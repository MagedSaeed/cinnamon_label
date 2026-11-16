// Pure helpers shared by the content scripts (as globalThis.CLU) and the Node tests (via require).
// Nothing in here touches the DOM, Chrome APIs or Label Studio.
(function (root) {
  const U = {};

  // A stable key for a media file, so the same video is recognised whether Label Studio asks for
  // `?d=Yemen/Tazzi/x.mp4` or `?d=Yemen%2FTazzi%2Fx.mp4&lsref=1` (its waveform request).
  U.mediaKey = function mediaKey(url, base) {
    try {
      const u = new URL(url, base);
      u.searchParams.delete("lsref");
      const d = u.searchParams.get("d"); // already percent-decoded
      if (d != null) return `${u.origin}${u.pathname}?d=${d}`;
      const rest = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const q = rest.map(([k, v]) => `${k}=${v}`).join("&");
      return `${u.origin}${u.pathname}${q ? "?" + q : ""}`;
    } catch (_) {
      return String(url);
    }
  };

  // "bytes 0-0/169888163" -> { start: 0, end: 0, total: 169888163 }
  U.parseContentRange = function parseContentRange(header) {
    const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(header || "");
    if (!m) return null;
    return { start: +m[1], end: +m[2], total: m[3] === "*" ? null : +m[3] };
  };

  // Split [0, total) into inclusive byte ranges of at most `size` bytes.
  U.planChunks = function planChunks(total, size) {
    if (!(total > 0) || !(size > 0)) return [];
    const out = [];
    for (let s = 0; s < total; s += size) out.push([s, Math.min(total, s + size) - 1]);
    return out;
  };

  U.fmtBytes = function fmtBytes(n) {
    if (!(n >= 0)) return "?";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
    if (n >= 1e7) return Math.round(n / 1e6) + " MB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    if (n >= 1e3) return Math.round(n / 1e3) + " KB";
    return n + " B";
  };

  // 75.25 -> "1:15.2"; 3725 -> "1:02:05.0"
  U.fmtClock = function fmtClock(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "–";
    const tenths = Math.floor(sec * 10 + 1e-6);
    const t = tenths % 10;
    const total = Math.floor(tenths / 10);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}.${t}` : `${m}:${ss}.${t}`;
  };

  U.fmtEta = function fmtEta(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "";
    if (sec < 10) return "a few seconds left";
    if (sec < 60) return `about ${Math.round(sec / 10) * 10} s left`;
    const m = Math.round(sec / 60);
    return `about ${m} min left`;
  };

  // Throughput over a sliding window (bytes per second).
  U.SpeedMeter = class SpeedMeter {
    constructor(windowMs = 4000) {
      this.windowMs = windowMs;
      this.samples = [];
    }
    add(t, loaded) {
      this.samples.push([t, loaded]);
      while (this.samples.length > 2 && t - this.samples[1][0] >= this.windowMs) this.samples.shift();
    }
    rate() {
      if (this.samples.length < 2) return 0;
      const [t0, l0] = this.samples[0];
      const [t1, l1] = this.samples[this.samples.length - 1];
      return t1 > t0 ? ((l1 - l0) * 1000) / (t1 - t0) : 0;
    }
  };

  // Least-recently-used eviction plan. index: { key: { size, used } }.
  // Returns the keys to delete so the total fits in `limit` (never evicts `keep`).
  U.lruEvict = function lruEvict(index, limit, keep) {
    const entries = Object.entries(index || {});
    let total = entries.reduce((t, [, v]) => t + (v.size || 0), 0);
    const out = [];
    entries
      .filter(([k]) => k !== keep)
      .sort((a, b) => (a[1].used || 0) - (b[1].used || 0))
      .forEach(([k, v]) => {
        if (total > limit) {
          out.push(k);
          total -= v.size || 0;
        }
      });
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = U;
  else root.CLU = U;
})(globalThis);

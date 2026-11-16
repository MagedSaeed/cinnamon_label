// Runs in the page's MAIN world, before Label Studio starts (document_start).
//
// What it does:
//  1. Answers read-only questions from the content script about the open task (window.Htx).
//  2. Holds Label Studio's own waveform download (the XHR whose URL has `lsref=1`) and, when
//     Cinnamon Label has the same file, lets Label Studio read it from that copy instead of
//     downloading the whole video a second time. If Cinnamon Label does not claim the request
//     quickly, or anything goes wrong, the request goes to the network exactly as before.
//
// It never submits, updates, skips or deletes anything, and never calls Label Studio's API.
(() => {
  if (window.__CL_BRIDGE__) return;
  window.__CL_BRIDGE__ = true;

  const CH = "CL_BRIDGE_v1";
  const ORIGIN = location.origin;
  const post = (msg) => window.postMessage({ ch: CH, dir: "toContent", ...msg }, ORIGIN);

  // ---------- 2. Label Studio's waveform request ----------
  // Held whenever Cinnamon Label is switched on (in either UI mode: switching to the native UI
  // also triggers this request). The content script then serves it from its copy or releases it.
  // Extension off, or an unreadable flag: never touch the request.
  const extensionActive = () => {
    try {
      return localStorage.getItem("cinnamonLabel.active") === "1";
    } catch (_) {
      return false;
    }
  };
  const isWaveformRequest = (url) => /[?&]lsref=1(&|$)/.test(url) && /\/data\/local-files\//.test(url);

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  const XA = XMLHttpRequest.prototype.abort;
  const meta = new WeakMap(); // xhr -> { method, url, async }
  const held = new Map(); // id -> { go(blob|null), claimed }
  let seq = 0;

  XMLHttpRequest.prototype.open = function (method, url, async, ...rest) {
    try {
      meta.set(this, { method, url: String(url), async: async !== false, aborted: false });
    } catch (_) {}
    return XO.call(this, method, url, async === undefined ? true : async, ...rest);
  };

  XMLHttpRequest.prototype.abort = function () {
    const m = meta.get(this);
    if (m) m.aborted = true;
    return XA.call(this);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const m = meta.get(this);
    if (!m || !m.async || !isWaveformRequest(m.url) || !extensionActive()) return XS.call(this, body);

    const xhr = this;
    const id = ++seq;
    let done = false;
    const go = (blob) => {
      if (done) return;
      done = true;
      held.delete(id);
      if (m.aborted) return;
      if (blob) {
        try {
          const bu = URL.createObjectURL(blob);
          xhr.addEventListener("loadend", () => URL.revokeObjectURL(bu), { once: true });
          XO.call(xhr, m.method, bu, true); // responseType and listeners survive a re-open
          XS.call(xhr, body);
          return;
        } catch (_) {
          /* fall through to the network */
        }
        try {
          XO.call(xhr, m.method, m.url, true);
        } catch (_) {}
      }
      try {
        XS.call(xhr, body); // the original open() is still in effect when we never re-opened
      } catch (_) {}
    };
    held.set(id, { go, claimed: false });

    // Ask until claimed (the content script may load after Label Studio fires the request).
    const started = Date.now();
    const ask = () => {
      const h = held.get(id);
      if (!h || h.claimed) return;
      if (Date.now() - started > 6000) return go(null);
      post({ op: "waveformWanted", id, url: m.url });
      setTimeout(ask, 500);
    };
    ask();
  };

  // ---------- 1. read-only task state ----------
  function state() {
    const s = window.Htx;
    const a = s && s.annotationStore && s.annotationStore.selected;
    if (!s || !a || !s.task) return { ready: false };
    let data = s.task.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = {};
      }
    }
    return {
      ready: true,
      taskId: s.task.id,
      annotationKey: String(a.id),
      readOnly: !!(a.readonly || (typeof a.isReadOnly === "function" && a.isReadOnly())),
      mediaUrl: (data && (data.video || data.audio)) || null,
    };
  }

  function reply(id, ok, data) {
    post({ id, ok, data });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGIN) return;
    const m = ev.data;
    if (!m || m.ch !== CH || m.dir !== "toPage") return;
    try {
      switch (m.op) {
        case "state":
          return reply(m.id, true, state());
        case "waveformClaim": {
          const h = held.get(m.args.id);
          if (h) h.claimed = true;
          return reply(m.id, true, !!h);
        }
        case "waveformServe": {
          const h = held.get(m.args.id);
          if (h) h.go(m.args.blob || null);
          return reply(m.id, true, !!h);
        }
        case "waveformRelease": {
          const h = held.get(m.args.id);
          if (h) h.go(null);
          return reply(m.id, true, !!h);
        }
        default:
          return reply(m.id, false, "unknown op " + m.op);
      }
    } catch (e) {
      reply(m.id, false, String((e && e.message) || e));
    }
  });
})();

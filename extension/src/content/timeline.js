// Two-lane timeline drawn on canvases.
//  Overview: the whole video. Click or drag to seek. Shows played part, buffered strip, and the
//            window shown in the detail lane.
//  Detail:   a zoomed window (15 s by default) that follows the playhead. Ruler with times.
//            Ctrl+wheel or the buttons zoom; the wheel pans. Click to seek.
// The <video> element is the only clock; the timeline only reads it and seeks it.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  const C = {
    bg: "#ffffff",
    wave: "#b3bac5",
    played: "#3d4452",
    center: "#d9dde3",
    accent: "#8a4b2a",
    accentFill: "rgba(138,75,42,0.05)",
    accentLine: "rgba(138,75,42,0.45)",
    buffered: "#c3c8d0",
    ruler: "#8c93a0",
    tick: "#d9dde3",
    hover: "rgba(29,33,41,0.35)",
    text: "#5d6573",
  };
  const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const MIN_SPAN = 1;
  const DEFAULT_SPAN = 15;

  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return { w, h, dpr };
  }

  CL.Timeline = class Timeline {
    constructor({ overview, detail, player, onView }) {
      this.ov = overview;
      this.dt = detail;
      this.player = player;
      this.v = player.v;
      this.onView = onView || (() => {});
      this.audio = null;
      this.message = "";
      this.viewStart = 0;
      this.span = DEFAULT_SPAN;
      this.follow = true;
      this.hoverX = null;
      this._raf = 0;
      this._dead = false;

      const inv = () => this.invalidate();
      this._ro = new ResizeObserver(inv);
      this._ro.observe(this.ov);
      this._ro.observe(this.dt);
      for (const ev of ["play", "pause", "seeked", "durationchange", "progress", "emptied", "loadedmetadata"]) CL.on(this.v, ev, inv);
      CL.on(this.v, "play", () => (this.follow = true));

      // Overview: drag the detail-window box to scroll the detail lane (playhead stays);
      // click or drag anywhere else to seek.
      let ovDrag = null; // { mode: "seek" | "view", grabT }
      const ovTime = (e) => {
        const r = this.ov.getBoundingClientRect();
        return ((e.clientX - r.left) / r.width) * this.duration;
      };
      const ovSeek = (e) => {
        const t = ovTime(e);
        this.player.seekTo(t);
        this.follow = true;
        this._reveal(t, true);
        this.invalidate();
      };
      const inBox = (t) => t >= this.viewStart && t <= this.viewStart + this.span && this.span < this.duration;
      CL.on(this.ov, "pointerdown", (e) => {
        if (!this.duration || e.button !== 0) return;
        this.ov.setPointerCapture(e.pointerId);
        const t = ovTime(e);
        if (inBox(t)) {
          ovDrag = { mode: "view", grabT: t - this.viewStart };
          this.follow = false;
        } else {
          ovDrag = { mode: "seek" };
          ovSeek(e);
        }
      });
      CL.on(this.ov, "pointermove", (e) => {
        if (!ovDrag) {
          this.ov.style.cursor = this.duration && inBox(ovTime(e)) ? "grab" : "pointer";
          return;
        }
        if (ovDrag.mode === "seek") return ovSeek(e);
        this.ov.style.cursor = "grabbing";
        this.viewStart = ovTime(e) - ovDrag.grabT;
        this._clampView();
        this.invalidate();
      });
      const ovEnd = () => {
        ovDrag = null;
        this.ov.style.cursor = "";
      };
      CL.on(this.ov, "pointerup", ovEnd);
      CL.on(this.ov, "pointercancel", ovEnd);

      // Detail: click to seek (dragging is reserved for segment editing).
      let down = null;
      CL.on(this.dt, "pointerdown", (e) => {
        if (e.button === 0) down = { x: e.clientX, y: e.clientY };
      });
      CL.on(this.dt, "pointerup", (e) => {
        if (down && Math.abs(e.clientX - down.x) < 4 && Math.abs(e.clientY - down.y) < 4) this.player.seekTo(this._xToTime(e));
        down = null;
        this.invalidate();
      });
      CL.on(this.dt, "pointermove", (e) => {
        this.hoverX = e.clientX - this.dt.getBoundingClientRect().left;
        this.invalidate();
      });
      CL.on(this.dt, "pointerleave", () => {
        this.hoverX = null;
        this.invalidate();
      });
      this.dt.addEventListener(
        "wheel",
        CL.guard((e) => {
          if (!this.duration) return;
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(e.deltaY * 0.0025), this._xToTime(e));
          else {
            const px = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            this.pan((px / this.dt.clientWidth) * this.span);
          }
        }),
        { passive: false }
      );
    }

    get duration() {
      const d = this.v.duration;
      return Number.isFinite(d) && d > 0 ? d : this.audio ? this.audio.duration : 0;
    }

    setAudio(track) {
      this.audio = track;
      this.invalidate();
    }
    setMessage(text) {
      this.message = text || "";
      this.invalidate();
    }

    // ---------- view ----------
    _clampView() {
      const d = this.duration;
      this.span = Math.max(MIN_SPAN, Math.min(this.span, d || DEFAULT_SPAN));
      this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, d - this.span)));
    }
    _reveal(t, center) {
      if (center || t < this.viewStart || t > this.viewStart + this.span) this.viewStart = t - this.span / 2;
      this._clampView();
    }
    zoomBy(factor, around) {
      const d = this.duration;
      if (!d) return;
      const t = around != null ? around : this.v.currentTime || 0;
      const frac = (t - this.viewStart) / this.span;
      this.span = this.span * factor;
      this._clampView();
      this.viewStart = t - frac * this.span;
      this._clampView();
      this.invalidate();
    }
    setSpan(seconds) {
      if (!this.duration || !(seconds > 0)) return;
      this.zoomBy(seconds / this.span);
    }
    pan(seconds) {
      this.viewStart += seconds;
      this.follow = false;
      this._clampView();
      this.invalidate();
    }
    _xToTime(e) {
      const r = this.dt.getBoundingClientRect();
      return this.viewStart + ((e.clientX - r.left) / r.width) * this.span;
    }

    // ---------- drawing ----------
    invalidate() {
      if (!this._raf && !this._dead) this._raf = requestAnimationFrame(() => this._frame());
    }
    _frame() {
      this._raf = 0;
      if (this._dead) return;
      try {
        this._draw();
      } catch (e) {
        CL.fail(e);
        return;
      }
      if (!this.v.paused) this.invalidate(); // keep animating while playing
    }

    // min/max of the signal over [t0, t1)
    _range(t0, t1) {
      const a = this.audio;
      if (!a || t0 >= a.decodedUntil) return null;
      if ((t1 - t0) * a.pps >= 1) {
        const b0 = Math.max(0, (t0 * a.pps) | 0);
        const b1 = Math.min(a.min.length, Math.max(b0 + 1, (t1 * a.pps) | 0));
        let lo = 0;
        let hi = 0;
        for (let b = b0; b < b1; b++) {
          if (a.min[b] < lo) lo = a.min[b];
          if (a.max[b] > hi) hi = a.max[b];
        }
        return [lo, hi];
      }
      // Deep zoom: read the 16 kHz copy.
      const s = a._pcmSum;
      const c = a._pcmCnt;
      const j0 = Math.max(0, Math.floor(t0 * a.pcmRate));
      const j1 = Math.min(s.length, Math.max(j0 + 1, Math.ceil(t1 * a.pcmRate)));
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = j0; j < j1; j++) {
        const x = c[j] ? s[j] / c[j] : 0;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return lo === Infinity ? null : [lo, hi];
    }

    _wave(ctx, x0, w, top, h, t0, span, playX, gain) {
      const mid = top + h / 2;
      const amp = (h / 2) * gain;
      ctx.fillStyle = C.center;
      ctx.fillRect(x0, Math.round(mid), w, 1);
      for (let x = 0; x < w; x++) {
        const r = this._range(t0 + (x / w) * span, t0 + ((x + 1) / w) * span);
        if (!r) continue;
        const y0 = mid - Math.min(1, r[1]) * amp;
        const y1 = mid - Math.max(-1, r[0]) * amp;
        ctx.fillStyle = x0 + x < playX ? C.played : C.wave;
        ctx.fillRect(x0 + x, y0, 1, Math.max(1, y1 - y0));
      }
    }

    _draw() {
      const d = this.duration;
      const t = this.v.currentTime || 0;
      if (this.follow && !this.v.paused && d) {
        if (t < this.viewStart || t > this.viewStart + this.span * 0.85) this.viewStart = t - this.span * 0.15;
      }
      this._clampView();
      this.onView(this);

      // Normalise loudness so quiet recordings are still readable.
      const gain = this.audio ? Math.min(4, 0.9 / Math.max(0.05, this._peak())) : 1;

      // ---- overview ----
      {
        const { w, h, dpr } = fitCanvas(this.ov);
        const ctx = this.ov.getContext("2d");
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, w, h);
        if (d) {
          const playX = (t / d) * w;
          this._wave(ctx, 0, w, 3 * dpr, h - 9 * dpr, 0, d, playX, gain);
          // buffered strip (what plays without stopping)
          const b = this.v.buffered;
          ctx.fillStyle = C.buffered;
          for (let i = 0; i < b.length; i++) {
            const x0 = (b.start(i) / d) * w;
            ctx.fillRect(x0, h - 3 * dpr, (b.end(i) / d) * w - x0, 3 * dpr);
          }
          // detail window
          const vx = (this.viewStart / d) * w;
          const vw = Math.max(2, (this.span / d) * w);
          ctx.fillStyle = C.accentFill;
          ctx.fillRect(vx, 0, vw, h - 4 * dpr);
          ctx.strokeStyle = C.accentLine;
          ctx.lineWidth = dpr;
          ctx.strokeRect(vx + dpr / 2, dpr / 2, vw - dpr, h - 4 * dpr - dpr);
          // playhead
          ctx.fillStyle = C.accent;
          ctx.fillRect(Math.round(playX - dpr), 0, 2 * dpr, h);
        }
      }

      // ---- detail ----
      {
        const { w, h, dpr } = fitCanvas(this.dt);
        const ctx = this.dt.getContext("2d");
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, w, h);
        const rulerH = 20 * dpr;
        if (d) {
          const t0 = this.viewStart;
          const span = this.span;
          const toX = (tt) => ((tt - t0) / span) * w;
          // ruler
          const pxPerSec = w / span;
          const step = STEPS.find((s) => s * pxPerSec >= 80 * dpr) || STEPS[STEPS.length - 1];
          const minor = step / (step >= 1 && step % 5 === 0 ? 5 : 2);
          ctx.fillStyle = C.tick;
          for (let s = Math.ceil(t0 / minor) * minor; s <= t0 + span; s += minor) ctx.fillRect(Math.round(toX(s)), rulerH - 4 * dpr, dpr, 4 * dpr);
          ctx.font = `${11 * dpr}px system-ui, sans-serif`;
          ctx.textBaseline = "middle";
          for (let s = Math.ceil(t0 / step) * step; s <= t0 + span + 1e-9; s += step) {
            const x = Math.round(toX(s));
            ctx.fillStyle = C.tick;
            ctx.fillRect(x, rulerH - 8 * dpr, dpr, 8 * dpr);
            ctx.fillStyle = C.ruler;
            const label = step < 1 ? U.fmtClock(s) : U.fmtClock(s).replace(/\.0$/, "");
            ctx.fillText(label, x + 4 * dpr, rulerH / 2 - dpr);
          }
          ctx.fillStyle = C.tick;
          ctx.fillRect(0, rulerH, w, dpr);
          // waveform
          const playX = toX(t);
          this._wave(ctx, 0, w, rulerH + 6 * dpr, h - rulerH - 12 * dpr, t0, span, playX, gain);
          // hover line + time
          if (this.hoverX != null) {
            const hx = Math.round(this.hoverX * dpr);
            ctx.fillStyle = C.hover;
            ctx.fillRect(hx, rulerH, dpr, h - rulerH);
            const label = U.fmtClock(t0 + (hx / w) * span);
            const tw = ctx.measureText(label).width + 8 * dpr;
            const lx = Math.min(w - tw, hx + 2 * dpr);
            ctx.fillStyle = "#fff";
            ctx.fillRect(lx, 2 * dpr, tw, rulerH - 6 * dpr);
            ctx.fillStyle = C.text;
            ctx.fillText(label, lx + 4 * dpr, rulerH / 2 - dpr);
          }
          // playhead
          if (playX >= -2 && playX <= w + 2) {
            ctx.fillStyle = C.accent;
            ctx.fillRect(Math.round(playX - dpr), 0, 2 * dpr, h);
            ctx.beginPath();
            ctx.moveTo(playX - 5 * dpr, 0);
            ctx.lineTo(playX + 5 * dpr, 0);
            ctx.lineTo(playX, 6 * dpr);
            ctx.closePath();
            ctx.fill();
          }
        }
        if (this.message) {
          ctx.font = `${12 * dpr}px system-ui, sans-serif`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillStyle = C.text;
          ctx.fillText(this.message, w / 2, (h + rulerH) / 2);
          ctx.textAlign = "start";
        }
      }
    }

    // Loudest point decoded so far (cached per audio version).
    _peak() {
      const a = this.audio;
      if (this._peakVersion === a.version) return this._peakVal;
      let p = 0;
      const n = Math.min(a.max.length, Math.ceil(a.decodedUntil * a.pps));
      for (let i = 0; i < n; i++) {
        const v = Math.max(a.max[i], -a.min[i]);
        if (v > p) p = v;
      }
      this._peakVersion = a.version;
      this._peakVal = p;
      return p;
    }

    destroy() {
      this._dead = true;
      cancelAnimationFrame(this._raf);
      this._ro.disconnect();
    }
  };
})();

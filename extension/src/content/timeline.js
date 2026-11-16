// Two-lane timeline drawn on canvases.
//  Overview: the whole video, with segments and suggestions in miniature. Click or drag to seek.
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
    buffered: "#c3c8d0",
    ruler: "#8c93a0",
    tick: "#d9dde3",
    hover: "rgba(29,33,41,0.35)",
    text: "#5d6573",
    segFill: "rgba(61,68,82,0.07)",
    segSelFill: "rgba(138,75,42,0.13)",
    segNewFill: "rgba(138,75,42,0.18)",
    segEdge: "#7d8594",
    segTag: "#7d8594",
    segOv: "#9aa1ad",
    segEdgeOv: "#5f6776",
    playedSel: "#7a3c1e",
    waveSel: "#d9b8a5",
    sugFill: "rgba(61,68,82,0.035)",
    sugLine: "#6f7785",
    sugOv: "#a7aebb",
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
      // Overview: click or drag anywhere to seek.
      CL.on(this.ov, "pointerdown", (e) => {
        if (!this.duration || e.button !== 0) return;
        this.ov.setPointerCapture(e.pointerId);
        ovDrag = { mode: "seek" };
        ovSeek(e);
      });
      CL.on(this.ov, "pointermove", (e) => {
        if (ovDrag) ovSeek(e);
      });
      const ovEnd = () => {
        ovDrag = null;
        this.ov.style.cursor = "";
      };
      CL.on(this.ov, "pointerup", ovEnd);
      CL.on(this.ov, "pointercancel", ovEnd);

      // Detail lane: segments.
      //  drag on empty waveform -> new segment; drag an edge -> resize; click a segment -> select + seek;
      //  click empty -> seek. Edges snap to the playhead and other edges (Shift: no snapping);
      //  Alt while resizing leaves a touching neighbour where it is.
      CL.on(this.dt, "pointerdown", (e) => this._down(e));
      CL.on(this.dt, "pointermove", (e) => this._move(e));
      CL.on(this.dt, "pointerup", (e) => this._up(e));
      CL.on(this.dt, "pointercancel", () => {
        this.drag = null;
        this.preview = null;
        this.invalidate();
      });
      CL.on(this.dt, "pointerleave", () => {
        if (this.drag) return;
        this.hoverX = null;
        this.hoverEdge = null;
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

    // ---------- segments ----------
    setStore(store) {
      this.store = store;
      this.drag = null;
      this.preview = null;
      this.invalidate();
    }
    get segs() {
      const list = this.preview || (this.store ? this.store.segments : []);
      // "Add segment" in progress: show the segment growing from its start to the playhead.
      const m = this.marking;
      if (!m || this.preview) return list;
      const t = this.v.currentTime || 0;
      const a = Math.min(m.start, t);
      const b = Math.max(m.start, t);
      return b - a > 0.01 ? list.concat({ id: "__new", start: a, end: b }) : list;
    }
    get editable() {
      return !!(this.store && this.store.supported && !this.store.readOnly && !this.segmentsDisabled);
    }
    _localX(e) {
      return e.clientX - this.dt.getBoundingClientRect().left;
    }
    // Nearest segment edge within 7 px: { id, edge } (the selected segment wins ties).
    _edgeAt(x) {
      const w = this.dt.clientWidth;
      const toX = (t) => ((t - this.viewStart) / this.span) * w;
      let best = null;
      for (const g of this.segs) {
        if (g.id === "__new") continue; // the "Add segment" preview has no handles
        for (const edge of ["start", "end"]) {
          const d = Math.abs(toX(g[edge]) - x);
          const pref = this.store && g.id === this.store.selected ? -0.5 : 0;
          if (d <= 7 && (!best || d + pref < best.d)) best = { id: g.id, edge, d: d + pref };
        }
      }
      return best;
    }
    // Snap t to the playhead or another segment's edge within 6 px (not while Shift is held).
    _snap(t, e, exclude) {
      if (e.shiftKey) return t;
      const pxPerSec = this.dt.clientWidth / this.span;
      let best = t;
      let bestD = 6 / pxPerSec;
      const cands = [this.v.currentTime || 0];
      for (const g of this.segs) if (g.id !== exclude) cands.push(g.start, g.end);
      for (const c of cands) {
        const d = Math.abs(c - t);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      return best;
    }
    _down(e) {
      if (e.button !== 0 || !this.duration) return;
      this.dt.setPointerCapture(e.pointerId);
      const x = this._localX(e);
      const t = this._xToTime(e);
      const base = this.store ? this.store.segments.map((g) => ({ id: g.id, start: g.start, end: g.end })) : [];
      const edge = this.editable ? this._edgeAt(x) : null;
      if (edge) this.drag = { kind: "edge", id: edge.id, edge: edge.edge, base, x0: x };
      else {
        const inside = globalThis.CLSeg.segmentAt(base, t);
        // On a suggestion (outside real segments): a click adds it, a drag still creates a segment.
        const sug = !inside && this.editable ? this._sugAt(t) : null;
        this.drag = inside ? { kind: "select", id: inside.id, x0: x } : { kind: "create", t0: this._snap(t, e), base, x0: x, sug };
      }
    }
    get sugs() {
      return (this.store && this.store.suggestions) || [];
    }
    _sugAt(t) {
      return this.sugs.find((s) => s.start <= t && s.end >= t) || null;
    }
    _move(e) {
      const x = this._localX(e);
      this.hoverX = x;
      const S = globalThis.CLSeg;
      const d = this.drag;
      if (!d) {
        this.hoverEdge = this.editable ? this._edgeAt(x) : null;
        const t = this._xToTime(e);
        const inSeg = S.segmentAt(this.segs, t);
        const sug = !this.hoverEdge && !inSeg && this.editable ? this._sugAt(t) : null;
        this.dt.style.cursor = this.hoverEdge ? "ew-resize" : sug ? "copy" : this.editable && !inSeg ? "crosshair" : "pointer";
        this.dt.title = sug ? `Click to add this suggested segment (${sug.speaker}), or drag to make your own.` : "";
        return this.invalidate();
      }
      d.moved = d.moved || Math.abs(x - d.x0) > 3;
      if (!d.moved) return;
      this.follow = false; // dragging: keep the view still
      if (d.kind === "edge") {
        const t = this._snap(this._xToTime(e), e, d.id);
        d.plan = S.moveEdge(d.base, d.id, d.edge, t, this.duration, { detach: e.altKey });
        this.preview = d.plan ? S.apply(d.base, d.plan) : null;
      } else if (d.kind === "create" && this.editable) {
        const r = S.create(d.base, d.t0, this._snap(this._xToTime(e), e), this.duration);
        d.plan = r ? r.plan : null;
        this.preview = r ? S.apply(d.base, r.plan, ["__new"]) : null;
      }
      this._autoscroll(x);
      this.invalidate();
    }
    _up(e) {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      const t = this._xToTime(e);
      const store = this.store;
      if (!d.moved) {
        if (d.sug && this.onSuggestion) {
          this.onSuggestion(d.sug); // add the clicked suggestion as a real segment
          this.invalidate();
          return;
        }
        if (d.kind === "select" || d.kind === "edge") {
          if (store) store.select(d.id);
        } else if (store) store.select(null);
        this.player.seekTo(t);
      } else if (d.plan && store) {
        store.apply(d.plan, { select: d.kind === "create" ? "created" : d.id });
      }
      this.preview = null;
      this.invalidate();
    }
    // While dragging near the lane's edges, scroll the view.
    _autoscroll(x) {
      const w = this.dt.clientWidth;
      const margin = 24;
      if (x < margin) this.viewStart -= this.span * 0.02;
      else if (x > w - margin) this.viewStart += this.span * 0.02;
      else return;
      this._clampView();
    }
    // Make sure segment g is visible in the detail lane.
    revealSegment(g) {
      if (!g) return;
      if (g.end - g.start > this.span * 0.9) this.span = Math.min(this.duration, (g.end - g.start) / 0.8);
      if (g.start < this.viewStart || g.end > this.viewStart + this.span) this.viewStart = g.start - (this.span - (g.end - g.start)) / 2;
      this.follow = false;
      this._clampView();
      this.invalidate();
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
      if (!this.v.paused || this.marking) this.invalidate(); // keep animating while playing / marking
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

    // sel: [x0, x1] pixel range of the selected segment: its waveform takes the segment's colour
    // (deep cinnamon where played, light cinnamon ahead), so progress inside it is easy to see.
    _wave(ctx, x0, w, top, h, t0, span, playX, gain, sel) {
      const mid = top + h / 2;
      const amp = (h / 2) * gain;
      ctx.fillStyle = C.center;
      ctx.fillRect(x0, Math.round(mid), w, 1);
      for (let x = 0; x < w; x++) {
        const r = this._range(t0 + (x / w) * span, t0 + ((x + 1) / w) * span);
        if (!r) continue;
        const y0 = mid - Math.min(1, r[1]) * amp;
        const y1 = mid - Math.max(-1, r[0]) * amp;
        const px = x0 + x;
        const inSel = sel && px >= sel[0] && px < sel[1];
        ctx.fillStyle = px < playX ? (inSel ? C.playedSel : C.played) : inSel ? C.waveSel : C.wave;
        ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0));
      }
    }
    // Pixel range of the selected segment on a lane drawn from t0 over span seconds, w pixels wide.
    _selRange(t0, span, w) {
      const g = this.store && this.store.selected ? this.segs.find((x) => x.id === this.store.selected) : null;
      return g ? [((g.start - t0) / span) * w, ((g.end - t0) / span) * w] : null;
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
          const top = 0;
          const bottom = h - 4 * dpr; // the buffered strip sits below
          // A miniature of the detail lane: suggestions (dashed) and segments (tinted, edged) behind
          // the waveform, the selected segment in cinnamon.
          ctx.save();
          ctx.setLineDash([4 * dpr, 3 * dpr]);
          ctx.strokeStyle = C.sugLine;
          ctx.lineWidth = dpr;
          for (const s of this.sugs) {
            const x0 = (s.start / d) * w;
            const x1 = (s.end / d) * w;
            ctx.fillStyle = C.sugFill;
            ctx.fillRect(x0, top, x1 - x0, bottom - top);
            ctx.strokeRect(x0 + dpr / 2, top + dpr / 2, Math.max(dpr, x1 - x0 - dpr), bottom - top - dpr);
          }
          ctx.restore();
          const sel = this.store && this.store.selected;
          for (const g of this.segs) {
            const x0 = (g.start / d) * w;
            const x1 = (g.end / d) * w;
            const isSel = g.id === sel || g.id === "__new";
            ctx.fillStyle = isSel ? C.segSelFill : C.segFill;
            ctx.fillRect(x0, top, Math.max(dpr, x1 - x0), bottom - top);
          }
          this._wave(ctx, 0, w, 3 * dpr, h - 9 * dpr, 0, d, playX, gain, this._selRange(0, d, w));
          // clear boundaries on top of the waveform: 2 px (3 px cinnamon for the selected segment)
          for (const g of this.segs) {
            const isSel = g.id === sel || g.id === "__new";
            const ew = (isSel ? 3 : 2) * dpr;
            const x0 = (g.start / d) * w;
            const x1 = (g.end / d) * w;
            ctx.fillStyle = isSel ? C.accent : C.segEdgeOv;
            ctx.fillRect(Math.round(x0), top, ew, bottom - top);
            ctx.fillRect(Math.round(x1) - ew, top, ew, bottom - top);
          }
          // buffered strip (what plays without stopping)
          const b = this.v.buffered;
          ctx.fillStyle = C.buffered;
          for (let i = 0; i < b.length; i++) {
            const x0 = (b.start(i) / d) * w;
            ctx.fillRect(x0, h - 3 * dpr, (b.end(i) / d) * w - x0, 3 * dpr);
          }
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
          // presegmentation suggestions (dashed, behind everything; real segments draw over them)
          ctx.save();
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.lineWidth = 1.5 * dpr;
          ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`;
          ctx.textBaseline = "middle";
          for (const s of this.sugs) {
            const x0 = toX(s.start);
            const x1 = toX(s.end);
            if (x1 < 0 || x0 > w) continue;
            ctx.fillStyle = C.sugFill;
            ctx.fillRect(x0, rulerH + dpr, x1 - x0, h - rulerH - dpr);
            ctx.strokeStyle = C.sugLine;
            ctx.strokeRect(x0 + dpr, rulerH + 2 * dpr, x1 - x0 - 2 * dpr, h - rulerH - 4 * dpr);
            if (x1 - x0 > 26 * dpr) {
              ctx.fillStyle = C.sugLine;
              ctx.fillText(s.speaker || "", Math.max(x0, 0) + 5 * dpr, h - 10 * dpr);
            }
          }
          ctx.restore();
          // segment blocks (behind the waveform)
          const sel = this.store && this.store.selected;
          const segs = this.segs;
          for (const g of segs) {
            const x0 = toX(g.start);
            const x1 = toX(g.end);
            if (x1 < 0 || x0 > w) continue;
            ctx.fillStyle = g.id === sel ? C.segSelFill : g.id === "__new" ? C.segNewFill : C.segFill;
            ctx.fillRect(x0, rulerH + dpr, x1 - x0, h - rulerH - dpr);
          }
          // waveform
          const playX = toX(t);
          this._wave(ctx, 0, w, rulerH + 6 * dpr, h - rulerH - 12 * dpr, t0, span, playX, gain, this._selRange(t0, span, w));
          // segment edges and numbers (on top)
          ctx.font = `600 ${10.5 * dpr}px system-ui, sans-serif`;
          ctx.textBaseline = "middle";
          segs.forEach((g, i) => {
            const x0 = toX(g.start);
            const x1 = toX(g.end);
            if (x1 < -2 || x0 > w + 2) return;
            const isSel = g.id === sel;
            const col = isSel || g.id === "__new" ? C.accent : C.segEdge;
            for (const [edge, x] of [["start", x0], ["end", x1]]) {
              const hot = this.hoverEdge && this.hoverEdge.id === g.id && this.hoverEdge.edge === edge;
              ctx.fillStyle = hot ? C.accent : col;
              const lw = (hot ? 3 : isSel ? 2 : 1.5) * dpr;
              ctx.fillRect(Math.round(x - lw / 2), rulerH + dpr, lw, h - rulerH - dpr);
            }
            if (g.id !== "__new" && x1 - x0 > 18 * dpr) {
              const label = String(i + 1);
              const tw = ctx.measureText(label).width + 8 * dpr;
              const lx = Math.max(x0, 0) + 3 * dpr;
              if (lx + tw < x1) {
                ctx.fillStyle = isSel ? C.accent : C.segTag;
                ctx.fillRect(lx, rulerH + 4 * dpr, tw, 14 * dpr);
                ctx.fillStyle = "#fff";
                ctx.fillText(label, lx + 4 * dpr, rulerH + 11 * dpr);
              }
            }
          });
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

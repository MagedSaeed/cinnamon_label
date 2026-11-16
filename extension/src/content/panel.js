// Side panel: the list of segments and the selected segment's details and actions.
// All edits go through the SegmentStore (which writes into Label Studio's annotation).
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  CL.PANEL_CSS = `
[hidden]{display:none !important}
.panel{display:flex; flex-direction:column; gap:14px; min-height:0}
.ph{display:flex; align-items:center; gap:10px}
.ph h2{margin:0; font-size:14px; font-weight:650}
.ph .count{color:var(--muted); font-weight:500; font-variant-numeric:tabular-nums}
.ph .undo{display:flex; gap:4px; margin-left:auto}
.icon{width:28px; height:28px; display:grid; place-items:center; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); padding:0}
.icon svg{width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.icon:disabled{opacity:.35; cursor:default}
.icon:not(:disabled):hover{border-color:#c9ced6}
.list{list-style:none; margin:0; padding:0; max-height:34%; min-height:60px; overflow:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel)}
.list li + li{border-top:1px solid var(--line)}
.row{display:grid; grid-template-columns:28px 1fr auto; align-items:center; gap:8px; width:100%; padding:7px 10px; border:0; background:none; text-align:left; font-variant-numeric:tabular-nums}
.row:hover{background:var(--surface)}
.row .n{display:inline-grid; place-items:center; min-width:22px; height:20px; padding:0 5px; border-radius:4px; background:#7d8594; color:#fff; font-size:11.5px; font-weight:650}
.row .t{color:var(--ink)}
.row .d{color:var(--muted); font-size:12.5px}
li.sel .row{background:var(--cinnamon-soft)}
li.sel .n{background:var(--cinnamon)}
.empty{color:var(--muted); margin:0; max-width:46ch}
.detail{display:flex; flex-direction:column; gap:12px; padding-top:2px}
.detail h3{margin:0; font-size:14px; font-weight:650}
.times{display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap}
.times label{display:flex; flex-direction:column; gap:3px; font-size:12px; color:var(--muted)}
.times input{width:108px; padding:5px 8px; font:inherit; font-size:14px; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:6px; font-variant-numeric:tabular-nums}
.times input:focus{outline:none; border-color:var(--cinnamon); box-shadow:0 0 0 3px var(--cinnamon-soft)}
.times .dur{padding-bottom:7px; color:var(--muted); font-variant-numeric:tabular-nums}
.actions{display:flex; gap:8px; flex-wrap:wrap}
.btn{display:inline-flex; align-items:center; gap:6px; padding:6px 11px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); white-space:nowrap}
.btn svg{width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.btn:hover:not(:disabled){border-color:#c9ced6}
.btn:disabled{opacity:.4; cursor:default}
.btn.primary{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.btn.danger{color:var(--err)}
.btn.danger:hover:not(:disabled){border-color:#e8b4ae}
.note{margin:0; font-size:12.5px; color:var(--muted)}
.note.err{color:var(--err)}
.restore{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px; border-radius:8px; background:var(--cinnamon-soft); border:1px solid #e6cfc2}
.restore span{flex:1; min-width:200px}
.ro{margin:0; padding:8px 10px; border-radius:6px; background:var(--surface); color:var(--muted); border:1px solid var(--line)}
`;

  const I = {
    undo: `<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`,
    redo: `<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>`,
    play: `<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/></svg>`,
    split: `<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M5 8h4M5 16h4M15 8h4M15 16h4"/></svg>`,
    merge: `<svg viewBox="0 0 24 24"><path d="M4 12h16"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>`,
    del: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  };

  const fmtMs = (t) => {
    const ms = Math.round(t * 1000);
    const m = Math.floor(ms / 60000);
    const s = (ms % 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  };
  const fmtDur = (d) => (d < 60 ? `${d.toFixed(d < 10 ? 2 : 1)} s` : U.fmtClock(d));

  CL.createPanel = function createPanel(container, { player, timeline, textFields, onSelect }) {
    let store = null;
    let note = "";
    let noteErr = false;
    let history = { canUndo: false, canRedo: false };
    const S = globalThis.CLSeg;
    container.innerHTML = `
      <div class="panel">
        <div class="ph">
          <h2>Segments <span class="count" id="segCount"></span></h2>
          <div class="undo">
            <button class="icon" id="undo" title="Undo (Label Studio's history)" aria-label="Undo">${I.undo}</button>
            <button class="icon" id="redo" title="Redo" aria-label="Redo">${I.redo}</button>
          </div>
        </div>
        <div class="restore" id="restore" role="region" aria-label="Backup" hidden>
          <span id="rTxt"></span>
          <button class="btn primary" id="rDo">Restore</button>
          <button class="btn" id="rNo">Discard</button>
        </div>
        <ol class="list" id="segList" aria-label="Segments"></ol>
        <p class="empty" id="segEmpty">No segments yet. Drag across the waveform below to mark one.</p>
        <section class="detail" id="detail" hidden>
          <h3 id="dTitle"></h3>
          <div class="times">
            <label>Start<input id="dStart" spellcheck="false" autocomplete="off" aria-label="Segment start"></label>
            <label>End<input id="dEnd" spellcheck="false" autocomplete="off" aria-label="Segment end"></label>
            <span class="dur" id="dDur"></span>
          </div>
          <div class="actions">
            <button class="btn primary" id="aPlay">${I.play}Play segment</button>
            <button class="btn" id="aSplit" title="Split this segment where the playhead is">${I.split}Split at playhead</button>
            <button class="btn" id="aMerge" title="Join this segment with the next one">${I.merge}Merge with next</button>
            <button class="btn danger" id="aDel">${I.del}Delete</button>
          </div>
          <p class="note" id="dNote"></p>
          <div id="form"></div>
        </section>
        <p class="ro" id="readOnly" hidden>This annotation is read-only. You can play and review it, but not edit it.</p>
      </div>`;
    const $ = (id) => container.querySelector("#" + id);
    const D = () => timeline.duration;
    const base = () => store.segments.map((g) => ({ id: g.id, start: g.start, end: g.end }));
    const sel = () => (store && store.selected ? store.byId(store.selected) : null);
    const setNote = (t, err = false) => {
      note = t || "";
      noteErr = err;
      $("dNote").textContent = note;
      $("dNote").className = "note" + (err ? " err" : "");
    };
    const refreshHistory = () =>
      CL.page("history")
        .then((h) => {
          history = h;
          $("undo").disabled = !h.canUndo || !store || store.readOnly;
          $("redo").disabled = !h.canRedo || !store || store.readOnly;
        })
        .catch(() => {});

    // ---- list ----
    CL.on($("segList"), "click", (e) => {
      const li = e.target.closest("li[data-id]");
      if (!li) return;
      store.select(li.dataset.id);
      const g = store.byId(li.dataset.id);
      if (g) {
        player.seekTo(g.start);
        timeline.revealSegment(g);
      }
      onSelect && onSelect(g);
    });

    // ---- times ----
    for (const [id, which] of [["dStart", "start"], ["dEnd", "end"]]) {
      const input = $(id);
      const commit = async () => {
        const g = sel();
        if (!g) return;
        const v = U.parseDuration(input.value);
        if (v == null) {
          input.value = fmtMs(g[which]);
          setNote("Type a time like 12.5 or 0:12.500.", true);
          return;
        }
        const start = which === "start" ? v : g.start;
        const end = which === "end" ? v : g.end;
        const plan = S.setTimes(base(), g.id, start, end, D());
        if (!plan) {
          input.value = fmtMs(g[which]);
          setNote("That would make the segment empty or overlap another one.", true);
          return;
        }
        setNote("");
        await store.apply(plan, { select: g.id });
      };
      CL.on(input, "change", commit);
      CL.onFieldKey(input, (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur(); // fires "change"
        } else if (e.key === "Escape") {
          const g = sel();
          if (g) input.value = fmtMs(g[which]);
          input.blur();
        }
      });
    }

    // ---- actions ----
    CL.on($("aPlay"), "click", () => {
      const g = sel();
      if (g) player.playRange(g.start, g.end);
    });
    CL.on($("aSplit"), "click", async () => {
      const g = sel();
      if (!g) return;
      const t = player.v.currentTime || 0;
      if (t <= g.start || t >= g.end) return setNote("Move the playhead inside this segment first.", true);
      const plan = S.split(base(), g.id, t);
      if (!plan) return setNote("Too close to the segment's edge to split.", true);
      // A split usually means the speaker changed: the new segment starts with no answers.
      setNote("");
      await store.apply(plan, { select: g.id });
      setNote("Split. The new segment starts with no answers; this one keeps its answers and transcript.");
    });
    CL.on($("aMerge"), "click", async () => {
      const g = sel();
      if (!g) return;
      const r = S.mergeNext(base(), g.id);
      if (!r) return setNote("There is no next segment to merge with.", true);
      const next = store.byId(r.removedId);
      // Join the transcripts (each text field) so nothing typed is lost.
      r.plan.fields = [];
      for (const name of textFields()) {
        const a = [].concat(g.fields[name] || []).join("").trim();
        const b = [].concat((next && next.fields[name]) || []).join("").trim();
        if (b) r.plan.fields.push({ id: g.id, name, value: a ? `${a} ${b}` : b });
      }
      setNote("");
      await store.apply(r.plan, { select: g.id });
      setNote("Merged. The transcripts were joined; this segment's choices were kept.");
    });
    CL.on($("aDel"), "click", async () => {
      const g = sel();
      if (!g) return;
      const n = store.segments.findIndex((x) => x.id === g.id) + 1;
      await store.apply(S.remove(base(), g.id));
      setNote("");
      flash(`Segment ${n} deleted. Use Undo to bring it back.`);
    });
    CL.on($("undo"), "click", async () => {
      await store.flush();
      await CL.page("undo");
      await store.refresh();
      refreshHistory();
    });
    CL.on($("redo"), "click", async () => {
      await CL.page("redo");
      await store.refresh();
      refreshHistory();
    });
    let flashTimer;
    const flash = (t) => {
      $("segEmpty").textContent = t;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => ($("segEmpty").textContent = "No segments yet. Drag across the waveform below to mark one."), 4000);
      setNote(t);
    };

    // ---- backup offer ----
    let backup = null;
    const when = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    CL.on($("rDo"), "click", async () => {
      if (!backup) return;
      $("rDo").disabled = true;
      const r = await backup.restore();
      $("rDo").disabled = false;
      if (store) await store.refresh();
      flash(r.message);
    });
    let discardArmed = 0;
    CL.on($("rNo"), "click", async () => {
      if (!backup) return;
      if (Date.now() - discardArmed > 4000) {
        discardArmed = Date.now();
        $("rNo").textContent = "Click again to delete the backup";
        setTimeout(() => ($("rNo").textContent = "Discard"), 4000);
        return;
      }
      discardArmed = 0;
      $("rNo").textContent = "Discard";
      await backup.discard();
    });

    // ---- render ----
    let lastListSig = "";
    const api = {
      setBackup(b) {
        backup = b;
        api.showOffer(b ? b.offer : null);
      },
      // b: a stored backup ({ segments, savedAt }) to offer, or null.
      showOffer(b) {
        $("restore").hidden = !b;
        if (b) {
          const n = b.segments;
          $("rTxt").textContent = `This browser has unsubmitted work for this task from ${when(b.savedAt)}: ${n} segment${n === 1 ? "" : "s"}. Restore it?`;
        }
      },
      setStore(s) {
        store = s;
        setNote("");
        api.render();
      },
      render() {
        const has = !!store && store.supported;
        const segs = has ? store.segments : [];
        $("segCount").textContent = segs.length ? `(${segs.length})` : "";
        $("readOnly").hidden = !(store && store.readOnly);
        $("segEmpty").hidden = segs.length > 0;
        // list (rebuilt only when it changed, so scrolling and clicks aren't disturbed)
        const sig = segs.map((g) => `${g.id}:${g.start}:${g.end}`).join("|") + "#" + (store && store.selected);
        if (sig !== lastListSig) {
          lastListSig = sig;
          const ol = $("segList");
          ol.textContent = "";
          segs.forEach((g, i) => {
            const li = document.createElement("li");
            li.dataset.id = g.id;
            if (store.selected === g.id) li.className = "sel";
            li.innerHTML = `<button class="row"><span class="n">${i + 1}</span><span class="t">${U.fmtClock(g.start)} – ${U.fmtClock(g.end)}</span><span class="d">${fmtDur(g.end - g.start)}</span></button>`;
            ol.appendChild(li);
          });
          ol.hidden = !segs.length;
          const cur = ol.querySelector("li.sel");
          if (cur) cur.scrollIntoView({ block: "nearest" });
        }
        // detail
        const g = sel();
        $("detail").hidden = !g;
        if (g) {
          const i = segs.findIndex((x) => x.id === g.id);
          $("dTitle").textContent = `Segment ${i + 1} of ${segs.length}`;
          const root = container.getRootNode();
          if (root.activeElement !== $("dStart")) $("dStart").value = fmtMs(g.start);
          if (root.activeElement !== $("dEnd")) $("dEnd").value = fmtMs(g.end);
          $("dDur").textContent = fmtDur(g.end - g.start);
          const ro = store.readOnly;
          for (const id of ["dStart", "dEnd"]) $(id).disabled = ro;
          for (const id of ["aSplit", "aMerge", "aDel"]) $(id).disabled = ro;
          $("aMerge").disabled = ro || i === segs.length - 1;
        }
        refreshHistory();
      },
      form: () => $("form"),
    };
    return api;
  };
})();

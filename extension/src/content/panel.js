// The segment UI, in two places:
//  - the segment toolbar above the waveform: Add segment (mark start / mark end), the selected
//    segment's start/end, play, split, merge, delete, undo/redo (where editing happens);
//  - the side panel: whole-video fields, then one card per segment (an accordion): the collapsed
//    card summarises the segment (time, status, answers, transcript preview); clicking its header
//    opens the segment's form in place and closes the previously open one.
// All edits go through the SegmentStore (which writes into Label Studio's annotation).
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  CL.PANEL_CSS = `
[hidden]{display:none !important}
.panel{display:flex; flex-direction:column; gap:14px; min-height:0}
.ph{display:flex; align-items:baseline; gap:8px}
.ph h2{margin:0; font-size:14px; font-weight:650}
.ph .count{color:var(--muted); font-weight:500; font-variant-numeric:tabular-nums}
.ph{align-items:center}
.ph .sum{margin-left:auto; font-size:12.5px; color:var(--muted); font-variant-numeric:tabular-nums}
.sugbar{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px; border:1px dashed #9aa1ad; border-radius:8px; background:var(--surface)}
.sugbar span{flex:1; min-width:220px; color:var(--ink)}
.sugbar.busy span{color:var(--muted)}
.sugbar.err{border-style:solid; border-color:#e8b4ae; background:#fdf3f2}
.sugbar.err span{color:var(--err)}
.oldnote{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px; border-radius:8px; background:#fff8e6; border:1px solid #f0dca8}
.oldnote span{flex:1; min-width:220px}
.icon{width:30px; height:30px; display:grid; place-items:center; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); padding:0; flex:none}
.icon svg, .btn svg{width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.icon:disabled{opacity:.35; cursor:default}
.icon:not(:disabled):hover{border-color:#c9ced6}
/* segment cards */
.cards{display:flex; flex-direction:column; gap:8px}
.card{display:grid; grid-template-columns:auto minmax(0,1fr); border:1px solid var(--line); border-radius:10px; background:var(--panel); overflow:hidden}
.cbody{grid-column:1 / -1}
/* play this segment (beside the header: a button can't contain another button) */
.cplay{align-self:stretch; display:grid; place-items:start center; width:40px; padding:12px 0 0 8px; border:0; background:none; color:var(--muted)}
.cplay span{display:grid; place-items:center; width:26px; height:26px; border-radius:50%; border:1px solid var(--line); background:var(--panel)}
.cplay svg{width:12px; height:12px; fill:currentColor}
.cplay:hover span{border-color:var(--cinnamon); color:var(--cinnamon)}
.cplay.on span{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.card.open .cplay{background:var(--cinnamon-soft); border-bottom:1px solid #ecdcd2}
.cplay:hover + .ch{background:var(--surface)}
.card.open .cplay:hover + .ch{background:var(--cinnamon-soft)}
.card.open{border-color:#e2c3b0; box-shadow:0 2px 10px rgba(138,75,42,.07)}
.ch{display:grid; grid-template-columns:auto 1fr auto auto; align-items:center; column-gap:12px; row-gap:3px; width:100%; padding:10px 12px;
  border:0; background:none; text-align:left; cursor:pointer; font-variant-numeric:tabular-nums}
.ch:hover{background:var(--surface)}
.card.open .ch{background:var(--cinnamon-soft); border-bottom:1px solid #ecdcd2}
.ch .n{grid-row:1 / span 3; align-self:start; display:inline-grid; place-items:center; min-width:26px; height:26px; padding:0 6px; border-radius:6px;
  background:#7d8594; color:#fff; font-size:12.5px; font-weight:650}
.card.open .ch .n{background:var(--cinnamon)}
.ch .t{font-weight:600; color:var(--ink)}
.ch .t span{font-weight:400; color:var(--muted); margin-left:8px}
.ch .chev{width:16px; height:16px; color:var(--muted); transition:transform .15s}
.card.open .ch .chev{transform:rotate(180deg)}
.ch .sub{grid-column:2 / -1; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.ch .pv{grid-column:2 / -1; direction:rtl; text-align:right; color:var(--ink); font-size:15px; line-height:1.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-family:"Noto Naskh Arabic","Amiri","Scheherazade New","Noto Sans Arabic","Segoe UI",serif}
.ch .pv.none{direction:ltr; text-align:left; font-family:inherit; font-size:12.5px; color:var(--faint); font-style:italic}
.cb{padding:12px 14px 14px}
.pill{padding:2px 10px; border-radius:999px; font-size:12px; white-space:nowrap}
.pill.ok{background:#e7f3ed; color:var(--ok)}
.pill.need{background:#fff; color:var(--cinnamon); border:1px solid #ead7cb}
.empty{margin:0; color:var(--ink); line-height:1.5}
.empty .help2{display:block; margin-top:4px; color:var(--muted); font-size:12.5px}
.empty .help2:empty{display:none}
.btn{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); white-space:nowrap; font-size:13px}
.btn:hover:not(:disabled){border-color:#c9ced6}
.btn:disabled{opacity:.4; cursor:default}
.btn.primary{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.btn.danger{color:var(--err)}
.btn.danger:hover:not(:disabled){border-color:#e8b4ae}
.btn.marking{background:#fff; border-color:var(--cinnamon); color:var(--cinnamon)}
.btn.marking::before{content:""; width:8px; height:8px; border-radius:50%; background:var(--err); animation:pulse 1s ease-in-out infinite alternate}
@keyframes pulse{from{opacity:.35} to{opacity:1}}
.note{margin:0 0 10px; font-size:12.5px; color:var(--muted)}
.note.err{color:var(--err)}
.note:empty{display:none}
.restore{display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 12px; border-radius:8px; background:var(--cinnamon-soft); border:1px solid #e6cfc2}
.restore span{flex:1; min-width:200px}
.whole{display:flex; flex-direction:column; gap:4px; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel)}
.whole .links{display:flex; gap:8px; flex-wrap:wrap; padding:2px 0}
.whole .links a{display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border:1px solid var(--line); border-radius:6px; color:var(--ink); text-decoration:none; font-size:13px}
.whole .links a:hover{border-color:#c9ced6}
.whole .tg.lead{border-top:0; padding:0; flex-wrap:wrap; gap:10px}
.whole .tg.lead .links{margin-right:auto}
.skipnote{margin:0; padding:10px 12px; border-radius:8px; background:var(--surface); border:1px solid var(--line); color:var(--muted)}
.ro{margin:0; padding:8px 10px; border-radius:6px; background:var(--surface); color:var(--muted); border:1px solid var(--line)}
/* segment toolbar (above the waveform) */
.segbar{display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0}
.segbar .sep{width:1px; height:22px; background:var(--line); margin:0 4px}
.segbar .who{font-weight:650; color:var(--ink); white-space:nowrap}
.segbar .hint{color:var(--muted); font-size:12.5px}
.tgrp{display:inline-flex; align-items:center}
.tgrp .tf{border-radius:0; border-left:0; border-right:0}
.nudge{width:24px; height:28px; padding:0; border:1px solid var(--line); background:var(--surface); color:var(--ink); font-size:15px; line-height:1}
.nudge:first-child{border-radius:6px 0 0 6px}
.nudge:last-child{border-radius:0 6px 6px 0}
.nudge:hover:not(:disabled){background:var(--cinnamon-soft); color:var(--cinnamon)}
.nudge:disabled{opacity:.4; cursor:default}
.tf{width:96px; padding:4px 7px; font:inherit; font-size:13px; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:6px; font-variant-numeric:tabular-nums}
.tf:focus{outline:none; border-color:var(--cinnamon); box-shadow:0 0 0 3px var(--cinnamon-soft)}
.segbar .dash{color:var(--muted)}
.segbar .dur{color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap}
@media (prefers-reduced-motion:reduce){.btn.marking::before{animation:none} .ch .chev{transition:none}}
`;

  const I = {
    add: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
    undo: `<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>`,
    redo: `<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>`,
    play: `<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/></svg>`,
    split: `<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M5 8h4M5 16h4M15 8h4M15 16h4"/></svg>`,
    merge: `<svg viewBox="0 0 24 24"><path d="M4 12h16"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>`,
    del: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
    x: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    playSmall: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    pauseSmall: `<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`,
    spark: `<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>`,
  };

  const fmtMs = (t) => {
    const ms = Math.round(t * 1000);
    const m = Math.floor(ms / 60000);
    const s = (ms % 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  };
  const fmtDur = (d) => (d < 60 ? `${d.toFixed(d < 10 ? 2 : 1)} s` : U.fmtClock(d));
  const EMPTY = "No segments yet. Use Add segment while it plays, drag across the waveform, or Presegment.";

  // container: the side panel; bar: the segment toolbar element above the waveform.
  CL.createPanel = function createPanel(container, { bar, player, timeline, textFields, presegment, nudgeMs = () => 50, nudgeShiftMs = () => 250 }) {
    let store = null;
    let presegBusy = false;
    let form = null;
    let taskView = null;
    let segView = null;
    let ui = null;
    let focusNext = false; // focus the transcript after the next selection made from the panel
    let marking = null; // { start } while "Add segment" waits for "Mark end"
    const S = globalThis.CLSeg;
    const CFG = globalThis.CLConfig;

    container.innerHTML = `
      <div class="panel">
        <section class="whole" id="whole" hidden>
          <div class="links" id="links"></div>
          <div id="taskForm"></div>
        </section>
        <p class="skipnote" id="skipNote" hidden>This video is marked to skip as a whole, so segments are not part of the answer (Label Studio leaves them out). Turn the switch off to work on segments.</p>
        <div class="restore" id="restore" role="region" aria-label="Backup" hidden>
          <span id="rTxt"></span>
          <button class="btn primary" id="rDo">Restore</button>
          <button class="btn" id="rNo">Discard</button>
        </div>
        <div class="oldnote" id="oldNote" role="note" hidden>
          <span>The old SpeakerCut extension is still installed. Cinnamon Label now includes presegmentation, so you can remove SpeakerCut in <b>chrome://extensions</b>.</span>
          <button class="btn" id="oldX">Got it</button>
        </div>
        <div class="ph"><h2>Segments <span class="count" id="segCount"></span></h2><span class="sum" id="segSum"></span>
          <button class="btn" id="aPre" title="Suggest segments by speaker (nothing is added until you accept)">${I.spark}Presegment</button></div>
        <div class="sugbar" id="sugBar" role="status" hidden>
          <span id="sugTxt"></span>
          <button class="btn primary" id="sugAll">Add all</button>
          <button class="btn" id="sugClear">Dismiss</button>
        </div>
        <div class="cards" id="cards" role="list" aria-label="Segments"></div>
        <p class="empty" id="segEmpty"><span id="segEmptyMain">${EMPTY}</span><span class="help2" id="segEmptyHelp"></span></p>
        <div hidden id="holder"><div class="cb" id="detail"><p class="note" id="dNote"></p><div id="form"></div></div></div>
        <p class="ro" id="readOnly" hidden>This annotation is read-only. You can play and review it, but not edit it.</p>
      </div>`;
    bar.innerHTML = `
      <button class="btn primary" id="aAdd" title="Start a segment at the playhead; press again to end it">${I.add}<span>Add segment</span></button>
      <button class="icon" id="aCancel" title="Cancel (Esc)" aria-label="Cancel adding a segment" hidden>${I.x}</button>
      <span class="sep" aria-hidden="true"></span>
      <span class="hint" id="bHint">Select a segment to edit it.</span>
      <span class="who" id="bWho" hidden></span>
      <span class="tgrp" id="gStart" hidden><button class="nudge" data-edge="start" data-dir="-1" title="Start 0.05 s earlier (Shift: 0.25 s)" aria-label="Start earlier">−</button><input class="tf" id="dStart" spellcheck="false" autocomplete="off" aria-label="Segment start" title="Start (e.g. 12.5 or 0:12.500), Enter to apply"><button class="nudge" data-edge="start" data-dir="1" title="Start 0.05 s later (Shift: 0.25 s)" aria-label="Start later">+</button></span>
      <span class="dash" id="bDash" hidden>–</span>
      <span class="tgrp" id="gEnd" hidden><button class="nudge" data-edge="end" data-dir="-1" title="End 0.05 s earlier (Shift: 0.25 s)" aria-label="End earlier">−</button><input class="tf" id="dEnd" spellcheck="false" autocomplete="off" aria-label="Segment end" title="End (e.g. 14 or 0:14.000), Enter to apply"><button class="nudge" data-edge="end" data-dir="1" title="End 0.05 s later (Shift: 0.25 s)" aria-label="End later">+</button></span>
      <span class="dur" id="dDur" hidden></span>
      <button class="btn" id="aPlay" title="Play this segment" hidden>${I.play}Play</button>
      <button class="btn" id="aSplit" title="Split this segment at the playhead" hidden>${I.split}Split</button>
      <button class="btn" id="aMerge" title="Join this segment with the next one" hidden>${I.merge}Merge</button>
      <button class="btn danger" id="aDel" title="Delete this segment (Undo brings it back)" hidden>${I.del}Delete</button>
      <span class="sep" aria-hidden="true"></span>
      <button class="icon" id="undo" title="Undo" aria-label="Undo">${I.undo}</button>
      <button class="icon" id="redo" title="Redo" aria-label="Redo">${I.redo}</button>`;
    const root = container.getRootNode();
    const $ = (id) => root.getElementById(id);
    const linksEl = $("links"); // moved around (see render), so kept by reference
    const D = () => timeline.duration;
    const base = () => store.segments.map((g) => ({ id: g.id, start: g.start, end: g.end }));
    const sel = () => (store && store.selected ? store.byId(store.selected) : null);
    const editable = () => !!(store && store.supported && !store.readOnly && !timeline.segmentsDisabled);
    const setNote = (t, err = false) => {
      $("dNote").textContent = t || "";
      $("dNote").className = "note" + (err ? " err" : "");
    };
    let flashTimer;
    let emptyText = EMPTY;
    const flash = (t, err = false) => {
      setNote(t, err);
      $("segEmptyMain").textContent = t;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => ($("segEmptyMain").textContent = emptyText), 5000);
      if (ui && ui.toast) ui.toast(t);
    };
    const refreshHistory = () =>
      CL.page("history")
        .then((h) => {
          $("undo").disabled = !h.canUndo || !editable();
          $("redo").disabled = !h.canRedo || !editable();
        })
        .catch(() => {});

    // ---- Add segment: mark start, then mark end ----
    function stopMarking() {
      marking = null;
      timeline.marking = null;
      timeline.invalidate();
      api.render();
    }
    CL.on($("aAdd"), "click", async () => {
      if (!editable()) return;
      const t = player.v.currentTime || 0;
      if (!marking) {
        const inside = S.segmentAt(base(), t);
        if (inside) {
          const n = store.segments.findIndex((g) => g.id === inside.id) + 1;
          return flash(`The playhead is inside segment ${n}. Move it to where the new speech starts.`, true);
        }
        marking = { start: t };
        timeline.marking = marking;
        timeline.invalidate();
        setNote("");
        return api.render();
      }
      const r = S.create(base(), marking.start, t, D());
      if (!r || t <= marking.start + S.MIN_DUR) return flash("Play on to where the speech ends, then press Mark end.", true);
      stopMarking();
      focusNext = true;
      await store.apply(r.plan, { select: "created" });
    });
    CL.on($("aCancel"), "click", stopMarking);

    // ---- cards: the play button plays (or pauses) just that segment, without opening it ----
    const playingId = () => {
      const r = player._range;
      if (!r || player.v.paused) return null;
      const g = store && store.segments.find((x) => Math.abs(x.start - r[0]) < 0.002 && Math.abs(x.end - r[1]) < 0.002);
      return g ? g.id : null;
    };
    const paintPlay = () => {
      const on = playingId();
      for (const [id, c] of cards) {
        const isOn = id === on;
        c.play.classList.toggle("on", isOn);
        c.play.firstChild.innerHTML = isOn ? I.pauseSmall : I.playSmall;
        c.play.title = isOn ? "Pause" : "Play this segment";
        c.play.setAttribute("aria-label", c.play.title);
      }
    };
    for (const ev of ["play", "pause", "ended", "seeking"]) CL.on(player.v, ev, () => setTimeout(paintPlay, 0));
    CL.on($("cards"), "click", (e) => {
      const pb = e.target.closest(".cplay");
      if (!pb) return;
      const id = pb.parentElement.dataset.id;
      const g = store && store.byId(id);
      if (!g) return;
      if (playingId() === id) player.v.pause();
      else player.playRange(g.start, g.end);
    });

    // ---- cards: click a header to open (or close) that segment ----
    CL.on($("cards"), "click", (e) => {
      const head = e.target.closest(".ch");
      if (!head) return;
      const id = head.parentElement.dataset.id;
      if (store.selected === id) {
        store.select(null); // close
        return;
      }
      focusNext = true; // put the cursor in the transcript once this segment's form is shown
      setNote("");
      store.select(id);
      const g = store.byId(id);
      if (g) {
        player.seekTo(g.start);
        timeline.revealSegment(g);
      }
    });

    // ---- nudge an edge by 0.05 s (Shift: 0.25 s); a touching neighbour moves with it ----
    CL.on(bar, "click", async (e) => {
      const b = e.target.closest(".nudge");
      if (!b || !editable()) return;
      const g = sel();
      if (!g) return;
      const step = ((e.shiftKey ? nudgeShiftMs() : nudgeMs()) * Number(b.dataset.dir)) / 1000;
      const plan = S.moveEdge(base(), g.id, b.dataset.edge, g[b.dataset.edge] + step, D());
      if (!plan || !plan.update.length) return flash("That edge can't move further that way.", true);
      await store.apply(plan, { select: g.id });
    });

    // ---- start / end fields ----
    for (const [id, which] of [["dStart", "start"], ["dEnd", "end"]]) {
      const input = $(id);
      const commit = async () => {
        const g = sel();
        if (!g) return;
        const v = U.parseDuration(input.value);
        if (v == null) {
          input.value = fmtMs(g[which]);
          return flash("Type a time like 12.5 or 0:12.500.", true);
        }
        const plan = S.setTimes(base(), g.id, which === "start" ? v : g.start, which === "end" ? v : g.end, D());
        if (!plan) {
          input.value = fmtMs(g[which]);
          return flash("That would make the segment empty or overlap another one.", true);
        }
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
    const play = () => {
      const g = sel();
      if (g) player.playRange(g.start, g.end);
    };
    CL.on($("aPlay"), "click", play);
    CL.on($("aSplit"), "click", async () => {
      const g = sel();
      if (!g) return;
      const t = player.v.currentTime || 0;
      if (t <= g.start || t >= g.end) return flash("Move the playhead inside this segment first.", true);
      const plan = S.split(base(), g.id, t);
      if (!plan) return flash("Too close to the segment's edge to split.", true);
      await store.apply(plan, { select: g.id }); // the new segment starts with no answers
      flash("Split. The new segment starts with no answers.");
    });
    CL.on($("aMerge"), "click", async () => {
      const g = sel();
      if (!g) return;
      const r = S.mergeNext(base(), g.id);
      if (!r) return flash("There is no next segment to merge with.", true);
      const next = store.byId(r.removedId);
      r.plan.fields = [];
      for (const name of textFields()) {
        const a = [].concat(g.fields[name] || []).join("").trim();
        const b = [].concat((next && next.fields[name]) || []).join("").trim();
        if (b) r.plan.fields.push({ id: g.id, name, value: a ? `${a} ${b}` : b });
      }
      await store.apply(r.plan, { select: g.id });
      flash("Merged. The transcripts were joined; this segment's answers were kept.");
    });
    CL.on($("aDel"), "click", async () => {
      const g = sel();
      if (!g) return;
      const n = store.segments.findIndex((x) => x.id === g.id) + 1;
      await store.apply(S.remove(base(), g.id));
      flash(`Segment ${n} deleted. Undo brings it back.`);
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

    // ---- presegmentation suggestions (shown only; added when the user accepts them) ----
    let sugMsg = null; // { text, kind: "busy" | "err" } while running or after a failure
    const setSugMsg = (text, kind, detail) => {
      sugMsg = text ? { text, kind, detail } : null;
      api.render();
    };
    CL.on($("aPre"), "click", async () => {
      if (!presegment || presegBusy || !editable()) return;
      presegBusy = true;
      setSugMsg("Starting presegmentation…", "busy");
      try {
        const r = await presegment((t) => setSugMsg(t, "busy"));
        setSugMsg(null);
        if (!r.segments.length) flash("Presegmentation found no clear single-speaker segments in this video.", true);
      } catch (e) {
        setSugMsg((e && e.message) || String(e), "err", e && e.detail);
      } finally {
        presegBusy = false;
        api.render();
      }
    });
    async function acceptSuggestion(s) {
      if (!editable()) return;
      const fit = S.fitInto(base(), s.start, s.end, D());
      store.dropSuggestions([s.key]);
      if (!fit) return flash("That suggestion lies inside existing segments; there is no free time left for it.", true);
      focusNext = true;
      await store.apply({ create: [fit], update: [], remove: [] }, { select: "created" });
    }
    timeline.onSuggestion = (s) => acceptSuggestion(s).catch(CL.warn);
    CL.on($("sugAll"), "click", async () => {
      if (!editable()) return;
      const r = S.addMany(base(), store.suggestions || [], D());
      store.setSuggestions([]);
      if (r.added) await store.apply(r.plan);
      flash(`Added ${r.added} segment${r.added === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} skipped (no free time)` : ""}. Check each one; Undo removes them all.`);
    });
    CL.on($("sugClear"), "click", () => {
      sugMsg = null;
      if (store) store.setSuggestions([]);
      api.render();
    });
    CL.on($("oldX"), "click", () => {
      chrome.storage.local.set({ clOldExtNoticeOff: true });
      $("oldNote").hidden = true;
    });

    // ---- backup offer ----
    let backup = null;
    const when = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    CL.on($("rDo"), "click", async () => {
      if (!backup) return;
      $("rDo").disabled = true;
      const r = await backup.restore();
      $("rDo").disabled = false;
      if (store) await store.refresh();
      flash(r.message, !r.ok);
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

    // ---- forms ----
    const values = (g) => ({ ...((store && store.taskFields) || {}), ...((g && g.fields) || {}) });
    const segmentsHidden = () => !!(form && store && !CFG.isVisible({ when: form.segmentLabelsWhen }, store.taskFields || {}));
    const missingFor = (g) => (form ? CFG.missing(form.segment, values(g)) : []);
    // Collapsed-card summary: the visible single-choice answers, and the transcript's first line.
    function summary(g) {
      if (!form) return { sub: "", pv: "" };
      const v = values(g);
      const parts = [];
      let pv = "";
      for (const it of form.segment) {
        if (!CFG.isVisible(it, v)) continue;
        const ans = [].concat(v[it.name] || []).filter(Boolean);
        if (it.kind === "choices" && ans.length && !(it.multiple && it.options.length === 1)) parts.push(ans.join(", "));
        if (it.kind === "choices" && it.multiple && it.options.length === 1 && ans.length) parts.unshift(it.options[0].label);
        if (it.kind === "textarea" && !pv && (it.rows >= 3 || it.dir === "rtl") && ans.length) pv = ans.join(" ");
      }
      return { sub: parts.join(" · "), pv };
    }
    function goNext() {
      const g = sel();
      if (!g) return;
      const nx = S.neighbour(store.segments, g.id, 1);
      if (!nx) return flash("This is the last segment.");
      store.flushTexts();
      focusNext = true;
      store.select(nx.id);
      player.seekTo(nx.start);
      timeline.revealSegment(nx);
    }

    // ---- cards: created once per segment id, updated in place (never rebuilt under the cursor) ----
    const cards = new Map(); // id -> { root, n, t, pill, sub, pv, body }
    function card(id) {
      let c = cards.get(id);
      if (c) return c;
      const rootEl = document.createElement("article");
      rootEl.className = "card";
      rootEl.dataset.id = id;
      rootEl.setAttribute("role", "listitem");
      rootEl.innerHTML = `<button class="cplay" title="Play this segment"><span>${I.playSmall}</span></button><button class="ch" aria-expanded="false"><span class="n"></span><span class="t"></span><span class="pill"></span><span class="chev">${I.chev}</span><span class="sub"></span><span class="pv"></span></button><div class="cbody"></div>`;
      const q = (s) => rootEl.querySelector(s);
      c = { root: rootEl, play: q(".cplay"), head: q(".ch"), n: q(".n"), t: q(".t"), pill: q(".pill"), sub: q(".sub"), pv: q(".pv"), body: q(".cbody") };
      cards.set(id, c);
      return c;
    }
    let lastOpen = null;

    // ---- render ----
    const api = {
      setUi(u) {
        ui = u;
      },
      // Esc outside text fields: cancel "Add segment". Returns true if something was cancelled.
      cancelMarking() {
        if (!marking) return false;
        stopMarking();
        return true;
      },
      setForm(f) {
        form = f;
        const links = linksEl;
        links.textContent = "";
        for (const l of (f && f.links) || []) {
          const a = document.createElement("a");
          a.href = l.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = l.text;
          links.appendChild(a);
        }
        links.hidden = !links.children.length;
        const taskFields = (f && f.task.filter((i) => i.kind === "choices" || i.kind === "textarea")) || [];
        $("whole").hidden = !links.children.length && !taskFields.length;
        taskView = f && f.task.length ? new CL.FormView($("taskForm"), { items: f.task, onChange: (name, v, o) => store && store.setField(null, name, v, o) }) : null;
        // The project's own instruction goes on its own line, below ours.
        $("segEmptyHelp").textContent = ((f && f.segmentHelp) || []).join(" ");
        segView = f
          ? new CL.FormView($("form"), {
              items: f.segment,
              onChange: (name, v, o) => store && store.selected && store.setField(store.selected, name, v, o),
              extras: { onReplay: play, onNext: goNext, onBlur: () => store && store.flushTexts() },
            })
          : null;
        api.render();
      },
      setStore(s) {
        store = s;
        marking = null;
        timeline.marking = null;
        setNote("");
        $("holder").appendChild($("detail"));
        for (const c of cards.values()) c.root.remove();
        cards.clear();
        lastOpen = null;
        api.render();
      },
      setBackup(b) {
        backup = b;
        api.showOffer(b ? b.offer : null);
      },
      // True while a presegmentation run is in progress (the dev auto-reload waits for it).
      get busy() {
        return presegBusy;
      },
      showOldExtNotice(on) {
        $("oldNote").hidden = !on;
      },
      showOffer(b) {
        $("restore").hidden = !b;
        if (b) {
          const n = b.segments;
          $("rTxt").textContent = `This browser has unsubmitted work for this task from ${when(b.savedAt)}: ${n} segment${n === 1 ? "" : "s"}. Restore it?`;
        }
      },
      render() {
        const has = !!store && store.supported;
        const segs = has ? store.segments : [];
        const canEdit = editable();
        $("segCount").textContent = segs.length ? `(${segs.length})` : "";
        $("readOnly").hidden = !(store && store.readOnly);
        $("segEmpty").hidden = segs.length > 0;
        const hiddenSegs = segmentsHidden();
        $("skipNote").hidden = !hiddenSegs;
        timeline.segmentsDisabled = hiddenSegs;
        const g = sel();

        // presegmentation
        const sugs = (store && store.suggestions) || [];
        const sb = $("sugBar");
        $("aPre").hidden = !presegment;
        $("aPre").disabled = presegBusy || !canEdit;
        if (sugMsg) {
          sb.hidden = false;
          sb.className = "sugbar " + sugMsg.kind;
          $("sugTxt").textContent = sugMsg.text;
          $("sugTxt").title = sugMsg.detail && sugMsg.detail !== sugMsg.text ? sugMsg.detail : "";
          $("sugAll").hidden = true;
          $("sugClear").hidden = sugMsg.kind !== "err";
        } else if (sugs.length) {
          sb.hidden = false;
          sb.className = "sugbar";
          const sp = new Set(sugs.map((s) => s.speaker)).size;
          $("sugTxt").textContent = `${sugs.length} suggested segment${sugs.length === 1 ? "" : "s"}, ${sp} speaker${sp === 1 ? "" : "s"}. Click one on the waveform to add it, or add them all.`;
          $("sugAll").hidden = false;
          $("sugClear").hidden = false;
        } else sb.hidden = true;

        // cards, in time order; open = the selected segment
        const list = $("cards");
        const miss = segs.map((x) => missingFor(x));
        $("segSum").textContent = form && segs.length ? `${miss.filter((m) => !m.length).length} of ${segs.length} complete` : "";
        const live = new Set();
        segs.forEach((x, i) => {
          const c = card(x.id);
          live.add(x.id);
          if (list.children[i] !== c.root) list.insertBefore(c.root, list.children[i] || null);
          c.n.textContent = String(i + 1);
          c.t.innerHTML = "";
          c.t.append(`${U.fmtClock(x.start)} – ${U.fmtClock(x.end)}`);
          const d = document.createElement("span");
          d.textContent = fmtDur(x.end - x.start);
          c.t.append(d);
          c.pill.hidden = !form;
          c.pill.className = "pill " + (miss[i].length ? "need" : "ok");
          c.pill.textContent = miss[i].length ? `${miss[i].length} still needed` : "✓ Complete";
          c.pill.title = miss[i].length ? "Still needed: " + miss[i].join(", ") : "Every required answer is given.";
          const sm = summary(x);
          c.sub.textContent = sm.sub;
          c.sub.hidden = !sm.sub;
          c.pv.textContent = sm.pv || "No transcript yet";
          c.pv.classList.toggle("none", !sm.pv);
          c.pv.hidden = !form;
          const open = !!g && g.id === x.id;
          c.root.classList.toggle("open", open);
          c.head.setAttribute("aria-expanded", String(open));
        });
        for (const [id, c] of cards) {
          if (live.has(id)) continue;
          if (c.body.contains($("detail"))) $("holder").appendChild($("detail"));
          c.root.remove();
          cards.delete(id);
        }

        // the open card holds the form
        if (g) {
          const c = cards.get(g.id);
          if (c && $("detail").parentElement !== c.body) c.body.appendChild($("detail"));
          if (segView) segView.render(g.id, values(g), { readOnly: !canEdit });
          if (c && lastOpen !== g.id) c.root.scrollIntoView({ block: "nearest" });
          if (focusNext) {
            focusNext = false;
            const tx = segView && segView.firstBigText();
            if (tx && canEdit) tx.focus({ preventScroll: true });
          }
        } else if ($("detail").parentElement !== $("holder")) $("holder").appendChild($("detail"));
        lastOpen = g ? g.id : null;

        // toolbar
        const i = g ? segs.findIndex((x) => x.id === g.id) : -1;
        $("aAdd").disabled = !canEdit;
        $("aAdd").classList.toggle("marking", !!marking);
        $("aAdd").classList.toggle("primary", !marking);
        $("aAdd").querySelector("span").textContent = marking ? "Mark end" : "Add segment";
        $("aAdd").title = marking ? `Started at ${U.fmtClock(marking.start)}. Press where the speech ends.` : "Start a segment at the playhead; press again to end it";
        $("aCancel").hidden = !marking;
        for (const id of ["bWho", "gStart", "bDash", "gEnd", "dDur", "aPlay", "aSplit", "aMerge", "aDel"]) $(id).hidden = !g || !!marking;
        $("bHint").hidden = !!g && !marking;
        $("bHint").textContent = marking ? "Let it play, then press Mark end where the speech stops." : canEdit ? "Select a segment to edit it." : "";
        if (g) {
          $("bWho").textContent = `Segment ${i + 1}`;
          if (root.activeElement !== $("dStart")) $("dStart").value = fmtMs(g.start);
          if (root.activeElement !== $("dEnd")) $("dEnd").value = fmtMs(g.end);
          $("dDur").textContent = fmtDur(g.end - g.start);
          for (const id of ["dStart", "dEnd"]) $(id).disabled = !canEdit;
          const ms = nudgeMs();
          const fmtStep = (v) => (v >= 1000 ? `${v / 1000} s` : `${v} ms`);
          bar.querySelectorAll(".nudge").forEach((n) => {
            n.disabled = !canEdit;
            const which = n.dataset.edge === "start" ? "Start" : "End";
            n.title = `${which} ${fmtStep(ms)} ${n.dataset.dir < 0 ? "earlier" : "later"}. Hold Shift: ${fmtStep(nudgeShiftMs())}.`;
          });
          for (const id of ["aSplit", "aDel"]) $(id).disabled = !canEdit;
          $("aMerge").disabled = !canEdit || i === segs.length - 1;
        }

        if (taskView) {
          taskView.render("task", values(null), { readOnly: !store || store.readOnly });
          // One tidy row: guide links on the left, the first whole-video switch on the right.
          // The form can rebuild (e.g. while switching tasks), so the links element is kept by
          // reference and re-attached; without a switch row it sits on its own at the top.
          const lead = $("taskForm").querySelector(".rows > .grp:first-child > .tg:first-child");
          if (lead) {
            lead.classList.add("lead");
            if (linksEl.parentElement !== lead) lead.prepend(linksEl);
          } else if (linksEl.parentElement !== $("whole")) $("whole").prepend(linksEl);
        }
        refreshHistory();
      },
    };
    return api;
  };
})();

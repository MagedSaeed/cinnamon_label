// The Cinnamon Label surface. It sits exactly over Label Studio's editor area (.lsf-main-view),
// so Label Studio's top bar, side panels and bottom bar (with Submit) stay visible and untouched.
// Label Studio's own DOM is never removed, so switching back to the native UI is instant.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  const ICON_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`;
  const ICON_PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>`;

  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
/* slim scrollbars: a rounded thumb floating in a clear track */
::-webkit-scrollbar{width:11px; height:11px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background-color:rgba(93,101,115,.32); border:3px solid transparent; background-clip:padding-box; border-radius:999px; min-height:40px}
::-webkit-scrollbar-thumb:hover{background-color:rgba(93,101,115,.6)}
::-webkit-scrollbar-thumb:active{background-color:#8a4b2a}
::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-button{display:none; width:0; height:0}
.app{
  --ink:#1d2129; --muted:#5d6573; --faint:#8c93a0; --line:#e3e6eb; --surface:#f5f6f8; --panel:#fff;
  --cinnamon:#8a4b2a; --cinnamon-soft:#f3e9e3; --ok:#2f7d5b; --warn:#9a6212; --err:#b42318;
  position:absolute; inset:0; display:grid; grid-template-rows:auto minmax(0,1fr) auto auto; background:var(--panel);
  color:var(--ink); font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;
  border-left:1px solid var(--line);
}
.bar{display:flex; align-items:center; gap:14px; padding:8px 14px; border-bottom:1px solid var(--line); min-height:44px}
.brand{display:flex; align-items:center; gap:8px; font-weight:600; letter-spacing:.01em}
.brand img{border-radius:5px; display:block}
.task{color:var(--muted); font-variant-numeric:tabular-nums}
.spacer{flex:1}
.net{display:flex; align-items:center; gap:10px; color:var(--muted); font-variant-numeric:tabular-nums; min-width:0}
.net .txt{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.net .meter{width:120px; height:4px; background:var(--line); border-radius:2px; overflow:hidden; flex:none}
.net .meter b{display:block; height:100%; width:0; background:var(--cinnamon); transition:width .25s linear}
.net.ok .txt{color:var(--ok)} .net.warn .txt{color:var(--warn)} .net.err .txt{color:var(--err)}
.net.ok .meter, .net.err .meter, .net.warn .meter{display:none}
.ahead{color:var(--faint); font-size:12.5px; white-space:nowrap; font-variant-numeric:tabular-nums}
button{font:inherit; color:inherit; cursor:pointer}
.ghost{background:none; border:1px solid var(--line); border-radius:6px; padding:4px 10px; color:var(--muted)}
.ghost:hover{border-color:#c9ced6; color:var(--ink)}
.link{background:none; border:none; padding:0; color:var(--cinnamon); text-decoration:underline; text-underline-offset:2px}
:focus-visible{outline:2px solid var(--cinnamon); outline-offset:2px}

.body{display:grid; grid-template-columns:minmax(0,1.35fr) minmax(320px,1fr); min-height:0}
.stage{position:relative; background:var(--surface); min-height:0; min-width:0; display:flex; align-items:center; justify-content:center; padding:12px; overflow:hidden}
/* Natural size: shrink to fit when larger than the stage, never enlarged. */
video{display:block; width:auto; height:auto; max-width:100%; max-height:100%; background:#000; box-shadow:0 0 0 1px var(--line)}
video:not([data-ready]){visibility:hidden}
.stage .msg{position:absolute; inset:auto 0 16px; text-align:center; color:var(--muted); font-size:13px; pointer-events:none}
/* its own slim line above the toolbar (the toolbar wraps, so a full-width first item sits on top) */
.streamnote{flex:1 0 100%; display:flex; align-items:center; gap:8px; margin:0; padding:5px 12px; border-radius:6px; background:#fff4d6;
  border:1px solid #f0d48a; color:#6b4e00; font-size:12.5px; font-weight:500}
.streamnote svg{width:14px; height:14px; flex:none; fill:none; stroke:#b7791f; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.side{border-left:1px solid var(--line); background:var(--surface); padding:18px; overflow:auto}
.side{display:flex; flex-direction:column; min-height:0; min-width:0; padding-bottom:0}
/* Space under the last card when scrolled to the end (a scrolling flex column drops its bottom padding). */
.side > *{flex-shrink:0} /* full height, so the side panel scrolls rather than squeezing it */
.side::after{content:""; flex:0 0 24px}
.stage{min-height:0}
.sync{display:inline-flex; align-items:center; gap:6px; white-space:nowrap; color:var(--muted); font-size:13px}
.sync i{width:8px; height:8px; border-radius:50%; background:#c4cad3}
.sync[data-state="synced"] i{background:var(--ok)}
.sync[data-state="pending"] i{background:var(--warn)}
.sync[data-state="error"]{color:var(--err)}
.sync[data-state="error"] i{background:var(--err)}
.sync:empty{display:none}
.toast{position:absolute; left:50%; top:54px; transform:translateX(-50%); z-index:2; max-width:70%; padding:7px 12px; border-radius:6px;
  background:var(--ink); color:#fff; font-size:13px; opacity:0; transition:opacity .15s; pointer-events:none}
.toast.show{opacity:1}

.transport{display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; padding:8px 14px; border-top:1px solid var(--line)}
.transport .zone{display:flex; align-items:center; gap:12px; flex:none}
.transport .segbar{flex:1}
.lanes .ov{margin-bottom:8px}
.play{width:36px; height:36px; border-radius:50%; border:none; background:var(--cinnamon); color:#fff; display:grid; place-items:center; flex:none}
.play svg{width:18px; height:18px; fill:currentColor}
.play:disabled{opacity:.4; cursor:default}
.pgroup{display:inline-flex; align-items:center; gap:6px; flex:none}
.nudge{width:24px; height:24px; border-radius:50%; border:none; background:rgba(138,75,42,.12); color:var(--cinnamon); display:grid; place-items:center; flex:none; cursor:pointer; transition:background .15s,color .15s}
.nudge svg{width:12px; height:12px; fill:currentColor}
.nudge:hover:not(:disabled){background:var(--cinnamon); color:#fff}
.nudge:active:not(:disabled){transform:scale(.92)}
.nudge:focus-visible{outline:2px solid var(--cinnamon); outline-offset:2px}
.nudge:disabled{opacity:.4; cursor:default}
.clock{font-variant-numeric:tabular-nums; color:var(--muted); white-space:nowrap}
.clock b{color:var(--ink); font-weight:600}
/* Timeline lanes (drawn by timeline.js) */
.lanes{padding:4px 14px 12px}
.lanes canvas{display:block; width:100%}
.lane{position:relative}
.lane[hidden]{display:none}
.single .dt{height:170px}
.ov{height:40px; cursor:pointer; border-radius:4px}
.dt{height:150px; border:1px solid var(--line); border-radius:6px}
.zoom{display:flex; align-items:center; gap:2px; color:var(--muted); font-variant-numeric:tabular-nums}
.zoom button{width:26px; height:26px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); font-size:15px; line-height:1}
.zoom button:hover{border-color:#c9ced6}
.zoom input{width:58px; padding:3px 2px; text-align:center; font:inherit; color:var(--ink); background:transparent;
  border:1px solid transparent; border-radius:6px; cursor:text; font-variant-numeric:tabular-nums}
.zoom input:hover{border-color:var(--line)}
.zoom input:focus{border-color:var(--cinnamon); background:var(--panel); outline:none}
.speed{display:flex; align-items:center; gap:6px; color:var(--muted)}
.speed select{font:inherit; border:1px solid var(--line); border-radius:6px; padding:3px 6px; background:var(--panel); color:var(--ink)}
.speed input{width:56px; font:inherit; border:1px solid var(--cinnamon); border-radius:6px; padding:3px 6px; background:var(--panel); color:var(--ink); outline:none; box-shadow:0 0 0 3px var(--cinnamon-soft)}
@media (prefers-reduced-motion:reduce){ .net .meter b{transition:none} }
`;

  const PILL_CSS = `
:host{all:initial}
.pill{position:fixed; z-index:31; display:flex; align-items:center; gap:10px; max-width:520px;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#1d2129; background:#fff;
  border:1px solid #e3e6eb; border-radius:8px; padding:6px 6px 6px 12px; box-shadow:0 1px 3px rgba(29,33,41,.12)}
.pill .msg{color:#b42318}
.pill .msg:empty{display:none}
button{font:inherit; cursor:pointer; border:none; border-radius:6px; padding:5px 10px; background:#8a4b2a; color:#fff; white-space:nowrap}
button:focus-visible{outline:2px solid #8a4b2a; outline-offset:2px}
/* Until Cinnamon Label has been tried once: a soft pulsing ring and a short invitation. */
.pill .new{display:none; color:#5b6270}
.pill.invite .new{display:inline}
.pill.invite{border-color:#d9b8a5}
/* While the button is out: grow, glow and settle three times, rest 5 s, repeat. */
.attn #back{animation:cl-attn 1.3s ease-in-out 3}
@keyframes cl-attn{
  0%{transform:scale(1); box-shadow:0 0 0 0 rgba(138,75,42,.6); background:#8a4b2a}
  30%{transform:scale(1.12); box-shadow:0 0 0 8px rgba(138,75,42,.25); background:#b5652f}
  60%{transform:scale(1); box-shadow:0 0 0 14px rgba(138,75,42,0); background:#8a4b2a}
  100%{transform:scale(1); box-shadow:0 0 0 0 rgba(138,75,42,0); background:#8a4b2a}
}
@media (prefers-reduced-motion:reduce){ .attn #back{animation:none} }
.pill .hide{background:none; color:#5b6270; padding:4px 6px; animation:none}
.pill .hide:hover{background:#f1f3f6; color:#1d2129}
/* Put away: just the logo, small, in the window's bottom-right corner. */
.dot{position:fixed; z-index:31; right:16px; bottom:16px; width:36px; height:36px; padding:0; border-radius:50%;
  background:#fff; border:1px solid #e3e6eb; box-shadow:0 1px 4px rgba(29,33,41,.18); display:flex; align-items:center; justify-content:center}
.dot:hover{border-color:#8a4b2a}
.dot img{width:20px; height:20px}
[hidden]{display:none !important}
`;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  CL.createOverlay = function createOverlay() {
    // ---- main surface ----
    const host = document.createElement("div");
    host.id = "cinnamon-label-root";
    host.style.cssText = "position:fixed;z-index:30;display:none;left:0;top:0;width:0;height:0";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}${CL.PANEL_CSS || ""}${CL.FORM_CSS || ""}</style>`;
    const app = el(`
      <div class="app">
        <header class="bar">
          <div class="brand"><img alt="" width="20" height="20" src="${chrome.runtime.getURL("icons/icon32.png")}">Cinnamon Label</div>
          <div class="task" id="task"></div>
          <div class="spacer"></div>
          <span class="sync" id="sync" aria-live="polite"></span>
          <div class="net" id="net"><span class="txt" id="netTxt"></span><span class="meter"><b id="netBar"></b></span></div>
          <span class="ahead" id="ahead" hidden></span>
          <button class="ghost" id="native" title="Show Label Studio's own editor. Your work is kept.">Switch to native UI</button>
        </header>
        <div class="body">
          <section class="stage"><video id="video" playsinline></video><div class="msg" id="stageMsg"></div></section>
          <aside class="side" id="side"></aside>
        </div>
        <footer class="transport">
          <p class="streamnote" id="streamNote" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>The video is still downloading, so playback may pause to buffer. It plays smoothly once the download finishes.</p>
          <span class="pgroup">
          <button class="nudge" id="skBack" aria-label="Back 2 seconds" title="Back 2 seconds" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 3.2v9.6L1.5 8zM14.5 3.2v9.6L8.5 8z"/></svg></button>
          <button class="play" id="play" aria-label="Play" disabled>${ICON_PLAY}</button>
          <button class="nudge" id="skFwd" aria-label="Forward 2 seconds" title="Forward 2 seconds" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.2v9.6L7.5 8zM8.5 3.2v9.6L14.5 8z"/></svg></button>
          </span>
          <span class="clock"><b id="cur">0:00.0</b> / <span id="dur">–</span></span>
          <div class="segbar" id="segbar" role="toolbar" aria-label="Segment tools"></div>
          <div class="zone">
          <div class="zoom" id="zoomBox" title="Close-up width. Ctrl + mouse wheel on the lane also zooms; the wheel scrolls.">
            <button id="zoomOut" aria-label="Show more time">−</button><input id="zoomTxt" value="15 s" spellcheck="false" autocomplete="off" inputmode="decimal" aria-label="Seconds shown in the detail lane" title="Type a width, e.g. 8 or 1:30, then press Enter"><button id="zoomIn" aria-label="Show less time">+</button>
          </div>
          <label class="speed">Speed
            <select id="rate" aria-label="Playback speed">
              <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option>
              <option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option>
              <option value="custom">Custom…</option>
            </select>
            <input id="rateTxt" hidden spellcheck="false" autocomplete="off" inputmode="decimal" aria-label="Custom playback speed" title="Type a speed from 0.25 to 4, e.g. 1.3, then press Enter">
          </label>
          </div>
        </footer>
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
        <section class="lanes">
          <div class="lane" id="ovLane"><canvas class="ov" id="ov" aria-label="Whole video. Click to jump."></canvas></div>
          <div class="lane"><canvas class="dt" id="dt" aria-label="Waveform. Click to jump, drag to make a segment."></canvas></div>
        </section>
      </div>`);
    root.appendChild(app);
    const $ = (id) => root.getElementById(id);

    // ---- "back to Cinnamon Label" pill shown in native mode ----
    const pillHost = document.createElement("div");
    pillHost.id = "cinnamon-label-pill";
    pillHost.style.display = "none";
    const proot = pillHost.attachShadow({ mode: "open" });
    proot.innerHTML = `<style>${PILL_CSS}</style><div class="pill"><span class="msg" id="msg"></span><span class="new">Try a smoother editor for this task</span><button id="back">Use Cinnamon Label</button><button class="hide" id="hide" title="Put away. The Cinnamon Label logo stays in the corner." aria-label="Put away">✕</button></div>
      <button class="dot" id="dot" hidden title="Use Cinnamon Label" aria-label="Show the Use Cinnamon Label button"><img alt="" src="${chrome.runtime.getURL("icons/icon32.png")}"></button>`;
    const pill = proot.querySelector(".pill");
    const dot = proot.getElementById("dot");
    const PUT_AWAY = "cinnamonLabel.pillAway";
    const isAway = () => {
      try {
        return localStorage.getItem(PUT_AWAY) === "1";
      } catch (_) {
        return false;
      }
    };
    let pillMessage = "";
    const paintPill = () => {
      const away = isAway() && !pillMessage; // an error message is always shown in full
      pill.hidden = away;
      dot.hidden = !away;
    };
    const setAway = (on) => {
      try {
        localStorage.setItem(PUT_AWAY, on ? "1" : "0");
      } catch (_) {}
      paintPill();
    };
    // Draw the eye once each time the button appears (page opened, or switched to native).
    let pillVisibleBefore = false;
    // Repeats every 5 s while the button is out; putting it away (the corner logo) stops it.
    let attnTimer = 0;
    const attention = () => {
      clearTimeout(attnTimer);
      if (!pillVisible || isAway() || pillMessage) return;
      pill.classList.remove("attn");
      void pill.offsetWidth; // restart the animation
      pill.classList.add("attn");
    };
    proot.addEventListener("animationend", (e) => {
      if (!e.target.closest(".attn")) return;
      pill.classList.remove("attn");
      attnTimer = setTimeout(attention, 5000);
    });
    proot.getElementById("hide").addEventListener("click", () => setAway(true));
    dot.addEventListener("click", () => {
      setAway(false);
      attention();
    });

    document.documentElement.append(host, pillHost);

    // ---- positioning over .lsf-main-view ----
    let anchor = null;
    let visible = false;
    let pillVisible = false;
    const place = () => {
      if (!anchor || !anchor.isConnected) return;
      const r = anchor.getBoundingClientRect();
      // Label Studio's editor area grows with its own (hidden) content; stop at its bottom bar
      // (where Submit is) or the window edge, so our editor always fits on screen.
      const bar = document.querySelector(".lsf-bottombar");
      const barTop = bar ? bar.getBoundingClientRect().top : Infinity;
      const bottom = Math.min(window.innerHeight, barTop > r.top ? barTop : Infinity, r.bottom);
      const height = Math.max(240, bottom - Math.max(0, r.top));
      if (visible) Object.assign(host.style, { left: r.left + "px", top: Math.max(0, r.top) + "px", width: r.width + "px", height: height + "px" });
      if (pillVisible) Object.assign(pill.style, { left: r.left + 16 + "px", top: r.bottom - 52 + "px" });
    };
    const ro = new ResizeObserver(() => place());
    window.addEventListener("resize", place);
    const placeTimer = setInterval(place, 500); // Label Studio panels can resize without a window resize

    const api = {
      host,
      video: $("video"),
      side: $("side"),
      segbar: $("segbar"),
      // store: SegmentStore or null
      setSync(store) {
        // Quiet when everything is fine; speaks up only for a failed write or a read-only annotation.
        const elx = $("sync");
        const st = !store || !store.supported ? "" : store.readOnly ? "readonly" : store.status === "error" ? "error" : "";
        elx.dataset.state = st;
        elx.textContent = "";
        if (!st) return;
        elx.innerHTML = "<i></i>";
        elx.append(st === "readonly" ? "Read-only" : "Last edit not in Label Studio");
        elx.title =
          st === "error"
            ? `The last edit did not reach Label Studio (${store.error}). The view now shows what Label Studio has; redo the edit if it's missing.`
            : "This annotation can be viewed but not edited.";
      },
      get visible() {
        return visible;
      },
      setAnchor(a) {
        if (a === anchor) return place();
        if (anchor) ro.unobserve(anchor);
        anchor = a;
        if (a) ro.observe(a);
        place();
      },
      show(on) {
        visible = !!on;
        host.style.display = on ? "block" : "none";
        place();
      },
      showPill(on, message = "") {
        pillVisible = !!on;
        proot.getElementById("msg").textContent = message;
        pillMessage = message;
        pill.classList.toggle("invite", !message && !CL.hasChosenMode());
        if (on && !pillVisibleBefore) attention();
        pillVisibleBefore = !!on;
        paintPill();
        pillHost.style.display = on ? "block" : "none";
        place();
      },
      onNative(fn) {
        CL.on($("native"), "click", fn);
      },
      onBack(fn) {
        CL.on(proot.getElementById("back"), "click", fn);
      },
      setTask(id) {
        $("task").textContent = id != null ? `Task ${id}` : "";
      },
      toast(text) {
        const t = $("toast");
        t.textContent = text;
        t.classList.add("show");
        clearTimeout(api._toastTimer);
        api._toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
      },
      // Background / look-ahead downloads: { taskId, loaded, total, current } or null.
      // Other tasks' background downloads are shown on their buttons in the task list, not here:
      // the header is only about the open task.
      setAhead() {
        $("ahead").hidden = true;
      },
      // While the player streams from the server (before the download completes).
      setStreaming(on) {
        $("streamNote").hidden = !on;
        if (api.timeline) api.timeline.showBuffered = !!on;
      },
      setStageMessage(t) {
        $("stageMsg").textContent = t || "";
      },
      // s: { kind, loaded, total, rate, eta, message, reason }
      setNet(s) {
        const net = $("net");
        const txt = $("netTxt");
        net.className = "net";
        let text = "";
        let pct = 0;
        switch (s.kind) {
          case "checking":
            text = "Checking for a saved copy…";
            break;
          case "downloading": {
            const parts = [];
            parts.push(s.total ? `Downloading ${U.fmtBytes(s.loaded)} of ${U.fmtBytes(s.total)}` : `Downloading ${U.fmtBytes(s.loaded)}`);
            if (s.rate > 0) parts.push(s.rate >= 1e5 ? `${(s.rate / 1e6).toFixed(1)} MB/s` : `${Math.max(1, Math.round(s.rate / 1e3))} KB/s`);
            else if (s.waiting) parts.push("waiting for a free connection");
            const eta = U.fmtEta(s.eta);
            if (eta) parts.push(eta);
            text = parts.join(", ");
            pct = s.total ? (100 * s.loaded) / s.total : 0;
            break;
          }
          case "saving":
            text = `Downloaded ${U.fmtBytes(s.total)}. Saving a copy…`;
            pct = 100;
            break;
          case "saved":
            net.classList.add("ok");
            text = `Saved offline, ${U.fmtBytes(s.total)}`;
            break;
          case "cached":
            net.classList.add("ok");
            text = `Loaded from saved copy, ${U.fmtBytes(s.total)}`;
            break;
          case "memory":
            net.classList.add("warn");
            text = `Downloaded ${U.fmtBytes(s.total)}; not saved offline (${s.reason})`;
            break;
          case "error":
            net.classList.add("err");
            text = `Download stopped: ${s.message} Streaming from the server instead.`;
            break;
        }
        txt.textContent = text;
        txt.title = text;
        $("netBar").style.width = pct.toFixed(1) + "%";
        const old = net.querySelector(".link");
        if (old) old.remove();
        if (s.kind === "error" && s.retry) {
          const b = el(`<button class="link">Try again</button>`);
          CL.on(b, "click", s.retry);
          net.appendChild(b);
        }
      },
      bindPlayer(player) {
        const v = player.v;
        const play = $("play");
        const paint = () => {
          play.innerHTML = v.paused || v.ended ? ICON_PLAY : ICON_PAUSE;
          play.setAttribute("aria-label", v.paused || v.ended ? "Play" : "Pause");
        };
        const tick = () => {
          $("cur").textContent = U.fmtClock(v.currentTime || 0);
        };
        const loop = () => {
          tick();
          if (!v.paused) requestAnimationFrame(loop);
        };
        CL.on(v, "play", () => (paint(), requestAnimationFrame(loop)));
        CL.on(v, "pause", paint);
        CL.on(v, "ended", paint);
        CL.on(v, "timeupdate", tick);
        CL.on(v, "seeked", tick);
        CL.on(v, "durationchange", () => ($("dur").textContent = U.fmtClock(v.duration)));
        const nudges = [$("skBack"), $("skFwd")];
        CL.on($("skBack"), "click", () => player.seekBy(-2));
        CL.on($("skFwd"), "click", () => player.seekBy(2));
        CL.on(v, "loadedmetadata", () => ((play.disabled = false), nudges.forEach((b) => (b.disabled = false)), v.setAttribute("data-ready", "")));
        CL.on(v, "emptied", () => ((play.disabled = true), nudges.forEach((b) => (b.disabled = true)), v.removeAttribute("data-ready"), paint(), tick()));
        CL.on(v, "waiting", () => api.setStageMessage("Buffering…"));
        CL.on(v, "playing", () => api.setStageMessage(""));
        CL.on(v, "canplay", () => api.setStageMessage(""));
        CL.on(v, "click", () => player.toggle());
        CL.on(play, "click", () => player.toggle());
        // Speed: a preset, or "Custom…" to type any speed from 0.25× to 4× (Chrome mutes beyond).
        const rateSel = $("rate");
        const rateTxt = $("rateTxt");
        let rateNow = 1;
        const showRate = (r) => {
          const v = String(r);
          let opt = [...rateSel.options].find((o) => o.value === v);
          if (!opt) {
            rateSel.querySelectorAll("option[data-custom]").forEach((o) => o.remove());
            opt = new Option(`${v}×`, v);
            opt.dataset.custom = "1";
            rateSel.insertBefore(opt, rateSel.querySelector('option[value="custom"]'));
          }
          rateSel.value = v;
        };
        const applyRate = (r) => {
          rateNow = Math.round(Math.min(4, Math.max(0.25, r)) * 100) / 100;
          player.setRate(rateNow);
          showRate(rateNow);
        };
        const closeCustom = (apply) => {
          if (rateTxt.hidden) return;
          const r = parseFloat(String(rateTxt.value).replace(",", ".").replace(/[×x]/gi, ""));
          rateTxt.hidden = true;
          rateSel.hidden = false;
          if (apply && r > 0) applyRate(r);
          else showRate(rateNow);
        };
        CL.on(rateSel, "change", () => {
          if (rateSel.value !== "custom") return applyRate(Number(rateSel.value));
          rateSel.hidden = true;
          rateTxt.hidden = false;
          rateTxt.value = String(rateNow);
          rateTxt.focus();
          rateTxt.select();
        });
        CL.onFieldKey(rateTxt, (e) => {
          if (e.type !== "keydown") return;
          if (e.key === "Enter") closeCustom(true);
          else if (e.key === "Escape") closeCustom(false);
        });
        CL.on(rateTxt, "blur", () => closeCustom(true));
        paint();

        // Timeline lanes; the zoom label follows the detail lane's width.
        const timeline = new CL.Timeline({
          overview: $("ov"),
          detail: $("dt"),
          player,
          onView: (tl) => {
            const box = $("zoomTxt");
            if (root.activeElement === box) return; // don't overwrite while the user is typing
            const label = spanLabel(tl.span);
            if (box.value !== label) box.value = label;
          },
        });
        // The width is editable: click, type 8 / 8.5 / 1:30, Enter applies, Esc cancels.
        const box = $("zoomTxt");
        const spanLabel = (span) => (span >= 60 ? U.fmtClock(span).replace(/\.\d$/, "") : `${span < 10 ? span.toFixed(1) : Math.round(span)} s`);
        const commit = () => {
          const v = U.parseDuration(box.value);
          if (v != null && v > 0) timeline.setSpan(v);
          box.value = spanLabel(timeline.span); // shows the clamped value, or restores on bad input
        };
        CL.on(box, "focus", () => {
          box.value = String(Math.round(timeline.span * 10) / 10);
          box.select();
        });
        CL.onFieldKey(box, (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            box.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            box.value = spanLabel(timeline.span);
            box.blur();
          }
        });
        CL.on(box, "blur", () => (box.value = spanLabel(timeline.span)));
        CL.on(box, "change", commit);
        CL.on($("zoomIn"), "click", () => timeline.zoomBy(1 / 1.5));
        CL.on($("zoomOut"), "click", () => timeline.zoomBy(1.5));
        api.timeline = timeline;
        // One waveform of the whole video (default), or the whole-video strip plus a close-up lane.
        api.setCloseUp = (on) => {
          $("ovLane").hidden = !on;
          $("zoomBox").hidden = !on;
          root.querySelector(".lanes").classList.toggle("single", !on);
          timeline.setSingle(!on);
        };
        api.setCloseUp(false);
        return timeline;
      },
      destroy() {
        if (api.timeline) api.timeline.destroy();
        clearInterval(placeTimer);
        ro.disconnect();
        window.removeEventListener("resize", place);
        host.remove();
        pillHost.remove();
      },
    };
    return api;
  };
})();

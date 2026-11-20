// A small download button on each row of Label Studio's task list. It shows whether that task's
// video is saved in this browser, and lets the user download it (or download it again) without
// opening the task. Only videos are downloaded; annotations are never read or changed here.
//   not saved  -> arrow: click to download
//   downloading -> percent: click to stop (not for the open task's own download)
//   saved      -> check: click to download again (replaces the saved copy)
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  const CSS = `
.cl-dl{all:unset; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:3px;
  min-width:22px; height:20px; margin-left:6px; padding:0 4px; border-radius:5px; vertical-align:middle; cursor:pointer;
  font:600 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#8b93a1}
.cl-dl:hover{background:rgba(138,75,42,.1); color:#8a4b2a}
.cl-dl:focus-visible{outline:2px solid #8a4b2a; outline-offset:1px}
.cl-dl svg{width:13px; height:13px; display:block}
.cl-dl[data-s="saved"]{color:#2f7d4f}
.cl-dl[data-s="downloading"]{color:#8a4b2a; font-variant-numeric:tabular-nums}
.cl-dl .ring circle{transition:stroke-dashoffset .4s}
.cl-dl .stop{display:none}
.cl-dl[data-s="downloading"]:hover .ring{display:none}
.cl-dl[data-s="downloading"]:hover .stop{display:block}
.cl-dl[data-s="open"]{cursor:default}
.cl-dl[data-s="open"]:hover{background:none}
`;
  const ICON = {
    get: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
    saved: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>',
  };

  // Errors here only affect the list buttons: log them, never switch the editor off.
  const safe = (fn) => (...a) => {
    try {
      return fn(...a);
    } catch (e) {
      CL.warn("Task list buttons:", e);
    }
  };
  // Downloading: a ring that fills with the progress (and, on hover, a stop square).
  const ring = (frac) => {
    const c = 2 * Math.PI * 6;
    const off = frac == null ? c * 0.75 : c * (1 - Math.max(0, Math.min(1, frac)));
    return `<svg class="ring" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 8 8)"/></svg>`;
  };
  const STOP = '<svg class="stop" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
  const apiBase = () => location.pathname.split("/projects/")[0];
  let savedTasks = new Set(); // task ids with a saved video (from the saved-videos index)
  let timer = 0;
  let styleEl = null;
  const urls = new Map(); // task id -> video URL (asked once per task)

  async function loadSaved() {
    const o = await new Promise((r) => chrome.storage.local.get({ clCacheIndex: {} }, r));
    savedTasks = new Set(Object.values(o.clCacheIndex || {}).map((e) => e && e.taskId).filter((x) => x != null).map(Number));
  }
  const onStorage = (changes, area) => {
    if (area === "local" && changes.clCacheIndex) loadSaved().then(() => paint()).catch(CL.warn);
  };

  async function videoUrl(taskId) {
    if (urls.has(taskId)) return urls.get(taskId);
    const r = await fetch(`${apiBase()}/api/tasks/${taskId}`, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const raw = j.data && (j.data.video || j.data.audio);
    if (!raw) throw new Error("this task has no video");
    const url = new URL(raw, location.href).href;
    urls.set(taskId, url);
    return url;
  }

  // Each row of the list, with its task id (tagged by the page bridge from Label Studio's own data).
  // The button goes in the ID column when it is shown, else in the cell after the checkbox.
  function rows() {
    const heads = [...document.querySelectorAll(".lsf-table-head .lsf-table__cell")];
    const col = heads.findIndex((c) => c.textContent.trim() === "ID");
    const out = [];
    for (const row of document.querySelectorAll(".lsf-table-row")) {
      const id = Number(row.dataset.clTask);
      if (!id) continue;
      const cells = [...row.children];
      const cell = (col >= 0 && cells[col]) || cells.find((c) => !c.classList.contains("lsf-select-row")) || null;
      if (cell) out.push({ cell, id });
    }
    return out;
  }

  function state(id) {
    const open = CL.openDownload && CL.openDownload();
    if (open && Number(open.taskId) === id) return { s: "open", p: open };
    const p = CL.prefetch.statusOf(id);
    if (p) return { s: "downloading", p };
    return { s: savedTasks.has(id) ? "saved" : "get" };
  }

  async function paint() {
    await CL.page("tagRows").catch(() => 0);
    if (!timer) return; // stopped meanwhile
    for (const { cell, id } of rows()) {
      let b = cell.querySelector(".cl-dl");
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "cl-dl";
        // Keep the click on our button: Label Studio opens the task on a row click.
        for (const ev of ["pointerdown", "mousedown", "mouseup", "dblclick"]) b.addEventListener(ev, (e) => e.stopPropagation());
        b.addEventListener("click", safe((e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick(Number(b.dataset.id)).catch((err) => CL.warn(`Download of task ${b.dataset.id}:`, err));
        }));
        const host = cell.querySelector(".lsf-table__cell-content") || cell;
        host.append(b);
      }
      const { s, p } = state(id);
      const pct = p && p.total ? Math.floor((100 * p.loaded) / p.total) + "%" : "…";
      const sig = `${id}|${s}|${pct}`;
      if (b.dataset.sig === sig) continue;
      b.dataset.sig = sig;
      b.dataset.id = id;
      b.dataset.s = s;
      if (s === "get") {
        b.innerHTML = ICON.get;
        b.title = "Download this task's video now, so it opens instantly";
      } else if (s === "saved") {
        b.innerHTML = ICON.saved;
        b.title = "Video saved in this browser. Click to download it again.";
      } else {
        const frac = p && p.total ? p.loaded / p.total : null;
        b.innerHTML = ring(frac) + (s === "downloading" ? STOP : "") + `<span>${pct}</span>`;
        b.title = s === "open" ? "Downloading for the open task" : "Downloading in the background. Click to stop.";
      }
      b.setAttribute("aria-label", b.title);
    }
  }

  async function onClick(id) {
    const { s } = state(id);
    if (s === "open") return;
    if (s === "downloading") return CL.prefetch.stop(id);
    const url = await videoUrl(id);
    const settings = await CL.settings();
    CL.prefetch.manual(id, url, settings);
    paint().catch(() => {});
  }

  CL.taskList = {
    start() {
      if (timer) return;
      styleEl = document.createElement("style");
      styleEl.textContent = CSS;
      document.head.append(styleEl);
      chrome.storage.onChanged.addListener(onStorage);
      loadSaved().catch(CL.warn);
      timer = setInterval(() => paint().catch((e) => CL.warn("Task list buttons:", e)), 700); // Label Studio re-renders its rows freely
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      chrome.storage.onChanged.removeListener(onStorage);
      if (styleEl) styleEl.remove();
      document.querySelectorAll(".cl-dl").forEach((b) => b.remove());
    },
  };
})();

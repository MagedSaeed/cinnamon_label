// Settings and the saved-videos manager.
// Saved videos live in the Label Studio site's storage, which the popup can't reach, so deletions
// are queued in chrome.storage.local ("clCacheDeletes") and applied by a Label Studio tab.
const U = globalThis.CLU;
const DEFAULTS = {
  enabled: true,
  connections: 3,
  cacheLimitGB: 2,
  noDrafts: true,
  devReload: false,
  prefetchNext: 1,
  closeUp: false,
  moveSegments: false,
  nudgeMs: 50,
  nudgeShiftMs: 250,
  splitGapMs: 100,
  psEnabled: true,
  psServer: "http://127.0.0.1:8000",
  psProvider: "local",
  psRemoveMusic: false,
  psMaxDur: 30,
  psPad: 0.2,
  psMinSeg: 1.0,
  psNum: 0,
  psMin: 0,
  psMax: 0,
  psDropOverlap: true,
  psTimeoutMin: 3,
};
// Numbers where 0 means "auto" / "no limit": shown as an empty field with a placeholder.
const ZERO_IS_EMPTY = ["psMaxDur", "psNum", "psMin", "psMax"];
const PS_NUMBERS = ["psMaxDur", "psPad", "psMinSeg", "psNum", "psMin", "psMax", "psTimeoutMin"];
const el = (id) => document.getElementById(id);

// ---------- tabs ----------
const TABS = ["general", "saved", "preseg"];
function selectTab(name) {
  if (!TABS.includes(name)) name = "general";
  for (const t of TABS) {
    el("tab-" + t).setAttribute("aria-selected", String(t === name));
    el("p-" + t).hidden = t !== name;
  }
  el("deleteAll").hidden = name !== "saved";
  el("reset").hidden = name === "saved";
  localStorage.setItem("clPopupTab", name);
}
TABS.forEach((t) => el("tab-" + t).addEventListener("click", () => selectTab(t)));
el("p-general").parentElement.parentElement.addEventListener("keydown", (e) => {
  if (e.target.getAttribute("role") !== "tab" || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const i = TABS.indexOf(e.target.id.slice(4)) + (e.key === "ArrowRight" ? 1 : -1);
  const next = TABS[(i + TABS.length) % TABS.length];
  selectTab(next);
  el("tab-" + next).focus();
});
selectTab(localStorage.getItem("clPopupTab") || "general");

// ---------- settings (autosave) ----------
function write(s) {
  el("enabled").checked = !!s.enabled;
  el("devReload").checked = !!s.devReload;
  el("noDrafts").checked = !!s.noDrafts;
  el("closeUp").checked = !!s.closeUp;
  el("moveSegments").checked = !!s.moveSegments;
  (document.querySelector(`input[name=prefetchNext][value="${s.prefetchNext}"]`) || document.querySelector('input[name=prefetchNext][value="1"]')).checked = true;
  const r = document.querySelector(`input[name=connections][value="${s.connections}"]`) || document.querySelector('input[name=connections][value="3"]');
  r.checked = true;
  el("cacheLimitGB").value = String(s.cacheLimitGB);
  if (document.activeElement !== el("nudgeMs")) el("nudgeMs").value = String(s.nudgeMs);
  if (document.activeElement !== el("nudgeShiftMs")) el("nudgeShiftMs").value = String(s.nudgeShiftMs);
  if (document.activeElement !== el("splitGapMs")) el("splitGapMs").value = String(s.splitGapMs);
  el("status").dataset.state = s.enabled ? "ok" : "off";
  el("statusText").textContent = s.enabled ? "Active" : "Off";
  // presegmentation
  if (document.activeElement !== el("psServer")) el("psServer").value = s.psServer;
  (document.querySelector(`input[name=psProvider][value="${s.psProvider}"]`) || document.querySelector('input[name=psProvider][value="local"]')).checked = true;
  el("psRemoveMusic").checked = !!s.psRemoveMusic;
  el("psEnabled").checked = s.psEnabled !== false;
  el("psSettings").classList.toggle("off", s.psEnabled === false);
  el("psDropOverlap").checked = !!s.psDropOverlap;
  for (const k of PS_NUMBERS) if (document.activeElement !== el(k)) el(k).value = ZERO_IS_EMPTY.includes(k) && Number(s[k]) === 0 ? "" : String(s[k]);
}
function read() {
  return {
    enabled: el("enabled").checked,
    devReload: el("devReload").checked,
    noDrafts: el("noDrafts").checked,
    closeUp: el("closeUp").checked,
    moveSegments: el("moveSegments").checked,
    prefetchNext: Number(document.querySelector("input[name=prefetchNext]:checked")?.value ?? DEFAULTS.prefetchNext),
    connections: Number(document.querySelector("input[name=connections]:checked")?.value) || DEFAULTS.connections,
    cacheLimitGB: Number(el("cacheLimitGB").value) || DEFAULTS.cacheLimitGB,
    nudgeMs: Math.max(1, Math.min(2000, Math.round(Number(el("nudgeMs").value)))) || DEFAULTS.nudgeMs,
    nudgeShiftMs: Math.max(1, Math.min(5000, Math.round(Number(el("nudgeShiftMs").value)))) || DEFAULTS.nudgeShiftMs,
    splitGapMs: Number.isFinite(Number(el("splitGapMs").value)) && el("splitGapMs").value !== "" ? Math.max(0, Math.min(2000, Math.round(Number(el("splitGapMs").value)))) : DEFAULTS.splitGapMs,
    psServer: el("psServer").value.trim() || DEFAULTS.psServer,
    psProvider: document.querySelector("input[name=psProvider]:checked")?.value || DEFAULTS.psProvider,
    psRemoveMusic: el("psRemoveMusic").checked,
    psEnabled: el("psEnabled").checked,
    psDropOverlap: el("psDropOverlap").checked,
    ...Object.fromEntries(
      PS_NUMBERS.map((k) => {
        const n = Number(el(k).value);
        return [k, el(k).value.trim() === "" ? (ZERO_IS_EMPTY.includes(k) ? 0 : DEFAULTS[k]) : Number.isFinite(n) && n >= 0 ? n : DEFAULTS[k]];
      })
    ),
  };
}
let flashTimer;
function flash(text) {
  const s = el("saved");
  s.textContent = text;
  s.classList.add("flash");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    s.textContent = "Changes save automatically";
    s.classList.remove("flash");
  }, 1500);
}
function save() {
  const s = read();
  chrome.storage.sync.set(s, () => {
    write(s);
    flash("Saved");
    renderSaved();
  });
}
document.addEventListener("change", (e) => {
  if (e.target.closest(".panel")) save();
  if (e.target.name === "psProvider" || e.target.id === "psRemoveMusic") renderHealth();
  if (e.target.id === "psEnabled") el("psSettings").classList.toggle("off", !e.target.checked);
});
el("reset").addEventListener("click", () => {
  write(DEFAULTS);
  chrome.storage.sync.set(read(), () => {
    flash("Defaults restored");
    checkServer();
  });
});

// ---------- presegmentation server status ----------
let health = null; // last /health answer
let checkSeq = 0;
function setPsStatus(state, text) {
  el("psStatus").dataset.state = state;
  el("psStatusText").textContent = text;
}
function psInfo(parts) {
  el("psInfo").replaceChildren(
    ...parts.map(([cls, t], i) => {
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = (i ? ". " : "") + t;
      return span;
    })
  );
}
function renderHealth() {
  const s = read();
  if (!health) {
    setPsStatus("down", "Offline");
    psInfo([["err", `Can't reach ${s.psServer}. Start the server, or fix the address`]]);
    return;
  }
  const d = health;
  const p = d.providers || {};
  const warn = [];
  if (s.psProvider === "local" && d.hf_token_set === false) warn.push("HF_TOKEN is missing on the server");
  if (s.psProvider === "pyannoteai" && !p.pyannoteai) warn.push("PYANNOTEAI_API_KEY is missing on the server");
  if (s.psRemoveMusic && d.separation === false) warn.push("music removal isn't installed on the server (run uv sync)");
  setPsStatus(warn.length ? "warn" : "ok", d.cuda ? "Online, GPU" : "Online, CPU");
  psInfo(warn.length ? warn.map((w) => ["warn", w]) : []);
}
function checkServer() {
  const seq = ++checkSeq;
  setPsStatus("checking", "Checking");
  chrome.runtime.sendMessage({ type: "CL_PS_HEALTH", serverUrl: read().psServer }, (r) => {
    void chrome.runtime.lastError;
    if (seq !== checkSeq) return; // a newer check started
    health = r && r.ok ? r.data : null;
    renderHealth();
  });
}
let urlTimer;
el("psServer").addEventListener("input", () => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    save();
    checkServer();
  }, 600);
});
el("psStatus").addEventListener("click", checkServer);

// ---------- saved videos ----------
function ago(ts) {
  if (!ts) return "";
  const d = (Date.now() - ts) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400 * 2) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} days ago`;
}

async function queueDelete(keys) {
  const { clCacheIndex: idx = {}, clCacheDeletes: q = [] } = await chrome.storage.local.get({ clCacheIndex: {}, clCacheDeletes: [] });
  const all = keys.includes("*");
  if (!all) keys.forEach((k) => delete idx[k]);
  await chrome.storage.local.set({ clCacheIndex: all ? {} : idx, clCacheDeletes: all ? ["*"] : [...new Set([...q, ...keys])] });
  el("queued").hidden = false;
  flash(all ? "All saved videos deleted" : "Deleted");
}

let confirmAll = 0;
el("deleteAll").addEventListener("click", () => {
  if (Date.now() - confirmAll > 4000) {
    confirmAll = Date.now();
    el("deleteAll").textContent = "Click again to delete all";
    setTimeout(() => (el("deleteAll").textContent = "Delete all saved videos"), 4000);
    return;
  }
  confirmAll = 0;
  el("deleteAll").textContent = "Delete all saved videos";
  queueDelete(["*"]);
});

// Is the saved video's task already submitted? Asked from Label Studio (read-only), once per popup.
const taskStatus = new Map(); // "base|id" -> Promise<{ status: "submitted" | "skipped" | "open", url } | null>
function statusOf(key, taskId) {
  const base = key.split("/data/local-files")[0]; // e.g. https://annotation.dlnlp.ai/cinnamon
  const k = `${base}|${taskId}`;
  if (!taskStatus.has(k)) {
    taskStatus.set(
      k,
      fetch(`${base}/api/tasks/${taskId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((t) =>
          !t
            ? null
            : {
                status: t.total_annotations > 0 ? "submitted" : t.cancelled_annotations > 0 ? "skipped" : "open",
                url: t.project != null ? `${base}/projects/${t.project}/data?task=${taskId}` : null,
              }
        )
        .catch(() => null)
    );
  }
  return taskStatus.get(k);
}
const STATUS_TEXT = { submitted: "Submitted", skipped: "Skipped", open: "Not submitted" };

async function renderSaved() {
  const { cacheLimitGB } = await chrome.storage.sync.get(DEFAULTS);
  const { clCacheIndex: idx = {} } = await chrome.storage.local.get({ clCacheIndex: {} });
  const entries = Object.entries(idx).sort((a, b) => (b[1].used || 0) - (a[1].used || 0));
  const used = entries.reduce((t, [, v]) => t + (v.size || 0), 0);
  const limit = cacheLimitGB * 1e9;
  el("used").textContent = U.fmtBytes(used);
  el("limitTxt").textContent = U.fmtBytes(limit);
  el("countTxt").textContent = entries.length ? `, ${entries.length} video${entries.length > 1 ? "s" : ""}` : "";
  el("usedBar").style.width = Math.min(100, (100 * used) / limit).toFixed(1) + "%";
  const list = el("list");
  list.textContent = "";
  for (const [key, v] of entries) {
    const li = document.createElement("li");
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = v.taskId != null ? `Task ${v.taskId}` : "Video";
    if (v.taskId != null) {
      const badge = document.createElement("span");
      badge.className = "status";
      name.append(" ", badge);
      statusOf(key, v.taskId).then((info) => {
        if (!info) return;
        badge.textContent = STATUS_TEXT[info.status];
        badge.dataset.s = info.status;
        if (!info.url) return;
        // The task name opens the task in a new tab.
        const a = document.createElement("a");
        a.className = "task";
        a.href = info.url;
        a.textContent = `Task ${v.taskId}`;
        a.title = "Open this task in a new tab";
        a.addEventListener("click", (e) => {
          e.preventDefault();
          chrome.tabs.create({ url: info.url });
        });
        name.firstChild.replaceWith(a);
      });
    }
    const file = document.createElement("span");
    file.className = "file";
    file.textContent = `${v.name || key}, opened ${ago(v.used)}`;
    file.title = key;
    const size = document.createElement("span");
    size.className = "size";
    size.textContent = U.fmtBytes(v.size);
    const del = document.createElement("button");
    del.className = "link danger del";
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete the saved video of task ${v.taskId ?? ""}`);
    del.addEventListener("click", () => queueDelete([key]));
    li.append(name, size, file, del);
    list.appendChild(li);
  }
  el("empty").hidden = entries.length > 0;
  el("deleteAll").disabled = entries.length === 0;
}
chrome.storage.onChanged.addListener((_c, area) => area === "local" && renderSaved());

chrome.storage.sync.get(DEFAULTS, (s) => {
  write(s);
  renderSaved();
  checkServer();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ready")));
});
setInterval(checkServer, 10000); // notice the server going down (or coming back) while the popup is open

// ---------- field help tooltips ----------
const tipBox = el("tooltip");
let tipFor = null;
let tipTimer;
function showTip(btn) {
  clearTimeout(tipTimer);
  if (tipFor && tipFor !== btn) tipFor.removeAttribute("aria-expanded");
  tipFor = btn;
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-describedby", "tooltip");
  tipBox.textContent = btn.dataset.tip;
  tipBox.hidden = false;
  const b = btn.getBoundingClientRect();
  const t = tipBox.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const m = 8;
  const left = Math.min(Math.max(b.left + b.width / 2 - t.width / 2, m), vw - t.width - m);
  const above = b.top - t.height - 8 >= m;
  tipBox.dataset.side = above ? "above" : "below";
  tipBox.style.left = left + "px";
  tipBox.style.top = (above ? b.top - t.height - 8 : b.bottom + 8) + "px";
  tipBox.style.setProperty("--ax", b.left + b.width / 2 - left + "px");
  requestAnimationFrame(() => tipBox.classList.add("show"));
}
function hideTip() {
  if (!tipFor) return;
  tipFor.removeAttribute("aria-expanded");
  tipFor.removeAttribute("aria-describedby");
  tipFor = null;
  tipBox.classList.remove("show");
  tipTimer = setTimeout(() => (tipBox.hidden = true), 150);
}
document.querySelectorAll(".tip").forEach((btn) => {
  btn.addEventListener("mouseenter", () => showTip(btn));
  btn.addEventListener("mouseleave", hideTip);
  btn.addEventListener("focus", () => showTip(btn));
  btn.addEventListener("blur", hideTip);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    tipFor === btn ? hideTip() : showTip(btn);
  });
});
document.addEventListener("keydown", (e) => e.key === "Escape" && hideTip());

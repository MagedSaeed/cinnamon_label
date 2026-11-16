// Settings and the saved-videos manager.
// Saved videos live in the Label Studio site's storage, which the popup can't reach, so deletions
// are queued in chrome.storage.local ("clCacheDeletes") and applied by a Label Studio tab.
const U = globalThis.CLU;
const DEFAULTS = { enabled: true, connections: 3, cacheLimitGB: 2, noDrafts: true, devReload: false };
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
  const r = document.querySelector(`input[name=connections][value="${s.connections}"]`) || document.querySelector('input[name=connections][value="3"]');
  r.checked = true;
  el("cacheLimitGB").value = String(s.cacheLimitGB);
  el("status").dataset.state = s.enabled ? "ok" : "off";
  el("statusText").textContent = s.enabled ? "Active" : "Off";
}
function read() {
  return {
    enabled: el("enabled").checked,
    devReload: el("devReload").checked,
    noDrafts: el("noDrafts").checked,
    connections: Number(document.querySelector("input[name=connections]:checked")?.value) || DEFAULTS.connections,
    cacheLimitGB: Number(el("cacheLimitGB").value) || DEFAULTS.cacheLimitGB,
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
});
el("reset").addEventListener("click", () => {
  write(DEFAULTS);
  chrome.storage.sync.set(read(), () => flash("Defaults restored"));
});

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
    del.setAttribute("aria-label", `Delete the saved video of ${name.textContent}`);
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
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ready")));
});

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

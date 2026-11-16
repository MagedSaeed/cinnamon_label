// Service worker. In M1 it only does the opt-in development auto-reload:
// when extension/build-id.txt changes on disk, reload the extension, then refresh the open
// Label Studio tabs so they run the new code. It never talks to Label Studio's API.

const LS_TABS = "https://annotation.dlnlp.ai/*";
const BUILD_URL = chrome.runtime.getURL("build-id.txt");

async function readBuildId() {
  try {
    const r = await fetch(BUILD_URL, { cache: "no-store" });
    return r.ok ? (await r.text()).trim() : null;
  } catch (_) {
    return null; // no build-id.txt: nothing to watch
  }
}

// Returns what it saw, so the page can show the reloader's state (for debugging the dev loop).
async function devTick(dirty) {
  const { devReload } = await chrome.storage.sync.get({ devReload: false });
  if (!devReload) return { devReload };
  const id = await readBuildId();
  if (!id) return { devReload, disk: null };
  const { clBuild } = await chrome.storage.session.get("clBuild");
  if (!clBuild) {
    await chrome.storage.session.set({ clBuild: id });
    return { devReload, disk: id, running: id };
  }
  if (clBuild === id || dirty) return { devReload, disk: id, running: clBuild, dirty }; // never reload over unsynced edits
  const tabs = await chrome.tabs.query({ url: LS_TABS });
  await chrome.storage.local.set({ clReloadTabs: tabs.map((t) => t.id) });
  chrome.runtime.reload();
  return { reloading: true };
}

// ---------- shared download budget ----------
// The site is HTTP/1.1: Chrome opens at most 6 connections to it, shared by ALL tabs. Every
// downloader chunk takes a slot here first, so all tabs together never use more than `limit`
// connections and Label Studio's own requests (saving, Submit) always get through.
// Priority: 0 = task in the visible tab, 1 = task in a background tab, 2 = prefetch.
const LEASE_MS = 120000; // a slot that is never released (crashed tab) frees itself
const leases = new Map(); // id -> { tabId, until }
let waiting = []; // { priority, tabId, t, respond }
let limit = 3;
let sweepTimer = 0;
chrome.storage.sync.get({ connections: 3 }, (s) => {
  limit = Math.max(1, Math.min(4, s.connections | 0));
  grant();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "sync" && ch.connections) {
    limit = Math.max(1, Math.min(4, ch.connections.newValue | 0));
    grant();
  }
});

function grant() {
  const now = Date.now();
  for (const [id, l] of leases) if (l.until < now) leases.delete(id);
  waiting.sort((a, b) => a.priority - b.priority || a.t - b.t);
  while (leases.size < limit && waiting.length) {
    const w = waiting.shift();
    const id = crypto.randomUUID();
    leases.set(id, { tabId: w.tabId, until: now + LEASE_MS });
    try {
      w.respond({ ok: true, lease: id });
    } catch (_) {
      leases.delete(id); // the asking page is gone
    }
  }
  // Re-check later so expired leases free up even if nobody asks (one timer at a time).
  if (leases.size && !sweepTimer) sweepTimer = setTimeout(() => ((sweepTimer = 0), grant()), 15000);
}

function dropTab(tabId) {
  for (const [id, l] of leases) if (l.tabId === tabId) leases.delete(id);
  waiting = waiting.filter((w) => w.tabId !== tabId);
  grant();
}
chrome.tabs.onRemoved.addListener(dropTab);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : -1;
  if (msg && msg.type === "CL_SLOT_ACQUIRE") {
    waiting.push({ priority: msg.priority | 0, tabId, t: Date.now(), respond: sendResponse });
    grant();
    return true; // answered when a slot is free
  }
  if (msg && msg.type === "CL_SLOT_RELEASE") {
    leases.delete(msg.lease);
    grant();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === "CL_SLOT_RESET") {
    dropTab(tabId); // the page reloaded: its old downloads are gone
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "CL_DEV_TICK") {
    devTick(!!msg.dirty)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

// After a development reload: refresh the Label Studio tabs that were open.
(async () => {
  const { clReloadTabs } = await chrome.storage.local.get({ clReloadTabs: [] });
  if (!clReloadTabs.length) return;
  await chrome.storage.local.remove("clReloadTabs");
  const id = await readBuildId();
  if (id) await chrome.storage.session.set({ clBuild: id });
  for (const tabId of clReloadTabs) chrome.tabs.reload(tabId).catch(() => {});
})();

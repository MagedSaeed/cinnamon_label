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

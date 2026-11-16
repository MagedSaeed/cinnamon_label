// Offline copies of task videos in this site's Cache Storage, with a size limit (least recently
// used first out). The index (sizes, last use) lives in chrome.storage.local so the popup can show it.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;
  const NAME = "cinnamon-label-media-v1";
  const INDEX = "clCacheIndex";

  const keyUrl = (key) => `${location.origin}/__cinnamon_label_cache__/${encodeURIComponent(key)}`;
  const getIndex = () => new Promise((r) => chrome.storage.local.get({ [INDEX]: {} }, (o) => r(o[INDEX] || {})));
  const setIndex = (idx) => new Promise((r) => chrome.storage.local.set({ [INDEX]: idx }, r));

  // Serialise index updates (several tasks/prefetches may finish at once).
  let chain = Promise.resolve();
  const withIndex = (fn) => (chain = chain.then(async () => setIndex((await fn(await getIndex())) || {})).catch(CL.warn));

  CL.cache = {
    async get(key) {
      const c = await caches.open(NAME);
      const res = await c.match(keyUrl(key));
      if (!res) {
        await withIndex((idx) => (delete idx[key], idx));
        return null;
      }
      const blob = await res.blob();
      await withIndex((idx) => ((idx[key] = { ...(idx[key] || { name: key }), size: blob.size, used: Date.now() }), idx));
      return blob.type ? blob : blob.slice(0, blob.size, res.headers.get("content-type") || "video/mp4");
    },

    async has(key) {
      const c = await caches.open(NAME);
      return !!(await c.match(keyUrl(key)));
    },

    // Returns { saved: boolean, reason? }. `info` ({ taskId, name }) is shown in the popup's list.
    async put(key, blob, limitBytes, info = {}) {
      if (blob.size > limitBytes) return { saved: false, reason: "larger than the cache limit" };
      const c = await caches.open(NAME);
      try {
        await c.put(
          keyUrl(key),
          new Response(blob, { headers: { "content-type": blob.type || "video/mp4", "content-length": String(blob.size) } })
        );
      } catch (e) {
        return { saved: false, reason: e && e.name === "QuotaExceededError" ? "browser storage is full" : String(e) };
      }
      await withIndex(async (idx) => {
        idx[key] = { size: blob.size, used: Date.now(), saved: Date.now(), taskId: info.taskId ?? null, name: info.name || key };
        for (const k of U.lruEvict(idx, limitBytes, key)) {
          await c.delete(keyUrl(k));
          delete idx[k];
        }
        return idx;
      });
      return { saved: true };
    },

    async clear() {
      await caches.delete(NAME);
      await withIndex(() => ({}));
    },

    // The popup can't reach this site's storage, so it queues deletions in chrome.storage.local
    // ("clCacheDeletes": list of keys, or ["*"] for everything). Any Label Studio tab applies them.
    async applyQueuedDeletes() {
      const { clCacheDeletes: q = [] } = await chrome.storage.local.get({ clCacheDeletes: [] });
      if (!q.length) return;
      await chrome.storage.local.set({ clCacheDeletes: [] });
      if (q.includes("*")) return CL.cache.clear();
      const c = await caches.open(NAME);
      for (const k of q) await c.delete(keyUrl(k));
      await withIndex((idx) => (q.forEach((k) => delete idx[k]), idx));
    },
  };
})();

// Look-ahead download: after the open task's video is complete, quietly download the videos of the
// next tasks in the current list (same view, same order) that have no annotation yet, into the saved
// videos. One at a time, at the lowest priority of the shared connection budget, so it never slows
// the task being worked on. Opening a task whose video is being prefetched adopts that download.
// Only videos are downloaded; annotations are never read or changed here.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;

  const inflight = new Map(); // media key -> { taskId, dl, blob, done (Promise<Blob>) }
  let running = false;
  let onStatusFn = () => {};
  // Every background download with its own progress: [{ taskId, loaded, total }].
  let statusTimer = 0;
  const onStatus = () => {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      const list = [...inflight.values()].filter((e) => !e.blob).map((e) => ({ taskId: e.taskId, loaded: e.dl.loaded, total: e.dl.total }));
      onStatusFn(list.length ? list : null);
    }, 200);
  };

  const apiBase = () => location.pathname.split("/projects/")[0]; // e.g. "/cinnamon"
  const viewAndProject = () => ({
    view: new URLSearchParams(location.search).get("tab"),
    project: (location.pathname.match(/\/projects\/(\d+)/) || [])[1],
  });

  // The tasks of the current list, in order, until the current task is found (a few pages at most).
  async function listAround(currentId) {
    const { view, project } = viewAndProject();
    if (!project) return [];
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const q = new URLSearchParams({ page: String(page), page_size: "100", project });
      if (view) q.set("view", view);
      const r = await fetch(`${apiBase()}/api/tasks?${q}`, { credentials: "include" });
      if (!r.ok) break;
      const j = await r.json();
      const tasks = j.tasks || j.results || [];
      all.push(...tasks);
      const idx = all.findIndex((t) => t.id === currentId);
      if (idx >= 0 && all.length - idx > 10) break; // enough after the current one
      if (!tasks.length || all.length >= (j.total || Infinity)) break;
    }
    return all;
  }

  CL.prefetch = {
    setStatusListener(fn) {
      onStatusFn = fn || (() => {});
    },

    // A prefetch in progress (or just finished) for this media: hand it to the task being opened.
    take(key) {
      const e = inflight.get(key);
      if (e) inflight.delete(key);
      onStatus();
      return e || null;
    },

    // Called when the open task's video is complete. settings: { prefetchNext, cacheLimitGB }.
    async after(currentId, settings) {
      const n = Number(settings.prefetchNext) || 0;
      if (!n || running) return;
      running = true;
      try {
        const list = await listAround(currentId);
        const idx = list.findIndex((t) => t.id === currentId);
        if (idx < 0) return;
        const next = list
          .slice(idx + 1)
          .filter((t) => !t.total_annotations && !t.cancelled_annotations && t.data && (t.data.video || t.data.audio))
          .slice(0, n);
        for (const t of next) {
          const url = new URL(t.data.video || t.data.audio, location.href).href;
          const key = U.mediaKey(url);
          if (inflight.has(key) || (await CL.cache.has(key).catch(() => false))) continue;
          await this._download(t.id, url, key, settings);
        }
      } catch (e) {
        CL.warn("Look-ahead download stopped:", e);
      } finally {
        running = false;
        onStatus();
      }
    },

    // A download the user switched away from: let it finish at low priority and save it.
    // At most 2 continue at once; the oldest is stopped if more pile up.
    continueInBackground(key, taskId, name, dl, runP, settings) {
      const bg = [...inflight.entries()].filter(([, e]) => e.background);
      while (bg.length >= 2) {
        const [k, e] = bg.shift();
        e.dl.abort();
        inflight.delete(k);
      }
      Object.assign(dl, {
        onChunk: () => {},
        onProgress: () => inflight.has(key) && onStatus(),
        acquire: () => CL.acquireSlot(2),
      });
      const entry = { taskId, dl, blob: null, background: true, done: null };
      entry.done = runP.then(async (blob) => {
        entry.blob = blob;
        await CL.cache.put(key, blob, settings.cacheLimitGB * 1e9, { taskId, name }).catch(CL.warn);
        return blob;
      });
      entry.done
        .catch(() => {})
        .finally(() => {
          if (inflight.get(key) === entry) inflight.delete(key);
          onStatus();
        });
      inflight.set(key, entry);
    },

    async _download(taskId, url, key, settings) {
      const name = decodeURIComponent((key.split("?d=")[1] || key).split("/").pop());
      const dl = new CL.Downloader(url, {
        connections: 2,
        acquire: () => CL.acquireSlot(2), // lowest priority: the open task always goes first
        onProgress: () => inflight.has(key) && onStatus(),
      });
      const entry = { taskId, dl, blob: null, done: null };
      entry.done = dl.run().then(async (blob) => {
        entry.blob = blob;
        await CL.cache.put(key, blob, settings.cacheLimitGB * 1e9, { taskId, name }).catch(CL.warn);
        return blob;
      });
      inflight.set(key, entry);
      try {
        await entry.done;
      } catch (e) {
        if (!dl.aborted) CL.warn(`Look-ahead download of task ${taskId} failed:`, e);
      } finally {
        if (inflight.get(key) === entry) inflight.delete(key);
      }
    },
  };
})();

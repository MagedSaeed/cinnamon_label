// Local backup of each task's unsubmitted annotation, in this browser (chrome.storage.local).
//
// Why: the server refuses Label Studio's draft saves, so unsubmitted work lives only in the open page.
// A reload or crash would lose it. We keep a copy of the results (exactly what Submit would send)
// after every change, offer to put it back when the task opens empty, and delete it once the user's
// Submit/Update/Skip succeeds. Restoring is always the user's choice; it is never automatic.
(() => {
  const CL = globalThis.CL;
  const KEY = "clBackups";
  const KEEP_DAYS = 14;
  const MAX = 300;
  const SAVE_DELAY = 800;

  const getAll = () => new Promise((r) => chrome.storage.local.get({ [KEY]: {} }, (o) => r(o[KEY] || {})));
  const setAll = (all) => new Promise((r) => chrome.storage.local.set({ [KEY]: all }, r));
  let chain = Promise.resolve();
  const update = (fn) => (chain = chain.then(async () => setAll((await fn(await getAll())) || {})).catch(CL.warn));
  const taskKey = (taskId) => `${location.origin}${location.pathname.replace(/\/data.*$/, "")}#${taskId}`;
  const segmentCount = (results) => new Set(results.filter((r) => r.value && r.value.start != null).map((r) => r.id)).size;

  CL.backup = {
    // Drop old backups (on start).
    prune() {
      return update((all) => {
        const cutoff = Date.now() - KEEP_DAYS * 86400000;
        const entries = Object.entries(all).filter(([, v]) => v.savedAt > cutoff);
        entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
        return Object.fromEntries(entries.slice(0, MAX));
      });
    },
    async get(taskId) {
      return (await getAll())[taskKey(taskId)] || null;
    },
    remove(taskId) {
      return update((all) => (delete all[taskKey(taskId)], all));
    },
  };

  // Follows one open task: saves after changes, knows whether a restore should be offered.
  CL.TaskBackup = class TaskBackup {
    constructor(taskId, { onOffer } = {}) {
      this.taskId = taskId;
      this.onOffer = onOffer || (() => {});
      this.sawWork = false; // the annotation had results at some point in this page
      this.offer = null;
      this._timer = 0;
      this._dead = false;
    }

    // Called on start and after every annotation change.
    changed() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._save().catch(CL.warn), SAVE_DELAY);
    }

    async _save() {
      if (this._dead) return;
      const s = await CL.page("serialize");
      if (this._dead || !s || s.taskId !== this.taskId) return;
      const n = s.results.length;
      if (n) {
        this.sawWork = true;
        this._setOffer(null);
        await update((all) => {
          all[taskKey(this.taskId)] = { taskId: this.taskId, results: s.results, segments: segmentCount(s.results), savedAt: Date.now() };
          return all;
        });
        return;
      }
      // Empty annotation. If the user emptied it in this page, that's their choice: clear the copy.
      if (this.sawWork) {
        await CL.backup.remove(this.taskId);
        return;
      }
      // Empty from the start (e.g. after a reload): offer the copy if we have one.
      const b = await CL.backup.get(this.taskId);
      if (!this._dead) this._setOffer(b && b.results && b.results.length ? b : null);
    }

    _setOffer(b) {
      this.offer = b;
      this.onOffer(b);
    }

    async restore() {
      const b = this.offer;
      if (!b) return { ok: false, message: "There is nothing to restore." };
      try {
        const r = await CL.page("restore", { taskId: this.taskId, results: b.results }, 8000);
        this._setOffer(null);
        this.sawWork = true;
        return { ok: true, message: `Restored ${b.segments} segment${b.segments === 1 ? "" : "s"} from this browser's backup.`, state: r.state };
      } catch (e) {
        return { ok: false, message: e.message || String(e) };
      }
    }

    async discard() {
      await CL.backup.remove(this.taskId);
      this._setOffer(null);
    }

    destroy() {
      this._dead = true;
      clearTimeout(this._timer);
    }
  };
})();

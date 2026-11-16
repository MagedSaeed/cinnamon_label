// The segments of the open annotation, mirrored from Label Studio (the single source of truth).
//
// Edits are planned with the pure rules in shared/segments.js, shown immediately (preview), then
// written into Label Studio one at a time, in order. Every write returns what Label Studio now
// holds; if that differs from what we expected, the status turns to "error" and the view reloads
// from Label Studio, so the two can never silently drift apart.
//
// Nothing here saves, submits or skips. Label Studio keeps its own draft behaviour.
(() => {
  const CL = globalThis.CL;
  const S = globalThis.CLSeg;
  const TEXT_DEBOUNCE = 350;

  CL.SegmentStore = class SegmentStore {
    constructor({ onChange }) {
      this.onChange = onChange || (() => {});
      this.supported = false;
      this.readOnly = false;
      this.segments = [];
      this.selected = null;
      this.status = "synced"; // "synced" | "pending" | "error"
      this.error = "";
      this._chain = Promise.resolve();
      this._inflight = 0;
      this._textTimers = new Map(); // `${id}|${name}` -> { timer, value }
      this._dead = false;
    }

    get dirty() {
      return this._inflight > 0 || this._textTimers.size > 0;
    }

    _emit() {
      if (!this._dead) this.onChange(this);
    }

    _setState(st) {
      this.supported = !!st.supported;
      this.readOnly = !!st.readOnly;
      this.segments = st.segments || [];
      this.labelsName = st.labelsName;
      this.textFields = st.textFields || [];
      this.taskFields = st.taskFields || {};
      this.objectName = st.objectName;
      if (this.selected && !this.segments.some((g) => g.id === this.selected)) this.selected = null;
    }

    // Re-read from Label Studio (after changes made elsewhere: undo, native UI, ...).
    async refresh() {
      if (this._dead || this.dirty) return; // our own write will bring the fresh state
      const st = await CL.page("segments");
      if (this._dead || this.dirty || !st || !st.ready) return;
      this._setState(st);
      if (this.status === "error") this.status = "synced";
      this._emit();
    }

    // Queue a write. fn() runs the bridge call and returns { state, ... }.
    _write(fn, expect) {
      this._inflight++;
      this.status = "pending";
      this._emit();
      const run = this._chain.then(async () => {
        if (this._dead) return null;
        try {
          const res = await fn();
          if (this._dead) return res;
          this._setState(res.state);
          const problem = expect ? expect(res) : null;
          if (problem) throw new Error(problem);
          return res;
        } catch (e) {
          this.status = "error";
          this.error = (e && e.message) || String(e);
          CL.warn("Edit not applied:", e);
          // Show what Label Studio really has.
          try {
            const st = await CL.page("segments");
            if (st && st.ready) this._setState(st);
          } catch (_) {}
          return null;
        } finally {
          this._inflight--;
          if (!this.dirty && this.status === "pending") this.status = "synced";
          this._emit();
        }
      });
      this._chain = run.catch(() => {});
      return run;
    }

    // Apply a plan from shared/segments.js. Returns the ids of created segments (or null on failure).
    async apply(plan, { select } = {}) {
      if (this.readOnly || !plan) return null;
      if (!plan.create.length && !plan.update.length && !plan.remove.length && !(plan.fields || []).length) return [];
      await this.flushTexts(); // a pending transcript must land on the segment it was typed for
      // Preview right away.
      const before = this.segments;
      const preview = S.apply(before, plan, plan.create.map((_, i) => `pending-${i}`));
      if (S.validate(preview).length > S.validate(before).length) return null; // never make things worse
      this.segments = preview.map((g) => ({ ...g, fields: (before.find((b) => b.id === g.id) || {}).fields || {} }));
      this._emit();
      const res = await this._write(
        () => CL.page("applyPlan", { plan }, 8000),
        (r) => {
          // Read-back check: every update landed at the planned times, every removal is gone.
          for (const u of plan.update) {
            const g = r.state.segments.find((x) => x.id === u.id);
            if (!g || Math.abs(g.start - u.start) > 0.0015 || Math.abs(g.end - u.end) > 0.0015) return `Segment ${u.id} is not where it should be.`;
          }
          for (const id of plan.remove) if (r.state.segments.some((x) => x.id === id)) return `Segment ${id} was not removed.`;
          if (r.created.length !== plan.create.length) return "A new segment was not created.";
          return null;
        }
      );
      if (!res) return null;
      if (select === "created" && res.created[0]) this.select(res.created[0]);
      else if (select) this.select(select);
      return res.created;
    }

    // An answer: per segment (id = segment id) or for the whole task (id = null).
    // Texts are written after a short pause in typing (or on flush).
    setField(id, name, value, { text = false } = {}) {
      if (this.readOnly) return;
      const local = text ? (value ? [value] : undefined) : value;
      if (id == null) this.taskFields = { ...this.taskFields, [name]: local };
      else {
        const g = this.segments.find((x) => x.id === id);
        if (g) g.fields = { ...g.fields, [name]: local };
      }
      if (!text) {
        this._write(() => (id == null ? CL.page("setTaskField", { name, value }) : CL.page("setField", { id, name, value })));
        this._emit();
        return;
      }
      const k = `${id}|${name}`;
      const old = this._textTimers.get(k);
      if (old) clearTimeout(old.timer);
      const timer = setTimeout(() => this._flushText(k), TEXT_DEBOUNCE);
      this._textTimers.set(k, { timer, id, name, value });
      this.status = "pending";
      this._emit();
    }

    _flushText(k) {
      const t = this._textTimers.get(k);
      if (!t) return Promise.resolve();
      clearTimeout(t.timer);
      this._textTimers.delete(k);
      return this._write(
        () => (t.id == null ? CL.page("setTaskField", { name: t.name, value: t.value }) : CL.page("setField", { id: t.id, name: t.name, value: t.value })),
        (r) => {
          const fields = t.id == null ? r.state.taskFields : (r.state.segments.find((x) => x.id === t.id) || {}).fields;
          const got = fields && fields[t.name] ? [].concat(fields[t.name]).join("") : "";
          return got === (t.value || "") ? null : "The text was not saved into Label Studio.";
        }
      );
    }

    flushTexts() {
      return Promise.all([...this._textTimers.keys()].map((k) => this._flushText(k)));
    }

    // Everything typed or edited is in Label Studio when this resolves.
    async flush() {
      await this.flushTexts();
      await this._chain;
    }

    select(id) {
      this.selected = id || null;
      CL.page("select", { id: this.selected }).catch(() => {});
      this._emit();
    }

    byId(id) {
      return this.segments.find((g) => g.id === id) || null;
    }

    // Presegmentation suggestions: shown on the timeline, never written to Label Studio until the
    // user accepts them (they then become normal segments through apply()).
    setSuggestions(list) {
      this.suggestions = (list || []).map((s, i) => ({ ...s, key: `s${i}` }));
      this._emit();
    }
    dropSuggestions(keys) {
      const drop = new Set(keys);
      this.suggestions = (this.suggestions || []).filter((s) => !drop.has(s.key));
      this._emit();
    }

    destroy() {
      this._dead = true;
      for (const t of this._textTimers.values()) clearTimeout(t.timer);
    }
  };
})();

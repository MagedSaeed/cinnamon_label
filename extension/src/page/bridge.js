// Runs in the page's MAIN world, before Label Studio starts (document_start).
//
// What it does:
//  1. Answers read-only questions from the content script about the open task (window.Htx).
//  2. Holds Label Studio's own waveform download (the XHR whose URL has `lsref=1`) and, when
//     Cinnamon Label has the same file, lets Label Studio read it from that copy instead of
//     downloading the whole video a second time. If Cinnamon Label does not claim the request
//     quickly, or anything goes wrong, the request goes to the network exactly as before.
//
//  3. Reads and edits the open annotation's speaker segments and their per-segment fields, through
//     Label Studio's own model actions (the same ones its UI uses), so Submit, History, review and
//     validation see exactly what a hand-made edit would produce.
//
// It never submits, updates, skips or deletes an annotation, never saves a draft itself, and never
// calls Label Studio's API.
(() => {
  if (window.__CL_BRIDGE__) return;
  window.__CL_BRIDGE__ = true;

  const CH = "CL_BRIDGE_v1";
  const ORIGIN = location.origin;
  const post = (msg) => window.postMessage({ ch: CH, dir: "toContent", ...msg }, ORIGIN);

  // ---------- 2. Label Studio's waveform request ----------
  // Held whenever Cinnamon Label is switched on (in either UI mode: switching to the native UI
  // also triggers this request). The content script then serves it from its copy or releases it.
  // Extension off, or an unreadable flag: never touch the request.
  const extensionActive = () => {
    try {
      return localStorage.getItem("cinnamonLabel.active") === "1";
    } catch (_) {
      return false;
    }
  };
  const isWaveformRequest = (url) => /[?&]lsref=1(&|$)/.test(url) && /\/data\/local-files\//.test(url);

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  const XA = XMLHttpRequest.prototype.abort;
  const meta = new WeakMap(); // xhr -> { method, url, async }
  const held = new Map(); // id -> { go(blob|null), claimed }
  let seq = 0;

  XMLHttpRequest.prototype.open = function (method, url, async, ...rest) {
    try {
      meta.set(this, { method, url: String(url), async: async !== false, aborted: false });
    } catch (_) {}
    return XO.call(this, method, url, async === undefined ? true : async, ...rest);
  };

  XMLHttpRequest.prototype.abort = function () {
    const m = meta.get(this);
    if (m) m.aborted = true;
    return XA.call(this);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const m = meta.get(this);
    if (!m || !m.async || !isWaveformRequest(m.url) || !extensionActive()) return XS.call(this, body);

    const xhr = this;
    const id = ++seq;
    let done = false;
    const go = (blob) => {
      if (done) return;
      done = true;
      held.delete(id);
      if (m.aborted) return;
      if (blob) {
        try {
          const bu = URL.createObjectURL(blob);
          xhr.addEventListener("loadend", () => URL.revokeObjectURL(bu), { once: true });
          XO.call(xhr, m.method, bu, true); // responseType and listeners survive a re-open
          XS.call(xhr, body);
          return;
        } catch (_) {
          /* fall through to the network */
        }
        try {
          XO.call(xhr, m.method, m.url, true);
        } catch (_) {}
      }
      try {
        XS.call(xhr, body); // the original open() is still in effect when we never re-opened
      } catch (_) {}
    };
    held.set(id, { go, claimed: false });

    // Ask until claimed (the content script may load after Label Studio fires the request).
    const started = Date.now();
    const ask = () => {
      const h = held.get(id);
      if (!h || h.claimed) return;
      if (Date.now() - started > 6000) return go(null);
      post({ op: "waveformWanted", id, url: m.url });
      setTimeout(ask, 500);
    };
    ask();
  };

  // ---------- 1. read-only task state ----------
  function state() {
    const s = window.Htx;
    const a = s && s.annotationStore && s.annotationStore.selected;
    if (!s || !a || !s.task) return { ready: false };
    let data = s.task.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (_) {
        data = {};
      }
    }
    return {
      ready: true,
      taskId: s.task.id,
      annotationKey: String(a.id),
      readOnly: !!(a.readonly || (typeof a.isReadOnly === "function" && a.isReadOnly())),
      mediaUrl: (data && (data.video || data.audio)) || null,
    };
  }

  // ---------- 3. segments: read and edit Label Studio's own annotation ----------
  // Only regions of the speaker-segment Labels tag and their per-segment fields are touched.
  // Writes go through Label Studio's own model actions, grouped into one undo step each.
  // Nothing here saves, submits, updates or skips: Label Studio decides when to save drafts.
  const ann = () => window.Htx && window.Htx.annotationStore && window.Htx.annotationStore.selected;
  const cleanId = (r) => r.cleanId || String(r.id).split("#")[0];

  // The Labels tag that marks segments on an Audio tag, from the live config.
  function segmentTags(a) {
    for (const [name, tag] of a.names) {
      if (!/labels$/i.test(tag.type || "") || !tag.toname) continue;
      const obj = a.names.get(tag.toname);
      if (obj && /audio/i.test(obj.type || "")) return { labels: tag, object: obj };
    }
    return null;
  }
  function segmentRegions(a, tags) {
    return a.regions.filter((r) => r.results && r.results.some((x) => x.from_name === tags.labels));
  }
  const findRegion = (a, tags, id) => segmentRegions(a, tags).find((r) => cleanId(r) === id) || null;

  function readSegments() {
    const a = ann();
    if (!a) return { ready: false };
    const tags = segmentTags(a);
    if (!tags) return { ready: true, supported: false };
    const segments = segmentRegions(a, tags)
      .map((r) => {
        const fields = {};
        for (const x of r.results) {
          if (x.from_name === tags.labels) continue;
          const tag = x.from_name;
          const v = x.value && x.value[tag.valueType];
          fields[tag.name] = v && v.toJSON ? v.toJSON() : v;
        }
        return { id: cleanId(r), start: r.start, end: r.end, fields, origin: r.origin || null, readonly: !!r.readonly };
      })
      .sort((p, q) => p.start - q.start);
    const sel = a.regions.find((r) => r.selected);
    // Whole-task answers (not tied to a segment), e.g. "Skip entire video".
    const taskFields = {};
    for (const x of a.results || []) {
      const tag = x.from_name;
      if (!tag || tag.perregion || tag === tags.labels || (x.area && x.area.start != null)) continue;
      const v = x.value && x.value[tag.valueType];
      taskFields[tag.name] = v && v.toJSON ? v.toJSON() : v;
    }
    return {
      taskFields,
      ready: true,
      supported: true,
      readOnly: !!(a.readonly || (typeof a.isReadOnly === "function" && a.isReadOnly())),
      labelsName: tags.labels.name,
      label: (tags.labels.children || []).map((c) => c.value).filter(Boolean)[0] || null,
      // Per-segment text fields (e.g. the transcript), for joining texts on merge.
      textFields: [...a.names.values()].filter((t) => t.perregion && /textarea/i.test(t.type || "")).map((t) => t.name),
      objectName: tags.object.name,
      selected: sel ? cleanId(sel) : null,
      segments,
    };
  }

  function guardWritable(a) {
    if (!a) throw new Error("No annotation is open.");
    if (a.readonly || (typeof a.isReadOnly === "function" && a.isReadOnly())) throw new Error("This annotation is read-only.");
    const tags = segmentTags(a);
    if (!tags) throw new Error("This labeling config has no segment labels on an audio track.");
    return tags;
  }

  // Set a per-segment field. value: array (choices) or string (text); empty removes the answer.
  function setFieldOn(a, region, name, value) {
    const tag = a.names.get(name);
    if (!tag || !tag.perregion) throw new Error(`"${name}" is not a per-segment field.`);
    const arr = Array.isArray(value) ? value.filter((v) => v != null && v !== "") : value == null || value === "" ? [] : [String(value)];
    const res = region.results.find((x) => x.from_name === tag);
    if (!arr.length) {
      if (res) region.removeResult(res);
    } else if (res) res.setValue(arr);
    else region.addResult({ from_name: tag.id, to_name: region.object.id, type: tag.resultType, value: { [tag.valueType]: arr } });
  }

  // plan: { create: [{start,end, copyFrom?}], update: [{id,start,end}], remove: [id], fields?: [{id|createIndex, name, value}] }
  function applyPlan(plan) {
    const a = ann();
    const tags = guardWritable(a);
    const h = a.history;
    const key = "cinnamon-label";
    const created = [];
    if (h && h.freeze) h.freeze(key);
    try {
      for (const id of plan.remove || []) {
        const r = findRegion(a, tags, id);
        if (r) r.deleteRegion();
      }
      for (const u of plan.update || []) {
        const r = findRegion(a, tags, u.id);
        if (!r) throw new Error(`Segment ${u.id} no longer exists.`);
        // Order matters only for validity in between; set the side that moves outward first.
        if (u.start < r.start) {
          r.setProperty("start", u.start);
          r.setProperty("end", u.end);
        } else {
          r.setProperty("end", u.end);
          r.setProperty("start", u.start);
        }
      }
      for (const c of plan.create || []) {
        const before = new Set(a.regions.map((r) => r.id));
        const label = (tags.labels.children || []).map((x) => x.value).filter(Boolean)[0];
        a.appendResults([
          {
            id: "cl" + Math.random().toString(36).slice(2, 10),
            from_name: tags.labels.name,
            to_name: tags.object.name,
            type: tags.labels.resultType || "labels",
            origin: c.origin || "manual",
            value: { start: c.start, end: c.end, channel: 0, [tags.labels.valueType || "labels"]: [label] },
          },
        ]);
        const r = a.regions.find((x) => !before.has(x.id));
        if (!r) throw new Error("Label Studio did not create the segment.");
        created.push(cleanId(r));
        if (c.copyFrom) {
          // Copy the choice answers (not texts) of the segment this one was split from.
          const src = findRegion(a, tags, c.copyFrom);
          for (const x of src ? src.results : []) {
            if (x.from_name === tags.labels || x.type !== "choices") continue;
            setFieldOn(a, r, x.from_name.name, [...x.value.choices]);
          }
        }
      }
      for (const f of plan.fields || []) {
        const id = f.id != null ? f.id : created[f.createIndex];
        const r = findRegion(a, tags, id);
        if (r) setFieldOn(a, r, f.name, f.value);
      }
    } finally {
      if (h && h.unfreeze) h.unfreeze(key);
    }
    return { created, state: readSegments() };
  }

  function setField({ id, name, value }) {
    const a = ann();
    const tags = guardWritable(a);
    const r = findRegion(a, tags, id);
    if (!r) throw new Error(`Segment ${id} no longer exists.`);
    setFieldOn(a, r, name, value);
    return { state: readSegments() };
  }

  // Whole-task field. value: array (choices) or string (text); empty clears it.
  function setTaskField({ name, value }) {
    const a = ann();
    guardWritable(a);
    const tag = a.names.get(name);
    if (!tag || tag.perregion) throw new Error(`"${name}" is not a whole-task field.`);
    const h = a.history;
    if (h && h.freeze) h.freeze("cinnamon-label-task");
    try {
      if (/choices/i.test(tag.type)) {
        const want = new Set(Array.isArray(value) ? value : value ? [value] : []);
        const kids = (tag.children || []).filter((c) => c.toggleSelected);
        const key = (c) => (c.alias != null && c.alias !== "" ? c.alias : c.value);
        for (const c of kids) if (c.sel && !want.has(key(c))) c.toggleSelected(); // unselect first
        for (const c of kids) if (!c.sel && want.has(key(c))) c.toggleSelected();
      } else if (/textarea/i.test(tag.type)) {
        const text = Array.isArray(value) ? value.join("") : value == null ? "" : String(value);
        const res = (a.results || []).find((x) => x.from_name === tag);
        if (!text) {
          if (res && res.area) res.area.removeResult(res);
        } else if (res) res.setValue([text]);
        else tag.addText(text); // creates the answer (addText appends, so only when there is none)
      } else throw new Error(`"${name}" can't be edited here.`);
    } finally {
      if (h && h.unfreeze) h.unfreeze("cinnamon-label-task");
    }
    return { state: readSegments() };
  }

  function selectSegment({ id }) {
    const a = ann();
    if (!a) return false;
    const tags = segmentTags(a);
    const r = id && tags ? findRegion(a, tags, id) : null;
    if (r && !r.selected) a.selectArea(r);
    else if (!r && a.unselectAll) a.unselectAll();
    return true;
  }

  // ---------- 4. drafts and submits ----------
  // The server refuses Label Studio's draft auto-save (403, "Runtime error: Forbidden"). When the
  // user's setting asks for it, auto-save is paused for each annotation; the content script keeps a
  // local backup instead. (Label Studio's own pause; nothing is sent.)
  const noDrafts = () => {
    try {
      return localStorage.getItem("cinnamonLabel.noDrafts") === "1";
    } catch (_) {
      return false;
    }
  };
  const pausedAnns = new WeakSet();
  function keepDraftsPaused() {
    const a = ann();
    if (!a || !noDrafts() || pausedAnns.has(a) || typeof a.pauseAutosave !== "function") return;
    a.pauseAutosave();
    pausedAnns.add(a);
  }

  // Watch (never change) Label Studio's own requests, to know when the user's Submit, Update or Skip
  // succeeded: then the local backup of that task is no longer needed.
  const F = window.fetch;
  window.fetch = function (input, init) {
    const p = F.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const created = /\/api\/tasks\/(\d+)\/annotations\/?(?:\?|$)/.exec(url);
      const updated = /\/api\/annotations\/(\d+)\/?(?:\?|$)/.exec(url);
      if ((created && method === "POST") || (updated && (method === "PATCH" || method === "PUT"))) {
        const taskId = created ? Number(created[1]) : window.Htx && window.Htx.task ? window.Htx.task.id : null;
        p.then((r) => r && r.ok && post({ op: "annotationSaved", taskId })).catch(() => {});
      }
    } catch (_) {}
    return p;
  };

  // Results as Submit would send them (for the local backup).
  function serialize() {
    const a = ann();
    const s = window.Htx;
    if (!a || !s || !s.task) return null;
    return { taskId: s.task.id, annotationPk: a.pk || null, results: a.serializeAnnotation() };
  }

  // Put backed-up results into an EMPTY annotation (the user clicked Restore). One undo step.
  function restore({ taskId, results }) {
    const a = ann();
    guardWritable(a);
    if (!window.Htx.task || window.Htx.task.id !== taskId) throw new Error("A different task is open now.");
    if (a.serializeAnnotation().length) throw new Error("This annotation already has work in it; nothing was restored.");
    const h = a.history;
    if (h && h.freeze) h.freeze("cinnamon-label-restore");
    try {
      a.appendResults(results);
    } finally {
      if (h && h.unfreeze) h.unfreeze("cinnamon-label-restore");
    }
    return { state: readSegments(), count: a.serializeAnnotation().length };
  }

  // Tell the content script when the annotation changes from elsewhere (undo, native UI, ...).
  let lastSig = "";
  setInterval(() => {
    try {
      keepDraftsPaused();
      const a = ann();
      if (!a) return;
      const sig = a.id + "|" + JSON.stringify(a.serializeAnnotation());
      if (sig !== lastSig) {
        lastSig = sig;
        post({ op: "annotationChanged" });
      }
    } catch (_) {}
  }, 300);

  function reply(id, ok, data) {
    post({ id, ok, data });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== ORIGIN) return;
    const m = ev.data;
    if (!m || m.ch !== CH || m.dir !== "toPage") return;
    try {
      switch (m.op) {
        case "state":
          return reply(m.id, true, state());
        case "segments":
          return reply(m.id, true, readSegments());
        case "applyPlan":
          return reply(m.id, true, applyPlan(m.args.plan));
        case "setField":
          return reply(m.id, true, setField(m.args));
        case "select":
          return reply(m.id, true, selectSegment(m.args));
        case "undo":
        case "redo": {
          const a = ann();
          if (a && typeof a[m.op] === "function") a[m.op](); // Label Studio's own history
          return reply(m.id, true, { canUndo: !!(a && a.history && a.history.canUndo), canRedo: !!(a && a.history && a.history.canRedo) });
        }
        case "setTaskField":
          return reply(m.id, true, setTaskField(m.args));
        case "config": {
          const c = window.Htx && window.Htx.config;
          return reply(m.id, true, typeof c === "string" ? c : null);
        }
        case "serialize":
          return reply(m.id, true, serialize());
        case "restore":
          return reply(m.id, true, restore(m.args));
        case "history": {
          const a = ann();
          return reply(m.id, true, { canUndo: !!(a && a.history && a.history.canUndo), canRedo: !!(a && a.history && a.history.canRedo) });
        }
        case "waveformClaim": {
          const h = held.get(m.args.id);
          if (h) h.claimed = true;
          return reply(m.id, true, !!h);
        }
        case "waveformServe": {
          const h = held.get(m.args.id);
          if (h) h.go(m.args.blob || null);
          return reply(m.id, true, !!h);
        }
        case "waveformRelease": {
          const h = held.get(m.args.id);
          if (h) h.go(null);
          return reply(m.id, true, !!h);
        }
        default:
          return reply(m.id, false, "unknown op " + m.op);
      }
    } catch (e) {
      reply(m.id, false, String((e && e.message) || e));
    }
  });
})();

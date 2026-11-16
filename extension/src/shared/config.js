// Reads a Label Studio labeling config (XML) into a form description, so the editor can render any
// project's fields (other countries, dialect lists, added or removed fields) without code changes.
// Pure code: used by the content scripts (globalThis.CLConfig) and the Node tests (require).
//
// form = {
//   objects: { video?, audio? },                 // object tag names
//   segmentLabels: { name, toName, label },      // the Labels tag that marks segments
//   segmentLabelsWhen: [cond],                   // when the segment tools are visible at all
//   task: [item], segment: [item],               // whole-task fields / per-segment fields, in config order
//   links: [{ text, href }],                     // HyperText links (tutorial, guidelines)
// }
// item = { kind: "header" | "text" | "choices" | "textarea" | "unsupported", name?, when: [cond], ... }
// cond = { type: "selected" | "unselected", tag, values: [..] | null }   (all must hold)
(function (root) {
  const C = {};

  // ---------- tiny XML reader (enough for Label Studio configs) ----------
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const decode = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m
    );

  C.parseXml = function parseXml(xml) {
    const rootNode = { tag: "#root", attrs: {}, children: [] };
    const stack = [rootNode];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>/]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) top.children.push({ tag: "#text", text: m[1] });
      else if (m[2]) {
        // closing tag: pop to the matching open tag (tolerates sloppy nesting)
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === m[2]) {
            stack.length = i;
            break;
          }
        }
      } else if (m[3]) {
        const attrs = {};
        const ar = /([\w:.-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
        let a;
        while ((a = ar.exec(m[4] || ""))) attrs[a[1]] = decode(a[3] ?? a[4] ?? a[5] ?? "");
        const node = { tag: m[3], attrs, children: [] };
        top.children.push(node);
        if (!m[5] && !/^(br|hr|img|input|meta|link)$/i.test(m[3])) stack.push(node);
      } else if (m[6] != null && m[6].trim()) top.children.push({ tag: "#text", text: decode(m[6]) });
    }
    return rootNode;
  };

  // ---------- helpers ----------
  const lower = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const truthy = (v) => /^(true|1|yes)$/i.test(String(v || ""));
  const textOf = (n) => (n.tag === "#text" ? n.text : (n.children || []).map(textOf).join(""));
  const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const isHiddenStyle = (style) => /display\s*:\s*none/i.test(style || "");
  const OBJECT_TAGS = new Set(["video", "audio", "audioplus", "image", "text", "hypertext", "paragraphs", "timeseries", "table"]);

  function condition(a) {
    const v = (a.visiblewhen || "").toLowerCase();
    if (v === "choice-selected" || v === "choice-unselected") {
      const values = a.whenchoicevalue != null && a.whenchoicevalue !== "" ? a.whenchoicevalue.split(",").map((s) => s.trim()) : null;
      return [{ type: v === "choice-selected" ? "selected" : "unselected", tag: a.whentagname, values }];
    }
    if (v === "region-selected") return [{ type: "region" }];
    if (v === "no-region-selected") return [{ type: "noregion" }];
    return [];
  }

  function links(html) {
    const out = [];
    const re = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html || ""))) out.push({ href: m[2] ?? m[3], text: stripHtml(m[4]) || m[2] || m[3] });
    return out;
  }

  // ---------- form ----------
  C.buildForm = function buildForm(xmlOrTree) {
    const tree = typeof xmlOrTree === "string" ? C.parseXml(xmlOrTree) : xmlOrTree;
    const form = { objects: {}, segmentLabels: null, segmentLabelsWhen: [], segmentHelp: [], task: [], segment: [], links: [] };
    const objectTypes = {}; // name -> lowercase tag

    // Pass 1: object tags (to know which Labels tag marks segments on audio).
    (function scan(n) {
      for (const c of n.children || []) {
        if (c.tag === "#text") continue;
        const a = lower(c.attrs);
        const t = c.tag.toLowerCase();
        if (OBJECT_TAGS.has(t) && a.name && t !== "text" && t !== "hypertext") {
          objectTypes[a.name] = t;
          if (!form.objects[t]) form.objects[t] = a.name;
        }
        scan(c);
      }
    })(tree);

    // Pass 2: controls, in document order, with inherited visibility.
    const walk = (n, when, inRegionView) => {
      for (const c of n.children || []) {
        if (c.tag === "#text") continue;
        const a = lower(c.attrs);
        const t = c.tag.toLowerCase();
        if (isHiddenStyle(a.style)) continue; // hidden on purpose (legacy fields)
        const w = when.concat(condition(a));
        const regionView = inRegionView || w.some((x) => x.type === "region");
        if (t === "view") {
          walk(c, w, regionView);
          continue;
        }
        const perRegion = truthy(a.perregion);
        const scope = perRegion || regionView ? form.segment : form.task;
        const cleanWhen = w.filter((x) => x.type !== "region");

        if (t === "labels") {
          const target = objectTypes[a.toname];
          if (!form.segmentLabels && (target === "audio" || target === "audioplus")) {
            const first = (c.children || []).find((x) => x.tag && x.tag.toLowerCase() === "label");
            const la = first ? lower(first.attrs) : {};
            form.segmentLabels = { name: a.name, toName: a.toname, label: la.alias || la.value || null };
            form.segmentLabelsWhen = cleanWhen;
            // Help text placed next to the segment labels is about making segments: show it there.
            for (let i = form.task.length - 1; i >= 0; i--) {
              const it = form.task[i];
              if (it.kind === "text" && it._parent === n) form.segmentHelp.unshift(...form.task.splice(i, 1).map((x) => x.text));
            }
          }
          continue;
        }
        if (t === "header") {
          const text = a.value || textOf(c).trim();
          if (text) scope.push({ kind: "header", text, when: cleanWhen });
          continue;
        }
        if ((t === "text" || t === "hypertext") && !a.toname) {
          // Static text in the config (not a task object): headings, help, links.
          const raw = a.value || textOf(c);
          if (!raw || /^\$/.test(raw)) continue;
          const l = links(raw);
          if (l.length && !perRegion && !regionView && !cleanWhen.length) {
            form.links.push(...l);
            continue;
          }
          const text = stripHtml(raw);
          if (text) scope.push({ kind: "text", name: a.name || null, text, when: cleanWhen, _parent: n });
          continue;
        }
        if (OBJECT_TAGS.has(t)) continue; // video/audio themselves
        if (t === "choices") {
          const options = (c.children || [])
            .filter((x) => x.tag && x.tag.toLowerCase() === "choice")
            .map((x) => {
              const ca = lower(x.attrs);
              return { value: ca.alias || ca.value, label: ca.value, hint: ca.hint || null };
            })
            .filter((o) => o.value != null);
          const choice = (a.choice || "single").toLowerCase();
          scope.push({ kind: "choices", name: a.name, toName: a.toname, perRegion, multiple: choice === "multiple", options, when: cleanWhen, required: truthy(a.required) });
          continue;
        }
        if (t === "textarea") {
          const style = a.style || "";
          scope.push({
            kind: "textarea",
            name: a.name,
            toName: a.toname,
            perRegion,
            rows: Number(a.rows) || 1,
            placeholder: a.placeholder || "",
            dir: /direction\s*:\s*rtl/i.test(style) ? "rtl" : "auto",
            when: cleanWhen,
            required: truthy(a.required),
          });
          continue;
        }
        if (a.name && (a.toname || perRegion)) scope.push({ kind: "unsupported", name: a.name, tag: c.tag, perRegion, when: cleanWhen });
        walk(c, w, regionView);
      }
    };
    walk(tree, [], false);
    return form;
  };

  // values: { [controlName]: string[] | string | undefined }
  const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  C.isVisible = function isVisible(item, values) {
    return (item.when || []).every((c) => {
      if (c.type === "noregion") return false;
      if (c.type !== "selected" && c.type !== "unselected") return true;
      const sel = asList(values[c.tag]);
      const hit = c.values ? c.values.some((v) => sel.includes(v)) : sel.length > 0;
      return c.type === "selected" ? hit : !hit;
    });
  };

  // Which visible fields still need an answer. Rule of thumb, matching this project's own Submit check:
  // a visible single choice or text needs an answer; multiple-choice (checkbox) fields are optional.
  // RULES lists the exceptions by field-name pattern.
  C.RULES = {
    requiredMultiple: [/(^|_)skip_reason$/], // a skip needs a reason
    optionalText: [/_other$/], // "other" free text next to a choice is optional...
    requiredText: [/skip_reason_other$/], // ...except the "other" skip reason
  };
  C.isRequired = function isRequired(item) {
    if (item.required) return true;
    const n = item.name || "";
    if (item.kind === "choices") return item.multiple ? C.RULES.requiredMultiple.some((r) => r.test(n)) : true;
    if (item.kind === "textarea") return C.RULES.requiredText.some((r) => r.test(n)) || !C.RULES.optionalText.some((r) => r.test(n));
    return false;
  };
  C.isAnswered = function isAnswered(item, values) {
    const v = asList(values[item.name]).filter((x) => x != null && String(x).trim() !== "");
    return v.length > 0;
  };

  // Label for an item: the nearest header above it, else a readable version of its name.
  C.labelFor = function labelFor(items, item) {
    const i = items.indexOf(item);
    for (let j = i - 1; j >= 0; j--) {
      if (items[j].kind === "header") return items[j].text;
      if (items[j].kind === "choices" || items[j].kind === "textarea") break;
    }
    return String(item.name || "")
      .replace(/^segment_/, "")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  };

  C.missing = function missing(items, values) {
    return items.filter((it) => (it.kind === "choices" || it.kind === "textarea") && C.isVisible(it, values) && C.isRequired(it) && !C.isAnswered(it, values)).map((it) => C.labelFor(items, it));
  };

  if (typeof module !== "undefined" && module.exports) module.exports = C;
  else root.CLConfig = C;
})(globalThis);

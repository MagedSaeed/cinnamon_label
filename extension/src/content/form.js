// Renders a form described by shared/config.js (whole-task or per-segment fields) and reports
// answers back through onChange. The DOM is built once per form key (task, or a segment id) and then
// only updated, so a field being typed in is never replaced under the cursor.
(() => {
  const CL = globalThis.CL;
  const CFG = globalThis.CLConfig;

  CL.FORM_CSS = `
.form{display:flex; flex-direction:column; gap:4px}
.form .fh{margin:12px 0 4px; font-size:13px; font-weight:650; color:var(--ink); display:flex; align-items:center; gap:6px}
.form .fh:first-child{margin-top:0}
.form .fh.need::after{content:""; width:6px; height:6px; border-radius:50%; background:var(--cinnamon)}
.form .ft{margin:2px 0 6px; font-size:12.5px; color:var(--muted); max-width:70ch}
.chips{display:flex; flex-wrap:wrap; gap:6px; margin:2px 0 6px}
.chip{padding:5px 11px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font-size:13px; line-height:1.3}
.chip:hover{border-color:#c9ced6}
.chip[aria-checked="true"], .chip[aria-pressed="true"]{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.chips.need .chip{border-color:#e2c3b0}
.fi{width:100%; padding:6px 9px; font:inherit; font-size:14px; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:6px; resize:vertical}
.fi:focus, .tx:focus{outline:none; border-color:var(--cinnamon); box-shadow:0 0 0 3px var(--cinnamon-soft)}
.fi.need{border-color:#e2c3b0}
.txwrap{display:flex; flex-direction:column; gap:6px; margin:2px 0 6px}
.tx{width:100%; min-height:132px; padding:12px 14px; resize:vertical; color:var(--ink); background:var(--panel);
  border:1px solid var(--line); border-radius:8px; font-size:22px; line-height:1.85;
  font-family:"Noto Naskh Arabic","Amiri","Scheherazade New","Noto Sans Arabic","Segoe UI","Arial",serif}
.tx.need{border-color:#e2c3b0}
.txbar{display:flex; gap:8px; align-items:center}
.txbar .sp{flex:1}
.txbar .count{color:var(--faint); font-size:12px; font-variant-numeric:tabular-nums}
.unsup{margin:2px 0 6px; padding:6px 9px; border-radius:6px; background:var(--surface); color:var(--muted); font-size:12.5px}
`;

  const isBig = (it) => it.kind === "textarea" && (it.rows >= 3 || (it.dir === "rtl" && it.rows >= 2));
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const textValue = (v) => list(v).join("");

  CL.FormView = class FormView {
    // items: from CLConfig.buildForm; onChange(name, value, { text }); extras: { onReplay, onNext } for the transcript bar
    constructor(container, { items, onChange, extras = {} }) {
      this.el = container;
      this.items = items;
      this.onChange = onChange;
      this.extras = extras;
      this.key = null;
      this.nodes = [];
      this.readOnly = false;
    }

    // key: what this form is for (e.g. a segment id). values: { name: answer } incl. whole-task answers.
    render(key, values, { readOnly = false } = {}) {
      if (key !== this.key || readOnly !== this.readOnly) this._build(key, readOnly);
      this.values = values;
      for (const n of this.nodes) n.update(values);
    }

    // The first visible text field (for focusing the transcript).
    firstBigText() {
      const n = this.nodes.find((x) => x.big && !x.root.hidden);
      return n ? n.input : null;
    }

    _build(key, readOnly) {
      this.key = key;
      this.readOnly = readOnly;
      this.el.textContent = "";
      const form = document.createElement("div");
      form.className = "form";
      this.el.appendChild(form);
      this.nodes = this.items.map((it) => this._node(it, readOnly));
      for (const n of this.nodes) form.appendChild(n.root);
    }

    _node(it, ro) {
      const items = this.items;
      const vis = (values) => CFG.isVisible(it, values);
      const need = (values) => vis(values) && CFG.isRequired(it) && !CFG.isAnswered(it, values);

      if (it.kind === "header" || it.kind === "text") {
        const root = document.createElement(it.kind === "header" ? "h4" : "p");
        root.className = it.kind === "header" ? "fh" : "ft";
        root.textContent = it.text;
        // A header gets a dot while the field right below it still needs an answer.
        const next = it.kind === "header" ? items.slice(items.indexOf(it) + 1).find((x) => x.kind !== "text") : null;
        const field = next && (next.kind === "choices" || next.kind === "textarea") ? next : null;
        return {
          root,
          update: (values) => {
            root.hidden = !vis(values);
            if (field) root.classList.toggle("need", CFG.isVisible(field, values) && CFG.isRequired(field) && !CFG.isAnswered(field, values));
          },
        };
      }

      if (it.kind === "choices") {
        const root = document.createElement("div");
        root.className = "chips";
        root.setAttribute("role", it.multiple ? "group" : "radiogroup");
        root.setAttribute("aria-label", CFG.labelFor(items, it));
        const buttons = it.options.map((o) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.textContent = o.label;
          if (o.hint) b.title = o.hint;
          if (!it.multiple) b.setAttribute("role", "radio");
          b.disabled = ro;
          CL.on(b, "click", () => {
            const cur = list(this.values && this.values[it.name]);
            let next;
            if (it.multiple) next = cur.includes(o.value) ? cur.filter((v) => v !== o.value) : cur.concat(o.value);
            else next = cur.includes(o.value) ? [] : [o.value]; // clicking the chosen one clears it
            this.onChange(it.name, next, { text: false });
          });
          root.appendChild(b);
          return [o, b];
        });
        return {
          root,
          update: (values) => {
            root.hidden = !vis(values);
            const cur = list(values[it.name]);
            for (const [o, b] of buttons) b.setAttribute(it.multiple ? "aria-pressed" : "aria-checked", String(cur.includes(o.value)));
            root.classList.toggle("need", need(values));
          },
        };
      }

      if (it.kind === "textarea") {
        const big = isBig(it);
        const root = document.createElement("div");
        root.className = big ? "txwrap" : "";
        const input = document.createElement(big || it.rows > 1 ? "textarea" : "input");
        input.className = big ? "tx" : "fi";
        if (!big && it.rows > 1) input.rows = it.rows;
        input.dir = it.dir;
        if (it.dir === "rtl") input.lang = "ar";
        input.placeholder = it.placeholder || "";
        input.spellcheck = false;
        input.setAttribute("aria-label", CFG.labelFor(items, it));
        input.readOnly = ro;
        CL.on(input, "input", () => this.onChange(it.name, input.value, { text: true }));
        CL.on(input, "blur", () => this.extras.onBlur && this.extras.onBlur());
        CL.onFieldKey(input, () => {}); // typed keys stay in the field (never reach Label Studio)
        root.appendChild(input);
        let count = null;
        if (big) {
          const bar = document.createElement("div");
          bar.className = "txbar";
          const replay = document.createElement("button");
          replay.type = "button";
          replay.className = "btn";
          replay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>Replay segment`;
          CL.on(replay, "click", () => this.extras.onReplay && this.extras.onReplay());
          const next = document.createElement("button");
          next.type = "button";
          next.className = "btn";
          next.innerHTML = `Next segment<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
          CL.on(next, "click", () => this.extras.onNext && this.extras.onNext());
          const sp = document.createElement("span");
          sp.className = "sp";
          count = document.createElement("span");
          count.className = "count";
          bar.append(replay, next, sp, count);
          root.appendChild(bar);
        }
        return {
          root,
          big,
          input,
          update: (values) => {
            root.hidden = !vis(values);
            const v = textValue(values[it.name]);
            const doc = input.getRootNode();
            if (doc.activeElement !== input && input.value !== v) input.value = v; // never under the cursor
            input.classList.toggle("need", need(values));
            if (count) {
              const words = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
              count.textContent = words ? `${words} word${words === 1 ? "" : "s"}` : "";
            }
          },
        };
      }

      const root = document.createElement("p");
      root.className = "unsup";
      root.textContent = `“${it.name}” (${it.tag}) can be edited in the native UI.`;
      return { root, update: (values) => (root.hidden = !vis(values)) };
    }
  };
})();

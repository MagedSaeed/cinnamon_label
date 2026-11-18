// Renders a form described by shared/config.js, arranged by CLConfig.layout():
//  - questions as aligned rows (label column | answers), headers become the labels;
//  - follow-up questions indented under the answer that reveals them;
//  - help text tucked behind an "i" next to its question;
//  - single on/off options as switches; the large text field (transcript) as its own card.
// The DOM is built once per form key (task, or a segment id) and then only updated, so a field
// being typed in is never replaced under the cursor.
(() => {
  const CL = globalThis.CL;
  const CFG = globalThis.CLConfig;

  CL.FORM_CSS = `
.rows{display:flex; flex-direction:column}
/* a group = a top-level question with its follow-ups; rules only between groups */
.grp{display:flex; flex-direction:column; padding:6px 0; border-top:1px solid var(--line)}
.grp:first-child{border-top:0; padding-top:0}
.grp > .q, .grp > .tg{border-top:0; padding:5px 0}
.grp > .tcard{margin:6px 0 2px}
.q{display:grid; grid-template-columns:minmax(130px,180px) 1fr; column-gap:14px; align-items:start; padding:9px 0; border-top:1px solid var(--line)}
.rows > .q:first-child, .rows > .tg:first-child{border-top:0; padding-top:2px}
/* Follow-up questions sit at the same level as the others, each separated by a hairline; they
   simply appear right after the question whose answer reveals them. */
.grp > .q + .q, .grp > .q + .tg, .grp > .tg + .q, .grp > .tg + .tg{border-top:1px solid var(--line); padding-top:9px}
.grp > [hidden] + .q, .grp > [hidden] + .tg{border-top:1px solid var(--line)}
.lab{display:flex; align-items:center; gap:6px; min-height:28px; font-size:13px; font-weight:600; color:var(--ink); line-height:1.3}
.lab .dot{width:6px; height:6px; border-radius:50%; background:var(--cinnamon); flex:none; visibility:hidden}
.need > .lab .dot, .tcard.need .dot{visibility:visible}
.info{width:17px; height:17px; padding:0; display:inline-grid; place-items:center; border:1px solid currentColor; border-radius:50%; background:none;
  color:var(--faint); font:italic 600 10px/1 Georgia,"Times New Roman",serif; flex:none}
.info:hover, .info[aria-expanded="true"]{color:var(--cinnamon)}
.ctl{min-width:0}
.help{margin:0; padding:8px 10px; border-radius:6px; background:var(--surface); color:var(--muted); font-size:12.5px; line-height:1.5}
/* notes: help texts from the config, always visible, at the end of the form */
.notes{display:flex; flex-direction:column; gap:8px; margin-top:12px}
.notes h5{margin:0; font-size:13px; font-weight:650; color:var(--ink)}
.notes .help{padding:10px 14px; border-left:4px solid var(--cinnamon); border-radius:0 8px 8px 0; color:var(--ink); background:#fbf3ee;
  font-size:14px; line-height:1.65; transition:background .3s}
.notes .help.flash{background:#f3dccd}
.chips{display:flex; flex-wrap:wrap; gap:6px}
.chip{padding:4px 11px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font-size:13px; line-height:1.35}
.chip:hover:not(:disabled){border-color:#c9ced6}
.chip[aria-checked="true"], .chip[aria-pressed="true"]{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.fi{width:100%; padding:5px 9px; font:inherit; font-size:14px; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:6px; resize:vertical}
.fi:focus, .tx:focus{outline:none; border-color:var(--cinnamon); box-shadow:0 0 0 3px var(--cinnamon-soft)}
/* switch rows */
.tg{display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid var(--line)}
.sw{position:relative; width:32px; height:18px; flex:none; border:0; padding:0; border-radius:999px; background:#d5d9e0; transition:background .15s}
.sw::after{content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.25); transition:transform .15s}
.sw[aria-checked="true"]{background:var(--cinnamon)}
.sw[aria-checked="true"]::after{transform:translateX(14px)}
.tg .tl{font-size:13px; font-weight:600; color:var(--ink); cursor:pointer}
/* transcript card */
.tcard{margin:10px 0 4px; padding:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel)}
.thead{display:flex; align-items:center; gap:8px; margin-bottom:8px}
.thead .lab{min-height:0}
.thead .count{margin-left:auto; color:var(--faint); font-size:12px; font-weight:400; font-variant-numeric:tabular-nums}
.tx{display:block; width:100%; min-height:128px; padding:10px 12px; resize:vertical; color:var(--ink); background:#fff;
  border:1px solid var(--line); border-radius:8px; font-size:22px; line-height:1.85;
  font-family:"Noto Naskh Arabic","Amiri","Scheherazade New","Noto Sans Arabic","Segoe UI","Arial",serif}
.tbar{display:flex; align-items:center; gap:8px; margin-top:8px}
.withnext{display:flex; align-items:flex-start; gap:10px}
.withnext > .chips{flex:1 1 auto; min-width:0}
.nextbtn{margin-left:auto; flex:none}
.tbar:empty{display:none}
/* Loop: a round button in a rail under the card's play and Replay buttons, in the same column */
.hasrail{display:grid; grid-template-columns:34px minmax(0,1fr); column-gap:14px}
.hasrail > :not(.rail){grid-column:2}
.rail{grid-column:1; grid-row:1 / span 9; align-self:stretch; margin:-12px 0 -14px -14px; padding:6px 4px 0 8px; display:flex; flex-direction:column;
  align-items:center; gap:8px; border-right:1px solid #e9ecf0}
.rb{display:grid; place-items:center; width:26px; height:26px; padding:0; border-radius:50%; border:1px solid var(--line); background:var(--panel); color:var(--muted); flex:none}
.rb svg{width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.rb:hover{border-color:var(--cinnamon); color:var(--cinnamon)}
.rb[aria-pressed="true"]{background:var(--cinnamon); border-color:var(--cinnamon); color:#fff}
.unsup{color:var(--muted); font-size:12.5px; padding-top:5px}
@media (prefers-reduced-motion:reduce){.sw, .sw::after{transition:none}}
`;

  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const textValue = (v) => list(v).join("");
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  CL.FormView = class FormView {
    // items: from CLConfig.buildForm; onChange(name, value, { text }); extras: { loop, onNext, onBlur }
    constructor(container, { items, onChange, extras = {} }) {
      this.el = container;
      this.items = items;
      this.rows = CFG.layout(items);
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

    // The visible transcript field (for focusing).
    firstBigText() {
      const n = this.nodes.find((x) => x.big && !x.root.hidden);
      return n ? n.input : null;
    }

    _build(key, readOnly) {
      this.key = key;
      this.readOnly = readOnly;
      this.el.textContent = "";
      const wrap = el("div", "rows");
      this.el.appendChild(wrap);
      // Help texts are shown at the end, always visible while their question is.
      const notes = el("section", "notes");
      notes.append(el("h5", null, "Notes"));
      this._notes = notes;
      this.nodes = this.rows.map((r) => this._row(r, readOnly));
      // Group each top-level row with the follow-ups below it.
      // The transcript card is a group of its own; a group that starts with a follow-up question
      // shows it un-indented (its parent is in an earlier group) and indents relative to it.
      const groups = [];
      let grp = null;
      let base = 0;
      let afterCard = false;
      this.nodes.forEach((n, i) => {
        const r = this.rows[i];
        const depth = r.depth || 0;
        if (!grp || afterCard || depth === 0 || r.type === "transcript") {
          grp = el("div", "grp");
          wrap.appendChild(grp);
          groups.push(grp);
          base = depth;
        }
        afterCard = r.type === "transcript";
        const rel = depth - base;
        n.root.classList.toggle("nested", rel > 0);
        if (rel > 0) n.root.style.setProperty("--d", String(rel - 1));
        else n.root.style.removeProperty("--d");
        grp.appendChild(n.root);
      });
      // Loop sits in a rail under the card's play and Replay buttons (same column), whether or
      // not the transcript is showing yet (so you can listen before choosing gender and dialect).
      const tc = this.nodes.find((n) => n.rctl);
      this.el.classList.toggle("hasrail", !!tc);
      if (tc) {
        const rail = el("div", "rail");
        rail.append(...tc.rctl.childNodes);
        this.el.prepend(rail);
      }
      this.nodes.push({ root: wrap, update: () => groups.forEach((g) => (g.hidden = [...g.children].every((c) => c.hidden))) });
      // "Next segment" sits at the right of the last visible question, so it comes after every
      // answer (or in the transcript card's bar if nothing follows the transcript).
      if (this.extras.onNext) {
        const next = el("button", "btn nextbtn");
        next.type = "button";
        next.innerHTML = `Next segment<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
        CL.on(next, "click", () => this.extras.onNext && this.extras.onNext());
        this.nodes.push({
          root: next,
          update: () => {
            const rows = [...wrap.querySelectorAll(".q, .tg, .tcard")].filter((r) => !r.hidden && !r.closest("[hidden]"));
            const last = rows[rows.length - 1];
            const slot = !last ? wrap : last.classList.contains("tcard") ? last.querySelector(".tbar") || last : last.querySelector(".ctl") || last;
            if (next.parentElement !== slot) slot.appendChild(next);
            wrap.querySelectorAll(".withnext").forEach((x) => x !== slot && x.classList.remove("withnext"));
            slot.classList.add("withnext");
          },
        });
      }
      if (notes.children.length > 1) {
        this.el.appendChild(notes);
        this.nodes.push({ root: notes, update: () => (notes.hidden = ![...notes.querySelectorAll(".help")].some((h) => !h.hidden)) });
      }
    }

    _set(name, value, text) {
      this.onChange(name, value, { text });
    }

    _row(row, ro) {
      const node = this._rowInner(row, ro);
      if (row._help) {
        const upd = node.update;
        node.update = (values) => {
          upd(values);
          row._help.hidden = node.root.hidden;
        };
      }
      return node;
    }

    _rowInner(row, ro) {
      const it = row.item;
      const vis = (values) => CFG.isVisible(it || row, values);
      const need = (values) => !!it && vis(values) && CFG.isRequired(it) && !CFG.isAnswered(it, values);

      if (row.type === "title" || row.type === "note") {
        const root = el("p", row.type === "title" ? "lab" : "help", row.text);
        if (row.type === "note") root.style.gridColumn = "auto";
        return { root, update: (values) => (root.hidden = !vis(values)) };
      }

      // Label with required dot and optional help toggle.
      const makeLabel = (cls = "lab") => {
        const lab = el("div", cls);
        lab.append(el("span", null, row.label));
        lab.append(el("span", "dot"));
        lab.lastChild.title = "Needs an answer";
        return lab;
      };
      // The help text goes to the Notes block (always visible while the question is); the "i" next to
      // the question jumps to it.
      const addHelp = (root, lab) => {
        if (!row.help.length) return;
        const help = el("p", "help", row.help.join(" "));
        this._notes.append(help);
        this._helpFor = this._helpFor || [];
        this._helpFor.push([help, row]);
        const btn = el("button", "info", "i");
        btn.type = "button";
        btn.title = "See the note below";
        btn.setAttribute("aria-label", `Note about ${row.label}`);
        CL.on(btn, "click", () => {
          help.scrollIntoView({ block: "nearest", behavior: "smooth" });
          help.classList.add("flash");
          setTimeout(() => help.classList.remove("flash"), 1200);
        });
        lab.append(btn);
        row._help = help;
      };
      const nest = (root) => {
        if (row.depth > 0) {
          root.classList.add("nested");
          root.style.setProperty("--d", String(row.depth - 1));
        }
      };

      if (row.type === "toggle") {
        const root = el("div", "tg");
        nest(root);
        const sw = el("button", "sw");
        sw.type = "button";
        sw.setAttribute("role", "switch");
        sw.setAttribute("aria-label", row.label);
        sw.disabled = ro;
        const value = it.options[0].value;
        const flip = () => {
          if (ro) return;
          const on = list(this.values && this.values[it.name]).includes(value);
          this._set(it.name, on ? [] : [value], false);
        };
        CL.on(sw, "click", flip);
        const tl = el("span", "tl", row.label);
        CL.on(tl, "click", flip);
        root.append(sw, tl);
        if (row.help.length) addHelp(root, root);
        return {
          root,
          update: (values) => {
            root.hidden = !vis(values);
            sw.setAttribute("aria-checked", String(list(values[it.name]).includes(value)));
          },
        };
      }

      if (row.type === "transcript") {
        const root = el("section", "tcard");
        const head = el("div", "thead");
        const lab = makeLabel();
        head.append(lab);
        const count = el("span", "count");
        head.append(count);
        root.append(head);
        addHelp(root, lab);
        const input = el("textarea", "tx");
        input.dir = it.dir;
        if (it.dir === "rtl") input.lang = "ar";
        input.placeholder = it.placeholder || "";
        input.spellcheck = false;
        input.setAttribute("aria-label", row.label);
        input.readOnly = ro;
        CL.on(input, "input", () => this._set(it.name, input.value, true));
        CL.on(input, "blur", () => this.extras.onBlur && this.extras.onBlur());
        CL.onFieldKey(input, () => {}); // typed keys stay in the field (never reach Label Studio)
        root.append(input);
        const bar = el("div", "tbar"); // holds Next segment when nothing follows the transcript
        root.append(bar);
        const rctl = el("span"); // Loop; _build moves it to the rail under the card's Replay button
        if (this.extras.loop) {
          // Loop: on, Replay keeps repeating the segment until paused; off, it plays once.
          const lp = this.extras.loop;
          const sw = el("button", "rb");
          sw.type = "button";
          sw.setAttribute("aria-label", "Loop");
          const paint = (on) => {
            sw.setAttribute("aria-pressed", String(on));
            sw.title = on ? "Loop is on: Replay repeats the segment until you pause. Click to turn off." : "Loop is off: Replay plays the segment once. Click to loop it.";
          };
          paint(!!lp.get());
          sw.innerHTML = `<svg viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
          CL.on(sw, "click", () => {
            const on = sw.getAttribute("aria-pressed") !== "true";
            paint(on);
            lp.set(on);
          });
          rctl.append(sw);
        }
        return {
          root,
          big: true,
          input,
          rctl: rctl.children.length ? rctl : null,
          update: (values) => {
            root.hidden = !vis(values);
            const v = textValue(values[it.name]);
            if (input.getRootNode().activeElement !== input && input.value !== v) input.value = v; // never under the cursor
            root.classList.toggle("need", need(values));
            const words = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
            count.textContent = words ? `${words} word${words === 1 ? "" : "s"}` : "";
          },
        };
      }

      // question row: choices, a small text, or an unsupported field
      const root = el("div", "q");
      nest(root);
      const lab = makeLabel();
      const ctl = el("div", "ctl");
      root.append(lab, ctl);
      addHelp(root, lab);

      if (it.kind === "choices") {
        const chips = el("div", "chips");
        chips.setAttribute("role", it.multiple ? "group" : "radiogroup");
        chips.setAttribute("aria-label", row.label);
        const buttons = it.options.map((o) => {
          const b = el("button", "chip", o.label);
          b.type = "button";
          if (o.hint) b.title = o.hint;
          if (!it.multiple) b.setAttribute("role", "radio");
          b.disabled = ro;
          CL.on(b, "click", () => {
            const cur = list(this.values && this.values[it.name]);
            let next;
            if (it.multiple) next = cur.includes(o.value) ? cur.filter((v) => v !== o.value) : cur.concat(o.value);
            else next = cur.includes(o.value) ? [] : [o.value]; // clicking the chosen one clears it
            this._set(it.name, next, false);
          });
          chips.appendChild(b);
          return [o, b];
        });
        ctl.append(chips);
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
        const input = el(it.rows > 1 ? "textarea" : "input", "fi");
        if (it.rows > 1) input.rows = it.rows;
        input.dir = it.dir;
        if (it.dir === "rtl") input.lang = "ar";
        input.placeholder = it.placeholder || "";
        input.spellcheck = false;
        input.setAttribute("aria-label", row.label);
        input.readOnly = ro;
        CL.on(input, "input", () => this._set(it.name, input.value, true));
        CL.on(input, "blur", () => this.extras.onBlur && this.extras.onBlur());
        CL.onFieldKey(input, () => {});
        ctl.append(input);
        return {
          root,
          update: (values) => {
            root.hidden = !vis(values);
            const v = textValue(values[it.name]);
            if (input.getRootNode().activeElement !== input && input.value !== v) input.value = v;
            root.classList.toggle("need", need(values));
          },
        };
      }

      ctl.append(el("div", "unsup", `Edit “${it.name}” (${it.tag}) in the native UI.`));
      return { root, update: (values) => (root.hidden = !vis(values)) };
    }
  };
})();

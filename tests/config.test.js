// Run with: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../extension/src/shared/config.js");

const form = C.buildForm(fs.readFileSync(path.join(__dirname, "fixtures", "config-cinnamon.xml"), "utf8"));
const names = (items) => items.filter((i) => i.name && i.kind !== "text").map((i) => i.name);

test("splits whole-video and per-segment fields; skips hidden legacy fields", () => {
  assert.deepEqual(form.objects, { video: "video", audio: "audio" });
  assert.deepEqual(form.segmentLabels, { name: "speaker_segments", toName: "audio", label: "Speaker segment" });
  assert.deepEqual(names(form.task), ["video_skip_toggle", "skip_reason", "skip_reason_other"]);
  assert.ok(names(form.segment).includes("segment_transcription"));
  assert.ok(!names(form.segment).includes("transcription") && !names(form.task).includes("gender"), "display:none fields are skipped");
  assert.deepEqual(form.links.map((l) => l.href), ["https://example.test/tutorial", "https://example.test/guidelines"]);
  assert.equal(form.links[0].text, "🎥 Video Tutorial");
  assert.deepEqual(form.segmentHelp, ["Select one or more speaker segments."], "help next to the segment labels");
  assert.ok(!form.task.some((i) => i.kind === "text"), "...and not in the whole-video block");
});

test("reads options, direction and headers", () => {
  const md = form.segment.find((i) => i.name === "segment_micro_dialect");
  assert.deepEqual(md.options.map((o) => o.value), ["Adeni", "Tazzi", "White dialect (اللهجة البيضاء)"]);
  assert.equal(md.multiple, false);
  const tr = form.segment.find((i) => i.name === "segment_transcription");
  assert.equal(tr.dir, "rtl");
  assert.equal(tr.rows, 4);
  assert.equal(C.labelFor(form.segment, tr), "Transcription");
  assert.equal(C.labelFor(form.segment, form.segment.find((i) => i.name === "segment_gender")), "Speaker Gender");
});

test("segment tools are hidden when the whole video is skipped", () => {
  assert.equal(C.isVisible({ when: form.segmentLabelsWhen }, {}), true);
  assert.equal(C.isVisible({ when: form.segmentLabelsWhen }, { video_skip_toggle: ["Skip entire video"] }), false);
});

// The project's own Submit check (annotator-ui.js missingFields), case by case.
test("missing fields match the project's Submit check", () => {
  const miss = (v) => C.missing(form.segment, v);
  assert.deepEqual(miss({}), ["Speaker Gender", "Dialect Validation"]);
  assert.deepEqual(miss({ segment_skip_toggle: ["Skip this segment"] }), ["Skip reason"]);
  assert.deepEqual(miss({ segment_skip_toggle: ["Skip this segment"], segment_skip_reason: ["Other"] }), ["Skip reason other"]);
  assert.deepEqual(miss({ segment_skip_toggle: ["Skip this segment"], segment_skip_reason: ["Has noise"] }), []);
  assert.deepEqual(miss({ segment_gender: ["Male"], segment_country: ["MSA (Skip)"] }), []);
  assert.deepEqual(miss({ segment_gender: ["Male"], segment_country: ["Yemen"] }), ["Micro-dialect", "Transcription", "Code switching"]);
  const done = { segment_gender: ["Male"], segment_country: ["Yemen"], segment_micro_dialect: ["Tazzi"], segment_transcription: ["نص"], segment_has_code_switch: ["No"] };
  assert.deepEqual(miss(done), [], "alternatives (checkboxes) are optional");
  assert.deepEqual(miss({ ...done, segment_has_code_switch: ["Yes"] }), ["Code switch language", "Code switch phrase"]);
  assert.deepEqual(miss({ ...done, segment_has_code_switch: ["Yes"], segment_code_switch_language: ["Other"], segment_code_switch_phrase: ["hello"] }), [], "the 'other language' text is optional");
  assert.deepEqual(miss({ ...done, segment_transcription: ["   "] }), ["Transcription"], "blank text doesn't count");
});

test("visibility handles selected/unselected and value lists", () => {
  const item = { when: [{ type: "selected", tag: "x", values: ["a", "b"] }] };
  assert.equal(C.isVisible(item, { x: ["b"] }), true);
  assert.equal(C.isVisible(item, { x: ["c"] }), false);
  assert.equal(C.isVisible({ when: [{ type: "unselected", tag: "x", values: null }] }, { x: [] }), true);
  assert.equal(C.isVisible({ when: [{ type: "unselected", tag: "x", values: null }] }, { x: ["a"] }), false);
});

test("parseXml decodes entities and tolerates comments", () => {
  const t = C.parseXml('<View><!-- c --><Choice value="A &amp; B" alias=\'x\'/></View>');
  const ch = t.children[0].children[0];
  assert.equal(ch.attrs.value, "A & B");
  assert.equal(ch.attrs.alias, "x");
});

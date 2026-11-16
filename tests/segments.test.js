// Run with: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../extension/src/shared/segments.js");

const D = 100;
const segs = () => [
  { id: "a", start: 10, end: 20 },
  { id: "b", start: 20, end: 30 }, // touches a
  { id: "c", start: 40, end: 50 },
];
const ok = (list) => assert.deepEqual(S.validate(list, D), []);

test("create clips to the gap where the drag started, in either direction", () => {
  const r = S.create(segs(), 35, 45, D); // starts in the gap 30..40
  assert.deepEqual(r.segment, { start: 35, end: 40 });
  const r2 = S.create(segs(), 38, 31, D); // right-to-left drag
  assert.deepEqual(r2.segment, { start: 31, end: 38 });
  assert.equal(S.create(segs(), 15, 18, D), null, "inside a segment: nothing");
  assert.equal(S.create(segs(), 30.02, 30.05, D), null, "too short");
  ok(S.apply(segs(), r.plan));
});

test("moveEdge moves a shared boundary with the neighbour, clamped", () => {
  const p = S.moveEdge(segs(), "a", "end", 25, D);
  const out = S.apply(segs(), p);
  assert.deepEqual(out.map((g) => [g.id, g.start, g.end]), [["a", 10, 25], ["b", 25, 30], ["c", 40, 50]]);
  ok(out);
  // Can't squeeze b below the minimum.
  const p2 = S.moveEdge(segs(), "a", "end", 35, D);
  assert.equal(S.apply(segs(), p2).find((g) => g.id === "b").start, 30 - S.MIN_DUR);
  ok(S.apply(segs(), p2));
  // Detached: stops at the neighbour instead of pushing it.
  const p3 = S.moveEdge(segs(), "a", "end", 25, D, { detach: true });
  assert.deepEqual(p3.update, []);
});

test("moveEdge never crosses a non-touching neighbour or the video bounds", () => {
  ok(S.apply(segs(), S.moveEdge(segs(), "c", "start", 5, D))); // stops at b's end (30)
  assert.equal(S.apply(segs(), S.moveEdge(segs(), "c", "start", 5, D)).find((g) => g.id === "c").start, 30);
  assert.equal(S.apply(segs(), S.moveEdge(segs(), "c", "end", 500, D)).find((g) => g.id === "c").end, D);
  assert.equal(S.apply(segs(), S.moveEdge(segs(), "a", "start", -5, D)).find((g) => g.id === "a").start, 0);
  assert.equal(S.apply(segs(), S.moveEdge(segs(), "c", "end", 0, D)).find((g) => g.id === "c").end, 40 + S.MIN_DUR);
});

test("split, merge, remove, setTimes", () => {
  const sp = S.split(segs(), "c", 44.5);
  ok(S.apply(segs(), sp));
  assert.deepEqual(S.apply(segs(), sp).map((g) => [g.start, g.end]).slice(2), [[40, 44.5], [44.5, 50]]);
  assert.equal(S.split(segs(), "c", 40.05), null, "too close to the edge");

  const m = S.mergeNext(segs(), "a");
  assert.equal(m.removedId, "b");
  assert.deepEqual(S.apply(segs(), m.plan).map((g) => [g.id, g.start, g.end]), [["a", 10, 30], ["c", 40, 50]]);
  assert.equal(S.mergeNext(segs(), "c"), null, "nothing after the last segment");

  assert.deepEqual(S.apply(segs(), S.remove(segs(), "b")).map((g) => g.id), ["a", "c"]);

  const st = S.setTimes(segs(), "c", 25, 60, D); // clamped to [30, 100]
  assert.deepEqual(S.apply(segs(), st).find((g) => g.id === "c"), { id: "c", start: 30, end: 60 });
  assert.equal(S.setTimes(segs(), "c", 45, 45.05, D), null);
});

test("fitInto keeps the largest free part; addMany never overlaps", () => {
  // existing: a 10-20, b 20-30, c 40-50
  assert.deepEqual(S.fitInto(segs(), 32, 38, D), { start: 32, end: 38 }, "fully free");
  assert.deepEqual(S.fitInto(segs(), 25, 45, D), { start: 30, end: 40 }, "trimmed to the gap");
  assert.deepEqual(S.fitInto(segs(), 5, 60, D), { start: 30, end: 40 }, "largest of 5-10, 30-40, 50-60 (a tie keeps the earlier)");
  assert.deepEqual(S.fitInto(segs(), 5, 65, D), { start: 50, end: 65 }, "a strictly larger later part wins");
  assert.equal(S.fitInto(segs(), 12, 18, D), null, "inside a segment");
  assert.equal(S.fitInto(segs(), 29.95, 30.05, D), null, "too small");
  const r = S.addMany(segs(), [{ start: 55, end: 70 }, { start: 32, end: 45 }, { start: 15, end: 18 }, { start: 60, end: 65 }], D);
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 2, "one inside a segment, one inside an earlier suggestion");
  const out = S.apply(segs(), r.plan);
  assert.deepEqual(S.validate(out, D), []);
  assert.deepEqual(out.map((g) => [g.start, g.end]), [[10, 20], [20, 30], [32, 40], [40, 50], [55, 70]]);
});

// Random sequences of operations must never break the invariants.
test("thousands of random edits keep segments valid", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let list = [];
  let n = 0;
  for (let step = 0; step < 5000; step++) {
    const t = rnd() * D;
    const pick = list[Math.floor(rnd() * list.length)];
    const op = Math.floor(rnd() * 6);
    let plan = null;
    if (op === 0) plan = S.create(list, t, t + (rnd() - 0.3) * 20, D)?.plan;
    else if (pick && op === 1) plan = S.moveEdge(list, pick.id, rnd() < 0.5 ? "start" : "end", t, D, { detach: rnd() < 0.3 });
    else if (pick && op === 2) plan = S.split(list, pick.id, pick.start + rnd() * (pick.end - pick.start));
    else if (pick && op === 3) plan = S.mergeNext(list, pick.id)?.plan;
    else if (pick && op === 4) plan = S.remove(list, pick.id);
    else if (pick && op === 5) plan = S.setTimes(list, pick.id, t - 5, t + rnd() * 10, D);
    if (!plan) continue;
    list = S.apply(list, plan, plan.create.map(() => `s${n++}`));
    const errs = S.validate(list, D);
    assert.deepEqual(errs, [], `step ${step}, op ${op}`);
  }
  assert.ok(n > 100, "the test actually created segments");
});

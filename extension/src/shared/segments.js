// Segment editing rules, as pure functions (no DOM, no Label Studio). Every operation takes the
// current segments and returns a plan of changes; it never mutates its input. The plan is then
// applied to Label Studio's annotation, which stays the single source of truth.
//
// Invariants (checked by `validate`, enforced by every operation):
//   - segments are sorted by start and never overlap (touching is fine);
//   - 0 <= start < end <= duration;
//   - every segment is at least MIN_DUR long.
//
// Segment: { id, start, end }. Plan: { create: [{start,end}], update: [{id,start,end}], remove: [id] }.
(function (root) {
  const S = {};
  const MIN_DUR = 0.1; // seconds
  const EPS = 1e-6;
  S.MIN_DUR = MIN_DUR;

  const round = (t) => Math.round(t * 1000) / 1000; // millisecond precision, like Label Studio's UI
  const sorted = (segs) => [...segs].sort((a, b) => a.start - b.start || a.end - b.end);
  const emptyPlan = () => ({ create: [], update: [], remove: [] });

  S.validate = function validate(segs, duration) {
    const s = sorted(segs);
    const errors = [];
    s.forEach((g, i) => {
      if (!(g.start >= -EPS)) errors.push(`${g.id}: starts before 0`);
      if (duration != null && !(g.end <= duration + EPS)) errors.push(`${g.id}: ends after the video`);
      if (!(g.end - g.start >= MIN_DUR - EPS)) errors.push(`${g.id}: shorter than ${MIN_DUR} s`);
      if (i && g.start < s[i - 1].end - EPS) errors.push(`${g.id}: overlaps ${s[i - 1].id}`);
    });
    return errors;
  };

  // Apply a plan to a list (used by tests and to predict the result before Label Studio confirms).
  S.apply = function apply(segs, plan, newIds = []) {
    const removed = new Set(plan.remove);
    const upd = new Map(plan.update.map((u) => [u.id, u]));
    const out = segs.filter((g) => !removed.has(g.id)).map((g) => (upd.has(g.id) ? { ...g, start: upd.get(g.id).start, end: upd.get(g.id).end } : { ...g }));
    plan.create.forEach((c, i) => out.push({ id: newIds[i] || `new${i}`, start: c.start, end: c.end }));
    return sorted(out);
  };

  // The free gap around time t: [lo, hi] (inside the video, between neighbours).
  S.gapAt = function gapAt(segs, t, duration) {
    let lo = 0;
    let hi = duration;
    for (const g of segs) {
      if (g.end <= t + EPS && g.end > lo) lo = g.end;
      if (g.start >= t - EPS && g.start < hi) hi = g.start;
      if (g.start < t - EPS && g.end > t + EPS) return null; // t is inside a segment
    }
    return [lo, hi];
  };

  S.segmentAt = (segs, t) => segs.find((g) => g.start <= t + EPS && g.end >= t - EPS) || null;

  // Create from a drag between a and b (any order). Clipped to the gap where the drag started.
  // Returns { plan, segment } or null if there is no room.
  S.create = function create(segs, a, b, duration) {
    const anchor = Math.max(0, Math.min(duration, a));
    const gap = S.gapAt(segs, anchor, duration);
    if (!gap) return null;
    let start = Math.max(gap[0], Math.min(a, b));
    let end = Math.min(gap[1], Math.max(a, b));
    if (end - start < MIN_DUR) return null;
    start = round(start);
    end = round(end);
    const plan = emptyPlan();
    plan.create.push({ start, end });
    return { plan, segment: { start, end } };
  };

  // Move one edge of segment `id` to time t. Segments are always separate: only this segment
  // changes, and the edge stops at a neighbour's edge instead of pushing it. Clamped so nothing
  // overlaps or gets too short.
  S.moveEdge = function moveEdge(segs, id, edge, t, duration) {
    const s = sorted(segs);
    const i = s.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const g = s[i];
    const plan = emptyPlan();
    if (edge === "start") {
      const prev = s[i - 1];
      const lo = prev ? prev.end : 0;
      const nt = round(Math.max(lo, Math.min(g.end - MIN_DUR, t)));
      if (Math.abs(nt - g.start) < EPS) return plan;
      plan.update.push({ id: g.id, start: nt, end: g.end });
    } else if (edge === "end") {
      const next = s[i + 1];
      const hi = next ? next.start : duration;
      const nt = round(Math.min(hi, Math.max(g.start + MIN_DUR, t)));
      if (Math.abs(nt - g.end) < EPS) return plan;
      plan.update.push({ id: g.id, start: g.start, end: nt });
    } else return null;
    return plan;
  };

  // Set both times at once (the start/end fields). Clamped between the neighbours.
  S.setTimes = function setTimes(segs, id, start, end, duration) {
    const s = sorted(segs);
    const i = s.findIndex((g) => g.id === id);
    if (i < 0 || !(end > start)) return null;
    const lo = i > 0 ? s[i - 1].end : 0;
    const hi = i + 1 < s.length ? s[i + 1].start : duration;
    let ns = round(Math.max(lo, start));
    let ne = round(Math.min(hi, end));
    if (ne - ns < MIN_DUR) return null;
    const plan = emptyPlan();
    if (Math.abs(ns - s[i].start) > EPS || Math.abs(ne - s[i].end) > EPS) plan.update.push({ id, start: ns, end: ne });
    return plan;
  };

  // Slide segment `id` by delta seconds, keeping its length. It stops at its neighbours and at the
  // ends of the video (segments never overlap). Returns null if it cannot move.
  S.shift = function shift(segs, id, delta, duration) {
    const s = sorted(segs);
    const i = s.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const g = s[i];
    const len = g.end - g.start;
    const lo = i > 0 ? s[i - 1].end : 0;
    const hi = i + 1 < s.length ? s[i + 1].start : duration != null ? duration : Infinity;
    if (hi - lo < len - EPS) return null;
    // Round to ms like every edit, but never past a neighbour's edge (which may not be ms-aligned):
    // at a limit, take that edge exactly.
    let ns = round(Math.min(Math.max(g.start + delta, lo), hi - len));
    let ne = round(ns + len);
    if (ns < lo) [ns, ne] = [lo, lo + len];
    if (ne > hi) [ns, ne] = [hi - len, hi];
    if (Math.abs(ns - g.start) < EPS) return null;
    const plan = emptyPlan();
    plan.update.push({ id, start: ns, end: ne });
    return plan;
  };

  // Split at t, leaving a gap of `gap` seconds centred on t: the segment keeps [start, t - gap/2],
  // a new one gets [t + gap/2, end]. Each part must stay at least MIN_DUR long.
  S.split = function split(segs, id, t, gap = 0) {
    const g = segs.find((x) => x.id === id);
    if (!g) return null;
    const h = Math.max(0, gap) / 2;
    const a = round(t - h);
    const b = round(t + h);
    if (a - g.start < MIN_DUR || g.end - b < MIN_DUR) return null;
    const plan = emptyPlan();
    plan.update.push({ id, start: g.start, end: a });
    plan.create.push({ start: b, end: g.end });
    return plan;
  };

  // Merge with the next segment: this one extends to the next one's end; the next is removed.
  S.mergeNext = function mergeNext(segs, id) {
    const s = sorted(segs);
    const i = s.findIndex((g) => g.id === id);
    if (i < 0 || i + 1 >= s.length) return null;
    const plan = emptyPlan();
    plan.update.push({ id, start: s[i].start, end: s[i + 1].end });
    plan.remove.push(s[i + 1].id);
    return { plan, removedId: s[i + 1].id };
  };

  S.remove = function remove(segs, id) {
    if (!segs.some((g) => g.id === id)) return null;
    const plan = emptyPlan();
    plan.remove.push(id);
    return plan;
  };

  S.neighbour = function neighbour(segs, id, dir) {
    const s = sorted(segs);
    const i = s.findIndex((g) => g.id === id);
    if (i < 0) return null;
    return s[i + dir] || null;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = S;
  else root.CLSeg = S;
})(globalThis);

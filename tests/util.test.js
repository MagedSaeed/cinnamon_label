// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../extension/src/shared/util.js");

test("mediaKey: Label Studio's waveform URL and the task URL map to the same key", () => {
  const base = "https://annotation.dlnlp.ai/cinnamon/projects/42/data?tab=19&task=101178";
  const task = "/cinnamon/data/local-files/?d=Yemen/Tazzi/a_b__SEG.mp4";
  const wave = "https://annotation.dlnlp.ai/cinnamon/data/local-files/?d=Yemen%2FTazzi%2Fa_b__SEG.mp4&lsref=1";
  assert.equal(U.mediaKey(task, base), U.mediaKey(wave, base));
  assert.equal(U.mediaKey(task, base), "https://annotation.dlnlp.ai/cinnamon/data/local-files/?d=Yemen/Tazzi/a_b__SEG.mp4");
});

test("mediaKey: other files differ; param order doesn't matter without ?d=", () => {
  const b = "https://x.test/";
  assert.notEqual(U.mediaKey("/f?d=a.mp4", b), U.mediaKey("/f?d=b.mp4", b));
  assert.equal(U.mediaKey("/v.mp4?b=2&a=1", b), U.mediaKey("/v.mp4?a=1&b=2&lsref=1", b));
});

test("parseContentRange", () => {
  assert.deepEqual(U.parseContentRange("bytes 0-0/169888163"), { start: 0, end: 0, total: 169888163 });
  assert.deepEqual(U.parseContentRange("bytes 10-19/*"), { start: 10, end: 19, total: null });
  assert.equal(U.parseContentRange(null), null);
  assert.equal(U.parseContentRange("items 0-1/2"), null);
});

test("planChunks covers every byte exactly once", () => {
  for (const [total, size] of [[1, 4], [4, 4], [5, 4], [169888163, 4 << 20]]) {
    const r = U.planChunks(total, size);
    assert.equal(r[0][0], 0);
    assert.equal(r[r.length - 1][1], total - 1);
    for (let i = 1; i < r.length; i++) assert.equal(r[i][0], r[i - 1][1] + 1);
    assert.ok(r.every(([s, e]) => e - s + 1 <= size));
  }
  assert.deepEqual(U.planChunks(0, 4), []);
});

test("fmtClock / fmtBytes / fmtEta", () => {
  assert.equal(U.fmtClock(0), "0:00.0");
  assert.equal(U.fmtClock(75.25), "1:15.2");
  assert.equal(U.fmtClock(185.611), "3:05.6");
  assert.equal(U.fmtClock(3725), "1:02:05.0");
  assert.equal(U.fmtClock(NaN), "–");
  assert.equal(U.fmtBytes(169888163), "170 MB");
  assert.equal(U.fmtBytes(3060000), "3.1 MB");
  assert.equal(U.fmtBytes(2e9), "2.00 GB");
  assert.equal(U.fmtEta(130), "about 2 min left");
  assert.equal(U.fmtEta(NaN), "");
});

test("parseDuration accepts seconds and clock formats", () => {
  for (const [input, want] of [
    ["8", 8], ["8.5", 8.5], ["8,5", 8.5], ["8 s", 8], ["8s", 8], [" 12 sec ", 12],
    ["1:30", 90], ["1:30.5", 90.5], ["0:05", 5], ["1:02:03", 3723],
  ]) assert.equal(U.parseDuration(input), want, input);
  for (const bad of ["", "abc", "1:75", "-3", "1::2", "s", null]) assert.equal(U.parseDuration(bad), null, String(bad));
});

test("SpeedMeter measures over its window", () => {
  const m = new U.SpeedMeter(4000);
  for (let t = 0; t <= 10000; t += 500) m.add(t, t * 1000); // 1 MB/s
  assert.ok(Math.abs(m.rate() - 1e6) < 1);
});

test("lruEvict removes oldest first, never the kept key", () => {
  const idx = { a: { size: 5, used: 1 }, b: { size: 5, used: 2 }, c: { size: 5, used: 3 } };
  assert.deepEqual(U.lruEvict(idx, 10, "c"), ["a"]);
  assert.deepEqual(U.lruEvict(idx, 5, "a"), ["b", "c"]);
  assert.deepEqual(U.lruEvict(idx, 100, "a"), []);
});

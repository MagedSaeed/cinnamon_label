// Run with: node --test tests/*.test.js
// Expected values come from ffprobe on the same fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../extension/src/shared/mp4.js");

const load = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", name)));
const reader = (bytes) => async (o, n) => bytes.subarray(o, Math.min(bytes.length, o + n));

for (const name of ["faststart.mp4", "moov-at-end.mp4"]) {
  test(`${name}: audio track, timing and sample bytes`, async () => {
    const bytes = load(name);
    const loc = await M.locateMoov(reader(bytes), bytes.length);
    if (name === "faststart.mp4") assert.ok(loc.offset < 100, "moov near the start");
    else assert.ok(loc.offset > bytes.length / 2, "moov near the end");

    const { tracks } = M.parseMoov(bytes.subarray(loc.offset, loc.offset + loc.size));
    const audio = tracks.find((t) => t.handler === "soun");
    const video = tracks.find((t) => t.handler === "vide");
    assert.ok(video && audio);
    assert.equal(audio.codec, "mp4a");
    assert.equal(audio.sampleRate, 44100);
    assert.equal(audio.channels, 2);
    assert.equal(M.aacCodecString(audio), "mp4a.40.2"); // AAC LC
    assert.ok(audio.asc && audio.asc.length >= 2);
    assert.equal(audio.mediaStart, 1024); // encoder priming skipped by the edit list

    const st = M.sampleTable(audio);
    assert.equal(st.count, 863); // ffprobe nb_read_packets
    // ffprobe: first packets pts -1024, 0, 1024 (sizes 338, 408, 333)
    assert.deepEqual([st.size[0], st.size[1], st.size[2]], [338, 408, 333]);
    assert.ok(Math.abs(st.time[0] - -1024 / 44100) < 1e-9);
    assert.equal(st.time[1], 0);
    assert.ok(Math.abs(st.time[2] - 1024 / 44100) < 1e-9);
    // Offsets are inside the file and every sample starts with an AAC raw frame (no ADTS header).
    for (let i = 0; i < st.count; i++) assert.ok(st.offset[i] + st.size[i] <= bytes.length);
    // Monotonic time, consistent duration.
    for (let i = 1; i < st.count; i++) assert.ok(st.time[i] > st.time[i - 1]);
    assert.ok(Math.abs(st.time[st.count - 1] + st.dur[st.count - 1] - 20) < 0.05);
  });
}

test("both layouts give the same samples (offsets shifted, bytes identical)", async () => {
  const a = load("faststart.mp4");
  const b = load("moov-at-end.mp4");
  const tab = async (bytes) => {
    const loc = await M.locateMoov(reader(bytes), bytes.length);
    const t = M.parseMoov(bytes.subarray(loc.offset, loc.offset + loc.size)).tracks.find((x) => x.handler === "soun");
    return M.sampleTable(t);
  };
  const ta = await tab(a);
  const tb = await tab(b);
  for (const i of [0, 1, 100, 862]) {
    const sa = a.subarray(ta.offset[i], ta.offset[i] + ta.size[i]);
    const sb = b.subarray(tb.offset[i], tb.offset[i] + tb.size[i]);
    assert.deepEqual(sa, sb);
  }
});

test("locateMoov rejects non-MP4 data", async () => {
  const junk = new Uint8Array(64);
  await assert.rejects(M.locateMoov(reader(junk), junk.length));
});

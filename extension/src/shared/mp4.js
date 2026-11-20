// Minimal MP4 (ISO BMFF) reader: finds the `moov` box and expands one track's sample table
// (byte offset, size and presentation time of every sample), plus the AAC decoder config.
// Pure code: used by the content scripts (globalThis.CLMP4) and the Node tests (require).
(function (root) {
  const M = {};

  const type4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const u64 = (dv, o) => dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);
  const i64 = (dv, o) => dv.getInt32(o) * 2 ** 32 + dv.getUint32(o + 4);

  // Child boxes of [start, end): [{ type, start, size, body }] (body = offset after the header).
  function boxes(dv, start, end) {
    const out = [];
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      const type = type4(dv, o + 4);
      let header = 8;
      if (size === 1) {
        size = u64(dv, o + 8);
        header = 16;
      } else if (size === 0) size = end - o;
      if (size < header || o + size > end) break; // truncated or corrupt: stop here
      out.push({ type, start: o, size, body: o + header });
      o += size;
    }
    return out;
  }
  const child = (dv, box, type) => boxes(dv, box.body, box.start + box.size).find((b) => b.type === type) || null;
  const path = (dv, box, ...types) => types.reduce((b, t) => (b ? child(dv, b, t) : null), box);

  // Locate the top-level moov box using small reads. read(offset, length) -> Promise<Uint8Array>.
  M.locateMoov = async function locateMoov(read, total) {
    let o = 0;
    for (let guard = 0; guard < 64 && o + 8 <= total; guard++) {
      const h = await read(o, 16);
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let size = dv.getUint32(0);
      const type = type4(dv, 4);
      if (size === 1) size = u64(dv, 8);
      else if (size === 0) size = total - o;
      if (size < 8) throw new Error("Not an MP4 file (bad box at " + o + ").");
      if (type === "moov") return { offset: o, size };
      o += size;
    }
    throw new Error("No moov box found.");
  };

  // Parse descriptor length (1-4 bytes, 7 bits each).
  function descLen(dv, o) {
    let len = 0;
    let i = 0;
    for (; i < 4; i++) {
      const b = dv.getUint8(o + i);
      len = (len << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return { len, next: o + i + 1 };
  }

  // AudioSpecificConfig from an esds box (ES_Descriptor > DecoderConfigDescriptor > DecoderSpecificInfo).
  function parseEsds(dv, box) {
    let o = box.body + 4; // version + flags
    const end = box.start + box.size;
    let objectType = null;
    while (o < end) {
      const tag = dv.getUint8(o);
      const { len, next } = descLen(dv, o + 1);
      if (tag === 0x03) {
        // ES_Descriptor: ES_ID(2) flags(1) [+ dependsOn(2)] [+ URL] [+ OCR_ES_Id(2)]
        const flags = dv.getUint8(next + 2);
        let p = next + 3;
        if (flags & 0x80) p += 2;
        if (flags & 0x40) p += 1 + dv.getUint8(p);
        if (flags & 0x20) p += 2;
        o = p;
        continue;
      }
      if (tag === 0x04) {
        objectType = dv.getUint8(next);
        o = next + 13; // objectType(1) streamType(1) bufferSize(3) maxBitrate(4) avgBitrate(4)
        continue;
      }
      if (tag === 0x05) return { objectType, asc: new Uint8Array(dv.buffer, dv.byteOffset + next, len).slice() };
      o = next + len;
    }
    return { objectType, asc: null };
  }

  // moovBytes: Uint8Array holding the whole moov box (header included).
  M.parseMoov = function parseMoov(moovBytes) {
    const dv = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const top = boxes(dv, 0, dv.byteLength).find((b) => b.type === "moov");
    if (!top) throw new Error("No moov box in the given bytes.");
    const mvhd = child(dv, top, "mvhd");
    const movieScale = mvhd ? dv.getUint32(mvhd.body + (dv.getUint8(mvhd.body) === 1 ? 20 : 12)) : 1000;

    const tracks = [];
    for (const trak of boxes(dv, top.body, top.start + top.size).filter((b) => b.type === "trak")) {
      const mdia = child(dv, trak, "mdia");
      const hdlr = mdia && child(dv, mdia, "hdlr");
      const mdhd = mdia && child(dv, mdia, "mdhd");
      const stbl = mdia && path(dv, mdia, "minf", "stbl");
      if (!hdlr || !mdhd || !stbl) continue;
      const handler = type4(dv, hdlr.body + 8);
      const v1 = dv.getUint8(mdhd.body) === 1;
      const timescale = dv.getUint32(mdhd.body + (v1 ? 20 : 12));
      const duration = v1 ? u64(dv, mdhd.body + 24) : dv.getUint32(mdhd.body + 16);

      // Edit list: leading empty edits delay the track; media_time skips encoder priming.
      let emptyDelay = 0; // seconds
      let mediaStart = 0; // track timescale units
      const elst = path(dv, trak, "edts", "elst");
      if (elst) {
        const ev1 = dv.getUint8(elst.body) === 1;
        const n = dv.getUint32(elst.body + 4);
        let p = elst.body + 8;
        for (let i = 0; i < n; i++) {
          const segDur = ev1 ? u64(dv, p) : dv.getUint32(p);
          const mediaTime = ev1 ? i64(dv, p + 8) : dv.getInt32(p + 4);
          p += ev1 ? 20 : 12;
          if (mediaTime === -1) emptyDelay += segDur / movieScale;
          else {
            mediaStart = mediaTime;
            break;
          }
        }
      }

      const t = { handler, timescale, duration: duration / timescale, emptyDelay, mediaStart, codec: null };
      const stsd = child(dv, stbl, "stsd");
      if (stsd) {
        const entry = boxes(dv, stsd.body + 8, stsd.start + stsd.size)[0];
        if (entry) {
          t.codec = entry.type;
          if (handler === "soun") {
            const ver = dv.getUint16(entry.body + 8);
            t.channels = dv.getUint16(entry.body + 16);
            t.sampleRate = dv.getUint32(entry.body + 24) / 65536;
            const childStart = entry.body + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
            const esds = boxes(dv, childStart, entry.start + entry.size).find((b) => b.type === "esds");
            if (esds) Object.assign(t, parseEsds(dv, esds));
          }
        }
      }
      t._dv = dv;
      t._stbl = stbl;
      tracks.push(t);
    }
    return { movieScale, tracks };
  };

  // Expand a track's sample table: { count, offset: Float64Array, size: Uint32Array, time: Float64Array (s), dur: Float64Array (s) }.
  M.sampleTable = function sampleTable(track) {
    const dv = track._dv;
    const stbl = track._stbl;
    const get = (t) => child(dv, stbl, t);

    const stsz = get("stsz") || get("stz2");
    if (!stsz || stsz.type !== "stsz") throw new Error("Unsupported sample size table.");
    const fixed = dv.getUint32(stsz.body + 4);
    const count = dv.getUint32(stsz.body + 8);
    const size = new Uint32Array(count);
    for (let i = 0; i < count; i++) size[i] = fixed || dv.getUint32(stsz.body + 12 + 4 * i);

    const co = get("stco") || get("co64");
    const nChunks = dv.getUint32(co.body + 4);
    const chunkOff = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) chunkOff[i] = co.type === "stco" ? dv.getUint32(co.body + 8 + 4 * i) : u64(dv, co.body + 8 + 8 * i);

    const stsc = get("stsc");
    const nStsc = dv.getUint32(stsc.body + 4);
    const offset = new Float64Array(count);
    let s = 0;
    for (let e = 0; e < nStsc; e++) {
      const first = dv.getUint32(stsc.body + 8 + 12 * e) - 1;
      const per = dv.getUint32(stsc.body + 12 + 12 * e);
      const lastExcl = e + 1 < nStsc ? dv.getUint32(stsc.body + 8 + 12 * (e + 1)) - 1 : nChunks;
      for (let c = first; c < lastExcl && s < count; c++) {
        let o = chunkOff[c];
        for (let k = 0; k < per && s < count; k++, s++) {
          offset[s] = o;
          o += size[s];
        }
      }
    }
    if (s !== count) throw new Error(`Sample table mismatch (${s} of ${count}).`);

    const stts = get("stts");
    const nStts = dv.getUint32(stts.body + 4);
    const time = new Float64Array(count);
    const dur = new Float64Array(count);
    let dts = 0;
    let i = 0;
    for (let e = 0; e < nStts && i < count; e++) {
      const n = dv.getUint32(stts.body + 8 + 8 * e);
      const delta = dv.getUint32(stts.body + 12 + 8 * e);
      for (let k = 0; k < n && i < count; k++, i++) {
        time[i] = (dts - track.mediaStart) / track.timescale + track.emptyDelay;
        dur[i] = delta / track.timescale;
        dts += delta;
      }
    }
    return { count, offset, size, time, dur };
  };

  // WebCodecs codec string for an AAC track, e.g. "mp4a.40.2".
  M.aacCodecString = function aacCodecString(track) {
    if (!track.asc || !track.asc.length) return "mp4a.40.2";
    let aot = track.asc[0] >> 3;
    if (aot === 31) aot = 32 + (((track.asc[0] & 7) << 3) | (track.asc[1] >> 5));
    return `mp4a.40.${aot}`;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = M;
  else root.CLMP4 = M;
})(globalThis);

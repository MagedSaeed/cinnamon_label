// Decodes a task's audio once, straight from the MP4's audio track, into:
//  - waveform peaks (min/max per 5 ms) for the timeline, filled in progressively;
//  - a 16 kHz mono copy for presegmentation (no need for Label Studio's waveform).
// Uses WebCodecs' AudioDecoder; falls back to decodeAudioData on the complete file.
(() => {
  const CL = globalThis.CL;
  const MP4 = globalThis.CLMP4;

  const PPS = 200; // peak buckets per second
  const PCM_RATE = 16000;

  CL.AudioTrack = class AudioTrack {
    constructor(duration, { onUpdate } = {}) {
      this.duration = duration;
      this.pps = PPS;
      const n = Math.ceil(duration * PPS) + 1;
      this.min = new Float32Array(n);
      this.max = new Float32Array(n);
      this.pcmRate = PCM_RATE;
      this._pcmSum = new Float32Array(Math.ceil(duration * PCM_RATE) + 1);
      this._pcmCnt = new Uint8Array(this._pcmSum.length);
      this.decodedUntil = 0; // seconds of audio decoded so far (from the start)
      this.done = false;
      this.error = null;
      this.version = 0; // bumps when new peaks arrive (for redraws)
      this.onUpdate = onUpdate || (() => {});
      this._next = 0;
      this._closed = false;
    }

    // ---------- shared sink: Float32 mono at `rate`, starting at time t0 (s) ----------
    _ingest(mono, rate, t0) {
      const pps = this.pps;
      const min = this.min;
      const max = this.max;
      const sum = this._pcmSum;
      const cnt = this._pcmCnt;
      const n = mono.length;
      for (let k = 0; k < n; k++) {
        const t = t0 + k / rate;
        if (t < 0) continue; // encoder priming
        const x = mono[k];
        const b = (t * pps) | 0;
        if (b < min.length) {
          if (x < min[b]) min[b] = x;
          if (x > max[b]) max[b] = x;
        }
        const j = (t * PCM_RATE) | 0; // box-filter down to 16 kHz
        if (j < sum.length && cnt[j] < 255) {
          sum[j] += x;
          cnt[j]++;
        }
      }
      const end = t0 + n / rate;
      if (end > this.decodedUntil) this.decodedUntil = Math.min(this.duration, end);
      this.version++;
    }

    _notify(force) {
      const now = performance.now();
      if (!force && now - (this._lastNotify || 0) < 150) return;
      this._lastNotify = now;
      this.onUpdate(this);
    }

    // 16 kHz mono Float32Array (for presegmentation).
    pcm16k() {
      const out = new Float32Array(this._pcmSum.length);
      for (let j = 0; j < out.length; j++) out[j] = this._pcmCnt[j] ? this._pcmSum[j] / this._pcmCnt[j] : 0;
      return out;
    }

    close() {
      this._closed = true;
      try {
        this._decoder && this._decoder.state !== "closed" && this._decoder.close();
      } catch (_) {}
    }

    // ---------- WebCodecs path ----------
    // track/table from CLMP4. Returns false if this browser can't decode the codec.
    async configure(track, table) {
      if (typeof AudioDecoder === "undefined" || !track.asc) return false;
      const config = {
        codec: MP4.aacCodecString(track),
        sampleRate: track.sampleRate,
        numberOfChannels: track.channels,
        description: track.asc,
      };
      try {
        const sup = await AudioDecoder.isConfigSupported(config);
        if (!sup.supported) return false;
      } catch (_) {
        return false;
      }
      this.table = table;
      this._decoder = new AudioDecoder({
        output: (ad) => this._onAudioData(ad),
        error: (e) => {
          this.error = e;
          CL.warn("Audio decoding failed:", e);
        },
      });
      this._decoder.configure(config);
      return true;
    }

    _onAudioData(ad) {
      try {
        if (this._closed) return;
        const frames = ad.numberOfFrames;
        const ch = ad.numberOfChannels;
        const mono = new Float32Array(frames);
        const plane = new Float32Array(frames);
        for (let c = 0; c < ch; c++) {
          ad.copyTo(plane, { planeIndex: c, format: "f32-planar" });
          for (let k = 0; k < frames; k++) mono[k] += plane[k];
        }
        if (ch > 1) for (let k = 0; k < frames; k++) mono[k] /= ch;
        this._ingest(mono, ad.sampleRate, ad.timestamp / 1e6);
        this._notify(false);
      } finally {
        ad.close();
      }
    }

    // read(offset, length) -> Promise<Uint8Array | null> (null: those bytes aren't downloaded yet).
    // Decodes every sample that is available, in order; call again when more data arrives.
    async pump(read) {
      if (read) this._read = read;
      if (this.done || this._closed || !this._decoder) return;
      if (this._pumping) {
        this._again = true; // more data arrived while pumping: go round once more
        return;
      }
      this._pumping = true;
      try {
        do {
          this._again = false;
          await this._pumpOnce();
        } while (this._again && !this.done && !this._closed);
      } finally {
        this._pumping = false;
      }
    }

    async _pumpOnce() {
      {
        const t = this.table;
        while (this._next < t.count && !this._closed) {
          const i = this._next;
          const data = await this._read(t.offset[i], t.size[i]);
          if (!data) break;
          this._decoder.decode(
            new EncodedAudioChunk({ type: "key", timestamp: Math.round(t.time[i] * 1e6), duration: Math.round(t.dur[i] * 1e6), data })
          );
          this._next++;
          if (this._decoder.decodeQueueSize > 64) await new Promise((r) => this._decoder.addEventListener("dequeue", r, { once: true }));
          if (this.error) throw this.error;
        }
        if (this._next >= t.count && !this._closed) {
          await this._decoder.flush();
          this.done = true;
          this.decodedUntil = this.duration;
          this._notify(true);
        }
      }
    }

    // ---------- fallback: the whole file at once ----------
    async decodeWholeFile(blob) {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const n = buf.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let k = 0; k < n; k++) mono[k] += d[k];
      }
      if (buf.numberOfChannels > 1) for (let k = 0; k < n; k++) mono[k] /= buf.numberOfChannels;
      this._ingest(mono, buf.sampleRate, 0);
      this.done = true;
      this.decodedUntil = this.duration;
      this._notify(true);
    }
  };

  // Reads byte ranges from a Blob through a sliding window (samples are read in order).
  CL.blobReader = function blobReader(blob, windowSize = 8 << 20) {
    let wStart = -1;
    let wBytes = null;
    return async (offset, length) => {
      if (offset + length > blob.size) return null;
      if (!wBytes || offset < wStart || offset + length > wStart + wBytes.length) {
        wStart = offset;
        wBytes = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + Math.max(windowSize, length))).arrayBuffer());
      }
      return wBytes.subarray(offset - wStart, offset - wStart + length);
    };
  };
})();

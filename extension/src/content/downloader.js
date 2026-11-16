// Downloads one media file with several parallel range requests.
// The server limits each connection to ~0.4 MB/s, so 4 connections are ~3x faster than one.
// Retries each chunk with backoff (the server sometimes answers 503). Falls back to a single
// request if the server ignores ranges.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  CL.Downloader = class Downloader {
    constructor(url, { connections = 3, chunkSize = 4 << 20, maxAttempts = 8, onProgress } = {}) {
      this.url = url;
      this.connections = Math.max(1, Math.min(4, connections | 0)); // never more than 4 of the 6
      this.chunkSize = chunkSize;
      this.maxAttempts = maxAttempts;
      this.onProgress = onProgress || (() => {});
      this.ac = new AbortController();
      this.total = null;
      this.loaded = 0;
      this.meter = new U.SpeedMeter(4000);
      this.lastStatus = null;
    }

    abort() {
      this.ac.abort();
    }
    get aborted() {
      return this.ac.signal.aborted;
    }

    #emit(force) {
      const now = performance.now();
      if (!force && now - (this._lastEmit || 0) < 250) return;
      this._lastEmit = now;
      this.meter.add(now, this.loaded);
      const rate = this.meter.rate();
      const left = this.total != null && rate > 0 ? (this.total - this.loaded) / rate : NaN;
      this.onProgress({ loaded: this.loaded, total: this.total, rate, eta: left, status: this.lastStatus });
    }

    #fetch(headers) {
      return fetch(this.url, { headers, credentials: "include", cache: "no-store", signal: this.ac.signal });
    }

    // Read a response body into `target` at `offset`, counting progress as bytes arrive.
    async #read(res, target, offset) {
      const reader = res.body.getReader();
      let got = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (target) target.set(value, offset + got);
          else (this._chunks = this._chunks || []).push(value);
          got += value.length;
          this.loaded += value.length;
          this.#emit(false);
        }
      } catch (e) {
        this.loaded -= got;
        throw e;
      }
      return got;
    }

    async run() {
      const probe = await this.#fetch({ Range: "bytes=0-0" });
      this.lastStatus = probe.status;
      const cr = probe.status === 206 ? U.parseContentRange(probe.headers.get("content-range")) : null;
      if (!cr || !cr.total) {
        // No range support: this response already is the whole file.
        if (!probe.ok) throw new Error(`The server answered ${probe.status}.`);
        const len = Number(probe.headers.get("content-length")) || null;
        this.total = len;
        this.#emit(true);
        await this.#read(probe, null, 0);
        const blob = new Blob(this._chunks || [], { type: probe.headers.get("content-type") || "video/mp4" });
        this._chunks = null;
        this.total = blob.size;
        this.#emit(true);
        return blob;
      }
      await probe.arrayBuffer().catch(() => {});
      this.total = cr.total;
      this.type = probe.headers.get("content-type") || "video/mp4";
      this.#emit(true);

      const ranges = U.planChunks(this.total, this.chunkSize);
      const parts = new Array(ranges.length);
      this.queue = ranges.map((_, i) => i);
      const worker = async () => {
        while (!this.aborted) {
          const i = this.queue.shift();
          if (i === undefined) return;
          parts[i] = await this.#chunk(ranges[i]);
        }
      };
      const tick = setInterval(() => this.#emit(true), 500);
      try {
        await Promise.all(Array.from({ length: Math.min(this.connections, ranges.length) }, worker));
      } finally {
        clearInterval(tick);
      }
      if (this.aborted) throw new DOMException("Download cancelled", "AbortError");
      const blob = new Blob(parts, { type: this.type });
      if (blob.size !== this.total) throw new Error(`Downloaded ${blob.size} of ${this.total} bytes.`);
      this.#emit(true);
      return blob;
    }

    async #chunk([start, end]) {
      const want = end - start + 1;
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await this.#fetch({ Range: `bytes=${start}-${end}` });
          this.lastStatus = res.status;
          const cr = U.parseContentRange(res.headers.get("content-range"));
          if (res.status !== 206 || !cr || cr.start !== start || cr.end !== end) {
            await res.body?.cancel().catch(() => {});
            throw new Error(`The server answered ${res.status} for bytes ${start}-${end}.`);
          }
          const buf = new Uint8Array(want);
          const got = await this.#read(res, buf, 0);
          if (got !== want) {
            this.loaded -= got;
            throw new Error(`Got ${got} of ${want} bytes.`);
          }
          return buf;
        } catch (e) {
          if (this.aborted) throw e;
          if (attempt >= this.maxAttempts) throw e;
          const wait = Math.min(8000, 400 * 2 ** attempt) * (0.75 + Math.random() / 2);
          CL.warn(`Chunk ${start}-${end} failed (${e.message}); retrying in ${Math.round(wait)} ms.`);
          await sleep(wait);
        }
      }
    }
  };
})();

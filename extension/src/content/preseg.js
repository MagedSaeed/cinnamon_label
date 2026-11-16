// Presegmentation: sends the task's audio (our own 16 kHz decode) to the user's diarization server
// and returns suggested segments. Suggestions are only shown; nothing is added to the annotation
// until the user accepts them.
(() => {
  const CL = globalThis.CL;

  // Message the background worker (which can reach a local http server).
  CL.bg = (msg) =>
    new Promise((resolve, reject) => {
      if (!CL.alive()) return reject(new Error("The extension was reloaded. Refresh the page."));
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        r && r.ok ? resolve(r.data) : reject(new Error((r && r.error) || "No answer from the extension."));
      });
    });

  // 16-bit PCM mono WAV, base64 (messages to the worker must be JSON).
  function wavB64(samples, sr) {
    const n = samples.length;
    const ab = new ArrayBuffer(44 + n * 2);
    const v = new DataView(ab);
    const w = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    w(0, "RIFF");
    v.setUint32(4, 36 + n * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const params = (s) => ({
    provider: s.psProvider,
    removeMusic: s.psRemoveMusic,
    maxDur: s.psMaxDur,
    pad: s.psPad,
    minSeg: s.psMinSeg,
    numSpeakers: s.psNum,
    minSpeakers: s.psMin,
    maxSpeakers: s.psMax,
    dropOverlap: s.psDropOverlap,
    timeoutMin: s.psTimeoutMin,
  });

  // A brief message for the user (the full detail goes to the tooltip and the console).
  class PresegError extends Error {
    constructor(brief, detail) {
      super(brief);
      this.detail = detail || brief;
    }
  }
  function friendly(e) {
    const m = String((e && e.message) || e || "");
    if (e instanceof PresegError) return e;
    if (/^PS_TIMEOUT/.test(m)) return new PresegError("Presegmentation took longer than the time limit and was stopped.", m);
    if (/^PS_ABORTED/.test(m)) return new PresegError("The presegmentation server stopped. Start it again, then retry.", m);
    if (/^PS_NETWORK/.test(m)) return new PresegError("Lost the connection to the presegmentation server. Is it still running?", m);
    if (/Music removal|demucs/i.test(m)) return new PresegError("Music removal isn't installed on the server. Turn it off, or run uv sync there.", m);
    if (/pyannote ?ai/i.test(m) && /could not load audio|download timed out/i.test(m))
      return new PresegError("pyannoteAI couldn't load the audio (on their side). Try again in a moment.", m);
    if (/pyannote ?ai/i.test(m) && /\b40[13]\b|unauthori[sz]ed|api[ _-]?key|forbidden/i.test(m))
      return new PresegError("pyannoteAI rejected the API key. Check PYANNOTEAI_API_KEY on the server.", m);
    if (/PS_HTTP 502|pyannote ?ai/i.test(m)) return new PresegError("pyannoteAI failed. Try again, or use local pyannote.", m);
    if (/HF_TOKEN|gated|hugging ?face/i.test(m)) return new PresegError("The server can't load the model. Check HF_TOKEN on the server.", m);
    if (/PS_HTTP 400/.test(m)) return new PresegError("The server couldn't read the audio.", m);
    if (/PS_HTTP 5\d\d/.test(m)) return new PresegError("The presegmentation server hit an error. See its log.", m);
    if (/reloaded|context invalidated|Receiving end does not exist/i.test(m)) return new PresegError("The extension was updated. Refresh the page, then try again.", m);
    return new PresegError("Presegmentation failed. Try again.", m);
  }

  CL.preseg = {
    // audio: CL.AudioTrack (must be fully decoded). onStatus(text) for progress.
    async run(audio, settings, onStatus = () => {}) {
      try {
        return await this._run(audio, settings, onStatus);
      } catch (e) {
        const f = friendly(e);
        CL.warn("Presegmentation:", f.detail);
        throw f;
      }
    },

    async _run(audio, settings, onStatus) {
      if (!audio || !audio.done) throw new PresegError("Still loading the audio. Try again in a moment.");
      onStatus("Checking the presegmentation server…");
      try {
        await CL.bg({ type: "CL_PS_HEALTH", serverUrl: settings.psServer });
      } catch (e) {
        throw new PresegError("Presegmentation server is offline. Start it, then try again.", `${settings.psServer}: ${e.message}`);
      }
      onStatus("Preparing the audio…");
      const wav = wavB64(audio.pcm16k(), audio.pcmRate);
      const runId = "r" + Date.now() + Math.random().toString(36).slice(2, 6);
      const started = Date.now();
      let healthFails = 0;
      let stopped = false;
      // Progress, a keep-alive for the worker, and a health check every 10 s: if the server goes
      // away mid-run, stop waiting instead of spinning forever.
      const tick = setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        onStatus(`Presegmenting… ${s} s`);
        CL.bg({ type: "CL_PS_PING" }).catch(() => {});
        if (s > 0 && s % 10 === 0)
          CL.bg({ type: "CL_PS_HEALTH", serverUrl: settings.psServer })
            .then(() => (healthFails = 0))
            .catch((e) => {
              if (!/PS_DOWN/.test(String(e && e.message))) return; // slow is fine; only "not running" counts
              if (++healthFails >= 2 && !stopped) {
                stopped = true;
                CL.bg({ type: "CL_PS_ABORT", runId }).catch(() => {});
              }
            });
      }, 1000);
      try {
        const res = await CL.bg({ type: "CL_PS_RUN", serverUrl: settings.psServer, wavB64: wav, params: params(settings), runId });
        // Speakers as S1, S2, ... in order of first appearance.
        const names = new Map();
        const segments = (res.segments || [])
          .filter((g) => Number.isFinite(g.start) && Number.isFinite(g.end) && g.end > g.start)
          .sort((a, b) => a.start - b.start)
          .map((g) => {
            if (!names.has(g.speaker)) names.set(g.speaker, `S${names.size + 1}`);
            return { start: g.start, end: g.end, speaker: names.get(g.speaker) };
          });
        return { segments, speakers: res.num_speakers ?? names.size };
      } finally {
        clearInterval(tick);
      }
    },
  };
})();

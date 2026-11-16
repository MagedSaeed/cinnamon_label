"""Local diarization service for the SpeakerCut extension (Label Studio presegmentation).

Run:
    cp .env.example .env          # put your HF_TOKEN in .env (must have accepted the model's terms)
    uv run uvicorn app:app --host 127.0.0.1 --port 8000

POST /diarize  (multipart: file=<mono WAV>, provider=local|pyannoteai, remove_music, ...)
GET  /health
"""
from __future__ import annotations

import io
import os
import threading

import httpx
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv

from fastapi.concurrency import run_in_threadpool

import cache
import providers
import separation
from segmenter import Seg, build_segments, to_dicts

# Load server/.env (next to this file) regardless of the working directory.
# Real environment variables take precedence over values in .env.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=False)

MODEL = os.environ.get("DIARIZATION_MODEL", "pyannote/speaker-diarization-community-1")
HF_TOKEN = os.environ.get("HF_TOKEN")

app = FastAPI(title="SpeakerCut")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_pipeline = None
_lock = threading.Lock()


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        from pyannote.audio import Pipeline

        if not HF_TOKEN:
            raise RuntimeError("HF_TOKEN is not set. Put it in server/.env (see .env.example).")

        try:
            p = Pipeline.from_pretrained(MODEL, token=HF_TOKEN)          # pyannote >= 4
        except TypeError:
            p = Pipeline.from_pretrained(MODEL, use_auth_token=HF_TOKEN)  # pyannote 3.x
        if p is None:
            raise RuntimeError(f"Could not load {MODEL}. Check HF_TOKEN and that you accepted the model terms.")
        if torch.cuda.is_available():
            p.to(torch.device("cuda"))
        _pipeline = p
    return _pipeline


def _annotation(output):
    # pyannote 4 returns DiarizeOutput; 3.x returns an Annotation
    return getattr(output, "speaker_diarization", output)


def _to_wav_bytes(wav: torch.Tensor, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, wav.squeeze(0).numpy(), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _loudness(wav: torch.Tensor, sr: int) -> np.ndarray:
    """Smoothed loudness, one value per 10 ms."""
    x = wav.squeeze(0).numpy()
    hop = max(1, int(sr * 0.01))
    n = len(x) // hop
    if n == 0:
        return np.zeros(0)
    rms = np.sqrt((x[: n * hop].reshape(n, hop).astype(np.float64) ** 2).mean(1))
    return np.convolve(rms, np.ones(25) / 25, mode="same")  # ~250 ms, so a breath beats a single quiet frame


def _quiet_finder(smooth: np.ndarray):
    """quiet_point(lo, hi) for the segmenter: the quietest moment in [lo, hi] s."""
    n = len(smooth)
    if n == 0:
        return None

    def quiet_point(lo: float, hi: float):
        a, b = max(0, int(lo * 100)), min(n, int(hi * 100))
        return None if b <= a else (a + int(np.argmin(smooth[a:b]))) / 100

    return quiet_point


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "loaded": _pipeline is not None, "cuda": torch.cuda.is_available(),
            "hf_token_set": bool(HF_TOKEN), "providers": providers.available(),
            "separation": separation.available()}


@app.post("/diarize")
async def diarize(
    file: UploadFile = File(...),
    provider: str = Form("local"),
    remove_music: bool = Form(False),
    max_dur: float = Form(30.0),
    pad: float = Form(0.2),
    min_seg: float = Form(1.0),
    num_speakers: int = Form(0),
    min_speakers: int = Form(0),
    max_speakers: int = Form(0),
    drop_overlap: bool = Form(True),
    refresh: bool = Form(False),  # ignore (and replace) a cached result for this clip
):
    raw = await file.read()
    try:
        audio, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception as e:
        raise HTTPException(400, f"Could not read audio: {e}")
    wav = torch.from_numpy(np.ascontiguousarray(audio.T))  # (channels, time)
    if wav.shape[0] > 1:
        wav = wav.mean(0, keepdim=True)
    duration = wav.shape[1] / sr

    model = MODEL if provider == "local" else os.environ.get("PYANNOTEAI_MODEL", "precision-2")
    key = cache.key(raw, provider=provider, model=model, remove_music=remove_music,
                    num_speakers=num_speakers, min_speakers=min_speakers, max_speakers=max_speakers)
    hit = None if refresh else cache.load(key)
    if hit:
        turns, loud = hit
    else:
        turns, loud = await _diarize(wav, sr, provider, remove_music, num_speakers, min_speakers, max_speakers)
        cache.save(key, turns, loud)

    segs = build_segments(turns, duration, max_dur=max_dur, pad=pad,
                          min_seg=min_seg, drop_overlap=drop_overlap, quiet_point=_quiet_finder(loud))
    return {
        "provider": provider,
        "remove_music": remove_music,
        "cached": bool(hit),
        "duration": round(duration, 3),
        "num_speakers": len({t.speaker for t in turns}),
        "segments": to_dicts(segs),
    }


async def _diarize(wav, sr, provider, remove_music, num_speakers, min_speakers, max_speakers):
    """Raw speaker turns + the loudness curve used for quiet-point splitting."""
    # Optional: diarize on the vocals stem only (music/background removed). Timing is unchanged.
    if remove_music:
        if not separation.available():
            raise HTTPException(400, "Music removal (demucs) is not installed. Run: uv sync")
        wav = await run_in_threadpool(separation.vocals_only, wav, sr, 16000)
        sr = 16000

    try:
        if provider == "local":
            kwargs = providers._speaker_kwargs(num_speakers, min_speakers, max_speakers)

            def _run():
                with _lock:  # one job at a time on the GPU
                    return _annotation(get_pipeline()({"waveform": wav, "sample_rate": sr}, **kwargs))

            ann = await run_in_threadpool(_run)
            turns = [Seg(t.start, t.end, spk) for t, _, spk in ann.itertracks(yield_label=True)]
        elif provider == "pyannoteai":
            turns = await run_in_threadpool(providers.pyannoteai, _to_wav_bytes(wav, sr),
                                            num_speakers, min_speakers, max_speakers)
        else:
            raise HTTPException(400, f"Unknown provider {provider!r}")
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    except httpx.TransportError as e:  # DNS failure, no internet, timeout
        raise HTTPException(502, f"The server couldn't reach the diarization service ({e}). Check its internet connection, or use Local pyannote.")
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    return turns, _loudness(wav, sr)


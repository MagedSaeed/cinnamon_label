"""Disk cache of diarization results, so re-presegmenting the same clip doesn't pay (or wait) twice.

Key: the uploaded audio bytes + every setting that changes the speaker turns (provider, model,
music removal, speaker-count hints). Segment settings (max length, padding, ...) are not part of
the key: the raw turns are cached and segments are rebuilt from them, so tweaking those is free.

Stored per entry: <key>.json (turns) and <key>.npy (smoothed loudness, for quiet-point splitting).
Location: $SPEAKERCUT_CACHE_DIR, default ~/.cache/speakercut/results (inside the Docker cache volume).
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

from segmenter import Seg


def _dir() -> Path:
    d = os.environ.get("SPEAKERCUT_CACHE_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "speakercut", "results")
    return Path(d)


def key(audio: bytes, **settings) -> str:
    h = hashlib.sha256(audio)
    h.update(json.dumps(settings, sort_keys=True).encode())
    return h.hexdigest()


def load(k: str) -> tuple[list[Seg], np.ndarray] | None:
    j, n = _dir() / f"{k}.json", _dir() / f"{k}.npy"
    try:
        turns = [Seg(s, e, spk) for s, e, spk in json.loads(j.read_text())["turns"]]
        return turns, np.load(n)
    except (OSError, ValueError, KeyError, TypeError):
        return None  # missing or damaged: diarize again


def save(k: str, turns: list[Seg], loudness: np.ndarray) -> None:
    d = _dir()
    try:
        d.mkdir(parents=True, exist_ok=True)
        np.save(d / f"{k}.npy", loudness.astype(np.float32))
        tmp = d / f"{k}.json.tmp"  # json last and atomically: an entry only counts once both files exist
        tmp.write_text(json.dumps({"turns": [[t.start, t.end, t.speaker] for t in turns]}))
        tmp.replace(d / f"{k}.json")
    except OSError:
        pass  # a cache that can't be written is not an error


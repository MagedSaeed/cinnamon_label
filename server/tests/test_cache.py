import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import numpy as np
import cache
from segmenter import Seg


def test_roundtrip_and_key(tmp_path, monkeypatch):
    monkeypatch.setenv("SPEAKERCUT_CACHE_DIR", str(tmp_path))
    k = cache.key(b"wav", provider="pyannoteai", remove_music=False, num_speakers=0)
    assert cache.load(k) is None
    cache.save(k, [Seg(0.5, 3.0, "A"), Seg(3.2, 6.0, "B")], np.array([0.1, 0.2, 0.05]))
    turns, loud = cache.load(k)
    assert [(t.start, t.end, t.speaker) for t in turns] == [(0.5, 3.0, "A"), (3.2, 6.0, "B")]
    assert np.allclose(loud, [0.1, 0.2, 0.05])
    # other audio or any diarization setting -> different entry
    assert cache.key(b"wav2", provider="pyannoteai", remove_music=False, num_speakers=0) != k
    assert cache.key(b"wav", provider="pyannoteai", remove_music=True, num_speakers=0) != k
    assert cache.key(b"wav", provider="pyannoteai", remove_music=False, num_speakers=2) != k


def test_damaged_entry_is_a_miss(tmp_path, monkeypatch):
    monkeypatch.setenv("SPEAKERCUT_CACHE_DIR", str(tmp_path))
    k = cache.key(b"x")
    (tmp_path / f"{k}.json").write_text("{not json")
    assert cache.load(k) is None

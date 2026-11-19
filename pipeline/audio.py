"""Audio sources: TTS (edge-tts) or your own recording + forced alignment."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

DEFAULT_VOICE = "nl-NL-FennaNeural"

# Lesson voices; the first one is the default. "name" is what the UI shows (id/tts stay
# the real voice: Alice = Fenna, Mike = Maarten). Other edge-tts Dutch voices:
# nl-NL-ColetteNeural (f), nl-BE-DenaNeural (f, Flemish), nl-BE-ArnaudNeural (m, Flemish).
VOICES = [
    {"id": "fenna", "name": "Alice", "gender": "f", "accent": "NL", "tts": "nl-NL-FennaNeural"},
    {"id": "maarten", "name": "Mike", "gender": "m", "accent": "NL", "tts": "nl-NL-MaartenNeural"},
]
TICKS = 10_000_000  # edge-tts offsets are in 100ns units


CACHE_DIR = Path(__file__).resolve().parent / ".cache"


def tts(text: str, out_mp3: Path, voice: str = DEFAULT_VOICE, rate: str = "+0%") -> list[dict]:
    """Synthesize text to MP3, return word timings [{text, start, end}] in seconds.
    Cached: the same text/voice/rate reuses the existing MP3 and its timings (each synthesis
    produces slightly different bytes, which would show up as changed audio in git)."""
    import hashlib
    import json

    key = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()
    cache = CACHE_DIR / f"{out_mp3.parent.name}-{out_mp3.stem}.json"
    if out_mp3.exists() and cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("key") == key:
            print(f"  (cached audio: {out_mp3.name})")
            return data["words"]

    words = _synthesize(text, out_mp3, voice, rate)
    CACHE_DIR.mkdir(exist_ok=True)
    cache.write_text(json.dumps({"key": key, "words": words}), encoding="utf-8")
    return words


def _synthesize(text: str, out_mp3: Path, voice: str, rate: str) -> list[dict]:
    import edge_tts

    async def run() -> list[dict]:
        comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        words = []
        with open(out_mp3, "wb") as f:
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    f.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    s = chunk["offset"] / TICKS
                    words.append({"text": chunk["text"], "start": s,
                                  "end": s + chunk["duration"] / TICKS})
        return words

    return asyncio.run(run())


def clip_name(form: str) -> str:
    """Stable ASCII file name for a word form. The hash keeps 'één' and 'een' apart."""
    import hashlib
    import re
    import unicodedata
    ascii_ = unicodedata.normalize("NFKD", form.lower()).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "", ascii_)[:24] or "w"
    return f"{base}-{hashlib.sha1(form.encode('utf-8')).hexdigest()[:6]}.mp3"


def tts_words(forms: list[str], out_dir: Path, voice: str = DEFAULT_VOICE,
              rate: str = "-10%") -> dict[str, str]:
    """Synthesize each word on its own -> {form: file name}. Existing files are reused."""
    import edge_tts

    out_dir.mkdir(parents=True, exist_ok=True)
    result = {f: clip_name(f) for f in forms}
    todo = [f for f in forms if not (out_dir / result[f]).exists()]

    async def one(form: str, sem: asyncio.Semaphore) -> None:
        async with sem:
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(form, voice, rate=rate).save(str(out_dir / result[form]))
                    return
                except Exception:  # transient network errors
                    if attempt == 2:
                        raise
                    await asyncio.sleep(1 + attempt)

    async def run() -> None:
        sem = asyncio.Semaphore(4)
        await asyncio.gather(*(one(f, sem) for f in todo))

    if todo:
        print(f"Word clips: {len(todo)} new, {len(forms) - len(todo)} cached")
        asyncio.run(run())
    return result


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise SystemExit("ffmpeg not found. Install it: winget install Gyan.FFmpeg")
    return exe


def convert_recording(src: Path, out_mp3: Path) -> None:
    """Normalize loudness, mono, 64 kbps MP3 — small files, good enough for speech."""
    subprocess.run([_ffmpeg(), "-y", "-loglevel", "error", "-i", str(src),
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100",
                    "-b:a", "64k", str(out_mp3)], check=True)


def align_recording(audio: Path, text: str) -> list[dict]:
    """Forced alignment of a known transcript (MMS model, language 'nld').
    Requires: uv sync --extra align"""
    try:
        import torch
        from ctc_forced_aligner import (generate_emissions, get_alignments, get_spans,
                                        load_alignment_model, load_audio,
                                        postprocess_results, preprocess_text)
    except ImportError as e:
        raise SystemExit("Alignment deps missing. Run: uv sync --extra align") from e

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, tokenizer = load_alignment_model(device, dtype=torch.float32)
    wave = load_audio(str(audio), model.dtype, model.device)
    emissions, stride = generate_emissions(model, wave, batch_size=4)
    tokens_starred, text_starred = preprocess_text(text, romanize=True, language="nld")
    segments, scores, blank = get_alignments(emissions, tokens_starred, tokenizer)
    spans = get_spans(tokens_starred, segments, blank)
    result = postprocess_results(text_starred, spans, stride, scores)
    return [{"text": w["text"], "start": float(w["start"]), "end": float(w["end"])}
            for w in result]

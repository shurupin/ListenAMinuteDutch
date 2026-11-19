"""Build a lesson: content/inbox/<slug>/ -> src/content/lessons/<slug>.json
                                           + public/audio/<slug>/<voice>.mp3 (one per voice)
                                           + public/audio/words/<voice>/*.mp3 (word clips)

Inbox folder:
  meta.json   {"title": "...", "level": "A1"|"A2", "topic": "...", "order": 1,
               "overrides": {"ontbijt": {"lemma": "ontbijten", "pos": "VERB"}},   (optional)
               "syntax": {"9:ontbijt": "P", "7:goedemorgen": "O", "5:te": "-"}}  (optional)
              syntax: "<sentence no. in the lesson>:<word>" -> S|P|O|A|D or "-" (no underline)
  nl.txt      Dutch text, paragraphs separated by a blank line
  en.txt      English translation, same paragraphs (optional)
  ru.txt      Russian translation, same paragraphs (optional)
  audio.*     your recording (mp3/wav/m4a/ogg/...): becomes an extra "Запись" voice.

Every lesson is voiced by all TTS voices in audio.VOICES (Fenna, Maarten).
Usage: uv run build_lesson.py <slug> [--voices fenna,maarten] [--rate -10%] [--tts]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import audio
import nlp
from timing import assign_times

ROOT = Path(__file__).resolve().parent.parent
INBOX = ROOT / "content" / "inbox"
LESSONS = ROOT / "src" / "content" / "lessons"
AUDIO_OUT = ROOT / "public" / "audio"
VOCAB = ROOT / "src" / "data" / "vocab.json"
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".opus", ".flac", ".webm", ".aac"}


def read_paras(path: Path) -> list[str]:
    return nlp.split_paragraphs(path.read_text(encoding="utf-8")) if path.exists() else []


def attach_translation(para: dict, text: str | None, lang: str) -> None:
    """Per-sentence if sentence counts match, else paragraph-level."""
    if not text:
        return
    parts = nlp.split_sentences(text)
    if len(parts) == len(para["sentences"]):
        for s, p in zip(para["sentences"], parts):
            s[lang] = p
    else:
        para[lang] = text


def apply_syntax_fixes(paragraphs: list[dict], fixes: dict[str, str]) -> None:
    """Manual corrections of the parser's members of the sentence (see meta.json "syntax")."""
    sentences = [s for p in paragraphs for s in p["sentences"]]
    for key, role in fixes.items():
        num, _, word = key.partition(":")
        ok = num.isdigit() and 0 < int(num) <= len(sentences)
        toks = sentences[int(num) - 1]["tokens"] if ok else []
        idx = next((i for i, t in enumerate(toks) if t["t"].lower() == word), None)
        if idx is None:
            print(f"! syntax fix {key!r}: word not found")
            continue
        t = toks[idx]
        if role == "-":
            t.pop("syn", None)
            t.pop("m", None)
        else:
            role = role.upper()
            prev = toks[idx - 1] if idx > 0 else None
            # adjacent words fixed to the same role form one member (one continuous line)
            same = prev is not None and prev.get("syn") == role and prev.get("m", 0) >= 1000
            t["syn"], t["m"] = role, prev["m"] if same else 1000 + idx


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--voices", default=",".join(v["id"] for v in audio.VOICES),
                    help="comma-separated voice ids from audio.VOICES")
    ap.add_argument("--rate", default="+0%", help="TTS speed, e.g. -10%%")
    ap.add_argument("--tts", action="store_true", help="ignore a recording, TTS voices only")
    args = ap.parse_args()

    src = INBOX / args.slug
    meta = json.loads((src / "meta.json").read_text(encoding="utf-8"))
    nl_paras = read_paras(src / "nl.txt")
    if not nl_paras:
        raise SystemExit(f"{src / 'nl.txt'} is missing or empty")
    en_paras, ru_paras = read_paras(src / "en.txt"), read_paras(src / "ru.txt")
    for name, tr in (("en", en_paras), ("ru", ru_paras)):
        if tr and len(tr) != len(nl_paras):
            print(f"! {name}.txt has {len(tr)} paragraphs, nl.txt has {len(nl_paras)}")

    # 1. Text analysis
    overrides = {k.lower(): v for k, v in meta.get("overrides", {}).items()}
    syntax_fix = {k.lower(): v for k, v in meta.get("syntax", {}).items()}
    paragraphs = []
    for i, ptext in enumerate(nl_paras):
        para = {"sentences": [{"text": s, "tokens": nlp.analyze_sentence(s, overrides)}
                              for s in nlp.split_sentences(ptext)]}
        attach_translation(para, en_paras[i] if i < len(en_paras) else None, "en")
        attach_translation(para, ru_paras[i] if i < len(ru_paras) else None, "ru")
        paragraphs.append(para)
    apply_syntax_fixes(paragraphs, syntax_fix)

    all_tokens = [t for p in paragraphs for s in p["sentences"] for t in s["tokens"]]
    word_tokens = [t for t in all_tokens if "key" in t]
    sentences = [s for p in paragraphs for s in p["sentences"]]
    full_text = "\n\n".join(nl_paras)
    out_dir = AUDIO_OUT / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)

    # Word forms for isolated clips: clicking a word plays only that word (cutting it out
    # of connected speech always catches a bit of the neighbouring words).
    forms: dict[str, str] = {}
    for t in word_tokens:
        forms.setdefault(t["t"] if t["pos"] == "PROPN" else t["t"].lower(), t["t"])

    def voice_entry(meta_v: dict, words: list[dict], mp3: Path, clip_voice: dict) -> dict:
        """Timings of one voice, stored apart from the text: flat [start, end, ...] per word
        token (document order) and per sentence."""
        toks = [dict(t) for t in all_tokens]
        missing = assign_times(toks, words)
        if missing:
            print(f"  ! {meta_v['id']}: {missing} words had no timing match (interpolated)")
        times = [x for t in toks if "key" in t for x in (t["start"], t["end"])]
        sents, i = [], 0
        for s in sentences:
            n = sum(1 for t in s["tokens"] if "key" in t)
            sents += [times[2 * i], times[2 * (i + n) - 1]]
            i += n
        files = audio.tts_words(list(forms), AUDIO_OUT / "words" / clip_voice["id"], clip_voice["tts"])
        return {
            **{k: meta_v[k] for k in ("id", "name", "gender", "accent")},
            "source": meta_v.get("source", f"tts:{meta_v.get('tts')}"),
            "audio": f"/audio/{args.slug}/{mp3.name}",
            "duration": round(max(w["end"] for w in words), 2),
            "times": times, "sents": [round(x, 3) for x in sents],
            "clips": {f: f"/audio/words/{clip_voice['id']}/{n}" for f, n in files.items()},
        }

    wanted = {v.strip() for v in args.voices.split(",") if v.strip()}
    tts_voices = [v for v in audio.VOICES if v["id"] in wanted]
    if not tts_voices:
        raise SystemExit(f"No known voices in --voices {args.voices}")
    voices = []

    recording = next((p for p in sorted(src.iterdir())
                      if p.stem == "audio" and p.suffix.lower() in AUDIO_EXT), None)
    if recording and not args.tts:
        print(f"Recording: {recording.name} -> forced alignment")
        mp3 = out_dir / "recording.mp3"
        audio.convert_recording(recording, mp3)
        rec = {"id": "rec", "name": "Запись", "gender": "", "accent": "", "source": "recording"}
        voices.append(voice_entry(rec, audio.align_recording(mp3, full_text), mp3, tts_voices[0]))

    for v in tts_voices:
        print(f"TTS: {v['tts']} rate {args.rate}")
        mp3 = out_dir / f"{v['id']}.mp3"
        voices.append(voice_entry(v, audio.tts(full_text, mp3, v["tts"], args.rate), mp3, v))

    for s in sentences:
        del s["text"]

    # 4. Vocabulary: add new lemma keys, Russian glosses get filled in afterwards
    vocab = json.loads(VOCAB.read_text(encoding="utf-8")) if VOCAB.exists() else {}
    new_keys = []
    for t in all_tokens:
        k = t.get("key")
        if k and t["pos"] != "PROPN" and k not in vocab:
            vocab[k] = {"lemma": t["lemma"], "pos": t["pos"], "ru": ""}
            new_keys.append(k)
    VOCAB.parent.mkdir(parents=True, exist_ok=True)
    VOCAB.write_text(json.dumps(dict(sorted(vocab.items())), ensure_ascii=False, indent=1),
                     encoding="utf-8")

    lesson = {
        "title": meta["title"], "level": meta.get("level", "A1"),
        "topic": meta.get("topic", ""), "order": meta.get("order", 999),
        "paragraphs": paragraphs,
        "voices": voices,
    }
    LESSONS.mkdir(parents=True, exist_ok=True)
    (LESSONS / f"{args.slug}.json").write_text(
        json.dumps(lesson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    durs = ", ".join(f"{v['id']} {v['duration']}s" for v in voices)
    print(f"OK {args.slug}: {len(word_tokens)} words, voices: {durs}; {len(new_keys)} new vocab keys")
    unglossed = [k for k, v in vocab.items() if not v.get("ru")]
    if unglossed:
        print(f"Unglossed vocab keys ({len(unglossed)}): " + ", ".join(unglossed))


if __name__ == "__main__":
    main()

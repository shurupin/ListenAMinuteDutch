"""Map word timings (from TTS boundaries or forced alignment) onto our tokens.

Both sides spell the same text, but may split words differently
("'s", numbers, hyphens). We compare normalized character streams
(lowercase letters/digits only) and transfer times char-by-char.
"""
from __future__ import annotations

import difflib
import unicodedata


def _norm_chars(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if c.isalnum())


def assign_times(tokens: list[dict], words: list[dict]) -> int:
    """tokens: dicts with "t" (only those with "key" get times).
    words: [{"text", "start", "end"}] in seconds, in spoken order.
    Mutates tokens (adds start/end). Returns number of word tokens left untimed."""
    w_chars, w_idx = [], []
    for i, w in enumerate(words):
        for c in _norm_chars(w["text"]):
            w_chars.append(c)
            w_idx.append(i)
    t_chars, t_idx = [], []
    for i, t in enumerate(tokens):
        if "key" not in t:
            continue
        for c in _norm_chars(t["t"]):
            t_chars.append(c)
            t_idx.append(i)

    # char position in token stream -> word index
    char_to_word: dict[int, int] = {}
    sm = difflib.SequenceMatcher(None, t_chars, w_chars, autojunk=False)
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            char_to_word[a + k] = w_idx[b + k]

    spans: dict[int, list[int]] = {}
    for pos, ti in enumerate(t_idx):
        if pos in char_to_word:
            spans.setdefault(ti, []).append(char_to_word[pos])

    missing = 0
    for i, t in enumerate(tokens):
        if "key" not in t:
            continue
        ws = spans.get(i)
        if not ws:
            missing += 1
            continue
        t["start"] = round(min(words[j]["start"] for j in ws), 3)
        t["end"] = round(max(words[j]["end"] for j in ws), 3)
    _interpolate_missing(tokens)
    return missing


def _interpolate_missing(tokens: list[dict]) -> None:
    """Give untimed word tokens the gap between their timed neighbours."""
    timed = [i for i, t in enumerate(tokens) if "start" in t]
    if not timed:
        return
    for i, t in enumerate(tokens):
        if "key" not in t or "start" in t:
            continue
        prev = max((j for j in timed if j < i), default=None)
        nxt = min((j for j in timed if j > i), default=None)
        s = tokens[prev]["end"] if prev is not None else tokens[nxt]["start"]
        e = tokens[nxt]["start"] if nxt is not None else s + 0.3
        t["start"], t["end"] = round(s, 3), round(max(e, s + 0.05), 3)

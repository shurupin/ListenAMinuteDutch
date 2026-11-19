"""Word correspondences between the Dutch text and its EN/RU translations (align.txt).

align.txt, one unit per line, blocks per sentence:
    # 1
    vraag me af = wonder = Интересно
    ongelukken = accidents = несчастных случаев

Each side is a list of words, matched case-insensitively to the sentence's words left to
right, preferring a not-yet-used occurrence (so repeated words like "ik" go in order) and
reusing one only when none is left ("I’ve" = ik + heb). Result per sentence:
    enW / ruW: [[start, end], ...] character spans of the translation's words
    al:        [[nl token indices], [en word indices], [ru word indices]] per unit
"""
from __future__ import annotations

import re
from pathlib import Path

WORD_RE = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*")


def word_spans(text: str) -> list[list[int]]:
    return [[m.start(), m.end()] for m in WORD_RE.finditer(text)]


def _match(words: list[str], cands: list[str], used: set[int], where: str) -> list[int]:
    out = []
    for w in words:
        w = w.lower()
        j = next((i for i, c in enumerate(cands) if c == w and i not in used), None)
        if j is None:
            j = next((i for i, c in enumerate(cands) if c == w), None)
        if j is None:
            print(f"  ! align {where}: '{w}' not found")
            continue
        used.add(j)
        out.append(j)
    return out


def parse(path: Path) -> dict[int, list[tuple[str, str, str]]]:
    blocks: dict[int, list[tuple[str, str, str]]] = {}
    current = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        m = re.fullmatch(r"#\s*(\d+)", line)
        if m:
            current = int(m.group(1))
            blocks.setdefault(current, [])
            continue
        if not line or line.startswith("#") or current is None:
            continue
        parts = [p.strip() for p in line.split("=")]
        parts += [""] * (3 - len(parts))
        blocks[current].append((parts[0], parts[1], parts[2]))
    return blocks


def apply(paragraphs: list[dict], path: Path) -> None:
    sentences = [s for p in paragraphs for s in p["sentences"]]
    for num, units in parse(path).items():
        if not 0 < num <= len(sentences):
            print(f"  ! align: sentence {num} does not exist")
            continue
        s = sentences[num - 1]
        nl = [t["t"].lower() for t in s["tokens"]]
        spans = {lang: word_spans(s[lang]) for lang in ("en", "ru") if s.get(lang)}
        words = {lang: [s[lang][a:b].lower() for a, b in sp] for lang, sp in spans.items()}
        used = {"nl": set(), "en": set(), "ru": set()}
        groups = []
        for nl_side, en_side, ru_side in units:
            g_nl = _match(nl_side.split(), nl, used["nl"], f"{num} nl")
            g = [g_nl]
            for lang, side in (("en", en_side), ("ru", ru_side)):
                g.append(_match(side.split(), words[lang], used[lang], f"{num} {lang}")
                         if side and lang in words else [])
            if g_nl and (g[1] or g[2]):
                groups.append(g)
        for lang, sp in spans.items():
            s[f"{lang}W"] = sp
        s["al"] = groups

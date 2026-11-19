"""Tokenization, lemmatization and frequency for Dutch lesson text."""
from __future__ import annotations

import re
from functools import lru_cache

import spacy
from wordfreq import zipf_frequency

import syntax

# Sentence split: after . ! ? … (optionally followed by closing quotes/brackets).
_SENT_RE = re.compile(r"(?<=[.!?…])[\"'”’»)]*\s+")
WORD_POS = {"NOUN", "VERB", "AUX", "ADJ", "ADV", "PRON", "DET", "ADP", "CCONJ",
            "SCONJ", "NUM", "INTJ", "PART", "PROPN", "X"}


@lru_cache(maxsize=1)
def _nlp():
    return spacy.load("nl_core_news_md")


def split_paragraphs(text: str) -> list[str]:
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text.strip())]
    return [p for p in paras if p]


def split_sentences(paragraph: str) -> list[str]:
    return [s.strip() for s in _SENT_RE.split(paragraph) if s.strip()]


def word_zipf(surface: str, lemma: str) -> float:
    """Frequency of a word for 'importance'. A learner learns the lemma,
    so take the larger of surface-form and lemma frequency."""
    return round(max(zipf_frequency(surface.lower(), "nl"),
                     zipf_frequency(lemma.lower(), "nl")), 2)


IRREGULAR = {
    "ben": "zijn", "bent": "zijn", "is": "zijn", "was": "zijn", "waren": "zijn",
    "heb": "hebben", "hebt": "hebben", "heeft": "hebben", "had": "hebben",
    "kan": "kunnen", "kunt": "kunnen", "kon": "kunnen", "wil": "willen", "wilt": "willen",
    "mag": "mogen", "zal": "zullen", "zult": "zullen", "moet": "moeten",
    "ga": "gaan", "gaat": "gaan", "sta": "staan", "staat": "staan", "doe": "doen",
    "doet": "doen", "zie": "zien", "ziet": "zien", "sla": "slaan", "slaat": "slaan",
}
_VOWELS = "aeiou"


def _infinitive_candidates(form: str) -> list[str]:
    """Dutch present-tense stem -> possible infinitives (neem->nemen, zit->zitten...)."""
    stems = {form}
    # 2/3 sg: drinkt -> drink. Only after a consonant: zit, eet, praat are stems themselves.
    if form.endswith("t") and len(form) > 3 and form[-2] not in _VOWELS:
        stems.add(form[:-1])
    cands = set()
    for s in stems:
        if s in IRREGULAR:
            cands.add(IRREGULAR[s])
        cands.update({s + "en", s + "n"})  # werken, doen
        if s == form:
            cands.add(s + s[-1] + "en")  # zit -> zitten (not for t-stripped: rus -> russen)
        alt = s[:-1] + {"f": "v", "s": "z"}.get(s[-1], s[-1])  # leef->leev, lees->leez
        for base in {s, alt}:
            cands.add(base + "en")
            # undouble long vowel: neem->nem, slaap->slap, leev->lev
            if len(base) >= 3 and base[-2] in _VOWELS and base[-3] == base[-2]:
                cands.add(base[:-3] + base[-2] + base[-1] + "en")
        if s[-1] in _VOWELS:
            cands.add(s + s[-1] + "n")  # sta -> staan
    return [c for c in cands if c != form]


def fix_verb_lemma(surface: str, lemma: str) -> str:
    """spaCy often returns the bare stem for 1st-person forms ("neem", "sta")."""
    form = surface.lower()
    if form in IRREGULAR:
        return IRREGULAR[form]
    if lemma.endswith(("en", "aan", "ien", "oen")) or lemma == "zijn":
        return lemma  # already an infinitive: werken, gaan, zien, doen
    best = max(_infinitive_candidates(form) + _infinitive_candidates(lemma),
               key=lambda c: zipf_frequency(c, "nl"), default=lemma)
    return best if zipf_frequency(best, "nl") >= 2.5 else lemma


def _lemma_pos(tok) -> tuple[str, str]:
    if tok.pos_ == "PROPN":
        return tok.text, "PROPN"
    lemma = tok.lemma_.lower()
    if tok.pos_ in ("VERB", "AUX"):
        if "Inf" in tok.morph.get("VerbForm"):
            # An infinitive is its own lemma; spaCy's lookup sometimes returns
            # an unrelated compound ("staan" -> "overstaan", "stoten" -> "doorstoten").
            lemma = tok.text.lower()
        else:
            lemma = _strip_phantom_particle(tok, fix_verb_lemma(tok.text, lemma))
    return lemma, tok.pos_


PARTICLES = ("terug", "samen", "thuis", "langs", "neer", "door", "over", "voor", "mee", "weg",
             "aan", "uit", "toe", "bij", "op", "af", "in", "om", "na")


def _strip_phantom_particle(tok, lemma: str) -> str:
    """spaCy may return a separable compound whose particle is not in the sentence
    ("Ik bel je" -> "terugbellen"). Drop such a particle."""
    if tok.text.lower().startswith(lemma[:3]):
        return lemma
    words = {t.text.lower() for t in tok.doc}
    for p in PARTICLES:
        rest = lemma[len(p):]
        if lemma.startswith(p) and p not in words and zipf_frequency(rest, "nl") >= 3:
            return rest
    return lemma


SEP_MIN_ZIPF = 2.0  # a particle+verb combination must be a real Dutch verb (rejects "inhebben")


def analyze_sentence(sentence: str, overrides: dict | None = None) -> list[dict]:
    """Returns tokens: {t, ws, [lemma, pos, key, zipf]} — punctuation has no key.
    overrides: {"surface (lowercase)": {"lemma": ..., "pos": ...}} for parser mistakes."""
    overrides = overrides or {}
    doc = _nlp()(sentence)
    # Separable verbs ("Ik bel je op" -> opbellen): particle attached via compound:prt.
    sep_lemma: dict[int, str] = {}
    sep_particle: dict[int, int] = {}  # particle token -> its verb token
    for tok in doc:
        if tok.dep_ == "compound:prt" and tok.head.pos_ in ("VERB", "AUX"):
            full = tok.lemma_.lower() + _lemma_pos(tok.head)[0]
            if zipf_frequency(full, "nl") >= SEP_MIN_ZIPF:
                sep_lemma[tok.head.i] = full
                sep_lemma[tok.i] = full
                sep_particle[tok.i] = tok.head.i
    # spaCy sometimes puts the particle into the verb's lemma ("vraag" -> "afvragen")
    # without linking the particle token itself ("Ik vraag me af").
    for tok in doc:
        if tok.pos_ != "VERB" or tok.i in sep_lemma:
            continue
        lemma = _lemma_pos(tok)[0]
        for p in doc[tok.i + 1:]:
            word = p.text.lower()
            if (p.pos_ in ("ADP", "ADV") and len(word) >= 2 and p.i not in sep_lemma
                    and lemma.startswith(word) and zipf_frequency(lemma[len(word):], "nl") >= 3):
                sep_lemma[tok.i] = sep_lemma[p.i] = lemma
                sep_particle[p.i] = tok.i
                break

    members = syntax.roles(doc, sep_particle)
    out = []
    for tok in doc:
        item: dict = {"t": tok.text, "ws": tok.whitespace_ != ""}
        if members[tok.i]:
            item["syn"], item["m"] = members[tok.i]
        ov = overrides.get(tok.text.lower())
        if not ov and (tok.is_punct or tok.is_space or tok.pos_ not in WORD_POS):
            out.append(item)
            continue
        if ov:
            lemma, pos = ov["lemma"], ov["pos"]
        elif tok.i in sep_lemma:
            lemma, pos = sep_lemma[tok.i], "VERB"
        else:
            lemma, pos = _lemma_pos(tok)
        # Separable verb parts ("af", "staan") are frequent on their own — rate the whole verb.
        zipf = (round(zipf_frequency(lemma, "nl"), 2) if tok.i in sep_lemma and not ov
                else word_zipf(tok.text, lemma))
        item.update(lemma=lemma, pos=pos, key=f"{lemma}|{pos}", zipf=zipf)
        out.append(item)
    return out

"""Members of the sentence (Russian school analysis) from a spaCy dependency parse.

Roles: S подлежащее, P сказуемое, O дополнение, A определение, D обстоятельство.
Every token gets (role, member) or None; `member` is the token index of the member's
head word, so the front end can join adjacent tokens of one member under one line.

Conventions:
- the whole predicate is one member: verb + aux + copula + separable particle + "zich"
  (+ te-infinitive complement), also in subordinate clauses;
- prepositions, articles, numerals and quantity words are underlined with their noun;
- particles (niet, ook, toch, wel ...), conjunctions and markers (dat, om, te) are not members;
- a participial phrase (acl without a subject) is one определение, a participle/gerund
  clause (advcl, verb without a subject) is one обстоятельство.
Parser mistakes that the rules cannot catch are fixed per lesson in meta.json "syntax".
"""
from __future__ import annotations

PARTICLES = {"niet", "ook", "toch", "wel", "al", "maar", "nog", "zelfs", "alleen", "er",
             "nu", "dus", "eens", "even", "pas", "ja", "nee"}
QUANTITY = {"veel", "weinig", "meer", "minder", "meest", "hoeveel", "genoeg", "paar"}
ARTICLES = {"de", "het", "een"}
TIME_NOUNS = {"dag", "uur", "week", "maand", "jaar", "ochtend", "middag", "avond", "nacht",
              "weekend", "keer", "tijd", "moment", "minuut", "seconde", "winter", "zomer",
              "lente", "herfst", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag",
              "zaterdag", "zondag", "vandaag", "morgen", "gisteren", "leven"}
# prepositions that make an oblique an обстоятельство (where? where to? when? how?)
ADVERBIAL_PREPS = {"in", "op", "naar", "bij", "uit", "onder", "boven", "achter", "naast",
                   "tussen", "langs", "rond", "om", "binnen", "buiten", "tot", "vanaf",
                   "sinds", "na", "tijdens", "als", "zonder"}
CLAUSE_DEPS = {"ROOT", "ccomp", "advcl", "acl:relcl", "parataxis", "csubj", "xcomp"}
PRED_PARTS = {"aux", "aux:pass", "cop", "expl:pv"}
INHERIT = {"case", "nummod", "flat", "flat:name", "compound", "fixed", "conj", "appos"}
VERBAL = ("VERB", "AUX")


def _has(t, *deps) -> bool:
    return any(c.dep_ in deps for c in t.children)


def _is_predicate_head(t) -> bool:
    if _has(t, "aux", "aux:pass", "cop"):
        return True  # "ben beland", "zijn pijnlijk", "is een ongeluk"
    if t.dep_ in CLAUSE_DEPS and t.pos_ in VERBAL:
        return True
    if t.dep_ == "acl" and t.pos_ in VERBAL and _has(t, "nsubj", "nsubj:pass"):
        return True  # "keer dat we elkaar ontmoeten": a clause, not a participial phrase
    # conjoined verbs ("Ik slaap lang en ik ontbijt") are predicates of their own clause
    return t.dep_ == "conj" and t.pos_ in VERBAL and _is_predicate_head(t.head)


def _oblique_role(t) -> str:
    prep = next((c.lemma_.lower() for c in t.children if c.dep_ == "case"), None)
    if t.lemma_.lower() in TIME_NOUNS or prep in ADVERBIAL_PREPS:
        return "D"
    if prep is None and t.pos_ in ("ADV", "ADJ"):
        return "D"
    return "O"


def roles(doc, particles: dict[int, int] | None = None) -> list[tuple[str, int] | None]:
    """particles: {particle token index: verb token index} for separable verbs that the
    lemma step accepted (e.g. "vraag ... af"); other compound:prt links are parser noise."""
    particles = particles or {}
    memo: dict[int, tuple[str, int] | None] = {}

    def role(t, depth=0) -> tuple[str, int] | None:
        if t.i in memo:
            return memo[t.i]
        if depth > 40:
            return None
        memo[t.i] = None  # cycle guard
        r = own_role(t, depth)
        memo[t.i] = r
        return r

    def pred_member(v, depth) -> tuple[str, int]:
        r = role(v, depth + 1)
        return ("P", r[1]) if r and r[0] == "P" else ("P", v.i)

    def whole_subtree(t, r: str) -> None:
        for c in t.subtree:
            if not (c.is_punct or c.dep_ in ("mark", "cc")):
                memo[c.i] = (r, t.i)

    def own_role(t, depth) -> tuple[str, int] | None:
        dep, lemma = t.dep_, t.lemma_.lower()
        if t.is_punct or t.is_space or dep in ("mark", "cc", "punct", "discourse", "vocative"):
            return None
        if t.i in particles:  # separable verb particle: part of the predicate
            return pred_member(doc[particles[t.i]], depth)
        if dep in PRED_PARTS:
            return pred_member(t.head, depth)
        if dep == "compound:prt":  # not a real separable verb: an adverbial preposition
            return ("D", t.i)
        if lemma in PARTICLES:
            return None
        if _is_predicate_head(t):
            if dep == "xcomp" and t.head.i != t.i and _is_predicate_head(t.head):
                return pred_member(t.head, depth)  # te-infinitive complement
            return ("P", t.i)
        if dep == "case" and t.head.pos_ in VERBAL:
            return None  # split pronominal adverb: "er ... in"
        core = dep in ("nsubj", "nsubj:pass", "obj", "iobj", "obl")
        if lemma in QUANTITY and not core and t.head.pos_ in VERBAL:
            # "te veel ongelukken" with "veel" hung on the verb: join the noun that follows
            noun = next((c for c in t.head.children if c.i > t.i and c.dep_ in ("obj", "nsubj")), None)
            return role(noun, depth + 1) if noun is not None else ("D", t.i)
        if (lemma in QUANTITY and not core) or (dep in ("advmod", "amod") and t.pos_ == "ADV"
                                                and t.head.pos_ in ("NOUN", "PRON", "DET")) \
                or (dep == "advmod" and t.head.lemma_.lower() in QUANTITY):
            # "een paar ongelukken", "te veel", "bijna elke keer": part of the noun's member
            return role(t.head, depth + 1) if t.head.i != t.i else None
        if dep in ("nsubj", "nsubj:pass"):
            return ("S", t.i)
        if dep in ("obj", "iobj", "obl:agent"):
            return ("O", t.i)
        if dep == "obl":
            return (_oblique_role(t), t.i)
        if dep == "advmod":
            return ("D", t.i)
        if dep in ("amod", "nmod", "nmod:poss"):
            return ("A", t.i)
        if dep == "acl":  # participial phrase: one определение
            whole_subtree(t, "A")
            return ("A", t.i)
        if dep == "advcl":
            if t.pos_ in VERBAL:  # participle/gerund clause: one обстоятельство
                whole_subtree(t, "D")
            return ("D", t.i)  # comparison "als mijn vriend": head only, "mijn" stays A
        if dep.startswith("det"):
            if lemma in ARTICLES:
                return role(t.head, depth + 1)
            return ("A", t.i)
        if dep == "conj" and t.head.pos_ in VERBAL and t.pos_ not in VERBAL:
            return (_oblique_role(t), t.i)  # noun mis-attached to a verb: "in en om het huis"
        if dep in INHERIT:
            return role(t.head, depth + 1) if t.head.i != t.i else None
        return None

    for t in doc:
        role(t)
    # read memo only now: a participial phrase relabels its whole subtree after the fact
    return [memo.get(t.i) for t in doc]

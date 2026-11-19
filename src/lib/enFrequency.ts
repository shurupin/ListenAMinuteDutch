// Build-time only (imported from page frontmatter, never shipped to the browser):
// frequency rank of every word of the English translations in SUBTLEX-US.
import subtlex from 'subtlex-word-frequencies';

// The list is sorted by frequency: position 1 is "you", 2 "I", 3 "the", ...
// Case-insensitive; a word listed in several spellings keeps its best (lowest) rank.
const ranks = new Map<string, number>();
(subtlex as { word: string; count: number }[]).forEach(({ word }, i) => {
  const w = word.toLowerCase();
  if (!ranks.has(w)) ranks.set(w, i + 1);
});

// SUBTLEX-US splits contractions and keeps the pieces ("re", "d", "m", "t", "ll"), except "'ve"
const CLITICS: Record<string, string> = { ve: 'have' };

/**
 * Frequency rank of an English word in SUBTLEX-US (1 = most frequent), or null when it is
 * not in the list. Contractions and compounds that are not listed ("I've", "o'clock",
 * "work-related") get the rank of their rarest part.
 */
export function enRank(word: string): number | null {
  const w = word.toLowerCase().replace(/’/g, "'");
  const direct = ranks.get(w);
  if (direct != null) return direct;
  const parts = w
    .split(/['-]/)
    .filter(Boolean)
    .map((p) => ranks.get(p) ?? ranks.get(CLITICS[p] ?? ''));
  return parts.length && parts.every((r) => r != null) ? Math.max(...(parts as number[])) : null;
}

// same word pattern as the pipeline (pipeline/wordalign.py)
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function wordSpans(text: string): [number, number][] {
  return [...text.matchAll(WORD_RE)].map((m) => [m.index!, m.index! + m[0].length]);
}

export type EnWords = { spans: [number, number][]; ranks: (number | null)[] };

type Para = { en?: string; sentences: { en?: string; enW?: [number, number][] }[] };

/** Every English translation of a lesson, split into words with their frequency ranks.
 *  Keys: "pi.si" for a sentence translation, "pi" for a paragraph-level one. */
export function englishWords(paragraphs: Para[]): Record<string, EnWords> {
  const out: Record<string, EnWords> = {};
  const add = (key: string, text: string, spans?: [number, number][]) => {
    const sp = spans?.length ? spans : wordSpans(text);
    out[key] = { spans: sp, ranks: sp.map(([a, b]) => enRank(text.slice(a, b))) };
  };
  paragraphs.forEach((p, pi) => {
    if (p.en) add(String(pi), p.en);
    p.sentences.forEach((s, si) => {
      if (s.en) add(`${pi}.${si}`, s.en, s.enW);
    });
  });
  return out;
}

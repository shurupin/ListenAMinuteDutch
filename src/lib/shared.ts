// Frequency bands (wordfreq Zipf scale: 7 ≈ "de", 3 ≈ rare).
export const BANDS = [
  { id: 1, min: 5.5, label: 'Основа', hint: 'топ ~500 слов' },
  { id: 2, min: 4.5, label: 'Важное', hint: 'топ ~3 000' },
  { id: 3, min: 3.5, label: 'Полезное', hint: 'топ ~15 000' },
  { id: 4, min: -Infinity, label: 'Редкое', hint: 'реже' },
] as const;

export function band(zipf: number | undefined) {
  const z = zipf ?? 0;
  return BANDS.find((b) => z >= b.min)!;
}

export const POS_RU: Record<string, string> = {
  NOUN: 'сущ.', VERB: 'глагол', AUX: 'вспом. глагол', ADJ: 'прил.', ADV: 'нареч.',
  PRON: 'местоим.', DET: 'артикль/определ.', ADP: 'предлог', CCONJ: 'союз',
  SCONJ: 'союз', NUM: 'числит.', INTJ: 'междом.', PART: 'частица', PROPN: 'имя собств.',
};

export function audioUrl(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + path;
}

// localStorage helpers — never throw (private mode, blocked storage).
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const KEY_SAVED = 'lam:saved';
export const KEY_DONE = 'lam:done';
export const KEY_PREFS = 'lam:prefs';

export type SavedWord = {
  key: string;
  word: string;
  lemma: string;
  ru: string;
  slug: string;
  title: string;
  start: number;
  end: number;
  audio: string;
  clip?: string;
  savedAt: number;
};

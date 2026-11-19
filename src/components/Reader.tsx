import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  BANDS, KEY_DONE, KEY_PREFS, KEY_SAVED, POS_RU, audioUrl, band, load, save,
  type SavedWord,
} from '../lib/shared';
import { playClip, playCut, preloadCut, stopWord } from '../lib/wordAudio';
import { IconChevron, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconRestart, IconStar } from './Icons';
import SpeedControl, { RATE_STEP, clampRate } from './SpeedControl';

type Token = {
  t: string; ws: boolean; lemma?: string; pos?: string; key?: string; zipf?: number;
  syn?: string; m?: number; start?: number; end?: number;
};
type Sentence = { start: number; end: number; en?: string; ru?: string; tokens: Token[] };
type Paragraph = { en?: string; ru?: string; sentences: Sentence[] };
type ReaderLesson = { title: string; audio: string; duration: number; clips: Record<string, string>; paragraphs: Paragraph[] };

// Lesson as stored: text without timings + one entry per voice with that voice's timings.
type RawToken = Omit<Token, 'start' | 'end'>;
type RawLesson = {
  title: string;
  paragraphs: { en?: string; ru?: string; sentences: { en?: string; ru?: string; tokens: RawToken[] }[] }[];
  voices: Voice[];
};
type Voice = {
  id: string; name: string; gender: string; accent: string; audio: string; duration: number;
  times: number[]; sents: number[]; clips: Record<string, string>;
};

/** The text with one voice's timings filled in. */
function withVoice(data: RawLesson, v: Voice): ReaderLesson {
  let w = 0;
  let si = 0;
  const paragraphs = data.paragraphs.map((p) => ({
    ...p,
    sentences: p.sentences.map((s) => {
      const sent = {
        ...s,
        start: v.sents[2 * si],
        end: v.sents[2 * si + 1],
        tokens: s.tokens.map((t) => (t.key ? { ...t, start: v.times[2 * w], end: v.times[2 * w++ + 1] } : t)),
      };
      si++;
      return sent;
    }),
  }));
  return { title: data.title, audio: v.audio, duration: v.duration, clips: v.clips, paragraphs };
}

type Props = {
  slug: string;
  data: RawLesson;
  gloss: Record<string, string>;
  counts: Record<string, number>;
};

type Range = { start: number; end: number; loop: boolean };
type Timed = { id: string; si: number; start: number; end: number };

// Members of the sentence (Russian school analysis) and their underline styles.
const SYNTAX = [
  { id: 'S', label: 'Подлежащее', hint: 'кто? что?', mark: '──' },
  { id: 'P', label: 'Сказуемое', hint: 'что делает? каков?', mark: '══' },
  { id: 'O', label: 'Дополнение', hint: 'вопросы косвенных падежей', mark: '- - -' },
  { id: 'A', label: 'Определение', hint: 'какой? чей?', mark: '~~~' },
  { id: 'D', label: 'Обстоятельство', hint: 'где? куда? когда? как?', mark: '-·-·-' },
];

/** Adjacent tokens of the same member (same syn + m) go under one continuous underline. */
function groupMembers(tokens: Token[]) {
  const groups: { syn?: string; items: { t: Token; ti: number }[] }[] = [];
  tokens.forEach((t, ti) => {
    const last = groups[groups.length - 1];
    if (t.syn && last?.syn === t.syn && last.items[last.items.length - 1].t.m === t.m) last.items.push({ t, ti });
    else groups.push({ syn: t.syn, items: [{ t, ti }] });
  });
  return groups;
}

const PAD_BEFORE = 0.04;
const PAD_AFTER = 0.08;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Reader({ slug, data, gloss, counts }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rangeRef = useRef<Range | null>(null);

  const [voiceId, setVoiceId] = useState(data.voices[0].id);
  const voice = data.voices.find((v) => v.id === voiceId) ?? data.voices[0];
  const lesson = useMemo(() => withVoice(data, voice), [data, voice]);
  // sentence to continue from after switching voice (applied once the new audio is loaded)
  const switchSentRef = useRef(-1);

  // Flat lists for binary search: every timed word, and every sentence.
  const { words, sents } = useMemo(() => {
    const words: Timed[] = [];
    const sents: { pi: number; si: number; start: number; end: number }[] = [];
    lesson.paragraphs.forEach((p, pi) =>
      p.sentences.forEach((s, si) => {
        const gsi = sents.length;
        sents.push({ pi, si, start: s.start, end: s.end });
        s.tokens.forEach((t, ti) => {
          if (t.start != null && t.end != null) words.push({ id: `${pi}.${si}.${ti}`, si: gsi, start: t.start, end: t.end });
        });
      }),
    );
    return { words, sents };
  }, [lesson]);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [activeSent, setActiveSent] = useState(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [repeat, setRepeatState] = useState(false);
  const repeatRef = useRef(false);
  const setRepeat = (v: boolean) => { repeatRef.current = v; setRepeatState(v); };
  const [rate, setRate] = useState(1);
  const [showFreq, setShowFreq] = useState(true);
  const [showTrans, setShowTrans] = useState(true);
  const [showSyntax, setShowSyntax] = useState(false);
  const [saved, setSaved] = useState<Record<string, SavedWord>>({});

  // Load prefs/saved words after mount (localStorage is client-only).
  useEffect(() => {
    const p = { rate: 1, showFreq: true, showTrans: true, showSyntax: false, voice: '', ...load(KEY_PREFS, {}) };
    setRate(clampRate(Number(p.rate) || 1));
    if (data.voices.some((v) => v.id === p.voice)) setVoiceId(p.voice);
    setShowFreq(p.showFreq);
    setShowTrans(p.showTrans);
    setShowSyntax(!!p.showSyntax);
    setSaved(load(KEY_SAVED, {}));
  }, []);
  useEffect(
    () => save(KEY_PREFS, { rate, showFreq, showTrans, showSyntax, voice: voiceId }),
    [rate, showFreq, showTrans, showSyntax, voiceId],
  );

  const changeVoice = (id: string) => {
    if (id === voice.id) return;
    audioRef.current?.pause();
    rangeRef.current = null;
    startFromRef.current = null; // word times differ per voice; a selected word is re-timed on use
    switchSentRef.current = activeSent;
    setVoiceId(id);
  };
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const locate = useCallback(
    (t: number) => {
      // last word with start <= t
      let lo = 0, hi = words.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      const w = idx >= 0 ? words[idx] : null;
      setActiveWord(w && t <= w.end + 0.25 ? w.id : null);
      setActiveSent(w ? w.si : -1);
      setTime(t);
    },
    [words],
  );

  // Stop or loop at the end of the current range. Returns true if playback was stopped.
  const checkRange = useCallback(() => {
    const a = audioRef.current;
    const r = rangeRef.current;
    if (!a || !r || a.currentTime < r.end) return false;
    if (r.loop) { a.currentTime = r.start; return false; }
    a.pause();
    rangeRef.current = null;
    setActiveWord(null); // the padding after a word already belongs to the next one
    return true;
  }, []);

  // Timer loop while playing: highlight + range end. setInterval, not requestAnimationFrame:
  // rAF is suspended when the window is hidden/occluded and the range would never stop.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const a = audioRef.current;
      if (a && !checkRange()) locate(a.currentTime);
    }, 30);
    return () => clearInterval(id);
  }, [playing, locate, checkRange]);

  const playRange = useCallback((start: number, end: number | null, loop = false) => {
    const a = audioRef.current;
    if (!a) return;
    rangeRef.current = end == null ? null : { start: Math.max(0, start), end, loop };
    a.currentTime = Math.max(0, start);
    void a.play();
  }, []);

  const playSentence = useCallback(
    (gsi: number, continueAfter = false) => {
      const s = sents[gsi];
      if (!s) return;
      if (repeatRef.current) playRange(s.start - PAD_BEFORE, s.end + PAD_AFTER, true);
      else playRange(s.start - PAD_BEFORE, continueAfter ? null : s.end + PAD_AFTER);
    },
    [sents, playRange],
  );

  /** Pause/Continue for one sentence: pauses if it is playing, otherwise resumes from
   *  where it was paused inside this sentence (or starts it), stopping at its end. */
  // Set by clicking a word: the next "Continue" in that sentence starts from this word.
  // Used once; any playback start clears it (see onPlay), so a later Continue resumes normally.
  const startFromRef = useRef<{ gsi: number; time: number } | null>(null);

  /** Sentence and start time for a word: a hair before it, not before the gap to the previous word. */
  const wordStart = (id: string) => {
    const i = words.findIndex((w) => w.id === id);
    if (i < 0) return null;
    const prev = words[i - 1];
    const floor = prev && prev.si === words[i].si ? (prev.end + words[i].start) / 2 : 0;
    return { gsi: words[i].si, time: Math.max(floor, words[i].start - 0.03) };
  };

  const playFrom = (gsi: number, time: number) => {
    const a = audioRef.current;
    const s = sents[gsi];
    if (!a || !s) return;
    rangeRef.current = repeatRef.current
      ? { start: s.start - PAD_BEFORE, end: s.end + PAD_AFTER, loop: true }
      : { start: time, end: s.end + PAD_AFTER, loop: false };
    a.currentTime = time;
    void a.play();
  };

  const toggleSentence = (gsi: number) => {
    const a = audioRef.current;
    const s = sents[gsi];
    if (!a || !s) return;
    if (!a.paused && activeSent === gsi) { a.pause(); return; }
    // 1) a word was just clicked in this sentence -> start from it
    const from = startFromRef.current;
    if (from && from.gsi === gsi) { playFrom(gsi, from.time); return; }
    const t = a.currentTime;
    const inside = activeSent === gsi && t >= s.start - PAD_BEFORE && t < s.end;
    if (!inside) {
      // 2) finished / not started: from the still-selected word of this sentence, else from the start
      const sel = selected ? wordStart(selected) : null;
      if (sel && sel.gsi === gsi) playFrom(gsi, sel.time);
      else playSentence(gsi);
      return;
    }
    // 3) paused in the middle of this sentence -> resume where it stopped
    rangeRef.current = repeatRef.current
      ? { start: s.start - PAD_BEFORE, end: s.end + PAD_AFTER, loop: true }
      : { start: t, end: s.end + PAD_AFTER, loop: false };
    void a.play();
  };

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    if (a.ended || a.currentTime >= lesson.duration - 0.05) a.currentTime = 0;
    if (repeat && activeSent >= 0) { playSentence(activeSent); return; }
    rangeRef.current = null;
    void a.play();
  }, [lesson.duration, repeat, activeSent, playSentence]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const cur = activeSent < 0 ? (dir === 1 ? -1 : 0) : activeSent;
      const next = Math.min(sents.length - 1, Math.max(0, cur + dir));
      playSentence(next, true);
    },
    [activeSent, sents.length, playSentence],
  );

  const toggleRepeat = () => {
    const on = !repeatRef.current;
    setRepeat(on);
    const a = audioRef.current;
    if (!a) return;
    if (on && activeSent >= 0) {
      const s = sents[activeSent];
      rangeRef.current = { start: s.start - PAD_BEFORE, end: s.end + PAD_AFTER, loop: true };
    } else if (!on && rangeRef.current?.loop) {
      rangeRef.current = null;
    }
  };

  const tokenAt = (id: string) => {
    const [pi, si, ti] = id.split('.').map(Number);
    return lesson.paragraphs[pi].sentences[si].tokens[ti];
  };

  const clipFor = (t: Token) => lesson.clips?.[t.pos === 'PROPN' ? t.t : t.t.toLowerCase()];

  /** The word as spoken in the text: cut from the lesson audio between its neighbours. */
  const playInText = (id: string) => {
    const t = tokenAt(id);
    if (t.start == null || t.end == null) return;
    audioRef.current?.pause();
    rangeRef.current = null;
    const i = words.findIndex((w) => w.id === id);
    void playCut(lesson.audio, t.start, t.end, words[i - 1]?.end ?? null, words[i + 1]?.start ?? null);
  };

  /** Click on a word: play only that word (isolated recording), never its neighbours. */
  const clickWord = (id: string) => {
    const t = tokenAt(id);
    setSelected(id);
    startFromRef.current = wordStart(id);
    audioRef.current?.pause();
    rangeRef.current = null;
    const clip = clipFor(t);
    if (clip) playClip(clip);
    else playInText(id);
  };

  useEffect(() => preloadCut(lesson.audio), [lesson.audio]);

  const toggleSave = (id: string) => {
    const t = tokenAt(id);
    if (!t.key) return;
    const next = { ...saved };
    if (next[t.key]) delete next[t.key];
    else
      next[t.key] = {
        key: t.key, word: t.t, lemma: t.lemma ?? t.t, ru: gloss[t.key] ?? '', slug,
        title: lesson.title, start: t.start ?? 0, end: t.end ?? 0, audio: lesson.audio, clip: clipFor(t),
        savedAt: Date.now(),
      };
    setSaved(next);
    save(KEY_SAVED, next);
  };

  // Click anywhere outside the selected word deselects it (and closes the word card).
  // Other words, the card and controls are excluded: a word click selects that word,
  // and "Continue" must still see the selection to start from it.
  useEffect(() => {
    if (!selected) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest('.w, .card, button, input, select, textarea, a, label')) return;
      setSelected(null);
      startFromRef.current = null;
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [selected]);

  // Keyboard: Space play/pause, ←/→ sentences, R repeat, −/+ speed by 0.01, Esc close card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'r' || e.key === 'к') toggleRepeat();
      else if (e.key === '-' || e.key === '_') setRate((r) => clampRate(r - RATE_STEP));
      else if (e.key === '+' || e.key === '=') setRate((r) => clampRate(r + RATE_STEP));
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onEnded = () => {
    setPlaying(false);
    const done = load<Record<string, number>>(KEY_DONE, {});
    done[slug] = Date.now();
    save(KEY_DONE, done);
  };

  const sel = selected ? tokenAt(selected) : null;
  let gsiCounter = 0;

  return (
    <div class={`reader${showFreq ? ' freq' : ''}${showSyntax ? ' syntax' : ''}`}>
      <audio
        ref={audioRef}
        src={audioUrl(lesson.audio)}
        preload="auto"
        onPlay={() => { stopWord(); startFromRef.current = null; setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onEnded={onEnded}
        onTimeUpdate={checkRange}
        onSeeked={(e) => locate((e.currentTarget as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget as HTMLAudioElement;
          a.playbackRate = rate;
          // after a voice switch: same sentence, new voice's timing
          const gsi = switchSentRef.current;
          switchSentRef.current = -1;
          // exactly at the sentence start (not before it: that is still the previous sentence)
          a.currentTime = gsi >= 0 && sents[gsi] ? sents[gsi].start + 0.001 : 0;
          locate(a.currentTime);
        }}
      />

      <div class="toolbar">
        <button class={showFreq ? 'on' : ''} onClick={() => setShowFreq(!showFreq)} aria-pressed={showFreq}>
          Частотность
        </button>
        <button class={showTrans ? 'on' : ''} onClick={() => setShowTrans(!showTrans)} aria-pressed={showTrans}>
          Перевод
        </button>
        <button class={showSyntax ? 'on' : ''} onClick={() => setShowSyntax(!showSyntax)} aria-pressed={showSyntax}>
          Разбор
        </button>
      </div>

      {showSyntax && (
        <div class="legend syntax-legend">
          {SYNTAX.map((r) => (
            <span title={r.hint}><span class={`syn syn-${r.id}`}>{r.label}</span></span>
          ))}
        </div>
      )}

      {showFreq && (
        <div class="legend">
          {BANDS.map((b) => (
            <span class={`w b${b.id}`} title={b.hint}>{b.label}</span>
          ))}
        </div>
      )}

      <div class="text" lang="nl">
        {lesson.paragraphs.map((p, pi) => {
          // Translations: English first, Russian right below it.
          const perSentence = showTrans && p.sentences.some((s) => s.en || s.ru);
          return (
            <div class="para">
              <div class="para-box">
                <div class="sents">
                  {p.sentences.map((s, si) => {
                    const gsi = gsiCounter++;
                    return (
                      <span class={`sent${gsi === activeSent ? ' cur' : ''}`}>
                        <span class="s-ctl">
                          <button class="s-play" title="Проиграть предложение заново" onClick={() => playSentence(gsi)}>
                            <IconRestart />
                          </button>
                          {playing && gsi === activeSent ? (
                            <button class="s-play on" title="Пауза" onClick={() => toggleSentence(gsi)}><IconPause /></button>
                          ) : (
                            <button class="s-play" title="Продолжить" onClick={() => toggleSentence(gsi)}><IconPlay /></button>
                          )}
                        </span>
                        {groupMembers(s.tokens).map((g) => {
                          const word = ({ t, ti }: { t: Token; ti: number }) => {
                            const id = `${pi}.${si}.${ti}`;
                            if (!t.key) return <>{t.t}</>;
                            const cls = `w b${band(t.zipf).id}${activeWord === id ? ' act' : ''}${selected === id ? ' sel' : ''}`;
                            return <span class={cls} onClick={() => clickWord(id)}>{t.t}</span>;
                          };
                          const last = g.items[g.items.length - 1];
                          const trailing = last.t.ws ? ' ' : '';
                          // spaces inside a member are underlined with it, the one after it is not
                          const inner = g.items.map((it, k) => (
                            <>{word(it)}{k < g.items.length - 1 && it.t.ws ? ' ' : ''}</>
                          ));
                          return showSyntax && g.syn ? (
                            <><span class={`syn syn-${g.syn}`}>{inner}</span>{trailing}</>
                          ) : (
                            <>{inner}{trailing}</>
                          );
                        })}{' '}
                        {perSentence && s.en && <span class="tr en" lang="en">{s.en}</span>}
                        {perSentence && s.ru && <span class="tr ru" lang="ru">{s.ru}</span>}
                      </span>
                    );
                  })}
                </div>
                {showTrans && !perSentence && p.en && <p class="tr en" lang="en">{p.en}</p>}
                {showTrans && !perSentence && p.ru && <p class="tr ru" lang="ru">{p.ru}</p>}
              </div>
              <button
                class="para-play"
                title="Проиграть абзац"
                onClick={() => playRange(p.sentences[0].start - PAD_BEFORE, p.sentences[p.sentences.length - 1].end + PAD_AFTER)}
              >
                <IconPlay />
              </button>
            </div>
          );
        })}
      </div>

      {sel && sel.key && (
        <div class="card" role="dialog" aria-label="Слово">
          <div class="card-head">
            <button class="icon" title="Слово отдельно" onClick={() => clickWord(selected!)}>🔊</button>
            <div class="card-word" lang="nl">
              <strong>{sel.t}</strong>
              {sel.lemma && sel.lemma !== sel.t.toLowerCase() && <span class="muted"> → {sel.lemma}</span>}
              <span class="muted pos"> · {POS_RU[sel.pos ?? ''] ?? sel.pos}</span>
            </div>
            <button class="icon" title="Закрыть" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div class="card-ru">{gloss[sel.key] || <span class="muted">перевод ещё не добавлен</span>}</div>
          <div class="card-meta">
            <span class={`w b${band(sel.zipf).id}`}>{band(sel.zipf).label}</span>
            <span class="muted">Zipf {sel.zipf?.toFixed(1)}</span>
            <span class="muted">в {counts[sel.key] ?? 1} ур.</span>
            <button class="pill pill-play" title="Как звучит в тексте" onClick={() => playInText(selected!)}>
              <IconPlay size={12} /><span>в тексте</span>
            </button>
            <button class={saved[sel.key] ? 'pill pill-star on' : 'pill pill-star'} onClick={() => toggleSave(selected!)}>
              <IconStar size={15} filled={!!saved[sel.key]} /><span>{saved[sel.key] ? 'В моих словах' : 'В мои слова'}</span>
            </button>
          </div>
        </div>
      )}

      <div class="player">
        <input
          type="range" min={0} max={lesson.duration} step={0.01} value={time} aria-label="Позиция"
          onInput={(e) => {
            const a = audioRef.current!;
            rangeRef.current = null;
            a.currentTime = Number((e.currentTarget as HTMLInputElement).value);
          }}
        />
        <div class="controls">
          <span class="muted time">{fmt(time)} / {fmt(lesson.duration)}</span>
          <div class="transport">
            <button class="icon" title="Предыдущее предложение (←)" onClick={() => step(-1)}><IconPrev size={18} /></button>
            <button class="primary play" title="Пробел" onClick={toggle}>{playing ? <IconPause size={18} /> : <IconPlay size={18} />}</button>
            <button class="icon" title="Следующее предложение (→)" onClick={() => step(1)}><IconNext size={18} /></button>
            <button class={repeat ? 'on repeat' : 'repeat'} title="Повторять предложение (R)" onClick={toggleRepeat} aria-pressed={repeat}>
              <IconRepeat size={18} />
            </button>
          </div>
          <div class="settings">
            {data.voices.length > 1 && (
              <span class="voice">
                <select
                  value={voice.id}
                  onChange={(e) => changeVoice((e.currentTarget as HTMLSelectElement).value)}
                  aria-label="Голос"
                  title="Голос"
                >
                  {data.voices.map((v) => (
                    <option value={v.id}>{v.name}</option>
                  ))}
                </select>
                <IconChevron size={14} />
              </span>
            )}
            <SpeedControl rate={rate} onChange={setRate} />
          </div>
        </div>
      </div>
    </div>
  );
}

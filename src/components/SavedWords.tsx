import { useEffect, useState } from 'preact/hooks';
import { KEY_SAVED, load, save, type SavedWord } from '../lib/shared';
import { playClip, playCut } from '../lib/wordAudio';

/** Words saved before lessons had several voices point to the old single-voice files
 *  (/audio/words/x.mp3, /audio/<slug>.mp3); that voice was Fenna. */
function upgradePaths(w: SavedWord) {
  return {
    clip: w.clip?.replace(/^\/audio\/words\/([^/]+\.mp3)$/, '/audio/words/fenna/$1'),
    audio: w.audio.replace(/^\/audio\/([^/]+)\.mp3$/, '/audio/$1/fenna.mp3'),
  };
}

export default function SavedWords() {
  const [words, setWords] = useState<Record<string, SavedWord> | null>(null);

  useEffect(() => setWords(load(KEY_SAVED, {})), []);

  // Words saved before isolated clips existed fall back to a cut from the lesson audio.
  const play = (w: SavedWord) => {
    const { clip, audio } = upgradePaths(w);
    return clip ? playClip(clip) : playCut(audio, w.start, w.end, null, null);
  };

  const remove = (key: string) => {
    const next = { ...words };
    delete next[key];
    setWords(next);
    save(KEY_SAVED, next);
  };

  if (!words) return null;
  const list = Object.values(words).sort((a, b) => b.savedAt - a.savedAt);
  if (list.length === 0)
    return <p class="muted">Пока пусто. В уроке нажмите на слово и выберите «☆ В мои слова».</p>;

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <ul class="saved">
      {list.map((w) => (
        <li key={w.key}>
          <button class="icon" title="Прослушать" onClick={() => play(w)}>🔊</button>
          <span lang="nl" class="lemma">{w.lemma}</span>
          <span class="ru">{w.ru || <span class="muted">—</span>}</span>
          <a class="muted src" href={`${base}/lesson/${w.slug}`}>{w.title}</a>
          <button class="icon" title="Удалить" onClick={() => remove(w.key)}>✕</button>
        </li>
      ))}
    </ul>
  );
}

// Playing single words: an isolated TTS clip, or a sample-accurate cut from the lesson audio.
import { audioUrl } from './shared';

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

export function stopWord() {
  try { current?.stop(); } catch { /* already stopped */ }
  current = null;
}

/** Isolated word recording — contains only this word. TTS clips start with ~0.2 s of
 *  silence and end with ~1 s of it; play just the sound so it starts right on click. */
export async function playClip(path: string) {
  stopWord();
  ctx ??= new AudioContext();
  await ctx.resume();
  const buf = await getBuffer(path);
  const ch = buf.getChannelData(0);
  let first = 0;
  let last = ch.length - 1;
  while (first < last && Math.abs(ch[first]) < SILENCE) first++;
  while (last > first && Math.abs(ch[last]) < SILENCE) last--;
  const a = Math.max(0, first / buf.sampleRate - 0.02);
  const b = Math.min(buf.duration, last / buf.sampleRate + 0.08);
  playSegment(buf, a, b, 0.004);
}

const SILENCE = 0.01;

function getBuffer(path: string): Promise<AudioBuffer> {
  ctx ??= new AudioContext();
  let p = buffers.get(path);
  if (!p) {
    p = fetch(audioUrl(path)).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b));
    buffers.set(path, p);
  }
  return p;
}

/** Start decoding ahead of the first click so it plays without delay. */
export function preloadCut(path: string) {
  void getBuffer(path).catch(() => buffers.delete(path));
}

const STEP = 0.002;
const WIN = 0.01;

function rms(ch: Float32Array, sr: number, t: number) {
  const n = Math.floor(WIN * sr);
  const i = Math.floor(t * sr - n / 2);
  let s = 0;
  for (let k = Math.max(0, i); k < Math.min(ch.length, i + n); k++) s += ch[k] * ch[k];
  return Math.sqrt(s / n);
}

/** Quietest point in [from, to] — where one word hands over to the next. */
function valley(ch: Float32Array, sr: number, from: number, to: number) {
  let best = from;
  let bestV = Infinity;
  for (let t = from; t <= to; t += STEP) {
    const v = rms(ch, sr, t);
    if (v < bestV) { bestV = v; best = t; }
  }
  return best;
}

/**
 * Play [start, end] of the lesson audio as heard in the text. TTS word timings are
 * only accurate to ~±50 ms, so each boundary with a neighbouring word is moved to the
 * nearest energy minimum, and the edges are faded to avoid clicks.
 */
export async function playCut(path: string, start: number, end: number, prevEnd: number | null, nextStart: number | null) {
  stopWord();
  ctx ??= new AudioContext();
  await ctx.resume();
  const buf = await getBuffer(path);
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const len = end - start;

  let a = Math.max(0, start - 0.03);
  if (prevEnd != null && start - prevEnd < 0.15) {
    const bd = (prevEnd + start) / 2;
    a = valley(ch, sr, bd - 0.06, Math.min(bd + 0.06, start + len * 0.4));
  }
  let b = Math.min(buf.duration, end + 0.05);
  if (nextStart != null && nextStart - end < 0.15) {
    const bd = (end + nextStart) / 2;
    b = valley(ch, sr, Math.max(bd - 0.06, start + len * 0.6), bd + 0.06);
  }

  playSegment(buf, a, b, 0.008);
}

/** Play buf[a..b] with short fades so cut edges don't click. */
function playSegment(buf: AudioBuffer, a: number, b: number, fadeIn: number) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  const t0 = c.currentTime + 0.01;
  const dur = b - a;
  const fadeOut = Math.min(0.025, dur / 4);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + fadeIn);
  gain.gain.setValueAtTime(1, t0 + dur - fadeOut);
  gain.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(gain).connect(c.destination);
  src.start(t0, a, dur);
  current = src;
}

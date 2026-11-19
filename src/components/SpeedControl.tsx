import { useEffect, useRef, useState } from 'preact/hooks';
import { IconMinus, IconPlus } from './Icons';

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const RATE_STEP = 0.01;

export const clampRate = (r: number) =>
  Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(r * 100) / 100));

type Props = { rate: number; onChange: (r: number) => void };

/** −  [1.00×]  +  — step 0.01. Hold a button to keep changing (speeds up the longer
 *  it is held). The value can also be typed; double-click it to reset to 1.00. */
export default function SpeedControl({ rate, onChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const timer = useRef<number>();

  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => stop, []);

  const startHold = (dir: 1 | -1) => {
    stop();
    let n = 0;
    const tick = () => {
      onChange(clampRate(rateRef.current + dir * RATE_STEP));
      n++;
      // first repeat after 400 ms, then every 80 ms, then every 30 ms
      timer.current = window.setTimeout(tick, n === 1 ? 400 : n < 15 ? 80 : 30);
    };
    tick();
  };

  const holdProps = (dir: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => { e.preventDefault(); startHold(dir); },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(clampRate(rate + dir * RATE_STEP)); }
    },
  });

  // Read the field itself, not `draft`: state may not have re-rendered yet when
  // typing and leaving the field happen back to back.
  const commit = (el: HTMLInputElement) => {
    const text = el.value.trim();
    const v = Number(text.replace(',', '.'));
    const ok = text !== '' && Number.isFinite(v);
    if (ok) onChange(clampRate(v));
    // Show the applied value even when it equals the previous one (Preact would not
    // touch the field then, leaving e.g. an empty or "5" in it).
    el.value = (ok ? clampRate(v) : rate).toFixed(2);
    setDraft(null);
  };

  return (
    <div class="speed" role="group" aria-label="Скорость воспроизведения">
      <button class="step" title="Медленнее на 0.01 (−)" aria-label="Медленнее" {...holdProps(-1)}><IconMinus size={14} /></button>
      <span class="val">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Скорость"
          title="Скорость. Двойной клик — сбросить на 1.00"
          value={draft ?? rate.toFixed(2)}
          onFocus={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onBlur={(e) => commit(e.currentTarget as HTMLInputElement)}
          onDblClick={() => { setDraft(null); onChange(1); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            else if (e.key === 'Escape') { setDraft(null); (e.currentTarget as HTMLInputElement).blur(); }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              setDraft(null);
              onChange(clampRate(rate + (e.key === 'ArrowUp' ? RATE_STEP : -RATE_STEP)));
            }
          }}
        />
        <span class="x">×</span>
      </span>
      <button class="step" title="Быстрее на 0.01 (+)" aria-label="Быстрее" {...holdProps(1)}><IconPlus size={14} /></button>
    </div>
  );
}

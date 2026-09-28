import { useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

export type DemoPhase = 'typing' | 'finished' | 'stopped';

/**
 * Idle landing demo. It types each example once (a single loop), so the live
 * patches appear on their own, then leaves the last example in place as a
 * clickable suggestion ("finished"). It never touches the real input value.
 *
 * - While typing, any interaction (pointer, key, wheel, touch) stops it.
 * - `stop()` is also called by the composer when the input is focused or hovered.
 * - With reduced motion it skips straight to "finished".
 */
export function useAutoDemo(examples: string[], enabled: boolean) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<DemoPhase>(reduce ? 'finished' : 'typing');
  const [text, setText] = useState(reduce ? examples[examples.length - 1] : '');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    setPhase('stopped');
    setText('');
  }, []);

  // Reduced motion (possibly resolved after mount): show the final example statically.
  useEffect(() => {
    if (reduce && phase === 'typing') {
      clearTimeout(timer.current);
      setText(examples[examples.length - 1]);
      setPhase('finished');
    }
  }, [reduce, phase, examples]);

  // While typing, the first real interaction anywhere ends the demo.
  useEffect(() => {
    if (phase !== 'typing' || !enabled) return;
    const opts = { capture: true, passive: true } as const;
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, stop, opts));
    return () => events.forEach((e) => window.removeEventListener(e, stop, opts));
  }, [phase, enabled, stop]);

  useEffect(() => {
    if (!enabled || phase !== 'typing' || reduce) return;
    let ex = 0;
    let i = 0;
    const tick = () => {
      const target = examples[ex];
      if (i <= target.length) {
        setText(target.slice(0, i));
        i++;
        // A little human jitter; pause slightly after spaces.
        const delay = 40 + Math.random() * 40 + (target[i - 2] === ' ' ? 60 : 0);
        timer.current = setTimeout(tick, i === 1 ? 600 : delay);
      } else if (ex < examples.length - 1) {
        timer.current = setTimeout(() => {
          setText('');
          ex++;
          i = 0;
          timer.current = setTimeout(tick, 380);
        }, 2000);
      } else {
        setPhase('finished'); // one loop only: the last example stays as a suggestion
      }
    };
    tick();
    return () => clearTimeout(timer.current);
  }, [enabled, phase, reduce, examples]);

  const active = enabled && phase !== 'stopped';
  return {
    text: active ? text : '',
    active,
    typing: active && phase === 'typing',
    finished: active && phase === 'finished',
    stop,
  };
}

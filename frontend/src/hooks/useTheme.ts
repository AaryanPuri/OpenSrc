import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { KEYS } from '../lib/storage';
import { useLocalStorage } from './useLocalStorage';

export type Theme = 'dark' | 'light';

const media = () => window.matchMedia?.('(prefers-color-scheme: light)');

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => unknown };

/** Light (paper) by default when the OS is light, night quilt when dark; persists a manual pick. */
export function useTheme() {
  const [stored, setStored] = useLocalStorage<Theme | null>(KEYS.theme, null);
  const [system, setSystem] = useState<Theme>(() => (media()?.matches ? 'light' : 'dark'));

  useEffect(() => {
    const m = media();
    if (!m) return;
    const onChange = () => setSystem(m.matches ? 'light' : 'dark');
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = stored ?? system;

  useEffect(() => {
    const root = document.documentElement;
    if (stored) root.dataset.theme = stored;
    else delete root.dataset.theme;
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute('content', theme === 'dark' ? '#1b1930' : '#f5eee1'));
  }, [stored, theme]);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const doc = document as DocWithVT;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Crossfade the whole page between palettes instead of a hard flip.
    if (doc.startViewTransition && !reduce) {
      doc.startViewTransition(() => {
        flushSync(() => setStored(next));
        document.documentElement.dataset.theme = next;
      });
    } else {
      setStored(next);
    }
  };
  return { theme, toggle };
}

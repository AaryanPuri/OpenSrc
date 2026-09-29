import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { KEYS } from '../lib/storage';
import { useLocalStorage } from './useLocalStorage';
import { useMediaQuery } from './useMediaQuery';

export type Theme = 'dark' | 'light';

type DocWithVT = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Light (paper) by default when the OS is light, night quilt when dark; persists a manual pick.
 * On the server this reports 'dark'. The inline script in index.html sets the real
 * data-theme before first paint, and the Header keeps its theme glyph neutral until hydrated.
 */
export function useTheme() {
  const [stored, setStored] = useLocalStorage<Theme | null>(KEYS.theme, null);
  const system: Theme = useMediaQuery('(prefers-color-scheme: light)') ? 'light' : 'dark';
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

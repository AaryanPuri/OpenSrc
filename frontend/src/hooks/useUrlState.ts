import { useCallback, useEffect, useState } from 'react';
import type { SortKey } from '../lib/types';

export interface UrlState {
  q: string;
  sort: SortKey;
  demo: boolean;
  /**
   * True whenever a `q` param is present, even an empty one. Removing the
   * last patch keeps you on the results layout (`?q=`) instead of bouncing
   * back to the landing hero.
   */
  browsing: boolean;
}

const SORTS: SortKey[] = ['best', 'newest', 'comments'];

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get('sort') as SortKey | null;
  const demo = p.get('demo');
  const q = p.get('q');
  return {
    q: q?.trim() ?? '',
    sort: sort && SORTS.includes(sort) ? sort : 'best',
    demo: demo === '1' || demo === 'true',
    browsing: q !== null,
  };
}

/** `?q=…&sort=…&demo=1` ⇄ state. Pushes history entries for new searches. */
export function useUrlState() {
  const [state, setState] = useState<UrlState>(readUrl);

  useEffect(() => {
    const onPop = () => setState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch: Partial<UrlState>, mode: 'push' | 'replace' = 'push') => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (patch.q && patch.browsing === undefined) next.browsing = true;
      const p = new URLSearchParams(window.location.search);
      if (next.browsing) p.set('q', next.q);
      else p.delete('q');
      if (next.sort !== 'best') p.set('sort', next.sort);
      else p.delete('sort');
      if (next.demo) p.set('demo', '1');
      else p.delete('demo');
      const qs = p.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
      if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
      }
      return next;
    });
  }, []);

  return [state, update] as const;
}

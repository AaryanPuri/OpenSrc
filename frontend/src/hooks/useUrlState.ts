import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
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

function readParams(p: URLSearchParams): UrlState {
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

/**
 * `?q=…&sort=…&demo=1` ⇄ state, read from the router so back/forward just work.
 * `update` pushes a history entry by default (new searches) or replaces it.
 * Pass `pathname` to move to another page while carrying the params over.
 */
export function useUrlState() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => readParams(params), [params]);

  // `update` reads the latest URL through a ref so its identity stays stable.
  const latest = useRef({ location, state, navigate });
  useEffect(() => {
    latest.current = { location, state, navigate };
  });

  const update = useCallback((patch: Partial<UrlState>, mode: 'push' | 'replace' = 'push', pathname?: string) => {
    const { location: loc, state: prev, navigate: go } = latest.current;
    const next = { ...prev, ...patch };
    if (patch.q && patch.browsing === undefined) next.browsing = true;
    const p = new URLSearchParams(loc.search);
    // Only the params in `patch` are rewritten, so other pages' params (the directory's
    // `sort=stars`, `first=1`) survive e.g. the demo toggle in the header.
    if ('q' in patch || 'browsing' in patch) {
      if (next.browsing) p.set('q', next.q);
      else p.delete('q');
    }
    if ('sort' in patch) {
      if (next.sort !== 'best') p.set('sort', next.sort);
      else p.delete('sort');
    }
    if ('demo' in patch) {
      if (next.demo) p.set('demo', '1');
      else p.delete('demo');
    }
    const qs = p.toString();
    const to = { pathname: pathname ?? loc.pathname, search: qs ? `?${qs}` : '', hash: loc.hash };
    if (to.pathname === loc.pathname && to.search === loc.search) return;
    go(to, { replace: mode === 'replace' });
  }, []);

  return [state, update] as const;
}

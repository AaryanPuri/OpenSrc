import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { REPO_SORTS, type RepoSort } from '../lib/repoSearch';

export interface RepoUrlState {
  q: string;
  /** A `q` param is present (even empty): the directory shows results rather than its landing. */
  browsing: boolean;
  sort: RepoSort;
  /** `first=1`: only first-PR friendly repos. */
  first: boolean;
  demo: boolean;
}

function read(p: URLSearchParams): RepoUrlState {
  const q = p.get('q');
  const sort = p.get('sort') as RepoSort | null;
  const demo = p.get('demo');
  return {
    q: q?.trim() ?? '',
    browsing: q !== null,
    sort: sort && REPO_SORTS.includes(sort) ? sort : 'score',
    first: p.get('first') === '1',
    demo: demo === '1' || demo === 'true',
  };
}

/**
 * The directory's `?q=&sort=&first=1` ⇄ state, like useUrlState for issues.
 * Only the params in a patch are rewritten; everything else in the URL stays.
 */
export function useRepoUrlState() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => read(params), [params]);

  const latest = useRef({ location, navigate });
  useEffect(() => {
    latest.current = { location, navigate };
  });

  const update = useCallback(
    (patch: Partial<Omit<RepoUrlState, 'browsing' | 'demo'>>, mode: 'push' | 'replace' = 'push') => {
      const { location: loc, navigate: go } = latest.current;
      const p = new URLSearchParams(loc.search);
      if (patch.q !== undefined) p.set('q', patch.q);
      if (patch.sort !== undefined) {
        if (patch.sort === 'score') p.delete('sort');
        else p.set('sort', patch.sort);
      }
      if (patch.first !== undefined) {
        if (patch.first) p.set('first', '1');
        else p.delete('first');
      }
      const qs = p.toString();
      const search = qs ? `?${qs}` : '';
      if (search === loc.search) return;
      go({ pathname: loc.pathname, search, hash: loc.hash }, { replace: mode === 'replace' });
    },
    [],
  );

  return [state, update] as const;
}

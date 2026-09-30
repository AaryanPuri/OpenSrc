import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_SIZE, SearchError, searchIssues } from '../lib/search';
import type { Issue, SearchNotice, SortKey } from '../lib/types';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface State {
  status: SearchStatus;
  items: Issue[];
  total: number;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  source: 'github' | 'sample' | null;
  notice?: SearchNotice;
  relaxed?: boolean;
  error?: string;
  /** The query the current results (or error) belong to; null while none has settled. */
  query: string | null;
}

const INITIAL: State = {
  status: 'idle',
  items: [],
  total: 0,
  page: 1,
  hasMore: false,
  loadingMore: false,
  source: null,
  query: null,
};

/**
 * Runs `searchIssues` whenever the GitHub query / sort changes; supports load-more.
 *
 * Every new search bumps a generation counter and aborts any in-flight
 * load-more, and responses from an older generation are dropped. Without
 * this, "Load more" followed by a new query could append the previous
 * query's page 2 to the new results.
 */
export function useSearch(ghQuery: string | null, sort: SortKey, token: string | null, demo: boolean) {
  // Start in "loading" when there is a query, so the first paint already
  // reserves the skeleton space (avoids a layout shift on cold loads).
  const [state, setState] = useState<State>(() => (ghQuery ? { ...INITIAL, status: 'loading' } : INITIAL));
  const mainCtrl = useRef<AbortController | null>(null);
  const moreCtrl = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const gen = ++generation.current;
    mainCtrl.current?.abort();
    moreCtrl.current?.abort();
    moreCtrl.current = null;
    if (!ghQuery) {
      setState(INITIAL);
      return;
    }
    const c = new AbortController();
    mainCtrl.current = c;
    setState((s) => ({ ...INITIAL, status: 'loading', items: s.status === 'success' ? s.items : [] }));
    searchIssues(ghQuery, { sort, token, demo, signal: c.signal, perPage: PAGE_SIZE, page: 1 })
      .then((r) => {
        if (c.signal.aborted || gen !== generation.current) return;
        setState({
          ...INITIAL,
          status: 'success',
          items: r.items,
          total: r.total,
          hasMore: r.hasMore,
          source: r.source,
          notice: r.notice,
          relaxed: r.relaxed,
          query: ghQuery,
        });
      })
      .catch((e: unknown) => {
        if (c.signal.aborted || gen !== generation.current) return;
        const message =
          e instanceof SearchError ? e.message : 'Something went wrong while searching. Please try again.';
        setState({ ...INITIAL, status: 'error', error: message, query: ghQuery });
      });
    return () => c.abort();
  }, [ghQuery, sort, token, demo, nonce]);

  useEffect(() => () => moreCtrl.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (!ghQuery || !state.hasMore || state.loadingMore) return;
    const gen = generation.current;
    const page = state.page + 1;
    const c = new AbortController();
    moreCtrl.current?.abort();
    moreCtrl.current = c;
    setState((s) => ({ ...s, loadingMore: true }));
    const stale = () => c.signal.aborted || gen !== generation.current;
    searchIssues(ghQuery, { sort, token, demo, perPage: PAGE_SIZE, page, signal: c.signal })
      .then((r) => {
        if (stale()) return;
        setState((s) => {
          const seen = new Set(s.items.map((i) => `${i.id}`));
          return {
            ...s,
            loadingMore: false,
            page,
            items: [...s.items, ...r.items.filter((i) => !seen.has(`${i.id}`))],
            hasMore: r.hasMore,
            // A mid-session fallback to samples is surfaced but doesn't wipe results.
            notice: r.notice ?? s.notice,
          };
        });
      })
      .catch(() => {
        if (stale()) return;
        setState((s) => ({ ...s, loadingMore: false, hasMore: false }));
      });
  }, [ghQuery, sort, token, demo, state.hasMore, state.loadingMore, state.page]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, loadMore, retry };
}

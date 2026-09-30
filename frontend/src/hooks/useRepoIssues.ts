import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoRecord } from '../../../shared/repo';
import { fetchRepoIssues, RepoIssuesError, type IssueTab, type TabCounts } from '../lib/repoIssues';
import type { Issue } from '../lib/types';

export type RepoIssuesStatus = 'loading' | 'success' | 'rate-limited' | 'not-found' | 'error';

interface State {
  status: RepoIssuesStatus;
  items: Issue[];
  hasMore: boolean;
  next: string | null;
  loadingMore: boolean;
  /** Epoch ms when GitHub's rate limit resets (rate-limited only), if known. */
  resetAt?: number;
  /** The tab these results (or this error) belong to. */
  tab: IssueTab | null;
}

const LOADING: State = { status: 'loading', items: [], hasMore: false, next: null, loadingMore: false, tab: null };

/**
 * A repo page's live issues for one tab, newest first, with "load more" by cursor. The
 * exact per-tab counts come with every answer (when the source has them) and are kept
 * across tab switches. Every new tab or retry bumps a generation, so a late answer for an
 * earlier tab never lands on the current one.
 */
export function useRepoIssues(repo: Pick<RepoRecord, 'fullName' | 'issueLabels'>, tab: IssueTab, token: string | null) {
  const [state, setState] = useState<State>(LOADING);
  const [counts, setCounts] = useState<TabCounts | null>(null);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const moreCtrl = useRef<AbortController | null>(null);
  const labelsKey = repo.issueLabels.join(',');

  useEffect(() => {
    const gen = ++generation.current;
    moreCtrl.current?.abort();
    const c = new AbortController();
    setState((s) => ({ ...LOADING, items: s.tab === tab && s.status === 'success' ? s.items : [] }));
    fetchRepoIssues(repo, tab, { token, signal: c.signal })
      .then((page) => {
        if (c.signal.aborted || gen !== generation.current) return;
        if (page.counts) setCounts(page.counts);
        setState({
          status: 'success',
          items: page.items,
          hasMore: page.hasMore,
          next: page.next,
          loadingMore: false,
          tab,
        });
      })
      .catch((err: unknown) => {
        if (c.signal.aborted || gen !== generation.current) return;
        const e = err instanceof RepoIssuesError ? err : null;
        setState({
          ...LOADING,
          tab,
          status: e?.kind === 'rate_limited' ? 'rate-limited' : e?.kind === 'not_found' ? 'not-found' : 'error',
          resetAt: e?.resetAt,
        });
      });
    return () => c.abort();
    // `repo` is read through fullName and its labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.fullName, labelsKey, tab, token, nonce]);

  useEffect(() => () => moreCtrl.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (state.status !== 'success' || !state.hasMore || !state.next || state.loadingMore) return;
    const gen = generation.current;
    const c = new AbortController();
    moreCtrl.current?.abort();
    moreCtrl.current = c;
    setState((s) => ({ ...s, loadingMore: true }));
    const stale = () => c.signal.aborted || gen !== generation.current;
    fetchRepoIssues(repo, tab, { token, after: state.next, signal: c.signal })
      .then((page) => {
        if (stale()) return;
        if (page.counts) setCounts(page.counts);
        setState((s) => {
          const seen = new Set(s.items.map((i) => i.id));
          return {
            ...s,
            loadingMore: false,
            items: [...s.items, ...page.items.filter((i) => !seen.has(i.id))],
            hasMore: page.hasMore,
            next: page.next,
          };
        });
      })
      .catch(() => {
        if (stale()) return;
        // Keep what is shown; the tab's GitHub link has the rest.
        setState((s) => ({ ...s, loadingMore: false, hasMore: false }));
      });
  }, [repo, tab, token, state.status, state.hasMore, state.next, state.loadingMore]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, counts, loadMore, retry };
}

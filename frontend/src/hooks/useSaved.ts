import { useCallback, useEffect, useRef } from 'react';
import type { RepoRecord } from '../../../shared/repo';
import {
  fromServerItems,
  issueKey,
  normalizeSearch,
  repoKey,
  savedApi,
  searchKey,
  serverIssue,
  syncOnLogin,
  type SavedApi,
  type SavedIssue,
  type SavedKind,
  type SavedRepo,
  type SavedSearch,
} from '../lib/savedSync';
import type { SessionState } from '../lib/session';
import { KEYS } from '../lib/storage';
import type { Issue } from '../lib/types';
import { useLocalStorage } from './useLocalStorage';

export type { SavedIssue, SavedRepo, SavedSearch };

export type RepoLike = Pick<
  RepoRecord,
  'fullName' | 'owner' | 'description' | 'languageName' | 'stars' | 'goodFirstIssues'
>;

/** localStorage keys for a user's offline copy (signed-out saves keep the plain keys). */
const userKey = (base: string, id: number | null) => `${base}:u:${id ?? 'none'}`;

const SIGNED_OUT: Pick<SessionState, 'status' | 'user'> = { status: 'anon', user: null };

/**
 * Saved issues, repos and searches.
 *
 * Signed out: exactly as before, in localStorage. Signed in: the server is the source
 * of truth; changes show at once (optimistic) and are sent to `/api/saved`, and a
 * per-user localStorage copy keeps them visible offline. The first sign-in on a
 * browser imports its signed-out saves once; nothing local is ever deleted by it.
 */
export function useSaved(session: Pick<SessionState, 'status' | 'user'> = SIGNED_OUT, api: SavedApi = savedApi) {
  const userId = session.status === 'user' && session.user ? session.user.id : null;

  const [anonIssues, setAnonIssues] = useLocalStorage<SavedIssue[]>(KEYS.saved, []);
  const [anonRepos, setAnonRepos] = useLocalStorage<SavedRepo[]>(KEYS.savedRepos, []);
  const [anonSearches, setAnonSearches] = useLocalStorage<SavedSearch[]>(KEYS.savedSearches, []);
  const [userIssues, setUserIssues] = useLocalStorage<SavedIssue[]>(userKey(KEYS.saved, userId), []);
  const [userRepos, setUserRepos] = useLocalStorage<SavedRepo[]>(userKey(KEYS.savedRepos, userId), []);
  const [userSearches, setUserSearches] = useLocalStorage<SavedSearch[]>(userKey(KEYS.savedSearches, userId), []);

  const signedIn = userId !== null;
  const saved = signedIn ? userIssues : anonIssues;
  const savedRepos = signedIn ? userRepos : anonRepos;
  const savedSearches = signedIn ? userSearches : anonSearches;
  const setSaved = signedIn ? setUserIssues : setAnonIssues;
  const setSavedRepos = signedIn ? setUserRepos : setAnonRepos;
  const setSavedSearches = signedIn ? setUserSearches : setAnonSearches;

  // Latest signed-out lists, read when a sign-in starts the import.
  const anon = useRef({ issues: anonIssues, repos: anonRepos, searches: anonSearches });
  useEffect(() => {
    anon.current = { issues: anonIssues, repos: anonRepos, searches: anonSearches };
  }, [anonIssues, anonRepos, anonSearches]);

  const applyServer = useCallback(
    (lists: ReturnType<typeof fromServerItems>) => {
      setUserIssues(lists.issues);
      setUserRepos(lists.repos);
      setUserSearches(lists.searches);
    },
    [setUserIssues, setUserRepos, setUserSearches],
  );

  // On sign-in (or a page load while signed in): import once, then load the server's lists.
  useEffect(() => {
    if (userId === null) return;
    let live = true;
    syncOnLogin({ userId, local: anon.current, api })
      .then((lists) => {
        if (live) applyServer(lists);
      })
      .catch(() => {
        /* offline: keep showing the local copy */
      });
    return () => {
      live = false;
    };
  }, [userId, api, applyServer]);

  /** Sends one change; on failure reloads the server's lists so the view doesn't lie. */
  const push = useCallback(
    (op: 'put' | 'remove', kind: SavedKind, key: string, payload?: unknown) => {
      if (!signedIn) return;
      const req = op === 'put' ? api.put(kind, key, payload) : api.remove(kind, key);
      req.catch(() =>
        api
          .list()
          .then((items) => applyServer(fromServerItems(items)))
          .catch(() => {}),
      );
    },
    [signedIn, api, applyServer],
  );

  const isSaved = useCallback(
    (issue: Pick<Issue, 'htmlUrl' | 'id'>) => saved.some((s) => issueKey(s) === issueKey(issue)),
    [saved],
  );

  const toggle = useCallback(
    (issue: Issue) => {
      const key = issueKey(issue);
      const had = saved.some((s) => issueKey(s) === key);
      const entry: SavedIssue = { ...issue, savedAt: new Date().toISOString() };
      setSaved((prev) => (had ? prev.filter((s) => issueKey(s) !== key) : [entry, ...prev]));
      push(had ? 'remove' : 'put', 'issue', key, had ? undefined : serverIssue(entry));
    },
    [saved, setSaved, push],
  );

  const remove = useCallback(
    (issue: Issue) => {
      setSaved((prev) => prev.filter((s) => issueKey(s) !== issueKey(issue)));
      push('remove', 'issue', issueKey(issue));
    },
    [setSaved, push],
  );

  const isRepoSaved = useCallback(
    (fullName: string) => savedRepos.some((r) => repoKey(r.fullName) === repoKey(fullName)),
    [savedRepos],
  );

  const toggleRepo = useCallback(
    (repo: RepoLike) => {
      const key = repoKey(repo.fullName);
      const had = savedRepos.some((r) => repoKey(r.fullName) === key);
      const entry: SavedRepo = {
        fullName: repo.fullName,
        owner: repo.owner,
        description: repo.description,
        languageName: repo.languageName,
        stars: repo.stars,
        goodFirstIssues: repo.goodFirstIssues,
        savedAt: new Date().toISOString(),
      };
      setSavedRepos((prev) => (had ? prev.filter((r) => repoKey(r.fullName) !== key) : [entry, ...prev]));
      push(had ? 'remove' : 'put', 'repo', key, had ? undefined : entry);
    },
    [savedRepos, setSavedRepos, push],
  );

  const removeRepo = useCallback(
    (fullName: string) => {
      setSavedRepos((prev) => prev.filter((r) => repoKey(r.fullName) !== repoKey(fullName)));
      push('remove', 'repo', repoKey(fullName));
    },
    [setSavedRepos, push],
  );

  const isSearchSaved = useCallback(
    (scope: SavedSearch['scope'], q: string) => savedSearches.some((s) => searchKey(s) === searchKey({ scope, q })),
    [savedSearches],
  );

  const toggleSearch = useCallback(
    (scope: SavedSearch['scope'], q: string) => {
      const text = normalizeSearch(q);
      if (!text) return;
      const key = searchKey({ scope, q: text });
      const had = savedSearches.some((s) => searchKey(s) === key);
      const entry: SavedSearch = { scope, q: text, savedAt: new Date().toISOString() };
      setSavedSearches((prev) => (had ? prev.filter((s) => searchKey(s) !== key) : [entry, ...prev]));
      push(had ? 'remove' : 'put', 'search', key, had ? undefined : entry);
    },
    [savedSearches, setSavedSearches, push],
  );

  const removeSearch = useCallback(
    (s: SavedSearch) => {
      setSavedSearches((prev) => prev.filter((x) => searchKey(x) !== searchKey(s)));
      push('remove', 'search', searchKey(s));
    },
    [setSavedSearches, push],
  );

  const clear = useCallback(() => {
    if (signedIn) {
      for (const i of saved) push('remove', 'issue', issueKey(i));
      for (const r of savedRepos) push('remove', 'repo', repoKey(r.fullName));
      for (const s of savedSearches) push('remove', 'search', searchKey(s));
    }
    setSaved([]);
    setSavedRepos([]);
    setSavedSearches([]);
  }, [signedIn, saved, savedRepos, savedSearches, push, setSaved, setSavedRepos, setSavedSearches]);

  return {
    saved,
    isSaved,
    toggle,
    remove,
    savedRepos,
    isRepoSaved,
    toggleRepo,
    removeRepo,
    savedSearches,
    isSearchSaved,
    toggleSearch,
    removeSearch,
    clear,
  };
}

import { useCallback } from 'react';
import type { RepoRecord } from '../../../shared/repo';
import type { Issue } from '../lib/types';
import { KEYS } from '../lib/storage';
import { useLocalStorage } from './useLocalStorage';

export interface SavedIssue extends Issue {
  savedAt: string;
}

/** A bookmarked repo: a small snapshot, so the drawer works before the directory has loaded. */
export interface SavedRepo {
  fullName: string;
  owner: string;
  description: string | null;
  languageName: string | null;
  stars: number;
  goodFirstIssues: number;
  savedAt: string;
}

export type RepoLike = Pick<
  RepoRecord,
  'fullName' | 'owner' | 'description' | 'languageName' | 'stars' | 'goodFirstIssues'
>;

export function useSaved() {
  const [saved, setSaved] = useLocalStorage<SavedIssue[]>(KEYS.saved, []);
  const [savedRepos, setSavedRepos] = useLocalStorage<SavedRepo[]>(KEYS.savedRepos, []);

  const isSaved = useCallback(
    (issue: Pick<Issue, 'htmlUrl' | 'id'>) => saved.some((s) => key(s) === key(issue)),
    [saved],
  );

  const toggle = useCallback(
    (issue: Issue) =>
      setSaved((prev) =>
        prev.some((s) => key(s) === key(issue))
          ? prev.filter((s) => key(s) !== key(issue))
          : [{ ...issue, savedAt: new Date().toISOString() }, ...prev],
      ),
    [setSaved],
  );

  const remove = useCallback(
    (issue: Issue) => setSaved((prev) => prev.filter((s) => key(s) !== key(issue))),
    [setSaved],
  );

  const isRepoSaved = useCallback(
    (fullName: string) => savedRepos.some((r) => sameRepo(r.fullName, fullName)),
    [savedRepos],
  );

  const toggleRepo = useCallback(
    (repo: RepoLike) =>
      setSavedRepos((prev) =>
        prev.some((r) => sameRepo(r.fullName, repo.fullName))
          ? prev.filter((r) => !sameRepo(r.fullName, repo.fullName))
          : [
              {
                fullName: repo.fullName,
                owner: repo.owner,
                description: repo.description,
                languageName: repo.languageName,
                stars: repo.stars,
                goodFirstIssues: repo.goodFirstIssues,
                savedAt: new Date().toISOString(),
              },
              ...prev,
            ],
      ),
    [setSavedRepos],
  );

  const removeRepo = useCallback(
    (fullName: string) => setSavedRepos((prev) => prev.filter((r) => !sameRepo(r.fullName, fullName))),
    [setSavedRepos],
  );

  const clear = useCallback(() => {
    setSaved([]);
    setSavedRepos([]);
  }, [setSaved, setSavedRepos]);

  return { saved, isSaved, toggle, remove, savedRepos, isRepoSaved, toggleRepo, removeRepo, clear };
}

const key = (i: Pick<Issue, 'htmlUrl' | 'id'>) => `${i.id}:${i.htmlUrl}`;
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

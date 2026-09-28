import { useCallback } from 'react';
import type { Issue } from '../lib/types';
import { KEYS } from '../lib/storage';
import { useLocalStorage } from './useLocalStorage';

export interface SavedIssue extends Issue {
  savedAt: string;
}

export function useSaved() {
  const [saved, setSaved] = useLocalStorage<SavedIssue[]>(KEYS.saved, []);

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
  const clear = useCallback(() => setSaved([]), [setSaved]);

  return { saved, isSaved, toggle, remove, clear };
}

const key = (i: Pick<Issue, 'htmlUrl' | 'id'>) => `${i.id}:${i.htmlUrl}`;

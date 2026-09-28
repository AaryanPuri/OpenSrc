import { useEffect, useReducer } from 'react';
import { cachedAiParse, checkLlmAvailable, fetchAiParse } from '../lib/aiParse';
import type { ParsedQuery } from '../lib/parseQuery';

/**
 * Claude's reading of `q`, or null while it's pending / unavailable (callers
 * show the local rules parse meanwhile). Probes `/api/health` once on mount.
 */
export function useAiParse(q: string, enabled: boolean): ParsedQuery | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    void checkLlmAvailable();
  }, []);

  useEffect(() => {
    if (!enabled || !q.trim() || cachedAiParse(q)) return;
    let live = true;
    fetchAiParse(q).then((parsed) => {
      if (live && parsed) rerender();
    });
    return () => {
      live = false;
    };
  }, [q, enabled]);

  return enabled ? (cachedAiParse(q) ?? null) : null;
}

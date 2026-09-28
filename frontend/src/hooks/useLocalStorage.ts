import { useCallback, useEffect, useState } from 'react';

const EVENT = 'opensrc:storage';

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // A bare (non-JSON) string, e.g. written by an older version or by hand.
    return typeof fallback === 'string' || fallback === null ? ((raw ?? fallback) as T) : fallback;
  }
}

/** JSON-backed localStorage state, synced across hook instances and tabs. */
export function useLocalStorage<T>(key: string, initialFallback: T) {
  // Callers pass literals (`[]`, `null`) whose identity changes every render. Pin the
  // first one so the effect/callback below stay stable and don't re-subscribe each render.
  const [fallback] = useState(initialFallback);
  const [value, setValue] = useState<T>(() => read(key, fallback));

  useEffect(() => {
    const sync = (e: Event) => {
      if (e instanceof StorageEvent && e.key !== null && e.key !== key) return;
      if (e instanceof CustomEvent && e.detail !== key) return;
      setValue(read(key, fallback));
    };
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, [key, fallback]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(read(key, fallback)) : next;
      try {
        if (resolved === null || resolved === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* storage unavailable (private mode) — keep in memory only */
      }
      setValue(resolved);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key, fallback],
  );

  return [value, set] as const;
}

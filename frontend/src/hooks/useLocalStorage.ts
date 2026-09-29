import { useCallback, useState, useSyncExternalStore } from 'react';

const EVENT = 'opensrc:storage';

/** Values that could not be written to localStorage (private mode, quota): kept in memory instead. */
const memory = new Map<string, string | null>();

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, raw: string | null) {
  try {
    if (raw === null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
    memory.delete(key);
  } catch {
    /* storage unavailable (private mode): keep in memory only */
    memory.set(key, raw);
  }
}

/** Last parse per key, so a snapshot keeps its identity until the stored string changes. */
const parsed = new Map<string, { raw: string; ok: boolean; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  let entry = parsed.get(key);
  if (!entry || entry.raw !== raw) {
    try {
      entry = { raw, ok: true, value: JSON.parse(raw) };
    } catch {
      entry = { raw, ok: false, value: undefined };
    }
    parsed.set(key, entry);
  }
  if (entry.ok) return entry.value as T;
  // A bare (non-JSON) string, e.g. written by an older version or by hand.
  return typeof fallback === 'string' || fallback === null ? (raw as T) : fallback;
}

function subscribe(key: string, onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const sync = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== null && e.key !== key) return;
    if (e instanceof CustomEvent && e.detail !== key) return;
    onChange();
  };
  window.addEventListener('storage', sync);
  window.addEventListener(EVENT, sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener(EVENT, sync);
  };
}

/**
 * JSON-backed localStorage state, synced across hook instances and tabs.
 * Renders the fallback on the server and during hydration.
 */
export function useLocalStorage<T>(key: string, initialFallback: T) {
  // Callers pass literals (`[]`, `null`) whose identity changes every render. Pin the
  // first one so snapshots and the setter stay stable.
  const [fallback] = useState(initialFallback);
  const subscribeKey = useCallback((onChange: () => void) => subscribe(key, onChange), [key]);
  const value = useSyncExternalStore(
    subscribeKey,
    () => read(key, fallback),
    () => fallback,
  );

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(read(key, fallback)) : next;
      writeRaw(key, resolved === null || resolved === undefined ? null : JSON.stringify(resolved));
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key, fallback],
  );

  return [value, set] as const;
}

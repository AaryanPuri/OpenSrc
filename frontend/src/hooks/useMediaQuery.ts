import { useCallback, useSyncExternalStore } from 'react';

const mql = (query: string) => (typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined);

/** Whether a media query matches; always false on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = mql(query);
      if (!m) return () => {};
      m.addEventListener('change', onChange);
      return () => m.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mql(query)?.matches ?? false,
    () => false,
  );
}

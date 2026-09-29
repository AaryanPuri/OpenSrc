import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False on the server and during hydration, true once the client has taken over. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

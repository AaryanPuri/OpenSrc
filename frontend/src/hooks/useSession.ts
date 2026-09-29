import { useSyncExternalStore } from 'react';
import { getSession, INITIAL_SESSION, subscribeSession, type SessionState } from '../lib/session';

/**
 * The signed-in user and the server's optional features. `unknown` with no features on
 * the server and during hydration, so pre-rendered HTML never depends on them.
 */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession, () => INITIAL_SESSION);
}

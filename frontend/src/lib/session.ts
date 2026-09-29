/**
 * Who is signed in, as a tiny external store (read with `useSession`).
 *
 * Nothing is known on the server or during hydration (`status: 'unknown'`), so the
 * pre-rendered HTML never depends on login. After hydration `startSession()` reads
 * `/api/health` and, when login is switched on, `/api/me`.
 */
import { getHealth, NO_FEATURES, type Health } from './health';

export interface SessionUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface SessionState {
  /** null until /api/health has answered. */
  features: Health | null;
  status: 'unknown' | 'anon' | 'user';
  user: SessionUser | null;
}

export const INITIAL_SESSION: SessionState = { features: null, status: 'unknown', user: null };
/** The last signed-in user, so saved items stay usable offline. */
const CACHE_KEY = 'opensrc:session-user';

let state: SessionState = INITIAL_SESSION;
const listeners = new Set<() => void>();

export const getSession = () => state;
export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(next: Partial<SessionState>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

/** Test hook. */
export function resetSession(): void {
  state = INITIAL_SESSION;
  started = null;
}

function cache(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
}
function cached(): SessionUser | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export async function refreshSession(): Promise<void> {
  const features = state.features ?? NO_FEATURES;
  if (!features.auth) {
    set({ status: 'anon', user: null });
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`/api/me ${res.status}`);
    const { user } = (await res.json()) as { user: SessionUser | null };
    cache(user);
    set({ status: user ? 'user' : 'anon', user });
  } catch {
    // Offline or the API is down: keep the last known user so their saved copy shows.
    const user = cached();
    set({ status: user ? 'user' : 'anon', user });
  }
}

let started: Promise<void> | null = null;

/** Once per page load, after hydration. */
export function startSession(): Promise<void> {
  if (!started) {
    started = getHealth().then(async (features) => {
      set({ features });
      await refreshSession();
    });
  }
  return started;
}

/** Where "Sign in with GitHub" goes; the server sends the browser back to `returnTo`. */
export function loginHref(returnTo: string): string {
  return `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    cache(null);
    set({ status: 'anon', user: null });
  }
}

/**
 * `/api/health`, fetched once per page session: whether the server has Claude parsing
 * and the optional features (login, newsletter). With no server (static hosting,
 * server down) everything reads as off.
 */

export interface Health {
  llm: boolean;
  auth: boolean;
  newsletter: boolean;
  db: boolean;
}

export const NO_FEATURES: Health = { llm: false, auth: false, newsletter: false, db: false };
export const HEALTH_TIMEOUT_MS = 4000;

let pending: Promise<Health> | null = null;

/** Test hook. */
export function resetHealth(): void {
  pending = null;
}

async function fetchHealth(): Promise<Health> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' }, signal: controller.signal });
    // A 404 or an HTML page (static hosting, proxy with no server behind it) means "no API here".
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return NO_FEATURES;
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j !== 'object' || j === null) return NO_FEATURES;
    return { llm: j.llm === true, auth: j.auth === true, newsletter: j.newsletter === true, db: j.db === true };
  } catch {
    return NO_FEATURES;
  } finally {
    clearTimeout(timer);
  }
}

export function getHealth(): Promise<Health> {
  if (!pending) pending = fetchHealth();
  return pending;
}

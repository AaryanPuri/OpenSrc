/**
 * Saved items on the server for signed-in users (`/api/saved`), and the one-time
 * import of what the browser saved before signing in.
 *
 * Local data is never deleted: signed-out saves stay under their own localStorage
 * keys, and a signed-in user's copy lives under per-user keys.
 */
import type { Issue } from './types';

export type SavedKind = 'issue' | 'repo' | 'search';

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

/** A saved directory (`repos`) or issue (`issues`) search. */
export interface SavedSearch {
  scope: 'repos' | 'issues';
  q: string;
  savedAt: string;
}

export interface SavedLists {
  issues: SavedIssue[];
  repos: SavedRepo[];
  searches: SavedSearch[];
}

export interface ServerItem {
  kind: SavedKind;
  key: string;
  payload: unknown;
  savedAt?: string;
}

export const normalizeSearch = (q: string) => q.trim().replace(/\s+/g, ' ');
export const issueKey = (i: Pick<Issue, 'htmlUrl' | 'id'>) => `${i.id}:${i.htmlUrl}`;
export const repoKey = (fullName: string) => fullName.toLowerCase();
export const searchKey = (s: Pick<SavedSearch, 'scope' | 'q'>) => `${s.scope}:${normalizeSearch(s.q).toLowerCase()}`;

/** The server accepts at most this many items per import call. */
export const IMPORT_CHUNK = 500;
export const importFlagKey = (userId: number) => `opensrc:saved-imported:${userId}`;

/** The server stores at most 8 KB per item: an issue keeps only the start of its body. */
export const serverIssue = (i: SavedIssue): SavedIssue => ({ ...i, body: (i.body ?? '').slice(0, 600) });

export function toServerItems(lists: SavedLists): ServerItem[] {
  return [
    ...lists.repos.map((r) => ({ kind: 'repo' as const, key: repoKey(r.fullName), payload: r })),
    ...lists.issues.map((i) => ({ kind: 'issue' as const, key: issueKey(i), payload: serverIssue(i) })),
    ...lists.searches.map((s) => ({ kind: 'search' as const, key: searchKey(s), payload: s })),
  ];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Server items back into the drawer's lists (newest first), skipping anything malformed. */
export function fromServerItems(items: ServerItem[]): SavedLists {
  const out: SavedLists = { issues: [], repos: [], searches: [] };
  for (const it of items) {
    if (!isObj(it.payload)) continue;
    const savedAt = typeof it.payload.savedAt === 'string' ? it.payload.savedAt : (it.savedAt ?? '');
    const p: Record<string, unknown> = { ...it.payload, savedAt };
    if (it.kind === 'repo' && typeof p.fullName === 'string') out.repos.push(p as unknown as SavedRepo);
    else if (it.kind === 'issue' && typeof p.htmlUrl === 'string' && isObj(p.repo)) {
      out.issues.push(p as unknown as SavedIssue);
    } else if (it.kind === 'search' && typeof p.q === 'string' && (p.scope === 'repos' || p.scope === 'issues')) {
      out.searches.push(p as unknown as SavedSearch);
    }
  }
  const newest = (a: { savedAt: string }, b: { savedAt: string }) => b.savedAt.localeCompare(a.savedAt);
  out.issues.sort(newest);
  out.repos.sort(newest);
  out.searches.sort(newest);
  return out;
}

export interface SavedApi {
  list(): Promise<ServerItem[]>;
  put(kind: SavedKind, key: string, payload: unknown): Promise<void>;
  remove(kind: SavedKind, key: string): Promise<void>;
  importItems(items: ServerItem[]): Promise<void>;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status}`);
  return res;
}
const itemPath = (kind: SavedKind, key: string) => `/api/saved/${kind}/${encodeURIComponent(key)}`;

export const savedApi: SavedApi = {
  async list() {
    return ((await (await call('/api/saved')).json()) as { items: ServerItem[] }).items;
  },
  async put(kind, key, payload) {
    await call(itemPath(kind, key), { method: 'PUT', body: JSON.stringify(payload) });
  },
  async remove(kind, key) {
    await call(itemPath(kind, key), { method: 'DELETE' });
  },
  async importItems(items) {
    await call('/api/saved/import', { method: 'POST', body: JSON.stringify({ items }) });
  },
};

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * On sign-in: the first time this user signs in on this browser, send the browser's
 * signed-out saves to the server (the server keeps its own copy of any duplicate).
 * Then return the server's lists, which are the source of truth from now on.
 * Never touches the signed-out lists.
 */
export async function syncOnLogin({
  userId,
  local,
  api = savedApi,
  storage = localStorage,
}: {
  userId: number;
  local: SavedLists;
  api?: SavedApi;
  storage?: FlagStorage;
}): Promise<SavedLists> {
  let imported = false;
  try {
    imported = storage.getItem(importFlagKey(userId)) !== null;
  } catch {
    /* storage unavailable: import (the server ignores duplicates) */
  }
  if (!imported) {
    const items = toServerItems(local);
    for (let i = 0; i < items.length; i += IMPORT_CHUNK) await api.importItems(items.slice(i, i + IMPORT_CHUNK));
    try {
      storage.setItem(importFlagKey(userId), new Date().toISOString());
    } catch {
      /* ignore */
    }
  }
  return fromServerItems(await api.list());
}

import { describe, expect, it, vi } from 'vitest';
import {
  fromServerItems,
  IMPORT_CHUNK,
  importFlagKey,
  searchKey,
  syncOnLogin,
  toServerItems,
  type SavedApi,
  type SavedIssue,
  type SavedLists,
  type SavedRepo,
  type ServerItem,
} from './savedSync';

const repo = (fullName: string, savedAt = '2026-09-01T00:00:00.000Z'): SavedRepo => ({
  fullName,
  owner: fullName.split('/')[0],
  description: null,
  languageName: 'Rust',
  stars: 10,
  goodFirstIssues: 3,
  savedAt,
});

const issue = (id: number, body = 'short'): SavedIssue =>
  ({
    id,
    number: id,
    title: `Issue ${id}`,
    body,
    htmlUrl: `https://github.com/acme/db/issues/${id}`,
    repo: { fullName: 'acme/db', owner: 'acme', name: 'db', url: 'https://github.com/acme/db', avatarUrl: '' },
    labels: [],
    comments: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    savedAt: '2026-09-02T00:00:00.000Z',
  }) as unknown as SavedIssue;

const LOCAL: SavedLists = {
  repos: [repo('Acme/DB')],
  issues: [issue(1)],
  searches: [{ scope: 'repos', q: 'beginner  rust ', savedAt: '2026-09-03T00:00:00.000Z' }],
};

/** An in-memory /api/saved with the server's import semantics (existing keys win). */
function fakeApi(initial: ServerItem[] = []) {
  const store = new Map(initial.map((i) => [`${i.kind}|${i.key}`, i]));
  const api: SavedApi = {
    list: vi.fn(async () => [...store.values()]),
    put: vi.fn(async (kind, key, payload) => void store.set(`${kind}|${key}`, { kind, key, payload })),
    remove: vi.fn(async (kind, key) => void store.delete(`${kind}|${key}`)),
    importItems: vi.fn(async (items: ServerItem[]) => {
      for (const i of items) if (!store.has(`${i.kind}|${i.key}`)) store.set(`${i.kind}|${i.key}`, i);
    }),
  };
  return { api, store };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

describe('toServerItems / fromServerItems', () => {
  it('keys repos case-insensitively and searches by scope + normalized text', () => {
    const items = toServerItems(LOCAL);
    expect(items.map((i) => `${i.kind}|${i.key}`)).toEqual([
      'repo|acme/db',
      'issue|1:https://github.com/acme/db/issues/1',
      'search|repos:beginner rust',
    ]);
    expect(searchKey({ scope: 'issues', q: '  Good  First ' })).toBe('issues:good first');
  });

  it('trims long issue bodies so every item stays under the server limit', () => {
    const [item] = toServerItems({ repos: [], searches: [], issues: [issue(2, 'x'.repeat(20_000))] });
    expect(JSON.stringify(item.payload).length).toBeLessThan(8 * 1024);
  });

  it('round-trips, newest first, and skips malformed payloads', () => {
    const lists = fromServerItems([
      ...toServerItems(LOCAL),
      { kind: 'repo', key: 'z/z', payload: repo('z/z', '2026-09-09T00:00:00.000Z') },
      { kind: 'repo', key: 'bad', payload: 'nope' },
      { kind: 'issue', key: 'bad', payload: { title: 'no url' } },
      { kind: 'search', key: 'bad', payload: { q: 'x', scope: 'elsewhere' } },
    ]);
    expect(lists.repos.map((r) => r.fullName)).toEqual(['z/z', 'Acme/DB']);
    expect(lists.issues).toHaveLength(1);
    expect(lists.searches).toEqual([LOCAL.searches[0]]);
  });
});

describe('syncOnLogin', () => {
  it("imports the browser's saves once per user, then returns the server's lists", async () => {
    const { api } = fakeApi([{ kind: 'repo', key: 'other/repo', payload: repo('other/repo') }]);
    const storage = memoryStorage();
    const lists = await syncOnLogin({ userId: 7, local: LOCAL, api, storage });
    expect(api.importItems).toHaveBeenCalledTimes(1);
    expect(storage.map.has(importFlagKey(7))).toBe(true);
    expect(lists.repos.map((r) => r.fullName).sort()).toEqual(['Acme/DB', 'other/repo']);
    expect(lists.issues).toHaveLength(1);
    expect(lists.searches).toHaveLength(1);

    // Second sign-in on this browser: no import, even with new local saves.
    const again = await syncOnLogin({
      userId: 7,
      local: { ...LOCAL, repos: [...LOCAL.repos, repo('new/one')] },
      api,
      storage,
    });
    expect(api.importItems).toHaveBeenCalledTimes(1);
    expect(again.repos.map((r) => r.fullName)).not.toContain('new/one');
  });

  it('imports again for a different user on the same browser', async () => {
    const { api } = fakeApi();
    const storage = memoryStorage();
    await syncOnLogin({ userId: 1, local: LOCAL, api, storage });
    await syncOnLogin({ userId: 2, local: LOCAL, api, storage });
    expect(api.importItems).toHaveBeenCalledTimes(2);
  });

  it('never changes the local lists it was given', async () => {
    const { api } = fakeApi();
    const local = structuredClone(LOCAL);
    await syncOnLogin({ userId: 1, local, api, storage: memoryStorage() });
    expect(local).toEqual(LOCAL);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('keeps the server copy of an item saved on both sides', async () => {
    const { api } = fakeApi([{ kind: 'repo', key: 'acme/db', payload: { ...repo('Acme/DB'), stars: 999 } }]);
    const lists = await syncOnLogin({ userId: 1, local: LOCAL, api, storage: memoryStorage() });
    expect(lists.repos).toHaveLength(1);
    expect(lists.repos[0].stars).toBe(999);
  });

  it('sends big imports in chunks of 500', async () => {
    const { api } = fakeApi();
    const many = Array.from({ length: IMPORT_CHUNK * 2 + 3 }, (_, i) => repo(`o/r${i}`));
    await syncOnLogin({ userId: 1, local: { repos: many, issues: [], searches: [] }, api, storage: memoryStorage() });
    const sizes = vi.mocked(api.importItems).mock.calls.map(([items]) => items.length);
    expect(sizes).toEqual([500, 500, 3]);
  });

  it("doesn't mark the import done when it fails, so the next sign-in retries", async () => {
    const { api } = fakeApi();
    vi.mocked(api.importItems).mockRejectedValueOnce(new Error('offline'));
    const storage = memoryStorage();
    await expect(syncOnLogin({ userId: 1, local: LOCAL, api, storage })).rejects.toThrow('offline');
    expect(storage.map.has(importFlagKey(1))).toBe(false);
    await syncOnLogin({ userId: 1, local: LOCAL, api, storage });
    expect(api.importItems).toHaveBeenCalledTimes(2);
    expect(storage.map.has(importFlagKey(1))).toBe(true);
  });
});

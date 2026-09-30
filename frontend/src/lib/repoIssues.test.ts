import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRepoIssues, repoTabLabels, resetRepoIssuesState, RepoIssuesError } from './repoIssues';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Stub fetch, routing `/api/*` (our API) and api.github.com separately. */
function route(api: Handler, github: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return url.startsWith('/api/') ? api(url, init) : github(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const repo = { fullName: 'JuliaLang/julia', issueLabels: ['good first issue', 'help wanted'] };

const wireIssue = (n: number, extra: Record<string, unknown> = {}) => ({
  id: n,
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/JuliaLang/julia/issues/${n}`,
  repo: {
    fullName: 'JuliaLang/julia',
    owner: 'JuliaLang',
    avatarUrl: '',
    url: 'https://github.com/JuliaLang/julia',
  },
  labels: [{ name: 'good first issue', color: '7057ff' }],
  comments: 0,
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  bodyExcerpt: '',
  author: 'octo',
  assigned: false,
  ...extra,
});

const restIssue = (n: number, extra: Record<string, unknown> = {}) => ({
  id: n,
  number: n,
  title: `REST ${n}`,
  html_url: `https://github.com/JuliaLang/julia/issues/${n}`,
  labels: ['good first issue'],
  comments: 0,
  created_at: `2026-09-${String(n).padStart(2, '0')}T00:00:00Z`,
  updated_at: '2026-09-20T00:00:00Z',
  user: { login: 'octo' },
  assignees: [],
  ...extra,
});

beforeEach(() => resetRepoIssuesState());
afterEach(() => vi.unstubAllGlobals());

describe('fetchRepoIssues', () => {
  it("asks the API with the repo's own label spellings, and keeps the exact counts", async () => {
    const fetch = route(
      () =>
        json({
          items: [wireIssue(2, { assigned: true }), wireIssue(1)],
          hasMore: true,
          next: 'abc',
          counts: { all: 3648, gfi: 64, help: 92 },
          labels: { gfi: ['good first issue'], help: ['help wanted'] },
          source: 'github',
          via: 'graphql',
        }),
      () => {
        throw new Error('no GitHub call expected');
      },
    );
    const page = await fetchRepoIssues(repo, 'gfi');
    expect(page.counts).toEqual({ all: 3648, gfi: 64, help: 92 });
    expect(page.items.map((i) => [i.number, !!i.assigned])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(page.next).toBe('abc');
    const url = new URL(String(fetch.mock.calls[0][0]), 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      repo: 'JuliaLang/julia',
      tab: 'gfi',
      gfi: 'good first issue',
      help: 'help wanted',
    });
  });

  it('falls back to GitHub REST (never samples) when the Worker predates the endpoint', async () => {
    const calls: string[] = [];
    route(
      () => json({ error: 'not found' }, 404),
      (url) => {
        calls.push(url);
        return json([restIssue(3), restIssue(5), restIssue(4, { pull_request: {} })]);
      },
    );
    const page = await fetchRepoIssues(repo, 'gfi');
    expect(page.via).toBe('rest');
    expect(page.counts).toBeNull();
    expect(page.items.map((i) => i.number)).toEqual([5, 3]);
    expect(page.items.every((i) => i.repo.fullName === 'JuliaLang/julia' && !i.sample)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('https://api.github.com/repos/JuliaLang/julia/issues?');
    expect(calls[0]).toContain('labels=good+first+issue');
    expect(calls[0]).not.toContain('search');

    // Remembered for the session: the API isn't asked again.
    await fetchRepoIssues(repo, 'all');
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain('labels=');
  });

  it('falls back to GitHub when there is no API at all (static hosting)', async () => {
    route(
      () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => json([restIssue(1)]),
    );
    expect((await fetchRepoIssues(repo, 'help')).items).toHaveLength(1);
  });

  it('reports a rate limit instead of showing anything else', async () => {
    const github = vi.fn(() => json([]));
    route(() => json({ error: 'rate_limited', resetAt: 1_790_000_000_000 }, 429), github);
    const err = await fetchRepoIssues(repo, 'all').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoIssuesError);
    expect((err as RepoIssuesError).kind).toBe('rate_limited');
    expect((err as RepoIssuesError).resetAt).toBe(1_790_000_000_000);
    expect(github).not.toHaveBeenCalled();
  });

  it("uses the visitor's own token (GraphQL, exact counts) when the API is rate limited", async () => {
    const seen: RequestInit[] = [];
    route(
      () => json({ error: 'rate_limited', resetAt: null }, 429),
      (url, init) => {
        expect(url).toBe('https://api.github.com/graphql');
        seen.push(init!);
        return json({
          data: {
            repository: {
              all: { totalCount: 10 },
              gfi: { totalCount: 2 },
              help: { totalCount: 3 },
              page: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          },
        });
      },
    );
    const page = await fetchRepoIssues(repo, 'gfi', { token: 'mine' });
    expect(page.counts).toEqual({ all: 10, gfi: 2, help: 3 });
    expect((seen[0].headers as Record<string, string>).Authorization).toBe('Bearer mine');
  });

  it('a rate-limited direct call is a rate limit too', async () => {
    route(
      () => json({ error: 'not found' }, 404),
      () =>
        json({ message: 'API rate limit exceeded' }, 403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1790000033',
        }),
    );
    const err = (await fetchRepoIssues(repo, 'gfi').catch((e: unknown) => e)) as RepoIssuesError;
    expect(err.kind).toBe('rate_limited');
    expect(err.resetAt).toBe(1_790_000_033_000);
  });

  it("says when GitHub doesn't know the repo", async () => {
    route(
      () => json({ error: 'repo_not_found' }, 404),
      () => json([]),
    );
    const err = (await fetchRepoIssues(repo, 'gfi').catch((e: unknown) => e)) as RepoIssuesError;
    expect(err.kind).toBe('not_found');
  });
});

describe('repoTabLabels', () => {
  it("uses the repo's spellings per tab, else the common ones", () => {
    expect(repoTabLabels({ issueLabels: ['D-Trivial', 'help wanted'] })).toEqual({
      gfi: ['D-Trivial'],
      help: ['help wanted'],
    });
    const unknown = repoTabLabels({ issueLabels: [] });
    expect(unknown.gfi[0]).toBe('good first issue');
    expect(unknown.help[0]).toBe('help wanted');
  });
});

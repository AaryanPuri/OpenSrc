import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchFixtures, getFixtures } from './fixtures';
import { buildGitHubQuery, parseQuery } from './parseQuery';
import { PAGE_SIZE, resetSearchState, searchIssues, stripMarkdown } from './search';
import { approachability, labelStyle, timeAgo } from './format';

const gh = (text: string) => buildGitHubQuery(parseQuery(text));

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Stub fetch, routing `/api/*` (our server) and everything else (api.github.com) separately. */
function route(api: Handler | 'missing', github: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/')) {
      return api === 'missing'
        ? new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
        : api(url, init);
    }
    return github(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('fixtures', () => {
  it('ships ~30 sample issues', () => {
    expect(getFixtures().length).toBeGreaterThanOrEqual(30);
    expect(getFixtures().every((i) => i.sample)).toBe(true);
  });

  it('filters by language, label and domain term', () => {
    const r = searchFixtures(gh('beginner friendly rust issues in databases'));
    expect(r.relaxed).toBe(false);
    expect(r.items.length).toBeGreaterThan(0);
    for (const i of r.items) expect(i.repo.language).toBe('Rust');
    expect(r.items.map((i) => i.repo.fullName)).toContain('apache/datafusion');
  });

  it('matches beginner label aliases like "junior job" and "D-Good-First-Issue"', () => {
    const names = searchFixtures(gh('easy game dev')).items.map((i) => i.repo.fullName);
    expect(names).toEqual(expect.arrayContaining(['bevyengine/bevy', 'godotengine/godot']));
  });

  it('relaxes rather than returning nothing', () => {
    const r = searchFixtures(gh('haskell quantum teleportation'));
    expect(r.relaxed).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('honours comments:<N and created:> qualifiers', () => {
    const few = searchFixtures(gh('fewer than 3 comments'), { perPage: 50 });
    expect(few.relaxed).toBe(false);
    for (const i of few.items) expect(i.comments).toBeLessThan(3);
    const none = searchFixtures(gh('unanswered'), { perPage: 50 });
    for (const i of none.items) expect(i.comments).toBe(0);
    const week = searchFixtures(gh('this week'), { perPage: 50 });
    for (const i of week.items) expect(Date.now() - Date.parse(i.createdAt)).toBeLessThan(8 * 86_400_000);
  });

  it('sorts by fewest comments', () => {
    const items = searchFixtures(gh(''), { sort: 'comments', perPage: 50 }).items;
    for (let k = 1; k < items.length; k++) expect(items[k].comments).toBeGreaterThanOrEqual(items[k - 1].comments);
  });

  it('paginates', () => {
    const p1 = searchFixtures(gh(''), { perPage: 10, page: 1 });
    const p4 = searchFixtures(gh(''), { perPage: 10, page: 4 });
    expect(p1.hasMore).toBe(true);
    expect(p4.hasMore).toBe(false);
  });
});

describe('searchIssues', () => {
  beforeEach(() => resetSearchState());
  afterEach(() => vi.unstubAllGlobals());

  it('demo mode never hits the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await searchIssues(gh('python docs'), { demo: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.source).toBe('sample');
    expect(r.notice?.kind).toBe('demo');
  });

  it('falls back to samples on rate limit (direct path)', async () => {
    route(
      'missing',
      () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) },
        }),
    );
    const r = await searchIssues(gh('go kubernetes rate-limit-test'));
    expect(r.source).toBe('sample');
    expect(r.notice?.kind).toBe('rate-limit');
    expect(r.notice?.message).toMatch(/sample results/);
  });

  it('falls back to samples on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const r = await searchIssues(gh('network-failure-test'));
    expect(r.source).toBe('sample');
    expect(r.notice?.kind).toBe('network');
  });

  it('maps GitHub payloads and skips pull requests', async () => {
    const body = {
      total_count: 2,
      incomplete_results: false,
      items: [
        {
          id: 1,
          number: 42,
          title: 'Fix it',
          body: '## Hi\nSee [docs](http://x)',
          html_url: 'https://github.com/a/b/issues/42',
          repository_url: 'https://api.github.com/repos/a/b',
          labels: [{ name: 'bug', color: 'd73a4a' }],
          comments: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          user: { login: 'u', avatar_url: 'x' },
        },
        {
          id: 2,
          number: 43,
          title: 'PR',
          body: '',
          html_url: '',
          repository_url: 'https://api.github.com/repos/a/b',
          labels: [],
          comments: 0,
          created_at: '',
          updated_at: '',
          user: null,
          pull_request: {},
        },
      ],
    };
    route('missing', () => new Response(JSON.stringify(body), { status: 200 }));
    const r = await searchIssues(gh('mapping-test'));
    expect(r.source).toBe('github');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].repo).toMatchObject({ fullName: 'a/b', owner: 'a', name: 'b' });
    expect(r.items[0].body).toBe('Hi See docs');
  });

  it('rejects invalid queries with a SearchError (direct path)', async () => {
    route('missing', () => new Response('{}', { status: 422 }));
    await expect(searchIssues(gh('invalid-test'))).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('searchIssues via /api/search backend', () => {
  beforeEach(() => resetSearchState());
  afterEach(() => vi.unstubAllGlobals());

  const backendIssue = {
    id: 7,
    number: 99,
    title: 'Add SQL test',
    url: 'https://github.com/acme/db/issues/99',
    repo: {
      fullName: 'acme/db',
      owner: 'acme',
      avatarUrl: 'https://github.com/acme.png?size=64',
      url: 'https://github.com/acme/db',
      stars: 1200,
      language: 'Rust',
    },
    labels: [
      { name: 'good first issue', color: '7057ff' },
      { name: '', color: '' },
    ],
    comments: 3,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    bodyExcerpt: 'The database needs a test.',
    author: 'alice',
  };
  const liveBody = (items: unknown[], total = items.length) => ({
    parsed: null,
    githubQuery: 'x',
    total,
    items,
    source: 'github',
  });

  it('calls the backend with gq/page/sort, maps its Issue shape and skips GitHub', async () => {
    const q = gh('beginner rust databases backend-map');
    const f = route(
      () => json(liveBody([backendIssue], 57)),
      () => {
        throw new Error('direct GitHub must not be called');
      },
    );
    const r = await searchIssues(q, { page: 2 });

    expect(f).toHaveBeenCalledTimes(1);
    const url = new URL(String(f.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('gq')).toBe(q);
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('sort')).toBe('best');
    expect(url.searchParams.has('order')).toBe(false);

    expect(r.source).toBe('github');
    expect(r.total).toBe(57);
    expect(r.notice).toBeUndefined();
    expect(r.items).toEqual([
      {
        id: 7,
        number: 99,
        title: 'Add SQL test',
        body: 'The database needs a test.',
        htmlUrl: 'https://github.com/acme/db/issues/99',
        repo: {
          fullName: 'acme/db',
          owner: 'acme',
          name: 'db',
          htmlUrl: 'https://github.com/acme/db',
          language: 'Rust',
          stars: 1200,
        },
        labels: [{ name: 'good first issue', color: '7057ff' }],
        comments: 3,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-02T00:00:00Z',
        author: { login: 'alice', avatarUrl: 'https://github.com/alice.png?size=40' },
      },
    ]);
  });

  it('computes hasMore from the shared page size', async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, k) => ({ ...backendIssue, id: k }));
    route(
      () => json(liveBody(full, 45)),
      () => new Response('{}', { status: 500 }),
    );
    expect((await searchIssues(gh('hasmore-a'), { page: 1 })).hasMore).toBe(true);
    route(
      () => json(liveBody(full.slice(0, 5), 45)),
      () => new Response('{}', { status: 500 }),
    );
    expect((await searchIssues(gh('hasmore-b'), { page: 3 })).hasMore).toBe(false);
  });

  it('leaves stars/language undefined when the server did not enrich', async () => {
    const bare = { ...backendIssue, repo: { ...backendIssue.repo, stars: undefined, language: undefined } };
    route(
      () => json(liveBody([bare])),
      () => new Response('{}', { status: 500 }),
    );
    const [item] = (await searchIssues(gh('no-enrich'))).items;
    expect('stars' in item.repo).toBe(false);
    expect('language' in item.repo).toBe(false);
  });

  it('asks for fewest comments first', async () => {
    const f = route(
      () => json(liveBody([])),
      () => new Response('{}', { status: 500 }),
    );
    await searchIssues(gh('order-test'), { sort: 'comments' });
    const url = new URL(String(f.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('sort')).toBe('comments');
    expect(url.searchParams.get('order')).toBe('asc');
  });

  it('maps a server rate-limit fallback to a rate-limit notice with local samples', async () => {
    const reset = Math.floor(Date.now() / 1000) + 300;
    route(
      () =>
        json({
          ...liveBody([backendIssue]),
          source: 'fixtures',
          warning: "GitHub's search rate limit was reached on the server. Showing sample results meanwhile.",
          fallbackReason: 'rate-limit',
          rateLimit: { remaining: 0, reset },
        }),
      () => {
        throw new Error('direct GitHub must not be called');
      },
    );
    const r = await searchIssues(gh('rust server-rate-limit'));
    expect(r.source).toBe('sample');
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.sample)).toBe(true);
    expect(r.notice).toEqual({
      kind: 'rate-limit',
      message: "GitHub's search rate limit was reached on the server. Showing sample results meanwhile.",
      resetAt: reset * 1000,
    });
  });

  it('maps a server "unavailable" fallback to a network notice', async () => {
    route(
      () =>
        json({
          ...liveBody([]),
          source: 'fixtures',
          warning: 'Server could not reach GitHub.',
          fallbackReason: 'unavailable',
        }),
      () => new Response('{}', { status: 500 }),
    );
    const r = await searchIssues(gh('server-unavailable'));
    expect(r.source).toBe('sample');
    expect(r.notice).toEqual({ kind: 'network', message: 'Server could not reach GitHub.' });
  });

  it('surfaces a backend 422 as an invalid-query SearchError', async () => {
    const f = route(
      () => json({ error: 'bad', kind: 'invalid' }, 422),
      () => new Response('{}', { status: 200 }),
    );
    await expect(searchIssues(gh('backend-invalid'))).rejects.toMatchObject({ kind: 'invalid' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['404', () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })],
    [
      'an HTML page (static hosting)',
      () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ],
    [
      'a network error',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('falls back to GitHub on %s and stops probing for the session', async (_name, apiHandler) => {
    const f = route(
      apiHandler as Handler,
      () => new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), { status: 200 }),
    );
    const r1 = await searchIssues(gh(`probe-1 ${_name}`));
    expect(r1.source).toBe('github');
    const r2 = await searchIssues(gh(`probe-2 ${_name}`));
    expect(r2.source).toBe('github');
    const apiCalls = f.mock.calls.filter(([u]) => String(u).startsWith('/api/'));
    const ghCalls = f.mock.calls.filter(([u]) => String(u).startsWith('https://api.github.com/'));
    expect(apiCalls).toHaveLength(1);
    expect(ghCalls).toHaveLength(2);
  });

  it('uses GitHub for one request on a transient backend 5xx but keeps probing', async () => {
    const f = route(
      () => json({ error: 'internal error' }, 500),
      () => new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), { status: 200 }),
    );
    expect((await searchIssues(gh('transient-1'))).source).toBe('github');
    await searchIssues(gh('transient-2'));
    expect(f.mock.calls.filter(([u]) => String(u).startsWith('/api/'))).toHaveLength(2);
  });

  it('goes straight to GitHub when the user has their own token', async () => {
    const f = route(
      () => json(liveBody([backendIssue])),
      () => new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), { status: 200 }),
    );
    const r = await searchIssues(gh('user-token'), { token: 'ghp_x' });
    expect(r.source).toBe('github');
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/api\.github\.com\/search\/issues/);
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer ghp_x');
  });

  it('bypasses the backend for a non-default page size', async () => {
    const f = route(
      () => json(liveBody([])),
      () => new Response(JSON.stringify({ total_count: 0, incomplete_results: false, items: [] }), { status: 200 }),
    );
    await searchIssues(gh('page-size'), { perPage: 50 });
    expect(f.mock.calls.every(([u]) => !String(u).startsWith('/api/'))).toBe(true);
  });
});

describe('format helpers', () => {
  it('timeAgo', () => {
    const now = Date.parse('2026-09-26T00:00:00Z');
    expect(timeAgo('2026-09-23T00:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('2026-09-25T23:59:50Z', now)).toBe('just now');
  });

  it('labelStyle produces readable text', () => {
    const s = labelStyle('fef2c0', 'light');
    expect(s.color).toMatch(/^rgb\(/);
  });

  it('approachability favours fresh beginner issues', () => {
    const [a] = getFixtures();
    const fresh = approachability({ ...a, comments: 0, labels: [{ name: 'good first issue', color: '7057ff' }] });
    const old = approachability({
      ...a,
      comments: 30,
      labels: [],
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(fresh.level).toBe('high');
    expect(old.level).toBe('low');
  });

  it('stripMarkdown', () => {
    expect(stripMarkdown('<!-- tpl -->**Bold** `x` ![img](a.png)')).toBe('Bold `x`');
  });
});

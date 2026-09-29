import { describe, expect, it, vi } from 'vitest';
import { checkRepo, labelQuery, parseRepoInput, RepoCheckError } from './repoCheck';

const NOW = Date.parse('2026-09-29T00:00:00Z');
const DAY = 86_400_000;

describe('parseRepoInput', () => {
  it.each([
    ['sharkdp/bat', 'sharkdp/bat'],
    ['  sharkdp/bat  ', 'sharkdp/bat'],
    ['https://github.com/sharkdp/bat', 'sharkdp/bat'],
    ['http://www.github.com/sharkdp/bat/', 'sharkdp/bat'],
    ['github.com/sharkdp/bat/issues?q=is%3Aopen', 'sharkdp/bat'],
    ['https://github.com/sharkdp/bat/tree/master/src#readme', 'sharkdp/bat'],
    ['https://github.com/sharkdp/bat.git', 'sharkdp/bat'],
    ['git@github.com:mrdoob/three.js.git', 'mrdoob/three.js'],
    ['mrdoob/three.js', 'mrdoob/three.js'],
  ])('%s → %s', (input, want) => expect(parseRepoInput(input)).toBe(want));

  it.each(['', 'bat', 'sharkdp', 'https://gitlab.com/a/b', 'a b/c', '-bad/name', 'owner/..', 'owner/na me'])(
    'rejects %j',
    (input) => expect(parseRepoInput(input)).toBeNull(),
  );
});

describe('labelQuery', () => {
  it('ORs the labels, quoted', () => {
    expect(labelQuery('a/b', ['good first issue', 'easy'])).toBe(
      'repo:a/b is:issue is:open label:"good first issue","easy"',
    );
  });
  it("stays inside GitHub's 256-character limit", () => {
    const labels = Array.from({ length: 40 }, (_, i) => `label number ${i}`);
    const q = labelQuery('owner/name', labels);
    expect(q.length).toBeLessThanOrEqual(256);
    expect(q).toContain('"label number 0"');
  });
});

interface Fixture {
  repo?: Record<string, unknown>;
  status?: Record<string, number>;
  labels?: string[];
  gfi?: { total: number; items: { assignees: unknown[]; comments: number }[] };
  help?: number;
}

const ghRepo = (over: Record<string, unknown> = {}) => ({
  full_name: 'sharkdp/bat',
  name: 'bat',
  owner: { login: 'sharkdp', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  description: 'A cat(1) clone with wings.',
  homepage: '',
  language: 'Rust',
  topics: ['cli', 'command-line', 'terminal'],
  stargazers_count: 50_000,
  forks_count: 1_300,
  license: { spdx_id: 'Apache-2.0' },
  archived: false,
  fork: false,
  mirror_url: null,
  private: false,
  pushed_at: new Date(NOW - 2 * DAY).toISOString(),
  created_at: '2018-04-21T00:00:00Z',
  ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fake api.github.com: routes by path, and records every URL asked for. */
function fakeGitHub(f: Fixture = {}) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const p = url.pathname;
    const status = Object.entries(f.status ?? {}).find(([k]) => p.includes(k))?.[1];
    if (status) return json({ message: status === 404 ? 'Not Found' : 'Error' }, status);
    if (p === '/repos/sharkdp/bat') return json(ghRepo(f.repo));
    if (p.endsWith('/community/profile')) {
      return json({
        files: {
          contributing: { html_url: 'https://github.com/sharkdp/bat/blob/master/CONTRIBUTING.md' },
          code_of_conduct: { key: 'contributor_covenant' },
        },
      });
    }
    if (p.endsWith('/commits')) {
      return json([{ commit: { committer: { date: new Date(NOW - DAY).toISOString() } } }]);
    }
    if (p.endsWith('/labels'))
      return json((f.labels ?? ['bug', 'Good First Issue', 'help wanted']).map((name) => ({ name })));
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (/good first issue/i.test(q)) {
        const gfi = f.gfi ?? {
          total: 12,
          items: [
            { assignees: [], comments: 0 },
            { assignees: [], comments: 3 },
            { assignees: [{ login: 'x' }], comments: 1 },
            { assignees: [], comments: 0 },
          ],
        };
        return json({ total_count: gfi.total, items: gfi.items });
      }
      return json({ total_count: f.help ?? 5, items: [] });
    }
    return json({ message: 'Not Found' }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe('checkRepo', () => {
  it('builds and scores a record like the collector', async () => {
    const gh = fakeGitHub();
    const { record, result, unknown } = await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW });
    expect(unknown).toEqual([]);
    expect(record).toMatchObject({
      fullName: 'sharkdp/bat',
      owner: 'sharkdp',
      name: 'bat',
      language: 'rust',
      languageName: 'Rust',
      homepage: null,
      license: 'Apache-2.0',
      mirror: false,
      contributingUrl: 'https://github.com/sharkdp/bat/blob/master/CONTRIBUTING.md',
      hasCodeOfConduct: true,
      goodFirstIssues: 12,
      helpWanted: 5,
      gfiSampled: 4,
      gfiUnassigned: 3,
      gfiUnanswered: 2,
      responseHours: null,
      curated: false,
      lastCommitAt: new Date(NOW - DAY).toISOString(),
    });
    expect(record.fields).toContain('cli');
    expect(result.eligible).toBe(true);
    expect(result.failedGates).toEqual([]);
    expect(record.score).toBe(result.score);
    expect(result.score).toBeGreaterThan(60);
    expect(result.firstPrFriendly).toBe(true);
  });

  it("searches with the repo's own label spellings", async () => {
    const gh = fakeGitHub();
    await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW });
    const searches = gh.calls
      .filter((c) => c.startsWith('/search/issues'))
      .map((c) => new URLSearchParams(c.split('?')[1]));
    expect(searches.map((s) => s.get('q'))).toEqual([
      'repo:sharkdp/bat is:issue is:open label:"Good First Issue"',
      'repo:sharkdp/bat is:issue is:open label:"help wanted"',
    ]);
    expect(searches[0].get('per_page')).toBe('20');
  });

  it('skips the search when the repo has no beginner labels', async () => {
    const gh = fakeGitHub({ labels: ['bug'] });
    const { record, result } = await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW });
    expect(gh.calls.some((c) => c.startsWith('/search/issues'))).toBe(false);
    expect(record.goodFirstIssues).toBe(0);
    expect(result.failedGates).toEqual(['issues']);
  });

  it('reports failing gates', async () => {
    const gh = fakeGitHub({
      repo: { archived: true, fork: true, license: null, stargazers_count: 4 },
      status: { '/commits': 409 },
    });
    const { record, result, unknown } = await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW + 400 * DAY });
    expect(record.license).toBeNull();
    expect(result.eligible).toBe(false);
    expect(result.failedGates).toEqual(['archived', 'fork', 'license', 'stale', 'stars']);
    expect(result.firstPrFriendly).toBe(false);
    // No commits endpoint: falls back to the last push.
    expect(record.lastCommitAt).toBe(ghRepo().pushed_at);
    expect(unknown.join(' ')).toContain('last commit');
  });

  it('falls back to every label variant when labels are unreadable', async () => {
    const gh = fakeGitHub({ status: { '/labels': 500 } });
    const { unknown } = await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW });
    const q = gh.calls.find((c) => c.startsWith('/search/issues'))!;
    expect(decodeURIComponent(q.replace(/\+/g, ' '))).toContain('"good first issue","good-first-issue"');
    expect(unknown.join(' ')).toContain('label');
  });

  it('says when the repo does not exist', async () => {
    const gh = fakeGitHub({ status: { '/repos/sharkdp/bat': 404 } });
    const err = await checkRepo('sharkdp/bat', { fetch: gh.fetch, now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepoCheckError);
    expect((err as RepoCheckError).kind).toBe('not-found');
  });

  it('turns rate limits into a friendly error with the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const fetch = vi.fn(async () =>
      json({ message: 'API rate limit exceeded' }, 403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      }),
    ) as unknown as typeof globalThis.fetch;
    const err = (await checkRepo('sharkdp/bat', { fetch, now: NOW }).catch((e: unknown) => e)) as RepoCheckError;
    expect(err.kind).toBe('rate-limit');
    expect(err.resetAt).toBe(reset * 1000);
    expect(err.message).toMatch(/60 requests an hour/);
    expect(err.message).toMatch(/token in Settings/);
  });

  it('recognises secondary search limits', async () => {
    const base = fakeGitHub();
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/search/')
        ? json({ message: 'You have exceeded a secondary rate limit.' }, 403)
        : base.fetch(input),
    ) as unknown as typeof globalThis.fetch;
    const err = (await checkRepo('sharkdp/bat', { fetch, now: NOW, token: 't' }).catch(
      (e: unknown) => e,
    )) as RepoCheckError;
    expect(err.kind).toBe('rate-limit');
    expect(err.message).not.toMatch(/Settings/);
  });

  it('sends the token and reports a rejected one', async () => {
    const fetch = vi.fn(async (_: unknown, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
      return json({ message: 'Bad credentials' }, 401);
    }) as unknown as typeof globalThis.fetch;
    const err = (await checkRepo('sharkdp/bat', { fetch, token: ' abc ' }).catch((e: unknown) => e)) as RepoCheckError;
    expect(err.kind).toBe('auth');
  });

  it('reports network failures', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const err = (await checkRepo('sharkdp/bat', { fetch }).catch((e: unknown) => e)) as RepoCheckError;
    expect(err.kind).toBe('network');
  });

  it('follows renames to the canonical name', async () => {
    const gh = fakeGitHub();
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/repos/SharkDP/Bat') ? json(ghRepo()) : gh.fetch(input),
    ) as unknown as typeof globalThis.fetch;
    const { record } = await checkRepo('SharkDP/Bat', { fetch, now: NOW });
    expect(record.fullName).toBe('sharkdp/bat');
  });
});

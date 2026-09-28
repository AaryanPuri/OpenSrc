import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PARSE_TIMEOUT_MS,
  cachedAiParse,
  checkLlmAvailable,
  fetchAiParse,
  rememberAiParse,
  resetAiParseState,
  sanitizeServerParse,
} from './aiParse';
import { buildGitHubQuery, getChips, parseQuery, removeChip, toQueryText, type ParsedQuery } from './parseQuery';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Stub fetch with separate handlers for /api/health and /api/parse. */
function stubApi({ health, parse }: { health: Handler; parse?: Handler }) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/health')) return health(url, init);
    if (url.startsWith('/api/parse') && parse) return parse(url, init);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const calls = (fn: ReturnType<typeof stubApi>, prefix: string) =>
  fn.mock.calls.filter(([u]) => String(u).startsWith(prefix));

const llmOn = () => json({ ok: true, llm: true, githubToken: false });

/** What the server's /api/parse returns for an LLM reading (shared ParsedQuery + interpretedBy). */
const serverParse = (q: string, over: Record<string, unknown> = {}) => ({
  raw: q,
  languages: ['rust'],
  domains: [{ id: 'databases', label: 'Databases', matched: 'database', term: 'database', topics: [] }],
  difficulty: 'beginner',
  types: ['bug'],
  keywords: ['tokio'],
  qualifiers: [],
  maxComments: 0,
  since: 'month',
  interpretedBy: 'llm',
  ...over,
});

const filters = (p: ParsedQuery) => ({
  languages: p.languages,
  domains: p.domains.map((d) => d.id),
  difficulty: p.difficulty,
  types: p.types,
  keywords: p.keywords,
  qualifiers: p.qualifiers,
  maxComments: p.maxComments,
  since: p.since,
});

beforeEach(() => resetAiParseState());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LLM availability (/api/health)', () => {
  it('is checked once per session', async () => {
    const f = stubApi({ health: llmOn });
    expect(await checkLlmAvailable()).toBe(true);
    expect(await checkLlmAvailable()).toBe(true);
    expect(calls(f, '/api/health')).toHaveLength(1);
  });

  it.each([
    ['llm:false', () => json({ ok: true, llm: false, githubToken: true })],
    ['a 404 (no backend)', () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })],
    [
      'an HTML page (static hosting)',
      () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ],
    [
      'a network error',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('keeps the local parse on %s and never calls /api/parse', async (_name, health) => {
    const f = stubApi({ health: health as Handler, parse: () => json(serverParse('x')) });
    expect(await fetchAiParse('rust databases')).toBeNull();
    expect(await fetchAiParse('go cli')).toBeNull();
    expect(calls(f, '/api/parse')).toHaveLength(0);
    expect(calls(f, '/api/health')).toHaveLength(1);
  });
});

describe('fetchAiParse (/api/parse)', () => {
  it("returns Claude's reading, keyed and cached by q", async () => {
    const q = 'stuff nobody touched in rust storage, recent';
    const f = stubApi({ health: llmOn, parse: () => json(serverParse(q)) });
    const p = await fetchAiParse(q);
    expect(p).not.toBeNull();
    expect(filters(p!)).toEqual({
      languages: ['rust'],
      domains: ['databases'],
      difficulty: 'beginner',
      types: ['bug'],
      keywords: ['tokio'],
      qualifiers: [],
      maxComments: 0,
      since: 'month',
    });
    expect(p!.raw).toBe(q);
    expect(new URL(String(calls(f, '/api/parse')[0][0]), 'http://x').searchParams.get('q')).toBe(q);

    expect(cachedAiParse(q)).toEqual(p);
    expect(await fetchAiParse(q)).toEqual(p);
    expect(calls(f, '/api/parse')).toHaveLength(1);
  });

  it('dedupes concurrent requests for the same q', async () => {
    const f = stubApi({ health: llmOn, parse: () => json(serverParse('same')) });
    const [a, b] = await Promise.all([fetchAiParse('same'), fetchAiParse('same')]);
    expect(a).toEqual(b);
    expect(calls(f, '/api/parse')).toHaveLength(1);
  });

  it('ignores the server’s rules fallback (the local parse is already the same thing)', async () => {
    stubApi({ health: llmOn, parse: () => json(serverParse('x', { interpretedBy: 'rules' })) });
    expect(await fetchAiParse('rust')).toBeNull();
    expect(cachedAiParse('rust')).toBeUndefined();
  });

  it.each([
    ['a 500', () => json({ error: 'internal error' }, 500)],
    ['a non-JSON body', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    [
      'a network error',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('keeps the local parse on %s', async (_name, parse) => {
    stubApi({ health: llmOn, parse: parse as Handler });
    expect(await fetchAiParse('rust databases')).toBeNull();
  });

  it('gives up after 4s, aborting the request, and keeps the local parse', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    stubApi({
      health: llmOn,
      parse: (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {}); // never answers
      },
    });
    let settled = false;
    const pending = fetchAiParse('slow query').then((p) => {
      settled = true;
      return p;
    });
    await vi.advanceTimersByTimeAsync(AI_PARSE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(cachedAiParse('slow query')).toBeUndefined();
  });
});

describe('sanitizeServerParse', () => {
  it('keeps only known ids, rebuilds domains from the shared dictionary, clamps ceilings', () => {
    const p = sanitizeServerParse('q', {
      ...serverParse('q'),
      languages: ['rust', 'klingon', 7],
      domains: [{ id: 'databases', term: 'EVIL' }, 'testing', { id: 'nope' }],
      difficulty: 'impossible',
      types: ['bug', 'chore'],
      keywords: [' Tokio ', 3],
      maxComments: 123456,
      since: 'decade',
    })!;
    expect(p.languages).toEqual(['rust']);
    expect(p.domains.map((d) => [d.id, d.term])).toEqual([
      ['databases', 'database'],
      ['testing', 'testing'],
    ]);
    expect(p.difficulty).toBeNull();
    expect(p.types).toEqual(['bug']);
    expect(p.keywords).toEqual(['tokio']);
    expect(p.maxComments).toBe(999);
    expect(p.since).toBeNull();
  });

  it('rejects non-objects and non-LLM results', () => {
    expect(sanitizeServerParse('q', null)).toBeNull();
    expect(sanitizeServerParse('q', 'x')).toBeNull();
    expect(sanitizeServerParse('q', serverParse('q', { interpretedBy: 'rules' }))).toBeNull();
  });
});

describe('URL stays the source of truth', () => {
  it('the searched GitHub query is built from the LLM parse, and it round-trips through toQueryText', async () => {
    const q = 'something low-traffic in rust storage engines, lately';
    stubApi({ health: llmOn, parse: () => json(serverParse(q)) });
    const ai = (await fetchAiParse(q))!;
    const local = parseQuery(q);
    expect(buildGitHubQuery(ai)).not.toBe(buildGitHubQuery(local));
    expect(buildGitHubQuery(ai, 0)).toContain('comments:0');

    const text = toQueryText(ai);
    expect(filters(parseQuery(text))).toEqual(filters(ai));
    expect(buildGitHubQuery(parseQuery(text), 0)).toBe(buildGitHubQuery(ai, 0));
  });

  it('removing a patch from an LLM parse rewrites q, and the new q still reads as the edited AI parse', async () => {
    const q = 'rust db stuff nobody replied to';
    stubApi({ health: llmOn, parse: () => json(serverParse(q)) });
    const ai = (await fetchAiParse(q))!;
    const chip = getChips(ai).find((c) => c.kind === 'language')!;
    const next = removeChip(ai, chip);
    rememberAiParse(next.raw, next); // what App/Composer do on an edit

    expect(next.languages).toEqual([]);
    expect(cachedAiParse(next.raw)).toMatchObject({ languages: [], domains: next.domains, maxComments: 0 });
    // Reloading that URL without the server gives the same filters from the local parser.
    expect(filters(parseQuery(next.raw))).toEqual(filters(next));
  });
});

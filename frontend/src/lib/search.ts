/**
 * The single place that talks to an issue-search backend.
 *
 * Order of preference for a live search:
 *   1. Our server's `/api/search?gq=…` (server-side GitHub token + caching).
 *   2. GitHub's REST search API directly from the browser, used when the
 *      server isn't there (404 / non-JSON / network error, e.g. static hosting)
 *      or when the user supplied their own token in Settings.
 * Demo mode never touches the network. Callers depend solely on
 * `searchIssues(q, opts)` and `SearchResult`.
 */
import { searchFixtures, sortIssues } from './fixtures';
import type { Issue, SearchNotice, SearchResult, SortKey } from './types';

const API = 'https://api.github.com';
const BACKEND_SEARCH = '/api/search';
/** GitHub search never returns more than 1000 results. */
const MAX_RESULTS = 1000;
/** Page size shared with the server (`PER_PAGE` in server/src/github/client.ts). */
export const PAGE_SIZE = 20;

export interface SearchOptions {
  page?: number;
  perPage?: number;
  sort?: SortKey;
  /** Optional GitHub personal access token for higher rate limits. */
  token?: string | null;
  signal?: AbortSignal;
  /** Force the bundled sample dataset (e.g. `?demo=1`). */
  demo?: boolean;
}

export class SearchError extends Error {
  constructor(
    message: string,
    public kind: 'invalid' | 'server' | 'auth',
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

const cache = new Map<string, { at: number; result: SearchResult }>();
const CACHE_TTL = 5 * 60_000;

export async function searchIssues(q: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const { page = 1, perPage = PAGE_SIZE, sort = 'best', demo = false } = opts;

  if (demo) {
    const result = searchFixtures(q, { page, perPage, sort });
    return { ...result, notice: { kind: 'demo', message: 'Demo mode: showing the bundled sample dataset.' } };
  }

  const key = JSON.stringify([q, page, perPage, sort, !!opts.token]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result;

  // A personal token stays a direct browser→GitHub call; the server's page size is fixed.
  if (!opts.token && perPage === PAGE_SIZE && backendAvailable) {
    try {
      const result = await fetchFromBackend(q, { ...opts, page, perPage, sort });
      cache.set(key, { at: Date.now(), result });
      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof SearchError) throw err;
      // Not there at all (static hosting, server stopped): stop probing for this session.
      if (err instanceof BackendUnavailableError) backendAvailable = false;
      // Otherwise (e.g. a transient 5xx) just use the direct path for this request.
    }
  }

  try {
    const result = await fetchFromGitHub(q, { ...opts, page, perPage, sort });
    cache.set(key, { at: Date.now(), result });
    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof SearchError) throw err;
    const notice = err instanceof RateLimitError ? err.notice : networkNotice();
    return { ...searchFixtures(q, { page, perPage, sort }), notice };
  }
}

/* ------------------------------------------------------------------ */
/* Server backend (/api/search)                                         */
/* ------------------------------------------------------------------ */

/** Session-scoped: once the server is found missing we don't probe again until reload. */
let backendAvailable = true;

/** Test hook: forget the remembered "backend unavailable" state and the result cache. */
export function resetSearchState(): void {
  backendAvailable = true;
  cache.clear();
}

class BackendUnavailableError extends Error {}
class BackendTransientError extends Error {}

/** Server response shape (server/src/types.ts `SearchResponse`, trimmed to what we use). */
interface BackendSearchResponse {
  total: number;
  items: BackendIssue[];
  source: 'github' | 'fixtures';
  githubQuery: string;
  rateLimit?: { limit?: number; remaining?: number; reset?: number };
  warning?: string;
  fallbackReason?: 'rate-limit' | 'unavailable';
}

interface BackendIssue {
  id: number;
  number: number;
  title: string;
  url: string;
  repo: { fullName: string; owner: string; avatarUrl: string; url: string; stars?: number; language?: string };
  labels: { name: string; color: string }[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  bodyExcerpt: string;
  author: string;
  linkedPr?: boolean;
}

async function fetchFromBackend(
  q: string,
  opts: Required<Pick<SearchOptions, 'page' | 'perPage' | 'sort'>> & SearchOptions,
): Promise<SearchResult> {
  const params = new URLSearchParams({ gq: q, page: String(opts.page), sort: opts.sort });
  // Match the direct path: "comments" means fewest comments first.
  if (opts.sort === 'comments') params.set('order', 'asc');

  let res: Response;
  try {
    res = await fetch(`${BACKEND_SEARCH}?${params}`, { headers: { Accept: 'application/json' }, signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new BackendUnavailableError('network');
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  // 404 or an HTML page (e.g. an SPA fallback on static hosting) means there is no server.
  if (res.status === 404 || !isJson) throw new BackendUnavailableError(`status ${res.status}`);
  if (res.status === 422) {
    throw new SearchError(
      'GitHub could not understand that search. Try removing a filter or a special character.',
      'invalid',
    );
  }
  if (!res.ok) throw new BackendTransientError(`status ${res.status}`);

  let data: BackendSearchResponse;
  try {
    data = (await res.json()) as BackendSearchResponse;
  } catch {
    throw new BackendUnavailableError('invalid JSON');
  }

  if (data.source === 'fixtures') {
    // The server couldn't reach GitHub. Show the same bundled sample set the
    // direct path uses (it understands our query string and marks items as
    // samples), with the server's explanation as the notice.
    const reset = data.rateLimit?.reset;
    const rateLimited = data.fallbackReason === 'rate-limit';
    const notice: SearchNotice = {
      kind: rateLimited ? 'rate-limit' : 'network',
      message: data.warning ?? networkNotice().message,
      ...(rateLimited && reset ? { resetAt: reset * 1000 } : {}),
    };
    return { ...searchFixtures(q, { page: opts.page, perPage: opts.perPage, sort: opts.sort }), notice };
  }

  const items = data.items.map(fromBackendIssue);
  const total = Math.min(data.total, MAX_RESULTS);
  return {
    items: opts.sort === 'best' ? items : sortIssues(items, opts.sort),
    total: data.total,
    hasMore: opts.page * opts.perPage < total && data.items.length === opts.perPage,
    source: 'github',
  };
}

function fromBackendIssue(i: BackendIssue): Issue {
  const [owner, name] = i.repo.fullName.split('/');
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    body: i.bodyExcerpt,
    htmlUrl: i.url,
    repo: {
      fullName: i.repo.fullName,
      owner: i.repo.owner || owner,
      name,
      htmlUrl: i.repo.url,
      // Only present when the server has a token; leave undefined otherwise, like the direct path.
      ...(i.repo.language ? { language: i.repo.language } : {}),
      ...(typeof i.repo.stars === 'number' ? { stars: i.repo.stars } : {}),
    },
    labels: i.labels.filter((l) => l.name).map((l) => ({ name: l.name, color: l.color || '8b949e' })),
    comments: i.comments,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    author: i.author ? { login: i.author, avatarUrl: `https://github.com/${i.author}.png?size=40` } : null,
    ...(typeof i.linkedPr === 'boolean' ? { linkedPr: i.linkedPr } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Direct GitHub                                                         */
/* ------------------------------------------------------------------ */

class RateLimitError extends Error {
  constructor(public notice: SearchNotice) {
    super(notice.message);
  }
}

function networkNotice(): SearchNotice {
  return {
    kind: 'network',
    message: "We couldn't reach GitHub, so here are sample results instead. Check your connection and try again.",
  };
}

function headers(token?: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

async function fetchFromGitHub(
  q: string,
  opts: Required<Pick<SearchOptions, 'page' | 'perPage' | 'sort'>> & SearchOptions,
): Promise<SearchResult> {
  const params = new URLSearchParams({ q, per_page: String(opts.perPage), page: String(opts.page) });
  if (opts.sort === 'newest') {
    params.set('sort', 'created');
    params.set('order', 'desc');
  } else if (opts.sort === 'comments') {
    params.set('sort', 'comments');
    params.set('order', 'asc');
  }

  const res = await fetch(`${API}/search/issues?${params}`, { headers: headers(opts.token), signal: opts.signal });

  if (res.status === 401) {
    throw new SearchError('GitHub rejected your access token. Update or remove it in Settings.', 'auth');
  }
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const resetAt = reset ? reset * 1000 : undefined;
    const when = resetAt ? ` in about ${Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000))} min` : ' shortly';
    throw new RateLimitError({
      kind: 'rate-limit',
      resetAt,
      message: opts.token
        ? `GitHub's search rate limit was reached. It resets${when}. Showing sample results meanwhile.`
        : `GitHub allows 10 unauthenticated searches per minute, and that limit was reached. It resets${when}. Add a token in Settings for 30/min. Showing sample results meanwhile.`,
    });
  }
  if (res.status === 422) {
    throw new SearchError(
      'GitHub could not understand that search. Try removing a filter or a special character.',
      'invalid',
    );
  }
  if (!res.ok) {
    throw new SearchError(`GitHub returned an unexpected error (${res.status}). Please try again.`, 'server');
  }

  const data = (await res.json()) as GhSearchResponse;
  const items = data.items.filter((i) => !i.pull_request).map(toIssue);
  const total = Math.min(data.total_count, MAX_RESULTS);
  return {
    items: opts.sort === 'best' ? items : sortIssues(items, opts.sort),
    total: data.total_count,
    hasMore: opts.page * opts.perPage < total && data.items.length === opts.perPage,
    source: 'github',
  };
}

/* ------------------------------------------------------------------ */
/* Repository metadata (stars / language), fetched lazily               */
/* ------------------------------------------------------------------ */

export interface RepoMeta {
  stars: number;
  language: string | null;
}

const repoCache = new Map<string, Promise<RepoMeta | null>>();

/**
 * Stars and language are not part of the issue search payload. Each lookup
 * costs one core-API request, so the UI only calls this when a token is set.
 */
export function fetchRepoMeta(fullName: string, token?: string | null): Promise<RepoMeta | null> {
  const cached = repoCache.get(fullName);
  if (cached) return cached;
  const p = fetch(`${API}/repos/${fullName}`, { headers: headers(token) })
    .then(async (r) => {
      if (!r.ok) return null;
      const j = (await r.json()) as { stargazers_count: number; language: string | null };
      return { stars: j.stargazers_count, language: j.language };
    })
    .catch(() => null);
  repoCache.set(fullName, p);
  return p;
}

/* ------------------------------------------------------------------ */
/* GitHub payload mapping                                               */
/* ------------------------------------------------------------------ */

interface GhSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GhIssue[];
}

interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  repository_url: string;
  labels: ({ name?: string; color?: string } | string)[];
  comments: number;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  pull_request?: unknown;
}

function toIssue(i: GhIssue): Issue {
  const fullName = i.repository_url.replace(`${API}/repos/`, '');
  const [owner, name] = fullName.split('/');
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    body: stripMarkdown(i.body ?? ''),
    htmlUrl: i.html_url,
    repo: { fullName, owner, name, htmlUrl: `https://github.com/${fullName}` },
    labels: i.labels
      .map((l) =>
        typeof l === 'string' ? { name: l, color: '8b949e' } : { name: l.name ?? '', color: l.color || '8b949e' },
      )
      .filter((l) => l.name),
    comments: i.comments,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    author: i.user ? { login: i.user.login, avatarUrl: i.user.avatar_url } : null,
  };
}

/** Cheap markdown → plain text for a one/two-line excerpt. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

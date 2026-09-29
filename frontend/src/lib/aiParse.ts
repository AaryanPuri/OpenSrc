/**
 * Optional Claude-powered reading of a query, served by our API (`/api/parse`).
 *
 * The local rules parser (shared/parse.ts) is always shown first. When the
 * server reports `llm: true`, a submitted query is also sent to `/api/parse`;
 * if Claude's reading comes back within the deadline it replaces the local one.
 * Any failure (no server, no key, slow, error, rules fallback) silently keeps
 * the local parse.
 */
import { DIFFICULTIES, ISSUE_TYPES } from './dictionary';
import { getHealth, resetHealth } from './health';
import {
  MAX_COMMENTS,
  domainMatchById,
  emptyQuery,
  languageById,
  type Difficulty,
  type IssueType,
  type ParsedQuery,
  type Since,
} from './parseQuery';

const PARSE_URL = '/api/parse';
/** Past this, the local parse stays: a late upgrade would reshuffle results the user is already reading. */
export const AI_PARSE_TIMEOUT_MS = 4000;

/** q → Claude's parse of it (or a parse derived from one by editing a patch). */
const parses = new Map<string, ParsedQuery>();
const inflight = new Map<string, Promise<ParsedQuery | null>>();

/** Test hook: forget the health check and every cached parse. */
export function resetAiParseState(): void {
  resetHealth();
  parses.clear();
  inflight.clear();
}

/** GET JSON with a hard deadline: aborts the request and rejects after `ms`, even if fetch ignores the signal. */
async function getJson(url: string, ms: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${url}: timed out after ${ms}ms`));
    }, ms);
  });
  try {
    const res = await Promise.race([
      fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal }),
      deadline,
    ]);
    // A 404 or an HTML page (static hosting, proxy with no server behind it) means "no API here".
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
      throw new Error(`${url}: ${res.status}`);
    }
    return await Promise.race([res.json(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** One `/api/health` call per page session; false when the server (or its API key) is absent. */
export function checkLlmAvailable(): Promise<boolean> {
  return getHealth().then((h) => h.llm);
}

/** Claude's parse for exactly this query text, if we have one. */
export function cachedAiParse(q: string): ParsedQuery | undefined {
  return parses.get(q);
}

/**
 * Remember a parse derived from an AI parse (a patch removed, a refine toggle),
 * keyed by the text it rewrites `?q=` to, so the edited query still reads as AI's.
 */
export function rememberAiParse(q: string, parsed: ParsedQuery): void {
  parses.set(q, { ...parsed, raw: q });
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Rebuild a ParsedQuery from the server's JSON using only known ids, so what we
 * apply always round-trips through toQueryText (chip removal keeps working).
 */
export function sanitizeServerParse(q: string, body: unknown): ParsedQuery | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.interpretedBy !== 'llm') return null;
  const domainIds = Array.isArray(b.domains)
    ? b.domains
        .map((d) => (typeof d === 'object' && d !== null ? (d as { id?: unknown }).id : d))
        .filter((id): id is string => typeof id === 'string')
    : [];
  const max = typeof b.maxComments === 'number' && Number.isFinite(b.maxComments) ? Math.floor(b.maxComments) : null;
  return {
    ...emptyQuery(q),
    languages: [...new Set(strings(b.languages).filter((id) => languageById(id)))],
    domains: [...new Set(domainIds)].map((id) => domainMatchById(id)).filter((d): d is NonNullable<typeof d> => !!d),
    difficulty: typeof b.difficulty === 'string' && b.difficulty in DIFFICULTIES ? (b.difficulty as Difficulty) : null,
    types: [...new Set(strings(b.types).filter((t): t is IssueType => t in ISSUE_TYPES))],
    keywords: [
      ...new Set(
        strings(b.keywords)
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    qualifiers: strings(b.qualifiers),
    maxComments: max === null || max < 0 ? null : Math.min(max, MAX_COMMENTS),
    since: b.since === 'week' || b.since === 'month' || b.since === 'year' ? (b.since as Since) : null,
  };
}

/**
 * Ask the server to read `q` with Claude. Resolves to null (keep the local parse)
 * when the LLM is unavailable, the call fails, it takes longer than 4s, or the
 * server fell back to its rules parser.
 */
export function fetchAiParse(q: string): Promise<ParsedQuery | null> {
  const text = q.trim();
  if (!text) return Promise.resolve(null);
  const hit = parses.get(q);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(q);
  if (pending) return pending;

  const p = (async () => {
    if (!(await checkLlmAvailable())) return null;
    try {
      const body = await getJson(`${PARSE_URL}?${new URLSearchParams({ q: text })}`, AI_PARSE_TIMEOUT_MS);
      const parsed = sanitizeServerParse(q, body);
      if (parsed) parses.set(q, parsed);
      return parsed;
    } catch {
      return null;
    } finally {
      inflight.delete(q);
    }
  })();
  inflight.set(q, p);
  return p;
}

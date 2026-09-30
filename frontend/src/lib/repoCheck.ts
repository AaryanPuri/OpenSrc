/**
 * The /submit page's check: reads a public repo from the GitHub REST API in the
 * browser, builds a RepoRecord from it the way the nightly collector would, and
 * scores it with the same gates and formula (shared/score.ts). The maintainer
 * response time isn't measured here, so it stays null ("unknown", neutral).
 *
 * Unauthenticated, a check costs 3–6 core requests (60 an hour) and up to 2
 * searches (10 a minute); the Settings token raises both.
 */
import { classifyRepo } from '../../../shared/classify';
import { GOOD_FIRST_LABELS, HELP_WANTED_LABELS } from '../../../shared/labels';
import { resolveLanguage } from '../../../shared/parse';
import type { RepoRecord } from '../../../shared/repo';
import { scoreRepo, type ScoreResult } from '../../../shared/score';

export const GITHUB_API = 'https://api.github.com';
/** Issues the collector samples per repo for "unassigned" and "unanswered". */
export const GFI_SAMPLE = 20;
/** Label pages read (100 each) when looking for the repo's own beginner labels. */
const LABEL_PAGES = 3;
/** GitHub rejects search queries longer than this. */
const MAX_QUERY = 256;

const OWNER_RE = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const NAME_RE = /^[\w.-]{1,100}$/;

/**
 * "owner/name", a github.com URL (any page of the repo, with or without the
 * scheme or `.git`) or an SSH remote → "owner/name"; anything else → null.
 */
export function parseRepoInput(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  s = s.replace(/[?#].*$/, '');
  const [owner, rawName] = s.split('/').filter(Boolean);
  if (!owner || !rawName) return null;
  const name = rawName.replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return null;
  return `${owner}/${name}`;
}

export type RepoCheckErrorKind = 'not-found' | 'rate-limit' | 'auth' | 'network' | 'server';

export class RepoCheckError extends Error {
  constructor(
    message: string,
    readonly kind: RepoCheckErrorKind,
    /** Epoch ms when the rate limit resets, when GitHub said. */
    readonly resetAt?: number,
  ) {
    super(message);
    this.name = 'RepoCheckError';
  }
}

export interface RepoCheck {
  /** The repo as the collector would record it (response time unknown, first seen now). */
  record: RepoRecord;
  result: ScoreResult;
  /** What couldn't be read, so the numbers may be off ("labels", "community profile"…). */
  unknown: string[];
}

export interface CheckOptions {
  /** A GitHub token (Settings) for higher rate limits. */
  token?: string | null;
  signal?: AbortSignal;
  /** Epoch ms to score at (default: now). */
  now?: number;
  fetch?: typeof fetch;
}

/* ------------------------------------------------------------------ */
/* GitHub responses (only the fields we read)                          */
/* ------------------------------------------------------------------ */

interface GhRepo {
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  license: { spdx_id: string | null } | null;
  archived: boolean;
  fork: boolean;
  mirror_url: string | null;
  private?: boolean;
  pushed_at: string | null;
  created_at: string;
}

interface GhCommunity {
  files?: {
    contributing?: { html_url?: string | null } | null;
    code_of_conduct?: unknown;
    code_of_conduct_file?: unknown;
  };
}

interface GhCommit {
  commit?: { committer?: { date?: string } | null; author?: { date?: string } | null };
}

interface GhSearch {
  total_count: number;
  items: { assignees?: unknown[] | null; assignee?: unknown; comments: number; pull_request?: unknown }[];
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token?.trim()) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

function rateLimitError(res: Response, search: boolean, token: boolean): RepoCheckError {
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const retryAfter = Number(res.headers.get('retry-after'));
  const resetAt = reset > 0 ? reset * 1000 : retryAfter > 0 ? Date.now() + retryAfter * 1000 : undefined;
  const mins = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000)) : null;
  const when = mins ? ` It resets in about ${mins} min.` : ' Try again in a minute.';
  const limit = search
    ? token
      ? "GitHub's search limit (30 a minute) was reached."
      : 'GitHub allows 10 searches a minute without a token, and that was reached.'
    : token
      ? "GitHub's API limit for your token was reached."
      : 'GitHub allows 60 requests an hour without a token, and that was reached.';
  return new RepoCheckError(
    `${limit}${when}${token ? '' : ' Add a token in Settings to raise the limit.'}`,
    'rate-limit',
    resetAt,
  );
}

const isRateLimited = (res: Response) =>
  res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

type Getter = <T>(path: string, opts?: { search?: boolean; optional?: boolean }) => Promise<T | null>;

function getter(opts: CheckOptions): Getter {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const token = !!opts.token?.trim();
  return async <T>(path: string, { search = false, optional = false } = {}) => {
    let res: Response;
    try {
      res = await doFetch(`${GITHUB_API}${path}`, { headers: headers(opts.token), signal: opts.signal });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new RepoCheckError("Couldn't reach GitHub. Check your connection and try again.", 'network');
    }
    if (isRateLimited(res)) throw rateLimitError(res, search, token);
    if (res.status === 401) {
      throw new RepoCheckError('GitHub rejected your access token. Update or remove it in Settings.', 'auth');
    }
    if (res.ok) return (await res.json()) as T;
    // Secondary rate limits come back as a plain 403 with a message.
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (/rate limit/i.test(body?.message ?? '')) throw rateLimitError(res, search, token);
    }
    if (optional) return null;
    if (res.status === 404) {
      throw new RepoCheckError(
        "GitHub has no public repo by that name. Check the spelling, or it's private.",
        'not-found',
      );
    }
    throw new RepoCheckError(`GitHub returned an unexpected error (${res.status}). Please try again.`, 'server');
  };
}

/** The repo's own spellings of the beginner / help-wanted labels (all of ours when the labels can't be read). */
async function repoLabels(get: Getter, fullName: string): Promise<string[] | null> {
  const names: string[] = [];
  for (let page = 1; page <= LABEL_PAGES; page++) {
    const labels = await get<{ name: string }[]>(`/repos/${fullName}/labels?per_page=100&page=${page}`, {
      optional: true,
    });
    if (!labels) return page === 1 ? null : names;
    names.push(...labels.map((l) => l.name));
    if (labels.length < 100) break;
  }
  return names;
}

function pickLabels(repoLabels: string[] | null, variants: readonly string[]): string[] {
  if (!repoLabels) return [...variants];
  const wanted = new Set(variants.map((v) => v.toLowerCase()));
  return repoLabels.filter((l) => wanted.has(l.toLowerCase()));
}

/** `repo:o/n is:issue is:open label:"a","b"`, with as many labels as fit in GitHub's query limit. */
export function labelQuery(fullName: string, labels: string[]): string {
  const base = `repo:${fullName} is:issue is:open label:`;
  const quoted: string[] = [];
  for (const l of labels) {
    const next = [...quoted, `"${l.replace(/"/g, '')}"`];
    if (quoted.length && (base + next.join(',')).length > MAX_QUERY) break;
    quoted.push(next[next.length - 1]);
  }
  return base + quoted.join(',');
}

async function countIssues(
  get: Getter,
  fullName: string,
  labels: string[],
  sample: number,
): Promise<{ total: number; items: GhSearch['items'] }> {
  if (!labels.length) return { total: 0, items: [] };
  const params = new URLSearchParams({ q: labelQuery(fullName, labels), per_page: String(Math.max(1, sample)) });
  if (sample > 0) {
    params.set('sort', 'created');
    params.set('order', 'desc');
  }
  const data = await get<GhSearch>(`/search/issues?${params}`, { search: true });
  const items = (data?.items ?? []).filter((i) => !i.pull_request);
  return { total: data?.total_count ?? 0, items: sample > 0 ? items.slice(0, sample) : [] };
}

export function normaliseLicense(spdxId: string | null | undefined): string | null {
  if (!spdxId) return null;
  return spdxId === 'NOASSERTION' ? 'other' : spdxId;
}

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

export async function checkRepo(fullName: string, opts: CheckOptions = {}): Promise<RepoCheck> {
  const get = getter(opts);
  const now = opts.now ?? Date.now();
  const unknown: string[] = [];

  const repo = (await get<GhRepo>(`/repos/${fullName}`))!;
  if (repo.private) {
    throw new RepoCheckError('That repo is private. Only public repos can be listed.', 'not-found');
  }
  const name = repo.full_name;

  const [community, commits, labels] = await Promise.all([
    get<GhCommunity>(`/repos/${name}/community/profile`, { optional: true }),
    get<GhCommit[]>(`/repos/${name}/commits?per_page=1`, { optional: true }),
    repoLabels(get, name),
  ]);
  if (!community) unknown.push('the CONTRIBUTING guide and code of conduct');
  if (!labels) unknown.push("the repo's own label names");

  // One search at a time: GitHub's secondary limits dislike bursts.
  const gfiLabels = pickLabels(labels, GOOD_FIRST_LABELS);
  const helpLabels = pickLabels(labels, HELP_WANTED_LABELS);
  const gfi = await countIssues(get, name, gfiLabels, GFI_SAMPLE);
  const help = await countIssues(get, name, helpLabels, 0);

  const commit = commits?.[0]?.commit;
  const lastCommitAt = commit?.committer?.date ?? commit?.author?.date ?? repo.pushed_at ?? repo.created_at;
  if (!commits?.length) unknown.push('the last commit (using the last push)');
  const files = community?.files ?? {};
  const topics = repo.topics ?? [];
  const assigned = (i: GhSearch['items'][number]) => (i.assignees?.length ?? 0) > 0 || !!i.assignee;

  const base: Omit<RepoRecord, 'score' | 'scoreParts' | 'firstPrFriendly'> = {
    fullName: name,
    owner: repo.owner.login,
    name: repo.name,
    description: repo.description?.trim() || null,
    homepage: repo.homepage?.trim() || null,
    avatarUrl: repo.owner.avatar_url,
    language: (repo.language && resolveLanguage(repo.language)) || null,
    languageName: repo.language,
    topics,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    license: normaliseLicense(repo.license?.spdx_id),
    archived: repo.archived,
    fork: repo.fork,
    mirror: !!repo.mirror_url,
    lastCommitAt,
    createdAt: repo.created_at,
    contributingUrl: files.contributing?.html_url ?? null,
    hasCodeOfConduct: !!(files.code_of_conduct || files.code_of_conduct_file),
    goodFirstIssues: gfi.total,
    helpWanted: help.total,
    gfiSampled: gfi.items.length,
    gfiUnassigned: gfi.items.filter((i) => !assigned(i)).length,
    gfiUnanswered: gfi.items.filter((i) => i.comments === 0).length,
    issueLabels: labels ? [...gfiLabels, ...helpLabels] : [],
    responseHours: null,
    responseSampledAt: null,
    fields: classifyRepo({
      name: repo.name,
      description: repo.description,
      topics,
      language: (repo.language && resolveLanguage(repo.language)) || null,
    }),
    curated: false,
    firstSeenAt: new Date(now).toISOString(),
  };
  const result = scoreRepo(base, now);
  return {
    record: { ...base, score: result.score, scoreParts: result.parts, firstPrFriendly: result.firstPrFriendly },
    result,
    unknown,
  };
}

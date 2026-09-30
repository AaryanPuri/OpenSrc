/**
 * A repo page's live issues, exactly as GitHub counts them: every open issue (assigned or
 * not, never a pull request), optionally limited to a set of label spellings OR-ed together.
 *
 * - With a token: one GraphQL request (core quota, 5,000 points an hour, not the 30-a-minute
 *   search quota) returns the exact open-issue count of all three tabs plus one page of the
 *   chosen tab, newest first, with a cursor for the next page. GraphQL's `labels:` argument
 *   is an OR and ignores case, which is what "good first issue" or "Good First Issue" needs.
 * - Without one (GraphQL refuses anonymous calls): the REST issues list, one request per
 *   label spelling (REST's `labels=` is an AND), merged, de-duplicated and sorted. REST has
 *   no cheap exact count, so `counts` is null there and the page shows no number rather
 *   than a wrong one.
 *
 * Used by the API (/api/repo-issues, with its token and a shared cache) and by the browser
 * when that API isn't there (with the visitor's own token, or anonymously). Plain
 * TypeScript on `fetch`, so it runs on Node, Workers and in the browser.
 */
import { GOOD_FIRST_LABELS, HELP_WANTED_LABELS, isGoodFirstLabel, isHelpWantedLabel } from './labels.js';

export type IssueTab = 'gfi' | 'help' | 'all';
export const ISSUE_TABS: IssueTab[] = ['gfi', 'help', 'all'];
export type LabelTab = Exclude<IssueTab, 'all'>;

export const REPO_ISSUES_PAGE = 20;
/** Label spellings per tab: GraphQL ORs them in one request. */
export const MAX_TAB_LABELS = 5;
/** REST needs one request per spelling, so it asks for fewer. */
export const MAX_REST_LABELS = 3;
export const MAX_LABEL_LEN = 50;
const API = 'https://api.github.com';
const TIMEOUT_MS = 8000;

/**
 * Spellings asked for when a repo's own aren't known (the dataset's `issueLabels` only
 * lists the ones seen on sampled issues): the most common ones first.
 */
export const DEFAULT_TAB_LABELS: Record<LabelTab, string[]> = {
  gfi: GOOD_FIRST_LABELS.filter((l) =>
    ['good first issue', 'good-first-issue', 'good first issues', 'first-timers-only', 'beginner'].includes(l),
  ),
  help: HELP_WANTED_LABELS.filter((l) =>
    ['help wanted', 'help-wanted', 'status: help wanted', 'up-for-grabs', 'contributions welcome'].includes(l),
  ),
};

/** The spellings a tab asks for: the ones the repo's issues use, else the common ones. */
export function tabLabels(issueLabels: readonly string[] | undefined, tab: LabelTab): string[] {
  const own = (issueLabels ?? []).filter(tab === 'gfi' ? isGoodFirstLabel : isHelpWantedLabel);
  return cleanLabels(own.length ? own : DEFAULT_TAB_LABELS[tab]);
}

/* ------------------------------------------------------------------ */
/* Validation (the API takes these from the query string)              */
/* ------------------------------------------------------------------ */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** `owner/name` as GitHub allows it, or null. Nothing else can reach a GitHub URL. */
export function parseRepoName(raw: string | undefined | null): { owner: string; name: string } | null {
  const parts = (raw ?? '').trim().split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

export const isIssueTab = (t: unknown): t is IssueTab => t === 'gfi' || t === 'help' || t === 'all';

/** A label name: printable, no quotes, backslashes or commas (the list separator), at most 50 characters. */
export function isValidLabel(l: string): boolean {
  // eslint-disable-next-line no-control-regex
  return l.length > 0 && l.length <= MAX_LABEL_LEN && !/[\u0000-\u001f\u007f",\\]/.test(l);
}

/** Trimmed, valid, de-duplicated ignoring case, at most MAX_TAB_LABELS. */
export function cleanLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const l = raw.trim();
    const key = l.toLowerCase();
    if (!isValidLabel(l) || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length === MAX_TAB_LABELS) break;
  }
  return out;
}

/** A comma list from the query string; null when it holds something invalid. */
export function parseLabelParam(raw: string | undefined): string[] | null | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (raw.length > (MAX_LABEL_LEN + 1) * MAX_TAB_LABELS) return null;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.some((p) => !isValidLabel(p))) return null;
  return cleanLabels(parts);
}

/** A GraphQL cursor (base64) or a REST page number. */
export const isValidCursor = (c: string) => /^[A-Za-z0-9+/=_:-]{1,200}$/.test(c);

/* ------------------------------------------------------------------ */
/* Links to GitHub's own view of a tab                                 */
/* ------------------------------------------------------------------ */

/** `is:issue is:open label:"a","b"`: what a tab shows, in GitHub's search syntax (the label list is an OR). */
export function tabSearchText(tab: IssueTab, labels: readonly string[]): string {
  const base = 'is:issue is:open';
  return tab === 'all' || !labels.length ? base : `${base} label:${labels.map((l) => `"${l}"`).join(',')}`;
}

/** The tab on github.com, e.g. …/issues?q=is:issue+is:open+label:"good first issue". */
export function githubIssuesUrl(fullName: string, tab: IssueTab, labels: readonly string[]): string {
  const q = encodeURIComponent(tabSearchText(tab, labels)).replace(/%20/g, '+').replace(/%3A/gi, ':');
  return `https://github.com/${fullName}/issues?q=${q}`;
}

/* ------------------------------------------------------------------ */
/* The wire shape (the same Issue as /api/search returns)              */
/* ------------------------------------------------------------------ */

export interface RepoIssue {
  id: number;
  number: number;
  title: string;
  url: string;
  repo: { fullName: string; owner: string; avatarUrl: string; url: string };
  labels: { name: string; color: string }[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  bodyExcerpt: string;
  author: string;
  /** An open PR is linked (GraphQL only; absent when unknown). */
  linkedPr?: boolean;
  /** Someone is assigned. The tabs list these too, tagged. */
  assigned: boolean;
}

export interface TabCounts {
  all: number;
  gfi: number;
  help: number;
}

export interface RepoIssuesResponse {
  items: RepoIssue[];
  hasMore: boolean;
  /** Pass back as `after` for the next page. */
  next: string | null;
  /** Exact open-issue counts per tab (GraphQL), or null when not known (REST). */
  counts: TabCounts | null;
  /** The label spellings each tab asked for. */
  labels: Record<LabelTab, string[]>;
  source: 'github';
  via: 'graphql' | 'rest';
  rateLimit?: { limit?: number; remaining?: number; reset?: number };
}

export type RepoIssuesErrorKind = 'rate_limited' | 'not_found' | 'auth' | 'unavailable';

export class RepoIssuesError extends Error {
  constructor(
    public kind: RepoIssuesErrorKind,
    message: string,
    /** Epoch ms when the rate limit resets, if known. */
    public resetAt?: number,
  ) {
    super(message);
    this.name = 'RepoIssuesError';
  }
}

/** Plain-text excerpt of an issue body for a card. */
export function excerpt(body: string | null | undefined, max = 280): string {
  if (!body) return '';
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ') // HTML comments (issue templates)
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/<[^>]+>/g, ' ') // html tags
    .replace(/(^|\s)[#>*_~|-]+(?=\s|$)/g, ' ') // standalone markdown markers
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/* ------------------------------------------------------------------ */
/* Linked PRs (GraphQL timeline)                                        */
/* ------------------------------------------------------------------ */

export interface GqlLinkedPrFields {
  id?: string;
  closedByPullRequestsReferences?: { totalCount: number } | null;
  timelineItems?: {
    nodes: ({ __typename: string; source?: { __typename: string; state?: string } | null } | null)[];
  } | null;
}

/**
 * An issue "has a linked PR" when an open PR will close it, it was manually connected to a
 * PR, or an open PR cross-references it.
 */
export function hasLinkedPr(node: GqlLinkedPrFields): boolean {
  if ((node.closedByPullRequestsReferences?.totalCount ?? 0) > 0) return true;
  return (node.timelineItems?.nodes ?? []).some(
    (n) =>
      n?.__typename === 'ConnectedEvent' ||
      (n?.__typename === 'CrossReferencedEvent' && n.source?.__typename === 'PullRequest' && n.source.state === 'OPEN'),
  );
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

export const REPO_ISSUES_QUERY = `query($owner: String!, $name: String!, $gfi: [String!], $help: [String!], $labels: [String!], $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    all: issues(states: OPEN) { totalCount }
    gfi: issues(states: OPEN, labels: $gfi) { totalCount }
    help: issues(states: OPEN, labels: $help) { totalCount }
    page: issues(states: OPEN, labels: $labels, first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId
        number
        title
        url
        body
        createdAt
        updatedAt
        author { login }
        comments { totalCount }
        assignees(first: 1) { totalCount }
        labels(first: 12) { nodes { name color } }
        closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount }
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], last: 25) {
          nodes {
            __typename
            ... on CrossReferencedEvent { source { __typename ... on PullRequest { state } } }
          }
        }
      }
    }
  }
  rateLimit { limit remaining resetAt }
}`;

interface GqlIssueNode extends GqlLinkedPrFields {
  databaseId: number;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: { login?: string } | null;
  comments: { totalCount: number };
  assignees: { totalCount: number };
  labels?: { nodes: ({ name: string; color?: string } | null)[] } | null;
}

interface GqlResponse {
  data?: {
    repository: {
      all: { totalCount: number };
      gfi: { totalCount: number };
      help: { totalCount: number };
      page: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (GqlIssueNode | null)[] };
    } | null;
    rateLimit?: { limit: number; remaining: number; resetAt: string } | null;
  } | null;
  errors?: { type?: string; message?: string }[];
}

export interface LoadOptions {
  owner: string;
  name: string;
  tab: IssueTab;
  labels: Record<LabelTab, string[]>;
  /** A cursor from a previous page's `next`. */
  after?: string | null;
  token?: string | null;
  /** The network: shared/ never touches `fetch` itself (Node, Workers and the browser pass theirs). */
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  /** Sent as User-Agent where the runtime allows it (not browsers). */
  userAgent?: string;
}

const repoOf = (owner: string, name: string) => ({
  fullName: `${owner}/${name}`,
  owner,
  avatarUrl: `https://github.com/${owner}.png?size=64`,
  url: `https://github.com/${owner}/${name}`,
});

function headers(token: string | null | undefined, userAgent?: string, json = false): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (userAgent) h['User-Agent'] = userAgent;
  if (token) h.Authorization = `Bearer ${token.trim()}`;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function readRateLimit(res: Response) {
  const num = (k: string) => {
    const v = res.headers.get(k);
    return v == null || v === '' ? undefined : Number(v);
  };
  const info = {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    reset: num('x-ratelimit-reset'),
  };
  return info.limit === undefined && info.remaining === undefined ? undefined : info;
}

/** GitHub answers a spent quota with 403 or 429 (and remaining 0, or a Retry-After). */
function rateLimitError(res: Response): RepoIssuesError | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const retryAfter = Number(res.headers.get('retry-after'));
  if (res.status === 403 && remaining !== '0' && !retryAfter) return null;
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const resetAt = retryAfter ? Date.now() + retryAfter * 1000 : reset ? reset * 1000 : undefined;
  return new RepoIssuesError('rate_limited', 'GitHub rate limit reached', resetAt);
}

function httpError(res: Response): RepoIssuesError {
  const limited = rateLimitError(res);
  if (limited) return limited;
  if (res.status === 401) return new RepoIssuesError('auth', 'GitHub rejected the access token');
  if (res.status === 404) return new RepoIssuesError('not_found', 'No such repository');
  return new RepoIssuesError('unavailable', `GitHub returned ${res.status}`);
}

async function send(f: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await f(url, { ...init, signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' && signal?.aborted) throw err;
    throw new RepoIssuesError('unavailable', `Could not reach GitHub: ${(err as Error)?.message ?? err}`);
  }
}

export async function loadRepoIssuesGraphql(o: LoadOptions): Promise<RepoIssuesResponse> {
  const f = o.fetchImpl;
  const variables = {
    owner: o.owner,
    name: o.name,
    gfi: o.labels.gfi,
    help: o.labels.help,
    labels: o.tab === 'all' ? null : o.labels[o.tab],
    first: REPO_ISSUES_PAGE,
    after: o.after || null,
  };
  const res = await send(
    f,
    `${API}/graphql`,
    {
      method: 'POST',
      headers: headers(o.token, o.userAgent, true),
      body: JSON.stringify({ query: REPO_ISSUES_QUERY, variables }),
    },
    o.signal,
  );
  if (!res.ok) throw httpError(res);
  const body = (await res.json()) as GqlResponse;
  const errors = body.errors ?? [];
  const rl = body.data?.rateLimit;
  const resetAt = rl?.resetAt ? Date.parse(rl.resetAt) : undefined;
  if (errors.some((e) => e.type === 'RATE_LIMITED')) {
    throw new RepoIssuesError('rate_limited', 'GitHub rate limit reached', resetAt);
  }
  const repo = body.data?.repository;
  if (!repo) {
    if (errors.some((e) => e.type === 'NOT_FOUND')) throw new RepoIssuesError('not_found', 'No such repository');
    throw new RepoIssuesError('unavailable', errors[0]?.message ?? 'GitHub returned no data');
  }
  const r = repoOf(o.owner, o.name);
  const items = repo.page.nodes
    .filter((n): n is GqlIssueNode => !!n)
    .map((n): RepoIssue => ({
      id: n.databaseId,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: r,
      labels: (n.labels?.nodes ?? [])
        .filter((l): l is { name: string; color?: string } => !!l?.name)
        .map((l) => ({ name: l.name, color: l.color || 'ededed' })),
      comments: n.comments.totalCount,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      bodyExcerpt: excerpt(n.body),
      author: n.author?.login ?? '',
      linkedPr: hasLinkedPr(n),
      assigned: n.assignees.totalCount > 0,
    }));
  return {
    items,
    hasMore: repo.page.pageInfo.hasNextPage,
    next: repo.page.pageInfo.hasNextPage ? repo.page.pageInfo.endCursor : null,
    counts: { all: repo.all.totalCount, gfi: repo.gfi.totalCount, help: repo.help.totalCount },
    labels: o.labels,
    source: 'github',
    via: 'graphql',
    ...(rl
      ? { rateLimit: { limit: rl.limit, remaining: rl.remaining, reset: resetAt ? resetAt / 1000 : undefined } }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* REST (no token)                                                     */
/* ------------------------------------------------------------------ */

export interface GhRestIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  labels: ({ name?: string; color?: string } | string)[];
  comments: number;
  created_at: string;
  updated_at: string;
  user?: { login?: string } | null;
  assignee?: unknown;
  assignees?: unknown[] | null;
  pull_request?: unknown;
}

/** One URL per label spelling (REST's `labels=` is an AND), or one without labels for "All open". */
export function restIssueUrls(o: Pick<LoadOptions, 'owner' | 'name' | 'tab' | 'labels'>, page: number): string[] {
  const base = `${API}/repos/${o.owner}/${o.name}/issues`;
  const params = (label?: string) => {
    const p = new URLSearchParams({
      state: 'open',
      per_page: String(REPO_ISSUES_PAGE),
      page: String(page),
      sort: 'created',
      direction: 'desc',
    });
    if (label) p.set('labels', label);
    return `${base}?${p}`;
  };
  if (o.tab === 'all') return [params()];
  return o.labels[o.tab].slice(0, MAX_REST_LABELS).map(params);
}

export function restToIssue(i: GhRestIssue, owner: string, name: string): RepoIssue {
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    url: i.html_url,
    repo: repoOf(owner, name),
    labels: i.labels
      .map((l) =>
        typeof l === 'string' ? { name: l, color: 'ededed' } : { name: l.name ?? '', color: l.color || 'ededed' },
      )
      .filter((l) => l.name),
    comments: i.comments,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    bodyExcerpt: excerpt(i.body),
    author: i.user?.login ?? '',
    assigned: (i.assignees?.length ?? 0) > 0 || !!i.assignee,
  };
}

/**
 * One page per label spelling → one list: pull requests out, duplicates (an issue with two
 * of the spellings) once, newest first. More pages exist while any list came back full.
 */
export function mergeRestPages(pages: GhRestIssue[][], owner: string, name: string) {
  const seen = new Set<number>();
  const items: RepoIssue[] = [];
  for (const page of pages) {
    for (const i of page) {
      if (i.pull_request || seen.has(i.id)) continue;
      seen.add(i.id);
      items.push(restToIssue(i, owner, name));
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.number - a.number));
  return { items, hasMore: pages.some((p) => p.length === REPO_ISSUES_PAGE) };
}

export async function loadRepoIssuesRest(o: LoadOptions): Promise<RepoIssuesResponse> {
  const f = o.fetchImpl;
  const page = Math.min(Math.max(Number.parseInt(o.after ?? '1', 10) || 1, 1), 100);
  let rateLimit: RepoIssuesResponse['rateLimit'];
  const pages = await Promise.all(
    restIssueUrls(o, page).map(async (url) => {
      const res = await send(f, url, { headers: headers(o.token, o.userAgent) }, o.signal);
      rateLimit = readRateLimit(res) ?? rateLimit;
      if (!res.ok) throw httpError(res);
      return (await res.json()) as GhRestIssue[];
    }),
  );
  const { items, hasMore } = mergeRestPages(pages, o.owner, o.name);
  return {
    items,
    hasMore,
    next: hasMore ? String(page + 1) : null,
    counts: null,
    labels: o.labels,
    source: 'github',
    via: 'rest',
    ...(rateLimit ? { rateLimit } : {}),
  };
}

/** GraphQL with a token (exact counts), REST without. */
export function loadRepoIssues(o: LoadOptions): Promise<RepoIssuesResponse> {
  return o.token ? loadRepoIssuesGraphql(o) : loadRepoIssuesRest(o);
}

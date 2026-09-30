/**
 * A repo page's live issues (shared/repoIssues.ts has the rules and the GitHub calls).
 *
 * Order of preference:
 *   1. Our API, `/api/repo-issues` (server token, exact counts, a cache shared by every visitor).
 *   2. GitHub straight from the browser when the API isn't there (static preview, or a Worker
 *      deployed before the endpoint existed: a 404 that isn't `repo_not_found`), when it can't
 *      reach GitHub, or when it is rate limited and the visitor has a token of their own.
 *      With the visitor's token that is GraphQL (exact counts), without it the REST list
 *      (no counts).
 * Never sample issues: a repo page shows that repo's issues or says why it can't.
 */
import type { RepoRecord } from '../../../shared/repo';
import {
  loadRepoIssues,
  parseRepoName,
  RepoIssuesError,
  tabLabels,
  type IssueTab,
  type LabelTab,
  type RepoIssuesResponse,
  type TabCounts,
} from '../../../shared/repoIssues';
import { fromBackendIssue } from './search';
import type { Issue } from './types';

export { RepoIssuesError, type IssueTab, type TabCounts };

const API = '/api/repo-issues';

export interface RepoIssuesPage {
  items: Issue[];
  hasMore: boolean;
  next: string | null;
  counts: TabCounts | null;
  via: 'graphql' | 'rest';
}

/** The spellings each tab asks for: the repo's own (from the dataset), else the common ones. */
export function repoTabLabels(repo: Pick<RepoRecord, 'issueLabels'>): Record<LabelTab, string[]> {
  return { gfi: tabLabels(repo.issueLabels, 'gfi'), help: tabLabels(repo.issueLabels, 'help') };
}

/** Session-scoped: once the API is found missing, go straight to GitHub until reload. */
let apiAvailable = true;

/** Test hook. */
export function resetRepoIssuesState(): void {
  apiAvailable = true;
}

class ApiUnavailable extends Error {}

export interface FetchRepoIssuesOptions {
  after?: string | null;
  token?: string | null;
  signal?: AbortSignal;
}

export async function fetchRepoIssues(
  repo: Pick<RepoRecord, 'fullName' | 'issueLabels'>,
  tab: IssueTab,
  opts: FetchRepoIssuesOptions = {},
): Promise<RepoIssuesPage> {
  const name = parseRepoName(repo.fullName);
  if (!name) throw new RepoIssuesError('not_found', 'Not a GitHub repository name');
  const labels = repoTabLabels(repo);

  if (apiAvailable) {
    try {
      return toPage(await fromApi(repo.fullName, tab, labels, opts));
    } catch (err) {
      if (isAbort(err, opts.signal)) throw err;
      if (err instanceof RepoIssuesError) {
        // The server's quota is spent: the visitor's own token can still ask GitHub.
        if (!(err.kind === 'rate_limited' && opts.token)) throw err;
      } else if (err instanceof ApiUnavailable) {
        apiAvailable = false;
      }
      // Anything else (a 503, a 400): straight to GitHub for this request.
    }
  }

  const body = await loadRepoIssues({
    ...name,
    tab,
    labels,
    after: opts.after,
    token: opts.token,
    signal: opts.signal,
    fetchImpl: (input, init) => fetch(input, init),
  });
  return toPage(body);
}

const isAbort = (err: unknown, signal?: AbortSignal) =>
  !!signal?.aborted || (err instanceof DOMException && err.name === 'AbortError');

async function fromApi(
  fullName: string,
  tab: IssueTab,
  labels: Record<LabelTab, string[]>,
  opts: FetchRepoIssuesOptions,
): Promise<RepoIssuesResponse> {
  const params = new URLSearchParams({ repo: fullName, tab, gfi: labels.gfi.join(','), help: labels.help.join(',') });
  if (opts.after) params.set('after', opts.after);
  let res: Response;
  try {
    res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' }, signal: opts.signal });
  } catch (err) {
    if (isAbort(err, opts.signal)) throw err;
    throw new ApiUnavailable('network');
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  // An HTML page (the SPA fallback on static hosting) means there is no API at all.
  if (!isJson) throw new ApiUnavailable(`status ${res.status}`);
  let body: (RepoIssuesResponse & { error?: string; resetAt?: number | null }) | null;
  try {
    body = await res.json();
  } catch {
    throw new ApiUnavailable('invalid JSON');
  }
  if (res.ok && body && Array.isArray(body.items)) return body;
  if (res.status === 404 && body?.error === 'repo_not_found') {
    throw new RepoIssuesError('not_found', 'No such repository');
  }
  // A 404 without that error is a Worker from before this endpoint existed.
  if (res.status === 404) throw new ApiUnavailable('no endpoint');
  if (res.status === 429 && body?.error === 'rate_limited') {
    throw new RepoIssuesError('rate_limited', 'GitHub rate limit reached', body.resetAt ?? undefined);
  }
  throw new Error(`status ${res.status}`);
}

function toPage(r: RepoIssuesResponse): RepoIssuesPage {
  return { items: r.items.map(fromBackendIssue), hasMore: r.hasMore, next: r.next, counts: r.counts, via: r.via };
}

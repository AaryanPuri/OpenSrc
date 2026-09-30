/**
 * The e2e `test`: every page gets GitHub and /api/search mocked, and nothing leaves
 * 127.0.0.1, so runs are fast and deterministic.
 *
 * - `/api/search?gq=…` answers three made-up issues in the `repo:` it asks for, and
 *   none when the query asks for `label:documentation` (a repo without that label).
 * - `/api/repo-issues?repo=…&tab=…` answers three made-up issues in that repo (the second
 *   one assigned) with exact per-tab counts (REPO_ISSUE_COUNTS).
 * - `https://api.github.com/*` answers from `github` (per test), else 404.
 * - Avatars are a 1×1 PNG; any other outside request is aborted.
 */
import { test as base, expect, type Page, type Route } from '@playwright/test';

export { expect };

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

export const ISSUE_TITLES = [
  'Document the config file format',
  'Add a --quiet flag',
  'Fix a typo in the error message',
];

/** What /api/search returns for a GitHub query, like the real server does. */
export function searchResponse(gq: string) {
  const repo = /repo:(\S+)/.exec(gq)?.[1] ?? 'acme/widget';
  const [owner] = repo.split('/');
  const none = /label:documentation/.test(gq);
  const items = none
    ? []
    : ISSUE_TITLES.map((title, i) => ({
        id: 9000 + i,
        number: 100 + i,
        title,
        url: `https://github.com/${repo}/issues/${100 + i}`,
        repo: { fullName: repo, owner, avatarUrl: '', url: `https://github.com/${repo}` },
        labels: [{ name: 'good first issue', color: '7057ff' }],
        comments: i,
        createdAt: '2026-09-20T10:00:00Z',
        updatedAt: '2026-09-27T10:00:00Z',
        bodyExcerpt: 'A small, well-scoped change with pointers in the description.',
        author: 'octo',
      }));
  return { parsed: null, githubQuery: gq, total: items.length, items, source: 'github' };
}

/** The per-tab counts the mocked /api/repo-issues reports. */
export const REPO_ISSUE_COUNTS = { all: 128, gfi: 7, help: 12 };

/** What /api/repo-issues returns for a repo and tab, like the real API does. */
export function repoIssuesResponse(repo: string, tab: string) {
  const [owner] = repo.split('/');
  const items = ISSUE_TITLES.map((title, i) => ({
    id: 7000 + i,
    number: 200 + i,
    title: tab === 'all' ? title : `${title} (${tab})`,
    url: `https://github.com/${repo}/issues/${200 + i}`,
    repo: { fullName: repo, owner, avatarUrl: '', url: `https://github.com/${repo}` },
    labels: [{ name: tab === 'help' ? 'help wanted' : 'good first issue', color: '7057ff' }],
    comments: i,
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
    bodyExcerpt: 'A small, well-scoped change with pointers in the description.',
    author: 'octo',
    assigned: i === 1,
  }));
  return {
    items,
    hasMore: false,
    next: null,
    counts: REPO_ISSUE_COUNTS,
    labels: { gfi: ['good first issue'], help: ['help wanted'] },
    source: 'github',
    via: 'graphql',
  };
}

type GithubHandler = (url: URL) => { status?: number; json: unknown } | undefined;

export interface Mocks {
  /** Answers for api.github.com, by URL. */
  github: GithubHandler[];
  /** Every /api/search query the page made. */
  searches: string[];
  /** Every /api/repo-issues query string the page made. */
  repoIssues: URLSearchParams[];
}

export async function mockNetwork(page: Page, mocks: Mocks): Promise<void> {
  await page.route(
    (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'api.github.com') {
        for (const h of mocks.github) {
          const hit = h(url);
          if (hit) return route.fulfill({ status: hit.status ?? 200, json: hit.json });
        }
        return route.fulfill({ status: 404, json: { message: 'Not Found' } });
      }
      if (url.hostname.startsWith('avatars.') || /\.png$/.test(url.pathname)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
      }
      return route.abort();
    },
  );
  await page.route('**/api/search?*', (route) => {
    const gq = new URL(route.request().url()).searchParams.get('gq') ?? '';
    mocks.searches.push(gq);
    return route.fulfill({ json: searchResponse(gq) });
  });
  await page.route('**/api/repo-issues?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    mocks.repoIssues.push(params);
    return route.fulfill({ json: repoIssuesResponse(params.get('repo') ?? '', params.get('tab') ?? 'gfi') });
  });
}

export const test = base.extend<{ mocks: Mocks }>({
  mocks: [
    async ({ page }, use) => {
      const mocks: Mocks = { github: [], searches: [], repoIssues: [] };
      await mockNetwork(page, mocks);
      await use(mocks);
    },
    { auto: true },
  ],
});

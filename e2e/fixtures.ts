/**
 * The e2e `test`: every page gets GitHub and /api/search mocked, and nothing leaves
 * 127.0.0.1, so runs are fast and deterministic.
 *
 * - `/api/search?gq=…` answers three made-up issues in the `repo:` it asks for, and
 *   none when the query asks for `label:documentation` (a repo without that label).
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

type GithubHandler = (url: URL) => { status?: number; json: unknown } | undefined;

export interface Mocks {
  /** Answers for api.github.com, by URL. */
  github: GithubHandler[];
  /** Every /api/search query the page made. */
  searches: string[];
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
}

export const test = base.extend<{ mocks: Mocks }>({
  mocks: [
    async ({ page }, use) => {
      const mocks: Mocks = { github: [], searches: [] };
      await mockNetwork(page, mocks);
      await use(mocks);
    },
    { auto: true },
  ],
});

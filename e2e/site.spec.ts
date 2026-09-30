import { flagIssueUrl, submitIssueUrl } from '../shared/issueForms';
import { expect, ISSUE_TITLES, mockNetwork, REPO_ISSUE_COUNTS, test } from './fixtures';

/** The fixture dataset (frontend/test/fixtures/dataset): 8 repos, 3 of them Rust. */
const RUST = ['gleam-lang/gleam', 'PyO3/pyo3', 'uutils/coreutils'];
/** All but Dexie.js are first-PR friendly (all 3 Rust ones are). */
const FIRST_PR = 7;

test.describe('directory', () => {
  test('home grid renders, and a plain-words search filters it with patches', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('repo-card')).toHaveCount(8);

    const input = page.getByTestId('search-input');
    await input.fill('beginner friendly rust repos');
    await input.press('Enter');
    await expect(page).toHaveURL(/\?q=beginner(\+|%20)friendly(\+|%20)rust(\+|%20)repos/);

    const chips = page.getByTestId('filter-chip');
    await expect(chips.filter({ hasText: 'Rust' })).toHaveCount(1);
    await expect(chips.filter({ hasText: 'First-PR friendly' })).toHaveCount(1);
    const cards = page.getByTestId('repo-card');
    await expect(cards).toHaveCount(RUST.length);
    for (const name of RUST) await expect(cards.filter({ hasText: name.split('/')[1] })).toHaveCount(1);
  });

  test('the First-PR toggle is the only audience switch, and the heading holds the one count', async ({ page }) => {
    await page.goto('/');
    const heading = page.locator('#repos-title');
    const toggle = page.getByTestId('first-pr-switch');
    await expect(heading).toHaveText('8 projects');
    await expect(page.getByRole('group', { name: 'Difficulty' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Challenge|Some exp/ })).toHaveCount(0);
    // The toggle describes itself; it carries no number.
    const label = page.locator('label').filter({ has: toggle });
    await expect(label).toContainText('Only repos ready for your first PR');
    expect(await label.innerText()).not.toMatch(/\d/);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/[?&]first=1/);
    await expect(heading).toHaveText(`${FIRST_PR} first-PR friendly repos`);
    await expect(page.getByTestId('repo-card')).toHaveCount(FIRST_PR);
    await expect(page.getByText('by most unclaimed issues')).toBeVisible();
    await expect(page.getByTestId('gfi-tag').first()).toContainText('unclaimed good first');
    await expect(page.getByTestId('first-pr-hint')).toHaveCount(0);
    // Every card qualifies here, so no card repeats the ribbon.
    await expect(page.getByTestId('first-pr-ribbon')).toHaveCount(0);

    await toggle.click();
    await expect(heading).toHaveText('8 projects');
    await expect(page.getByText('by best score')).toBeVisible();
    await expect(page.getByTestId('first-pr-hint')).toBeVisible();
    await expect(page.getByTestId('repo-card').getByTestId('first-pr-ribbon')).toHaveCount(FIRST_PR);
  });

  test('beginner wording turns the toggle on; unpicking its patch turns it off', async ({ page }) => {
    await page.goto('/');
    const input = page.getByTestId('search-input');
    await input.fill('beginner friendly rust repos');
    await input.press('Enter');
    const toggle = page.getByTestId('first-pr-switch');
    const heading = page.locator('#repos-title');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(heading).toHaveText(`${RUST.length} first-PR friendly repos`);

    const patch = page.getByTestId('filter-chip').filter({ hasText: 'First-PR friendly' });
    await patch.getByTestId('chip-remove').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page).toHaveURL(/\?q=rust$/);
    await expect(heading).toHaveText(`${RUST.length} projects`);
    await expect(page.getByTestId('filter-chip').filter({ hasText: 'First-PR friendly' })).toHaveCount(0);

    // Switching the toggle off takes the wording with it too.
    await input.fill('beginner rust');
    await input.press('Enter');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page).toHaveURL(/\?q=rust$/);
  });

  test('help wanted / intermediate stay issue-level, as one Contributions welcome patch', async ({ page }) => {
    await page.goto('/?q=intermediate');
    await expect(page.locator('#repos-title')).toHaveText('8 projects');
    await expect(page.getByTestId('first-pr-switch')).toHaveAttribute('aria-checked', 'false');
    const chips = page.getByTestId('filter-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips).toContainText('Contributions welcome');
  });

  test('/?first=1 still works', async ({ page }) => {
    await page.goto('/?first=1');
    await expect(page.getByTestId('first-pr-switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#repos-title')).toHaveText(`${FIRST_PR} first-PR friendly repos`);
    await expect(page.getByTestId('repo-card')).toHaveCount(FIRST_PR);
  });

  test('card → repo page with live issues, and back to the same search', async ({ page, mocks }) => {
    await page.goto('/?q=beginner%20rust&sort=stars&first=1');
    await page.getByTestId('repo-card').filter({ hasText: 'gleam' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/repo\/gleam-lang\/gleam\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'gleam' })).toBeVisible();

    const issues = page.getByTestId('repo-issues');
    await expect(issues.getByText(`${ISSUE_TITLES[0]} (gfi)`)).toBeVisible();
    // Exactly GitHub's sets, from the repo-issues endpoint (not issue search).
    expect(mocks.repoIssues.some((p) => p.get('repo') === 'gleam-lang/gleam' && p.get('tab') === 'gfi')).toBe(true);
    expect(mocks.searches).toEqual([]);
    // GitHub's live counts on every tab, and assigned issues listed, tagged.
    await expect(page.getByTestId('issue-tab-count')).toHaveText(
      [REPO_ISSUE_COUNTS.gfi, REPO_ISSUE_COUNTS.help, REPO_ISSUE_COUNTS.all].map(String),
    );
    await expect(issues.getByTestId('assigned')).toHaveCount(1);
    await expect(page.getByTestId('repo-facts')).toContainText(`Good first issues${REPO_ISSUE_COUNTS.gfi}`);

    await page.getByTestId('issue-tab').filter({ hasText: 'All open' }).click();
    await expect(issues.getByText(ISSUE_TITLES[0], { exact: true })).toBeVisible();
    expect(mocks.repoIssues.some((p) => p.get('tab') === 'all')).toBe(true);

    const back = page.getByRole('link', { name: 'Back to your search' });
    await expect(back).toHaveAttribute('href', '/?q=beginner+rust&sort=stars&first=1');
    await back.click();
    await expect(page).toHaveURL(/\/\?q=beginner\+rust&sort=stars&first=1$/);
  });

  test('a search picks the tab a repo page opens on, but never filters it', async ({ page, mocks }) => {
    await page.goto('/repo/gleam-lang/gleam?q=rust%20docs%20help%20wanted');
    await expect(page.getByRole('tab', { selected: true })).toContainText('Contributions welcome');
    await expect(page.getByTestId('repo-issues').getByText(`${ISSUE_TITLES[1]} (help)`)).toBeVisible();
    await expect(page.getByTestId('issue-narrowing')).toHaveCount(0);
    expect(mocks.repoIssues.every((p) => [...p.keys()].sort().join() === 'gfi,help,repo,tab')).toBe(true);
  });

  test('a spent GitHub quota gets a breather with a GitHub link, never other repos', async ({ page, mocks }) => {
    await page.route('**/api/repo-issues?*', (route) =>
      route.fulfill({ status: 429, json: { error: 'rate_limited', resetAt: Date.now() + 33_000 } }),
    );
    await page.goto('/repo/gleam-lang/gleam');
    const breather = page.getByTestId('rate-limited');
    await expect(breather).toContainText('GitHub needs a short breather.');
    await expect(breather.getByTestId('rate-limited-countdown')).toContainText(/Try again in 0:3\d\./);
    await expect(breather.getByTestId('issues-on-github')).toHaveAttribute(
      'href',
      'https://github.com/gleam-lang/gleam/issues?q=is:issue+is:open+label:%22good+first+issue%22',
    );
    await expect(breather.getByRole('button', { name: 'Retry' })).toBeVisible();
    // Nothing from anywhere else: no issue cards, no samples, no counts.
    await expect(page.getByTestId('result-card')).toHaveCount(0);
    await expect(page.getByTestId('repo-issues')).toHaveCount(0);
    await expect(page.getByTestId('sample-banner')).toHaveCount(0);
    await expect(page.getByTestId('issue-tab-count')).toHaveCount(0);
    for (const other of ['withastro', 'pola-rs', 'material-ui', 'Sample']) {
      await expect(page.locator('#repo-issues')).not.toContainText(other);
    }
    expect(mocks.searches).toEqual([]);

    await page.getByTestId('issue-tab').filter({ hasText: 'All open' }).click();
    await expect(breather.getByTestId('issues-on-github')).toHaveAttribute(
      'href',
      'https://github.com/gleam-lang/gleam/issues?q=is:issue+is:open',
    );
  });

  test('a Worker without the endpoint falls back to GitHub itself, still only this repo', async ({ page, mocks }) => {
    await page.route('**/api/repo-issues?*', (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
    const asked: URL[] = [];
    mocks.github.push((url) => {
      if (url.pathname !== '/repos/gleam-lang/gleam/issues') return undefined;
      asked.push(url);
      return {
        json: [
          {
            id: 1,
            number: 42,
            title: 'Straight from GitHub',
            html_url: 'https://github.com/gleam-lang/gleam/issues/42',
            labels: [{ name: 'good first issue', color: '7057ff' }],
            comments: 0,
            created_at: '2026-09-20T10:00:00Z',
            updated_at: '2026-09-20T10:00:00Z',
            user: { login: 'octo' },
            assignees: [],
          },
          { id: 2, number: 43, title: 'A pull request', pull_request: {}, labels: [], comments: 0 },
        ],
      };
    });
    await page.goto('/repo/gleam-lang/gleam');
    const issues = page.getByTestId('repo-issues');
    await expect(issues.getByText('Straight from GitHub')).toBeVisible();
    await expect(issues.getByText('A pull request')).toHaveCount(0);
    // REST can't count exactly, so no number rather than a wrong one.
    await expect(page.getByTestId('issue-tab-count')).toHaveCount(0);
    expect(asked[0].searchParams.get('labels')).toBe('good first issue');
    expect(mocks.searches).toEqual([]);
  });

  test('a repo page is complete without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await mockNetwork(page, { github: [], searches: [], repoIssues: [] });
    const res = await page.goto('/repo/gleam-lang/gleam');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'gleam' })).toBeVisible();
    await expect(page.getByTestId('repo-facts')).toContainText('Good first issues');
    await expect(page.getByTestId('score-parts')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://opensrc.studio/repo/gleam-lang/gleam',
    );
    await context.close();
  });

  test('language, field and collection pages', async ({ page }) => {
    await page.goto('/language/rust');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rust');
    await expect(page.getByTestId('repo-card')).toHaveCount(RUST.length);
    await expect(page.getByRole('heading', { level: 2, name: /projects/ })).toContainText(`${RUST.length} projects`);
    await page.getByTestId('first-pr-switch').click();
    await expect(page).toHaveURL(/\/language\/rust\?first=1$/);
    await expect(page.getByRole('heading', { level: 2, name: /first-PR/ })).toContainText(
      `${RUST.length} first-PR friendly repos`,
    );

    await page.goto('/field/compilers');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Compilers');
    await expect(page.getByTestId('repo-card').filter({ hasText: 'gleam' })).toHaveCount(1);

    await page.goto('/collections');
    // Blocks carry a title and a blurb, no counts: the collection's page has its one count.
    await expect(page.getByTestId('collection-block')).toHaveCount(5);
    for (const block of await page.getByTestId('collection-block').all()) {
      expect(await block.innerText()).not.toMatch(/\d+\s+repos|None yet/);
    }
    await page.getByTestId('collection-block').first().click();
    await expect(page).toHaveURL(/\/collections\/first-pr$/);
    await expect(page.getByTestId('repo-card').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /first-PR/ })).toContainText(
      `${FIRST_PR} first-PR friendly repos`,
    );
    // Every repo here is first-PR friendly, so the cards don't repeat the ribbon.
    await expect(page.getByTestId('first-pr-ribbon')).toHaveCount(0);
  });

  test('an unknown repo is a 404', async ({ page }) => {
    const res = await page.goto('/repo/nobody/nothing-here');
    expect(res?.status()).toBe(404);
    await expect(page.getByText("This repo isn't in the directory")).toBeVisible();
  });
});

test.describe('submit and flag', () => {
  test('checks a repo against GitHub (mocked) and links a prefilled submission', async ({ page, mocks }) => {
    const repo = 'octo/new-tool';
    const recent = '2026-09-25T10:00:00Z';
    mocks.github.push((url) => {
      const p = url.pathname;
      if (p === `/repos/${repo}`) {
        return {
          json: {
            full_name: repo,
            name: 'new-tool',
            owner: { login: 'octo', avatar_url: '' },
            description: 'A friendly command line tool for tidy notes',
            homepage: null,
            language: 'Rust',
            topics: ['cli'],
            stargazers_count: 420,
            forks_count: 12,
            license: { spdx_id: 'MIT' },
            archived: false,
            fork: false,
            mirror_url: null,
            pushed_at: recent,
            created_at: '2024-01-01T00:00:00Z',
          },
        };
      }
      if (p === `/repos/${repo}/community/profile`) {
        return {
          json: { files: { contributing: { html_url: `https://github.com/${repo}/blob/main/CONTRIBUTING.md` } } },
        };
      }
      if (p === `/repos/${repo}/commits`) return { json: [{ commit: { committer: { date: recent } } }] };
      if (p === `/repos/${repo}/labels`) return { json: [{ name: 'good first issue' }, { name: 'help wanted' }] };
      if (p === '/search/issues') {
        const count = url.searchParams.get('q')!.includes('good first issue') ? 6 : 2;
        return { json: { total_count: count, items: Array.from({ length: count }, () => ({ comments: 0 })) } };
      }
      return undefined;
    });

    await page.goto('/submit');
    const form = page.getByTestId('check-form');
    await form.getByRole('textbox').fill(`https://github.com/${repo}`);
    await form.getByRole('button', { name: 'Check it' }).click();
    await expect(page.getByTestId('check-verdict')).toBeVisible();
    await expect(page.getByTestId('file-submission')).toHaveAttribute('href', submitIssueUrl(repo));
  });

  test('every repo page links a prefilled flag form', async ({ page }) => {
    await page.goto('/repo/PyO3/pyo3');
    await expect(page.getByTestId('flag-repo')).toHaveAttribute('href', flagIssueUrl('PyO3/pyo3'));
  });
});

test.describe('saving and the newsletter', () => {
  test('a repo saved while signed out survives a reload', async ({ page }) => {
    await page.goto('/repo/uutils/coreutils');
    const save = page.getByTestId('save-repo');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('save-repo')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('saved-button').click();
    await expect(page.getByTestId('saved-drawer').getByTestId('saved-repo')).toContainText('coreutils');
  });

  test('subscribing to the newsletter shows the check-your-email state', async ({ page }) => {
    await page.goto('/');
    const form = page.getByTestId('newsletter-form');
    await form.getByRole('textbox', { name: /email/i }).fill('reader@example.com');
    await form.getByRole('button', { name: /subscribe|sign up/i }).click();
    await expect(page.getByTestId('newsletter-sent')).toBeVisible();
  });
});

test('/issues still searches issues', async ({ page }) => {
  await page.goto('/issues?q=beginner%20rust');
  await expect(page.getByTestId('result-card').first()).toBeVisible();
  await expect(page.getByTestId('result-card')).toHaveCount(ISSUE_TITLES.length);
  await expect(page.getByTestId('result-card').first()).toContainText(ISSUE_TITLES[0]);
});

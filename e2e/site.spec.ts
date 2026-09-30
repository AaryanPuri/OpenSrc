import { flagIssueUrl, submitIssueUrl } from '../shared/issueForms';
import { expect, ISSUE_TITLES, mockNetwork, test } from './fixtures';

/** The fixture dataset (frontend/test/fixtures/dataset): 8 repos, 3 of them Rust. */
const RUST = ['gleam-lang/gleam', 'PyO3/pyo3', 'uutils/coreutils'];

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
    await expect(chips.filter({ hasText: 'Good first issues' })).toHaveCount(1);
    const cards = page.getByTestId('repo-card');
    await expect(cards).toHaveCount(RUST.length);
    for (const name of RUST) await expect(cards.filter({ hasText: name.split('/')[1] })).toHaveCount(1);
  });

  test('card → repo page with live issues, and back to the same search', async ({ page, mocks }) => {
    await page.goto('/?q=beginner%20rust&sort=stars&first=1');
    await page.getByTestId('repo-card').filter({ hasText: 'gleam' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/repo\/gleam-lang\/gleam\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'gleam' })).toBeVisible();

    const issues = page.getByTestId('repo-issues');
    await expect(issues.getByText(ISSUE_TITLES[0])).toBeVisible();
    expect(mocks.searches.some((q) => q.startsWith('repo:gleam-lang/gleam '))).toBe(true);

    const back = page.getByRole('link', { name: 'Back to your search' });
    await expect(back).toHaveAttribute('href', '/?q=beginner+rust&sort=stars&first=1');
    await back.click();
    await expect(page).toHaveURL(/\/\?q=beginner\+rust&sort=stars&first=1$/);
  });

  test('a repo tab narrowed to nothing falls back to the whole list, with a note', async ({ page }) => {
    await page.goto('/repo/gleam-lang/gleam?q=rust%20docs');
    await expect(page.getByTestId('issue-fallback')).toHaveText(
      "No 'docs'-labelled issues here, showing all good first issues.",
    );
    await expect(page.getByTestId('repo-issues').getByText(ISSUE_TITLES[1])).toBeVisible();
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
  });

  test('a repo page is complete without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await mockNetwork(page, { github: [], searches: [] });
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

    await page.goto('/field/compilers');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Compilers');
    await expect(page.getByTestId('repo-card').filter({ hasText: 'gleam' })).toHaveCount(1);

    await page.goto('/collections');
    await page.getByTestId('collection-block').first().click();
    await expect(page).toHaveURL(/\/collections\/first-pr$/);
    await expect(page.getByTestId('repo-card').first()).toBeVisible();
    await expect(page.getByTestId('first-pr-ribbon').first()).toBeVisible();
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

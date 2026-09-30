import { seedSession, SESSION_COOKIE } from './db';
import { BASE_URL } from './env';
import { expect, test } from './fixtures';

test('signing in imports the saves made while signed out', async ({ page, context }) => {
  // Signed out: save a repo (kept in localStorage).
  await page.goto('/repo/gleam-lang/gleam');
  await page.getByTestId('save-repo').click();
  await expect(page.getByTestId('save-repo')).toHaveAttribute('aria-pressed', 'true');

  // "Sign in": a session seeded straight into the server's database, no OAuth.
  const token = await seedSession({ githubId: 777, login: 'e2e-user', name: 'E2E User' });
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);

  const imported = page.waitForResponse(
    (r) => r.url().endsWith('/api/saved/import') && r.request().method() === 'POST',
  );
  await page.reload();
  expect((await imported).ok()).toBe(true);
  await expect(page.getByTestId('user-menu')).toBeVisible();

  // The server now has it, and the signed-in drawer shows it.
  const saved = (await (await page.request.get('/api/saved')).json()) as { items: { kind: string; key: string }[] };
  expect(saved.items).toContainEqual(expect.objectContaining({ kind: 'repo', key: 'gleam-lang/gleam' }));
  await page.getByTestId('saved-button').click();
  await expect(page.getByTestId('saved-drawer').getByTestId('saved-repo')).toContainText('gleam');
});

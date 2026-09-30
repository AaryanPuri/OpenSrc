/**
 * End-to-end tests (e2e/), Chromium only. Builds nothing itself: `npm run e2e`
 * first makes e2e/.site/ (the production bundle pre-rendered from the fixture
 * dataset, see e2e/build-site.mjs) from an existing `npm run build`, and this
 * config starts the production Node server on it, with a throwaway file database
 * and console email so login and the newsletter are switched on.
 * GitHub and /api/search are mocked in the browser (e2e/fixtures.ts).
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { BASE_URL, E2E_DB, PORT, ROOT } from './e2e/env';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      SERVE_STATIC: path.join(ROOT, 'e2e', '.site'),
      SITE_URL: BASE_URL,
      DATABASE_URL: `file:${E2E_DB}`,
      MAIL_PROVIDER: 'console',
      SESSION_SECRET: 'e2e-session-secret',
      NEWSLETTER_SECRET: 'e2e-newsletter-secret',
      NEWSLETTER_FROM: 'OpenSrc <digest@opensrc.test>',
      // Login is switched on, but the tests never go through GitHub: they seed a session (e2e/db.ts).
      GITHUB_OAUTH_CLIENT_ID: 'e2e-client-id',
      GITHUB_OAUTH_CLIENT_SECRET: 'e2e-client-secret',
    },
  },
});

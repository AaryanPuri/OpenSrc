/**
 * Makes the site the end-to-end tests run against: the production client bundle
 * from `npm run build` (frontend/dist), pre-rendered again from the 8-repo fixture
 * dataset (frontend/test/fixtures/dataset) into e2e/.site/. Small and deterministic,
 * so the tests don't depend on the nightly data. Run by `npm run e2e`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
export const SITE_DIR = path.join(ROOT, 'e2e', '.site');

for (const file of ['dist/assets', 'dist-ssr/entry-server.js']) {
  if (!existsSync(path.join(FRONTEND, file))) {
    console.error(`e2e: frontend/${file} is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }
}
if (!existsSync(path.join(ROOT, 'backend', 'dist', 'backend', 'src', 'node.js'))) {
  console.error('e2e: backend/dist is missing. Run `npm run build` first.');
  process.exit(1);
}

rmSync(SITE_DIR, { recursive: true, force: true });
// The bundle and static files, without the real dataset's pages and data (the fixture's replace them)
// and without precompressed copies (they would be the real dataset's pages).
const SKIP_DIRS = new Set(
  ['repo', 'language', 'field', 'collections', 'submit', 'data'].map((d) => path.join(FRONTEND, 'dist', d)),
);
cpSync(path.join(FRONTEND, 'dist'), SITE_DIR, {
  recursive: true,
  filter: (src) => !SKIP_DIRS.has(src) && !/\.(br|gz)$/.test(src),
});

const env = { ...process.env, SITE_URL: 'https://opensrc.studio' };
delete env.PRERENDER_LIMIT;
delete env.CI_REQUIRE_SITE_URL;
execFileSync(
  process.execPath,
  [
    path.join(FRONTEND, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    'scripts/prerender.ts',
    '--data',
    'test/fixtures/dataset',
    '--out',
    SITE_DIR,
  ],
  { cwd: FRONTEND, env, stdio: 'inherit' },
);
console.log(`e2e: site ready in ${path.relative(ROOT, SITE_DIR)}/`);

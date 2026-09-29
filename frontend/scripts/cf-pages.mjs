#!/usr/bin/env node
/**
 * Adapt a pre-rendered build (frontend/dist) for Cloudflare Pages. Run it after `npm run build`,
 * in the Pages build only. The Node server (`npm start`) serves dist as-is and doesn't need this.
 *
 * Pages serves `a/b/index.html` at `/a/b/`, redirecting `/a/b` there, which would contradict our
 * canonical URLs. It serves `a/b.html` at `/a/b`. So:
 *   1. every nested `…/index.html` becomes `….html` (the root index.html stays);
 *   2. the app shell (app.html) is copied to the client-only routes (/issues, /account);
 *   3. pre-compressed .br/.gz copies are removed, because Cloudflare compresses at the edge;
 *   4. `_headers` sets long-lived caching for hashed files and a few security headers.
 *
 * Usage: node frontend/scripts/cf-pages.mjs [distDir]   (default: frontend/dist)
 */
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv[2] ?? join(here, '..', 'dist'));
const CLIENT_ROUTES = ['issues', 'account'];
const MAX_FILES = 20_000; // Cloudflare Pages per-deployment limit (free plan)

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`cf-pages: ${dist} has no index.html. Run the frontend build first.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let flattened = 0;
let removed = 0;
for (const file of walk(dist)) {
  if (/\.(br|gz)$/.test(file)) {
    rmSync(file);
    removed++;
    continue;
  }
  if (file.endsWith('/index.html') && file !== join(dist, 'index.html')) {
    const dir = dirname(file);
    renameSync(file, `${dir}.html`);
    flattened++;
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
}

const shell = join(dist, 'app.html');
if (!existsSync(shell)) {
  console.error('cf-pages: app.html (the client-side app shell) is missing from the build.');
  process.exit(1);
}
for (const route of CLIENT_ROUTES) copyFileSync(shell, join(dist, `${route}.html`));

writeFileSync(
  join(dist, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/data/repos.*.json
  Cache-Control: public, max-age=31536000, immutable
`,
);

const total = walk(dist).length;
console.log(
  `cf-pages: flattened ${flattened} pages, added ${CLIENT_ROUTES.length} client routes, removed ${removed} precompressed files; ${total} files in ${relative(process.cwd(), dist) || '.'}`,
);
if (total > MAX_FILES) {
  console.error(`cf-pages: ${total} files exceeds the Cloudflare Pages limit of ${MAX_FILES}.`);
  process.exit(1);
}

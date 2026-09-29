/**
 * Pre-renders the site after `vite build` and `vite build --ssr src/entry-server.tsx --outDir dist-ssr`:
 *
 *   tsx scripts/prerender.ts [--data ../data] [--dist dist] [--ssr dist-ssr] [--out <dist>]
 *
 * - One HTML file per page (home, every repo, language, field and collection
 *   page, /submit), each with its <head> meta and its data inlined for hydration,
 *   plus 404.html and app.html (the shell for client-rendered routes like /issues).
 * - dist/data/: the compact index under a content hash (repos.<hash>.json),
 *   meta.json and one full record per repo (repo/<owner>/<name>.json).
 * - sitemap.xml, robots.txt and feed.xml (RSS).
 *
 * Environment:
 *   SITE_URL             origin for canonical links, the sitemap and the feed (default https://opensrc.studio)
 *   PRERENDER_LIMIT      only pre-render the N best-scored repo pages (quick local and CI builds)
 *   CI_REQUIRE_SITE_URL  "1": fail when SITE_URL isn't set
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type * as Entry from '../src/entry-server';
import type { DatasetMeta, RepoRecord } from '../../shared/repo';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Pages rendered before their files are written, at most. */
const BATCH = 64;
const FEED_ITEMS = 50;

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: path.join(FRONTEND, '..', 'data') },
    dist: { type: 'string', default: path.join(FRONTEND, 'dist') },
    ssr: { type: 'string', default: path.join(FRONTEND, 'dist-ssr') },
    out: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(`prerender: ${message}`);
  process.exit(1);
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** "/repo/a/b" → "repo/a/b/index.html" */
const fileFor = (route: Entry.SiteRoute) =>
  route.kind === 'not-found' ? '404.html' : route.path === '/' ? 'index.html' : `${route.path.slice(1)}/index.html`;

async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    bytes += (await stat(path.join(entry.parentPath, entry.name))).size;
    files++;
  }
  return { bytes, files };
}

async function main() {
  const started = performance.now();
  const dataDir = path.resolve(args.data!);
  const dist = path.resolve(args.dist!);
  const ssrDir = path.resolve(args.ssr!);
  const out = path.resolve(args.out ?? dist);

  if (!process.env.SITE_URL?.trim() && process.env.CI_REQUIRE_SITE_URL === '1') {
    fail('SITE_URL is required (CI_REQUIRE_SITE_URL=1). Set it to the production origin, e.g. https://opensrc.studio.');
  }

  const entryFile = path.join(ssrDir, 'entry-server.js');
  if (!existsSync(entryFile))
    fail(`${entryFile} is missing. Run \`vite build --ssr src/entry-server.tsx --outDir dist-ssr\` first.`);
  const ssr = (await import(pathToFileURL(entryFile).href)) as typeof Entry;

  const siteUrl = ssr.normalizeSiteUrl(process.env.SITE_URL?.trim() || ssr.DEFAULT_SITE_URL);
  if (!/^https?:\/\/[^/]+$/.test(siteUrl))
    fail(`SITE_URL must be an origin like https://opensrc.studio (got "${siteUrl}").`);
  const rawLimit = process.env.PRERENDER_LIMIT?.trim();
  const limit = rawLimit ? Number(rawLimit) : Infinity;
  if (!(limit >= 0)) fail(`PRERENDER_LIMIT must be a number (got "${rawLimit}").`);

  // dist/index.html is the template until it is overwritten with the home page;
  // a copy in dist-ssr/ lets the script run again (the smoke test does).
  const templateCopy = path.join(ssrDir, 'template.html');
  const built = await readFile(path.join(dist, 'index.html'), 'utf8').catch(() => '');
  let template: string;
  if (built.includes('<!--head-->')) {
    template = built;
    await writeFile(templateCopy, template);
  } else if (existsSync(templateCopy)) {
    template = await readFile(templateCopy, 'utf8');
  } else {
    fail(
      `No page template: ${path.join(dist, 'index.html')} has no <!--head--> placeholder. Run \`vite build\` first.`,
    );
  }
  if (!template.includes('<div id="root"></div>')) fail('The template has no empty <div id="root"></div>.');

  const records = JSON.parse(await readFile(path.join(dataDir, 'repos.json'), 'utf8')) as RepoRecord[];
  const meta = JSON.parse(await readFile(path.join(dataDir, 'meta.json'), 'utf8')) as DatasetMeta;
  const site = ssr.prepareSite(records, meta);

  // Data: the index under a content hash (cached forever), meta and the full records.
  const indexJson = JSON.stringify(site.compact);
  const hash = createHash('sha256').update(indexJson).digest('hex').slice(0, 10);
  const indexUrl = `/data/repos.${hash}.json`;
  const opts = { siteUrl, indexUrl };
  for (const dir of ['data', 'repo', 'language', 'field', 'collections', 'submit']) {
    await rm(path.join(out, dir), { recursive: true, force: true });
  }
  await mkdir(path.join(out, 'data'), { recursive: true });
  await writeFile(path.join(out, indexUrl), indexJson);
  await writeFile(path.join(out, 'data', 'meta.json'), JSON.stringify(meta));
  const dirs = new Set(records.map((r) => path.dirname(path.join(out, ssr.repoDetailPath(r.fullName)))));
  await Promise.all([...dirs].map((d) => mkdir(d, { recursive: true })));
  for (let i = 0; i < records.length; i += BATCH) {
    await Promise.all(
      records
        .slice(i, i + BATCH)
        .map((r) => writeFile(path.join(out, ssr.repoDetailPath(r.fullName)), JSON.stringify(r))),
    );
  }

  const fill = (head: string, body: string, data: Entry.PageData) =>
    template
      .replace('<!--head-->', () => head)
      .replace(
        '<div id="root"></div>',
        () =>
          `<div id="root">${body}</div>\n    <script id="${ssr.PAGE_DATA_ID}" type="application/json">${ssr.scriptJson(data)}</script>`,
      );

  // Pages.
  const routes = ssr.siteRoutes(site, limit);
  const indexed: string[] = [];
  const counts: Record<string, number> = {};
  for (let i = 0; i < routes.length; i += BATCH) {
    const writes: Promise<void>[] = [];
    for (const route of routes.slice(i, i + BATCH)) {
      const data = ssr.pageDataFor(site, route, opts);
      const { html, meta: head } = ssr.render(route.path, { dataset: ssr.toInitialDataset(data), siteUrl });
      if (!head) fail(`${route.path} rendered without page meta (useDocumentMeta).`);
      if (route.kind !== 'not-found' && head.robots?.includes('noindex') !== true) indexed.push(route.path);
      counts[route.kind] = (counts[route.kind] ?? 0) + 1;
      const file = path.join(out, fileFor(route));
      writes.push(
        mkdir(path.dirname(file), { recursive: true }).then(() =>
          writeFile(file, fill(ssr.headHtml(head), html, data)),
        ),
      );
    }
    await Promise.all(writes);
  }

  // The shell for client-rendered routes (/issues, /account): empty #root, the meta and index address inlined.
  const shellHead = [
    `<title>${xml(ssr.HOME_TITLE)}</title>`,
    '<meta name="description" content="Find an open-source repo or issue for your first contribution." />',
  ].join('\n    ');
  await writeFile(path.join(out, 'app.html'), fill(shellHead, '', ssr.shellData(site, opts)));

  // sitemap.xml: every indexable page.
  const lastmod = meta.generatedAt;
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexed.map((p) => `  <url><loc>${xml(siteUrl + encodeURI(p))}</loc><lastmod>${lastmod}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
  await writeFile(path.join(out, 'sitemap.xml'), sitemap);

  await writeFile(
    path.join(out, 'robots.txt'),
    [
      'User-agent: *',
      'Disallow: /issues',
      'Disallow: /account',
      'Disallow: /api/',
      '',
      `Sitemap: ${siteUrl}/sitemap.xml`,
      '',
    ].join('\n'),
  );

  // feed.xml: the newest listings (by when the collector first saw them), best score first among equals.
  const newest = [...records]
    .sort(
      (a, b) =>
        Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) ||
        b.score - a.score ||
        (a.fullName < b.fullName ? -1 : 1),
    )
    .slice(0, FEED_ITEMS);
  const item = (r: RepoRecord) => {
    const link = `${siteUrl}/repo/${encodeURI(r.fullName)}`;
    const facts = `${r.goodFirstIssues} good first issues, welcome score ${r.score}/100${r.languageName ? `, ${r.languageName}` : ''}.`;
    return [
      '    <item>',
      `      <title>${xml(r.fullName)}</title>`,
      `      <link>${xml(link)}</link>`,
      `      <guid isPermaLink="true">${xml(link)}</guid>`,
      `      <pubDate>${new Date(r.firstSeenAt).toUTCString()}</pubDate>`,
      `      <description>${xml(`${r.description ? `${r.description} ` : ''}${facts}`)}</description>`,
      '    </item>',
    ].join('\n');
  };
  const feed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>OpenSrc: new repos for first contributions</title>',
    `    <link>${xml(siteUrl)}/</link>`,
    `    <atom:link href="${xml(siteUrl)}/feed.xml" rel="self" type="application/rss+xml" />`,
    '    <description>Open-source repos that just joined the OpenSrc directory, with open good first issues.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${new Date(meta.generatedAt).toUTCString()}</lastBuildDate>`,
    ...newest.map(item),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
  await writeFile(path.join(out, 'feed.xml'), feed);

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const size = await dirSize(out);
  const kinds = Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  console.log(
    `prerender: ${routes.length + 1} pages (${kinds}, app shell) for ${siteUrl} in ${seconds}s; ` +
      `${indexed.length} in the sitemap; index ${indexUrl}; ${out} is ${(size.bytes / 1e6).toFixed(1)} MB in ${size.files} files`,
  );
}

main().catch((e: unknown) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));

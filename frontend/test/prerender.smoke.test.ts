import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import type { DatasetMeta, RepoRecord } from '../../shared/repo';
import { COLLECTIONS } from '../../shared/collections';

const SITE = 'https://opensrc.studio';
const out = inject('prerenderOut');
const fixture = path.resolve(__dirname, 'fixtures', 'dataset');
const repos = JSON.parse(readFileSync(path.join(fixture, 'repos.json'), 'utf8')) as RepoRecord[];
const meta = JSON.parse(readFileSync(path.join(fixture, 'meta.json'), 'utf8')) as DatasetMeta;

const read = (file: string) => readFileSync(path.join(out, file), 'utf8');

/** Every HTML file the build wrote, relative to `out`. */
const htmlFiles = (readdirSync(out, { recursive: true }) as string[])
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.split(path.sep).join('/'))
  .sort();

/** "repo/a/b/index.html" → "/repo/a/b" */
const routeOf = (file: string) => (file === 'index.html' ? '/' : `/${file.replace(/\/index\.html$/, '')}`);
const pages = htmlFiles.filter((f) => f.endsWith('index.html'));

const attr = (html: string, re: RegExp) =>
  re
    .exec(html)?.[1]
    ?.replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const canonicalOf = (html: string) => attr(html, /<link rel="canonical" href="([^"]*)"/);
const ogTitleOf = (html: string) => attr(html, /<meta property="og:title" content="([^"]*)"/);
const robotsOf = (html: string) => attr(html, /<meta name="robots" content="([^"]*)"/);
const jsonLdOf = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const pageDataOf = (html: string) =>
  JSON.parse(/<script id="__OPENSRC_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]);

const languages = Object.entries(meta.languages)
  .filter(([id, n]) => id !== 'other' && n >= 3)
  .map(([id]) => id);
const fields = Object.keys(meta.fields);

describe('pre-rendered site', () => {
  it('writes every page and file', () => {
    const expected = [
      'index.html',
      '404.html',
      'app.html',
      'sitemap.xml',
      'robots.txt',
      'feed.xml',
      'data/meta.json',
      'collections/index.html',
      'submit/index.html',
      ...repos.map((r) => `repo/${r.fullName}/index.html`),
      ...repos.map((r) => `data/repo/${r.fullName}.json`),
      ...languages.map((id) => `language/${id}/index.html`),
      ...fields.map((id) => `field/${id}/index.html`),
      ...COLLECTIONS.map((c) => `collections/${c.id}/index.html`),
    ];
    for (const file of expected) expect(existsSync(path.join(out, file)), file).toBe(true);
    // Languages with fewer than 3 repos get no page.
    expect(existsSync(path.join(out, 'language/python/index.html'))).toBe(false);
    // The index is written under its content hash only.
    const data = readdirSync(path.join(out, 'data'));
    expect(data.filter((f) => /^repos\.[0-9a-f]{10}\.json$/.test(f))).toHaveLength(1);
    expect(data).not.toContain('repos.json');
    expect(pages).toHaveLength(expected.filter((f) => f.endsWith('index.html')).length);
  });

  it('gives each page a unique title, canonical link and og:title, and valid JSON-LD', () => {
    const titles = new Set<string>();
    const canonicals = new Set<string>();
    const ogTitles = new Set<string>();
    for (const file of pages) {
      const html = read(file);
      const route = routeOf(file);
      const title = titleOf(html);
      const canonical = canonicalOf(html);
      const og = ogTitleOf(html);
      expect(title, file).toBeTruthy();
      expect(canonical, file).toBe(`${SITE}${route}`);
      expect(og, file).toBeTruthy();
      expect(titles.has(title!), `duplicate title ${title}`).toBe(false);
      expect(canonicals.has(canonical!), `duplicate canonical ${canonical}`).toBe(false);
      expect(ogTitles.has(og!), `duplicate og:title ${og}`).toBe(false);
      titles.add(title!);
      canonicals.add(canonical!);
      ogTitles.add(og!);
      expect(html, file).toContain('<meta name="description" content="');
      expect(html, file).toContain(`<meta property="og:image" content="${SITE}/og.png"`);
      expect(html, file).toContain('<meta name="twitter:card" content="summary_large_image"');
      for (const ld of jsonLdOf(html)) {
        expect(ld['@context'], file).toBe('https://schema.org');
        expect(typeof ld['@type'], file).toBe('string');
      }
      // The page's own data, for hydration.
      const pd = pageDataOf(html);
      expect(pd.path, file).toBe(route);
      expect(pd.site, file).toBe(SITE);
      expect(pd.index, file).toMatch(/^\/data\/repos\.[0-9a-f]{10}\.json$/);
      expect(existsSync(path.join(out, pd.index)), file).toBe(true);
    }
  });

  it('uses the titles the plan asks for', () => {
    const [rust] = repos.filter((r) => r.language === 'rust');
    expect(titleOf(read('index.html'))).toBe('OpenSrc · Find a repo for your first open-source contribution');
    expect(titleOf(read(`repo/${rust.fullName}/index.html`))).toBe(
      `${rust.fullName}: ${rust.goodFirstIssues} good first issue${rust.goodFirstIssues === 1 ? '' : 's'} · OpenSrc`,
    );
    expect(titleOf(read('language/rust/index.html'))).toBe('Beginner-friendly Rust repos to contribute to · OpenSrc');
    expect(titleOf(read('field/databases/index.html'))).toBe(
      'Databases open-source projects for first contributions · OpenSrc',
    );
  });

  it('describes each page with structured data', () => {
    const repo = repos.find((r) => r.fullName === 'dexie/Dexie.js')!;
    const ld = jsonLdOf(read('repo/dexie/Dexie.js/index.html'));
    expect(ld[0]).toMatchObject({
      '@type': 'SoftwareSourceCode',
      name: repo.name,
      codeRepository: 'https://github.com/dexie/Dexie.js',
      programmingLanguage: repo.languageName,
    });
    expect(ld.map((x) => x['@type'])).toContain('BreadcrumbList');
    const home = jsonLdOf(read('index.html'));
    expect(home[0]).toMatchObject({ '@type': 'WebSite', potentialAction: { '@type': 'SearchAction' } });
    expect(home[1]).toMatchObject({ '@type': 'ItemList', numberOfItems: repos.length });
    const lang = jsonLdOf(read('language/rust/index.html'));
    expect(lang[0]['@type']).toBe('ItemList');
    expect(lang[0].itemListElement).toHaveLength(meta.languages.rust);
  });

  it('renders real content into the HTML', () => {
    for (const r of repos) {
      const html = read(`repo/${r.fullName}/index.html`);
      expect(html, r.fullName).toContain(`>${r.name}</h1>`);
      expect(html, r.fullName).toContain('data-testid="repo-facts"');
      expect(html, r.fullName).toContain('data-testid="score-parts"');
    }
    const home = read('index.html');
    expect(home.match(/data-testid="repo-card"/g)).toHaveLength(repos.length);
    expect(home).toContain('data-testid="language-row"');
    const lang = read('language/rust/index.html');
    expect(lang).toContain('data-testid="list-intro"');
    expect(lang).toContain(`OpenSrc lists ${meta.languages.rust} Rust repositories`);
    expect(lang.match(/data-testid="repo-card"/g)).toHaveLength(meta.languages.rust);
    expect(read('404.html')).toContain('This patch is missing');
    // The app shell renders nothing: /issues and friends are client-rendered.
    expect(read('app.html')).toContain('<div id="root"></div>');
  });

  it('marks thin pages noindex and keeps them out of the sitemap', () => {
    expect(robotsOf(read('404.html'))).toContain('noindex');
    // An empty collection explains itself and stays out of the index.
    for (const c of COLLECTIONS) {
      const html = read(`collections/${c.id}/index.html`);
      const empty = html.includes('data-testid="collection-empty"');
      expect(robotsOf(html)?.includes('noindex') ?? false, c.id).toBe(empty);
    }
    // The submit page explains how listing works: real content, indexable.
    expect(robotsOf(read('submit/index.html'))).toBeUndefined();
    expect(read('submit/index.html')).toContain('How repos get listed');
    expect(robotsOf(read('index.html'))).toBeUndefined();
    expect(robotsOf(read(`repo/${repos[0].fullName}/index.html`))).toBeUndefined();
  });

  it('lists every indexable page in the sitemap', () => {
    const sitemap = read('sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const indexable = pages.filter((f) => !robotsOf(read(f))?.includes('noindex')).map((f) => `${SITE}${routeOf(f)}`);
    expect(new Set(locs)).toEqual(new Set(indexable));
    expect(locs).toContain(`${SITE}/`);
    expect(locs).toContain(`${SITE}/repo/dexie/Dexie.js`);
    expect(locs).toContain(`${SITE}/submit`);
    expect(sitemap).toContain(`<lastmod>${meta.generatedAt}</lastmod>`);
  });

  it('writes robots.txt and an RSS feed', () => {
    const robots = read('robots.txt');
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain('Disallow: /issues');
    expect(robots).toContain('Disallow: /account');
    const feed = read('feed.xml');
    expect(feed).toContain('<rss version="2.0"');
    expect(feed.match(/<item>/g)).toHaveLength(repos.length);
    // Newest listing first.
    const newest = [...repos].sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt))[0];
    expect(/<item>\s*<title>([^<]*)<\/title>/.exec(feed)?.[1]).toBe(newest.fullName);
  });

  it('keeps inlined data from breaking out of its script tag', () => {
    const tricky = repos.find((r) => r.description?.includes('</script>'))!;
    const html = read(`repo/${tricky.fullName}/index.html`);
    const opened = html.match(/<script\b/g)!.length;
    const closed = html.match(/<\/script>/g)!.length;
    expect(closed).toBe(opened);
    expect(pageDataOf(html).detail.description).toBe(tricky.description);
    expect(html).not.toContain('<script>alert(');
  });

  it('never prints undefined, NaN or [object Object]', () => {
    for (const file of [...htmlFiles, 'sitemap.xml', 'feed.xml', 'robots.txt']) {
      const text = read(file);
      for (const bad of ['undefined', '[object Object]', 'NaN']) {
        expect(text.includes(bad), `${bad} in ${file}`).toBe(false);
      }
    }
  });
});

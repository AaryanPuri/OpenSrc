import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetMeta, RepoRecord } from '../../shared/repo';
import type { InitialDataset } from './data/dataset';
import { pageDataFor, prepareSite, siteRoutes, toInitialDataset } from './data/pageData';
import { render as renderPage } from './entry-server';
import { metaFor } from './lib/dataset';
import { AppRoutes } from './routes';

// A small slice of the real dataset: the best-scored rust repos plus a few others.
const all = JSON.parse(readFileSync(new URL('../../data/repos.json', import.meta.url), 'utf8')) as RepoRecord[];
const meta = JSON.parse(readFileSync(new URL('../../data/meta.json', import.meta.url), 'utf8')) as DatasetMeta;
const rust = all
  .filter((r) => r.language === 'rust' && r.goodFirstIssues > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 4);
const others = all.filter((r) => r.language === 'python').slice(0, 4);
const repos = [...rust, ...others];
const dataset: InitialDataset = { repos, meta: metaFor(repos, meta.generatedAt) };
const star = rust[0];

const render = (location: string, data: InitialDataset | null = dataset) =>
  renderToString(
    <StaticRouter location={location}>
      <AppRoutes dataset={data ?? undefined} />
    </StaticRouter>,
  );

/** Text content, roughly: tags stripped, entities for quotes decoded. */
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('server rendering', () => {
  beforeAll(async () => {
    // The issue finder is lazy: the first render starts loading its chunk (and shows the fallback).
    render('/issues');
    await import('./pages/IssuesPage');
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(() => {
    // Effects never run on the server, so nothing should reach the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('fetch during server render'))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs without browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });

  it('renders the directory on /', () => {
    const html = render('/');
    expect(html).toContain('Skip to content');
    expect(html).toContain('An open-source repository finder');
    expect(html).toContain('data-testid="collection-quilt"');
    expect(html.match(/data-testid="repo-card"/g)).toHaveLength(repos.length);
    expect(text(html)).toContain(`${repos.length} repos`);
    expect(html).toContain(`href="/repo/${star.fullName}"`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters the directory with ?q=', () => {
    const html = render('/?q=beginner%20rust%20repos');
    expect(html).toContain('beginner rust repos</textarea>');
    expect(html.match(/data-testid="repo-card"/g)).toHaveLength(rust.length);
    expect(html).toContain('href="/issues?q=beginner%20rust%20repos"');
    // Cards carry the search to the repo page.
    expect(html).toContain(`href="/repo/${star.fullName}?q=beginner%20rust%20repos"`);
  });

  it('shows skeletons on / while the directory loads', () => {
    const html = render('/', null);
    expect(html).toContain('data-testid="repo-skeletons"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders a repo page', () => {
    const html = render(`/repo/${star.fullName}`);
    expect(html).toContain(`>${star.name}</h1>`);
    expect(html).toContain('data-testid="repo-facts"');
    expect(html).toContain('data-testid="score-parts"');
    expect(html).toContain('Start here');
    expect(html).toContain(`repo=${encodeURIComponent(star.fullName)}`);
    expect(html).toContain('template=flag-repo.yml');
    // Live issues are fetched in the browser only, by a component loaded after hydration.
    expect(html).toContain('data-testid="repo-issues-loading"');
    expect(html).not.toContain('data-testid="issue-tab"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders cards and tiles in their final place (no entrance offset before hydration)', () => {
    for (const path of ['/', '/collections', '/language/rust', '/nope']) {
      const html = render(path);
      // The entrance offsets used by cards, tiles, patches and badges.
      expect(html, path).not.toMatch(/transform:\s*translate|scale[XY]?\(0(\.[236])?\)|rotate\(-20deg\)/);
    }
  });

  it('matches repo names case-insensitively', () => {
    expect(render(`/repo/${star.fullName.toUpperCase()}`)).toContain(`>${star.name}</h1>`);
  });

  it('renders a not-listed state for unknown repos', () => {
    const html = render('/repo/nobody/nothing-here');
    expect(text(html)).toContain("This repo isn't in the directory");
    expect(html).toContain('href="https://github.com/nobody/nothing-here"');
  });

  it('renders /issues', () => {
    const html = render('/issues?q=rust&demo=1');
    expect(html).toContain('Open issues for “rust”');
    expect(html).toContain('rust</textarea>');
  });

  it('renders the issue finder landing on /issues without a query', () => {
    const html = render('/issues');
    expect(html).toContain('Stitch yourself');
    expect(html).not.toContain('Open issues for');
  });

  it('renders language, field, collection and submit pages', () => {
    const lang = text(render('/language/rust'));
    expect(lang).toContain('Rust repos to contribute to');
    expect(lang).toContain(`OpenSrc lists ${rust.length} Rust repositories`);
    expect(render('/language/rust')).toContain(`href="/repo/${star.fullName}"`);
    expect(text(render('/field/compilers'))).toContain('Compilers &amp; Languages open-source projects');
    expect(render('/collections')).toContain('data-testid="collection-block"');
    expect(render('/collections/first-pr')).toContain('Best for a first PR');
    const submit = render('/submit');
    expect(submit).toContain('Stitch in a repo');
    expect(submit).toContain('Unpick a repo');
    expect(text(submit)).toContain('How repos get listed');
    expect(submit).toContain('data-testid="listing-rules"');
    expect(submit).toContain('value="flag-repo.yml"');
    for (const reason of ['Archived or inactive', 'Spam or not open source']) expect(submit).toContain(reason);
  });

  it('sorts a collection with ?sort= and explains an empty one', () => {
    const byScore = render('/collections/first-pr');
    expect(byScore).toContain('data-testid="collection-sort"');
    expect(byScore).toContain('data-testid="collection-intro"');
    // "Fresh this week" is empty right after the first build.
    const fresh = render('/collections/fresh');
    expect(fresh).toContain('data-testid="collection-empty"');
    expect(fresh).toContain('href="/collections/first-pr"');
    expect(renderPage('/collections/fresh', { dataset }).meta?.robots).toContain('noindex');
  });

  it('renders the 404 page for unknown paths', () => {
    // Unknown ids, and languages without enough repos for a page.
    for (const path of ['/no/such/page', '/field/nope', '/collections/nope', '/language/nope', '/language/go']) {
      const html = render(path);
      expect(html).toContain('This patch is missing');
      expect(html).toContain('href="/"');
    }
  });
});

describe('server render entry', () => {
  it('reports the page meta', () => {
    const { html, meta } = renderPage(`/repo/${star.fullName}`, { dataset, siteUrl: 'https://example.test' });
    expect(html).toContain(`>${star.name}</h1>`);
    expect(meta?.title).toBe(
      `${star.fullName}: ${star.goodFirstIssues} good first issue${star.goodFirstIssues === 1 ? '' : 's'} · OpenSrc`,
    );
    expect(meta?.canonical).toBe(`https://example.test/repo/${star.fullName}`);
    expect(meta?.jsonLd[0]).toMatchObject({
      '@type': 'SoftwareSourceCode',
      codeRepository: `https://github.com/${star.fullName}`,
    });
    expect(meta?.robots).toBeNull();
  });

  it('marks thin and search pages noindex', () => {
    expect(renderPage('/submit', { dataset }).meta?.robots).toBeNull();
    expect(renderPage('/nope', { dataset }).meta?.robots).toContain('noindex');
    expect(renderPage('/?q=rust', { dataset }).meta?.robots).toContain('noindex');
    expect(renderPage('/', { dataset }).meta?.robots).toBeNull();
  });

  it('renders a pre-rendered slice exactly like the whole directory', () => {
    const site = prepareSite(repos, dataset.meta);
    const full: InitialDataset = { repos: site.repos, meta: site.meta };
    const opts = { siteUrl: 'https://example.test', indexUrl: '/data/repos.abc.json' };
    for (const route of siteRoutes(site)) {
      const pd = pageDataFor(site, route, opts);
      const fromSlice = renderPage(route.path, { dataset: toInitialDataset(pd), siteUrl: opts.siteUrl });
      const fromFull = renderPage(route.path, {
        dataset: { ...full, details: pd.detail ? [pd.detail] : [] },
        siteUrl: opts.siteUrl,
      });
      expect(fromSlice.html, route.path).toBe(fromFull.html);
      expect(fromSlice.meta, route.path).toEqual(fromFull.meta);
    }
  });
});

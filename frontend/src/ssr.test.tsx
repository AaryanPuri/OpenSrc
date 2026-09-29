import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetMeta, RepoRecord } from '../../shared/repo';
import type { InitialDataset } from './data/dataset';
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
    // Live issues are fetched in the browser only.
    expect(fetch).not.toHaveBeenCalled();
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

  it('renders field, collection and submit pages', () => {
    expect(text(render('/field/databases'))).toContain('Databases repos');
    expect(render('/collections')).toContain('data-testid="collection-block"');
    expect(render('/collections/first-pr')).toContain('Best for a first PR');
    expect(render('/submit')).toContain('Submit a repo');
  });

  it('renders the 404 page for unknown paths', () => {
    for (const path of ['/no/such/page', '/field/nope', '/collections/nope']) {
      const html = render(path);
      expect(html).toContain('This patch is missing');
      expect(html).toContain('href="/"');
    }
  });
});

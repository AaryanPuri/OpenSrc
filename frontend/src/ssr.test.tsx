import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './routes';

const render = (location: string) =>
  renderToString(
    <StaticRouter location={location}>
      <AppRoutes />
    </StaticRouter>,
  );

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

  it('renders a search on /', () => {
    const html = render('/?q=rust&demo=1');
    expect(html).toContain('Skip to content');
    expect(html).toContain('Open issues for “rust”');
    expect(html).toContain('rust</textarea>');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders the landing hero on / without a query', () => {
    const html = render('/');
    expect(html).toContain('<main id="main"');
    expect(html).not.toContain('Open issues for');
  });

  it('renders /issues', () => {
    const html = render('/issues?q=rust&demo=1');
    expect(html).toContain('Open issues for “rust”');
  });

  it('renders the 404 page for unknown paths', () => {
    const html = render('/no/such/page');
    expect(html).toContain('This patch is missing');
    expect(html).toContain('href="/"');
  });
});

// @vitest-environment jsdom
/**
 * Loads pre-rendered pages into jsdom and hydrates them the way main.tsx does:
 * the first client render must match the server's HTML exactly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { RepoRecord } from '../../shared/repo';
import { boot } from '../src/boot';

const out = inject('prerenderOut');
const repos = JSON.parse(
  readFileSync(path.resolve(__dirname, 'fixtures', 'dataset', 'repos.json'), 'utf8'),
) as RepoRecord[];

// React's act() environment flag, so state updates after hydration are flushed and checked.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What jsdom lacks and the app touches. */
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
  window.scrollTo = () => {};
  // Files from the pre-rendered site; anything else (GitHub, /api) is offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), window.location.origin);
      try {
        const body = readFileSync(path.join(out, decodeURIComponent(url.pathname)), 'utf8');
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch {
        return new Response('offline', { status: 503 });
      }
    }),
  );
});
afterAll(() => vi.unstubAllGlobals());

let unmount: (() => void) | null = null;
afterEach(() => {
  act(() => unmount?.());
  unmount = null;
});

/** Puts a pre-rendered file into the document at `route`, as the browser would receive it. */
function load(file: string, route: string) {
  const html = readFileSync(path.join(out, file), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  window.history.replaceState(null, '', route);
  // innerHTML never runs scripts: only the data script's JSON is read.
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
}

async function hydrate(file: string, route: string, tamper?: (doc: Document) => void) {
  load(file, route);
  tamper?.(document);
  const serverHtml = document.getElementById('root')!.innerHTML;
  const onRecoverableError = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let mode = '';
  await act(async () => {
    const started = boot(document, { onRecoverableError });
    mode = started.mode;
    unmount = () => started.root.unmount();
  });
  // Let the background index download land and re-render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  const errors = consoleError.mock.calls.map((c) => c.map(String).join(' '));
  consoleError.mockRestore();
  return { mode, onRecoverableError, errors, serverHtml };
}

const hydrationWarnings = (errors: string[]) =>
  errors.filter((e) => /did not match|hydrat|server rendered|Expected server HTML/i.test(e));

describe('hydrating pre-rendered pages', () => {
  it('hydrates a repo page without a single mismatch', async () => {
    const repo = repos.find((r) => r.fullName === 'dexie/Dexie.js')!;
    const { mode, onRecoverableError, errors } = await hydrate(
      `repo/${repo.fullName}/index.html`,
      `/repo/${repo.fullName}`,
    );
    expect(mode).toBe('hydrate');
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(hydrationWarnings(errors)).toEqual([]);
    expect(document.querySelector('h1')?.textContent).toBe(repo.name);
    expect(document.title).toContain(repo.fullName);
  });

  it.each([
    ['index.html', '/'],
    ['language/rust/index.html', '/language/rust'],
    ['field/databases/index.html', '/field/databases'],
    ['collections/index.html', '/collections'],
    ['collections/first-pr/index.html', '/collections/first-pr'],
    ['submit/index.html', '/submit'],
  ])('hydrates %s without a mismatch', async (file, route) => {
    const { mode, onRecoverableError, errors } = await hydrate(file, route);
    expect(mode).toBe('hydrate');
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(hydrationWarnings(errors)).toEqual([]);
  });

  it('loads the full index in the background', async () => {
    await hydrate('language/rust/index.html', '/language/rust');
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /^\/data\/repos\.[0-9a-f]{10}\.json$/.test(u))).toBe(true);
  });

  it('notices a mismatch (the check above is real)', async () => {
    const { onRecoverableError, errors } = await hydrate('language/rust/index.html', '/language/rust', (doc) => {
      doc.querySelector('h1')!.textContent = 'Something else';
    });
    expect(onRecoverableError.mock.calls.length + hydrationWarnings(errors).length).toBeGreaterThan(0);
  });

  it('renders fresh instead of hydrating when the address asks for something else', async () => {
    const { mode, onRecoverableError } = await hydrate('index.html', '/?q=rust');
    expect(mode).toBe('render');
    expect(onRecoverableError).not.toHaveBeenCalled();
  });

  it('renders 404.html fresh at an unknown address', async () => {
    const { mode } = await hydrate('404.html', '/repo/nobody/nothing');
    expect(mode).toBe('render');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.body.textContent).toContain("This repo isn't in the directory");
  });
});

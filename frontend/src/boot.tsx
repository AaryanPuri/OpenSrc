import { StrictMode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { partialCovers } from './data/dataset';
import { readPageData, toInitialDataset } from './data/pageData';
import { AppRoutes } from './routes';

export interface BootOptions {
  /** Passed to hydrateRoot / createRoot (the hydration test counts these). */
  onRecoverableError?: (error: unknown) => void;
}

/**
 * Starts the app in `doc`. A pre-rendered page is hydrated when the address is
 * exactly the one it was rendered for (no query string: `?q=`, `?tab=` would
 * render something else); its inlined data makes the first render identical to
 * the server's. Anything else (the app shell, 404.html, a query) renders fresh,
 * still using the inlined meta and index address.
 */
export function boot(doc: Document, opts: BootOptions = {}): { mode: 'hydrate' | 'render'; root: Root } {
  const container = doc.getElementById('root');
  if (!container) throw new Error('#root is missing');
  const { location } = doc.defaultView ?? window;
  const pd = readPageData(doc);
  const dataset = pd ? toInitialDataset(pd) : undefined;
  const app = (
    <StrictMode>
      <BrowserRouter>
        <AppRoutes dataset={dataset} siteUrl={pd?.site ?? location.origin} />
      </BrowserRouter>
    </StrictMode>
  );
  const matches =
    !!pd?.slice && pd.path !== undefined && partialCovers({ path: pd.path }, location.pathname, location.search);
  if (container.hasChildNodes() && matches) {
    return { mode: 'hydrate', root: hydrateRoot(container, app, { onRecoverableError: opts.onRecoverableError }) };
  }
  const root = createRoot(container, { onRecoverableError: opts.onRecoverableError });
  root.render(app);
  return { mode: 'render', root };
}

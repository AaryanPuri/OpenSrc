/**
 * Server render, used at build time by scripts/prerender.ts (built with
 * `vite build --ssr src/entry-server.tsx --outDir dist-ssr`). Renders one URL
 * to HTML and reports the <head> meta the page chose.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import type { RepoRecord } from '../../shared/repo';
import type { InitialDataset } from './data/dataset';
import type { HeadCollector } from './seo/context';
import { DEFAULT_SITE_URL, type PageMeta } from './seo/meta';
import { AppRoutes } from './routes';

export interface RenderOptions {
  dataset?: InitialDataset;
  /** The repo page's full record, when not already in `dataset.details`. */
  repoDetail?: RepoRecord;
  siteUrl?: string;
}

export function render(url: string, opts: RenderOptions = {}): { html: string; meta: PageMeta | null } {
  const head: HeadCollector = { meta: null };
  const dataset =
    opts.dataset && opts.repoDetail
      ? { ...opts.dataset, details: [...(opts.dataset.details ?? []), opts.repoDetail] }
      : opts.dataset;
  const html = renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <AppRoutes dataset={dataset} siteUrl={opts.siteUrl ?? DEFAULT_SITE_URL} head={head} />
      </StaticRouter>
    </StrictMode>,
  );
  return { html, meta: head.meta };
}

// What the pre-render script needs besides render(), from the same bundle as the pages.
export { COLLECTIONS } from '../../shared/collections';
export { PAGE_DATA_ID, pageDataFor, prepareSite, shellData, siteRoutes, toInitialDataset } from './data/pageData';
export type { PageData, Site, SiteRoute } from './data/pageData';
export { scriptJson } from './seo/jsonLd';
export { DEFAULT_SITE_URL, headHtml, HOME_TITLE, normalizeSiteUrl, pageMeta } from './seo/meta';
export type { PageMeta } from './seo/meta';
export { repoDetailPath } from './lib/dataset';

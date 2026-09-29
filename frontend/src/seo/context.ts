import { createContext, useContext } from 'react';
import { DEFAULT_SITE_URL, type PageMeta } from './meta';

/** Filled during a server render: the meta of the page that rendered (see useDocumentMeta). */
export interface HeadCollector {
  meta: PageMeta | null;
}

export interface Seo {
  /** Absolute origin for canonical links and JSON-LD, without a trailing slash. */
  siteUrl: string;
  /** Only on the server. */
  head?: HeadCollector;
}

export const SeoContext = createContext<Seo>({ siteUrl: DEFAULT_SITE_URL });

export const useSiteUrl = () => useContext(SeoContext).siteUrl;

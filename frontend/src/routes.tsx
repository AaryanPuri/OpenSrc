import { lazy, Suspense, useMemo } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from './AppShell';
import { DatasetProvider } from './data/DatasetContext';
import { AccountPage } from './pages/AccountPage';
import type { InitialDataset } from './data/dataset';
import { CollectionPage, CollectionsPage } from './pages/CollectionPage';
import { HomePage } from './pages/HomePage';
import { FieldPage, LanguagePage } from './pages/ListPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RepoPage } from './pages/RepoPage';
import { SubmitPage } from './pages/SubmitPage';
import { SeoContext, type HeadCollector, type Seo } from './seo/context';
import { DEFAULT_SITE_URL } from './seo/meta';

// The issue finder is its own chunk: no pre-rendered page needs it (it is a noindex, client-rendered page).
const IssuesPage = lazy(() => import('./pages/IssuesPage').then((m) => ({ default: m.IssuesPage })));

function IssuesFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6" aria-busy="true" data-testid="issues-loading">
      <div className="skeleton h-10 w-2/3" />
      <div className="skeleton mt-6 h-24 w-full" />
    </div>
  );
}

interface Props {
  /** The repo directory up front (server rendering, tests, a pre-rendered page's inlined slice). */
  dataset?: InitialDataset;
  /** Origin for canonical links; defaults to the production site. */
  siteUrl?: string;
  /** Server rendering: receives the page's <head> meta. */
  head?: HeadCollector;
}

/**
 * Every page, wrapped in the shared shell. Used by BrowserRouter in main.tsx and by
 * StaticRouter when rendering on the server. Without `dataset` the browser fetches it.
 */
export function AppRoutes({ dataset, siteUrl = DEFAULT_SITE_URL, head }: Props) {
  const seo = useMemo<Seo>(() => ({ siteUrl, head }), [siteUrl, head]);
  return (
    <SeoContext.Provider value={seo}>
      <DatasetProvider initial={dataset}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route
              path="issues"
              element={
                <Suspense fallback={<IssuesFallback />}>
                  <IssuesPage />
                </Suspense>
              }
            />
            <Route path="repo/:owner/:name" element={<RepoPage />} />
            <Route path="language/:id" element={<LanguagePage />} />
            <Route path="field/:id" element={<FieldPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="collections/:id" element={<CollectionPage />} />
            <Route path="submit" element={<SubmitPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </DatasetProvider>
    </SeoContext.Provider>
  );
}

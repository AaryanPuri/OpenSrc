import { Route, Routes, useParams } from 'react-router';
import { AppShell } from './AppShell';
import { DatasetProvider } from './data/DatasetContext';
import type { InitialDataset } from './data/dataset';
import { DOMAINS } from './lib/dictionary';
import { CollectionPage, CollectionsPage } from './pages/CollectionPage';
import { HomePage } from './pages/HomePage';
import { IssuesPage } from './pages/IssuesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RepoPage } from './pages/RepoPage';
import { SubmitPage } from './pages/SubmitPage';

/** `/field/:id`: the directory with that field picked (a page of its own comes with pre-rendering). */
function FieldRoute() {
  const { id = '' } = useParams();
  if (!DOMAINS.some((d) => d.id === id)) return <NotFoundPage />;
  // Keyed so switching fields resets the page's input.
  return <HomePage key={id} fieldId={id} />;
}

/**
 * Every page, wrapped in the shared shell. Used by BrowserRouter in main.tsx and by
 * StaticRouter when rendering on the server. `dataset` hands over the repo
 * directory up front (server rendering, tests); without it the browser fetches it.
 */
export function AppRoutes({ dataset }: { dataset?: InitialDataset }) {
  return (
    <DatasetProvider initial={dataset}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="issues" element={<IssuesPage />} />
          <Route path="repo/:owner/:name" element={<RepoPage />} />
          <Route path="field/:id" element={<FieldRoute />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:id" element={<CollectionPage />} />
          <Route path="submit" element={<SubmitPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </DatasetProvider>
  );
}

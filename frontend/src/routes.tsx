import { Route, Routes } from 'react-router';
import { AppShell } from './AppShell';
import { IssuesPage } from './pages/IssuesPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Every page, wrapped in the shared shell. Used by BrowserRouter in main.tsx and by
 * StaticRouter when rendering on the server. `/` becomes the repo directory later;
 * for now it and `/issues` are both the issue finder.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<IssuesPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

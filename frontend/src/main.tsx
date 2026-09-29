import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { migrateStorage } from './lib/storage';
import { AppRoutes } from './routes';

migrateStorage();

const app = (
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>
);

const root = document.getElementById('root')!;
// Pre-rendered pages arrive with markup to hydrate; the plain index.html has an empty #root.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);

/// <reference types="vitest" />
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { DatasetMeta, RepoRecord } from '../shared/repo';
import { compactDataset } from './src/lib/dataset';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

interface DataFiles {
  /** Compact index (src/lib/dataset.ts), as served at /data/repos.json. */
  index: string;
  meta: string;
  /** Full records by fullName, served at /data/repo/<owner>/<name>.json. */
  repos: Map<string, RepoRecord>;
}

let cached: { stamp: string; files: DataFiles } | null = null;

/** Reads data/repos.json + data/meta.json (re-read when either changes on disk), or null when absent. */
function loadData(): DataFiles | null {
  let stamp: string;
  try {
    stamp = ['repos.json', 'meta.json'].map((f) => statSync(DATA_DIR + f).mtimeMs).join(':');
  } catch {
    return null;
  }
  if (cached?.stamp === stamp) return cached.files;
  const repos = JSON.parse(readFileSync(DATA_DIR + 'repos.json', 'utf8')) as RepoRecord[];
  const meta = readFileSync(DATA_DIR + 'meta.json', 'utf8');
  const { generatedAt } = JSON.parse(meta) as DatasetMeta;
  const files: DataFiles = {
    index: JSON.stringify(compactDataset(repos, generatedAt)),
    meta,
    repos: new Map(repos.map((r) => [r.fullName, r])),
  };
  cached = { stamp, files };
  return files;
}

/**
 * The repo directory's data, from the repo-root data/ folder: served under /data/
 * in dev (compacted on the fly) and written to dist/data/ by `vite build`.
 */
function repoData(): Plugin {
  return {
    name: 'opensrc-repo-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const files = loadData();
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const detail = /^\/repo\/(.+)\.json$/.exec(path);
        const body =
          !files
            ? undefined
            : path === '/repos.json'
              ? files.index
              : path === '/meta.json'
                ? files.meta
                : detail && files.repos.has(detail[1])
                  ? JSON.stringify(files.repos.get(detail[1]))
                  : undefined;
        if (body === undefined) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
    generateBundle() {
      const files = loadData();
      if (!files) {
        this.warn('data/repos.json or data/meta.json is missing: the build has no repo directory data.');
        return;
      }
      this.emitFile({ type: 'asset', fileName: 'data/repos.json', source: files.index });
      this.emitFile({ type: 'asset', fileName: 'data/meta.json', source: files.meta });
      for (const [fullName, repo] of files.repos) {
        this.emitFile({ type: 'asset', fileName: `data/repo/${fullName}.json`, source: JSON.stringify(repo) });
      }
    },
  };
}

// The API server (backend/: `npm run dev:backend` from the repo root, or `npm run dev` for both).
// If it isn't running, the proxy answers with a non-JSON error and the app falls
// back to calling GitHub directly (see src/lib/search.ts).
//   API_PROXY_TARGET  where /api goes (default http://127.0.0.1:8787)
//   WEB_PORT          Vite port (default 5173); when set, fail instead of picking another port
export default defineConfig(({ mode }) => {
  // Prefix '' = also read non-VITE_ variables (from the shell or .env files); none reach client code.
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:8787';
  const webPort = env.WEB_PORT ? Number(env.WEB_PORT) : undefined;
  const proxy = { '/api': { target: apiTarget, changeOrigin: true } };

  return {
    plugins: [react(), repoData()],
    server: {
      proxy,
      // ../shared holds the parser used by both halves.
      fs: { allow: ['..'] },
      ...(webPort ? { port: webPort, strictPort: true } : {}),
    },
    preview: { proxy },
    test: {
      environment: 'node',
      // Scan from the repo root so ../shared's tests run here, once.
      dir: '..',
      include: ['frontend/src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
    },
  };
});

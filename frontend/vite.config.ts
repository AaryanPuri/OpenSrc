/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
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
      include: ['frontend/src/**/*.test.ts', 'shared/**/*.test.ts'],
    },
  };
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_URL = 'https://opensrc.studio';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where the fixture site was pre-rendered. */
    prerenderOut: string;
  }
}

/** Pre-renders test/fixtures/dataset once for every test file, with the bundle `npm run build` made. */
export default function setup({ provide }: GlobalSetupContext) {
  if (!existsSync(path.join(FRONTEND, 'dist-ssr', 'entry-server.js'))) {
    throw new Error('dist-ssr/entry-server.js is missing: run `npm run build` before `npm run test:prerender`.');
  }
  const out = mkdtempSync(path.join(tmpdir(), 'opensrc-prerender-'));
  const env: Record<string, string | undefined> = { ...process.env, SITE_URL };
  delete env.PRERENDER_LIMIT;
  delete env.CI_REQUIRE_SITE_URL;
  execFileSync(
    process.execPath,
    [
      path.join(FRONTEND, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/prerender.ts',
      '--data',
      'test/fixtures/dataset',
      '--out',
      out,
    ],
    { cwd: FRONTEND, env, stdio: 'inherit' },
  );
  provide('prerenderOut', out);
  return () => rmSync(out, { recursive: true, force: true });
}

/**
 * Writes Brotli (.br) and gzip (.gz) copies next to every compressible file in
 * the build, so the Node server (backend/src/static.ts) can send them as they
 * are instead of compressing on every request:
 *
 *   tsx scripts/compress.ts [dir]        (default: dist)
 *
 * Only HTML, JS, CSS, JSON, XML, SVG and text files of at least MIN_BYTES are
 * compressed, and a copy is kept only when it is actually smaller. Stale copies
 * whose source is gone are removed. Cloudflare Pages drops these files again
 * (scripts/cf-pages.mjs) and compresses at the edge instead.
 */
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

export const COMPRESSIBLE = /\.(html|js|mjs|css|json|xml|svg|txt|webmanifest)$/i;
export const MIN_BYTES = 1024;
const CONCURRENCY = 16;

export interface CompressStats {
  files: number;
  bytes: number;
  br: number;
  gz: number;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

/** Compresses every eligible file under `dir`; returns totals. */
export async function compressDir(dir: string): Promise<CompressStats> {
  const all = await walk(dir);
  const present = new Set(all);
  const stats: CompressStats = { files: 0, bytes: 0, br: 0, gz: 0 };

  // Copies whose source no longer exists (or no longer qualifies) go.
  await Promise.all(
    all
      .filter((f) => /\.(br|gz)$/.test(f))
      .filter((f) => {
        const src = f.slice(0, -3);
        return !present.has(src) || !COMPRESSIBLE.test(src);
      })
      .map((f) => rm(f, { force: true })),
  );

  const queue = all.filter((f) => COMPRESSIBLE.test(f));
  const work = async () => {
    for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
      const size = (await stat(f)).size;
      if (size < MIN_BYTES) {
        await Promise.all([rm(`${f}.br`, { force: true }), rm(`${f}.gz`, { force: true })]);
        continue;
      }
      const body = await readFile(f);
      const [b, g] = await Promise.all([
        brotli(body, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          },
        }),
        gz(body, { level: 9 }),
      ]);
      stats.files++;
      stats.bytes += body.length;
      if (b.length < body.length) {
        await writeFile(`${f}.br`, b);
        stats.br += b.length;
      } else await rm(`${f}.br`, { force: true });
      if (g.length < body.length) {
        await writeFile(`${f}.gz`, g);
        stats.gz += g.length;
      } else await rm(`${f}.gz`, { force: true });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, work));
  return stats;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const started = performance.now();
  compressDir(dir)
    .then((s) => {
      const mb = (n: number) => (n / 1e6).toFixed(1);
      console.log(
        `compress: ${s.files} files, ${mb(s.bytes)} MB → ${mb(s.br)} MB brotli, ${mb(s.gz)} MB gzip ` +
          `in ${((performance.now() - started) / 1000).toFixed(1)}s`,
      );
    })
    .catch((e: unknown) => {
      console.error(`compress: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      process.exit(1);
    });
}

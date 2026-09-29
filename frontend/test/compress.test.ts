import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { compressDir } from '../scripts/compress';

const dir = mkdtempSync(path.join(tmpdir(), 'opensrc-compress-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (file: string, body: string | Buffer) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), body);
};
const has = (file: string) => existsSync(path.join(dir, file));

describe('compressDir', () => {
  it('writes .br and .gz next to large text files only', async () => {
    const html = `<!doctype html>${'<p>running stitch</p>'.repeat(300)}`;
    write('index.html', html);
    write('repo/a/b/index.html', html);
    write('assets/app-1.js', 'export const x = 1;'.repeat(200));
    write('assets/app-1.css', '.a{color:red}'.repeat(200));
    write('data/meta.json', JSON.stringify({ k: 'v'.repeat(3000) }));
    write('robots.txt', 'User-agent: *\n');
    write('og.png', Buffer.alloc(5000, 1));
    // A stale copy of a file that is gone.
    write('old.js.br', 'stale');

    const stats = await compressDir(dir);
    expect(stats.files).toBe(5);
    for (const f of ['index.html', 'repo/a/b/index.html', 'assets/app-1.js', 'assets/app-1.css', 'data/meta.json']) {
      expect(has(`${f}.br`), f).toBe(true);
      expect(has(`${f}.gz`), f).toBe(true);
    }
    expect(brotliDecompressSync(readFileSync(path.join(dir, 'index.html.br'))).toString()).toBe(html);
    expect(gunzipSync(readFileSync(path.join(dir, 'index.html.gz'))).toString()).toBe(html);
    // Too small, or not text.
    expect(has('robots.txt.br')).toBe(false);
    expect(has('og.png.br')).toBe(false);
    expect(has('old.js.br')).toBe(false);
    expect(stats.br).toBeLessThan(stats.bytes);
  });

  it('is safe to run again', async () => {
    const again = await compressDir(dir);
    expect(again.files).toBe(5);
    expect(has('index.html.br.br')).toBe(false);
  });
});

/**
 * Precompressed files: frontend/scripts/compress.ts writes .br / .gz copies next
 * to the build's files, and mountStatic sends them when Accept-Encoding allows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { HTML_CACHE, IMMUTABLE_CACHE, mountStatic, negotiateEncoding } from "../src/static.js";

let dir: string;
let app: ReturnType<typeof createApp>;

const page = (t: string) => `<!doctype html><title>${t}</title>${"<p>stitch</p>".repeat(200)}`;
const write = (file: string, body: string, { br = true, gz = true } = {}) => {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
  if (br) writeFileSync(`${full}.br`, brotliCompressSync(body));
  if (gz) writeFileSync(`${full}.gz`, gzipSync(body));
};

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oss-static-br-"));
  write("index.html", page("Home"));
  write("app.html", page("Shell"));
  write("404.html", page("Not found"));
  write("repo/tokio-rs/tokio/index.html", page("tokio"));
  write("assets/app-abc123.js", "console.log('stitch');".repeat(100));
  write("data/meta.json", JSON.stringify({ a: "b".repeat(2000) }), { br: false });
  write("favicon.svg", "<svg/>", { br: false, gz: false });
  app = createApp();
  mountStatic(app, dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const get = (p: string, acceptEncoding?: string) =>
  app.request(p, { headers: acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {} });
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe("precompressed static files", () => {
  it("sends brotli when accepted, with the original content type", async () => {
    const res = await get("/repo/tokio-rs/tokio", "gzip, deflate, br, zstd");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE);
    expect(brotliDecompressSync(await bytes(res)).toString()).toBe(page("tokio"));
  });

  it("falls back to gzip, then to the plain file", async () => {
    const gz = await get("/assets/app-abc123.js", "gzip");
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gz.headers.get("content-type")).toContain("javascript");
    expect(gz.headers.get("cache-control")).toBe(IMMUTABLE_CACHE);
    expect(gunzipSync(await bytes(gz)).toString()).toContain("stitch");

    const plain = await get("/assets/app-abc123.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("vary")).toContain("Accept-Encoding");
    expect(await plain.text()).toContain("console.log");
  });

  it("uses whichever copy exists", async () => {
    const res = await get("/data/meta.json", "br, gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(gunzipSync(await bytes(res)).toString())).toEqual({ a: "b".repeat(2000) });
  });

  it("serves small files uncompressed", async () => {
    const res = await get("/favicon.svg", "br");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("<svg/>");
  });

  it("compresses the 404 page and the app shell too", async () => {
    const missing = await get("/repo/nobody/nothing", "br");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-encoding")).toBe("br");
    expect(missing.headers.get("vary")).toBe("Accept-Encoding");
    expect(brotliDecompressSync(await bytes(missing)).toString()).toBe(page("Not found"));

    const shell = await get("/issues", "gzip;q=1, br;q=0");
    expect(shell.status).toBe(200);
    expect(shell.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(await bytes(shell)).toString()).toBe(page("Shell"));

    const plain = await get("/issues");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(page("Shell"));
  });
});

describe("negotiateEncoding", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["identity", null],
    ["gzip", "gzip"],
    ["gzip, deflate, br", "br"],
    ["br;q=0.5, gzip;q=0.8", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["*", "br"],
    ["*;q=0.1, br;q=0", "gzip"],
  ])("%j → %j", (header, want) => {
    expect(negotiateEncoding(header)).toBe(want);
  });
  it("only offers what exists", () => {
    expect(negotiateEncoding("br, gzip", ["gzip"])).toBe("gzip");
    expect(negotiateEncoding("br", ["gzip"])).toBeNull();
  });
});

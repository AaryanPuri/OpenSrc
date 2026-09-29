import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { HTML_CACHE, mountStatic, staticRoot } from "../src/static.js";

const write = (root: string, file: string, body: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), body);
};

let dir: string;
let app: ReturnType<typeof createApp>;
let spaDir: string;
let spa: ReturnType<typeof createApp>;

beforeAll(() => {
  // A pre-rendered build (scripts/prerender.ts).
  dir = mkdtempSync(path.join(tmpdir(), "oss-static-"));
  write(dir, "index.html", "<!doctype html><title>Home</title>");
  write(dir, "app.html", "<!doctype html><title>Shell</title>");
  write(dir, "404.html", "<!doctype html><title>Not found</title>");
  write(dir, "repo/tokio-rs/tokio/index.html", "<!doctype html><title>tokio</title>");
  write(dir, "repo/mrdoob/three.js/index.html", "<!doctype html><title>three.js</title>");
  write(dir, "language/rust/index.html", "<!doctype html><title>Rust</title>");
  write(dir, "field/databases/index.html", "<!doctype html><title>Databases</title>");
  write(dir, "collections/index.html", "<!doctype html><title>Collections</title>");
  write(dir, "collections/first-pr/index.html", "<!doctype html><title>First PR</title>");
  write(dir, "assets/app-abc123.js", "console.log(1)");
  write(dir, "data/repos.0123456789.json", "{}");
  write(dir, "data/meta.json", "{}");
  write(dir, "favicon.svg", "<svg/>");
  write(dir, "sitemap.xml", "<urlset/>");
  app = createApp();
  mountStatic(app, dir);

  // A plain `vite build` (no pre-rendering): index.html is the shell.
  spaDir = mkdtempSync(path.join(tmpdir(), "oss-static-spa-"));
  write(spaDir, "index.html", "<!doctype html><title>SPA</title>");
  spa = createApp();
  mountStatic(spa, spaDir);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(spaDir, { recursive: true, force: true });
});

const title = async (res: Response) => /<title>(.*)<\/title>/.exec(await res.text())?.[1];

describe("mountStatic", () => {
  it("serves the pre-rendered home page at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await title(res)).toBe("Home");
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE);
  });

  it("serves nested pre-rendered pages, with or without a trailing slash", async () => {
    for (const [p, t] of [
      ["/repo/tokio-rs/tokio", "tokio"],
      ["/repo/tokio-rs/tokio/", "tokio"],
      ["/language/rust", "Rust"],
      ["/field/databases", "Databases"],
      ["/collections", "Collections"],
      ["/collections/first-pr", "First PR"],
    ]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-type"), p).toContain("text/html");
      expect(res.headers.get("cache-control"), p).toBe(HTML_CACHE);
      expect(await title(res), p).toBe(t);
    }
  });

  it("serves repo pages whose name looks like a file", async () => {
    const res = await app.request("/repo/mrdoob/three.js");
    expect(res.status).toBe(200);
    expect(await title(res)).toBe("three.js");
  });

  it("answers unknown directory pages with 404.html and a 404 status", async () => {
    for (const p of [
      "/repo/nobody/nothing",
      "/repo/nobody/some.lib",
      "/repo",
      "/language/cobol",
      "/field/nope",
      "/collections/nope",
    ]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("content-type"), p).toContain("text/html");
      expect(await title(res), p).toBe("Not found");
    }
  });

  it("falls back to the app shell for client-side routes", async () => {
    for (const p of ["/issues", "/issues?q=rust", "/account", "/saved/some/deep/route"]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-type"), p).toContain("text/html");
      expect(res.headers.get("cache-control"), p).toBe(HTML_CACHE);
      expect(await title(res), p).toBe("Shell");
    }
  });

  it("caches hashed assets and the hashed index forever", async () => {
    for (const p of ["/assets/app-abc123.js", "/data/repos.0123456789.json"]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("cache-control"), p).toBe("public, max-age=31536000, immutable");
    }
    expect(await (await app.request("/assets/app-abc123.js")).text()).toBe("console.log(1)");
  });

  it("revalidates other files", async () => {
    for (const p of ["/favicon.svg", "/data/meta.json", "/sitemap.xml"]) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("cache-control"), p).toBe("no-cache");
    }
  });

  it("404s missing files that have an extension", async () => {
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    expect((await app.request("/data/repos.json")).status).toBe(404);
  });

  it("keeps the API working and unknown /api paths as JSON 404s", async () => {
    expect(await (await app.request("/api/health")).json()).toMatchObject({ ok: true });
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("refuses to mount a directory without index.html", () => {
    expect(() => mountStatic(createApp(), path.join(dir, "assets"))).toThrow(/index\.html/);
  });
});

describe("mountStatic without pre-rendered pages", () => {
  it("serves index.html for every client-side route", async () => {
    for (const p of ["/", "/issues?q=rust", "/repo/mrdoob/three.js", "/language/rust"]) {
      const res = await spa.request(p);
      expect(res.status, p).toBe(200);
      expect(await title(res), p).toBe("SPA");
    }
  });
});

describe("staticRoot", () => {
  it("is off by default in development", () => {
    expect(staticRoot({})).toBeUndefined();
  });
  it("uses frontend/dist/ in production", () => {
    const root = staticRoot({ NODE_ENV: "production" })!;
    expect(root.replace(/\\/g, "/")).toMatch(/\/frontend\/dist$/);
    expect(root).not.toContain(`${path.sep}backend${path.sep}dist`);
  });
  it("SERVE_STATIC overrides and can disable", () => {
    expect(staticRoot({ SERVE_STATIC: "../frontend/dist" })).toBe("../frontend/dist");
    expect(staticRoot({ SERVE_STATIC: "off", NODE_ENV: "production" })).toBeUndefined();
  });
});

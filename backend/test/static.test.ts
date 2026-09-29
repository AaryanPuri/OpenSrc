import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { mountStatic, staticRoot } from "../src/static.js";

let dir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oss-static-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>SPA</title>");
  writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  app = createApp();
  mountStatic(app, dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("mountStatic", () => {
  it("serves index.html at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>SPA</title>");
  });

  it("serves hashed assets with an immutable cache header", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("serves other files with no-cache", async () => {
    const res = await app.request("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await app.request("/saved/some/deep/route?q=rust");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>SPA</title>");
  });

  it("serves repo pages whose name looks like a file", async () => {
    const res = await app.request("/repo/mrdoob/three.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>SPA</title>");
  });

  it("404s missing files that have an extension", async () => {
    expect((await app.request("/assets/missing.js")).status).toBe(404);
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

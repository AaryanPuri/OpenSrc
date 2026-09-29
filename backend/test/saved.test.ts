import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ITEMS, MAX_PAYLOAD_BYTES } from "../src/routes/saved.js";
import { makeApp, signIn, write, type TestApp } from "./accountHelpers.js";

const repo = { fullName: "acme/db", owner: "acme", stars: 10, savedAt: "2026-09-01T00:00:00.000Z" };
const path = (kind: string, key: string) => `/api/saved/${kind}/${encodeURIComponent(key)}`;

async function list(t: TestApp, cookie: string) {
  const res = await t.app.request("/api/saved", { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { kind: string; key: string; payload: unknown; savedAt: string }[] }).items;
}

describe("saved items", () => {
  it("needs a session (401)", async () => {
    const t = makeApp();
    expect((await t.app.request("/api/saved")).status).toBe(401);
    const put = await t.app.request(path("repo", "acme/db"), { method: "PUT", headers: write(), body: "{}" });
    expect(put.status).toBe(401);
  });

  it("PUT, GET and DELETE, with keys containing slashes and colons", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const issueKey = "123:https://github.com/acme/db/issues/7";
    expect(
      (
        await t.app.request(path("repo", "acme/db"), {
          method: "PUT",
          headers: write(cookie),
          body: JSON.stringify(repo),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.app.request(path("issue", issueKey), {
          method: "PUT",
          headers: write(cookie),
          body: JSON.stringify({ id: 123, title: "Fix", savedAt: "2026-09-02T00:00:00.000Z" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.app.request(path("search", "repos:beginner rust"), {
          method: "PUT",
          headers: write(cookie),
          body: JSON.stringify({ q: "beginner rust", scope: "repos" }),
        })
      ).status,
    ).toBe(200);

    const items = await list(t, cookie);
    expect(items.map((i) => `${i.kind}|${i.key}`)).toEqual([
      "search|repos:beginner rust", // saved "now" (no savedAt in its payload)
      `issue|${issueKey}`,
      "repo|acme/db",
    ]);
    expect(items[2].payload).toEqual(repo);
    expect(items[2].savedAt).toBe(repo.savedAt);

    // PUT again replaces the payload, keeps one row.
    await t.app.request(path("repo", "acme/db"), {
      method: "PUT",
      headers: write(cookie),
      body: JSON.stringify({ ...repo, stars: 11 }),
    });
    expect((await list(t, cookie)).filter((i) => i.kind === "repo")).toHaveLength(1);

    const del = await t.app.request(path("issue", issueKey), { method: "DELETE", headers: write(cookie) });
    expect(del.status).toBe(200);
    expect((await list(t, cookie)).map((i) => i.kind).sort()).toEqual(["repo", "search"]);
  });

  it("keeps each user's items apart", async () => {
    const a = makeApp();
    const { cookie: ca } = await signIn(a);
    await a.app.request(path("repo", "acme/db"), { method: "PUT", headers: write(ca), body: JSON.stringify(repo) });
    // A second user on the same database.
    const b = makeApp({ db: a.db, githubUser: { id: 7, login: "other" } });
    const { cookie: cb } = await signIn(b);
    expect(await list(b, cb)).toEqual([]);
  });

  it("rejects unknown kinds, non-object payloads and payloads over 8 KB", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const put = (p: string, body: string) => t.app.request(p, { method: "PUT", headers: write(cookie), body });
    expect((await put(path("gist", "x"), "{}")).status).toBe(400);
    expect((await put(path("repo", "x"), "[1,2]")).status).toBe(400);
    expect((await put(path("repo", "x"), "not json")).status).toBe(400);
    expect((await put(path("repo", "x"), JSON.stringify({ blob: "x".repeat(MAX_PAYLOAD_BYTES) }))).status).toBe(413);
    expect((await put(path("repo", "k".repeat(600)), "{}")).status).toBe(400);
  });
});

describe("POST /api/saved/import", () => {
  const items = [
    { kind: "repo", key: "acme/db", payload: repo },
    { kind: "issue", key: "1:https://github.com/acme/db/issues/1", payload: { id: 1, title: "One" } },
    { kind: "search", key: "issues:good first issue", payload: { q: "good first issue", scope: "issues" } },
  ];

  it("imports, and a second identical import changes nothing", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const first = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({ items }),
    });
    expect(await first.json()).toEqual({ imported: 3, skipped: 0, total: 3 });
    const second = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({ items }),
    });
    expect(await second.json()).toEqual({ imported: 0, skipped: 0, total: 3 });
    expect(await list(t, cookie)).toHaveLength(3);
  });

  it("keeps what the server already has for a key", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    await t.app.request(path("repo", "acme/db"), {
      method: "PUT",
      headers: write(cookie),
      body: JSON.stringify({ ...repo, stars: 999 }),
    });
    await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({ items }),
    });
    const saved = (await list(t, cookie)).find((i) => i.kind === "repo")!;
    expect((saved.payload as { stars: number }).stars).toBe(999);
  });

  it("refuses more than 500 items (413) and skips invalid or oversized ones", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const tooMany = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, i) => ({
      kind: "repo",
      key: `o/r${i}`,
      payload: {},
    }));
    const big = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({ items: tooMany }),
    });
    expect(big.status).toBe(413);

    const mixed = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({
        items: [
          ...items,
          { kind: "repo", key: "o/huge", payload: { blob: "x".repeat(MAX_PAYLOAD_BYTES) } },
          { kind: "nope", key: "x", payload: {} },
          { kind: "repo", key: "", payload: {} },
          { kind: "repo", key: "o/list", payload: [1] },
        ],
      }),
    });
    expect(await mixed.json()).toEqual({ imported: 3, skipped: 4, total: 3 });
  });

  it("accepts exactly 500", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const five = Array.from({ length: MAX_IMPORT_ITEMS }, (_, i) => ({ kind: "repo", key: `o/r${i}`, payload: { i } }));
    const res = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: write(cookie),
      body: JSON.stringify({ items: five }),
    });
    expect(await res.json()).toMatchObject({ imported: 500, total: 500 });
  });

  it("is CSRF-checked", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const res = await t.app.request("/api/saved/import", {
      method: "POST",
      headers: { ...write(cookie), origin: "https://evil.example" },
      body: JSON.stringify({ items }),
    });
    expect(res.status).toBe(403);
  });
});

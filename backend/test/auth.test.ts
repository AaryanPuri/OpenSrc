import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { safeReturnTo } from "../src/auth/routes.js";
import { migrate } from "../src/db/index.js";
import { nodeDb } from "../src/db/node.js";
import { sha256Hex } from "../src/lib/crypto.js";
import { dumpDb, FAKE_GH_TOKEN, makeApp, setCookies, signIn, SITE, write } from "./accountHelpers.js";

describe("migrations", () => {
  it("apply once and are idempotent", async () => {
    const db = nodeDb(":memory:");
    expect(await migrate(db)).toEqual(["0001_init"]);
    expect(await migrate(db)).toEqual([]);
    const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map(
      (r) => r.name,
    );
    expect(tables).toEqual(expect.arrayContaining(["_migrations", "saved", "sessions", "subscribers", "users"]));
  });
});

describe("GET /api/health feature flags", () => {
  it("reports db, auth and newsletter when configured", async () => {
    const { app } = makeApp();
    expect(await (await app.request("/api/health")).json()).toMatchObject({ db: true, auth: true, newsletter: true });
  });

  it("login needs the OAuth app and SESSION_SECRET", async () => {
    const { app } = makeApp({ env: { SESSION_SECRET: undefined } });
    expect(await (await app.request("/api/health")).json()).toMatchObject({ db: true, auth: false, newsletter: true });
  });
});

describe("GitHub sign-in", () => {
  it("redirects to GitHub with no scopes and a signed state cookie", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/github?returnTo=/repo/a/b");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("client-id");
    expect(loc.searchParams.get("redirect_uri")).toBe(`${SITE}/api/auth/github/callback`);
    expect(loc.searchParams.has("scope")).toBe(false);
    const cookie = setCookies(res).get("opensrc_oauth")!;
    expect(cookie.raw).toMatch(/HttpOnly/i);
    expect(cookie.raw).toMatch(/Path=\/api\/auth/);
    expect(cookie.raw).toMatch(/SameSite=Lax/i);
  });

  it("a good callback creates the user and a session cookie, then returns to the page", async () => {
    const t = makeApp();
    const { cookie, location } = await signIn(t, "/repo/a/b?tab=issues");
    expect(location).toBe(`${SITE}/repo/a/b?tab=issues`);

    const me = await (await t.app.request("/api/me", { headers: { cookie } })).json();
    expect(me.user).toMatchObject({ login: "octo", name: "Octo Cat" });

    const users = await t.db.execute("SELECT * FROM users");
    expect(users.rows).toHaveLength(1);
    expect(Number(users.rows[0].github_id)).toBe(4242);
  });

  it("sets an HttpOnly, Secure, SameSite=Lax session cookie on Path=/", async () => {
    const t = makeApp();
    const start = await t.app.request("/api/auth/github");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cb = await t.app.request(`/api/auth/github/callback?code=good&state=${state}`, {
      headers: { cookie: `opensrc_oauth=${setCookies(start).get("opensrc_oauth")!.value}` },
    });
    const raw = setCookies(cb).get("opensrc_session")!.raw;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//);
  });

  it("drops Secure when the site is plain-http localhost", async () => {
    const t = makeApp({ env: { SITE_URL: "http://localhost:5173" } });
    const start = await t.app.request("/api/auth/github");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cb = await t.app.request(`/api/auth/github/callback?code=good&state=${state}`, {
      headers: { cookie: `opensrc_oauth=${setCookies(start).get("opensrc_oauth")!.value}` },
    });
    expect(setCookies(cb).get("opensrc_session")!.raw).not.toMatch(/Secure/i);
  });

  it("never stores the GitHub access token, and stores only a hash of the session token", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const raw = cookie.split("=")[1];
    const dump = await dumpDb(t.db);
    expect(dump).not.toContain(FAKE_GH_TOKEN);
    expect(dump).not.toContain(raw);
    expect(dump).toContain(await sha256Hex(raw));
    // The token was used once, for GET /user.
    expect(t.github.calls.map((c) => c.url)).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
    ]);
  });

  it("rejects a state that doesn't match the cookie (400)", async () => {
    const { app } = makeApp();
    const start = await app.request("/api/auth/github");
    const stateCookie = setCookies(start).get("opensrc_oauth")!.value;
    const res = await app.request("/api/auth/github/callback?code=good&state=someone-elses", {
      headers: { cookie: `opensrc_oauth=${stateCookie}` },
    });
    expect(res.status).toBe(400);
    expect(setCookies(res).get("opensrc_session")).toBeUndefined();
  });

  it("rejects a callback without the state cookie, or with a tampered one (400)", async () => {
    const { app } = makeApp();
    const start = await app.request("/api/auth/github");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    expect((await app.request(`/api/auth/github/callback?code=good&state=${state}`)).status).toBe(400);
    const tampered = setCookies(start)
      .get("opensrc_oauth")!
      .value.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
    const res = await app.request(`/api/auth/github/callback?code=good&state=${state}`, {
      headers: { cookie: `opensrc_oauth=${tampered}` },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an expired state (400)", async () => {
    const t = makeApp();
    const start = await t.app.request("/api/auth/github");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    t.clock.now += 11 * 60_000;
    const res = await t.app.request(`/api/auth/github/callback?code=good&state=${state}`, {
      headers: { cookie: `opensrc_oauth=${setCookies(start).get("opensrc_oauth")!.value}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns to the home page when returnTo points at another site", async () => {
    for (const evil of ["https://evil.example/steal", "//evil.example/x", "/\\evil.example", "/api/me"]) {
      const t = makeApp();
      const { location } = await signIn(t, evil);
      expect(location).toBe(`${SITE}/`);
    }
  });

  it("sends a failed code exchange back to the account page without a session", async () => {
    const t = makeApp();
    const start = await t.app.request("/api/auth/github");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await t.app.request(`/api/auth/github/callback?code=bad&state=${state}`, {
      headers: { cookie: `opensrc_oauth=${setCookies(start).get("opensrc_oauth")!.value}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${SITE}/account?login=failed`);
    expect(setCookies(res).get("opensrc_session")).toBeUndefined();
  });

  it("updates the profile on a second sign-in instead of duplicating the user", async () => {
    const t = makeApp();
    await signIn(t);
    await signIn(t);
    expect((await t.db.execute("SELECT COUNT(*) AS n FROM users")).rows[0].n).toBe(1);
    expect((await t.db.execute("SELECT COUNT(*) AS n FROM sessions")).rows[0].n).toBe(2);
  });
});

describe("sessions", () => {
  it("/api/me is null when signed out", async () => {
    const { app } = makeApp();
    expect(await (await app.request("/api/me")).json()).toEqual({ user: null });
  });

  it("logout deletes the session and clears the cookie", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const res = await t.app.request("/api/auth/logout", { method: "POST", headers: write(cookie) });
    expect(res.status).toBe(200);
    expect(setCookies(res).get("opensrc_session")?.value).toBe("");
    expect((await t.db.execute("SELECT COUNT(*) AS n FROM sessions")).rows[0].n).toBe(0);
    expect(await (await t.app.request("/api/me", { headers: { cookie } })).json()).toEqual({ user: null });
  });

  it("expires after 30 days", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    t.clock.now += 31 * 86_400_000;
    expect(await (await t.app.request("/api/me", { headers: { cookie } })).json()).toEqual({ user: null });
  });
});

describe("CSRF", () => {
  it("rejects writes without an Origin, or from another site", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const noOrigin = await t.app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(noOrigin.status).toBe(403);
    const evil = await t.app.request("/api/saved/repo/a%2Fb", {
      method: "PUT",
      headers: { ...write(cookie), origin: "https://evil.example" },
      body: "{}",
    });
    expect(evil.status).toBe(403);
    // The session survived both.
    expect((await (await t.app.request("/api/me", { headers: { cookie } })).json()).user).not.toBeNull();
  });

  it("allows the site's own origin", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    const res = await t.app.request("/api/saved/repo/a%2Fb", { method: "PUT", headers: write(cookie), body: "{}" });
    expect(res.status).toBe(200);
  });

  it("allows localhost origins only when the site itself is local", async () => {
    const local = makeApp({ env: { SITE_URL: "http://localhost:5173" } });
    const a = await local.app.request("/api/auth/logout", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(a.status).toBe(200);
    const prod = makeApp();
    const b = await prod.app.request("/api/auth/logout", {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });
    expect(b.status).toBe(403);
  });
});

describe("feature switched off", () => {
  it("answers 503 without a database", async () => {
    const app = createApp({
      env: { SITE_URL: SITE, SESSION_SECRET: "s", GITHUB_OAUTH_CLIENT_ID: "i", GITHUB_OAUTH_CLIENT_SECRET: "c" },
    });
    for (const path of ["/api/auth/github", "/api/auth/github/callback?code=x&state=y", "/api/me", "/api/saved"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(503);
      expect(await res.json()).toEqual({ error: "feature disabled" });
    }
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { origin: SITE } });
    expect(logout.status).toBe(503);
  });

  it("answers 503 with a database but no OAuth app", async () => {
    const { app } = makeApp({ env: { GITHUB_OAUTH_CLIENT_ID: undefined } });
    expect((await app.request("/api/me")).status).toBe(503);
    expect((await app.request("/api/auth/github")).status).toBe(503);
  });
});

describe("safeReturnTo", () => {
  it.each([
    [undefined, "/"],
    ["/repo/a/b", "/repo/a/b"],
    ["/?q=rust#top", "/?q=rust#top"],
    ["https://opensrc.test/account", "/account"],
    ["https://evil.example/", "/"],
    ["//evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/api/auth/logout", "/"],
  ])("%s → %s", (raw, out) => expect(safeReturnTo(raw, SITE)).toBe(out));
});

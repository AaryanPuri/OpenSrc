import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MailError, ResendProvider } from "../src/mail/index.js";
import { TokenBucket } from "../src/middleware/rateLimit.js";
import {
  confirmToken,
  CONFIRM_TTL_S,
  peekToken,
  signToken,
  unsubscribeToken,
  verifyToken,
} from "../src/newsletter/tokens.js";
import { makeApp, signIn, SITE, write, type TestApp } from "./accountHelpers.js";

const SECRET = "newsletter-secret-for-tests";
const NOW = Date.parse("2026-09-28T12:00:00Z");

describe("newsletter tokens", () => {
  it("sign and verify for the same email and purpose", async () => {
    const t = await confirmToken(SECRET, 12, "Ada@Example.com", NOW);
    expect(peekToken(t)).toMatchObject({ purpose: "confirm", id: 12 });
    expect(t).not.toContain("example");
    expect(await verifyToken(SECRET, t, "confirm", "ada@example.com", NOW)).toMatchObject({ id: 12 });
  });

  it("fail for another email, purpose, secret or a changed id", async () => {
    const t = await confirmToken(SECRET, 12, "ada@example.com", NOW);
    expect(await verifyToken(SECRET, t, "confirm", "eve@example.com", NOW)).toBeNull();
    expect(await verifyToken(SECRET, t, "unsub", "ada@example.com", NOW)).toBeNull();
    expect(await verifyToken("other", t, "confirm", "ada@example.com", NOW)).toBeNull();
    expect(
      await verifyToken(SECRET, t.replace("confirm.12.", "confirm.13."), "confirm", "ada@example.com", NOW),
    ).toBeNull();
    expect(await verifyToken(SECRET, "garbage", "confirm", "ada@example.com", NOW)).toBeNull();
  });

  it("confirm links expire after 7 days; unsubscribe links never do", async () => {
    const c = await confirmToken(SECRET, 1, "a@b.co", NOW);
    expect(await verifyToken(SECRET, c, "confirm", "a@b.co", NOW + (CONFIRM_TTL_S - 1) * 1000)).not.toBeNull();
    expect(await verifyToken(SECRET, c, "confirm", "a@b.co", NOW + CONFIRM_TTL_S * 1000)).toBeNull();
    const u = await unsubscribeToken(SECRET, 1, "a@b.co");
    expect(await verifyToken(SECRET, u, "unsub", "a@b.co", NOW + 10 * 365 * 86_400_000)).not.toBeNull();
    const expired = await signToken(SECRET, { purpose: "unsub", id: 1, exp: NOW / 1000 - 1 }, "a@b.co");
    expect(await verifyToken(SECRET, expired, "unsub", "a@b.co", NOW)).toBeNull();
  });
});

const subscribe = (t: TestApp, body: unknown, headers: Record<string, string> = {}) =>
  t.app.request("/api/newsletter/subscribe", {
    method: "POST",
    headers: write(undefined, headers),
    body: JSON.stringify(body),
  });

const linkIn = (text: string, path: string) => {
  const m = new RegExp(`${SITE}${path}\\?token=\\S+`).exec(text);
  if (!m) throw new Error(`no ${path} link in:\n${text}`);
  return m[0].slice(SITE.length);
};

async function row(t: TestApp, email: string) {
  return (await t.db.execute({ sql: "SELECT * FROM subscribers WHERE email = ?", args: [email] })).rows[0];
}

describe("subscribe → confirm → unsubscribe", () => {
  it("runs the double opt-in and one-click unsubscribe", async () => {
    const t = makeApp();
    const res = await subscribe(t, { email: " Ada@Example.com ", languages: ["rust", "go", "klingon"] });
    expect(res.status).toBe(202);
    const pending = await row(t, "ada@example.com");
    expect(pending.status).toBe("pending");
    expect(JSON.parse(String(pending.languages))).toEqual(["rust", "go"]);

    expect(t.mail.outbox).toHaveLength(1);
    const mail = t.mail.outbox[0];
    expect(mail.to).toBe("ada@example.com");
    expect(mail.from).toBe("OpenSrc <digest@opensrc.test>");
    expect(mail.replyTo).toBe("hello@opensrc.studio");
    expect(mail.text).toContain("Rust and Go");
    expect(mail.html).toContain("Confirm my subscription");

    const confirm = await t.app.request(linkIn(mail.text, "/api/newsletter/confirm"));
    expect(confirm.status).toBe(302);
    expect(confirm.headers.get("location")).toBe(`${SITE}/?newsletter=confirmed`);
    expect((await row(t, "ada@example.com")).status).toBe("active");

    // An unsubscribe link as the digest would carry it.
    const id = Number(pending.id);
    const unsub = `/api/newsletter/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(SECRET, id, "ada@example.com"))}`;
    const out = await t.app.request(unsub);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(`${SITE}/?newsletter=unsubscribed`);
    expect((await row(t, "ada@example.com")).status).toBe("unsubscribed");
  });

  it("accepts the mail client's one-click POST without an Origin (RFC 8058)", async () => {
    const t = makeApp();
    await subscribe(t, { email: "ada@example.com", languages: [] });
    await t.app.request(linkIn(t.mail.outbox[0].text, "/api/newsletter/confirm"));
    const id = Number((await row(t, "ada@example.com")).id);
    const token = await unsubscribeToken(SECRET, id, "ada@example.com");
    const res = await t.app.request(`/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect((await row(t, "ada@example.com")).status).toBe("unsubscribed");
  });

  it("rejects bad and expired confirm links", async () => {
    const t = makeApp();
    await subscribe(t, { email: "ada@example.com", languages: [] });
    const link = linkIn(t.mail.outbox[0].text, "/api/newsletter/confirm");
    const bad = await t.app.request("/api/newsletter/confirm?token=confirm.1.9999999999.xxx");
    expect(bad.headers.get("location")).toBe(`${SITE}/?newsletter=invalid`);
    t.clock.now += 8 * 86_400_000;
    const late = await t.app.request(link);
    expect(late.headers.get("location")).toBe(`${SITE}/?newsletter=invalid`);
    expect((await row(t, "ada@example.com")).status).toBe("pending");
  });

  it("confirming while signed in links the subscription to the account", async () => {
    const t = makeApp();
    const { cookie } = await signIn(t);
    await subscribe(t, { email: "octo@example.com", languages: ["python"] });
    const res = await t.app.request(linkIn(t.mail.outbox[0].text, "/api/newsletter/confirm"), { headers: { cookie } });
    expect(res.headers.get("location")).toBe(`${SITE}/account?subscribed=1`);

    const me = await (await t.app.request("/api/newsletter/me", { headers: { cookie } })).json();
    expect(me).toEqual({ subscription: { email: "octo@example.com", languages: ["python"], status: "active" } });

    const put = await t.app.request("/api/newsletter/me", {
      method: "PUT",
      headers: write(cookie),
      body: JSON.stringify({ languages: ["go"] }),
    });
    expect((await put.json()).subscription.languages).toEqual(["go"]);

    const del = await t.app.request("/api/newsletter/me", { method: "DELETE", headers: write(cookie) });
    expect((await del.json()).subscription.status).toBe("unsubscribed");
  });

  it("answers the same way for an address that is already subscribed, and changes nothing", async () => {
    const t = makeApp();
    await subscribe(t, { email: "ada@example.com", languages: ["rust"] });
    await t.app.request(linkIn(t.mail.outbox[0].text, "/api/newsletter/confirm"));
    const again = await subscribe(t, { email: "ada@example.com", languages: ["go"] });
    expect(again.status).toBe(202);
    expect(t.mail.outbox).toHaveLength(1);
    expect(JSON.parse(String((await row(t, "ada@example.com")).languages))).toEqual(["rust"]);
  });

  it("doesn't resend a confirmation within 10 minutes", async () => {
    const t = makeApp();
    await subscribe(t, { email: "ada@example.com", languages: [] });
    await subscribe(t, { email: "ada@example.com", languages: [] });
    expect(t.mail.outbox).toHaveLength(1);
    t.clock.now += 11 * 60_000;
    await subscribe(t, { email: "ada@example.com", languages: [] });
    expect(t.mail.outbox).toHaveLength(2);
  });

  it("can subscribe again after unsubscribing (a new confirmation)", async () => {
    const t = makeApp();
    await subscribe(t, { email: "ada@example.com", languages: [] });
    await t.app.request(linkIn(t.mail.outbox[0].text, "/api/newsletter/confirm"));
    const id = Number((await row(t, "ada@example.com")).id);
    await t.app.request(
      `/api/newsletter/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(SECRET, id, "ada@example.com"))}`,
    );
    await subscribe(t, { email: "ada@example.com", languages: ["go"] });
    expect(t.mail.outbox).toHaveLength(2);
    expect((await row(t, "ada@example.com")).status).toBe("pending");
    await t.app.request(linkIn(t.mail.outbox[1].text, "/api/newsletter/confirm"));
    expect((await row(t, "ada@example.com")).status).toBe("active");
  });

  it("validates the address", async () => {
    const t = makeApp();
    for (const email of ["", "nope", "a@b", "a b@c.co", 42, `${"x".repeat(250)}@a.co`]) {
      expect((await subscribe(t, { email, languages: [] })).status).toBe(400);
    }
    expect(t.mail.outbox).toHaveLength(0);
  });

  it("rate-limits sign-ups per IP", async () => {
    const t = makeApp({ newsletterLimiter: new TokenBucket(2, 60_000) });
    const ip = { "cf-connecting-ip": "203.0.113.9" };
    expect((await subscribe(t, { email: "a@example.com" }, ip)).status).toBe(202);
    expect((await subscribe(t, { email: "b@example.com" }, ip)).status).toBe(202);
    expect((await subscribe(t, { email: "c@example.com" }, ip)).status).toBe(429);
    expect((await subscribe(t, { email: "d@example.com" }, { "cf-connecting-ip": "203.0.113.10" })).status).toBe(202);
  });

  it("is CSRF-checked", async () => {
    const t = makeApp();
    const res = await subscribe(t, { email: "a@example.com" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("answers 502 when the confirmation can't be sent", async () => {
    const t = makeApp({
      mail: {
        name: "broken",
        send: async () => {
          throw new MailError("down", 500);
        },
      },
    });
    expect((await subscribe(t, { email: "a@example.com" })).status).toBe(502);
  });
});

describe("newsletter switched off", () => {
  it("answers 503 without a database, secret or mail provider", async () => {
    const apps = [
      createApp({ env: { SITE_URL: SITE, NEWSLETTER_SECRET: "s", MAIL_PROVIDER: "console" } }),
      makeApp({ env: { NEWSLETTER_SECRET: undefined } }).app,
      makeApp({ mail: undefined, env: { NEWSLETTER_FROM: undefined } }).app,
    ];
    for (const app of apps) {
      const health = await (await app.request("/api/health")).json();
      expect(health.newsletter).toBe(false);
      const res = await app.request("/api/newsletter/subscribe", {
        method: "POST",
        headers: write(),
        body: JSON.stringify({ email: "a@example.com" }),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "feature disabled" });
      expect((await app.request("/api/newsletter/confirm?token=x")).status).toBe(503);
      expect((await app.request("/api/newsletter/unsubscribe?token=x")).status).toBe(503);
    }
  });
});

describe("ResendProvider", () => {
  it("posts the message with headers and reply-to", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const provider = new ResendProvider("re_test", (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({ id: "email_1" });
    }) as unknown as typeof fetch);
    const r = await provider.send({
      to: "a@example.com",
      from: "OpenSrc <digest@opensrc.studio>",
      replyTo: "hello@opensrc.studio",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
    expect(r.id).toBe("email_1");
    expect(sent!.url).toBe("https://api.resend.com/emails");
    expect(new Headers(sent!.init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(sent!.init.body))).toMatchObject({
      to: ["a@example.com"],
      reply_to: "hello@opensrc.studio",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
  });

  it("throws a MailError with the status on failure", async () => {
    const provider = new ResendProvider(
      "k",
      (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
    );
    await expect(
      provider.send({ to: "a@b.co", from: "f@b.co", subject: "s", html: "h", text: "t" }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

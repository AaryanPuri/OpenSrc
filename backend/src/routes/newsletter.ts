/**
 * Newsletter sign-up with double opt-in.
 *
 *   POST /api/newsletter/subscribe { email, languages[] }   pending row + confirmation email (202)
 *   GET  /api/newsletter/confirm?token=                      active, then back to the site
 *   GET  /api/newsletter/unsubscribe?token=                  one click (also POST, RFC 8058)
 *   GET|PUT|DELETE /api/newsletter/me                        the signed-in user's subscription
 *
 * The subscribe answer is the same whatever the address's state, so the form can't
 * be used to find out who is subscribed.
 */
import type { Hono } from "hono";
import { LANGUAGES } from "../../../shared/dictionary.js";
import { requireUser } from "../auth/routes.js";
import { currentUser } from "../auth/session.js";
import { disabled, features, siteOrigin, type AppEnv, type Ctx, type Deps } from "../context.js";
import { nowIso, type Db } from "../db/index.js";
import { TokenBucket } from "../middleware/rateLimit.js";
import { mailFrom, REPLY_TO } from "../mail/index.js";
import { MAX_LANGUAGES, parseLanguages } from "../newsletter/digest.js";
import { confirmEmail } from "../newsletter/emails.js";
import { confirmToken, peekToken, verifyToken } from "../newsletter/tokens.js";

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
/** Don't send another confirmation to the same address within this window. */
const RESEND_AFTER_MS = 10 * 60_000;
const KNOWN_LANGUAGES = new Set(LANGUAGES.map((l) => l.id));

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function cleanLanguages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.filter((l): l is string => typeof l === "string" && KNOWN_LANGUAGES.has(l)))].slice(
    0,
    MAX_LANGUAGES,
  );
}

interface SubscriberRow {
  id: number;
  email: string;
  languages: string[];
  status: "pending" | "active" | "unsubscribed";
  userId: number | null;
  confirmSentAt: string | null;
}

function toRow(r: Record<string, unknown>): SubscriberRow {
  return {
    id: Number(r.id),
    email: String(r.email),
    languages: parseLanguages(r.languages),
    status: String(r.status) as SubscriberRow["status"],
    userId: r.user_id == null ? null : Number(r.user_id),
    confirmSentAt: r.confirm_sent_at == null ? null : String(r.confirm_sent_at),
  };
}

async function byId(db: Db, id: number): Promise<SubscriberRow | null> {
  const rs = await db.execute({ sql: "SELECT * FROM subscribers WHERE id = ?", args: [id] });
  return rs.rows[0] ? toRow(rs.rows[0] as Record<string, unknown>) : null;
}

export function registerNewsletter(app: Hono<AppEnv>, deps: Deps, opts: { limiter?: TokenBucket } = {}): void {
  // 5 sign-ups in a burst per address, then one every 2 minutes.
  const limiter = opts.limiter ?? new TokenBucket(5, 2 * 60_000);

  const newsletterDb = async (c: Ctx): Promise<Db | null> => {
    if (!features(deps.env(c), deps.hasDb(c), !!deps.mail(c)).newsletter) return null;
    return deps.db(c);
  };

  app.post("/api/newsletter/subscribe", async (c) => {
    const db = await newsletterDb(c);
    if (!db) return disabled(c);
    if (!limiter.take(deps.clientIp(c), deps.now())) {
      return c.json({ error: "Too many sign-ups from here. Try again in a few minutes." }, 429);
    }
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; languages?: unknown } | null;
    const email = normalizeEmail(body?.email);
    if (!email) return c.json({ error: "That doesn't look like an email address." }, 400);
    const languages = cleanLanguages(body?.languages);
    const env = deps.env(c);
    const now = deps.now();

    const rs = await db.execute({ sql: "SELECT * FROM subscribers WHERE email = ?", args: [email] });
    const existing = rs.rows[0] ? toRow(rs.rows[0] as Record<string, unknown>) : null;
    let id: number;
    if (!existing) {
      const ins = await db.execute({
        sql: `INSERT INTO subscribers (email, languages, status, created_at) VALUES (?, ?, 'pending', ?)
              ON CONFLICT(email) DO NOTHING RETURNING id`,
        args: [email, JSON.stringify(languages), nowIso(now)],
      });
      if (!ins.rows[0]) return c.json({ ok: true }, 202); // a concurrent sign-up for the same address
      id = Number(ins.rows[0].id);
    } else if (existing.status === "active") {
      // Already subscribed: change nothing (only the owner can, from the account page or a new confirmation).
      return c.json({ ok: true }, 202);
    } else {
      id = existing.id;
      const recently =
        existing.status === "pending" &&
        existing.confirmSentAt !== null &&
        now - Date.parse(existing.confirmSentAt) < RESEND_AFTER_MS;
      await db.execute({
        sql: "UPDATE subscribers SET languages = ?, status = 'pending' WHERE id = ?",
        args: [JSON.stringify(languages), id],
      });
      if (recently) return c.json({ ok: true }, 202);
    }

    const site = siteOrigin(env, c);
    const token = await confirmToken(env.NEWSLETTER_SECRET!, id, email, now);
    const message = confirmEmail({
      site,
      confirmUrl: `${site}/api/newsletter/confirm?token=${encodeURIComponent(token)}`,
      languages,
    });
    try {
      await deps.mail(c)!.send({ to: email, from: mailFrom(env), replyTo: REPLY_TO, ...message });
    } catch (err) {
      console.warn("[newsletter] confirmation email failed:", (err as Error).message);
      return c.json({ error: "We couldn't send the confirmation email. Please try again later." }, 502);
    }
    await db.execute({ sql: "UPDATE subscribers SET confirm_sent_at = ? WHERE id = ?", args: [nowIso(now), id] });
    return c.json({ ok: true }, 202);
  });

  app.get("/api/newsletter/confirm", async (c) => {
    const db = await newsletterDb(c);
    if (!db) return disabled(c);
    const env = deps.env(c);
    const site = siteOrigin(env, c);
    const token = c.req.query("token");
    const claims = peekToken(token);
    const row = claims ? await byId(db, claims.id) : null;
    const ok = row && (await verifyToken(env.NEWSLETTER_SECRET!, token, "confirm", row.email, deps.now()));
    if (!row || !ok || row.status === "unsubscribed") return c.redirect(`${site}/?newsletter=invalid`, 302);

    // Signed in while confirming: link the subscription to the account, so it shows there.
    const user = features(env, true, false).auth ? await currentUser(c, db, deps) : null;
    await db.execute({
      sql: `UPDATE subscribers SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?), unsubscribed_at = NULL,
            user_id = COALESCE(?, user_id) WHERE id = ?`,
      args: [nowIso(deps.now()), user?.id ?? null, row.id],
    });
    return c.redirect(user ? `${site}/account?subscribed=1` : `${site}/?newsletter=confirmed`, 302);
  });

  const unsubscribe = async (c: Ctx): Promise<boolean | null> => {
    const db = await newsletterDb(c);
    if (!db) return null;
    const env = deps.env(c);
    const token = c.req.query("token");
    const claims = peekToken(token);
    const row = claims ? await byId(db, claims.id) : null;
    if (!row || !(await verifyToken(env.NEWSLETTER_SECRET!, token, "unsub", row.email, deps.now()))) return false;
    if (row.status !== "unsubscribed") {
      await db.execute({
        sql: "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?",
        args: [nowIso(deps.now()), row.id],
      });
    }
    return true;
  };

  app.get("/api/newsletter/unsubscribe", async (c) => {
    const done = await unsubscribe(c);
    if (done === null) return disabled(c);
    return c.redirect(`${siteOrigin(deps.env(c), c)}/?newsletter=${done ? "unsubscribed" : "invalid"}`, 302);
  });

  // One-click unsubscribe from the mail client (List-Unsubscribe-Post). No Origin: exempt from the CSRF check.
  app.post("/api/newsletter/unsubscribe", async (c) => {
    const done = await unsubscribe(c);
    if (done === null) return disabled(c);
    return done ? c.json({ ok: true }) : c.json({ error: "invalid link" }, 400);
  });

  const mine = async (db: Db, userId: number) => {
    const rs = await db.execute({
      sql: "SELECT * FROM subscribers WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      args: [userId],
    });
    return rs.rows[0] ? toRow(rs.rows[0] as Record<string, unknown>) : null;
  };
  const view = (s: SubscriberRow | null) =>
    s ? { subscription: { email: s.email, languages: s.languages, status: s.status } } : { subscription: null };

  app.get("/api/newsletter/me", async (c) => {
    if (!features(deps.env(c), deps.hasDb(c), !!deps.mail(c)).newsletter) return disabled(c);
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    c.header("Cache-Control", "no-store");
    return c.json(view(await mine(r.db, r.user.id)));
  });

  app.put("/api/newsletter/me", async (c) => {
    if (!features(deps.env(c), deps.hasDb(c), !!deps.mail(c)).newsletter) return disabled(c);
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    const sub = await mine(r.db, r.user.id);
    if (!sub) return c.json({ error: "no subscription on this account" }, 404);
    const body = (await c.req.json().catch(() => null)) as { languages?: unknown } | null;
    const languages = cleanLanguages(body?.languages);
    await r.db.execute({
      sql: "UPDATE subscribers SET languages = ? WHERE id = ?",
      args: [JSON.stringify(languages), sub.id],
    });
    return c.json(view({ ...sub, languages }));
  });

  app.delete("/api/newsletter/me", async (c) => {
    if (!features(deps.env(c), deps.hasDb(c), !!deps.mail(c)).newsletter) return disabled(c);
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    const sub = await mine(r.db, r.user.id);
    if (!sub) return c.json(view(null));
    await r.db.execute({
      sql: "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?",
      args: [nowIso(deps.now()), sub.id],
    });
    return c.json(view({ ...sub, status: "unsubscribed" }));
  });
}

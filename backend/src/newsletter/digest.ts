/**
 * The weekly digest: for each active subscriber, "New first-PR repos in {Lang} this
 * week", topped up with the best-scoring repos when a week is thin.
 *
 * Resumable and cap-aware: a subscriber is marked with the ISO week once their
 * digest is sent, and a run sends at most DIGEST_DAILY_CAP emails per UTC day
 * (counting earlier runs that day). The Monday run plus the Tuesday and Wednesday
 * catch-up runs (.github/workflows/digest.yml) finish whatever the cap left over.
 */
import { collectionById, type CollectionContext } from "../../../shared/collections.js";
import type { DatasetMeta, RepoRecord } from "../../../shared/repo.js";
import { nowIso, type Db } from "../db/index.js";
import { MailError, REPLY_TO, type MailProvider } from "../mail/index.js";
import { digestEmail, type DigestSection, type Email } from "./emails.js";
import { unsubscribeToken } from "./tokens.js";

export const SECTION_SIZE = 5;
export const MAX_LANGUAGES = 5;
/** Default daily cap: under Resend's free 100 emails/day, leaving room for confirmation emails. */
export const DEFAULT_DAILY_CAP = 90;

/** ISO 8601 week, e.g. "2026-W40" (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const fresh = collectionById("fresh")!;
const byScore = (a: RepoRecord, b: RepoRecord) => b.score - a.score || a.fullName.localeCompare(b.fullName);

/** One section per language (or one for any language), dropping empty ones. */
export function selectSections(
  repos: RepoRecord[],
  languages: string[],
  ctx: CollectionContext,
  size = SECTION_SIZE,
): DigestSection[] {
  const langs: (string | null)[] = languages.length ? languages.slice(0, MAX_LANGUAGES) : [null];
  const sections: DigestSection[] = [];
  for (const language of langs) {
    const pool = language === null ? repos : repos.filter((r) => r.language === language);
    const isNew = pool
      .filter((r) => r.firstPrFriendly && fresh.includes(r, ctx))
      .sort(byScore)
      .slice(0, size);
    const taken = new Set(isNew.map((r) => r.fullName));
    const topUp = pool
      .filter((r) => !taken.has(r.fullName))
      .sort((a, b) => Number(b.firstPrFriendly) - Number(a.firstPrFriendly) || byScore(a, b))
      .slice(0, size - isNew.length);
    if (isNew.length || topUp.length) sections.push({ language, fresh: isNew, topUp });
  }
  return sections;
}

export function parseLanguages(raw: unknown): string[] {
  try {
    const v = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface DigestOptions {
  db: Db;
  mail: MailProvider;
  repos: RepoRecord[];
  meta: Pick<DatasetMeta, "bootstrapAt"> | null;
  site: string;
  secret: string;
  from: string;
  cap: number;
  now?: Date;
  dryRun?: boolean;
  log?: (msg: string) => void;
  /** Pause between sends (Resend allows 2 requests a second by default). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DigestReport {
  week: string;
  dryRun: boolean;
  /** Emails already sent today before this run. */
  sentEarlierToday: number;
  sent: number;
  /** Subscribers with nothing to send (marked done for the week). */
  skipped: number;
  failed: number;
  /** Still waiting for this week's digest after the run. */
  remaining: number;
  capReached: boolean;
  /** Dry runs: what would have been sent. */
  previews: { to: string; email: Email }[];
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function runDigest(o: DigestOptions): Promise<DigestReport> {
  const now = o.now ?? new Date();
  const log = o.log ?? console.log;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const week = isoWeek(now);
  const bootstrapAt = o.meta ? Date.parse(o.meta.bootstrapAt) : NaN;
  const ctx: CollectionContext = { now: now.getTime(), bootstrapAt: Number.isFinite(bootstrapAt) ? bootstrapAt : null };
  const dryRun = !!o.dryRun;

  const waiting = async () =>
    Number(
      (
        await o.db.execute({
          sql: `SELECT COUNT(*) AS n FROM subscribers
                WHERE status = 'active' AND (last_digest_week IS NULL OR last_digest_week <> ?)`,
          args: [week],
        })
      ).rows[0]?.n ?? 0,
    );

  const sentEarlierToday = Number(
    (
      await o.db.execute({
        sql: "SELECT COUNT(*) AS n FROM subscribers WHERE last_sent_at >= ?",
        args: [nowIso(startOfUtcDay(now).getTime())],
      })
    ).rows[0]?.n ?? 0,
  );
  const budget = Math.max(0, o.cap - sentEarlierToday);
  const report: DigestReport = {
    week,
    dryRun,
    sentEarlierToday,
    sent: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
    capReached: false,
    previews: [],
  };

  // Enough rows to fill the budget even if some of them have nothing to send.
  const rows = (
    await o.db.execute({
      sql: `SELECT id, email, languages FROM subscribers
            WHERE status = 'active' AND (last_digest_week IS NULL OR last_digest_week <> ?)
            ORDER BY id LIMIT ?`,
      args: [week, budget * 2 + 50],
    })
  ).rows;

  const mark = async (id: number, sent: boolean) => {
    if (dryRun) return;
    await o.db.execute({
      sql: sent
        ? "UPDATE subscribers SET last_digest_week = ?, last_sent_at = ? WHERE id = ?"
        : "UPDATE subscribers SET last_digest_week = ? WHERE id = ?",
      args: sent ? [week, nowIso(now.getTime()), id] : [week, id],
    });
  };

  for (const row of rows) {
    if (report.sent >= budget) {
      report.capReached = true;
      break;
    }
    const id = Number(row.id);
    const email = String(row.email);
    const sections = selectSections(o.repos, parseLanguages(row.languages), ctx);
    if (!sections.length) {
      report.skipped++;
      await mark(id, false);
      continue;
    }
    const unsubscribeUrl = `${o.site}/api/newsletter/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(o.secret, id, email))}`;
    const message = digestEmail({ site: o.site, sections, unsubscribeUrl, week });
    if (dryRun) {
      report.previews.push({ to: email, email: message });
      report.sent++;
      continue;
    }
    try {
      if (report.sent > 0 && o.delayMs) await sleep(o.delayMs);
      await o.mail.send({
        to: email,
        from: o.from,
        replyTo: REPLY_TO,
        ...message,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${REPLY_TO}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await mark(id, true);
      report.sent++;
    } catch (err) {
      // The provider's own quota: stop here; the next run carries on.
      if (err instanceof MailError && err.status === 429) {
        log(`[digest] provider limit reached after ${report.sent} emails: ${err.message}`);
        report.capReached = true;
        break;
      }
      report.failed++;
      log(`[digest] sending to subscriber ${id} failed: ${(err as Error).message}`);
    }
  }
  if (!report.capReached && report.sent >= budget && rows.length > report.sent + report.skipped + report.failed) {
    report.capReached = true;
  }
  report.remaining = dryRun ? Math.max(0, (await waiting()) - report.sent - report.skipped) : await waiting();
  return report;
}

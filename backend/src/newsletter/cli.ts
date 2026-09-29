/**
 * Weekly digest sender (run from backend/):
 *
 *   npm run digest                       send this week's digest (resumes where the last run stopped)
 *   npm run digest -- --dry-run          show who would get what; sends and writes nothing
 *   npm run digest -- --preview rust,go --out digest.html   render one sample email, no database needed
 *   npm run digest -- --data-dir ../data
 *
 * Env: DATABASE_URL (+ DATABASE_AUTH_TOKEN), NEWSLETTER_SECRET, SITE_URL, RESEND_API_KEY +
 * NEWSLETTER_FROM (or MAIL_PROVIDER=console), DIGEST_DAILY_CAP. Reads backend/.env.
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectionContext } from "../../../shared/collections.js";
import { migrate } from "../db/index.js";
import { nodeDb } from "../db/node.js";
import { mailFrom, mailFromEnv } from "../mail/index.js";
import { envFromProcess, loadDotEnv } from "../nodeEnv.js";
import { findRepoRoot } from "../pipeline/cli.js";
import { readDataset } from "../pipeline/write.js";
import { digestEmail } from "./emails.js";
import { DEFAULT_DAILY_CAP, isoWeek, runDigest, selectSections } from "./digest.js";

interface Args {
  dryRun: boolean;
  dataDir: string;
  preview?: string[];
  out?: string;
}

export function parseDigestArgs(argv: string[], defaultDataDir: string): Args {
  const args: Args = { dryRun: false, dataDir: defaultDataDir };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--data-dir") args.dataDir = resolve(value());
    else if (flag === "--preview") {
      const v = value();
      args.preview = v === "any" ? [] : v.split(",").filter(Boolean);
    } else if (flag === "--out") args.out = value();
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return args;
}

async function main() {
  loadDotEnv();
  const env = envFromProcess();
  const args = parseDigestArgs(process.argv.slice(2), join(findRepoRoot(), "data"));
  const { repos, meta } = await readDataset(args.dataDir);
  if (!repos.length) throw new Error(`no repos in ${args.dataDir}`);
  const site = (env.SITE_URL || "https://opensrc.studio").replace(/\/+$/, "");

  if (args.preview) {
    const ctx = meta ? collectionContext(meta) : { now: Date.now(), bootstrapAt: null };
    const sections = selectSections(repos, args.preview, { ...ctx, now: Date.now() });
    const email = digestEmail({
      site,
      sections,
      unsubscribeUrl: `${site}/api/newsletter/unsubscribe?token=preview`,
      week: isoWeek(new Date()),
    });
    if (args.out) await writeFile(args.out, email.html);
    console.log(`Subject: ${email.subject}\n\n${email.text}`);
    if (args.out) console.log(`\nHTML written to ${args.out}`);
    return;
  }

  if (!env.DATABASE_URL) throw new Error("set DATABASE_URL (or use --preview to render a sample without a database)");
  if (!env.NEWSLETTER_SECRET) throw new Error("set NEWSLETTER_SECRET (it signs the unsubscribe links)");
  const mail = mailFromEnv(env);
  if (!mail && !args.dryRun) throw new Error("set RESEND_API_KEY and NEWSLETTER_FROM (or MAIL_PROVIDER=console)");
  const cap = Number(env.DIGEST_DAILY_CAP ?? DEFAULT_DAILY_CAP);
  if (!Number.isInteger(cap) || cap < 0) throw new Error("DIGEST_DAILY_CAP must be a whole number");

  const db = nodeDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
  try {
    await migrate(db);
    const report = await runDigest({
      db,
      mail: mail ?? { name: "none", send: async () => ({}) },
      repos,
      meta,
      site,
      secret: env.NEWSLETTER_SECRET,
      from: mailFrom(env),
      cap,
      dryRun: args.dryRun,
      delayMs: mail?.name === "resend" ? 600 : 0,
    });
    for (const p of report.previews) console.log(`would send to ${p.to}: ${p.email.subject}`);
    console.log(
      `digest ${report.week}${report.dryRun ? " (dry run)" : ""}: sent ${report.sent}, skipped ${report.skipped}, failed ${report.failed}, ` +
        `${report.remaining} still waiting, ${report.sentEarlierToday} sent earlier today, cap ${cap}${report.capReached ? " (reached)" : ""}`,
    );
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`digest: ${(err as Error).message}`);
    process.exit(1);
  });
}

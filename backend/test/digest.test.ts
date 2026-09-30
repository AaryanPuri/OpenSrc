import { describe, expect, it } from "vitest";
import type { RepoRecord } from "../../shared/repo.js";
import { migrate, type Db } from "../src/db/index.js";
import { nodeDb } from "../src/db/node.js";
import { ConsoleProvider, MailError, type MailProvider } from "../src/mail/index.js";
import { isoWeek, runDigest, selectSections } from "../src/newsletter/digest.js";
import { digestEmail, esc } from "../src/newsletter/emails.js";
import { parseDigestArgs } from "../src/newsletter/cli.js";
import { verifyToken, peekToken } from "../src/newsletter/tokens.js";

const NOW = new Date("2026-09-28T14:00:00Z"); // a Monday
const BOOTSTRAP = "2026-08-01T00:00:00.000Z";
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const SECRET = "digest-secret";
const SITE = "https://opensrc.test";

function repo(fullName: string, over: Partial<RepoRecord> = {}): RepoRecord {
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    owner,
    name,
    description: `About ${name}`,
    homepage: null,
    avatarUrl: "",
    language: "rust",
    languageName: "Rust",
    topics: [],
    stars: 1200,
    forks: 0,
    license: "MIT",
    archived: false,
    fork: false,
    mirror: false,
    lastCommitAt: daysAgo(1),
    createdAt: daysAgo(900),
    contributingUrl: "https://x/CONTRIBUTING.md",
    hasCodeOfConduct: true,
    goodFirstIssues: 5,
    helpWanted: 2,
    gfiSampled: 5,
    gfiUnassigned: 5,
    gfiUnanswered: 1,
    issueLabels: [],
    responseHours: 10,
    responseSampledAt: null,
    fields: [],
    curated: false,
    firstSeenAt: daysAgo(60),
    score: 60,
    scoreParts: { supply: 0, activity: 0, response: 0, onboarding: 0, claimable: 0, reach: 0 },
    firstPrFriendly: true,
    ...over,
  };
}

const REPOS: RepoRecord[] = [
  repo("r/new-best", { firstSeenAt: daysAgo(2), score: 90 }),
  repo("r/new-ok", { firstSeenAt: daysAgo(6), score: 70 }),
  repo("r/new-not-friendly", { firstSeenAt: daysAgo(1), score: 95, firstPrFriendly: false }),
  repo("r/old-top", { score: 99 }),
  repo("r/old-mid", { score: 80 }),
  repo("r/old-unfriendly", { score: 98, firstPrFriendly: false }),
  repo("r/stale-new", { firstSeenAt: daysAgo(9), score: 85 }),
  repo("g/go-old", { language: "go", languageName: "Go", score: 75 }),
  repo("p/py-new", { language: "python", languageName: "Python", firstSeenAt: daysAgo(3), score: 65 }),
];
const CTX = { now: NOW.getTime(), bootstrapAt: Date.parse(BOOTSTRAP) };

describe("isoWeek", () => {
  it.each([
    ["2026-09-28T00:00:00Z", "2026-W40"],
    ["2026-10-04T23:59:59Z", "2026-W40"],
    ["2026-10-05T00:00:00Z", "2026-W41"],
    ["2027-01-01T00:00:00Z", "2026-W53"],
    ["2025-12-29T00:00:00Z", "2026-W01"],
  ])("%s → %s", (d, w) => expect(isoWeek(new Date(d))).toBe(w));
});

describe("selectSections", () => {
  it("puts this week's first-PR friendly repos first, then tops up by score", () => {
    const [rust] = selectSections(REPOS, ["rust"], CTX);
    expect(rust.language).toBe("rust");
    expect(rust.fresh.map((r) => r.fullName)).toEqual(["r/new-best", "r/new-ok"]);
    // Friendly repos before unfriendly ones, each by score.
    expect(rust.topUp.map((r) => r.fullName)).toEqual(["r/old-top", "r/stale-new", "r/old-mid"]);
  });

  it("uses one 'any language' section when none were picked", () => {
    const [any] = selectSections(REPOS, [], CTX);
    expect(any.language).toBeNull();
    expect(any.fresh.map((r) => r.fullName)).toEqual(["r/new-best", "r/new-ok", "p/py-new"]);
    expect(any.fresh.length + any.topUp.length).toBe(5);
  });

  it("tops up a language with nothing new, and drops languages with no repos", () => {
    const sections = selectSections(REPOS, ["go", "haskell"], CTX);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ language: "go", fresh: [] });
    expect(sections[0].topUp.map((r) => r.fullName)).toEqual(["g/go-old"]);
  });

  it("doesn't count the dataset's first run as new", () => {
    const [rust] = selectSections(REPOS, ["rust"], { ...CTX, bootstrapAt: NOW.getTime() - 3 * 86_400_000 });
    expect(rust.fresh.map((r) => r.fullName)).toEqual(["r/new-best"]);
  });
});

describe("digestEmail", () => {
  it("renders HTML and text with repo links and the unsubscribe link, escaping repo text", () => {
    const sections = selectSections(
      [...REPOS, repo("r/xss", { description: '<script>alert("x")</script>', firstSeenAt: daysAgo(1), score: 100 })],
      ["rust"],
      CTX,
    );
    const e = digestEmail({
      site: SITE,
      sections,
      unsubscribeUrl: `${SITE}/api/newsletter/unsubscribe?token=t`,
      week: "2026-W40",
    });
    expect(e.subject).toBe("3 new first-PR repos in Rust this week");
    expect(e.html).toContain("New first-PR repos in Rust this week");
    expect(e.html).toContain(`${SITE}/repo/r/new-best`);
    expect(e.html).toContain(`${SITE}/api/newsletter/unsubscribe?token=t`);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain(esc('<script>alert("x")</script>'));
    expect(e.text).toContain(`${SITE}/repo/r/new-best`);
    expect(e.text).toContain("Unsubscribe:");
  });
});

async function seed(
  db: Db,
  subs: { email: string; languages?: string[]; status?: string; week?: string | null; sentAt?: string | null }[],
) {
  await migrate(db);
  for (const s of subs) {
    await db.execute({
      sql: `INSERT INTO subscribers (email, languages, status, created_at, last_digest_week, last_sent_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        s.email,
        JSON.stringify(s.languages ?? []),
        s.status ?? "active",
        daysAgo(30),
        s.week ?? null,
        s.sentAt ?? null,
      ],
    });
  }
}

const base = (db: Db, mail: MailProvider, cap = 10) => ({
  db,
  mail,
  repos: REPOS,
  meta: { bootstrapAt: BOOTSTRAP },
  site: SITE,
  secret: SECRET,
  from: "OpenSrc <digest@opensrc.test>",
  cap,
  now: NOW,
  log: () => {},
});

describe("runDigest", () => {
  it("sends one digest per active subscriber with List-Unsubscribe headers, and marks the week", async () => {
    const db = nodeDb(":memory:");
    await seed(db, [
      { email: "a@x.co", languages: ["rust"] },
      { email: "b@x.co", languages: ["go"] },
      { email: "pending@x.co", status: "pending" },
      { email: "gone@x.co", status: "unsubscribed" },
    ]);
    const mail = new ConsoleProvider(() => {});
    const report = await runDigest(base(db, mail));
    expect(report).toMatchObject({ week: "2026-W40", sent: 2, skipped: 0, failed: 0, remaining: 0, capReached: false });
    expect(mail.outbox.map((m) => m.to)).toEqual(["a@x.co", "b@x.co"]);
    const m = mail.outbox[0];
    expect(m.replyTo).toBe("hello@opensrc.studio");
    expect(m.from).toBe("OpenSrc <digest@opensrc.test>");
    expect(m.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const url = /<(https:[^>]+)>/.exec(m.headers!["List-Unsubscribe"])![1];
    const token = new URL(url).searchParams.get("token")!;
    expect(await verifyToken(SECRET, token, "unsub", "a@x.co", NOW.getTime())).toMatchObject({
      id: peekToken(token)!.id,
    });

    // Resumable: a second run the same week sends nothing more.
    const again = await runDigest(base(db, mail));
    expect(again).toMatchObject({ sent: 0, remaining: 0, sentEarlierToday: 2 });
    expect(mail.outbox).toHaveLength(2);
  });

  it("stops at the daily cap and finishes on the next day's run", async () => {
    const db = nodeDb(":memory:");
    await seed(
      db,
      Array.from({ length: 5 }, (_, i) => ({ email: `s${i}@x.co`, languages: ["rust"] })),
    );
    const mail = new ConsoleProvider(() => {});
    const monday = await runDigest(base(db, mail, 3));
    expect(monday).toMatchObject({ sent: 3, remaining: 2, capReached: true });

    // Same day again: the cap counts earlier runs.
    const mondayAgain = await runDigest(base(db, mail, 3));
    expect(mondayAgain).toMatchObject({ sent: 0, sentEarlierToday: 3, remaining: 2, capReached: true });

    const tuesday = await runDigest({ ...base(db, mail, 3), now: new Date(NOW.getTime() + 86_400_000) });
    expect(tuesday).toMatchObject({ week: "2026-W40", sent: 2, remaining: 0, capReached: false });
    expect(new Set(mail.outbox.map((m) => m.to)).size).toBe(5);
  });

  it("sends again the next week", async () => {
    const db = nodeDb(":memory:");
    await seed(db, [{ email: "a@x.co", week: "2026-W39", sentAt: daysAgo(7) }]);
    const mail = new ConsoleProvider(() => {});
    expect((await runDigest(base(db, mail))).sent).toBe(1);
  });

  it("skips (and marks) subscribers with nothing to send", async () => {
    const db = nodeDb(":memory:");
    await seed(db, [{ email: "a@x.co", languages: ["haskell"] }]);
    const mail = new ConsoleProvider(() => {});
    expect(await runDigest(base(db, mail))).toMatchObject({ sent: 0, skipped: 1, remaining: 0 });
    expect(mail.outbox).toHaveLength(0);
  });

  it("stops on the provider's 429 and retries failed sends next run", async () => {
    const db = nodeDb(":memory:");
    await seed(db, [{ email: "a@x.co" }, { email: "b@x.co" }, { email: "c@x.co" }]);
    let n = 0;
    const flaky: MailProvider = {
      name: "flaky",
      send: async (msg) => {
        n++;
        if (msg.to === "a@x.co") throw new Error("boom");
        if (msg.to === "c@x.co") throw new MailError("daily quota", 429);
        return {};
      },
    };
    const report = await runDigest(base(db, flaky));
    expect(report).toMatchObject({ sent: 1, failed: 1, capReached: true, remaining: 2 });
    expect(n).toBe(3);
  });

  it("dry run renders previews and changes nothing", async () => {
    const db = nodeDb(":memory:");
    await seed(db, [{ email: "a@x.co", languages: ["rust"] }]);
    const mail = new ConsoleProvider(() => {});
    const report = await runDigest({ ...base(db, mail), dryRun: true });
    expect(report).toMatchObject({ dryRun: true, sent: 1 });
    expect(report.previews[0].email.subject).toContain("Rust");
    expect(mail.outbox).toHaveLength(0);
    const row = (await db.execute("SELECT last_digest_week, last_sent_at FROM subscribers")).rows[0];
    expect(row.last_digest_week).toBeNull();
    expect(row.last_sent_at).toBeNull();
  });
});

describe("digest CLI args", () => {
  it("parses flags", () => {
    expect(parseDigestArgs(["--dry-run"], "/d")).toEqual({ dryRun: true, dataDir: "/d" });
    expect(parseDigestArgs(["--preview", "rust,go", "--out=x.html"], "/d")).toMatchObject({
      preview: ["rust", "go"],
      out: "x.html",
    });
    expect(parseDigestArgs(["--preview", "any"], "/d").preview).toEqual([]);
    expect(() => parseDigestArgs(["--nope"], "/d")).toThrow(/unknown option/);
  });
});

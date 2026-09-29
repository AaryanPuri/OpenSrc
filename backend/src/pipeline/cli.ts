/**
 * Collector CLI (run from backend/):
 *
 *   npm run collect -- [--dry-run] [--limit N] [--only owner/name,…] [--languages rust,go]
 *   npm run validate-data
 *   npx tsx src/pipeline/cli.ts summary --base old-repos.json   # Markdown for the nightly PR
 *
 * The token comes from COLLECTOR_TOKEN, else GITHUB_TOKEN. A run that hits
 * the rate-limit floor exits with code 2 and writes nothing.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LANGUAGES } from "../../../shared/dictionary.js";
import type { RepoRecord } from "../../../shared/repo.js";
import { collect } from "./collect.js";
import { emptyCuration, parseCuration, type Curation } from "./curation.js";
import { GraphQLClient, RateLimitAbort } from "./graphql.js";
import { mergeDatasets } from "./merge.js";
import { summarizeChanges } from "./summary.js";
import { validateDataset } from "./validate.js";
import { readCurationText, readDataset, writeDataset } from "./write.js";

export interface CollectArgs {
  dryRun: boolean;
  limit?: number;
  only?: string[];
  languages?: string[];
  pages?: number;
  dataDir: string;
}

export interface RunDeps {
  token: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** The repo root: the nearest ancestor holding shared/, backend/ and frontend/ (backend/dist has only the first two). */
export function findRepoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    if (["shared", "backend", "frontend"].every((d) => existsSync(join(dir, d)))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("could not find the repo root (a folder with shared/, backend/ and frontend/)");
    dir = up;
  }
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function parseArgs(
  argv: string[],
  defaultDataDir: string,
): { command: string; args: CollectArgs; base?: string } {
  const [command = "collect", ...rest] = argv;
  const args: CollectArgs = { dryRun: false, dataDir: defaultDataDir };
  let base: string | undefined;
  const list = (v: string | undefined, flag: string) => {
    if (!v) throw new Error(`${flag} needs a value`);
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = rest[i].split(/=(.*)/s, 2);
    const value = () => inline ?? rest[++i];
    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--limit":
      case "--pages": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
        if (flag === "--limit") args.limit = n;
        else args.pages = n;
        break;
      }
      case "--only":
        args.only = list(value(), flag);
        for (const r of args.only) if (!REPO_RE.test(r)) throw new Error(`--only: "${r}" is not owner/name`);
        break;
      case "--languages":
        args.languages = list(value(), flag);
        for (const l of args.languages) {
          if (!LANGUAGES.some((d) => d.id === l)) {
            throw new Error(`--languages: unknown id "${l}" (known: ${LANGUAGES.map((d) => d.id).join(", ")})`);
          }
        }
        break;
      case "--data-dir":
        args.dataDir = resolve(value() ?? "");
        break;
      case "--base":
        base = value();
        break;
      default:
        throw new Error(`unknown option ${rest[i]}`);
    }
  }
  return { command, args, base };
}

async function loadCuration(dataDir: string): Promise<Curation> {
  const text = await readCurationText(dataDir);
  return text === null ? emptyCuration() : parseCuration(text);
}

export interface CollectSummary {
  written: boolean;
  count: number;
  firstPrFriendly: number;
  pointsUsed: number;
  remaining: number | null;
  dropped: number;
  missing: string[];
}

/** Collect, merge and (unless dry-run) write. Throws RateLimitAbort without writing anything. */
export async function runCollect(args: CollectArgs, deps: RunDeps): Promise<CollectSummary> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? new Date();
  const curation = await loadCuration(args.dataDir);
  const previous = await readDataset(args.dataDir);
  const client = new GraphQLClient({ token: deps.token, fetchImpl: deps.fetchImpl, log, sleep: deps.sleep });

  const result = await collect({
    client,
    now,
    curation,
    previous: previous.repos,
    languages: args.languages,
    only: args.only,
    limit: args.limit,
    maxPagesPerQuery: args.pages,
    log,
  });

  const onlySet = new Set(args.only?.map((r) => r.toLowerCase()));
  const langSet = new Set(args.languages);
  const partial = !!(args.only?.length || args.languages?.length);
  const covers = (r: RepoRecord) =>
    args.only?.length ? onlySet.has(r.fullName.toLowerCase()) : !!r.language && langSet.has(r.language);
  const merged = mergeDatasets({
    previous: previous.repos,
    previousMeta: previous.meta,
    collected: result.records,
    scope: partial ? "partial" : "full",
    covers,
    now,
    pointsUsed: client.pointsUsed,
    curation,
    // A partial run only tops up its slice, so the global cap stays the default.
    limit: partial ? undefined : args.limit,
  });

  for (const d of merged.dropped.slice(0, 20)) log(`dropped ${d.fullName}: ${d.gates.join(", ")}`);
  if (merged.dropped.length > 20) log(`…and ${merged.dropped.length - 20} more dropped`);
  if (result.missing.length) log(`not found or failed: ${result.missing.join(", ")}`);
  log(
    `${result.searched} searched, ${result.candidates} candidates, ${result.records.length} detailed → ${merged.repos.length} listed ` +
      `(${merged.meta.firstPrFriendly} first-PR friendly). ${client.pointsUsed} points used, ` +
      `${client.rateLimit?.remaining ?? "?"} left.`,
  );

  if (!args.dryRun) await writeDataset(args.dataDir, merged.repos, merged.meta);
  return {
    written: !args.dryRun,
    count: merged.repos.length,
    firstPrFriendly: merged.meta.firstPrFriendly,
    pointsUsed: client.pointsUsed,
    remaining: client.rateLimit?.remaining ?? null,
    dropped: merged.dropped.length,
    missing: result.missing,
  };
}

export async function runValidate(dataDir: string): Promise<string[]> {
  const data = await readDataset(dataDir);
  let curation: Curation;
  try {
    curation = await loadCuration(dataDir);
  } catch (err) {
    return [(err as Error).message];
  }
  return validateDataset(data.reposText, data.metaText, curation);
}

async function main(): Promise<number> {
  const { command, args, base } = parseArgs(process.argv.slice(2), join(findRepoRoot(), "data"));
  if (command === "validate") {
    const errors = await runValidate(args.dataDir);
    if (errors.length) {
      console.error(`Dataset invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
      for (const e of errors) console.error(`  - ${e}`);
      return 1;
    }
    const { meta } = await readDataset(args.dataDir);
    console.log(`Dataset OK: ${meta?.count} repos, ${meta?.firstPrFriendly} first-PR friendly.`);
    return 0;
  }
  if (command === "summary") {
    if (!base) throw new Error("summary needs --base <old repos.json>");
    const before = existsSync(base) ? (JSON.parse(await readFile(base, "utf8")) as RepoRecord[]) : [];
    const { repos, meta } = await readDataset(args.dataDir);
    process.stdout.write(summarizeChanges(before, repos, meta));
    return 0;
  }
  if (command !== "collect") throw new Error(`unknown command "${command}" (collect, validate, summary)`);

  const token = process.env.COLLECTOR_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Set COLLECTOR_TOKEN or GITHUB_TOKEN (a token with public read access is enough).");
    return 1;
  }
  try {
    await runCollect(args, { token });
    return 0;
  } catch (err) {
    if (err instanceof RateLimitAbort) {
      console.error(`Rate limit: ${err.message}. Nothing was written.`);
      return 2;
    }
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? (process.env.DEBUG ? err.stack : err.message) : err);
      process.exit(1);
    },
  );
}

/**
 * Deterministic output: repos sorted by name (case-insensitive), one compact
 * JSON object per line with a fixed key order, so nightly diffs show exactly
 * which repos changed.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatasetMeta, RepoRecord, ScoreParts } from "../../../shared/repo.js";

export const REPOS_FILE = "repos.json";
export const META_FILE = "meta.json";
export const CURATION_FILE = "curation.yml";

/** Every RepoRecord key, in output order. validate.ts checks records have exactly these. */
export const RECORD_KEYS: (keyof RepoRecord)[] = [
  "fullName",
  "owner",
  "name",
  "description",
  "homepage",
  "avatarUrl",
  "language",
  "languageName",
  "topics",
  "stars",
  "forks",
  "license",
  "archived",
  "fork",
  "mirror",
  "lastCommitAt",
  "createdAt",
  "contributingUrl",
  "hasCodeOfConduct",
  "goodFirstIssues",
  "helpWanted",
  "gfiSampled",
  "gfiUnassigned",
  "gfiUnanswered",
  "responseHours",
  "responseSampledAt",
  "fields",
  "curated",
  "firstSeenAt",
  "score",
  "scoreParts",
  "firstPrFriendly",
];

export const SCORE_PART_KEYS: (keyof ScoreParts)[] = [
  "supply",
  "activity",
  "response",
  "onboarding",
  "claimable",
  "reach",
];

export const META_KEYS: (keyof DatasetMeta)[] = [
  "version",
  "generatedAt",
  "bootstrapAt",
  "count",
  "firstPrFriendly",
  "languages",
  "fields",
  "pointsUsed",
  "scope",
];

export function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function ordered(r: RepoRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RECORD_KEYS) {
    out[k] = k === "scoreParts" ? Object.fromEntries(SCORE_PART_KEYS.map((p) => [p, r.scoreParts[p]])) : r[k];
  }
  return out;
}

export function serializeRepos(repos: RepoRecord[]): string {
  const sorted = [...repos].sort((a, b) => compareNames(a.fullName, b.fullName));
  if (!sorted.length) return "[]\n";
  return `[\n${sorted.map((r) => JSON.stringify(ordered(r))).join(",\n")}\n]\n`;
}

export function serializeMeta(meta: DatasetMeta): string {
  const out = Object.fromEntries(META_KEYS.map((k) => [k, meta[k]]));
  return `${JSON.stringify(out, null, 2)}\n`;
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

export async function writeDataset(dataDir: string, repos: RepoRecord[], meta: DatasetMeta): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeAtomic(join(dataDir, REPOS_FILE), serializeRepos(repos));
  await writeAtomic(join(dataDir, META_FILE), serializeMeta(meta));
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readDataset(
  dataDir: string,
): Promise<{ repos: RepoRecord[]; meta: DatasetMeta | null; reposText: string | null; metaText: string | null }> {
  const reposText = await readIfExists(join(dataDir, REPOS_FILE));
  const metaText = await readIfExists(join(dataDir, META_FILE));
  return {
    repos: reposText ? (JSON.parse(reposText) as RepoRecord[]) : [],
    meta: metaText ? (JSON.parse(metaText) as DatasetMeta) : null,
    reposText,
    metaText,
  };
}

export async function readCurationText(dataDir: string): Promise<string | null> {
  return readIfExists(join(dataDir, CURATION_FILE));
}

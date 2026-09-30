/**
 * Checks data/repos.json and data/meta.json before they are committed: shape,
 * formatting, uniqueness, gates, scores (recomputed at generatedAt), curation
 * and meta totals. Returns a list of problems; empty means valid.
 */
import { DOMAINS, LANGUAGES } from "../../../shared/dictionary.js";
import { isGoodFirstLabel, isHelpWantedLabel } from "../../../shared/labels.js";
import { MAX_REPOS, type DatasetMeta, type RepoRecord } from "../../../shared/repo.js";
import { scoreRepo } from "../../../shared/score.js";
import { isExcluded, isIncluded, type Curation } from "./curation.js";
import { buildMeta } from "./merge.js";
import { META_KEYS, RECORD_KEYS, SCORE_PART_KEYS, serializeMeta, serializeRepos } from "./write.js";

const LANGUAGE_IDS = new Set(LANGUAGES.map((l) => l.id));
const FIELD_IDS = new Set(DOMAINS.map((d) => d.id));
const MAX_ERRORS = 50;

type Kind = "string" | "string?" | "number" | "number?" | "boolean" | "string[]" | "object";

const TYPES: Record<keyof RepoRecord, Kind> = {
  fullName: "string",
  owner: "string",
  name: "string",
  description: "string?",
  homepage: "string?",
  avatarUrl: "string",
  language: "string?",
  languageName: "string?",
  topics: "string[]",
  stars: "number",
  forks: "number",
  license: "string?",
  archived: "boolean",
  fork: "boolean",
  mirror: "boolean",
  lastCommitAt: "string",
  createdAt: "string",
  contributingUrl: "string?",
  hasCodeOfConduct: "boolean",
  goodFirstIssues: "number",
  helpWanted: "number",
  gfiSampled: "number",
  gfiUnassigned: "number",
  gfiUnanswered: "number",
  issueLabels: "string[]",
  responseHours: "number?",
  responseSampledAt: "string?",
  fields: "string[]",
  curated: "boolean",
  firstSeenAt: "string",
  score: "number",
  scoreParts: "object",
  firstPrFriendly: "boolean",
};

function hasKind(v: unknown, kind: Kind): boolean {
  switch (kind) {
    case "string":
      return typeof v === "string";
    case "string?":
      return v === null || typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v) && v >= 0;
    case "number?":
      return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
    case "boolean":
      return typeof v === "boolean";
    case "string[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "object":
      return !!v && typeof v === "object" && !Array.isArray(v);
  }
}

const isIso = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s));

function validateRecord(r: RepoRecord, now: number, errors: string[]): void {
  const id = typeof r?.fullName === "string" ? r.fullName : JSON.stringify(r).slice(0, 60);
  const err = (msg: string): void => void errors.push(`${id}: ${msg}`);
  if (!r || typeof r !== "object") return err("not an object");

  const keys = Object.keys(r);
  const missing = RECORD_KEYS.filter((k) => !(k in r));
  const extra = keys.filter((k) => !(RECORD_KEYS as string[]).includes(k));
  if (missing.length) err(`missing ${missing.join(", ")}`);
  if (extra.length) err(`unexpected ${extra.join(", ")}`);
  for (const k of RECORD_KEYS) if (k in r && !hasKind(r[k], TYPES[k])) err(`${k} has the wrong type`);
  if (missing.length || errors.length >= MAX_ERRORS) return;

  if (r.fullName !== `${r.owner}/${r.name}`) err("fullName is not owner/name");
  for (const k of ["lastCommitAt", "createdAt", "firstSeenAt"] as const)
    if (!isIso(r[k])) err(`${k} is not an ISO date`);
  if (r.responseSampledAt !== null && !isIso(r.responseSampledAt)) err("responseSampledAt is not an ISO date");
  if (r.language !== null && !LANGUAGE_IDS.has(r.language)) err(`unknown language ${r.language}`);
  if (r.fields.length > 3) err("more than 3 fields");
  const badFields = r.fields.filter((f) => !FIELD_IDS.has(f));
  if (badFields.length) err(`unknown field(s) ${badFields.join(", ")}`);
  if (new Set(r.fields).size !== r.fields.length) err("duplicate fields");
  if (r.gfiUnassigned > r.gfiSampled || r.gfiUnanswered > r.gfiSampled) err("sample counts exceed gfiSampled");
  if (r.gfiSampled > r.goodFirstIssues) err("gfiSampled exceeds goodFirstIssues");
  const unknownLabels = r.issueLabels.filter((l) => !isGoodFirstLabel(l) && !isHelpWantedLabel(l));
  if (unknownLabels.length) err(`issueLabels has unknown label(s) ${unknownLabels.join(", ")}`);
  if (!Number.isInteger(r.score) || r.score > 100) err(`score ${r.score} is not an integer 0–100`);

  const partKeys = Object.keys(r.scoreParts);
  if (
    partKeys.length !== SCORE_PART_KEYS.length ||
    !SCORE_PART_KEYS.every((k) => typeof r.scoreParts[k] === "number")
  ) {
    return err("scoreParts has the wrong shape");
  }
  const s = scoreRepo(r, now);
  if (s.failedGates.length) err(`fails gate(s): ${s.failedGates.join(", ")}`);
  if (s.score !== r.score) err(`score ${r.score} but recomputes to ${s.score}`);
  if (SCORE_PART_KEYS.some((k) => s.parts[k] !== r.scoreParts[k])) err("scoreParts don't match a recomputation");
  if (s.firstPrFriendly !== r.firstPrFriendly) err(`firstPrFriendly should be ${s.firstPrFriendly}`);
}

export function validateDataset(reposText: string | null, metaText: string | null, curation: Curation): string[] {
  const errors: string[] = [];
  if (reposText === null) return ["data/repos.json is missing"];
  if (metaText === null) return ["data/meta.json is missing"];

  let repos: RepoRecord[];
  let meta: DatasetMeta;
  try {
    repos = JSON.parse(reposText) as RepoRecord[];
  } catch (e) {
    return [`data/repos.json is not valid JSON: ${(e as Error).message}`];
  }
  try {
    meta = JSON.parse(metaText) as DatasetMeta;
  } catch (e) {
    return [`data/meta.json is not valid JSON: ${(e as Error).message}`];
  }
  if (!Array.isArray(repos)) return ["data/repos.json must be an array"];
  if (!meta || typeof meta !== "object") return ["data/meta.json must be an object"];

  const metaMissing = META_KEYS.filter((k) => !(k in meta));
  if (metaMissing.length) return [`meta.json is missing ${metaMissing.join(", ")}`];
  if (meta.version !== 1) errors.push(`meta.version ${meta.version} is not supported`);
  if (!isIso(meta.generatedAt)) return ["meta.generatedAt is not an ISO date"];
  if (!isIso(meta.bootstrapAt)) errors.push("meta.bootstrapAt is not an ISO date");
  const now = Date.parse(meta.generatedAt);

  const seen = new Set<string>();
  for (const r of repos) {
    if (errors.length >= MAX_ERRORS) break;
    validateRecord(r, now, errors);
    const k = String(r?.fullName).toLowerCase();
    if (seen.has(k)) errors.push(`${r.fullName}: listed twice`);
    seen.add(k);
    if (typeof r?.fullName === "string") {
      if (isExcluded(curation, r.fullName)) errors.push(`${r.fullName}: excluded in curation.yml but listed`);
      if (r.curated !== isIncluded(curation, r.fullName))
        errors.push(`${r.fullName}: curated flag disagrees with curation.yml`);
    }
  }
  if (errors.length) return errors.slice(0, MAX_ERRORS);

  const auto = repos.filter((r) => !r.curated).length;
  if (auto > MAX_REPOS) errors.push(`${auto} non-curated repos, more than the ${MAX_REPOS} cap`);
  if (serializeRepos(repos) !== reposText) {
    errors.push("data/repos.json isn't in canonical form (sorted by name, one repo per line); rerun the collector");
  }
  const expected = buildMeta(repos, meta);
  if (serializeMeta(expected) !== metaText) {
    errors.push("data/meta.json totals or formatting don't match data/repos.json");
  }
  return errors;
}

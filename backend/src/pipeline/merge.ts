/**
 * Folds a run's freshly collected records into the previous dataset:
 * keeps firstSeenAt, reuses response-time samples younger than a week,
 * applies curation, re-scores everything at `now`, drops repos that fail a
 * gate, caps the list and builds meta.json.
 */
import { MAX_REPOS, type DatasetMeta, type RepoRecord } from "../../../shared/repo.js";
import { scoreRepo, type Gate } from "../../../shared/score.js";
import { fieldOverride, isExcluded, isIncluded, type Curation } from "./curation.js";

export const RESPONSE_MAX_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Whether a repo's response time should be (re-)sampled on this run. */
export function needsResponseSample(prev: Pick<RepoRecord, "responseSampledAt"> | undefined, now: number): boolean {
  if (!prev?.responseSampledAt) return true;
  const t = Date.parse(prev.responseSampledAt);
  return !Number.isFinite(t) || now - t >= RESPONSE_MAX_AGE_DAYS * DAY_MS;
}

export interface MergeInput {
  previous: RepoRecord[];
  previousMeta: DatasetMeta | null;
  /** This run's records (score fields are recomputed here). */
  collected: RepoRecord[];
  /**
   * "full": the run covered everything, so previous repos it didn't collect are removed.
   * "partial": only previous repos for which `covers` is true are replaced or removed.
   */
  scope: "full" | "partial";
  covers?: (repo: RepoRecord) => boolean;
  now: Date;
  pointsUsed: number;
  curation: Curation;
  /** Cap on non-curated repos (default MAX_REPOS). */
  limit?: number;
}

export interface MergeResult {
  repos: RepoRecord[];
  meta: DatasetMeta;
  /** Repos collected (or carried over) that failed a gate. */
  dropped: { fullName: string; gates: Gate[] }[];
}

export function withScore(r: RepoRecord, now: number): { record: RepoRecord; gates: Gate[] } {
  const s = scoreRepo(r, now);
  return {
    record: { ...r, score: s.score, scoreParts: s.parts, firstPrFriendly: s.firstPrFriendly },
    gates: s.failedGates,
  };
}

const key = (fullName: string) => fullName.toLowerCase();

/** A timestamp from the future (a skewed committer clock) is clamped to the collection time. */
export const notAfter = (iso: string, nowMs: number, nowIso: string) => (Date.parse(iso) > nowMs ? nowIso : iso);

export function mergeDatasets(input: MergeInput): MergeResult {
  const nowMs = input.now.getTime();
  const nowIso = input.now.toISOString();
  const prevByName = new Map(input.previous.map((r) => [key(r.fullName), r]));

  const merged = new Map<string, RepoRecord>();
  if (input.scope === "partial") {
    const covers = input.covers ?? (() => false);
    for (const r of input.previous) if (!covers(r)) merged.set(key(r.fullName), r);
  }
  for (const fresh of input.collected) {
    const prev = prevByName.get(key(fresh.fullName));
    const r: RepoRecord = {
      ...fresh,
      // Commit dates come from the committer's clock, which can be ahead of ours.
      lastCommitAt: notAfter(fresh.lastCommitAt, nowMs, nowIso),
      createdAt: notAfter(fresh.createdAt, nowMs, nowIso),
      firstSeenAt: prev?.firstSeenAt ?? nowIso,
    };
    if (!r.responseSampledAt && prev && !needsResponseSample(prev, nowMs)) {
      r.responseHours = prev.responseHours;
      r.responseSampledAt = prev.responseSampledAt;
    }
    merged.set(key(r.fullName), r);
  }

  const dropped: MergeResult["dropped"] = [];
  const kept: RepoRecord[] = [];
  for (const r of merged.values()) {
    if (isExcluded(input.curation, r.fullName)) continue;
    const curated = isIncluded(input.curation, r.fullName);
    const fields = fieldOverride(input.curation, r.fullName) ?? r.fields;
    const { record, gates } = withScore({ ...r, curated, fields }, nowMs);
    if (gates.length) dropped.push({ fullName: r.fullName, gates });
    else kept.push(record);
  }

  // Cap the automatic listings by score; curated repos always stay.
  const limit = input.limit ?? MAX_REPOS;
  const auto = kept
    .filter((r) => !r.curated)
    .sort((a, b) => b.score - a.score || b.stars - a.stars || (key(a.fullName) < key(b.fullName) ? -1 : 1));
  const repos = [...kept.filter((r) => r.curated), ...auto.slice(0, limit)];

  const bootstrapAt =
    input.previousMeta?.bootstrapAt ??
    (input.previous.length ? input.previous.map((r) => r.firstSeenAt).sort()[0] : nowIso);

  return {
    repos,
    meta: buildMeta(repos, { generatedAt: nowIso, bootstrapAt, pointsUsed: input.pointsUsed, scope: input.scope }),
    dropped,
  };
}

export function buildMeta(
  repos: RepoRecord[],
  m: Pick<DatasetMeta, "generatedAt" | "bootstrapAt" | "pointsUsed" | "scope">,
): DatasetMeta {
  const languages: Record<string, number> = {};
  const fields: Record<string, number> = {};
  for (const r of repos) {
    const lang = r.language ?? "other";
    languages[lang] = (languages[lang] ?? 0) + 1;
    for (const f of r.fields) fields[f] = (fields[f] ?? 0) + 1;
  }
  return {
    version: 1,
    generatedAt: m.generatedAt,
    bootstrapAt: m.bootstrapAt,
    count: repos.length,
    firstPrFriendly: repos.filter((r) => r.firstPrFriendly).length,
    languages: sortedCounts(languages),
    fields: sortedCounts(fields),
    pointsUsed: m.pointsUsed,
    scope: m.scope,
  };
}

/** Largest first, then by id, so meta.json diffs stay small. */
function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

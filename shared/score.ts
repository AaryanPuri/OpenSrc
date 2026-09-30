/**
 * Repo score (0–100): hard gates, then six weighted parts. Pure: the caller
 * passes `now` (the collector uses the dataset's generatedAt), so the browser,
 * the pre-renderer and the collector always agree.
 */
import type { RepoRecord, ScoreParts } from './repo.js';

export const SCORE_WEIGHTS: ScoreParts = {
  supply: 30,
  activity: 15,
  response: 20,
  onboarding: 10,
  claimable: 15,
  reach: 10,
};

export const MIN_STARS = 30;
export const MAX_IDLE_DAYS = 180;
export const MIN_OPEN_ISSUES = 2;
export const FIRST_PR_MIN_SCORE = 70;
/** Most good-first-issues' worth that help-wanted issues can add to supply. */
export const HELP_WANTED_CAP = 3;
/** Supply earns full marks at this many claimable good-first-issues. */
export const SUPPLY_FULL_AT = 50;
/** Unclaimed (unassigned) good first issues needed to be first-PR friendly. */
export const FIRST_PR_MIN_GFI = 3;
/** Response points when there's too little data to measure (a bit under half: unproven). */
export const UNKNOWN_RESPONSE = 0.4;
export const FIRST_PR_MAX_RESPONSE_HOURS = 72;

export type Gate = 'archived' | 'fork' | 'mirror' | 'license' | 'stale' | 'issues' | 'stars';

export const GATE_LABELS: Record<Gate, string> = {
  archived: 'Archived',
  fork: 'A fork',
  mirror: 'A mirror',
  license: 'No license',
  stale: `No commit in ${MAX_IDLE_DAYS} days`,
  issues: `Fewer than ${MIN_OPEN_ISSUES} open good first issues or issues open to contributors`,
  stars: `Fewer than ${MIN_STARS} stars`,
};

/** The record fields the score reads. */
export type ScoreInput = Pick<
  RepoRecord,
  | 'archived'
  | 'fork'
  | 'mirror'
  | 'license'
  | 'lastCommitAt'
  | 'goodFirstIssues'
  | 'helpWanted'
  | 'gfiSampled'
  | 'gfiUnassigned'
  | 'responseHours'
  | 'contributingUrl'
  | 'hasCodeOfConduct'
  | 'description'
  | 'stars'
  | 'curated'
>;

export interface ScoreResult {
  /** Passes every hard gate. */
  eligible: boolean;
  failedGates: Gate[];
  /** 0–100, the rounded sum of `parts` (computed even when not eligible). */
  score: number;
  /** Points per part, one decimal. */
  parts: ScoreParts;
  firstPrFriendly: boolean;
}

const DAY_MS = 86_400_000;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

export function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : Infinity;
}

/**
 * Open good-first-issues nobody has claimed yet: the count, scaled by the
 * unassigned share of the sampled newest ones.
 */
export function claimableGfi(r: Pick<ScoreInput, 'goodFirstIssues' | 'gfiSampled' | 'gfiUnassigned'>): number {
  return r.gfiSampled > 0
    ? Math.round((r.goodFirstIssues * Math.min(r.gfiUnassigned, r.gfiSampled)) / r.gfiSampled)
    : 0;
}

export function scoreGates(r: ScoreInput, now: number): Gate[] {
  const failed: Gate[] = [];
  if (r.archived) failed.push('archived');
  if (r.fork) failed.push('fork');
  if (r.mirror) failed.push('mirror');
  if (!r.license) failed.push('license');
  if (daysSince(r.lastCommitAt, now) > MAX_IDLE_DAYS) failed.push('stale');
  if (r.goodFirstIssues + r.helpWanted < MIN_OPEN_ISSUES) failed.push('issues');
  if (r.stars < MIN_STARS && !r.curated) failed.push('stars');
  return failed;
}

/** Each part as a 0–1 fraction of its weight. */
export function scoreFractions(r: ScoreInput, now: number): ScoreParts {
  // Supply: claimable (unassigned) good-first-issues on a log scale, full marks at 50, so a
  // big backlog that is mostly claimed doesn't count. Help-wanted issues count a quarter each,
  // worth at most 3 good-first-issues, so they can't carry a repo on their own.
  const supply = clamp01(
    Math.log1p(claimableGfi(r) + Math.min(0.25 * r.helpWanted, HELP_WANTED_CAP)) / Math.log1p(SUPPLY_FULL_AT),
  );
  // Activity: decays with a 45-day time constant since the last commit.
  const activity = clamp01(Math.exp(-daysSince(r.lastCommitAt, now) / 45));
  // Response: full marks within a day, zero at 30 days (log scale); unknown is a little under half.
  const h = r.responseHours;
  const response = h === null ? UNKNOWN_RESPONSE : h <= 24 ? 1 : clamp01(1 - Math.log(h / 24) / Math.log(30));
  // Onboarding: CONTRIBUTING matters most, then a code of conduct and a real description.
  const onboarding =
    (r.contributingUrl ? 0.6 : 0) +
    (r.hasCodeOfConduct ? 0.25 : 0) +
    ((r.description ?? '').trim().length >= 10 ? 0.15 : 0);
  // Claimable: share of the sampled good-first-issues nobody is assigned to.
  const claimable = r.gfiSampled > 0 ? clamp01(r.gfiUnassigned / r.gfiSampled) : 0;
  // Reach: stars on a log scale from the 30-star floor to 100k, so size helps but never dominates.
  const reach = clamp01(
    (Math.log10(Math.max(1, r.stars)) - Math.log10(MIN_STARS)) / (Math.log10(100_000) - Math.log10(MIN_STARS)),
  );
  return { supply, activity, response, onboarding: clamp01(onboarding), claimable, reach };
}

export function scoreRepo(r: ScoreInput, now: number): ScoreResult {
  const failedGates = scoreGates(r, now);
  const f = scoreFractions(r, now);
  const parts = Object.fromEntries(
    (Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]).map((k) => [k, round1(f[k] * SCORE_WEIGHTS[k])]),
  ) as unknown as ScoreParts;
  const score = Math.min(100, Math.round(Object.values(parts).reduce((a, b) => a + b, 0)));
  const eligible = failedGates.length === 0;
  const firstPrFriendly =
    eligible &&
    score >= FIRST_PR_MIN_SCORE &&
    claimableGfi(r) >= FIRST_PR_MIN_GFI &&
    !!r.contributingUrl &&
    (r.responseHours === null || r.responseHours <= FIRST_PR_MAX_RESPONSE_HOURS);
  return { eligible, failedGates, score, parts, firstPrFriendly };
}

/**
 * "Why this score": one plain-language line per score part, in the tone of
 * fit.ts ("12 open good first issues", "last commit 3 days ago").
 */
import type { RepoRecord, ScoreParts } from '../../../shared/repo';
import {
  FIRST_PR_MAX_RESPONSE_HOURS,
  FIRST_PR_MIN_GFI,
  FIRST_PR_MIN_SCORE,
  SCORE_WEIGHTS,
  claimableGfi,
  scoreRepo,
  GATE_LABELS,
} from '../../../shared/score';
import { compactNumber, plural, replyTime, timeAgo } from './format';

export interface ScoreLine {
  part: keyof ScoreParts;
  title: string;
  points: number;
  weight: number;
  reason: string;
}

const TITLES: Record<keyof ScoreParts, string> = {
  supply: 'Issues to pick from',
  activity: 'Recent activity',
  response: 'Maintainer replies',
  onboarding: 'Onboarding',
  claimable: 'Up for grabs',
  reach: 'Reach',
};

export function scoreLines(r: RepoRecord, now: number): ScoreLine[] {
  // Parts are re-derived so they always match this record (the compact index doesn't carry them).
  const { parts } = scoreRepo(r, now);
  const reason: Record<keyof ScoreParts, string> = {
    supply:
      r.goodFirstIssues === 0
        ? `no open good first issues${r.helpWanted ? `, ${plural(r.helpWanted, 'help-wanted issue')}` : ''}`
        : `${plural(claimableGfi(r), 'unclaimed good first issue')} of ${r.goodFirstIssues} open${r.helpWanted ? `, and ${r.helpWanted} help wanted` : ''}`,
    activity: r.lastCommitAt ? `last commit ${timeAgo(r.lastCommitAt, now)}` : 'last commit unknown',
    response:
      r.responseHours === null
        ? 'reply time not measured yet, so it counts a little under half'
        : `maintainers usually reply in ${replyTime(r.responseHours)}`,
    onboarding: [
      r.contributingUrl ? 'a CONTRIBUTING guide' : 'no CONTRIBUTING guide',
      r.hasCodeOfConduct ? 'a code of conduct' : null,
      (r.description ?? '').trim().length >= 10 ? 'a clear description' : 'barely a description',
    ]
      .filter(Boolean)
      .join(', ')
      .replace(/, ([^,]*)$/, ' and $1'),
    claimable:
      r.gfiSampled > 0
        ? `${r.gfiUnassigned} of the ${r.gfiSampled} newest good first issues are unassigned`
        : 'no good first issues to check',
    reach: `${compactNumber(r.stars)} stars, so your work gets seen`,
  };
  return (Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]).map((part) => ({
    part,
    title: TITLES[part],
    points: parts[part],
    weight: SCORE_WEIGHTS[part],
    reason: capitalise(reason[part]),
  }));
}

/** Why the repo is (or isn't) first-PR friendly, as checks. */
export function firstPrChecks(r: RepoRecord): { ok: boolean; text: string }[] {
  return [
    { ok: r.score >= FIRST_PR_MIN_SCORE, text: `Score of ${FIRST_PR_MIN_SCORE} or more` },
    { ok: claimableGfi(r) >= FIRST_PR_MIN_GFI, text: `At least ${FIRST_PR_MIN_GFI} unclaimed good first issues` },
    { ok: !!r.contributingUrl, text: 'A CONTRIBUTING guide' },
    {
      ok: r.responseHours === null || r.responseHours <= FIRST_PR_MAX_RESPONSE_HOURS,
      text: `Replies within ${FIRST_PR_MAX_RESPONSE_HOURS / 24} days`,
    },
  ];
}

/** Hard gates the repo fails right now (normally none: failing repos aren't listed). */
export function failedGateLabels(r: RepoRecord, now: number): string[] {
  return scoreRepo(r, now).failedGates.map((g) => GATE_LABELS[g]);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

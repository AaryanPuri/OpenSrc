/**
 * Issue label spellings that count as "good first issue" and "help wanted".
 * The collector counts them per repo (issue `labels:` filters are OR-ed and
 * case-insensitive, so each list holds distinct spellings only), and the repo
 * page searches for the ones a repo actually uses (RepoRecord.issueLabels).
 *
 * Checked against real repos: rust-lang/* use `E-easy` / `E-mentor` and
 * `E-help-wanted` (tokio), bevy uses `D-Trivial`, numpy `sprintable`,
 * freeCodeCamp `first timers only`, vite `contribution welcome`.
 */

export const GOOD_FIRST_LABELS = [
  'good first issue',
  'good-first-issue',
  'good first issues',
  'good first bug',
  'good first contribution',
  'good-first-contribution',
  'first-timers-only',
  'first timers only',
  'first-timer',
  'beginner',
  'beginner friendly',
  'beginner-friendly',
  'easy',
  'E-easy',
  'E-mentor',
  'D-Trivial',
  'D-Good-First-Issue',
  'good first issue :baby:',
  'starter',
  'newcomer',
  'sprintable',
  'status: good first issue',
  'difficulty: easy',
];

export const HELP_WANTED_LABELS = [
  'help wanted',
  'help-wanted',
  'E-help-wanted',
  'status: help wanted',
  'help needed',
  'contributions welcome',
  'contribution welcome',
  'PRs welcome',
  'up-for-grabs',
  'up for grabs',
];

const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
const GOOD_FIRST_SET = lower(GOOD_FIRST_LABELS);
const HELP_WANTED_SET = lower(HELP_WANTED_LABELS);

export const isGoodFirstLabel = (name: string) => GOOD_FIRST_SET.has(name.trim().toLowerCase());
export const isHelpWantedLabel = (name: string) => HELP_WANTED_SET.has(name.trim().toLowerCase());

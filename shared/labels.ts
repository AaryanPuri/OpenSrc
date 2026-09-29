/**
 * Issue label spellings that count as "good first issue" and "help wanted".
 * The collector counts them per repo (issue `labels:` filters are OR-ed and
 * case-insensitive, so each list holds distinct spellings only), and the repo
 * page searches for the same ones.
 */

export const GOOD_FIRST_LABELS = [
  'good first issue',
  'good-first-issue',
  'good first issues',
  'good first bug',
  'good first contribution',
  'first-timers-only',
  'beginner',
  'beginner friendly',
  'beginner-friendly',
  'easy',
  'E-easy',
  'starter',
  'newcomer',
  'status: good first issue',
  'difficulty: easy',
];

export const HELP_WANTED_LABELS = [
  'help wanted',
  'help-wanted',
  'status: help wanted',
  'help needed',
  'contributions welcome',
  'PRs welcome',
  'up-for-grabs',
  'up for grabs',
];

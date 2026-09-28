import { DOMAINS, LANGUAGES } from './dictionary';
import type { ParsedQuery } from './parseQuery';
import type { Issue } from './types';
import { plural } from './format';

const BEGINNER_RE = /good.?first|junior|beginner|easy|starter|first.?timer|straightforward/i;
const HELP_RE = /help.?wanted|up.?for.?grabs|contributions?.?welcome/i;
const DOCS_RE = /doc|typo|readme|example/i;
const TEST_RE = /\btests?\b|testing|coverage/i;
const BUG_RE = /\bbug|regression|crash/i;

const DAY = 86_400_000;

/**
 * A short, human reason list for "why this issue fits you", built from what
 * the user asked for (parsed filters) and what the issue signals (labels,
 * age, discussion). Returns 1–3 fragments, most relevant first.
 */
export function whyItFits(issue: Issue, parsed: ParsedQuery | null, now = Date.now()): string[] {
  const reasons: string[] = [];
  const names = issue.labels.map((l) => l.name);
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const text = `${issue.title} ${issue.body} ${(issue.repo.topics ?? []).join(' ')}`.toLowerCase();

  // What you asked for, confirmed.
  const langLabel =
    issue.repo.language ??
    (parsed?.languages.length === 1 ? LANGUAGES.find((l) => l.id === parsed.languages[0])?.label : null);
  const langWanted = parsed?.languages.length
    ? parsed.languages.some(
        (id) => LANGUAGES.find((l) => l.id === id)?.label.toLowerCase() === langLabel?.toLowerCase(),
      )
    : false;

  if (has(BEGINNER_RE))
    reasons.push(langWanted && langLabel ? `good first issue in ${langLabel}` : 'marked as a good first issue');
  else if (has(HELP_RE))
    reasons.push(langWanted && langLabel ? `maintainers want help, in ${langLabel}` : 'maintainers asked for help');
  else if (langWanted && langLabel) reasons.push(`written in ${langLabel}`);

  const domain = parsed?.domains.find((d) => {
    const def = DOMAINS.find((x) => x.id === d.id);
    const words = [d.term.replace(/"/g, ''), ...(def?.topics ?? []).map((t) => t.replace(/-/g, ' '))];
    return words.some((w) => w && text.includes(w.toLowerCase().replace(/s$/, '')));
  });
  if (domain) reasons.push(`touches ${domain.label.replace(/ & .*/, '').toLowerCase()}`);

  // Size of the change.
  if (has(DOCS_RE)) reasons.push('a docs-sized change');
  else if (has(TEST_RE)) reasons.push('adds tests, a gentle way in');
  else if (has(BUG_RE) && parsed?.types.includes('bug')) reasons.push('a focused bug fix');

  // Social signals.
  if (issue.comments === 0) reasons.push('no one has replied yet');
  else if (issue.comments <= 3) reasons.push(`quiet thread (${plural(issue.comments, 'comment')})`);

  const age = now - Date.parse(issue.createdAt);
  if (age <= 14 * DAY) reasons.push('freshly opened');

  if (!reasons.length) {
    if (now - Date.parse(issue.updatedAt) <= 30 * DAY) reasons.push('recently active');
    else reasons.push('open and unassigned');
  }
  return reasons.slice(0, 3);
}

/** "Good first issue in Rust · quiet thread (2 comments)". */
export function whyItFitsText(issue: Issue, parsed: ParsedQuery | null, now = Date.now()): string {
  const r = whyItFits(issue, parsed, now);
  const s = r.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The rules parser and GitHub query builder, shared by the frontend and the
 * API server so both always read a query the same way.
 */
import {
  DIFFICULTIES,
  DOMAINS,
  ISSUE_TYPES,
  LANGUAGES,
  STOPWORDS,
  type DomainDef,
  type LanguageDef,
} from './dictionary.js';
import type { Difficulty, DomainMatch, IssueType, ParsedQuery, Since } from './types.js';

export const SINCE_DAYS: Record<Since, number> = { week: 7, month: 30, year: 365 };
const SINCE_TEXT: Record<Since, string> = { week: 'this week', month: 'this month', year: 'this year' };

/** Largest comment ceiling the parser (and so a round-trip) understands. */
export const MAX_COMMENTS = 999;

type Entry =
  | { kind: 'language'; def: LanguageDef }
  | { kind: 'domain'; def: DomainDef }
  | { kind: 'difficulty'; id: Difficulty }
  | { kind: 'type'; id: IssueType };

/* ------------------------------------------------------------------ */
/* Lexicon                                                             */
/* ------------------------------------------------------------------ */

const PRESERVED = new Set(['.net', 'node.js', 'vue.js', 'c++', 'c#']);

const LEXICON = new Map<string, Entry>();
let MAX_PHRASE = 1;

function register(phrase: string, entry: Entry) {
  const key = normalise(phrase).join(' ');
  if (!key) return;
  if (!LEXICON.has(key)) LEXICON.set(key, entry);
  MAX_PHRASE = Math.max(MAX_PHRASE, key.split(' ').length);
}

/** Exposed for tests: detects accidental duplicates across dictionaries. */
export function lexiconConflicts(): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  const add = (phrase: string, owner: string) => {
    const key = normalise(phrase).join(' ');
    const prev = seen.get(key);
    if (prev && prev !== owner) conflicts.push(`${key}: ${prev} vs ${owner}`);
    seen.set(key, owner);
  };
  LANGUAGES.forEach((l) => l.aliases.forEach((a) => add(a, `language:${l.id}`)));
  DOMAINS.forEach((d) => d.synonyms.forEach((s) => add(s, `domain:${d.id}`)));
  (Object.keys(DIFFICULTIES) as Difficulty[]).forEach((k) =>
    DIFFICULTIES[k].synonyms.forEach((s) => add(s, `difficulty:${k}`)),
  );
  (Object.keys(ISSUE_TYPES) as IssueType[]).forEach((k) => ISSUE_TYPES[k].synonyms.forEach((s) => add(s, `type:${k}`)));
  return conflicts;
}

// Order matters only for conflicts; difficulty/type phrases are registered
// first so e.g. "good first issue" is never swallowed by anything else.
(Object.keys(DIFFICULTIES) as Difficulty[]).forEach((id) =>
  DIFFICULTIES[id].synonyms.forEach((s) => register(s, { kind: 'difficulty', id })),
);
(Object.keys(ISSUE_TYPES) as IssueType[]).forEach((id) =>
  ISSUE_TYPES[id].synonyms.forEach((s) => register(s, { kind: 'type', id })),
);
LANGUAGES.forEach((def) => def.aliases.forEach((a) => register(a, { kind: 'language', def })));
DOMAINS.forEach((def) => def.synonyms.forEach((s) => register(s, { kind: 'domain', def })));

/** Lower-case, split into tokens, normalising separators. Keeps `c++`, `c#`, `.net`, `node.js`. */
export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[_\-/,;!?()[\]{}"`|]+/g, ' ')
    .replace(/'s\b/g, '')
    .replace(/'/g, '')
    .split(/\s+/)
    .map((t) => {
      // Trailing punctuation first, so "…in .NET." still keeps its leading dot.
      const trimmed = t.replace(/[.:]+$/g, '');
      return PRESERVED.has(trimmed) ? trimmed : trimmed.replace(/^[.:]+/g, '');
    })
    .filter(Boolean);
}

function singular(token: string): string {
  if (token.length <= 3 || PRESERVED.has(token)) return token;
  if (token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) return token.slice(0, -1);
  return token;
}

function lookup(tokens: string[]): Entry | undefined {
  const key = tokens.join(' ');
  return LEXICON.get(key) ?? LEXICON.get(tokens.map(singular).join(' '));
}

function isStopword(tok: string): boolean {
  return STOPWORDS.has(tok) || STOPWORDS.has(singular(tok));
}

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

const QUALIFIER_RE = /\b([a-z]+):("[^"]*"|[^\s"]+)/gi;
const QUOTED_RE = /"([^"]+)"/g;
const KNOWN_QUALIFIERS = new Set([
  'repo',
  'org',
  'user',
  'label',
  'language',
  'is',
  'no',
  'in',
  'author',
  'comments',
  'created',
  'updated',
  'archived',
  'reactions',
  'interactions',
  'milestone',
  'state',
  'sort',
  'involves',
  'mentions',
  'assignee',
]);

export function emptyQuery(raw = ''): ParsedQuery {
  return {
    raw,
    languages: [],
    domains: [],
    difficulty: null,
    types: [],
    keywords: [],
    qualifiers: [],
    maxComments: null,
    since: null,
  };
}

export function parseQuery(input: string): ParsedQuery {
  const result = emptyQuery(input);
  let text = input;

  // 1. Power-user GitHub qualifiers pass through untouched.
  text = text.replace(QUALIFIER_RE, (whole, key: string, value: string) => {
    if (!KNOWN_QUALIFIERS.has(key.toLowerCase())) return whole;
    const q = `${key.toLowerCase()}:${value}`;
    if (!result.qualifiers.includes(q)) result.qualifiers.push(q);
    return ' ';
  });

  // 2. Quoted phrases become exact keywords.
  text = text.replace(QUOTED_RE, (_, phrase: string) => {
    const p = normalise(phrase).join(' ');
    if (p && !result.keywords.includes(p)) result.keywords.push(p);
    return ' ';
  });

  // 3. Activity phrases: comment ceilings and recency windows.
  text = extractActivity(text, result);

  // 4. Greedy longest-phrase match over the remaining tokens.
  const tokens = normalise(text);
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      const entry = lookup(span);
      if (!entry) continue;
      apply(result, entry, span.join(' '));
      i += n;
      matched = true;
      break;
    }
    if (matched) continue;
    const tok = tokens[i];
    const noise = isStopword(tok) || !/[a-z0-9]/.test(tok);
    if (!noise && !result.keywords.includes(tok)) {
      result.keywords.push(tok);
    }
    i++;
  }
  return result;
}

const NUM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  a: 1,
  few: 3,
};
const NUM = String.raw`(\d{1,3}|${Object.keys(NUM_WORDS).join('|')})`;
const COMMENT_CEILING_RE = new RegExp(
  String.raw`\b(?:with\s+|having\s+)?(?:less|fewer)\s+than\s+(?:a\s+)?${NUM}\s+(?:comments?|replies|responses)\b|\b(?:under|below|<)\s*${NUM}\s+(?:comments?|replies|responses)\b`,
  'gi',
);
const NO_COMMENTS_RE =
  /\b(?:with\s+)?(?:no|zero|0)\s+(?:comments?|replies|responses|discussion)(?:\s+yet)?\b|\b(?:unanswered|uncommented|untouched|no\s+one\s+has\s+replied)\b/gi;
const SINCE_RE =
  /\b(?:(?:from|in|during|over)\s+)?(?:this|the\s+last|last|the\s+past|past)\s+(week|month|year)\b|\b(?:recent|recently|lately|fresh|brand\s+new)\b|\b(?:today|yesterday)\b/gi;

function toNumber(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : (NUM_WORDS[s.toLowerCase()] ?? 0);
}

/** Pull "fewer than 5 comments", "no comments", "this week"… out of the text. */
function extractActivity(text: string, result: ParsedQuery): string {
  text = text.replace(COMMENT_CEILING_RE, (_, a?: string, b?: string) => {
    const n = toNumber(a ?? b ?? '0');
    if (n > 0 && result.maxComments === null) result.maxComments = n;
    return ' ';
  });
  text = text.replace(NO_COMMENTS_RE, () => {
    if (result.maxComments === null) result.maxComments = 0;
    return ' ';
  });
  text = text.replace(SINCE_RE, (whole: string, unit?: string) => {
    const w = whole.toLowerCase();
    const since: Since = unit ? (unit.toLowerCase() as Since) : /today|yesterday/.test(w) ? 'week' : 'month';
    if (!result.since) result.since = since;
    return ' ';
  });
  return text;
}

function apply(result: ParsedQuery, entry: Entry, phrase: string) {
  switch (entry.kind) {
    case 'language':
      if (!result.languages.includes(entry.def.id)) result.languages.push(entry.def.id);
      break;
    case 'domain': {
      if (result.domains.some((d) => d.id === entry.def.id)) break;
      result.domains.push(makeDomainMatch(entry.def, phrase));
      break;
    }
    case 'difficulty':
      // First mention wins: "beginner, maybe help wanted" stays beginner.
      if (!result.difficulty) result.difficulty = entry.id;
      break;
    case 'type':
      if (!result.types.includes(entry.id)) result.types.push(entry.id);
      break;
  }
}

/**
 * Domains named in already-normalised tokens (see `normalise`), using the same
 * greedy longest-phrase match as parseQuery. Phrases that belong to a language,
 * difficulty or issue type are consumed without producing a domain, exactly as
 * in a query. Used to classify repos from their descriptions and topics.
 */
export function matchDomains(tokens: string[]): DomainMatch[] {
  const found: DomainMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    let step = 1;
    for (let n = Math.min(MAX_PHRASE, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      const entry = lookup(span);
      if (!entry) continue;
      if (entry.kind === 'domain' && !found.some((d) => d.id === entry.def.id)) {
        found.push(makeDomainMatch(entry.def, span.join(' ')));
      }
      step = n;
      break;
    }
    i += step;
  }
  return found;
}

export function makeDomainMatch(def: DomainDef, phrase: string): DomainMatch {
  const specific = def.specific?.find((s) => s === phrase || s === normalise(phrase).map(singular).join(' '));
  const term = specific ? (specific.includes(' ') ? `"${specific}"` : specific) : def.term;
  return { id: def.id, label: def.label, matched: phrase, term, topics: def.topics };
}

/** The canonical DomainMatch for a domain id (as if its first synonym was typed), or undefined. */
export function domainMatchById(id: string): DomainMatch | undefined {
  const def = DOMAINS.find((d) => d.id === id);
  return def ? makeDomainMatch(def, def.synonyms[0]) : undefined;
}

export function languageById(id: string): LanguageDef | undefined {
  return LANGUAGES.find((l) => l.id === id);
}

/** Resolve a language id, alias, GitHub qualifier or display name ("C++", "golang", "cpp") to its id. */
export function resolveLanguage(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const norm = normalise(n).join(' ');
  return LANGUAGES.find(
    (l) =>
      l.id === n ||
      l.qualifier === n ||
      l.label.toLowerCase() === n ||
      l.aliases.includes(n) ||
      l.aliases.includes(norm),
  )?.id;
}

/* ------------------------------------------------------------------ */
/* GitHub query builder                                                */
/* ------------------------------------------------------------------ */

export const BASE_QUALIFIERS = ['is:issue', 'is:open', 'no:assignee', 'archived:false'];

/** `comments:<N` / `comments:0` for a ceiling, or null. */
export function commentsQualifier(max: number | null): string | null {
  if (max === null) return null;
  return max <= 0 ? 'comments:0' : `comments:<${max}`;
}

/** `created:>YYYY-MM-DD` for a recency window relative to `now`. */
export function sinceQualifier(since: Since | null, now = Date.now()): string | null {
  if (!since) return null;
  const d = new Date(now - SINCE_DAYS[since] * 86_400_000);
  return `created:>${d.toISOString().slice(0, 10)}`;
}

/**
 * Build the GitHub issue-search string.
 * - `topic:` only works for repository search, so domains become free-text terms.
 * - Several `language:` qualifiers are OR-ed by GitHub (verified against the live API).
 * - Issue types are ONE comma-separated `label:a,b` qualifier (OR); "tests" adds the word `test`.
 */
export function buildGitHubQuery(p: ParsedQuery, now = Date.now()): string {
  const parts = [...BASE_QUALIFIERS];
  if (p.difficulty) parts.push(DIFFICULTIES[p.difficulty].qualifier);

  for (const id of p.languages) {
    const def = languageById(id);
    if (def) parts.push(`language:${def.qualifier}`);
  }

  const labels = p.types.map((t) => ISSUE_TYPES[t].githubLabel).filter(Boolean);
  if (labels.length) parts.push(`label:${labels.join(',')}`);
  if (p.types.includes('tests')) parts.push('test');

  for (const d of p.domains) parts.push(d.term);
  for (const k of p.keywords) {
    const clean = k.replace(/["\\]/g, '').trim();
    if (clean) parts.push(clean.includes(' ') ? `"${clean}"` : clean);
  }
  const comments = commentsQualifier(p.maxComments);
  if (comments) parts.push(comments);
  const created = sinceQualifier(p.since, now);
  if (created) parts.push(created);
  parts.push(...p.qualifiers);

  return dedupe(parts).join(' ');
}

/**
 * Write a ParsedQuery back into plain language, such that
 * parseQuery(toQueryText(p)) yields the same filters. Used when the user
 * removes a chip or refines via the sidebar (and for LLM parses), so the URL
 * (?q=) stays the single source of truth.
 */
export function toQueryText(p: ParsedQuery): string {
  const words: string[] = [];
  if (p.difficulty) words.push(DIFFICULTIES[p.difficulty].canonical);
  for (const id of p.languages) {
    const def = languageById(id);
    if (def) words.push(def.aliases[0]);
  }
  for (const d of p.domains) words.push(d.matched);
  for (const t of p.types) words.push(ISSUE_TYPES[t].canonical);
  // Quote keywords the parser would otherwise re-interpret or drop. Quoted phrases
  // are extracted before bare words, so if any needs quotes, quote them all to keep order.
  const needsQuotes = (k: string) => {
    const tokens = normalise(k);
    return k.includes(' ') || !!lookup(tokens) || tokens.some(isStopword) || tokens.join(' ') !== k;
  };
  const quoteAll = p.keywords.some(needsQuotes);
  for (const k of p.keywords) words.push(quoteAll ? `"${k}"` : k);
  if (p.maxComments !== null) {
    const n = Math.min(Math.max(0, Math.floor(p.maxComments)), MAX_COMMENTS);
    words.push(n <= 0 ? 'no comments' : `fewer than ${n} comments`);
  }
  if (p.since) words.push(SINCE_TEXT[p.since]);
  words.push(...p.qualifiers);
  return words.join(' ');
}

export function hasFilters(p: ParsedQuery): boolean {
  return !!(
    p.difficulty ||
    p.languages.length ||
    p.domains.length ||
    p.types.length ||
    p.keywords.length ||
    p.qualifiers.length ||
    p.maxComments !== null ||
    p.since
  );
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

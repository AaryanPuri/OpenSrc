/**
 * Frontend view of the query parser. The parser, GitHub query builder and
 * types live in shared/ (also used by the API server); this module re-exports
 * them and adds the UI-only helpers: chips ("patches") and refine toggles.
 */
import { DIFFICULTIES, DOMAINS, ISSUE_TYPES, type Difficulty, type IssueType } from '../../../shared/dictionary';
import { SINCE_DAYS, commentsQualifier, languageById, makeDomainMatch, toQueryText } from '../../../shared/parse';
import type { ParsedQuery, Since } from '../../../shared/types';

export * from '../../../shared/parse';
export type { Difficulty, DomainMatch, InterpretedQuery, IssueType, ParsedQuery, Since } from '../../../shared/types';

const SINCE_LABEL: Record<Since, string> = {
  week: 'Opened this week',
  month: 'Opened this month',
  year: 'Opened this year',
};

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

export type ChipKind = 'difficulty' | 'language' | 'domain' | 'type' | 'activity' | 'recency' | 'keyword' | 'qualifier';

/** Screen-reader / aria names for each kind of patch. */
export const KIND_LABEL: Record<ChipKind, string> = {
  difficulty: 'Difficulty',
  language: 'Language',
  domain: 'Field',
  type: 'Kind of work',
  activity: 'Discussion',
  recency: 'Opened',
  keyword: 'Keyword',
  qualifier: 'GitHub qualifier',
};

export interface Chip {
  kind: ChipKind;
  id: string;
  label: string;
  /** Short explanation of what this chip does to the GitHub query. */
  detail: string;
  color?: string;
}

export function getChips(p: ParsedQuery): Chip[] {
  const chips: Chip[] = [];
  if (p.difficulty) {
    chips.push({
      kind: 'difficulty',
      id: p.difficulty,
      label: DIFFICULTIES[p.difficulty].label,
      detail: DIFFICULTIES[p.difficulty].qualifier,
    });
  }
  for (const id of p.languages) {
    const def = languageById(id);
    if (def)
      chips.push({ kind: 'language', id, label: def.label, detail: `language:${def.qualifier}`, color: def.color });
  }
  for (const d of p.domains) {
    chips.push({
      kind: 'domain',
      id: d.id,
      label: d.label,
      detail: `matches “${d.term.replace(/"/g, '')}” · topics: ${d.topics.join(', ')}`,
    });
  }
  for (const t of p.types) {
    const def = ISSUE_TYPES[t];
    chips.push({
      kind: 'type',
      id: t,
      label: def.label,
      detail: def.githubLabel ? `label:${def.githubLabel}` : 'mentions “test”',
    });
  }
  if (p.maxComments !== null) {
    const label =
      p.maxComments <= 0
        ? 'No comments yet'
        : `Fewer than ${p.maxComments} ${p.maxComments === 1 ? 'comment' : 'comments'}`;
    chips.push({ kind: 'activity', id: String(p.maxComments), label, detail: commentsQualifier(p.maxComments)! });
  }
  if (p.since) {
    chips.push({
      kind: 'recency',
      id: p.since,
      label: SINCE_LABEL[p.since],
      detail: `created in the last ${SINCE_DAYS[p.since]} days`,
    });
  }
  for (const k of p.keywords) chips.push({ kind: 'keyword', id: k, label: k, detail: 'free-text keyword' });
  for (const q of p.qualifiers) chips.push({ kind: 'qualifier', id: q, label: q, detail: 'raw GitHub qualifier' });
  return chips;
}

export function removeChip(p: ParsedQuery, chip: Pick<Chip, 'kind' | 'id'>): ParsedQuery {
  const next: ParsedQuery = { ...p };
  switch (chip.kind) {
    case 'difficulty':
      next.difficulty = null;
      break;
    case 'language':
      next.languages = p.languages.filter((l) => l !== chip.id);
      break;
    case 'domain':
      next.domains = p.domains.filter((d) => d.id !== chip.id);
      break;
    case 'type':
      next.types = p.types.filter((t) => t !== chip.id);
      break;
    case 'keyword':
      next.keywords = p.keywords.filter((k) => k !== chip.id);
      break;
    case 'qualifier':
      next.qualifiers = p.qualifiers.filter((q) => q !== chip.id);
      break;
    case 'activity':
      next.maxComments = null;
      break;
    case 'recency':
      next.since = null;
      break;
  }
  next.raw = toQueryText(next);
  return next;
}

export function setDifficulty(p: ParsedQuery, d: Difficulty | null): ParsedQuery {
  const next = { ...p, difficulty: d };
  next.raw = toQueryText(next);
  return next;
}

export function toggleLanguage(p: ParsedQuery, id: string): ParsedQuery {
  const languages = p.languages.includes(id) ? p.languages.filter((l) => l !== id) : [...p.languages, id];
  const next = { ...p, languages };
  next.raw = toQueryText(next);
  return next;
}

export function toggleType(p: ParsedQuery, t: IssueType): ParsedQuery {
  const types = p.types.includes(t) ? p.types.filter((x) => x !== t) : [...p.types, t];
  const next = { ...p, types };
  next.raw = toQueryText(next);
  return next;
}

export function toggleDomain(p: ParsedQuery, id: string): ParsedQuery {
  const def = DOMAINS.find((d) => d.id === id);
  if (!def) return p;
  const domains = p.domains.some((d) => d.id === id)
    ? p.domains.filter((d) => d.id !== id)
    : [...p.domains, makeDomainMatch(def, def.synonyms[0])];
  const next = { ...p, domains };
  next.raw = toQueryText(next);
  return next;
}

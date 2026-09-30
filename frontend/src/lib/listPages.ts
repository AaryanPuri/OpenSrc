/**
 * Language and field pages (`/language/:id`, `/field/:id`): which ones exist,
 * which repos they list, and the numbers their intro is written from. Plain
 * TypeScript: the pages, the server render and scripts/prerender.ts share it.
 */
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { sortRepos } from '../../../shared/repoFilter';
import { DOMAINS, LANGUAGES, type DomainDef, type LanguageDef } from './dictionary';
import { plural, welcomeIssues } from './format';
import { emptyQuery, makeDomainMatch, toQueryText } from './parseQuery';

/** A language gets a page once the directory has this many of its repos (fewer would be a thin page). */
export const LANGUAGE_PAGE_MIN = 3;
/** Field pages need at least one repo. */
export const FIELD_PAGE_MIN = 1;
/** Repos per grid page; a pre-rendered list page carries this many. */
export const LIST_PAGE = 30;

export type ListKind = 'language' | 'field';

export const languageLabel = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? null;
export const languageDef = (id: string): LanguageDef | undefined => LANGUAGES.find((l) => l.id === id);
export const fieldDef = (id: string): DomainDef | undefined => DOMAINS.find((d) => d.id === id);

export const hasLanguagePage = (meta: Pick<DatasetMeta, 'languages'>, id: string) =>
  !!languageDef(id) && (meta.languages[id] ?? 0) >= LANGUAGE_PAGE_MIN;
export const hasFieldPage = (meta: Pick<DatasetMeta, 'fields'>, id: string) =>
  !!fieldDef(id) && (meta.fields[id] ?? 0) >= FIELD_PAGE_MIN;

/** Language ids with a page, most repos first (ties by name). */
export function languagePageIds(meta: Pick<DatasetMeta, 'languages'>): string[] {
  return LANGUAGES.filter((l) => hasLanguagePage(meta, l.id))
    .sort((a, b) => (meta.languages[b.id] ?? 0) - (meta.languages[a.id] ?? 0) || a.label.localeCompare(b.label, 'en'))
    .map((l) => l.id);
}

/** Field ids with a page, most repos first (ties by name). */
export function fieldPageIds(meta: Pick<DatasetMeta, 'fields'>): string[] {
  return DOMAINS.filter((d) => hasFieldPage(meta, d.id))
    .sort((a, b) => (meta.fields[b.id] ?? 0) - (meta.fields[a.id] ?? 0) || a.label.localeCompare(b.label, 'en'))
    .map((d) => d.id);
}

/** A language or field page's repos, best score first. */
export function listRepos(repos: RepoRecord[], kind: ListKind, id: string): RepoRecord[] {
  return sortRepos(
    repos.filter((r) => (kind === 'language' ? r.language === id : r.fields.includes(id))),
    'score',
  );
}

/** What a list page's intro and related links are written from: its whole list, not just the first page. */
export interface ListStats {
  count: number;
  firstPr: number;
  gfi: number;
  helpWanted: number;
  medianScore: number;
  /** The best-scored repos (fullName), at most 3. */
  top: string[];
  /** Language ids by how many of the list's repos use them, at most 6. */
  languages: [string, number][];
  /** Field ids by how many of the list's repos are about them, at most 6. */
  fields: [string, number][];
}

const tally = (list: RepoRecord[], keys: (r: RepoRecord) => string[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const r of list) for (const k of keys(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 6);
};

/** `list` sorted best first (listRepos). */
export function listStats(list: RepoRecord[]): ListStats {
  const scores = list.map((r) => r.score).sort((a, b) => a - b);
  const mid = scores.length >> 1;
  const median = !scores.length ? 0 : scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  return {
    count: list.length,
    firstPr: list.filter((r) => r.firstPrFriendly).length,
    gfi: list.reduce((n, r) => n + r.goodFirstIssues, 0),
    helpWanted: list.reduce((n, r) => n + r.helpWanted, 0),
    medianScore: Math.round(median),
    top: list.slice(0, 3).map((r) => r.fullName),
    languages: tally(list, (r) => (r.language ? [r.language] : [])),
    fields: tally(list, (r) => r.fields),
  };
}

/** "a, b and c" */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The page's opening paragraph, written from its numbers so every page reads
 * differently: how many repos, how many issues, the median score, the top picks
 * and what else they have in common.
 */
export function listIntro(kind: ListKind, id: string, label: string, s: ListStats): string {
  if (s.count === 0)
    return `No ${label} repos are in the directory right now. Check back after the next nightly update.`;
  const what =
    kind === 'language'
      ? `${label} ${s.count === 1 ? 'repository' : 'repositories'}`
      : `${s.count === 1 ? 'repository' : 'repositories'} about ${label}`;
  const parts = [
    `OpenSrc lists ${s.count.toLocaleString('en')} ${what} with open issues for new contributors` +
      (s.firstPr
        ? `, and ${s.firstPr.toLocaleString('en')} of them ${s.firstPr === 1 ? 'is' : 'are'} first-PR friendly.`
        : '.'),
    `${s.count === 1 ? 'It has' : 'Between them they have'} ${plural(s.gfi, 'open good first issue')} and ${welcomeIssues(s.helpWanted)}.`,
    s.top.length
      ? `The median welcome score is ${s.medianScore}/100, and the best-scored right now ${s.top.length === 1 ? 'is' : 'are'} ${joinList(s.top)}.`
      : '',
  ];
  if (kind === 'language') {
    const fields = s.fields.slice(0, 3).map(([f]) => fieldDef(f)?.label ?? f);
    if (fields.length) parts.push(`${s.count === 1 ? 'It is' : 'Most are'} about ${joinList(fields)}.`);
  } else {
    const langs = s.languages.slice(0, 3).map(([l]) => languageLabel(l) ?? l);
    if (langs.length) parts.push(`${s.count === 1 ? 'It is' : 'Most are'} written in ${joinList(langs)}.`);
    const also = s.fields
      .filter(([f]) => f !== id)
      .slice(0, 2)
      .map(([f]) => fieldDef(f)?.label ?? f);
    if (also.length) parts.push(`${s.count === 1 ? 'It also touches' : 'Many also touch'} ${joinList(also)}.`);
  }
  return parts.filter(Boolean).join(' ');
}

/** The directory search that shows the same repos, with filters to narrow them further. */
export function directoryQuery(kind: ListKind, id: string): string {
  if (kind === 'language') return toQueryText({ ...emptyQuery(), languages: [id] });
  const def = fieldDef(id);
  return def ? toQueryText({ ...emptyQuery(), domains: [makeDomainMatch(def, def.synonyms[0])] }) : '';
}

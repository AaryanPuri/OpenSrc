/**
 * Field (domain) classification for repos: up to three DOMAINS ids from a repo's
 * topics, description and name, using the same vocabulary as the query parser.
 */
import { DOMAINS } from './dictionary.js';
import { matchDomains, normalise } from './parse.js';
import type { RepoRecord } from './repo.js';

export const MAX_FIELDS = 3;

/** Weights: a topic listed on the domain beats a topic that is a synonym, which beats prose. */
const EXACT_TOPIC = 3;
const SYNONYM_TOPIC = 2;
const PROSE = 1;

export function classifyRepo(repo: Pick<RepoRecord, 'name' | 'description' | 'topics'>): string[] {
  const scores = new Map<string, number>();
  const add = (id: string, pts: number) => scores.set(id, (scores.get(id) ?? 0) + pts);

  for (const raw of repo.topics) {
    const topic = raw.toLowerCase();
    const exact = DOMAINS.filter((d) => d.topics.includes(topic));
    exact.forEach((d) => add(d.id, EXACT_TOPIC));
    for (const m of matchDomains(normalise(topic))) {
      if (!exact.some((d) => d.id === m.id)) add(m.id, SYNONYM_TOPIC);
    }
  }
  for (const m of matchDomains(normalise(repo.description ?? ''))) add(m.id, PROSE);
  for (const m of matchDomains(normalise(repo.name))) add(m.id, PROSE);

  const order = (id: string) => DOMAINS.findIndex((d) => d.id === id);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))
    .slice(0, MAX_FIELDS)
    .map(([id]) => id);
}

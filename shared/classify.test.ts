import { describe, expect, it } from 'vitest';
import { DOMAINS } from './dictionary';
import { classifyRepo, MAX_FIELDS } from './classify';
import { matchDomains, normalise, parseQuery } from './parse';

describe('matchDomains', () => {
  it('finds domains in normalised tokens like the parser does', () => {
    const text = 'A fast SQL query engine with a GraphQL API';
    expect(matchDomains(normalise(text)).map((d) => d.id)).toEqual(['databases', 'backend']);
    expect(matchDomains(normalise(text)).map((d) => d.id)).toEqual(parseQuery(text).domains.map((d) => d.id));
  });

  it('consumes language and difficulty phrases without producing a domain', () => {
    expect(matchDomains(normalise('good first issue in rust'))).toEqual([]);
    expect(matchDomains([])).toEqual([]);
  });
});

describe('classifyRepo', () => {
  it('prefers topics over prose and caps at three fields', () => {
    const fields = classifyRepo({
      name: 'turbodb',
      description: 'A web UI and CLI for machine learning on a database',
      topics: ['database', 'sql', 'kubernetes'],
    });
    expect(fields).toHaveLength(MAX_FIELDS);
    expect(fields[0]).toBe('databases');
    expect(fields).toContain('devops');
  });

  it('matches hyphenated topics through synonyms', () => {
    expect(classifyRepo({ name: 'x', description: null, topics: ['machine-learning'] })).toEqual(['ml']);
    expect(classifyRepo({ name: 'x', description: null, topics: ['deep-learning', 'pytorch'] })).toEqual(['ml']);
  });

  it('returns known ids only, and nothing when nothing matches', () => {
    const ids = new Set(DOMAINS.map((d) => d.id));
    const fields = classifyRepo({ name: 'kube-thing', description: 'Kubernetes operator for Postgres', topics: [] });
    expect(fields.every((f) => ids.has(f))).toBe(true);
    expect(fields).toEqual(expect.arrayContaining(['devops', 'databases']));
    expect(classifyRepo({ name: 'zzz', description: 'Nothing to see here', topics: ['hacktoberfest'] })).toEqual([]);
  });
});

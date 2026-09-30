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

describe('classifyRepo: real repos', () => {
  it('freeCodeCamp is web work, not scientific computing ("computer science" is denied)', () => {
    const fields = classifyRepo({
      name: 'freeCodeCamp',
      language: 'typescript',
      description:
        "freeCodeCamp.org's open-source codebase and curriculum. Learn math, programming, and computer science for free.",
      topics: ['learn-to-code', 'nonprofits', 'programming', 'nodejs', 'react', 'd3', 'education', 'javascript'],
    });
    expect(fields).not.toContain('science');
    expect(fields).toEqual(['frontend', 'backend']);
  });

  it('uses ecosystem hints on topics and prose', () => {
    expect(
      classifyRepo({
        name: 'tantivy',
        description: 'Tantivy is a full-text search engine library inspired by Apache Lucene and written in Rust',
        topics: ['search-engine', 'rust'],
      }),
    ).toEqual(['databases']);
    expect(
      classifyRepo({
        name: 'FastAsyncWorldEdit',
        description: 'Blazingly fast world manipulation for artists, builders and everyone else.',
        topics: ['minecraft-plugin', 'minecraft-mod', 'worldedit'],
      }),
    ).toEqual(['gamedev']);
    expect(
      classifyRepo({ name: 'rocq', description: 'The Rocq Prover is an interactive theorem prover', topics: [] }),
    ).toEqual(['compilers']);
  });

  it('vague prose words count half, so they alone assign nothing', () => {
    // "web" and "UI" in passing are not enough for Web Frontend
    expect(classifyRepo({ name: 'eclipse.platform.ui', description: 'Eclipse Platform UI', topics: [] })).toEqual([]);
    expect(classifyRepo({ name: 'x', description: 'Works on any OS and the web', topics: [] })).toEqual([]);
    // but a real synonym still does
    expect(classifyRepo({ name: 'x', description: 'An AI-powered document editor', topics: [] })).toContain('ml');
  });

  it('uses the primary language as a hint', () => {
    expect(
      classifyRepo({
        name: 'yak-aggregator',
        description: 'On-chain dex aggregator',
        topics: [],
        language: 'solidity',
      }),
    ).toEqual(['blockchain']);
    // JS/TS with UI words is frontend work; the same words in a Go repo are not.
    const ui = {
      name: 'track-extension',
      description: 'Toggl Track browser extension for Chrome and Firefox',
      topics: [],
    };
    expect(classifyRepo({ ...ui, language: 'javascript' })).toEqual(['frontend']);
    expect(classifyRepo({ ...ui, language: 'go' })).toEqual([]);
  });
});

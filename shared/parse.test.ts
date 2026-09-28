/**
 * Tests for the shared rules parser and GitHub query builder. These run once,
 * from the root vitest config; the frontend and the server both use this code.
 * UI-only helpers (chips, toggles) are tested in src/lib/parseQuery.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGitHubQuery,
  domainMatchById,
  emptyQuery,
  lexiconConflicts,
  normalise,
  parseQuery,
  resolveLanguage,
  toQueryText,
} from './parse';
import type { ParsedQuery } from './types';

const filters = (p: ParsedQuery) => ({
  languages: p.languages,
  domains: p.domains.map((d) => d.id),
  difficulty: p.difficulty,
  types: p.types,
  keywords: p.keywords,
  qualifiers: p.qualifiers,
  maxComments: p.maxComments,
  since: p.since,
});
const ids = (p: ParsedQuery) => p.domains.map((d) => d.id);
const BASE = 'is:issue is:open no:assignee archived:false';

describe('parseQuery — spec examples', () => {
  it('beginner friendly rust issues in databases', () => {
    const p = parseQuery('beginner friendly rust issues in databases');
    expect(filters(p)).toEqual({
      languages: ['rust'],
      domains: ['databases'],
      difficulty: 'beginner',
      types: [],
      keywords: [],
      qualifiers: [],
      maxComments: null,
      since: null,
    });
    expect(buildGitHubQuery(p)).toBe(`${BASE} label:"good first issue" language:rust database`);
  });

  it('python machine learning docs help', () => {
    const p = parseQuery('python machine learning docs help');
    expect(p.languages).toEqual(['python']);
    expect(p.domains.map((d) => d.id)).toEqual(['ml']);
    expect(p.types).toEqual(['docs']);
    expect(p.keywords).toEqual([]);
    expect(buildGitHubQuery(p)).toContain('label:documentation');
    expect(buildGitHubQuery(p)).toContain('"machine learning"');
  });

  it('frontend accessibility bugs in react', () => {
    const p = parseQuery('frontend accessibility bugs in react');
    expect(p.domains.map((d) => d.id)).toEqual(['frontend', 'accessibility']);
    expect(p.types).toEqual(['bug']);
    expect(p.keywords).toEqual(['react']);
    const q = buildGitHubQuery(p);
    expect(q).toContain('label:bug');
    expect(q).toMatch(/ react$/);
  });

  it('easy go issues for kubernetes tooling', () => {
    const p = parseQuery('easy go issues for kubernetes tooling');
    expect(p.difficulty).toBe('beginner');
    expect(p.languages).toEqual(['go']);
    expect(p.domains).toHaveLength(1);
    expect(p.domains[0]).toMatchObject({ id: 'devops', term: 'kubernetes' });
    expect(p.keywords).toEqual([]);
  });
});

describe('languages', () => {
  it.each([
    ['golang', 'go'],
    ['py', 'python'],
    ['ts', 'typescript'],
    ['TypeScript', 'typescript'],
    ['js', 'javascript'],
    ['node.js', 'javascript'],
    ['c++', 'cpp'],
    ['C#', 'csharp'],
    ['.net', 'csharp'],
    ['java', 'java'],
    ['ruby on rails', 'ruby'],
    ['kotlin', 'kotlin'],
    ['swift', 'swift'],
  ])('%s → %s', (input, id) => {
    expect(parseQuery(`${input} bugs`).languages).toEqual([id]);
  });

  it('does not confuse java and javascript', () => {
    expect(parseQuery('java and javascript').languages).toEqual(['java', 'javascript']);
  });

  it('maps language to GitHub qualifier values', () => {
    expect(buildGitHubQuery(parseQuery('c++'))).toContain('language:cpp');
    expect(buildGitHubQuery(parseQuery('c#'))).toContain('language:csharp');
  });
});

describe('domains', () => {
  it('matches multi-word synonyms before single words', () => {
    const p = parseQuery('react native apps');
    expect(p.domains.map((d) => d.id)).toEqual(['mobile']);
    expect(p.domains[0].term).toBe('"react native"');
    expect(p.keywords).toEqual([]);
  });

  it('handles plurals and hyphens', () => {
    expect(parseQuery('compilers').domains[0].id).toBe('compilers');
    expect(parseQuery('game-dev').domains[0].id).toBe('gamedev');
    expect(parseQuery('command-line tools').domains[0].id).toBe('cli');
    expect(parseQuery('a11y').domains[0].id).toBe('accessibility');
  });

  it('uses precise synonyms as search terms, generic ones fall back to default term', () => {
    expect(parseQuery('postgres').domains[0].term).toBe('postgres');
    expect(parseQuery('devops').domains[0].term).toBe('kubernetes');
    expect(parseQuery('ai').domains[0].term).toBe('"machine learning"');
  });

  it('never emits a topic: qualifier (unsupported by issue search)', () => {
    expect(buildGitHubQuery(parseQuery('rust databases machine learning'))).not.toContain('topic:');
  });

  it('counts each domain once', () => {
    expect(parseQuery('k8s kubernetes docker').domains).toHaveLength(1);
  });
});

describe('difficulty', () => {
  it.each([
    ['good first issue', 'beginner'],
    ['good-first-issue', 'beginner'],
    ['first timers', 'beginner'],
    ['newcomer', 'beginner'],
    ['low hanging fruit', 'beginner'],
    ['help wanted', 'help-wanted'],
    ['intermediate', 'intermediate'],
  ] as const)('%s → %s', (input, expected) => {
    expect(parseQuery(input).difficulty).toBe(expected);
  });

  it('first mention wins', () => {
    expect(parseQuery('easy help wanted').difficulty).toBe('beginner');
  });

  it('builds the right label qualifier', () => {
    expect(buildGitHubQuery(parseQuery('help wanted'))).toContain('label:"help wanted"');
    expect(buildGitHubQuery(parseQuery('intermediate'))).toContain('-label:"good first issue"');
  });
});

describe('types', () => {
  it('combines several type labels with OR (comma)', () => {
    const p = parseQuery('bugs and docs');
    expect(p.types).toEqual(['bug', 'docs']);
    expect(buildGitHubQuery(p)).toContain('label:bug,documentation');
  });

  it('feature and tests', () => {
    const p = parseQuery('write tests for new feature');
    expect(p.types).toEqual(expect.arrayContaining(['tests', 'feature']));
    const q = buildGitHubQuery(p);
    expect(q).toContain('label:enhancement');
    expect(q).toContain(' test');
  });

  it('distinguishes the testing type from the testing-framework domain', () => {
    const p = parseQuery('test framework');
    expect(p.domains.map((d) => d.id)).toEqual(['testing']);
    expect(p.types).toEqual([]);
  });
});

describe('keywords & qualifiers', () => {
  it('drops stopwords and keeps leftovers', () => {
    const p = parseQuery('I want to find some rust issues about async parsing');
    expect(p.languages).toEqual(['rust']);
    expect(p.keywords).toEqual(['async', 'parsing']);
  });

  it('keeps quoted phrases verbatim', () => {
    const p = parseQuery('"memory leak" rust');
    expect(p.keywords).toEqual(['memory leak']);
    expect(buildGitHubQuery(p)).toContain('"memory leak"');
  });

  it('passes raw GitHub qualifiers through', () => {
    const p = parseQuery('easy repo:rust-lang/rust-clippy lint');
    expect(p.qualifiers).toEqual(['repo:rust-lang/rust-clippy']);
    expect(p.keywords).toEqual(['lint']);
    expect(buildGitHubQuery(p)).toMatch(/repo:rust-lang\/rust-clippy$/);
  });

  it('ignores unknown "x:y" text as a qualifier', () => {
    expect(parseQuery('foo:bar').qualifiers).toEqual([]);
  });

  it('handles empty and punctuation-only input', () => {
    expect(filters(parseQuery(''))).toEqual(filters(parseQuery('  ?!, ')));
    expect(buildGitHubQuery(parseQuery(''))).toBe(BASE);
  });
});

describe('round-tripping & chip edits', () => {
  it.each([
    'beginner friendly rust issues in databases',
    'python machine learning docs help',
    'frontend accessibility bugs in react',
    'easy go issues for kubernetes tooling',
    'help wanted c++ graphics "memory leak" repo:foo/bar',
    'intermediate typescript react native tests',
  ])('parse(toQueryText(parse(x))) is stable: %s', (input) => {
    const p = parseQuery(input);
    const again = parseQuery(toQueryText(p));
    expect(filters(again)).toEqual(filters(p));
    expect(buildGitHubQuery(again)).toBe(buildGitHubQuery(p));
  });

  it('keyword that collides with a dictionary word is quoted to survive a round-trip', () => {
    const p = { ...parseQuery('rust'), keywords: ['docs'] };
    expect(parseQuery(toQueryText(p)).keywords).toEqual(['docs']);
  });

  it('keywords that are filler words or odd tokens survive a round-trip (LLM parses)', () => {
    const p = { ...emptyQuery(), languages: ['go'], keywords: ['friendly', 'tokio', 'vue.js plugin', 'new'] };
    expect(parseQuery(toQueryText(p)).keywords).toEqual(['friendly', 'tokio', 'vue.js plugin', 'new']);
  });

  it('a structured parse built from ids (as the LLM path does) round-trips exactly', () => {
    const p: ParsedQuery = {
      ...emptyQuery('stuff nobody has touched in rust storage'),
      languages: ['rust', 'objective-c'],
      domains: ['databases', 'testing', 'systems', 'ml'].map((id) => domainMatchById(id)!),
      difficulty: 'help-wanted',
      types: ['bug', 'tests'],
      keywords: ['tokio'],
      maxComments: 0,
      since: 'week',
    };
    const again = parseQuery(toQueryText(p));
    expect(filters(again)).toEqual(filters(p));
    expect(buildGitHubQuery(again, 0)).toBe(buildGitHubQuery(p, 0));
  });
});

describe('activity: comment ceilings & recency', () => {
  const NOW = Date.parse('2026-09-26T12:00:00Z');

  it('"issues with less than 5 comments in go" → comments:<5, no filler keywords', () => {
    const p = parseQuery('issues with less than 5 comments in go');
    expect(p.languages).toEqual(['go']);
    expect(p.maxComments).toBe(5);
    expect(p.keywords).toEqual([]);
    expect(buildGitHubQuery(p)).toContain('comments:<5');
  });

  it.each([
    ['fewer than 3 comments', 3],
    ['under 10 comments', 10],
    ['less than five comments', 5],
    ['with fewer than 2 replies', 2],
  ])('%s → comments:<%i', (input, n) => {
    const p = parseQuery(`rust ${input}`);
    expect(p.maxComments).toBe(n);
    expect(p.keywords).toEqual([]);
  });

  it.each(['no comments', 'with no comments yet', 'unanswered', 'zero comments', 'untouched'])(
    '%s → comments:0',
    (input) => {
      const p = parseQuery(`python ${input} bugs`);
      expect(p.maxComments).toBe(0);
      expect(p.types).toEqual(['bug']);
      expect(p.keywords).toEqual([]);
      expect(buildGitHubQuery(p)).toContain('comments:0');
    },
  );

  it.each([
    ['recent', 'month', '2026-08-27'],
    ['recently opened', 'month', '2026-08-27'],
    ['this week', 'week', '2026-09-19'],
    ['from the last week', 'week', '2026-09-19'],
    ['this month', 'month', '2026-08-27'],
    ['past year', 'year', '2025-09-26'],
  ] as const)('%s → created:> window (%s)', (input, since, date) => {
    const p = parseQuery(`go ${input}`);
    expect(p.since).toBe(since);
    expect(p.keywords).toEqual(input === 'recently opened' ? ['opened'] : []);
    expect(buildGitHubQuery(p, NOW)).toContain(`created:>${date}`);
  });

  it('round-trips through toQueryText', () => {
    for (const input of ['go fewer than 4 comments this month', 'python unanswered recent docs']) {
      const p = parseQuery(input);
      expect(filters(parseQuery(toQueryText(p)))).toEqual(filters(p));
    }
  });

  it('drops leftover filler instead of making keyword chips', () => {
    const p = parseQuery('something quick in rust, maybe a few small things, thanks');
    expect(p.languages).toEqual(['rust']);
    expect(p.keywords).toEqual([]);
  });
});

describe('dictionary hygiene', () => {
  it('has no phrase claimed by two different filters', () => {
    expect(lexiconConflicts()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Ported from the server's former rules parser tests (same ids).       */
/* Expectations follow the shared (frontend) behaviour where they      */
/* differed: frontend domain ids, `cpp`/`csharp` language ids, no      */
/* `in:title,body` suffix.                                             */
/* ------------------------------------------------------------------ */

describe('normalizeQuery', () => {
  it('lowercases, splits hyphens and keeps c++/c#/node.js', () => {
    expect(normalise('Beginner-Friendly C++ and C# / Node.js!').join(' ')).toBe('beginner friendly c++ and c# node.js');
  });
  it('strips trailing dots but keeps .net', () => {
    expect(normalise('issues in .NET.').join(' ')).toBe('issues in .net');
    expect(parseQuery('issues in .NET.').languages).toEqual(['csharp']);
  });
});

describe('parseRules', () => {
  it('parses the canonical example', () => {
    const p = parseQuery('beginner friendly rust issues in databases');
    expect(p.languages).toEqual(['rust']);
    expect(ids(p)).toEqual(['databases']);
    expect(p.difficulty).toBe('beginner');
    expect(p.types).toEqual([]);
    expect(p.keywords).toEqual([]);
  });

  it('parses frontend accessibility bugs in react', () => {
    const p = parseQuery('frontend accessibility bugs in react');
    expect(ids(p)).toEqual(['frontend', 'accessibility']);
    expect(p.types).toEqual(['bug']);
    expect(p.languages).toEqual([]);
    expect(p.difficulty).toBeNull();
  });

  it.each([
    ['golang', 'go'],
    ['py', 'python'],
    ['ts', 'typescript'],
    ['js', 'javascript'],
    ['nodejs', 'javascript'],
    ['c++', 'cpp'],
    ['cpp', 'cpp'],
    ['c#', 'csharp'],
    ['csharp', 'csharp'],
    ['.net', 'csharp'],
    ['objective-c', 'objective-c'],
    ['rails', 'ruby'],
    ['bash', 'shell'],
    ['kt', 'kotlin'],
    ['perl', 'perl'],
    ['vue.js', 'vue'],
  ])('maps language alias %s -> %s', (alias, lang) => {
    expect(parseQuery(`${alias} issues`).languages).toEqual([lang]);
  });

  it("does not treat 'cs' as the C language via plural stemming", () => {
    expect(parseQuery('cs homework').languages).toEqual([]);
  });

  it('finds multiple languages in query order', () => {
    expect(parseQuery('python or golang cli tools').languages).toEqual(['python', 'go']);
  });

  it.each([
    ['kubernetes operators', 'devops'],
    ['k8s', 'devops'],
    ['machine learning', 'ml'],
    ['llms', 'ml'],
    ['game engine', 'gamedev'],
    ['smart contracts', 'blockchain'],
    ['android app', 'mobile'],
    ['react native', 'mobile'],
    ['flutter', 'mobile'],
    ['pandas', 'data-science'],
    ['compiler', 'compilers'],
    ['command line', 'cli'],
    ['a11y', 'accessibility'],
    ['screen reader', 'accessibility'],
    ['static site generator', 'docs-tooling'],
    ['test runner', 'testing'],
    ['p2p networking', 'networking'],
    ['firmware', 'embedded'],
    ['kernel', 'systems'],
    ['vscode extension', 'devtools'],
    ['bioinformatics', 'science'],
    ['vulkan renderer', 'graphics'],
    ['postgres', 'databases'],
    ['graphql api', 'backend'],
    ['infosec', 'security'],
    ['etl pipelines', 'data-science'],
  ])("maps domain synonym '%s' -> %s", (phrase, id) => {
    expect(ids(parseQuery(phrase))).toContain(id);
  });

  it('prefers the longest phrase (react native -> mobile, not frontend)', () => {
    expect(ids(parseQuery('react native'))).toEqual(['mobile']);
  });

  it.each([
    ['good first issue', 'beginner'],
    ['easy python', 'beginner'],
    ['first timers only', 'beginner'],
    ['help wanted', 'help-wanted'],
    ['help-wanted issues', 'help-wanted'],
    ['advanced rust', 'intermediate'],
    ['intermediate go', 'intermediate'],
  ])("difficulty '%s' -> %s", (q, d) => {
    expect(parseQuery(q).difficulty).toBe(d);
  });

  it('prefers beginner when several difficulty words appear', () => {
    expect(parseQuery('easy or intermediate issues').difficulty).toBe('beginner');
  });

  it.each([
    ['bugs', ['bug']],
    ['documentation and typos', ['docs']],
    ['feature requests', ['feature']],
    ['write tests', ['tests']],
    ['docs and bugs', ['docs', 'bug']],
  ])("types for '%s'", (q, t) => {
    expect(parseQuery(q).types).toEqual(t);
  });

  it('keeps specific leftover words as keywords and drops filler', () => {
    // "async runtime" is a systems-domain phrase in the shared dictionary.
    const p = parseQuery('I want to contribute to tokio async runtime projects');
    expect(p.keywords).toEqual(['tokio']);
    expect(ids(p)).toEqual(['systems']);
  });

  it('handles empty input', () => {
    expect(parseQuery('')).toEqual(emptyQuery(''));
  });

  it('returns domain labels and topics', () => {
    const [d] = parseQuery('databases').domains;
    expect(d.label).toBe('Databases');
    expect(d.topics).toContain('database');
  });
});

describe('buildGithubQuery', () => {
  const empty = emptyQuery();

  it('always includes base qualifiers', () => {
    expect(buildGitHubQuery(empty)).toBe(BASE);
  });

  it('builds the canonical example', () => {
    expect(buildGitHubQuery(parseQuery('beginner friendly rust issues in databases'))).toBe(
      `${BASE} label:"good first issue" language:rust database`,
    );
  });

  it('maps c++ / c# to linguist qualifiers and repeats language: (GitHub ORs them)', () => {
    const q = buildGitHubQuery({ ...empty, languages: ['cpp', 'csharp'] });
    expect(q).toContain('language:cpp language:csharp');
  });

  it('maps difficulties to labels', () => {
    expect(buildGitHubQuery({ ...empty, difficulty: 'help-wanted' })).toContain('label:"help wanted"');
    const inter = buildGitHubQuery({ ...empty, difficulty: 'intermediate' });
    expect(inter).toContain('label:"help wanted"');
    expect(inter).toContain('-label:"good first issue"');
  });

  it('emits all types as one comma-separated (OR) label qualifier, in order', () => {
    expect(buildGitHubQuery({ ...empty, types: ['docs', 'bug'] })).toBe(`${BASE} label:documentation,bug`);
    const q = buildGitHubQuery({ ...empty, types: ['bug', 'docs', 'feature'] });
    expect(q).toContain('label:bug,documentation,enhancement');
    expect(q.match(/label:/g)).toHaveLength(1);
  });

  it('single type is a plain label', () => {
    expect(buildGitHubQuery({ ...empty, types: ['bug'] })).toBe(`${BASE} label:bug`);
  });

  it('tests adds the word `test` and no label', () => {
    expect(buildGitHubQuery({ ...empty, types: ['tests'] })).toBe(`${BASE} test`);
  });

  it('tests alongside labelled types keeps both the label list and the word', () => {
    const q = buildGitHubQuery({ ...empty, types: ['tests', 'bug', 'docs'] });
    expect(q).toContain('label:bug,documentation');
    expect(q).toMatch(/ test\b/);
    expect(q).not.toMatch(/label:[^ ]*test/);
  });

  it('keeps the difficulty label as its own qualifier (AND) next to the type list', () => {
    expect(buildGitHubQuery(parseQuery('beginner rust bugs and docs'))).toBe(
      `${BASE} label:"good first issue" language:rust label:bug,documentation`,
    );
  });

  it('strips quotes from keywords', () => {
    expect(buildGitHubQuery({ ...empty, keywords: ['a"b'] })).toBe(`${BASE} ab`);
  });

  it('emits comments:/created: for activity filters', () => {
    const q = buildGitHubQuery({ ...empty, maxComments: 5, since: 'week' }, Date.parse('2026-09-26T00:00:00Z'));
    expect(q).toBe(`${BASE} comments:<5 created:>2026-09-19`);
  });
});

describe('resolveLanguage', () => {
  it.each([
    ['C++', 'cpp'],
    ['cpp', 'cpp'],
    ['golang', 'go'],
    ['Objective-C', 'objective-c'],
    ['TypeScript', 'typescript'],
    ['klingon', undefined],
    ['', undefined],
  ])('%s -> %s', (name, id) => {
    expect(resolveLanguage(name)).toBe(id);
  });
});

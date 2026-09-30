import { describe, expect, it } from 'vitest';
import {
  cleanLabels,
  githubIssuesUrl,
  mergeRestPages,
  parseLabelParam,
  parseRepoName,
  restIssueUrls,
  tabSearchText,
  type GhRestIssue,
} from './repoIssues';

const issue = (id: number, created: string, extra: Partial<GhRestIssue> = {}): GhRestIssue => ({
  id,
  number: id,
  title: `#${id}`,
  html_url: `https://github.com/a/b/issues/${id}`,
  labels: [],
  comments: 0,
  created_at: created,
  updated_at: created,
  ...extra,
});

describe('repo names and labels from a query string', () => {
  it('accepts owner/name only', () => {
    expect(parseRepoName('JuliaLang/julia')).toEqual({ owner: 'JuliaLang', name: 'julia' });
    expect(parseRepoName('pola-rs/polars')).toEqual({ owner: 'pola-rs', name: 'polars' });
    expect(parseRepoName('a/b.c_d-e')).toEqual({ owner: 'a', name: 'b.c_d-e' });
    for (const bad of ['', 'a', 'a/b/c', '../x', 'a/..', 'a b/c', 'a/b?x', '-a/b', 'a/b#', 'https://x.y/a/b']) {
      expect(parseRepoName(bad)).toBeNull();
    }
  });

  it('cleans label lists: trimmed, unique ignoring case, at most five', () => {
    expect(cleanLabels([' good first issue ', 'Good First Issue', 'E-easy'])).toEqual(['good first issue', 'E-easy']);
    expect(cleanLabels(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(5);
    expect(parseLabelParam('good first issue,status: help wanted')).toEqual([
      'good first issue',
      'status: help wanted',
    ]);
    expect(parseLabelParam(undefined)).toBeUndefined();
    expect(parseLabelParam('say "hi"')).toBeNull();
    expect(parseLabelParam('x'.repeat(51))).toBeNull();
  });
});

describe('GitHub links for a tab', () => {
  it('ORs the spellings in one label qualifier', () => {
    expect(tabSearchText('gfi', ['good first issue', 'E-easy'])).toBe(
      'is:issue is:open label:"good first issue","E-easy"',
    );
    expect(tabSearchText('all', ['ignored'])).toBe('is:issue is:open');
  });

  it("points at the repo's own issue list", () => {
    expect(githubIssuesUrl('JuliaLang/julia', 'gfi', ['good first issue'])).toBe(
      'https://github.com/JuliaLang/julia/issues?q=is:issue+is:open+label:%22good+first+issue%22',
    );
    expect(githubIssuesUrl('JuliaLang/julia', 'all', [])).toBe(
      'https://github.com/JuliaLang/julia/issues?q=is:issue+is:open',
    );
  });
});

describe('REST fallback', () => {
  it('asks once per spelling (at most three), newest first, assigned or not', () => {
    const urls = restIssueUrls(
      { owner: 'a', name: 'b', tab: 'gfi', labels: { gfi: ['w', 'x', 'y', 'z'], help: [] } },
      2,
    ).map((u) => new URL(u));
    expect(urls.map((u) => u.searchParams.get('labels'))).toEqual(['w', 'x', 'y']);
    for (const u of urls) {
      expect(u.pathname).toBe('/repos/a/b/issues');
      expect(u.searchParams.get('page')).toBe('2');
      expect(u.searchParams.get('state')).toBe('open');
      expect(u.searchParams.has('assignee')).toBe(false);
    }
  });

  it('merges pages: no PRs, no duplicates, sorted, more while any page was full', () => {
    const { items, hasMore } = mergeRestPages(
      [
        [issue(1, '2026-01-01T00:00:00Z'), issue(2, '2026-01-03T00:00:00Z', { assignee: { login: 'x' } })],
        [issue(2, '2026-01-03T00:00:00Z'), issue(3, '2026-01-02T00:00:00Z', { pull_request: {} })],
      ],
      'a',
      'b',
    );
    expect(items.map((i) => [i.number, i.assigned])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(hasMore).toBe(false);
    const full = Array.from({ length: 20 }, (_, i) => issue(i + 10, '2026-01-01T00:00:00Z'));
    expect(mergeRestPages([full, []], 'a', 'b').hasMore).toBe(true);
  });
});

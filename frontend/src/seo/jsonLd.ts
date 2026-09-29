/**
 * schema.org JSON-LD for the pages: a repo is SoftwareSourceCode, list pages
 * are ItemLists, every page but the home page has a BreadcrumbList, and the
 * home page describes the WebSite and its search.
 */
import type { RepoRecord } from '../../../shared/repo';
import { repoPath } from '../lib/repoDisplay';

export type JsonLd = Record<string, unknown>;

const CONTEXT = 'https://schema.org';

/** SPDX ids link to their license page; "other" (a custom license file) has none. */
const licenseUrl = (id: string | null) => (id && id !== 'other' ? `https://spdx.org/licenses/${id}.html` : undefined);

export function softwareSourceCode(site: string, repo: RepoRecord): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'SoftwareSourceCode',
    name: repo.name,
    alternateName: repo.fullName,
    url: `${site}${repoPath(repo.fullName)}`,
    codeRepository: `https://github.com/${repo.fullName}`,
    ...(repo.description ? { description: repo.description } : {}),
    ...(repo.languageName ? { programmingLanguage: repo.languageName } : {}),
    ...(licenseUrl(repo.license) ? { license: licenseUrl(repo.license) } : {}),
    ...(repo.homepage ? { sameAs: repo.homepage } : {}),
    ...(repo.topics.length ? { keywords: repo.topics.join(', ') } : {}),
    author: { '@type': 'Organization', name: repo.owner, url: `https://github.com/${repo.owner}` },
  };
}

export function itemList(site: string, name: string, repos: RepoRecord[], total = repos.length): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: total,
    itemListElement: repos.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${site}${repoPath(r.fullName)}`,
      name: r.fullName,
    })),
  };
}

/** Links (not repos), e.g. the collections. */
export function linkList(site: string, name: string, items: { name: string; path: string }[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${site}${it.path}`,
      name: it.name,
    })),
  };
}

/** Home first; `trail` is the rest, ending with the page itself. */
export function breadcrumbs(site: string, trail: { name: string; path: string }[]): JsonLd {
  const all = [{ name: 'OpenSrc', path: '/' }, ...trail];
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: `${site}${c.path}`,
    })),
  };
}

export function webSite(site: string, description: string): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: 'OpenSrc',
    url: `${site}/`,
    description,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** JSON for inside a <script>: no `</script>`, `<!--` or line separators can break out of it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LINE_SEP)
    .join('\\u2028')
    .split(PARA_SEP)
    .join('\\u2029');
}

// Old JS engines end a string literal at these.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

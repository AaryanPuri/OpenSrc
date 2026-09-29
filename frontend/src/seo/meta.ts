/**
 * Per-page <head>: title, description, canonical link, Open Graph and Twitter
 * cards, robots and JSON-LD. Pages build theirs with the helpers below and pass
 * it to useDocumentMeta; the server render collects it for the `<!--head-->`
 * placeholder in index.html (headHtml), and the browser keeps it current on
 * client-side navigation (applyMeta).
 */
import type { Collection } from '../../../shared/collections';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { clampText } from '../lib/dataset';
import { plural, replyTime } from '../lib/format';
import { joinList, listIntro, type ListKind, type ListStats } from '../lib/listPages';
import { repoPath } from '../lib/repoDisplay';
import { breadcrumbs, itemList, linkList, scriptJson, softwareSourceCode, webSite, type JsonLd } from './jsonLd';

export const SITE_NAME = 'OpenSrc';
/** Production origin; the build and the server read SITE_URL to override it. */
export const DEFAULT_SITE_URL = 'https://opensrc.studio';
/** Social preview image, served from public/. */
export const OG_IMAGE_PATH = '/og.png';
const SUFFIX = ` · ${SITE_NAME}`;
const NOINDEX = 'noindex, follow';

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL of the page, without its query string. */
  canonical: string;
  /** Only set when the page mustn't be indexed. */
  robots: string | null;
  og: { title: string; description: string; url: string; image: string; type: 'website' | 'article' };
  twitter: { card: 'summary_large_image'; title: string; description: string; image: string };
  jsonLd: JsonLd[];
}

interface MetaInput {
  title: string;
  description: string;
  /** Path of the page ("/repo/a/b"). */
  path: string;
  noindex?: boolean;
  type?: 'website' | 'article';
  jsonLd?: JsonLd[];
}

/** "https://x.dev/" → "https://x.dev" */
export const normalizeSiteUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** Meta descriptions: one sentence-ish, cut at a word near 160 characters. */
const clip = (s: string) => clampText(s.replace(/\s+/g, ' ').trim(), 160);

export function pageMeta(site: string, input: MetaInput): PageMeta {
  const canonical = `${site}${input.path === '/' ? '/' : input.path}`;
  const description = clip(input.description);
  const image = `${site}${OG_IMAGE_PATH}`;
  const socialTitle = input.title.endsWith(SUFFIX) ? input.title.slice(0, -SUFFIX.length) : input.title;
  return {
    title: input.title,
    description,
    canonical,
    robots: input.noindex ? NOINDEX : null,
    og: { title: socialTitle, description, url: canonical, image, type: input.type ?? 'website' },
    twitter: { card: 'summary_large_image', title: socialTitle, description, image },
    jsonLd: input.jsonLd ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Per route                                                           */
/* ------------------------------------------------------------------ */

export const HOME_TITLE = `${SITE_NAME} · Find a repo for your first open-source contribution`;

export function homeMeta(site: string, meta: DatasetMeta | null, top: RepoRecord[]): PageMeta {
  const count = meta ? `${meta.count.toLocaleString('en')} ` : '';
  const description =
    `A free directory of ${count}open-source repos that welcome new contributors, scored on good first issues, ` +
    'maintainer replies and recent activity. Browse by language or field and find your first PR.';
  return pageMeta(site, {
    title: HOME_TITLE,
    description,
    path: '/',
    jsonLd: [webSite(site, description), itemList(site, 'Best-scored repos for new contributors', top, meta?.count)],
  });
}

/** A directory search (`/?q=`): useful to visitors, not a page of its own for search engines. */
export function searchMeta(site: string, q: string): PageMeta {
  return pageMeta(site, {
    title: `${q || 'All repos'} · ${SITE_NAME} repos`,
    description: `Open-source repos for “${q}” in the OpenSrc directory.`,
    path: '/',
    noindex: true,
  });
}

export function repoMeta(site: string, repo: RepoRecord): PageMeta {
  const facts = [
    plural(repo.goodFirstIssues, 'open good first issue'),
    repo.helpWanted ? plural(repo.helpWanted, 'help-wanted issue') : '',
    repo.languageName ? `written in ${repo.languageName}` : '',
    repo.responseHours !== null ? `maintainers reply in ${replyTime(repo.responseHours)}` : '',
  ].filter(Boolean);
  const about = repo.description?.trim().replace(/[.!]?$/, '.') ?? '';
  return pageMeta(site, {
    title: `${repo.fullName}: ${plural(repo.goodFirstIssues, 'good first issue')}${SUFFIX}`,
    description: `${about ? `${about} ` : ''}How to contribute to ${repo.fullName}: ${joinList(facts)}. Welcome score ${repo.score}/100.`,
    path: repoPath(repo.fullName),
    type: 'article',
    jsonLd: [
      softwareSourceCode(site, repo),
      breadcrumbs(site, [{ name: repo.fullName, path: repoPath(repo.fullName) }]),
    ],
  });
}

export function listPageTitle(kind: ListKind, label: string): string {
  return kind === 'language'
    ? `Beginner-friendly ${label} repos to contribute to${SUFFIX}`
    : `${label} open-source projects for first contributions${SUFFIX}`;
}

export function listMeta(
  site: string,
  kind: ListKind,
  id: string,
  label: string,
  stats: ListStats,
  first: RepoRecord[],
): PageMeta {
  const path = `/${kind}/${id}`;
  const title = listPageTitle(kind, label);
  return pageMeta(site, {
    title,
    description: listIntro(kind, id, label, stats),
    path,
    jsonLd: [
      itemList(site, title.slice(0, -SUFFIX.length), first, stats.count),
      breadcrumbs(site, [{ name: kind === 'language' ? `${label} repos` : label, path }]),
    ],
  });
}

export function collectionsMeta(site: string, collections: Collection[]): PageMeta {
  return pageMeta(site, {
    title: `Collections of repos to contribute to${SUFFIX}`,
    description: `Hand-cut views of the OpenSrc directory: ${joinList(collections.map((c) => c.title.toLowerCase()))}.`,
    path: '/collections',
    jsonLd: [
      linkList(
        site,
        'Collections',
        collections.map((c) => ({ name: c.title, path: `/collections/${c.id}` })),
      ),
      breadcrumbs(site, [{ name: 'Collections', path: '/collections' }]),
    ],
  });
}

export function collectionMeta(site: string, c: Collection, first: RepoRecord[], total: number): PageMeta {
  const path = `/collections/${c.id}`;
  return pageMeta(site, {
    title: `${c.title}: repos to contribute to${SUFFIX}`,
    description: `${c.description} ${plural(total, 'repo')} in this collection right now.`,
    path,
    // An empty collection is a thin page.
    noindex: total === 0,
    jsonLd: [
      itemList(site, c.title, first, total),
      breadcrumbs(site, [
        { name: 'Collections', path: '/collections' },
        { name: c.title, path },
      ]),
    ],
  });
}

export function submitMeta(site: string): PageMeta {
  return pageMeta(site, {
    title: `Submit a repo to the directory${SUFFIX}`,
    description:
      'Suggest an open-source repo for OpenSrc: check it against the listing rules and its contributor-friendliness ' +
      'score, then file it on GitHub. Or flag a listed repo that no longer fits.',
    path: '/submit',
    jsonLd: [breadcrumbs(site, [{ name: 'Submit a repo', path: '/submit' }])],
  });
}

export function issuesMeta(site: string, q: string): PageMeta {
  return pageMeta(site, {
    title: q ? `${q} · ${SITE_NAME} issues` : `Search open issues${SUFFIX}`,
    description:
      'Describe the open-source work you want in plain words and find open, unclaimed GitHub issues that fit.',
    path: '/issues',
    noindex: true,
  });
}

export function notFoundMeta(site: string, path: string, title = `Page not found${SUFFIX}`): PageMeta {
  return pageMeta(site, {
    title,
    description: 'Nothing is stitched in at this address. Browse the OpenSrc directory instead.',
    path,
    noindex: true,
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const attr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Tag = ['name' | 'property', string, string];

function metaTags(m: PageMeta): Tag[] {
  const tags: Tag[] = [
    ['name', 'description', m.description],
    ['property', 'og:site_name', SITE_NAME],
    ['property', 'og:title', m.og.title],
    ['property', 'og:description', m.og.description],
    ['property', 'og:url', m.og.url],
    ['property', 'og:image', m.og.image],
    ['property', 'og:type', m.og.type],
    ['name', 'twitter:card', m.twitter.card],
    ['name', 'twitter:title', m.twitter.title],
    ['name', 'twitter:description', m.twitter.description],
    ['name', 'twitter:image', m.twitter.image],
  ];
  if (m.robots) tags.push(['name', 'robots', m.robots]);
  return tags;
}

/** The tags for the `<!--head-->` placeholder. */
export function headHtml(m: PageMeta): string {
  return [
    `<title>${text(m.title)}</title>`,
    ...metaTags(m).map(([k, key, v]) => `<meta ${k}="${key}" content="${attr(v)}" />`),
    `<link rel="canonical" href="${attr(m.canonical)}" />`,
    ...m.jsonLd.map((ld) => `<script type="application/ld+json">${scriptJson(ld)}</script>`),
  ].join('\n    ');
}

/** Brings document.head in line with `m` (client-side navigation). */
export function applyMeta(doc: Document, m: PageMeta): void {
  doc.title = m.title;
  const head = doc.head;
  const managed = new Set<Element>();
  for (const [k, key, v] of metaTags(m)) {
    let el = head.querySelector(`meta[${k}="${key}"]`);
    if (!el) {
      el = doc.createElement('meta');
      el.setAttribute(k, key);
      head.appendChild(el);
    }
    if (el.getAttribute('content') !== v) el.setAttribute('content', v);
    managed.add(el);
  }
  // A page without robots rules drops the previous page's noindex.
  const robots = head.querySelector('meta[name="robots"]');
  if (robots && !managed.has(robots)) robots.remove();

  let canonical = head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = doc.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    head.appendChild(canonical);
  }
  if (canonical.getAttribute('href') !== m.canonical) canonical.setAttribute('href', m.canonical);

  const scripts = [...head.querySelectorAll('script[type="application/ld+json"]')];
  const want = m.jsonLd.map((ld) => JSON.stringify(ld));
  if (scripts.length === want.length && scripts.every((s, i) => s.textContent === want[i])) return;
  for (const s of scripts) s.remove();
  for (const json of want) {
    const s = doc.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = json;
    head.appendChild(s);
  }
}

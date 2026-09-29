/**
 * GraphQL documents for the collector and the pure functions that turn their
 * answers into partial RepoRecords. Label filters on `issues(labels:)` are
 * OR-ed and case-insensitive, so each list holds distinct spellings only.
 */

import { GOOD_FIRST_LABELS, HELP_WANTED_LABELS } from "../../../shared/labels.js";

// The label spellings live in shared/ so the repo page's live issue search uses the same ones.
export { GOOD_FIRST_LABELS, HELP_WANTED_LABELS };

export const CONTRIBUTING_PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"];

/** Repo-search star ranges, so each language × bucket stays under GitHub's 1,000-result cap. */
export const STAR_BUCKETS: [number, number | null][] = [
  [30, 99],
  [100, 299],
  [300, 999],
  [1000, 4999],
  [5000, null],
];

export const SEARCH_PAGE_SIZE = 50;
/** Issues looked at per repo for claimable/unanswered counts. */
export const GFI_SAMPLE = 20;
/** Recent issues looked at per repo for the maintainer response time. */
export const RESPONSE_SAMPLE = 20;
const RESPONSE_COMMENTS = 10;

const RATE_LIMIT = "rateLimit { cost remaining limit resetAt }";
const labelList = (labels: string[]) => `[${labels.map((l) => JSON.stringify(l)).join(", ")}]`;

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export function starQualifier(bucket: [number, number | null] | null, minStars = 30): string {
  if (!bucket) return `stars:>=${minStars}`;
  const [lo, hi] = bucket;
  return hi === null ? `stars:>=${lo}` : `stars:${lo}..${hi}`;
}

export function searchQueryString(
  languageQualifier: string,
  bucket: [number, number | null] | null,
  pushedSince: string,
): string {
  return [
    `language:${languageQualifier}`,
    "good-first-issues:>=2",
    starQualifier(bucket),
    `pushed:>${pushedSince}`,
    "archived:false",
    "fork:false",
  ].join(" ");
}

export const SEARCH_QUERY = `query($q: String!, $first: Int!, $after: String) {
  ${RATE_LIMIT}
  search(type: REPOSITORY, query: $q, first: $first, after: $after) {
    repositoryCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Repository {
        nameWithOwner
        description
        stargazerCount
        pushedAt
        isArchived
        isFork
        isMirror
        licenseInfo { spdxId }
        primaryLanguage { name }
        gfi: issues(states: OPEN, labels: ${labelList(GOOD_FIRST_LABELS)}) { totalCount }
        hw: issues(states: OPEN, labels: ${labelList(HELP_WANTED_LABELS)}) { totalCount }
      }
    }
  }
}`;

export interface SearchNode {
  nameWithOwner: string;
  description: string | null;
  stargazerCount: number;
  pushedAt: string;
  isArchived: boolean;
  isFork: boolean;
  isMirror: boolean;
  licenseInfo: { spdxId: string | null } | null;
  primaryLanguage: { name: string } | null;
  gfi: { totalCount: number };
  hw: { totalCount: number };
}

export interface SearchData {
  search: {
    repositoryCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (SearchNode | Record<string, never> | null)[];
  };
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

const ACTOR = "author { __typename login }";

const DETAIL_FRAGMENT = `fragment RepoDetail on Repository {
  nameWithOwner
  name
  owner { login avatarUrl(size: 96) }
  description
  homepageUrl
  stargazerCount
  forkCount
  isArchived
  isFork
  isMirror
  createdAt
  pushedAt
  primaryLanguage { name }
  licenseInfo { spdxId }
  repositoryTopics(first: 20) { nodes { topic { name } } }
  defaultBranchRef { target { ... on Commit { committedDate } } }
${CONTRIBUTING_PATHS.map((p, i) => `  contributing${i}: object(expression: ${JSON.stringify(`HEAD:${p}`)}) { id }`).join("\n")}
  contributingGuidelines { url }
  codeOfConduct { key }
  gfi: issues(states: OPEN, labels: ${labelList(GOOD_FIRST_LABELS)}) { totalCount }
  hw: issues(states: OPEN, labels: ${labelList(HELP_WANTED_LABELS)}) { totalCount }
  gfiSample: issues(states: OPEN, labels: ${labelList(GOOD_FIRST_LABELS)}, first: ${GFI_SAMPLE}, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { assignees { totalCount } comments { totalCount } }
  }
}`;

/** Issues opened in this window (days ago) are sampled for the response time. */
export const RESPONSE_WINDOW_DAYS: [number, number] = [2, 90];

/**
 * Issue-search string for the response sample: issues old enough to have had
 * a fair chance of a reply, newest first. (Plain `issues(orderBy)` would only
 * return hours-old issues on busy repos.)
 */
export function responseSearchString(owner: string, name: string, now: Date): string {
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const [newest, oldest] = RESPONSE_WINDOW_DAYS;
  return `repo:${owner}/${name} is:issue created:${day(oldest)}..${day(newest)} sort:created-desc`;
}

export interface DetailRequest {
  owner: string;
  name: string;
  /** Also sample recent issues for the maintainer response time. */
  sampleResponse: boolean;
}

export const detailAlias = (i: number) => `r${i}`;
export const responseAlias = (i: number) => `s${i}`;

/**
 * One request for several repos, each under its own alias (r0, r1…), plus an
 * issue search (s0, s1…) for repos whose response time needs sampling.
 */
export function buildDetailQuery(repos: DetailRequest[], now: Date): string {
  const body = repos
    .map((r, i) => {
      const repo = `  ${detailAlias(i)}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) { ...RepoDetail }`;
      if (!r.sampleResponse) return repo;
      const q = JSON.stringify(responseSearchString(r.owner, r.name, now));
      return `${repo}
  ${responseAlias(i)}: search(type: ISSUE, query: ${q}, first: ${RESPONSE_SAMPLE}) {
    nodes {
      ... on Issue {
        createdAt
        authorAssociation
        ${ACTOR}
        comments(first: ${RESPONSE_COMMENTS}) { nodes { createdAt authorAssociation ${ACTOR} } }
      }
    }
  }`;
    })
    .join("\n");
  return `query {\n  ${RATE_LIMIT}\n${body}\n}\n${DETAIL_FRAGMENT}`;
}

export type DetailData = Record<string, DetailNode | { nodes: (ResponseIssue | null)[] } | null>;

interface Actor {
  __typename: string;
  login: string;
}

export interface ResponseIssue {
  createdAt: string;
  authorAssociation: string;
  author: Actor | null;
  comments: { nodes: ({ createdAt: string; authorAssociation: string; author: Actor | null } | null)[] };
}

export interface DetailNode {
  nameWithOwner: string;
  name: string;
  owner: { login: string; avatarUrl: string };
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isFork: boolean;
  isMirror: boolean;
  createdAt: string;
  pushedAt: string;
  primaryLanguage: { name: string } | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: ({ topic: { name: string } } | null)[] };
  defaultBranchRef: { target: { committedDate?: string } | null } | null;
  contributingGuidelines: { url: string } | null;
  codeOfConduct: { key: string } | null;
  gfi: { totalCount: number };
  hw: { totalCount: number };
  gfiSample: { nodes: ({ assignees: { totalCount: number }; comments: { totalCount: number } } | null)[] };
  [contributing: `contributing${number}`]: { id: string } | null;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/** Who may open an issue without it counting toward the sample. */
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
/**
 * Whose reply counts. CONTRIBUTOR (has merged code) is included because
 * org members with private membership show up as CONTRIBUTOR, not MEMBER.
 */
const RESPONDER = new Set(["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"]);
const isBot = (a: Actor | null) => !a || a.__typename === "Bot" || /\[bot\]$/i.test(a.login);

/** An issue with no maintainer reply after this long counts as a (capped) slow response. */
const UNANSWERED_AFTER_HOURS = 14 * 24;
const UNANSWERED_HOURS = 30 * 24;
/** Newer issues have had no fair chance of a reply yet. */
const MIN_AGE_HOURS = 48;
const MIN_SAMPLES = 3;

/**
 * Median hours to a maintainer's first comment on recent issues opened by
 * non-maintainers. Issues older than two weeks with no maintainer reply count
 * as 30 days; newer unanswered ones are skipped. Null with fewer than 3 samples.
 */
export function medianResponseHours(issues: (ResponseIssue | null)[], now: number): number | null {
  const samples: number[] = [];
  for (const issue of issues) {
    if (!issue?.createdAt || MAINTAINER.has(issue.authorAssociation) || isBot(issue.author)) continue;
    const opened = Date.parse(issue.createdAt);
    const age = (now - opened) / 3_600_000;
    if (!Number.isFinite(age) || age < MIN_AGE_HOURS) continue;
    const reply = (issue.comments?.nodes ?? []).find(
      (c) => c && RESPONDER.has(c.authorAssociation) && !isBot(c.author) && c.author?.login !== issue.author?.login,
    );
    if (reply) samples.push(Math.max(0, (Date.parse(reply.createdAt) - opened) / 3_600_000));
    else if (age >= UNANSWERED_AFTER_HOURS) samples.push(UNANSWERED_HOURS);
  }
  if (samples.length < MIN_SAMPLES) return null;
  samples.sort((a, b) => a - b);
  const mid = samples.length >> 1;
  const median = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
  return Math.round(median * 10) / 10;
}

export function normaliseLicense(spdxId: string | null | undefined): string | null {
  if (!spdxId) return null;
  return spdxId === "NOASSERTION" ? "other" : spdxId;
}

/** The repo's own CONTRIBUTING file (first of CONTRIBUTING_PATHS), else GitHub's pick, e.g. the org default. */
export function contributingUrl(node: DetailNode): string | null {
  const i = CONTRIBUTING_PATHS.findIndex((_, i) => node[`contributing${i}`]);
  if (i !== -1) return `https://github.com/${node.nameWithOwner}/blob/HEAD/${CONTRIBUTING_PATHS[i]}`;
  return node.contributingGuidelines?.url ?? null;
}

export function gfiSampleCounts(node: DetailNode): { sampled: number; unassigned: number; unanswered: number } {
  const nodes = (node.gfiSample?.nodes ?? []).filter((n): n is NonNullable<typeof n> => !!n);
  return {
    sampled: nodes.length,
    unassigned: nodes.filter((n) => n.assignees.totalCount === 0).length,
    unanswered: nodes.filter((n) => n.comments.totalCount === 0).length,
  };
}

/**
 * One collection run: search candidates per language × star bucket, rank them
 * cheaply, then fetch full details for the chosen few in aliased batches.
 * Scoring, curation flags and firstSeenAt are settled later by merge.ts.
 */
import { classifyRepo } from "../../../shared/classify.js";
import { LANGUAGES } from "../../../shared/dictionary.js";
import { resolveLanguage } from "../../../shared/parse.js";
import { MAX_REPOS, type RepoRecord } from "../../../shared/repo.js";
import { MAX_IDLE_DAYS, MIN_OPEN_ISSUES, MIN_STARS, scoreRepo } from "../../../shared/score.js";
import { isExcluded, type Curation } from "./curation.js";
import { GraphQLRequestError, RateLimitAbort, type GraphQLClient, type GraphQLResult } from "./graphql.js";
import { needsResponseSample } from "./merge.js";
import {
  buildDetailQuery,
  contributingUrl,
  detailAlias,
  responseAlias,
  gfiSampleCounts,
  medianResponseHours,
  normaliseLicense,
  SEARCH_PAGE_SIZE,
  SEARCH_QUERY,
  searchQueryString,
  STAR_BUCKETS,
  type DetailData,
  type DetailNode,
  type DetailRequest,
  type ResponseIssue,
  type SearchData,
  type SearchNode,
} from "./queries.js";

export interface CollectOptions {
  client: GraphQLClient;
  now: Date;
  curation: Curation;
  /** The current dataset, for response-sample reuse. */
  previous: RepoRecord[];
  /** Language ids to search (default: every dictionary language). */
  languages?: string[];
  /** Fetch exactly these repos (owner/name) and skip searching. */
  only?: string[];
  /** Max non-curated repos to detail (default MAX_REPOS). */
  limit?: number;
  /** Search pages (of 50) per language or language × star bucket. Default 2. */
  maxPagesPerQuery?: number;
  /** Candidates guaranteed per language before the global ranking fills the rest. Default 10. */
  minPerLanguage?: number;
  /** Repos per detail request. Default 6 (bigger batches hit GitHub 502/504 timeouts more often). */
  batchSize?: number;
  /** Requests in flight at once (searches, detail batches). Default 3, gentle on secondary limits. */
  concurrency?: number;
  log?: (msg: string) => void;
}

export interface Candidate {
  fullName: string;
  language: string;
  prescore: number;
}

export interface CollectResult {
  records: RepoRecord[];
  /** Unique repos seen in search results. */
  searched: number;
  /** Repos that passed the cheap pre-filter. */
  candidates: number;
  /** Requested repos that couldn't be fetched (renamed, deleted, errors). */
  missing: string[];
}

const DAY_MS = 86_400_000;

export async function collect(opts: CollectOptions): Promise<CollectResult> {
  const log = opts.log ?? (() => {});
  const concurrency = opts.concurrency ?? 3;
  const now = opts.now.getTime();
  const prevByName = new Map(opts.previous.map((r) => [r.fullName.toLowerCase(), r]));

  let names: string[];
  let searched = 0;
  let candidates = 0;
  if (opts.only?.length) {
    names = opts.only;
  } else {
    const languages = opts.languages?.length ? opts.languages : LANGUAGES.map((l) => l.id);
    const defs = languages.map((id) => {
      const def = LANGUAGES.find((l) => l.id === id);
      if (!def) throw new Error(`unknown language id "${id}"`);
      return def;
    });
    const perLanguage = await mapLimit(defs, concurrency, async (def) => {
      const nodes = await searchLanguage(opts.client, def.qualifier, opts.now, opts.maxPagesPerQuery ?? 2);
      log(`search ${def.id}: ${nodes.length} results (${opts.client.pointsUsed} points so far)`);
      return nodes;
    });
    // Merged in language order, so the outcome doesn't depend on which request finished first.
    const found = new Map<string, { node: SearchNode; language: string }>();
    perLanguage.forEach((nodes, i) => {
      for (const node of nodes) {
        const k = node.nameWithOwner.toLowerCase();
        const language = resolveLanguage(node.primaryLanguage?.name ?? "") ?? defs[i].id;
        if (!found.has(k)) found.set(k, { node, language });
      }
    });
    searched = found.size;
    const pool = [...found.values()]
      .filter(({ node }) => passesPrefilter(node, now) && !isExcluded(opts.curation, node.nameWithOwner))
      .map(({ node, language }) => ({ fullName: node.nameWithOwner, language, prescore: prescore(node, now) }));
    candidates = pool.length;
    names = selectCandidates(pool, opts.limit ?? MAX_REPOS, opts.minPerLanguage ?? 10).map((c) => c.fullName);
    const chosen = new Set(names.map((n) => n.toLowerCase()));
    for (const inc of opts.curation.include) {
      if (!chosen.has(inc.repo.toLowerCase()) && !isExcluded(opts.curation, inc.repo)) names.push(inc.repo);
    }
  }

  const requests: DetailRequest[] = names.map((fullName) => {
    const [owner, name] = fullName.split("/");
    return { owner, name, sampleResponse: needsResponseSample(prevByName.get(fullName.toLowerCase()), now) };
  });
  const size = opts.batchSize ?? 6;
  const batches: DetailRequest[][] = [];
  for (let i = 0; i < requests.length; i += size) batches.push(requests.slice(i, i + size));
  let done = 0;
  const results = await mapLimit(batches, concurrency, async (batch) => {
    const out: RepoRecord[] = [];
    const missing: string[] = [];
    await fetchDetails(opts.client, batch, opts.now, out, missing, log);
    done += batch.length;
    if (done === requests.length || Math.floor(done / 100) !== Math.floor((done - batch.length) / 100)) {
      log(`details: ${done}/${requests.length} (${opts.client.pointsUsed} points)`);
    }
    return { out, missing };
  });
  return {
    records: results.flatMap((r) => r.out),
    searched,
    candidates,
    missing: results.flatMap((r) => r.missing),
  };
}

/** `fn` over `items` with at most `limit` in flight; results keep the input order. The first failure rejects. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Search one language: a single query when its results fit in `maxPages`, else one per star bucket. */
export async function searchLanguage(
  client: GraphQLClient,
  qualifier: string,
  now: Date,
  maxPages: number,
): Promise<SearchNode[]> {
  const pushedSince = new Date(now.getTime() - MAX_IDLE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const first = await searchPages(client, searchQueryString(qualifier, null, pushedSince), maxPages);
  if (first.total <= first.nodes.length) return first.nodes;
  const nodes = [...first.nodes];
  for (const bucket of STAR_BUCKETS) {
    const page = await searchPages(client, searchQueryString(qualifier, bucket, pushedSince), maxPages);
    nodes.push(...page.nodes);
  }
  return nodes;
}

/** Follow `endCursor` for up to `maxPages` pages. */
export async function searchPages(
  client: GraphQLClient,
  q: string,
  maxPages: number,
): Promise<{ total: number; nodes: SearchNode[] }> {
  const nodes: SearchNode[] = [];
  let after: string | null = null;
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const res: GraphQLResult<SearchData> = await client.query<SearchData>(SEARCH_QUERY, {
      q,
      first: SEARCH_PAGE_SIZE,
      after,
    });
    const search: SearchData["search"] = res.data!.search;
    total = search.repositoryCount;
    for (const n of search.nodes) if (n && "nameWithOwner" in n) nodes.push(n as SearchNode);
    if (!search.pageInfo.hasNextPage || !search.pageInfo.endCursor) break;
    after = search.pageInfo.endCursor;
  }
  return { total, nodes };
}

export function passesPrefilter(n: SearchNode, now: number): boolean {
  return (
    !n.isArchived &&
    !n.isFork &&
    !n.isMirror &&
    !!normaliseLicense(n.licenseInfo?.spdxId) &&
    n.stargazerCount >= MIN_STARS &&
    n.gfi.totalCount + n.hw.totalCount >= MIN_OPEN_ISSUES &&
    now - Date.parse(n.pushedAt) <= MAX_IDLE_DAYS * DAY_MS
  );
}

/** The real score with guesses for what search results don't carry (neutral response, 70% claimable, no docs). */
export function prescore(n: SearchNode, now: number): number {
  const sampled = Math.min(n.gfi.totalCount, 20);
  return scoreRepo(
    {
      archived: false,
      fork: false,
      mirror: false,
      license: "x",
      lastCommitAt: n.pushedAt,
      goodFirstIssues: n.gfi.totalCount,
      helpWanted: n.hw.totalCount,
      gfiSampled: sampled,
      gfiUnassigned: Math.round(sampled * 0.7),
      responseHours: null,
      contributingUrl: null,
      hasCodeOfConduct: false,
      description: n.description,
      stars: n.stargazerCount,
      curated: false,
    },
    now,
  ).score;
}

/** Top `minPerLanguage` of every language first, then the best of the rest, up to `limit`. */
export function selectCandidates(pool: Candidate[], limit: number, minPerLanguage: number): Candidate[] {
  const ranked = [...pool].sort(
    (a, b) => b.prescore - a.prescore || (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1),
  );
  const chosen: Candidate[] = [];
  const taken = new Set<string>();
  const perLanguage = new Map<string, number>();
  for (const c of ranked) {
    if (chosen.length >= limit) break;
    const n = perLanguage.get(c.language) ?? 0;
    if (n >= minPerLanguage) continue;
    perLanguage.set(c.language, n + 1);
    chosen.push(c);
    taken.add(c.fullName);
  }
  for (const c of ranked) {
    if (chosen.length >= limit) break;
    if (!taken.has(c.fullName)) chosen.push(c);
  }
  return chosen;
}

/** Fetch one batch; on a hard failure split it, down to single repos, so one bad repo can't sink the rest. */
async function fetchDetails(
  client: GraphQLClient,
  batch: DetailRequest[],
  now: Date,
  out: RepoRecord[],
  missing: string[],
  log: (msg: string) => void,
): Promise<void> {
  let data: DetailData | null;
  try {
    ({ data } = await client.query<DetailData>(buildDetailQuery(batch, now)));
  } catch (err) {
    if (err instanceof RateLimitAbort || !(err instanceof GraphQLRequestError)) throw err;
    if (batch.length > 1) {
      const mid = batch.length >> 1;
      await fetchDetails(client, batch.slice(0, mid), now, out, missing, log);
      await fetchDetails(client, batch.slice(mid), now, out, missing, log);
      return;
    }
    log(`skipping ${batch[0].owner}/${batch[0].name}: ${err.message}`);
    missing.push(`${batch[0].owner}/${batch[0].name}`);
    return;
  }
  batch.forEach((req, i) => {
    const node = data?.[detailAlias(i)] as DetailNode | null | undefined;
    const issues = (data?.[responseAlias(i)] as { nodes: (ResponseIssue | null)[] } | null | undefined)?.nodes;
    if (!node) missing.push(`${req.owner}/${req.name}`);
    // A failed issue search leaves the response time unsampled (reused or retried next run).
    else out.push(toRecord(node, now, req.sampleResponse && issues ? issues : null));
  });
}

/** `responseIssues`: the response-time sample, or null when it wasn't taken this run. */
export function toRecord(node: DetailNode, now: Date, responseIssues: (ResponseIssue | null)[] | null): RepoRecord {
  const nowIso = now.toISOString();
  const topics = (node.repositoryTopics?.nodes ?? []).flatMap((n) => (n ? [n.topic.name] : []));
  const sample = gfiSampleCounts(node);
  const languageName = node.primaryLanguage?.name ?? null;
  const [owner, name] = node.nameWithOwner.split("/");
  return {
    fullName: node.nameWithOwner,
    owner,
    name,
    description: node.description?.trim() || null,
    homepage: node.homepageUrl?.trim() || null,
    avatarUrl: node.owner.avatarUrl,
    language: (languageName && resolveLanguage(languageName)) || null,
    languageName,
    topics,
    stars: node.stargazerCount,
    forks: node.forkCount,
    license: normaliseLicense(node.licenseInfo?.spdxId),
    archived: node.isArchived,
    fork: node.isFork,
    mirror: node.isMirror,
    lastCommitAt: node.defaultBranchRef?.target?.committedDate ?? node.pushedAt,
    createdAt: node.createdAt,
    contributingUrl: contributingUrl(node),
    hasCodeOfConduct: !!node.codeOfConduct,
    goodFirstIssues: node.gfi.totalCount,
    helpWanted: node.hw.totalCount,
    gfiSampled: sample.sampled,
    gfiUnassigned: sample.unassigned,
    gfiUnanswered: sample.unanswered,
    responseHours: responseIssues ? medianResponseHours(responseIssues, now.getTime()) : null,
    responseSampledAt: responseIssues ? nowIso : null,
    fields: classifyRepo({ name: node.name, description: node.description, topics }),
    curated: false,
    firstSeenAt: nowIso,
    score: 0,
    scoreParts: { supply: 0, activity: 0, response: 0, onboarding: 0, claimable: 0, reach: 0 },
    firstPrFriendly: false,
  };
}

import { TTLCache } from "../cache.js";
import type { Issue, RateLimitInfo, SortMode } from "../types.js";
import { annotateLinkedPrs, clearLinkedPrCache } from "./linkedPrs.js";
import { normalizeItem, type GhSearchItem } from "./normalize.js";
import { sortParams } from "./query.js";

const API = "https://api.github.com";
export const PER_PAGE = 20;
const SEARCH_TTL = 5 * 60 * 1000;
const REPO_TTL = 60 * 60 * 1000;
const ENRICH_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 8000;

export interface GithubResult {
  total: number;
  items: Issue[];
  rateLimit?: RateLimitInfo;
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status: number,
    public rateLimit?: RateLimitInfo,
  ) {
    super(message);
  }
}

const searchCache = new TTLCache<GithubResult>(SEARCH_TTL);
const repoCache = new TTLCache<{ stars: number; language?: string } | null>(REPO_TTL, 2000);

export function clearGithubCaches(): void {
  searchCache.clear();
  repoCache.clear();
  clearLinkedPrCache();
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "opensrc",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function readRateLimit(res: Response): RateLimitInfo | undefined {
  const num = (k: string) => {
    const v = res.headers.get(k);
    return v == null ? undefined : Number(v);
  };
  const info = {
    limit: num("x-ratelimit-limit"),
    remaining: num("x-ratelimit-remaining"),
    reset: num("x-ratelimit-reset"),
  };
  return info.limit === undefined && info.remaining === undefined ? undefined : info;
}

export async function searchIssues(
  githubQuery: string,
  opts: { page: number; sort: SortMode; order?: "asc" | "desc"; token?: string; fetchImpl?: typeof fetch },
): Promise<GithubResult> {
  const cacheKey = `${githubQuery}|${opts.page}|${opts.sort}|${opts.order ?? ""}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const f = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ q: githubQuery, per_page: String(PER_PAGE), page: String(opts.page) });
  const { sort, order } = sortParams(opts.sort);
  if (sort) params.set("sort", sort);
  // `order` only means something alongside an explicit sort (not for best match).
  if (sort) params.set("order", opts.order ?? order ?? "desc");

  const res = await f(`${API}/search/issues?${params}`, {
    headers: headers(opts.token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const rateLimit = readRateLimit(res);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GithubError(`GitHub search failed: ${res.status} ${body.slice(0, 200)}`, res.status, rateLimit);
  }
  const data = (await res.json()) as { total_count: number; items: GhSearchItem[] };
  const items = data.items.map(normalizeItem);

  if (opts.token) {
    await Promise.all([
      enrichRepos(items, opts.token, f),
      annotateLinkedPrs(
        items,
        data.items.map((i) => i.node_id),
        opts.token,
        f,
      ),
    ]);
  }

  const result: GithubResult = { total: data.total_count, items, rateLimit };
  searchCache.set(cacheKey, result);
  return result;
}

/** Fill repo stars/language for unique repos (bounded concurrency, 1h cache). Failures are ignored. */
export async function enrichRepos(items: Issue[], token: string, f: typeof fetch = fetch): Promise<void> {
  const names = [...new Set(items.map((i) => i.repo.fullName))];
  const missing = names.filter((n) => repoCache.get(n) === undefined);

  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const name = missing[next++];
      try {
        const res = await f(`${API}/repos/${name}`, { headers: headers(token), signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          repoCache.set(name, null, 5 * 60 * 1000);
          continue;
        }
        const r = (await res.json()) as { stargazers_count: number; language?: string | null };
        repoCache.set(name, { stars: r.stargazers_count, language: r.language ?? undefined });
      } catch {
        /* network/timeout: leave uncached so a later request can retry */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, missing.length) }, worker));

  for (const item of items) {
    const info = repoCache.get(item.repo.fullName);
    if (info) {
      item.repo.stars = info.stars;
      if (info.language) item.repo.language = info.language;
    }
  }
}

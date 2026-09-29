/**
 * A small GitHub GraphQL client for the collector: injectable fetch, retries
 * with backoff, and rate-limit bookkeeping. It stops cleanly (RateLimitAbort)
 * before the budget drops below `minRemaining`, so a run never drains the
 * token and a partial run can be thrown away whole.
 */

export const GRAPHQL_URL = "https://api.github.com/graphql";

export interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: string | null;
}

export interface GraphQLErrorItem {
  message: string;
  type?: string;
  path?: (string | number)[];
}

export interface GraphQLResult<T> {
  data: T | null;
  /** Non-fatal errors (e.g. NOT_FOUND for one aliased repo). */
  errors: GraphQLErrorItem[];
}

/** The budget ran low (or GitHub said we're out). Callers must write nothing. */
export class RateLimitAbort extends Error {
  constructor(
    message: string,
    public rateLimit: RateLimitState | null,
  ) {
    super(message);
    this.name = "RateLimitAbort";
  }
}

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: GraphQLErrorItem[] = [],
  ) {
    super(message);
    this.name = "GraphQLRequestError";
  }
}

export interface GraphQLClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  /** Stop before sending a request when fewer points than this remain. Default 200. */
  minRemaining?: number;
  /** Extra attempts after the first for network errors, 5xx and secondary rate limits. Default 3. */
  retries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 90_000;

export class GraphQLClient {
  /** Sum of `rateLimit.cost` over every successful request. */
  pointsUsed = 0;
  requests = 0;
  rateLimit: RateLimitState | null = null;

  private readonly f: typeof fetch;
  private readonly minRemaining: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: GraphQLClientOptions) {
    this.f = opts.fetchImpl ?? fetch;
    this.minRemaining = opts.minRemaining ?? 200;
    this.retries = opts.retries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.log = opts.log ?? (() => {});
  }

  /**
   * Run one query. Every query should select `rateLimit { cost remaining limit resetAt }`
   * so the budget is tracked precisely; response headers are the fallback.
   */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResult<T>> {
    let attempt = 0;
    for (;;) {
      this.checkBudget();
      let res: Response;
      try {
        res = await this.f(GRAPHQL_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.opts.token}`,
            "Content-Type": "application/json",
            "User-Agent": "opensrc-collector",
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt++ < this.retries) {
          this.log(`network error (${(err as Error).message}), retrying`);
          await this.sleep(backoff(attempt));
          continue;
        }
        throw err;
      }
      this.requests++;
      this.readHeaders(res);

      if (res.status === 401) throw new GraphQLRequestError("GitHub rejected the token (401)", 401);
      if (res.status === 403 || res.status === 429) {
        const body = await res.text().catch(() => "");
        if (this.rateLimit?.remaining === 0 && !/secondary/i.test(body)) {
          throw new RateLimitAbort("GitHub rate limit exhausted", this.rateLimit);
        }
        if (attempt++ < this.retries) {
          const wait = retryAfterMs(res) ?? backoff(attempt) * 10;
          this.log(`secondary rate limit, waiting ${Math.round(wait / 1000)}s`);
          await this.sleep(Math.min(wait, MAX_RETRY_AFTER_MS));
          continue;
        }
        throw new GraphQLRequestError(`GitHub refused the request (${res.status}): ${body.slice(0, 200)}`, res.status);
      }
      if (RETRYABLE_STATUS.has(res.status)) {
        if (attempt++ < this.retries) {
          this.log(`GitHub ${res.status}, retrying`);
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new GraphQLRequestError(`GitHub GraphQL failed with ${res.status}`, res.status);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GraphQLRequestError(`GitHub GraphQL failed with ${res.status}: ${body.slice(0, 200)}`, res.status);
      }

      let body: { data?: T | null; errors?: GraphQLErrorItem[] };
      try {
        body = JSON.parse(await res.text()) as typeof body;
      } catch {
        // Truncated or empty body (seen on slow queries): retry, then fail like a 5xx.
        if (attempt++ < this.retries) {
          this.log("unreadable response body, retrying");
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new GraphQLRequestError("GitHub GraphQL returned an unreadable body", res.status);
      }
      const errors = body.errors ?? [];
      if (errors.some((e) => e.type === "RATE_LIMITED")) {
        throw new RateLimitAbort("GitHub GraphQL rate limit reached", this.rateLimit);
      }
      const data = body.data ?? null;
      this.readBody(data);
      if (!data) {
        // No data at all: the query itself failed (syntax, complexity, timeout). Retry transient ones.
        const transient = errors.some((e) => /timeout|something went wrong|try again/i.test(e.message));
        if (transient && attempt++ < this.retries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new GraphQLRequestError(
          `GraphQL error: ${errors.map((e) => e.message).join("; ") || "no data"}`,
          res.status,
          errors,
        );
      }
      return { data, errors };
    }
  }

  private checkBudget(): void {
    if (this.rateLimit && this.rateLimit.remaining < this.minRemaining) {
      throw new RateLimitAbort(
        `stopping: ${this.rateLimit.remaining} GraphQL points left (floor ${this.minRemaining}), resets ${this.rateLimit.resetAt ?? "soon"}`,
        this.rateLimit,
      );
    }
  }

  private readHeaders(res: Response): void {
    const remaining = numHeader(res, "x-ratelimit-remaining");
    const limit = numHeader(res, "x-ratelimit-limit");
    const reset = numHeader(res, "x-ratelimit-reset");
    if (remaining === undefined) return;
    this.rateLimit = {
      remaining,
      limit: limit ?? this.rateLimit?.limit ?? 5000,
      resetAt: reset !== undefined ? new Date(reset * 1000).toISOString() : (this.rateLimit?.resetAt ?? null),
    };
  }

  private readBody(data: unknown): void {
    const rl = (data as { rateLimit?: { cost?: number; remaining?: number; limit?: number; resetAt?: string } } | null)
      ?.rateLimit;
    if (!rl) return;
    if (typeof rl.cost === "number") this.pointsUsed += rl.cost;
    if (typeof rl.remaining === "number") {
      this.rateLimit = {
        remaining: rl.remaining,
        limit: rl.limit ?? this.rateLimit?.limit ?? 5000,
        resetAt: rl.resetAt ?? this.rateLimit?.resetAt ?? null,
      };
    }
  }
}

function backoff(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

function numHeader(res: Response, name: string): number | undefined {
  const v = res.headers.get(name);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function retryAfterMs(res: Response): number | undefined {
  const s = numHeader(res, "retry-after");
  return s === undefined ? undefined : s * 1000;
}

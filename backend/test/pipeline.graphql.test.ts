import { describe, expect, it, vi } from "vitest";
import { GraphQLClient, GraphQLRequestError, RateLimitAbort } from "../src/pipeline/graphql.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const ok = (remaining = 4000, cost = 2) =>
  json({ data: { rateLimit: { cost, remaining, limit: 5000, resetAt: "x" } } });
const noSleep = () => Promise.resolve();

describe("GraphQLClient", () => {
  it("tracks points used and the remaining budget", async () => {
    const f = vi.fn(async () => ok(4000, 3));
    const client = new GraphQLClient({ token: "t", fetchImpl: f as unknown as typeof fetch, sleep: noSleep });
    await client.query("{ rateLimit { cost } }");
    await client.query("{ rateLimit { cost } }");
    expect(client.pointsUsed).toBe(6);
    expect(client.rateLimit?.remaining).toBe(4000);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("retries 5xx and network errors with backoff", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const client = new GraphQLClient({ token: "t", fetchImpl: f, sleep });
    const res = await client.query("{ x }");
    expect(res.data).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    const client = new GraphQLClient({ token: "t", fetchImpl: f, sleep: noSleep, retries: 2 });
    await expect(client.query("{ x }")).rejects.toBeInstanceOf(GraphQLRequestError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("stops cleanly before the budget drops below the floor", async () => {
    const f = vi.fn(async () => ok(150));
    const client = new GraphQLClient({ token: "t", fetchImpl: f, sleep: noSleep });
    await client.query("{ x }"); // learns remaining = 150
    await expect(client.query("{ x }")).rejects.toBeInstanceOf(RateLimitAbort);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("aborts on GraphQL RATE_LIMITED and on an exhausted primary limit", async () => {
    const limited = vi.fn(async () => json({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }));
    await expect(
      new GraphQLClient({ token: "t", fetchImpl: limited, sleep: noSleep }).query("{ x }"),
    ).rejects.toBeInstanceOf(RateLimitAbort);

    const exhausted = vi.fn(async () =>
      json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" }),
    );
    await expect(
      new GraphQLClient({ token: "t", fetchImpl: exhausted, sleep: noSleep }).query("{ x }"),
    ).rejects.toBeInstanceOf(RateLimitAbort);
  });

  it("waits out secondary rate limits using retry-after", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        json({ message: "You have exceeded a secondary rate limit" }, 403, {
          "retry-after": "7",
          "x-ratelimit-remaining": "3000",
        }),
      )
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    await new GraphQLClient({ token: "t", fetchImpl: f, sleep }).query("{ x }");
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("returns partial data with errors (e.g. one repo not found), and throws when there is no data", async () => {
    const partial = vi.fn(async () =>
      json({
        data: { r0: null, rateLimit: { cost: 1, remaining: 4000 } },
        errors: [{ type: "NOT_FOUND", message: "nope" }],
      }),
    );
    const res = await new GraphQLClient({ token: "t", fetchImpl: partial, sleep: noSleep }).query("{ x }");
    expect(res.errors).toHaveLength(1);

    const broken = vi.fn(async () => json({ errors: [{ message: "Parse error on ')'" }] }));
    await expect(new GraphQLClient({ token: "t", fetchImpl: broken, sleep: noSleep }).query("{ x }")).rejects.toThrow(
      /Parse error/,
    );
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("retries a truncated body, then fails with a request error", async () => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    await expect(
      new GraphQLClient({ token: "t", fetchImpl: f, sleep: noSleep, retries: 1 }).query("{ x }"),
    ).rejects.toBeInstanceOf(GraphQLRequestError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected token", async () => {
    const f = vi.fn(async () => new Response("", { status: 401 }));
    await expect(new GraphQLClient({ token: "bad", fetchImpl: f, sleep: noSleep }).query("{ x }")).rejects.toThrow(
      /401/,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });
});

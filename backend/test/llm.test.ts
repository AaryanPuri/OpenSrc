import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK: every `new Anthropic(opts)` records opts and shares one `messages.create` mock.
const { create, ctor } = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
    constructor(opts: unknown) {
      ctor(opts);
    }
  },
}));

import { domainMatchById, emptyQuery, parseQuery as parseRules, toQueryText } from "../../shared/parse.js";
import { createApp } from "../src/app.js";
import { clearParseCache, parseQuery } from "../src/parse/index.js";
import { buildLlmRequest, coerceLlmOutput, DEFAULT_MODEL, LLM_TIMEOUT_MS, LlmParseError } from "../src/parse/llm.js";

const env = { ANTHROPIC_API_KEY: "sk-test" };

function toolResponse(input: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Here you go." },
      { type: "tool_use", id: "toolu_1", name: "record_query", input },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  };
}

const goodInput = {
  languages: ["rust"],
  domains: ["databases"],
  difficulty: "beginner",
  types: ["bug"],
  keywords: ["tokio"],
  maxComments: null,
  since: "none",
};
const databases = domainMatchById("databases")!;

beforeEach(() => {
  clearParseCache();
  create.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LLM request shape (claude-api skill: strict tool + forced tool_choice)", () => {
  it("forces the record_query tool with a strict, closed schema on Haiku 4.5", () => {
    const req = buildLlmRequest("rust databases", DEFAULT_MODEL);
    expect(req.model).toBe("claude-haiku-4-5");
    expect(req.tool_choice).toEqual({ type: "tool", name: "record_query", disable_parallel_tool_use: true });
    expect(req.messages).toEqual([{ role: "user", content: "rust databases" }]);
    expect(req.tools).toHaveLength(1);
    const tool = req.tools![0] as { name: string; strict?: boolean; input_schema: Record<string, unknown> };
    expect(tool.name).toBe("record_query");
    expect(tool.strict).toBe(true);
    const schema = tool.input_schema as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { enum?: unknown[] }>;
    };
    expect(schema.type).toBe("object");
    // Strict mode: additionalProperties:false and every property required.
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.properties.difficulty.enum).toEqual(["beginner", "help-wanted", "intermediate", "none"]);
    // Activity filters from the shared parser are part of the schema too.
    expect(schema.properties.since.enum).toEqual(["week", "month", "year", "none"]);
    expect(schema.properties.maxComments).toMatchObject({ anyOf: [{ type: "integer" }, { type: "null" }] });
    // Languages and domains are limited to the shared dictionary's ids.
    expect(schema.properties.languages).toMatchObject({ items: { enum: expect.arrayContaining(["rust", "cpp"]) } });
    // No constructs strict mode rejects (numeric/string length constraints).
    expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum|minLength|maxLength|maxItems/);
  });

  it("uses tool_choice auto for models that reject forced tool use", () => {
    expect(buildLlmRequest("x", "claude-opus-5-5").tool_choice).toEqual({
      type: "auto",
      disable_parallel_tool_use: true,
    });
    expect(buildLlmRequest("x", "claude-fable-5-1").tool_choice).toMatchObject({ type: "auto" });
    expect(buildLlmRequest("x", "claude-opus-5").tool_choice).toMatchObject({ type: "tool" });
  });
});

describe("parseQuery with ANTHROPIC_API_KEY", () => {
  it("returns the LLM parse on a successful tool call", async () => {
    create.mockResolvedValue(toolResponse(goodInput));
    const p = await parseQuery("easy rust database bugs with tokio", { ANTHROPIC_API_KEY: "sk-ctor" });
    expect(p).toEqual({
      ...emptyQuery("easy rust database bugs with tokio"),
      languages: ["rust"],
      domains: [databases],
      difficulty: "beginner",
      types: ["bug"],
      keywords: ["tokio"],
      interpretedBy: "llm",
    });
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-ctor", maxRetries: 0, timeout: LLM_TIMEOUT_MS }),
    );
    const [params, options] = create.mock.calls[0];
    expect(params.model).toBe("claude-haiku-4-5");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("honours ANTHROPIC_MODEL", async () => {
    create.mockResolvedValue(toolResponse(goodInput));
    await parseQuery("rust", { ...env, ANTHROPIC_MODEL: "claude-sonnet-5" });
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5");
  });

  it("cleans garbage fields from the tool input", async () => {
    create.mockResolvedValue(
      toolResponse({
        languages: ["Golang", "cpp", "klingon", 42, ""],
        domains: ["databases", "databases", "not-a-domain", null],
        difficulty: "impossible",
        types: ["bug", "chore", "bug"],
        keywords: ['"React"', "react", "x".repeat(41), "", "a", "b"],
        maxComments: -3,
        since: "decade",
        extra: "ignored",
      }),
    );
    const p = await parseQuery("garbage please", env);
    expect(p).toEqual({
      ...emptyQuery("garbage please"),
      languages: ["go", "cpp"],
      domains: [databases],
      difficulty: null,
      types: ["bug"],
      keywords: ["react", "a", "b"],
      interpretedBy: "llm",
    });
  });

  it("maps maxComments/since, clamps huge ceilings, and keeps rules-only bits (qualifiers, missed activity)", async () => {
    create.mockResolvedValueOnce(toolResponse({ ...goodInput, maxComments: 5000.7, since: "week" }));
    const a = await parseQuery("rust db stuff nobody touched lately", env);
    expect(a).toMatchObject({ maxComments: 999, since: "week" });

    // Model left activity out, but the text is explicit: the deterministic rules values fill in.
    create.mockResolvedValueOnce(toolResponse(goodInput));
    const b = await parseQuery("rust fewer than 4 comments this month repo:tokio-rs/tokio", env);
    expect(b).toMatchObject({ maxComments: 4, since: "month", qualifiers: ["repo:tokio-rs/tokio"] });
  });

  it("an LLM parse round-trips through the shared toQueryText (so chip removal works in the UI)", async () => {
    create.mockResolvedValue(
      toolResponse({
        languages: ["rust", "cpp"],
        domains: ["databases", "testing"],
        difficulty: "help-wanted",
        types: ["bug", "tests"],
        keywords: ["tokio", "friendly"],
        maxComments: 0,
        since: "month",
      }),
    );
    const p = await parseQuery("stuff nobody has looked at in rust or c++ storage", env);
    const again = parseRules(toQueryText(p));
    const pick = (x: typeof again) => ({
      languages: x.languages,
      domains: x.domains.map((d) => d.id),
      difficulty: x.difficulty,
      types: x.types,
      keywords: x.keywords,
      maxComments: x.maxComments,
      since: x.since,
    });
    expect(pick(again)).toEqual(pick(p));
  });

  it.each([
    ["a non-object tool input", toolResponse("rust databases")],
    ["an array tool input", toolResponse([goodInput])],
    [
      "no tool_use block",
      { ...toolResponse(goodInput), content: [{ type: "text", text: "Sorry." }], stop_reason: "end_turn" },
    ],
    [
      "a tool call with another name",
      { ...toolResponse(goodInput), content: [{ type: "tool_use", id: "t", name: "other", input: goodInput }] },
    ],
    ["stop_reason max_tokens", toolResponse(goodInput, { stop_reason: "max_tokens" })],
    ["stop_reason refusal", toolResponse(goodInput, { stop_reason: "refusal" })],
  ])("rejects %s and falls back to rules", async (_name, response) => {
    create.mockResolvedValue(response);
    const p = await parseQuery("beginner friendly rust issues in databases", env);
    expect(p.interpretedBy).toBe("rules");
    expect(p.languages).toEqual(["rust"]);
    expect(p.difficulty).toBe("beginner");
  });

  it("falls back to rules on an API error", async () => {
    create.mockRejectedValue(Object.assign(new Error("529 Overloaded"), { status: 529 }));
    const p = await parseQuery("golang kubernetes", env);
    expect(p.interpretedBy).toBe("rules");
    expect(p.languages).toEqual(["go"]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("falls back to rules at the 4s deadline and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    create.mockImplementation((_params: unknown, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise(() => {}); // never settles on its own
    });

    let settled = false;
    const pending = parseQuery("python data science", env).then((p) => {
      settled = true;
      return p;
    });
    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const p = await pending;
    expect(p.interpretedBy).toBe("rules");
    expect(p.languages).toEqual(["python"]);
    expect(signal?.aborted).toBe(true);
  });

  it("caches successful parses by normalized query", async () => {
    create.mockResolvedValue(toolResponse(goodInput));
    const a = await parseQuery("Rust  Databases!", env);
    const b = await parseQuery("rust databases", env);
    expect(b).toEqual(a);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("caches a rules fallback only briefly, then retries the LLM", async () => {
    vi.useFakeTimers();
    create.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(toolResponse(goodInput));
    expect((await parseQuery("rust cache retry", env)).interpretedBy).toBe("rules");
    expect((await parseQuery("rust cache retry", env)).interpretedBy).toBe("rules");
    expect(create).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    expect((await parseQuery("rust cache retry", env)).interpretedBy).toBe("llm");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("never calls the LLM without a key or for an empty query", async () => {
    expect((await parseQuery("rust databases", {})).interpretedBy).toBe("rules");
    expect((await parseQuery("   ", env)).interpretedBy).toBe("rules");
    expect(create).not.toHaveBeenCalled();
  });

  it("does not let a rules-only cached result mask the LLM parse", async () => {
    create.mockResolvedValue(toolResponse(goodInput));
    expect((await parseQuery("rust mask test", {})).interpretedBy).toBe("rules");
    expect((await parseQuery("rust mask test", env)).interpretedBy).toBe("llm");
  });
});

describe("endpoints with an API key", () => {
  it("/api/health reports llm: true and /api/parse returns the LLM parse", async () => {
    create.mockResolvedValue(toolResponse(goodInput));
    const app = createApp({ env });
    expect(await (await app.request("/api/health")).json()).toMatchObject({ llm: true });
    const body = await (await app.request("/api/parse?q=endpoint%20llm")).json();
    expect(body.interpretedBy).toBe("llm");
  });
});

describe("coerceLlmOutput", () => {
  it("throws LlmParseError for non-object input", () => {
    expect(() => coerceLlmOutput(null)).toThrow(LlmParseError);
    expect(() => coerceLlmOutput("x")).toThrow(LlmParseError);
  });
  it("tolerates missing fields", () => {
    expect(coerceLlmOutput({})).toEqual(emptyQuery());
  });
});

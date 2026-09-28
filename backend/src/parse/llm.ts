import Anthropic from "@anthropic-ai/sdk";
import { DOMAINS, LANGUAGES } from "../../../shared/dictionary.js";
import { MAX_COMMENTS, domainMatchById, emptyQuery, resolveLanguage } from "../../../shared/parse.js";
import type { Difficulty, IssueType, ParsedQuery, Since } from "../../../shared/types.js";

export const DEFAULT_MODEL = "claude-haiku-4-5";
export const LLM_TIMEOUT_MS = 4000;

const DIFFICULTIES: Difficulty[] = ["beginner", "help-wanted", "intermediate"];
const TYPES: IssueType[] = ["bug", "docs", "feature", "tests"];
const SINCES: Since[] = ["week", "month", "year"];

const TOOL: Anthropic.Tool = {
  name: "record_query",
  description: "Record the structured interpretation of an open-source issue search query.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["languages", "domains", "difficulty", "types", "keywords", "maxComments", "since"],
    properties: {
      languages: {
        type: "array",
        items: { type: "string", enum: LANGUAGES.map((l) => l.id) },
        description:
          "Programming languages explicitly named or strongly implied, as ids from the allowed list. Empty if none.",
      },
      domains: {
        type: "array",
        items: { type: "string", enum: DOMAINS.map((d) => d.id) },
        description: "Problem domains the user cares about, chosen from the allowed ids.",
      },
      difficulty: {
        type: "string",
        enum: [...DIFFICULTIES, "none"],
        description:
          "beginner (good first issue / easy / newcomer), help-wanted, intermediate (harder/advanced), or none if unstated.",
      },
      types: {
        type: "array",
        items: { type: "string", enum: TYPES },
        description: "Kinds of issue requested (bug, docs, feature, tests). Empty if unstated.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "At most 3 short, specific search keywords not already captured above (e.g. library or framework names like 'react'). Never filler words like 'issues' or 'projects'.",
      },
      maxComments: {
        anyOf: [{ type: "integer" }, { type: "null" }],
        description:
          "Comment ceiling: 0 for 'no comments' / 'unanswered' / 'nobody has replied', N for 'fewer than N comments' / 'under N comments'. null if the user did not ask about comments.",
      },
      since: {
        type: "string",
        enum: [...SINCES, "none"],
        description:
          "Only issues opened recently: week ('this week', 'today', 'past few days'), month ('recent', 'this month'), year ('this year'); none if unstated.",
      },
    },
  },
};

const SYSTEM = `You convert natural-language requests for open-source contribution opportunities into structured search filters for GitHub issue search.
Always answer by calling the ${TOOL.name} tool exactly once.
Only include what the user actually asked for; leave fields empty rather than guessing.
Allowed domain ids: ${DOMAINS.map((d) => `${d.id} (${d.label})`).join("; ")}.
Allowed language ids: ${LANGUAGES.map((l) => `${l.id} (${l.label})`).join("; ")}.`;

/**
 * Models that reject forced tool use (`tool_choice` any/tool → 400). For these we use
 * `auto` + the system-prompt instruction and verify a call was made; `strict: true`
 * still guarantees schema-valid arguments.
 */
const NO_FORCED_TOOL_CHOICE = /^claude-(opus-5-5|fable-5-1|mythos-5-1)/;

export class LlmParseError extends Error {
  constructor(
    message: string,
    public reason: "timeout" | "no-tool-call" | "stop-reason" | "invalid-output",
  ) {
    super(message);
    this.name = "LlmParseError";
  }
}

interface RawParse {
  languages?: unknown;
  domains?: unknown;
  difficulty?: unknown;
  types?: unknown;
  keywords?: unknown;
  maxComments?: unknown;
  since?: unknown;
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Validate and normalize the model's tool input into the shared ParsedQuery shape
 * (so it round-trips through toQueryText like any rules parse). Throws if it isn't
 * an object at all. `raw` and `qualifiers` are filled in by the caller.
 */
export function coerceLlmOutput(raw: unknown): ParsedQuery {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LlmParseError("LLM tool input is not an object", "invalid-output");
  }
  const r = raw as RawParse;
  // Only known languages: an invented one would become a `language:` qualifier that matches nothing.
  const languages = [
    ...new Set(
      strArr(r.languages)
        .map(resolveLanguage)
        .filter((x): x is string => !!x),
    ),
  ];
  const domains = [...new Set(strArr(r.domains))].map(domainMatchById).filter((d): d is NonNullable<typeof d> => !!d);
  const difficulty = DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : null;
  const types = [...new Set(strArr(r.types))].filter((t): t is IssueType => TYPES.includes(t as IssueType));
  const keywords = [
    ...new Set(
      strArr(r.keywords)
        .map((k) =>
          k
            .toLowerCase()
            .replace(/[^a-z0-9 .+#'-]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter((k) => k.length > 0 && k.length <= 40),
    ),
  ].slice(0, 3);
  const n = typeof r.maxComments === "number" && Number.isFinite(r.maxComments) ? Math.floor(r.maxComments) : null;
  const maxComments = n === null || n < 0 ? null : Math.min(n, MAX_COMMENTS);
  const since = SINCES.includes(r.since as Since) ? (r.since as Since) : null;
  return { ...emptyQuery(), languages, domains, difficulty, types, keywords, maxComments, since };
}

const clients = new Map<string, Anthropic>();
function clientFor(apiKey: string, timeoutMs: number): Anthropic {
  const key = `${apiKey}|${timeoutMs}`;
  let c = clients.get(key);
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
    clients.set(key, c);
  }
  return c;
}

/** Build the Messages API request (exported for tests). */
export function buildLlmRequest(q: string, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 512,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: NO_FORCED_TOOL_CHOICE.test(model)
      ? { type: "auto", disable_parallel_tool_use: true }
      : { type: "tool", name: TOOL.name, disable_parallel_tool_use: true },
    messages: [{ role: "user", content: q }],
  };
}

/**
 * Parse via Claude. Throws on timeout / API error / unexpected output; the caller
 * falls back to rules. The deadline is enforced here (abort + race), not only via
 * the SDK's own timeout, so a slow model can never hold up a search past `timeoutMs`.
 */
export async function parseWithLlm(
  q: string,
  apiKey: string,
  model = DEFAULT_MODEL,
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<ParsedQuery> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LlmParseError(`LLM parse exceeded ${timeoutMs}ms`, "timeout"));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      clientFor(apiKey, timeoutMs).messages.create(buildLlmRequest(q, model), { signal: controller.signal }),
      deadline,
    ]);
    // A truncated or refused turn can't be trusted even if a tool_use block is present.
    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      throw new LlmParseError(`LLM stopped with ${response.stop_reason}`, "stop-reason");
    }
    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL.name,
    );
    if (!block)
      throw new LlmParseError(
        `LLM returned no ${TOOL.name} call (stop_reason=${response.stop_reason})`,
        "no-tool-call",
      );
    return coerceLlmOutput(block.input);
  } finally {
    clearTimeout(timer);
  }
}

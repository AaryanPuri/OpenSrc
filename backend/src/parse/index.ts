import { normalise, parseQuery as parseRules } from "../../../shared/parse.js";
import type { InterpretedQuery } from "../../../shared/types.js";
import { TTLCache } from "../cache.js";
import type { Env } from "../types.js";
import { DEFAULT_MODEL, parseWithLlm } from "./llm.js";

const PARSE_TTL = 60 * 60 * 1000;
/** A rules result produced because the LLM failed is cached briefly, so the LLM gets retried soon. */
const FALLBACK_TTL = 60 * 1000;

const parseCache = new TTLCache<InterpretedQuery>(PARSE_TTL);

export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * LLM parse when ANTHROPIC_API_KEY is set (4s deadline), otherwise / on failure the
 * shared rules parser (the same one the frontend runs). Both return the shared
 * ParsedQuery shape, including `maxComments` and `since`.
 */
export async function parseQuery(q: string, env: Env): Promise<InterpretedQuery> {
  const normalized = normalise(q).join(" ");
  const useLlm = !!env.ANTHROPIC_API_KEY && normalized.length > 0;
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  // Keyed by parser too, so a rules-only result never masks an LLM one (and vice versa).
  const key = `${useLlm ? model : "rules"}|${normalized}`;
  const cached = parseCache.get(key);
  if (cached) return cached;

  const rules = parseRules(q);
  if (useLlm) {
    try {
      const llm = await parseWithLlm(q, env.ANTHROPIC_API_KEY!, model);
      const parsed: InterpretedQuery = {
        ...llm,
        raw: q,
        // Deterministic bits the rules parser is exact about: raw GitHub qualifiers
        // typed by power users, and activity phrases the model left out.
        qualifiers: rules.qualifiers,
        maxComments: llm.maxComments ?? rules.maxComments,
        since: llm.since ?? rules.since,
        interpretedBy: "llm",
      };
      parseCache.set(key, parsed);
      return parsed;
    } catch (err) {
      console.warn("[parse] LLM parse failed, falling back to rules:", (err as Error).message);
      const parsed: InterpretedQuery = { ...rules, interpretedBy: "rules" };
      parseCache.set(key, parsed, FALLBACK_TTL);
      return parsed;
    }
  }

  const parsed: InterpretedQuery = { ...rules, interpretedBy: "rules" };
  parseCache.set(key, parsed);
  return parsed;
}

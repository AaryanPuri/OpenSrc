/**
 * Types shared by the frontend (src/) and the API server (server/).
 * Plain TypeScript: no DOM or Node APIs anywhere under shared/.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'help-wanted';

export type IssueType = 'bug' | 'docs' | 'feature' | 'tests';

/** Recency window from "recent", "this week", "this month"… (→ `created:>DATE`). */
export type Since = 'week' | 'month' | 'year';

export interface DomainMatch {
  id: string;
  label: string;
  /** The phrase the user actually typed (normalised). Written back by toQueryText. */
  matched: string;
  /** Free-text term sent to GitHub. */
  term: string;
  topics: string[];
}

export interface ParsedQuery {
  raw: string;
  /** Language ids, see dictionary LANGUAGES. */
  languages: string[];
  domains: DomainMatch[];
  difficulty: Difficulty | null;
  types: IssueType[];
  /** Leftover meaningful words / quoted phrases. */
  keywords: string[];
  /** Raw GitHub qualifiers typed by power users, e.g. `repo:rust-lang/rust`. */
  qualifiers: string[];
  /**
   * Comment ceiling from phrases like "fewer than 5 comments" (→ `comments:<5`)
   * or "no comments" / "unanswered" (0 → `comments:0`).
   */
  maxComments: number | null;
  since: Since | null;
}

/** What the server's /api/parse returns: a ParsedQuery plus who produced it. */
export interface InterpretedQuery extends ParsedQuery {
  interpretedBy: 'llm' | 'rules';
}

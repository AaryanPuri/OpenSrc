/**
 * data/curation.yml: hand edits on top of the automatic collection.
 *
 *   include:            # always collected (the 30-star floor is waived)
 *     - owner/name
 *     - repo: owner/name
 *       fields: [cli]   # optional field override
 *   exclude:            # never listed
 *     - repo: owner/name
 *       reason: why
 *   fields:             # field overrides for any listed repo
 *     owner/name: [databases, cli]
 */
import { parse } from "yaml";
import { DOMAINS } from "../../../shared/dictionary.js";

export interface Curation {
  include: { repo: string; fields?: string[] }[];
  exclude: { repo: string; reason?: string }[];
  /** Lower-cased full name → field ids. */
  fields: Record<string, string[]>;
}

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const FIELD_IDS = new Set(DOMAINS.map((d) => d.id));

export class CurationError extends Error {
  constructor(message: string) {
    super(`data/curation.yml: ${message}`);
    this.name = "CurationError";
  }
}

export function emptyCuration(): Curation {
  return { include: [], exclude: [], fields: {} };
}

function repoName(value: unknown, where: string): string {
  if (typeof value !== "string" || !REPO_RE.test(value.trim())) {
    throw new CurationError(`${where}: expected "owner/name", got ${JSON.stringify(value)}`);
  }
  return value.trim();
}

function fieldList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new CurationError(`${where}: fields must be a list of field ids`);
  const ids = value.map((v) => String(v).trim());
  const unknown = ids.filter((id) => !FIELD_IDS.has(id));
  if (unknown.length) {
    throw new CurationError(
      `${where}: unknown field id(s) ${unknown.join(", ")} (known: ${[...FIELD_IDS].join(", ")})`,
    );
  }
  if (ids.length > 3) throw new CurationError(`${where}: at most 3 fields`);
  return ids;
}

function entries(value: unknown, key: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new CurationError(`${key} must be a list`);
  return value;
}

export function parseCuration(text: string): Curation {
  let doc: unknown;
  try {
    doc = parse(text) ?? {};
  } catch (err) {
    throw new CurationError(`invalid YAML: ${(err as Error).message}`);
  }
  if (typeof doc !== "object" || Array.isArray(doc)) throw new CurationError("expected a mapping at the top level");
  const d = doc as Record<string, unknown>;
  const extra = Object.keys(d).filter((k) => !["include", "exclude", "fields"].includes(k));
  if (extra.length) throw new CurationError(`unknown key(s) ${extra.join(", ")}`);

  const curation = emptyCuration();
  entries(d.include, "include").forEach((e, i) => {
    const where = `include[${i}]`;
    if (typeof e === "string") return curation.include.push({ repo: repoName(e, where) });
    if (!e || typeof e !== "object") throw new CurationError(`${where}: expected "owner/name" or { repo, fields }`);
    const o = e as Record<string, unknown>;
    const repo = repoName(o.repo, where);
    const fields = o.fields === undefined ? undefined : fieldList(o.fields, where);
    curation.include.push(fields ? { repo, fields } : { repo });
    if (fields) curation.fields[repo.toLowerCase()] = fields;
  });
  entries(d.exclude, "exclude").forEach((e, i) => {
    const where = `exclude[${i}]`;
    if (typeof e === "string") return curation.exclude.push({ repo: repoName(e, where) });
    if (!e || typeof e !== "object") throw new CurationError(`${where}: expected "owner/name" or { repo, reason }`);
    const o = e as Record<string, unknown>;
    const repo = repoName(o.repo, where);
    curation.exclude.push(typeof o.reason === "string" ? { repo, reason: o.reason } : { repo });
  });
  if (d.fields != null) {
    if (typeof d.fields !== "object" || Array.isArray(d.fields)) throw new CurationError("fields must be a mapping");
    for (const [repo, ids] of Object.entries(d.fields as Record<string, unknown>)) {
      curation.fields[repoName(repo, `fields.${repo}`).toLowerCase()] = fieldList(ids, `fields.${repo}`);
    }
  }

  const excluded = new Set(curation.exclude.map((e) => e.repo.toLowerCase()));
  const both = curation.include.filter((e) => excluded.has(e.repo.toLowerCase()));
  if (both.length) throw new CurationError(`listed in both include and exclude: ${both.map((e) => e.repo).join(", ")}`);
  const seen = new Set<string>();
  for (const e of curation.include) {
    const k = e.repo.toLowerCase();
    if (seen.has(k)) throw new CurationError(`included twice: ${e.repo}`);
    seen.add(k);
  }
  return curation;
}

export function isExcluded(c: Curation, fullName: string): boolean {
  const k = fullName.toLowerCase();
  return c.exclude.some((e) => e.repo.toLowerCase() === k);
}

export function isIncluded(c: Curation, fullName: string): boolean {
  const k = fullName.toLowerCase();
  return c.include.some((e) => e.repo.toLowerCase() === k);
}

export function fieldOverride(c: Curation, fullName: string): string[] | undefined {
  return c.fields[fullName.toLowerCase()];
}

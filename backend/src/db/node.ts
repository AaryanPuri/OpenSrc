/**
 * Node-only: a libSQL client for any DATABASE_URL, including local files
 * (`file:.data/opensrc.db`) and `:memory:`. Never imported by the Worker entry.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import type { Db } from "./index.js";

export function nodeDb(url: string, authToken?: string): Db {
  if (url.startsWith("file:")) {
    const path = url.slice("file:".length);
    if (path && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  }
  return createClient({ url, authToken: authToken || undefined }) as unknown as Db;
}

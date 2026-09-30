/**
 * Test-only database helper: signs a user in without GitHub by writing a user and a
 * session straight into the e2e server's database (the same code the OAuth callback
 * uses, from the compiled backend), and returns the session cookie's value.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2E_DB, ROOT } from './env';

interface Db {
  execute(stmt: string | { sql: string; args: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
  close(): void;
}

const backend = (file: string) => pathToFileURL(path.join(ROOT, 'backend', 'dist', 'backend', 'src', file)).href;

export const SESSION_COOKIE = 'opensrc_session';

export async function seedSession(user: { githubId: number; login: string; name?: string }): Promise<string> {
  const { nodeDb } = (await import(backend('db/node.js'))) as { nodeDb: (url: string) => Db };
  const { migrate } = (await import(backend('db/index.js'))) as { migrate: (db: Db) => Promise<string[]> };
  const { createSession } = (await import(backend('auth/session.js'))) as {
    createSession: (db: Db, userId: number, now: number) => Promise<string>;
  };
  const db = nodeDb(`file:${E2E_DB}`);
  try {
    await migrate(db);
    const at = new Date().toISOString();
    const rs = await db.execute({
      sql: `INSERT INTO users (github_id, login, name, avatar_url, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET login = excluded.login
            RETURNING id`,
      args: [user.githubId, user.login, user.name ?? null, at, at],
    });
    return await createSession(db, Number(rs.rows[0].id), Date.now());
  } finally {
    db.close();
  }
}

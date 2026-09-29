/**
 * 0001: accounts, sessions, saved items and newsletter subscribers.
 *
 * Plain SQL, kept in a .ts module so it is bundled into the Worker (Workers have no
 * file system). Every statement is idempotent, so a migration that two isolates
 * start at the same time is harmless.
 */
export default [
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    github_id   INTEGER NOT NULL UNIQUE,
    login       TEXT NOT NULL,
    name        TEXT,
    avatar_url  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`,

  // Only the SHA-256 of the session token is stored; the token itself lives in the cookie.
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,

  // payload: the item as the frontend stores it (JSON, at most 8 KB).
  `CREATE TABLE IF NOT EXISTS saved (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL CHECK (kind IN ('issue', 'repo', 'search')),
    key       TEXT NOT NULL,
    payload   TEXT NOT NULL,
    saved_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, key)
  )`,

  // languages: JSON array of language ids ([] = any). last_digest_week: ISO week ("2026-W40") of the last digest.
  `CREATE TABLE IF NOT EXISTS subscribers (
    id                 INTEGER PRIMARY KEY,
    email              TEXT NOT NULL UNIQUE,
    languages          TEXT NOT NULL DEFAULT '[]',
    status             TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL,
    confirm_sent_at    TEXT,
    confirmed_at       TEXT,
    unsubscribed_at    TEXT,
    last_digest_week   TEXT,
    last_sent_at       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS subscribers_status ON subscribers(status, last_digest_week)`,
  `CREATE INDEX IF NOT EXISTS subscribers_user ON subscribers(user_id)`,
];

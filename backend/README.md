# OpenSrc: API server

Turns plain-English requests like "beginner friendly rust issues in databases" into GitHub issue searches and returns normalized results.

Built with Hono and TypeScript. It runs locally on Node through `@hono/node-server`. The app logic in `src/app.ts` uses only `fetch` and in-memory `Map` caches, so the same app can also be deployed as a Cloudflare Worker, where `app.ts`'s default export is the Worker.

## Run

```bash
cd backend
npm install
cp .env.example .env   # optional: fill in keys
npm run dev            # tsx watch, http://localhost:8787
npm test               # vitest (LLM path tested with a mocked SDK; no key or network needed)
npm run typecheck      # tsc over src/, test/ and ../shared
npm run build && npm start   # build output: dist/backend/src/*.js + dist/shared/*.js
npm run start:prod     # NODE_ENV=production: also serves the built frontend (../frontend/dist)
```

The query parser, dictionary, GitHub query builder and query types are **not** in this folder. They live in the repo-root `shared/`, the same code the frontend runs.

- `tsconfig.json` uses `rootDir: ".."` and includes `../shared`, so `tsc` compiles it too.
- `tsx watch` and the Worker bundler follow the relative imports.
- The shared parser's tests run from the root `npm test`.

To run it together with the frontend, use `npm run dev` from the repo root. Vite (5173) proxies `/api` to this server on 8787; the proxy target can be changed with `API_PROXY_TARGET`. Linting and formatting are configured at the repo root (`npm run lint`, `npm run format`).

### Production: one process for the UI and the API

`src/node.ts` also serves the built frontend when either of these is set:

- `NODE_ENV=production`, which serves `frontend/dist/`;
- `SERVE_STATIC=<dir>`, which serves that folder, resolved from the working directory.

The API routes take priority. Existing files are served as-is, and hashed `/assets/*` files get a one-year `immutable` cache. Any other extension-less, non-`/api` path gets `index.html` (the SPA fallback). Missing files that have an extension and unknown `/api/*` paths stay 404. `SERVE_STATIC=off` turns this off even in production.

From the repo root, `npm start` builds both halves and runs this. The static serving lives in `src/static.ts` and is imported only by the Node entry, so the Worker entry (`src/app.ts`) never touches `node:fs`.

## Environment

| Var                 | Required              | Effect                                                                                                                   |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | no                    | Enables LLM query parsing with Claude Haiku 4.5. If a call fails or takes more than 4s, parsing falls back to the rules. |
| `ANTHROPIC_MODEL`   | no                    | Overrides the parser model. The default is `claude-haiku-4-5`.                                                           |
| `GITHUB_TOKEN`      | no, but recommended   | Raises the search rate limit from 10 to 30 requests/min and turns on repo star and language enrichment.                  |
| `PORT`              | no                    | Node server port. The default is 8787.                                                                                   |
| `NODE_ENV`          | no                    | `production` also serves the built frontend from `frontend/dist/`.                                                       |
| `SERVE_STATIC`      | no                    | A directory to serve the frontend from (overrides the above), or `off` to turn static serving off.                       |
| `COLLECTOR_TOKEN`   | for `npm run collect` | Token for the repo-directory collector (falls back to `GITHUB_TOKEN`). Public read access is enough.                     |

Optional accounts and newsletter (each switches itself off when unset; setup in [`docs/deploy.md`](../docs/deploy.md#3-login--newsletter-optional)):

| Var                                                    | Effect                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                             | Public origin: OAuth callback, email links and the Origin allowed to make writes. `http://localhost:5173` in dev. |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                  | libSQL. `file:.data/opensrc.db` on Node; Turso (`libsql://…`) on Workers.                                         |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App (no scopes). Login needs these, the database and `SESSION_SECRET`.                               |
| `SESSION_SECRET`                                       | Signs the OAuth state cookie.                                                                                     |
| `NEWSLETTER_SECRET`                                    | Signs confirm and unsubscribe links. The newsletter needs it, the database and a mail provider.                   |
| `RESEND_API_KEY`, `NEWSLETTER_FROM`                    | Sends email through Resend.                                                                                       |
| `MAIL_PROVIDER=console`                                | Prints emails and their links to the log instead (local development).                                             |
| `DIGEST_DAILY_CAP`                                     | Most digest emails per UTC day (default 90).                                                                      |

## Endpoints

- `GET /api/health` returns `{ ok, llm, githubToken, db, auth, newsletter }`.
- `GET /api/parse?q=...` returns the shared `ParsedQuery` plus `interpretedBy: "llm" | "rules"`. The fields are `raw`, `languages`, `domains` (`{id, label, matched, term, topics}`), `difficulty`, `types`, `keywords`, `qualifiers`, `maxComments` and `since`. The frontend calls this when `/api/health` reports `llm: true`.
- `GET /api/search?q=...&page=1&sort=best|newest|comments` returns `{ parsed, githubQuery, total, items, source: "github"|"fixtures", rateLimit?, warning?, fallbackReason? }`.
  - **`gq=<raw GitHub query>`** skips parsing and runs that exact query through the cached client with the server token. The frontend uses this, since it parses on its own.
    - `q` and the filter params are ignored, and `parsed` is `null`.
    - The query is whitespace-normalized and clamped to 512 chars at a word boundary.
    - If GitHub rejects it with a 422, the server returns **422** `{ error, kind: "invalid" }` rather than sample data.
    - An empty `gq=` counts as absent.
  - `order=asc|desc` overrides the direction for `newest`/`comments`. The frontend sends `sort=comments&order=asc` for "fewest comments".
  - `fallbackReason` is `"rate-limit"` or `"unavailable"` when sample data is served because of a GitHub failure. `warning` is written to be shown to users as-is.
  - Filter overrides: `lang`, `difficulty`, `type`, `domain`, `keywords`, `maxComments` (a number) and `since` (`week`/`month`/`year`). Values are comma-separated where it makes sense. If a param is present, even with an empty value, it **replaces** the parsed value. That lets the UI remove a chip, for example with `lang=` or `difficulty=`.
  - `demo=1` forces the bundled sample data.
  - Page size is 20 and pages are capped at 50.

- Accounts and newsletter (below): `/api/auth/*`, `/api/me`, `/api/saved*`, `/api/newsletter/*`. They answer
  `503 {"error":"feature disabled"}` when their configuration is missing.

CORS allows `GET` from any `localhost`, `127.0.0.1` or `[::1]` origin. Every `POST`, `PUT`, `PATCH` and `DELETE`
must carry an `Origin` of this site (`SITE_URL`, the request's own origin, or localhost while `SITE_URL` is local)
or it gets 403 (`src/middleware/csrf.ts`). The mail client's one-click unsubscribe is the one exception.

## Accounts, saved items and the newsletter

All optional, and all built on Web Crypto, `fetch` and `@libsql/client`, so they run on Node and Workers alike.

- **Database** (`src/db/`): SQL migrations in `src/db/migrations/` (TypeScript modules holding plain SQL, so the
  Worker bundles them), applied by a small runner. `npm run db:migrate` applies them to `DATABASE_URL`; the API
  also applies missing ones on its first query in each process or Worker isolate. `src/db/index.ts` only uses the
  `@libsql/client/web` HTTP client (the Worker); `src/node.ts` builds a full client with `src/db/node.ts` (files,
  `:memory:`) and passes it to `createApp({ db })`.
- **Sign in with GitHub** (`src/auth/`): `GET /api/auth/github?returnTo=/path` sets a signed, 10-minute state
  cookie and redirects to GitHub (no scopes). `GET /api/auth/github/callback` checks the state, exchanges the code,
  reads `GET /user`, **drops the access token**, upserts the user and sets the session cookie
  (`opensrc_session`: 32 random bytes, HttpOnly, SameSite=Lax, Path=/, Secure on https, 30 days). Only the
  token's SHA-256 is stored. `returnTo` must be a path on this site, else `/`. `POST /api/auth/logout`,
  `GET /api/me` (`{ user }`, null when signed out).
- **Saved items** (`src/routes/saved.ts`): `GET /api/saved`, `PUT|DELETE /api/saved/:kind/:key` (kind
  `issue|repo|search`, payload a JSON object up to 8 KB), `POST /api/saved/import` (up to 500 items; keys the
  server already has are kept, so repeating an import changes nothing; invalid or oversized items are skipped and
  counted). At most 3,000 items per user.
- **Newsletter** (`src/routes/newsletter.ts`, `src/newsletter/`, `src/mail/`): `POST /api/newsletter/subscribe
{ email, languages[] }` stores a pending subscriber and emails an HMAC-signed confirm link (valid 7 days);
  `GET /api/newsletter/confirm?token=` activates it; `GET|POST /api/newsletter/unsubscribe?token=` is one click
  (also in the digest's `List-Unsubscribe` and `List-Unsubscribe-Post` headers). The answer to a sign-up is the
  same whatever the address's state. Rate limits: an in-memory token bucket per IP (on Workers, per isolate
  only) and one confirmation per address per 10 minutes. `GET|PUT|DELETE /api/newsletter/me` manages the
  subscription linked to the signed-in account (linked when it is confirmed while signed in).
- **Digest** (`npm run digest`, `src/newsletter/digest.ts`): reads `data/repos.json` and `data/meta.json`; each
  active subscriber gets "New first-PR repos in {Lang} this week" (first listed in the last 7 days and first-PR
  friendly, at most 5 per language), topped up with the best-scoring repos when the week is thin. It stops at
  `DIGEST_DAILY_CAP` emails per UTC day (counting earlier runs) or on Resend's 429, and marks each subscriber with
  the ISO week, so the next run carries on. `--dry-run` sends and writes nothing; `--preview rust,go --out x.html`
  renders a sample without a database. `.github/workflows/digest.yml` runs it on Mondays with Tuesday and
  Wednesday catch-ups.

Types are exported from `src/types.ts`: `ParsedQuery` and `InterpretedQuery` (re-exported from `shared/types.ts`), plus `Issue` and `SearchResponse`.

## How queries are parsed

1. **LLM** (`src/parse/llm.ts`), used when `ANTHROPIC_API_KEY` is set. Claude calls one tool, `record_query`, whose strict schema covers every filter:
   - `languages` and `domains` are enums of the shared dictionary's ids;
   - `difficulty`, `types` and `keywords`;
   - `maxComments` (an integer or null);
   - `since` (`week`/`month`/`year`/`none`).

   How the call and its answer are handled:
   - Claude is forced to use the tool with `tool_choice: {type: "tool"}` and `disable_parallel_tool_use`. For models that reject forced tool use (Opus 5.5, Fable 5.1), it's `auto` plus a prompt instruction, and the server checks that a call was made.
   - The answer is checked and turned into the shared `ParsedQuery`: known ids only, `maxComments` clamped to 0–999, domains rebuilt from the dictionary. That means it round-trips through `toQueryText` like any rules parse.
   - Two things the rules parser is exact about are merged in: raw GitHub qualifiers (`repo:…`), and any `maxComments`/`since` that Claude left out.
   - A turn that stops with `max_tokens` or `refusal`, or that returns no tool call or a non-object input, is rejected and the rules parser is used instead.
   - A hard 4s deadline aborts the request and falls back to the rules.

2. **Rules**, used otherwise: the shared parser (`shared/parse.ts`), identical to the frontend's. It first extracts:
   - raw GitHub qualifiers;
   - "quoted phrases";
   - activity phrases ("fewer than 5 comments", "unanswered", "this week").

   It then matches the remaining words longest-phrase-first against 31 languages, 22 domains, difficulty words and issue-type words. Whatever is left, minus stopwords, becomes keywords.

Parse results are cached for 1h, keyed by the parser or model and the normalized query. When the LLM fails and the rules parser is used instead, that result is cached for only 60s, so the LLM gets tried again soon.

## How the GitHub query is built (`shared/parse.ts`, `buildGitHubQuery`)

```
is:issue is:open no:assignee archived:false
  + label:"good first issue"  (beginner)
  | label:"help wanted"       (help-wanted)
  | label:"help wanted" -label:"good first issue"  (intermediate)
  + language:<x> per language   (repeated qualifiers are OR-ed; checked against the live API)
  + label:bug,documentation,enhancement   (ONE comma list = OR. "tests" adds the word `test`)
  + one term per domain (a precise synonym such as `postgres` if typed, else the domain's default term)
  + keywords, then comments:<N / comments:0 and created:>YYYY-MM-DD, then raw qualifiers
```

GitHub's `topic:` qualifier only works for repository search, not issue search, so domains become plain keywords matched against issue text. Separate `label:` qualifiers are AND-ed. That's why all issue types go into a single comma-separated `label:` list, which GitHub treats as OR. That list is still AND-ed with the difficulty label.

This is the same builder the frontend uses, so `/api/search?q=` and the frontend's own `gq=` produce identical queries for the same text. Before the parser was shared, the server also capped domain terms at 2, capped keywords at 3 and added `in:title,body`. The shared builder follows the frontend and does none of that.

## Caching and fallback

- Search results are cached for 5 minutes, keyed by query, page and sort.
- Repo stars are cached for 1h. Enrichment only runs when a token is set, fetching at most 4 repos at a time.
- If GitHub returns an error, hits the rate limit or times out, the API serves `src/data/fixtures.json` with `source: "fixtures"` and a `warning`.
  - The file has 32 sample issues on real, popular repos. They are filtered by language where possible and ranked by how well they match.
  - The sample issues are illustrative. Their `url` points to the repo's `/contribute` page, not a specific issue.

## Repo directory data pipeline (`src/pipeline/`)

A command-line collector builds the repo directory's dataset: `data/repos.json` (one repo per line, sorted by name) and `data/meta.json`, at the repo root. The frontend reads those files; nothing here runs inside the API server.

```bash
cd backend
COLLECTOR_TOKEN=... npm run collect                          # full run (up to 1,500 repos + curated ones)
COLLECTOR_TOKEN=... npm run collect -- --limit 50 --dry-run  # small run, prints stats, writes nothing
npm run collect -- --only owner/name,owner/other             # refresh just these repos, keep the rest
npm run collect -- --languages rust,go                       # refresh these languages, keep the rest
npm run validate-data                                        # check the dataset (CI runs this)
npm run rescore                                              # re-classify and re-score data/ offline, after a rule change
```

How a run works:

1. **Search** (`collect.ts`, `queries.ts`). For each dictionary language, a GraphQL repo search for `language:X good-first-issues:>=2 stars:>=30 pushed:>(180 days ago) archived:false fork:false`, 50 results a page. When a language has more results than fit in 2 pages, the search is repeated per star bucket (30–99, 100–299, 300–999, 1k–5k, 5k+) to get past GitHub's 1,000-result cap. `good-first-issues:` only counts GitHub's standard label, so projects that use their own spelling (tokio, bevy, numpy…) are listed through `data/curation.yml`.
2. **Rank.** Candidates that fail a cheap gate check are dropped. The rest get a pre-score (the real score, with guesses for what search doesn't return) and the best are kept: the top 10 of every language first, then the best overall, up to the limit, plus 3% spare. Repos in the `include` list of `data/curation.yml` are always added.
3. **Details**, 6 repos per aliased GraphQL request: topics, license, last commit on the default branch, a CONTRIBUTING file (`CONTRIBUTING.md`, `.github/CONTRIBUTING.md`, `docs/CONTRIBUTING.md`, else GitHub's own pick such as an org default), code of conduct, open good-first-issue and help-wanted counts across the label spellings in `shared/labels.ts` (matched ignoring case), how many of the 20 newest good-first-issues are unassigned or have no comments, and which of those spellings the sampled issues carry (`issueLabels`, so a repo page searches exactly the labels the repo uses). The search matches `pushed:` (a push to any branch), but the stale gate reads the default branch's last commit, so repos pushed recently with a stale default branch are left out at this step (the spare candidates fill their places) instead of showing up as dropped. Response time is the median hours to a maintainer's first comment on issues opened 2–90 days ago by non-maintainers. It is re-sampled only once it is 7 days old.
4. **Merge** (`merge.ts`). Keeps each repo's `firstSeenAt`, sets `bootstrapAt` on the very first run (so "Fresh this week" skips day-one repos), applies curation, scores every repo at the run's time with `shared/score.ts`, drops repos that fail a gate and caps the list by score.
   After a change to the score or field rules, `npm run rescore` re-classifies and re-scores the committed dataset at its own `generatedAt`, without calling GitHub.

5. **Write** (`write.ts`) with a fixed key order, so nightly diffs stay readable. `validate.ts` re-checks shape, order, gates, scores and meta totals.

The GraphQL client (`graphql.ts`) retries network errors, 5xx responses and secondary rate limits. It stops before the budget drops below 200 points; a run that stops early exits with code 2 and writes nothing.

**Curation** (`data/curation.yml`): `include` (always collected; the 30-star floor is waived), `exclude` (never listed) and `fields` (field overrides). The file's header explains the format for contributors.

**Nightly job** (`.github/workflows/collect.yml`): runs at 03:17 UTC and on demand. It collects with the `COLLECTOR_TOKEN` secret, validates, stops if the list shrank by more than 20%, and opens or updates one PR from the `data/nightly` branch with a summary of added, removed and re-scored repos. It then starts CI on that branch, because pushes made with the workflow token don't trigger other workflows. The one-time setup is listed at the top of the workflow file.

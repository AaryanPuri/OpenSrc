# OpenSrc: stitch yourself into open source

Describe the open-source work you want in plain language, for example _"beginner friendly rust issues in databases"_ or _"easy go issues for kubernetes tooling"_. OpenSrc turns that into a precise GitHub issue search and shows open, unassigned issues you can pick up.

The design language is a quilt. Every field (domain) is a fabric patch with its own colour and weave. Your query is "sewn" into patches as you type, and each result is a patch in the quilt.

## Features

- **Natural-language query parser** (`shared/`, the same code on the frontend and the server):
  - Detects languages (31, with aliases like `golang`, `py`, `c++`, `.net`), 22 fields, difficulty, kind of work and leftover keywords.
  - Understands activity phrases: "fewer than 5 comments" / "no comments" / "unanswered" become `comments:<N` / `comments:0`, and "recent" / "this week" / "this month" become `created:>DATE`.
  - Builds a GitHub query such as `is:issue is:open no:assignee archived:false label:"good first issue" language:rust database`.
- **Claude reading (optional)**: when the API server has an `ANTHROPIC_API_KEY`, a submitted query is also read by Claude (`/api/parse`). The local parse is shown instantly, and Claude's reading replaces it if it arrives within 4s. A small sparkle next to "We read that as" marks it. With no server, no key, an error or a slow answer, the local parse simply stays.
- **Live patches**: as you type (debounced), the query is parsed and sewn into removable patches attached to the search bar. On an idle landing page an auto-typing demo shows this, and it stops on your first interaction.
- **"How much time do you have?"**: An hour / A weekend / Ongoing map to a difficulty and kind of work. Difficulty is in plain words: First contribution, Some experience, Ready for a challenge.
- **Refine**: a compact, sticky sidebar (a disclosure on mobile) for difficulty, kind of work, language and field. Sort by best match, newest or fewest comments. Load more.
- **Result cards**, with a clear hierarchy:
  - title and issue number;
  - a one-line "why this fits you" with an approachability score;
  - the repo with stars and a trust badge (last update, amber when stale for more than 6 months);
  - meta (language, comments, age) and up to 3 labels.
- **Rate-limit resilience**: on 403/429 or network failure the app falls back to a bundled sample dataset (`frontend/src/data/fixtures.json`), announced by one slim, dismissible notice.
- **Shareable URLs**: `?q=…&sort=…`. Editing a patch or filter rewrites `q`, so the URL is always the source of truth. `?demo=1` forces sample data. Unpicking the last patch keeps you on the results page (`?q=`) with a "pick a patch to start" state.
- **Saved issues**: bookmark issues (a patch flies to the Saved button) into a drawer, stored in localStorage (`opensrc:*` keys; old `ocf:*` keys are migrated).
- **Settings**: an optional GitHub token (localStorage only) raises the search limit to 30/min and enables repo star counts. There is also a sample-data toggle.
- **Design**:
  - Warm paper-and-ink light mode and an indigo "night quilt" dark mode, which follow `prefers-color-scheme` and remember your choice.
  - The theme switch crossfades using the View Transitions API.
  - Fonts: Fraunces (display), Instrument Sans (UI), JetBrains Mono (the GitHub query).
  - Motion via framer-motion, with a full `prefers-reduced-motion` fallback. Content is never hidden behind an entrance animation.
  - AA contrast and 44px touch targets on mobile.
- **Keyboard**: `/` focuses search, `Enter` searches, `Esc` closes overlays.

## Layout

```
frontend/   Vite + React + Tailwind UI           (its own package.json)
backend/    Hono API server (Node or Workers)    (its own package.json)
shared/     query parser used by both halves     (plain TypeScript, no DOM/Node APIs)
```

The root `package.json` only holds repo-wide tooling (ESLint, Prettier, concurrently) and scripts that drive both halves.

## Run

```bash
npm run setup         # install root tooling + frontend + backend (once)
cp backend/.env.example backend/.env   # optional: ANTHROPIC_API_KEY, GITHUB_TOKEN
npm run dev           # web on http://localhost:5173 + API on :8787, together
npm test              # frontend + shared parser tests, then backend tests
npm run build         # build frontend (frontend/dist) and backend (backend/dist)
npm run lint          # ESLint over frontend/, backend/ and shared/
npm run format        # Prettier (format:check verifies only; CI runs it)
npm start             # production: build both, then ONE Node server for UI + API
```

Run one half on its own with `npm run dev:frontend` (searches then go straight to GitHub from the browser) or `npm run dev:backend`.

**Ports.** The defaults are web on 5173 and API on 8787. To run a second copy alongside:

```bash
WEB_PORT=5180 PORT=8788 API_PROXY_TARGET=http://127.0.0.1:8788 npm run dev
```

- `WEB_PORT` sets Vite's port. It uses a strict port, so it fails rather than silently switching.
- `PORT` is the API server's port.
- `API_PROXY_TARGET` is where Vite's `/api` proxy points. The default is `http://127.0.0.1:8787`.

**Production (`npm start`).** This builds the frontend into `frontend/dist/`, compiles `backend/`, and runs the backend with `NODE_ENV=production`. That one process serves:

- the API under `/api/*`;
- the built frontend from `frontend/dist/`, with long-lived caching for the hashed `/assets/*` files;
- `index.html` for any other extension-less path, so client-side routes work.

Unknown `/api/*` paths still return JSON 404s. It listens on `PORT` (default 8787). `SERVE_STATIC=<dir>` serves a different build folder, and `SERVE_STATIC=off` turns static serving off. The Cloudflare Worker entry (`backend/src/app.ts`) isn't affected.

**CI.** `.github/workflows/ci.yml` runs on every push and PR with Node 20: `npm ci` for root, frontend and backend, then format check, lint, typecheck, test and build.

### One parser (`shared/`)

`shared/` holds the dictionary, the rules parser, the GitHub query builder and the shared types. It is plain TypeScript: an ESLint rule forbids DOM and Node APIs there.

- The frontend imports it through `frontend/src/lib/dictionary.ts` and `frontend/src/lib/parseQuery.ts`, which re-export it and add the UI-only chip helpers.
- The backend compiles it alongside itself (`rootDir: ".."`), so the same text gives the same filters and the same GitHub query on both sides.
- Its tests (`shared/parse.test.ts`) run once, with the frontend tests.

**Claude parsing and the URL.**

- `?q=` stays the source of truth. When Claude's reading is applied, the GitHub query built from it is what gets searched.
- Editing a patch rewrites `q` with `toQueryText(parse)`. That text round-trips through the local parser, so the edited query reloads the same without the server. The edit is also remembered as Claude's for the session, so the sparkle stays.
- See `frontend/src/lib/aiParse.ts` and `frontend/src/hooks/useAiParse.ts`.

### Backend (`backend/`)

`backend/` is a small Hono API (see `backend/README.md`). In development, Vite proxies `/api` to `http://127.0.0.1:8787`. Put a `GITHUB_TOKEN` in `backend/.env` to raise the shared rate limit to 30 searches/min and get repo star counts on every card.

How `searchIssues` in `frontend/src/lib/search.ts` picks a path:

1. **Demo mode** (`?demo=1` or the Settings toggle) stays fully local and never touches the network.
2. **Server first.** The frontend still parses the text itself and sends the finished GitHub query as `/api/search?gq=…&page=&sort=`. The server runs that exact query with its own token and a 5-minute cache. If the server hits GitHub's rate limit or can't reach GitHub, it replies `source: "fixtures"`, and the app shows the bundled sample issues with the server's `warning` as the notice.
3. **Direct GitHub fallback.** The browser calls `api.github.com` itself in these cases:
   - The server isn't there: a 404, a non-JSON reply (e.g. static hosting or the proxy with the server stopped), or a network error. This is remembered for the rest of the page session, so the server isn't probed on every search.
   - The server returns a transient 5xx. That request goes direct, and the next one tries the server again.
   - **You added your own token in Settings.** Your token is only ever sent directly to GitHub.

Page size is 20 on both sides (`PAGE_SIZE` in `search.ts`, `PER_PAGE` in the server).

## Structure

```
shared/                 used by both halves (no DOM/Node APIs)
  types.ts              ParsedQuery, DomainMatch, Difficulty, IssueType, Since
  dictionary.ts         languages, domains, difficulty, types, stopwords
  parse.ts              rules parser, GitHub query builder, toQueryText round-trip
frontend/
  index.html, vite.config.ts, tailwind.config.js
  public/               favicon
  src/
    lib/
      dictionary.ts     re-exports shared/dictionary
      parseQuery.ts     re-exports shared/parse + chip helpers and refine toggles
      aiParse.ts        optional Claude reading via /api/parse (health check, 4s deadline, cache)
      examples.ts       example queries and featured fields
      search.ts         searchIssues(q, opts): /api/search first, direct GitHub fallback
      fixtures.ts       sample-data search with GitHub-like semantics
      format.ts         time-ago, label colours, approachability, plural(), activity()
      fabric.ts         the 22 field fabrics (colour + CSS-gradient weave)
      fit.ts            "why this fits you" reasons for a card
      presets.ts        "How much time do you have?" presets
      storage.ts        localStorage keys + ocf:* → opensrc:* migration
    data/fixtures.json  32 sample issues
    hooks/              URL state, search (race-safe load more), AI parse, theme, saved, auto-typing demo
    components/         Header, Hero (+ DomainQuilt), Composer (search + patches), Patches,
                        RefinePanel, IssueCard, ResultStates, SavedDrawer, SettingsPopover
backend/
  src/                  app.ts (routes), node.ts (Node entry), parse/ (LLM + rules), github/ (client, cache, linked PRs)
  test/                 vitest suites
```

`frontend/src/lib/search.ts` is the only frontend module that talks to the network: it calls the `/api/search` backend first and GitHub directly as a fallback. Callers depend only on `searchIssues(q, opts)` and the `SearchResult` shape.

## Notes

- GitHub issue search does not support `topic:`, so a domain becomes a free-text term (for example "kubernetes" or "database"). The related topics are still shown in the chip tooltip.
- Sample issues link to the real repository's issue list, not to specific issues.

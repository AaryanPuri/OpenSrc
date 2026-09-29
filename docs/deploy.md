# Deploying OpenSrc to Cloudflare

OpenSrc runs on two free Cloudflare products on the `opensrc.studio` zone:

| Part | Product                               | Serves                                           |
| :--- | :------------------------------------ | :----------------------------------------------- |
| Site | **Cloudflare Pages**                  | Every pre-rendered page, `/data/*`, sitemap, RSS |
| API  | **Cloudflare Worker** (`opensrc-api`) | `opensrc.studio/api/*`                           |

The site works without the API: live issues then fall back to calling GitHub straight from the browser, at a lower rate limit.

## 1. Pages (the site)

Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick `AaryanPuri/OpenSrc`.

| Setting                | Value                                                                                               |
| :--------------------- | :-------------------------------------------------------------------------------------------------- |
| Production branch      | `main`                                                                                              |
| Framework preset       | None                                                                                                |
| Build command          | `npm --prefix frontend ci && npm --prefix frontend run build && node frontend/scripts/cf-pages.mjs` |
| Build output directory | `frontend/dist`                                                                                     |
| Environment variables  | `NODE_VERSION` = `20`, `SITE_URL` = `https://opensrc.studio`                                        |

Then open the project → **Custom domains** → add `opensrc.studio` (and `www.opensrc.studio`, which Pages redirects to the apex).

Every push to `main`, including merged nightly dataset PRs, rebuilds and redeploys the site automatically.

`frontend/scripts/cf-pages.mjs` adapts the build for Pages: it serves pages at clean URLs without trailing slashes, adds `/issues` and `/account`, and sets caching headers. The Node server (`npm start`) doesn't need it.

## 2. Worker (the API)

Wrangler 4 needs **Node.js 22+**.

```bash
cd backend
npx wrangler login                          # opens the browser once
npx wrangler deploy                         # uses backend/wrangler.toml
npx wrangler secret put GITHUB_TOKEN        # a read-only token: higher GitHub limits
npx wrangler secret put ANTHROPIC_API_KEY   # optional: Claude query parsing
```

`wrangler.toml` routes `opensrc.studio/api/*` to the Worker. Check it with `https://opensrc.studio/api/health`, which should return `{"ok":true,...}`.

Redeploy the Worker (`npx wrangler deploy`) whenever `backend/` or `shared/` changes.

## 3. Login & newsletter (optional)

GitHub login (with saves synced across devices) and the weekly email digest stay off until you configure them.
Until then the site hides "Sign in", shows an RSS link in place of the newsletter form, and those API routes
answer `503 {"error":"feature disabled"}`. `https://opensrc.studio/api/health` reports `{ "db", "auth",
"newsletter" }`, so you can check what is on.

| Feature    | Needs                                                                                       |
| :--------- | :------------------------------------------------------------------------------------------ |
| Database   | `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                                                       |
| Login      | the database, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`      |
| Newsletter | the database, `NEWSLETTER_SECRET`, `RESEND_API_KEY`, `NEWSLETTER_FROM`, plus the digest job |

`SITE_URL` is set to `https://opensrc.studio` in `wrangler.toml` (`[vars]`).

### 3.1 GitHub OAuth Apps (login)

Create two OAuth Apps at GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**. Leave
"Enable Device Flow" off. OpenSrc asks for no scopes, so it only sees public profile data, and it drops the
GitHub token right after reading the profile.

| App             | Homepage URL             | Authorization callback URL                        |
| :-------------- | :----------------------- | :------------------------------------------------ |
| OpenSrc         | `https://opensrc.studio` | `https://opensrc.studio/api/auth/github/callback` |
| OpenSrc (local) | `http://localhost:5173`  | `http://localhost:5173/api/auth/github/callback`  |

For each one, copy the **Client ID** and generate a **client secret**. The local app's values go in
`backend/.env` together with `SITE_URL=http://localhost:5173`; the production values go only into Cloudflare
(step 3.4).

### 3.2 Turso database

1. Sign up at [turso.tech](https://turso.tech) (the free plan is plenty), install the CLI
   (`curl -sSfL https://get.tur.so/install.sh | bash`) and run `turso auth login`.
2. `turso db create opensrc`
3. `turso db show opensrc --url` gives `DATABASE_URL` (`libsql://opensrc-<you>.turso.io`).
4. `turso db tokens create opensrc` gives `DATABASE_AUTH_TOKEN`.
5. Create the tables from your machine:

   ```bash
   cd backend
   DATABASE_URL=libsql://opensrc-<you>.turso.io DATABASE_AUTH_TOKEN=<token> npm run db:migrate
   ```

   The API also applies any missing migration on its first database request in each Worker isolate, so a
   deploy that adds a migration still works if you skip this. Running it first catches a wrong URL or token
   before your users do.

Locally, `DATABASE_URL=file:.data/opensrc.db` in `backend/.env` is enough: the Node server opens files. The
Worker can only reach Turso.

### 3.3 Resend (newsletter email)

1. Sign up at [resend.com](https://resend.com) (free: 100 emails a day, 3,000 a month).
2. **Domains** → **Add domain** → `opensrc.studio`. Resend sends from a subdomain (by default
   `send.opensrc.studio`) and lists a few DNS records: an **MX** and an **SPF TXT** record on `send`, and a
   **DKIM TXT** record on `resend._domainkey`. Add each one in Cloudflare → **DNS** exactly as shown, with the
   proxy **off** (DNS only), then press **Verify** in Resend.
   - These records sit on the `send` subdomain, next to **Email Routing**'s MX records on the apex (which
     deliver `hello@opensrc.studio`), without touching them.
   - Watch for the MX conflict: never add Resend's MX on the apex, and don't delete or replace Email Routing's
     MX or SPF records, or incoming mail stops. If Resend ever asks for an apex SPF entry, merge it into the
     existing record instead of adding a second `v=spf1` record.
   - A DMARC record helps delivery: a `_dmarc` TXT record with `v=DMARC1; p=none; rua=mailto:hello@opensrc.studio`.
3. **API Keys** → create a key with **Sending access**. That is `RESEND_API_KEY`.
4. `NEWSLETTER_FROM` = `OpenSrc <digest@opensrc.studio>`. Replies go to `hello@opensrc.studio`.
5. `NEWSLETTER_SECRET` = a long random string (`openssl rand -base64 32`). It signs the confirm and unsubscribe
   links, so keep it stable: changing it breaks the links in emails already sent.

### 3.4 Worker secrets

```bash
cd backend
npx wrangler secret put DATABASE_URL
npx wrangler secret put DATABASE_AUTH_TOKEN
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET        # openssl rand -base64 32
npx wrangler secret put NEWSLETTER_SECRET     # the same value as the digest job's secret
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NEWSLETTER_FROM       # OpenSrc <digest@opensrc.studio>
npx wrangler deploy
```

`https://opensrc.studio/api/health` should then show `"db":true,"auth":true,"newsletter":true`. Sessions last
30 days. Changing `SESSION_SECRET` only cancels sign-ins that are in progress, not existing sessions.

The newsletter's per-IP rate limit (5 sign-ups, then one every 2 minutes) lives in each Worker isolate's memory,
so on Workers it only slows a burst down. Whatever the IP, an address gets at most one confirmation email per
10 minutes, and nothing else is sent until its owner confirms. For a hard limit, add a Cloudflare **rate
limiting rule** for `/api/newsletter/subscribe` (Security → WAF).

### 3.5 The weekly digest (GitHub Actions)

`.github/workflows/digest.yml` runs every Monday at 14:00 UTC, with catch-up runs on Tuesday and Wednesday for
anyone the daily cap left out. Add these repository secrets (Settings → Secrets and variables → Actions):
`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `RESEND_API_KEY`, `NEWSLETTER_SECRET`, `NEWSLETTER_FROM`. You can also add
a repository **variable** `DIGEST_DAILY_CAP`. The default is 90, which leaves room under Resend's 100 a day for
confirmation emails.

Try it first with **Actions** → **Weekly digest** → **Run workflow** (dry run is ticked by default): it lists who
would get which subject and sends nothing. Locally, run `npm --prefix backend run digest -- --dry-run`, or
`npm --prefix backend run digest -- --preview rust,go --out digest.html` to render a sample email without a
database.

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

# Pre-rendering and SEO

Every directory page is rendered to static HTML at build time, so search engines, link previews and visitors
without JavaScript get the real content: repo names, descriptions, facts, scores and the repo grid. In the
browser, React hydrates that HTML and takes over.

## Build

`npm run build` (repo root) runs, in `frontend/`:

1. `tsc --noEmit`
2. `vite build`: the client bundle in `frontend/dist/`
3. `vite build --ssr src/entry-server.tsx --outDir dist-ssr`: the server render (`render(url, { dataset })`)
4. `tsx scripts/prerender.ts`: the pages, the data files, the sitemap, `robots.txt` and the feed
5. `tsx scripts/compress.ts`: Brotli (`.br`) and gzip (`.gz`) copies of every HTML, JS, CSS, JSON, XML and SVG
   file of 1 KB or more, for the Node server. Cloudflare Pages drops them again (`scripts/cf-pages.mjs`) and
   compresses at the edge.

It then compiles `backend/`. `npm start` does the same and starts the server.

The pre-render script reads `data/repos.json` and `data/meta.json` (`--data <dir>` picks another folder), and
also takes `--dist`, `--ssr` and `--out`. On the full dataset (about 1,500 repos) it writes about 1,550 pages
in under 10 seconds.

## Environment

| Variable              | Default                  | What it does                                                                                                                                    |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`            | `https://opensrc.studio` | Public origin used for canonical links, `og:url`, JSON-LD, `sitemap.xml`, `robots.txt` and `feed.xml`. No trailing slash.                       |
| `PRERENDER_LIMIT`     | unset (all)              | Only pre-render the N best-scored repo pages. Use it for quick local builds, never in production: repos without a page are answered with a 404. |
| `CI_REQUIRE_SITE_URL` | unset                    | `1` makes the build fail when `SITE_URL` is missing. CI sets it.                                                                                |

## What is generated

In `frontend/dist/`:

| File                                                    | Content                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `index.html`                                            | The home page (the directory).                                                                    |
| `repo/<owner>/<name>/index.html`                        | One page per repo.                                                                                |
| `language/<id>/index.html`                              | One page per language with at least 3 repos.                                                      |
| `field/<id>/index.html`                                 | One page per field with at least 1 repo.                                                          |
| `collections/index.html`, `collections/<id>/index.html` | The collections.                                                                                  |
| `submit/index.html`                                     | The submit page: the check-and-file form, flagging, and how listing works.                        |
| `404.html`                                              | The not-found page.                                                                               |
| `app.html`                                              | The empty app shell, for client-rendered routes (`/issues`, `/account`).                          |
| `data/repos.<hash>.json`                                | The compact repo index, named by a hash of its content.                                           |
| `data/meta.json`, `data/repo/<owner>/<name>.json`       | Dataset meta and one full record per repo (loaded when navigating to a repo page in the browser). |
| `sitemap.xml`                                           | Every indexable page, with `lastmod` set to the dataset's `generatedAt`.                          |
| `robots.txt`                                            | Allows everything except `/issues`, `/account` and `/api/`, and points to the sitemap.            |
| `feed.xml`                                              | RSS 2.0: the 50 newest repos (by when the collector first listed them, then by score).            |

`frontend/public/og.png` is the social preview image for every page.

## Each page's head

Pages set their `<head>` with `useDocumentMeta(meta)` (`src/hooks/useDocumentMeta.ts`), built by the helpers in
`src/seo/meta.ts`: title, description, canonical link, Open Graph and Twitter card tags, `robots` when the page
must not be indexed, and JSON-LD from `src/seo/jsonLd.ts`:

- repos: `SoftwareSourceCode` (name, description, code repository, language, license) and a `BreadcrumbList`
- language, field and collection pages: an `ItemList` of their repos and a `BreadcrumbList`
- the home page: `WebSite` with a `SearchAction` (`/?q=`) and an `ItemList`

On the server, the render collects the meta and the script puts it in place of `<!--head-->` in `index.html`.
In the browser, the same hook updates the tags on client-side navigation.

`noindex` pages: `/issues`, `/account`, directory searches (`/?q=`), empty collections and the 404
page.

## Hydration

Each page inlines its own data in `<script id="__OPENSRC_DATA__" type="application/json">`, escaped so nothing
in it can close the tag. It holds the dataset meta, the address of the hashed index and only the repos the page
shows (the first 30 of a list, or the one repo with its full record), plus the totals the page prints. The
browser's first render uses exactly that data, so it matches the server's HTML. The full index then loads in the
background.

"Now" is always `meta.generatedAt`, never the clock, so ages like "committed 3d ago" come out the same on both
sides.

`src/boot.tsx` hydrates only when the address is the one the page was rendered for, without a query string.
Otherwise (`/?q=rust`, `404.html` served at an unknown address) it renders from scratch.

Entrance animations (cards sliding in, tiles settling) use `useEntrance()` (`src/hooks/useEntrance.ts`): on the
server and during hydration framer-motion gets `initial={false}`, so the HTML, and visitors without JavaScript,
see everything in its final place. Only elements that mount later animate in.

A repo page's live issues (`src/components/RepoIssues.tsx`, with the issue cards and the GitHub search) load in
their own chunk after hydration. The server renders placeholders there.

## Serving

`backend/src/static.ts` serves `frontend/dist/` in production:

- A directory's `index.html` answers its path: `/repo/a/b` serves `repo/a/b/index.html`, including names with
  dots like `/repo/mrdoob/three.js`.
- Unknown `/repo/…`, `/language/…`, `/field/…` and `/collections/…` paths get `404.html` with status 404.
- Other paths without an extension (`/issues`, `/account`) get the app shell (`app.html`) with status 200.
- Precompressed files: when a file has a `.br` or `.gz` copy and `Accept-Encoding` allows it, that copy is
  sent with `Content-Encoding` (Brotli first). The 404 page and the app shell are negotiated the same way
  (q-values honoured). Compressible responses always carry `Vary: Accept-Encoding`.
- Cache headers:
  - HTML: `public, max-age=300`
  - `/assets/*` and `/data/repos.<hash>.json`: `public, max-age=31536000, immutable`
  - everything else: `no-cache`

Any static host with the same rules works too: nested `index.html`, `404.html` for the directory prefixes and
`app.html` as the fallback for the rest.

## Tests

- `frontend/src/ssr.test.tsx` (part of `npm test`): every route renders on the server, meta and `noindex`
  rules hold, and a page renders the same from its slice as from the whole dataset.
- `npm --prefix frontend run test:prerender` (after `npm run build`): pre-renders the 8-repo fixture in
  `frontend/test/fixtures/dataset/` into a temporary folder.
  - `test/prerender.smoke.test.ts` checks:
    - the expected files exist
    - titles, canonical links and `og:title` are unique
    - JSON-LD is valid
    - the sitemap covers every indexable page
    - `robots.txt` and the feed are there
    - inlined data can't break out of its script tag
    - no `undefined`, `NaN` or `[object Object]` appears anywhere
  - `test/hydration.test.tsx` hydrates the pages in jsdom and expects no recoverable errors or hydration
    warnings.
- `backend/test/static.test.ts`: nested pages, 404s, the app shell and cache headers;
  `backend/test/static.compress.test.ts`: precompressed responses and `Accept-Encoding` negotiation.
- `frontend/test/compress.test.ts` (in `test:prerender`): which files get `.br` / `.gz` copies.

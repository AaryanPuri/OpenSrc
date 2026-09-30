# Contributing to OpenSrc

Thanks for helping people find their first open-source contribution. OpenSrc is itself a good place to make yours.

## Ways to help

- **Suggest a repo.** Use the [Submit a repo](https://opensrc.studio/submit) page, or open a "Submit a repo" issue. We check it against the same rules the nightly collector uses.
- **Flag a listing.** Wrong data, archived, unwelcoming, or wrongly categorised? Use "Flag this repo" on its page, or open a "Flag a repo" issue.
- **Curate by hand.** Edit [`data/curation.yml`](data/curation.yml) to force-include or exclude a repo, or to fix its fields, and open a PR. The comments at the top of that file explain the format.
- **Fix or build something.** Look for issues labelled [`good first issue`](https://github.com/AaryanPuri/OpenSrc/labels/good%20first%20issue) or `help wanted`, and comment that you're taking one so nobody duplicates the work.

## Local setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/AaryanPuri/OpenSrc.git
cd OpenSrc
npm run setup   # installs root tooling, frontend and backend
npm run dev     # web on http://localhost:5173, API on :8787
```

API keys are optional. Copy `backend/.env.example` to `backend/.env` to enable Claude query parsing (`ANTHROPIC_API_KEY`) or higher GitHub limits (`GITHUB_TOKEN`). Everything works without them.

## Before you open a PR

Run the same checks CI runs:

```bash
npm run format   # Prettier
npm run lint     # ESLint
npm run typecheck
npm test
npm run build
npm run e2e:install   # once: Playwright's Chromium
npm run e2e           # end-to-end tests against the build, with a small fixture dataset
```

- Keep PRs focused: one change per PR.
- Add or update tests when you change behaviour. The parser, score and filters live in `shared/` and each has a `*.test.ts`.
- UI changes: include a before/after screenshot in light and dark mode, and check the page at 360px wide.
- Don't commit `.env` files, tokens, or anything generated under `dist/`.

## Project layout

```
frontend/   React + Vite + Tailwind UI
backend/    Hono API server and the nightly repo collector (backend/src/pipeline)
shared/     query parser, score and filters used by both halves
data/       the repo dataset (generated nightly) and curation.yml (hand-edited)
```

## Code of conduct

Be kind and patient, because many people here are making their very first contribution. Harassment or dismissive behaviour isn't welcome. Report problems to hello@opensrc.studio.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

# GreenLeaf

A plant care web app: plant library, searchable plant-name catalogue, My garden tracker, a today's watering checklist, harvest predictor, water planner, Plant Lab (simulator and experiment journal), Plant doctor, AI assistant and Plant Camera.

This repository contains an Express + TypeScript server, a SQLite database with migrations, and the existing single-file frontend in `public/index.html`.

## Honest status

| Area | Status |
| --- | --- |
| Lint, typecheck, production build | Run and passing (Windows, Node 22; CI covers Linux on Node 22 and 24) |
| 18 automated tests (API, migrations, plant CSV import, AI proxy with a mock upstream, frontend smoke tests in jsdom) | Passing |
| Server start from the production build, static files, health endpoint | Smoke-tested |
| Windows | Tested locally (Node 22). If PowerShell blocks `npm.ps1`, use `npm.cmd` |
| Real Anthropic API calls | **Not tested.** Only a mock upstream was used. Add your own key and try it |
| Docker image, GitHub Actions workflow | **Not run** here |
| PWA installation on real phones, mobile layouts on real devices | **Not tested** |
| User accounts | **Not implemented.** Each browser gets an anonymous cookie id |

## Requirements

- Node.js 22 or newer and npm
- On Windows, `better-sqlite3` normally installs a prebuilt binary. If `npm install` fails, install the Visual Studio Build Tools ("Desktop development with C++") and retry.

## Run locally (Windows PowerShell, macOS, Linux)

```
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
npm run migrate
npm run dev
```

Open http://localhost:3000. The AI features need `ANTHROPIC_API_KEY` in `.env`. Without it the assistant shows offline help and the camera says analysis is unavailable.

## Plant-name catalogue (optional)

The detailed care library has 31 hand-written guides. For a much wider A–Z index, import the USDA PLANTS CSV (`plantlst.txt`, 93,157 rows) into SQLite. The CSV is not committed to this repository.

```
npm run migrate
npm run import:plants -- "path/to/plantlst.txt"
```

On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked by the execution policy, for example `npm.cmd run import:plants -- "E:\32\plantlst.txt"`.

The import replaces the `plants` table in one transaction, so it is safe to run again after downloading a newer list. It loads scientific names, common names, families, and whether each row is an accepted name or a synonym. The **Plant names A–Z** section searches it through `GET /api/plants`; the 31 detailed care guides stay in the Plant library.

Choosing a search result opens a basic profile with plant group, family, USDA symbol, sunlight, water, soil, best time, duration and spacing guidance. **These fields are estimates** generated from the plant group and the name record, not verified per-species advice. The profile is labelled as an estimate and links to the USDA record. When a name exactly matches a library plant (common name, or scientific name and its synonyms), it also offers the hand-written care guide.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with auto-reload |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript check |
| `npm test` | Runs all tests |
| `npm run build` | Compiles to `dist/` |
| `npm start` | Runs the compiled server (also applies pending migrations) |
| `npm run migrate` / `npm run migrate:prod` | Applies SQL files in `migrations/` (from source / from `dist/`) |
| `npm run import:plants -- <csv>` | Imports the USDA PLANTS CSV into the `plants` table |
| `npm run import:plants:prod -- <csv>` | Same import from the compiled build |

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (3000) | HTTP port |
| `NODE_ENV` | no | `production` turns on `Secure` cookies (needs HTTPS) |
| `DATABASE_PATH` | no | SQLite file. Use a persistent disk in production |
| `ANTHROPIC_API_KEY` | for AI | Server-side only. Never sent to the browser |
| `ANTHROPIC_MODEL` | no | Model name used for AI requests |
| `ANTHROPIC_BASE_URL` | no | Override for tests or a proxy |
| `TRUST_PROXY` | no | Set `true` behind a reverse proxy so rate limits see real client IPs |

## API

- `GET /api/health` returns `{ ok, ai }`.
- `GET /api/plants?q=rose&limit=20&offset=0` searches the imported plant-name catalogue. `q` needs 2–80 characters; `limit` is 1–50 (default 20). It returns `{ total, limit, offset, items }`, where each item has `symbol`, `synonymSymbol`, `scientificName`, `commonName`, `family` and `accepted`.
- `GET /api/data`, `PUT /api/data/:key`, `DELETE /api/data/:key` store the user's garden, favorites, experiments, chats and photo history. Allowed keys: `gl_garden`, `gl_fav`, `gl_exp`, `gl_chats`, `gl_cam`.
- `POST /api/ai/messages` validates the request, adds the API key and model on the server and forwards it to the Anthropic Messages API. Limit: 20 requests per minute per IP.

`public/sync.js` mirrors `gl_*` localStorage keys to the server (last write wins) and provides the AI bridge used by the assistant and camera. localStorage stays as an offline cache.

## Database

SQLite (`better-sqlite3`, WAL mode). Tables: `users`, `user_data` (one JSON document per user and key), `plants` (the optional imported name catalogue) and `schema_migrations`. Add a new numbered `.sql` file to `migrations/` to change the schema.

This suits **one server instance with a persistent disk**. It does not scale across several instances. The 31 detailed care guides are still embedded in `public/index.html`, while the larger name catalogue lives in SQLite. User data is stored as documents rather than normalized tables. Moving to PostgreSQL and normalized models is future work. Back up the database file regularly.

## Deployment

1. Build: `npm ci && npm run build`
2. Start: `npm run migrate:prod && npm start`
3. Set the environment variables above, mount a persistent disk and point `DATABASE_PATH` at it.
4. Serve over HTTPS. HTTPS is required for `Secure` cookies, the service worker and PWA install.

A `Dockerfile` is included (not built here). Platforms with persistent disks (Render, Railway, Fly.io, a VPS with nginx and systemd) fit this setup. Free tiers with ephemeral disks will lose data.

## PWA and mobile

`manifest.webmanifest`, `sw.js` and icons make the site installable over HTTPS. The service worker caches the app shell and never caches `/api`. Native store apps (for example with Capacitor) are not built. They would need token-based accounts instead of the cookie id.

## Known limitations

- Frontend is one JavaScript file inside `index.html`, so TypeScript and ESLint cover the server and tests only. Its CSP needs `'unsafe-inline'`.
- Plant data has 31 hand-written care guides. The 93,157-name catalogue imported from USDA PLANTS is a name index with no verified care details. Its profile panel shows clearly labelled estimates based on plant group, family and name; those are not a substitute for species-level advice.
- The plant-name catalogue only appears after running the import command. Searches return an empty result on a fresh database until then.
- No accounts. Clearing cookies loses access to server-side data.
- Photos are compressed in the browser, stored in the database and sent to the AI provider only when the user presses Analyze.

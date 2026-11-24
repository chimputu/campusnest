# CampusNest — Reconnaissance & Tech-Stack Audit
_Generated: 2026-11-24 · Auditor: AI agent · Mode: read-only_

## 0. Executive Summary
- The repo is a **flat, single-package, decoupled client–server prototype**: a dependency-free vanilla-JS SPA (`index.html`, `js/`, `css/`) plus a minimal Express/Postgres API (`server/`) that are **not connected** — the SPA performs zero network calls (`js/app.js`, `js/data.js`; no `fetch`/XHR found).
- What works end-to-end today is the **browser-only** product: role/register/login, tenant browse+filter+save+request+map, landlord dashboard/listing CRUD/request handling, admin moderation, and reviews — all persisted in `localStorage` via `DB` (`js/data.js:1-11`, `js/app.js:1140-1190`).
- **Top risk 1:** no persistence layer shared between users — `localStorage` means no cross-device/cross-user behavior, and the API's `users` table has no schema/migrations (`server/routes/auth.js:40-68`, no `*.sql`/`CREATE TABLE` found).
- **Top risk 2:** authentication is client-side plaintext with hardcoded admin credentials in source (`js/app.js:182-196`, `js/app.js:1059`, `js/app.js:1066`); all RBAC is UI-only (`js/app.js:1156-1163`) and the API has no auth middleware (`server/middleware/` is empty, `server/server.js:12-16`).
- **Top risk 3:** permissive CORS, no validation library on write endpoints, no rate limiting, no CSRF model, no upload validation beyond client resize (`server/server.js:12`, `server/routes/auth.js:8-84`, `js/app.js:858-888`).
- **Top 3 next steps:** (1) define Postgres schema + migrations; (2) build and wire a real REST API with server-side auth/RBAC; (3) add config/CI hygiene (`.env.example`, scripts, tests).

## 1. Repository & Environment Setup

- **Architecture Type:** **Decoupled Client–Server (single repo, two disconnected apps).** No monorepo tooling (no workspaces in `package-lock.json`, only one `package.json`), no full-stack framework. Static SPA served as plain files (`index.html:21-22` loads global scripts with no bundler) and an Express REST API (`server/server.js:7-44`).
- **Directory Tree (3 levels, cleaned):**
  ```
  Campus_nest/
  ├── .env                       # DB credentials (values redacted in this report)
  ├── .gitignore                 # node_modules/, .env
  ├── .idea/                     # JetBrains IDE metadata (not application source)
  │   ├── Campus_nest.iml
  │   ├── .gitignore
  │   ├── modules.xml
  │   └── workspace.xml
  ├── css/
  │   └── styles.css             # 325 lines, hand-written CSS design tokens
  ├── image/                     # 12 image assets + README.txt
  │   ├── 1.webp 2.webp 3.webp 4.webp 6.webp
  │   ├── backG.jpg background.jpg login-house-background.jpg
  │   ├── campusnest-login-background.png
  │   ├── campusnest-login-background-v2.png
  │   ├── sunlit-student-dorm-retreat.png
  │   ├── logo.webp OIP.webp README.txt
  ├── index.html                 # SPA shell + script tags
  ├── js/
  │   ├── data.js                # localStorage DB + seed data + SVG photo generator
  │   └── app.js                 # 1189 lines: UI, router, actions, validation, forms
  ├── package.json
  ├── package-lock.json          # lockfileVersion 3
  └── server/
      ├── config/
      │   └── db.js              # pg.Pool from .env
      ├── middleware/            # EMPTY directory (no files found)
      ├── routes/
      │   └── auth.js            # POST /register, POST /login
      ├── server.js              # Express app, /api/health, /api/auth
      └── test-db.js             # one-off DB connectivity script
  ```
- **Package manager(s) + runtime constraints:** npm only (`package-lock.json`, lockfileVersion 3; no `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `composer.lock`, `poetry.lock`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`, `pubspec.yaml`, `go.mod`, `Cargo.toml` found). No `.nvmrc`, `.node-version`, `engines` field, `runtime.txt`, or `.tool-versions`; `package.json:12` declares `"type": "commonjs"`. `package.json:6-8` has only a stub `test` script. Locally observed Node `v26.13.1`, npm `11.20.0` — **not declared by the repo** (UNKNOWN — needs verification for target environments).
- **Containerization:** none detected — no `Dockerfile`, `docker-compose.yml`, `compose.yaml`, or `.devcontainer/` found.
- **`.env` keys detected (names only, values never printed):** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (source: `.env`; loaded by `server/config/db.js:2-10` and `server/server.js:3`). No `.env.example`, `.env.sample`, `.env.local`, `.env.template`, or `.env.production` exists. `.env` is ignored via `.gitignore:2`.
- **README/docs summary:** **no `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, or `docs/` directory exists** (verified by file checks). The only documentation found is inline: `js/app.js:1-26` (architecture/flow comments), `js/app.js:28-32` (image-editing instructions), `image/README.txt:1-3` (asset folder notes), and `js/app.js:177-181` (admin credentials instructions).
- **Version control:** no git repository detected (`git rev-parse` returned no work tree); therefore no history, branches, or CI hooks available.

## 2. Verified Tech Stack

| Layer | Technology/Library | Version | Status | Evidence (file path) |
| :--- | :--- | :--- | :--- | :--- |
| Frontend / Mobile | Vanilla JavaScript, global scripts, no framework/build step | n/a | Active | `index.html:21-22`, `js/app.js` |
| Frontend / Mobile | Hash-based SPA router with client-side role guards | n/a | Active | `js/app.js:1140-1190` |
| Frontend / Mobile | Custom CSS with `:root` design tokens; Google Fonts (Bricolage Grotesque, Public Sans) | n/a | Active | `css/styles.css:1-18`, `index.html:8-11` |
| Frontend / Mobile | State = module-level globals + `localStorage` wrapper `DB` | n/a | Active | `js/data.js:1-11`, `js/app.js:169-172` |
| Frontend / Mobile | Forms + custom ARIA validation engine (`RULES`, `validateForm`) | n/a | Active | `js/app.js:906-1038` |
| Backend / API | Node.js + Express (CommonJS), port 3000 | 5.3.0 | Active (3 routes only) | `package.json:12-18`, `server/server.js:1-16,42-44` |
| Backend / API | REST paradigm (`/api/health`, `/api/auth/register`, `/api/auth/login`) | n/a | Active | `server/server.js:16-39`, `server/routes/auth.js:7-8,85-86` |
| Backend / API | CORS (fully open `app.use(cors())`), `express.json()` | 2.8.6 | Active | `server/server.js:2,12-13` |
| Backend / API | `dotenv` config loading | 18.0.9 | Active | `server/server.js:3`, `server/config/db.js:2` |
| Backend / API | Validation library (Zod/Joi/express-validator) | — | Absent | no manifest entry in `package.json:13-19`; manual checks in `server/routes/auth.js:13-37,91-101` |
| Backend / API | Rate limiting, logging framework, central error handler, auth middleware | — | Absent | `package.json:13-19`, `server/middleware/` empty, `server/server.js:11-16` |
| Database & ORM | PostgreSQL via `pg.Pool`, parameterized queries | 8.23.1 | Configured (non-functional without schema) | `package.json:18`, `server/config/db.js:1-10`, `server/routes/auth.js:40-43,56-68` |
| Database & ORM | ORM/query builder (Prisma/Drizzle/TypeORM/Sequelize/Knex) | — | Absent | no manifest entry in `package.json:13-19` |
| Database & ORM | Schema files / migrations / seed scripts | — | Absent | no `*.sql`, `*schema*`, `*migration*` files found; no `CREATE TABLE` in source |
| Auth & Security | `bcrypt` hashing on server register/login (cost 12) | 6.0.0 | Active (server path only) | `package.json:14`, `server/routes/auth.js:53,123-126` |
| Auth & Security | Client-side plaintext passwords + `session` user-id in `localStorage`; hardcoded admin credentials | n/a | Active (insecure) | `js/app.js:182-196`, `js/app.js:1059-1069` |
| Auth & Security | JWT/session cookies, helmet, CSRF, RBAC middleware | — | Absent | `package.json:13-19`, `server/middleware/` empty, `server/server.js:12-16` |
| Auth & Security | Client-side role checks (tenant/landlord/admin) | n/a | Active (bypassable) | `js/app.js:1156-1163` |
| Storage & 3rd-party | Browser `localStorage` as sole persistent store; images as base64 data URLs (canvas-resized to 800px) | n/a | Active | `js/data.js:1-11`, `js/app.js:858-888,1128-1129` |
| Storage & 3rd-party | Inline SVG generated "photos" fallback | n/a | Active | `js/data.js:13-34`, `js/app.js:150-156` |
| Storage & 3rd-party | WhatsApp deep link (`wa.me`), `tel:`, `mailto:` | n/a | Active | `js/app.js:111-115`, `js/app.js:656-662` |
| Storage & 3rd-party | Maps/geolocation (Leaflet/Mapbox/Google Maps/geolocation API) | — | Absent — hand-drawn SVG map with static `mapX/mapY` | `js/app.js:467-490`, `js/data.js:45-50` |
| Storage & 3rd-party | Payment gateways (MTN MoMo, Airtel Money, Zamtel Kwacha, Flutterwave, Paystack, DPO, Broadpay) | — | Absent | no matches in `package.json`, `js/`, `server/` |
| Storage & 3rd-party | SMS/email/push/analytics providers | — | Absent | `package.json:13-19`; UI-only toast at `js/app.js:139-144` |
| Testing & Tooling | Test runner / coverage / lint / format / type-check | — | Absent | `package.json:6-8` (stub test only); no config files found (IDE autodetect only in `.idea/workspace.xml`) |
| Testing & Tooling | CI config (`.github/workflows`, `.gitlab-ci.yml`) | — | Absent | no CI directories/files found |
| Infra & Deployment | Hosting config, IaC, Docker, serverless | — | Absent | no manifests found; `server/server.js:8,42` hardcodes `PORT = 3000` |

## 3. System Overview — What CampusNest Currently Does

**Problem statement (as evidenced by code):** a marketplace for **off-campus boarding houses near a university campus**. Evidence: seed listings with distance-to-campus, per-room occupancy, price/deposit in Kwacha, and utilities (`js/data.js:44-51`); a hand-drawn SVG map labelling the centre "Campus / Mulungushi" (`js/app.js:482`); a listing on "Kabwe Road" (`js/data.js:48`); Zambian phone validation (`+260`/`0`, `js/app.js:954`); contact copy via WhatsApp (`js/app.js:660`). The platform connects tenants (students) with landlords and provides an admin moderation panel (`js/app.js:175,574-625`).

**Implemented Modules (bullets + file paths):**
- Role selection → register → login → role-based landing, entirely in-browser (`js/app.js:268-321`, `js/app.js:1049-1069`, `js/app.js:174-175`).
- Tenant home with free-text search, max-price, people-per-room, self-contained, availability, WiFi filters and sort (`js/app.js:171`, `js/app.js:327-373`); saved listings (`js/app.js:375-380`, `js/app.js:718-726`).
- Listing detail with gallery/thumbnails/lightbox, facts, tags, save/share contact actions (`js/app.js:393-424`, `js/app.js:643-671`).
- "Request a space" workflow with move-in date/message and pending/accepted/declined status (`js/app.js:664-671`, `js/app.js:803-807`, `js/app.js:1103-1110`); landlord inbox with Accept/Decline (`js/app.js:513-523`).
- Landlord dashboard stats, add/edit listing with multi-photo upload, availability toggle and delete (`js/app.js:496-511`, `js/app.js:525-554`, `js/app.js:748-761`, `js/app.js:1112-1131`).
- Owner public profiles with aggregated ratings and student reviews gated on an accepted request (`js/app.js:426-465`, `js/app.js:1092-1101`).
- Hand-drawn SVG map with clickable pins and listing cards (`js/app.js:467-490`).
- Admin panel: stats, landlord verification toggle, remove users/listings/admins, add admins (`js/app.js:574-625`, `js/app.js:763-797`, `js/app.js:1071-1082`).
- Accessibility layer: skip link, live regions, focus trap, ARIA validation, keyboard handlers (`index.html:14-19`, `js/app.js:812-838`, `js/app.js:896-1038`).
- Server: `GET /api/health` DB check and `POST /api/auth/register`, `POST /api/auth/login` with bcrypt and duplicate-email check (`server/server.js:19-39`, `server/routes/auth.js:7-84,85-156`); DB connectivity script (`server/test-db.js:1-21`).

**In-Progress / Stubbed Modules (bullets + file paths):**
- The entire Express API is disconnected from the SPA — no `fetch`/XHR in `js/`; API is effectively standalone (`server/server.js:16-39`, `js/app.js`).
- Backend references a `users` table that is never created by any schema/migration in the repo (`server/routes/auth.js:40-43,56-68`).
- "Search this area" on the map only displays a toast (`js/app.js:746`); pins use hardcoded `mapX/mapY` (`js/data.js:45-50`).
- Missing image files (`house1.jpg`–`house4.jpg`) are silently replaced by generated SVGs (`js/app.js:46-52`, `js/data.js:13-34`, `image/README.txt:1-3`); `dashboardBanner` has a stray trailing quote (`js/app.js:41`).
- Demo/admin accounts and admin password are hardcoded and self-reseeding on every load (`js/app.js:177-196`, `js/app.js:320`).
- `server/middleware/` exists but is empty — placeholder for future guards (`server/middleware/`).
- `package.json:7` test script is an intentional failing stub.

**Absent Modules (bullets; absence verified by grep over `js/`, `server/`, `package.json` unless noted):**
- On-campus hostel listing, bed-space allocation, caretaker role, hostel admin/super-admin roles, maintenance tickets, roommate matching.
- University/student verification (student ID, registration number, `@mulungushi` email) — the only "Mulungushi" string is the map label (`js/app.js:482`).
- Any payment flow or mobile-money integration — `deposit` is display-only data (`js/data.js:45-50`, `js/app.js:417`).
- Gender-policy search/filter; amenity filtering (amenities are display tags only, `js/app.js:416`).
- In-app messaging (only external `tel:`/`mailto:`/`wa.me` links, `js/app.js:656-662`), notifications (only UI toast, `js/app.js:139-144`), analytics, error monitoring.
- Real geolocation/maps, cloud media storage, lease/document workflow, listing approval queue (publish is immediate, `js/app.js:1130`).

**Feature-state matrix (Step 3 verdicts):**

| Feature | Verdict | Evidence |
| :--- | :--- | :--- |
| Student signup + university verification | Partial (signup yes, verification absent) | `js/app.js:282-307,1050-1062`, `server/routes/auth.js:8-84` |
| Roles: Student / Landlord / Hostel Admin / Super Admin | Partial (tenant, landlord, admin; no hostel/super-admin) | `js/app.js:174-175,1156-1163`, `server/routes/auth.js:24-29` |
| On-campus hostel + bed-space allocation | Absent | no `hostel`/`bed` in source; `js/data.js:44-51` |
| Off-campus boarding houses near Kabwe/Main Campus | Implemented | `js/data.js:44-51`, `js/app.js:356-373,482` |
| Search/filter by distance, price, gender policy, amenities | Partial (distance/price yes; gender/amenity filter absent) | `js/app.js:171,327-343,362-369,416` |
| Booking / reservation / lease (request → accept → deposit → lease) | Partial (request → accept only) | `js/app.js:664-671,803-807,1103-1110` |
| Payments (mobile money, deposit, rent schedule) | Absent | `js/app.js:417` display only; no gateway refs |
| Maintenance tickets | Absent | no matches in source |
| Roommate matching | Absent | no matches in source |
| Messaging student ↔ landlord | Partial (external deep links + one-way request note) | `js/app.js:656-670` |
| Reviews / ratings | Implemented | `js/app.js:451-465,1092-1101` |
| Admin moderation / listing approval | Partial (delete/verify yes, approval queue absent) | `js/app.js:574-625,1130` |
| Notifications (SMS/email/push) | Absent | `js/app.js:139-144` (toast only) |

## 4. Gap Analysis

### Critical Blockers (MVP must-haves)
- `[CRITICAL]` No database schema, migrations, or seed; API queries a non-existent `users` table — `server/routes/auth.js:40-43,56-68`; no `*.sql` found.
- `[CRITICAL]` SPA and API are disconnected; no cross-user/cross-device data — `js/data.js:1-11`, `server/server.js:16-39`; zero network calls in `js/`.
- `[CRITICAL]` Plaintext passwords stored client-side; no password hashing on the path users actually take — `js/app.js:1059,1066`.
- `[CRITICAL]` Hardcoded admin credentials shipped in client source and re-seeded every load — `js/app.js:177-196`.
- `[CRITICAL]` All role checks are client-side only and trivially bypassed; API has no auth guards — `js/app.js:1156-1163`, `server/middleware/` empty, `server/server.js:16`.
- `[HIGH]` No write-endpoint validation library; server checks a few fields manually — `server/routes/auth.js:13-37,91-101`; custom client rules in `js/app.js:906-935`.
- `[HIGH]` No `start`/`dev`/`migrate` scripts; only a failing test stub — `package.json:6-8`.
- `[HIGH]` Broken/missing asset paths; trailing quote in `dashboardBanner` — `js/app.js:41,46-52`; `image/README.txt:1-3`.

### Security & Privacy
- `[HIGH]` Permissive CORS (`app.use(cors())`) with no allowlist — `server/server.js:2,12`.
- `[HIGH]` No rate limiting on login/register; bcrypt cost 12 mitigates but does not replace throttling — `server/routes/auth.js:8-84`, `package.json:13-19`.
- `[HIGH]` IDOR risk: all object access is by client-supplied `data-id` with no server ownership check — `js/app.js:710-711,753-760,804-806`.
- `[HIGH]` Unvalidated file uploads beyond client-side canvas resize; data URLs stored in localStorage — `js/app.js:858-888,1128-1129`.
- `[HIGH]` Secrets in repo: `.env` contains DB credentials and is only gitignored, not templated — `.env:1-5`, `.gitignore:2`, no `.env.example`.
- `[MEDIUM]` No CSRF model/token; no helmet-equivalent security headers — `server/server.js:11-16`, `package.json:13-19`.
- `[MEDIUM]` Student email/phone is displayed publicly on owner profiles and sent via `mailto:`/`tel:` without consent controls — `js/app.js:439,520,660`.
- `[MEDIUM]` Student ID documents are not collected today; any future document upload needs encryption, access control, retention and consent policy — UNKNOWN — needs verification (no such fields in `js/app.js:287-305`).
- `[MEDIUM]` Error logging via `console.error` only; no structured logging/monitoring — `server/server.js:32`, `server/routes/auth.js:76-83,148-155`.

### Data Model Gaps
- `[CRITICAL]` No relational schema at all; no FKs, unique constraints, enums, timestamps or indexes defined anywhere in repo — no `*.sql`; `server/routes/auth.js:60` assumes columns `user_id, full_name, email, password_hash, phone, role, verified, created_at`.
- `[HIGH]` Cascade deletes implemented manually in JS and only for some relations; reviews (`ratings`) are conditionally cleaned but no DB constraints back them — `js/app.js:757-760,787-796`.
- `[HIGH]` Role is stored as free string in client (`role: pendingRole`) while server applies an allowlist; no shared enum — `js/app.js:1059`, `server/routes/auth.js:20-29`.
- `[MEDIUM]` Listing location/distance/map position are unvalidated free-form numbers; no geospatial type or index — `js/app.js:540,1117-1126`.
- `[MEDIUM]` No uniqueness on one active request per tenant/listing; only a UI check — `js/app.js:1106-1108`.
- `[MEDIUM]` Review eligibility is client-side only — `js/app.js:1094-1097`.

### Developer Experience / CI
- `[HIGH]` No CI, tests, lint, format, or type-check configuration — `package.json:6-8`, no CI dirs found.
- `[HIGH]` No README/setup docs — no `README.md` found; only inline comments (`js/app.js:1-26`, `image/README.txt:1-3`).
- `[MEDIUM]` No git history/version control — `git rev-parse` reported no repo.
- `[MEDIUM]` No `.env.example`, so required keys are undiscoverable from the repo — `.env:1-5`, no template files found.
- `[MEDIUM]` No error monitoring or logging strategy — `server/server.js:32`, `server/routes/auth.js:76-83`.

## 5. Recommended Improvements (Prioritized)

1. **Priority P0 — Define and apply a Postgres schema with migrations**
   - Why it matters: the API cannot function against a fresh database; no FKs/constraints means no data integrity.
   - Concrete change: add `server/migrations/001_init.sql` (or Prisma/Drizzle schema + migration) creating `users`, `listings`, `requests`, `reviews`, `saved` with PK/FKs, role enum, unique lowercased email, indexes on `owner_id`/`listing_id`/`tenant_id`; add a seed script; update `server/config/db.js:4-10` only if pool config must change.
   - Estimated effort: **M**

2. **Priority P0 — Implement real server-side auth + RBAC and wire the SPA to the API**
   - Why it matters: eliminates plaintext client passwords, hardcoded admin, and bypassable UI-only guards.
   - Concrete change: add `server/middleware/auth.js` (httpOnly JWT cookie verification, `requireRole`), add `express-rate-limit`, `cookie-parser`, `helmet`, `zod` validation; route handlers in `server/routes/auth.js:8-156` return tokens/cookies; replace `DB` calls in `js/app.js:95-99,1043-1132` with an API client module; delete `ADMIN_EMAIL`/`ADMIN_PASSWORD` block at `js/app.js:177-196`.
   - Estimated effort: **L**

3. **Priority P1 — Build full REST resources the UI already assumes**
   - Why it matters: multi-user workflows (request → landlord inbox → accept → review) require shared state.
   - Concrete change: add `server/routes/listings.js`, `requests.js`, `reviews.js`, `saved.js`; enforce ownership on update/delete; convert `js/app.js:679-808` actions and `js/app.js:1112-1131` form handler to API calls.
   - Estimated effort: **L**

4. **Priority P1 — Config, scripts and CI hygiene**
   - Why it matters: reproducible setup; currently no way to start/migrate/verify the project.
   - Concrete change: create `.env.example` with the five keys from `.env:1-5` (blank values); add `start`, `dev`, `migrate`, `seed`, `test`, `lint` scripts to `package.json:6-8`; add `.github/workflows/ci.yml`; add a `README.md`.
   - Estimated effort: **S**

5. **Priority P1 — Fix assets and replace stub interactions**
   - Why it matters: broken references and fake map behavior undermine trust.
   - Concrete change: correct `js/app.js:41,46-52`; either supply `house1.jpg`–`house4.jpg` or remove them from `IMAGES`; replace `js/app.js:470-490` with Leaflet/Mapbox + geocoding; replace `js/app.js:746` toast with a real bounds query.
   - Estimated effort: **M**

6. **Priority P2 — Domain completeness: verification, booking lifecycle, payments, messaging**
   - Why it matters: these are the university-housing requirements absent today.
   - Concrete change: add student ID/registration-number fields and a verification workflow (`js/app.js:287-305`), listing approval state (`js/app.js:1130`), deposit/lease state machine (`js/app.js:1103-1110`), in-app messages, and a Zambian mobile-money provider adapter (e.g., MTN MoMo) behind a server-only integration; design a privacy/retention policy for ID documents.
   - Estimated effort: **L**

7. **Priority P2 — Security hardening and privacy controls**
   - Why it matters: public contact exposure, IDOR, and upload handling need production controls.
   - Concrete change: restrict CORS in `server/server.js:12`, add server-side ownership checks in all routes, validate/scans uploads before storage (`js/app.js:858-888`), add consent toggles for phone/email display (`js/app.js:439,520,660`), add structured logging.
   - Estimated effort: **M**

## 6. Ready-to-Execute Action Plan

- [ ] Initialize git repository and add `.gitignore` entries for `node_modules/`, `.env`, coverage output.
- [ ] Create `.env.example` listing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` with empty values.
- [ ] Add `engines` field to `package.json` and decide target Node version.
- [ ] Add npm scripts: `start`, `dev`, `migrate`, `seed`, `test`, `lint`.
- [ ] Write `server/migrations/001_init.sql` with `users`, `listings`, `requests`, `reviews`, `saved` tables, constraints and indexes.
- [ ] Write `server/seed.js` to replace the client-side seed data in `js/data.js:36-61`.
- [ ] Install and configure `helmet`, `cookie-parser`, `express-rate-limit`, `zod`, `jsonwebtoken` (server-side only).
- [ ] Implement `server/middleware/auth.js` with `requireAuth` and `requireRole(['TENANT'|'LANDLORD'|'ADMIN'])`.
- [ ] Refactor `server/routes/auth.js` to hash (already bcrypt), set httpOnly cookie, and validate with Zod.
- [ ] Add `server/routes/listings.js` with CRUD + ownership guards.
- [ ] Add `server/routes/requests.js` with create/list/accept/decline + ownership guards.
- [ ] Add `server/routes/reviews.js` with accepted-request eligibility enforced server-side.
- [ ] Add `server/routes/saved.js` with per-user saved listings.
- [ ] Create `js/api.js` wrapper using `fetch` with `credentials: 'same-origin'`.
- [ ] Replace `DB`-backed reads/writes in `js/app.js:95-99`, `679-808`, `1043-1132` with `js/api.js` calls.
- [ ] Remove `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`seedAdmin()` from `js/app.js:177-196` and all demo credentials from `js/app.js:320`.
- [ ] Fix `js/app.js:41` stray quote and `js/app.js:46-52` missing image filenames.
- [ ] Replace generated SVG map (`js/app.js:467-490`) with a real map library and remove the `search-area` toast (`js/app.js:746`).
- [ ] Add server-side upload validation/storage and convert `js/app.js:858-888` to upload via API.
- [ ] Add unit/integration tests for auth, RBAC, and CRUD ownership.
- [ ] Add `.github/workflows/ci.yml` running lint and tests.
- [ ] Write `README.md` documenting setup, env vars, migration/seed commands, and roles.
- [ ] Confirm with the owner the items in Section 7 before adding verification, payments, or messaging.

## 7. Open Questions

- Is CampusNest officially affiliated with Mulungushi University, and is a verified `@mulungushi` email or student ID the intended verification source? (Code evidence is only the map label at `js/app.js:482`.)
- Which entity is authoritative for listings and users going forward: the browser `localStorage` prototype or the Postgres API? (`js/data.js:1-11` vs `server/config/db.js:4-10`.)
- What are the intended role names and permission matrix for "Hostel Admin" / "Super Admin" / caretaker, which are currently absent (`js/app.js:175,1156-1163`)?
- Should the platform cover on-campus hostel bed allocation in addition to off-campus boarding houses? (No code evidence for on-campus; `js/data.js:44-51` is off-campus only.)
- Which payment provider(s) are required (MTN MoMo, Airtel Money, Zamtel Kwacha, Flutterwave, Paystack, DPO, Broadpay) and who holds the merchant account? (No code evidence.)
- Should rent deposits and lease documents be stored, and what retention/consent policy applies to student ID documents? (No such fields in `js/app.js:287-305`.)
- Are the hardcoded demo/admin accounts (`js/app.js:177-196,320`) acceptable for a demo environment only, and must they be removed before any deployment?
- What hosting/deployment target is planned? (No Docker, hosting config, or IaC found.)
- Is the local Node/npm version observed during audit (`v26.13.1` / `11.20.0`) the intended production runtime? (No constraints in repo.)
- Are the missing images (`house1.jpg`–`house4.jpg`) intentionally omitted or simply not yet added (`js/app.js:46-52`, `image/README.txt:1-3`)?

# CampusNest Codebase Reconnaissance

## Architecture summary

CampusNest is a vanilla-JavaScript single-page marketplace served by an Express 5 API, backed by PostgreSQL through raw `pg` queries and SQL migrations. Local startup uses `backend/server.js`; `api/index.js` exports the same app for Vercel, whose configuration serves the frontend and rewrites API routes (`frontend/index.html:22-25`, `backend/app.js:33-74`, `backend/server.js:1-6`, `api/index.js:1`, `vercel.json:3-9`).

## Stack and external services

- **Languages/runtime:** JavaScript, HTML, and CSS. Node.js `>=18` is declared in `package.json:17-20`; the inspected environment is Node `v26.13.1` and npm `11.20.0`.
- **Backend:** Express `5.3.0`, PostgreSQL driver `pg` `8.23.1`, Zod `4.6.7`, `jsonwebtoken` `9.0.3`, `bcrypt` `6.0.0`, Helmet `8.3.0`, and `express-rate-limit` `8.7.5` (`package.json:21-33`; installed versions confirmed with `npm ls --depth=0`).
- **Database:** PostgreSQL via a connection pool and parameterized raw SQL; there is no ORM (`backend/config/db.js:5-14`). The connected local database reports PostgreSQL `18.6`; CI provisions PostgreSQL 16 (`.github/workflows/ci.yml:12-19`).
- **External services:** Cloudinary signed image uploads and AWS S3 presigned PUT uploads (`backend/lib/storage.js:21-29,32-62`); MTN MoMo Collection and webhook integration (`backend/lib/momo.js:5-15,25-56,69-75`); Leaflet from `unpkg.com`, OpenStreetMap tiles, and Google Fonts (`frontend/index.html:8-12,22`, `frontend/js/app.js:587-592`).
- **Build/deployment:** npm scripts cover start/dev, database migration/seed/check, and tests; there is no frontend build or lint command (`package.json:6-13`). Vercel serves `frontend/` and rewrites API requests (`vercel.json:3-9`).

## Important project structure

- `frontend/` — SPA shell, application logic, API wrapper, CSS, data helpers, and static assets; scripts are loaded in order from `frontend/index.html:22-25`.
- `backend/config/` — environment validation, PostgreSQL pool, and transaction helper (`backend/config/env.js:1-43`, `backend/config/db.js:1-25`, `backend/config/tx.js:1-19`).
- `backend/middleware/` — cookie/JWT authentication, origin checks, request validation, and centralized errors (`backend/middleware/auth.js:5-75`, `backend/middleware/security.js:3-11`, `backend/middleware/validate.js:7-24`, `backend/middleware/error.js:5-31`).
- `backend/lib/` — user/notification helpers, listing state/locking, photo storage adapters, and MoMo integration (`backend/lib/helpers.js:3-21`, `backend/lib/listingStatus.js:1-25`, `backend/lib/storage.js:7-62`, `backend/lib/momo.js:1-75`).
- `backend/routes/` — API modules for auth, config, zones, listings, requests, reviews, saved listings, reports, admins, notifications, receipts, uploads, and payments; mounted centrally in `backend/app.js:56-68`.
- `backend/migrations/` — relational schema and payments extension; `backend/migrate.js` records and applies migrations, while `backend/seed.js` seeds core and optional demo data (`backend/migrations/001_init.sql`, `backend/migrations/002_payments.sql`, `backend/migrate.js:6-33`, `backend/seed.js:36-66,69-130`).
- `api/` and `vercel.json` — serverless adapter and Vercel routing configuration (`api/index.js:1`, `vercel.json:3-9`).
- `tests/` — one Node built-in test file, `tests/api.test.js`; CI runs it against PostgreSQL (`tests/api.test.js:1-18`, `.github/workflows/ci.yml:9-47`).

## Main request lifecycle: login, then submit a space request

1. `frontend/index.html:22-25` loads frontend scripts. At startup, `frontend/js/app.js:1215-1223` removes legacy keys, loads a limited `sessionStorage` profile cache, and refreshes the session from `/api/auth/me`.
2. The login handler in `frontend/js/app.js:1104-1109` posts credentials. `frontend/js/api.js:38-57` sends same-origin requests with credentials and normalizes API errors.
3. Middleware and routes are composed in `backend/app.js:33-40,56-68`. `backend/routes/auth.js:67-76` checks credentials, signs a JWT, and sets the session cookie. `backend/middleware/auth.js:51-68` verifies `cn_session`, reloads the user from PostgreSQL, and attaches the database user to the request.
4. The listing view in `frontend/js/app.js:267-276` loads data; browse queries are implemented in `backend/routes/listings.js:127-178` and support optional authentication.
5. The tenant request form submits through `frontend/js/app.js:1124-1132`. `backend/routes/requests.js:105-135` checks the tenant role, locks and validates the listing, writes the request transactionally, and notifies the landlord. Transaction and row-lock helpers are in `backend/config/tx.js:3-15` and `backend/lib/listingStatus.js:21-25`.

## Data model

The initial migration defines core entities and enums (`backend/migrations/001_init.sql:1-19`); `002_payments.sql:1-18` adds payments.

- `users`: identity/contact fields, unique case-insensitive email, password hash, role/status, student identifiers, and landlord verification (`001_init.sql:31-48`).
- `zones`: campus, name, distance range, display order, and active flag (`001_init.sql:50-63`).
- `listings`: landlord and zone foreign keys; campus/location/coordinates; occupancy, policy, amenities, beds, rent/deposit, and status (`001_init.sql:65-102`).
- `listing_photos`: listing foreign key, photo URL, and sort order (`001_init.sql:104-112`).
- `requests`: listing and tenant foreign keys, move-in date, duration, status, reference code, and accepted timestamp; a partial unique index prevents duplicate active requests (`001_init.sql:114-131`).
- `reviews`: listing and tenant, 1–5-star rating, and body; unique per tenant/listing (`001_init.sql:133-143`).
- `saved_listings`: user/listing composite primary key (`001_init.sql:145-151`).
- `reports`: listing, reporter, reason/status, optional reviewer, and reviewed timestamp (`001_init.sql:153-165`).
- `notifications`: recipient, type, content/link, and read timestamp (`001_init.sql:167-179`).
- `payments`: request and payer, amount/currency/provider, external/reference IDs, status, and phone (`002_payments.sql:2-18`).
- `_migrations`: migration filename and applied timestamp, created by the migration runner (`backend/migrate.js:6-14`).

Relations connect users to listings, requests, reviews, saved items, reports, and notifications; zones to listings; listings to photos, requests, reviews, saved items, and reports; and requests to payments. Foreign-key and cascade declarations are in `001_init.sql:68-69,107-108,117-118,136-137,147-148,156-161,170-179` and `002_payments.sql:4-5`.

## Security surface

- **Authentication:** JWT is signed with `JWT_SECRET` and stored in the `cn_session` `httpOnly` cookie; `/api/auth/me` reloads the DB user as the session source of truth (`backend/middleware/auth.js:5-18,29-36,51-68`). The cookie uses `SameSite=Strict`, and `Secure` in production (`backend/middleware/auth.js:5-18`). Normal auth responses remove password hashes through `safeUser()` (`backend/lib/helpers.js:3-6`).
- **Request protections:** Writes with an `Origin` header are checked against `CLIENT_ORIGIN`; credentialed CORS is origin-restricted (`backend/middleware/security.js:3-11`, `backend/app.js:33-35`). Rate limiters use an explicit `DISABLE_RATE_LIMIT` test flag, rather than automatically disabling in `NODE_ENV=test` (`backend/config/env.js`, `backend/routes/auth.js`, `backend/routes/receipts.js`, `.env.example`).
- **Secrets:** DB credentials, JWT secret, admin credentials, Cloudinary/S3 credentials, and MoMo credentials are environment settings (`backend/config/env.js:5-33`). `.env` is ignored, `.env.example` is tracked with blank secret values (`.gitignore:1-4`, `.env.example:3-29`). No committed production secret was apparent in the inspected source; CI uses dummy test credentials (`.github/workflows/ci.yml:32-35`).
- **Public or session-unguarded endpoints:** `GET /api/health` (`backend/app.js:42-54`); `GET /api/config` (`backend/routes/config.js:7-13`); `POST /api/auth/register`, `/login`, and `/logout` (`backend/routes/auth.js:43-82`); `GET /api/zones` (`backend/routes/zones.js:7-17`); public listing browse/detail (`backend/routes/listings.js:127-145,181-216`, with optional auth and `mine=1` checks); public/optional-auth reviews (`backend/routes/reviews.js:16-33`); and `GET /api/receipts/:code` (`backend/routes/receipts.js:19-46`). Static frontend files are public (`backend/app.js:72`). `POST /api/payments/webhook` does not use a user session but requires the configured shared webhook secret (`backend/routes/payments.js:45-58`, `backend/lib/momo.js:69-75`). Other admin, upload, and user-specific routes require authentication/roles as applicable; admin routes apply `requireRole('ADMIN')` router-wide (`backend/routes/admin.js:9-12`).

## Quality and health

- **Tests and runtime checks:** `npm test` passed all 13 API integration tests against the configured loopback PostgreSQL instance; there were no failures, skips, cancellations, or deprecation warnings. The database reported PostgreSQL `18.6`. `node --check` passed for frontend entry scripts, the Express app, and the Vercel entry. These checks do not replace browser/UI or production deployment verification. No build script is configured (`package.json:6-13`). CI targets Node 22 and PostgreSQL 16 (`.github/workflows/ci.yml:12-19,39-46`).
- **Coverage:** One test file contains 13 cases (`tests/api.test.js:1-18,70-247`); no coverage instrumentation/report is configured (`package.json:6-13`). As a rough module-level proxy, six of 13 route modules are definitely exercised; uploads coverage is conditional on storage configuration (`tests/api.test.js:176-213`). This is not a line/branch coverage percentage. Payments, positive admin operations, notifications, reports, reviews, saved listings, and real provider uploads lack dedicated integration coverage.
- **TODO scan:** No exact `TODO`, `FIXME`, or `HACK` matches were found in the inspected source, SQL, documentation, and JSON files.
- **Code smells/schema drift:** `frontend/js/app.js` is a 1,225-line SPA combining state, templates, validation, handlers, and routing (`frontend/js/app.js:44-51,295-333,1085-1207,1215-1225`). The browser mapping still reads `has_parking` and `water_included`, absent from the listing schema and create/update validation (`frontend/js/app.js:80-88`, `backend/migrations/001_init.sql:65-98`, `backend/routes/listings.js:39-68`). `README.md` contains only a title (`README.md:1-2`). `HANDOFF.md` omits `payments` from its table inventory and describes Phase 2 additions as uncommitted despite their presence in Git history (`HANDOFF.md:62-67,114-124`).

## Top 10 weaknesses, ranked by risk

1. **High — admin APIs return password hashes.** Some admin mutations use `RETURNING *` and return `rows[0]`; because the user table includes `password_hash`, these responses expose hashes (`backend/routes/admin.js:60-78,81-101`, `backend/migrations/001_init.sql:31-45`). Use `safeUser()` or explicit safe columns.
2. **High — upload size is not enforced server-side.** The server validates MIME type and rate-limits presign requests, but does not impose a byte limit on Cloudinary/S3 uploads. The 5 MB check is in the browser and can be bypassed (`backend/routes/uploads.js:12-27`, `backend/lib/storage.js:34-47,51-62`, `frontend/js/api.js:61-67`).
3. **High — local storage-unconfigured upload fallback is missing.** `fileToDataUrl()` exists, but `uploadListingPhoto()` throws `upload_failed` when presigning is unavailable instead of using that fallback; listing creation/editing therefore cannot add photos without a configured provider (`frontend/js/api.js:95-114,117-135`, `frontend/js/app.js:938-960,1140-1159`).
4. **Medium-high — public receipt endpoint exposes booking details by bearer code.** A valid code reveals tenant display name, listing/zone, rent/deposit, move-in date, and acceptance date. It is rate-limited but has no session-auth requirement (`backend/routes/receipts.js:10-19,24-46`).
5. **Medium-high — payments are untested and may not be idempotent.** The request-to-pay route contacts MTN before inserting a payment row; repeated submissions may create multiple attempts, and an insert failure after provider acceptance may leave an unrecorded attempt. No payment test exists (`backend/routes/payments.js:17-42`, `tests/api.test.js:70-247`).
6. **Medium — no provider-level upload tests.** Tests cover signature construction and unavailable storage, but not successful provider uploads, provider response handling, S3 behavior, or persistence of returned URLs (`tests/api.test.js:88-113,176-213`, `frontend/js/api.js:69-93`).
7. **Medium — multiple business/security routes have no tests.** No dedicated tests exercise admin mutations, saved listings, notifications, report/review eligibility, payment authorization, or rate-limit behavior; existing RBAC coverage is negative-only for listing/admin access (`tests/api.test.js:169-174,215-245`).
8. **Medium — third-party script supply-chain exposure.** Leaflet JavaScript loads from `unpkg.com` without an integrity attribute, while CSP permits the host (`frontend/index.html:11,22`, `backend/app.js:22-24`).
9. **Low-medium — frontend verification is limited.** The SPA is large and there is no frontend build, lint, or browser-test command; syntax checks do not validate DOM behavior or the end-user upload flow (`frontend/js/app.js:1-1225`, `package.json:6-13`).
10. **Low — documentation/schema drift weakens onboarding.** `README.md` is nearly empty and `HANDOFF.md` has an outdated table inventory and commit-state note (`README.md:1-2`, `HANDOFF.md:62-67,114-124`).

## What is needed to proceed

Nothing is required to complete this reconnaissance. To begin remediation, confirm which ranked issues to prioritize and whether Cloudinary or S3 is the intended production photo provider. Do not send credentials; provider secrets belong in environment or deployment secret configuration.
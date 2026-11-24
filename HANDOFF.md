# CampusNest — Phase 1 Handoff / System Overview

This document is a read-only-oriented overview of the system after Phase 1. Give it to any engineer or AI that needs full context before changing the codebase.

## What the system is

CampusNest is a student off-campus accommodation marketplace for Mulungushi University (Kabwe, Zambia). Tenants (students) browse boarding-house listings near campus, save them, send space requests, and receive booking receipts. Landlords publish listings and manage requests. Admins verify landlords, resolve reports, and suspend accounts.

## Repository layout

```
frontend/            static SPA, the ONLY directory served over HTTP
  index.html         loads data.js -> api.js -> app.js
  css/styles.css     hand-written CSS; appended "Phase 1 additions" block at line 327
  js/data.js         only photo() SVG generator (all seed data removed)
  js/api.js          fetch wrapper; window.api + window.apiErrorMessage + ApiError
  js/app.js          the entire SPA (screens, router, actions, validation, in-memory cache)
  image/             static image assets (do not edit)
backend/
  server.js          local dev entry (calls app.listen)
  migrate.js         applies backend/migrations/*.sql, tracks _migrations
  seed.js            admin + 5 zones + optional SEED_DEMO data
  utils.js           asyncHandler, httpError, idParam, isUnique
  config/
    db.js            pg.Pool, BIGINT/NUMERIC type parsers
    env.js           zod-validated environment
    tx.js            withTransaction helper
  middleware/
    auth.js          JWT in cn_session httpOnly cookie; optionalAuth/requireAuth/requireRole
    validate.js      validateBody/validateQuery (zod)
    error.js         central error handler + notFoundApi
  lib/
    helpers.js       safeUser, displayName, notify
    listingStatus.js recomputeListingStatus, lockListing (FOR UPDATE)
  routes/
    auth.js zones.js listings.js requests.js reviews.js saved.js
    reports.js admin.js notifications.js receipts.js
  migrations/001_init.sql
  scripts/test-db.js, scripts/smoke.sh
tests/               Phase 2 (node:test)
api/index.js         Phase 2 Vercel serverless entry
vercel.json          Phase 2 hosting config
package.json, package-lock.json, .env (ignored), .env.example, .gitignore, HANDOFF.md
```

## Git history

```
4753f30 feat(spa): wire to API, remove localStorage auth, add notifications and receipts
2c241d5 feat(api): auth, RBAC, listings, requests, reviews, saved, reports, admin, notifications, receipts
cdb0b8f feat(db): schema, migrations, seed
2481ce4 chore: reorganize into frontend/ and backend/
22ac441 chore: initial commit (pre-restructure baseline)
```

## Environment keys (names only — never print values)

`.env.example` documents: `PORT`, `NODE_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CLIENT_ORIGIN`, `SEED_DEMO`, `SEED_DEMO_PASSWORD`.

Phase 2 adds: `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MOMO_ENV`, `MOMO_BASE_URL`, `MOMO_CONSUMER_KEY`, `MOMO_CONSUMER_SECRET`, `MOMO_MERCHANT_ID`, `MOMO_API_USER`, `MOMO_API_KEY`, `MOMO_WEBHOOK_SECRET`.

## Data model (PostgreSQL 14+, raw `pg`, no ORM)

Enums: `user_role`, `account_status`, `campus_enum`, `occupancy_enum`, `gender_policy_enum`, `electricity_enum`, `room_type_enum`, `kitchen_enum`, `security_level_enum`, `listing_status_enum`, `request_status_enum`, `report_reason_enum`, `report_status_enum`, `notification_type_enum`.

Tables (9 + `_migrations`): `users`, `zones`, `listings`, `listing_photos`, `requests`, `reviews`, `saved_listings`, `reports`, `notifications`.

Key invariants:
- `occupied_beds` = count of ACCEPTED requests; always computed, never stored.
- Listing status: `DRAFT | ACTIVE | PAUSED | FULL | REMOVED`. `REMOVED` is terminal in Phase 1.
- Public browse shows `ACTIVE` and `FULL`; `FULL` blocks new requests.
- Request state machine: `PENDING → ACCEPTED | DECLINED_BY_LANDLORD | CANCELLED_BY_STUDENT`; `ACCEPTED → CANCELLED_BY_STUDENT | CANCELLED_BY_LANDLORD | COMPLETED`. All transitions are conditional updates with `FOR UPDATE` locks: listing row first, then request row, then `recomputeListingStatus`.
- Landlord phone/email are private. Tenants see them only on their own ACCEPTED/COMPLETED request.
- Public receipt `GET /api/receipts/:code` resolves only ACCEPTED/COMPLETED and returns redacted fields.

## API surface

Public: `GET /api/health`, `GET /api/zones`, `GET /api/listings`, `GET /api/listings/:id`, `GET /api/listings/:id/reviews`, `GET /api/receipts/:code`.

Auth: `POST /api/auth/register|login|logout`, `GET /api/auth/me`.

Tenant: `GET /api/saved`, `POST|DELETE /api/saved/:listing_id`, `POST /api/requests`, `GET /api/requests/mine`, `POST /api/requests/:id/cancel|complete`, `POST /api/listings/:id/reports`, `POST /api/listings/:id/reviews`.

Landlord: `POST|PATCH|DELETE /api/listings`, `GET /api/listings?mine=1`, `GET /api/requests/inbox`, `POST /api/requests/:id/accept|decline|cancel-by-landlord|complete`.

Admin: `GET /api/admin/stats|landlords|reports`, `POST /api/admin/landlords/:id/verify|unverify`, `POST /api/admin/users/:id/suspend|reactivate`, `POST /api/admin/reports/:id/resolve`, `POST /api/admin/listings/:id/hide`.

Notifications: `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.

All writes validate with `zod`; protected routes use `requireAuth` / `requireRole`; every SQL query is parameterized. CORS is restricted to `CLIENT_ORIGIN` with credentials.

## Front-end architecture

`app.js` is vanilla JS with a hash router. It keeps an in-memory cache `S` (users, listings, requests, inbox, reviews, saved, notifications, admin data) hydrated by `hydrate()` on route changes. Snake_case API rows are adapted by `mapUser`, `mapListing`, `mapRequest`, `mapReview`. No passwords or user data are stored in localStorage; a legacy cleanup removes `cn_*` keys on boot. `sessionStorage.cn_user` holds only `{ id, name, role, verified }` for first paint and is always confirmed by `/api/auth/me`.

All API errors surface through `toast()` using `apiErrorMessage()`. The hand-drawn SVG map is still present in `viewMap`; WhatsApp/tel/mailto links appear only with server-provided contact data; "Search this area" is still a toast.

## Phase 2 decisions made by the owner

- Hosting: Vercel, static `frontend/` + serverless `/api/*` functions.
- Photo storage: AWS S3 (presigned PUT; data URLs remain a fallback until migrated).
- Payments: MTN MoMo sandbox adapter.
- Maps: Leaflet + OpenStreetMap (no API key).
- Additionally requested: automated tests + CI, a real CSP, and this handoff audit.

## Known gaps / do not assume

- S3 and MoMo require credentials that are not in the repo; adapters must fail with clear env-key errors, never with embedded secrets.
- Vercel serverless functions are ephemeral: no local file writes, no long-lived in-memory state.
- Inline `style="..."` attributes are used throughout `app.js`; a strict CSP needs `style-src-attr 'unsafe-inline'` (or a later refactor to classes).
- Admin has no add-admin/remove-user endpoints (deliberately dropped from the prototype UI).
- Full browser verification of the 13 flows is still the human's responsibility.

## Phase 2 additions

- **Security:** real CSP in `backend/app.js` (self-only scripts, Google Fonts, Leaflet CDN, OSM tiles, `data:` images, `frame-ancestors 'none'`). `backend/middleware/security.js` rejects cross-origin writes. CSP still allows `style-src-attr 'unsafe-inline'` because `app.js` uses inline `style` attributes.
- **Vercel:** `backend/app.js` exports the Express app; `backend/server.js` is now only the local listener; `api/index.js` is the serverless entry; `vercel.json` serves `frontend/` statically and rewrites `/api/*` to the function.
- **Tests/CI:** `tests/api.test.js` uses built-in `node:test` (10 integration tests covering health, CSP, static exposure, origin checks, auth, RBAC, listings, request lifecycle and redacted receipts). `.github/workflows/ci.yml` provisions Postgres 16, migrates, seeds, starts the server and runs the tests. `npm test` now runs `node --test tests/`.
- **Storage:** `backend/lib/storage.js` uses AWS S3 presigned PUT URLs (`POST /api/uploads/presign`, landlord/tenant authenticated). Photos are still accepted as data URLs or `https://` URLs by `POST/PATCH /api/listings`.
- **Maps:** `viewMap()` now uses Leaflet + OpenStreetMap with the campus centred near Kabwe; listings without coordinates get deterministic offsets around campus. The OSM tile URL and Leaflet CDN are explicitly allowed by the CSP.
- **Payments:** migration `002_payments.sql` adds the `payments` table. `backend/lib/momo.js` is an MTN MoMo sandbox adapter (token, request-to-pay, status, webhook secret check). `POST /api/payments/request-to-pay`, `POST /api/payments/webhook`, `GET /api/payments/:id` are wired.
- **New migrations:** `001_init.sql` then `002_payments.sql`; `_migrations` currently records 2 applied files.

Phase 2 changes are currently uncommitted; review before creating a commit.

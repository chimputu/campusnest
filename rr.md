# CampusNest — Latest Changes Report

**Date:** 2026-11-25
**Scope:** Uncommitted working tree changes since `fcf5dc6 first commit` (9 modified files + 1 new file).
**Verification:** `npm test` → 10/10 tests pass (in-process Express app, ~4s).

## 1. Summary

The pending work adds **client-side listing photo uploads** with two storage backends (Cloudinary and S3), a **public runtime-config endpoint**, a **local-dev data-URL fallback**, and **self-contained tests** that boot the Express app in-process. It also relaxes rate limiters under `NODE_ENV=test` and simplifies CI by removing the external server-start/wait step.

## 2. Changes by file

### Storage & configuration
- `backend/lib/storage.js` — split `configured()` into `cloudinaryConfigured()` and `s3Configured()`; added `signCloudinaryUpload(userId)` which SHA1-signs `folder=campusnest/<userId>&timestamp=<unix>` with `CLOUDINARY_API_SECRET` and returns `{ provider, upload_url, params }`. `presignPut()` now prefers Cloudinary, falls back to S3, and returns `provider: 's3'` for S3 responses. `makeClient()` no longer self-guards; `presignPut()` checks configuration first.
- `backend/config/env.js` / `.env.example` — four new optional Cloudinary variables: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- `backend/routes/config.js` (**new, currently untracked**) — `GET /api/config` returns non-secret `cloudinary_cloud_name`, `cloudinary_upload_preset`, and a `storage_configured` boolean. Explicitly never returns API secrets.
- `backend/app.js` — mounts `/api/config` and extends CSP `img-src` with `https://res.cloudinary.com` and `connect-src` with `https://api.cloudinary.com` + `https://res.cloudinary.com`.

### Frontend (`frontend/js/api.js`)
- Added `uploadListingPhoto(file)`: validates type (JPEG/PNG/WebP) and size (≤5 MB), loads config from `window.CN_CONFIG` or `GET /api/config`, then uploads via unsigned Cloudinary preset → signed Cloudinary presign → S3 PUT → `fileToDataUrl()` fallback (canvas-compressed data URL).
- Added `uploadToCloudinary`, `uploadToS3`, `fileToDataUrl`, `validatePhoto`, `loadClientConfig`; exported `uploadListingPhoto` and `fileToDataUrl` on `window.api`.
- Added error messages: `upload_failed`, `invalid_photo_type`, `photo_too_large`.

### Tests & CI
- `tests/api.test.js` — boots the app in-process on an ephemeral port unless `TEST_BASE_URL` is set; sets `NODE_ENV=test` before requiring the app; reuses the app's DB pool for cleanup; closes the HTTP server in `after()`.
- `backend/routes/auth.js` / `backend/routes/receipts.js` — rate limiters skip when `NODE_ENV === 'test'` (prevents 429s across repeated local runs).
- `.github/workflows/ci.yml` — removed `npm start &` and the 30s health-poll step (tests now self-host).

## 3. Suggested improvements (priority order)

1. **Wire the new uploader into the UI (high).** `frontend/js/app.js:925` still uses its own `readPhoto()` (local data URL) at `frontend/js/app.js:943–951` and never calls `api.uploadListingPhoto`. As-is, the entire Cloudinary/S3 feature is unreachable from the app. Replace `readPhoto` with `window.api.uploadListingPhoto` and surface `apiErrorMessage` on failure. Also remove the now-duplicated compression logic.
2. **Pick one Cloudinary strategy (high).** The client prefers an unsigned upload preset from `/api/config`, which bypasses the server's signed `signCloudinaryUpload()` flow entirely whenever a preset is configured. Either drop the presign path as dead code, or make the server-issued signature the single path and stop exposing the preset. As written, both paths coexist and behave differently (folder scoping only in the signed path).
3. **Harden the unsigned upload preset (high).** An unsigned preset is public by design; exposing it via `/api/config` means anyone can upload to your Cloudinary cloud. Configure the preset in Cloudinary with allowed formats (jpg/png/webp), a max file size (5 MB), and folder/access restrictions; add per-user upload throttling. The 5 MB/type checks in `validatePhoto()` are client-side only and trivially bypassed.
4. **Don't key security controls off `NODE_ENV` (medium).** `skip: () => process.env.NODE_ENV === 'test'` in `auth.js` and `receipts.js` disables all auth/receipt throttling if `NODE_ENV` is ever `test` in a deployed environment. Use an explicit, validated test-only flag (e.g. `DISABLE_RATE_LIMIT`) and centralize the helper instead of duplicating it. `NODE_ENV=test` should ideally be set by the test runner/package script rather than mutated inside `tests/api.test.js`.
5. **Add coverage for the new code (medium).** No tests exercise `/api/config`, the 503 `storage_unavailable` path, the Cloudinary signature, or photo validation. Add tests asserting config leaks no secrets, that a missing-credentials setup returns 503, and that the signature is stable/correct for a fixed timestamp.
6. **Validate remote photo URLs server-side (medium).** `backend/routes/listings.js:20–24` accepts *any* `https://` URL as a photo. After moving uploads off-domain, restrict hosts to the configured Cloudinary cloud / S3 bucket (or a small allowlist) so clients cannot inject arbitrary third-party image URLs into listings.
7. **Tighten CSP scope (low).** `connect-src https://res.cloudinary.com` is likely unnecessary (delivery domain, not an API target); keep only `api.cloudinary.com` plus `tile.openstreetmap.org` unless a fetch to the delivery domain is actually required.
8. **Small cleanups (low).** In `presignPut()`, `ext` is computed before the Cloudinary branch and unused there — move it below. `/api/config` has no cache headers; a short `Cache-Control` would reduce repeat fetches. Ensure the new `backend/routes/config.js` is tracked (`git status` shows it untracked) before committing.

## 4. Risk assessment

- **Functional gap:** highest — uploads are implemented but not invoked by the SPA; users still store compressed photos as data URLs in Postgres.
- **Security:** moderate — public unsigned preset and `NODE_ENV`-based limiter bypass; both need explicit configuration/guardrails.
- **Stability:** low — tests pass; in-process test harness and CI simplification are sound, though the no-server CI path relies on DB availability via `npm run migrate`/`seed`.

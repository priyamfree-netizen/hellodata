# BillSOS Mobile — Dev Setup

## Prerequisites
- Flutter 3.41+ / Dart 3.11+ (`flutter --version`).
- Android Studio / Xcode for device+emulator builds.
- Access to the BillSOS Supabase project's **anon key + URL**, and the Worker API base URL.

## First run

```bash
cd mobile/app
flutter pub get
```

## Configuration

The app resolves config in this order: **`--dart-define` → bundled `.env` asset →
fallback**. The simplest path is the `.env` file at `mobile/app/.env` (already created,
registered as an asset in `pubspec.yaml`, and loaded by `loadEnv()` in `main`):

```
API_BASE_URL=http://10.0.2.2:8080          # origin serving /api/* (your web app / Worker)
SUPABASE_URL=https://monitor.dninfo.online
SUPABASE_ANON_KEY=<public anon key>
```

**`API_BASE_URL` must be reachable from the device running the app:**
- Android **emulator** → host machine's `localhost` is `http://10.0.2.2:<port>`
- iOS **simulator** → `http://localhost:<port>`
- **Physical device** → your dev machine's LAN IP, e.g. `http://192.168.1.5:<port>`
- **Deployed** → `https://your-domain`

The port must match your running web app (`npm run dev`; `VITE_APP_URL` in the web `.env`
is `:8080`). Auth (`/api/auth/*`) and extraction (`/api/extract/document`) go through this
origin; direct data reads go straight to `SUPABASE_URL`. So the backend must be running.

> **Email uses SMTP on the backend, not in the app.** Signup verification, password reset
> and MFA codes are sent by the Worker using its `SMTP_*` env vars. The mobile app only
> calls the API — it never holds SMTP/service-role/JWT secrets. Only the **public anon
> key** ships in the app.

Cleartext HTTP to localhost is enabled for dev (Android `usesCleartextTraffic`, iOS
`NSAllowsLocalNetworking`); production should use HTTPS.

### Overriding via --dart-define (optional)

`--dart-define` values win over `.env`. Copy the example and fill values:

- `SUPABASE_URL` — from the web `.env` `VITE_SUPABASE_URL`.
- `SUPABASE_ANON_KEY` — from `VITE_SUPABASE_ANON_KEY` (anon key only).
- `API_BASE_URL` — the Cloudflare Worker origin serving `/api/*` (same host as the web app).

Run:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://YOUR-WORKER-ORIGIN \
  --dart-define=SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

For convenience, keep a local `run.dev.sh` / VS Code launch config with these defines
(git‑ignored). A `--dart-define-from-file=env.dev.json` file is also supported and
git‑ignored.

## Never put in the app
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `EXDOC_API_KEY`, SMTP creds,
Razorpay secret. Those are server‑only (Cloudflare Worker secrets).

## Common commands

```bash
flutter analyze          # lint
flutter test             # unit/widget tests
flutter run              # debug (with the --dart-defines above)
flutter build apk        # android
flutter build ipa        # ios
dart run build_runner build --delete-conflicting-outputs   # riverpod/codegen
```

## Backend prerequisites (already on web)
The following must be applied to the linked Supabase project (they already are for web —
see project memories): custom‑auth token columns, MFA tables
(`202607030001_mfa_email_and_challenge.sql`), free‑plan grant
(`202607030003_free_plan_signup_grant.sql`), org management
(`202607020003_org_management.sql`). The mobile app needs no new migrations for Phases
0–10.

## Directory
See `01_ARCHITECTURE.md` §4 for the `lib/` layout. Planning docs live in `mobile/docs/`;
the Flutter project lives in `mobile/app/`.

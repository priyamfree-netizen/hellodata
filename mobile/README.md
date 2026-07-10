# BillSOS Mobile

Flutter mobile app for BillSOS — the **user side** of the data‑entry automation platform.
All super‑admin functionality stays on the existing web app; this client never exposes it.

- **Planning docs:** [`docs/`](docs/)
  - [Overview](docs/00_OVERVIEW.md) · [Architecture](docs/01_ARCHITECTURE.md) ·
    [Backend integration](docs/02_BACKEND_INTEGRATION.md) ·
    [Phase plan](docs/03_PHASE_PLAN.md) · [Screens](docs/04_SCREENS.md) ·
    [Dev setup](docs/05_DEV_SETUP.md)
- **Flutter app:** [`app/`](app/)

## The one‑line pitch
Point your phone at an invoice → auto‑crop → extract structured fields → review → export.

## Reuses the existing backend
- Cloudflare Worker `/api/*` (auth, extract, documents, orgs, payment).
- Supabase directly (PostgREST + Storage + Realtime) using the same JWT the web app uses.
No backend rewrite. See [Backend integration](docs/02_BACKEND_INTEGRATION.md).

## Current status
Phases 0–11 implemented end-to-end (auth incl. 2FA, onboarding, dashboard, capture →
configure → extract → processing → output, history, templates, settings, notifications,
support). `flutter analyze` is clean and unit tests pass. Not yet verified against a live
backend on a device; Phase 12 (release engineering) remains. See
[phase plan](docs/03_PHASE_PLAN.md).

## Run it

```bash
cd app && flutter pub get
flutter run \
  --dart-define=API_BASE_URL=https://YOUR-WORKER-ORIGIN \
  --dart-define=SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

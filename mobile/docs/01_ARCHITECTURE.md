# BillSOS Mobile — Architecture

## 1. Tech stack

| Concern | Choice | Why |
|--------|--------|-----|
| UI framework | **Flutter 3.41+ / Dart 3.11+** | Single codebase iOS + Android; matches installed toolchain. |
| State management | **Riverpod (`flutter_riverpod` + `riverpod_annotation`)** | Compile‑safe DI, testable, good for async auth/session state machine. |
| Routing | **`go_router`** | Declarative, supports redirect guards that mirror the web `status` gate. |
| Networking (`/api/*`) | **`dio`** + `dio_cookie_manager` + `cookie_jar` | Interceptors for auth header + refresh; cookie jar persists the refresh cookie (see backend doc). |
| Supabase data/storage | **`supabase` (Dart) or `postgrest`+`storage_client`** | Direct RLS‑protected reads/writes using the injected JWT, mirroring the web client. |
| Secure token storage | **`flutter_secure_storage`** | Keychain / Keystore for the refresh token + session marker. |
| Local cache | **`hive` / `shared_preferences`** | Cache last KPIs, org selection, recent docs. |
| Camera / scan | **`cunning_document_scanner`** (edge‑detect + crop) with `image_picker` fallback | Core capture experience. |
| File pick (PDF) | **`file_picker`** | Upload existing PDFs. |
| Realtime | Supabase Realtime channel (via `supabase` client) | `processing_jobs` live updates, mirrors web. |
| Push | **`firebase_messaging`** (+ APNs) | Job‑complete / notification push. Deferred to Phase 11. |
| Export/share | **`share_plus`** + `csv` | Share extracted data as CSV/Excel/text. |
| Charts | **`fl_chart`** | Dashboard KPIs. |

> All package choices are pinned in `pubspec.yaml`. If a package is unavailable at build
> time, prefer a maintained alternative in the same category rather than changing the layer.

## 2. Layered architecture

```
UI (screens/widgets)
   │  consumes providers, renders state
Presentation (Riverpod providers / notifiers)
   │  orchestrates use-cases, holds view state
Domain (models + repository interfaces)
   │  pure Dart, no Flutter/SDK imports
Data (repository implementations)
   │  ApiClient (dio) + SupabaseDataClient + local cache
Infrastructure
   ApiClient · SupabaseDataClient · SecureTokenStore · Env · Realtime
```

Rules:
- **Domain has no dependency on Flutter, dio, or Supabase.** Repositories return domain
  models, not raw JSON.
- Screens never call `dio`/Supabase directly — always through a provider → repository.
- One repository per bounded area (auth, org, documents, templates, extractions, billing,
  notifications, support).

## 3. Auth / session state machine

Mirror the web app's proven `status` design (see memory `project-auth-architecture`):

```
enum SessionStatus { loading, unauthenticated, noWorkspace, ready, backendError }
```

- Only **one** place (the `SessionController`) talks to the network for membership state.
- Router redirects read `SessionStatus` only — no network calls inside route guards.
- `backendError` renders a retry screen; it is **never** treated as "no workspace"
  (that bug caused redirect loops on web — do not repeat it).
- Boot sequence: load refresh token from secure storage → `POST /api/auth/refresh` →
  decode JWT claims (`sub`, `email`, `org_ids`, `is_super_admin`) → if `org_ids` empty →
  `noWorkspace` → else fetch active memberships to confirm → `ready`.

## 4. Folder layout (`mobile/app/`)

```
lib/
  main.dart
  app.dart                      # MaterialApp.router + theme + providers scope
  core/
    env/            env.dart, env.example.dart   # compile-time config
    network/        api_client.dart, api_exception.dart, interceptors/
    supabase/       supabase_client.dart          # anon key + injected JWT
    auth/           token_store.dart, session_controller.dart, session_status.dart
    router/         router.dart, guards.dart
    theme/          theme.dart, colors.dart, typography.dart
    realtime/       realtime_service.dart
    utils/          result.dart, formatters.dart
  features/
    auth/           data/ domain/ presentation/  (login, signup, verify, forgot, mfa)
    onboarding/     ...
    dashboard/      ...
    capture/        ...   # camera scan + upload
    configure/      ...   # template/category pick + trigger extract
    processing/     ...   # realtime job status
    output/         ...   # results view + edit + export
    history/        ...
    templates/      ...
    settings/       ...   # profile, billing, org, 2FA, sessions
    support/        ...
    notifications/  ...
  shared/
    widgets/        buttons, fields, empty_state, error_view, loaders, doc_card
    models/         cross-feature domain models (Profile, Organization, ...)
test/
  ...
```

## 5. Configuration & flavors

- `--dart-define` (or `flutter_dotenv`) supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `API_BASE_URL` (the Cloudflare Worker origin, e.g. the same host that serves the web app).
- Two flavors: **dev** (points at staging/self‑hosted) and **prod**.
- No service‑role key, no JWT secret, no SMTP creds ever ship in the app — those are
  server‑only. The app only holds the **anon key** + user access/refresh tokens.

## 6. Error, loading, empty states

Every list/detail screen implements the four canonical states via shared widgets:
`Loading`, `Error(retry)`, `Empty(cta)`, `Content`. Network layer maps failures to a
typed `ApiException` (`unauthorized`, `forbidden`, `notFound`, `network`, `server`,
`rateLimited`) so the UI can respond consistently (e.g. `unauthorized` → silent refresh
then retry once → else logout).

## 7. Security notes

- Access token lives in memory only; refresh token in `flutter_secure_storage`.
- Certificate pinning optional (Phase 12) for the API host.
- Respect `is_super_admin` = **ignore it**; never expose admin surfaces.
- Screenshot protection + biometric app‑lock are optional Phase 11 hardening items.

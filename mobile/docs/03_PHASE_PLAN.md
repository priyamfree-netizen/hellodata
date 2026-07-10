# BillSOS Mobile — Phase Plan (Master Roadmap)

Each phase is independently demoable and testable. Check items off as they land.
"Backend" column notes whether the phase needs any backend touch (goal: almost none).

Legend: ☐ todo · ◐ in progress · ☑ done

> **Build snapshot (2026-07-03):** Phases 0–11 are implemented end-to-end as compiling
> Flutter code — `flutter analyze` is clean and unit tests pass. Every phase's primary
> screen exists and is wired to the real backend (Worker `/api/*` + Supabase). What remains
> before "production done": run against a live backend on a device, add auto-refresh
> timer, deep links, full 2FA enrollment UI, push notifications, an edge-detection
> scanner, and release engineering (Phase 12). See per-phase notes.

---

## Phase 0 — Foundation & Setup  ☑ (mostly)
**Goal:** an app that boots, is themed, has networking + config, shows a placeholder.

- ☑ `flutter create` the project under `mobile/app/` (org `com.billsos`, iOS + Android).
- ☑ Add dependencies (riverpod, go_router, dio + cookie_manager + cookie_jar,
  flutter_secure_storage, google_fonts, shared_preferences, supabase).
- ☑ `Env` config via `--dart-define` (`env.dev.json.example`). (Flavors → Phase 12.)
- ☑ Theme: BillSOS colors/typography via an **OKLCH→Color converter** that reuses the
  web's exact `styles.css` tokens; DM Sans/DM Mono; light + dark; Material 3.
- ☑ `ApiClient` (dio) with base URL, JSON, error → `ApiException` mapping + auth header.
- ☑ `SupabaseDataClient` (anon key + injected JWT via the `headers` setter).
- ☑ `TokenStore` (flutter_secure_storage) + cookie jar for the refresh cookie.
- ☑ `go_router` with `SessionStatus`-only redirect guards + `ProviderScope`.
- ◐ Shared state widgets: error/splash done; generic Loading/Empty/Content → next.
- ☐ CI: `flutter analyze` + `flutter test` (GitHub Actions). Locally: analyze clean, tests green.
**Backend:** none.

## Phase 1 — Authentication  ◐
**Goal:** a user can log in (incl. 2FA), sign up, verify email, reset password; session
survives app restart.

- ☑ `SessionController` + `SessionStatus` state machine (§3 architecture).
- ☑ Login screen → `POST /api/auth/login`; handles `mfa_required` → code entry →
  `/mfa/challenge/verify`; resend via `/mfa/challenge/send`.
- ☑ Token handling: access in memory (JWT decode), refresh via `/api/auth/refresh`
  (cookie jar), session marker in secure storage. ☐ auto‑refresh timer (~60s before
  `exp`) + single‑flight dedupe → next.
- ☐ Signup screen → `/api/auth/signup`; email‑verify pending screen + resend.
- ☐ Forgot / reset password screens.
- ☐ Deep link handling for verify/reset tokens (`billsos://` + universal links).
- ☑ Logout → `/api/auth/logout` + clear secure storage.
- ☑ Router guards read `SessionStatus` only.
**Backend:** default Option A (cookie jar); Option B only if refresh fails on device.

> ⚠️ **Runtime not yet verified on device/emulator.** Code compiles (`flutter analyze`
> clean) and unit tests pass, but the login → refresh → RLS-query round-trip still needs
> to be exercised against a live backend with real `--dart-define` config. Do this before
> calling Phase 1 done — especially confirm the cookie-jar refresh (Option A) works on iOS.

## Phase 2 — Onboarding & Workspace  ☐
**Goal:** brand‑new users create a workspace; existing users land in their org.

- ☐ `no_workspace` gate → create‑organization screen → `create_first_organization` RPC.
- ☐ Confirm active membership → `ready`.
- ☐ Workspace switcher (multi‑org) + create another workspace (`create_organization`).
- ☐ Accept / decline pending invitations (`/api/orgs/*`, `my_pending_invitations`).
- ☐ `backend_error` retry screen (never treat as no‑workspace).
**Backend:** none (RPCs already exist).

## Phase 3 — Dashboard / Home  ☐
**Goal:** at‑a‑glance status + quick actions.

- ☐ KPI cards (docs processed, credits remaining, storage used) via dashboard KPI RPC.
- ☐ Credits‑remaining math (plan + granted + purchased − used).
- ☐ Recent documents / recent extractions list.
- ☐ Prominent **Scan** FAB → capture flow.
- ☐ Pull‑to‑refresh; cache last KPIs for instant paint.
**Backend:** none.

## Phase 4 — Document Capture & Upload  ☐  ★ core mobile feature
**Goal:** scan or pick a document and upload it.

- ☐ Camera scan with auto edge‑detect + crop (`cunning_document_scanner`); multi‑page.
- ☐ Gallery pick + PDF pick (`file_picker`).
- ☐ Client‑side compress/normalize (target reasonable size for OCR).
- ☐ Upload to Storage bucket `documents` at `"<org>/<uuid>-<name>"`.
- ☐ Insert `documents` row (`status:"uploaded"`, `source:"upload"`); orphan cleanup on
  DB‑insert failure (remove uploaded file).
- ☐ Upload progress + retry; queue if offline.
**Backend:** none.

## Phase 5 — Configure & Extract  ☐
**Goal:** choose what to extract and kick off extraction.

- ☐ Category picker (`document_categories`) + template picker (`templates`, filtered).
- ☐ Show template fields (`template_fields` where `is_enabled`) as a preview.
- ☐ Trigger `POST /api/extract/document` (document_id + resolved template).
- ☐ Handle "no template" default‑fields path.
- ☐ Navigate to Processing without blocking on the HTTP response.
**Backend:** none.

## Phase 6 — Processing (Realtime)  ☐
**Goal:** live job status.

- ☐ Subscribe to Realtime on `processing_jobs` filtered by org/document.
- ☐ Stage timeline UI: `queued → ocr → ai_extraction → validation → completed/failed`.
- ☐ Confidence + duration display; error message on `failed` with retry.
- ☐ On `completed` → route to Output.
**Backend:** none.

## Phase 7 — Output / Results  ☐
**Goal:** review, edit, export the extracted data.

- ☐ Render `extractions.data` + `extraction_fields` as an editable key/value form.
- ☐ Inline edit → persist (`useUpdateExtractionData` equivalent).
- ☐ Confidence indicators per field; low‑confidence highlight.
- ☐ Export CSV / Excel + `share_plus`; copy‑all.
- ☐ Document preview (signed URL / `/api/documents/:id/preview`).
- ☐ Delete extraction(s).
**Backend:** none.

## Phase 8 — History  ☐
**Goal:** find past work.

- ☐ List documents / jobs / extractions with status chips.
- ☐ Filters (status, category, date range) + search.
- ☐ Pagination (cursor/limit).
- ☐ Tap → Output detail.
**Backend:** none.

## Phase 9 — Templates & Categories (browse)  ☐
**Goal:** discover and select templates before scanning.

- ☐ Browse categories → templates (public + org private copies).
- ☐ Template detail: fields list, usage.
- ☐ Clone a template for the user's org (`useCloneTemplateForUser` equivalent) — optional.
- ☐ (Template authoring is web‑first; mobile is browse/select. Full editor optional/later.)
**Backend:** none.

## Phase 10 — Settings & Account  ☐
**Goal:** self‑service account management.

- ☐ Profile view/edit (`profiles`, `useUpdateProfile`).
- ☐ Change password (`/api/auth/change-password`).
- ☐ **2FA**: enroll TOTP (QR + manual key) / email OTP; disable. Shared with login challenge.
- ☐ Active sessions list + revoke (`useMyActiveSessions` / `useRevokeSession`).
- ☐ Billing view: current plan (incl. Free plan), credits, invoices, transactions.
- ☐ Organization: members list, roles (view), leave workspace, switch/create workspace.
- ☐ Notifications preferences.
- ☐ Account deletion (`useDeleteAccount`) with confirmation.
- ☐ Theme toggle, about, legal links, logout.
**Backend:** none.

## Phase 11 — Notifications & Polish  ☐
**Goal:** engagement + production quality.

- ☐ In‑app notification inbox (`notifications`, mark read).
- ☐ Push via FCM/APNs (job complete, invites, low credits). Requires Firebase project +
  a server‑side sender — **flag as the one likely backend addition** (a push‑token
  register endpoint + send hook). Keep additive.
- ☐ Support tickets (create, reply, view) + contact form.
- ☐ Offline queue for uploads; graceful degradation.
- ☐ Empty/error/skeleton states everywhere; accessibility pass; localization scaffold.
- ☐ Optional hardening: biometric app‑lock, screenshot protection.
**Backend:** push‑token register + send (additive) if push is enabled.

## Phase 12 — Release Engineering  ☐
**Goal:** shippable builds.

- ☐ App icons + splash (`flutter_launcher_icons`, `flutter_native_splash`).
- ☐ dev/prod flavors wired to signing configs.
- ☐ Android signing + Play Store listing; iOS provisioning + App Store listing.
- ☐ Crash/analytics (Sentry to match web, if keys available) — opt‑in.
- ☐ E2E smoke test on device; beta (TestFlight / Play internal).
- ☐ Store review compliance (payments, permissions rationale, privacy labels).

---

## Cross‑cutting acceptance criteria (every phase)
- No super‑admin surface is reachable, ever.
- No server‑only secret is present in the app bundle.
- New screens implement Loading/Error/Empty/Content.
- `flutter analyze` clean; unit test for new repository/notifier logic.
- Works on both iOS and Android at the phase's target screens.

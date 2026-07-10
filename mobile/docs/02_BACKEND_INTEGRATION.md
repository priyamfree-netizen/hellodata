# BillSOS Mobile — Backend Integration

This is the contract between the Flutter app and the existing backend. It is derived from
the web client's code (`src/api/*`, `src/lib/auth/client.ts`, `src/lib/supabase/client.ts`,
`src/lib/queries/index.ts`). **No backend rewrite** — the mobile app is a second client.

## 1. Two backends, one auth token

The web (and mobile) client talks to **two** surfaces:

1. **Cloudflare Worker API** at `API_BASE_URL` — the custom `/api/*` endpoints
   (auth, extract, documents signed URLs, orgs, payment).
2. **Supabase** directly at `SUPABASE_URL` — PostgREST (`/rest/v1/*`), Storage, Realtime,
   using the **anon key** + the user's JWT as `Authorization: Bearer`.

The magic that makes this work: **the access token issued by `/api/auth/login` is a
Supabase‑compatible JWT** signed with `SUPABASE_JWT_SECRET` (HS256), carrying
`{ sub, email, org_ids, is_super_admin, aud:"authenticated", role:"authenticated", exp }`.
So the same token authenticates against both the Worker API *and* Supabase RLS
(`auth.uid()` = `sub`). Access token lifetime: **15 minutes**.

### Supabase client setup (mirror of web)

```dart
// anon key client; inject the custom JWT per request (like src/lib/supabase/client.ts)
final supabase = SupabaseClient(
  env.supabaseUrl,
  env.supabaseAnonKey,
  // do NOT persist Supabase's own session — we manage tokens ourselves
);
// before each call, set the bearer to the current in-memory access token:
supabase.rest.headers['Authorization'] = 'Bearer $accessToken';
// (and the realtime/storage clients likewise)
```

## 2. Auth flow (`/api/auth/*`)

All are `POST` unless noted. Base = `API_BASE_URL`.

| Endpoint | Body | Returns |
|----------|------|---------|
| `/api/auth/signup` | `{ email, password, full_name? }` | created; may require email verify |
| `/api/auth/login` | `{ email, password }` | `{ access_token }` **or** `{ mfa_required:true, challenge_token, method }` |
| `/api/auth/mfa/challenge/verify` | `{ challenge_token, code }` | `{ access_token }` |
| `/api/auth/mfa/challenge/send` | `{ challenge_token }` | resend email OTP |
| `/api/auth/refresh` | — (refresh cookie) | `{ access_token }` |
| `/api/auth/logout` | — | clears refresh cookie |
| `/api/auth/verify-email` | `{ token }` | verifies |
| `/api/auth/resend-verification` | `{ email }` | resends |
| `/api/auth/forgot-password` | `{ email }` | sends reset link |
| `/api/auth/reset-password` | `{ token, password }` | resets |
| `/api/auth/change-password` | `{ current, next }` (Bearer) | changes |
| `/api/auth/mfa/enroll` `/mfa/verify` | TOTP enroll + verify | enrollment |
| `/api/auth/mfa/email/start` `/mfa/email/verify` | email‑OTP enroll | enrollment |
| `/api/auth/mfa/disable` `/mfa/unenroll` | disable 2FA | |
| `/api/auth/oauth/google` (GET) | — | Google OAuth redirect (defer on mobile) |

### Login result shape (from `src/lib/auth/client.ts`)

```
LoginResult = { ok, access_token }            // no 2FA
            | { mfa, challenge_token, method } // method ∈ {"totp","email"}
```
On `mfa`, show a code‑entry step, then call `/mfa/challenge/verify` to get the real token.

### ⚠️ The one mobile‑specific decision: the refresh token

On web, `/api/auth/login` returns the **refresh token in an `HttpOnly` cookie**
(`billsos-refresh`, `Path=/api/auth`, `SameSite=Strict`, `Secure`) — JS never sees it.
`/api/auth/refresh` reads that cookie.

Mobile clients don't have a browser cookie store, but native HTTP stacks can persist
cookies via a **cookie jar**. Two options:

- **Option A (no backend change) — cookie jar.** Use `dio_cookie_manager` + a
  `PersistCookieJar` backed by `flutter_secure_storage`. `SameSite` is a browser‑only
  concept (native clients ignore it), and prod is HTTPS so `Secure` is satisfied. Persist
  the jar across launches → `/api/auth/refresh` just works. **This is the default plan.**
- **Option B (small additive backend change) — mobile refresh body.** Add an opt‑in
  header (e.g. `X-Client: mobile`) to `handleLogin`/`handleRefresh` that *also* returns
  the raw refresh token in the JSON body, so the app can store it in secure storage and
  send it as `Authorization`/a body field on refresh. Only pursue if Option A proves
  flaky on iOS. Keep it additive — the web cookie path must remain unchanged.

**Decision: start with Option A.** Revisit only if refresh fails on device.

Access‑token refresh scheduling mirrors web: refresh ~60s before `exp`.

## 3. Extraction pipeline (`/api/extract/document`)

`POST /api/extract/document` with `Authorization: Bearer <jwt>` and JSON:

```json
{ "document_id": "<uuid>", "template_id": "<uuid?>", "document_type": "invoice?",
  "fields": { "<key>": "<description>?" }, "options": {} }
```

Behavior (from `src/api/extract.ts`): the Worker validates access to the document,
resolves the template (explicit → document's → default fields), creates a
`processing_jobs` row, downloads the file from Storage, submits to the ExDoc OCR/AI
service, polls to completion, writes an `extractions` row + `extraction_fields`, updates
the document to `extracted`, and returns:

```json
{ "job_id", "document_id", "extraction_id", "status": "done", "data": { ...fields } }
```

This call can take tens of seconds. **Mobile UX:** fire it, then navigate to the
Processing screen which subscribes to Realtime on `processing_jobs` (see §5) rather than
blocking on the HTTP response. The final HTTP response is a bonus/confirmation.

## 4. Document upload flow

Mirror `useUploadDocument` (`src/lib/queries/index.ts`):

1. Build path: `"<organization_id>/<uuid>-<filename>"`.
2. Upload the file to Supabase Storage bucket **`documents`** (RLS‑scoped by org).
3. Insert a row into **`documents`**:
   `{ organization_id, file_name, storage_path, mime_type, file_size_bytes,
      category_id?, template_id?, status:"uploaded", source:"upload" }`.
4. On DB insert failure → **remove the uploaded file** (orphan cleanup — the web does this).
5. Then optionally call `/api/extract/document` (§3).

Preview / download of an existing doc:
- `GET /api/documents/:id/signed-url` → `{ signedUrl }` (1‑hour signed URL), or
- `GET /api/documents/:id/preview` → the file bytes inline (Bearer). Web also builds
  signed URLs directly via `supabase.storage.from('documents').createSignedUrl(path, 3600)`.

## 5. Direct Supabase data access (PostgREST + RLS)

For reads/writes the app uses the Supabase client with the injected JWT. Key tables the
**user side** touches (RLS restricts to the user's active org memberships):

| Table | Used for |
|-------|----------|
| `profiles` | current user profile, `two_factor_enabled/method`, `is_super_admin` (ignored) |
| `organizations` | workspace(s) |
| `organization_members` | membership + role + `status:"active"` + section access |
| `organization_invitations` | pending invites (accept via `/api/orgs/*`) |
| `document_categories` | category picker |
| `templates`, `template_fields` | template browse + fields to extract (`is_enabled`) |
| `documents` | uploaded docs + status |
| `processing_jobs` | job stage (`queued`→`ocr`→`ai_extraction`→`validation`→`completed`/`failed`) + **Realtime** |
| `extractions`, `extraction_fields` | results (`data` JSON, `confidence`, per‑field values) |
| `subscriptions`, `credit_grants` | billing view + credits‑remaining math |
| `admin_settings.free_plan` | free plan limits (read‑only display) |
| `notifications` | in‑app inbox (mark read) |
| `usage_records`, `metric_snapshots` | dashboard KPIs (also via `dashboard KPI RPC`) |
| `tickets`, `ticket_replies` | support |
| `contact_submissions` | contact form |

RPCs the user side calls: `create_first_organization` / `create_organization`
(onboarding + new workspace, applies free‑plan grant on first org), dashboard KPI RPC,
`increment_template_downloads` (server‑side only), `org_credit_summary`‑style math for
credits remaining (`plan + granted + purchased − used`).

**Realtime:** subscribe to a Postgres changes channel on `processing_jobs` filtered by
`organization_id` (and/or `document_id`) to drive the Processing screen live, exactly as
the web `/processing` route does.

## 6. Payments (`/api/payment.ts`)

Razorpay pay‑as‑you‑go (see migration `202607010001_razorpay_payg.sql`). Mobile billing
is **view‑first** in early phases (show plan, credits, invoices, transactions). In‑app
purchase / Razorpay checkout is a later phase and must respect store policies (physical
service credits vs. digital goods) — flag for review before implementing.

## 7. Org / membership management (`/api/orgs/*`)

Token‑based email invitations, member role management, ownership transfer, leave/delete
workspace, multi‑workspace creation. Mobile exposes the **member‑facing** subset:
view members, accept/decline invitations, leave workspace, switch workspace, create
workspace. Owner/admin management actions can be included read‑mostly; destructive org
actions should confirm and can defer to web.

## 8. What the app must NOT call

- Any `/api/admin*` surface or admin‑only RPC.
- Anything requiring the **service‑role key** — that is server‑only and never in the app.
- Super‑admin gated Supabase rows (RLS already blocks non‑members; the app additionally
  never renders admin UI).

## 9. Environment variables the app needs

| Var | Source | Notes |
|-----|--------|-------|
| `API_BASE_URL` | Worker origin (same host serving web) | e.g. `https://app.billsos...` |
| `SUPABASE_URL` | `.env` `VITE_SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | `.env` `VITE_SUPABASE_ANON_KEY` | **anon only** |

Never ship: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `EXDOC_API_KEY`, SMTP creds.

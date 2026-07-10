# BillSOS — Audit Implementation Status

## Completed

### Security — Critical
- Privilege self-escalation blocked: trigger prevents users from writing `is_super_admin`, `risk_score`, `credits_remaining`, `status` on their own profile
- Org hijack fixed: replaced dangerous RLS policy with atomic `create_first_organization()` SECURITY DEFINER RPC — no more client-side 3-step flow that let any user insert themselves as owner of any org

### Security — High
- `dashboard_kpis()` RPC restricted to service_role + super-admin only
- Job claiming uses `claim_processing_jobs()` RPC with `FOR UPDATE SKIP LOCKED` — no race condition between concurrent workers
- `audit_logs` write policy dropped — triggers write audit rows, not users
- `workers` table hidden from regular authenticated users
- `feature_flags` restricted to super-admin only
- `write_audit_log()` trigger fixed to capture service-role actor via `app.actor_id` fallback
- `metric_snapshots` unique index added per metric per day
- `vendor_apis` no longer public — requires authenticated session
- `webhook_deliveries` schema fixed: added `status`, renamed `request_body → payload`, `status_code → response_status`
- `webhooks` table: renamed `url → endpoint_url`, `secret_hash → secret_key`

### Security — Medium
- Performance indexes: `org_members_user_status_idx`, `org_members_admin_lookup_idx`, `profiles_superadmin_idx`
- `profiles` read policy consolidated — users see their own profile + same-org member profiles only
- `add_org_credits()` RPC created with super-admin guard and positive-amount validation
- `api_idempotency_keys` table created (service_role only, 24h TTL)
- `feature_flag_overrides` policy uses `auth_user_is_super_admin()` helper instead of inline subquery
- Storage `UPDATE` policies added for `documents` and `exports` buckets (were missing, caused 403 on overwrite)

### Schema Fixes
- `extractions` table: added `page_count` and `tokens_used` columns (extract worker was inserting these — silent failure without them)
- `usage_records` table: added `documents_uploaded` column (cron-rollup was inserting this — silent failure)

### Edge Functions
- `extract-api`: full rewrite — API key auth (hash lookup), expiry check, scope check (read_only rejected), rate limit via RPC, storage quota check, MIME + size validation, filename sanitization, idempotency via `api_idempotency_keys`, structured JSON logging, X-Request-ID
- `extract`: service-role auth guard, atomic job claiming via RPC, structured logging
- `webhook-dispatch`: SSRF protection (blocks RFC1918 + localhost + `.internal`), HMAC-SHA256 signature, timeout + abort, structured logging
- `cron-rollup`: service-role auth guard, idempotent metric_snapshots via delete+insert, correct `total_pages` sum (was using row count)
- `delete-account`: new function — JWT verification, body/JWT user_id cross-check, sole-owner org cleanup, cascading auth deletion

### Frontend
- Auth state machine: `loading → unauthenticated / no_workspace / ready / backend_error`
- Route guards: `requireAuth`, `requireSuperAdmin` on all app + admin routes
- `superAdminCache` — eliminates redundant DB call on every admin route navigation
- `setCurrentOrg` writes to DB first, then updates local state (was reversed — state desync on failure)
- `useCreateOrganization` uses `create_first_organization()` RPC instead of 3-step client insert
- `useDeleteAccount`, `useChangePassword`, `useAddCredits` — all wired up and functional
- Onboarding flow: redirects to `/onboarding` when user has no org; submits via RPC
- 2FA enrollment + verify flow in settings
- Active session list + per-session revoke in settings
- Notification inbox (bell icon) — in-app notifications, localStorage read tracking
- Org switcher in sidebar
- Feature flag per-org overrides — expandable UI in admin panel
- CSP with per-request nonce (HTMLRewriter injection for Cloudflare Workers, TransformStream fallback for dev)
- HTTP → HTTPS redirect in `server.ts`
- Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy

### Infrastructure
- CI pipeline: `.github/workflows/ci.yml` — tsc, eslint, vite build, Playwright smoke test on PRs
- Playwright smoke test: `e2e/smoke.spec.ts` — login redirect, auth flow
- `types:sync` script in package.json — `supabase gen types typescript --linked`
- Storage orphan fix: upload rolls back file on DB insert failure
- Storage quota trigger: blocks uploads when org is over limit
- Audit log triggers on all major tables
- Cursor-based pagination on user list
- Recharts lazy-loaded in all 7 admin routes

---

### Additional fixes (this session)
- Webhook retry/backoff: `next_attempt_at` column + index on `webhook_deliveries` (migration 002200); dispatcher updated — failed deliveries retry up to 5 times on schedule 1m/5m/30m/2h; SSRF permanently failed immediately
- Row cleanup: `cron-rollup` now deletes expired `api_idempotency_keys` and stale `api_rate_counters` windows on every daily run
- pg_cron schedules: migration 002300 registers `billsos-cron-rollup` (00:05 UTC), `billsos-extract-worker` (every 1 min), `billsos-webhook-dispatch` (every 1 min) — requires pg_cron + pg_net extensions enabled and two GUC settings (see migration file header)
- Storage orphan cleanup: `delete_document_storage_object()` trigger on `documents` table calls pg_net HTTP DELETE to Storage when a document row is deleted — files removed automatically alongside the DB record

---

### Additional fixes (final session)
- **Mindee extraction**: `callVendorApi()` stub replaced with real Mindee Invoice API v4 call — extracts supplier name, invoice number, date, amounts, line items, currency. Requires `MINDEE_API_KEY` Supabase secret.
- **Transactional email**: `supabase/functions/_shared/email.ts` — Resend helper with HTML templates. `extract/index.ts` sends "Extraction complete" / "Extraction failed" emails to the org owner after each job. Requires `RESEND_API_KEY` and `EMAIL_FROM` secrets.
- **Stripe integration**: `stripe-webhook/index.ts` — handles `checkout.session.completed`, `subscription.updated/deleted`, `invoice.paid/payment_failed`. `create-checkout/index.ts` — creates Checkout Sessions (new subscription) or Customer Portal sessions (manage/cancel). Migration 002400 adds `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `stripe_invoice_id` columns.
- **Billing page wired**: Upgrade button opens plan picker modal → Stripe Checkout. "Manage / Cancel" and "Add / Manage" buttons open Stripe Customer Portal. Error banner shown on failure.
- **Sentry**: `@sentry/react` added to frontend. Initialized from `VITE_SENTRY_DSN` env var. `ErrorComponent` in `__root.tsx` calls `Sentry.captureException()`.
- **PostHog**: `posthog-js` added to frontend. Initialized from `VITE_POSTHOG_KEY` env var with `capture_pageview` and `capture_pageleave` enabled.

---

## Remaining (manual setup — no code needed)

### 1. Set Supabase secrets
In Supabase Dashboard → Project Settings → Edge Function Secrets, add:
| Secret | Value |
|--------|-------|
| `MINDEE_API_KEY` | From mindee.com → API Keys |
| `RESEND_API_KEY` | From resend.com → API Keys |
| `EMAIL_FROM` | `BillSOS <noreply@yourdomain.com>` (domain must be verified in Resend) |
| `STRIPE_SECRET_KEY` | From Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks → `whsec_…` |
| `APP_URL` | `https://app.billsos.com` (your production domain) |

### 2. Configure Stripe
1. Create products + prices in Stripe Dashboard and copy each price ID into the `plans.stripe_price_id` column
2. Create a Webhook endpoint in Stripe Dashboard pointing to: `https://<ref>.supabase.co/functions/v1/stripe-webhook`
   - Events to enable: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
3. Enable the **Stripe Customer Portal** in Stripe Dashboard → Billing → Customer Portal (configure branding + allowed actions)

### 3. Enable pg_cron + pg_net and set GUC settings
In Supabase Dashboard → Database → Extensions, enable **pg_cron** and **pg_net**. Then run in SQL editor:
```sql
alter database postgres set app.supabase_url     = 'https://<ref>.supabase.co';
alter database postgres set app.service_role_key  = '<your-service-role-key>';
```
Then re-run migration 002300 or call `cron.schedule(...)` manually.

### 4. Set frontend env vars
In Cloudflare Pages → Settings → Environment Variables (or `.env.production`):
| Var | Value |
|-----|-------|
| `VITE_SENTRY_DSN` | From Sentry → Project → Settings → Client Keys |
| `VITE_POSTHOG_KEY` | From PostHog → Project → Settings |
| `VITE_POSTHOG_HOST` | `https://app.posthog.com` (or your EU host) |

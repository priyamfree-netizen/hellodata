# BillSOS — Project Audit

> Engineering review of the current state of the codebase: what's solid, what's
> half-done, what's risky, and what's missing for production. Use this file as a
> working checklist; each item lists the problem, why it matters, where it
> lives, and what to do next.

_Last reviewed: branch `main`, commit at-time-of-audit._

---

## Project Summary

BillSOS is a finance-team-facing platform for batch-extracting structured data
from invoices, GST returns, bank statements, salary slips, etc. The stack is:

- **Frontend**: React 19 + TanStack Start (file-routed SSR) + Tailwind v4 +
  shadcn-style components + Framer Motion + Recharts.
- **Backend**: Supabase (Postgres + Auth + Storage). Migrations in
  `supabase/migrations/`. RLS on every table.
- **Data access**: TanStack Query hooks centralized in `src/lib/queries/index.ts`.
- **Deploy target**: Cloudflare Workers (via `@cloudflare/vite-plugin` and
  `wrangler.jsonc`).
- **Routes**: marketing landing, auth (login/signup/forgot-password), a
  user-facing app (`/dashboard`, `/upload`, `/processing`, `/history`,
  `/output`, `/templates`, `/categories`, `/configure`, `/api-keys`,
  `/settings/**`), and a 17-page super-admin console at `/admin/**`.

Schema covers organizations, profiles, plans/subscriptions/invoices, document
categories, templates, documents, processing jobs, workers, extractions,
exports, API keys, webhooks, vendor APIs, integrations, feature flags,
notifications, audit logs, security events, tickets, usage records, metric
snapshots — backed by RLS helpers and a `documents`/`exports` storage bucket.

What is **not** present: an actual document-processing worker, payment
provider integration, email delivery, real-time updates, and route-level auth
guards.

---

## What is Already Working

These pieces are wired end-to-end and can be exercised by a developer right
now (with Supabase env vars set):

- **Auth flows** — `signup` / `login` / `forgot-password` hit
  `supabase.auth.signUp` / `signInWithPassword` / `resetPasswordForEmail`.
  OAuth (GitHub + Google) buttons are functional.
  _Files_: `src/routes/login.tsx`, `signup.tsx`, `forgot-password.tsx`.
- **Profile auto-creation** — Postgres trigger `handle_new_user()` writes
  `public.profiles` on every `auth.users` insert.
  _Files_: `supabase/migrations/…000100_organizations_and_profiles.sql`.
- **Session-aware shell** — `AuthProvider` loads session + profile + orgs;
  the sidebar shows the real user/org and signs out properly.
  _Files_: `src/lib/supabase/auth.tsx`, `src/components/app-shell.tsx`.
- **Profile + org settings** save real changes (`useUpdateProfile`,
  `useUpdateOrganization`, `useInviteMember`).
- **API keys** — create (raw shown once), list, revoke. Stored with SHA-256
  hash + prefix.
  _Files_: `src/routes/api-keys.tsx`, hook in `src/lib/queries/index.ts`.
- **Document upload** — drag/drop → Supabase storage (`documents/<org_id>/…`)
  → `documents` row → `processing_jobs` row in stage `queued`.
  _Files_: `src/routes/upload.tsx`, `useUploadDocument` hook.
- **Categories, templates, template fields** — read from DB, with a working
  field-count trigger and a field-toggle mutation.
- **Admin console** — every admin page reads real DB rows via the hooks +
  legacy-shape adapters in `src/lib/admin-data.ts`.
- **Schema** — 10 ordered migration files, RLS on every table, idempotent
  reference-data seed, dev `seed.sql`, storage bucket policies.
- **Type-check & build** — `npx tsc --noEmit` is clean; `npm run build`
  produces a working Cloudflare Worker bundle.
- **Cloudflare-aware error handling** — `src/server.ts` already normalises the
  h3 `{ unhandled: true }` SSR-swallow case into a branded 500.

---

## Pending Work / Incomplete Parts

Concrete inline mock data and stub handlers that survived the migration off
`admin-data.ts`:

1. **Static AI-status panel on `/dashboard`.**
   - Problem: "Document classifier / Field extractor v3.1 / Tax rules engine /
     Vector store" are hard-coded as healthy strings, not from a system-health
     source.
   - Why it matters: lies to the user when something is actually down.
   - Where: `src/routes/dashboard.tsx:144-147`.
   - Next: poll `vendor_apis` (or a new `system_health` table) and render the
     real `status` per service.

2. **User detail panel still uses inline fake history.**
   - Problem: `/admin/users` detail tabs render hand-crafted "Billing /
     Activity / Security / API" lists.
   - Where: `src/routes/admin/users.tsx:308-403` — six `Array.from({ length:
     N }, …)` blocks for billing rows, activity, sessions, API keys.
   - Next: join `transactions`, `audit_logs` (by `actor_id`), `user_sessions`,
     `api_keys` for the selected user.

3. **Bulk-action handlers are stubs.**
   - Problem: `[Suspend, Assign Plan, Add Credits, Send Notification, Enable
     Beta, Export, Delete]` all `onClick: () => {}`.
   - Where: `src/routes/admin/users.tsx:204-212`.
   - Next: implement each as a mutation (e.g. `useSuspendUser`,
     `useAddCredits`) and call it on bulk-selected rows.

4. **Channel stats on `/admin/notifications` are hardcoded.**
   - Where: `src/routes/admin/notifications.tsx:20-25` (12,400 emails, 91%
     in-app open rate, etc.).
   - Next: aggregate from `notifications` rows over a date range.

5. **Revenue chart and analytics charts are zero-filled.**
   - Problem: `revenueData`, `apiUptimeData`, `mrrData`, `queueData`,
     `infraMetrics.*.data` arrays return `Array.from({length: N}, () => 0)`.
   - Where: `src/routes/admin/index.tsx`, `admin/billing.tsx`,
     `admin/analytics.tsx`, `admin/queue.tsx`.
   - Next: populate `metric_snapshots` with a cron, then read via
     `useMetricSnapshots()`.

6. **`generateSparkline()` returns a zero-line.**
   - Where: `src/lib/admin-data.ts:498-504`.
   - Next: replace with `useMetricSnapshots('cpu' | 'memory' | …)` per chart.

7. **Stubbed buttons on user-facing pages.**
   - `Re-download` (dashboard exports), `Bulk edit` / `Export selected`
     (output), `Pause` job (processing), upload-from-URL, Google Drive / S3
     buttons (upload, dashboard).
   - Next: each needs a mutation + signed URL + queueing logic.

8. **Configure page renders a static `DocumentMock`**, not the user's actual
   document preview.
   _Where_: `src/routes/configure.tsx:236-280`.
   _Next_: pull a thumbnail or PDF render from `documents.storage_path`.

9. **Settings → Profile shows "Last Password Change: 42 days ago" stub**
   in the user detail security tab.

10. **Admin user-management Activity / Sessions tabs use fabricated entries.**
    See item 2.

11. **Marketing landing has hardcoded "Trusted by" logos and a "Now extracting
    from 38 document types" badge.** Cosmetic — only relevant if you intend the
    site to be marketing-trustworthy.

---

## Bugs and Risk Areas

1. **No route-level auth guards.**
   - Problem: `/dashboard`, `/admin/**`, `/settings/**`, `/api-keys`, etc. all
     render even when there is no session. The shell pulls
     `useAuth().currentOrg` → `null`, so queries quietly disable themselves
     but the page chrome still shows.
   - Why it matters: anyone hitting `/admin` sees the layout; nothing checks
     `is_super_admin` client-side either (RLS is the only barrier).
   - Where: `src/routes/__root.tsx`, every route file. No `beforeLoad`
     anywhere (verified by grep).
   - Next: add `beforeLoad` on `/admin/route.tsx`, `/dashboard.tsx`,
     `/settings/route.tsx`, `/api-keys.tsx`, etc. that checks the Supabase
     session and `profile.is_super_admin` and redirects to `/login` or `/`
     when missing.

2. **No `requireAuth` redirect on protected pages** — same root cause as #1.

3. **`useDashboardKpis` performs ~7 sequential `head:true` count queries on
   each invocation.** Inefficient and triggers N round trips.
   - Where: `src/lib/queries/index.ts:776-810`.
   - Next: wrap in a single Postgres `view` or `rpc()` that returns all
     counters in one call.

4. **Math.max over an empty queue-stage-counts map yields `-Infinity`.**
   - Where: `src/routes/admin/index.tsx:157` (`Math.max(...Object.values(...)`).
   - Why: causes `NaN%` widths on the queue pipeline bar at first render
     before data lands.
   - Next: `Math.max(1, ...values)`.

5. **`/admin/index.tsx` "Top Enterprise Customers" sorts orgs by
   `pagesProcessed` but reports MRR as `pagesProcessed * 5` — fabricated
   currency value.**
   - Where: `src/routes/admin/index.tsx:42-46`.
   - Next: join active `subscriptions` × `plans.price_amount_inr` per org.

6. **`useApiKeys` SHA-256 hashes the raw key client-side**, then sends both
   prefix and hash to Postgres. That's fine if you trust the browser, but it
   means anyone with the anon key can _insert_ an api-key row claiming any
   hash — they could then claim to own a key they don't actually possess.
   - Where: `src/lib/queries/index.ts:573-617`.
   - Next: move generation + hashing into an Edge Function (service role) so
     the client never sees raw key generation logic.

7. **No deduplication enforcement at upload time** — there is a partial unique
   index `documents_org_sha` on `(organization_id, sha256)`, but the client
   never computes a SHA. So the dedup option in the upload UI is a lie.
   - Where: schema in `…000400_documents_processing.sql`, UI in
     `src/routes/upload.tsx`.
   - Next: hash files client-side (or in a worker) and pre-check.

8. **Storage bucket creation lives in a migration**, but Supabase bucket
   creation through SQL only works if the project has the storage extension
   already enabled. On a brand-new project, you may need to also create the
   buckets through the dashboard.
   - Where: `supabase/migrations/…000900_storage.sql`.
   - Next: doc this in `supabase/README.md` (mostly OK) and consider gating
     with `if not exists`.

9. **Inserting into `documents` after `supabase.storage.upload` does NOT roll
   back on row insert failure** — orphaned objects pile up.
   - Where: `src/lib/queries/index.ts:308-339`.
   - Next: catch the insert error and call `storage.from('documents').remove([path])`.

10. **OAuth redirect URL points at `${window.location.origin}/dashboard`.**
    Fine for dev, but Cloudflare preview deploys have rotating hostnames; you
    need to also whitelist those in Supabase Auth → URL Configuration.

11. **`mini-chart.tsx` uses `Math.random()` for the SVG gradient id** which
    yields hydration mismatches between SSR and client.
    - Where: `src/components/admin/mini-chart.tsx:12`.
    - Next: use `useId()` from React.

12. **`ui/sidebar.tsx` also uses `Math.random()` for skeleton widths** —
    similar hydration risk, but only in a Skeleton placeholder so less severe.

13. **Two stale `href="#"` anchors** — Terms / Privacy on `/signup` and "Help
    & docs" in the app shell.

14. **The `<select>` for switching templates in `/configure` has an empty
    `value=""` `option` rendered only when there are no templates** — fine
    when zero templates, but if the user has no permission to write a
    template, they hit a dead end.

---

## Missing Backend Features

1. **Extraction worker / queue consumer.** Schema defines
   `processing_jobs.stage = 'queued'`, but nothing transitions it forward.
   - Why it matters: this is the actual product. Uploads sit forever.
   - Next: an Edge Function (`supabase/functions/extract.ts`) or a Cloudflare
     cron-triggered worker that:
       1. selects N `queued` rows,
       2. claims them (`update … set stage='ocr', worker_id=$me, started_at=now()`),
       3. downloads the file from storage,
       4. calls a vendor API (`vendor_apis` table holds endpoints),
       5. writes `extractions` + `extraction_fields`,
       6. updates the job stage to `completed`/`failed`.

2. **Webhook delivery worker.** `webhooks` and `webhook_deliveries` tables
   exist; no code posts payloads anywhere.
   - Next: on `extractions.status='done'`, enqueue webhook deliveries; an
     Edge Function POSTs with HMAC signature (`secret_hash`) and records the
     response in `webhook_deliveries`.

3. **API request handler for `POST /v1/extract`** advertised on the API-keys
   page. Currently zero implementation; the cURL snippet is aspirational.
   - Next: Edge Function `supabase/functions/extract-api.ts` that validates
     the `Authorization: Bearer …` against `api_keys.key_hash`, accepts a
     `multipart/form-data`, and inserts a job.

4. **Rate-limiting on API key usage.** `plans.api_rate_limit` exists; nothing
   enforces it.
   - Next: a Postgres function + table for sliding-window counters, or
     Cloudflare Workers KV per `api_key_id`.

5. **Storage size enforcement.** `plans.storage_limit_bytes` and
   `organizations.storage_used_bytes` exist but no trigger keeps the latter
   in sync, and uploads aren't blocked at quota.
   - Next: trigger on `documents` insert/delete that updates
     `organizations.storage_used_bytes`; a Postgres `before insert` check
     compares to plan limit.

6. **Email delivery.** Supabase Auth sends auth emails (signup/reset)
   automatically, but app-level emails (invite member, payment failed,
   processing complete) have no transport.
   - Next: integrate Resend/Postmark in an Edge Function; trigger on
     `user_notifications` insert or via Postgres `pg_net`/HTTP webhooks.

7. **Background job for daily `usage_records` rollups.** The table exists,
   nothing fills it.
   - Next: a `pg_cron` job (or external scheduler) aggregates yesterday's
     `extractions` + storage usage per org.

8. **`metric_snapshots` cron.** Same problem: schema present, no writer.
   Without it, every chart is a flat zero line.

9. **Server-only Supabase client is defined but never imported anywhere** —
   no Edge Functions exist yet.
   - Where: `src/lib/supabase/server.ts`.

10. **Realtime subscriptions** — no `supabase.channel(...)` anywhere. Job
    progress on `/processing` requires manual refresh.
    - Next: subscribe to `postgres_changes` on `processing_jobs` filtered by
      `organization_id`.

11. **No `RPC` functions** for any of the cross-table writes that should be
    atomic (e.g. "promote member to admin AND log audit row").

12. **No file-virus / file-type / file-size enforcement at the storage layer**
    beyond client-side `accept=` attributes.

---

## Missing Database / Schema Items

1. **`webhooks` and `audit_logs` lack triggers.** Jobs and extractions don't
   automatically write audit entries; webhooks don't fire on the events they
   would care about.
   - Next: triggers on the four or five interesting tables that insert
     `audit_logs` and `webhook_deliveries` rows.

2. **No `organizations.storage_used_bytes` maintenance trigger.** Field is in
   the schema but is never recomputed.

3. **No `subscriptions.subscribers_count` on `plans`.** Admin/plans shows
   "0 subscribers" because the page does not count active subscriptions.
   - Where: `src/routes/admin/plans.tsx`.
   - Next: a `usePlanSubscriberCount(planId)` hook (or a SQL view) that
     counts active subscriptions per plan.

4. **`tickets` lacks SLA-breach logic.** `sla_deadline` is a column; no view
   or trigger flags overdue tickets.

5. **No `extraction_fields` natural index on `(field_key, value_text)`.**
   `/output` filters/searches will full-scan once the table grows.

6. **No `documents.text_search` `tsvector`.** Full-text search across
   extracted documents is impossible without it.

7. **`sha256 text` should ideally be `bytea` or fixed-length `char(64)`** —
   minor space win.

8. **`storage_buckets` migration doesn't create the bucket on `db reset`** if
   the storage extension isn't pre-enabled in the local Supabase
   Docker stack — known Supabase CLI quirk worth documenting.

9. **No partitioning strategy for `audit_logs`, `processing_jobs`,
   `extractions`** — these tables grow without bound. At 100K orgs and
   100 jobs/day, they hit 10M rows/year. Plan partition-by-month.

10. **No `feature_flag_overrides` per org/user.** The flags currently apply
    globally; the UI implies environment-specific rollout but there's no
    targeting table.

11. **`integrations` table has aggregate counts (`syncs_today`,
    `failed_syncs`) baked in.** Those should be computed from a `sync_runs`
    table, not stored.

12. **No `email_templates` table** for system emails (invite, receipt, etc.).

13. **No `documents.text_extracted_at`, `extractions.tokens_used`,
    `extractions.cost_inr`** — these matter for cost accounting per
    extraction and for the `plans.ai_token_limit` enforcement.

---

## Missing Admin Features

1. **No "impersonate user" implementation.** Button exists in user detail
   panel (`src/routes/admin/users.tsx:280`); does nothing.

2. **No "force logout" / "reset API keys" wired to actions.** Same panel.

3. **No `/admin/audit` route** to browse `audit_logs` directly. The data is
   modelled but the page is missing.

4. **No bulk message / broadcast tool.** `/admin/notifications` has a "New
   Notification" button that doesn't open a composer.

5. **No org-impersonation banner.** When a super-admin views an org, there's
   no signalling that they're acting cross-tenant.

6. **No template review / approval workflow.** `templates.status` includes
   `review` and `rejected` but the admin templates page doesn't expose an
   approve/reject mutation.

7. **No feature-flag targeting UI** (env percent only, no per-org overrides).

8. **`/admin/storage` shows hardcoded breakdown** (`{ type: "PDF Documents",
   pct: 50 }`). Real breakdown would aggregate from
   `documents.file_size_bytes`.

9. **No `/admin/exports` view of recent exports** across all orgs.

10. **No retention / data-deletion controls** (GDPR / DPDP delete flow).

---

## Missing User Features

1. **No "delete account" implementation.** The danger-zone button on
   `/settings` is decorative.

2. **No org switcher.** `useAuth().setCurrentOrg` exists; no UI calls it.
   Users in multiple orgs can't switch workspaces.

3. **No "create organization" flow for new sign-ups.** First-time users land
   with no `currentOrg` and the dashboard largely empties out.

4. **No email-verification redirect handler** beyond Supabase's default
   `?token=...` link.

5. **No password change flow** when the user knows their current password
   (separate from the reset link).

6. **No 2FA setup UI.** `profiles.two_factor_enabled` is in the schema; no
   page enrolls TOTP via Supabase Auth MFA.

7. **No file-preview** of uploaded documents.

8. **No CSV/Excel export implementation.** Buttons on `/output` and
   `/history` don't trigger downloads.

9. **No real-time progress on `/processing`.** Page must be refreshed.

10. **No template duplication / import-from-marketplace** flow.

11. **No team-level templates / scope filtering UI.** Schema has a
    `team` field on `organization_members`; nothing surfaces it.

---

## Missing Security / Auth Items

1. **No route guards** (see Bugs #1). Critical.

2. **No CSP / security headers** on the Cloudflare worker response.

3. **No CSRF protection** on mutating endpoints (acceptable when only
   Supabase RLS is used, but Edge Functions added later must enforce it).

4. **No password complexity rules** beyond `minLength={8}` on the signup
   form.

5. **No account-lockout** after N failed login attempts (Supabase has
   defaults but they're not configured here).

6. **No session revocation UI.** `user_sessions` table exists; users can't
   revoke other devices.

7. **No audit-log writer on auth events.** Sign-in / sign-out / password
   change should emit `audit_logs` rows.

8. **No CAPTCHA on signup / forgot-password.** Mass-signup abuse is easy.

9. **API keys are not rotated.** No "rotate" mutation, only revoke.

10. **No IP allowlist** per API key (would map naturally to a JSONB column on
    `api_keys`).

11. **No webhook signature secret rotation** flow.

12. **`SUPABASE_SERVICE_ROLE_KEY` is read from `process.env`** — works on
    Node-style runtimes; on Cloudflare Workers it needs to come from
    `env.SUPABASE_SERVICE_ROLE_KEY` via the fetch handler. The current code
    will throw on Cloudflare.
    - Where: `src/lib/supabase/server.ts:9-22`.

---

## Missing Analytics / Monitoring

1. **No application telemetry.** No PostHog / Mixpanel / Plausible / Sentry
   integration. Errors are caught and logged to `console.error` but lost.

2. **No `metric_snapshots` writer** (covered above).

3. **No funnel tracking** for signup → first upload → first export.

4. **No request log table** for API key usage (rate limiting + per-org
   billing depends on this).

5. **No queue-throughput metric** — `useQueueStageCounts` just counts current
   rows, not throughput over time.

6. **No SLO / uptime panel** that is driven by real probe data; the existing
   "99.97% uptime" string is hardcoded.

7. **No structured logging** — `console.log` only, no JSON / no correlation
   ids.

8. **No error tracking on the Worker** beyond `console.error`. The h3-swallow
   path in `src/server.ts` is good, but the error itself is lost.

---

## Missing Billing / Subscription Items

1. **No payment provider.** Schema has `payment_methods.external_ref` and
   `transactions.external_ref` — nothing inserts them.
   - Next: integrate Stripe or Razorpay. A `subscriptions` row should be
     created/updated via webhook from the provider.

2. **No upgrade / downgrade UI.** The "Upgrade" button on
   `/settings/billing` is decorative.

3. **No proration logic** between plans.

4. **No invoice PDF generator.** `invoices.pdf_url` is a column with no
   filler.

5. **No payment-failure handling** loop / dunning emails.

6. **No usage-based overage billing** even though the schema supports
   tracking it (`usage_records`).

7. **No coupon / promo code** table.

8. **No tax computation** (GST on Indian invoices) — schema only stores
   `amount_inr`.

9. **Free plan is "free forever" in the schema** — no trial-end transitions
   wired.

10. **`current_period_end` on `subscriptions` is not auto-rolled** by a cron.

---

## Missing Document Processing Features

1. **No processing pipeline at all.** See Backend #1. This is the single
   biggest missing feature.

2. **No OCR fallback.** Schema has the stage; no implementation switches
   between native PDF text and OCR.

3. **No multi-page handling** beyond a `total_pages` column — no per-page
   confidence, no page-by-page retry.

4. **No field-level confidence storage.** `extraction_fields.confidence`
   exists; the worker would populate it, but no UI surfaces low-confidence
   fields for review.

5. **No "AI corrections" implementation.** The button on `/output` exists;
   it's a no-op.

6. **No bulk re-process / retry** for failed jobs.

7. **No template auto-detection.** Schema supports
   `documents.template_id`; upload sets it to null and no service classifies.

8. **No human-review queue** for low-confidence extractions.

9. **No duplicate detection at upload** (see Bugs #7).

10. **No virus scanning** on uploaded files.

11. **No file-type validation** beyond the `accept=` HTML attribute.

12. **No bank-statement-specific parser** despite the category existing.

13. **No GSTR-2B reconciliation logic** despite the template existing.

14. **No export-job orchestration.** The schema has an `exports` table;
    nothing actually generates a CSV or XLSX.

---

## Missing Notification Features

1. **No transport.** Schema models notifications but no email / SMS / push
   gateway is wired.

2. **No `notifications` ➝ `user_notifications` fan-out worker.** When an admin
   "sends a notification", nothing per-user is created.

3. **No "mark as read"** in the UI even though the column exists.

4. **No in-app notification bell content.** The header bell icon shows a red
   dot but never populates.
   - Where: `src/components/admin/admin-shell.tsx:250`,
     `src/components/app-shell.tsx:142`.

5. **No notification preferences** per user (email vs in-app, frequency).

6. **No scheduled-send execution.** `notifications.scheduled_for` column has
   no cron worker.

7. **No template engine** for notification bodies.

8. **No bounce / spam handling.**

9. **No SMS provider integration** despite `channel = 'sms'` being in the
   enum.

---

## Performance / Scalability Concerns

1. **`useDashboardKpis` issues 7 sequential count queries.** Fold into one
   `rpc`. (Bugs #3.)

2. **Admin lists fetch with no pagination.** `useUsers({ limit: 100 })`,
   `useOrganizations({ limit: 50 })`, etc. — the UI shows all rows in memory.
   - Next: switch to cursor pagination with `range()` and a "Load more"
     button or a virtualised list.

3. **`useExtractions` query joins three levels deep** (`document` →
   `category`). Will get expensive on big workspaces.

4. **No HTTP caching headers** on assets or API responses.

5. **No materialized views** for repeated aggregations (top customers,
   queue throughput, MRR).

6. **Postgres functions used in RLS (`auth_user_org_ids()`) are stable but
   not `select security definer set search_path`** — they are, but a
   `set search_path = public, auth` is recommended for hardening.

7. **No connection pooling guidance** for the service-role client when a
   long-lived Worker reuses it across requests.

8. **`exports`, `audit_logs`, `processing_jobs`, `extractions`** all lack
   partitioning. See Database #9.

9. **`recharts` is loaded synchronously on admin pages** (~824KB chunk in the
   build output). Lazy-load it for admin-only routes.

10. **`mini-chart.tsx` and `ui/sidebar.tsx` use `Math.random()` at render**
    — causes hydration mismatch warnings and re-renders.

---

## Suggested Improvements

These are concrete additions that would meaningfully strengthen the platform:

- **Route guards utility** in `src/lib/auth-guards.ts` exposing
  `requireAuth`, `requireSuperAdmin` for use in `beforeLoad`.
- **`rpc()` for dashboard KPIs**, replacing 7 queries with one.
- **Edge Function workspace** under `supabase/functions/`:
  - `extract` — the processing worker.
  - `extract-api` — bearer-auth gateway for `POST /v1/extract`.
  - `webhook-dispatch` — outbound webhook delivery.
  - `cron-rollup` — daily `usage_records` + `metric_snapshots` writer.
- **Realtime subscriptions** on `processing_jobs` and `extractions` for live
  UI updates.
- **Audit-log triggers** on the four to five tables that matter (orgs,
  members, api_keys, plans, feature_flags).
- **Stripe (or Razorpay) integration** with a webhook handler that owns
  `subscriptions`, `transactions`, and `invoices`.
- **Sentry + PostHog** at the Cloudflare worker boundary and in the React
  root.
- **Resend integration** for app-level transactional email.
- **Storage-quota trigger** on `documents` to keep
  `organizations.storage_used_bytes` accurate.
- **CSP + security headers** in `src/server.ts` (`Content-Security-Policy`,
  `X-Frame-Options`, `Strict-Transport-Security`, etc.).
- **`supabase gen types typescript --linked`** wired into a `package.json`
  script to keep `src/lib/supabase/types.ts` in sync.
- **CI pipeline** — `tsc --noEmit`, `eslint`, `vite build` on each PR.
- **Playwright smoke test** — signup → upload → see job → log out.
- **Pagination + virtualisation** on every admin list (`useUsers`,
  `useOrganizations`, `useAllProcessingJobs`).
- **Lazy-load `recharts` and admin-only chunks**.
- **Bucket lifecycle policy** on the `documents` bucket (e.g. auto-archive
  after N days for Free plan).
- **Per-org settings page**: webhook endpoints, regional preferences, audit
  retention, etc.

---

## Priority Roadmap

### P0 — Critical (blocks any production launch)

- [ ] **Route guards** — `beforeLoad` on `/dashboard`, `/admin/**`,
      `/settings/**`, `/api-keys` redirecting to `/login`; `is_super_admin`
      check on `/admin`. _Bugs #1._
- [ ] **Extraction worker** — Edge Function that consumes `processing_jobs`,
      otherwise the product literally doesn't work. _Backend #1._
- [ ] **Payment provider integration** — Stripe/Razorpay → `subscriptions`
      lifecycle. Without it, billing is theatre. _Billing #1._
- [ ] **Service-role client + Cloudflare env binding** — `server.ts` reads
      `process.env`, will throw on Workers. _Security #12._
- [ ] **Storage-orphan fix** — wrap upload in try/catch that removes the
      object if the DB insert fails. _Bugs #9._
- [ ] **First-run org creation** for users with zero memberships, otherwise
      `/dashboard` empties out for every brand-new user. _User #3._

### P1 — Important (before any user trust)

- [ ] **Webhook dispatcher** + signature + delivery log. _Backend #2._
- [ ] **API gateway for `POST /v1/extract`** — currently the docs lie.
      _Backend #3._
- [ ] **Rate limiting** based on `plans.api_rate_limit`. _Backend #4._
- [ ] **Email delivery** (Resend/Postmark) for invites, payments, alerts.
      _Backend #6._
- [ ] **Dashboard KPI RPC** — collapse 7 queries into 1. _Performance #1._
- [ ] **Realtime job updates** on `/processing`. _User #9._
- [ ] **`usage_records` cron** + `metric_snapshots` cron. _Backend #7-8._
- [ ] **Storage-quota trigger** + plan enforcement. _Backend #5._
- [ ] **CSV / Excel export implementation** + storage upload + signed link.
      _User #8._
- [ ] **Audit-log triggers** on auth and admin actions. _Security #7._
- [ ] **Replace all remaining inline mock blocks** in `/admin/users` detail
      panel. _Pending #2, #10._
- [ ] **Hydration fix**: `useId()` in `mini-chart.tsx` and `ui/sidebar.tsx`.
      _Bugs #11-12._

### P2 — Nice to have

- [ ] **2FA enrolment UI** + per-user device session management.
      _Security #6, #10._
- [ ] **Org switcher** in the sidebar. _User #2._
- [ ] **Template review workflow** in `/admin/templates`. _Admin #6._
- [ ] **Feature-flag targeting** (per-org overrides). _Admin #7, Database #10._
- [ ] **Notification preferences** and bell-icon inbox. _Notification #4-5._
- [ ] **Recharts lazy-loading** for admin routes. _Performance #9._
- [ ] **Pagination / virtualisation** on every list. _Performance #2._
- [ ] **Audit log browser** at `/admin/audit`. _Admin #3._
- [ ] **Bulk-action implementations** on `/admin/users`. _Pending #3._
- [ ] **Account-deletion flow** (DPDP / GDPR). _User #1, Admin #10._
- [ ] **Document preview** in `/configure`. _Pending #8._
- [ ] **Auto template classification** at upload time. _Processing #7._
- [ ] **Human-review queue** for low-confidence extractions.
      _Processing #8._
- [ ] **Sentry + PostHog** for monitoring. _Analytics #1._
- [ ] **CSP / security headers**. _Security #2._
- [ ] **CI pipeline** running `tsc`, `eslint`, `build` on every PR.

---

_Cross-references in this file use the section numbers in parentheses. When
implementing, prefer one PR per checkbox so the codebase audit stays easy to
re-run._

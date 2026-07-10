# BillSOS — Supabase Backend

This directory is the **source of truth** for the database schema, storage
buckets, RLS policies, and reference / seed data that the BillSOS frontend
runs on. No code in `src/` ever fabricates data — every list you see in the UI
is read from one of the tables defined here.

## 1. Prerequisites

```bash
# Supabase CLI — pick one
npm i -g supabase
# or
brew install supabase/tap/supabase
```

You'll also need a Supabase project (free tier is fine):
<https://supabase.com/dashboard/projects>.

Grab these three values from **Project Settings → API**:

| Value                       | Used by                                |
| --------------------------- | -------------------------------------- |
| Project URL                 | `VITE_SUPABASE_URL`                    |
| `anon` public key           | `VITE_SUPABASE_ANON_KEY`               |
| `service_role` (secret) key | `SUPABASE_SERVICE_ROLE_KEY` (server)   |

## 2. Configure environment variables

```bash
cp .env.example .env.local
# then fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
```

The Vite-prefixed vars are exposed to the browser by design. The service-role
key MUST NEVER be exposed; it is only used by server-side code in
`src/lib/supabase/server.ts`.

## 3. Apply migrations

```bash
# Link the local CLI to your hosted project (one-time):
supabase login
supabase link --project-ref <YOUR-PROJECT-REF>

# Push every migration in supabase/migrations/ (idempotent):
supabase db push
```

The migrations are split into focused files for reviewability:

| File                                         | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `…000000_extensions_and_enums.sql`           | Extensions, all enum types, `set_updated_at()`    |
| `…000100_organizations_and_profiles.sql`     | Orgs, profiles, memberships, sessions, RLS helpers |
| `…000200_plans_and_billing.sql`              | Plans, subscriptions, payment methods, invoices   |
| `…000300_categories_templates.sql`           | Document categories, templates, template fields   |
| `…000400_documents_processing.sql`           | Documents, jobs, workers, extractions, exports    |
| `…000500_api_integrations.sql`               | API keys, webhooks, vendor APIs, integrations     |
| `…000600_admin_ops.sql`                      | Feature flags, notifications, audit, security, tickets, usage |
| `…000700_rls_policies.sql`                   | RLS enabled + scoped policies on every table      |
| `…000800_seed_reference_data.sql`            | Plans, categories, vendor APIs, integrations, flags, workers (idempotent) |
| `…000900_storage.sql`                        | `documents` + `exports` storage buckets and their RLS |

## 4. (Optional) Local dev with the Supabase stack

```bash
supabase start             # docker-based local postgres + auth + storage
supabase db reset          # apply all migrations AND run supabase/seed.sql
supabase status            # prints local URLs and keys to put into .env.local
```

`supabase/seed.sql` is **dev-only**. It populates three demo orgs (Acme,
Northwind, Helios), demo subscriptions and invoices for Acme, and six
templates with full Invoice fields. It is NOT applied by `supabase db push`
against a hosted project — only by `supabase db reset` locally.

## 5. Make a user a super admin

Reference data is publicly readable; admin pages require `is_super_admin = true`
on the user's profile. After signing up:

```sql
update profiles
   set is_super_admin = true
 where email = 'you@example.com';
```

Sign out and back in; `/admin` should now render.

## 6. Schema overview

```
auth.users
   └─ profiles (1-1, auto-created via trigger)
         └─ organization_members ──► organizations ──► plans
                                          └─ subscriptions, invoices, transactions, payment_methods
                                          └─ documents ──► extractions ──► extraction_fields
                                          └─ processing_jobs ──► workers
                                          └─ exports
                                          └─ api_keys, webhooks, integration_connections
                                          └─ usage_records, audit_logs, tickets
document_categories ──► templates ──► template_fields
vendor_apis, integrations, feature_flags, notifications, security_events, metric_snapshots
```

## 7. Storage layout

```
documents/
  <org_id>/<uuid>-<original-filename>          # uploaded source files
exports/
  <org_id>/<uuid>-<export-name>.csv            # generated exports
```

RLS uses the leading path segment as the org id. Members of an org can read
that prefix; non-members cannot. Org admins can also delete.

## 8. Regenerating TypeScript types

Once the project is linked you can replace the hand-written
`src/lib/supabase/types.ts` with generated ones:

```bash
supabase gen types typescript --linked > src/lib/supabase/types.ts
```

## 9. Deploying to Cloudflare (Wrangler)

The frontend ships through `@cloudflare/vite-plugin`. Set Supabase env vars as
Cloudflare secrets:

```bash
wrangler secret put VITE_SUPABASE_URL
wrangler secret put VITE_SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

(Or define them as Vite env vars at build time and Cloudflare will inline them
into the static bundle.)

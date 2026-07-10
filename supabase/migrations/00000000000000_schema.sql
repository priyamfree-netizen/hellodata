-- ============================================================================
-- BillSOS · Universal Schema Migration
-- Single file — run once on a fresh Supabase project.
-- Consolidated from 18 individual migrations on 2026-07-03.
-- Contains all tables, indexes, RLS, functions, triggers, and seed data.
-- ============================================================================

-- ============================================================================
-- SOURCE: 00000000000000_schema.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Universal Schema Migration
-- Single file — run once on a fresh Supabase project.
-- Contains all tables, indexes, RLS, functions, triggers, and seed data.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto"  with schema public;
create extension if not exists "uuid-ossp" with schema public;
create extension if not exists "citext"    with schema public;

-- ── Enums ───────────────────────────────────────────────────────────────────
create type plan_interval        as enum ('monthly', 'yearly');
create type plan_status          as enum ('active', 'archived', 'draft');
create type subscription_status  as enum ('trialing','active','past_due','canceled','paused','expired');
create type transaction_status   as enum ('succeeded','failed','refunded','pending');
create type payment_method       as enum ('card','upi','wire','bank_transfer');
create type invoice_status       as enum ('draft','open','paid','void','uncollectible');
create type user_status          as enum ('active','inactive','suspended','trial','churned');
create type org_status           as enum ('active','suspended','trial');
create type member_role          as enum ('owner','admin','member','viewer');
create type member_status        as enum ('active','pending','inactive');
create type job_priority         as enum ('low','normal','high','critical');
create type job_stage            as enum ('pending','queued','ocr','ai_extraction','validation','export','completed','failed','retry','dead_letter');
create type extraction_status    as enum ('queued','processing','done','failed','cancelled');
create type document_status      as enum ('uploaded','queued','processing','extracted','failed');
create type export_format        as enum ('json','excel','csv','webhook');
create type template_status      as enum ('draft','review','published','rejected','archived');
create type template_scope       as enum ('org','team','public','draft');
create type category_tag         as enum ('core','tax','soon');
create type api_key_scope        as enum ('read_only','write','full_access');
create type vendor_api_status    as enum ('healthy','degraded','down');
create type vendor_api_type      as enum ('scraping','extraction','validation');
create type integration_status   as enum ('connected','disconnected','error','beta');
create type notification_channel as enum ('email','sms','push','in_app');
create type notification_status  as enum ('delivered','failed','scheduled','sending');
create type ticket_priority      as enum ('low','normal','high','urgent');
create type ticket_status        as enum ('open','in_progress','waiting','resolved','closed');
create type feature_flag_type    as enum ('release','experiment','ops','permission');
create type security_event_type  as enum ('suspicious_login','api_abuse','brute_force','data_export','permission_change','2fa_disabled');
create type security_severity    as enum ('low','medium','high','critical');
create type worker_status        as enum ('healthy','degraded','offline');
create type worker_type          as enum ('shared','dedicated');

-- ── Shared updated_at trigger function ─────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- ── Organizations ────────────────────────────────────────────────────────────
create table organizations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  slug                 citext not null unique,
  country              text,
  status               org_status not null default 'trial',
  plan_id              uuid,
  sso_enabled          boolean not null default false,
  storage_limit_bytes  bigint not null default 524288000,
  storage_used_bytes   bigint not null default 0,
  pages_processed      bigint not null default 0,
  team_size            int not null default 1,
  departments          text[] not null default '{}',
  stripe_customer_id   text,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_activity_at     timestamptz
);
create index organizations_status_idx        on organizations(status);
create index organizations_plan_id_idx       on organizations(plan_id);
create index organizations_last_activity_idx on organizations(last_activity_at desc);
create unique index organizations_stripe_customer_idx
  on organizations(stripe_customer_id) where stripe_customer_id is not null;
create trigger organizations_set_updated
  before update on organizations for each row execute function set_updated_at();

-- ── Profiles (custom auth — no FK to auth.users) ─────────────────────────────
create table profiles (
  id                   uuid primary key,
  email                citext not null unique,
  first_name           text,
  last_name            text,
  full_name            text generated always as
                         (trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored,
  phone                text,
  avatar_url           text,
  avatar_initials      text,
  country              text,
  current_org_id       uuid references organizations(id) on delete set null,
  status               user_status not null default 'active',
  is_super_admin       boolean not null default false,
  risk_score           int not null default 0 check (risk_score between 0 and 100),
  two_factor_enabled   boolean not null default false,
  credits_remaining    bigint not null default 0,
  -- custom auth columns
  password_hash        text,
  email_verified       boolean not null default false,
  email_verify_token   text,
  email_verify_expires timestamptz,
  pwd_reset_token      text,
  pwd_reset_expires    timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  last_login_at        timestamptz,
  last_activity_at     timestamptz,
  password_changed_at  timestamptz
);
create index profiles_status_idx      on profiles(status);
create index profiles_current_org_idx on profiles(current_org_id);
create index profiles_last_login_idx  on profiles(last_login_at desc);
create index profiles_risk_idx        on profiles(risk_score desc);
create index profiles_superadmin_idx  on profiles(id, is_super_admin) where is_super_admin = true;
create trigger profiles_set_updated
  before update on profiles for each row execute function set_updated_at();

-- ── OAuth accounts ────────────────────────────────────────────────────────────
create table oauth_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  provider         text not null,
  provider_user_id text not null,
  provider_email   text,
  created_at       timestamptz not null default now(),
  unique (provider, provider_user_id)
);
create index oauth_accounts_user_idx on oauth_accounts(user_id);

-- ── Refresh tokens ────────────────────────────────────────────────────────────
create table refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  token_hash   text not null unique,
  device       text,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index refresh_tokens_user_active_idx on refresh_tokens(user_id) where revoked_at is null;
create index refresh_tokens_hash_idx        on refresh_tokens(token_hash);

-- ── TOTP factors ──────────────────────────────────────────────────────────────
create table totp_factors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  secret        text not null,
  friendly_name text,
  verified      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index totp_factors_user_idx on totp_factors(user_id);

-- ── Organization members ──────────────────────────────────────────────────────
create table organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  role            member_role not null default 'member',
  status          member_status not null default 'active',
  team            text,
  invited_by      uuid references profiles(id),
  invited_at      timestamptz,
  joined_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index org_members_org_idx        on organization_members(organization_id);
create index org_members_user_idx       on organization_members(user_id);
create index org_members_user_status_idx
  on organization_members(user_id, organization_id) where status = 'active';
create index org_members_admin_lookup_idx
  on organization_members(organization_id, user_id, role)
  where status = 'active' and role in ('owner','admin');
create trigger org_members_set_updated
  before update on organization_members for each row execute function set_updated_at();

-- ── User sessions (login history / active devices) ────────────────────────────
create table user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  device       text,
  ip_address   inet,
  location     text,
  user_agent   text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
create index user_sessions_user_idx on user_sessions(user_id, last_seen_at desc);

-- ── RLS helper functions ─────────────────────────────────────────────────────
create or replace function auth_user_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

create or replace function auth_user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select organization_id from organization_members
  where user_id = auth.uid() and status = 'active';
$$;

create or replace function auth_user_is_org_admin(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  );
$$;

-- ── Plans ────────────────────────────────────────────────────────────────────
create table plans (
  id                  uuid primary key default gen_random_uuid(),
  code                citext not null unique,
  name                text not null,
  description         text,
  price_amount_inr    numeric(14,2),
  is_custom_price     boolean not null default false,
  interval            plan_interval not null default 'monthly',
  status              plan_status not null default 'active',
  version             text not null default '1.0',
  sort_order          int not null default 0,
  page_limit          bigint,
  ai_token_limit      bigint,
  ocr_limit           bigint,
  storage_limit_bytes bigint,
  api_rate_limit      int,
  webhook_limit       int,
  concurrency         int,
  team_seats          int,
  white_label         boolean not null default false,
  dedicated_workers   boolean not null default false,
  priority_queue      boolean not null default false,
  sla_support         boolean not null default false,
  audit_logs          boolean not null default false,
  stripe_price_id     text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index plans_status_idx on plans(status);
create trigger plans_set_updated
  before update on plans for each row execute function set_updated_at();

alter table organizations
  add constraint organizations_plan_id_fkey
  foreign key (plan_id) references plans(id) on delete set null;

-- ── Subscriptions ────────────────────────────────────────────────────────────
create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations(id) on delete cascade,
  plan_id               uuid references plans(id),
  status                subscription_status not null default 'active',
  current_period_start  timestamptz not null default now(),
  current_period_end    timestamptz,
  trial_ends_at         timestamptz,
  cancelled_at          timestamptz,
  external_ref          text,
  stripe_subscription_id text,
  stripe_price_id       text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint subscriptions_org_uniq unique (organization_id)
);
create index subscriptions_org_idx    on subscriptions(organization_id);
create index subscriptions_status_idx on subscriptions(status);
create unique index subscriptions_stripe_sub_idx
  on subscriptions(stripe_subscription_id) where stripe_subscription_id is not null;
create trigger subscriptions_set_updated
  before update on subscriptions for each row execute function set_updated_at();

-- ── Payment methods ───────────────────────────────────────────────────────────
create table payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type            payment_method not null,
  brand           text,
  last4           text,
  exp_month       int,
  exp_year        int,
  is_default      boolean not null default false,
  external_ref    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payment_methods_org_idx on payment_methods(organization_id);
create unique index payment_methods_default_per_org
  on payment_methods(organization_id) where is_default;
create trigger payment_methods_set_updated
  before update on payment_methods for each row execute function set_updated_at();

-- ── Transactions ──────────────────────────────────────────────────────────────
create table transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  plan_id         uuid references plans(id),
  amount_inr      numeric(14,2) not null,
  currency        text not null default 'INR',
  status          transaction_status not null default 'pending',
  method          payment_method,
  external_ref    text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index transactions_org_idx    on transactions(organization_id, created_at desc);
create index transactions_status_idx on transactions(status);
create trigger transactions_set_updated
  before update on transactions for each row execute function set_updated_at();

-- ── Invoices ──────────────────────────────────────────────────────────────────
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  transaction_id  uuid references transactions(id) on delete set null,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount_inr      numeric(14,2) not null,
  status          invoice_status not null default 'open',
  issue_date      date not null default current_date,
  due_date        date,
  paid_at         timestamptz,
  pdf_url         text,
  stripe_invoice_id text,
  line_items      jsonb not null default '[]'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint invoices_stripe_invoice_uniq unique (stripe_invoice_id)
);
create index invoices_org_idx    on invoices(organization_id, issue_date desc);
create index invoices_status_idx on invoices(status);
create trigger invoices_set_updated
  before update on invoices for each row execute function set_updated_at();

-- ── Document categories ───────────────────────────────────────────────────────
create table document_categories (
  id             uuid primary key default gen_random_uuid(),
  code           citext not null unique,
  name           text not null,
  description    text,
  tag            category_tag not null default 'core',
  icon           text,
  default_fields int not null default 0,
  industry       text,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index document_categories_tag_idx on document_categories(tag);
create trigger document_categories_set_updated
  before update on document_categories for each row execute function set_updated_at();

-- ── Templates ─────────────────────────────────────────────────────────────────
create table templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  category_id     uuid references document_categories(id) on delete set null,
  organization_id uuid references organizations(id) on delete cascade,
  author_id       uuid references profiles(id) on delete set null,
  status          template_status not null default 'draft',
  scope           template_scope not null default 'org',
  version         text not null default '1.0',
  is_featured     boolean not null default false,
  rating          numeric(3,2) not null default 0 check (rating between 0 and 5),
  downloads       bigint not null default 0,
  field_count     int not null default 0,
  config          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index templates_org_idx      on templates(organization_id);
create index templates_category_idx on templates(category_id);
create index templates_status_idx   on templates(status);
create index templates_scope_idx    on templates(scope);
create trigger templates_set_updated
  before update on templates for each row execute function set_updated_at();

-- ── Template fields ───────────────────────────────────────────────────────────
create table template_fields (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid not null references templates(id) on delete cascade,
  key                citext not null,
  label              text not null,
  field_group        text not null default 'General',
  data_type          text not null default 'string',
  is_required        boolean not null default false,
  is_enabled         boolean not null default true,
  default_confidence numeric(4,3) not null default 0.9 check (default_confidence between 0 and 1),
  sort_order         int not null default 0,
  config             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (template_id, key)
);
create index template_fields_template_idx on template_fields(template_id, sort_order);
create trigger template_fields_set_updated
  before update on template_fields for each row execute function set_updated_at();

create or replace function recalc_template_field_count()
returns trigger language plpgsql as $$
declare tid uuid := coalesce(new.template_id, old.template_id);
begin
  update templates set field_count = (select count(*) from template_fields where template_id = tid) where id = tid;
  return null;
end; $$;
create trigger template_fields_count_sync
  after insert or delete or update of template_id on template_fields
  for each row execute function recalc_template_field_count();

-- ── Workers ───────────────────────────────────────────────────────────────────
create table workers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  type           worker_type not null default 'shared',
  status         worker_status not null default 'healthy',
  region         text not null default 'ap-south-1',
  cpu_pct        int not null default 0,
  memory_pct     int not null default 0,
  jobs_processed bigint not null default 0,
  current_job_id uuid,
  uptime_seconds bigint not null default 0,
  started_at     timestamptz,
  last_heartbeat timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index workers_status_idx on workers(status);
create trigger workers_set_updated
  before update on workers for each row execute function set_updated_at();

-- ── Documents ─────────────────────────────────────────────────────────────────
create table documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  uploaded_by     uuid references profiles(id) on delete set null,
  category_id     uuid references document_categories(id) on delete set null,
  template_id     uuid references templates(id) on delete set null,
  file_name       text not null,
  storage_path    text,
  mime_type       text,
  file_size_bytes bigint not null default 0,
  page_count      int not null default 0,
  status          document_status not null default 'uploaded',
  sha256          text,
  source          text not null default 'upload',
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index documents_org_idx    on documents(organization_id, created_at desc);
create index documents_status_idx on documents(status);
create index documents_category_idx on documents(category_id);
create unique index documents_org_sha on documents(organization_id, sha256) where sha256 is not null;
create trigger documents_set_updated
  before update on documents for each row execute function set_updated_at();

-- ── Processing jobs ───────────────────────────────────────────────────────────
create table processing_jobs (
  id              uuid primary key default gen_random_uuid(),
  job_number      bigserial unique,
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id     uuid references documents(id) on delete cascade,
  template_id     uuid references templates(id) on delete set null,
  created_by      uuid references profiles(id) on delete set null,
  name            text not null,
  stage           job_stage not null default 'pending',
  priority        job_priority not null default 'normal',
  worker_id       uuid references workers(id) on delete set null,
  total_pages     int not null default 0,
  total_docs      int not null default 1,
  completed_docs  int not null default 0,
  failed_docs     int not null default 0,
  attempts        int not null default 0,
  confidence      numeric(5,2),
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  duration_ms     bigint,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index processing_jobs_org_idx    on processing_jobs(organization_id, created_at desc);
create index processing_jobs_stage_idx  on processing_jobs(stage);
create index processing_jobs_worker_idx on processing_jobs(worker_id);
create index processing_jobs_doc_idx    on processing_jobs(document_id);
create trigger processing_jobs_set_updated
  before update on processing_jobs for each row execute function set_updated_at();

alter table workers
  add constraint workers_current_job_fkey
  foreign key (current_job_id) references processing_jobs(id) on delete set null;

-- ── Extractions ───────────────────────────────────────────────────────────────
create table extractions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  document_id     uuid not null references documents(id) on delete cascade,
  job_id          uuid references processing_jobs(id) on delete set null,
  template_id     uuid references templates(id) on delete set null,
  status          extraction_status not null default 'queued',
  confidence      numeric(5,2),
  field_count     int not null default 0,
  page_count      int not null default 0,
  tokens_used     bigint not null default 0,
  data            jsonb not null default '{}'::jsonb,
  raw_text        text,
  error_message   text,
  duration_ms     bigint,
  reviewed_by     uuid references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index extractions_org_idx    on extractions(organization_id, created_at desc);
create index extractions_doc_idx    on extractions(document_id);
create index extractions_job_idx    on extractions(job_id);
create index extractions_status_idx on extractions(status);
create trigger extractions_set_updated
  before update on extractions for each row execute function set_updated_at();

-- ── Extraction fields ─────────────────────────────────────────────────────────
create table extraction_fields (
  id            uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references extractions(id) on delete cascade,
  field_key     citext not null,
  field_label   text,
  value_text    text,
  value_numeric numeric(18,4),
  value_date    date,
  confidence    numeric(4,3),
  page_number   int,
  bbox          jsonb,
  is_corrected  boolean not null default false
);
create index extraction_fields_ext_idx on extraction_fields(extraction_id);

-- ── Exports ───────────────────────────────────────────────────────────────────
create table exports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  job_id          uuid references processing_jobs(id) on delete set null,
  file_name       text not null,
  storage_path    text,
  format          export_format not null default 'csv',
  size_bytes      bigint not null default 0,
  row_count       int not null default 0,
  download_count  int not null default 0,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index exports_org_idx on exports(organization_id, created_at desc);

-- ── API keys ──────────────────────────────────────────────────────────────────
create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  name            text not null,
  prefix          text not null,
  key_hash        text not null,
  scope           api_key_scope not null default 'read_only',
  last_used_at    timestamptz,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index api_keys_org_idx on api_keys(organization_id);
create unique index api_keys_hash on api_keys(key_hash) where revoked_at is null;
create trigger api_keys_set_updated
  before update on api_keys for each row execute function set_updated_at();

-- ── API rate counters ─────────────────────────────────────────────────────────
create table api_rate_counters (
  api_key_id    uuid not null references api_keys(id) on delete cascade,
  window_start  timestamptz not null,
  request_count integer not null default 1,
  primary key (api_key_id, window_start)
);
create index rate_counters_key_window_idx on api_rate_counters(api_key_id, window_start desc);

-- ── API idempotency keys ───────────────────────────────────────────────────────
create table api_idempotency_keys (
  key_hash        text primary key,
  api_key_id      uuid not null references api_keys(id) on delete cascade,
  response_status int not null,
  response_body   jsonb not null,
  expires_at      timestamptz not null default now() + interval '24 hours',
  created_at      timestamptz not null default now()
);
create index idempotency_keys_expires_idx on api_idempotency_keys(expires_at);

-- ── Webhooks ──────────────────────────────────────────────────────────────────
create table webhooks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  created_by       uuid references profiles(id) on delete set null,
  name             text not null,
  endpoint_url     text not null,
  events           text[] not null default '{}',
  secret_key       text not null,
  is_active        boolean not null default true,
  last_delivery_at timestamptz,
  last_status_code int,
  failure_count    int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index webhooks_org_idx on webhooks(organization_id);
create trigger webhooks_set_updated
  before update on webhooks for each row execute function set_updated_at();

-- ── Webhook deliveries ────────────────────────────────────────────────────────
create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  webhook_id      uuid not null references webhooks(id) on delete cascade,
  event           text not null,
  status          text not null default 'pending',
  response_status int,
  payload         jsonb,
  response_body   text,
  attempts        int not null default 1,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index webhook_deliveries_webhook_idx on webhook_deliveries(webhook_id, created_at desc);
create index webhook_deliveries_retry_idx on webhook_deliveries(next_attempt_at) where status = 'pending';

-- ── Vendor APIs ───────────────────────────────────────────────────────────────
create table vendor_apis (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  type             vendor_api_type not null,
  endpoint         text not null,
  status           vendor_api_status not null default 'healthy',
  latency_ms       int not null default 0,
  success_rate     numeric(5,2) not null default 100.0,
  cost_per_doc_inr numeric(10,4) not null default 0,
  docs_today       bigint not null default 0,
  cost_today_inr   numeric(14,2) not null default 0,
  uptime_pct       numeric(5,2) not null default 100.0,
  last_incident_at timestamptz,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger vendor_apis_set_updated
  before update on vendor_apis for each row execute function set_updated_at();

-- ── Integrations ──────────────────────────────────────────────────────────────
create table integrations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  category       text not null,
  status         integration_status not null default 'disconnected',
  icon           text,
  description    text,
  syncs_today    bigint not null default 0,
  failed_syncs   int not null default 0,
  connected_orgs int not null default 0,
  last_sync_at   timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger integrations_set_updated
  before update on integrations for each row execute function set_updated_at();

create table integration_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  integration_id  uuid not null references integrations(id) on delete cascade,
  is_active       boolean not null default true,
  config          jsonb not null default '{}'::jsonb,
  credentials     jsonb,
  last_sync_at    timestamptz,
  failed_count    int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, integration_id)
);
create index integration_connections_org_idx on integration_connections(organization_id);
create trigger integration_connections_set_updated
  before update on integration_connections for each row execute function set_updated_at();

-- ── Feature flags ─────────────────────────────────────────────────────────────
create table feature_flags (
  id                 uuid primary key default gen_random_uuid(),
  name               citext not null unique,
  description        text,
  type               feature_flag_type not null default 'release',
  is_enabled         boolean not null default false,
  enabled_dev        boolean not null default true,
  enabled_staging    boolean not null default false,
  enabled_production boolean not null default false,
  rollout_pct        int not null default 0 check (rollout_pct between 0 and 100),
  owner_id           uuid references profiles(id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger feature_flags_set_updated
  before update on feature_flags for each row execute function set_updated_at();

create table feature_flag_overrides (
  id              uuid primary key default gen_random_uuid(),
  flag_id         uuid not null references feature_flags(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (flag_id, organization_id)
);
create index ff_overrides_flag_id_idx on feature_flag_overrides(flag_id);
create index ff_overrides_org_id_idx  on feature_flag_overrides(organization_id);

-- ── Notifications ─────────────────────────────────────────────────────────────
create table notifications (
  id             uuid primary key default gen_random_uuid(),
  channel        notification_channel not null,
  subject        text not null,
  body           text,
  audience       text not null,
  status         notification_status not null default 'scheduled',
  recipients     int not null default 0,
  open_rate_pct  numeric(5,2),
  click_rate_pct numeric(5,2),
  sent_at        timestamptz,
  scheduled_for  timestamptz,
  created_by     uuid references profiles(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index notifications_status_idx   on notifications(status);
create index notifications_sent_idx     on notifications(sent_at desc);
create index notifications_in_app_created_idx on notifications(created_at desc) where channel = 'in_app';
create trigger notifications_set_updated
  before update on notifications for each row execute function set_updated_at();

create table user_notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  notification_id uuid references notifications(id) on delete cascade,
  title           text not null,
  body            text,
  link            text,
  is_read         boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index user_notifications_user_idx   on user_notifications(user_id, created_at desc);
create index user_notifications_unread_idx on user_notifications(user_id) where not is_read;

-- ── Audit logs ────────────────────────────────────────────────────────────────
create table audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  actor_id        uuid references profiles(id) on delete set null,
  actor_label     text,
  action          text not null,
  target_type     text,
  target_id       text,
  target_label    text,
  ip_address      inet,
  details         text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_logs_org_idx    on audit_logs(organization_id, created_at desc);
create index audit_logs_actor_idx  on audit_logs(actor_id, created_at desc);
create index audit_logs_action_idx on audit_logs(action);

-- ── Security events ───────────────────────────────────────────────────────────
create table security_events (
  id              uuid primary key default gen_random_uuid(),
  type            security_event_type not null,
  severity        security_severity not null default 'low',
  user_id         uuid references profiles(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  ip_address      inet,
  location        text,
  user_agent      text,
  details         text,
  is_resolved     boolean not null default false,
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index security_events_severity_idx    on security_events(severity);
create index security_events_user_idx        on security_events(user_id, created_at desc);
create index security_events_unresolved_idx  on security_events(created_at desc) where not is_resolved;

-- ── Tickets ───────────────────────────────────────────────────────────────────
create table tickets (
  id              uuid primary key default gen_random_uuid(),
  number          bigserial unique,
  organization_id uuid references organizations(id) on delete set null,
  requester_id    uuid references profiles(id) on delete set null,
  assignee_id     uuid references profiles(id) on delete set null,
  subject         text not null,
  body            text,
  priority        ticket_priority not null default 'normal',
  status          ticket_status not null default 'open',
  category        text,
  sla_deadline    timestamptz,
  last_reply_at   timestamptz,
  resolved_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index tickets_org_idx      on tickets(organization_id, created_at desc);
create index tickets_status_idx   on tickets(status);
create index tickets_assignee_idx on tickets(assignee_id);
create trigger tickets_set_updated
  before update on tickets for each row execute function set_updated_at();

create table ticket_replies (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  is_internal boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index ticket_replies_ticket_idx on ticket_replies(ticket_id, created_at);

-- ── Usage records ─────────────────────────────────────────────────────────────
create table usage_records (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  date                date not null default current_date,
  pages_processed     bigint not null default 0,
  ai_tokens_used      bigint not null default 0,
  ocr_pages           bigint not null default 0,
  api_calls           bigint not null default 0,
  storage_bytes       bigint not null default 0,
  documents_uploaded  bigint not null default 0,
  unique (organization_id, date)
);
create index usage_records_org_idx on usage_records(organization_id, date desc);

-- ── Metric snapshots ──────────────────────────────────────────────────────────
create table metric_snapshots (
  id       uuid primary key default gen_random_uuid(),
  metric   text not null,
  value    numeric not null,
  taken_at timestamptz not null default now(),
  dims     jsonb not null default '{}'::jsonb
);
create index metric_snapshots_metric_idx on metric_snapshots(metric, taken_at desc);

create or replace function public.trunc_to_utc_day(ts timestamptz)
returns timestamp language sql immutable parallel safe as $$
  select date_trunc('day', ts at time zone 'UTC')
$$;
create unique index metric_snapshots_metric_day_uniq
  on metric_snapshots (metric, trunc_to_utc_day(taken_at));

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

alter table organizations          enable row level security;
alter table profiles               enable row level security;
alter table oauth_accounts         enable row level security;
alter table refresh_tokens         enable row level security;
alter table totp_factors           enable row level security;
alter table organization_members   enable row level security;
alter table user_sessions          enable row level security;
alter table plans                  enable row level security;
alter table subscriptions          enable row level security;
alter table payment_methods        enable row level security;
alter table transactions           enable row level security;
alter table invoices               enable row level security;
alter table document_categories    enable row level security;
alter table templates              enable row level security;
alter table template_fields        enable row level security;
alter table workers                enable row level security;
alter table documents              enable row level security;
alter table processing_jobs        enable row level security;
alter table extractions            enable row level security;
alter table extraction_fields      enable row level security;
alter table exports                enable row level security;
alter table api_keys               enable row level security;
alter table api_rate_counters      enable row level security;
alter table api_idempotency_keys   enable row level security;
alter table webhooks               enable row level security;
alter table webhook_deliveries     enable row level security;
alter table vendor_apis            enable row level security;
alter table integrations           enable row level security;
alter table integration_connections enable row level security;
alter table feature_flags          enable row level security;
alter table feature_flag_overrides enable row level security;
alter table notifications          enable row level security;
alter table user_notifications     enable row level security;
alter table audit_logs             enable row level security;
alter table security_events        enable row level security;
alter table tickets                enable row level security;
alter table ticket_replies         enable row level security;
alter table usage_records          enable row level security;
alter table metric_snapshots       enable row level security;

-- ── Profiles ─────────────────────────────────────────────────────────────────
create policy profiles_read on profiles for select using (
  auth_user_is_super_admin()
  or id = auth.uid()
  or id in (
    select m2.user_id from organization_members m1
    join organization_members m2 using (organization_id)
    where m1.user_id = auth.uid() and m1.status = 'active' and m2.status = 'active'
  )
);
create policy profiles_self_update on profiles for update
  using  (id = auth.uid() or auth_user_is_super_admin())
  with check (id = auth.uid() or auth_user_is_super_admin());

-- ── Custom auth tables ────────────────────────────────────────────────────────
create policy oauth_accounts_self on oauth_accounts for all
  using (user_id = auth.uid() or auth_user_is_super_admin());
create policy refresh_tokens_deny on refresh_tokens for all using (false);
create policy totp_factors_self on totp_factors for all
  using (user_id = auth.uid() or auth_user_is_super_admin());

-- ── Organizations ─────────────────────────────────────────────────────────────
create policy organizations_member_read on organizations for select using (
  auth_user_is_super_admin() or id in (select auth_user_org_ids())
);
create policy organizations_admin_write on organizations for update
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(id));
create policy organizations_admin_insert on organizations for insert with check (auth.uid() is not null);
create policy organizations_super_delete on organizations for delete using (auth_user_is_super_admin());

-- ── Org members ───────────────────────────────────────────────────────────────
create policy org_members_read on organization_members for select using (
  auth_user_is_super_admin()
  or user_id = auth.uid()
  or organization_id in (select auth_user_org_ids())
);
create policy org_members_write on organization_members for all
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

create policy org_members_update on organization_members for update
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));
create policy org_members_delete on organization_members for delete
  using (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

-- ── Sessions ──────────────────────────────────────────────────────────────────
create policy user_sessions_self on user_sessions for all
  using  (user_id = auth.uid() or auth_user_is_super_admin())
  with check (user_id = auth.uid() or auth_user_is_super_admin());

-- ── Plans (public read) ───────────────────────────────────────────────────────
create policy plans_read on plans for select using (true);
create policy plans_admin_write on plans for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

-- ── Billing tables ────────────────────────────────────────────────────────────
create policy subscriptions_org_read on subscriptions for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy subscriptions_admin_write on subscriptions for all
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

create policy payment_methods_org_read on payment_methods for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy payment_methods_admin_write on payment_methods for all
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

create policy transactions_org_read on transactions for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy transactions_admin_write on transactions for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy invoices_org_read on invoices for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy invoices_admin_write on invoices for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

-- ── Reference data ────────────────────────────────────────────────────────────
create policy document_categories_read on document_categories for select using (true);
create policy document_categories_admin_write on document_categories for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy vendor_apis_read on vendor_apis for select using (auth.uid() is not null);
create policy vendor_apis_admin_write on vendor_apis for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy integrations_read on integrations for select using (true);
create policy integrations_admin_write on integrations for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

-- ── Templates ─────────────────────────────────────────────────────────────────
create policy templates_read on templates for select using (
  scope = 'public' or auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy templates_write_org_admin on templates for all
  using  (auth_user_is_super_admin() or (organization_id is not null and auth_user_is_org_admin(organization_id)) or author_id = auth.uid())
  with check (auth_user_is_super_admin() or (organization_id is not null and auth_user_is_org_admin(organization_id)) or author_id = auth.uid());

create policy template_fields_read on template_fields for select using (
  auth_user_is_super_admin()
  or exists (select 1 from templates t where t.id = template_fields.template_id
    and (t.scope = 'public' or t.organization_id in (select auth_user_org_ids())))
);
create policy template_fields_write on template_fields for all
  using (auth_user_is_super_admin() or exists (select 1 from templates t where t.id = template_fields.template_id
    and (t.author_id = auth.uid() or (t.organization_id is not null and auth_user_is_org_admin(t.organization_id)))))
  with check (auth_user_is_super_admin() or exists (select 1 from templates t where t.id = template_fields.template_id
    and (t.author_id = auth.uid() or (t.organization_id is not null and auth_user_is_org_admin(t.organization_id)))));

-- ── Documents / extractions / jobs / exports ───────────────────────────────────
create policy documents_org_all on documents for all
  using  (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()))
  with check (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()));

create policy processing_jobs_org_all on processing_jobs for all
  using  (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()))
  with check (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()));

create policy extractions_org_all on extractions for all
  using  (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()))
  with check (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()));

create policy extraction_fields_read on extraction_fields for select using (
  auth_user_is_super_admin()
  or exists (select 1 from extractions e where e.id = extraction_fields.extraction_id
    and e.organization_id in (select auth_user_org_ids()))
);
create policy extraction_fields_write on extraction_fields for all
  using  (auth_user_is_super_admin() or exists (select 1 from extractions e where e.id = extraction_fields.extraction_id and e.organization_id in (select auth_user_org_ids())))
  with check (auth_user_is_super_admin() or exists (select 1 from extractions e where e.id = extraction_fields.extraction_id and e.organization_id in (select auth_user_org_ids())));

create policy exports_org_all on exports for all
  using  (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()))
  with check (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()));

-- ── Workers (super-admin only) ────────────────────────────────────────────────
create policy workers_admin on workers for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

-- ── API keys / rate limits ────────────────────────────────────────────────────
create policy api_keys_org_all on api_keys for all
  using  (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()))
  with check (auth_user_is_super_admin() or organization_id in (select auth_user_org_ids()));

-- api_rate_counters and api_idempotency_keys: service role only (no user policies)

-- ── Webhooks ──────────────────────────────────────────────────────────────────
create policy webhooks_org_read on webhooks for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy webhooks_org_all on webhooks for all
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

create policy webhook_deliveries_read on webhook_deliveries for select using (
  auth_user_is_super_admin()
  or exists (select 1 from webhooks w where w.id = webhook_deliveries.webhook_id
    and w.organization_id in (select auth_user_org_ids()))
);

create policy integration_connections_read on integration_connections for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy integration_connections_org_all on integration_connections for all
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

-- ── Admin / ops tables ────────────────────────────────────────────────────────
create policy feature_flags_superadmin_read on feature_flags for select using (auth_user_is_super_admin());
create policy feature_flags_admin on feature_flags for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy "super_admin_all_ff_overrides" on feature_flag_overrides for all
  to authenticated using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy notifications_admin on notifications for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());
create policy notifications_in_app_read on notifications for select using (
  channel = 'in_app' or auth_user_is_super_admin()
);

create policy user_notifications_self on user_notifications for all
  using  (user_id = auth.uid() or auth_user_is_super_admin())
  with check (user_id = auth.uid() or auth_user_is_super_admin());

create policy audit_logs_org_read on audit_logs for select using (
  auth_user_is_super_admin()
  or (organization_id is not null and organization_id in (select auth_user_org_ids()))
);

create policy security_events_admin on security_events for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());
create policy security_events_self_read on security_events for select using (
  user_id = auth.uid() or auth_user_is_super_admin()
);

create policy tickets_org_all on tickets for all
  using (auth_user_is_super_admin() or requester_id = auth.uid()
    or (organization_id is not null and organization_id in (select auth_user_org_ids())))
  with check (auth_user_is_super_admin() or requester_id = auth.uid()
    or (organization_id is not null and organization_id in (select auth_user_org_ids())));

create policy ticket_replies_read on ticket_replies for select using (
  auth_user_is_super_admin()
  or exists (select 1 from tickets t where t.id = ticket_replies.ticket_id
    and (t.requester_id = auth.uid()
         or (t.organization_id is not null and t.organization_id in (select auth_user_org_ids()))))
);
create policy ticket_replies_write on ticket_replies for insert with check (
  auth_user_is_super_admin()
  or exists (select 1 from tickets t where t.id = ticket_replies.ticket_id
    and (t.requester_id = auth.uid() or t.assignee_id = auth.uid()))
);

create policy usage_records_org_read on usage_records for select using (
  auth_user_is_super_admin() or organization_id in (select auth_user_org_ids())
);
create policy usage_records_admin_write on usage_records for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

create policy metric_snapshots_read on metric_snapshots for select using (auth_user_is_super_admin());
create policy metric_snapshots_admin_write on metric_snapshots for all
  using (auth_user_is_super_admin()) with check (auth_user_is_super_admin());

-- ============================================================================
-- TRIGGERS & SECURITY FUNCTIONS
-- ============================================================================

-- ── Privilege escalation guard ────────────────────────────────────────────────
create or replace function prevent_privilege_self_escalation()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if coalesce((select is_super_admin from profiles where id = v_uid), false) then return new; end if;
  if new.is_super_admin    is distinct from old.is_super_admin    then raise exception 'permission denied: cannot change is_super_admin'; end if;
  if new.risk_score        is distinct from old.risk_score        then raise exception 'permission denied: cannot change risk_score'; end if;
  if new.credits_remaining is distinct from old.credits_remaining then raise exception 'permission denied: cannot change credits_remaining'; end if;
  if new.status            is distinct from old.status            then raise exception 'permission denied: cannot change status'; end if;
  return new;
end; $$;
create trigger profiles_guard_escalation
  before update on profiles for each row execute function prevent_privilege_self_escalation();

-- ── Storage quota maintenance ─────────────────────────────────────────────────
create or replace function update_org_storage_used()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    update organizations set storage_used_bytes = storage_used_bytes + coalesce(NEW.file_size_bytes,0) where id = NEW.organization_id;
  elsif TG_OP = 'DELETE' then
    update organizations set storage_used_bytes = greatest(0, storage_used_bytes - coalesce(OLD.file_size_bytes,0)) where id = OLD.organization_id;
  elsif TG_OP = 'UPDATE' then
    if OLD.organization_id = NEW.organization_id then
      update organizations set storage_used_bytes = greatest(0, storage_used_bytes - coalesce(OLD.file_size_bytes,0) + coalesce(NEW.file_size_bytes,0)) where id = NEW.organization_id;
    else
      update organizations set storage_used_bytes = greatest(0, storage_used_bytes - coalesce(OLD.file_size_bytes,0)) where id = OLD.organization_id;
      update organizations set storage_used_bytes = storage_used_bytes + coalesce(NEW.file_size_bytes,0) where id = NEW.organization_id;
    end if;
  end if;
  return coalesce(NEW, OLD);
end; $$;
create trigger documents_storage_quota
  after insert or update of file_size_bytes, organization_id or delete on documents
  for each row execute function update_org_storage_used();

-- ── Audit log trigger ─────────────────────────────────────────────────────────
create or replace function write_audit_log()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_actor      uuid;
  v_action     text;
  v_org_id     uuid;
  v_target_id  text;
  v_target_lbl text;
  v_details    text;
begin
  v_actor := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  case TG_TABLE_NAME
    when 'organization_members' then
      v_org_id := coalesce(NEW.organization_id, OLD.organization_id);
      v_target_id := coalesce(NEW.user_id, OLD.user_id)::text;
      v_target_lbl := 'member:' || coalesce(NEW.role, OLD.role);
    when 'api_keys' then
      v_org_id := coalesce(NEW.organization_id, OLD.organization_id);
      v_target_id := coalesce(NEW.id, OLD.id)::text;
      v_target_lbl := coalesce(NEW.name, OLD.name, 'api_key');
      if TG_OP = 'UPDATE' and OLD.revoked_at is null and NEW.revoked_at is not null then
        v_action := 'api_keys.revoked';
      end if;
    when 'feature_flags' then
      v_org_id := null;
      v_target_id := coalesce(NEW.id, OLD.id)::text;
      v_target_lbl := coalesce(NEW.name::text, OLD.name::text);
      if TG_OP = 'UPDATE' then v_details := 'is_enabled: ' || OLD.is_enabled || ' → ' || NEW.is_enabled; end if;
    when 'plans' then
      v_org_id := null;
      v_target_id := coalesce(NEW.id, OLD.id)::text;
      v_target_lbl := coalesce(NEW.name, OLD.name);
    when 'organizations' then
      v_org_id := coalesce(NEW.id, OLD.id);
      v_target_id := v_org_id::text;
      v_target_lbl := coalesce(NEW.name, OLD.name);
    else
      v_org_id := null; v_target_id := null; v_target_lbl := null;
  end case;
  insert into audit_logs(organization_id, actor_id, action, target_type, target_id, target_label, details)
  values (v_org_id, v_actor, v_action, TG_TABLE_NAME, v_target_id, v_target_lbl, v_details);
  return coalesce(NEW, OLD);
end; $$;

create trigger audit_organization_members after insert or update or delete on organization_members for each row execute function write_audit_log();
create trigger audit_api_keys             after insert or update or delete on api_keys             for each row execute function write_audit_log();
create trigger audit_feature_flags        after insert or update or delete on feature_flags        for each row execute function write_audit_log();
create trigger audit_plans                after insert or update or delete on plans                for each row execute function write_audit_log();
create trigger audit_organizations        after update                     on organizations         for each row execute function write_audit_log();

-- ============================================================================
-- STORED PROCEDURES / RPCs
-- ============================================================================

-- ── Atomic first-org creation ──────────────────────────────────────────────────
create or replace function public.create_first_organization(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid            uuid := auth.uid();
  v_base_slug      citext;
  v_candidate_slug citext;
  v_org            public.organizations;
  v_attempt        int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.organization_members where user_id = v_uid and status = 'active') then
    raise exception 'already_has_organization';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'name_too_short'; end if;
  v_base_slug := lower(regexp_replace(trim(coalesce(p_slug, p_name)), '[^a-z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug::text, '^-|-$', '', 'g');
  if length(v_base_slug::text) < 2 then v_base_slug := 'org'; end if;
  v_base_slug := left(v_base_slug::text, 48);
  loop
    begin
      v_candidate_slug := case when v_attempt = 0 then v_base_slug
        else left(v_base_slug::text, 48 - length(('-' || v_attempt)::text)) || '-' || v_attempt end;
      insert into public.organizations (name, slug, status) values (trim(p_name), v_candidate_slug, 'trial') returning * into v_org;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 99 then raise exception 'slug_conflict_unresolvable'; end if;
    end;
  end loop;
  insert into public.organization_members (organization_id, user_id, role, status, joined_at) values (v_org.id, v_uid, 'owner', 'active', now());
  update public.profiles set current_org_id = v_org.id where id = v_uid;
  return to_jsonb(v_org);
end; $$;
revoke all on function public.create_first_organization(text, text) from public;
revoke all on function public.create_first_organization(text, text) from anon;
grant execute on function public.create_first_organization(text, text) to authenticated;

-- ── Dashboard KPIs (super-admin only) ─────────────────────────────────────────
create or replace function public.dashboard_kpis()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_users           bigint;
  v_orgs            bigint;
  v_enterprises     bigint;
  v_pages_today     bigint;
  v_queue_active    bigint;
  v_failed_today    bigint;
  v_webhooks_active bigint;
  v_enterprise_plan uuid;
begin
  if not coalesce((select is_super_admin from profiles where id = auth.uid()), false) then
    raise exception 'permission denied for function dashboard_kpis';
  end if;
  select id into v_enterprise_plan from plans where code = 'enterprise' limit 1;
  select count(*) into v_users from profiles;
  select count(*) into v_orgs from organizations where status != 'suspended';
  select count(*) into v_enterprises from organizations where status != 'suspended' and plan_id = v_enterprise_plan;
  select count(*) into v_pages_today from documents where created_at >= now() - interval '1 day';
  select count(*) into v_queue_active from processing_jobs where stage in ('pending','queued','ocr','ai_extraction','validation','export','retry');
  select count(*) into v_failed_today from processing_jobs where stage = 'failed' and created_at >= now() - interval '1 day';
  select count(*) into v_webhooks_active from webhooks where is_active = true;
  return json_build_object('users',v_users,'orgs',v_orgs,'enterprises',v_enterprises,'pages_today',v_pages_today,'queue_active',v_queue_active,'failed_today',v_failed_today,'webhooks_active',v_webhooks_active);
end; $$;
revoke execute on function public.dashboard_kpis() from authenticated;
grant  execute on function public.dashboard_kpis() to service_role;

-- ── Atomic job claiming ────────────────────────────────────────────────────────
create or replace function claim_processing_jobs(p_worker_id uuid, p_batch int)
returns setof processing_jobs language sql security definer set search_path = public as $$
  update processing_jobs set stage = 'ocr', worker_id = p_worker_id, started_at = now()
  where id in (
    select id from processing_jobs where stage = 'queued' and worker_id is null
    order by created_at limit p_batch for update skip locked
  ) returning *;
$$;
grant execute on function claim_processing_jobs(uuid, int) to service_role;

-- ── Add org credits ────────────────────────────────────────────────────────────
create or replace function add_org_credits(p_org_id uuid, p_credits bigint)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not coalesce((select is_super_admin from profiles where id = auth.uid()), false) then
    raise exception 'permission denied for function add_org_credits';
  end if;
  if p_credits <= 0 then raise exception 'credits must be a positive integer'; end if;
  update profiles set credits_remaining = credits_remaining + p_credits
  where id in (select user_id from organization_members where organization_id = p_org_id and role = 'owner' and status = 'active');
  if not found then raise exception 'organization not found or has no active owner'; end if;
end; $$;
grant execute on function add_org_credits(uuid, bigint) to authenticated;

-- ── API rate limit ─────────────────────────────────────────────────────────────
create or replace function public.check_api_rate_limit(p_key_id uuid, p_limit integer)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count  integer;
begin
  insert into public.api_rate_counters(api_key_id, window_start, request_count)
  values (p_key_id, v_window, 1)
  on conflict (api_key_id, window_start) do update set request_count = api_rate_counters.request_count + 1
  returning request_count into v_count;
  return v_count <= p_limit;
end; $$;

-- ============================================================================
-- STORAGE BUCKETS & POLICIES
-- ============================================================================

insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('exports', 'exports', false)     on conflict (id) do nothing;

create or replace function storage_path_org(p_name text)
returns uuid language sql immutable as $$
  select case when split_part(p_name,'/',1) ~* '^[0-9a-f-]{36}$'
    then split_part(p_name,'/',1)::uuid else null end;
$$;

drop policy if exists "documents_read"   on storage.objects;
drop policy if exists "documents_insert" on storage.objects;
drop policy if exists "documents_update" on storage.objects;
drop policy if exists "documents_delete" on storage.objects;
drop policy if exists "exports_read"     on storage.objects;
drop policy if exists "exports_insert"   on storage.objects;
drop policy if exists "exports_update"   on storage.objects;
drop policy if exists "exports_delete"   on storage.objects;

create policy "documents_read"   on storage.objects for select to authenticated using (bucket_id = 'documents' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "documents_insert" on storage.objects for insert to authenticated with check (bucket_id = 'documents' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "documents_update" on storage.objects for update to authenticated using (bucket_id = 'documents' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids()))) with check (bucket_id = 'documents' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "documents_delete" on storage.objects for delete to authenticated using (bucket_id = 'documents' and (auth_user_is_super_admin() or (storage_path_org(name) is not null and auth_user_is_org_admin(storage_path_org(name)))));

create policy "exports_read"   on storage.objects for select to authenticated using (bucket_id = 'exports' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "exports_insert" on storage.objects for insert to authenticated with check (bucket_id = 'exports' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "exports_update" on storage.objects for update to authenticated using (bucket_id = 'exports' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids()))) with check (bucket_id = 'exports' and (auth_user_is_super_admin() or storage_path_org(name) in (select auth_user_org_ids())));
create policy "exports_delete" on storage.objects for delete to authenticated using (bucket_id = 'exports' and (auth_user_is_super_admin() or (storage_path_org(name) is not null and auth_user_is_org_admin(storage_path_org(name)))));

-- ── Storage object cleanup on document delete ──────────────────────────────────
create or replace function public.delete_document_storage_object()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_delete(
      url     := current_setting('app.supabase_url', true) || '/storage/v1/object/documents/' || old.storage_path,
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key', true))
    );
  end if;
  return old;
end; $$;
create trigger documents_delete_storage_object
  after delete on public.documents for each row execute function public.delete_document_storage_object();

-- ============================================================================
-- SCHEDULED TASKS (pg_cron + pg_net — enable extensions first)
-- ============================================================================
-- PREREQUISITES (run once in Supabase Dashboard → Extensions):
--   1. Enable pg_cron
--   2. Enable pg_net
--   Then set GUCs:
--     alter database postgres set app.supabase_url    = 'https://<ref>.supabase.co';
--     alter database postgres set app.service_role_key = '<service-role-key>';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
  and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobname) from cron.job
      where jobname in ('billsos-cron-rollup','billsos-extract-worker','billsos-webhook-dispatch');

    perform cron.schedule('billsos-cron-rollup', '5 0 * * *',
      format($q$select net.http_post(url:=%L,headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{}'::jsonb)$q$,
        current_setting('app.supabase_url') || '/functions/v1/cron-rollup', current_setting('app.service_role_key')));

    perform cron.schedule('billsos-extract-worker', '* * * * *',
      format($q$select net.http_post(url:=%L,headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{}'::jsonb)$q$,
        current_setting('app.supabase_url') || '/functions/v1/extract', current_setting('app.service_role_key')));

    perform cron.schedule('billsos-webhook-dispatch', '* * * * *',
      format($q$select net.http_post(url:=%L,headers:='{"Content-Type":"application/json","Authorization":"Bearer %s"}'::jsonb,body:='{}'::jsonb)$q$,
        current_setting('app.supabase_url') || '/functions/v1/webhook-dispatch', current_setting('app.service_role_key')));
  else
    raise notice 'pg_cron or pg_net not enabled — skipping scheduled task registration';
  end if;
end; $$;

-- ============================================================================
-- REFERENCE DATA SEED
-- ============================================================================

insert into plans (code, name, price_amount_inr, is_custom_price, interval, status, version, sort_order,
  page_limit, ai_token_limit, ocr_limit, storage_limit_bytes, api_rate_limit, webhook_limit,
  concurrency, team_seats, white_label, dedicated_workers, priority_queue, sla_support, audit_logs)
values
  ('free',       'Free',       0,     false, 'monthly', 'active', '3.2', 1, 200,   50000,    200,   524288000,    60,   5,   1,  1,  false, false, false, false, false),
  ('starter',    'Starter',    1999,  false, 'monthly', 'active', '3.2', 2, 5000,  500000,   5000,  10737418240,  300,  20,  3,  5,  false, false, false, false, false),
  ('pro',        'Pro',        4999,  false, 'monthly', 'active', '3.2', 3, 25000, 2000000,  25000, 53687091200,  1000, 100, 10, 20, false, false, true,  false, true),
  ('business',   'Business',   14999, false, 'monthly', 'active', '3.2', 4, 100000,10000000, 100000,214748364800, 5000, 500, 25, 50, true,  false, true,  true,  true),
  ('enterprise', 'Enterprise', null,  true,  'yearly',  'active', '3.2', 5, null,  null,     null,  1099511627776,null, null,64, null,true,  true,  true,  true,  true)
on conflict (code) do update set
  name=excluded.name, price_amount_inr=excluded.price_amount_inr,
  is_custom_price=excluded.is_custom_price, interval=excluded.interval, status=excluded.status,
  version=excluded.version, sort_order=excluded.sort_order, page_limit=excluded.page_limit,
  ai_token_limit=excluded.ai_token_limit, ocr_limit=excluded.ocr_limit,
  storage_limit_bytes=excluded.storage_limit_bytes, api_rate_limit=excluded.api_rate_limit,
  webhook_limit=excluded.webhook_limit, concurrency=excluded.concurrency, team_seats=excluded.team_seats,
  white_label=excluded.white_label, dedicated_workers=excluded.dedicated_workers,
  priority_queue=excluded.priority_queue, sla_support=excluded.sla_support, audit_logs=excluded.audit_logs;

insert into document_categories (code, name, description, tag, icon, default_fields, industry, sort_order) values
  ('invoice',         'Invoice',         'Vendor invoices, line items, GST, totals.',        'core', 'Receipt',         24, 'General',    1),
  ('purchase_order',  'Purchase Order',  'PO numbers, vendor terms, item-level breakdown.',  'core', 'FileText',        18, 'General',    2),
  ('gst_return',      'GST Return',      'GSTR-1, 2B, 3B with reconciliation hooks.',        'tax',  'ScrollText',      32, 'Tax',        3),
  ('tds_certificate', 'TDS Certificate', 'Form 16, 16A, 26AS with deductor split.',          'tax',  'FileCheck2',      21, 'Tax',        4),
  ('bank_statement',  'Bank Statement',  'Multi-bank reconciliation, narration parsing.',    'core', 'Landmark',        14, 'Banking',    5),
  ('cheque',          'Cheque / DD',     'MICR, IFSC, payee, signatory verification.',       'core', 'Wallet',           9, 'Banking',    6),
  ('balance_sheet',   'Balance Sheet',   'Assets, liabilities, equity by period.',           'core', 'FileSpreadsheet', 28, 'Accounting', 7),
  ('pl_statement',    'P&L Statement',   'Revenue, COGS, opex, margins, EBITDA.',            'core', 'FileSpreadsheet', 26, 'Accounting', 8),
  ('delivery_challan','Delivery Challan','Dispatch references, SKU, transporter.',           'soon', 'ClipboardList',   16, 'Logistics',  9),
  ('salary_slip',     'Salary Slip',     'Earnings, deductions, PF, ESI, tax.',              'core', 'ReceiptText',     22, 'Payroll',   10),
  ('agreement',       'Agreement / MOU', 'Parties, clauses, term, signatories.',             'soon', 'FileSignature',   19, 'Legal',     11),
  ('expense_report',  'Expense Report',  'Per-employee, per-project expense rollups.',       'core', 'Banknote',        17, 'Finance',   12)
on conflict (code) do update set
  name=excluded.name, description=excluded.description, tag=excluded.tag, icon=excluded.icon,
  default_fields=excluded.default_fields, industry=excluded.industry, sort_order=excluded.sort_order;

insert into vendor_apis (name, type, endpoint, status, latency_ms, success_rate, cost_per_doc_inr, docs_today, cost_today_inr, uptime_pct, last_incident_at) values
  ('DocuScrape Primary',   'extraction', 'api.docuscrape.com/v2',  'healthy',  1240, 99.7, 0.50, 142000, 71000.00, 99.98, now() - interval '14 days'),
  ('DataFilter Pro',       'scraping',   'filter.api.net/extract', 'healthy',  850,  99.8, 0.20, 84000,  16800.00, 99.99, now() - interval '28 days'),
  ('FastExtract Global',   'extraction', 'global.extract.io/v1',   'degraded', 3200, 96.2, 0.40, 28000,  11200.00, 99.91, now() - interval '2 hours'),
  ('BankStatement Parser', 'extraction', 'finance-parser.com/api', 'healthy',  1860, 99.6, 1.20, 42000,  50400.00, 99.97, now() - interval '7 days')
on conflict (name) do update set type=excluded.type, endpoint=excluded.endpoint, status=excluded.status,
  latency_ms=excluded.latency_ms, success_rate=excluded.success_rate, cost_per_doc_inr=excluded.cost_per_doc_inr,
  docs_today=excluded.docs_today, cost_today_inr=excluded.cost_today_inr, uptime_pct=excluded.uptime_pct,
  last_incident_at=excluded.last_incident_at;

insert into integrations (name, category, status, icon, description, syncs_today, failed_syncs, connected_orgs, last_sync_at) values
  ('QuickBooks',       'Accounting',    'connected',    'QB', 'Sync extracted invoices to QuickBooks',    1240, 3,  890,  now()),
  ('Zoho Books',       'Accounting',    'connected',    'ZB', 'Push journal entries to Zoho Books',        840, 1,  620,  now()),
  ('Tally Prime',      'ERP',           'connected',    'TP', 'Export vouchers to Tally Prime',           2100, 8,  1450, now()),
  ('SAP Business One', 'ERP',           'connected',    'SP', 'Bidirectional sync with SAP B1',            320, 0,  84,   now()),
  ('Slack',            'Communication', 'connected',    'SL', 'Notify channels on extraction events',    4200, 2,  1820, now()),
  ('Microsoft Teams',  'Communication', 'connected',    'MT', 'Post extraction summaries to Teams',      1800, 5,  940,  now()),
  ('Google Drive',     'Storage',       'connected',    'GD', 'Watch Drive folders for new documents',   3400, 4,  2100, now()),
  ('Dropbox',          'Storage',       'disconnected', 'DB', 'Watch Dropbox folders for new documents',    0, 0,  340,  now() - interval '2 days'),
  ('Busy Accounting',  'ERP',           'beta',         'BA', 'Export to Busy Accounting',                  45, 12, 28,  now()),
  ('MARG ERP',         'ERP',           'beta',         'MG', 'Export to MARG ERP',                         18, 4,  12,  now() - interval '1 day')
on conflict (name) do update set category=excluded.category, status=excluded.status, icon=excluded.icon,
  description=excluded.description, syncs_today=excluded.syncs_today, failed_syncs=excluded.failed_syncs,
  connected_orgs=excluded.connected_orgs, last_sync_at=excluded.last_sync_at;

insert into feature_flags (name, description, type, is_enabled, enabled_dev, enabled_staging, enabled_production, rollout_pct) values
  ('ai_v2_extraction',       'Use v2 AI extraction pipeline with improved accuracy',             'release',    true,  true, true,  true,  100),
  ('batch_upload_v3',        'New batch upload UI with drag-and-drop folders',                  'release',    true,  true, true,  false,  30),
  ('gemini_fallback',        'Enable Gemini as fallback when Claude rate-limited',              'ops',        true,  true, true,  true,  100),
  ('smart_template_suggest', 'AI-powered template suggestion on upload',                         'experiment', false, true, false, false,   0),
  ('enterprise_sso_v2',      'SAML 2.0 SSO with custom IdP support',                            'permission', true,  true, true,  true,  100),
  ('realtime_collaboration', 'Live collaboration on extraction review',                          'experiment', false, true, false, false,   0),
  ('auto_retry_v2',          'Intelligent retry with exponential backoff and circuit breaker',  'ops',        true,  true, true,  true,  100),
  ('webhook_v3_payload',     'Enhanced webhook payload with extraction metadata',               'release',    true,  true, true,  false,  50),
  ('ocr_confidence_ui',      'Show per-field OCR confidence scores in UI',                       'experiment', false, true, true,  false,   0),
  ('dedicated_worker_pool',  'Enterprise customers get isolated worker pool',                    'permission', true,  true, true,  true,  100)
on conflict (name) do update set description=excluded.description, type=excluded.type,
  is_enabled=excluded.is_enabled, enabled_dev=excluded.enabled_dev, enabled_staging=excluded.enabled_staging,
  enabled_production=excluded.enabled_production, rollout_pct=excluded.rollout_pct;

insert into workers (name, type, status, region, cpu_pct, memory_pct, jobs_processed)
select
  'wrk-' || lpad(n::text, 2, '0'),
  case when n <= 8 then 'dedicated'::worker_type else 'shared'::worker_type end,
  (array['healthy','healthy','healthy','healthy','degraded','offline']::worker_status[])[1 + (n % 6)],
  (array['ap-south-1','us-east-1','eu-west-1','ap-southeast-1'])[1 + (n % 4)],
  30 + (n * 7) % 60, 40 + (n * 11) % 50, 500 + n * 73
from generate_series(1, 24) as n
on conflict (name) do nothing;

-- Signal PostgREST to reload the schema cache
select pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- SOURCE: 202606090001_add_custom_auth_token_columns.sql
-- ============================================================================
alter table public.profiles
  add column if not exists email_verify_token text,
  add column if not exists email_verify_expires timestamptz,
  add column if not exists pwd_reset_token text,
  add column if not exists pwd_reset_expires timestamptz;

create index if not exists profiles_email_verify_token_idx
  on public.profiles(email_verify_token)
  where email_verify_token is not null;

create index if not exists profiles_pwd_reset_token_idx
  on public.profiles(pwd_reset_token)
  where pwd_reset_token is not null;

-- ============================================================================
-- SOURCE: 202606100001_private_template_copies.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Private editable copies of prebuilt templates
-- ============================================================================

alter type template_scope add value if not exists 'user';

alter table templates
  add column if not exists source_template_id uuid references templates(id) on delete set null;

drop index if exists templates_user_source_unique_idx;

create unique index if not exists templates_user_source_unique_idx
  on templates(author_id, source_template_id);

create index if not exists templates_source_template_idx
  on templates(source_template_id);

drop policy if exists templates_read on templates;
drop policy if exists templates_write_org_admin on templates;
drop policy if exists template_fields_read on template_fields;
drop policy if exists template_fields_write on template_fields;

create policy templates_read on templates for select using (
  scope = 'public'
  or auth_user_is_super_admin()
  or organization_id in (select auth_user_org_ids())
  or (scope::text = 'user' and author_id = auth.uid())
);

create policy templates_write_org_admin on templates for all
  using (
    auth_user_is_super_admin()
    or (scope::text = 'user' and author_id = auth.uid())
    or (organization_id is not null and auth_user_is_org_admin(organization_id))
    or (scope <> 'public' and author_id = auth.uid())
  )
  with check (
    auth_user_is_super_admin()
    or (scope::text = 'user' and author_id = auth.uid() and organization_id is null)
    or (organization_id is not null and auth_user_is_org_admin(organization_id))
    or (scope::text not in ('public', 'user') and author_id = auth.uid())
  );

create policy template_fields_read on template_fields for select using (
  auth_user_is_super_admin()
  or exists (
    select 1
    from templates t
    where t.id = template_fields.template_id
      and (
        t.scope = 'public'
        or t.organization_id in (select auth_user_org_ids())
        or (t.scope::text = 'user' and t.author_id = auth.uid())
      )
  )
);

create policy template_fields_write on template_fields for all
  using (
    auth_user_is_super_admin()
    or exists (
      select 1
      from templates t
      where t.id = template_fields.template_id
        and (
          (t.scope::text = 'user' and t.author_id = auth.uid())
          or (t.organization_id is not null and auth_user_is_org_admin(t.organization_id))
          or (t.scope <> 'public' and t.author_id = auth.uid())
        )
    )
  )
  with check (
    auth_user_is_super_admin()
    or exists (
      select 1
      from templates t
      where t.id = template_fields.template_id
        and (
          (t.scope::text = 'user' and t.author_id = auth.uid())
          or (t.organization_id is not null and auth_user_is_org_admin(t.organization_id))
          or (t.scope <> 'public' and t.author_id = auth.uid())
        )
    )
  );

-- ============================================================================
-- SOURCE: 20260610_prebuilt_templates.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Prebuilt Public Templates — Research-based Field Definitions
-- Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.
-- Run via Supabase SQL editor or supabase db push.
-- ============================================================================

-- ── Step 1: Upsert all categories ────────────────────────────────────────────
insert into document_categories
  (code, name, description, tag, icon, default_fields, industry, sort_order, is_active)
values
  ('invoice',          'Tax Invoice',        'GST/VAT tax invoices — B2B and B2C with line items, taxes, and ITC fields',           'core', 'Receipt',        20, 'Finance',     1, true),
  ('bank_statement',   'Bank Statement',     'Monthly bank account statements with transactions, balances, and account details',    'core', 'Landmark',       18, 'Banking',     2, true),
  ('purchase_order',   'Purchase Order',     'Vendor purchase orders with header, line items, delivery terms, and approval',        'core', 'ClipboardList',  19, 'Procurement', 3, true),
  ('salary_slip',      'Salary Slip',        'Employee payslips with earnings, PF, ESI, TDS deductions, and net pay',              'core', 'Banknote',       18, 'HR',          4, true),
  ('gst_return',       'GST Return',         'GSTR-2B / GSTR-3B with ITC, tax liability, and reconciliation fields',               'tax',  'ScrollText',     15, 'Accounting',  5, true),
  ('tds_certificate',  'TDS Certificate',    'Form 16 / Form 16A — TDS certificate with deductor, deductee, and amounts',         'tax',  'FileCheck2',     16, 'Accounting',  6, true),
  ('credit_note',      'Credit Note',        'GST credit/debit notes against original invoices — CGST Section 34',                'core', 'ReceiptText',    15, 'Finance',     7, true),
  ('delivery_note',    'Delivery Challan',   'GST delivery challans (Rule 55) for dispatch, job work, and stock transfers',        'core', 'FileText',       14, 'Logistics',   8, true),
  ('expense_report',   'Expense Report',     'Employee expense claims with categories, receipts, taxes, and reimbursement',        'core', 'Wallet',         15, 'Finance',     9, true),
  ('utility_bill',     'Utility Bill',       'Electricity, gas, water, telecom bills with usage, meter readings, and charges',    'core', 'FileSpreadsheet',15, 'Facilities', 10, true),
  ('rental_agreement', 'Rental Agreement',   'Lease and rental contracts — parties, rent, deposit, term, and clauses',            'soon', 'FileSignature',  14, 'Real Estate',11, true),
  ('insurance_policy', 'Insurance Policy',   'Health, vehicle, and property insurance policies with coverage and premium',         'soon', 'FileText',       14, 'Insurance',  12, true)
on conflict (code) do nothing;

-- ── Step 2: Create one public template per category ──────────────────────────
insert into templates
  (id, name, description, category_id, organization_id, author_id,
   status, scope, is_featured, rating, downloads, version)
select
  gen_random_uuid(),
  dc.name,
  dc.description,
  dc.id,
  null,
  null,
  'published',
  'public',
  dc.code in ('invoice','bank_statement','purchase_order','salary_slip'),
  4.7,
  0,
  '1.0'
from document_categories dc
where not exists (
  select 1 from templates t
  where t.category_id = dc.id
    and t.scope = 'public'
    and t.organization_id is null
);

-- ── Step 3: Seed fields — one block per document type ────────────────────────
-- Pattern: WITH tpl AS (get template id) INSERT ... SELECT tpl.id, v.* FROM tpl CROSS JOIN (VALUES ...) v

-- ────────────────────────────────────────────────────────────────────────────
-- TAX INVOICE  (CGST Rule 46 + e-Invoice/IRN fields)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'invoice' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('invoice_number',   'Invoice Number',        'Identification','string',  'true',  0.99, 1),
  ('invoice_date',     'Invoice Date',          'Identification','date',    'true',  0.98, 2),
  ('invoice_type',     'Invoice Type',          'Identification','string',  'true',  0.96, 3),
  ('place_of_supply',  'Place of Supply',       'Identification','string',  'true',  0.94, 4),
  ('reverse_charge',   'Reverse Charge',        'Identification','string',  'false', 0.88, 5),
  ('vendor_name',      'Supplier Name',         'Supplier',     'string',  'true',  0.99, 6),
  ('vendor_address',   'Supplier Address',      'Supplier',     'string',  'false', 0.88, 7),
  ('vendor_gstin',     'Supplier GSTIN',        'Supplier',     'string',  'true',  0.97, 8),
  ('vendor_pan',       'Supplier PAN',          'Supplier',     'string',  'false', 0.87, 9),
  ('buyer_name',       'Buyer Name',            'Buyer',        'string',  'true',  0.98, 10),
  ('buyer_address',    'Buyer Address',         'Buyer',        'string',  'false', 0.87, 11),
  ('buyer_gstin',      'Buyer GSTIN',           'Buyer',        'string',  'true',  0.96, 12),
  ('shipping_address', 'Shipping Address',      'Buyer',        'string',  'false', 0.84, 13),
  ('item_description', 'Item Description',      'Line Items',   'string',  'true',  0.95, 14),
  ('hsn_sac_code',     'HSN / SAC Code',        'Line Items',   'string',  'true',  0.92, 15),
  ('quantity',         'Quantity',              'Line Items',   'number',  'true',  0.93, 16),
  ('unit_of_measure',  'Unit of Measure',       'Line Items',   'string',  'false', 0.87, 17),
  ('unit_price',       'Unit Price',            'Line Items',   'currency','true',  0.94, 18),
  ('discount',         'Discount',              'Line Items',   'currency','false', 0.85, 19),
  ('taxable_value',    'Taxable Value',         'Totals',       'currency','true',  0.98, 20),
  ('cgst_rate',        'CGST Rate %',           'Tax',          'string',  'false', 0.91, 21),
  ('cgst_amount',      'CGST Amount',           'Tax',          'currency','true',  0.97, 22),
  ('sgst_rate',        'SGST / UTGST Rate %',   'Tax',          'string',  'false', 0.91, 23),
  ('sgst_amount',      'SGST / UTGST Amount',   'Tax',          'currency','true',  0.97, 24),
  ('igst_rate',        'IGST Rate %',           'Tax',          'string',  'false', 0.90, 25),
  ('igst_amount',      'IGST Amount',           'Tax',          'currency','false', 0.95, 26),
  ('cess_amount',      'Cess Amount',           'Tax',          'currency','false', 0.83, 27),
  ('total_amount',     'Total Invoice Value',   'Totals',       'currency','true',  0.99, 28),
  ('amount_in_words',  'Amount in Words',       'Totals',       'string',  'false', 0.82, 29),
  ('due_date',         'Payment Due Date',      'Totals',       'date',    'true',  0.91, 30),
  ('irn_number',       'IRN Number',            'e-Invoice',    'string',  'false', 0.96, 31),
  ('eway_bill_number', 'E-Way Bill Number',     'e-Invoice',    'string',  'false', 0.90, 32)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- BANK STATEMENT
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'bank_statement' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('account_holder',   'Account Holder Name',   'Account',      'string',  'true',  0.98, 1),
  ('account_number',   'Account Number',        'Account',      'string',  'true',  0.99, 2),
  ('account_type',     'Account Type',          'Account',      'string',  'true',  0.94, 3),
  ('ifsc_code',        'IFSC Code',             'Account',      'string',  'true',  0.98, 4),
  ('micr_code',        'MICR Code',             'Account',      'string',  'false', 0.85, 5),
  ('bank_name',        'Bank Name',             'Account',      'string',  'true',  0.99, 6),
  ('branch_name',      'Branch Name',           'Account',      'string',  'false', 0.88, 7),
  ('customer_id',      'Customer ID',           'Account',      'string',  'false', 0.87, 8),
  ('statement_period', 'Statement Period',      'Period',       'string',  'true',  0.96, 9),
  ('statement_date',   'Statement Date',        'Period',       'date',    'true',  0.96, 10),
  ('opening_balance',  'Opening Balance',       'Balances',     'currency','true',  0.97, 11),
  ('closing_balance',  'Closing Balance',       'Balances',     'currency','true',  0.98, 12),
  ('total_credits',    'Total Credits',         'Balances',     'currency','true',  0.96, 13),
  ('total_debits',     'Total Debits',          'Balances',     'currency','true',  0.96, 14),
  ('txn_date',         'Transaction Date',      'Transactions', 'date',    'true',  0.97, 15),
  ('value_date',       'Value Date',            'Transactions', 'date',    'false', 0.93, 16),
  ('txn_description',  'Description / Narration','Transactions','string',  'true',  0.93, 17),
  ('txn_reference',    'Reference / Cheque No', 'Transactions', 'string',  'false', 0.88, 18),
  ('debit_amount',     'Debit Amount',          'Transactions', 'currency','true',  0.96, 19),
  ('credit_amount',    'Credit Amount',         'Transactions', 'currency','true',  0.96, 20),
  ('running_balance',  'Running Balance',       'Transactions', 'currency','false', 0.90, 21),
  ('txn_type',         'Transaction Type',      'Transactions', 'string',  'false', 0.88, 22)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- PURCHASE ORDER
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'purchase_order' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('po_number',        'PO Number',             'Identification','string',  'true',  0.99, 1),
  ('po_date',          'PO Date',               'Identification','date',    'true',  0.98, 2),
  ('po_revision',      'Revision / Amendment',  'Identification','string',  'false', 0.82, 3),
  ('buyer_name',       'Buyer / Company Name',  'Buyer',        'string',  'true',  0.98, 4),
  ('buyer_address',    'Buyer Address',         'Buyer',        'string',  'false', 0.87, 5),
  ('buyer_gstin',      'Buyer GSTIN',           'Buyer',        'string',  'false', 0.90, 6),
  ('buyer_contact',    'Buyer Contact Person',  'Buyer',        'string',  'false', 0.82, 7),
  ('vendor_name',      'Vendor Name',           'Vendor',       'string',  'true',  0.98, 8),
  ('vendor_address',   'Vendor Address',        'Vendor',       'string',  'false', 0.86, 9),
  ('vendor_gstin',     'Vendor GSTIN',          'Vendor',       'string',  'true',  0.93, 10),
  ('vendor_code',      'Vendor Code',           'Vendor',       'string',  'false', 0.85, 11),
  ('item_code',        'Item / Part Code',      'Line Items',   'string',  'false', 0.88, 12),
  ('item_description', 'Item Description',      'Line Items',   'string',  'true',  0.95, 13),
  ('hsn_code',         'HSN / SAC Code',        'Line Items',   'string',  'true',  0.91, 14),
  ('quantity',         'Quantity',              'Line Items',   'number',  'true',  0.94, 15),
  ('unit_of_measure',  'Unit of Measure',       'Line Items',   'string',  'false', 0.87, 16),
  ('unit_price',       'Unit Price',            'Line Items',   'currency','true',  0.94, 17),
  ('line_total',       'Line Total',            'Line Items',   'currency','true',  0.93, 18),
  ('delivery_date',    'Required Delivery Date','Terms',        'date',    'true',  0.92, 19),
  ('delivery_address', 'Delivery Address',      'Terms',        'string',  'false', 0.85, 20),
  ('payment_terms',    'Payment Terms',         'Terms',        'string',  'true',  0.90, 21),
  ('incoterms',        'Incoterms',             'Terms',        'string',  'false', 0.82, 22),
  ('subtotal',         'Subtotal',              'Totals',       'currency','true',  0.98, 23),
  ('tax_amount',       'Tax Amount',            'Totals',       'currency','true',  0.97, 24),
  ('freight_charges',  'Freight / Shipping',    'Totals',       'currency','false', 0.84, 25),
  ('total_amount',     'Total PO Value',        'Totals',       'currency','true',  0.99, 26),
  ('approved_by',      'Approved By',           'Approval',     'string',  'false', 0.82, 27),
  ('approval_date',    'Approval Date',         'Approval',     'date',    'false', 0.82, 28)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- SALARY SLIP  (Indian PF / ESI / TDS compliance)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'salary_slip' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('employee_name',     'Employee Name',          'Employee',  'string',  'true',  0.99, 1),
  ('employee_id',       'Employee ID',            'Employee',  'string',  'true',  0.97, 2),
  ('designation',       'Designation',            'Employee',  'string',  'true',  0.96, 3),
  ('department',        'Department',             'Employee',  'string',  'true',  0.94, 4),
  ('location',          'Work Location',          'Employee',  'string',  'false', 0.88, 5),
  ('pan_number',        'PAN Number',             'Employee',  'string',  'true',  0.96, 6),
  ('uan_number',        'UAN (PF) Number',        'Employee',  'string',  'false', 0.90, 7),
  ('esi_number',        'ESI Number',             'Employee',  'string',  'false', 0.87, 8),
  ('pay_period',        'Pay Period',             'Period',    'string',  'true',  0.98, 9),
  ('working_days',      'Working Days',           'Period',    'number',  'false', 0.87, 10),
  ('days_paid',         'Days Paid',              'Period',    'number',  'false', 0.86, 11),
  ('basic_salary',      'Basic Salary',           'Earnings',  'currency','true',  0.99, 12),
  ('hra',               'HRA',                    'Earnings',  'currency','true',  0.96, 13),
  ('special_allowance', 'Special Allowance',      'Earnings',  'currency','true',  0.93, 14),
  ('conveyance',        'Conveyance Allowance',   'Earnings',  'currency','false', 0.88, 15),
  ('lta',               'LTA',                    'Earnings',  'currency','false', 0.83, 16),
  ('medical_allowance', 'Medical Allowance',      'Earnings',  'currency','false', 0.84, 17),
  ('other_allowances',  'Other Allowances',       'Earnings',  'currency','false', 0.83, 18),
  ('gross_salary',      'Gross Earnings',         'Earnings',  'currency','true',  0.99, 19),
  ('pf_employee',       'PF Employee 12%',        'Deductions','currency','true',  0.97, 20),
  ('esi_employee',      'ESI Employee 0.75%',     'Deductions','currency','false', 0.91, 21),
  ('tds_deduction',     'TDS on Salary',          'Deductions','currency','true',  0.96, 22),
  ('professional_tax',  'Professional Tax',       'Deductions','currency','false', 0.89, 23),
  ('loan_deduction',    'Loan / Advance',         'Deductions','currency','false', 0.82, 24),
  ('other_deductions',  'Other Deductions',       'Deductions','currency','false', 0.81, 25),
  ('total_deductions',  'Total Deductions',       'Deductions','currency','true',  0.98, 26),
  ('net_salary',        'Net Pay (Take Home)',    'Summary',   'currency','true',  0.99, 27),
  ('payment_mode',      'Payment Mode',           'Summary',   'string',  'false', 0.85, 28),
  ('bank_account',      'Bank Account Number',    'Summary',   'string',  'false', 0.88, 29)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- GST RETURN  (GSTR-2B / GSTR-3B)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'gst_return' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('gstin',             'GSTIN',                 'Identification',  'string',  'true',  0.99, 1),
  ('legal_name',        'Legal Name',            'Identification',  'string',  'true',  0.98, 2),
  ('trade_name',        'Trade Name',            'Identification',  'string',  'false', 0.88, 3),
  ('return_type',       'Return Type',           'Identification',  'string',  'true',  0.99, 4),
  ('return_period',     'Return Period',         'Identification',  'string',  'true',  0.98, 5),
  ('filing_date',       'Filing Date',           'Identification',  'date',    'false', 0.90, 6),
  ('taxable_turnover',  'Taxable Turnover',      'Outward Supplies','currency','true',  0.97, 7),
  ('exempt_supplies',   'Exempt / Nil Supplies', 'Outward Supplies','currency','false', 0.84, 8),
  ('export_supplies',   'Exports (Zero Rated)',  'Outward Supplies','currency','false', 0.83, 9),
  ('igst_liability',    'IGST Liability',        'Tax Liability',   'currency','true',  0.96, 10),
  ('cgst_liability',    'CGST Liability',        'Tax Liability',   'currency','true',  0.96, 11),
  ('sgst_liability',    'SGST Liability',        'Tax Liability',   'currency','true',  0.96, 12),
  ('cess_liability',    'Cess Liability',        'Tax Liability',   'currency','false', 0.82, 13),
  ('total_tax_liability','Total Tax Liability',  'Tax Liability',   'currency','true',  0.97, 14),
  ('itc_igst',          'ITC Available IGST',    'Input Tax Credit','currency','true',  0.93, 15),
  ('itc_cgst',          'ITC Available CGST',    'Input Tax Credit','currency','true',  0.93, 16),
  ('itc_sgst',          'ITC Available SGST',    'Input Tax Credit','currency','true',  0.93, 17),
  ('itc_reversed',      'ITC Reversed',          'Input Tax Credit','currency','false', 0.84, 18),
  ('net_itc',           'Net ITC Claimed',       'Input Tax Credit','currency','true',  0.92, 19),
  ('tax_payable',       'Tax Payable (Net)',      'Payment',         'currency','true',  0.96, 20),
  ('late_fee',          'Late Fee',              'Payment',         'currency','false', 0.80, 21),
  ('interest',          'Interest',              'Payment',         'currency','false', 0.80, 22)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- TDS CERTIFICATE  (Form 16 / Form 16A)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'tds_certificate' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('certificate_type',  'Certificate Type',      'Identification','string',  'true',  0.99, 1),
  ('certificate_number','Certificate Number',    'Identification','string',  'true',  0.97, 2),
  ('assessment_year',   'Assessment Year',       'Identification','string',  'true',  0.99, 3),
  ('quarter',           'Quarter Q1 to Q4',      'Identification','string',  'true',  0.97, 4),
  ('deductor_name',     'Deductor Name',         'Deductor',     'string',  'true',  0.99, 5),
  ('deductor_tan',      'Deductor TAN',          'Deductor',     'string',  'true',  0.99, 6),
  ('deductor_pan',      'Deductor PAN',          'Deductor',     'string',  'false', 0.91, 7),
  ('deductor_address',  'Deductor Address',      'Deductor',     'string',  'false', 0.83, 8),
  ('deductee_name',     'Deductee Name',         'Deductee',     'string',  'true',  0.99, 9),
  ('deductee_pan',      'Deductee PAN',          'Deductee',     'string',  'true',  0.99, 10),
  ('deductee_desig',    'Designation',           'Deductee',     'string',  'false', 0.87, 11),
  ('gross_income',      'Gross Income Paid',     'Amounts',      'currency','true',  0.97, 12),
  ('section_code',      'Section Code',          'Amounts',      'string',  'true',  0.95, 13),
  ('tds_rate',          'TDS Rate Percent',      'Amounts',      'string',  'true',  0.94, 14),
  ('tds_deducted',      'TDS Deducted',          'Amounts',      'currency','true',  0.99, 15),
  ('surcharge',         'Surcharge',             'Amounts',      'currency','false', 0.83, 16),
  ('cess_amount',       'Cess',                  'Amounts',      'currency','false', 0.83, 17),
  ('total_tds',         'Total TDS Deposited',   'Amounts',      'currency','true',  0.98, 18),
  ('payment_date',      'Payment / Deduction Date','Payment',    'date',    'false', 0.90, 19),
  ('challan_number',    'Challan / BSR Code',    'Payment',      'string',  'false', 0.87, 20),
  ('deposit_date',      'Deposit Date',          'Payment',      'date',    'false', 0.86, 21)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- CREDIT NOTE / DEBIT NOTE  (CGST Section 34)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'credit_note' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('note_number',         'Credit/Debit Note No',  'Identification','string',  'true',  0.99, 1),
  ('note_date',           'Note Date',             'Identification','date',    'true',  0.98, 2),
  ('note_type',           'Note Type CR or DR',    'Identification','string',  'true',  0.98, 3),
  ('original_invoice_no', 'Original Invoice No',   'Identification','string',  'true',  0.96, 4),
  ('original_invoice_dt', 'Original Invoice Date', 'Identification','date',    'false', 0.90, 5),
  ('place_of_supply',     'Place of Supply',       'Identification','string',  'true',  0.92, 6),
  ('supplier_name',       'Supplier Name',         'Parties',      'string',  'true',  0.98, 7),
  ('supplier_gstin',      'Supplier GSTIN',        'Parties',      'string',  'true',  0.97, 8),
  ('receiver_name',       'Receiver Name',         'Parties',      'string',  'true',  0.97, 9),
  ('receiver_gstin',      'Receiver GSTIN',        'Parties',      'string',  'true',  0.95, 10),
  ('item_description',    'Item Description',      'Items',        'string',  'true',  0.93, 11),
  ('hsn_sac_code',        'HSN / SAC Code',        'Items',        'string',  'true',  0.90, 12),
  ('quantity',            'Quantity',              'Items',        'number',  'false', 0.88, 13),
  ('unit_price',          'Unit Price',            'Items',        'currency','false', 0.87, 14),
  ('taxable_amount',      'Taxable Amount',        'Amounts',      'currency','true',  0.97, 15),
  ('cgst_amount',         'CGST Amount',           'Amounts',      'currency','true',  0.96, 16),
  ('sgst_amount',         'SGST Amount',           'Amounts',      'currency','true',  0.96, 17),
  ('igst_amount',         'IGST Amount',           'Amounts',      'currency','false', 0.94, 18),
  ('total_note_value',    'Total Note Value',      'Amounts',      'currency','true',  0.99, 19),
  ('reason',              'Reason for Issuance',   'Details',      'string',  'true',  0.88, 20)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- DELIVERY CHALLAN  (GST Rule 55)
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'delivery_note' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('challan_number',    'Challan Number',        'Identification','string',  'true',  0.99, 1),
  ('challan_date',      'Challan Date',          'Identification','date',    'true',  0.98, 2),
  ('challan_type',      'Challan Type',          'Identification','string',  'false', 0.84, 3),
  ('po_reference',      'PO / Order Reference',  'Identification','string',  'false', 0.85, 4),
  ('consignor_name',    'Consignor Name',        'Parties',      'string',  'true',  0.97, 5),
  ('consignor_gstin',   'Consignor GSTIN',       'Parties',      'string',  'true',  0.95, 6),
  ('consignor_address', 'Consignor Address',     'Parties',      'string',  'false', 0.85, 7),
  ('consignee_name',    'Consignee Name',        'Parties',      'string',  'true',  0.97, 8),
  ('consignee_gstin',   'Consignee GSTIN',       'Parties',      'string',  'false', 0.88, 9),
  ('delivery_address',  'Delivery Address',      'Parties',      'string',  'true',  0.91, 10),
  ('item_description',  'Item Description',      'Items',        'string',  'true',  0.95, 11),
  ('hsn_code',          'HSN Code',              'Items',        'string',  'true',  0.91, 12),
  ('quantity',          'Quantity',              'Items',        'number',  'true',  0.95, 13),
  ('unit_of_measure',   'Unit of Measure',       'Items',        'string',  'false', 0.87, 14),
  ('taxable_value',     'Taxable Value',         'Items',        'currency','false', 0.88, 15),
  ('transporter_name',  'Transporter Name',      'Transport',    'string',  'false', 0.84, 16),
  ('vehicle_number',    'Vehicle Number',        'Transport',    'string',  'false', 0.87, 17),
  ('lr_number',         'LR / GR Number',        'Transport',    'string',  'false', 0.83, 18),
  ('dispatch_date',     'Dispatch Date',         'Transport',    'date',    'true',  0.94, 19),
  ('expected_delivery', 'Expected Delivery Date','Transport',    'date',    'false', 0.83, 20),
  ('eway_bill_number',  'E-Way Bill Number',     'Transport',    'string',  'false', 0.88, 21)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- EXPENSE REPORT
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'expense_report' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('report_id',          'Report ID',             'Report',    'string',  'false', 0.88, 1),
  ('report_title',       'Report Title',          'Report',    'string',  'false', 0.85, 2),
  ('report_period',      'Report Period',         'Report',    'string',  'true',  0.96, 3),
  ('submission_date',    'Submission Date',       'Report',    'date',    'true',  0.95, 4),
  ('employee_name',      'Employee Name',         'Employee',  'string',  'true',  0.98, 5),
  ('employee_id',        'Employee ID',           'Employee',  'string',  'false', 0.90, 6),
  ('department',         'Department',            'Employee',  'string',  'false', 0.88, 7),
  ('cost_center',        'Cost Center / Project', 'Employee',  'string',  'false', 0.83, 8),
  ('expense_date',       'Expense Date',          'Expense',   'date',    'true',  0.96, 9),
  ('merchant_name',      'Merchant / Vendor',     'Expense',   'string',  'true',  0.94, 10),
  ('expense_category',   'Expense Category',      'Expense',   'string',  'true',  0.93, 11),
  ('expense_description','Description',           'Expense',   'string',  'true',  0.90, 12),
  ('payment_method',     'Payment Method',        'Expense',   'string',  'false', 0.87, 13),
  ('receipt_number',     'Receipt / Invoice No',  'Expense',   'string',  'false', 0.85, 14),
  ('currency',           'Currency',              'Expense',   'string',  'false', 0.92, 15),
  ('amount',             'Amount Before Tax',     'Expense',   'currency','true',  0.96, 16),
  ('gst_amount',         'GST / Tax Amount',      'Expense',   'currency','false', 0.88, 17),
  ('total_amount',       'Total Amount',          'Expense',   'currency','true',  0.97, 18),
  ('billable_to_client', 'Billable to Client',    'Expense',   'string',  'false', 0.78, 19),
  ('total_claimed',      'Total Amount Claimed',  'Summary',   'currency','true',  0.99, 20),
  ('approved_amount',    'Approved Amount',       'Summary',   'currency','false', 0.88, 21),
  ('approved_by',        'Approved By',           'Summary',   'string',  'false', 0.85, 22),
  ('approval_date',      'Approval Date',         'Summary',   'date',    'false', 0.84, 23)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- UTILITY BILL
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'utility_bill' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('service_provider',   'Service Provider',      'Provider', 'string',  'true',  0.98, 1),
  ('bill_number',        'Bill / Invoice Number', 'Provider', 'string',  'true',  0.97, 2),
  ('utility_type',       'Utility Type',          'Provider', 'string',  'true',  0.96, 3),
  ('consumer_name',      'Consumer Name',         'Account',  'string',  'true',  0.97, 4),
  ('consumer_number',    'Consumer / Account No', 'Account',  'string',  'true',  0.99, 5),
  ('meter_number',       'Meter Number',          'Account',  'string',  'false', 0.90, 6),
  ('service_address',    'Service Address',       'Account',  'string',  'true',  0.92, 7),
  ('billing_period',     'Billing Period',        'Period',   'string',  'true',  0.97, 8),
  ('bill_date',          'Bill Date',             'Period',   'date',    'true',  0.97, 9),
  ('due_date',           'Due Date',              'Period',   'date',    'true',  0.97, 10),
  ('previous_reading',   'Previous Meter Reading','Usage',    'number',  'false', 0.88, 11),
  ('current_reading',    'Current Meter Reading', 'Usage',    'number',  'false', 0.88, 12),
  ('units_consumed',     'Units Consumed',        'Usage',    'number',  'true',  0.93, 13),
  ('rate_per_unit',      'Rate Per Unit',         'Usage',    'currency','false', 0.86, 14),
  ('load_sanctioned',    'Sanctioned Load kW',    'Usage',    'string',  'false', 0.80, 15),
  ('energy_charges',     'Energy Charges',        'Charges',  'currency','true',  0.95, 16),
  ('fixed_charges',      'Fixed / Demand Charges','Charges',  'currency','false', 0.86, 17),
  ('fuel_surcharge',     'Fuel / Regulatory Surcharge','Charges','currency','false',0.82,18),
  ('arrears',            'Arrears',               'Charges',  'currency','false', 0.86, 19),
  ('subsidies',          'Subsidies / Rebate',    'Charges',  'currency','false', 0.80, 20),
  ('tax_amount',         'Tax / GST Amount',      'Charges',  'currency','false', 0.87, 21),
  ('total_amount',       'Total Amount Due',      'Charges',  'currency','true',  0.99, 22),
  ('previous_balance',   'Previous Balance',      'Payment',  'currency','false', 0.84, 23),
  ('last_payment_date',  'Last Payment Date',     'Payment',  'date',    'false', 0.82, 24),
  ('last_payment_amount','Last Payment Amount',   'Payment',  'currency','false', 0.82, 25)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- RENTAL / LEASE AGREEMENT
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'rental_agreement' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('agreement_number',  'Agreement Number',      'Identification','string',  'false', 0.85, 1),
  ('agreement_date',    'Agreement Date',        'Identification','date',    'true',  0.96, 2),
  ('agreement_type',    'Agreement Type',        'Identification','string',  'true',  0.92, 3),
  ('registration_no',   'Registration Number',   'Identification','string',  'false', 0.82, 4),
  ('landlord_name',     'Landlord Name',         'Parties',      'string',  'true',  0.97, 5),
  ('landlord_pan',      'Landlord PAN',          'Parties',      'string',  'false', 0.88, 6),
  ('landlord_address',  'Landlord Address',      'Parties',      'string',  'false', 0.84, 7),
  ('landlord_contact',  'Landlord Contact',      'Parties',      'string',  'false', 0.80, 8),
  ('tenant_name',       'Tenant Name',           'Parties',      'string',  'true',  0.97, 9),
  ('tenant_pan',        'Tenant PAN',            'Parties',      'string',  'false', 0.87, 10),
  ('tenant_address',    'Tenant Permanent Address','Parties',    'string',  'false', 0.82, 11),
  ('property_address',  'Property Address',      'Property',     'string',  'true',  0.95, 12),
  ('property_type',     'Property Type',         'Property',     'string',  'true',  0.91, 13),
  ('carpet_area',       'Carpet / Built-up Area','Property',     'string',  'false', 0.83, 14),
  ('furnishing_status', 'Furnishing Status',     'Property',     'string',  'false', 0.80, 15),
  ('lease_start_date',  'Lease Start Date',      'Terms',        'date',    'true',  0.97, 16),
  ('lease_end_date',    'Lease End Date',         'Terms',        'date',    'true',  0.97, 17),
  ('lease_duration',    'Lease Duration',        'Terms',        'string',  'true',  0.93, 18),
  ('lock_in_period',    'Lock-in Period',        'Terms',        'string',  'false', 0.83, 19),
  ('notice_period',     'Notice Period',         'Terms',        'string',  'false', 0.84, 20),
  ('renewal_clause',    'Renewal / Extension Clause','Terms',    'string',  'false', 0.78, 21),
  ('monthly_rent',      'Monthly Rent',          'Financial',    'currency','true',  0.98, 22),
  ('rent_escalation',   'Rent Escalation Pct',   'Financial',    'string',  'false', 0.82, 23),
  ('security_deposit',  'Security Deposit',      'Financial',    'currency','true',  0.96, 24),
  ('maintenance_charges','Maintenance Charges',  'Financial',    'currency','false', 0.83, 25),
  ('total_advance',     'Total Advance Paid',    'Financial',    'currency','false', 0.82, 26)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- INSURANCE POLICY
-- ────────────────────────────────────────────────────────────────────────────
with tpl as (
  select t.id from templates t
  join document_categories dc on dc.id = t.category_id
  where dc.code = 'insurance_policy' and t.scope = 'public' and t.organization_id is null
  limit 1
)
insert into template_fields
  (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select
  tpl.id,
  v.key, v.label, v.grp, v.dtype,
  v.enabled::boolean, v.conf::numeric, v.idx::int
from tpl
cross join (values
  ('policy_number',     'Policy Number',         'Identification','string',  'true',  0.99, 1),
  ('policy_type',       'Policy Type',           'Identification','string',  'true',  0.98, 2),
  ('policy_status',     'Policy Status',         'Identification','string',  'false', 0.87, 3),
  ('endorsement_number','Endorsement Number',    'Identification','string',  'false', 0.82, 4),
  ('insurer_name',      'Insurer Name',          'Insurer',      'string',  'true',  0.99, 5),
  ('insurer_uin',       'Insurer UIN / IRDA No', 'Insurer',      'string',  'false', 0.85, 6),
  ('agent_name',        'Agent / Broker Name',   'Insurer',      'string',  'false', 0.82, 7),
  ('agent_code',        'Agent Code',            'Insurer',      'string',  'false', 0.80, 8),
  ('insured_name',      'Insured Name',          'Insured',      'string',  'true',  0.99, 9),
  ('insured_dob',       'Date of Birth',         'Insured',      'date',    'false', 0.88, 10),
  ('insured_pan',       'PAN Number',            'Insured',      'string',  'false', 0.87, 11),
  ('insured_address',   'Insured Address',       'Insured',      'string',  'false', 0.84, 12),
  ('nominee_name',      'Nominee Name',          'Insured',      'string',  'false', 0.83, 13),
  ('policy_start_date', 'Policy Start Date',     'Coverage',     'date',    'true',  0.98, 14),
  ('policy_end_date',   'Policy End Date',       'Coverage',     'date',    'true',  0.98, 15),
  ('sum_insured',       'Sum Insured',           'Coverage',     'currency','true',  0.97, 16),
  ('coverage_type',     'Coverage Type',         'Coverage',     'string',  'true',  0.93, 17),
  ('deductible',        'Deductible / Excess',   'Coverage',     'currency','false', 0.83, 18),
  ('vehicle_number',    'Vehicle Registration No','Vehicle',     'string',  'false', 0.93, 19),
  ('vehicle_make_model','Vehicle Make and Model','Vehicle',      'string',  'false', 0.90, 20),
  ('chassis_number',    'Chassis Number',        'Vehicle',      'string',  'false', 0.87, 21),
  ('basic_premium',     'Basic Premium',         'Premium',      'currency','true',  0.96, 22),
  ('gst_on_premium',    'GST on Premium 18 Pct', 'Premium',      'currency','false', 0.88, 23),
  ('total_premium',     'Total Premium Paid',    'Premium',      'currency','true',  0.98, 24),
  ('payment_mode',      'Payment Mode',          'Premium',      'string',  'false', 0.85, 25),
  ('premium_due_date',  'Next Premium Due Date', 'Premium',      'date',    'false', 0.85, 26)
) as v(key, label, grp, dtype, enabled, conf, idx)
on conflict (template_id, key) do nothing;

-- ── Step 4: Refresh field_count for all public templates ─────────────────────
update templates t
set field_count = (
  select count(*) from template_fields tf where tf.template_id = t.id
)
where t.scope = 'public'
  and t.organization_id is null;

-- ============================================================================
-- SOURCE: 202606110001_admin_user_notes_restrictions.sql
-- ============================================================================
-- Superadmin user notes and safe restriction flags.

create table if not exists admin_user_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_user_notes_user_idx
  on admin_user_notes(user_id, created_at desc);

drop trigger if exists admin_user_notes_set_updated on admin_user_notes;
create trigger admin_user_notes_set_updated
  before update on admin_user_notes for each row execute function set_updated_at();

create table if not exists admin_user_restrictions (
  user_id          uuid primary key references profiles(id) on delete cascade,
  uploads_disabled boolean not null default false,
  api_restricted   boolean not null default false,
  reason           text,
  updated_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists admin_user_restrictions_flags_idx
  on admin_user_restrictions(uploads_disabled, api_restricted);

drop trigger if exists admin_user_restrictions_set_updated on admin_user_restrictions;
create trigger admin_user_restrictions_set_updated
  before update on admin_user_restrictions for each row execute function set_updated_at();

alter table admin_user_notes enable row level security;
alter table admin_user_restrictions enable row level security;

drop policy if exists admin_user_notes_superadmin_read on admin_user_notes;
create policy admin_user_notes_superadmin_read
  on admin_user_notes for select
  using (auth_user_is_super_admin());

drop policy if exists admin_user_notes_superadmin_write on admin_user_notes;
create policy admin_user_notes_superadmin_write
  on admin_user_notes for all
  using (auth_user_is_super_admin())
  with check (auth_user_is_super_admin());

drop policy if exists admin_user_restrictions_superadmin_read on admin_user_restrictions;
create policy admin_user_restrictions_superadmin_read
  on admin_user_restrictions for select
  using (auth_user_is_super_admin());

drop policy if exists admin_user_restrictions_superadmin_write on admin_user_restrictions;
create policy admin_user_restrictions_superadmin_write
  on admin_user_restrictions for all
  using (auth_user_is_super_admin())
  with check (auth_user_is_super_admin());

-- ============================================================================
-- SOURCE: 202606110002_set_superadmin.sql
-- ============================================================================
-- Set is_super_admin = true for the primary admin account.
-- Replace the email below with your actual super admin email if different.
update profiles
set is_super_admin = true
where email = 'priyamtagadiya@gmail.com';

-- ============================================================================
-- SOURCE: 202606290001_credit_storage_system.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Credit & Storage Billing System
-- Adds all infrastructure for the credit/storage based billing model:
--   - admin_settings  : key-value config store (pricing, feature flags, etc.)
--   - credit_grants   : audit trail for every admin credit/storage grant
--   - org columns     : purchased_credits, granted_credits, credits_used
--   - RPCs            : add_org_credits (upgraded), add_org_storage (new),
--                       admin_upsert_plan (new), deduct_org_credits (new),
--                       save_admin_settings (new)
--   - View            : org_credit_summary
-- ============================================================================

-- ── 1. admin_settings ────────────────────────────────────────────────────────
-- Global key-value config. Superadmin writes; anyone can read.
create table if not exists admin_settings (
  key        text        primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

create trigger admin_settings_set_updated
  before update on admin_settings
  for each row execute function set_updated_at();

-- Seed default credit pricing — skipped if key already exists
insert into admin_settings (key, value) values (
  'credit_pricing',
  '{"credit_price_inr":10,"credit_unit":1000,"storage_price_inr":50,"storage_unit_gb":1}'::jsonb
) on conflict (key) do nothing;

alter table admin_settings enable row level security;

create policy "admin_settings: public read"
  on admin_settings for select using (true);

create policy "admin_settings: superadmin write"
  on admin_settings for all
  using  (auth_user_is_super_admin())
  with check (auth_user_is_super_admin());

-- ── 2. credit_grants ─────────────────────────────────────────────────────────
-- Immutable audit trail for every credit or storage grant issued by superadmin.
create table if not exists credit_grants (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references organizations(id) on delete cascade,
  granted_by            uuid        references auth.users(id) on delete set null,
  grant_type            text        not null check (grant_type in ('credits', 'storage')),
  credits_granted       bigint,
  storage_bytes_granted bigint,
  note                  text,
  created_at            timestamptz not null default now()
);

create index credit_grants_org_idx     on credit_grants(organization_id);
create index credit_grants_created_idx on credit_grants(created_at desc);

alter table credit_grants enable row level security;

create policy "credit_grants: org members read own"
  on credit_grants for select
  using (
    auth_user_is_super_admin()
    or organization_id in (select auth_user_org_ids())
  );

create policy "credit_grants: superadmin insert"
  on credit_grants for insert
  with check (auth_user_is_super_admin());

-- ── 3. Extend organizations with credit-tracking columns ──────────────────────
-- purchased_credits : accumulated from à-la-carte purchases — never resets
-- granted_credits   : accumulated from superadmin grants — never resets
-- credits_used      : total consumed; reset to 0 each subscription cycle
alter table organizations
  add column if not exists purchased_credits bigint not null default 0,
  add column if not exists granted_credits   bigint not null default 0,
  add column if not exists credits_used      bigint not null default 0;

comment on column organizations.purchased_credits is 'Credits bought à-la-carte; accumulate indefinitely';
comment on column organizations.granted_credits   is 'Credits issued by superadmin; accumulate indefinitely';
comment on column organizations.credits_used      is 'Cumulative credits consumed this billing period';

-- ── 4. View: org_credit_summary ───────────────────────────────────────────────
-- Single source of truth for an org's available credits and storage headroom.
-- Used by the processing pipeline and the admin dashboard.
create or replace view org_credit_summary as
select
  o.id                                                          as organization_id,
  o.name                                                        as organization_name,
  coalesce(p.ai_token_limit, 0)                                 as plan_credits,
  o.purchased_credits,
  o.granted_credits,
  o.credits_used,
  greatest(0,
    coalesce(p.ai_token_limit, 0)
    + o.purchased_credits
    + o.granted_credits
    - o.credits_used
  )                                                             as credits_available,
  o.storage_limit_bytes,
  o.storage_used_bytes,
  greatest(0, o.storage_limit_bytes - o.storage_used_bytes)    as storage_available_bytes
from organizations o
left join subscriptions s
  on  s.organization_id = o.id
  and s.status in ('active', 'trialing')
left join plans p on p.id = s.plan_id;

-- ── 5. RPC: add_org_credits (upgraded) ───────────────────────────────────────
-- Superadmin-gated. Increments granted_credits and logs to credit_grants.
-- Replaces the earlier version that modified purchased_credits directly.
create or replace function add_org_credits(p_org_id uuid, p_credits bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not auth_user_is_super_admin() then
    raise exception 'Forbidden: superadmin only';
  end if;

  update organizations
  set granted_credits = granted_credits + p_credits,
      updated_at      = now()
  where id = p_org_id;

  if not found then
    raise exception 'Organization % not found', p_org_id;
  end if;

  insert into credit_grants (organization_id, granted_by, grant_type, credits_granted)
  values (p_org_id, auth.uid(), 'credits', p_credits);
end;
$$;

-- ── 6. RPC: add_org_storage ───────────────────────────────────────────────────
-- Superadmin-gated. Increases storage_limit_bytes and logs to credit_grants.
create or replace function add_org_storage(p_org_id uuid, p_bytes bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not auth_user_is_super_admin() then
    raise exception 'Forbidden: superadmin only';
  end if;

  update organizations
  set storage_limit_bytes = storage_limit_bytes + p_bytes,
      updated_at          = now()
  where id = p_org_id;

  if not found then
    raise exception 'Organization % not found', p_org_id;
  end if;

  insert into credit_grants (organization_id, granted_by, grant_type, storage_bytes_granted)
  values (p_org_id, auth.uid(), 'storage', p_bytes);
end;
$$;

-- ── 7. RPC: admin_upsert_plan ─────────────────────────────────────────────────
-- Superadmin-gated plan create/update. Only exposes the fields that matter in
-- the credit/storage model; zeros out legacy limits on update.
create or replace function admin_upsert_plan(
  p_id                  uuid,
  p_code                text,
  p_name                text,
  p_price_amount_inr    numeric,
  p_is_custom_price     boolean,
  p_interval            plan_interval,
  p_ai_token_limit      bigint,
  p_storage_limit_bytes bigint
) returns plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result plans;
begin
  if not auth_user_is_super_admin() then
    raise exception 'Forbidden: superadmin only';
  end if;

  if p_id is not null then
    update plans set
      code                = p_code,
      name                = p_name,
      price_amount_inr    = p_price_amount_inr,
      is_custom_price     = p_is_custom_price,
      interval            = p_interval,
      ai_token_limit      = p_ai_token_limit,
      storage_limit_bytes = p_storage_limit_bytes,
      -- zero-out fields not used in the credit/storage model
      page_limit          = null,
      ocr_limit           = null,
      api_rate_limit      = null,
      webhook_limit       = null,
      concurrency         = null,
      team_seats          = null,
      white_label         = false,
      dedicated_workers   = false,
      priority_queue      = false,
      sla_support         = false,
      audit_logs          = false,
      updated_at          = now()
    where id = p_id
    returning * into v_result;

    if not found then
      raise exception 'Plan % not found', p_id;
    end if;
  else
    insert into plans (
      code, name, price_amount_inr, is_custom_price, interval,
      ai_token_limit, storage_limit_bytes,
      status, version, sort_order,
      page_limit, ocr_limit, api_rate_limit, webhook_limit,
      concurrency, team_seats, white_label, dedicated_workers,
      priority_queue, sla_support, audit_logs
    ) values (
      p_code, p_name, p_price_amount_inr, p_is_custom_price, p_interval,
      p_ai_token_limit, p_storage_limit_bytes,
      'active', '2.0', 0,
      null, null, null, null,
      null, null, false, false,
      false, false, false
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

-- ── 8. RPC: deduct_org_credits ────────────────────────────────────────────────
-- Called by the processing pipeline before each job.
-- Priority: plan credits first → then purchased → then granted.
-- Returns TRUE on success, FALSE if balance is insufficient.
create or replace function deduct_org_credits(p_org_id uuid, p_credits bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available bigint;
begin
  select credits_available
  into   v_available
  from   org_credit_summary
  where  organization_id = p_org_id;

  if coalesce(v_available, 0) < p_credits then
    return false;
  end if;

  update organizations
  set credits_used = credits_used + p_credits,
      updated_at   = now()
  where id = p_org_id;

  return true;
end;
$$;

-- ── 9. RPC: save_admin_settings ───────────────────────────────────────────────
-- Superadmin-gated upsert for admin_settings. Stamps updated_by.
create or replace function save_admin_settings(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not auth_user_is_super_admin() then
    raise exception 'Forbidden: superadmin only';
  end if;

  insert into admin_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;

-- ── 10. RPC: reset_org_credits_used (billing cycle hook) ─────────────────────
-- Called by the billing webhook / cron at the start of each subscription period
-- to reset the used-credits counter while preserving purchased/granted credits.
create or replace function reset_org_credits_used(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow service-role calls (no auth.uid()) and superadmin calls
  if auth.uid() is not null and not auth_user_is_super_admin() then
    raise exception 'Forbidden';
  end if;

  update organizations
  set credits_used = 0,
      updated_at   = now()
  where id = p_org_id;
end;
$$;

-- ============================================================================
-- After applying: run `npm run types:sync` to regenerate src/lib/supabase/types.ts
-- ============================================================================

-- ============================================================================
-- SOURCE: 202607010001_razorpay_payg.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Razorpay Payment Gateway + Pay-As-You-Go Plan Type
-- ============================================================================

-- ── 1. plan_type column on plans ─────────────────────────────────────────────
alter table plans
  add column if not exists plan_type text not null default 'subscription'
  check (plan_type in ('subscription', 'pay_as_you_go'));

comment on column plans.plan_type is
  'subscription = fixed monthly/yearly plan; pay_as_you_go = no interval, per-unit billing';

-- ── 2. razorpay_orders — immutable order ledger ───────────────────────────────
create table if not exists razorpay_orders (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references organizations(id) on delete cascade,
  razorpay_order_id   text        not null unique,
  razorpay_payment_id text,
  order_type          text        not null
                        check (order_type in ('subscription', 'credits', 'storage')),
  plan_id             uuid        references plans(id) on delete set null,
  credits_amount      bigint,
  storage_bytes       bigint,
  amount_paise        bigint      not null,
  currency            text        not null default 'INR',
  status              text        not null default 'created'
                        check (status in ('created', 'paid', 'failed')),
  applied             boolean     not null default false,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists razorpay_orders_org_idx
  on razorpay_orders(organization_id);
create index if not exists razorpay_orders_rzp_idx
  on razorpay_orders(razorpay_order_id);
create index if not exists razorpay_orders_created_idx
  on razorpay_orders(created_at desc);

alter table razorpay_orders enable row level security;

create policy "razorpay_orders: org members read own"
  on razorpay_orders for select
  using (
    auth_user_is_super_admin()
    or organization_id in (select auth_user_org_ids())
  );

-- ── 3. Seed Razorpay config in admin_settings ─────────────────────────────────
-- Sensitive — key_secret/webhook_secret are only read server-side via service role.
-- Frontend only receives key_id through GET /api/payment/config.
insert into admin_settings (key, value) values (
  'razorpay_config',
  '{
    "key_id": "",
    "key_secret": "",
    "webhook_secret": "",
    "test_mode": true,
    "currency": "INR"
  }'::jsonb
) on conflict (key) do nothing;

-- ── 4. Update credit_pricing: add storage_unit_type ──────────────────────────
update admin_settings
set value = value || '{"storage_unit_type":"GB"}'::jsonb
where key = 'credit_pricing'
  and not (value ? 'storage_unit_type');

-- ── 5. RPC: apply_razorpay_order ─────────────────────────────────────────────
-- Called by the server after verifying Razorpay payment signature.
-- Idempotent — skips if order already applied.
create or replace function apply_razorpay_order(p_order_id uuid, p_payment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  razorpay_orders;
begin
  -- Lock the row to prevent double-application under concurrent requests
  select * into v_order
  from   razorpay_orders
  where  id = p_order_id
  for    update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  if v_order.applied then
    return;  -- idempotent
  end if;

  -- Mark paid + applied
  update razorpay_orders
  set razorpay_payment_id = p_payment_id,
      status              = 'paid',
      applied             = true,
      updated_at          = now()
  where id = p_order_id;

  -- Apply credits
  if v_order.order_type = 'credits' and v_order.credits_amount is not null then
    update organizations
    set purchased_credits = purchased_credits + v_order.credits_amount,
        updated_at        = now()
    where id = v_order.organization_id;

    insert into credit_grants (organization_id, grant_type, credits_granted, note)
    values (v_order.organization_id, 'credits', v_order.credits_amount,
            'Razorpay purchase: ' || p_payment_id);
  end if;

  -- Apply storage
  if v_order.order_type = 'storage' and v_order.storage_bytes is not null then
    update organizations
    set storage_limit_bytes = storage_limit_bytes + v_order.storage_bytes,
        updated_at          = now()
    where id = v_order.organization_id;

    insert into credit_grants (organization_id, grant_type, storage_bytes_granted, note)
    values (v_order.organization_id, 'storage', v_order.storage_bytes,
            'Razorpay purchase: ' || p_payment_id);
  end if;

  -- For subscription orders, the server creates/updates the subscription record directly
  -- (service role bypasses RLS). Nothing extra done here for subscriptions.
end;
$$;

-- ============================================================================
-- SOURCE: 202607010002_report_runs.sql
-- ============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- Report Runs — tracks every admin-generated report download
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key      text        NOT NULL,           -- matches REPORT_DEFS[].id in frontend
  report_name     text        NOT NULL,
  generated_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  date_from       date        NOT NULL,
  date_to         date        NOT NULL,
  row_count       int         NOT NULL DEFAULT 0,
  file_name       text,
  file_size_bytes bigint      NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'completed'
                              CHECK (status IN ('completed', 'failed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS report_runs_report_key_idx  ON report_runs (report_key);
CREATE INDEX IF NOT EXISTS report_runs_created_at_idx  ON report_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS report_runs_generated_by_idx ON report_runs (generated_by);

-- Row-Level Security
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;

-- Super-admins can read and write all runs
CREATE POLICY "super_admin_report_runs_all"
  ON report_runs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Report Templates — stores the 6 standard report definitions so they are
-- DB-managed (category, schedule, description) while generation logic stays
-- in the frontend.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text        NOT NULL UNIQUE,   -- matches REPORT_DEFS[].id
  name         text        NOT NULL,
  category     text        NOT NULL,
  schedule     text        NOT NULL DEFAULT 'Manual',
  description  text,
  is_active    boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_report_templates_all"
  ON report_templates FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  );

-- Seed the 6 standard templates
INSERT INTO report_templates (key, name, category, schedule, description, sort_order)
VALUES
  ('revenue',   'Monthly Revenue Recognition',    'Financial',        'Monthly (1st)',    'Transaction revenue data for accounting recognition',               1),
  ('sla',       'SLA Compliance Audit',           'Operations',       'Weekly',           'Processing job SLA compliance and duration metrics',                2),
  ('usage',     'Platform Usage Analytics',       'Product',          'Daily',            'Platform usage records broken down by organization and metric',     3),
  ('churn',     'Enterprise Customer Churn',      'Customer Success', 'Weekly',           'Cancelled and expired subscription tracking',                       4),
  ('accuracy',  'ExDoc Extraction Accuracy',      'Engineering',      'Monthly (15th)',   'ExDoc API extraction confidence scores and field accuracy rates',    5),
  ('retention', 'Data Retention Purge Log',       'Compliance',       'Daily',            'Audit log of all data-deletion actions for compliance reporting',   6)
ON CONFLICT (key) DO UPDATE
  SET name        = EXCLUDED.name,
      category    = EXCLUDED.category,
      schedule    = EXCLUDED.schedule,
      description = EXCLUDED.description,
      updated_at  = now();

-- ============================================================================
-- SOURCE: 202607020001_ticket_replies_fixes.sql
-- ============================================================================
-- ── Ticket replies: bump parent ticket, fix internal-note leak, ensure realtime ──

create or replace function bump_ticket_on_reply()
returns trigger language plpgsql as $$
begin
  update tickets set last_reply_at = new.created_at, updated_at = now()
  where id = new.ticket_id;
  return new;
end; $$;

create trigger ticket_replies_bump_parent
  after insert on ticket_replies
  for each row execute function bump_ticket_on_reply();

drop policy if exists ticket_replies_read on ticket_replies;
create policy ticket_replies_read on ticket_replies for select using (
  auth_user_is_super_admin()
  or (not is_internal and exists (
    select 1 from tickets t where t.id = ticket_replies.ticket_id
      and (t.requester_id = auth.uid()
           or (t.organization_id is not null and t.organization_id in (select auth_user_org_ids())))
  ))
  or (is_internal and exists (
    select 1 from tickets t where t.id = ticket_replies.ticket_id and t.assignee_id = auth.uid()
  ))
);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tickets') then
    execute 'alter publication supabase_realtime add table public.tickets';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ticket_replies') then
    execute 'alter publication supabase_realtime add table public.ticket_replies';
  end if;
end $$;

-- ============================================================================
-- SOURCE: 202607020003_org_management.sql
-- ============================================================================
-- ============================================================================
-- Organization management: email invitations, role safety rails, org lifecycle
-- ============================================================================
-- Adds:
--   1. organization_invitations table (token-based email invites) + RLS
--   2. Role helpers (auth_user_org_role, member_role_rank)
--   3. protect_org_members trigger — last-owner protection + role hierarchy
--   4. Self-leave RLS policy on organization_members
--   5. RPCs: create_organization, transfer_org_ownership, delete_organization,
--      my_pending_invitations
-- ============================================================================

-- ── 1. Invitation status enum + table ────────────────────────────────────────
do $$ begin
  create type invitation_status as enum ('pending','accepted','declined','revoked','expired');
exception when duplicate_object then null; end $$;

create table if not exists organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  email            citext not null,
  role             member_role not null default 'member',
  status           invitation_status not null default 'pending',
  -- SHA-256 hex of the raw invite token; the raw token only ever lives in the
  -- invite email link, so a DB leak cannot be replayed into an acceptance.
  token_hash       text not null unique,
  invited_by       uuid references profiles(id) on delete set null,
  expires_at       timestamptz not null default now() + interval '7 days',
  accepted_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint org_invitations_role_not_owner check (role <> 'owner')
);

-- One live invite per (org, email); resend updates the existing row.
create unique index if not exists org_invitations_pending_unique
  on organization_invitations(organization_id, email) where status = 'pending';
create index if not exists org_invitations_org_idx   on organization_invitations(organization_id, status);
create index if not exists org_invitations_email_idx on organization_invitations(email, status);

create trigger org_invitations_updated_at
  before update on organization_invitations for each row execute function set_updated_at();

alter table organization_invitations enable row level security;

-- Org admins manage invites; the invited person can see invites addressed to
-- their own (verified at signup) email so they can accept in-app.
create policy org_invitations_select on organization_invitations for select using (
  auth_user_is_super_admin()
  or auth_user_is_org_admin(organization_id)
  or email = (select p.email from profiles p where p.id = auth.uid())
);
create policy org_invitations_insert on organization_invitations for insert
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));
create policy org_invitations_update on organization_invitations for update
  using  (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id))
  with check (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));
create policy org_invitations_delete on organization_invitations for delete
  using (auth_user_is_super_admin() or auth_user_is_org_admin(organization_id));

-- ── 2. Role helpers ──────────────────────────────────────────────────────────
create or replace function member_role_rank(r member_role)
returns int language sql immutable as $$
  select case r
    when 'owner'  then 4
    when 'admin'  then 3
    when 'member' then 2
    when 'viewer' then 1
    else 0 end;
$$;

create or replace function auth_user_org_role(org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select role from organization_members
  where organization_id = org and user_id = auth.uid() and status = 'active'
  limit 1;
$$;

-- ── 3. Member-row safety trigger ─────────────────────────────────────────────
-- RLS says WHO may write to organization_members (org admins + self-delete).
-- This trigger says WHAT writes are legal, for everyone including admins:
--   * an org can never lose its last active owner (unless the org itself is
--     being deleted — during the cascade the parent row is already gone)
--   * only owners can grant/revoke the owner role or touch owner rows
--   * admins cannot modify other admins
--   * nobody can raise their own role
create or replace function protect_org_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role member_role;
  v_org        uuid;
  -- NEW is unassigned in DELETE triggers and OLD in INSERT triggers, so copy
  -- the fields we need into plain (nullable) locals up front.
  v_old_role   member_role;
  v_old_status member_status;
  v_old_user   uuid;
  v_old_id     uuid;
  v_new_role   member_role;
  v_new_status member_status;
  v_losing_owner boolean := false;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
  else
    v_org := new.organization_id;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    v_old_role   := old.role;
    v_old_status := old.status;
    v_old_user   := old.user_id;
    v_old_id     := old.id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_role   := new.role;
    v_new_status := new.status;
  end if;

  -- Last-active-owner protection (applies to every caller, incl. service role).
  if tg_op = 'DELETE' and v_old_role = 'owner' and v_old_status = 'active' then
    v_losing_owner := true;
  elsif tg_op = 'UPDATE' and v_old_role = 'owner' and v_old_status = 'active'
        and (v_new_role <> 'owner' or v_new_status <> 'active') then
    v_losing_owner := true;
  end if;

  -- When the parent organization row is already gone we are inside the
  -- ON DELETE CASCADE of delete_organization(); let every row go.
  if not exists (select 1 from organizations o where o.id = v_org) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_losing_owner and not exists (
    select 1 from organization_members m
    where m.organization_id = v_org
      and m.role = 'owner' and m.status = 'active' and m.id <> v_old_id
  ) then
    raise exception 'cannot_remove_last_owner';
  end if;

  -- Service role (auth.uid() is null) and super admins skip hierarchy checks.
  if v_actor is null
     or coalesce((select is_super_admin from profiles where id = v_actor), false)
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Anyone may delete their own membership row (leave the workspace).
  if tg_op = 'DELETE' and v_old_user = v_actor then
    return old;
  end if;

  v_actor_role := auth_user_org_role(v_org);
  if v_actor_role is null then
    raise exception 'not_an_active_member';
  end if;

  -- Only owners may grant or revoke the owner role, or modify owner rows.
  if v_old_role = 'owner' or v_new_role = 'owner' then
    if v_actor_role <> 'owner' then
      raise exception 'only_owners_can_manage_owners';
    end if;
  end if;

  -- Admins cannot modify other admins.
  if v_actor_role = 'admin' and v_old_role = 'admin' and v_old_user <> v_actor then
    raise exception 'admins_cannot_modify_admins';
  end if;

  -- Nobody may raise their own role.
  if tg_op = 'UPDATE' and v_old_user = v_actor
     and member_role_rank(v_new_role) > member_role_rank(v_old_role)
  then
    raise exception 'cannot_raise_own_role';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists protect_org_members_trigger on organization_members;
create trigger protect_org_members_trigger
  before insert or update or delete on organization_members
  for each row execute function protect_org_members();

-- ── 4. Self-leave policy ─────────────────────────────────────────────────────
-- Existing delete policy only covers org admins; members must be able to
-- remove their own row (the trigger still blocks the last owner from leaving).
do $$ begin
  create policy org_members_self_delete on organization_members
    for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── 5a. Create an additional organization ────────────────────────────────────
-- Same atomic flow as create_first_organization but without the
-- "already_has_organization" guard, so existing users can open new workspaces.
create or replace function public.create_organization(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid            uuid := auth.uid();
  v_base_slug      citext;
  v_candidate_slug citext;
  v_org            public.organizations;
  v_attempt        int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'name_too_short'; end if;
  if (select count(*) from public.organization_members
      where user_id = v_uid and status = 'active') >= 20 then
    raise exception 'organization_limit_reached';
  end if;
  v_base_slug := lower(regexp_replace(trim(coalesce(p_slug, p_name)), '[^a-z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug::text, '^-|-$', '', 'g');
  if length(v_base_slug::text) < 2 then v_base_slug := 'org'; end if;
  v_base_slug := left(v_base_slug::text, 48);
  loop
    begin
      v_candidate_slug := case when v_attempt = 0 then v_base_slug
        else left(v_base_slug::text, 48 - length(('-' || v_attempt)::text)) || '-' || v_attempt end;
      insert into public.organizations (name, slug, status)
        values (trim(p_name), v_candidate_slug, 'trial') returning * into v_org;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 99 then raise exception 'slug_conflict_unresolvable'; end if;
    end;
  end loop;
  insert into public.organization_members (organization_id, user_id, role, status, joined_at)
    values (v_org.id, v_uid, 'owner', 'active', now());
  update public.profiles set current_org_id = v_org.id where id = v_uid;
  return to_jsonb(v_org);
end; $$;
revoke all on function public.create_organization(text, text) from public;
revoke all on function public.create_organization(text, text) from anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ── 5b. Transfer ownership ───────────────────────────────────────────────────
-- Promote first, demote second, so the last-owner guard always passes.
create or replace function public.transfer_org_ownership(p_org uuid, p_new_owner_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if auth_user_org_role(p_org) is distinct from 'owner' then
    raise exception 'only_owner_can_transfer';
  end if;
  if p_new_owner_user = v_uid then raise exception 'already_owner'; end if;
  if not exists (
    select 1 from organization_members
    where organization_id = p_org and user_id = p_new_owner_user and status = 'active'
  ) then
    raise exception 'target_not_active_member';
  end if;
  update organization_members set role = 'owner'
    where organization_id = p_org and user_id = p_new_owner_user;
  update organization_members set role = 'admin'
    where organization_id = p_org and user_id = v_uid;
end; $$;
revoke all on function public.transfer_org_ownership(uuid, uuid) from public;
revoke all on function public.transfer_org_ownership(uuid, uuid) from anon;
grant execute on function public.transfer_org_ownership(uuid, uuid) to authenticated;

-- ── 5c. Delete organization (owner only) ─────────────────────────────────────
-- Cascades wipe members, invitations, documents, etc.
-- profiles.current_org_id is ON DELETE SET NULL so no profile blocks the drop.
create or replace function public.delete_organization(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if auth_user_org_role(p_org) is distinct from 'owner' then
    raise exception 'only_owner_can_delete';
  end if;
  delete from organizations where id = p_org;
end; $$;
revoke all on function public.delete_organization(uuid) from public;
revoke all on function public.delete_organization(uuid) from anon;
grant execute on function public.delete_organization(uuid) to authenticated;

-- ── 5d. Invitations addressed to me ──────────────────────────────────────────
-- Security definer so the invited user can see the org name + inviter name
-- before they are a member (RLS would hide both tables from them).
create or replace function public.my_pending_invitations()
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  email             text,
  role              member_role,
  invited_by_name   text,
  expires_at        timestamptz,
  created_at        timestamptz
) language sql stable security definer set search_path = public as $$
  select i.id, i.organization_id, o.name, o.slug::text, i.email::text, i.role,
         coalesce(nullif(trim(coalesce(p.full_name, '')), ''), p.email::text),
         i.expires_at, i.created_at
  from organization_invitations i
  join organizations o on o.id = i.organization_id
  left join profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and i.email = (select email from profiles where id = auth.uid())
  order by i.created_at desc;
$$;
revoke all on function public.my_pending_invitations() from public;
revoke all on function public.my_pending_invitations() from anon;
grant execute on function public.my_pending_invitations() to authenticated;

-- ============================================================================
-- SOURCE: 202607020004_fix_org_member_self_insert.sql
-- ============================================================================
-- ============================================================================
-- Fix: protect_org_members() rejected the founding owner row on org creation.
-- ============================================================================
-- The trigger required the actor to already hold an active membership in the
-- target org before allowing ANY insert. That's correct for admins adding
-- other people, but it also blocked create_organization/create_first_organization
-- from inserting the creator's own first (owner) row, since no membership row
-- exists yet at BEFORE INSERT time -- auth_user_org_role() returned null and
-- the trigger raised not_an_active_member, aborting org creation entirely.
--
-- Safe to allow: RLS (org_members_write) already restricts direct inserts to
-- existing org admins, and a brand-new org has none yet -- so the only way to
-- reach this insert with new.user_id = auth.uid() and no prior membership is
-- through the SECURITY DEFINER RPCs, which already enforce the real
-- authorization (org just created by this transaction, 20-org cap, etc).
create or replace function protect_org_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role member_role;
  v_org        uuid;
  v_old_role   member_role;
  v_old_status member_status;
  v_old_user   uuid;
  v_old_id     uuid;
  v_new_role   member_role;
  v_new_status member_status;
  v_losing_owner boolean := false;
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
  else
    v_org := new.organization_id;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    v_old_role   := old.role;
    v_old_status := old.status;
    v_old_user   := old.user_id;
    v_old_id     := old.id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_role   := new.role;
    v_new_status := new.status;
  end if;

  if tg_op = 'DELETE' and v_old_role = 'owner' and v_old_status = 'active' then
    v_losing_owner := true;
  elsif tg_op = 'UPDATE' and v_old_role = 'owner' and v_old_status = 'active'
        and (v_new_role <> 'owner' or v_new_status <> 'active') then
    v_losing_owner := true;
  end if;

  if not exists (select 1 from organizations o where o.id = v_org) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_losing_owner and not exists (
    select 1 from organization_members m
    where m.organization_id = v_org
      and m.role = 'owner' and m.status = 'active' and m.id <> v_old_id
  ) then
    raise exception 'cannot_remove_last_owner';
  end if;

  if v_actor is null
     or coalesce((select is_super_admin from profiles where id = v_actor), false)
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- Anyone may delete their own membership row (leave the workspace).
  if tg_op = 'DELETE' and v_old_user = v_actor then
    return old;
  end if;

  -- Anyone may insert their own membership row. RLS (org_members_write)
  -- already blocks any caller who isn't an org admin from reaching a raw
  -- insert, and a brand-new org has no admins yet -- so this only ever
  -- fires from the trusted create_organization/create_first_organization
  -- (and future invite-acceptance) RPCs, which own the real authorization.
  if tg_op = 'INSERT' and new.user_id = v_actor then
    return new;
  end if;

  v_actor_role := auth_user_org_role(v_org);
  if v_actor_role is null then
    raise exception 'not_an_active_member';
  end if;

  if v_old_role = 'owner' or v_new_role = 'owner' then
    if v_actor_role <> 'owner' then
      raise exception 'only_owners_can_manage_owners';
    end if;
  end if;

  if v_actor_role = 'admin' and v_old_role = 'admin' and v_old_user <> v_actor then
    raise exception 'admins_cannot_modify_admins';
  end if;

  if tg_op = 'UPDATE' and v_old_user = v_actor
     and member_role_rank(v_new_role) > member_role_rank(v_old_role)
  then
    raise exception 'cannot_raise_own_role';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

-- ============================================================================
-- SOURCE: 202607020005_section_permissions.sql
-- ============================================================================
-- ============================================================================
-- Per-user, per-section access overrides (view/edit/none) on top of roles.
-- ============================================================================
-- Sections: billing, support, history, process, templates, data_entries.
-- Role still sets the default access per section (resolved client-side in
-- src/lib/permissions.ts); this column lets an owner/admin override any one
-- section for any non-owner member without changing their overall role.
-- Owners are never restrictable -- the client always resolves them to "edit"
-- regardless of this column's contents, same as the existing role hierarchy.
--
-- Writes go through the existing org_members_update RLS policy (caller must
-- be an org admin/owner) plus protect_org_members_trigger, which already
-- blocks non-owners from touching an owner's row and admins from touching
-- other admins' rows -- both apply generically to any column, including this
-- one, so no new RPC or trigger logic is needed.
alter table organization_members
  add column if not exists section_access jsonb not null default '{}'::jsonb;

comment on column organization_members.section_access is
  'Per-section overrides: {"billing"|"support"|"history"|"process"|"templates"|"data_entries": "none"|"view"|"edit"}. Missing keys fall back to the role default (see src/lib/permissions.ts). Ignored entirely for role = owner.';

-- ============================================================================
-- SOURCE: 202607020006_contact_submissions.sql
-- ============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- Contact Form Submissions — public "Contact us" page on the marketing site
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  phone       text        NOT NULL,
  company     text,
  email       text        NOT NULL,
  message     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'contacted', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx ON contact_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_submissions_status_idx ON contact_submissions (status);

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

-- The public contact form submits without auth — anyone may insert.
CREATE POLICY contact_submissions_public_insert
  ON contact_submissions FOR INSERT
  WITH CHECK (true);

-- Only super-admins can read or manage submissions.
CREATE POLICY contact_submissions_super_admin_all
  ON contact_submissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  );

-- ============================================================================
-- SOURCE: 202607020007_contact_submissions_rls_fix.sql
-- ============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: public contact form inserts were rejected with 42501 (RLS violation).
-- Re-create the policies explicitly scoped to roles and add defensive grants,
-- since the anon role needs both a table grant and a matching RLS policy.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS contact_submissions_public_insert ON contact_submissions;
DROP POLICY IF EXISTS contact_submissions_super_admin_all ON contact_submissions;

GRANT USAGE ON SCHEMA public TO anon;
GRANT INSERT ON contact_submissions TO anon;
GRANT ALL ON contact_submissions TO authenticated;

CREATE POLICY contact_submissions_public_insert
  ON contact_submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY contact_submissions_super_admin_all
  ON contact_submissions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_super_admin = true
    )
  );

-- ============================================================================
-- SOURCE: 202607030001_mfa_email_and_challenge.sql
-- ============================================================================
-- =============================================================================
-- MFA: email-based OTP + login challenge handles
-- =============================================================================
-- Extends the existing TOTP-only MFA (totp_factors) with:
--   - profiles.two_factor_method : which method is active for a user
--   - mfa_email_codes            : one-time email OTP codes (enroll + login)
--   - mfa_challenges             : short-lived handle issued at login when the
--                                  password is correct but a second factor is
--                                  still required. Exchanged for real tokens by
--                                  /api/auth/mfa/challenge/verify.
--
-- All rows are written/read only by the auth API using the service-role key,
-- which bypasses RLS. RLS is enabled with no policies so anon/authenticated
-- clients cannot read codes or challenge handles.
-- =============================================================================

-- ── 1. Active method on the profile ──────────────────────────────────────────
alter table profiles
  add column if not exists two_factor_method text
    check (two_factor_method in ('totp', 'email'));

-- ── 2. Email OTP codes ───────────────────────────────────────────────────────
create table if not exists mfa_email_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  code_enc    text not null,                 -- AES-GCM encrypted 6-digit code
  purpose     text not null check (purpose in ('enroll', 'login')),
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists mfa_email_codes_user_idx on mfa_email_codes(user_id);

alter table mfa_email_codes enable row level security;

-- ── 3. Login challenge handles ───────────────────────────────────────────────
create table if not exists mfa_challenges (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,          -- sha256 of the raw handle
  user_id     uuid not null references profiles(id) on delete cascade,
  method      text not null check (method in ('totp', 'email')),
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists mfa_challenges_user_idx on mfa_challenges(user_id);

alter table mfa_challenges enable row level security;

-- ============================================================================
-- SOURCE: 202607030002_ensure_custom_auth_tables.sql
-- ============================================================================
-- =============================================================================
-- Ensure custom-auth tables exist
-- =============================================================================
-- This database is missing `refresh_tokens` and `totp_factors` (both defined in
-- the base schema) even though `profiles.password_hash` and the rest of the
-- schema are present — the base migration's custom-auth section never landed
-- here. Their absence breaks token refresh (401s) and MFA enrollment
-- ("Failed to create MFA factor" — the totp_factors insert 404s).
--
-- Recreated idempotently, matching the base schema definitions verbatim so this
-- is a no-op on databases where they already exist.
-- =============================================================================

-- ── refresh_tokens (service-role only) ───────────────────────────────────────
create table if not exists refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  token_hash   text not null unique,
  device       text,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists refresh_tokens_user_active_idx
  on refresh_tokens(user_id) where revoked_at is null;
create index if not exists refresh_tokens_hash_idx on refresh_tokens(token_hash);

alter table refresh_tokens enable row level security;
drop policy if exists refresh_tokens_deny on refresh_tokens;
create policy refresh_tokens_deny on refresh_tokens for all using (false);

-- ── totp_factors (self-managed via API service role) ─────────────────────────
create table if not exists totp_factors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  secret        text not null,
  friendly_name text,
  verified      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists totp_factors_user_idx on totp_factors(user_id);

alter table totp_factors enable row level security;
drop policy if exists totp_factors_self on totp_factors;
create policy totp_factors_self on totp_factors for all
  using (user_id = auth.uid() or auth_user_is_super_admin());

-- ============================================================================
-- SOURCE: 202607030003_free_plan_signup_grant.sql
-- ============================================================================
-- ============================================================================
-- BillSOS · Free Plan & First-Signup Grant
-- ----------------------------------------------------------------------------
-- Every user gets a configurable free allotment of credits + storage the first
-- time they create a workspace (their first sign-up). The allotment is managed
-- by superadmin from Admin → Plans → "Free Plan Limits" and stored as a single
-- source of truth in admin_settings.free_plan.
--
--   admin_settings.free_plan = {
--     "enabled":       true,
--     "name":          "Free",
--     "description":   "...",
--     "credits":       50,
--     "storage_bytes": 104857600   -- 100 MB
--   }
--
-- Applied atomically inside create_first_organization() so the very first
-- workspace is provisioned with the free limits and an audit row is written to
-- credit_grants. Additional workspaces (create_organization) are NOT re-granted,
-- so the bonus can't be farmed by opening extra orgs.
-- ============================================================================

-- ── 1. Seed the default free-plan config (never overwrites an admin edit) ─────
insert into admin_settings (key, value) values (
  'free_plan',
  jsonb_build_object(
    'enabled',       true,
    'name',          'Free',
    'description',   'Everything you need to get started — no card required.',
    'credits',       50,
    'storage_bytes', 104857600      -- 100 MB
  )
) on conflict (key) do nothing;

-- ── 2. Grant helper — apply the free plan to a freshly created org ────────────
-- SECURITY DEFINER so it can read admin_settings, bump the org's limits and
-- write the audit row regardless of the caller's RLS context. Idempotent-safe:
-- callers only invoke it once, at first-org creation.
create or replace function public.apply_free_plan_grant(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg     jsonb;
  v_enabled boolean;
  v_credits bigint;
  v_storage bigint;
begin
  select value into v_cfg from admin_settings where key = 'free_plan';
  if v_cfg is null then
    return; -- no config → leave org on its column defaults
  end if;

  v_enabled := coalesce((v_cfg->>'enabled')::boolean, false);
  if not v_enabled then
    return; -- free plan switched off by superadmin
  end if;

  v_credits := greatest(0, coalesce((v_cfg->>'credits')::bigint, 0));
  v_storage := nullif(v_cfg->>'storage_bytes', '')::bigint;

  update organizations
  set granted_credits     = granted_credits + v_credits,
      -- override the column default (500 MB) with the configured free limit
      storage_limit_bytes  = coalesce(v_storage, storage_limit_bytes),
      updated_at           = now()
  where id = p_org_id;

  if v_credits > 0 then
    insert into credit_grants (organization_id, granted_by, grant_type, credits_granted, note)
    values (p_org_id, auth.uid(), 'credits', v_credits, 'Free plan signup grant');
  end if;

  if v_storage is not null then
    insert into credit_grants (organization_id, granted_by, grant_type, storage_bytes_granted, note)
    values (p_org_id, auth.uid(), 'storage', v_storage, 'Free plan signup grant');
  end if;
end;
$$;

-- ── 3. Redefine create_first_organization to apply the free plan ──────────────
-- Identical to the original (schema.sql) plus the apply_free_plan_grant() call.
create or replace function public.create_first_organization(p_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid            uuid := auth.uid();
  v_base_slug      citext;
  v_candidate_slug citext;
  v_org            public.organizations;
  v_attempt        int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.organization_members where user_id = v_uid and status = 'active') then
    raise exception 'already_has_organization';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'name_too_short'; end if;
  v_base_slug := lower(regexp_replace(trim(coalesce(p_slug, p_name)), '[^a-z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug::text, '^-|-$', '', 'g');
  if length(v_base_slug::text) < 2 then v_base_slug := 'org'; end if;
  v_base_slug := left(v_base_slug::text, 48);
  loop
    begin
      v_candidate_slug := case when v_attempt = 0 then v_base_slug
        else left(v_base_slug::text, 48 - length(('-' || v_attempt)::text)) || '-' || v_attempt end;
      insert into public.organizations (name, slug, status) values (trim(p_name), v_candidate_slug, 'trial') returning * into v_org;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 99 then raise exception 'slug_conflict_unresolvable'; end if;
    end;
  end loop;
  insert into public.organization_members (organization_id, user_id, role, status, joined_at) values (v_org.id, v_uid, 'owner', 'active', now());
  update public.profiles set current_org_id = v_org.id where id = v_uid;

  -- First workspace → provision the configurable free-plan allotment.
  perform public.apply_free_plan_grant(v_org.id);

  -- Return the org with the freshly applied limits.
  select * into v_org from public.organizations where id = v_org.id;
  return to_jsonb(v_org);
end; $$;
revoke all on function public.create_first_organization(text, text) from public;
revoke all on function public.create_first_organization(text, text) from anon;
grant execute on function public.create_first_organization(text, text) to authenticated;

-- ============================================================================
-- After applying: run `npm run types:sync` to regenerate src/lib/supabase/types.ts
-- (adds apply_free_plan_grant to the Database["public"]["Functions"] map).
-- ============================================================================


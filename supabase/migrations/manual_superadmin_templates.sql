create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists country text,
  add column if not exists current_org_id uuid references public.organizations(id) on delete set null,
  add column if not exists status text not null default 'active',
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists credits_remaining bigint not null default 0,
  add column if not exists password_hash text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists email_verify_token text,
  add column if not exists email_verify_expires timestamptz,
  add column if not exists pwd_reset_token text,
  add column if not exists pwd_reset_expires timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists password_changed_at timestamptz;

do $admin$
declare
  v_email text := 'priyamtagadiya@gmail.com';
  v_user_id uuid;
  v_org_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  v_user_id := coalesce(v_user_id, gen_random_uuid());

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Priyam","last_name":"Tagadiya"}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

  insert into public.organizations (
    id, name, slug, country, status, storage_limit_bytes,
    team_size, metadata, last_activity_at
  )
  values (
    gen_random_uuid(),
    'BillSOS Super Admin',
    'billsos-super-admin',
    'IN',
    'active',
    10737418240,
    1,
    '{"source":"manual_superadmin_setup"}'::jsonb,
    now()
  )
  on conflict (slug) do update set
    status = 'active',
    updated_at = now(),
    last_activity_at = now()
  returning id into v_org_id;

  insert into public.profiles (
    id, email, first_name, last_name, country, current_org_id,
    status, is_super_admin, credits_remaining, password_hash,
    email_verified, metadata, password_changed_at
  )
  values (
    v_user_id,
    v_email,
    'Priyam',
    'Tagadiya',
    'IN',
    v_org_id,
    'active',
    true,
    1000000,
    'pbkdf2$210000$f53a6b944a01961e80476709d7167730$65630034d18d2f98ba10b6e6e15689b383c3fa3ab00b5ed5917a8eb062ef42ee',
    true,
    '{"source":"manual_superadmin_setup"}'::jsonb,
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    country = excluded.country,
    current_org_id = excluded.current_org_id,
    status = 'active',
    is_super_admin = true,
    credits_remaining = greatest(coalesce(public.profiles.credits_remaining, 0), 1000000),
    password_hash = excluded.password_hash,
    email_verified = true,
    metadata = public.profiles.metadata || excluded.metadata,
    updated_at = now(),
    password_changed_at = now();

  insert into public.organization_members (
    organization_id, user_id, role, status, team, joined_at
  )
  values (
    v_org_id, v_user_id, 'owner', 'active', 'Admin', now()
  )
  on conflict (organization_id, user_id) do update set
    role = 'owner',
    status = 'active',
    team = 'Admin',
    updated_at = now();
end
$admin$;

select
  p.email,
  p.is_super_admin,
  p.status,
  o.name as organization,
  m.role
from public.profiles p
left join public.organizations o on o.id = p.current_org_id
left join public.organization_members m
  on m.user_id = p.id and m.organization_id = o.id
where lower(p.email::text) = lower('priyamtagadiya@gmail.com');

-- ============================================================================
-- BillSOS seed-data cleanup
-- Keeps live user and organization records only.
--
-- Preserved when present:
--   - public.organizations
--   - public.profiles
--   - public.organization_members
--   - public.oauth_accounts
--   - public.totp_factors
--
-- Cleared:
--   - all other public tables, including seeded plans/templates/documents/jobs,
--     billing demo rows, integrations, vendor APIs, workers, notifications,
--     tickets, reports, metrics, audit/security demo rows, etc.
--
-- This script is schema-adaptive: it restores only columns that exist in the
-- current database, so it works across older/newer BillSOS schemas.
-- Run from Supabase SQL Editor or psql as database owner/service role.
-- ============================================================================

begin;

create temp table _keep_organizations as
select * from public.organizations;

create temp table _keep_profiles as
select * from public.profiles;

create temp table _keep_organization_members as
select * from public.organization_members;

do $$
begin
  if to_regclass('public.oauth_accounts') is not null then
    execute 'create temp table _keep_oauth_accounts as select * from public.oauth_accounts';
  end if;

  if to_regclass('public.totp_factors') is not null then
    execute 'create temp table _keep_totp_factors as select * from public.totp_factors';
  end if;
end $$;

do $$
declare
  table_list text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into table_list
  from pg_tables
  where schemaname = 'public'
    and tablename not like 'pg_%'
    and tablename not like 'sql_%';

  if table_list is null then
    raise exception 'No public tables found.';
  end if;

  execute 'truncate table ' || table_list || ' restart identity cascade';
end $$;

do $$
declare
  cols text;
  exprs text;
begin
  select
    string_agg(format('%I', column_name), ', ' order by ordinal_position),
    string_agg(
      case column_name
        when 'plan_id' then 'null::uuid as plan_id'
        when 'storage_used_bytes' then '0::bigint as storage_used_bytes'
        when 'pages_processed' then '0::bigint as pages_processed'
        when 'last_activity_at' then 'null::timestamptz as last_activity_at'
        else format('%I', column_name)
      end,
      ', ' order by ordinal_position
    )
    into cols, exprs
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'organizations'
    and is_generated = 'NEVER';

  execute format(
    'insert into public.organizations (%s) select %s from _keep_organizations',
    cols,
    exprs
  );
end $$;

do $$
declare
  cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and is_generated = 'NEVER';

  execute format(
    'insert into public.profiles (%s) select %s from _keep_profiles',
    cols,
    cols
  );
end $$;

do $$
declare
  cols text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'organization_members'
    and is_generated = 'NEVER';

  execute format(
    'insert into public.organization_members (%s) select %s from _keep_organization_members',
    cols,
    cols
  );
end $$;

do $$
declare
  cols text;
begin
  if to_regclass('public.oauth_accounts') is not null and to_regclass('pg_temp._keep_oauth_accounts') is not null then
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into cols
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'oauth_accounts'
      and is_generated = 'NEVER';

    execute format(
      'insert into public.oauth_accounts (%s) select %s from _keep_oauth_accounts',
      cols,
      cols
    );
  end if;
end $$;

do $$
declare
  cols text;
begin
  if to_regclass('public.totp_factors') is not null and to_regclass('pg_temp._keep_totp_factors') is not null then
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into cols
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'totp_factors'
      and is_generated = 'NEVER';

    execute format(
      'insert into public.totp_factors (%s) select %s from _keep_totp_factors',
      cols,
      cols
    );
  end if;
end $$;

do $$
declare
  has_member_status boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organization_members'
      and column_name = 'status'
  )
  into has_member_status;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'organizations'
      and column_name = 'team_size'
  ) then
    if has_member_status then
      update public.organizations o
      set team_size = greatest(1, members.member_count)
      from (
        select organization_id, count(*)::int as member_count
        from public.organization_members
        where status = 'active'
        group by organization_id
      ) members
      where members.organization_id = o.id;

      update public.organizations
      set team_size = 1
      where id not in (
        select organization_id
        from public.organization_members
        where status = 'active'
      );
    else
      update public.organizations o
      set team_size = greatest(1, members.member_count)
      from (
        select organization_id, count(*)::int as member_count
        from public.organization_members
        group by organization_id
      ) members
      where members.organization_id = o.id;

      update public.organizations
      set team_size = 1
      where id not in (
        select organization_id
        from public.organization_members
      );
    end if;
  end if;
end $$;

select
  (select count(*) from public.organizations) as kept_organizations,
  (select count(*) from public.profiles) as kept_profiles,
  (select count(*) from public.organization_members) as kept_memberships;

commit;

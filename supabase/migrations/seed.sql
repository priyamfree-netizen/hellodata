-- ============================================================================
-- BillSOS · Development Seed Data
-- Populates orgs, demo users, templates, processing jobs, and history so the
-- frontend has realistic data when running against a local Supabase instance.
--
-- This file is consumed by `supabase db reset` (NOT applied automatically by
-- `supabase db push`). Do not run in production.
-- ============================================================================

-- Create three demo orgs
with new_orgs as (
  insert into organizations (id, name, slug, country, status, sso_enabled, storage_limit_bytes, storage_used_bytes, pages_processed, team_size, departments)
  values
    ('11111111-1111-1111-1111-111111111111', 'Acme Finance Pvt Ltd',  'acme',      'India', 'active', false, 53687091200,  4509715660, 12481,  18, array['Finance','Tax','Audit']),
    ('22222222-2222-2222-2222-222222222222', 'Northwind Industries',  'northwind', 'India', 'active', true,  1099511627776,512000000000,248000, 84, array['Procurement','Finance','Operations']),
    ('33333333-3333-3333-3333-333333333333', 'Helios Energy',         'helios',    'India', 'trial',  false, 10737418240,  84510000,    420,    4,  array['Finance'])
  on conflict (id) do nothing
  returning id
)
update organizations
   set plan_id = (select id from plans where code = case
     when slug = 'acme'      then 'pro'
     when slug = 'northwind' then 'enterprise'
     else 'starter' end)
 where slug in ('acme','northwind','helios');

-- Create a default subscription per org
insert into subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
select o.id, o.plan_id, 'active', now() - interval '15 days', now() + interval '15 days'
  from organizations o
 where o.plan_id is not null
   and not exists (select 1 from subscriptions s where s.organization_id = o.id);

-- Sample payment method for Acme
insert into payment_methods (organization_id, type, brand, last4, exp_month, exp_year, is_default)
values ('11111111-1111-1111-1111-111111111111', 'card', 'Visa', '4242', 12, 2028, true)
on conflict do nothing;

-- Sample transactions / invoices for Acme (Pro @ ₹4,999)
do $$
declare
  org uuid := '11111111-1111-1111-1111-111111111111';
  plan_pro uuid := (select id from plans where code = 'pro');
  i int;
  tx_id uuid;
begin
  for i in 0..5 loop
    insert into transactions (organization_id, plan_id, amount_inr, currency, status, method, created_at)
    values (org, plan_pro, 4999, 'INR', 'succeeded', 'card', now() - (i * interval '30 days'))
    returning id into tx_id;

    insert into invoices (number, organization_id, transaction_id, amount_inr, status,
                          issue_date, due_date, paid_at)
    values (
      'INV-2026-' || lpad((100 - i)::text, 3, '0'),
      org, tx_id, 4999, 'paid',
      (now() - (i * interval '30 days'))::date,
      (now() - (i * interval '30 days') + interval '7 days')::date,
      now() - (i * interval '30 days')
    );
  end loop;
end$$;

-- Sample templates (one per common category) for Acme
insert into templates (id, name, description, category_id, organization_id, status, scope, is_featured, rating, downloads, version)
select
  gen_random_uuid(),
  case dc.code
    when 'invoice'        then 'GST-ready invoice (Pro)'
    when 'bank_statement' then 'HDFC bank statement'
    when 'gst_return'     then 'GSTR-2B reconciliation'
    when 'salary_slip'    then 'Payroll slip — Indian PF'
    when 'purchase_order' then 'Vendor PO with line items'
    when 'tds_certificate' then 'Form 16 — Part A & B'
    else dc.name end,
  dc.description,
  dc.id,
  '11111111-1111-1111-1111-111111111111',
  'published',
  case when dc.code in ('invoice','bank_statement') then 'org'::template_scope else 'team'::template_scope end,
  dc.code = 'invoice',
  4.6,
  case dc.code
    when 'invoice'        then 12480
    when 'bank_statement' then 8021
    when 'gst_return'     then 4210
    when 'salary_slip'    then 3104
    when 'purchase_order' then 2987
    when 'tds_certificate' then 2410
    else 100 end,
  '3.2'
from document_categories dc
where dc.code in ('invoice','bank_statement','gst_return','salary_slip','purchase_order','tds_certificate')
  and not exists (
    select 1 from templates t
    where t.organization_id = '11111111-1111-1111-1111-111111111111'
      and t.category_id = dc.id
  );

-- Default fields for the Invoice template
insert into template_fields (template_id, key, label, field_group, data_type, is_enabled, default_confidence, sort_order)
select t.id, f.key, f.label, f.grp, f.dtype, f.enabled, f.conf, f.idx
from templates t
cross join (values
  ('invoice_number','Invoice Number','Identification','string', true,  0.99, 1),
  ('invoice_date',  'Invoice Date',  'Identification','date',   true,  0.98, 2),
  ('po_reference',  'PO Reference',  'Identification','string', false, 0.87, 3),
  ('vendor_name',   'Vendor Name',   'Parties',       'string', true,  0.99, 4),
  ('vendor_gstin',  'Vendor GSTIN',  'Parties',       'string', true,  0.97, 5),
  ('buyer_name',    'Buyer Name',    'Parties',       'string', true,  0.96, 6),
  ('buyer_gstin',   'Buyer GSTIN',   'Parties',       'string', true,  0.95, 7),
  ('line_items',    'Line Items',    'Items',         'array',  true,  0.94, 8),
  ('quantity',      'Quantity',      'Items',         'number', true,  0.92, 9),
  ('unit_price',    'Unit Price',    'Items',         'currency',true, 0.93, 10),
  ('hsn_code',      'HSN Code',      'Items',         'string', false, 0.88, 11),
  ('subtotal',      'Subtotal',      'Totals',        'currency',true, 0.99, 12),
  ('tax_amount',    'Tax Amount',    'Totals',        'currency',true, 0.98, 13),
  ('total_amount',  'Total Amount',  'Totals',        'currency',true, 0.99, 14),
  ('due_date',      'Due Date',      'Totals',        'date',   true,  0.91, 15)
) as f(key,label,grp,dtype,enabled,conf,idx)
where t.organization_id = '11111111-1111-1111-1111-111111111111'
  and t.name = 'GST-ready invoice (Pro)'
  and not exists (
    select 1 from template_fields tf where tf.template_id = t.id and tf.key = f.key
  );

-- 0081_document_requirements.sql - the document vault, part 2c: the "7 de 9" checklist
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 5;
--  docs/superpowers/plans/2026-10-16-document-vault-pr2c.md)
--
-- An account lists the documents every customer must have (accounts.required_document_categories;
-- empty = the checklist is off). A customer for whom one does not apply is skipped for it
-- (document_requirement_skips): one ACTIVE skip per contact and category; an un-skip stamps the row
-- (unskipped_at, unskipped_by) instead of deleting it, so the skip and the un-skip each keep their
-- timeline row (plan deviation 1). Server-written only; members read skips under the contact's
-- visibility. Other is never required (owner ruling D8): anything filed as Other would meet it.
-- One read, public.document_requirements, answers each required category's state for one customer:
-- met (a live document of that category, on the customer or on a household or business they belong
-- to, with a ready CLEAN version, not expired on p_today in the account's own zone), checking (none
-- met, but one has a ready version still pending its scan), expired (none met, one clean but past
-- its date), missing, or skipped. SECURITY DEFINER because the answer is the CUSTOMER's (owner
-- ruling D7): an Owners-only file meets the requirement for Staff too. It answers states only, never
-- a file, a title or an id, and re-checks both fences itself: the caller is the agency or a member of
-- the account's organisation (0078's guard), and can see the contact (0068: Owner, Staff and the
-- agency see every customer; a Technician only those assigned to them). Every guard coalesces:
-- app.is_agency() is NULL for a client token, and a NULL in an IF would fall through, open.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads none of it.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.unskip_document_requirement(uuid, uuid, text);
--   drop function public.document_requirements(uuid, uuid, date);
--   drop table public.document_requirement_skips;
--   alter table public.accounts drop constraint accounts_required_document_categories_check,
--     drop column required_document_categories;
--   drop function app.required_document_categories_ok(text[]);
--   Lost: every account's list and every skip.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on accounts (adding the column and its CHECK
--    takes ACCESS EXCLUSIVE briefly; a queued one blocks every later reader).
set local lock_timeout = '5s';

-- 1. The list. One-dimensional, no NULL, each one of the eight requirable keys, no duplicate. The
--    CASE keeps array_position away from a 2-D array (it raises on one) and makes the order explicit.
create function app.required_document_categories_ok(p_categories text[]) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_categories is null then false
    when coalesce(array_ndims(p_categories), 1) <> 1 then false
    else coalesce(
      array_position(p_categories, null) is null
      and p_categories <@ array['id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty']::text[]
      and cardinality(p_categories) = (select count(distinct x) from unnest(p_categories) as x),
      false)
  end
$$;
revoke all on function app.required_document_categories_ok(text[]) from public, anon;
grant execute on function app.required_document_categories_ok(text[]) to authenticated, service_role;

-- No grant on the column (0031's rule): accounts is edited per column by clients, and this one is
-- written only by the save action, through the service client, after its own role check.
alter table public.accounts add column required_document_categories text[] not null default '{}'
  constraint accounts_required_document_categories_check
  check (app.required_document_categories_ok(required_document_categories));
comment on column public.accounts.required_document_categories is
  'The documents every customer must have (0081). Empty = the Documents card shows no checklist. Service-client write only.';

-- 2. Skips. Server-written only; members read under the contact's visibility.
create table public.document_requirement_skips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null,
  category text not null constraint document_requirement_skips_category_check
    check (category in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty')),
  skipped_by text not null constraint document_requirement_skips_skipped_by_check check (btrim(skipped_by) <> ''),
  created_at timestamptz not null default now(),
  unskipped_at timestamptz,
  unskipped_by text constraint document_requirement_skips_unskipped_by_check check (unskipped_by is null or btrim(unskipped_by) <> ''),
  constraint document_requirement_skips_unskip_coherent check ((unskipped_at is null) = (unskipped_by is null)),
  constraint document_requirement_skips_unskip_after check (unskipped_at is null or unskipped_at > created_at),
  constraint document_requirement_skips_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
create unique index document_requirement_skips_active on public.document_requirement_skips (account_id, contact_id, category)
  where unskipped_at is null;
create index document_requirement_skips_by_contact on public.document_requirement_skips (account_id, contact_id);
comment on table public.document_requirement_skips is
  'A required document a customer does not need (0081). Active while unskipped_at is null. Server-written only; authenticated reads under the contact''s visibility.';

alter table public.document_requirement_skips enable row level security;
revoke all on public.document_requirement_skips from anon, authenticated;
grant select on public.document_requirement_skips to authenticated;
grant select, insert, update, delete on public.document_requirement_skips to service_role;
create policy document_requirement_skips_member_read on public.document_requirement_skips for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_requirement_skips_technician_scope on public.document_requirement_skips as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));

-- 3. The read. One row per required category, in the account's stored order.
create function public.document_requirements(p_account_id uuid, p_contact_id uuid, p_today date)
returns table (category text, state text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_account_id is null or p_contact_id is null or p_today is null then
    raise exception 'document_requirements: a required argument is null' using errcode = '22004';
  end if;
  if not (coalesce(app.is_agency(), false) or coalesce(p_account_id = app.current_account_id(), false)) then
    raise exception 'document_requirements: not this account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.contacts c
     where c.account_id = p_account_id and c.id = p_contact_id
       and (coalesce(app.sees_all_customers(p_account_id), false) or c.id in (select app.my_contact_ids()))) then
    raise exception 'document_requirements: not this contact' using errcode = '42501';
  end if;
  return query
  with req as (
    select r.cat, r.ord
      from public.accounts a
     cross join lateral unnest(a.required_document_categories) with ordinality as r(cat, ord)
     where a.id = p_account_id
  ),
  held as (
    select d.id, d.category as cat, d.expires_on
      from public.documents d
     where d.account_id = p_account_id and d.deleted_at is null
       and (d.contact_id = p_contact_id
            or d.client_group_id in (select m.client_group_id from public.client_group_members m
                                       where m.account_id = p_account_id and m.contact_id = p_contact_id))
  ),
  st as (
    select h.cat,
           coalesce(bool_or(cl.ok and (h.expires_on is null or h.expires_on >= p_today)), false) as met,
           coalesce(bool_or(cl.ok), false) as has_clean,
           coalesce(bool_or(pe.ok), false) as checking
      from held h
      left join lateral (select true as ok from public.document_versions v
                          where v.document_id = h.id and v.account_id = p_account_id
                            and v.status = 'ready' and v.scan_status = 'clean' limit 1) cl on true
      left join lateral (select true as ok from public.document_versions v
                          where v.document_id = h.id and v.account_id = p_account_id
                            and v.status = 'ready' and v.scan_status = 'pending' limit 1) pe on true
     group by h.cat
  )
  select req.cat,
         case
           when exists (select 1 from public.document_requirement_skips k
                         where k.account_id = p_account_id and k.contact_id = p_contact_id
                           and k.category = req.cat and k.unskipped_at is null) then 'skipped'
           when coalesce(st.met, false) then 'met'
           when coalesce(st.checking, false) then 'checking'
           when coalesce(st.has_clean, false) then 'expired'
           else 'missing'
         end
    from req left join st on st.cat = req.cat
   order by req.ord;
end $$;
revoke all on function public.document_requirements(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.document_requirements(uuid, uuid, date) to authenticated;

-- 4. The un-skip, on the DATABASE's clock (plan review M6): the skip's created_at is the column's
--    default now(), so the un-skip writes now() too, and unskip_after can never be tripped by an app
--    server's clock. Compare-and-set from active; answers the stored instant, or NULL when nothing changed
--    (another account's row, or already un-skipped). Plain (invoker), service_role only: the action has
--    already proved the row on the request client.
create function public.unskip_document_requirement(p_account_id uuid, p_skip_id uuid, p_actor text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare v_at timestamptz;
begin
  if p_account_id is null or p_skip_id is null or p_actor is null then
    raise exception 'unskip_document_requirement: a required argument is null' using errcode = '22004';
  end if;
  update public.document_requirement_skips
     set unskipped_at = now(), unskipped_by = p_actor
   where id = p_skip_id and account_id = p_account_id and unskipped_at is null
  returning unskipped_at into v_at;
  return v_at;
end $$;
revoke all on function public.unskip_document_requirement(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.unskip_document_requirement(uuid, uuid, text) to service_role;

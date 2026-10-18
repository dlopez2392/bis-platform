-- 0087_record_summaries.sql - the customer record's AI summary (first release item 8, part 8a-2)
-- (docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md section 4.5;
--  docs/superpowers/plans/2026-10-18-ai-record-summary-pr8a2.md)
--
-- One row per customer per language: the paragraph the record page shows under its facts line, the
-- digest of the inputs it was written from (the app compares it on open: a different digest means the
-- paragraph is stale), and a 30-second lease so one reader writes while every other reader waits.
-- The app writes it through the service role only, after the route proved the customer on the
-- reader's own client. The client role reads a row exactly when it can read the customer (the
-- restrictive policy's subquery runs under contacts' own policies, 0068's Technician fence included)
-- and writes nothing. claim_record_summary (service_role only) creates the row if missing, locks it,
-- and answers busy (a live lease), fresh (not forced and the digest is unchanged), too_soon (forced,
-- the digest unchanged, within a minute of the last such forced claim) or won with a new lease_id the
-- save must match. A changed digest is never too_soon. The cool-down is per row, so per language.
-- The daily cap is NOT here: 0086's ai_ledger_record already counts successful record_summary rows
-- per account day, and ai_gate_check already returns the count. This migration does not touch 0086.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads
-- none of it. The build after it needs it (the record page's AI part fails to its error state
-- without it): the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.claim_record_summary(uuid, uuid, text, text, boolean);
--   drop table public.record_summaries;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on contacts (the foreign key).
set local lock_timeout = '5s';

-- 1. The cache.
create table public.record_summaries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null,
  language text not null constraint record_summaries_language_check check (language in ('en', 'es')),
  body text constraint record_summaries_body_check check (char_length(body) between 1 and 2000),
  input_digest text constraint record_summaries_digest_check
    check (char_length(input_digest) = 64 and input_digest !~ '[^0-9a-f]'),
  model text constraint record_summaries_model_check check (char_length(model) between 1 and 64),
  generated_at timestamptz,
  generating_until timestamptz,
  lease_id uuid,
  last_forced_at timestamptz,
  created_at timestamptz not null default now(),
  constraint record_summaries_written_coherent check (
    (body is null) = (input_digest is null) and (body is null) = (model is null) and (body is null) = (generated_at is null)),
  constraint record_summaries_lease_coherent check ((lease_id is null) = (generating_until is null)),
  constraint record_summaries_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint record_summaries_one_per_language unique (account_id, contact_id, language)
);
comment on table public.record_summaries is
  'The record page''s AI paragraph, one per customer per language (0087). Server-written only; '
  'authenticated reads a row exactly when it reads the customer. Never a prompt.';

-- 2. Who reads: a member of the account (or the agency), and only for a customer they can read.
--    Who writes: service_role only. A new table gets Supabase's default ALL: revoke it first.
alter table public.record_summaries enable row level security;
revoke all on public.record_summaries from anon, authenticated;
grant select on public.record_summaries to authenticated;
grant select, insert, update, delete on public.record_summaries to service_role;
create policy record_summaries_member_read on public.record_summaries for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
-- A row is visible exactly when its customer is: the subquery runs under contacts' own policies.
create policy record_summaries_through_contact on public.record_summaries as restrictive for select to authenticated
  using (contact_id in (select c.id from public.contacts c));

-- 3. The claim. The row lock (for update) is the one serialisation point: concurrent claims queue,
--    and every claim after the winner sees its lease.
create function public.claim_record_summary(
  p_account uuid, p_contact uuid, p_language text, p_digest text, p_force boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.record_summaries%rowtype; v_lease uuid; v_same boolean;
begin
  if p_account is null or p_contact is null or p_language is null or p_digest is null or p_force is null then
    raise exception 'claim_record_summary: a required argument is null' using errcode = '22004';
  end if;
  if p_language not in ('en', 'es') then
    raise exception 'claim_record_summary: p_language is not en or es' using errcode = '22023';
  end if;
  if char_length(p_digest) <> 64 or p_digest ~ '[^0-9a-f]' then
    raise exception 'claim_record_summary: p_digest is not a sha256 hex digest' using errcode = '22023';
  end if;
  insert into public.record_summaries (account_id, contact_id, language) values (p_account, p_contact, p_language)
    on conflict (account_id, contact_id, language) do nothing;
  select * into v from public.record_summaries s
    where s.account_id = p_account and s.contact_id = p_contact and s.language = p_language
    for update;
  if v.generating_until is not null and v.generating_until > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  -- A changed digest is stale whether or not the reader pressed Regenerate: it is never too_soon, and
  -- it does not start the cool-down (plan fix I6). Only a forced claim on an UNCHANGED digest is limited.
  v_same := v.body is not null and v.input_digest = p_digest;
  if p_force and v_same then
    if v.last_forced_at is not null and v.last_forced_at > now() - interval '60 seconds' then
      return jsonb_build_object('status', 'too_soon');
    end if;
  elsif v_same then
    return jsonb_build_object('status', 'fresh');
  end if;
  v_lease := gen_random_uuid();
  update public.record_summaries s
    set generating_until = now() + interval '30 seconds', lease_id = v_lease,
        last_forced_at = case when p_force and v_same then now() else s.last_forced_at end
    where s.id = v.id;
  return jsonb_build_object('status', 'won', 'lease_id', v_lease);
end $$;
revoke all on function public.claim_record_summary(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.claim_record_summary(uuid, uuid, text, text, boolean) to service_role;

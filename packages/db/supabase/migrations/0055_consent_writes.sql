-- 0055_consent_writes.sql
-- Consent chain PR-2 (docs/superpowers/specs/2026-09-26-consent-chain-design.md
-- sections 3 and 4.2; plan docs/superpowers/plans/2026-09-28-consent-pr2-keywords-holds-controls.md).
--
-- ADDITIVE ONLY. The build before this file runs unchanged against it: it
-- never calls the new function, never writes the new tasks column, and its
-- one ledger writer (the gate's carrier_block) writes no source_ref, which the
-- new unique index ignores. So production takes this file BEFORE the merge
-- deploy, and the build after it can rely on it from its first request.
--
-- 1. public.append_consent_event: the ledger's ONE write path from PR-2 on.
--    Under a per-address advisory lock it reads the address's newest deciding
--    row, applies the caller's guard, spec section 3's two rules (a
--    hold_released only while held; a held only while allowed, or as a staff
--    undo of a hold's resolution) and choice 19's staff rules (below), and
--    inserts with occurred_at = clock_timestamp() taken AFTER the lock. The
--    newest row is ordered as consentStateOf orders it in
--    packages/db/src/consent.ts: occurred_at to the MILLISECOND (the precision
--    of JavaScript's Date.parse), then the more restrictive action, then the
--    larger id, so the function and the reducer never disagree. Two writes to
--    one address inside the same millisecond therefore tie on time and the
--    more restrictive reads as newest (a stop written 0.4 ms before a START
--    still stands): that errs toward sending less, on purpose.
--    Choice 19 (staff can lift only a stop staff made), enforced here and not
--    only in the app: a staff 'revoked' lands only on an allowed address; a
--    confirmed free-text stop ('revoked' / 'free_text') only on a hold; a
--    staff Resume ('resubscribed' / 'staff') only over a stop whose method is
--    staff, free_text or backfill_0049; a staff undo of a stop
--    ('resubscribed' / 'staff_undo') only over a staff stop. Without these a
--    caller who knows the id of a customer's own STOP could stop over it and
--    then undo its own stop (plan review R3-C1).
--    The guard unless_customer_stopped refuses only while the newest deciding
--    row is the customer's OWN stop (keyword, carrier_block, backfill_telnyx,
--    unsubscribe_link, one_click): a customer's STOP over a staff stop is
--    recorded, so only the customer can lift it (danlo, 2026-09-28).
--    SECURITY INVOKER: it writes with its caller's own grants, and EXECUTE is
--    service_role's alone (0054 gives service_role SELECT and INSERT on the
--    ledger; no role holds UPDATE or DELETE). A retried write from the same
--    source (a webhook's message id, a form submission, a booking, a backfill
--    row) answers 'duplicate' with the first row's id and writes nothing.
-- 2. consent_events_source_once: one row per address, action and source. A
--    source_ref names ONE delivery or event (a message id, a form submission,
--    a booking, one Telnyx opt-out at its own time), never a reusable channel
--    such as a token or an address: a reused source would read as a retry
--    forever, and a second real stop from it would be dropped as 'duplicate'.
-- 3. consent_events_account_id_id_key and tasks.consent_event_id: a To-do
--    names the hold or stop it asks about, same-account by construction
--    (0050's composite pattern), one To-do per ledger row.
--
-- tasks keeps its table-level grants (authenticated INSERT, UPDATE, DELETE;
-- schema-grants-guard.test.ts pins them), so the new column is
-- client-writable like every other tasks column. The composite key means a
-- client can only link its own account's task to its own account's ledger
-- row, and nothing trusts the link: the To-do's buttons re-read the ledger and
-- act through this function.
--
-- No backslash anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first; the build after this file calls the function):
--   drop function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz);
--   drop index public.tasks_consent_event_once;
--   alter table public.tasks drop column consent_event_id;
--   alter table public.consent_events drop constraint consent_events_account_id_id_key;
--   drop index public.consent_events_source_once;

set local lock_timeout = '5s';

create unique index consent_events_source_once
  on public.consent_events (account_id, channel, address, action, source_ref)
  where source_ref is not null;

alter table public.consent_events
  add constraint consent_events_account_id_id_key unique (account_id, id);

alter table public.tasks add column consent_event_id uuid;
alter table public.tasks add constraint tasks_consent_event_fkey
  foreign key (account_id, consent_event_id) references public.consent_events (account_id, id)
  on delete set null (consent_event_id);
create unique index tasks_consent_event_once
  on public.tasks (consent_event_id) where consent_event_id is not null;

comment on column public.tasks.consent_event_id is
  'The consent_events row this To-do asks about (a free-text hold to confirm, or a CANCEL stop whose appointment to check). One To-do per row. Written by the inbound SMS route as the service role.';

create function public.append_consent_event(
  p_account_id uuid, p_channel text, p_address text, p_action text, p_method text,
  p_guard text, p_expect_id uuid,
  p_contact_id uuid, p_actor_id text, p_note text, p_source_ref text,
  p_evidence jsonb, p_occurred_at timestamptz
)
returns table (outcome text, event_id uuid, prior_id uuid, prior_action text, prior_method text, prior_evidence jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior_id uuid;
  v_prior_action text;
  v_prior_method text;
  v_prior_evidence jsonb;
  v_dup uuid;
  v_ok boolean;
  v_id uuid;
begin
  if p_guard is null or p_guard not in ('none', 'if_empty', 'unless_customer_stopped', 'if_allowed', 'if_stopped_or_held', 'if_newest') then
    raise exception 'append_consent_event: unknown guard %', coalesce(p_guard, 'null') using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text || '|' || p_channel || '|' || p_address, 0));

  if p_source_ref is not null then
    select e.id into v_dup
      from public.consent_events e
     where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address
       and e.action = p_action and e.source_ref = p_source_ref;
    if v_dup is not null then
      return query select 'duplicate'::text, v_dup, null::uuid, null::text, null::text, null::jsonb;
      return;
    end if;
  end if;

  select e.id, e.action, e.method, e.evidence
    into v_prior_id, v_prior_action, v_prior_method, v_prior_evidence
    from public.consent_events e
   where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address
     and e.action in ('revoked', 'held', 'hold_released', 'resubscribed')
   order by pg_catalog.date_trunc('milliseconds', e.occurred_at) desc,
            case e.action when 'revoked' then 3 when 'held' then 2 else 1 end desc,
            e.id desc
   limit 1;

  v_ok := case p_guard
    when 'none' then true
    when 'if_empty' then not exists (
      select 1 from public.consent_events e
       where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address)
    when 'unless_customer_stopped' then v_prior_action is distinct from 'revoked'
      or v_prior_method not in ('keyword', 'carrier_block', 'backfill_telnyx', 'unsubscribe_link', 'one_click')
    when 'if_allowed' then v_prior_action is null or v_prior_action in ('hold_released', 'resubscribed')
    when 'if_stopped_or_held' then v_prior_action in ('revoked', 'held')
    when 'if_newest' then v_prior_id is not distinct from p_expect_id
  end;

  if p_action = 'hold_released' then
    v_ok := v_ok and v_prior_action = 'held';
  elsif p_action = 'held' then
    v_ok := v_ok and (
      v_prior_action is null
      or v_prior_action in ('hold_released', 'resubscribed')
      or (p_method = 'staff_undo' and p_guard = 'if_newest'
          and ((v_prior_action = 'revoked' and v_prior_method = 'free_text') or v_prior_action = 'hold_released')));
  elsif p_action = 'revoked' and p_method = 'staff' then
    v_ok := v_ok and (v_prior_action is null or v_prior_action in ('hold_released', 'resubscribed'));
  elsif p_action = 'revoked' and p_method = 'free_text' then
    v_ok := v_ok and v_prior_action = 'held';
  elsif p_action = 'resubscribed' and p_method = 'staff' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'free_text', 'backfill_0049');
  elsif p_action = 'resubscribed' and p_method = 'staff_undo' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method = 'staff';
  end if;

  -- coalesce is load-bearing: `v_prior_action in (...)` is NULL, not false,
  -- when the address has no deciding row, and `if not NULL` is not taken
  -- (memory bis-plpgsql-null-guard).
  if not coalesce(v_ok, false) then
    return query select 'refused'::text, null::uuid, v_prior_id, v_prior_action, v_prior_method, v_prior_evidence;
    return;
  end if;

  insert into public.consent_events
    (account_id, channel, address, action, method, contact_id, actor_id, note, source_ref, evidence, occurred_at)
  values
    (p_account_id, p_channel, p_address, p_action, p_method, p_contact_id, p_actor_id, p_note, p_source_ref,
     coalesce(p_evidence, '{}'::jsonb), coalesce(p_occurred_at, pg_catalog.clock_timestamp()))
  returning id into v_id;

  return query select 'appended'::text, v_id, v_prior_id, v_prior_action, v_prior_method, v_prior_evidence;
end;
$$;

comment on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz) is
  'The consent ledger''s one write path (0055). Per-address advisory lock; guard none, if_empty, unless_customer_stopped (refused only over the customer''s own stop), if_allowed, if_stopped_or_held or if_newest (p_expect_id: the newest deciding row the caller saw, null for none); hold_released only while held; held only while allowed or as a staff undo; staff stop only while allowed, confirmed free-text stop only while held, staff Resume only over a staff-made stop, staff undo only over a staff stop (choice 19). A source_ref names one delivery or event, never a reusable channel. Answers appended, duplicate (same address, action and source_ref) or refused, with the prior newest deciding row. Called only from packages/db/src/consent.ts.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
revoke all on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  to service_role;

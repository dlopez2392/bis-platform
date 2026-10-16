-- 0082_inbound_email.sql - inbound email, part 1: customers' replies come back
-- (docs/superpowers/specs/2026-10-16-inbound-email-design.md "Data model";
--  docs/superpowers/plans/2026-10-16-inbound-email.md)
--
-- A customer thread gets one opaque reply token (24 lowercase hex characters, made by the app), the
-- local part of the Reply-To the email gate writes once the account's Replies mode is not off. Mail
-- to r-<token>@<reply domain> arrives through Resend's email.received event and is kept in
-- inbound_emails: filed (on the thread, as a messages row), held (waiting in the inbox's Needs a look)
-- or dismissed (not a customer). Server-written only (0053); members read their account's rows, and a
-- Technician only their own customers' (0068), through the conversation.
-- consent_events.method gains inbound_email (a clear stop in a reply, applied at once). A staff Undo of
-- it is a resubscribed / staff_undo row, which 0055 allowed only over a staff stop: the function is
-- re-created with exactly that one line widened (plan G2).
-- unfile_inbound_email is the Undo of a manual "File": the row back to held and its message deleted,
-- in one transaction.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Safe for the build before it: it reads
-- none of the new columns, and the widened CHECK and function accept everything they accepted.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.unfile_inbound_email(uuid, uuid, uuid);
--   re-run 0055's create function body for public.append_consent_event as create or replace (the
--     one line back to v_prior_method = 'staff');
--   delete nothing from consent_events: an inbound_email row is legal evidence. If any exist, keep the
--     widened CHECK; with none: drop consent_events_inbound_email_shape_check, then re-add 0062's
--     consent_events_method_check exactly.
--   drop table public.inbound_emails;
--   alter table public.accounts drop constraint accounts_inbound_domain_required,
--     drop constraint accounts_inbound_domain_check, drop constraint accounts_inbound_mode_check,
--     drop column inbound_domain, drop column inbound_mode;
--   drop index public.conversations_reply_token_key;
--   alter table public.conversations drop constraint conversations_account_id_id_key,
--     drop constraint conversations_reply_token_revoked_check, drop constraint conversations_reply_token_check,
--     drop column reply_token_revoked_at, drop column reply_token;
--   Lost: every reply token (mail to an old r- address is then dropped) and every inbound row.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (each ALTER takes ACCESS EXCLUSIVE briefly).
set local lock_timeout = '5s';

-- 1. The reply token. One per conversation, unique across every account (the webhook arrives with
--    only the token). (account_id, id) is unique so inbound_emails can carry the account in its FK.
alter table public.conversations
  add column reply_token text,
  add column reply_token_revoked_at timestamptz,
  add constraint conversations_reply_token_check check (reply_token is null or reply_token ~ '^[0-9a-f]{24}$'),
  add constraint conversations_reply_token_revoked_check check (reply_token_revoked_at is null or reply_token is not null),
  add constraint conversations_account_id_id_key unique (account_id, id);
create unique index conversations_reply_token_key on public.conversations (reply_token) where reply_token is not null;
-- No grant: conversations is server-written (0053).

-- 2. The account's Replies mode. Agency-only (0015's rule): no grant to authenticated.
alter table public.accounts
  add column inbound_mode text not null default 'off',
  add column inbound_domain text,
  add constraint accounts_inbound_mode_check check (inbound_mode in ('off', 'bis', 'own_domain')),
  add constraint accounts_inbound_domain_check check (
    inbound_domain is null
    or (inbound_domain = lower(inbound_domain)
        and char_length(inbound_domain) <= 253
        and inbound_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
        and inbound_domain <> 'reply.bis-rgv.com')),
  add constraint accounts_inbound_domain_required check (inbound_mode <> 'own_domain' or inbound_domain is not null);
create unique index accounts_inbound_domain_key on public.accounts (inbound_domain) where inbound_domain is not null;

-- 3. inbound_emails.
create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null,
  provider_email_id text not null,
  from_email text not null,
  from_name text,
  to_email text not null,
  subject text,
  text text not null default '',
  auth jsonb not null default '{}'::jsonb,
  attachment_count integer not null default 0,
  status text not null,
  hold_reason text,
  message_id uuid references public.messages(id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint inbound_emails_conversation_fkey foreign key (account_id, conversation_id)
    references public.conversations (account_id, id) on delete cascade,
  constraint inbound_emails_provider_email_id_key unique (provider_email_id),
  constraint inbound_emails_status_check check (status in ('filed', 'held', 'dismissed')),
  constraint inbound_emails_hold_reason_check check (hold_reason is null or hold_reason in ('not_on_record', 'unverified')),
  constraint inbound_emails_held_has_reason check (status <> 'held' or hold_reason is not null),
  constraint inbound_emails_text_length check (char_length(text) <= 100000),
  constraint inbound_emails_attachment_count_check check (attachment_count >= 0),
  constraint inbound_emails_decided_coherent check ((decided_by is null) = (decided_at is null))
);
create index inbound_emails_held on public.inbound_emails (account_id, received_at desc) where status = 'held';
create index inbound_emails_by_conversation on public.inbound_emails (account_id, conversation_id);
comment on table public.inbound_emails is
  'An inbound reply through Resend''s email.received webhook (0082). filed: on the thread, as a messages row. held: waiting in the inbox''s Needs a look (hold_reason not_on_record or unverified). dismissed: not a customer. Server-written only; members read their account''s rows, a Technician only through conversation_id (0068''s shape).';

alter table public.inbound_emails enable row level security;
create policy inbound_emails_member_read on public.inbound_emails for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy inbound_emails_technician_scope on public.inbound_emails as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or conversation_id in (select v.id from public.conversations v where v.contact_id in (select app.my_contact_ids())));
revoke all on public.inbound_emails from anon, authenticated;
grant select on public.inbound_emails to authenticated;
grant select, insert, update, delete on public.inbound_emails to service_role;

-- 4. The method.
alter table public.consent_events drop constraint consent_events_method_check;
alter table public.consent_events add constraint consent_events_method_check
  check (method in (
    'keyword', 'start_keyword', 'free_text', 'staff', 'staff_undo', 'carrier_block',
    'unsubscribe_link', 'one_click', 'unsubscribe_page', 'form', 'booking', 'inbound_text',
    'backfill_0049', 'backfill_telnyx',
    'email_bounce', 'email_complaint',
    'inbound_email'));
alter table public.consent_events add constraint consent_events_inbound_email_shape_check
  check (method <> 'inbound_email' or (channel = 'email' and action = 'revoked'));
comment on constraint consent_events_inbound_email_shape_check on public.consent_events is
  'inbound_email (0082): a clear stop keyword in a customer''s reply, applied at once. Email stops only.';

-- 5. append_consent_event: 0055's body, one line widened (see the file header).
create or replace function public.append_consent_event(
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

  -- m2 (review, F3): a future p_occurred_at RAISES rather than answering
  -- 'refused', so a bad backfill fails loudly instead of silently skipping an
  -- opt-out the caller believed it recorded. This refuses ANY time after
  -- clock_timestamp(), not merely one beyond 0054's own
  -- consent_events_occurred_at_sane CHECK (that CHECK allows up to
  -- created_at + 5 minutes of clock skew, which is exactly why this rule
  -- exists: a stop dated now+4 minutes would pass THAT check yet still
  -- outrank a real START that lands a minute from now, review m2, B11).
  -- Only a backfill supplies this argument, and it always writes a past
  -- time.
  if p_occurred_at is not null and p_occurred_at > pg_catalog.clock_timestamp() then
    raise exception 'append_consent_event: p_occurred_at is in the future' using errcode = '22023';
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
  elsif p_action = 'revoked' and p_method = 'backfill_0049' then
    -- m1 (review, B1): a one-time historical backfill must never land OVER an
    -- existing stop (staff's or the customer's) merely because a caller
    -- passed guard 'none' by mistake; it gets the same "allowed address
    -- only" rule as a staff stop, whatever the guard.
    v_ok := v_ok and (v_prior_action is null or v_prior_action in ('hold_released', 'resubscribed'));
  elsif p_action = 'revoked' and p_method = 'free_text' then
    v_ok := v_ok and v_prior_action = 'held';
  elsif p_action = 'resubscribed' and p_method = 'staff' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'free_text', 'backfill_0049');
  elsif p_action = 'resubscribed' and p_method = 'staff_undo' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'inbound_email');
  elsif p_action = 'resubscribed' and p_method not in ('start_keyword', 'unsubscribe_page') then
    -- m1 (review, B2; review R1-N10 already named this gap): a resubscribed
    -- row is written for exactly four methods - start_keyword (a customer's
    -- own START), staff and staff_undo (both gated above by their own
    -- rules), and unsubscribe_page (reserved for PR-3's one-click email
    -- resubscribe, choice 28). Reaching this branch means p_method is none
    -- of staff/staff_undo (both matched by the elsifs above) and not
    -- start_keyword/unsubscribe_page either, so it is refused outright,
    -- whatever the guard: choice 28 ("a grant never lifts a stop") would
    -- otherwise be enforceable only by callers remembering never to pass
    -- guard 'none' with a stray method such as 'form'.
    v_ok := false;
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
  'The consent ledger''s one write path (0055). Per-address advisory lock; guard none, if_empty, unless_customer_stopped (refused only over the customer''s own stop), if_allowed, if_stopped_or_held or if_newest (p_expect_id: the newest deciding row the caller saw, null for none); hold_released only while held; held only while allowed or as a staff undo; staff stop and backfill_0049 stop only while allowed, confirmed free-text stop only while held, staff Resume only over a staff-made stop, staff undo only over a staff or inbound_email stop (0082), resubscribed refused outright outside start_keyword/staff/staff_undo/unsubscribe_page (choice 19, choice 28); a future p_occurred_at is refused. A source_ref names one delivery or event, never a reusable channel. Answers appended, duplicate (same address, action and source_ref) or refused, with the prior newest deciding row. Called only from packages/db/src/consent.ts.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
revoke all on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  to service_role;

-- 6. unfile_inbound_email.
create function public.unfile_inbound_email(p_account_id uuid, p_id uuid, p_message_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_account_id is null or p_id is null or p_message_id is null then
    raise exception 'unfile_inbound_email: null argument' using errcode = '22004';
  end if;
  update public.inbound_emails
     set status = 'held', message_id = null, decided_by = null, decided_at = null
   where account_id = p_account_id and id = p_id and status = 'filed'
     and message_id = p_message_id and hold_reason is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;
  end if;
  delete from public.messages where account_id = p_account_id and id = p_message_id;
  return true;
end;
$$;
comment on function public.unfile_inbound_email(uuid, uuid, uuid) is
  'The Undo of a manual File (0082): a filed row that was held before (hold_reason is not null) goes back to held and its message is deleted, in one transaction. Never a webhook-filed row (hold_reason is null). Service role only.';
revoke all on function public.unfile_inbound_email(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.unfile_inbound_email(uuid, uuid, uuid) to service_role;

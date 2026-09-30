-- 0054_consent_ledger.sql
-- Consent chain PR-1 (docs/superpowers/specs/2026-09-26-consent-chain-design.md
-- sections 3 and 4.1; plan docs/superpowers/plans/2026-09-26-consent-pr1-ledger-and-gate.md).
--
-- ADDITIVE ONLY. The build before this file runs unchanged against it: it
-- never reads consent_events, never writes the new contacts column (its
-- default covers every insert), and never writes the new automation_log
-- source. So production takes this file BEFORE the merge deploy, and the
-- build after it can rely on it from its first request.
--
-- 1. consent_events: the ledger. Append-only BY GRANTS: after this file no
--    role, service_role included, holds UPDATE or DELETE on it. Rows still
--    leave with their account (on delete cascade) and let go of a deleted
--    contact (on delete set null (contact_id)), because a referential
--    action runs as the table's OWNER, not as the role that deleted the
--    parent row; consent-ledger-schema.test.ts proves both.
--    Writers: packages/db/src/consent.ts only, as the service role.
--    Readers: the send gate (service role) and the account's own users under
--    RLS (SELECT only).
-- 2. contacts.phone_country_unconfirmed: F-009's "this ten-digit number could
--    be Mexican or US" flag. The send gate holds a flagged contact until a
--    person picks the country. Client-UPDATABLE by name (0053's rule for a
--    new contacts column), the same as `phone` itself: the operator's
--    contact edits write the flag in the same statement as the phone, and
--    deciding a number's country through the data API is the same act as
--    the drawer's country buttons. It is a guard against the platform's own
--    misreading of a number, not a consent record; consent is in 1.
-- 3. automation_log: the missed-call text-back gets its own source,
--    'textback', so a text-back held overnight is released at 08:00 by the
--    same queue every automation uses. The list is 0047's (0047:82-86)
--    verbatim, plus the new value at the end.
--
-- No backslash anywhere in this file (the MCP apply rule): the E.164 CHECK
-- spells a literal plus as [+].
--
-- ROLLBACK (the build after this file reads the table and the column, so roll
-- the app back first):
--   drop table public.consent_events;
--   alter table public.contacts drop column phone_country_unconfirmed;
--   delete from public.automation_log where source = 'textback';
--   then re-add 0047's automation_log_source_check exactly.

set local lock_timeout = '5s';

-- 1. The ledger.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  channel text not null
    constraint consent_events_channel_check check (channel in ('sms', 'email')),
  address text not null,
  action text not null
    constraint consent_events_action_check check (action in ('granted', 'revoked', 'held', 'hold_released', 'resubscribed')),
  method text not null
    constraint consent_events_method_check check (method in (
      'keyword', 'start_keyword', 'free_text', 'staff', 'staff_undo', 'carrier_block',
      'unsubscribe_link', 'one_click', 'unsubscribe_page', 'form', 'booking', 'inbound_text',
      'backfill_0049', 'backfill_telnyx')),
  contact_id uuid,
  actor_id text,
  note text,
  source_ref text
    constraint consent_events_source_ref_check check (source_ref is null or char_length(source_ref) <= 200),
  evidence jsonb not null default '{}'::jsonb
    constraint consent_events_evidence_check check (
      jsonb_typeof(evidence) = 'object'
      and char_length(coalesce(evidence ->> 'excerpt', '')) <= 160),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint consent_events_address_check check (
    (channel = 'sms' and address ~ '^[+][1-9][0-9]{7,14}$')
    or (channel = 'email' and address = lower(address) and address = btrim(address)
        and char_length(address) between 3 and 254 and position('@' in address) > 1)),
  constraint consent_events_note_check check (
    method <> 'staff' or action <> 'resubscribed' or (note is not null and btrim(note) <> '')),
  constraint consent_events_actor_check check (
    method not in ('staff', 'staff_undo') or (actor_id is not null and btrim(actor_id) <> '')),
  -- Backfills write PAST times, so that stays legal. A future time (beyond
  -- 5 minutes of clock skew) or `infinity` is refused: today both would be
  -- accepted, and a future `resubscribed` could outrank a real STOP, while
  -- `infinity` makes JS `Date.parse` return NaN (review, m1).
  constraint consent_events_occurred_at_sane check (
    isfinite(occurred_at) and occurred_at <= created_at + interval '5 minutes'),
  -- The contact is the row's OWN account's (0050's pattern, onto
  -- contacts_account_id_id_key). A deleted contact nulls only contact_id;
  -- the row keeps its account and its address, so the evidence outlives a
  -- merge or a delete.
  constraint consent_events_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete set null (contact_id)
);

comment on table public.consent_events is
  'The consent ledger: one append-only row per grant, revoke, hold, hold release or resubscribe, per account and normalised address. State = the newest row whose action is revoked, held, hold_released or resubscribed. Written only by packages/db/src/consent.ts as the service role; no role holds UPDATE or DELETE.';
comment on column public.consent_events.actor_id is
  'The staff member for method staff or staff_undo: the Clerk user id, the events.actor_id convention.';

create index consent_events_address_idx
  on public.consent_events (account_id, channel, address, occurred_at desc, id desc);
-- The contact reference's ON DELETE SET NULL finds rows by (account_id,
-- contact_id); without this every contact delete scans the ledger.
create index consent_events_contact_idx
  on public.consent_events (account_id, contact_id) where contact_id is not null;

alter table public.consent_events enable row level security;
create policy consent_events_read on public.consent_events for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
-- revoke all, then grant back only what each role needs (0040's shape; the
-- default ACL hands ALL, MAINTAIN included, to all three roles by name).
revoke all on public.consent_events from anon, authenticated, service_role;
grant select on public.consent_events to authenticated;
grant select, insert on public.consent_events to service_role;

-- 2. F-009's flag.
alter table public.contacts
  add column phone_country_unconfirmed boolean not null default false;

comment on column public.contacts.phone_country_unconfirmed is
  'F-009: true when the stored phone came from ten digits valid as both a +1 and a +52 number, or as neither, so its country is unknown. The send gate holds texts to this contact until a person picks the country. Client-updatable (0054), like phone.';

grant update (phone_country_unconfirmed) on public.contacts to authenticated;

-- 3. The text-back's own automation_log source.
alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in (
    'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
    'instant_reply', 'weekly_report', 'concierge', 'voice',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup',
    'textback'));

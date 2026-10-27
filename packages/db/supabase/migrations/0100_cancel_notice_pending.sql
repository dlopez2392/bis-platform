-- 0100_cancel_notice_pending.sql - the business-cancel notice survives the process that queued it
-- (F-048 follow-up; apps/web .../calendar/cancel-notice.ts header, docs/crm-features.md F-048 rider row)
--
-- WHY. A cancel made on the Calendar page tells the customer only once its Undo window has closed. Today
-- that send waits inside the cancel's own server invocation (next/server after()). If that process dies
-- inside the wait (a deploy, a crash, a cold kill), the customer is never told and the notice's QUEUED
-- thread row sits on the conversation for good. This table is the notice's durable copy: written in the
-- cancel's own request, deleted by whoever settles the notice, and swept by the 15-minute cron when the
-- process that queued it did not settle it.
--
-- WHAT THIS FILE ADDS:
--   public.booking_cancel_notices  one row per booking whose customer notice is waiting to be settled.
--     booking_id  the cancelled booking; also the primary key (one live notice per booking: a cancel,
--                 its Undo and a second cancel replace the row, the app upserts on it).
--     account_id  the booking's account. The booking is the row's OWN account's: a composite FK onto
--                 bookings (account_id, id), the key 0061 added.
--     version     the cancel's own bookings.updated_at. The notice CLAIMS the cancel by it
--                 (claimCancelNotice), so the sweep and the after() job cannot both send, and an Undo
--                 that landed first leaves nothing to claim.
--     message_id  the notice's queued thread row (messages). Cascades: the Undo's discard of that row
--                 carries this one away too.
--     user_id     the person who cancelled (the thread row and its status changes are theirs), text like
--                 every other actor id (events.actor_id).
--     email       the composed email (subject, text, html, from, reply-to, address, language), fixed when
--                 the cancel was made, so the sweep sends exactly what after() would have.
--     due_at      when the Undo window and its grace close. The sweep reads only rows due 2 minutes ago
--                 or more, so the after() job, still alive, normally settles a row first.
--     created_at  when the cancel queued it. The sweep never sends a notice older than 24 hours.
--   booking_cancel_notices_due_at_idx  the sweep's oldest-first read.
--   No other index: a row lives for the ~15 seconds of an Undo window, or until the next tick when its
--   process died, so the cascades' scans by message_id and account_id read a near-empty table.
--
-- WHO WRITES. Only service_role: the Calendar page's cancel action (insert, upsert on booking_id), its
-- after() job, its Undo and the cron sweep (select, delete), all on the service client after their own
-- checks (requireAccountAccess and callerCanSee for the two actions). A client session neither reads nor
-- writes it.
--
-- GRANTS AND POLICIES. 0057 ops_heartbeats' server-only shape: RLS on with NO policy, revoke all from
-- public, anon, authenticated and service_role (the default ACL hands ALL, MAINTAIN included, to all three
-- roles by name), then grant service_role SELECT, INSERT, UPDATE and DELETE. No client write is added, so
-- the client-write digest (proposals-drop.test.ts) and EXPECTED_WRITES (schema-grants-guard.test.ts) are
-- unchanged. booking-cancel-notices-schema.test.ts pins the matrix, the policies and the keys.
--
-- SEARCH PATHS (0096 rule). This file creates no function. EXPECTED_DEFINERS is unchanged.
--
-- TEARDOWN. Every FK cascades (booking, account, message): a row is scratch state about one notice, not a
-- lead-bearing row, so it is NOT on ACCOUNT_OWNED_TABLES. deleteAccountCascade deletes bookings, and this
-- row goes with its booking.
--
-- LOCKS. Creating the three FKs takes SHARE ROW EXCLUSIVE on bookings, messages and accounts for the
-- length of this file (it blocks their writes, not their reads, and validates against an empty table);
-- lock_timeout 5s is the protection.
--
-- APPLY ORDER: after 0099 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: the build after this file writes the table on every Calendar-page cancel that schedules a
-- notice, and the cron sweep reads it on every tick. A write that fails is logged and the cancel goes on
-- (the after() send is unchanged), but the sweep's read failing would mark its heartbeat failed on every
-- tick, so production gets this file BEFORE the merge deploy.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names no object here.
--
-- ROLLBACK (roll the app back first). Dropping the table loses only notices waiting to be settled: a
-- process that is still alive sends its own, one that died leaves its queued thread row, as before 0100.
--   drop table public.booking_cancel_notices;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.booking_cancel_notices (
  booking_id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  version timestamptz not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id text not null,
  email jsonb not null,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint booking_cancel_notices_booking_fkey foreign key (account_id, booking_id)
    references public.bookings (account_id, id) on delete cascade
);

create index booking_cancel_notices_due_at_idx on public.booking_cancel_notices (due_at);

comment on table public.booking_cancel_notices is
  'F-048: a Calendar-page cancel''s customer notice, waiting for its Undo window to close. Written in the cancel''s own request; deleted by whoever settles the notice (its after() job, its Undo, or the cron sweep when the process that queued it died). Server-only: service_role reads and writes it, no grant to anon or authenticated.';
comment on column public.booking_cancel_notices.version is
  'The cancel''s own bookings.updated_at. The notice claims the cancel by it (claimCancelNotice) before anything is sent, so exactly one of the after() job, the sweep and the Undo wins.';
comment on column public.booking_cancel_notices.email is
  'The composed email (ComposedCancelNotice: address, language, from, reply-to, subject, text, html), fixed when the cancel was made.';
comment on column public.booking_cancel_notices.due_at is
  'When the Undo window and its grace close. The sweep reads rows due 2 minutes ago or more, oldest first.';

alter table public.booking_cancel_notices enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not
-- bypass it, and the grants below refuse anon and authenticated outright.
revoke all on public.booking_cancel_notices from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.booking_cancel_notices to service_role;

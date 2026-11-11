-- 0114_work_queue_actions.sql - the To do queue finishes what it shows (F-077 part 1)
-- (docs/superpowers/specs/2026-11-06-work-queue-actions-design.md sections 3, 4, 8 and 10;
--  docs/superpowers/plans/2026-11-06-work-queue-actions.md, Task 1)
--
-- WHY. Two loose ends the queue shows today have no way to be finished from it. A failed transfer (a caller
-- who asked for a person and never reached one) needs a "Called back" that a person can press and Undo. A
-- booking change Sofia made live (ai_acts.kind booking_created, booking_rescheduled or booking_cancelled)
-- needs an Accept that says "someone has seen this" without touching the booking, and without taking away
-- the record's own Undo of it.
-- A failed transfer cannot be derived from what calls holds today (spec section 10): every call row starts
-- abandoned (0019), and the handoff-result route writes transferred only when the human conversation ENDS, so
-- "abandoned and handoff_requested_at set" also matches every transfer still in progress, and every one whose
-- transferred write was refused or failed. So the failure is recorded when it happens, by the route that
-- knows, and the queue reads only that.
--
-- WHAT.
--   calls.transfer_failed_at timestamptz and calls.transfer_failed_reason text, nullable, no default: when and
--     why a caller who asked for a person reached nobody. NULL = no recorded failure (every row before this
--     file, and every call still being handled). The reasons, a closed set (calls_transfer_failed_reason_check):
--       'no_answer' - the second dial rang and nobody picked up: the "reached nobody" branch of
--         apps/web/src/app/api/voice/texml/handoff-result/route.ts:265-311 (every DialCallStatus outside
--         REACHED_A_PERSON, line 46: busy, no-answer, failed, canceled, or one nobody has heard of).
--       'refused' - the caller asked but was never dialled: the refusal branches of
--         apps/web/src/app/api/voice/texml/handoff/route.ts, the request too old to act on (334-338) and no
--         transfer target, not configured or the account's own number (357-360).
--     handoff-result's own refusals (167-170 no call for the token, 188-191 the call never asked) name no
--     call that asked, so they record nothing. calls_transfer_failed_pair: both set or neither.
--   calls.transfer_followup_at timestamptz and calls.transfer_followup_by text (a Clerk user id, not an FK:
--     0091's reason for undone_by), nullable, no default: when and by whom the failed transfer was marked
--     handled from the To do queue. calls_transfer_followup_pair: both set or neither.
--   calls_transfer_failed_open: a partial index on calls (account_id, transfer_failed_at) where
--     transfer_failed_at is not null and transfer_followup_at is null, the queue's read.
--   ai_acts.accepted_at timestamptz and ai_acts.accepted_by text (a Clerk user id, not an FK), nullable, no
--     default: when and by whom the act was accepted on the queue. ai_acts_accepted_pair: both set or neither.
--   Deliberately NO "not both accepted and undone" CHECK (plan review C1, 2026-11-06): undo_ai_booking_act's
--     final write (0091, as re-created by 0107: update ... set undone_at = p_now, undone_by = p_by) never clears
--     accepted_at, so such a CHECK would make the record's Undo raise 23514 on any act accepted on the queue.
--     Accepting an act already undone is refused by the app's compare-and-swap instead
--     (stampAiActAccepted: undone_at is null).
--   No function or trigger changes. app.ai_acts_act_is_fixed() (0091) raises only when one of eleven NAMED
--     columns moves; it has no "everything else is fixed" branch, so the two new ai_acts columns move freely
--     the moment they exist, exactly as undone_at, undone_by and undo_notified do. It is not re-created here,
--     which also keeps the search_path 0096 gave it (pg_catalog, pg_temp).
--
-- GRANTS. None. calls grants authenticated SELECT only (0019; 0020 revoked every write verb and nothing
-- re-granted one); ai_acts grants authenticated SELECT only (0091). Both are table-level, so authenticated
-- reads the new columns through the existing row policies (calls_tenant and calls_technician_scope;
-- ai_acts_member_read and ai_acts_technician_scope), unchanged. Writes go to service_role, which holds the
-- table-level write set on both: the handoff routes write the failure on serviceDb(), and the app writes the
-- follow-up and accept stamps on serviceDb() behind a request-client read that proves the caller may see the
-- row (callerCanSee). anon gains nothing. No RLS policy changes. The client-write digest and the definer count
-- (39, definer-search-path.test.ts) do not move: measured on the PostgreSQL 17.6 replica before and after
-- this file.
--
-- SEARCH PATHS. This file creates and alters no function.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each
-- lock, not the work done under it. Section 0 takes ACCESS EXCLUSIVE on ai_acts FIRST, then calls, inside
-- its do block, and holds both until the file commits: every read and write of either table waits for the
-- file, not just for one catalog change. The lock is taken INSIDE the do block (0088's and 0090's pattern):
-- the Supabase CLI does not run a file inside a transaction block, and a bare LOCK TABLE there fails 25P01
-- (CI verify, 2026-11-06). The second do block proves the next statement is still that transaction and still
-- holds both locks; a path that commits between statements fails there, before any DDL. A client that stops
-- on the first error (the CLI, apply_migration, psql with ON_ERROR_STOP) then applies nothing; a bare psql -f
-- would carry on past the raise, so never apply this file that way.
--   Why that order: the live writers hold ai_acts and then need calls (undo_ai_booking_act deletes a booking,
--     whose calls.booking_id FK sets null; merge_contacts; insertAiActs' FK check on ai_acts_call_fkey). Taking
--     calls first deadlocked such a writer on the PG 17.6 replica (40P01, and the victim can be a live call's
--     insertAiActs, whose act is then lost). Taking ai_acts first, the file waits behind that writer instead.
--   An added column with no default and no NOT NULL is a catalog change only: no table rewrite.
--   The four CHECKs are added valid, so each scans its table once under that lock; every existing row has its
--     new columns null and passes.
--   calls_transfer_failed_open is a plain create index, NOT concurrently: concurrently cannot run inside a
--     transaction, and at this size it does not need to. It reads calls once under the lock already held; every
--     row today fails its predicate, so it starts empty.
--   Production on 2026-11-06 (read-only): calls about 423 rows, 928 kB in all; ai_acts 48 kB in all.
--
-- LOAD-BEARING. The DB layer of F-077 part 1 (plan Tasks 2 and 3) and the handoff routes select and write these
-- columns, so the app that names them ships only after this file is on production. The app before this file
-- never names them, and keeps working unchanged after it.
--
-- ROLLBACK (roll the app back first; it names these columns), in one transaction:
--   drop index public.calls_transfer_failed_open;
--   alter table public.ai_acts drop constraint ai_acts_accepted_pair, drop column accepted_at, drop column accepted_by;
--   alter table public.calls drop constraint calls_transfer_followup_pair, drop constraint calls_transfer_failed_pair,
--     drop constraint calls_transfer_failed_reason_check, drop column transfer_followup_by,
--     drop column transfer_followup_at, drop column transfer_failed_reason, drop column transfer_failed_at;
--   (Every recorded failure, every accept and every "Called back" stamp is lost with its column. The booking
--   each act names is not touched: accepting never wrote a booking.)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock, then take both locks, ai_acts FIRST (LOCKS AND COST),
--    inside the block so they run in the block's transaction on every client. Then prove the next statement
--    is still that transaction, holding both, or stop before any DDL.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0114_xid', pg_catalog.txid_current()::text, true);
  lock table public.ai_acts in access exclusive mode;
  lock table public.calls in access exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m0114_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or (select count(*) from pg_catalog.pg_locks l
          where l.locktype = 'relation' and l.relation in ('public.ai_acts'::regclass, 'public.calls'::regclass)
            and l.pid = pg_catalog.pg_backend_pid() and l.mode = 'AccessExclusiveLock' and l.granted) <> 2 then
    raise exception '0114_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 1. calls: the failure, recorded when it happens, and who called the caller back, from the To do queue.
alter table public.calls
  add column transfer_failed_at timestamptz,
  add column transfer_failed_reason text
    constraint calls_transfer_failed_reason_check check (transfer_failed_reason in ('no_answer', 'refused')),
  add column transfer_followup_at timestamptz,
  add column transfer_followup_by text,
  add constraint calls_transfer_failed_pair check ((transfer_failed_at is null) = (transfer_failed_reason is null)),
  add constraint calls_transfer_followup_pair check ((transfer_followup_at is null) = (transfer_followup_by is null));
comment on column public.calls.transfer_failed_at is
  'When a caller who asked for a person reached nobody (0114, F-077 part 1). Written by the handoff routes on '
  'the SERVICE client, when it happens: handoff-result''s reached-nobody branch, or the handoff route''s '
  'refusals. NULL = no recorded failure, including a transfer still in progress. Set together with '
  'transfer_failed_reason (calls_transfer_failed_pair).';
comment on column public.calls.transfer_failed_reason is
  'Why the transfer failed (0114): no_answer (the dial rang and nobody picked up) or refused (the caller was '
  'never dialled: the ask was too old, or there is no usable transfer number). NULL exactly when '
  'transfer_failed_at is NULL.';
comment on column public.calls.transfer_followup_at is
  'When a person marked this failed transfer handled ("Called back") on the To do queue (0114, F-077 part 1). '
  'NULL = not yet followed up, or not a failed transfer. Written by setTransferFollowedUp on the SERVICE '
  'client, behind a request-client read that proves the caller may see this call (callerCanSee): calls grants '
  'authenticated no write at all (0020), so this column has no client grant either. Set together with '
  'transfer_followup_by (calls_transfer_followup_pair).';
comment on column public.calls.transfer_followup_by is
  'The Clerk user id of whoever pressed "Called back" (0114). Not an FK (0091''s reason for undone_by). Undo '
  'needs the same person and the same instant. NULL exactly when transfer_followup_at is NULL.';

-- 2. The queue's read: the account's failed transfers nobody has followed up yet.
create index calls_transfer_failed_open on public.calls (account_id, transfer_failed_at)
  where transfer_failed_at is not null and transfer_followup_at is null;

-- 3. ai_acts: a queue-only "someone has seen this" stamp, independent of the booking's own Undo (undone_at).
--    app.ai_acts_act_is_fixed() (0091) already lets these move: it checks eleven NAMED columns, not
--    "everything but three"; no function edit is needed or made here.
alter table public.ai_acts
  add column accepted_at timestamptz,
  add column accepted_by text;
comment on column public.ai_acts.accepted_at is
  'When someone marked this booking change seen on the To do queue (0114, F-077 part 1). Independent of '
  'undone_at: accepting touches no booking, and the record''s own Undo still works on an accepted act. '
  'NULL = not yet accepted. Set together with accepted_by (ai_acts_accepted_pair).';
comment on column public.ai_acts.accepted_by is
  'The Clerk user id of whoever accepted this act on the To do queue (0114). Not an FK (0091''s reason for '
  'undone_by). NULL exactly when accepted_at is NULL.';

alter table public.ai_acts
  add constraint ai_acts_accepted_pair check ((accepted_at is null) = (accepted_by is null));
-- Deliberately NO "not both accepted and undone" CHECK: see WHAT above (plan review C1).

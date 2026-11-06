-- 0114_work_queue_actions.sql - the To do queue finishes what it shows (F-077 part 1)
-- (docs/superpowers/specs/2026-11-06-work-queue-actions-design.md sections 3, 4 and 8;
--  docs/superpowers/plans/2026-11-06-work-queue-actions.md, Task 1)
--
-- WHY. Two loose ends the queue shows today have no way to be finished from it. A failed transfer (a caller
-- who asked for a person, handoff_requested_at set, and never reached one, outcome abandoned) needs a
-- "Called back" that a person can press and Undo. A booking change Sofia made live (ai_acts.kind
-- booking_created, booking_rescheduled or booking_cancelled) needs an Accept that says "someone has seen
-- this" without touching the booking, and without taking away the record's own Undo of it. Each needs one
-- stamp to read and to clear.
--
-- WHAT.
--   calls.transfer_followup_at timestamptz, nullable, no default: when a person marked the failed transfer
--     handled from the To do queue. NULL = not yet, or not a failed transfer.
--   ai_acts.accepted_at timestamptz and ai_acts.accepted_by text (a Clerk user id, not an FK: 0091's reason
--     for undone_by), nullable, no default: when and by whom the act was accepted on the queue.
--   ai_acts_accepted_pair: (accepted_at is null) = (accepted_by is null).
--   Deliberately NO "not both accepted and undone" CHECK (plan review C1, 2026-11-06): undo_ai_booking_act's
--     final write (0091, as re-created by 0107: update ... set undone_at = p_now, undone_by = p_by) never clears
--     accepted_at, so such a CHECK would make the record's Undo raise 23514 on any act accepted on the queue.
--     Accepting an act already undone is refused by the app's compare-and-swap instead
--     (stampAiActAccepted: undone_at is null).
--   No function or trigger changes. app.ai_acts_act_is_fixed() (0091) raises only when one of eleven NAMED
--     columns moves; it has no "everything else is fixed" branch, so the two new columns move freely the
--     moment they exist, exactly as undone_at, undone_by and undo_notified do. It is not re-created here,
--     which also keeps the search_path 0096 gave it (pg_catalog, pg_temp).
--
-- GRANTS. None. calls grants authenticated SELECT only (0019; 0020 revoked every write verb and nothing
-- re-granted one); ai_acts grants authenticated SELECT only (0091). Both are table-level, so authenticated
-- reads the new columns through the existing row policies (calls_tenant and calls_technician_scope;
-- ai_acts_member_read and ai_acts_technician_scope), unchanged. Writes go to service_role, which holds the
-- table-level write set on both: the app writes these stamps on serviceDb() behind a request-client read that
-- proves the caller may see the row (callerCanSee). anon gains nothing. No RLS policy changes. The
-- client-write digest and the definer count (39, definer-search-path.test.ts) do not move: measured on the
-- PostgreSQL 17.6 replica before and after this file.
--
-- SEARCH PATHS. This file creates and alters no function.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each
-- lock, not the work done under it. Section 0 takes ACCESS EXCLUSIVE on ai_acts FIRST, then calls, in one
-- lock table statement, and holds both until the file commits: every read and write of either table waits
-- for the file, not just for one catalog change.
--   Why that order: the live writers hold ai_acts and then need calls (undo_ai_booking_act deletes a booking,
--     whose calls.booking_id FK sets null; merge_contacts; insertAiActs' FK check on ai_acts_call_fkey). Taking
--     calls first deadlocked such a writer on the PG 17.6 replica (40P01, and the victim can be a live call's
--     insertAiActs, whose act is then lost). Taking ai_acts first, the file waits behind that writer instead.
--   An added column with no default and no NOT NULL is a catalog change only: no table rewrite, no scan.
--   ai_acts_accepted_pair is added valid, so it scans ai_acts once under that lock; every existing row has both
--     new columns null and passes.
--   Production on 2026-11-06 (read-only): calls about 423 rows, 928 kB in all; ai_acts 48 kB in all.
--   No index: the queue's reads are per account and already narrow (handoff_requested_at is not null; three
--     booking kinds' acts not undone), and a partial index is a later file if a measurement asks for one.
--
-- LOAD-BEARING. The DB layer of F-077 part 1 (plan Tasks 2 and 3) selects and writes these columns, so the app
-- that reads them ships only after this file is on production. The app before this file never names them, and
-- keeps working unchanged after it.
--
-- ROLLBACK (roll the app back first; it names these columns), in one transaction:
--   alter table public.ai_acts drop constraint ai_acts_accepted_pair, drop column accepted_at, drop column accepted_by;
--   alter table public.calls drop column transfer_followup_at;
--   (Every accept and every "Called back" stamp is lost with its column. The booking each act names is not
--   touched by either: accepting never wrote a booking.)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;
lock table public.ai_acts, public.calls in access exclusive mode;

-- 1. calls: when a person marked a failed transfer handled (called the caller back) from the To do queue.
alter table public.calls add column transfer_followup_at timestamptz;
comment on column public.calls.transfer_followup_at is
  'When a person marked a failed transfer (asked for a person, handoff_requested_at set, outcome '
  'abandoned) handled, from the To do queue (0114, F-077 part 1). NULL = not yet followed up, or not a '
  'failed transfer. Written by setTransferFollowedUp on the SERVICE client, behind a request-client read that '
  'proves the caller may see this call (callerCanSee): calls grants authenticated no write at all (0020), '
  'so this column has no client grant either.';

-- 2. ai_acts: a queue-only "someone has seen this" stamp, independent of the booking's own Undo (undone_at).
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

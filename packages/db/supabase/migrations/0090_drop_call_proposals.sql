-- 0090_drop_call_proposals.sql - the bridge goes (first release item 8, part 8b-2; S-14, F-019)
-- (docs/superpowers/specs/2026-10-19-ai-proposals-review-tray-design.md section 4.6, where it is named
--  "0089"; docs/superpowers/plans/2026-10-19-ai-proposals-tray-pr8b2.md, the migration decision and Task 2)
--
-- Drops call_proposals (0040), which takes its two triggers (call_proposals_guard, call_proposals_mirror),
-- 0053's and 0068's policies on it, its indexes and its constraints with it, and then the three bridge
-- functions 0088 added: app.mirror_call_proposal(), app.guard_call_proposal(), app.copy_call_proposals().
-- proposals (0088) is untouched. No client role held a write on call_proposals (0053), so the client
-- write surface does not change.
--
-- THIS IS THE POINT OF NO ROLLBACK TO PRE-8B CODE (spec 4.6): after it, the 8a build has no table to
-- read or write. Recreating the table means 0040's, 0053's and 0068's definitions of call_proposals, its
-- grants and its policies, then 0088's rollback steps 2-3 (0088_proposals.sql header, lines 28-53) to
-- copy proposals back. That path is UNTESTED; treat it as a hand repair, not a rollback.
--
-- THE GATE (plan Task 10 step 5). Production: only at or after 2026-10-20T05:35:46Z (8b-1's READY at
-- 2026-10-19T17:35:46Z plus the 12 h skew-protection age), and only with evidence items 1-3 in the
-- ledger: (1) no call_proposals row created or decided after that time; (2) every call_proposals id is in
-- proposals and every decided row's status equals its twin's; (3) the call_proposals grep on the branch
-- equals the allow-list. bis-ci: items 2 and 3 gate, item 1 is recorded only (owner, 2026-10-19).
-- APPLY ORDER: production's E1 and E2 read green first; then bis-ci (ci-project-setup.yml: push-dry-run,
-- then push); then production (MCP apply_migration, once); then the parity check.
--
-- THE SELF-CHECK: item 2 is enforced here as well, under the lock, so a row the ledger's read missed
-- still stops the drop. A pending call_proposals row whose twin the new code has since decided is
-- expected (production holds two from the 8b-1 smoke) and is never a difference.
--
-- ONE TRANSACTION (0088's pattern, plan assumption A3): the settings and the access-exclusive lock are
-- taken inside the first do block; the second raises 0090_not_one_transaction unless it runs in the
-- same transaction, still holding that lock. A path that commits between statements fails there,
-- before anything is dropped. No dependent object may be dropped silently: every drop below names its
-- object and none reaches past it, so a hidden dependency fails the drop loudly.
--
-- ASCII only, no backslash anywhere.

-- 0. The lock, then evidence item 2, under it. An old-code write cannot land between the check and the
--    drop: access exclusive mode admits no reader or writer until this transaction ends.
do $$
declare v_missing bigint; v_differ bigint;
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0090_xid', pg_catalog.txid_current()::text, true);
  lock table public.call_proposals in access exclusive mode;
  select count(*) into v_missing from public.call_proposals cp
   where not exists (select 1 from public.proposals p where p.id = cp.id);
  select count(*) into v_differ from public.call_proposals cp join public.proposals p on p.id = cp.id
   where cp.status <> 'pending' and p.status is distinct from cp.status;
  if v_missing > 0 or v_differ > 0 then
    raise exception '0090_not_copied: % missing, % differ', v_missing, v_differ using errcode = 'P0001';
  end if;
end $$;

-- 1. Still the one transaction that took the lock, or nothing is dropped.
do $$
begin
  if pg_catalog.current_setting('bis.m0090_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or not exists (select 1 from pg_catalog.pg_locks l
                     where l.locktype = 'relation' and l.relation = 'public.call_proposals'::regclass
                       and l.pid = pg_catalog.pg_backend_pid() and l.mode = 'AccessExclusiveLock' and l.granted) then
    raise exception '0090_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 2. The table, and with it its triggers, policies, indexes and constraints.
drop table public.call_proposals;

-- 3. The bridge functions. The two trigger functions lost their triggers with the table above.
drop function app.mirror_call_proposal();
drop function app.guard_call_proposal();
drop function app.copy_call_proposals();

-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration
-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.
--
-- web_chat_ledger: the website chat's AI spend goes on the ledger.
--
-- 0086's ai_ledger_feature_check admits four features (call_summary, call_proposals, call_card,
-- record_summary), so the task router (apps/web/src/lib/ai/tasks.ts, #362) gave the web chat no
-- feature and the gateway wrote no row for it: its spend was not recorded. This admits 'web_chat'.
-- Nothing else in SQL lists the features: ai_ledger_record passes p_feature through (it counts only
-- record_summary toward the daily cap), and no view or other function names them.
--
-- The new set is a superset of the old, so every existing row passes the re-added check. Dropping
-- a check constraint is not a contract change (runbook section 6): the app on main writes only the
-- four old values, which the new check still admits.
--
-- APPLY ORDER: bis-ci (CI, after the PR is ready), then production, then the app that writes
-- 'web_chat'. The app before it never sends 'web_chat'; the app after it would see a 23514 on each
-- chat turn's ledger write without it (logged, the answer kept: gateway.ts never fails a turn on
-- the ledger), so the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, app reverted first, and only after deleting the web_chat rows):
--   delete from public.ai_ledger where feature = 'web_chat';
--   alter table public.ai_ledger drop constraint ai_ledger_feature_check;
--   alter table public.ai_ledger add constraint ai_ledger_feature_check
--     check (feature in ('call_summary', 'call_proposals', 'call_card', 'record_summary'));
--
-- ASCII only, no backslash anywhere.

-- Fail fast instead of queueing behind a long lock on ai_ledger (the re-added check scans it).
set local lock_timeout = '5s';

alter table public.ai_ledger drop constraint ai_ledger_feature_check;
alter table public.ai_ledger add constraint ai_ledger_feature_check
  check (feature in ('call_summary', 'call_proposals', 'call_card', 'record_summary', 'web_chat'));

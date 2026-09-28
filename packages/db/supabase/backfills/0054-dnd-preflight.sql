-- Consent chain PR-1, choice 25's pre-flight: the gate does NOT read
-- contacts.dnd (0003: jsonb not null default '{}', read and written by no
-- code), so any contact that carries a non-empty value there must be found
-- BEFORE the gate ships and turned into staff-recorded stops by a plan of
-- its own. READ ONLY. Expected answer on both databases: no rows.
--
-- Run on the CI project with
-- `pnpm --filter @bis/db ci:sql supabase/backfills/0054-dnd-preflight.sql`,
-- on production only with danlo's go, through execute_sql. Counts only:
-- no contact's value is printed.
--
-- ASCII only, no backslash (memory bis-mcp-sql-escapes); ci:sql's read gate
-- passes it (src/ci/sql-files.test.ts).
select c.account_id, jsonb_typeof(c.dnd) as shape, count(*) as contacts
from public.contacts c
where c.dnd <> '{}'::jsonb
group by c.account_id, jsonb_typeof(c.dnd)
order by c.account_id, shape;

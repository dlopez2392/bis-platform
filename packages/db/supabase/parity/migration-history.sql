-- Migration history, normalised so the two projects can be diffed.
-- READ ONLY.
--
--   CI:    pnpm --filter @bis/db ci:sql supabase/parity/migration-history.sql > ci-history.tsv
--   PROD:  the orchestrator pastes this file into the Supabase MCP execute_sql
--          on tlbkbmlrfafquucsmsmm.
--
-- The rows come in three forms (read in the review of #365, 2026-11-13):
--   - the CLI's (db:push:ci, and every bis-ci row): version 0001, name tenancy;
--     production's 0001-0011 too. Printed as version_name.
--   - the MCP's WHOLE STEM: version = the apply time, name 0115_x. Production's
--     0012-0031, 0033-0041, 0046-0059, 0116, and an extra
--     0048_accounts_mailing_address_check_escapes. Printed as the name.
--   - the MCP's SLUG ALONE: version = the apply time, name owner_line.
--     Production's 0032, 0042-0045 and 0060-0115 (61 rows; 0115 is
--     20261111035059, owner_line). Printed as the bare slug, so the diff shows
--     owner_line against CI's 0115_owner_line: match those 61 by slug, which
--     is unique among them. Never apply a file this way again.
-- New files (YYYYMMDDHHMMSS_slug.sql, from 20261113000000; a slug starts with
-- a letter, packages/db/src/migrations/names.ts) are the CLI's form on bis-ci
-- and the whole stem on production (the MCP's name is the stem by
-- instruction), so both print the stem.
--
-- ASCII only, no backslashes (memory bis-mcp-sql-escapes).
select case
         when name ~ '^[0-9]+_' then name
         when version ~ '^[0-9]{4}$' or version >= '20261113000000' then version || '_' || name
         else name
       end as migration
from supabase_migrations.schema_migrations
order by 1;

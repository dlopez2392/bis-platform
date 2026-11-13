-- Migration history, normalised so the two projects can be diffed.
-- READ ONLY.
--
--   CI:    pnpm --filter @bis/db ci:sql supabase/parity/migration-history.sql > ci-history.tsv
--   PROD:  the orchestrator pastes this file into the Supabase MCP execute_sql
--          on tlbkbmlrfafquucsmsmm.
--
-- The two projects record history differently:
--   - CI is pushed by the Supabase CLI (db:push:ci), which splits a file name
--     like 0001_tenancy.sql into version 0001 and name tenancy. [ASSUMPTION
--     from the plan; confirm on the first read after the push.]
--   - Production is applied by the MCP apply_migration, whose version is a
--     timestamp and whose name carries the number (bis-db-schema agent file,
--     "Pre-flight matches on name, not version").
-- Since 2026-11-13 new files are named YYYYMMDDHHMMSS_slug.sql, and a slug
-- starts with a letter (packages/db/src/migrations/names.ts). A row whose name
-- already starts with digits and an underscore carries its whole stem (the
-- MCP's form, for a numbered file or a timestamped one); every other row is
-- version_name (the CLI's form, either kind). Both come out as the file's stem.
--
-- ASCII only, no backslashes (memory bis-mcp-sql-escapes).
select case when name ~ '^[0-9]+_' then name else version || '_' || name end as migration
from supabase_migrations.schema_migrations
order by 1;

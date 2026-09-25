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
-- Both come out as NNNN_snake_name.
--
-- ASCII only, no backslashes (memory bis-mcp-sql-escapes).
select case when version ~ '^[0-9]{4}$' then version || '_' || name else name end as migration
from supabase_migrations.schema_migrations
order by 1;

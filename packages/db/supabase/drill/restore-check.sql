-- The restore drill's comparison (docs/runbooks/restore-drill.md). READ-ONLY.
-- Run it twice, unchanged: once on the temporary project restored from a
-- backup, once on production, then diff the two outputs. It prints counts,
-- versions and timestamps only, never a row's contents, so its output can be
-- pasted into the drill log.
--
-- What a good restore looks like: every table present on both sides, the same
-- latest migration, and row counts and newest timestamps that differ only by
-- what production has written SINCE the backup was taken (the backup is older,
-- so its numbers are equal or lower, never higher).

select 'migration' as check, max(version)::text as value
from supabase_migrations.schema_migrations

union all
select 'tables', count(*)::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'

union all
select 'rows:' || t.table_name,
  (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'

union all
select 'newest:events', coalesce(max(created_at)::text, 'none') from public.events
union all
select 'newest:contacts', coalesce(max(created_at)::text, 'none') from public.contacts
union all
select 'newest:calls', coalesce(max(created_at)::text, 'none') from public.calls

order by 1;

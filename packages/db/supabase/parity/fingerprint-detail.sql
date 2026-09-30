-- Parity fingerprint, DETAIL form: every item, one row each.
-- READ ONLY. Use it only for a kind whose digest differs in fingerprint.sql:
--
--   CI:    pnpm --filter @bis/db ci:sql supabase/parity/fingerprint-detail.sql > ci-detail.tsv
--   PROD:  the orchestrator pastes this file into the Supabase MCP execute_sql
--          on tlbkbmlrfafquucsmsmm (read only; the MCP cannot reach CI).
--
-- The item list below is fingerprint.sql's, byte for byte, and a test holds
-- it there (packages/db/src/ci/sql-files.test.ts). Change one, change both.
-- The header comment of fingerprint.sql explains the kinds, the one allowed
-- difference, what platform-owned rows are scoped out, and why every sort is
-- collate "C" and ACLs are compared as sorted items.
--
-- ASCII only, no backslashes (memory bis-mcp-sql-escapes).
with items(kind, key, def) as (
  select 'extension', e.extname::text, null::text
    from pg_extension e where e.extname in ('btree_gist', 'plpgsql')
  union all
  select 'extension_version(info)', e.extname::text, e.extversion
    from pg_extension e where e.extname in ('btree_gist', 'plpgsql')
  union all
  select 'schema_acl', n.nspname::text,
         case when n.nspacl is null then 'default'
              else coalesce((select string_agg(s.item, ',' order by s.item collate "C")
                               from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end
                                            || '=' || x.privilege_type
                                            || case when x.is_grantable then '*' else '' end as item
                                       from aclexplode(n.nspacl) x
                                      where x.grantee = 0
                                         or x.grantee in ('postgres'::regrole, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)) s),
                            '') end
    from pg_namespace n where n.nspname in ('public', 'app')
  union all
  select 'relation', n.nspname || '.' || c.relname,
         c.relkind::text || ' rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
     and not exists (select 1 from pg_depend dep where dep.classid = 'pg_class'::regclass and dep.objid = c.oid and dep.deptype = 'e')
  union all
  select 'column', table_schema || '.' || table_name || '.' || column_name,
         concat_ws(' | ', data_type, udt_name, is_nullable, column_default, is_identity,
                   identity_generation, is_generated, generation_expression)
    from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'constraint', n.nspname || '.' || cl.relname || '.' || co.conname,
         co.contype::text || ' ' || pg_get_constraintdef(co.oid)
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
   where n.nspname in ('public', 'app')
  union all
  select 'index', schemaname || '.' || indexname, indexdef
    from pg_indexes where schemaname in ('public', 'app')
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         concat_ws(' | ', permissive, roles::text, cmd, qual, with_check)
    from pg_policies where schemaname in ('public', 'app', 'storage')
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         concat_ws(' | ', md5(pg_get_functiondef(p.oid)), 'secdef=' || p.prosecdef::text,
                   'vol=' || p.provolatile::text, coalesce(array_to_string(p.proconfig, ','), ''),
                   case when p.proacl is null then 'default'
                        else coalesce((select string_agg(s.item, ',' order by s.item collate "C")
                                         from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end
                                                      || '=' || x.privilege_type
                                                      || case when x.is_grantable then '*' else '' end as item
                                                 from aclexplode(p.proacl) x
                                                where x.grantee = 0
                                                   or x.grantee in ('postgres'::regrole, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)) s),
                                      '') end)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend dep where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e')
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'app')
  union all
  select 'event_trigger', e.evtname::text, e.evtevent || ' ' || e.evtfoid::regproc::text || ' ' || e.evtenabled::text
    from pg_event_trigger e where e.evtowner = 'postgres'::regrole
  union all
  select 'table_grant', n.nspname || '.' || c.relname || ' -> ' || a.grantee::regrole::text,
         string_agg(a.privilege_type, ',' order by a.privilege_type collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname in ('public', 'app')
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
   group by n.nspname, c.relname, a.grantee
  union all
  select 'column_grant', n.nspname || '.' || c.relname || '.' || at.attname || ' -> ' || a.grantee::regrole::text,
         string_agg(a.privilege_type, ',' order by a.privilege_type collate "C")
    from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(at.attacl) a
   where n.nspname in ('public', 'app') and at.attacl is not null
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
   group by n.nspname, c.relname, at.attname, a.grantee
  union all
  select 'default_acl', pg_get_userbyid(d.defaclrole) || ' ' || coalesce(dn.nspname, '*') || ' ' || d.defaclobjtype::text,
         coalesce((select string_agg(s.item, ',' order by s.item collate "C")
                     from (select case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end
                                  || '=' || x.privilege_type
                                  || case when x.is_grantable then '*' else '' end as item
                             from aclexplode(d.defaclacl) x) s),
                  '')
    from pg_default_acl d left join pg_namespace dn on dn.oid = d.defaclnamespace
   where d.defaclrole = 'postgres'::regrole
  union all
  select 'enum', t.typname::text, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'app') group by t.typname
  union all
  select 'bucket', b.id, concat_ws(' | ', b.public::text, b.file_size_limit::text, b.allowed_mime_types::text)
    from storage.buckets b
  union all
  select 'publication', pubname || '.' || schemaname || '.' || tablename, null from pg_publication_tables
)
select kind, key, def from items order by kind collate "C", key collate "C", def collate "C";

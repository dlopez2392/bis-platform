-- 0096_definer_search_path.sql - every function in public and app that sets a search_path lists pg_temp
-- LAST, so a session's temporary objects can never shadow a name inside a function that runs as its owner
-- (S-47c follow-up; the S-47c final review and the Task 1 review, proven on a replica)
--
-- WHY. A function declared with set search_path = '' still searches the session's own temporary schema
-- (pg_temp) FIRST for relation and type names: PostgreSQL searches pg_temp before everything else unless
-- the path names it. A session holding service_role created a pg_temp.text domain whose CHECK called a
-- pg_temp function; save_voice_knowledge (0095) and reserve_document_version (0077), both SECURITY DEFINER,
-- then resolved their own text variables to that domain and ran the function as their owner, postgres.
-- It is not reachable today: service_role is NOLOGIN, so only PostgREST holds it, and PostgREST runs no
-- DDL for a caller. It would turn any future way of holding service_role in a session into postgres. Naming
-- pg_temp explicitly at the END of the path makes it the last place searched, so pg_catalog.text and every
-- other real type and table win. Function and operator names are never looked up in pg_temp at all.
--
-- WHAT. One loop over pg_proc in public and app, for every function that sets a search_path, definer or
-- not, and every SECURITY DEFINER function (which must set one: a definer with no search_path setting
-- raises here, so a future surprise is loud):
--   search_path ''                 becomes  pg_catalog, pg_temp   (21 definers and 55 invokers today)
--   search_path public             becomes  public, pg_temp       (app.current_account_id, 0008)
--   any other path without pg_temp gets  , pg_temp  appended   (none today)
--   a path whose last entry is already pg_temp is left alone; one naming pg_temp anywhere else raises.
-- ALTER FUNCTION ... SET changes only the search_path key of proconfig: every other setting stays, in its
-- place (ensure_knowledge_snapshot keeps lock_timeout=2s from 0095). Bodies, grants, owners, volatility
-- and SECURITY DEFINER itself are untouched. A last block re-reads pg_proc and raises if any function in
-- scope still lacks pg_temp last.
--
-- WHY THE INVOKERS TOO. The security boundary is the definer, but it does not stop at the definer body.
-- While a definer runs, current_user is its owner, so every invoker function it calls and every trigger
-- function fired by its writes runs as postgres as well, and each of those carries its OWN
-- search_path = '' that puts pg_temp first again. Proven on the replica: with only save_voice_knowledge
-- hardened, its facts-only save stopped running the shadow, but a save carrying business hours still ran
-- it as postgres, inside app.voice_business_hours_valid (an invoker, 0095) during its variable
-- initialisation. Functions with no search_path setting (app.jwt, app.is_agency, the concierge and unread
-- helpers, the btree_gist functions) inherit the caller's path, which inside a definer is now safe, so
-- they need nothing.
--
-- RULE FOR EVERY LATER MIGRATION. A new function in public or app that sets a search_path writes
--   set search_path = pg_catalog, pg_temp
-- and never set search_path = '' (which searches pg_temp FIRST). The same holds for a create or replace
-- of an existing function: its SET clause replaces the whole setting, so copying an old definition with
-- search_path = '' quietly undoes this file for that function. A new SECURITY DEFINER function must also
-- be added by name to EXPECTED_DEFINERS in packages/db/src/test/definer-search-path.test.ts. That test
-- fails CI on any function in public or app whose search_path does not end with pg_temp.
--
-- SAFE UNDER THE RUNNING BUILD: yes. Every body names its tables and functions schema-qualified, and every
-- name a body resolves is found in pg_catalog (or public, for current_account_id) exactly as before: the
-- only change in lookup order is that pg_temp now comes last instead of first, and nothing in the build
-- creates a temporary object. Callers in flight finish under the old setting; the next call reads the new
-- one (PL/pgSQL recompiles on the catalog change). No table is locked; the ALTERs update pg_proc rows only.
-- The client-write digest is unchanged.
--
-- ROLLBACK (no app step; this file changes no name the app uses), as postgres, in one transaction:
--   do $$ declare r record; begin
--     for r in select p.oid::regprocedure as fn, c.cfg from pg_proc p
--                join pg_namespace n on n.oid = p.pronamespace
--                cross join lateral unnest(p.proconfig) as c(cfg)
--               where n.nspname in ('public', 'app') and c.cfg like 'search_path=%' loop
--       if r.cfg = 'search_path=pg_catalog, pg_temp' then
--         execute format('alter function %s set search_path = %L', r.fn, '');
--       elsif r.cfg = 'search_path=public, pg_temp' then
--         execute format('alter function %s set search_path = public', r.fn);
--       end if;
--     end loop; end $$;
-- That restores the 77 settings this file changed and leaves lock_timeout=2s where it is. It reopens the
-- hole; do it only to undo a fault this file caused.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Independent of the app: the build before and
-- after this file is the same, so it may go at any time; definer-search-path.test.ts is red on a database
-- without it.
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a lock (0094 reason: inside a do block, so it is always in the
--    block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. pg_temp last on every function in public and app that sets a search_path; a definer without one raises.
do $$
declare
  r record;
  v_path text;
  v_parts text[];
  v_new text;
  v_changed integer := 0;
begin
  for r in
    select p.oid, p.oid::pg_catalog.regprocedure as fn, p.prosecdef, p.prokind,
           (select pg_catalog.substr(c.cfg, pg_catalog.length('search_path=') + 1)
              from pg_catalog.unnest(p.proconfig) as c(cfg)
             where c.cfg like 'search_path=%') as path
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and (p.prosecdef
            or exists (select 1 from pg_catalog.unnest(p.proconfig) as c(cfg) where c.cfg like 'search_path=%'))
     order by p.oid::pg_catalog.regprocedure::text
  loop
    if r.path is null then
      raise exception '0096: SECURITY DEFINER function % sets no search_path; give it one before this file runs', r.fn;
    end if;
    if r.prokind <> 'f' then
      raise exception '0096: % is not a plain function (prokind %); handle it by hand', r.fn, r.prokind;
    end if;
    v_path := r.path;
    v_parts := pg_catalog.string_to_array(v_path, ',');
    if v_path = '""' then
      v_new := 'pg_catalog, pg_temp';
    elsif pg_catalog.btrim(v_parts[pg_catalog.array_upper(v_parts, 1)]) = 'pg_temp' then
      continue;
    elsif exists (select 1 from pg_catalog.unnest(v_parts) as e(x) where pg_catalog.btrim(e.x) = 'pg_temp') then
      raise exception '0096: % names pg_temp before the end of its search_path (%); decide by hand', r.fn, v_path;
    else
      v_new := v_path || ', pg_temp';
    end if;
    execute pg_catalog.format('alter function %s set search_path = %s', r.fn, v_new);
    v_changed := v_changed + 1;
  end loop;
  raise notice '0096: % functions now list pg_temp last', v_changed;
end $$;

-- 2. Re-read: nothing in scope may be left with pg_temp anywhere but last.
do $$
declare
  v_left text;
begin
  select pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ') into v_left
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and (p.prosecdef
          or exists (select 1 from pg_catalog.unnest(p.proconfig) as c(cfg) where c.cfg like 'search_path=%'))
     and not exists (select 1 from pg_catalog.unnest(p.proconfig) as c(cfg)
                      where c.cfg like 'search_path=%'
                        and (c.cfg = 'search_path=pg_temp' or c.cfg like '%, pg_temp'));
  if v_left is not null then
    raise exception '0096: still without pg_temp last: %', v_left;
  end if;
end $$;

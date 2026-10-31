-- 0108_contact_search.sql - contacts search that ignores accents and finds full names and phone digits (F-092 part 1)
-- (docs/superpowers/specs/2026-10-31-search-accents-design.md section 4.3;
--  docs/superpowers/plans/2026-10-31-search-accents.md, Task 1)
--
-- WHY. Contact search matched raw text with ILIKE, which folds case and never accents: "Garcia" did not find
-- "Garcia" spelled with its accent, "Maria Garcia" found nobody (the whole term had to sit inside ONE column), and the
-- legacy Mexican mobile shape "+52 1 899 ..." missed the stored "+52 899 ...". The owner ruled (spec section 9,
-- 2026-10-31): n and n-tilde match both ways, a phone search starts at 4 digits, the list keeps its own order, and
-- households and businesses follow the same rules.
--
-- WHAT.
--   pg_trgm, in the extensions schema (read on both projects 2026-10-31: the schema exists, pg_trgm was not
--     installed, default version 1.6). Trusted, like btree_gist (0016), so the migration role may create it.
--   app.contact_search_name(text, text, text): app.contact_name_fold (0106) of first name, last name and business
--     name, the non-empty ones joined by one space, NULL when all three fold to nothing. plpgsql, not sql: a sql
--     function calling a sql function re-plans the inner one on every row (0106 section 1's measured reason).
--     Its TypeScript twin is contactSearchName in packages/db/src/dedupe-keys.ts, compared shape by shape in
--     contact-search-schema.test.ts.
--   contacts.search_name: stored, generated from it. company_name is written by the business sync (0069) and reset by
--     0072's BEFORE trigger; stored generated columns are computed after BEFORE triggers, so search_name always
--     carries the business name the row ends up with (proven in contact-search-schema.test.ts).
--   client_groups.search_name: stored, generated from app.contact_name_fold(name) ('' for a blank name).
--   contacts_search_trgm: one GIN over search_name and the six columns the search's other clauses read (first_name,
--     last_name, email, phone, phone_key, phone_national), every column extensions.gin_trgm_ops, so each arm of the
--     search's OR can be a bitmap scan of this one index. client_groups_search_trgm: search_name and name.
--
-- GRANTS. app.contact_search_name: EXECUTE for authenticated and service_role (a stored generated column runs its
-- function as the WRITING role: 0106 plan correction 3), revoked from PUBLIC and anon by name (the default ACL grants
-- anon by name). No column grant: contacts and client_groups keep their table-level SELECT for authenticated, and
-- nothing writes a generated column. No definer (EXPECTED_DEFINERS stays 37); no client write changes (the digest in
-- proposals-drop.test.ts stays 49|e0df0cc230da2dce6fa93b26b43e6d46).
--
-- SEARCH PATHS. The function says set search_path = pg_catalog, pg_temp (the 0096 rule) and names app functions by
-- schema. The indexes name their operator class by schema, so no search_path decides which one is used.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each lock.
--   contacts: adding a stored generated column rewrites the table under ACCESS EXCLUSIVE, held to the end of the
--     file: every contact read and write waits for it. MEASURED on a real PostgreSQL 17.6 replica (pre = 0001-0107,
--     one account, laptop SSD, psql -1, three runs each): 10,000 contacts, the whole file 0.95 to 1.07 s (the contacts
--     rewrite 0.38 to 0.42 s, contacts_search_trgm 0.21 to 0.25 s); 50,000 contacts, the whole file 3.96 to 4.17 s
--     (the rewrite 2.41 to 2.71 s, the index 1.17 to 1.22 s). The search's own timings at 50,000 contacts per
--     account are in the spec (plan Task 12), not here, so this file stays fixed once it is applied.
--     Production held 53 contacts on 2026-10-31: no off-peak rule.
--   client_groups: the same rewrite, of a table production holds a handful of rows of.
--   Every contact insert, and every update of a name or a phone, computes search_name and updates the GIN index.
--
-- LOAD-BEARING. From plan Task 4 on, the app's contact search names search_name and phone_national in its filter;
-- the app merges only after this file is on production. Both search_name columns, like 0106's name_key, STORE
-- app.contact_name_fold's answer: PostgreSQL does not track function bodies, so a later create or replace of
-- app.contact_name_fold changes future writes only. Changing the fold means dropping and re-adding search_name and
-- name_key (a full rewrite) in the same migration.
--
-- ROLLBACK (roll the app back first):
--   drop index public.client_groups_search_trgm;
--   drop index public.contacts_search_trgm;
--   alter table public.client_groups drop column search_name;
--   alter table public.contacts drop column search_name;
--   drop function app.contact_search_name(text, text, text);
--   pg_trgm stays: nothing else depends on it, and removing it is a separate decision.
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The trigram operator classes.
create extension if not exists pg_trgm with schema extensions;

-- 2. The searched name. Three folds, the non-empty ones joined by one space; NULL when none.
create function app.contact_search_name(p_first text, p_last text, p_company text) returns text
language plpgsql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
declare
  v_first text := app.contact_name_fold(p_first);
  v_last text := app.contact_name_fold(p_last);
  v_company text := app.contact_name_fold(p_company);
  v text := '';
begin
  if v_first <> '' then
    v := v_first;
  end if;
  if v_last <> '' then
    v := case when v = '' then v_last else v || ' ' || v_last end;
  end if;
  if v_company <> '' then
    v := case when v = '' then v_company else v || ' ' || v_company end;
  end if;
  return nullif(v, '');
end $$;

revoke all on function app.contact_search_name(text, text, text) from public, anon;
grant execute on function app.contact_search_name(text, text, text) to authenticated, service_role;

-- 3. The stored names. Each alter table rewrites its table once.
alter table public.contacts
  add column search_name text generated always as (app.contact_search_name(first_name, last_name, company_name)) stored;
alter table public.client_groups
  add column search_name text generated always as (app.contact_name_fold(name)) stored;

comment on column public.contacts.search_name is
  'F-092 (0108): first, last and business name folded by app.contact_name_fold, joined by spaces. Search only.';
comment on column public.client_groups.search_name is
  'F-092 (0108): the group name folded by app.contact_name_fold. Search only.';

-- 4. The trigram indexes: every column a search clause reads.
create index contacts_search_trgm on public.contacts using gin (
  search_name extensions.gin_trgm_ops,
  first_name extensions.gin_trgm_ops,
  last_name extensions.gin_trgm_ops,
  email extensions.gin_trgm_ops,
  phone extensions.gin_trgm_ops,
  phone_key extensions.gin_trgm_ops,
  phone_national extensions.gin_trgm_ops
);
create index client_groups_search_trgm on public.client_groups using gin (
  search_name extensions.gin_trgm_ops,
  name extensions.gin_trgm_ops
);

-- CI project bootstrap. Run ONCE on the CI project, BEFORE its first push:
--
--   pnpm --filter @bis/db ci:sql supabase/bootstrap/ci-project.sql --allow-write
--   pnpm --filter @bis/db db:push:ci --dry-run      (must list 0001 ... 0050)
--   pnpm --filter @bis/db db:push:ci
--
-- Target: the bis-ci project, expected ref odnobiodsftffphuuosz, named by
-- BIS_CI_SUPABASE_REF. ci:sql refuses production (tlbkbmlrfafquucsmsmm) and
-- any ref that is not BIS_CI_SUPABASE_REF. NEVER run this on production: it
-- would change what every future production migration is granted.
--
-- ASCII only and no backslashes (the MCP apply path mangles them; see memory
-- bis-mcp-sql-escapes). ci:sql runs the whole file in one transaction and
-- commits, so a statement that fails leaves nothing behind; that is also why
-- this file carries no begin/commit of its own (ci:sql refuses them).
--
-- WHY. Migrations 0001-0017 (and 0033) create tables without a single GRANT.
-- They work in production only because production was created under
-- Supabase's older default privileges, which grant every new table, sequence
-- and function in public to anon, authenticated and service_role at CREATE
-- time. A project created today is not auto-exposed (config.toml, the
-- "auto-expose" note), so a straight push would leave service_role, which
-- bypasses RLS but NOT grants, unable to read the tables it seeds. Grants
-- attach at CREATE time, so the defaults must equal production's BEFORE the
-- push, not after it.
--
-- SOURCE. Production's pg_default_acl, the rows owned by role postgres, read
-- 2026-09-24 (plan step O2; .superpowers/sdd/prod-default-acl-2026-09-24.txt):
--
--   postgres | app     | f | {anon=X,authenticated=X,service_role=X}
--   postgres | public  | S | {postgres=rwU,anon=rwU,authenticated=rwU,service_role=rwU}
--   postgres | public  | f | {postgres=X,anon=X,authenticated=X,service_role=X}
--   postgres | public  | r | {postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}
--   postgres | storage | S | same as public S
--   postgres | storage | f | same as public f
--   postgres | storage | r | same as public r
--
-- "all" is exactly those letters on Postgres 17 (both projects run 17):
-- tables arwdDxtm (m is MAINTAIN, new in 17), sequences rwU, functions X.
-- The app row names no postgres grantee, so neither does its statement.
--
-- NOT HERE, on purpose: the supabase_admin and supabase_auth_admin rows.
-- They are platform-managed and expected identical on any new project; the
-- parity fingerprint's default_acl kind compares them rather than this file
-- asserting them.
--
-- AFTER RUNNING: ci:sql supabase/parity/fingerprint-detail.sql and compare
-- its default_acl rows with production's. If Supabase overrides or rejects
-- these defaults (the plan's assumption is that the new default is only a
-- default-ACL difference), use the plan's O5 fallback: push first, then
-- grant table by table from production's table_grant / column_grant rows.

-- The app schema is created by migration 0001 (create schema if not exists
-- app), which runs AFTER this file. A default privilege IN SCHEMA app needs
-- the schema to exist now; 0001's own "if not exists" then does nothing.
create schema if not exists app;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema storage
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage
  grant all on functions to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema app
  grant all on functions to anon, authenticated, service_role;

-- The brand-logos bucket. No migration creates it: it was made by hand on
-- production for M3 white-labeling (docs/superpowers/plans/2026-08-07-m3-
-- white-labeling.md, Task 1 Step 1). PUBLIC because a logo renders on
-- /f/<publicId> to anonymous visitors (packages/db/src/branding.ts,
-- brandLogoUrl). The db suite needs it too, not only e2e: demo-seed.test.ts
-- uploads a logo live.
--
-- Settings are production's, read 2026-09-24 13:42Z: public = true,
-- file_size_limit = 524288 (512 KiB), allowed_mime_types =
-- {image/png,image/jpeg,image/webp} -- in that order, because the parity
-- fingerprint compares the array as text. The three types are exactly the
-- ones branding.ts can name a file for (its EXT table). A bucket difference
-- is NOT an allowed one at parity: the upsert makes a re-run converge on
-- these values instead of failing, so any difference is a real finding.
-- ASSUMPTION (plan section 2): a hosted project accepts a direct insert into
-- storage.buckets. If it is refused, the whole file rolls back; create the
-- bucket in the dashboard (plan step D3) with these settings and re-run the
-- file without this statement.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('brand-logos', 'brand-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

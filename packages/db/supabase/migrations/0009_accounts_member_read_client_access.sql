-- Gap found in review of M2 Task 2: `accounts_member_read` (0001_tenancy.sql)
-- matches on the org claim directly --
--   using (clerk_org_id = app.jwt()->>'org_id')
-- -- rather than through app.current_account_id(), so it never picked up the
-- client_access_enabled gate that 0008 added to that function. The design
-- spec (docs/superpowers/specs/2026-08-02-m2-client-access-design.md §3.3)
-- claimed every tenant policy reads through current_account_id() and so all
-- of them inherit the switch; this policy was the one exception. A client
-- with client_access_enabled = false could still select their own accounts
-- row (id, name, clerk_org_id, status, timezone, created_at, the flag
-- itself) even though every other tenant table correctly returned nothing
-- for them. Not a cross-tenant leak -- still their own row -- but it broke
-- the "turning a client off cuts their database access" promise.
--
-- Fix: recreate the policy so it also requires the flag, matching the
-- app.current_account_id() rule directly instead of duplicating the org-id
-- comparison. New migration rather than editing 0008, which is already
-- applied to the dev database.
--
-- accounts_agency_all (0001_tenancy.sql) is untouched: the agency path is
-- app.is_agency() alone and must keep seeing every account regardless of
-- the flag.
drop policy if exists accounts_member_read on public.accounts;
create policy accounts_member_read on public.accounts
  for select to authenticated
  using (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled);

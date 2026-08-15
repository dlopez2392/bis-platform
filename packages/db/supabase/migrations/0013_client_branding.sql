-- M4c: a client edits their own branding.
--
-- Until now the branding write ran as SERVICE ROLE behind an agency-only
-- guard, so that guard was the only thing between a caller and any account's
-- branding. Fine while only the agency could reach it. M4c lets clients in,
-- which makes that guard load-bearing against untrusted callers -- the exact
-- shape of M1a's finding, where a client-controlled accountId fed a
-- service-role client (twelve latent IDORs, harmless only because no
-- non-agency role existed yet). The write moves to the RLS-enforced client
-- and the boundary is enforced twice.

-- ROW SCOPE. A client may update their own account's row, and only while
-- their access is switched on.
--
-- `using` decides which rows the update can see; `with check` decides what the
-- row is allowed to BECOME. Both are required: without the second, a client
-- could move their own row to another org.
--
-- accounts_agency_all (0001) is untouched -- it is app.is_agency() alone, so
-- one action serves both roles and each is covered by its own policy.
create policy accounts_member_update on public.accounts
  for update to authenticated
  using      (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled)
  with check (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled);

-- COLUMN SCOPE, and this half is not defensive -- it is the point.
--
-- An UPDATE policy is ROW-scoped, not column-scoped. Measured before writing
-- this: role `authenticated` already holds UPDATE on ALL SIXTEEN columns of
-- public.accounts, including client_access_enabled, name, clerk_org_id and
-- agency_id. That is harmless TODAY only because no policy lets a client
-- update any row at all, so every such update matches nothing. The policy
-- above makes those privileges live on the client's own row: without the
-- revoke below, a client could switch their own client_access_enabled back on
-- after the agency turned it off, and rewrite `name`, which is the agency's
-- private label for them.
--
-- Safe for the agency: createAccount, setClientAccess and the previous-logo
-- read all run as service_role, which is subject to neither column grants nor
-- RLS. Verified by reading every accounts write in packages/db/src and every
-- caller in apps/web/src, not assumed.
--
-- ⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves
-- for the agency and silently fails for clients.
-- client-branding-grants.test.ts asserts this set EXACTLY, in both directions.
revoke update on public.accounts from authenticated;
grant update (brand_name, brand_logo_path, brand_color,
              brand_neutral, brand_corners, brand_type, brand_mode)
  on public.accounts to authenticated;

-- Client access is off for every existing account, so shipping M2 changes
-- nothing for the agency on day one.
alter table public.accounts
  add column client_access_enabled boolean not null default false;

-- The switch is enforced in Postgres, not only in the UI. Every tenant policy
-- reads through this function, so all of them inherit the flag from this one
-- change, and a policy added later inherits it without anyone remembering to.
--
-- Agency access is unaffected: policies are
--   app.is_agency() or account_id = app.current_account_id()
-- and is_agency() short-circuits before this branch is evaluated.
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts
  where clerk_org_id = app.jwt()->>'org_id'
    and client_access_enabled
$$;

-- 0072_company_name_read_only.sql - the business name becomes a read-only copy (S-02 follow-up G9)
-- (docs/superpowers/specs/2026-10-11-client-groups-design.md, G9 and section 11, "The follow-up release")
--
-- Since 0069, contacts.company_name is a copy of the contact's business group name, kept by the sync
-- trigger (0069 section 6), and no app code writes it. This release closes the column to everyone else:
-- the client role loses UPDATE (company_name) (granted by 0053:138), a before insert or update trigger
-- puts any direct write back to the derived value, so only the sync decides it, and the backfill
-- reconcile_business_groups() is dropped after one last run. The column is KEPT (owner ruling 13.1):
-- the contact list sorts and pages on it.
--
-- Who is reset: every role, service_role and the table owner included. The trigger checks no role, so
-- a server path that still writes the column is undone, not trusted. The sync itself writes exactly
-- the derived value, so its own UPDATE passes through unchanged.
-- What is kept (owner ruling 2026-10-12): a stored value the sync never set (an over-long name reconcile
-- skipped, 0069 section 8) survives every UPDATE that does not change company_name, including one that
-- sets the same value again. It is replaced by a write that changes the column, by a business
-- membership change, and by ANY upsert that sets company_name, even one sending the stored value back:
-- the upsert's INSERT half resets excluded.company_name first, so its UPDATE half sees a change. No app
-- code upserts contacts.
-- ASCII only, no backslash anywhere (0050's rule; the MCP apply has mangled escapes before).
--
-- APPLY ORDER: only after the post-deploy reconcile #2 (0069 header) has run on BOTH projects. Then the
-- CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP apply_migration),
-- then the parity check, then merge. Section 3 runs the reconcile once more inside this transaction,
-- after the trigger holds the table, so a write that landed between reconcile #2 and the apply is
-- folded in, not stranded.
--
-- ROLLBACK (the app needs no revert: it writes the group, never the column):
--   drop trigger contacts_company_name_derived on public.contacts;
--   drop function app.company_name_derived();
--   grant update (company_name) on public.contacts to authenticated;
--   then, only if a reconcile is needed again, run 0069_client_groups.sql's section 8 (its whole
--   "create function public.reconcile_business_groups" statement, verbatim) and:
--   revoke all on function public.reconcile_business_groups(uuid) from public, anon, authenticated, service_role;
--   grant execute on function public.reconcile_business_groups(uuid) to service_role;
--   Section 3's last reconcile may have created business groups, linked, relinked or unlinked
--   memberships and respelled columns. Those repairs persist after a rollback; they are what reconcile
--   #2 would have done for the same writes. Nothing else in this file changes data.

set local lock_timeout = '5s';

-- 1. The client role's direct write goes (anon never held one; the guard test pins both).
revoke update (company_name) on public.contacts from authenticated;

-- 2. Every other direct write is put back. SECURITY DEFINER: app.company_name_for is executable by
--    service_role only (0069 section 9), and a client-role INSERT carrying company_name fires this too.
--    It reads only the contact's own memberships and writes only NEW. The UPDATE test is
--    "is not distinct from", and tg_op is never NULL, so no branch can be skipped on a NULL
--    (memory bis-plpgsql-null-guard). On INSERT a NULL needs no lookup: a new contact has no
--    memberships yet. An upsert that lands on an existing row and sets company_name always ends at the
--    derived value: its INSERT half resets excluded.company_name to it (or leaves a NULL), so the UPDATE
--    half sees a change from any value the sync never set, even when the upsert sent that value back.
create function app.company_name_derived() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.company_name is not distinct from old.company_name then
    return new;
  end if;
  if tg_op = 'INSERT' and new.company_name is null then
    return new;
  end if;
  new.company_name := app.company_name_for(new.id);
  return new;
end $$;
create trigger contacts_company_name_derived
  before insert or update of company_name on public.contacts
  for each row execute function app.company_name_derived();

revoke all on function app.company_name_derived() from public, anon, authenticated, service_role;
grant execute on function app.company_name_derived() to service_role;

-- 3. The last reconcile, then the function goes. The trigger above already holds the table, so nothing
--    can write the column between this run and the drop. Every helper it called is shared with the
--    write functions (lock_contact, find_or_create_business, link_member, promote_primary,
--    company_name_for, group_name_key, group_ws) and stays.
select public.reconcile_business_groups();
drop function public.reconcile_business_groups(uuid);

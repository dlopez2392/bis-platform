-- `concierge_enable` must refuse a form that belongs to another account.
--
-- THE HOLE, as 0044 shipped it. The function set
--   concierge_form_id = p_form_id where account_id = p_account_id
-- The account scope was on the PROFILE, never on the FORM.
-- `voice_profiles_concierge_form_id_fkey` requires only that the form EXIST —
-- it carries no account predicate — and every caller reaches this through
-- `serviceDb()`, so RLS never sees the statement either.
--
-- WHAT THAT COSTS, concretely: enable account A's concierge with a form id
-- owned by account B, and `getVoiceProfileByPublicId` hands the turn route
-- `{account_id: A, concierge_form_id: B's form}`. A visitor on A's website
-- then has their lead filed against B's form — which means B's
-- `notify_emails` receive A's customer's name, phone and message. That is a
-- cross-tenant leak of exactly the data this product exists to protect, with
-- no error on any surface.
--
-- Nothing calls `enableConcierge` yet; the Settings toggle that will is still
-- unbuilt. Closing it here means that toggle cannot introduce it.
--
-- WHY THE GUARD IS IN SQL RATHER THAN THE ACCESSOR. `concierge.ts` states the
-- principle itself: "both conditions are in the query rather than checked by
-- the caller, so a second caller cannot forget one." A read-then-write check
-- in TypeScript also opens a window between the check and the update. One
-- statement, one truth.
--
-- WHY plpgsql AND NOT sql. The two failure modes must stay distinguishable.
-- Folding the form check into the UPDATE's WHERE would match no row and
-- return null — which is already the signal for "this account has no
-- voice_profiles row", a normal state for an account that never saved voice
-- settings. A caller could not tell "set up your persona first" from "that
-- form is not yours". So the cross-tenant case RAISES (42501, the privilege
-- code, because that is what it is) and the missing-profile case still
-- returns null.
--
-- `create or replace` deliberately, NOT drop-and-create: replace PRESERVES the
-- function's ACL, while DROP + CREATE resets it to this project's defaults,
-- which grant EXECUTE to `anon` and `authenticated` by name (the 0043 trap).
-- The grants are re-asserted at the bottom anyway, because relying on that
-- without checking is how 0043 happened.
create or replace function public.concierge_enable(
  p_account_id uuid, p_form_id uuid, p_new_public_id text
) returns text language plpgsql as $fn$
declare
  v_public_id text;
begin
  if not exists (
    select 1 from public.forms
     where id = p_form_id and account_id = p_account_id
  ) then
    raise exception 'concierge_enable: form does not belong to this account'
      using errcode = '42501';
  end if;

  update public.voice_profiles
     set public_id = coalesce(public_id, p_new_public_id),
         concierge_enabled = true,
         concierge_form_id = p_form_id
   where account_id = p_account_id
  returning public_id into v_public_id;

  -- Null when the account has no voice_profiles row. A real state, not an
  -- error: an account that has never saved voice settings has no persona to
  -- embed, and the caller says so.
  return v_public_id;
end;
$fn$;

revoke all on function public.concierge_enable(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.concierge_enable(uuid, uuid, text) to service_role;

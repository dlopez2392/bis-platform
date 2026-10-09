-- 0063_go_live.sql
-- Going live is ONE transaction (D-043), and an account holds at most one
-- active number.
--
-- 1. public.go_live(p_account_id, p_phone_number_id, p_actor_id)
--
-- WHY. goLiveAction (apps/web/.../setup/actions.ts) made two separate writes
-- through PostgREST, each its own transaction: upsertVoiceProfile(enabled:
-- true), then setPhoneNumberStatus(live), each followed by its own event
-- insert (packages/db/src/voice.ts). A failure after the first left the
-- profile enabled and the number still 'testing'. The incoming route answers
-- a 'testing' number once the profile is enabled, so real callers reached the
-- receptionist while text-back had no live number to send from and Setup's
-- go-live step still read "To do". This function makes all four writes one
-- statement: either every one lands or none does.
--
-- WHAT IT DOES, in the order the app did it:
--   * refuses a missing or blank actor (22004). Every event names who did it.
--   * refuses when the account holds a non-released number OTHER than the one
--     named (P0001). go_live never chooses which number is THE number; while
--     section 2's index stands this cannot fire, and it is here so the
--     function does not depend on an index for the invariant it relies on.
--   * enables the profile; refuses when the account has none (P0002). The app
--     used to INSERT a profile in that case (upsert), but go-live's own
--     prerequisites require a profile with a greeting, so a missing one means
--     the re-check raced a delete, and inventing an empty profile would be
--     wrong.
--   * sets the number live, scoped to THIS account and refusing a released
--     number (P0002, one message for both: from here a number on another
--     account and a number that does not exist must look the same).
--   * appends voice_profile.updated {fields: [enabled]} and then
--     phone_number.status_changed {phoneNumberId, status: live}, actor_type
--     'user', actor_id p_actor_id: byte-for-byte what upsertVoiceProfile and
--     setPhoneNumberStatus emit for this call (jsonb is canonical, so key order
--     cannot differ). Two inserts, so the event ids keep the app's order.
--   * stamps updated_at with now(), the database's clock, as 0060 does.
--   Any raise rolls back every write before it (the profile update included):
--   one statement, one transaction under PostgREST.
--
-- SECURITY INVOKER with an empty search_path (0060's shape for a service-only
-- function). service_role already holds UPDATE on voice_profiles and
-- phone_numbers and INSERT on events, so the function can do nothing
-- serviceDb() could not, and there is no definer-side guard standing in for
-- RLS that a NULL could open (no app.is_agency() anywhere in it). EXECUTE is
-- service_role's alone: goLiveAction calls it through serviceDb() after its
-- own agency check. Default privileges grant EXECUTE to anon, authenticated
-- and service_role BY NAME, so the revoke names them (0043's lesson).
--
-- 2. phone_numbers_one_active_per_account
--
-- A partial unique index: at most one row per account whose status is not
-- 'released'. The setup wizard, go-live and the SMS sender all assume one
-- active number per account (the sender silently picked the oldest live one;
-- D-042), and the two app-side checks that keep it (moveNumberAction,
-- moveNumberToAccountAction) are read-then-write. The index makes it true for
-- every writer: assignNumberAction on an occupied account and un-releasing a
-- former number while another holds the slot now fail with 23505, which both
-- actions already report as a failed save. A released number is a FORMER
-- number and never holds the slot. Checked READ-ONLY before writing this
-- file (2026-10-09 ~02:07Z): zero accounts with more than one non-released
-- number on bis-ci and on production. preflight.sql re-checks it, because the
-- create fails (and with it this whole file) if one has appeared since.
--
-- APPLY ORDER: 0062_email_suppression must reach production before this file
-- (it is on bis-ci already). Then bis-ci, then production, then
-- notify pgrst, 'reload schema' on each, then parity, and only then the merge
-- deploy: the build after this file calls go_live on every go-live, and an rpc
-- to a function PostgREST does not know fails (PGRST202). ADDITIVE for the old
-- build, which never calls the function; the index binds it too (see above).
--
-- No backslash and no non-ASCII byte anywhere in this file (the MCP apply
-- rule).
--
-- ROLLBACK (roll the app back first):
--   drop function public.go_live(uuid, uuid, text);
--   drop index public.phone_numbers_one_active_per_account;

create unique index phone_numbers_one_active_per_account
  on public.phone_numbers (account_id) where status <> 'released';

comment on index public.phone_numbers_one_active_per_account is
  'At most one non-released number per account (0063). A released number is a former number and never holds the slot. Every surface that asks "what is this account''s number" (setup, go-live, the SMS sender) relies on this.';

create function public.go_live(p_account_id uuid, p_phone_number_id uuid, p_actor_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_id is null or pg_catalog.btrim(p_actor_id) = '' then
    raise exception 'go_live: an actor is required' using errcode = '22004';
  end if;

  if exists (
    select 1 from public.phone_numbers
     where account_id = p_account_id
       and status <> 'released'
       and id is distinct from p_phone_number_id
  ) then
    raise exception 'go_live: this account has another active number' using errcode = 'P0001';
  end if;

  update public.voice_profiles
     set enabled = true, updated_at = pg_catalog.now()
   where account_id = p_account_id;
  if not found then
    raise exception 'go_live: this account has no voice profile' using errcode = 'P0002';
  end if;

  update public.phone_numbers
     set status = 'live', updated_at = pg_catalog.now()
   where id = p_phone_number_id
     and account_id = p_account_id
     and status <> 'released';
  if not found then
    raise exception 'go_live: no such number on this account, or it was released' using errcode = 'P0002';
  end if;

  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'voice_profile.updated', 'user', p_actor_id,
          pg_catalog.jsonb_build_object('fields', pg_catalog.jsonb_build_array('enabled')));

  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'phone_number.status_changed', 'user', p_actor_id,
          pg_catalog.jsonb_build_object('phoneNumberId', p_phone_number_id, 'status', 'live'));
end;
$$;

comment on function public.go_live(uuid, uuid, text) is
  'Takes an account live in one transaction (0063, D-043): enables its voice profile, sets the named number live (this account only, never a released one), and appends voice_profile.updated and phone_number.status_changed exactly as upsertVoiceProfile and setPhoneNumberStatus emit them. Raises, writing nothing, on a missing actor (22004), another active number on the account (P0001), no voice profile (P0002), or a number not on this account or released (P0002). Called only by goLive (packages/db/src/voice.ts) as service_role.';

revoke all on function public.go_live(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.go_live(uuid, uuid, text) to service_role;

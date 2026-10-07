-- 0060_alert_phone_consume_db_clock.sql
-- Consuming an alert-phone code stamps the DATABASE's clock (D-107).
--
-- WHY. 0036's alert_phone_verifications_consumed_check is
--   consumed_at is null or (consumed_at >= created_at and consumed_at <= expires_at)
-- and created_at / expires_at are the database's now(). verifyAlertPhoneCode
-- (packages/db/src/alert-phone-verification.ts) stamped consumed_at with the
-- APP server's new Date(). Two clocks, one comparison: a server clock even
-- milliseconds behind the database's put consumed_at before created_at, and
-- the CHECK refused a genuine code ("verifyAlertPhoneCode consume failed: ...
-- violates check constraint"). It turned CI red on 2026-10-06 (run
-- 37517575687, four tests in alert-phone-verification-flow.test.ts that
-- create and consume within milliseconds); in production it could refuse a
-- real code typed quickly, and near expires_at a FAST server clock could
-- stamp past the deadline, the CHECK's other half.
--
-- 0036's own comment on that CHECK names the condition it depends on: it
-- "binds only if the caller stamps the real time." So the caller stops
-- stamping. This function does, with now(), the clock that wrote the row.
-- Clamping the app's timestamp up to created_at would be exactly the fake
-- timestamp that comment warns about, and is not done.
--
-- WHAT IT DOES. One UPDATE, the same compare-and-swap the app sent, with the
-- stamp moved into the database:
--   * where id = p_id and consumed_at is null: unchanged. A second consume of
--     the same row touches nothing and returns false, which the caller
--     reports as "expired" (raced; nothing left to prove).
--   * and expires_at > now(): new, and the same clock again. The app's
--     lookup filters expires_at against ITS clock; a slow app clock can hand
--     over a row the database already calls expired. Without this clause the
--     stamp would land past expires_at and the CHECK would raise, which the
--     caller reports as an error (a failed page) instead of "expired". With
--     it, every row this clause refuses is one the CHECK would also have
--     refused (now() > expires_at); the only other value it excludes is
--     now() = expires_at to the microsecond. It never consumes anything the
--     old statement would not have.
--   * now() in both places is ONE value (transaction time), so a row this
--     function stamps always satisfies consumed_at <= expires_at, and
--     consumed_at >= created_at because the row was committed by an earlier
--     transaction (the caller had to read it before calling). The only way
--     left to trip the CHECK is the database's own clock stepping backwards,
--     which raises rather than consuming: the safe direction.
--   Returns true when it consumed the row, false otherwise. The attempts cap
--   is not re-checked here because the statement it replaces did not check
--   it either; the lookup that found this row did.
--
-- WHY A FUNCTION, NOT A TRIGGER. A BEFORE UPDATE trigger forcing consumed_at
-- := now() would fix every writer, but the app would still send a timestamp
-- the database silently replaces (code that reads as stamping app time and
-- does not), and the near-deadline case would still surface as a CHECK
-- error rather than "expired", because PostgREST cannot filter on the
-- database's now(). One explicit statement owns both decisions.
--
-- SECURITY INVOKER with an empty search_path (0055/0057's shape for a
-- service-only function). It writes with service_role's own grant on the
-- table (0036: select, insert, update, delete to service_role, nothing to
-- anon or authenticated), so it can do nothing service_role could not
-- already do, and there is no definer-side check standing in for RLS that a
-- NULL could open. EXECUTE is service_role's alone: the verify path is
-- serviceDb() behind requireAgencyOnlyAccountAccess (0036 Decision 5), and
-- default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
--
-- ADDITIVE ONLY. The build before this file never calls the function and
-- keeps working unchanged against a database that has it. The build after
-- it calls it on every correct code, and an rpc to a function PostgREST does
-- not know fails (PGRST202) and the verify page errors. APPLY ORDER: the CI
-- project first, then production, then notify pgrst, 'reload schema', and
-- only then the merge deploy.
--
-- No backslash and no non-ASCII byte anywhere in this file (the MCP apply
-- rule).
--
-- ROLLBACK (roll the app back first; the build after this file calls the
-- function on every correct code):
--   drop function public.consume_alert_phone_verification(uuid);

create function public.consume_alert_phone_verification(p_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with consumed as (
    update public.alert_phone_verifications
       set consumed_at = pg_catalog.now()
     where id = p_id
       and consumed_at is null
       and expires_at > pg_catalog.now()
    returning id
  )
  select exists (select 1 from consumed);
$$;

comment on function public.consume_alert_phone_verification(uuid) is
  'Consumes one alert-phone verification row (0060, D-107): sets consumed_at = now() where id = p_id, consumed_at is null and expires_at > now(); true if it consumed the row, false otherwise (already consumed, expired by the database clock, or no such row). The database stamps consumed_at so 0036 consumed_check compares one clock with itself. Called only from verifyAlertPhoneCode (packages/db/src/alert-phone-verification.ts) as service_role.';

revoke all on function public.consume_alert_phone_verification(uuid) from public, anon, authenticated, service_role;
grant execute on function public.consume_alert_phone_verification(uuid) to service_role;

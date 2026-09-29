-- 0056_messaging_profile.sql
-- Consent chain PR-2, plan Task 7 (danlo's answer to Q3). Each texting
-- business's OWN Telnyx messaging profile, recorded by the agency on the A2P
-- card once step 0 is done on Telnyx. Spec section 5: one profile per
-- texting account is a go-live precondition, because Telnyx blocks a STOP at
-- the profile (every number on it) and a profile has one reply text. The app
-- refuses to text for an approved account until this is set
-- (lib/sms/sender.ts), and no two accounts can record the same profile.
--
-- Agency-written through serviceDb only: 0013 and 0053 grant `authenticated`
-- UPDATE on named branding columns of accounts, and this column is not one of
-- them (schema-grants-guard.test.ts pins that list, unchanged).
--
-- ADDITIVE ONLY: the build before this file never reads the column.
-- No backslash anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first):
--   drop index public.accounts_telnyx_messaging_profile_id_key;
--   alter table public.accounts drop column telnyx_messaging_profile_id;

set local lock_timeout = '5s';

alter table public.accounts add column telnyx_messaging_profile_id text
  constraint accounts_telnyx_messaging_profile_id_check check (
    telnyx_messaging_profile_id is null
    or telnyx_messaging_profile_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

create unique index accounts_telnyx_messaging_profile_id_key
  on public.accounts (telnyx_messaging_profile_id) where telnyx_messaging_profile_id is not null;

comment on column public.accounts.telnyx_messaging_profile_id is
  'This business''s own Telnyx messaging profile (a uuid), recorded on the A2P card after step 0. Texting is refused while it is null, and no two accounts share one. Agency-written through serviceDb only.';

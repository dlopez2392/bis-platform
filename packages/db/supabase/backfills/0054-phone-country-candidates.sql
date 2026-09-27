-- Consent chain PR-1, the 0054 phone-country backfill: the READ half.
--
-- READ ONLY. Run AFTER the merge deploy (review R1-I1), because until then
-- the old build stores any ten digits as +1. Each row carries created_at and
-- its last write (updated_at) as UTC ISO text; the CLI decides who wrote the
-- number from created_at and the stored shape (byWriter), never from
-- updated_at alone, which moves on a write to any field.
-- It lists every contact whose stored number is a ten-digit
-- reading (a +1 number or bare ten digits: phone_key has ten digits), OR
-- whose phone TEXT carries an extension marker (review I5: an extension's
-- digits fold INTO phone_key, so "+1 551 234 5613 ext 12" keys at 13 digits,
-- never 10 -- Task 2's normalisePhone strips the extension and reads these as
-- a confirmed +1 today, so this backfill is the only thing that can still
-- flag one), that is not flagged yet, and that the SAME account has never
-- seen inbound: not the caller of a call (calls.caller_e164, folded the way
-- phone_key folds), and not the contact of an inbound text (the inbound
-- route files a text under the contact its sender's number matched, so the
-- conversation is the record). Spec 4.1 item 1: "unless the same account has
-- seen it as the caller or sender of an inbound call or text".
--
-- Whether a number COULD BE MEXICAN is not decidable in SQL (it needs
-- libphonenumber's metadata); `pnpm --filter @bis/db backfill:phone-country`
-- reads this file's output and decides. Run on the CI project with
-- `pnpm --filter @bis/db ci:sql supabase/backfills/0054-phone-country-candidates.sql`,
-- on production only with danlo's go, through execute_sql.
--
-- ASCII only, no backslash (memory bis-mcp-sql-escapes); ci:sql's read gate
-- passes it (src/ci/sql-files.test.ts).
select c.id, c.account_id, c.phone, c.phone_key,
       to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_written_at,
       to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
from public.contacts c
where c.phone is not null
  and c.phone_country_unconfirmed = false
  and (
    c.phone_key ~ '^[0-9]{10}$'
    or (
      c.phone_key ~ '^[0-9]{10,}$'
      and c.phone ~* '[[:space:],.-]*(ext[.]?|extension|[x#])[[:space:].:-]*[0-9]+[.]?[[:space:]]*$'
    )
  )
  and not exists (
    select 1
    from public.calls k
    where k.account_id = c.account_id
      and k.caller_e164 is not null
      and (case
             when length(regexp_replace(k.caller_e164, '[^0-9]', '', 'g')) = 11
              and left(regexp_replace(k.caller_e164, '[^0-9]', '', 'g'), 1) = '1'
             then substr(regexp_replace(k.caller_e164, '[^0-9]', '', 'g'), 2)
             else regexp_replace(k.caller_e164, '[^0-9]', '', 'g')
           end) = c.phone_key
  )
  and not exists (
    select 1
    from public.conversations v
    join public.messages m on m.conversation_id = v.id and m.account_id = v.account_id
    where v.account_id = c.account_id
      and v.contact_id = c.id
      and m.channel = 'sms'
      and m.direction = 'inbound'
      and m.created_at >= c.updated_at
  )
order by c.account_id, c.id;

-- 0049-fold-count.sql
-- Consent chain PR-3 (plan Task 2; run in Task 15 step 3). READ ONLY.
-- What the 0049 fold would write, and what it widens (choice 24), before
-- anything is written: one row of counts, no customer named. Run on
-- production through execute_sql under danlo's go. ASCII only, no backslash
-- (the MCP rule). The address rule is emailLedgerAddress's (packages/db/src/
-- consent.ts): whitespace trimmed, lowercased, 3 to 254 characters, an @
-- after the first character; restricted here to printable ASCII, so any
-- other address is counted as left_out_needs_a_look and never written.
with opted as (
  select c.id, c.account_id, c.marketing_email_opted_out_at as at,
         lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) as address
    from public.contacts c
   where c.marketing_email_opted_out_at is not null
), judged as (
  select o.*,
         coalesce(o.address <> ''
           and char_length(o.address) between 3 and 254
           and position('@' in o.address) > 1
           and o.address !~ '[^ -~]', false) as valid
    from opted o
), foldable as (
  -- EXACTLY the write's rule (0049-fold-write.sql's valid CTE): a valid
  -- address AND a stamp that is not in the future (0055 raises on one).
  select * from judged where valid and at <= now()
), folded as (
  select distinct account_id, address from foldable
)
select
  (select count(*) from judged) as opted_out_contacts,
  (select count(*) from judged where address is null or address = '') as no_email,
  (select count(*) from judged where not valid and address is not null and address <> '') as left_out_needs_a_look,
  (select count(*) from folded) as to_fold_addresses,
  (select count(distinct account_id) from folded) as accounts,
  (select count(*) from folded f
    where exists (select 1 from public.consent_events e
                   where e.account_id = f.account_id and e.channel = 'email' and e.address = f.address
                     and e.action in ('revoked', 'held', 'hold_released', 'resubscribed'))) as already_stopped_or_decided,
  (select count(*) from public.contacts c
     join folded f on f.account_id = c.account_id
                  and f.address = lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)))
    where c.marketing_email_opted_out_at is null) as other_contacts_sharing_an_address,
  (select count(*) from folded f
    where exists (select 1 from public.bookings b
                    join public.contacts c on c.id = b.contact_id and c.account_id = b.account_id
                   where b.account_id = f.account_id and b.status = 'booked'
                     and b.starts_at between now() and now() + interval '30 days'
                     and lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) = f.address)) as with_a_booking_in_30_days,
  -- Skipped by the write (never folded while in the future); a later run
  -- folds each once its time has passed.
  (select count(*) from judged where at > now()) as future_stamps,
  has_function_privilege(current_user,
    'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)',
    'EXECUTE') as can_write;

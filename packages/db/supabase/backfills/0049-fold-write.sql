-- 0049-fold-write.sql
-- Consent chain PR-3 (plan Task 2; run in Task 15 steps 5 and 8). ONE
-- statement, so execute_sql shows its whole answer: one row per outcome.
-- Folds every 0049 "No marketing emails" stamp into the ledger as
-- revoked / backfill_0049 (spec 4.3, choice 24), ONE row per account and
-- address, dated at the EARLIEST stamp among that account's contacts with
-- that address, through 0055's function (the ledger's one write path). Guard
-- 'none': 0055 refuses a backfill_0049 stop over ANY existing stop whatever
-- the guard, so an address the customer already stopped answers 'refused'.
-- source_ref names ONE event, the stamp at its own instant (spec 3, PR-2
-- S10), so a re-run answers 'duplicate' and writes nothing. The address rule
-- is 0049-fold-count.sql's (emailLedgerAddress, printable ASCII only).
-- ASCII only, no backslash (the MCP rule). No transaction control.
with opted as (
  select c.id, c.account_id, c.marketing_email_opted_out_at as at,
         lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) as address
    from public.contacts c
   where c.marketing_email_opted_out_at is not null
), valid as (
  select distinct on (o.account_id, o.address) o.id, o.account_id, o.address, o.at
    from opted o
   where o.address <> ''
     and char_length(o.address) between 3 and 254
     and position('@' in o.address) > 1
     and o.address !~ '[^ -~]'
     and o.at <= now()
   order by o.account_id, o.address, o.at asc, o.id asc
)
select r.outcome, count(*)::int as n
  from valid v
  cross join lateral public.append_consent_event(
    v.account_id, 'email', v.address, 'revoked', 'backfill_0049', 'none', null,
    v.id, null, null,
    'contact:' || v.id::text || ':0049:' || to_char(v.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    jsonb_build_object('column', 'contacts.marketing_email_opted_out_at', 'contactId', v.id::text),
    v.at) r
 group by r.outcome
 order by r.outcome;

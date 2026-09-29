-- 0055-telnyx-optout-owners.sql (consent chain PR-2, plan Task 3)
-- READ ONLY. Every number this platform has ever held, with the account it
-- belongs to, for the Telnyx opt-out backfill: an opt-out row names the
-- business's number in `from` (plan F10), and this maps it to an account.
-- Every status is listed (a released number's opt-outs are still reported,
-- never written, if its row's account no longer texts). No customer number is
-- read here.
select p.e164, p.account_id, p.status
  from public.phone_numbers p
 order by p.e164;

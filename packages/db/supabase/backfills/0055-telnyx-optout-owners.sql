-- 0055-telnyx-optout-owners.sql (consent chain PR-2, plan Task 3)
-- READ ONLY. Every number this platform has ever held, with the account it
-- belongs to, for the Telnyx opt-out backfill: an opt-out row names the
-- business's number in `from` (plan F10), and this maps it to an account.
-- Every status is listed, including released: a released number's opt-outs
-- are still written (orchestrator decision I3, 2026-09-28). The customer
-- told THAT business to stop, and that fact does not un-happen when the
-- business later releases the number. No customer number is read here.
select p.e164, p.account_id, p.status
  from public.phone_numbers p
 order by p.e164;

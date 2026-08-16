-- Where a reply goes.
--
-- Everything this platform sends goes out FROM crm@bis-rgv.com, so every reply
-- to a client's outbound email lands in the BIS mailbox and the client never
-- sees it. `replyTo` has been typed and passed to Resend since M1b with no
-- caller populating it; this column is the missing half.
--
-- Nullable, no default. Every existing account starts unset, and unset is a
-- documented state rather than a gap: the send path omits the header entirely,
-- which is exactly the behaviour today.
alter table public.accounts add column reply_to_email text;

-- 0013 revoked UPDATE on public.accounts from `authenticated` and granted it
-- back on a named list, because an UPDATE policy is ROW-scoped and never
-- column-scoped. That file's own warning is what this line answers:
--
--   "⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves
--    for the agency and silently fails for clients."
--
-- The agency writes through the service role, which is bound by neither column
-- grants nor RLS, so omitting this would produce a bug the agency cannot see
-- and the client cannot get around: their write is FILTERED, not rejected, so
-- it reports success and changes nothing.
--
-- `grant update (col)` is additive -- it does not disturb the seven columns
-- 0013 granted. client-branding-grants.test.ts asserts the resulting set
-- EXACTLY, in both directions.
grant update (reply_to_email) on public.accounts to authenticated;

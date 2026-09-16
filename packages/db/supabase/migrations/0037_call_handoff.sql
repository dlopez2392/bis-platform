-- 0037_call_handoff.sql
-- A number to reach a person on, and a way to find the call again.
--
-- Today a caller who asks for a human is offered a message and a callback.
-- That is the whole of it: `take_message` records what they said, the
-- text-back leg says sorry we missed you, and nobody's phone rings. The
-- product has never had a path where the call reaches a person, and the
-- reason is entirely this layer — there is nowhere to put the business's own
-- number, and nothing on a `calls` row that a second request could use to
-- find the call that is still in flight.
--
-- This migration adds exactly those three facts and one word of vocabulary.
-- It changes NO behaviour: nothing in the tree writes `transfer_phone`,
-- nothing sets a `handoff_token`, and nothing classifies a call
-- `transferred`. The routes that do arrive later and build on these.
--
-- Four changes, each with its own reasoning below:
--   1. `accounts.transfer_phone`     — where a handed-off call goes.
--   2. `calls_outcome_check`         — a sixth legal outcome.
--   3. `calls.handoff_token` / `calls.handoff_requested_at`.
--   4. Grants — and, as in 0035, the ABSENT ones are the control.


-- ─────────────────────────────────────────────────────────────────────────
-- 1. `accounts.transfer_phone` — ONE number, nullable, and the field IS the
--    switch.
--
-- The same scalar-not-array shape 0035 chose for `alert_phone`, and for a
-- reason that is stronger here rather than merely analogous: an alert is a
-- notification and could sensibly fan out, but a transfer is a CONNECTION.
-- Two destinations for one caller is not a richer feature, it is a hunt
-- group — ring order, no-answer timeouts, voicemail fallback — and none of
-- that is decidable in a column. One number, and the day a hunt group is a
-- real requirement it gets a table and a product decision, not an array
-- quietly widened underneath the dial path.
--
-- NULL means this account offers no transfer, and that is NOT a failure: it
-- is the state every account in this database is in at the moment this
-- migration runs, and the state most of them will stay in. `report_emails`
-- (0031) and `alert_phone` (0035) both record the same idea in their own
-- comments — the field is the on/off switch, so there is no second flag to
-- fall out of step with it.
--
-- THE CHECK IS `phone_numbers_e164_check`'s REGEX, CHARACTER FOR CHARACTER.
-- Copied, not re-derived. This platform has exactly one definition of "a
-- number we can reach" and a second dialect of it would mean a number this
-- column accepts and the dial path cannot ring — the same argument 0035
-- makes at length, which applies here verbatim because it is the same
-- question about the same kind of value. `toE164`
-- (apps/web/src/lib/voice/phone-number.ts) remains the single normaliser:
-- every non-null value it can produce satisfies this constraint and every
-- value it rejects fails it, so the rule for any caller is one line — store
-- `toE164(input)`, store NULL when it returns null, never the raw string.
--
-- The empty string is refused, and that is load-bearing rather than tidy. A
-- blank settings field posts "", and "" is exactly what gives "off" a second
-- spelling: `if (account.transferPhone)` would read it as off while
-- `transfer_phone is not null` reads it as on, and the in-call decision and
-- the settings screen would disagree about the same row. NULL is the only
-- "off" this column can hold. Callers must write NULL, never "".
--
-- Whitespace is refused too, with no trim() anywhere near it — 0033 and 0034
-- are the record of what a normalising column costs, because it acquires a
-- TypeScript twin that must agree with it on every input and a tab-padded
-- value silently got a different answer on each side. A column that REFUSES
-- has no twin to disagree with.
--
-- WHAT THIS DOES NOT CLAIM, stated so nobody reads more into it: that the
-- number will be answered. A shape check cannot know whether anybody picks
-- up, whether the line is a fax, or whether the business closed at five. The
-- call path has to handle no-answer on its own, and this constraint has
-- nothing to say about it.
alter table public.accounts
  add column transfer_phone text
    constraint accounts_transfer_phone_check
    check (transfer_phone is null or transfer_phone ~ '^\+[0-9]{8,15}$');

comment on column public.accounts.transfer_phone is
  'Where a caller who asks for a person is connected. NULL = this account offers no transfer, and that is not a failure. E.164 only, the same shape as phone_numbers.e164. Agency-written through serviceDb(): authenticated has SELECT but deliberately no UPDATE.';


-- ─────────────────────────────────────────────────────────────────────────
-- 2. A SIXTH OUTCOME: `transferred`.
--
-- The five outcomes 0019 shipped describe what the RECEPTIONIST produced —
-- a booking, a lead, a message, nothing, or a robot. A handed-off call
-- produces none of those and is not any of them. Recording it as `message`
-- would claim a message that was never taken; as `abandoned` it would tell
-- a business that the caller they SPOKE TO hung up on the machine. The
-- distinction is the whole point of the feature: this caller reached a
-- person, which is the best outcome on the list, and a vocabulary that
-- cannot say so makes the feature invisible on every screen and in every
-- number the product reports.
--
-- A CHECK CANNOT BE ALTERED IN PLACE, so this drops and re-adds. The name
-- below — `calls_outcome_check` — was READ FROM THE LIVE SCHEMA before this
-- file was written (`select conname, pg_get_constraintdef(oid) from
-- pg_constraint where conrelid = 'public.calls'::regclass and contype =
-- 'c'`), not guessed from the naming convention and not assumed anonymous.
-- It is re-added under the SAME name so that the next migration needing a
-- seventh value finds it exactly where this one did. The drop is bare rather
-- than `if exists`: if that name were ever wrong, this migration must fail
-- loudly at the drop rather than quietly add a second constraint beside a
-- first one nobody noticed.
--
-- The re-add revalidates every existing row. That is wanted, not tolerated —
-- it is free proof that no row already holds something outside the list —
-- and it is cheap: the whole table is small and the ACCESS EXCLUSIVE lock is
-- held for one scan.
--
-- NOTHING IN THE TREE PRODUCES THIS VALUE YET, deliberately. `classifyOutcome`
-- (apps/web/src/lib/voice/call-state.ts) is untouched: at socket close a
-- transferred call still classifies `abandoned`, because from the SOCKET's
-- point of view the caller did leave — and the route that performs the
-- handoff is what upgrades the row afterwards. Widening the vocabulary first,
-- in its own commit, is what lets that route be a small change rather than a
-- migration plus a route in one breath.
alter table public.calls drop constraint calls_outcome_check;
alter table public.calls add constraint calls_outcome_check
  check (outcome in ('booked', 'lead', 'message', 'abandoned', 'spam', 'transferred'));


-- ─────────────────────────────────────────────────────────────────────────
-- 3. `calls.handoff_token` and `calls.handoff_requested_at` — how a second
--    request finds a call that is still in flight.
--
-- A handoff spans two requests. The first is inside the live call: the
-- receptionist hears "can I talk to someone" and needs to hand control to a
-- route that can dial. The second is that route, arriving separately, with
-- no session, no signed-in user and NO ACCOUNT ID — its only input is
-- whatever the first request gave it. So the call row has to be findable by
-- a value the first request minted, and that value is `handoff_token`.
--
-- THE TOKEN IS THE CREDENTIAL. That is why `getCallByHandoffToken`
-- (packages/db/src/voice.ts) is deliberately not account-scoped — there is
-- no account id to scope it BY — and why it returns `account_id`, so every
-- read after it is scoped by the account the token resolved to. The token is
-- a lookup key that is also an authorisation, which is a shape worth naming
-- out loud rather than leaving to be inferred.
--
-- HENCE THE UNIQUE INDEX, and it is the one part of this migration that is
-- not merely storage. Two calls sharing a token means the route dials for
-- whichever row it happens to read first — it transfers the WRONG CALLER, to
-- a real human, on a real line. There is no error, no log line and no
-- symptom; both callers just have a confusing minute. A unique index is the
-- only thing that can make that state unrepresentable, and it must be the
-- DATABASE that refuses it, because the mint happens inside a live call where
-- a retry or a duplicated webhook is ordinary.
--
-- PARTIAL (`where handoff_token is not null`) because every row that exists
-- today has a null token and every call that never asks for a person always
-- will. Postgres does not treat nulls as equal, so a plain unique index would
-- also admit them — the predicate is not what makes the nulls legal. What it
-- buys is an index that holds only the handful of rows a lookup can ever
-- match, and a declaration in the schema itself that null means "no handoff"
-- rather than "a handoff with no token". `messages_provider_message_id_unique`
-- (0005) is the precedent, for the same reason in the same words, and its
-- definition was read from the live schema before this one was written.
--
-- `handoff_requested_at` is separate from the token, not folded into it,
-- because they answer different questions. The token answers "which call",
-- and only the route that holds it asks. The timestamp answers "when did this
-- caller ask for a person", which is what the eventual screen shows, what a
-- stale-token check would compare against, and the only durable trace that a
-- handoff was ever ATTEMPTED when the dial then failed. A token with no
-- timestamp would make a failed handoff indistinguishable from one that never
-- happened.
--
-- NO INDEX ON `handoff_requested_at`. Nothing queries by it — the lookups
-- this feature performs are by token, and the per-account reads already ride
-- `calls_account_started_idx` (0019). An index nobody's query planner will
-- choose is write cost with no reader.
alter table public.calls add column handoff_token text;
alter table public.calls add column handoff_requested_at timestamptz;

create unique index calls_handoff_token_unique
  on public.calls (handoff_token)
  where handoff_token is not null;

comment on column public.calls.handoff_token is
  'Minted when a caller asks for a person; the credential the handoff route looks this call up by. Unique across the whole project (calls_handoff_token_unique), because it carries no account and a shared token would transfer the wrong caller. NULL = this call never asked.';
comment on column public.calls.handoff_requested_at is
  'When the caller asked for a person. Set alongside handoff_token, and the only durable trace that a handoff was attempted when the dial afterwards failed.';


-- ─────────────────────────────────────────────────────────────────────────
-- 4. GRANTS — there are none, and each absence is a decision.
--
-- Verified read-only against this database before this file was written
-- (information_schema.table_privileges and column_privileges), so every claim
-- below is measured rather than remembered.
--
-- `accounts.transfer_phone`:
--   * NO `grant update (transfer_phone) to authenticated`, and that absence
--     IS the control. ⚠️ DO NOT "FIX" THIS BY ADDING ONE. 0013 revoked UPDATE
--     on public.accounts wholesale and re-granted it one column at a time, so
--     a new column here starts with no UPDATE for `authenticated` and only an
--     explicit grant could change that. This column must never get one: a
--     granted column is reachable by any `authenticated` token for the org
--     through PostgREST directly, with no server action in the path, and
--     whoever can write it decides who this account's callers are connected
--     to. `alert_phone` was withheld because a wrong value sends a stranger
--     lead PII; this one is worse in kind — a wrong value hands a stranger
--     the LIVE CALLER, and it does it on the tenant's own trunk, at the
--     tenant's own per-minute cost. The 2 AM failure mode is the same and
--     just as silent: the screen still shows a number, the calls still
--     connect, and the only person who could notice is the one who never
--     gets them.
--   * SELECT needs no grant: it is TABLE-level on public.accounts for
--     `authenticated`, so a column added today is already readable and the
--     settings screen needs nothing further. Deliberate asymmetry, the same
--     one 0035 chose — the client should SEE where their calls would go even
--     though they cannot change it.
--   * service_role has TABLE-level UPDATE and INSERT on public.accounts, so
--     `serviceDb()` can write this column with no grant here. That is the
--     only write path there is, and it is agency-gated at the call site
--     (`setTransferPhone`), exactly as `setAlertPhone` is. Nothing in the
--     database stands behind that write; the gate at the call site does.
--
-- `calls.handoff_token` / `calls.handoff_requested_at`:
--   * `authenticated` has NO write verb on public.calls at all — 0020 revoked
--     insert, update, delete, truncate, references and trigger on this table
--     and re-granted none, because a call is a RECORD and a client who could
--     write one could rewrite what happened on it. New columns inherit that
--     nothing. serviceDb() writes them; that is the whole list.
--   * `authenticated` KEEPS table-level SELECT, so these columns are readable
--     by members of the account that owns the row. Deliberate, and worth
--     saying plainly because a readable credential deserves a second look:
--     `calls_tenant` is a ROW policy, so the only tokens a member can read
--     are the ones on their own account's calls, and the token's entire job
--     is to authorise an action on that same call — it is a credential for a
--     thing its reader may already do. Narrowing it would mean revoking
--     table-level SELECT on `calls` and re-granting every column one at a
--     time, which reaches far past this feature and belongs in its own
--     migration if it is ever wanted.
--   * `anon` has nothing on public.calls (0020 revoked all) and gains nothing
--     here. The handoff route reads through serviceDb(), never as anon.
--
-- NO RLS POLICY IS ADDED, and that is not an omission. A Postgres policy is
-- ROW-scoped and never column-scoped, so `accounts_agency_all` /
-- `accounts_member_read` / `accounts_member_update` and `calls_tenant`
-- already cover every column added today. Adding one would be the mistake.

-- 0039_screened_calls.sql
-- The refusals the product currently forgets.
--
-- A refused inbound call leaves no trace. `texml/route.ts` writes one
-- console.log line and hangs up: no row, nothing on any screen, nothing
-- queryable once the log rotates. Two things follow, and the second is the
-- larger one.
--
--   1. A false positive is undiscoverable. Guard 2 (`decideReputation`)
--      blocks a caller whose entire recent history on an account is silent
--      calls. 956 Woodworks took eight robocalls in a day on 2026-09-17, so
--      this guard is live against real traffic on a real client. If it ever
--      misfires on a person, the only evidence is a log line.
--   2. A misconfigured number turns EVERY caller away, silently. A number
--      that is not live, or an account whose voice profile is missing or
--      disabled, refuses everyone — and nothing anywhere says so. That is an
--      outage on a paying client that the product does not notice.
--
-- WHY THIS IS NOT A `calls` ROW, which is the whole design and must not be
-- "simplified" later:
--
--   `countCallsSince` counts every `calls` row for an account unfiltered by
--   outcome, and feeds `decideLimit` — the daily cap that declines real
--   callers. Refusals stored there would let a robocall wave consume a
--   client's call limit and start declining genuine customers.
--
--   Worse: `decideReputation` returns `{blocked:false}` the moment
--   `history.otherCalls > 0`, and `otherCalls` is the
--   `.neq("outcome","spam")` branch of `countCallerHistorySince`. A refusal
--   written as a `calls` row with any new outcome would UN-BLOCK that caller
--   for the rest of the window on the very first block — the guard disabling
--   itself, silently, in the direction of letting spam through.
--
--   Writing them as `outcome:'spam'` is not a fix either: that branch also
--   requires `turn_count >= 1` and a refused call has zero turns, so the row
--   would be invisible to both branches by accident. Correct today, fragile
--   forever.


-- ─────────────────────────────────────────────────────────────────────────
-- `account_id` AND `phone_number_id` ARE NULLABLE, and that is load-bearing
-- rather than lax.
--
-- `calls.account_id` and `calls.phone_number_id` are both NOT NULL, which is
-- precisely why a call to a number this platform does not own cannot be
-- recorded there at all. That call is the one case where we know least and a
-- wrong number is indistinguishable from a probe — exactly the sort of thing
-- worth being able to count. A nullable pair is what makes it representable.
--
-- `on delete cascade` for the account: a deleted account's screening history
-- is about an account that no longer exists. `on delete set null` for the
-- number, because a number OUTLIVES its assignment — it gets reassigned to
-- another client, and the refusal still happened on the line.
create table public.screened_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  called_e164 text not null,
  caller_e164 text,
  reason text not null,
  created_at timestamptz not null default now(),
  -- A CHECK here, UNLIKE 0038's `transfer_answered_by`, and the contrast is
  -- the reasoning. 0038 refused a constraint because its values are chosen by
  -- a CARRIER and the column existed to learn what they are; a constraint
  -- would have dropped the unanticipated value the column was added to see.
  -- These six values are OURS, enumerated in our own source, and a seventh
  -- must not appear without a migration saying so — the same position
  -- `calls_outcome_check` takes.
  constraint screened_calls_reason_check check (reason in (
    'unknown-number', 'not-live', 'no-profile', 'profile-disabled',
    'over-cap', 'repeat-spam'
  ))
);

comment on table public.screened_calls is
  'Inbound calls the platform refused before bridging. NOT a calls row, deliberately: see 0039 header — a calls row would feed the daily cap and disarm the repeat-spam guard. Agency-only; service_role writes, nothing else reads.';

-- The list page orders by created_at desc across every account.
create index screened_calls_created_idx
  on public.screened_calls (created_at desc);

-- The banner counts distinct numbers per account in a 24h window; the list
-- filters by account. Both are (account_id, created_at) prefixes.
create index screened_calls_account_created_idx
  on public.screened_calls (account_id, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- GRANTS ARE THE CONTROL HERE, not the row policy — the shape
-- 0036_alert_phone_verifications.sql established for a table only the server
-- touches.
--
-- The design called for an `app.is_agency()` policy. This is stronger. No
-- in-app caller needs the `authenticated` grant at all: the agency list runs
-- `requireAgency()` then reads through `serviceDb()`, which is the pattern
-- /dashboard/numbers already uses for a cross-tenant screen. With no grant, a
-- client asking for this table gets PERMISSION DENIED rather than zero rows —
-- a stronger guarantee than a policy, and one that cannot be defeated by a
-- future query that forgets a filter.
--
-- RLS is still enabled: not because a policy is doing work today, but so that
-- a future `grant select ... to authenticated` cannot silently open the whole
-- table. Enabled RLS with no policy denies by default.
alter table public.screened_calls enable row level security;
revoke all on public.screened_calls from anon, authenticated;
grant select, insert, delete on public.screened_calls to service_role;

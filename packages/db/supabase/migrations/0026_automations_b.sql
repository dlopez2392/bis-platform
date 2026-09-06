-- 0026: Automations Milestone B — the two remaining state-derived recipes
-- (no-show nudge, ~2h SMS booking reminder) and the two decisions taken after
-- Milestone A shipped (spec, "Decisions taken after Milestone A shipped").
--
-- 1. THE CLOCKS. The review clock anchors on COMPLETION, not only on ends_at:
--    a client who batch-marked a week's jobs completed on Friday got no review
--    requests for anything older than 61h, and no counter said so.
--    `completed_at` and its twin `no_show_at` are stamped by setBookingStatus
--    on the flip TO that status; each gate runs from the LATER of ends_at and
--    the stamp. Rows flipped before this migration keep null and therefore
--    keep the ends_at anchor — the pre-B behaviour exactly. Never cleared on a
--    flip away: the status filter already stops the row matching, and a
--    re-flip re-stamps.
-- 2. THE ATTEMPT MARKERS. One SMS attempt per booking per day after a FAILED
--    attempt: write-then-send on a 15-minute cron wrote ~12 failed messages
--    rows per booking per morning band during a carrier outage. Each
--    `*_sms_failed_at` is an ATTEMPT marker (never a receipt), written by its
--    pass on a provider failure and read back by the same pass's due-list;
--    the pass holds the booking while the marker is younger than 24h and
--    counts the hold. One column per recipe, not one shared column: an SMS
--    reminder that failed at noon must not silence the review request the
--    next morning.
-- 3. THE DEDUPE STAMPS for the two new recipes — send-then-stamp, like
--    reminder_sent_at, followup_sent_at and review_requested_at.
-- 4. THE CATALOGUE grows by two keys. Postgres names an inline column CHECK
--    <table>_<column>_check; the pre-flight read confirms the name before
--    this runs.
--
-- Grants: bookings revokes UPDATE from `authenticated` (house pattern, pinned
-- in automations-grants.test.ts); new columns inherit that. OFF BY DEFAULT:
-- the two new recipes need an enabled automations row that no account has.

alter table public.bookings
  add column completed_at timestamptz,
  add column no_show_at timestamptz,
  add column no_show_nudged_at timestamptz,
  add column sms_reminder_sent_at timestamptz,
  add column review_request_sms_failed_at timestamptz,
  add column no_show_nudge_sms_failed_at timestamptz,
  add column sms_reminder_failed_at timestamptz;

alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in ('review_request', 'no_show_nudge', 'sms_reminder'));

-- The review and no-show due-lists match on EITHER anchor (ends_at OR the
-- stamp inside the window); a second partial index per recipe lets Postgres
-- BitmapOr the two instead of scanning.
create index bookings_review_due_completed
  on public.bookings (completed_at) where status = 'completed' and review_requested_at is null;
create index bookings_no_show_due
  on public.bookings (ends_at) where status = 'no_show' and no_show_nudged_at is null;
create index bookings_no_show_due_marked
  on public.bookings (no_show_at) where status = 'no_show' and no_show_nudged_at is null;
create index bookings_sms_reminder_due
  on public.bookings (starts_at) where status = 'booked' and sms_reminder_sent_at is null;

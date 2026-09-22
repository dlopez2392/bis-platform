-- 0047_automations_b.sql
-- Automation engine, part B (docs/superpowers/specs/2026-09-21-automation-engine-b-design.md).
--
-- FOUR recipes on part C's floor, and ONE migration for the four because they
-- share two CHECK rewrites: four separate drop/re-adds of the same constraint
-- would be four chances to misspell one of the nine values that must survive.
--
-- Nothing here is a new table. Every column is an `alter table ... add column`
-- on a table that already exists, which is why there are NO GRANT CHANGES:
-- a new column inherits its table's standing (0027's header). The two shapes
-- that standing takes, and both are PROVEN rather than asserted, in
-- automations-b-schema.test.ts's catalogue describe:
--   * bookings carries NO `authenticated` UPDATE at all - 0016:88 revokes it
--     and nothing re-grants it - so the client's UPDATE set for that table is
--     empty, and six new columns leave it empty.
--   * contacts and opportunities carry TABLE-level grants, which
--     information_schema.column_privileges EXPANDS into one row per column,
--     so a new column appears automatically with the same four privileges
--     every other column already has. 0030_contacts_sort_name.sql:37-49 is
--     the in-repo record of that mechanism, appended as a CORRECTION after
--     the same mistake was made there.
-- Both CHECK rewrites are constraint-only and touch no ACL.
--
-- Column by column, and why each one exists:
--   bookings.confirm_asked_at        the appointment_confirm dedupe stamp
--                                    (send-then-stamp, like every recipe).
--   bookings.confirm_reply           'yes' | 'no', written by the INBOUND SMS
--                                    webhook when the customer answers. It
--                                    NEVER changes bookings.status: a
--                                    destructive action from one word in a
--                                    text, with no confirmation, is what
--                                    DESIGN.md rule 6 forbids. The operator
--                                    cancels.
--   bookings.confirm_reply_at        when they answered.
--   bookings.confirm_sms_failed_at   the attempt marker. WRITTEN AND NEVER
--                                    READ BACK: the confirm's due window is
--                                    75 minutes, so a 24h cooldown would mean
--                                    one attempt ever - the text reminder's
--                                    recorded bug (caps.ts's
--                                    SMS_RETRY_COOLDOWN_MS comment). It exists
--                                    so a failed attempt is visible.
--   bookings.referral_asked_at       the referral_ask dedupe stamp.
--   bookings.referral_ask_sms_failed_at   its attempt marker, read back.
--   opportunities.quote_followup_sent_at  one send per opportunity, EVER.
--   opportunities.quote_followup_sms_failed_at   its attempt marker, read back.
--   contacts.reactivation_sent_at    one send per contact, EVER. This column
--                                    IS the off switch that outlives the
--                                    toggle: turning reactivation off mid-drain
--                                    strands nothing, because the stamp is
--                                    permanent.

-- 1. The recipe catalogue: four keys become eight. 0027's shape - Postgres
--    has no "alter check", so drop and re-add.
alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in (
    'review_request', 'no_show_nudge', 'sms_reminder', 'instant_reply',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup'));

-- 2. The log's sources: nine become thirteen. The nine are copied from
--    0046_automation_log.sql:35-37 verbatim; re-typing them from memory is
--    how a source silently stops being writable.
alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in (
    'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
    'instant_reply', 'weekly_report', 'concierge', 'voice',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup'));

-- 3. bookings: the confirmation ask and its answer, plus the referral ask.
alter table public.bookings add column confirm_asked_at timestamptz;
alter table public.bookings add column confirm_reply text
  constraint bookings_confirm_reply_check check (confirm_reply in ('yes', 'no'));
alter table public.bookings add column confirm_reply_at timestamptz;
alter table public.bookings add column confirm_sms_failed_at timestamptz;
alter table public.bookings add column referral_asked_at timestamptz;
alter table public.bookings add column referral_ask_sms_failed_at timestamptz;

-- 4. opportunities: the quote follow-up's stamp and its attempt marker.
alter table public.opportunities add column quote_followup_sent_at timestamptz;
alter table public.opportunities add column quote_followup_sms_failed_at timestamptz;

-- 5. contacts: the reactivation stamp.
alter table public.contacts add column reactivation_sent_at timestamptz;

-- 6. Indexes - EIGHT, and the count is a decision (plan amendment B10).
--    NAMING: a bare table prefix, no `idx_`. Zero of the 113 indexes in
--    `public` carry that prefix today, and `opportunities` is abbreviated
--    `opps_` by its own two existing indexes (opps_account_pipeline,
--    opps_contact). An index name is permanent once applied; this is the
--    house form, read off the live catalogue, not invented here.
--
--    (a) THREE partial cap-count indexes, 0027's shape: a daily cap counts
--        stamps (no ledger table, no timezone), so `(account_id, <stamp>)
--        where <stamp> is not null` makes each count an index-only read.
--        ONE PER CAPPED RECIPE, and there are exactly three of those -
--        referral_ask, reactivation, quote_followup. appointment_confirm is
--        UNCAPPED (spec decision 2) and this plan deliberately declares no
--        countAppointmentConfirmsSince, so an index on confirm_asked_at
--        would index a column nothing ever counts. It is not created.
create index bookings_referral_ask_count
  on public.bookings (account_id, referral_asked_at)
  where referral_asked_at is not null;
create index contacts_reactivation_count
  on public.contacts (account_id, reactivation_sent_at)
  where reactivation_sent_at is not null;
create index opps_quote_followup_count
  on public.opportunities (account_id, quote_followup_sent_at)
  where quote_followup_sent_at is not null;
--    (b) TWO due-list indexes for the two due-lists whose predicates are new
--        columns on their own table. Each carries its due-list's OWN
--        predicates so an idle tick on a busy account reads index tuples and
--        no heap.
create index opps_quote_followup_due
  on public.opportunities (account_id, stage_id, stage_changed_at)
  where quote_followup_sent_at is null and status = 'open';
create index bookings_confirm_due
  on public.bookings (account_id, starts_at)
  where confirm_asked_at is null and status = 'booked';
--    (c) THREE more the review added, because without them two new due-lists
--        scan `bookings` whole on every fifteen-minute tick.
--
--        The referral ask needs its OWN pair of anchors. The review request
--        has the identical two-anchor shape and TWO partial indexes for it
--        (0025:44 bookings_review_due on (ends_at), 0026:49-50
--        bookings_review_due_completed on (completed_at)), and NEITHER can
--        serve this query: Postgres chooses a partial index only when its
--        predicate is IMPLIED by the query's, and
--        `referral_asked_at is null` does not imply
--        `review_requested_at is null`.
create index bookings_referral_due
  on public.bookings (ends_at)
  where status = 'completed' and referral_asked_at is null;
create index bookings_referral_due_completed
  on public.bookings (completed_at)
  where status = 'completed' and referral_asked_at is null;
--        And reactivation's anti-blast read filters bookings on
--        `.in("contact_id", ...).eq("status","completed")`. There is no
--        index on bookings.contact_id AT ALL - the live catalogue's only
--        bookings indexes are bookings_pkey, bookings_cancel_token_key,
--        bookings_no_overlap, bookings_by_calendar, bookings_reminder_due,
--        bookings_review_due, bookings_review_due_completed,
--        bookings_no_show_due, bookings_no_show_due_marked and
--        bookings_sms_reminder_due.
create index bookings_completed_by_contact
  on public.bookings (contact_id)
  where status = 'completed';

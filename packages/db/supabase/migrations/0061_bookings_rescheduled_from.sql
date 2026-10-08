-- 0061_bookings_rescheduled_from.sql
-- A booking can name the booking it replaced, so a reschedule stops being
-- counted as a new booking (defect D-035).
--
-- WHY. Sofia's reschedule (apps/web/src/lib/voice/tools/registry.ts,
-- reschedule_appointment) books the new slot with createBooking and then
-- cancels the old row. That stays: the new row needs its own cancel_token,
-- its own meeting room and fresh automation stamps. But
-- listBookingCreationsBetween (packages/db/src/booking.ts), the one read
-- behind the dashboard's bookings number and chart, the Monday report and
-- the agency roll-up, counts created rows, so every reschedule read as one
-- more booking. The owner chose to LINK the new row to the old one and leave
-- linked rows out of that count. The original keeps the bar it earned when
-- it was made, cancelled or not.
--
-- WHAT.
--   1. UNIQUE (account_id, id) on bookings. Redundant as a uniqueness rule
--      (id is the primary key), there only because a foreign key must
--      reference a unique key on exactly its target columns (0050's reason
--      for contacts and calendars, 0055's for consent_events).
--   2. bookings.rescheduled_from_id uuid NULL, with
--        (account_id, rescheduled_from_id) -> bookings (account_id, id)
--        ON DELETE SET NULL (rescheduled_from_id)
--      Same-account by construction (0050's composite pattern): a booking
--      can only name one of its own account's bookings. NULL = not a
--      reschedule, which is every row that exists today.
--      The COLUMN LIST on SET NULL is load-bearing. A plain SET NULL on a
--      composite key nulls every referencing column, account_id included,
--      and account_id is NOT NULL: deleting any booking that had been
--      rescheduled would then fail. Proved on a scratch table before this
--      file was written; the schema test pins confdelsetcols. Deleting the
--      original (a test teardown; nothing in the app deletes a booking)
--      therefore only drops the link, and the replacement keeps its row
--      and its account.
--   3. CHECK (rescheduled_from_id <> id): a booking cannot replace itself.
--   4. A partial index on rescheduled_from_id, for the FK's delete-side
--      lookup (0054's reason for its consent_events index). The count query
--      filters on IS NULL and does not use it.
--
-- GRANTS. None in this file, on purpose. Since 0053 the client role
-- (authenticated) holds only table-level SELECT on bookings, and no INSERT
-- or UPDATE, at table or column level; the service role holds the table.
-- A new column inherits table-level privileges, so the link is readable by
-- a signed-in member under the existing bookings_tenant_read policy, and
-- writable only by the service role, which is the client createBooking is
-- called with (voice, the public booking page, the operator's actions).
-- bookings-rescheduled-from-schema.test.ts pins all three roles' column
-- privileges; schema-grants-guard.test.ts already pins that the client role
-- writes nothing on bookings.
--
-- ADDITIVE ONLY. The build before this file never names the column, and its
-- inserts get NULL. So production can take this file BEFORE the merge
-- deploy, and the build after it can rely on it from its first request.
--
-- LOCKS AND COST. The UNIQUE build and the constraint adds take ACCESS
-- EXCLUSIVE on bookings for the length of a small index build; ADD COLUMN
-- with no default is catalogue-only; validating the FK and the CHECK reads
-- rows whose new column is NULL, which pass both. Read-only on 2026-10-08:
-- production holds 33 bookings, the CI project 0.
--
-- PostgREST: a self-referencing FK adds bookings-to-bookings relationships.
-- Nothing in packages/ or apps/ embeds bookings (grepped before writing
-- this file), and the bookings -> contacts / calendars embeds are unchanged
-- (same-account-fk-schema.test.ts probes them).
--
-- ROLLBACK (roll the app back first; the build after this file writes and
-- filters on the column):
--   drop index public.bookings_rescheduled_from;
--   alter table public.bookings drop column rescheduled_from_id;
--     (drops bookings_rescheduled_from_fkey and
--      bookings_rescheduled_from_not_self with it)
--   alter table public.bookings drop constraint bookings_account_id_id_key;
--
-- ASCII only, no backslash anywhere (the MCP apply rule).

set local lock_timeout = '5s';

alter table public.bookings
  add constraint bookings_account_id_id_key unique (account_id, id);

alter table public.bookings
  add column rescheduled_from_id uuid,
  add constraint bookings_rescheduled_from_fkey
    foreign key (account_id, rescheduled_from_id) references public.bookings (account_id, id)
    on delete set null (rescheduled_from_id),
  add constraint bookings_rescheduled_from_not_self
    check (rescheduled_from_id <> id);

create index bookings_rescheduled_from
  on public.bookings (rescheduled_from_id) where rescheduled_from_id is not null;

comment on column public.bookings.rescheduled_from_id is
  'The booking this one replaced, when it was made by rescheduling (the old row is cancelled). NULL = a new booking. Same account by construction (composite FK). Linked rows are left out of listBookingCreationsBetween, so a reschedule is not counted as a new booking. Written only by the service role.';

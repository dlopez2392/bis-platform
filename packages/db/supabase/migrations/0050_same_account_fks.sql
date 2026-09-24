-- 0050_same_account_fks.sql
-- A booking's contact and calendar, and a deal's contact, must belong to the
-- row's OWN account, and the schema now says so.
--
-- WHY. `bookings.contact_id`, `bookings.calendar_id` and
-- `opportunities.contact_id` were single-column FKs (0017:30-37, 0003:79).
-- They proved the contact or calendar EXISTED, not that it was the row's own
-- account's, so a booking in account A could point at account B's customer or
-- B's calendar. Every reader that follows the FK (the reminder, the follow-up,
-- the six automation recipes, the reactivation "past customer" proof) would
-- then have mailed B's customer under A's brand, or linked B's public booking
-- page. #122 and #123 guarded that in the READERS: `ownAccountEmbedsOnly`
-- (booking.ts), its contact-only delegate in automations.ts, the per-account
-- `contacts!inner` quote read, and the account-keyed booking reads in the
-- reactivation recipe. This migration is the schema-level version: a crossed
-- row can no longer be written, so no reader can ever meet one. The reader
-- guards STAY, as defence in depth, each with a line naming this migration.
--
-- WHAT.
--   1. UNIQUE (account_id, id) on contacts and on calendars. Redundant as a
--      uniqueness rule (id alone is the primary key; calendars is already
--      unique on account_id), and there only because a foreign key must
--      reference a unique key on exactly its target columns.
--   2. The three FKs become composite, under their EXISTING names:
--        bookings (account_id, contact_id)       -> contacts (account_id, id)   ON DELETE RESTRICT
--        bookings (account_id, calendar_id)      -> calendars (account_id, id)  ON DELETE RESTRICT
--        opportunities (account_id, contact_id)  -> contacts (account_id, id)   NO ACTION
--      Delete behaviour is identical to before: restrict on the two booking
--      FKs (0017's decision: bookings are leads), no action on the deal's
--      (0003 named none). Names are reused so a violation reads exactly as it
--      did, and nothing in the repo names a constraint (no `!..._fkey` embed
--      hint, no error-text match; grepped before writing this file).
--      An embed hint on these three relationships must name the CONSTRAINT
--      (`contacts!bookings_contact_id_fkey`), never the column: PostgREST
--      resolves a column-name hint (`contacts!contact_id`) only against a
--      single-column FK, so after this file it would fail with PGRST200.
--      (From PostgREST's documented behaviour, not measured here; no hint of
--      either kind exists in packages/ or apps/ today.)
--   3. The single-column FKs are DROPPED IN THE SAME STATEMENT as each
--      composite is added. Both left in place would be two relationships
--      between the same pair of tables, and PostgREST then refuses every
--      `contacts(...)` / `calendars!inner(...)` embed on bookings and
--      opportunities as ambiguous (PGRST201): the reminder, follow-up and
--      every recipe's due-list would error in production. One ALTER TABLE per
--      table carries the drop and the add together, so the swap is atomic
--      whether or not the caller wraps the file in a transaction.
--
-- A NEW REFUSAL, beyond crossed inserts. `on update` is NO ACTION on all
-- three (as before), and the referenced key now INCLUDES contacts.account_id
-- and calendars.account_id. So moving a contact or a calendar to another
-- account while a booking or deal of its old account points at it is refused
-- (23503) instead of silently creating the crossed row. No code in
-- packages/db/src or apps/web/src updates either column (the only
-- `.update({ account_id` is voice.ts, on phone_numbers).
--
-- LOCKS AND COST. Adding the unique keys builds two small indexes; adding the
-- FKs validates every existing row. Read-only against this database before
-- writing this file (2026-09-24 04:24 UTC): contacts 53, calendars 4,
-- bookings 33, opportunities 20, and 0 crossed rows on each of the three
-- pairs. A crossed row written between that read and the apply makes the
-- FK's ALTER fail and change nothing; the orchestrator's pre-flight re-reads
-- the crossed counts. No referencing-side index is added: the delete-side
-- check on bookings had no FULL index on contact_id before this either (the
-- two PARTIAL ones, bookings_completed_by_contact and
-- bookings_confirm_reply_pending, cannot serve its unfiltered lookup), and
-- `opps_contact (contact_id)` still serves the deal's.
--
-- PostgREST reloads its relationship cache on this DDL through the
-- `pgrst_ddl_watch` event trigger (present, read 2026-09-24).
--
-- ROLLBACK (restores 0017's / 0003's FKs exactly, then drops the keys):
--   alter table public.bookings
--     drop constraint bookings_contact_id_fkey,
--     add constraint bookings_contact_id_fkey
--       foreign key (contact_id) references public.contacts(id) on delete restrict,
--     drop constraint bookings_calendar_id_fkey,
--     add constraint bookings_calendar_id_fkey
--       foreign key (calendar_id) references public.calendars(id) on delete restrict;
--   alter table public.opportunities
--     drop constraint opportunities_contact_id_fkey,
--     add constraint opportunities_contact_id_fkey
--       foreign key (contact_id) references public.contacts(id);
--   alter table public.contacts drop constraint contacts_account_id_id_key;
--   alter table public.calendars drop constraint calendars_account_id_id_key;
--
-- ASCII only, no backslash anywhere (0048's MCP apply altered an escape).

-- The UNIQUE builds take ACCESS EXCLUSIVE on contacts and calendars. If another
-- session holds a lock there, fail after 5s instead of queueing every read
-- behind this apply. `set local` only takes effect inside a transaction.
set local lock_timeout = '5s';

alter table public.contacts
  add constraint contacts_account_id_id_key unique (account_id, id);

alter table public.calendars
  add constraint calendars_account_id_id_key unique (account_id, id);

alter table public.bookings
  drop constraint bookings_contact_id_fkey,
  add constraint bookings_contact_id_fkey
    foreign key (account_id, contact_id) references public.contacts(account_id, id) on delete restrict,
  drop constraint bookings_calendar_id_fkey,
  add constraint bookings_calendar_id_fkey
    foreign key (account_id, calendar_id) references public.calendars(account_id, id) on delete restrict;

alter table public.opportunities
  drop constraint opportunities_contact_id_fkey,
  add constraint opportunities_contact_id_fkey
    foreign key (account_id, contact_id) references public.contacts(account_id, id);

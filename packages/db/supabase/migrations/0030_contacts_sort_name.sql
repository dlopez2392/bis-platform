-- 0030_contacts_sort_name
--
-- Server-side sorting of the contact list by Name.
--
-- The UI's sort key was never a column: `contactDisplayName` (apps/web/src/
-- lib/format.ts) computes `[first_name, last_name].filter(Boolean).join(" ")`
-- in JS, so the old client-side sort could only order the rows already in the
-- browser — 20 of them, out of however many the account has. Postgres cannot
-- order by that expression without seeing it, so it becomes a stored generated
-- column: the database computes it, which makes it impossible for the sort key
-- to drift away from the displayed name the way a trigger-maintained or
-- application-maintained copy would.
--
-- `nullif(..., '')` is the deliberate part: a contact with neither name gets
-- NULL rather than the empty string, so `nulls last` parks the nameless ones
-- at the end in BOTH directions. The client-side sort used to fall back to the
-- literal string "No name", which interleaved nameless contacts among the Ns.
alter table public.contacts
  add column sort_name text
  generated always as (
    nullif(lower(trim(both ' ' from coalesce(first_name, '') || ' ' || coalesce(last_name, ''))), '')
  ) stored;

-- Matches the cursor's comparison order exactly: the account scope first, then
-- the sort column, then the id tiebreaker that makes the tuple cursor total.
create index contacts_account_sort_name
  on public.contacts (account_id, sort_name, id);

-- REQUIRED, and easy to forget: `authenticated` holds COLUMN-level SELECT on
-- contacts (one grant per column), not a table-wide one. A new column is
-- therefore unreadable by the app until it is named here — and the service
-- client used by most test fixtures bypasses grants entirely, so a missing
-- grant passes every unit test and fails only in the real app.
-- No UPDATE/INSERT grant: the column is generated and cannot be written.
grant select (sort_name) on public.contacts to authenticated;

-- CORRECTION, appended 2026-09-09 after the migration had already been applied.
-- The comment above the grant is WRONG about this table, and the SQL below it
-- was a no-op. `public.contacts` carries TABLE-level grants (Supabase's default
-- `grant all ... to anon, authenticated`), which already cover a newly added
-- column: all four roles hold all four privileges on all 15 columns, uniformly.
-- `information_schema.column_privileges` EXPANDS a table-level grant into one
-- row per column, so a query filtered to a single role and privilege looks
-- exactly like a per-column grant — which is how the mistake was made.
-- Access control on this table is RLS, not column grants. Some tables here DO
-- use real column-level grants (calendars' 7 settings columns), so the habit is
-- worth keeping — just verify per table before relying on it.
-- The grant statement is left in place rather than rewritten: it ran, it is
-- harmless, and an applied migration's SQL should not be edited after the fact.

-- 0034_email_key_whitespace
--
-- 0033's email_key stripped whitespace with `trim(both ' ' from ...)`, which
-- removes ONLY the ASCII space. 0033's own comment claimed this "mirrors
-- emailKey()", but emailKey() called JS's `.trim()`, which strips the FULL
-- Unicode whitespace set — tab, newline, CR, form feed, vertical tab, and
-- NBSP among others. An email padded with a tab or newline — exactly what a
-- CSV import produces — got trimmed away on the TypeScript side and NOT on
-- the database side, so the two computed different keys for the same input
-- and silently stopped matching. Neither side throws: findDuplicate's
-- `.eq()`/`.ilike()` lookup just quietly reports no match.
--
-- Fixed here, in a NEW migration, rather than as an edit to 0033: 0033 is
-- already applied in production, and editing an applied migration file
-- changes nothing a running database has already computed and stored — the
-- only way to change a STORED generated column's expression is a new
-- migration that drops and re-adds it.
--
-- Rather than chase JS's `.trim()` (whose exact Unicode whitespace set
-- Postgres's regexp engine has no single built-in that reproduces character
-- for character), both sides now name the SAME explicit class instead:
-- space, tab (\t), newline (\n), carriage return (\r), form feed (\f),
-- vertical tab (\v), and NBSP (\u00A0). See emailKey()'s doc comment in
-- packages/db/src/contacts.ts for the TypeScript twin — spelled out
-- explicitly there too, in the same order, so the two lists can be read
-- side by side and verified identical rather than trusted to agree.
--
-- phone_key is unaffected and untouched here: both sides already strip
-- every non-digit character via `regexp_replace(..., '[^0-9]', '', 'g')`,
-- so whitespace of any kind was already removed on both sides either way.
--
-- A column's index is dropped along with the column itself, so
-- contacts_account_email_key is recreated immediately below — it must
-- exist afterwards, or the account-scoped lookup findDuplicate relies on
-- silently degrades to a sequential scan, exactly the regression 0033 was
-- written to prevent.
alter table public.contacts drop column email_key;

alter table public.contacts
  add column email_key text
  generated always as (
    nullif(regexp_replace(lower(regexp_replace(coalesce(email, ''), '^[ \t\n\r\f\v\u00A0]+|[ \t\n\r\f\v\u00A0]+$', '', 'g')), '\+[^@]*@', '@'), '')
  ) stored;

create index contacts_account_email_key on public.contacts (account_id, email_key);

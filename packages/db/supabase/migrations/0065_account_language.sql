-- 0065_account_language.sql
-- accounts.language: the account-level UI-language default for CLIENT-role
-- sessions, read by the Spanish-runtime resolver (Task 4) and written only
-- by the agency Settings page (Task 5).
--
-- WHY. The dashboard needs a language to render in before any per-person
-- preference exists. This column is the first (and, until the parallel
-- staff-and-roles lane ships users.language, the ONLY) place that default
-- lives.
--
-- WHAT. accounts.language text, NULL, check (language is null or language
-- in ('en', 'es')). NULL = no preference recorded; resolveLocale() (Task 2)
-- is what turns that into the product default (en), not this column.
--
-- SCOPE (owner decision, 2026-10-10, Spanish-runtime). This column governs
-- CLIENT-role sessions only. Agency operators stay English regardless of
-- this value until the parallel staff-and-roles lane's users.language
-- exists; nothing in this migration enforces that split — it is a
-- read-site rule for Task 4's resolver, recorded here because this is the
-- column's one authoritative comment.
--
-- GRANTS. None. accounts.language is server-write-only, same shape as
-- accounts.client_access_enabled and accounts.transfer_phone: the only
-- writer is setAccountLanguage (packages/db/src/accounts.ts), called from
-- the agency Settings server action (Task 5) through serviceDb(). Granting
-- authenticated UPDATE here would let a client change their own account's
-- default without the agency's involvement, which nothing today asks for.
-- SELECT stays table-level for authenticated (0001), so the value is
-- readable by the account's own members, same asymmetry 0037 chose for
-- transfer_phone.
--
-- ADDITIVE ONLY. NULL with no default; every existing account is
-- unaffected until the agency sets a language. Catalogue-only ALTER, no
-- rewrite.
--
-- ROLLBACK (roll the app back first):
--   alter table public.accounts drop column language;
--
-- ASCII only, no backslash anywhere (the MCP apply rule).

alter table public.accounts
  add column language text null
  check (language is null or language in ('en', 'es'));

comment on column public.accounts.language is
  'UI language for this account''s CLIENT-role sessions. NULL = no preference recorded; '
  'resolveLocale() falls through to the default (en). Agency-operator sessions do not read '
  'this column (decision 1, 2026-10-10 Spanish-runtime owner decisions) until the parallel '
  'staff-and-roles lane''s users.language exists.';

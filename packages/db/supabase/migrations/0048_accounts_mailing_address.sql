-- 0048_accounts_mailing_address.sql
-- The postal address a business prints on email to its past customers.
--
-- The `reactivation` recipe is the only one that emails someone who did not
-- just interact with the business: a past customer, up to 18 months quiet. Its
-- purpose is winning business back, which reads as commercial email under
-- CAN-SPAM, and a commercial email needs a working opt-out and the sender's
-- valid physical postal address. (That is the orchestrator's reading of the
-- law, recorded 2026-09-22, not a lawyer's.) Until this migration nothing on
-- `accounts` could hold that address, so the recipe shipped without one.
--
-- Nullable, no default. Every existing account starts unset, and unset is a
-- documented state rather than a gap: the reactivation recipe refuses to be
-- switched on without a mailing address, and a send whose address has since
-- been cleared is skipped with a reason the client can read, never sent
-- without it. Every other send path ignores this column.
--
-- Multi-line on purpose: an address is several lines, and the email prints it
-- as they were typed. The template escapes it and turns newlines into <br> in
-- the HTML part; this column stores plain text and never markup.
alter table public.accounts
  add column mailing_address text
    constraint accounts_mailing_address_check
    check (
      mailing_address is null
      or char_length(
           regexp_replace(
             mailing_address,
             '^[ \t\n\r\f\v\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[ \t\n\r\f\v\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
             '', 'g')
         ) between 1 and 300
    );


-- ─────────────────────────────────────────────────────────────────────────
-- THE CHECK: a non-null value is 1–300 characters once leading and trailing
-- whitespace is stripped. Blank is refused, so NULL is the ONLY way to spell
-- "not set" (0035's argument about "": if "" or "\t" could be stored, a
-- `mailing_address is not null` read and the send path's "blank after trim"
-- read would disagree about the same row).
--
-- WHY NOT `btrim()`. `btrim(x)` strips ONLY the ASCII space, which is 0033's
-- mistake in a new place: the app side of this rule is JavaScript's `.trim()`
-- (the Branding action trims before it saves; the reactivation pass treats a
-- value that is blank after `.trim()` as unset). Measured read-only against
-- this database before writing this file:
--   char_length(btrim(E'\t'))        = 1   -> a tab alone would PASS btrim
--   char_length(btrim(E'\r\n'))      = 2   -> so would a bare line break
--   char_length(btrim(E'\u00A0'))    = 1   -> and a no-break space
-- Each of those is blank to `.trim()`, so under `btrim` the database would
-- accept a value the send path reads as missing: a second spelling of "off".
--
-- The class above is not 0034's seven-character list. It is EXACTLY the set
-- `.trim()` strips, enumerated rather than recalled: every code point from
-- U+0000 to U+10FFFF run through `String.fromCodePoint(c).trim() === ''` on
-- Node v24.13.0 returns 25 of them, and they are these 25, in this order:
--   U+0020 U+0009 U+000A U+000D U+000C U+000B U+00A0 U+1680
--   U+2000..U+200A (11) U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
-- Verified against this database on literals: a string of any of them, alone
-- or mixed, strips to length 0 and fails the check; U+200B (zero-width space,
-- NOT whitespace to `.trim()`) is kept and passes; "  123 Main St\nMcAllen,
-- TX 78501\t\n" strips to 29 and passes with its interior newline intact
-- (`^`/`$` anchor the whole string, not each line, without the `n` flag);
-- repeat('a', 300) passes; repeat('a', 301) fails.
--
-- This is a CHECK, not a generated column: it stores nothing it computes, so
-- there is no key for the two sides to disagree on. It is still a rule with a
-- TypeScript twin, and the class has to stay the one `.trim()` uses.
--
-- LENGTH UNITS. `char_length` counts code points; JavaScript's `.length`
-- counts UTF-16 units, which is never fewer (150 house emoji: 150 here, 300
-- there). So an app that refuses `.trim().length > 300` is at least as strict
-- as this check, and there is no value the app accepts that the database
-- refuses. The reverse gap (the app refusing an astral-heavy address the
-- database would take) is the app's to close if it ever matters.
--
-- The upper bound is a backstop, not the product rule. 300 is room for a
-- suite, a PO box and a second line with slack to spare; the Branding action
-- refuses past it with its own message before this constraint is ever reached.


-- ─────────────────────────────────────────────────────────────────────────
-- WHO MAY WRITE IT: the client, like `reply_to_email` (0014), and unlike
-- `from_email` (0015) and `alert_phone` (0035).
--
-- 0013 revoked UPDATE on public.accounts from `authenticated` and granted it
-- back on a named list, because an UPDATE policy is ROW-scoped and never
-- column-scoped. That file's own warning is what this line answers:
--
--   "⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves
--    for the agency and silently fails for clients."
--
-- The agency writes through the service role, which is bound by neither column
-- grants nor RLS, so omitting this grant would produce a bug the agency cannot
-- see and the client cannot get around: their write is FILTERED, not
-- rejected, so it reports success and changes nothing.
--
-- Why this column is on the granted side when 0015 and 0035 withheld theirs:
-- those two are places the platform SENDS FROM or SENDS TO, so a client who
-- could write them could spend the platform's money or speak as another
-- tenant without touching any row RLS would see. This column is neither. It is
-- a line of text printed inside email the account already sends to its own
-- customers under its own brand, and a wrong value can only harm the account
-- that wrote it. `accounts_member_update` (0013) confines the write to the
-- caller's own row while their access is switched on; RLS has nothing more to
-- decide here. A business's own postal address is theirs to state.
--
-- `grant update (col)` is additive -- it does not disturb the eight columns
-- 0013 and 0014 granted. client-branding-grants.test.ts asserts the resulting
-- set EXACTLY, in both directions.
--
-- SELECT needs no grant: `authenticated` holds table-level SELECT on
-- public.accounts (read live from information_schema.table_privileges before
-- writing this file), which covers a column added today.
grant update (mailing_address) on public.accounts to authenticated;


comment on column public.accounts.mailing_address is
  'The business''s postal address, printed at the foot of reactivation emails to past customers. NULL = not set, and the reactivation recipe refuses to turn on (and skips any send) without it. Plain text, multi-line allowed; 1-300 characters after stripping the whitespace JavaScript''s .trim() strips. Client-editable (grant update to authenticated), like reply_to_email.';

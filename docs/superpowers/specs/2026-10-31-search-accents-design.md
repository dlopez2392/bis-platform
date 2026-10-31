# Contacts search that ignores accents and finds full names and phone digits (F-092 part 1): design

Date: 2026-10-31. Author: bis-crm. Base: `af5976fa` (branch `feat/search-accents`).
Status: design, owner-approved. Nothing here is built. The four owner questions were answered on 2026-10-31, each as
recommended (section 9); the design below states the answers, not the options. Plan:
`docs/superpowers/plans/2026-10-31-search-accents.md`.
Migration number: **0108** (0107, the calendar agenda, is the newest file in `packages/db/supabase/migrations/`).

Every claim about current code cites `path:line` at `af5976fa`. Short forms: `ACCT/` =
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`, `MIG/` = `packages/db/supabase/migrations/`,
`DB/` = `packages/db/src/`, `WEB/` = `apps/web/src/`, `ROUTE` = `WEB/app/api/accounts/[accountId]/search/route.ts`.
A claim about a system outside this repo is labelled **ASSUMPTION** and names how the plan verifies it. Where the
brief and the source disagree, the source wins, and section 12 records each disagreement.

Scope, from `docs/crm-features.md:1433`: "contacts search that ignores accents and finds full names and phone
digits", 1.5 to 2 engineer-weeks, no dependencies, because "'Garcia' must find 'García'". The whole feature's
promise (`:2156`): "Search that ignores accents and finds full names and any phone format, across every record".
Surface 4 (`:2670-2691`) records today's gap in the owner's words: "contact search does not match "Garcia" to
"García"". **Part 2 is out of scope**: one index across every record type and nickname expansion (`:1555`,
4 to 5 weeks, "With Ask BIS"), and with it typo tolerance ("Garsia"), Spanish type words ("citas mañana") and the
palette's "Ver los 42 resultados" page, which are F-095 (`:1434`, `:2689-2691`). Section 10 lists the rest.

---

## 1. The problem, as the code has it

- **One function decides what every customer search matches**, and it matches raw text. `withSearch`
  (`DB/contacts.ts:925-935`) ORs four `ilike '%term%'` clauses over `first_name`, `last_name`, `email` and `phone`,
  plus a digits clause on `phone_key` when the term looks like a phone (`:877-889`). ILIKE folds case, never
  accents, so "Garcia" does not match "García".
- **A full name never matches.** The whole term must sit inside ONE column: "Maria Garcia" is not a substring of
  `first_name` "María" nor of `last_name` "García", so the most natural thing to type finds nobody, with or without
  the accent. "garcia maria" (surname first, as people say it at a counter) cannot work either.
- **Some Mexican phone shapes miss.** The phone clause matches the typed digits against `phone_key`
  (`DB/contacts.ts:933`), which keeps the `52` of a Mexican number (`DB/contacts-phone.test.ts:37`). A number typed
  in the legacy mobile form "+52 1 899 123 4567" gives `5218991234567`, which is not inside `528991234567`, so the
  customer is not found. 0106's `phone_national` already folds that shape (`MIG/0106_contact_merge.sql:159-171`);
  search does not read it.
- **Results come back newest first, not best first.** The palette and every picker ask for 5 to 9 rows of the
  list's default order, `created_at desc` (`DB/contacts.ts:944`), so with forty Marías on an account, typing
  "maria" offers the five newest, and "María" herself may not be among them.

---

## 2. Every place someone looks up a customer today

| # | Surface (who uses it) | Code | How it queries today | In part 1? |
|---|---|---|---|---|
| 1 | **Contact list search box** (Owner, Staff, agency; Technician sees only their own) | form `ACCT/contacts/page.tsx:469-484`, reads `listContacts` + `countContacts` `:331-334` | GET `?q=`; server `withSearch` on both, so rows and the header total agree; cursor paging and the chosen sort unchanged by search (`:461-467` keeps sort and search independent) | **Yes**: the filter changes, nothing else |
| 2 | **CSV export of a searched list** (Owner) | `ACCT/contacts/export/route.ts:126`, `:157` | Same `listContacts`/`countContacts` with `search: q` | Yes, for free (same `withSearch`) |
| 3 | **⌘K palette, contacts half** (everyone signed in) | `WEB/components/command-palette.tsx:122-124`, `:157`; `ROUTE:84-107` | Debounced GET; route sanitizes, gates at 2 real characters (`ROUTE:31`, `:86`), calls `listContacts(..., { search, limit: 5 })` (`:95`) on the RLS client (`:88`) | **Yes**: filter + best-first order (section 5) |
| 4 | **Add job: choose the customer** (Owner, Staff, agency) | `ACCT/calendar/job-sheet.tsx:176-190` (fetch), `:309-327` (rows) | The same route; reads only `contacts` (`:186`), though the route also runs the calls and conversations searches (`ROUTE:94-98`) | **Yes**, via the route |
| 5 | **Held email: choose a record** (Owner, Staff, agency) | `ACCT/conversations/held-email-search.ts:40-49` | The same route, contacts only | **Yes**, via the route |
| 6 | **Add a relationship: find a person** (record page) | `ACCT/contacts/add-relationship-dialog.tsx:91` → `ACCT/contacts/relationship-actions.ts:227-249` | Server action, `listContacts(..., { search, limit: 9 })` on the RLS client (`:236-238`) | **Yes**: filter + best-first |
| 7 | **Shared number: move a thread to a customer** (inbox) | `ACCT/conversations/holding-move.tsx:35`, `:105` | The same server action as #6 | **Yes**, via #6 |
| 8 | **Household or business: find one** (record page's groups card) | `ACCT/contacts/groups-card.tsx:381` → `groups-actions.ts:87-92` → `DB/client-groups.ts:130-144` | `client_groups.name ilike '%term%'`, 8 rows by `name_key`; `name_key` is `lower(btrim(name))` (`MIG/0069_client_groups.sql:36-38`), so no accent folding | **Yes** (Q4, decided 2026-10-31): the same folded words, on a stored `client_groups.search_name` in 0108 |
| 9 | ⌘K palette, calls half | `DB/voice.ts:1311-1322` | `caller_e164` or `summary` ilike the sanitized term | No (section 10) |
| 10 | ⌘K palette, conversations half | `DB/messaging.ts:967-985` | Message `body` ilike, newest 200 matches, archived-and-read threads out | No: a message body is not a customer name; part 2's one index |
| 11 | New deal: pick the customer (pipeline) | `ACCT/pipeline/page.tsx:26`; `ACCT/pipeline/add-opportunity-dialog.tsx:78-89` | No search at all: a Select of the newest 200 contacts | No; recorded as a finding (section 13) |
| 12 | Merge screen | `ACCT/contacts/merge/page.tsx:46-52` | No picker: the two records arrive as `?a=&b=` from the duplicates queue | Nothing to change |
| 13 | Exact lookups: dedupe on create (forms via `WEB/lib/forms/enrich.ts:108`, imports, staff adds), Sofía's caller ID, the text-back | `findDuplicate` `DB/contacts.ts:277-300` (equality on `email_key`, `phone_key`); `readCandidates` `WEB/lib/voice/identity/candidates.ts:19-22` → `listContactsOnNumber` `DB/voice.ts:777-785` (`phone_key in (...)`) | Indexed equality on stored keys, not a search | **No, deliberately**: these decide WHO a message or a call belongs to. A looser match there would attach a stranger's call to a customer. 0106 already folds accents and Mexican shapes for duplicates (section 3) |

No other customer search box exists: the inbox has no search field (only ⌘K's conversations half), the calls page
has none, and "Search companies…" (`WEB/lib/messages.ts:110`) switches the agency between accounts, not customers.

---

## 3. What exists to reuse, and what cannot serve

| Thing | Where | Serves search? |
|---|---|---|
| `app.contact_name_fold(text)`, IMMUTABLE | `MIG/0106_contact_merge.sql:191-214` | **Yes, the core.** One `translate()` maps A-Z to a-z, `- . , '` and six whitespace characters to a space, and the 48 accented letters of Spanish and Portuguese names (including Ñ/ñ → n, Ü/ü → u) to plain letters; then drops everything outside `[a-z0-9 ]`, collapses and trims spaces. No `lower()`, so the answer does not depend on the database's ctype (`:191-192`). Immutable, so a stored generated column and an index may use it. |
| `nameFold` (its TypeScript twin) | `DB/dedupe-keys.ts:36-55`, import-free, exported as `@bis/db/dedupe-keys` (`packages/db/package.json:18`) | **Yes**: folds the typed query exactly as the database folds the stored names, so the two always agree. Already compared shape by shape on a real database (`DB/test/contact-dedupe-schema.test.ts:117`). |
| `contacts.name_key` | `MIG/0106_contact_merge.sql:220-231`, `:247`; twin `nameKey` `DB/dedupe-keys.ts:58-69` | **No.** It is `first|first surname` for EQUALITY (pairing duplicates): the second surname and any middle name are cut off, the first name must be whole, and it is NULL when there is no last name or the first name is a placeholder ("Caller"). "lopez" could never find "María García López" through it. |
| `contacts.phone_national` | `MIG/0106_contact_merge.sql:159-171`, `:246`; twin `phoneNational` `DB/dedupe-keys.ts:19-24` | **Yes**: the ten national digits of every +1 and +52 shape (legacy 521, 044, 045, 01), so a full number in any of those shapes matches. Indexed only by `(account_id, phone_national)` equality (`:254`). |
| `contacts.phone_key` | `MIG/0033_contact_dedupe_keys.sql:45`; twin `phoneDigits` `DB/contacts.ts:190-193` | **Yes, for partial digits**: what search uses today; keeps a Mexican number's `52`, so "+52 899 12" still matches by substring. |
| `contacts.email_key` | `MIG/0034_email_key_whitespace.sql:45`; twin `emailKey` `DB/contacts.ts:222-227` | **Only for an exact-email tier** (section 5): lowercased and `+suffix`-stripped, which a substring search must not depend on ("dan+bis" would vanish). The substring search keeps the raw `email` column. |
| `contacts.sort_name` | `MIG/0030_contacts_sort_name.sql:19-27` | Ordering only (`lower(first || ' ' || last)`, index `(account_id, sort_name, id)`); no accent fold. |
| `phoneSearchDigits` and its 4-digit floor | `DB/contacts.ts:879-889`, pinned by `DB/contacts-phone.test.ts:63`, `:73` | **Yes**, extended (section 4.2). |
| `sanitizeSearchTerm`, `searchTermLength` | `DB/search-term.ts:75-81` | Kept for the raw clauses. The new folded tokens need none of it: they contain only `[a-z0-9]`, so they can carry no PostgREST grammar and no LIKE wildcard (section 4.4). |
| Extensions | `create extension` appears once: `btree_gist` (`MIG/0016_booking.sql:5`) | `pg_trgm` and `unaccent` are NOT installed. The parity fingerprint lists only `btree_gist` and `plpgsql` (`packages/db/supabase/parity/fingerprint.sql:59`, `fingerprint-detail.sql:17`). |

`unaccent()` is not used, and not needed. It is STABLE, not IMMUTABLE (its result depends on a dictionary that
can be changed), so it cannot sit in a generated column or an index without an IMMUTABLE wrapper that lies about
it, and calling it at query time on every stored row defeats any index. `contact_name_fold` already does the
folding immutably, and the duplicates queue already depends on it, so search and the duplicates queue agree on
what "the same letters" means.

---

## 4. The design

### 4.1 How a typed query is read

One function, `contactSearchPlan(raw)` in a new import-free `DB/contact-search.ts`, turns what was typed into
three independent parts. Each part is a way to match; a contact matches when ANY part matches.

1. **Name tokens.** `nameFold(raw)` split on spaces, at most 6 tokens (the rest are ignored, which no real name
   reaches). A contact matches when EVERY token appears somewhere in its `search_name` (4.3): the words in any
   order, each as a substring.
   - Accents and case: folded on both sides by the same table. "Garcia", "GARCÍA" and "garcía" are one query.
   - **ñ**: the shipped fold maps ñ to n, so "Pena" finds "Peña" AND "Peña" finds "Pena" (Q1, decided 2026-10-31:
     both ways, as the duplicates queue already treats them).
   - Hyphens, periods, commas and apostrophes are word breaks: "García-López" is stored `garcia lopez`, so
     "garcia lopez", "lopez garcia" and "garcia-lopez" all find it. "O'Brien" is `o brien`: "o'brien" and
     "brien" find it, "obrien" does not (a known gap, section 10).
   - A letter typed in its decomposed form (e + combining accent, as some phones paste it) folds the same: the
     accent is outside `[a-z0-9 ]` and is dropped, leaving `e`.
   - Two surnames: "María García López" is `maria garcia lopez`; "maria lopez" finds her (both tokens are in it),
     which the duplicates queue's `name_key` deliberately cannot (`docs/superpowers/specs/2026-10-29-dedupe-merge-design.md:153`).
   - A full name typed into `first_name` alone (a one-column CSV) is still found: the stored document joins both
     columns, so where the words sit does not matter.
2. **Email.** The sanitized term as typed (`sanitizeSearchTerm`), matched as a substring of the raw `email`
   column, exactly as today (`DB/contacts.ts:930`).
3. **Phone.** Section 4.2.

The 2-character floor stays as it is, measured with `searchTermLength` on the raw term (`ROUTE:86`,
`command-palette.tsx:123`, `job-sheet.tsx:180`, `relationship-actions.ts:235`).

**Nothing found today stops being found.** The new `withSearch` keeps every clause it has today (raw `first_name`,
`last_name`, `email`, `phone`, and `phone_key` digits) and ADDS the folded-token clause and the `phone_national`
clause. The match set is therefore a strict superset of today's. That matters for names the fold empties: a name
written only in a script outside `[a-z]` (for example Chinese or Arabic) folds to nothing, and the raw clauses
still find it exactly as they do now. A db test pins the superset (section 11, T3).

### 4.2 Phone digits in any format

The phone part runs only when the term looks like a phone: today's shape rule (digits and `+ ( ) - . space` only,
`DB/contacts.ts:879`) and today's floor of **4 digits** (`:880`; Q2, decided 2026-10-31: 4, today's rule). Letters anywhere ("Suite 9",
"maria5@…") keep it off, as now. Then:

- **A leading "+" names a country code**, which is dropped before matching partial digits: `+1` drops the `1`;
  `+521` becomes `52` (the legacy mobile `1` dropped, matching how `phone_key` stores a Mexican number). The floor
  is counted after this, so "+1 956" (3 digits left) is not a phone search.
- Three clauses, any of which can match: the new key as a substring of `phone_key` (today's clause, which already
  handles "+1" full numbers through `phoneDigits`' NANP fold); `keptKey` — the pre-F-092 (`af5976fa`) digits,
  matched against `phone_key` whenever they do not already contain the new key (keeps "+1 956" and "+521 899 12"
  finding what they did); and `phoneNational(digits)` against `phone_national`, only when it is exactly 10 digits
  and differs from the new key (the full +52 shapes `phone_key` misses).

| Typed | Matches the stored number | Through |
|---|---|---|
| `(956) 555-0199`, `956.555.0199`, `9565550199` | +19565550199 | `phone_key` (as today) |
| `+1 956 555 0199` | +19565550199 | `phone_key` (`phoneDigits` folds the 1, as today) |
| `0199` (the last four) | every phone containing 0199 | `phone_key` (as today) |
| `899 123 4567` | +528991234567 | `phone_key` substring (as today) |
| `+52 1 899 123 4567`, `044 899 123 4567` | +528991234567 | `phone_national` (**new**; misses today) |
| `+521 899 12` | +528991234567 | `phone_key` after `+521` → `52` (**new**) |
| `+1 956 55` | +19565550199 | `phone_key` after dropping the `+1` (**new**: today `195655` misses) |
| `956` | nothing by phone (3 digits, under the floor); still a name/email substring | |

Highlighting a phone match (section 6) shows the digits in the number as the screen formats it: it marks the last
run of the digits, the one the stored key holds.

### 4.3 The database: migration 0108

Decided: **a stored generated document plus a trigram index**, not `unaccent()` at query time and not `name_key`
(section 3 says why neither can serve).

1. `create extension if not exists pg_trgm with schema extensions;` and every operator class written
   `extensions.gin_trgm_ops`. **ASSUMPTION:** `pg_trgm` is available, and a schema named `extensions` exists, on
   hosted Supabase (bis-ci and production), in the Supabase CLI's Docker images CI starts
   (`.github/scripts/ci-local-supabase.sh`), and on the local PG18 replica. The plan verifies it before writing
   the file: `select name from pg_available_extensions where name = 'pg_trgm'` and
   `select nspname from pg_namespace where nspname = 'extensions'`, read-only, on bis-ci and the replica; CI's
   own migration run proves the Docker images. It also reads where 0016 put `btree_gist`
   (`select extnamespace::regnamespace from pg_extension where extname = 'btree_gist'`) and follows that
   placement if `extensions` is missing anywhere.
   **Pre-flight, measured 2026-10-31 by the orchestrator (read-only), identical on production and bis-ci:** the
   `extensions` schema exists; `pg_trgm` is NOT installed and is available at default version 1.6;
   `app.contact_name_fold` exists and is IMMUTABLE (`provolatile = 'i'`); contacts: production 53, bis-ci 41. So
   0108 creates the extension `with schema extensions` and names the operator class `extensions.gin_trgm_ops`.
   Still an ASSUMPTION, proven by CI `verify` applying 0108 in its own stack: the Supabase CLI's Docker images
   carry `pg_trgm` and an `extensions` schema. The local PG17.6 replica's unpacked binaries carry only
   `btree_gist`; the plan unpacks the full archive, which holds `pg_trgm` and `btree_gin`.
2. `app.contact_search_name(p_first text, p_last text, p_company text) returns text`, `plpgsql immutable parallel
   safe set search_path = pg_catalog, pg_temp`: `contact_name_fold` of each, joined by one space, empty parts
   skipped, NULL when all three are empty. plpgsql, not sql, for 0106's measured reason: a sql function calling a
   sql function re-plans the inner one on every row (`MIG/0106_contact_merge.sql:217-219`, `:88-90`). EXECUTE for
   `authenticated` and `service_role`, revoked from `public` and `anon` (a stored generated column runs its
   function as the WRITING role, `:155-156`).
3. `contacts.search_name text generated always as (app.contact_search_name(first_name, last_name, company_name))
   stored`. `company_name` is in it because the list shows and sorts by it and a business's name should find its
   people (D3); it is written by a BEFORE trigger (`MIG/0072_company_name_read_only.sql:5-8`), and PostgreSQL
   computes stored generated columns after BEFORE triggers run (PostgreSQL documentation, "Generated Columns";
   the schema test in T1 proves it on a contact joined to a business).
4. The index: `create index contacts_search_trgm on public.contacts using gin (search_name extensions.gin_trgm_ops,
   first_name extensions.gin_trgm_ops, last_name extensions.gin_trgm_ops, email extensions.gin_trgm_ops, phone
   extensions.gin_trgm_ops, phone_key extensions.gin_trgm_ops, phone_national extensions.gin_trgm_ops)`. Every arm
   of the search's OR is on one indexed column, so the planner can answer it with one bitmap scan per arm and a
   BitmapOr; one unindexed arm would force a scan of the account's rows. A trigram index serves `ILIKE '%x%'` for
   any term of 3 or more characters; a 2-character term cannot use it and scans the account's rows (section 4.5).
5. `client_groups.search_name` generated as `app.contact_name_fold(name)` and a trigram GIN on it (Q4, decided
   2026-10-31).
6. The parity fingerprint gains `pg_trgm` in both extension lists (`parity/fingerprint.sql:59`,
   `parity/fingerprint-detail.sql:17`), so a project missing it is a parity difference, not a surprise.
7. Header in 0098/0103/0106 form (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK),
   ASCII only and no backslash (`MIG/0072_company_name_read_only.sql:20`), `lock_timeout` 5s in a `do` block.
   Rollback: drop the index(es), the column(s), the function; leave the extension (dropping it is harmless but
   unnecessary, and another migration may come to use it).

No new grant on the column: `contacts` carries table-level SELECT for `authenticated`
(`MIG/0030_contacts_sort_name.sql:37-41`), and the column is never written. `COLS` (`DB/contacts.ts:82-83`) does
not gain it: nothing renders it.

**Locks and cost.** Adding a stored generated column rewrites `contacts` under ACCESS EXCLUSIVE for the length of
the file. Production held 53 contacts on 2026-10-29 (`MIG/0106_contact_merge.sql:91`); 0106's two generated keys
rewrote 10,000 contacts in about 1 s on the replica (`:87-88`). The plan measures 0108 on the replica the same way
and writes the numbers into the header.

### 4.4 The filter

`withSearch` (`DB/contacts.ts:925-935`) is rewritten around `contactSearchPlan`, and stays the ONE filter both
`listContacts` and `countContacts` apply, so the rows, the header's real total and the export can never disagree:

```
or( first_name ilike %s%, last_name ilike %s%, email ilike %s%, phone ilike %s%,     -- today's, kept
    and(search_name ilike %t1%, search_name ilike %t2%, ...),                          -- new: every token
    phone_key ilike %d%, phone_national ilike %n% )                                   -- phone part, 4.2
```

`s` is `sanitizeSearchTerm` (interpolated unquoted, as `search-term.ts:35-43` requires for its `\_` escape). The
tokens `t1..t6` need no sanitizing at all: `nameFold`'s output is `[a-z0-9 ]` by construction, so a token cannot
contain a quote, comma, parenthesis, backslash, `%`, `*` or `_`. A unit test pins that every token of a hostile
input matches `^[a-z0-9]+$`. PostgREST accepts a nested `and(...)` inside `or(...)` (its documented logical
operators); the db test proves it on the real API.

### 4.5 Performance, designed for 50,000 contacts on one account

Today's volume is tiny (53 contacts in production, `MIG/0106_contact_merge.sql:91`), so correctness is the whole
risk today and the index is for later. The plan seeds the local replica with 10 accounts of 50,000 contacts each
(realistic Spanish names, two surnames, mixed phone shapes) and records `EXPLAIN (ANALYZE, BUFFERS)` for: page one
of the list with "garcia", "maria lopez", "0199" and "ma" under each sort; the same counts; and the palette's
three tiers (section 5). Budget: under 150 ms for a list page plus its count, under 100 ms for the palette's
contacts half, at the 95th percentile on the replica.

The trigram GIN is not account-first (a GIN index cannot lead with a uuid without the `btree_gin` extension), so a
common trigram's matches across every account are found first and then filtered to the account. If the
measurement misses the budget, the plan's fallback is `btree_gin` and a composite `(account_id, search_name)`
index, decided with the numbers in hand, not now. A 2-character term ("ma") cannot use a trigram index at all and
filters the account's own rows through the existing `(account_id, …)` indexes; at 50,000 rows that is the case the
budget is most likely to catch, and it is measured explicitly.

### 4.6 Performance, measured (plan Task 12, 2026-10-31): the budget is NOT met

Measured by bis-db-schema at `7afbad50`. 0108 is already on bis-ci and is not edited; its header points here.

**Verdict.** At 50,000 contacts on one account, as a signed-in Owner under RLS, **every line of the budget fails**,
for every term and both sorts, including `ma`'s 300 ms line. The plan's `btree_gin` fallback does not change that.
Two causes, neither in 0108's index definition: (1) ILIKE is not LEAKPROOF, so under RLS PostgreSQL cannot use
`contacts_search_trgm` for any ILIKE arm, whatever index exists; (2) the house policy on `contacts` calls
`app.current_account_id()` once per ROW, which already costs about 660 ms on an unsearched list at this size,
before and without 0108. Any fix is a new migration (0109) and an owner decision; none is written. At today's size
(53 contacts in production) all of this is sub-millisecond: the cost is per row of the account.

**Where.** PostgreSQL 17.6 (x86_64-windows, the full archive T1 unpacked, its binaries run in place) in its own
cluster, initdb `--locale=C --locale-provider=icu --icu-locale=en-US` (T1's flags), `pre` = the worktree's
0001-0107 (107 files, each `psql -1`). Seed (plan Task 12, deterministic `setseed`, triggers off, generated columns
computed): one agency, 10 accounts x 50,000 = 500,000 contacts; 40 first names (20 accented) x 40 surnames (20
accented); measured mix 70.0 % two surnames, 60.0 % with an email, 5.0 % with no phone, 3.0 % archived, phones 40 %
`+1956...`, 20 % `(956) ...`, 25 % `+52899...`, 10 % `+52 1 899 ...`; created over 2024-10-31 to 2026-10-31; no
`client_groups` rows. `vacuum analyze` before each measurement.

**0108 on 500,000 contacts** (`perf` re-created from the seeded template for each run; `psql -1`, `\timing`):

| Run | Whole file (wall) | `alter table contacts add column search_name` (the rewrite) | `create index contacts_search_trgm` |
|---|---|---|---|
| 1 | 74,562 ms | 40,372.6 ms | 33,456.1 ms |
| 2 | 77,255 ms | 41,555.2 ms | 35,049.5 ms |
| 3 | 84,469 ms | 44,479.4 ms | 39,306.7 ms |

Index sizes after `vacuum analyze`: `contacts_search_trgm` **111 MB** (116,891,648 bytes, about 234 bytes per
contact; the `contacts` heap is 124 MB); `client_groups_search_trgm` 16 kB (empty table). Every contact read and
write would wait for the whole file, about 75 to 85 s at this size, under ACCESS EXCLUSIVE.

**How.** The queries are the app's own, not retyped: `listContacts` (limit 51, `archived: "exclude"`, newest first
and by name, as `contacts/page.tsx:347-348` calls it), `countContacts`, and `searchContacts` (limit 5, the route's
`PER_SOURCE`, `ROUTE:29`, `:110`) were run against a recording client and each recorded chain was translated to the
SQL PostgREST sends: filters as bound parameters, the list as `json_agg` over a `pgrst_source` CTE with a literal
`limit`, the count as `count(*)` over the unlimited source. Every captured `.or()` string equals T4's and T5's pinned
strings where they overlap (for example `(956) 555-0199`'s `...,and(search_name.ilike.%956%,search_name.ilike.%555%,
search_name.ilike.%0199%),phone_key.ilike.%9565550199%` and its tier 1 `search_name.eq.956 555 0199,
phone_national.eq.9565550199`), including the kept `phone_key` arm (`+52 1 899 123` sends both `%52899123%` and
`%521899123%`). Each run is its own transaction, as PostgREST's: `set_config('request.jwt.claims', {org_id, sub},
true)` for an Owner membership made as `actAsMember` makes one, then `set local role authenticated`. Before any
timing the harness proved the refusal it relies on: role `authenticated`, `app.current_account_id()` = the account,
50,000 contacts visible (the superuser sees 500,000), 0 rows of a second account. 5 warm-up and 40 timed runs per
query, nearest-rank p50 and p95, wall time on localhost. The three tiers are timed one after another and summed (the
route runs them in parallel, so the sum is the conservative reading). Custom plans only: PostgREST's prepared
statements may switch to a generic plan after five runs, not measured, because no plan here can use the trigram
index for an ILIKE arm whatever its parameters (cause 1).

**p50 / p95, ms, Owner under RLS, quiet machine** (a first run, with another agent's tests on the same machine, gave
the same pass or fail on every line):

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `garcia` | 2099 | 733.8 / 839.2 | 814.6 / 1209.2 | 922.3 / 2168.7 | 24.2 / 34.8 | 631.6 / 868.3 | 719.5 / 794.6 |
| `maria lopez` | 78 | 811.5 / 1131.8 | 718.6 / 773.6 | 740.0 / 2009.2 | 13.1 / 17.9 | 725.5 / 2248.8 | 1037.3 / 1161.9 |
| `garcía lópez` | 50 | 1008.4 / 1294.8 | 746.2 / 946.9 | 759.9 / 1139.9 | 14.0 / 16.3 | 620.0 / 903.7 | 779.8 / 1444.6 |
| `ana` | 6118 | 959.0 / 1115.5 | 41.2 / 54.6 | 739.9 / 1002.4 | 20.7 / 28.1 | 33.2 / 50.7 | 37.6 / 46.0 |
| `0199` | 18 | 801.8 / 1141.9 | 753.0 / 846.7 | 785.0 / 1207.7 | 1.4 / 1.7 | 888.9 / 1125.2 | 297.4 / 346.4 |
| `(956) 555-0199` | 0 | 1059.6 / 2526.3 | 950.8 / 1868.6 | 2743.4 / 2936.3 | 1.1 / 1.4 | 892.3 / 994.6 | 1110.4 / 1202.6 |
| `+52 1 899 123` | 18 | 1147.7 / 1484.1 | 803.2 / 887.5 | 793.0 / 832.4 | 0.8 / 1.0 | 592.0 / 619.1 | 788.3 / 834.9 |
| `zzqx` | 0 | 704.6 / 773.0 | 707.7 / 747.1 | 704.4 / 761.7 | 0.8 / 1.2 | 593.1 / 666.1 | 754.1 / 893.3 |
| `ma` | 6718 | 686.4 / 750.8 | 18.8 / 26.2 | 684.1 / 727.7 | 0.9 / 1.2 | 4.3 / 5.1 | 4.8 / 6.0 |

**The lines** (sums of p95, ms):

| Term | List newest + count | List by name + count | Line | Tiers 1+2+3 | Line |
|---|---|---|---|---|---|
| `garcia` | 3007.9 | 3377.9 | < 150: **fail**, **fail** | 1697.7 | < 100: **fail** |
| `maria lopez` | 3141.0 | 2782.8 | < 150: **fail**, **fail** | 3428.6 | < 100: **fail** |
| `garcía lópez` | 2434.7 | 2086.8 | < 150: **fail**, **fail** | 2364.6 | < 100: **fail** |
| `ana` | 2117.9 | 1057.0 | < 150: **fail**, **fail** | 124.8 | < 100: **fail** |
| `0199` | 2349.6 | 2054.4 | < 150: **fail**, **fail** | 1473.3 | < 100: **fail** |
| `(956) 555-0199` | 5462.6 | 4804.9 | < 150: **fail**, **fail** | 2198.6 | < 100: **fail** |
| `+52 1 899 123` | 2316.5 | 1719.9 | < 150: **fail**, **fail** | 1455.0 | < 100: **fail** |
| `zzqx` | 1534.7 | 1508.8 | < 150: **fail**, **fail** | 1560.6 | < 100: **fail** |
| `ma` | 1478.5 | 753.9 | < 300: **fail**, **fail** | 12.3 | not budgeted |

**The plans' top nodes.** Every list, count, tier 2 and tier 3 query that does not fill early is `Bitmap Heap Scan
on contacts` over `Bitmap Index Scan on contacts_account_assigned` with `Index Cond: (account_id = ...)` only: all
50,000 of the account's rows are fetched, and the RLS conditions and every search arm run as a per-row `Filter`
(`zzqx`'s count: `Rows Removed by Filter: 50000`, 741 ms). A name-ordered page whose term is common fills early
through `Index Scan using contacts_account_sort_name` (`ana` by name: 51 rows after `Rows Removed by Filter: 2550`,
37 ms); the worst case is a rare or absent term, which visits every row. Of the 54 queries, 37 take the first shape
and 8 the second. `contacts_search_trgm` appears in exactly one shape, the other 9: tier 1's `search_name = '...'`
(`texteq` is leakproof), as `Bitmap Index Scan on contacts_search_trgm`, `Index Cond: (search_name =
'garcia'::text)`, joined for `(956) 555-0199` by `contacts_account_phone_national` for its `phone_national = ...`.
None of the 216 plans read (this run, the first run, the fallback and the diagnostic) has an ILIKE index condition.

**Cause 1: ILIKE is not LEAKPROOF.** `texticlike` has `proleakproof = false`, as do `textlike`, the regex matches,
pg_trgm's similarity operators, array containment and full-text `@@`; of the operators read, only `texteq`,
`text_ge` and `text_le` are leakproof. PostgreSQL never runs a non-leakproof condition of the query ahead of a
table's RLS conditions, so it cannot become an index condition, and for an `authenticated` caller no "contains"
search on `contacts` can be index-served. The same statement as the superuser (no RLS) is a `BitmapAnd` of
`account_id` with a `BitmapOr` of five `contacts_search_trgm` scans: `garcia`, list newest first, 30.3 ms against
989 ms as the Owner. `contacts_search_trgm` is right for the superuser and the service role, and unused by the
app's searches, all of which run on the request client.

**Cause 2: the policy runs per row.** `contacts_member_all` is `app.is_agency() OR account_id =
app.current_account_id()` (0003's house shape, read from the replica's `pg_policy`), not wrapped in `(select ...)`,
so `app.current_account_id()` (SECURITY DEFINER, a lookup) runs once per row; only `contacts_technician_scope`
(0068) is wrapped and runs once. Medians of 10, quiet: the Owner's count with NO search term (today's unsearched
`countContacts`) **676.7 ms**, with `garcia` 718.5 ms; the superuser's 13.4 and 16.6 ms. That is about 13 microseconds
per row of the account, paid by every contacts read that visits the account's rows, searched or not. The house
shape is on every account-scoped table; whether they show the same cost at this size is not measured here.

**The plan's fallback, measured.** `btree_gin` 1.3's uuid operator class is `uuid_ops` (`btree_gin--1.2--1.3.sql:22`),
not `gin_uuid_ops` as the plan guessed. On a scratch copy, `contacts_search_trgm` rebuilt as `(account_id
extensions.uuid_ops, search_name ... phone_national extensions.gin_trgm_ops)`: 112 MB (117,563,392 bytes), built in
18.4 s. The planner uses it for `account_id = ...` only (`Bitmap Index Scan on contacts_search_trgm`, `rows=50000`),
which is the same per-account bitmap as before; the ILIKE arms stay filters, for cause 1. Every list line fails
(for example `garcia` 3542.6 / 2567.8 ms, `zzqx` 2083.2 / 2287.7 ms); of the palette lines only `ana` passes (94.9 ms).

**A diagnostic, not a proposal.** On another scratch copy only, `contacts_member_all` with both helpers wrapped,
`(select app.is_agency()) or account_id = (select app.current_account_id())`: the unsearched count drops from
676.7 ms to **18.2 ms**, and `garcia`'s from 718.5 ms to 200.5 ms. Every list line still fails (for example
`garcia` 462.7 / 486.7 ms, `zzqx` 468.7 / 475.2 ms, `ma` 972.5 / 340.1 ms); the palette passes for `ana` (45.1 ms)
only. What remains is cause 1: the search arms evaluated row by row.

**Collation, an ASSUMPTION.** The search arms' own cost depends on the collation: the five ILIKE arms over the
account's 50,000 rows take 183.8 ms on this ICU `en-US` replica and 62.4 ms with `COLLATE "C"` (superuser, the bare
scan 3.3 ms). Production's and bis-ci's collation was not read for this measurement. If either is libc, the search
arms' share there is about a third of what this replica shows; cause 2's share does not depend on it.

**For the owner** (each would be a 0109; nothing here is decided or written):
- By arithmetic from the per-row costs above (not measured at that size), list plus count stays under 150 ms on
  this replica only while an account holds fewer than about 4,400 contacts: 2 queries x N rows x (13.3 + 3.7)
  microseconds.
- Wrapping the policy helpers in `(select ...)` removes cause 2 (measured above) but not cause 1, and it changes the
  house shape every account-scoped table copies.
- Only a path that does not put ILIKE under RLS can use the trigram index: for example a SECURITY DEFINER function
  that takes the account from `app.current_account_id()` (never from a parameter), applies the technician scope
  itself, and returns the matching ids from `contacts_search_trgm`, with the list then reading `id in (...)` under
  RLS (`uuid` equality is leakproof). Its floor is the superuser plan, 16.6 ms for `garcia`'s count; it is not
  measured end to end, and it would move `EXPECTED_DEFINERS` from 37 to 38.

**Decision (owner, 2026-10-31).** Ship F-092 part 1 as is. Production's largest single account holds 40 contacts
on 2026-10-31, and the per-row arithmetic above keeps a list page plus its count under the 150 ms budget for any
account below about 4,400 contacts, so today's shipped 0108 already meets the budget everywhere it runs. A
follow-up item makes lists and search fast at 50,000 contacts per account by doing both fixes together: wrapping
the account-scoped policies' `app.current_account_id()` calls in `(select ...)` (removes cause 2), and a
server-side search that can use `contacts_search_trgm` (for example a SECURITY DEFINER id matcher, moving
`EXPECTED_DEFINERS` from 37 to 38; removes cause 1). That item is measured on the replica first and is done before
any account passes about 2,000 contacts, half the estimated ceiling. Each fix lands as its own new migration
(0109+); 0108 stays exactly as applied.

---

## 5. Order and paging

**The contact list keeps its own order** while a search is on (Q3, decided 2026-10-31): the sort the person
chose, newest first by default (`DB/contacts.ts:944`), the same cursor (`:963-984`), exactly one pager and the real
total from `countContacts`. Search stays a filter and sort stays the other, independent axis, as the list already
promises (`ACCT/contacts/page.tsx:461-467`; DESIGN.md "Paged lists", line 197). Nothing about paging changes,
because nothing but `withSearch` changes.

**The small boxes show the best match first.** The palette (5 rows), Add job and held email (through the route),
and the relationship and shared-number pickers (8 rows) never page, so their order decides whether the person is
found at all. A new `searchContacts(db, accountId, { term, limit, assignee? })` in `DB/contacts.ts` runs three
queries in parallel, each with `withSearch`'s match set narrowed further, the same holding, archive, merge and
assignee helpers, `order by sort_name, id` and `limit`:

1. **Exact**: `search_name` equals the tokens joined by a space; or `phone_national` equals the typed number's
   national digits (10 or more digits typed); or `email_key` equals `emailKey(term)` (the term holds an `@`).
2. **Every word starts a word**: each token begins the document or follows a space (`search_name ilike 't%'` or
   `ilike '% t%'`), so "ana" ranks "Ana García" above "Mariana" and "Susana".
3. **Contains**: the rest of the match set.

The rows are merged in tier order, de-duplicated by id, and cut to `limit`. Tiers 1 and 2 are subsets of the full
match set, so a later "see all results" (F-095) that links to the list with `?q=` will show every row the box did,
and more. The route switches to `searchContacts` and passes the RAW trimmed term (today it passes the already
sanitized one, `ROUTE:85`, `:95`, which only works because sanitizing twice happens to be harmless). The ⌘K palette
sends the trimmed raw query too (final review M-5, `paletteSearchUrl`), so "john_doe@x.com" reaches the exact-email
tier. The route also accepts `types=contacts`, which Add job and held email send, so they stop paying for the calls
and conversations searches they never read (`job-sheet.tsx:186`, `held-email-search.ts:48`).

**The hit says why it matched.** The route's `sublabel` is today `email ?? phone` (`ROUTE:104`); when the match
came through the phone part it shows the phone, so a search by number shows the number. The `SearchHit` type
(`ROUTE:10-19`) is unchanged.

---

## 6. Highlighting, and the empty and error states

**Highlighting.** Where a name or phone that matched is shown, the matched letters are set in weight 600 inside
a `<mark>` reset to no background and the inherited colour (DESIGN.md line 67: hierarchy by weight first, colour
last; no new token, no hard-coded colour). A new import-free `WEB/lib/contacts/search-highlight.ts` folds the
displayed string one character at a time with the same table as `nameFold` (one per-character export added beside
it in `DB/dedupe-keys.ts`, so the table is never declared twice), finds each token, and maps the ranges back to
the original characters, so "García" highlights "García", accent included. A phone highlight maps digit positions
onto the number as displayed. Applied in: the contact list's name and phone cells (`ACCT/contacts/contacts-table.tsx`),
the Add job rows (`job-sheet.tsx:318-322`), the held-email rows, the relationship and shared-number pickers. The
palette's rows render through `command-palette.tsx`, which is bis-frontend's: they call the same helper (T7).

**Empty states** (DESIGN.md rule 5, line 111; bilingual DoD line 397). The list's no-match copy today is a
generic "No matches" (`WEB/lib/messages.ts:631-634`). New copy, under the `contacts.` namespace, `{digits}` filled
with the floor from section 4.2:

| When | English | Spanish |
|---|---|---|
| Active list, nothing matches | **Nobody matches “{query}”** — Try part of the name, or the last {digits} digits of their phone. | **Nadie coincide con “{query}”** — Pruebe con parte del nombre o con los últimos {digits} dígitos del teléfono. |
| Same, with a ghost link (archived contacts leave search by the owner's 2026-10-28 ruling; this does not bring them back, it offers to look) | Look in archived customers | Buscar en clientes archivados |
| Technician, nothing matches (their list is only theirs, `ACCT/contacts/page.tsx:152-157`) | **None of your customers match “{query}”** | **Ninguno de sus clientes coincide con “{query}”** |
| Mine, nothing matches (the voluntary Mine filter, same copy as the Technician row: both searched only the signed-in person's own customers) | **None of your customers match “{query}”** | **Ninguno de sus clientes coincide con “{query}”** |
| Unassigned, nothing matches | **No unassigned customer matches “{query}”** | **Ningún cliente sin asignar coincide con “{query}”** |
| Archived view, nothing matches | **No archived customer matches “{query}”** | **Ningún cliente archivado coincide con “{query}”** |

The “Look in archived customers” link appears only in the whole-account, All, active view (`view === "active" &&
wholeAccount && assign.who === "all"`): from inside Mine, Unassigned or the Archived view itself it would silently
widen the search to everyone's archived customers. The link carries `?view=archived&q=…` and states no count: how
many archived customers match is not known without a query the empty state has no reason to run (“never promise a
number the screen cannot know”). The palette's and
Add job's existing "Nothing matches “{query}”." / "Nada coincide con “{query}”." (`messages.ts:3899-3900`) and
their error rows (`:3903-3904`) stay. Loading stays as it is: the list renders on the server, and the boxes already
show their own skeleton or nothing while a request is out (rule 7). Every new string passes the pseudo-locale's
+35% at phone width; the empty-state title wraps rather than truncates.

---

## 7. Access

- **Account scope.** Every query in this design starts `.eq("account_id", accountId)` (`DB/contacts.ts:949`,
  `:1058`) and runs on the signed-in person's RLS client: the route (`ROUTE:88`, "NEVER serviceDb here"), the
  relationship action (`relationship-actions.ts:236`), the list page (`ACCT/contacts/page.tsx:299`), the export
  (`export/route.ts:120`), the groups search (`groups-actions.ts:92`). `searchContacts` takes the caller's client
  and is never handed `serviceDb()`.
- **Technicians see only their own customers**, and that is enforced by the database, not the list: the
  restrictive policy `contacts_technician_scope` (`MIG/0068_mine_unassigned_technician.sql:103-107`) admits a
  Technician's row only when `assigned_to` is them. Search adds a filter, never a path around RLS, so it inherits
  the rule. "Mine" and "Unassigned" (`withAssignee`, `DB/contacts.ts:909-911`) are a separate, voluntary filter
  that search keeps applying where it applies today. The T3 db test runs a search as a Technician session
  (`DB/test/assignment.test.ts:11` has the helper that makes one) and asserts only their assigned customers come
  back, in the rows AND the count.
- **Archived contacts leave search; merged-away records never appear; a shared number's holding record is never a
  customer.** All three are already applied by `withArchived` (`DB/contacts.ts:917-923`) and the holding skip
  (`:949`, `:1058`), by the owner's ruling (`docs/superpowers/specs/2026-10-28-contact-archive-design.md:46`,
  `:273`). Searching inside the Archived view searches archived contacts only, as today. `searchContacts` reuses
  the same helpers, so the boxes match the list.

---

## 8. Decisions this spec makes (recommended, changeable in review)

| # | Decision | Why |
|---|---|---|
| D1 | Reuse `app.contact_name_fold` and `nameFold`; no new fold, no `unaccent`, no `normalize()` | Immutable, shipped, twin-tested; search and the duplicates queue agree. Letters outside Spanish and Portuguese Latin-1 (for example "ễ" in "Nguyễn") are dropped by it: "Nguyễn" is stored `nguyn`, found by "nguyễn" and "nguy", not by "nguyen". Widening the fold would change `name_key` and re-pair duplicates, so it waits for part 2's one index |
| D2 | Words in any order, each a substring, all required | "garcia maria" and "maria lopez" must work; one word that is not in the name narrows rather than widens |
| D3 | `company_name` is part of the searched name | The list shows and sorts by it; a business's name should find its people |
| D4 | The match set is a superset of today's | No customer found today stops being found (section 4.1) |
| D5 | List keeps its chosen order; boxes rank exact, word-start, contains | Section 5; Q3 decided 2026-10-31 |
| D6 | The route takes `types=contacts` and the raw term | Section 5 |
| D7 | Highlight by weight, not colour | DESIGN.md line 67 |
| D8 | Exact lookups (dedupe, caller ID, forms) unchanged | Section 2 row 13 |
| D9 | Calls and conversations search unchanged | Section 10 |

---

## 9. Owner questions: DECIDED 2026-10-31 (all four as recommended)

1. **When someone types "n", should search find "ñ"?** **DECIDED 2026-10-31: (A) yes, both ways.** "Pena" finds
   "Peña" and "Peña" finds "Pena": the existing `app.contact_name_fold` / `nameFold` behaviour, unchanged, so search
   agrees with the duplicates queue. (Not chosen: B, one way, which cost a second stored name; C, ñ and n distinct.)
2. **How many digits before search treats what was typed as a phone number?** **DECIDED 2026-10-31: (A) 4**,
   today's rule (`MIN_PHONE_SEARCH_DIGITS`), so "the one ending in 0199" works. (Not chosen: B, 3; C, 7.)
3. **While a search is on, what order does the contact list show?** **DECIDED 2026-10-31: (A).** The contact list
   keeps the order already chosen (newest first unless changed), its cursor paging, its one pager and its real
   total while searching; the ⌘K box and the pick-a-customer boxes rank the best match first (exact, every word
   starts a word, contains). (Not chosen: B, best match first in the list too, which needed a database function and
   a new page marker.)
4. **Should the household and business search follow the same rules in this part?** **DECIDED 2026-10-31: (A)
   yes.** "Familia Garcia" finds "Familia García": `client_groups.search_name`, stored and trigram-indexed, lands in
   the same migration 0108. (Not chosen: B, customers only.)

---

## 10. Not in this part

- **Part 2** (`docs/crm-features.md:1555`): one index across every record type, nickname expansion ("Chuy" finds
  Jesús), typo tolerance ("Garsia"). The trigram index this part adds is what a similarity search would use.
- **F-095** (`:1434`): Spanish type words, the "Buscar o preguntar" box, "Ver los N resultados".
- **Calls search by formatted phone** (`DB/voice.ts:1311-1322`, bis-voice's): every caller gets a contact
  (`WEB/lib/voice/textback.ts:174-190`), so the contacts half already finds the person by any phone format and their
  calls hang off the record, as that function's own comment says (`DB/voice.ts:1305-1306`).
- **Message bodies** (`DB/messaging.ts:967-985`): accent folding over message text belongs to the one index.
- Joined-up words ("obrien" for "O'Brien", "garcialopez"), and a name and a number in one query ("maria 0199").
- `&`, `_` and `+` inside a word lose the word boundary, the same gap as the joined-up case above: "Smith&Sons" is
  stored `smithsons`, one token, not two.
- A curly apostrophe "’" is dropped while a straight `'` becomes a space, so the two spellings of the same name
  rank differently: "O'Brien" (straight) folds to two tokens, "o brien"; "O’Brien" (curly) folds to one, "obrien".
- A query of more than 6 words (`MAX_NAME_TOKENS`) never reaches the exact tier: only the first 6 folded words
  build tier 1's equality, so a seven-word typed name cannot equal a stored `search_name` of more words.
- A placeholder label ("Unnamed contact") is never highlighted (`SearchHit.unnamed`): nothing in it is the
  customer's own name, so no client marks letters in it.
- The deal picker that cannot reach past the newest 200 contacts (section 13).

---

## 11. Task outline (risk tier per the speed process)

| # | Task | Owner | Tier |
|---|---|---|---|
| T0 | Verify the ASSUMPTIONs in 4.3 (pg_trgm, the `extensions` schema, where `btree_gist` lives) on bis-ci and the replica, read-only | bis-db-schema | low |
| T1 | Migration 0108 (4.3) + the twin `contactSearchName` and the per-character fold export in `DB/dedupe-keys.ts` + a schema test comparing column and twin on real shapes (accents, ñ, two surnames, hyphen, apostrophe, decomposed accent, non-Latin name, a business member, empty) + a signed-in insert and edit succeeding (0106's EXECUTE lesson) + the parity fingerprint lists. Replica run, then CI project, then production, then parity: the orchestrator's | bis-db-schema | **high** |
| T2 | `contactSearchPlan` (tokens, email term, phone keys with the "+" rule and floor) in import-free `DB/contact-search.ts`, with unit tests: the table in 4.2, the hostile-input token test, the 6-token cap | bis-crm | low |
| T3 | `withSearch` rewrite (4.4), db tests: Garcia/García, "garcia maria", "maria lopez", Peña/Pena per question 1, the 4.2 phone table, superset of today's clauses, archived/merged/holding excluded, rows equal count, a Technician session sees only theirs. Run by the orchestrator (an agent never runs the `@bis/db` suite in a worktree) | bis-crm | medium |
| T4 | `searchContacts` tiers (section 5); route switch with raw term, `types=contacts`, phone-aware sublabel; relationship action switch; route and action tests | bis-crm | medium |
| T5 | `search-highlight.ts` and its tests; highlighting in the list, Add job, held email and the two pickers | bis-crm | low |
| T6 | Empty-state copy EN/ES (section 6), the archived link, the Technician variant; copy-catalogue tests incl. the milestone guard | bis-crm | low |
| T7 | Palette rows use the highlight helper | bis-frontend | low |
| T8 | The 50,000-contact measurement (4.5) on the replica, numbers into 0108's header; `btree_gin` fallback only if the budget is missed | bis-db-schema with bis-crm | medium |
| T9 | (Q4 decided) `searchGroups` on `client_groups.search_name` tokens, accent test | bis-crm | low |
| T10 | e2e (bis-e2e-qa): typing "garcia maria" in the list and in ⌘K finds a "María García" made on the per-run fixture account, never on Test Client One, whose Maria Garcia carries no accent and must stay read-only | bis-e2e-qa | medium |

---

## 12. Where the brief and the source disagree

1. **`name_key` is not "accents and two surnames folded".** It keeps the first name and only the FIRST surname, as
   an equality key, and is NULL without a last name or with a placeholder first name
   (`MIG/0106_contact_merge.sql:220-231`). It cannot serve search; its fold function can (section 3).
2. **The Technician rule is not in the contact list's code.** It is a restrictive RLS policy
   (`MIG/0068_mine_unassigned_technician.sql:103-107`); the list's "Mine" filter is a separate thing (section 7).
3. **There are no merge or compare pickers.** The merge screen takes both records from the URL (`ACCT/contacts/merge/page.tsx:46-52`).
4. **There is no inbox search box.** Conversations are found only through ⌘K's message-body half (`DB/messaging.ts:967`).
5. **Archived contacts in search is not an open question.** The owner ruled on 2026-10-28 that an archived contact
   leaves search (`docs/superpowers/specs/2026-10-28-contact-archive-design.md:46`); this spec keeps it and offers a
   link to the Archived view from an empty search.
6. Verified as the brief stated: `email_key` (0034), `phone_national` and its twin, `dedupe-keys.ts` import-free,
   the Add job search through the route, the contact list's server sort and cursor paging, migration number 0108.

---

## 13. Findings outside this part (for the ledger)

1. **The new-deal picker cannot reach most customers on a large account.** `ACCT/pipeline/page.tsx:26` loads the
   newest 200 contacts into a plain Select (`ACCT/pipeline/add-opportunity-dialog.tsx:78-89`); a customer older
   than that cannot be chosen at all. It should become a search box on `searchContacts` (a pipeline task, not this
   part).
2. **Add job and held email run two searches they throw away** (`ROUTE:94-98`): fixed in T4 by `types=contacts`.
3. **The route sanitizes twice** (`ROUTE:85`, then `DB/contacts.ts:926`): harmless today, removed in T4.

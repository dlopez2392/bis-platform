# Contacts search that ignores accents and finds full names and phone digits (F-092 part 1): design

Date: 2026-10-31. Author: bis-crm. Base: `af5976fa` (branch `feat/search-accents`).
Status: design. Nothing here is built. Four owner questions are open (section 9).
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
| 8 | **Household or business: find one** (record page's groups card) | `ACCT/contacts/groups-card.tsx:381` → `groups-actions.ts:87-92` → `DB/client-groups.ts:130-144` | `client_groups.name ilike '%term%'`, 8 rows by `name_key`; `name_key` is `lower(btrim(name))` (`MIG/0069_client_groups.sql:36-38`), so no accent folding | **Owner question 4** |
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
   - **ñ**: the shipped fold maps ñ to n, so "Pena" finds "Peña" AND "Peña" finds "Pena" (owner question 1).
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
`DB/contacts.ts:879`) and today's floor of **4 digits** (`:880`; owner question 2). Letters anywhere ("Suite 9",
"maria5@…") keep it off, as now. Then:

- **A leading "+" names a country code**, which is dropped before matching partial digits: `+1` drops the `1`;
  `+521` becomes `52` (the legacy mobile `1` dropped, matching how `phone_key` stores a Mexican number). The floor
  is counted after this, so "+1 956" (3 digits left) is not a phone search.
- Two clauses, either matching: the digits as a substring of `phone_key` (today's clause, which already handles
  "+1" full numbers through `phoneDigits`' NANP fold), and `phoneNational(digits)` as a substring of
  `phone_national` whenever that differs (it differs exactly for the full +52 shapes `phone_key` misses).

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

Highlighting a phone match (section 6) shows the digits in the number as the screen formats it.

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
5. If owner question 4 says yes: `client_groups.search_name` generated as `app.contact_name_fold(name)` and a
   trigram GIN on it.
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

---

## 5. Order and paging

**The contact list keeps its own order** while a search is on (owner question 3, recommended): the sort the person
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
sanitized one, `ROUTE:85`, `:95`, which only works because sanitizing twice happens to be harmless). The route
also accepts `types=contacts`, which Add job and held email send, so they stop paying for the calls and
conversations searches they never read (`job-sheet.tsx:186`, `held-email-search.ts:48`).

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
| Archived view, nothing matches | **No archived customer matches “{query}”** | **Ningún cliente archivado coincide con “{query}”** |

The link carries `?view=archived&q=…` and states no count: how many archived customers match is not known without
a query the empty state has no reason to run ("never promise a number the screen cannot know"). The palette's and
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
| D5 | List keeps its chosen order; boxes rank exact, word-start, contains | Section 5; owner question 3 can overturn the first half |
| D6 | The route takes `types=contacts` and the raw term | Section 5 |
| D7 | Highlight by weight, not colour | DESIGN.md line 67 |
| D8 | Exact lookups (dedupe, caller ID, forms) unchanged | Section 2 row 13 |
| D9 | Calls and conversations search unchanged | Section 10 |

---

## 9. Owner questions

1. **When someone types "n", should search find "ñ"?**
   - **(A) Yes, both ways: "Pena" finds "Peña", and "Peña" finds "Pena". Recommended:** staff on an English
     keyboard type "Pena", and the duplicates queue already treats the two as the same name, so search agrees with it.
   - (B) One way: "Pena" finds "Peña", but typing "Peña" finds only "Peña". Costs a second stored name.
   - (C) No: ñ and n are different letters, and "Pena" never finds "Peña".
2. **How many digits before search treats what was typed as a phone number?**
   - **(A) 4. Recommended:** it is today's rule, and "the one ending in 0199" is how people remember a number.
   - (B) 3: finds by area code ("956"), but in the Valley nearly everyone shares one, so it finds everyone.
   - (C) 7: fewer accidental matches, but the last four digits alone no longer work.
3. **While a search is on, what order does the contact list show?**
   - **(A) The order already chosen (newest first unless changed); the ⌘K box and the pick-a-customer boxes show
     the best match first. Recommended:** the pager and the total work exactly as they do now, and the small boxes,
     which show 5 to 8 names, are where order decides whether you find the person.
   - (B) Best match first in the list too, while a search is on. Needs a database function and a new kind of page
     marker; about 3 more days.
4. **Should the household and business search follow the same rules in this part?**
   - **(A) Yes: "Familia Garcia" finds "Familia García". Recommended:** it is one more stored name in the same
     migration (under a day), and otherwise the record page finds "García" the person but not "García" the family.
   - (B) No: customers only; households and businesses wait for part 2.

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
| T9 | If question 4 is A: `searchGroups` on `client_groups.search_name` tokens, accent test | bis-crm | low |
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

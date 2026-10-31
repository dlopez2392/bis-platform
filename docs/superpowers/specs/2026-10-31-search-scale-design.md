# Contact lists and search at 50,000 contacts per account (F-092 scale follow-up): design

Date: 2026-10-31. Author: bis-db-schema. Base: `6de56435` (origin/main, 0108 included; branch `feat/search-scale`).
Status: design with measurements. Nothing here is built or applied. Migrations: **0109** (the policy wrap) and
**0110** (the search path), two files because the owner's decision says each fix lands as its own migration
(`F092:387-388`; section 9). 0108, `contact_search`, is the newest file in `packages/db/supabase/migrations/` and is
on production and bis-ci.

Every claim about current code cites `path:line` at `6de56435`. Short forms as in the F-092 spec: `ACCT/` =
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`, `MIG/` = `packages/db/supabase/migrations/`,
`DB/` = `packages/db/src/`, `ROUTE` = `apps/web/src/app/api/accounts/[accountId]/search/route.ts`, `F092` =
`docs/superpowers/specs/2026-10-31-search-accents-design.md`. A claim about a system outside this repo is labelled
**ASSUMPTION** and names how it is verified. Where the brief and the source disagree, the source wins (section 9).

The item, from the owner's decision (`F092:380-388`): make contact lists and search fast at 50,000 contacts per
account, before any account passes about 2,000 contacts (largest today: 40, read below), by doing both fixes
together: wrap the account-scoped policies' helper calls in `(select ...)` (cause 2) and give search a server-side
path that can use `contacts_search_trgm` (cause 1). Budgets, as `F092:233-235` set them, at the 95th percentile on
the replica: a list page plus its count under 150 ms; the palette's contacts half under 100 ms; `ma` (a
2-character term, which no trigram index can serve) under 300 ms.

---

## 1. What T12 found, and what this adds

T12 (`F092:244-388`) measured 0108 at 500,000 contacts (10 accounts x 50,000) as a signed-in Owner and found every
budget line failing, for two causes neither of which is in 0108's index: (1) `ILIKE` is not LEAKPROOF, so under
RLS no `ILIKE` arm can become an index condition (`F092:333-340`); (2) `contacts_member_all` calls
`app.current_account_id()` once per row, about 13 microseconds a row, which costs an UNSEARCHED count about 677 ms
(`F092:342-348`). Its one diagnostic wrapped only that policy and stopped there (`F092:357-361`).

This document adds: the inventory of every policy with the cause-2 shape (section 2), with the contacts read paths
mapped onto it; measurements of five options as an Owner, a Technician and the agency, including the unsearched
list and count and a second hot table (section 3); one recommended design with its tests, security review and
deploy order (section 4); the owner's choices (section 5); and a task outline (section 6).

**Verdict, measured.** Wrapping alone, (b), fixes every unsearched read (Owner list plus count 1,226 -> 60 ms) and
everything a Technician does, but leaves every searched Owner line failing (430-715 ms). Wrapping plus a
SECURITY DEFINER matcher over an account-first trigram index, (d), brings every searched line under 150 ms except
the two-letter `ma` (588-674 ms), which byte-wise comparison for two-letter terms, (e), brings to 211-244 ms. No
option changed a single answer (3.4). ⌘K passes by the slowest tier, which is what the route waits for; by T12's
conservative sum of the three tiers, `garcia` and `ana` still miss its 100 ms line (3.7).

---

## 2. Cause 2: every policy that calls a helper once per row

### 2.1 How it was read

`pg_policies` on the replica (0001-0108, PostgreSQL 17.6), dumped whole and classified by script: every call to an
`app.*` helper that is NOT inside an uncorrelated `( SELECT ... )` (an InitPlan, evaluated once per statement) is a
per-row call. The same digest of every policy row (`md5` over table, name, permissive, roles, command, `qual`,
`with_check`, ordered) reads **`4f4914fcd094dbb3f13894fa6e19b3f2` on the replica, on production and on bis-ci**
(read-only, 2026-10-31): 136 policies on 64 tables, identical text in all three. So the inventory below is
production's.

### 2.2 The inventory

| Shape | Policies | Tables | Text today | Wrappable? |
|---|---|---|---|---|
| **The 0003 house shape** | **50** | **49** | `(app.is_agency() OR (account_id = app.current_account_id()))`, in `qual` and, for the 20 `ALL` policies, `with_check` (29 SELECT, 20 ALL, 1 INSERT) | Yes |
| Agency-only | 9 | 9 | `app.is_agency()` or `COALESCE(app.is_agency(), false)` | Yes |
| `accounts_member_read`, `accounts_member_update` | 2 | 1 | `clerk_org_id = (app.jwt() ->> 'org_id') AND client_access_enabled` | Yes |
| `memberships_member_read` | 1 | 1 | `account_id = app.current_account_id()` | Yes |
| `inbound_never_log_member_read` | 1 | 1 | `COALESCE(app.is_agency(), false) OR account_id = app.current_account_id()` | Yes |
| `users_member_read` | 1 | 1 | `EXISTS (select 1 from memberships m where m.user_id = users.id ... and m.account_id = app.current_account_id())` | Yes: the call has no row reference; its InitPlan hangs off the correlated sub-plan |
| `inbound_never_log_no_technician` | 1 | 1 | `COALESCE(app.sees_all_customers(account_id), false)` | **No, not by wrapping**: it passes a ROW column (section 2.4) |
| Already wrapped, or no helper | 71 | 48 | e.g. every `*_technician_scope` (0068), every owner-only restrictive policy (0066) | Nothing to do |

The 49 house-shape tables: account_billing, ai_acts, automation_log, automation_settings, automations, bookings,
business_status, calendars, calls, checklist_items, client_group_members, client_groups, closed_days,
consent_events, contact_duplicate_flags (2 policies), contact_relationships, contact_tags, contacts, conversations,
custom_fields, custom_values, document_requests, document_requirement_skips, document_shares, document_versions,
documents, equipment, events, form_submissions, forms, inbound_emails, messages, notes, opportunities,
phone_numbers, pipeline_stages, pipelines, places, proposals, record_summaries, site_traffic_breakdown,
site_traffic_daily, sites, tags, tasks, usage_events, voice_knowledge_snapshots, voice_profiles, voice_services.
The agency-only nine: account_ai_settings, accounts (`accounts_agency_all`), agencies, ai_gateway_settings,
ai_ledger, blueprints, memberships (`memberships_agency_read`), plans, users (`users_agency_read`).

In all: **65 policies on 59 tables call a helper per row; 64 can be wrapped as they stand.**

Where the shape comes from: `MIG/0003_crm_core.sql:118-130` generated `%I_member_all` with the bare calls for ten
tables, and later migrations were told to copy the live `notes_member_all` row (`MIG/0033_contact_dedupe_keys.sql:75`,
`MIG/0036_alert_phone_verifications.sql:336`, `MIG/0040_call_proposals.sql:68`). The schema already knows the
cure: 0066 wrapped its owner-only policies precisely because a SECURITY DEFINER helper "cannot be inlined, and
called as app.is_account_owner(account_id) it ran once per row" (`MIG/0066_staff_and_roles.sql:73-78`, measured
245 ms to 60 ms), and 0068 wrote every Technician policy wrapped (`MIG/0068_mine_unassigned_technician.sql:13-14`,
`:103-107`). The permissive house policy those restrictive ones are ANDed with was never revisited.

### 2.3 What the contacts list, count, export and search hit

| Read | Code | Policies evaluated | Per-row helper calls today |
|---|---|---|---|
| The list page and its header total | `listContacts` + `countContacts`, `ACCT/contacts/page.tsx:350-354`, both on the request client (`:319`) | `contacts_member_all` (permissive) AND `contacts_technician_scope` (restrictive, already wrapped) | `app.current_account_id()` per row of the account (and `app.is_agency()`, inlined, per row) |
| The export | `countContacts` (agency only) then `listContacts` in chunks of 500, `ACCT/contacts/export/route.ts:126`, `:157`, `:76`; tags per chunk through `contact_tags` + `tags` | the same, plus `contact_tags_member_all` and `tags_member_all` (house shape) | the same, on every chunk |
| ⌘K, Add job, held email | `searchContacts` (3 tiers), `ROUTE:113`; the route also runs `searchCalls` and `searchConversations` unless `types=contacts` | contacts as above; `calls_tenant`, `conversations_member_read`, `messages_member_read` (house shape) for the other two halves | the same |
| Relationship and shared-number pickers | `searchContacts`, `ACCT/contacts/relationship-actions.ts:239` | contacts as above | the same |
| Dashboard tile | `countContacts(db, accountId)`, `ACCT/dashboard/page.tsx:148` | contacts as above | the same: an unsearched count of every active contact |
| Deal picker | `listContacts(db, accountId, { limit: 200 })`, `ACCT/pipeline/page.tsx:26` | contacts as above | a bounded page |

Five other policies read `contacts` in a sub-query and so pay `contacts_member_all` once per row of THEIR table:
`ai_acts_technician_scope`, `contact_archive_log_read`, `contact_merges_read`, `proposals_technician_scope`,
`record_summaries_through_contact`.

### 2.4 Is wrapping semantically identical?

**Yes, for all 64, and the helpers' definitions are why.** Read from the replica's `pg_proc` (identical files
on all three projects):

| Helper | Defined | Volatility | SECURITY DEFINER | Arguments | Per-row today means |
|---|---|---|---|---|---|
| `app.jwt()` | `MIG/0001_tenancy.sql:4-7` | STABLE | no | none | inlined: a `current_setting` plus a `jsonb` parse per row |
| `app.is_agency()` | `MIG/0001_tenancy.sql:9-12` | STABLE | no | none | inlined (plain SQL, no SET): the same parse per row |
| `app.current_account_id()` | `MIG/0008_client_access.sql:13-18` (0096 appended `pg_temp` to its path) | STABLE | yes (`search_path = public, pg_temp`) | none | NOT inlinable (definer + SET): a function call and an `accounts` lookup per row |

1. A STABLE function promises the same result for the same arguments for every row within one statement
   (PostgreSQL documentation, "Function Volatility Categories"). These three take no arguments, so every per-row
   call in a statement already returns one value; an uncorrelated `(select f())` computes that value once (an
   InitPlan) and hands it to every row. NULL is carried through unchanged: a client token's `is_agency()` is NULL
   and `NULL OR x` reads the same whether NULL came from a call or a sub-select; a disabled account's
   `current_account_id()` is NULL either way (`MIG/0008_client_access.sql:13-18`), and `account_id = NULL` refuses
   either way. An error (a malformed claims string failing the `::jsonb` cast) is raised either way, at the first
   row that needs the value.
2. What could differ, and does not here: a statement that changes `request.jwt.claims` between rows. PostgREST sets
   the claims once, before the statement (the bench and `DB/test/db.ts:22-25` model the same), and nothing in the
   app calls `set_config` mid-statement.
3. The precedent already runs on production: the restrictive policies of 0066 and 0068 are exactly this form, and
   `contacts_technician_scope` is ANDed with `contacts_member_all` on every contacts read today.
4. **The one that cannot be wrapped:** `inbound_never_log_no_technician` calls `app.sees_all_customers(account_id)`
   with the ROW's account. Wrapping needs an argument with no row in it. It could be REWRITTEN as
   `(select app.sees_all_customers(app.current_account_id()))` (the permissive policy already limits a member's rows
   to their own account, and the agency's answer does not depend on the argument), but that is a rewrite whose
   equivalence rests on the other policy, not a wrap. `inbound_never_log` is a small log (one row per blocked
   inbound), so this design leaves it alone and the guard test (4.6) names it as the one exception.

Nothing else in the 65 depends on per-row evaluation: no other helper call in a policy takes a column.

---

## 3. Measurements

### 3.1 Where and how

- **The replica**: T12's own cluster, copied (PostgreSQL 17.6 x86_64-windows, ICU `en-US`, T12's initdb flags,
  `F092:256-262`), on its own port. `perf` = 0001-0108 plus T12's seed (10 accounts x 50,000 contacts, `F092:258-262`);
  the 108 migration files T12 applied are byte-identical to `6de56435`'s. Added for this item
  (`scale-spec/seed-extra.sql`, deterministic): a **Technician** on account 01 with 2,500 of its contacts assigned
  (5 %, random), and 100,000 conversations (one per contact of accounts 01 and 02) holding 200,000 messages;
  `vacuum analyze` after. Each option is a template copy of `perf`.
- **The queries are the app's own**: `listContacts` (limit 51, `archived: "exclude"`, newest first and by name, as
  `ACCT/contacts/page.tsx:350-353` calls it), `countContacts`, and `searchContacts` (limit 5, `ROUTE:32`, `:113`),
  recorded from the scale worktree's `DB/contacts.ts` and translated to the SQL PostgREST sends by T12's translator
  (`F092:276-284`), plus the **unsearched** list and count (the same chains, no term). The `rpc` path is the same
  chain with its first `.or()` (`contactSearchFilter`'s match set) replaced by `from
  public.contacts_matching("p_account_id" := $1, ...)`, parameters bound as a GET call binds them; `rpcpost` passes
  each argument as a sub-select, the form PostgreSQL refuses to inline.
- **Three callers**, each in its own transaction per run, as PostgREST: `request.jwt.claims` set local, then `set
  local role authenticated`. Owner (T12's), Technician, agency (`app_role: agency_admin`, `org_id: org_agency`).
  Before any timing the harness proves the refusal it relies on, or refuses to measure: role `authenticated`;
  rows visible in account 01: 50,000 / 2,500 / 50,000; in account 02: 0 / 0 / 50,000.
- 3 warm-up and 20 timed runs per query (15 for the baseline and the Technician's (d), 10 for the agency),
  nearest-rank p50 and p95 in ms, wall time on localhost. A **line** is the sum of p95s, T12's conservative
  reading (the page runs list and count in parallel, `ACCT/contacts/page.tsx:350-354`; the route runs its tiers
  in parallel, `DB/contacts.ts:1139`). Bold marks a line over its budget.
- **Equivalence**: each query's first answer is digested (md5 of the page's ids, or the count) and compared across
  options for the same caller.

### 3.2 The options

| | What | Database |
|---|---|---|
| (a) | Today: 0108 | `perf` |
| (b) | `contacts_member_all` wrapped (`scale-spec/wrap-contacts.sql`) | `perf_b`; `perf_ball` = all 64 wrapped (`wrap-all.sql`), for the inbox |
| (c) | (b) + the matcher and its entry point (`scale-spec/matcher.sql`) over 0108's index | `perf_b` |
| (d) | (c) with `contacts_search_trgm` re-created account-first (`btree_gin`, `scale-spec/build-d.sql`) | `perf_d` |
| (e) | (d) with the matcher reading 2-character terms under `COLLATE "C"` (`scale-spec/matcher-c.sql`) | `perf_d` |

Considered and not measured, because neither can work: **marking `texticlike` LEAKPROOF** needs a superuser
(production's `postgres` has `rolsuper = false`, read 2026-10-31) and would be wrong anyway (an `ILIKE` can raise on a
malformed pattern, which is the leak LEAKPROOF forbids); **`COLLATE "C"` on the list's own filter** cannot be sent
through PostgREST's filter grammar, and an arm under a collation other than the column's cannot use the trigram
index (the planner matches an index only under the column's own collation), so it can only help the 2-character
scan, which is (e).

### 3.3 The budget lines

Bold is over budget. A dash is a query not run for that option (the baseline ran on a six-term subset; T12's full
Owner table, `F092:296-306`, is the same data and code). (e) differs from (d) only for terms shorter than 3
characters, so its `garcia` and `ana` cells are a second run of (d)'s structure and show the run-to-run spread:
⌘K `garcia` 111 in one run, 77 in the other.

**Owner: list newest first + count** (sum of p95, ms; budget 150, `ma` 300)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 48503 | **1226** | 60 | – | – | – |
| `garcia` | 2099 | **1687** | **525** | 77 | 51 | 46 |
| `maria lopez` | 78 | **1700** | **527** | 47 | 26 | – |
| `garcía lópez` | 50 | – | **522** | 65 | 25 | – |
| `ana` | 6118 | – | **430** | **702** | 100 | 91 |
| `0199` | 18 | **1668** | **605** | 15 | 11 | – |
| `(956) 555-0199` | 0 | – | **599** | 33 | 20 | – |
| `+52 1 899 123` | 18 | – | **714** | 54 | 46 | – |
| `zzqx` | 0 | **1556** | **523** | 6 | 10 | – |
| `ma` | 6718 | **1612** | **751** | **543** | **674** | 244 |

**Owner: list by name + count**

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 48503 | **561** | 20 | – | – | – |
| `garcia` | 2099 | **1642** | **593** | 72 | 51 | 48 |
| `maria lopez` | 78 | **1737** | **523** | 47 | 23 | – |
| `garcía lópez` | 50 | – | **610** | 63 | 26 | – |
| `ana` | 6118 | – | **227** | **641** | 112 | 108 |
| `0199` | 18 | **1597** | **626** | 15 | 9 | – |
| `(956) 555-0199` | 0 | – | **609** | 31 | 17 | – |
| `+52 1 899 123` | 18 | – | **715** | 56 | 57 | – |
| `zzqx` | 0 | **1669** | **551** | 6 | 10 | – |
| `ma` | 6718 | **767** | **447** | **552** | **588** | 211 |

**Owner: ⌘K, tiers 1+2+3** (sum of p95, and the slowest tier, which is what the route waits for; budget 100, `ma` not budgeted by F-092, 300 here)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `garcia` | 2099 | **1743 (max 963)** | **200 (max 165)** | **155 (max 62)** | **111 (max 45)** | 77 (max 29) |
| `maria lopez` | 78 | **1540 (max 770)** | **467 (max 307)** | 87 (max 42) | 40 (max 20) | – |
| `garcía lópez` | 50 | – | **436 (max 263)** | 81 (max 31) | 33 (max 15) | – |
| `ana` | 6118 | – | 46 (max 19) | **834 (max 298)** | **140 (max 57)** | **185 (max 79)** |
| `0199` | 18 | **1050 (max 739)** | **198 (max 118)** | 23 (max 9) | 16 (max 6) | – |
| `(956) 555-0199` | 0 | – | **411 (max 288)** | 36 (max 18) | 23 (max 11) | – |
| `+52 1 899 123` | 18 | – | **542 (max 398)** | 55 (max 28) | 55 (max 30) | – |
| `zzqx` | 0 | **1677 (max 896)** | **498 (max 330)** | 11 (max 5) | 16 (max 5) | – |
| `ma` | 6718 | 15 (max 8) | 7 (max 3) | **792 (max 273)** | **950 (max 381)** | 289 (max 108) |

**Technician: list newest first + count** (sum of p95, ms; budget 150, `ma` 300)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 2436 | 80 | 38 | – | – | – |
| `garcia` | 99 | 136 | 70 | 25 | 34 | – |
| `maria lopez` | 6 | 143 | 66 | 38 | 45 | – |
| `garcía lópez` | 3 | – | 86 | 52 | – | – |
| `ana` | 267 | – | 67 | 39 | 53 | – |
| `0199` | 1 | 137 | 69 | 12 | – | – |
| `(956) 555-0199` | 0 | – | 69 | 42 | – | – |
| `+52 1 899 123` | 1 | – | 70 | 52 | – | – |
| `zzqx` | 0 | 120 | 67 | 10 | 9 | – |
| `ma` | 332 | 139 | 71 | 38 | 48 | 17 |

**Technician: list by name + count**

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 2436 | 45 | 20 | – | – | – |
| `garcia` | 99 | 146 | 75 | 25 | 35 | – |
| `maria lopez` | 6 | 140 | 71 | 40 | 53 | – |
| `garcía lópez` | 3 | – | 86 | 42 | – | – |
| `ana` | 267 | – | 39 | 39 | 53 | – |
| `0199` | 1 | 147 | 83 | 13 | – | – |
| `(956) 555-0199` | 0 | – | 75 | 45 | – | – |
| `+52 1 899 123` | 1 | – | 65 | 50 | – | – |
| `zzqx` | 0 | 128 | 78 | 10 | 8 | – |
| `ma` | 332 | 110 | 58 | 38 | 47 | 18 |

**Technician: ⌘K, tiers 1+2+3** (sum of p95, and the slowest tier, which is what the route waits for; budget 100, `ma` not budgeted by F-092, 300 here)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `garcia` | 99 | **152 (max 67)** | 65 (max 33) | 54 (max 25) | 70 (max 25) | – |
| `maria lopez` | 6 | **151 (max 69)** | 76 (max 33) | 78 (max 38) | 99 (max 45) | – |
| `garcía lópez` | 3 | – | 78 (max 36) | 62 (max 24) | – | – |
| `ana` | 267 | – | 30 (max 21) | 79 (max 39) | 71 (max 30) | – |
| `0199` | 1 | **162 (max 100)** | 87 (max 62) | 17 (max 6) | – | – |
| `(956) 555-0199` | 0 | – | 61 (max 37) | 45 (max 22) | – | – |
| `+52 1 899 123` | 1 | – | 69 (max 41) | 70 (max 35) | – | – |
| `zzqx` | 0 | **143 (max 82)** | 71 (max 47) | 12 (max 4) | 10 (max 3) | – |
| `ma` | 332 | 16 (max 7) | 10 (max 6) | 54 (max 19) | 64 (max 25) | 22 (max 9) |

**agency: list newest first + count** (sum of p95, ms; budget 150, `ma` 300)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 48503 | **178** | 57 | – | – | – |
| `garcia` | 2099 | **609** | **439** | 50 | 40 | – |
| `ana` | 6118 | – | – | – | 77 | – |
| `zzqx` | 0 | **620** | **468** | 4 | 5 | – |
| `ma` | 6718 | – | – | **522** | **472** | 207 |

**agency: list by name + count**

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `(none)` | 48503 | **182** | 20 | – | – | – |
| `garcia` | 2099 | **585** | **442** | 50 | 42 | – |
| `ana` | 6118 | – | – | – | 77 | – |
| `zzqx` | 0 | **607** | **477** | 4 | 4 | – |
| `ma` | 6718 | – | – | **547** | **491** | 183 |

**agency: ⌘K, tiers 1+2+3** (sum of p95, and the slowest tier, which is what the route waits for; budget 100, `ma` not budgeted by F-092, 300 here)

| Term | Matches | (a) today | (b) wrapped | (c) b + matcher | (d) c + account-first index | (e) d + `COLLATE "C"` for 2 characters |
|---|---|---|---|---|---|---|
| `garcia` | 2099 | **481 (max 287)** | **173 (max 145)** | 95 (max 36) | 73 (max 29) | – |
| `ana` | 6118 | – | – | – | **142 (max 62)** | – |
| `zzqx` | 0 | **455 (max 288)** | **354 (max 239)** | 8 (max 3) | 10 (max 4) | – |
| `ma` | 6718 | – | – | **768 (max 262)** | **742 (max 266)** | 298 (max 120) |

**Per query, p50 / p95 ms.** Owner, (d), the recommended structure:

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `garcia` | 2099 | 20.8 / 23.1 | 21.2 / 23.7 | 22.1 / 27.7 | 22.2 / 25.7 | 34.5 / 45.3 | 33.0 / 39.8 |
| `maria lopez` | 78 | 8.3 / 13.1 | 8.9 / 10.6 | 7.5 / 12.7 | 13.8 / 20.2 | 8.1 / 12.0 | 7.7 / 8.2 |
| `garcía lópez` | 50 | 10.9 / 13.2 | 10.5 / 13.7 | 9.3 / 11.8 | 6.2 / 6.5 | 10.0 / 12.4 | 9.6 / 14.5 |
| `ana` | 6118 | 35.2 / 49.0 | 47.7 / 60.8 | 38.4 / 50.7 | 22.9 / 39.6 | 43.2 / 57.2 | 34.7 / 43.1 |
| `0199` | 18 | 4.0 / 6.5 | 4.1 / 4.4 | 3.5 / 4.1 | 3.4 / 6.2 | 3.7 / 4.3 | 3.9 / 5.1 |
| `(956) 555-0199` | 0 | 8.1 / 10.9 | 7.8 / 8.7 | 7.6 / 8.7 | 0.9 / 1.3 | 8.7 / 10.3 | 8.2 / 11.0 |
| `+52 1 899 123` | 18 | 15.5 / 18.3 | 15.7 / 29.3 | 15.7 / 27.3 | 0.9 / 1.2 | 19.9 / 23.7 | 26.4 / 30.0 |
| `zzqx` | 0 | 4.3 / 5.4 | 3.8 / 5.3 | 3.6 / 4.8 | 3.7 / 5.4 | 3.8 / 5.2 | 4.2 / 5.4 |
| `ma` | 6718 | 261.4 / 345.6 | 212.0 / 260.4 | 246.4 / 327.9 | 220.5 / 245.9 | 295.7 / 381.3 | 261.5 / 323.1 |

Owner, (e), the terms it was run on (only `ma` reads differently; the other two rows are the same structure re-run):

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `garcia` | 2099 | 20.8 / 22.7 | 22.1 / 25.1 | 19.7 / 22.9 | 19.5 / 21.3 | 25.3 / 29.2 | 24.0 / 26.5 |
| `ana` | 6118 | 34.9 / 43.4 | 50.3 / 60.5 | 37.1 / 47.1 | 25.1 / 42.8 | 53.5 / 78.5 | 42.5 / 64.0 |
| `ma` | 6718 | 95.4 / 142.1 | 90.5 / 109.1 | 83.1 / 101.4 | 61.9 / 77.7 | 99.8 / 108.3 | 86.9 / 103.4 |

Owner, (a) today, re-measured (compare T12's `F092:296-306`):

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `(none)` | 48503 | 559.6 / 670.1 | 3.7 / 5.3 | 489.3 / 555.6 | – | – | – |
| `garcia` | 2099 | 718.7 / 912.5 | 715.9 / 867.6 | 710.3 / 774.6 | 29.4 / 43.8 | 608.3 / 736.6 | 740.5 / 962.9 |
| `maria lopez` | 78 | 731.8 / 842.0 | 702.3 / 879.0 | 740.9 / 857.7 | 13.3 / 22.0 | 618.1 / 748.5 | 721.5 / 769.5 |
| `0199` | 18 | 730.2 / 840.2 | 727.7 / 769.1 | 751.5 / 828.2 | 1.0 / 1.2 | 589.0 / 738.9 | 220.4 / 309.4 |
| `zzqx` | 0 | 700.3 / 780.8 | 716.4 / 893.2 | 712.0 / 775.6 | 0.8 / 1.2 | 601.5 / 779.7 | 737.8 / 896.4 |
| `ma` | 6718 | 696.7 / 874.4 | 18.6 / 29.8 | 670.2 / 737.2 | 0.9 / 1.1 | 4.6 / 8.2 | 4.8 / 5.9 |

Owner, (b) wrapped only:

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `(none)` | 48503 | 36.3 / 42.3 | 2.1 / 2.3 | 16.1 / 18.1 | – | – | – |
| `garcia` | 2099 | 226.1 / 240.0 | 246.7 / 308.5 | 217.8 / 284.9 | 26.9 / 31.3 | 127.9 / 165.2 | 3.2 / 3.4 |
| `maria lopez` | 78 | 233.6 / 285.0 | 241.7 / 280.8 | 213.0 / 241.9 | 15.1 / 20.2 | 112.5 / 139.3 | 217.1 / 307.0 |
| `garcía lópez` | 50 | 231.5 / 259.1 | 252.0 / 347.2 | 222.9 / 262.4 | 12.3 / 16.0 | 101.2 / 157.0 | 231.3 / 263.2 |
| `ana` | 6118 | 187.3 / 218.4 | 11.9 / 14.8 | 185.8 / 211.9 | 15.5 / 18.9 | 7.5 / 13.7 | 11.5 / 13.9 |
| `0199` | 18 | 233.1 / 262.3 | 247.5 / 283.0 | 234.5 / 342.8 | 0.7 / 1.0 | 99.7 / 118.0 | 66.1 / 79.1 |
| `(956) 555-0199` | 0 | 255.6 / 319.3 | 255.5 / 329.3 | 238.0 / 279.7 | 0.8 / 0.9 | 93.3 / 122.5 | 247.6 / 287.8 |
| `+52 1 899 123` | 18 | 284.3 / 336.6 | 295.2 / 337.6 | 286.9 / 377.6 | 0.7 / 1.0 | 103.5 / 142.4 | 312.4 / 398.4 |
| `zzqx` | 0 | 200.1 / 211.7 | 207.7 / 240.0 | 215.6 / 311.3 | 0.7 / 1.0 | 149.9 / 167.2 | 275.0 / 329.6 |
| `ma` | 6718 | 242.2 / 316.7 | 7.7 / 12.5 | 214.3 / 434.3 | 0.8 / 1.4 | 1.7 / 2.1 | 2.1 / 3.0 |

Owner, (c) wrapped + matcher over 0108's index:

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `garcia` | 2099 | 35.6 / 44.8 | 35.5 / 39.9 | 30.4 / 32.0 | 32.3 / 37.8 | 52.7 / 61.6 | 45.6 / 55.5 |
| `maria lopez` | 78 | 23.5 / 25.6 | 21.2 / 25.2 | 19.1 / 21.7 | 36.8 / 41.9 | 20.6 / 23.1 | 19.1 / 22.0 |
| `garcía lópez` | 50 | 31.4 / 35.6 | 31.4 / 33.5 | 27.5 / 29.4 | 19.4 / 21.4 | 24.9 / 28.5 | 25.7 / 31.4 |
| `ana` | 6118 | 317.2 / 408.4 | 278.9 / 347.4 | 229.9 / 293.1 | 231.0 / 257.7 | 237.1 / 278.7 | 250.3 / 297.7 |
| `0199` | 18 | 6.4 / 7.8 | 6.1 / 7.7 | 5.5 / 7.1 | 6.0 / 6.5 | 5.6 / 7.5 | 6.2 / 8.9 |
| `(956) 555-0199` | 0 | 14.1 / 16.5 | 12.5 / 15.3 | 13.8 / 16.1 | 1.3 / 1.6 | 13.9 / 17.5 | 14.2 / 16.4 |
| `+52 1 899 123` | 18 | 22.9 / 26.3 | 20.7 / 28.8 | 20.4 / 27.3 | 1.0 / 1.4 | 21.3 / 27.5 | 20.9 / 26.2 |
| `zzqx` | 0 | 2.9 / 3.4 | 2.5 / 3.2 | 2.2 / 2.9 | 2.4 / 3.1 | 3.0 / 4.5 | 2.4 / 3.7 |
| `ma` | 6718 | 227.1 / 268.1 | 231.6 / 277.4 | 229.6 / 274.5 | 212.5 / 261.5 | 238.9 / 272.5 | 234.9 / 258.1 |

Technician, (a) today and (d):

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `(none)` | 2436 | 37.9 / 39.3 | 3.5 / 4.1 | 37.2 / 40.7 | – | – | – |
| `garcia` | 99 | 55.3 / 65.7 | 54.3 / 74.8 | 51.4 / 70.7 | 19.9 / 26.6 | 45.9 / 58.6 | 51.5 / 67.0 |
| `maria lopez` | 6 | 51.2 / 68.3 | 50.0 / 65.2 | 48.9 / 74.7 | 13.3 / 20.2 | 45.0 / 61.5 | 52.0 / 69.4 |
| `0199` | 1 | 51.3 / 61.0 | 57.4 / 71.7 | 52.8 / 75.6 | 0.8 / 1.0 | 42.9 / 60.3 | 69.7 / 100.3 |
| `zzqx` | 0 | 48.7 / 61.8 | 55.3 / 69.6 | 51.5 / 58.3 | 0.8 / 0.9 | 43.0 / 60.3 | 64.2 / 81.6 |
| `ma` | 332 | 48.9 / 70.5 | 31.3 / 40.8 | 52.2 / 68.9 | 0.9 / 1.2 | 3.9 / 7.4 | 4.1 / 7.2 |

Technician, (d):

| Term | Matches | List, newest first | List, by name | Count | Tier 1 exact | Tier 2 word starts | Tier 3 contains |
|---|---|---|---|---|---|---|---|
| `garcia` | 99 | 16.2 / 17.6 | 16.2 / 18.3 | 15.1 / 16.6 | 20.5 / 21.4 | 17.7 / 23.6 | 16.7 / 24.7 |
| `maria lopez` | 6 | 16.2 / 17.8 | 15.6 / 26.2 | 17.6 / 26.7 | 24.5 / 44.9 | 18.5 / 26.9 | 20.2 / 27.3 |
| `ana` | 267 | 17.0 / 26.1 | 15.9 / 27.0 | 17.1 / 26.4 | 17.0 / 30.0 | 13.8 / 23.2 | 14.4 / 17.9 |
| `zzqx` | 0 | 2.7 / 3.9 | 2.7 / 3.1 | 2.4 / 4.7 | 2.6 / 3.1 | 2.6 / 3.3 | 2.5 / 3.1 |
| `ma` | 332 | 15.4 / 24.1 | 14.1 / 23.2 | 12.8 / 23.6 | 11.3 / 17.1 | 14.3 / 21.5 | 14.7 / 25.2 |

### 3.4 Equivalence: no option changed a single answer

For the same caller, every digest (the page's ids in order, or the count) was identical across options: (a) and (b)
on 33 of 33 Owner queries, 33 of 33 Technician, 15 of 15 agency; (b) and (c) on 54 of 54 Owner, 54 of 54
Technician, 12 of 12 agency; (b) and (d) on 54 of 54 Owner and 30 of 30 Technician; (c) and (d) on 18 of 18 agency;
(b) and the POST shape on 30 of 30 Owner; (b) and (e) on 18 of 18 Owner and 6 of 6 Technician. The seed's names are
all Latin, so (e) could not differ here even where its meaning does (3.8); that case belongs in the test (4.6).

### 3.5 A second hot table: wrapping contacts alone does not help it

The inbox's first page (`listConversations`, `DB/messaging.ts:707-741`, hand-translated to PostgREST's embed
shape, NOT recorded), a probe that visits every conversation of the account (a count), and one thread's messages;
`perf` (a), `perf_b` (contacts only wrapped), `perf_ball` (all 64 wrapped); 20 runs, p50 / p95 ms:

| Read | Caller | (a) today | contacts only wrapped | all 64 wrapped |
|---|---|---|---|---|
| Inbox, page one (50 rows) | Owner | 5.8 / 6.1 | 5.6 / 6.7 | 3.9 / 4.2 |
| | Technician | 47.3 / 57.1 | 47.6 / 49.4 | 17.8 / 21.3 |
| Every conversation of the account (probe) | Owner (50,000) | 472.0 / 515.9 | 492.4 / 536.0 | **6.5 / 7.7** |
| | Technician (2,500) | 35.8 / 42.1 | 34.4 / 37.0 | 11.3 / 12.5 |
| One thread's messages | Owner | 1.2 / 1.7 | 1.2 / 1.7 | 1.1 / 1.3 |
| | Technician | 45.9 / 57.5 | 42.2 / 47.5 | 12.7 / 14.3 |

The inbox's own page is cheap today because it walks `conversations_account_recent` in order and stops at 50 rows;
anything that visits the account's rows (a count, an unindexed filter, a report on the request client) pays about
10 microseconds a row (contacts: about 13, `F092:346-347`), and only wrapping THAT table's policy removes it.

### 3.6 The POST shape (not inlined) is about as fast

Called with each argument as a sub-select, the form PostgreSQL will not inline, every plan carries `Function Scan on
contacts_matching`; the digests are identical and the lines barely move (Owner, p95 sums, newest+count /
name+count / ⌘K): `garcia` 71 / 87 / 97 against (d)'s 51 / 51 / 111, `ana` 107 / 148 / 221 against 100 / 112 / 140,
`zzqx` 5 / 7 / 9 against 10 / 10 / 16. The matcher's narrow id set, not the inlining, is what makes it fast; GET
stays the recommendation (4.4) because it is the cheaper of the two on the broad terms.

### 3.7 Where the remaining time goes

- **`ana` in (c)**: 0108's GIN is not account-first, so a common trigram finds the matches of all ten accounts
  (about 61,000) before the account filter; (d)'s account-first GIN intersects inside the index: newest+count 702 ->
  100 ms.
- **`ma`**: two characters hold no trigram, so the matcher reads all 50,000 rows of the account and runs the arms
  on each. Under ICU a case-insensitive comparison costs about three times what it costs under `C` (T12: five arms
  over 50,000 rows, 183.8 against 62.4 ms, `F092:363-366`); (e) runs the arms under `C` for terms shorter than 3
  characters: newest+count 674 -> 244 ms.
- **⌘K's sum**: each tier calls the matcher again, so three matcher calls per keystroke. By T12's conservative
  sum, `garcia` (111 ms) and `ana` (140 ms) miss the 100 ms line in (d); by the slowest tier, which is what the
  route waits for (it awaits the three in parallel, `DB/contacts.ts:1139`), every term is under it (45 and 57 ms).

### 3.8 What (e) changes in meaning, exactly

For the `search_name`, `phone_key` and `phone_national` arms, nothing: their contents are `[a-z0-9 ]` or digits by
construction (`F092:72`, `:75-76`). For the four raw arms (`first_name`, `last_name`, `email`, `phone`), `C` folds
only the ASCII letters where ICU folds every cased letter. Spanish and Portuguese names are unaffected, because the
folded `search_name` arm still matches them ("ín" finds "ÍÑIGUEZ" through `inigue...`). What changes, for a
2-character term only: a name in a cased script the fold drops (Cyrillic, Greek, Armenian) typed in the other
case from the stored name ("ив" stops finding "ИВАНОВ" and "Иванов"; it still finds "иванов", and "Ив" still
finds "Иванов"), and two symbols whose lower case is ASCII (the Kelvin
sign and the dotted capital I). This is owner question 2.

### 3.9 What the migrations cost at 500,000 contacts

- 0109's 64 `alter policy` statements as one transaction (`scale-spec/wrap-all.sql` on `perf_ball`): 386, 220 and
  261 ms over three runs. No table is rewritten. The policy digest afterwards reads
  `960f704c23380d8d6f9e650de13826ed`: what T2 should read on both projects after 0109, if PostgreSQL deparses the
  same text there (both are 17.6).
- 0110's index (`scale-spec/build-d.sql`): `create extension btree_gin` 60 ms, the drop 621 ms, the build
  16,424 ms, 117,571,584 bytes (0108's: 116,891,648 bytes, `F092:272`; T12's identical fallback: 18.4 s,
  `F092:350-353`). At production's 53 contacts the index is 352 kB today (read 2026-10-31).

---

## 4. The design (recommended)

Two migrations and one app change. **0109** is part A alone: it changes no outcome, can ship first and on its own,
and by itself fixes every unsearched read. **0110** is parts B and C, the search path. Then bis-crm switches the
search readers (4.4). Each part is measured in section 3.

### 4.1 Part A (0109): every wrappable policy, wrapped (64 policies on 59 tables)

`alter policy <name> on public.<table> using (...) [with check (...)]` for each of the 64, the expression being the
live one with each bare helper call replaced by its `(select ...)` form, nothing else changed (name, command,
roles, permissive or restrictive all stay, which `alter policy` guarantees by not touching them). The house shape
becomes:

```sql
((select app.is_agency()) or account_id = (select app.current_account_id()))
```

The 64 statements are GENERATED from the live `pg_policies` rows, not typed: the generator that produced the
measured `perf_ball` database (`scale-spec/genwrap.mjs`, four fixed text substitutions keyed on the exact live
expressions, refusing any row whose text it does not recognise) writes them into the migration, and the test in 4.6
recomputes the same substitution from the pre-0109 text it pins and compares. A hand-typed `account_id =
(select app.current_account_id()` with a typo in one of 64 places is the risk this removes.

`inbound_never_log_no_technician` stays as it is (section 2.4).

After 0109 the live `notes_member_all` row, which later migrations are told to copy, IS the wrapped form, so every
future table inherits it; the guard test in 4.6 fails naming any policy that reintroduces a bare call.

### 4.2 Part B (0110): the trigram index leads with the account

`create extension if not exists btree_gin with schema extensions;` then `contacts_search_trgm` dropped and re-created
with `account_id extensions.uuid_ops` as its first column and the seven trigram columns after it, exactly 0108's
seven (`MIG/0108_contact_search.sql`). A GIN index over several columns answers `account_id = X and col ilike p` in
ONE scan that intersects the account's posting list with the pattern's trigrams, so a common trigram (`ana`) no
longer fetches every account's matches first (section 3). `btree_gin` 1.3 is available, not installed, on production
and on bis-ci (read 2026-10-31); its uuid operator class is `uuid_ops` (`F092:350`). **ASSUMPTION:** the Supabase
CLI's Docker images CI starts carry `btree_gin`; CI `verify` applying 0110 proves it, as it proved `pg_trgm` for 0108.
The parity fingerprint gains `btree_gin` in both extension lists (`packages/db/supabase/parity/fingerprint.sql:59`,
`fingerprint-detail.sql:17`), as 0108 added `pg_trgm` (`F092:195-196`).

### 4.3 Part C (0110): the matcher (a new SECURITY DEFINER) and its invoker entry point

```
app.contact_match_ids(p_account_id uuid, p_text text, p_tokens text[] default '{}',
                      p_phone_keys text[] default '{}', p_national text default null) returns setof uuid
  plpgsql, STABLE, SECURITY DEFINER, set search_path = pg_catalog, pg_temp
public.contacts_matching(<the same five, the same defaults>) returns setof public.contacts
  sql, STABLE, INVOKER, NO set clause:
  select c.* from public.contacts c where c.id in (select app.contact_match_ids(<the five>))
```

The matcher, in order (the measured body is `scale-spec/matcher.sql`; the migration adds the service-role branch and
the defaults):

1. **Who may ask about which account.** `service_role` (read as `current_setting('role', true) = 'service_role'`,
   which inside a definer still names the CALLER's role while `current_user` is the owner, proven on the replica;
   an `authenticated` session cannot set it, because `set role` requires membership) is answered for the named
   account, as RLS lets it read every row. Anyone else is answered only when the house predicate holds, written
   null-safe: `if not coalesce(coalesce(app.is_agency(), false) or p_account_id = app.current_account_id(), false)
   then return; end if;`. The outer `coalesce` is load-bearing: `is_agency()` is NULL for a client token, and a bare
   `if not (...)` on a NULL takes neither branch and FAILS OPEN (the plpgsql trap the schema has met before).
   **The account comes from the parameter, admitted by the predicate, not from `app.current_account_id()` alone**:
   the agency's token carries `org_id: "org_agency"` (`apps/web/src/lib/auth.test.ts:40`), so
   `current_account_id()` is NULL for every agency read, and a matcher keyed on it would answer the agency nothing.
2. **The Technician scope** (for every caller but `service_role`), as `contacts_technician_scope` states it (`MIG/0068_mine_unassigned_technician.sql:103-107`):
   unless `coalesce(app.sees_all_customers(app.current_account_id()), false)`, the caller must be a current
   Technician (`app.is_technician(app.current_account_id())`) and gets only rows with `assigned_to =
   app.current_user_id()`; a client with no membership gets nothing.
3. **Inputs refused, never repaired** (`22023`): `p_text` empty, longer than 160 (80 typed characters, each `_`
   escaped to two), or holding `%` or any backslash not followed by `_` (exactly what `sanitizeSearchTerm` can emit,
   `DB/search-term.ts:57-81`); more than 6 tokens (`MAX_NAME_TOKENS`, `DB/contact-search.ts:8`) or a token outside
   `^[a-z0-9]+$`; more than 2 phone keys or a key outside `^[0-9]+$`; a national number that is not 10 digits. The
   checks are written without a backslash (`chr(92)`), as 0072's rule requires (`F092:198`).
4. **The match**, `contactSearchFilter`'s arms (`DB/contacts.ts:898-911`) in its order: the four raw `ilike` arms
   on `p_text`, the tokens ANDed on `search_name`, each phone key on `phone_key`, the national ten on
   `phone_national`; run as `return query execute <fixed text with $1..$3> using p_account_id, v_me, v_patterns`.
   Every pattern is a bound parameter; the only text spliced is fixed SQL and integer array positions. Dynamic SQL
   on purpose: a one-shot plan sees the real patterns, so each arm becomes a bitmap scan of `contacts_search_trgm`
   and an absent arm is absent, not an `is null or` the planner cannot index.
5. It returns ids only, of every matching row of the account (archived, merged and holding records included):
   the app's own `withArchived` and holding filters still decide those, outside, exactly as today.

The entry point is the only thing PostgREST can call (`app` is not an exposed schema,
`packages/db/supabase/config.toml:13`). It is INVOKER, so RLS on `contacts` applies to every row it returns: the
matcher's account and Technician checks are a SECOND gate, not the only one. It has no `set` clause and is a single
`select`, which is what lets PostgreSQL inline it into the caller's statement (measured: no `Function Scan on
contacts_matching` in any plan, section 3), so the app's `eq`, `or`, `order` and `limit` reach `contacts` and its
indexes directly. The 0096 rule binds functions that SET a search path (`DB/test/definer-search-path.test.ts:17-20`);
an invoker function with no SET runs as its caller and can raise no one's privileges.

Grants: EXECUTE on both to `authenticated` and `service_role`; revoked from `public` and `anon`. The matcher is the
38th definer in `public` and `app`: `EXPECTED_DEFINERS` goes from 37 to 38
(`DB/test/definer-search-path.test.ts:25-31`, `:81-87`) with `["search_path=pg_catalog, pg_temp"]`.

### 4.4 How the app calls it (bis-crm's change, after 0110 is applied)

Nothing changes for an unsearched read: it stays `db.from("contacts")`, and part A alone makes it fast. When
`contactSearchFilter(search)` is non-null (`DB/contacts.ts:898-911`), the three readers swap their source and drop
the `.or(filter)`; everything else in each chain stays as it is:

| Reader | Today | After |
|---|---|---|
| `listContacts` (`DB/contacts.ts:960-1011`) | `db.from("contacts").select(COLS)...` + `withSearch` | `db.rpc("contacts_matching", args, { get: true }).select(COLS)...`, no `withSearch`; the two `order`s, `limit`, the cursor's `.or()` (`:986-1007`), `withAssignee`, `withArchived` unchanged |
| `countContacts` (`:1075-1090`) | `db.from("contacts").select("id", { count: "exact", head: true })` + `withSearch` | `db.rpc("contacts_matching", args, { head: true, count: "exact" })`, the same `eq`s, `withAssignee`, `withArchived` |
| `searchContacts` (`:1109-1149`) | `base()` = `db.from("contacts")...or(filter)` | `base()` = the `get: true` rpc; tier 1's and tier 2's extra `.or()` unchanged, so tiers stay subsets of the match set |
| Export, list page, ⌘K route, pickers, dashboard | call the three above | **no change** |

`args` comes from one new import-free function beside `contactSearchFilter`, built from the SAME
`sanitizeSearchTerm` and `contactSearchPlan` calls, and null exactly when `contactSearchFilter` is null:
`{ p_account_id, p_text: s, p_tokens: plan.tokens, p_phone_keys: [plan.phone?.key, plan.keptKey] (present ones),
p_national: plan.phone?.national }`, with an absent part left `undefined`, NEVER `null`: with `get`/`head`,
postgrest-js puts arguments in the URL, drops `undefined`, writes an array as `{a,b}` and writes `null` as the
string `"null"` (read from `@supabase/postgrest-js` 2.110.8, `dist/index.mjs:3837-3846`), which the matcher would
refuse. Hence the defaults in 4.3. `get: true` matters: a POST sends the arguments in a JSON body, and the
POST-shaped call measured in section 3 is not inlined. A set-returning RPC chained with `.select().order().range()`
already exists in the package (`DB/proposals.ts:181-183`). `contactSearchFilter` stays: it is the oracle the
equivalence tests compare against, and the `phoneMatches` sublabel rule still reads the same plan.

**What survives, and why.** Cursor paging and sort: the entry point returns `contacts` rows, so the same
`order(column).order(id)` and the same row-value cursor apply to the same columns. The real total: the count is the
same entry point with the same filters, so rows and total cannot disagree (the list, its count and the export keep
sharing one match rule, now the matcher's). The Technician scope: applied twice, by the matcher and by
`contacts_technician_scope` on the rows it returns. Archive, merge and holding rules: unchanged, outside.

### 4.5 What it does to `ma`

Owner question 2 decides this. Recommended (option (e), measured): when the sanitized term is shorter than 3
characters, the matcher writes every arm as `col collate "C" ilike $n` (`scale-spec/matcher-c.sql`, one `v_c`
variable). A term of 3 or more characters is untouched, and must be: an arm under a collation other than the
column's cannot use the trigram index. Measured at 50,000 contacts: the Owner's `ma` list newest first plus count
674 -> 244 ms, by name 588 -> 211, ⌘K 950 -> 289 (slowest tier 108); the agency's 207 / 183 / 298; the
Technician's 17 / 18 / 22. What it changes in meaning is 3.8. If the owner keeps exact meaning, the `v_c` line is
left out and 2-character searches stay at (d)'s 588-674 ms on a 50,000-contact account.

### 4.6 Tests that prove it (bis-db-schema; red before apply where marked)

**For 0109**, two new files (as built in T1, 2026-10-31): `packages/db/src/test/policy-initplans-schema.test.ts` (items 1
and 2, red before apply) and `packages/db/src/test/policy-initplans-behaviour.test.ts` (item 3, green before and after),
`withRollback` + `actAs`:

1. **Pins (red pre-apply).** For each of the 64 policies: `qual` and `with_check` equal the generated wrapped text.
   The pre-0109 text is pinned in the test as the input, and the expected text is computed from it by the same four
   substitutions, so a hand edit to either side fails.
2. **Guard (red pre-apply: names 64 policies).** No policy in `public` calls `app.current_account_id()`,
   `app.is_agency()` or `app.jwt()` outside an uncorrelated `( SELECT ...)`, except
   `inbound_never_log_no_technician`. Mutation: add a bare-call policy in the test's own transaction -> FAILS naming
   it.
3. **Behaviour matrix (green before AND after; it is an equivalence guard, not a red-first test, and the report
   says so).** Two accounts, one row of each kind in contacts, conversations, messages, bookings, calls, notes,
   tasks, documents (one `owners_only`), memberships, users; roles Owner, Staff, Technician (one assigned contact),
   member with no membership, client with access disabled, agency, forged claims: for each role and table the
   visible ids, and for each `ALL` policy one cross-account insert refused `42501`. As built
   (`policy-initplans-behaviour.test.ts`): nine roles, reads on 20 tables, and every write in its own savepoint, so a
   refusal does not abort the rest; every house `ALL` table gets the same insert on the caller's account and on
   another. Five of them (automations, calendars, calls, phone_numbers, voice_profiles) hold no INSERT grant for
   `authenticated`, so their refusal is the GRANT's and no policy change can move it.
4. **Two existing pins move.** `one-switch-schema.test.ts:517` and `structured-facts-schema.test.ts:429` pin the
   unwrapped house text for `business_status_member_read` and `voice_services_member_read`; both become the wrapped
   text in the same task.

**For 0110**, `packages/db/src/test/contact-match-schema.test.ts`, new:

5. **Shape (red pre-apply).** The matcher: `prosecdef`, `proconfig = {search_path=pg_catalog, pg_temp}`, STABLE;
   the entry point: not `prosecdef`, `proconfig` NULL, language sql, STABLE (a later SET clause or definer flag
   would silently stop the inlining, so it is pinned); EXECUTE for `authenticated` and `service_role`, none for
   `anon` or `public`, on both. `EXPECTED_DEFINERS` 37 -> 38.
6. **The matcher called DIRECTLY, per role.** Through the entry point alone RLS would hide a matcher that answered
   too much, so these call `app.contact_match_ids` itself: Owner of A asking for B -> 0 ids (mutation: drop the
   house check -> FAILS); client with access disabled -> 0 (mutation: drop the outer `coalesce` -> FAILS, the
   fail-open); Technician -> only their assigned ids (mutation: drop the scope -> FAILS); no-membership member -> 0;
   agency -> the named account's matches; `service_role` -> the named account's matches.
7. **Equivalence, per role and term.** For every term shape in `F092:141-150` plus `ma`, `ana`, `garcía lópez`,
   `zzqx`, a `_` and a non-Latin name: ids from `public.contacts_matching(...)` with the list's filters equal ids
   from `public.contacts` with `contactSearchFilter`'s arms written in SQL, rows and count, for Owner, Technician and
   agency.
8. **Refusals.** `%` in `p_text`, a token `a;b`, a national `abc` -> `22023` (one per `withRollback`).
9. **Inlining.** `explain` of the GET-shaped statement as an Owner shows no `Function Scan on contacts_matching`.

bis-crm's tests: `contact-search-live.test.ts` (`DB/test/contact-search-live.test.ts:1-40`, real PostgREST, CI)
gains the comparison of the rpc chain with today's `.or(filter)` chain for every term it already reads, rows equal
to count, through `serviceDb()` (which proves the `service_role` branch end to end) and its existing superset oracle
`todayIds`; unit tests pin the `args` builder (null exactly when `contactSearchFilter` is null; no `null` value in
any args object). **ASSUMPTION:** PostgREST sends a GET rpc as `fn("p" := $1, ...)` with plain parameters, which
PostgreSQL can inline. Verified in the live suite by reading the statement PostgREST sent from
`pg_stat_statements` (**ASSUMPTION:** present in the CLI's images; if not, `log_min_duration_statement = 0` on the
local stack) and running `explain` on it as test 9 does.

The 500,000-contact numbers are not a CI test (the seed takes minutes); the replica harness of section 3 is re-run
on each final file before production, and its numbers go into that file's header, as 0108's did.

### 4.7 Security review points for the 38th definer

- The account is admitted by the house predicate, null-safe; the Technician scope is applied inside; the service
  role is recognised by a setting an `authenticated` session cannot forge.
- It returns ids only, and only through an INVOKER entry point that re-applies RLS: a matcher bug can at worst
  return fewer rows, or ids RLS then drops, never another tenant's row. Test 6 exists because that second gate would
  otherwise hide a matcher bug.
- No cross-tenant oracle: a count or a list built on another account's ids is refused at step 1, before any read.
- Dynamic SQL splices no caller text; every value is a `using` parameter; the input rules refuse what the app cannot
  send.
- `search_path = pg_catalog, pg_temp`, every name schema-qualified, no backslash in the file.
- It reads `contacts` as its owner: `contacts` is owned by `postgres` with FORCE ROW LEVEL SECURITY off (read on
  production, 2026-10-31), the same footing `app.my_contact_ids()` has always read it on
  (`MIG/0068_mine_unassigned_technician.sql:83-90`).
- Cost: a 2-character term reads the account's rows once per call (section 3); the term is capped at 80 typed
  characters and 6 words; nothing else is unbounded.

### 4.8 Deploy order, and whether 0109 and 0110 are safe under the old app

Order, for each of 0109 and 0110: bis-ci (`ci-project-setup.yml`), then production (the orchestrator's
`apply_migration`, once), then the parity check. 0109 needs nothing else and can merge on its own PR. 0110 must be
on production before bis-crm's app change merges. The e2e job refuses a branch whose migration bis-ci lacks
(`.github/scripts/ci-migrations-applied.sh`), so the app change cannot reach CI's green before 0110 is on bis-ci.

**Both migrations are safe under today's app.** 0109 changes no outcome (2.4) and only makes today's reads cheaper.
0110's part C adds two functions nothing calls yet; its part B swaps an index today's app never reaches under RLS
(cause 1): only `service_role` reads can use it, and at production's size (53 contacts, the whole index 352 kB) the rebuild is
instant. **The new app under the old schema is NOT safe**: `contacts_matching` would not exist (`PGRST202`) and
every search would fail, so the order above is binding.

**Locks and cost.** `alter policy` takes ACCESS EXCLUSIVE on its table (read on the replica: `AccessExclusiveLock`
on `contacts`), so part A holds that lock on 59 tables until the file commits; at today's size the whole file is
milliseconds. `accounts` is part A's third statement and `app.current_account_id()` reads `accounts`, so from that
lock on every authenticated request waits until the file commits, whatever table it reads: about 0.3 s measured
(0109's header). `lock_timeout` 5 s in a `do` block (0108's form) bounds each wait; a timeout aborts the whole file,
which is then simply re-run. A deadlock between the file and a live transaction that holds one of these tables and
waits on another aborts whichever side waited when PostgreSQL detected it: the file (re-run it), or the live
request, which fails with `40P01`. 0110 takes ACCESS EXCLUSIVE on `contacts` only (the index drop). Rebuilding the
index at 500,000 rows took 16.4 s (117,571,584 bytes, 3.9) on the replica; at production's 53 rows it is nothing. Header in 0108's form (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING /
ROLLBACK), ASCII only. Rollback of 0110: re-create 0108's index, drop the two functions, leave `btree_gin`. Rollback
of 0109: `alter policy` back to the pinned pre-0109 text (the test holds it verbatim).

---

## 5. Owner decisions

Only genuine product or risk choices; each is recommended first, with its reason. All three were ruled on by the
owner on 2026-10-31, each as recommended.

1. **Which policies does 0109 wrap?** **DECIDED 2026-10-31 (owner): (A), all 64 wrappable policies on 59 tables;
   `inbound_never_log_no_technician` stays per-row, because it passes a row column (2.4 item 4).**
   - **(A) Recommended: all 64 wrappable policies, on 59 tables.** Why: the answers are identical (2.4; 81 of 81
     digests across (a) and (b)), and the same per-row cost sits on every large table: counting an account's
     50,000 conversations goes from 516 to 8 ms only when `conversations` is wrapped too (3.5), and every table
     created later copies the wrapped row.
   - (B) `contacts_member_all` only. One policy, and every contacts read is fixed; every other table keeps paying
     per row, and new tables keep copying the bare shape.
   - (C) Contacts plus the tables a contacts screen also reads (`contact_tags`, `tags`, `conversations`,
     `messages`, `calls`): six policies, a middle blast radius.
2. **When someone types only two letters ("ma") on a very large account, may the search compare letters
   byte-wise?** **DECIDED 2026-10-31 (owner): (A), yes, for two-character searches only. It lands in 0110 (PR 2),
   not in 0109.**
   - **(A) Recommended: yes, for two-character searches only.** Why: it brings "ma" at 50,000 contacts from about
     674 to 244 ms, inside the 300 ms line, and it changes nothing for Spanish or English names; the only names it
     stops finding are ones in another alphabet typed in the other case ("ив" for "ИВАНОВ").
   - (B) No: keep exact matching, and accept about 0.6 s for a two-letter search on a 50,000-contact account (it
     scales with the account; at today's sizes it is instant).
   - (C) Search only from three letters in the contact list (two letters show nothing until a third is typed):
     a visible change to how the box behaves.
3. **Does 0109 ship on its own, ahead of the search work?** **DECIDED 2026-10-31 (owner): (A), yes, on its own pull
   request first; 0110 (the account-first trigram index, `app.contact_match_ids`, `public.contacts_matching`) and
   bis-crm's app change follow together in PR 2.**
   - **(A) Recommended: yes, now, on its own pull request.** Why: it changes no answer, it alone takes an
     unsearched contact list plus its count at 50,000 contacts from 1,226 to 60 ms (and the dashboard tile from
     556 to 18 ms), and it is the half the 2,000-contact deadline needs most; 0110 and the app change follow.
   - (B) One pull request for 0109, 0110 and the app change: one review and one apply window, but the safe half
     waits for the half that adds a definer.

---

## 6. Task outline (risk tier per the speed process)

| # | Task | Owner | Tier |
|---|---|---|---|
| T0 | Pre-flight, read-only, on bis-ci and production: `select name from supabase_migrations.schema_migrations where name in ('policy_initplans', 'contact_match')` is empty (by NAME: `version` holds a timestamp here); the policy digest of 2.1 still reads `4f4914fcd094dbb3f13894fa6e19b3f2` (if not, regenerate 0109 from the live rows first); `btree_gin` available; `pg_stat_statements` in the CLI's images (or the fallback of 4.6) | bis-db-schema | low |
| T1 | `0109_policy_initplans.sql` (part A, generated), `policy-initplans-schema.test.ts` (pins, guard) and `policy-initplans-behaviour.test.ts` (behaviour matrix), the two moved pins; on the local replica: red before, green after, and the 500,000-contact unsearched numbers into the header | bis-db-schema | **high** |
| T2 | Apply 0109: bis-ci, production, parity. Post-apply: the guard query of T1 returns exactly `inbound_never_log_no_technician`; the digest of 2.1 reads the same new value on both projects (the replica's after the generated file: `960f704c23380d8d6f9e650de13826ed`, 3.9; **superseded by T1, 2026-10-31: the committed 0109 wraps each call on its own, `COALESCE((select app.is_agency()), false)` rather than the scratch generator's `(select coalesce(app.is_agency(), false))`, and reads `1597df0fa14a63845c61298f53c1413e` on the replica**) | orchestrator | **high** |
| T3 | `0110_contact_match.sql` (parts B and C), `contact-match-schema.test.ts` (shape, direct matcher per role with its mutations, equivalence, refusals, inlining), `EXPECTED_DEFINERS` 37 -> 38, the parity fingerprint gains `btree_gin`; the replica harness of section 3 re-run on the final file, numbers into the header | bis-db-schema | **high** |
| T4 | Security review of 0110 against 4.7, by a reviewer who did not write it, with its own probe of a cross-account and a Technician call | reviewer | **high** |
| T5 | Apply 0110: bis-ci, production, parity. Post-apply: `to_regprocedure('app.contact_match_ids(uuid,text,text[],text[],text)')` and `public.contacts_matching(...)` exist with the pinned `prosecdef`/`proconfig`; `contacts_search_trgm`'s `indexdef` leads with `account_id` | orchestrator | **high** |
| T6 | bis-crm: the `args` builder beside `contactSearchFilter`, the source swap in `listContacts` / `countContacts` / `searchContacts` (4.4), unit tests (null exactly when the filter is null; never a `null` argument), `contact-search-live.test.ts` comparisons and the GET-statement check (CI) | bis-crm | medium |
| T7 | The F-092 e2e (`F092:555`) re-run on the branch; no new spec: nothing on screen changes | bis-e2e-qa | low |

---

## 7. Not in this item

- Calls and conversations search (`DB/voice.ts:1311-1322`, `DB/messaging.ts:967-985`): unchanged; they keep their
  own `ilike` under RLS (without the per-row helper cost if owner question 1 is answered (A)).
- Ranking, typo tolerance, nicknames: F-092 part 2.
- `inbound_never_log_no_technician`'s per-row call (2.4).

---

## 8. Findings outside this item (for the ledger)

1. **Every unsearched read of a large table pays the per-row cost today, not only contacts.** The dashboard's
   contacts tile (`ACCT/dashboard/page.tsx:148`, an unsearched `countContacts`) measured 489.3 / 555.6 ms (p50 /
   p95) at 50,000 contacts; 0109 alone takes it to 16.1 / 18.1 ms. The inbox and the probe in section 3 show the
   same shape on `conversations`.
2. **`inbound_never_log_no_technician` passes a row column to a definer** (2.4). Small table; left as it is.
3. **`.rpc()` is a POST unless told otherwise.** The package's one set-returning RPC chained with filters,
   `list_pending_proposals_for_agency` (`DB/proposals.ts:181-183`), is called without `get: true`; whether PostgREST's
   POST form keeps it from being inlined, and whether that matters at its size, is not measured here.
4. **The agency is not slowed by cause 2**: `is_agency()` is plain SQL and inlines, so the house policy's left
   operand is true at the cost of a claims parse per row; the agency's unsearched list plus count (newest first,
   p95 sum) at 50,000 contacts measured 178 ms today and 57 ms with (b). Its searches are slowed by cause 1 like everyone's.
5. **T12's harness reused**: `scale-spec/` beside it holds the policy dump and classifier, the generated wraps,
   the measured matcher, the query generator and the results (`r-*.json`, `i-*.json`), so T3's re-measurement
   starts from the same files.

---

## 9. Where the brief and the source disagree

1. **"Account from app.current_account_id()".** The agency's token has no client account (`org_id: "org_agency"`,
   `apps/web/src/lib/auth.test.ts:40`), so `current_account_id()` is NULL on every agency read; a matcher keyed on
   it alone would answer the agency nothing. The matcher takes the account the app already passes and admits it by
   the house predicate, which is exactly what RLS admits (4.3 step 1).
2. **"No anon" is not enough for the callers that exist.** `serviceDb()` callers, including the live search suite
   (`DB/test/contact-search-live.test.ts:13-14`), carry neither `app_role` nor `org_id`; the matcher needs an
   explicit `service_role` branch (4.3 step 1).
3. **`COLLATE "C"`.** Production's and bis-ci's databases are ICU `en-US` (`datlocprovider = 'i'`, read
   2026-10-31), the replica's provider, so T12's collation caveat (`F092:363-366`) is settled: the replica's arm
   costs are production's. The one place `COLLATE "C"` helps is inside the matcher, for terms the trigram index
   cannot serve (3.7, 3.8, owner question 2).
4. **The policy count.** The brief says "every account-scoped table"; the inventory is 65 per-row policies on 59
   tables, of which 64 (on the same 59 tables) can be wrapped (2.2).
5. **One migration or two.** The brief names 0109 for any change; the owner's decision says each fix lands as its own
   migration (`F092:387-388`). This design follows the decision: 0109 is the wrap, 0110 the search path.


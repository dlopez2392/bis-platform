# Evidence-grade records, part 1: the `record_changes` change log and trash (S-04 + F-115 part 1) — design

Date: 2026-11-02. Base: `origin/main` ac192df7. Status: **owner rulings taken 2026-11-02 (§9) — ready for the plan.**
Roadmap: S-04 (`docs/crm-features.md:1404`, `:3758`), F-115 part 1 "the history tab on S-04" (`:1440`, `:2219`, `:3657`). S-48 (`:1575`, `:3802`) and F-149 (`:1709`) depend on it; F-022 builds on the schema F-115's first part owns (`:941`).
Dropped, not designed here: the hash chain witnessed in the owner's inbox (`:1783`, `:2260`).

Abbreviations: `MIG/` = `packages/db/supabase/migrations/`, `DB/` = `packages/db/src/`, `WEB/` = `apps/web/src/`.

---

## 1. What records history today (reuse it, don't duplicate it)

| Thing | Where | What it records | Gap for F-115 |
|---|---|---|---|
| `public.events` domain ledger | `MIG/0001_tenancy.sql:58-68`; client appends only via `record_event` (`MIG/0053_server_only_writes.sql:64-97`); `DB/events.ts:15-40` | type, actor (`user`/`system`/`ai`), actor id, payload. Field edits hold field **names** only: `contact.updated {contactId, fields}` (`DB/contacts.ts:593`, `:720`, `:766`); `opportunity.updated` (`DB/opportunities.ts:101-102`); `client_group.renamed` (`DB/client-groups.ts:444`) | No before/after values. Three actor types, not the five author kinds (`system` can't tell customer from automation). Technicians read none (`MIG/0068:144-145`). Roadmap already says "Partial (event-level only; no before-and-after values)" (`docs/crm-features.md:727`) |
| Author marks on timeline rows | `MIG/0073_record_provenance.sql:52-69` (`author_kind` CHECK, five kinds), triggers `:100-135`; `DB/provenance.ts:7`, `:19-49`; `WEB/lib/record/author-mark.ts:13-17`; contacts gained `author_kind`/`author_id` in 0091 (`DB/contacts.ts:85`) | Who **created** a message, booking, form, task, deal, note, contact | Creation only, never later field changes |
| Sofía's live acts | `MIG/0091_ai_acts.sql:58-86` (`before`/`after`, `undone_at`/`undone_by`); undo by compare-and-swap (`DB/contacts.ts:745-768`) | Before/after of AI writes only | A person's edits leave no values |
| Accepted suggestions | `MIG/0088_proposals.sql`; timeline source `suggestions` (`DB/record.ts:604-609`) | The proposal and what was applied | Proposals only |
| Contact archive log | `MIG/0103_contact_archive.sql:140-160`, `:164-196`, `:204-219` (definer log trigger, role test in `WHEN`) | Archive/restore with author `person`/`customer` | Archive state only; cascades away with a permanent delete (`:150-151`) |
| Merge log | `MIG/0106_contact_merge.sql:294`, `:307` (30-day `undo_until`); dedupe spec §4.2 | Every overwritten contact column, moved rows, Undo | Merges only. Ruling D10: once S-04 lands, a merge also writes one change row per field (`docs/crm-features.md:1404`; dedupe spec §8) |
| Access log (F-118) | `MIG/0105_access_log.sql:1-40` | Agency **views**; append-only by grants; no FK ("the log outlives the record") | Views, not writes — its conventions are reused here |
| Document trash | `MIG/0077_document_vault.sql:72-75`; `DB/documents.ts:229`, `:249`, `:365`; `DB/document-rules.ts:35` (`DOCUMENT_TRASH_DAYS = 30`); `WEB/lib/automations/passes/documents-sweep.ts:30` | Trash with Undo, purge after 30 days, typed-name purge (DESIGN.md:323-325) | Documents only |
| Toast-only Undo snapshots | `DB/places.ts:302-309`, `:444` (`removeEquipment`), `:460` (`restoreEquipment`); `DB/activities.ts:52`; `DB/client-groups.ts:405` (`restoreMembership`) | Nothing durable; snapshot lives in the toast | After the toast closes, a removed unit/member/tag/relationship is gone without trace |
| Contact permanent delete | `MIG/0103:297-348` (`delete_internal_contacts`, Owner-only, internal-only); `WEB/.../contacts/bulk-action-bar.tsx:276-283` | Deletes + an events row | Cascades away the archive log |
| Notes | client IUD grant (`DB/test/schema-grants-guard.test.ts:98`) | — | No update/delete writer exists; nothing to record yet |

Does the timeline show who changed a field? **No** — no timeline source for field edits (`DB/record.ts:278-282`); `lastFieldEditor` (`DB/contacts.ts:778-798`) only names the last editor for the AI-act display. Field edits are recorded by name/actor/time; by value only for Sofía (`ai_acts`) and merges (`contact_merges`).

---

## 2. Scope of part 1

### 2.1 Decisions (with reasons)

1. **Capture in the database with triggers.** ~690 `serviceDb()` call sites in 225 files (`DB/service.ts:4-9`) and SQL definers (0069, 0076, 0091, 0103, 0106) bypass TypeScript; an app-layer log repeats the drift `events.ts:8-13` records. A trigger sees every write inside the write's transaction: no change row can be lost after commit, no write can commit without its row.
2. **Who made a write is decided in the database from the strongest evidence**: token for signed-in writes → transaction-local setting for SQL definers → request header for server code (§2.3). Follows 0073's split.
3. **One row per changed field**, grouped per write by transaction id (S-04's own wording, `docs/crm-features.md:1404`). "Every value this phone has had" is one index read.
4. **Explicit audited-column list, pinned by a test.** Every column of an audited table is AUDITED or EXCLUDED with a reason; a new column fails until decided (same mechanism as `EXPECTED_WRITES`, `DB/test/schema-grants-guard.test.ts:65-111`).
   - Contacts EXCLUDED: `archived_at`/`archived_by` (0103's log); `merged_into`/`merged_at` (0106's log); `company_name` (derived, 0072); `sort_name`, `email_key`, `phone_key`, `phone_country_unconfirmed` (derived); `updated_at`; `author_*` (creation provenance); `holds_shared_number` (structural); `last_language_signal*`, `language_hint_kept_at`, `language_set_at` (telemetry); `attribution` (machine UTM blob, `WEB/lib/forms/enrich.ts:416`).
   - Contacts AUDITED: `first_name`, `last_name`, `email`, `phone`, `assigned_to`, `dnd`, `source`, `marketing_email_opted_out_at`, `language`, and `custom` diffed per key (`field = 'custom.<key>'`).
5. **Append-only by grants** (0054/0105 shape): no API role holds UPDATE/DELETE/TRUNCATE; time is `now()`; author from the token, never a client value. This is "evidence-grade" with the hash chain dropped; the table owner is not bound by grants and the trust pack already says so (`MIG/0105:14-15`).
6. **Customers' own values are included** (booking-page / form blank-fills, customer mark). Staff see them; no customer-facing history surface (module contract, DESIGN.md:266-272).
7. **No duplication — link instead.** A `via` column names the causing act (`merge:<id>`, `ai_act:<uuid>`, `proposal:<uuid>`, `restore:<change id>`); the timeline folds those change rows into the existing merge / AI-act / suggestion row (§3).
8. **Restore window for removed rows: 30 days**, matching `DOCUMENT_TRASH_DAYS` and the merge Undo. After that the history row stays, Restore is no longer offered.

### 2.2 Data — migration 0111 (HIGH)

To the 0103/0106 conventions: WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS / ROLLBACK header, ASCII only, `lock_timeout` 5s, `set search_path = pg_catalog, pg_temp` on every definer (0096 rule).

```sql
create table public.record_changes (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  record_type text not null,            -- CHECK: the audited set (§9 Q1)
  record_id uuid not null,              -- NO FK: the log outlives a removed row (0105's reason)
  contact_id uuid,                      -- whose timeline shows it
  client_group_id uuid,                 -- a household/business's own rows
  op text not null check (op in ('insert', 'update', 'delete')),
  field text,                           -- null for insert/delete
  before jsonb, after jsonb,            -- insert: after = audited snapshot; delete: before = snapshot
  xact bigint not null default pg_catalog.txid_current(),
  author_kind text check (author_kind in ('person','ai','automation','customer','import')),
  author_id text,                       -- Clerk sub; only with person or import
  via text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint record_changes_field_shape check ((op = 'update') = (field is not null)),
  constraint record_changes_author_id check (author_id is null or author_kind in ('person', 'import'))
);
-- indexes: (account_id, contact_id, created_at desc, id desc);
--          (account_id, client_group_id, created_at desc, id desc) where client_group_id is not null;
--          (account_id, record_type, record_id, created_at desc)
```

- `author_kind` is NULLABLE only during observe mode; 0113 sets NOT NULL (0073 → 0074's two-step, `MIG/0073:12-13`).
- **Capture:** one definer `app.record_changes_capture()`, column list in `app.record_change_fields(record_type)`. Each audited table gets two AFTER ROW triggers: `WHEN (current_user = 'authenticated')` → `TG_ARGV[0] = 'client'`; `WHEN (current_user <> 'authenticated')` → `'server'` (the role test must sit in `WHEN`, as 0103 learned, `MIG/0103:200-219`). UPDATE writes one row per audited column that `IS DISTINCT FROM`; nothing for a no-op.
- **Contact permanent delete:** the trigger deletes that contact's value-bearing rows and writes one values-free `delete` row (who/when). Old values don't outlive a deletion the Owner asked for; the fact does.
- **RLS and grants (§9 Q2 = Owners, Staff, BIS; Technicians none):** `revoke all from anon, authenticated`; `grant select` to `authenticated` via one policy: `(select app.sees_all_customers(app.current_account_id()))` and the row's contact readable (`events_technician_none` shape, `MIG/0068:144-145`), every call in an InitPlan (0109). `service_role`: `select, insert` only. Not on `ACCOUNT_OWNED_TABLES` (`DB/account-teardown.ts:20`) — leaves with its account by cascade (0105).
- **Pins:** definer joins `EXPECTED_DEFINERS` (`DB/test/definer-search-path.test.ts:31`, 38 today); table added to the grants guard; `EXPECTED_WRITES` unchanged.
- **0111 tables:** `contacts` only. 0112 adds the rest of §9 Q1's set and the definer changes.

### 2.3 Who made the write — every path

Precedence in `app.record_changes_capture()`:

| # | Condition | Mark |
|---|---|---|
| 1 | `'client'` (signed-in PostgREST write) | `person`, `author_id` = `app.jwt()->>'sub'`. Exception: header `x-bis-author: import` → `import` with the sub kept (CSV import, `DB/contact-import.ts:178`, `:191`). A person can only relabel their own write as an import |
| 2 | `'server'` and `current_setting('bis.author', true)` set | That kind/id. Set with `set_config(…, true)` by definers that know who acted: `restore_contact_on_sign` → `customer`; the 0091 undo → `person`; cron SQL → `automation`. `bis.via` likewise (`merge_contacts` → `merge:<id>`) |
| 3 | `'server'`, JWT role `authenticated` (a definer a person called: `merge_contacts`, `undo_contact_merge`, `delete_internal_contacts`) | `person` = sub; any header ignored (a person can't claim Sofía) |
| 4 | `'server'`, service-role request, header `x-bis-author: {"kind","id","via"}` from `current_setting('request.headers', true)` | That kind, validated against the closed set; `person` requires an id. Only BIS server code holds the service key |
| 5 | none of the above | Observe mode: `author_kind` NULL (counted unattributed). Enforce mode: `raise 42501 'record_changes: a server write must say who made it'` |

**TypeScript (T2):** `withAuthor(builder, author: RowAuthor, via?)` attaches the header per query. Writers of audited tables (`updateContact`, `fillContactBlanks*`, language setters, `assignment.ts:339`, `forms/enrich.ts:416`, `updateOpportunity`, client-group/place/equipment writers) take a **required** `author: RowAuthor` with a service client (`isUserClient`, `DB/user-client.ts:30`, as in `emit`). This deliberately replaces `ActorType` for these writers (`system` is ambiguous: customer in `contactAuthor` `DB/provenance.ts:44-49`, automation in `messageAuthor` `:19-24`). Voice/web-chat: the `ai_acts` id is generated before the write, sent as `via: ai_act:<uuid>`, then used as the act's id.

**Observe, then enforce:** 0111 adds a one-row `app.record_changes_settings (enforce boolean not null default false)`. CI's local stacks turn enforce ON after migrating (`.github/scripts/ci-local-supabase.sh`), so every db/integration/e2e test fails on an unattributed path it covers. Production stays observe so a missed path never breaks a live call; a cron pass reports the unattributed count daily via the ops heartbeat. After 7 consecutive zero days, 0113 backfills NULL rows from the matching `events` row (same account, `payload.contactId`, field, within 2 s; actor mapped via `DB/provenance.ts`; 0074's method), names the leftover count, sets NOT NULL and enforce ON. The history UI (T5) merges only after 0113.

### 2.4 Trash across record types (§9 Q4 = on each record)

| Record type | Today | Part 1 |
|---|---|---|
| Contact | Archive = reversible trash (0103); permanent delete Owner-only, typed count | **Unchanged.** Archive stays out of `record_changes` (0103's log holds it) |
| Document | Trash 30 days + sweep; typed-name purge | **Unchanged**; document metadata history is later |
| Place | Deleted when empty (toast Undo) else archived (`DB/places.ts:302-309`) | Delete row's `before` snapshot → **Restore for 30 days** from the record timeline |
| Equipment, group member, tag, relationship | Hard delete, toast-only Undo | **Restore for 30 days** from the delete row, reusing `restoreEquipment` (`DB/places.ts:460`) / `restoreMembership` (`DB/client-groups.ts:405`) with the logged snapshot (same id). Parent gone or id taken → a worded "can't be restored" |

**Restore semantics:** "Put back" on a field change is compare-and-swap — lands only while the current value still equals that row's `after` (`restoreContactFieldIf`'s rule, `DB/contacts.ts:745-768`, widened to every audited column). A put-back is a new write: person mark, `via restore:<id>`; history is never rewritten. Who: Owners, Staff, agency (archive rule, 0103 Q3); not Technicians.

### 2.5 Performance, storage, retention, export

- **Cost:** one `to_jsonb(old/new)` diff per row per write. Bulk paths are capped at 500 ids (`capBatch`, `DB/contacts.ts:1423+`). Measure a 500-contact bulk assign and a 10,000-message merge on the PG18 replica before/after; state both in 0111's LOCKS AND COST; target < +20% wall time.
- **Storage:** ~200–300 bytes/row; ~3 MB/year at 1,000 field edits/month/account (estimate, to be measured).
- **Retention (§9 Q3 = as long as the record exists):** rows go with the account (cascade) and a contact purge takes that contact's values (§2.2). No sweep. F-123 later owns legal hold and limits. Legal record-keeping periods: an assumption for counsel to confirm.
- **Export (§9 Q5 = yes, per record, Owners):** a "Download history" link per record (CSV, English and Spanish headers), Owners only, using the contacts export route's pattern (`WEB/.../contacts/export/route.ts`); agency downloads write an F-118 access-log note (`DB/access-log.ts`).
- **Field restriction (F-004, not built):** when it lands, the reader must hide restricted fields' rows (each row carries `field`). Dependency noted, not built.

---

## 3. UI under the module contract

- **No new surface.** History is a timeline source on the existing record page (DESIGN.md:266-272; record page :299-311). The roadmap's "history tab" (`docs/crm-features.md:1440`) is read as this.
- **Source `changes`, opt-in**, like `suggestions`/`ai_acts` (`DB/record.ts:537`, `:604-615`): the record page and group page ask for it (`WEB/lib/record/loaders.ts:100-104`; `group-loaders.ts:142`); the drawer does not (`loaders.ts:210-213`; `recent-rows.ts:55-66` gains an exhaustive `null` case). Reads `record_changes` by contact-id set (tombstones via `mergedIdsOf`), paged on `(created_at, id)`, grouped by `xact`, dropping groups whose `via` names a merge/act/suggestion row on the same page (fold only when that row is on the page).
- **Row grammar:** one row per write with the author mark and a verb — EN "changed phone and email" / ES "cambió el teléfono y el correo". Consecutive groups by the same author on the same record within 10 minutes collapse into one row; expanding shows every step. Detail lists `Field: was → now`, values formatted (phones via the formatter; `assigned_to` named via `listPeopleNames` `DB/record.ts:635-653`, else "Someone on the team"; custom keys via their label; blank "(blank)"/"(vacío)"; booleans "Yes/No"/"Sí/No"). Status words, never colour alone (rule 3). "Put back" ghost button per field while possible. Removal row: "removed the unit Carrier AC" / "quitó el equipo Carrier AC" with "Restore"/"Restaurar" for 30 days. Owners see "Download history"/"Descargar historial".
- **States:** loaded as above; empty = the timeline's own empty state; error = a failed `changes` read joins the timeline's partial-failure line via a new `SOURCE_KEY` "changes"/"cambios" (`WEB/lib/record/timeline-rows.ts:57-62`, `:283`); loading = timeline skeleton (rule 7). Put back / Restore run at once with an Undo toast (rule 6); stale value → "It changed since, so it wasn't put back" / "Cambió desde entonces; no se restauró".
- **Phone:** one column (DESIGN.md:306-308); was/now stack on two lines with word labels; 44 px targets.
- **Bilingual:** every string through `t()` with an `.es` twin, usted; passes the +35% pseudo-locale; server actions take locale right after accountId and are `.bind()`-ed (gate 3).
- **Styleguide:** reuses `timeline-item` (`WEB/components/record/timeline-item.tsx`); if the disclosure isn't in the kit, add it to `/styleguide`.

---

## 4. Risks

1. **Unconverted server path writes unattributed rows** — data wrong, not broken. Mitigated by CI enforce mode, the daily count, the 7-day zero gate, the 0113 backfill.
2. **External-system ASSUMPTIONS to verify in T1/T2 before building on them:** (a) Supabase PostgREST exposes request headers to SQL as `current_setting('request.headers', true)`; (b) supabase-js `^2.110.8` (`packages/db/package.json:45`) has a per-query `setHeader()` on the PostgREST builder (unused in the repo today). If (b) fails: a short-lived `createClient(..., { global: { headers } })` per author (same cost as today's per-call `serviceDb()`). If (a) fails: writers call a `public.write_as(author, …)` definer RPC (~+0.5 ew).
3. A person marks their own edit as an import — their id is still recorded and shown ("Import · María"). Accepted.
4. Write amplification on bulk paths and merges — measured in T1.
5. PII in history — covered by the Q2 fence, the contact-purge rule, Q3.
6. `via` folding hides a change row whose act/merge/suggestion row the reader can't see — fold only when that row is on the same page.
7. Changing 0106/0091/0103 definers (T3) touches HIGH code — each only gains a `set_config` line; their tests re-run.

## 5. Test plan (each names the mutation that must turn it red)

| # | Test | Mutation |
|---|---|---|
| 1 | Schema: columns, CHECKs, indexes, `field_shape`, `author_id` | Drop a CHECK so a person id on an `ai` row passes |
| 2 | Grants: anon nothing; authenticated SELECT only; service_role SELECT+INSERT only; no UPDATE/DELETE/TRUNCATE anywhere | Grant `update` to service_role |
| 3 | RLS: other account 0 rows; Technician 0; Staff read; agency reads | Remove the restrictive policy |
| 4 | Column pin: every column of every audited table AUDITED or EXCLUDED | Add a contacts column without listing it |
| 5 | Signed-in edit → one row per changed field, `person` + sub; no-op → 0 rows | Drop `IS DISTINCT FROM` |
| 6 | Precedence: GUC beats header; person-called definer → person even with an `ai` header; `import` header from a person → `import` + sub | Swap steps 3 and 4 |
| 7 | Enforce on: service write with no author → 42501, contact update rolled back | Step 5 returns NULL in enforce mode |
| 8 | Client can't write: authenticated INSERT → 42501; client can't set `bis.author` to claim `ai` | Read the GUC in the client branch |
| 9 | Contact purge: value rows gone, one values-free delete row left | Keep value rows |
| 10 | Merge: one row per overwritten field with `via merge:<id>`; Undo writes reverse rows | Remove `set_config` from `merge_contacts` |
| 11 | New definer in `EXPECTED_DEFINERS` with `pg_catalog, pg_temp` | Omit `search_path` |
| 12 | TS: each audited writer refuses a service client with no author (runtime) and doesn't compile without one | Make `author` optional |
| 13 | Reader: `xact` grouping, 10-minute collapse, `via` folding, paging cursor, failed read named in `failed` | Group by `created_at` |
| 14 | Put back: CAS refuses a stale value; writes `via restore:`; Technician refused | Drop the `eq(column, after)` |
| 15 | Restore removed unit within 30 days: same id; after 30 days not offered; parent gone → worded refusal | Compare against 31 days |
| 16 | UI: EN/ES strings, author mark on every change row, phone stacking, Undo toast | Render a row with no mark |
| 17 | Download: Owner gets CSV (both header languages); Staff/Technician refused; agency download writes an access-log note | Allow Staff |
| 18 | e2e: edit a phone → row with "was → now" → Put back → Undo (per-run fixture account) | — |
| 19 | Cost: replica timings recorded in 0111's header | — |

## 6. Tasks (PR-sized)

| # | Tier | What | Depends on |
|---|---|---|---|
| T1 | HIGH | 0111: table, capture definer, contacts triggers, observe mode + settings row, grants & RLS (Owners/Staff/BIS), pins; tests 1–9, 11; replica timings; CI stacks turn enforce on | — |
| T2 | HIGH | `withAuthor`, required `RowAuthor` on audited writers, every contacts write path converted (voice, web chat with act id as `via`, forms enrich, booking page, assignment, language, import header), cron unattributed-count pass; test 12 | T1 |
| T3 | HIGH | 0112: households/businesses + members, places, equipment, deals, relationships, tags (§9 Q1); `set_config` in `merge_contacts`, `undo_contact_merge`, `restore_contact_on_sign`, the 0091 undo, `delete_internal_contacts`; their TS writers converted; test 10 | T2 |
| T4 | MEDIUM | Reader: `changes` source in `DB/record.ts`, record + group loaders opt in, drawer `null` case; test 13 | T1 |
| T5 | MEDIUM | Timeline rows, disclosure, value formatting, EN/ES copy, phone layout, failure-line key; test 16. Merges only after T7 | T4 |
| T6 | HIGH | Put back and Restore server actions; tests 14–15 | T3, T4 |
| T7 | HIGH | 0113 (after 7 zero days in production): backfill from `events`, NOT NULL, enforce on | T2, T3 in production 7 days |
| T8 | MEDIUM | Download history (Owners, CSV EN/ES headers, access-log note for agency); test 17 | T4 |
| T9 | MEDIUM | e2e (test 18) on the per-run fixture account | T5, T6 |
| T10 | LOW | `docs/crm-features.md` status rows (`:727`, `:1404`, `:1440`); tracker F-115/S-04 | T9 |

Apply order per migration: bis-ci (`ci-project-setup.yml`) → production → parity check → merge (CLAUDE.md). 0111/0112 are additive and safe to apply before their deploy. Effort ≈ S-04 2–3 + F-115 1–2 ew + download 0.25–0.5.

## 7. Rollback

Revert the app first. Then: (1) drop triggers, capture function, settings row; (2) drop `record_changes` — **destroys history**, owner decision only, after an export; (3) restore the 0106/0103/0091 definer bodies (T3).

## 8. Explicitly later

Document metadata history; notes (no editor exists); field-restriction filtering (F-004); customer-visible history; retention engine and legal hold (F-123); whole-business export (F-121); API/webhooks reading the log (F-149); To-dos and bookings history.

## 9. Owner rulings (2026-11-02, all as recommended)

- **Q1 What gets history:** the customer's own facts — contacts (with tags and custom fields), households/businesses and their members, places, equipment, deals, relationships. (Not To-dos or bookings in part 1.)
- **Q2 Who sees it:** Owners, Staff and BIS (agency). Technicians see none.
- **Q3 Retention:** as long as the record exists; gone with the account or a contact's permanent delete. F-123 later adds legal hold/limits.
- **Q4 Trash:** on each record — removal rows carry Restore for 30 days; contacts keep Archived, files keep the Documents trash. No new top-level surface.
- **Q5 Download:** yes — per record, Owners only, CSV with English and Spanish headers; agency downloads noted in the BIS access log.

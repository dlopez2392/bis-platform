# Duplicates found the Valley way, and a reversible merge (F-006 part 1, with S-12): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff see the customers who are probably one person (same phone in any +1/+52 form, same email, or same name with accents and two surnames folded), merge a pair in one screen with Undo for 30 days, and every call, text and email from a number or address the merge did not keep still reaches the kept customer.

**Architecture:** Migration 0106 adds two stored comparison keys on `contacts` (`phone_national`, `name_key`, each with a TypeScript twin), a database trigger that files every pair into the existing `contact_duplicate_flags` queue, and a reversible merge: the merged-away record stays as a hidden pointer (`merged_into`), every row it owned moves to the kept record and is logged in `contact_merges`, and `undo_contact_merge` puts it all back. Every lookup by phone, email or contact id follows the pointer one hop. The UI adds a "Possible duplicates" view of the contact list, one line under the record header, a To do count row, a compare screen at `contacts/merge`, and merge rows on the record timeline.

**Tech Stack:** Postgres 17 (Supabase) plpgsql migrations, supabase-js/PostgREST RPC, Next.js App Router server components and server actions, React, vitest, Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-10-29-dedupe-merge-design.md` (owner rulings 2026-10-29 in its §13, planning corrections in its §14). Every count and line below was read off the files at `8f191334` on 2026-10-29.

## Global Constraints

- Migration number **0106**. 0105 belongs to F-118 (`feat/access-log`) and is not written yet; 0106 must not create or name `agency_visits`, `agency_visit_items`, `app.agency_visit_window`, `public.agency_visit_live`, `public.start_agency_visit`, `public.note_agency_open` or `public.access_log_page`. 0106 reaches bis-ci only AFTER 0105 is there (orchestrator checklist).
- **No agent applies 0106 to any Supabase project.** It is proven only on a local replica. Use the real **PostgreSQL 17.6** binaries at `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin\` (`postgres.exe --version` → `postgres (PostgreSQL) 17.6`, checked 2026-10-29). PG18 hides PG17 plans (memory `bis-local-db-replica`).
- **No `@bis/db` vitest runs locally against bis-ci, ever, in this lane.** This worktree has no `packages/db/.env` and no `apps/web/.env.local` (checked 2026-10-29): never create one, never export a Supabase variable in a shell. Local db runs are exactly two kinds: `withRollback` files against the replica (`SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/<db>`), or pure fake-client files. Files built on `withTestAccount` (named `*-live.test.ts` here, plus the existing live files this plan edits) are proven by CI `verify`, which builds its own stack from the branch's migrations.
- The worktree has no `node_modules`. Each implementer runs `pnpm install` once from `C:\Users\danlo\bis-platform\.claude\worktrees\dedupe` before its first test run (memory `bis-lane-pipeline`).
- Judge a db run by vitest's own summary block, never the exit code (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` follows the real results). Capture an exit code to a file with nothing after the command when it matters.
- Owner rulings (spec §13, 2026-10-29): **D2** same-name pairs ship in part 1, labelled "Same name", listed after phone and email pairs, dismissable for good. **D4** the older record is kept by default, with "Keep this one instead". **D7** Undo lasts 30 days (toast, then the merge row on the timeline). **D8** a phone or email the merge did not keep still routes calls, texts and mail to the kept customer. **D9** Owners, Staff and the agency may merge, dismiss and undo; Technicians may not. **D10** merge ships BEFORE S-04 (`record_changes`); the roadmap order changes (checklist step 12).
- Production facts (read 2026-10-29): 53 contacts, 0 `contact_duplicate_flags` rows. 0106's generated columns rewrite a tiny table: keep `lock_timeout` 5s, no batching, no off-peak rule.
- Migration text: ASCII only, no backslash anywhere, every dollar sign part of a `$$` pair (the 0098 rule, `0098_shared_number_holding.sql:57`). Every new function in `public` or `app` says `set search_path = pg_catalog, pg_temp` (the 0096 rule), and every SECURITY DEFINER is added to `EXPECTED_DEFINERS`.
- Copy follows DESIGN.md's 7 AM rule in English and usted Spanish; every English key has its `.es` twin on the very next line; no milestone codes, no `{{template}}`, no arrows. The kept record is never "survivor" and the other never "loser" on screen. `messages.ts` has exactly ONE writer in this plan (T2).
- DESIGN.md rules 4 (whole row is the target; no checkboxes without a bulk bar), 5 (loaded, empty, error), 6 (Undo toast), 7 (skeletons), 8 (one primary per view; the record header's one primary stays Call), 11 (no hero) and the Paged-lists amendment of 2026-10-17 (a list not sorted by recency names its pager "Next" / "Back to the start") bind every UI task.
- e2e runs only on the per-run fixture account, never `Test Client One`. Only bis-e2e-qa writes Playwright; only the orchestrator runs it.
- Commits: `git add <explicit paths>` then `git commit -m "<type(scope): what and why>" -- <paths>`. Never `-A`, `.`, stash, checkout, amend, rebase or push. If `.git/index.lock` exists, wait and retry.
- Gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) are the orchestrator's.

---

## Corrections to the spec made while planning (the source wins)

Each is also recorded in the spec's §14, same commit.

1. **`contact_duplicate_flags_pair` leads on `account_id`, not `contact_a`** (`0033_contact_dedupe_keys.sql:65-66`). 0106 indexes `contact_a` AND `contact_b`, and `tasks(contact_id)`; `contact-archive-schema.test.ts:643`'s list of unindexed single-column foreign keys becomes `[]`.
2. **The client keeps INSERT on the flag table, on four columns.** Spec 4.3 narrowed it to select-only, but `createContact` (`contacts.ts:476-481`), `flagMatchesOf` (`:543-555`), `updateContact`'s and `setContactPhoneCountry`'s `flagDuplicatePair` (`:375-388`) insert on the request client, and the first two THROW on a non-23505 error. So: `grant insert (account_id, contact_a, contact_b, reason)`; UPDATE and DELETE go; dismissal and `merge_id` are written only by definers. The client-write digest moves `52 → 49`.
3. **A stored generated column runs its function as the WRITING role.** Proven on a scratch PG18 cluster 2026-10-29: with EXECUTE revoked from the writer, `insert` fails `permission denied for function k`; a service-only helper called inside it fails `permission denied for function ws`. So the key functions keep EXECUTE for `authenticated` and `service_role` (never 0069's service-only loop), and never call `app.group_ws()`.
4. **No `lower()` and no `.toLowerCase()` in the name key.** One `translate()` maps A to Z and the 48 accented letters; everything outside `[a-z0-9 ]` is then dropped. The answer cannot depend on the database's ctype or on JavaScript's Unicode tables. `search_path` is `pg_catalog, pg_temp` (0096), not `''`.
5. **Status names collided.** `merge_contacts` answered `merged` both for success and for "already a tombstone"; `undo_contact_merge` answered `undone` both ways. The refusals are `already_merged` and `already_undone`.
6. **The trigger writes first, so pinned reasons move.** The pairs the TypeScript writers also find now carry the trigger's reason (`same_phone`, `same_digits`, `same_email`). About fifteen live assertions in four files change with T4 (listed there). The TypeScript writers stay: their `flagged` answers feed the import summary (`import/actions.ts:25`) and the suggestion Undo (`lib/proposals/decide.ts:194,287`), and `email_phone_conflict` exists only in a submission, never in stored keys.
7. **Email replies reach a thread only by its `reply_token`** (`0082_inbound_email.sql:51-56`, `findReplyThread`, `inbound-email.ts:118-127`). Deleting the other thread would orphan every reply to an email sent before the merge, against D8. `contact_merges.other_reply_token` records it, and `findReplyThread` falls back to it (T7).
8. **Threads always combine into a kept thread.** When the kept record has none, the merge creates one and moves the rows, instead of re-pointing the other thread; an Undo then never carries post-merge texts back with a re-pointed thread.
9. **`contact_merges`' two contact keys are ON DELETE CASCADE**, like `contact_archive_log`: a contact deleted for good takes its (undone) merge log with it. A live merge blocks delete through the new `merges` blocker. `contact_duplicate_flags.merge_id` is ON DELETE SET NULL, so teardown (`contact_merges` before `contacts` on `ACCOUNT_OWNED_TABLES`) works while the flag table stays off the list.
10. **`ai_contact_held_by`'s new reason is the table name `contact_merges`**, the house shape (`ai-acts-schema.test.ts:683-694` maps blocker names to FK tables). `FK_TABLES` gains `contacts` (the pointer; exempt, because a pointer is always written with a merge row) and `contact_merges`.
11. **Consent is not a timeline source** (`record.ts:281`). Through the id set the kept timeline shows the tombstone's Sofía acts, accepted suggestions, archive history and the merge rows; nothing of `consent_events`.
12. **`follow_merge` also skips `contact_duplicate_flags`, `contact_archive_log` and `record_summaries`**, and it is two static trigger functions (`contact_id`, `related_contact_id`), not one with `TG_ARGV` and `jsonb_populate_record` (no precedent in the repo).
13. **The compare screen's counts come from one invoker SQL function** (`contact_merge_preview`) sharing the merge's table list, not TypeScript head counts (which would add a `.from("messages")` reader to `lib/messages-readers.test.ts`).
14. **The duplicates list, its total and the record's line read through invoker SQL functions.** PostgREST cannot express the household and relationship `not exists` filters; rows and total share `app.open_duplicate_pairs`.
15. **`contact_merges.moved_counts`** holds the small per-table counts the timeline row reads; `moved` keeps the ids for Undo and is never read by a page.
16. **Copy.** "Compare" and "Undo" are controls, not words inside a sentence (the toast's action is `common.undo`, `messages.ts:302`). Keys are added for counts, failures, field nouns and the hidden-record fallback (T2's table).
17. **Assumptions verified.** A file's storage path is `account/document/version` (`0077_document_vault.sql:102`), so documents move by row alone. No job handler carries a contact (`lib/automations/jobs/registry.ts:8-10`: only `platform-ping`). `contacts.dnd` is dead (`automations.ts:1402`); its rule is "the kept record's unless empty".
18. **Reactivation's held release** (`getDueReactivationById`, `automations.ts:1736-1745`) would send to the merged-away address; T8 filters `merged_into`. The reactivation walk itself never finds a tombstone (it starts from conversations, and a tombstone has none).
19. **`stale` compares a fingerprint of the merge's fields, not `updated_at`.** Several writers never stamp `contacts.updated_at` (`assignment.ts:339`, `contacts.ts:1295,1313,1540`, `automations.ts:1855`, `MIG/0076:107`), so the spec's check missed their writes (plan review m3). `app.merge_fields_of(contacts)` is the merge's one field list; `contact_merge_preview` answers both rows' `fields` and `seen` (`md5` of each), the screen shows those fields and sends `seen` back as `p_seen`, so what is shown and what is checked are one snapshot.
20. **Who checks live in one function, `app.may_merge(account)`,** with 0103's two coalesces; five definers call it.
21. **`EXPECTED_DEFINERS` goes 29 → 36** (T1 +3, T3 +4; 0104 and 0105 add none).
22. **No 100,000-row timing or off-peak rule** (production facts above). T1 times one 10,000-contact apply for the header.
23. **One import-free twin module, `packages/db/src/dedupe-keys.ts`** (`nameFold`, `nameKey`, `phoneNational`, `phoneFamily`, the reason strengths), exported as `@bis/db/dedupe-keys`, instead of `phoneNational` in `contacts.ts` and a separate `name-key.ts`.

### Plan review fixes (2026-10-29; the reviewer ran the SQL on a PG17 replica: merge then Undo restored all 30 fixture rows exactly once)

- **I1, a dismissed pair resurfaced and a phantom survived Undo.** The field update filled K's blank email from O, the flag trigger filed K–X fresh (undismissed), and the later O–X re-file then conflicted and did nothing, unrecorded. Now the re-file runs BEFORE the field update, and every flag the trigger files for K during the field update (flag ids naming K, compared before and after) is recorded in `contact_duplicate_flags_added`, so Undo removes it. T3's Flags case seeds exactly that shape.
- **I2, an in-flight write landed on the hidden record.** `follow_merge` read `merged_into` without a lock, so a write that began before the merge committed read the old pointer. Both pointer reads are now `for share` (still SECURITY DEFINER): the write waits on the merge's row lock and reads the committed pointer. T3 adds a two-connection test outside `withRollback`. Spec §7.2-7.3 corrected: "the insert waits" was true only for messages.
- **m3:** `stale` by fingerprint (correction 19).
- **m4:** T1's probe (c) needed its own case: an Owner of A whose token names org B.
- **m5:** `app.open_duplicate_pairs` cannot inline (it sets `search_path`), so the contact filter, the cursor and the limit are its own parameters; T1 measures it at 20,000 contacts.
- **m6:** T3 guards that every foreign-key table into contacts is in `merge_contacts`' `c_moves` or a named special, stays or self list.
- **m7:** the SMS route bumps unread on the conversation its message now sits on (T7), so a merge between the insert and the bump cannot make the bump a silent no-op.
- **m8:** (a) the merge never touches `messages.updated_at` (an Undo could not restore it); (b) a redirected late insert that collides with a row K already has (a skip, a membership) answers 23505 and the caller reports its usual failure, while a tag upsert is a no-op (ON CONFLICT sees the redirected row): documented and tested in T3; (c) `authenticated` reads only ten columns of `contact_merges` (never `removed`, `moved`, `keep_before`, `keep_after`, `choices` or `other_reply_token`); (d) T1's placeholder and no-last-name seeds use two different phones, so a phone pair cannot satisfy them.

---

## Shared facts every task relies on

`ACCT/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `MIG/` = `packages/db/supabase/migrations/`.

### SQL interfaces (T1 = 0106 part A, T3 = 0106 part B)

```text
contacts.merged_into uuid null, contacts.merged_at timestamptz null   -- both null, or both set; no client grant
contacts.phone_national text (generated: app.phone_national(phone))
contacts.name_key text (generated: app.contact_name_key(first_name, last_name))
app.phone_national(text) / app.contact_name_fold(text) / app.contact_name_key(text, text)   immutable; EXECUTE authenticated, service_role
app.phone_family(text) -> 'us' | 'mx' | null                                                  immutable; EXECUTE service_role
contact_duplicate_flags + dismissed_at, dismissed_by, merge_id bigint (-> contact_merges, on delete set null),
                        strength smallint (generated from reason)
public.contact_merges(id bigint, account_id, keep_id, other_id, merged_by, merged_at, undo_until, keep_before, keep_after,
                      choices, moved, moved_counts, removed, unread_handed, other_reply_token, undone_at, undone_by)
app.may_merge(uuid) -> boolean                                       the one who-check (service_role JWT, agency, Owner/Staff of this account)
app.open_duplicate_pairs(p_account_id uuid, p_contact_id uuid default null, p_after_strength smallint default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null, p_limit integer default null)
  -> setof pair rows          invoker; the read-time filters, and the contact filter, cursor and limit INSIDE (it cannot inline)
public.duplicate_pairs_page(p_account_id uuid, p_limit int, p_after_strength smallint, p_after_created_at timestamptz, p_after_id uuid)
public.duplicate_pairs_count(p_account_id uuid) -> integer
public.duplicate_pairs_of(p_account_id uuid, p_contact_id uuid)       -- at most 20, strongest first
public.dismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null) -> {"status":"dismissed"|"not_found"}
public.undismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null) -> {"status":"restored"|"not_found"}
public.merge_contacts(p_account_id uuid, p_keep uuid, p_other uuid, p_choices jsonb, p_seen jsonb, p_actor text default null)
  -> {"status":"merged","mergeId":n,"moved":{key:count}} | {"status":"same"|"not_found"|"holding"|"already_merged"|"stale"}
public.undo_contact_merge(p_account_id uuid, p_merge_id bigint, p_actor text default null)
  -> {"status":"undone","otherId":uuid,"keptNew":n,"keptEdits":[field]} | {"status":"not_found"|"already_undone"|"expired"|"later_merge"}
public.contact_merge_preview(p_account_id uuid, p_keep uuid, p_other uuid)        invoker
  -> {"status":"ok","counts":{messages,calls,bookings,documents,opportunities,notes,tasks,form_submissions},
      "fields":{"keep":{…},"other":{…}},"seen":{"keep":<md5>,"other":<md5>}}
   | {"status":"same"|"not_found"|"holding"|"already_merged"}
app.merge_fields_of(public.contacts) -> jsonb    the merge's one field list; p_seen = md5(merge_fields_of(row)::text) per side
contact_merges: authenticated SELECTs only id, account_id, keep_id, other_id, merged_by, merged_at, undo_until,
                moved_counts, undone_at, undone_by (column grant, plan review m8c)
contact_delete_blockers: + reason 'merges' (a merge not undone names the contact)
ai_contact_held_by: + reason 'contact_merges' (same rule)
```

Pair reasons and their strength (lower is stronger; `same_name` last): `same_phone` 1, `same_email` 2, `email_phone_conflict` 3, `same_digits` 4, `phone_country_twin` 4, `phone_shared_new_person` 5, `hidden_match` 6, `phone_match_on_edit` 7, `email_match_on_edit` 7, `phone_country_pick` 7, `merged_by_hand` 8, anything else 8, `same_name` 9.

### TypeScript interfaces

`packages/db/src/dedupe-keys.ts` (T1; import-free; `@bis/db/dedupe-keys` and the barrel):

```ts
export function nameFold(value: string | null | undefined): string;
export function nameKey(first: string | null | undefined, last: string | null | undefined): string | null;
export function phoneNational(phone: string | null | undefined): string | null;
export type PhoneFamily = "us" | "mx";
export function phoneFamily(phone: string | null | undefined): PhoneFamily | null;
export const DUPLICATE_REASON_STRENGTH: Readonly<Record<string, number>>;
export function reasonStrength(reason: string): number;           // ?? 8
export type ReasonLabel = "samePhone" | "sameDigits" | "sameEmail" | "sameName" | "other";
export function reasonLabel(reason: string): ReasonLabel;
export const MERGE_UNDO_DAYS = 30;
```

`packages/db/src/contact-merge.ts` (T5; exported from `index.ts`):

```ts
export type DuplicatePerson = { id: string; firstName: string | null; lastName: string | null };
export type DuplicatePair = { id: string; a: DuplicatePerson; b: DuplicatePerson; reason: string; strength: number; createdAt: string };
export type DuplicateCursor = { strength: number; createdAt: string; id: string };   // createdAt exactly as PostgREST returned it
export const DUPLICATE_PAGE_MAX = 100;
listDuplicatePairs(db, accountId, opts?: { limit?: number; after?: DuplicateCursor }): Promise<DuplicatePair[]>
countDuplicatePairs(db, accountId): Promise<number>                         // throws on a non-number answer
duplicatePairsOf(db, accountId, contactId): Promise<DuplicatePair[]>
dismissDuplicatePair(db, accountId, flagId, actor?): Promise<"dismissed" | "not_found">
undismissDuplicatePair(db, accountId, flagId, actor?): Promise<"restored" | "not_found">
export type MergeChoice = "keep" | "other";
export const MERGE_CHOICE_FIELDS = ["first_name", "last_name", "email", "phone", "assigned_to", "language"] as const;
/** `seen`: the two fingerprints `contactMergePreview` answered, sent back unchanged (correction 19). */
export type MergeInput = { keepId: string; otherId: string; choices: Readonly<Record<string, MergeChoice>>; seen: { keep: string; other: string }; actor?: string };
export type MergeOutcome = { status: "merged"; mergeId: number; moved: Record<string, number> }
                         | { status: "same" | "not_found" | "holding" | "already_merged" | "stale" };
mergeContacts(db, accountId, input: MergeInput): Promise<MergeOutcome>
export type UndoMergeOutcome = { status: "undone"; otherId: string; keptNew: number; keptEdits: string[] }
                             | { status: "not_found" | "already_undone" | "expired" | "later_merge" };
undoContactMerge(db, accountId, mergeId: number, actor?: string): Promise<UndoMergeOutcome>
export const MERGE_COUNT_KEYS = ["messages", "calls", "bookings", "documents", "opportunities", "notes", "tasks", "form_submissions"] as const;
export type MergeCountKey = (typeof MERGE_COUNT_KEYS)[number];
export type MergePreview =
  | { status: "ok"; counts: Record<MergeCountKey, number>;
      fields: { keep: Record<string, unknown>; other: Record<string, unknown> }; seen: { keep: string; other: string } }
  | { status: "same" | "not_found" | "holding" | "already_merged" };
contactMergePreview(db, accountId, keepId, otherId): Promise<MergePreview>
followMerge(db, accountId, contactId): Promise<string>       // merged_into ?? contactId; an unknown id answers itself; throws on a read error
mergedIdsOf(db, accountId, keepId): Promise<string[]>        // the tombstones pointing at keepId (one hop: 0106 flattens chains)
```

`packages/db/src/contacts.ts` (T4): `COLS` (`:80-81`, still ONE literal) gains `merged_into`; `DELETE_BLOCK_REASONS` (`:1339`) gains `"merges"`.

`packages/db/src/record.ts` (T9): `TimelineSource` and `TIMELINE_SOURCES` gain `"merge"` after `"archive"`; `TimelineEntry` gains

```ts
export type TimelineMerge = {
  mergeId: string; otherId: string; otherFirstName: string | null; otherLastName: string | null; otherVisible: boolean;
  mergedBy: string; mergedAt: string; undoUntil: string; undoneAt: string | null; undoneBy: string | null;
  counts: Partial<Record<MergeCountKey, number>>;
};
  | { kind: "merge"; id: string; at: string; contactId: string; merge: TimelineMerge }        // at = merged_at
  | { kind: "mergeUndone"; id: string; at: string; contactId: string; merge: TimelineMerge }  // at = undone_at
```

`apps/web/src/lib/contacts/merge-copy.ts` (T9): `mergeCountsList(counts: Partial<Record<MergeCountKey, number>>, tr: Tr, locale: Locale): string` (counted phrases with their One twins, joined by `Intl.ListFormat(locale, { type: "conjunction" })`; zero counts left out; `""` when nothing).

Server actions (T10, `ACCT/contacts/merge-actions.ts`; T11 consumes `undoMergeAction`):

```ts
export type MergeActionResult = { ok: true; mergeId: number; keptId: string } | { ok: false; errorKey: "contacts.merge.stale" | "contacts.merge.failed" };
export async function mergeContactsAction(accountId: string, input: { keepId: string; otherId: string; choices: Record<string, "keep" | "other">; seen: { keep: string; other: string } }): Promise<MergeActionResult>;
export type UndoMergeActionResult = { ok: true; otherId: string; keptNew: number; keptEdits: string[] }
  | { ok: false; errorKey: "contacts.merge.undoExpired" | "contacts.merge.undoLater" | "contacts.merge.undoFailed" };
export async function undoMergeAction(accountId: string, mergeId: number): Promise<UndoMergeActionResult>;
export async function dismissPairAction(accountId: string, flagId: string): Promise<{ ok: true } | { ok: false; errorKey: "contacts.duplicates.dismissFailed" }>;
export async function undismissPairAction(accountId: string, flagId: string): Promise<{ ok: true } | { ok: false; errorKey: "contacts.duplicates.dismissFailed" }>;
```

The compare route is `ACCT/contacts/merge?a=<uuid>&b=<uuid>[&keep=<uuid>]`: `a` and `b` unordered; `keep` (when it is one of the two) overrides the default, the older record (`created_at`, then `id`).

### Pinned lists this plan moves (grep was run for each before naming tasks)

| Pinned list | File:line | Moves | Task |
|---|---|---|---|
| `EXPECTED_DEFINERS` and its two counts | `packages/db/src/test/definer-search-path.test.ts:25-59,75,84` | 29 → 32 (T1), → 36 (T3) | T1, T3 |
| `EXPECTED_WRITES` for the flag table | `packages/db/src/test/schema-grants-guard.test.ts:79` | `IUD` → four `INSERT(col)` | T1 |
| Client-write digest | `packages/db/src/test/proposals-drop.test.ts:98` | `52|b662…` → `49|<read on post>` | T1 |
| `FK_PAIRS` / `FK_TABLES` (+ the count in the test name and `toHaveLength`) | `packages/db/src/test/ai-acts-schema.test.ts:849-879` | 23 → 26 pairs, 21 → 23 tables | T1 |
| held-by blocker cases and exempt list | `ai-acts-schema.test.ts:653-694` | + `contact_merges` case; `contacts` exempt | T1 |
| Unindexed single-column FKs | `packages/db/src/test/contact-archive-schema.test.ts:643` | three → `[]` | T1 |
| `ACCOUNT_OWNED_TABLES` | `packages/db/src/account-teardown.ts:42` | `"contact_merges"` before `"contact_archive_log"` | T1 |
| `DELETE_BLOCK_REASONS` | `packages/db/src/contacts.ts:1339` | + `"merges"` | T4 |
| Flag reasons pinned in live tests | `test/contacts.test.ts:321,340,487,505,1218,1225-1237,1250-1257,1281-1290,1349`; `test/contacts-phone-live.test.ts:31,49,62-70`; `test/contact-import.test.ts:201`; `test/assignee-filters.test.ts:218-230` | trigger reasons (T4 table) | T4 |
| `TIMELINE_SOURCES` | `packages/db/src/test/record.test.ts:305` | + `"merge"` after `"archive"` | T9 |
| `NINE` source lists | `record.test.ts:754,894` | + `"merge"` | T9 |
| Derived source list | `packages/db/src/test/timeline-merge.test.ts:149` | none (it filters the two asked-for sources; `merge` is always read) | — |
| `lib/messages-readers.test.ts` | `apps/web/src/lib/messages-readers.test.ts:23` | `messaging.ts` 14 → 15: `incrementUnreadForMessage` reads one message's thread (plan review m7). The compare screen adds none (correction 13) | T7 |
| `in-account-service-reads.test.ts` `ALLOWED` | `ACCT/in-account-service-reads.test.ts:90-210` | **none**: every new page and action uses the request client only. A task that adds `serviceDb` stops and asks | — |
| `READ_ONLY_ALLOWED` (billing pause) | `apps/web/src/lib/billing/read-only.test.ts:149-170` | **none**: merge, undo, dismiss and undismiss are writes and stay refused while paused; the compare page is a page | — |
| `technician-guards.test.ts` `PAGES` | `ACCT/technician-guards.test.ts:20-23` | + `"contacts/merge/page.tsx"` | T10 |
| Palette index | `apps/web/src/lib/palette/registry.ts` | **none**: the compare screen is a sub-route of Contacts, not a settings section | — |
| F-118 route walk (`ACCT/access-log-routes.test.ts`, not on main yet) | F-118 plan T11 | classify the compare page and the four actions | T13 (after main merge) |

### Bare `@bis/db` mock factories a task must extend

A bare factory exposes only what it lists; a module under test that newly calls a symbol gets `undefined`.

| Test file (mock line) | Kind | Why | Task |
|---|---|---|---|
| `ACCT/contacts/page.test.ts:92` | bare | the page reads `listDuplicatePairs`, `countDuplicatePairs` in the duplicates view | T10 |
| `ACCT/tasks/page.test.ts:131` | partial | the page reads `countDuplicatePairs` | T10 |
| `ACCT/contacts/export/route.get.test.ts:19` | bare | none new; `archivedFilterOf` takes the third view | T10 (assert only) |
| `ACCT/contacts/[contactId]/page.test.ts:104` | bare | `loadTimeline` calls `mergedIdsOf` and `listTimelinePage` (T9); the page calls `duplicatePairsOf` (T11) | T9, T11 |
| `apps/web/src/lib/record/loaders.test.ts:22` | bare | `mergedIdsOf`, `listTimelinePage` | T9 |
| `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts:36` | bare | `duplicatePairsOf`; a tombstone row from `getContact` | T11 |
| `apps/web/src/lib/proposals/kinds/contact-field.test.ts:7` | partial | `followMerge` | T6 |
| `apps/web/src/lib/ai-acts/actions.test.ts:39` | bare | `followMerge` | T6 |

### The second-account rule

Every account-scoped read or write this plan adds gets a test in which a SECOND account holds a matching row:

| Read or write | Test | Task |
|---|---|---|
| the flag trigger, the backfill, `open_duplicate_pairs` and the three list functions, dismiss | `contact-dedupe-schema.test.ts` | T1 |
| `merge_contacts`, `undo_contact_merge`, `contact_merge_preview`, `follow_merge` | `contact-merge-schema.test.ts` | T3 |
| `listContacts`/`countContacts` tombstone filter, `findDuplicate`, `buildMatchIndex` | `contact-merge-lookups-live.test.ts` | T4 |
| the wrappers end to end | `contact-merge-live.test.ts` | T5 |
| `listContactsOnNumber` | `voice-merge-live.test.ts` | T6 |
| `ensureConversation`, `matchSender`, `findReplyThread` | `messaging-merge-live.test.ts` | T7 |
| the timeline `merge` source | `record-merge-live.test.ts` | T9 |

### e2e locators a new control can collide with

- `getByRole("link", { name: "Contacts", exact: true })` (`e2e/phone-width.spec.ts:376`, `e2e/staff-roles.spec.ts:115`): the duplicates view's way back is `contacts.archived.back` ("Back to contacts"), never "Contacts".
- The record line names the OTHER person. A spec that opens a record and finds a person's name with an unscoped `getByText` now meets it twice when the two share a phone, email or name on the fixture account and are NOT in one household or linked by a relationship (those pairs are filtered out). T12 Step 1 greps every spec that creates two such contacts.
- The archive toolbar's "Archived" link and the bulk bar (`bulk-action-bar`, `/delete/i`): the duplicates view adds no checkbox, no bulk control and no word "delete".

### File map

| File | Task |
|---|---|
| `MIG/0106_contact_merge.sql` (new; part A sections 0–13, part B sections 14–19) | T1, T3 |
| `packages/db/src/dedupe-keys.ts`, `packages/db/src/dedupe-keys.test.ts` (new); `packages/db/package.json` (one `exports` line) | T1 |
| `packages/db/src/test/contact-dedupe-schema.test.ts` (new) | T1 |
| `packages/db/src/test/contact-merge-schema.test.ts` (new) | T3 |
| `packages/db/src/contacts.ts`, `contact-import.ts`, `contacts-merge-resolve.test.ts` (new), `test/contact-merge-lookups-live.test.ts` (new), four live files' pins | T4 |
| `packages/db/src/contact-merge.ts`, `contact-merge.test.ts` (new), `test/contact-merge-live.test.ts` (new) | T5 |
| `packages/db/src/index.ts` | T1 (W1), T5 (W2), T7 (W3; T9 adds nothing to the barrel: apps/web names the type as `Extract<TimelineEntry, { kind: "merge" }>["merge"]`) |
| `packages/db/src/voice.ts`, `voice-merge.test.ts` (new), `test/voice-merge-live.test.ts` (new); `apps/web/src/lib/voice/identity/candidates.test.ts`; `lib/ai-acts/actions.ts`; `lib/proposals/kinds/contact-field.ts` (+ tests) | T6 |
| `packages/db/src/messaging.ts`, `inbound-email.ts`, `messaging-merge.test.ts` (new), `test/messaging-merge-live.test.ts` (new); `apps/web/src/app/api/sms/inbound/route.ts` (+ two tests); `apps/web/src/lib/messages-readers.test.ts` | T7 |
| `packages/db/src/automations.ts`, `automations-merge.test.ts` (new) | T8 |
| `packages/db/src/record.ts`, `test/record.test.ts`, `test/record-merge-live.test.ts` (new); `apps/web/src/lib/record/{timeline-rows,author-mark,recent-rows,loaders}.ts` (+ tests); `apps/web/src/lib/contacts/merge-copy.ts` (+ test); `ACCT/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.merge.test.ts`); `ACCT/groups/[groupId]/group-timeline.tsx` (+ test); `ACCT/contacts/[contactId]/page.test.ts` (mock only) | T9 |
| `ACCT/contacts/merge/{page,loading,merge-screen}.tsx` (+ tests), `ACCT/contacts/merge-actions.ts` (+ test), `ACCT/contacts/duplicates-list.tsx` (+ test), `ACCT/contacts/page.tsx` (+ test), `apps/web/src/lib/contacts/{view,merge-fields,duplicates}.ts` (+ tests), `ACCT/contacts/export/route.get.test.ts`, `ACCT/tasks/page.tsx` (+ test), `ACCT/technician-guards.test.ts` | T10 |
| `ACCT/contacts/duplicate-line.tsx` (+ test), `ACCT/contacts/[contactId]/page.tsx` (+ test), `ACCT/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`, `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts` (+ tests), `apps/web/src/lib/contacts/drawer-summary.ts` (+ test), `ACCT/contacts/[contactId]/activity-timeline.tsx` (Undo merge control), `dashboard/styleguide/merge-demo.tsx` (+ test), `dashboard/styleguide/page.tsx` | T11 |
| `apps/web/e2e/contacts-merge.spec.ts` (new) | T12 |
| `apps/web/src/lib/messages.ts`, `messages.test.ts` | T2 |

---

## Task list

| # | Title | Owner | Tier | Wave |
|---|---|---|---|---|
| T1 | 0106 part A: keys and their twins, the pair queue and its trigger, the list and dismiss functions, the tombstone columns and guard, `contact_merges`, blockers, held-by; schema tests and pinned lists | bis-db-schema | high | 1 |
| T2 | Every new string, English and Spanish | bis-crm | low | 1 |
| T3 | 0106 part B: `merge_contacts`, `undo_contact_merge`, `contact_merge_preview`, the `follow_merge` backstop; schema tests | bis-db-schema | high | 2 |
| T4 | Contact queries: tombstones leave every list, lookups follow the pointer, the flag-reason pins move | bis-crm | medium | 2 |
| T5 | `contact-merge.ts`: the typed wrappers, `followMerge`, `mergedIdsOf` | bis-crm | medium | 2 |
| T6 | Sofía and the tray after a merge: number lookup, AI act Undo, suggestion Accept | bis-voice | medium | 3 |
| T7 | Threads and mail after a merge: `ensureConversation`, `matchSender`, `findReplyThread` | bis-comms | medium | 3 |
| T8 | Reactivation's held release skips a tombstone | bis-automations | medium | 3 |
| T9 | Merge rows on the timeline (record, household, drawer), the id set, the counts phrase | bis-crm | medium | 3 |
| T10 | Actions, the compare screen, the Possible duplicates view, the To do row | bis-crm | medium | 4 |
| T11 | The record line, the drawer line, tombstone redirects, Undo merge on the timeline, styleguide | bis-frontend | medium | 4 |
| T12 | e2e: `contacts-merge.spec.ts` on the fixture account | bis-e2e-qa | medium | 5 |
| T13 | After F-118 merges: reconcile with the access log (route walk, page log) | bis-crm | low | after main merge |

**Tiers** follow `bis-speed-process` (binding 2026-10-19): the two migration tasks are high (full ceremony: brief review, opus review with mutation probes, re-review). Every other task is medium (implementer plus one review) except copy and the F-118 reconcile (low: no per-task review; covered by the end-of-PR review). T8 is medium, not high, although it touches a send path: it can only REMOVE a send (a held release answers `gone`), never cause one.

**Waves.** Wave 2 starts once T1 is green on the replica and committed (T3 appends to its file; T4 and T5 need its columns and functions). T4 and T5 are two bis-crm agents on disjoint files. Wave 3 needs T3, T4 and T5 committed (T6 and T7 import `followMerge`; T9's live test merges for real). Wave 4 needs T2 and T9 (T10 and T11 render the counts phrase and the timeline rows). T11 imports `undoMergeAction` from T10's file, so T11 runs `pnpm --filter web typecheck` and commits only AFTER T10 has committed; neither stages the other's files. Wave 5 runs after everything has landed and 0106 is on bis-ci (checklist step 4). Two tasks in one wave never share a file; the file lists below are the complete set each task may touch.

---

### Task 1: 0106 part A, its twins and its schema tests

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0106_contact_merge.sql` (sections 0–13 below; T3 appends 14–19)
- Create: `packages/db/src/dedupe-keys.ts`, `packages/db/src/dedupe-keys.test.ts`
- Create: `packages/db/src/test/contact-dedupe-schema.test.ts`
- Modify: `packages/db/package.json` (`exports`: add `"./dedupe-keys": "./src/dedupe-keys.ts"` after `"./webchat-plan"`)
- Modify: `packages/db/src/index.ts` (after `:31`, one line: `export { nameFold, nameKey, phoneNational, phoneFamily, reasonStrength, reasonLabel, DUPLICATE_REASON_STRENGTH, MERGE_UNDO_DAYS, type PhoneFamily, type ReasonLabel } from "./dedupe-keys";`)
- Modify: `packages/db/src/test/definer-search-path.test.ts:25-59,70,75,84`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:79`
- Modify: `packages/db/src/test/proposals-drop.test.ts:84-98`
- Modify: `packages/db/src/test/ai-acts-schema.test.ts:653-694` (one BLOCKERS case, the exempt list) and `:846-879` (FK lists)
- Modify: `packages/db/src/test/contact-archive-schema.test.ts:627-644` (the index guard)
- Modify: `packages/db/src/account-teardown.ts:41-42`
- Scratch (not committed): `<scratchpad>/dm-t1/pg17-dm.sh`

**Interfaces:** Produces every SQL object of part A and the twins, with the names in "Shared facts". Consumes nothing.

- [ ] **Step 1: The PG17 replica.** Write `pg17-dm.sh` in your scratchpad (`dm-t1/`), port **55761**, its own data dir. Copy `docs/superpowers/plans/2026-10-28-calendar-feed.md` Task 1 Step 1's script and change exactly: `B` stays the PG17 path above; `D` is your scratch dir; `W=/c/Users/danlo/bis-platform/.claude/worktrees/dedupe`; port 55761; `pre` applies every file in `$M` except `0106_*` (0103 and 0104 are on this branch already, so drop the `git show feat/contacts-archive` lines); `post` = `create database post template pre`, then `alter database post set timezone to 'UTC'`, then 0106. Add a third verb `rw`: `create database rw template pre`, insert 10,000 contacts with `generate_series` (names `'Ana' || i`, last name `'Ruiz'`, phone `'+1956555' || lpad((i % 10000)::text, 4, '0')`), then time `psql -1 -f 0106` with `\timing on`. Confirm `pre` holds every file through 0104: `psql -p 55761 -d pre -tAc "select count(*) from public.calendar_feeds"` answers `0`.
- [ ] **Step 2: The twins, red first.** Create `packages/db/src/dedupe-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nameFold, nameKey, phoneNational, phoneFamily, reasonStrength, reasonLabel, DUPLICATE_REASON_STRENGTH, MERGE_UNDO_DAYS } from "./dedupe-keys";

describe("dedupe-keys: the TypeScript twins of 0106's key functions", () => {
  it.each([
    ["María", "maria"], ["  JOSÉ  ", "jose"], ["Muñoz", "munoz"], ["García-López", "garcia lopez"], ["O'Brien", "o brien"],
    ["Ruiz\u00A0Díaz", "ruiz diaz"], ["Ana\tMaría", "ana maria"], ["N/A", "na"], ["Zoë Brontë", "zoe bronte"],
    ["Ståhl", "sthl"], ["İsmail", "smail"], ["García\u3000López", "garcialopez"], ["李", ""], [null, ""],
  ])("nameFold(%j) = %j (mutation: .toLowerCase() anywhere -> 'İsmail' FAILS; .trim() -> the \\u3000 row FAILS)", (input, want) => {
    expect(nameFold(input)).toBe(want);
  });

  it.each([
    [["María", "García López"], "maria|garcia"], [["Maria", "Garcia"], "maria|garcia"], [["Juan Carlos", "García"], "juan carlos|garcia"],
    [["Ana", "de la Garza Treviño"], "ana|de la garza"], [["Luis", "San Miguel"], "luis|san miguel"], [["Rosa", "Santa Cruz"], "rosa|santa cruz"],
    [["Pedro", "García y López"], "pedro|garcia"], [["Pedro", "Delgado"], "pedro|delgado"], [["Ana", "de la"], "ana|de la"],
    [["Ana", ""], null], [["Ana", null], null], [[null, "Ruiz"], null], [["Caller", "Prueba"], null], [["Unknown", "Caller"], null],
    [["Desconocido", "Pérez"], null], [["N/A", "Pérez"], null], [["Sin Nombre", "Ruiz"], null], [["Cliente", "López"], null],
  ] as const)("nameKey(%j) = %j", ([first, last], want) => {
    expect(nameKey(first, last)).toBe(want);
  });

  it.each([
    ["+19562921696", "9562921696", "us"], ["(956) 292-1696", "9562921696", "us"], ["19562921696", "9562921696", "us"],
    ["+528999221234", "8999221234", "mx"], ["+52 1 899 922 1234", "8999221234", "mx"], ["044 899 922 1234", "8999221234", "mx"],
    ["045 899 922 1234", "8999221234", "mx"], ["01 899 922 1234", "8999221234", "mx"], ["+44 20 7946 0958", "442079460958", null],
    ["+5289992212345", "5289992212345", null], ["call after 5", "5", null], ["", null, null], [null, null, null],
  ] as const)("phoneNational(%j) = %j, family %j (mutation: drop the 521 branch -> the '+52 1' row FAILS)", (input, national, family) => {
    expect(phoneNational(input)).toBe(national);
    expect(phoneFamily(input)).toBe(family);
  });

  it("strength orders phone, email, conflict, digits, …, name last; an unknown reason is 8 (mutation: same_name 2 -> FAILS)", () => {
    expect(["same_phone", "same_email", "email_phone_conflict", "same_digits", "same_name"].map(reasonStrength)).toEqual([1, 2, 3, 4, 9]);
    expect(reasonStrength("whatever")).toBe(8);
    expect(Object.keys(DUPLICATE_REASON_STRENGTH).length).toBe(11);
  });

  it("labels: every reason maps to one of five words (mutation: phone_country_twin -> samePhone FAILS)", () => {
    expect(["same_phone", "phone_shared_new_person", "phone_match_on_edit", "phone_country_pick"].map(reasonLabel)).toEqual(Array(4).fill("samePhone"));
    expect(["same_digits", "phone_country_twin"].map(reasonLabel)).toEqual(["sameDigits", "sameDigits"]);
    expect(["same_email", "email_match_on_edit"].map(reasonLabel)).toEqual(["sameEmail", "sameEmail"]);
    expect(reasonLabel("same_name")).toBe("sameName");
    expect(["email_phone_conflict", "hidden_match", "merged_by_hand", "x"].map(reasonLabel)).toEqual(Array(4).fill("other"));
  });

  it("the Undo window is 30 days (owner ruling D7; mutation: 7 -> FAILS)", () => {
    expect(MERGE_UNDO_DAYS).toBe(30);
  });
});
```

Run `pnpm --filter @bis/db exec vitest run src/dedupe-keys.test.ts`. Expected: the file fails to import (`Failed to resolve import "./dedupe-keys"`). Paste the line.

- [ ] **Step 3: The twins.** Create `packages/db/src/dedupe-keys.ts`:

```ts
/**
 * F-006 part 1 (migration 0106): the TypeScript twins of the database's comparison keys, and the pair
 * reasons' order. IMPORT-FREE on purpose: apps/web's client components import it as `@bis/db/dedupe-keys`.
 * Each function is spelled to match its SQL twin character for character, never with a built-in that
 * folds a superset (the 0034 lesson): no .trim(), no .toLowerCase(), no .normalize(). contact-dedupe-schema.test.ts
 * compares the two sides shape by shape on a real database.
 */

/** phoneDigits' fold (contacts.ts:188-191), restated so this module imports nothing. */
function digitsKey(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/[^0-9]/g, "");
  const k = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return k === "" ? null : k;
}
const TEN = /^[0-9]{10}$/;
const MX = [/^521[0-9]{10}$/, /^04[45][0-9]{10}$/, /^52[0-9]{10}$/, /^01[0-9]{10}$/];

/** app.phone_national: the ten national digits of any +1 or +52 shape (legacy 521, 044, 045 and 01 too), else the digits key. */
export function phoneNational(phone: string | null | undefined): string | null {
  const k = digitsKey(phone);
  if (k === null) return null;
  if (TEN.test(k)) return k;
  return MX.some((re) => re.test(k)) ? k.slice(-10) : k;
}

export type PhoneFamily = "us" | "mx";
/** app.phone_family: "us" for ten digits (a bare ten reads as +1, as phone_key always has), "mx" for every +52 shape, else null. */
export function phoneFamily(phone: string | null | undefined): PhoneFamily | null {
  const k = digitsKey(phone);
  if (k === null) return null;
  if (TEN.test(k)) return "us";
  return MX.some((re) => re.test(k)) ? "mx" : null;
}

/** The fold table, in app.contact_name_fold's order: A-Z, then - . , ', then six whitespace characters, then the
 *  24 upper and 24 lower accented letters of Spanish and Portuguese names. Code points, not a regex class. */
const ACCENT_CODES = [192, 193, 194, 195, 196, 199, 200, 201, 202, 203, 204, 205, 206, 207, 209, 210, 211, 212, 213, 214, 217, 218, 219, 220];
const ACCENT_TO = "aaaaaceeeeiiiinooooouuuu";
const FOLD: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (let c = 65; c <= 90; c++) m.set(String.fromCharCode(c), String.fromCharCode(c + 32));
  for (const s of ["-", ".", ",", "'"]) m.set(s, " ");
  for (const c of [9, 10, 11, 12, 13, 160]) m.set(String.fromCharCode(c), " ");
  ACCENT_CODES.forEach((c, i) => {
    m.set(String.fromCharCode(c), ACCENT_TO[i]!);
    m.set(String.fromCharCode(c + 32), ACCENT_TO[i]!);
  });
  return m;
})();

/** app.contact_name_fold: map, drop everything outside [a-z0-9 ], collapse spaces, trim spaces. */
export function nameFold(value: string | null | undefined): string {
  let out = "";
  for (const ch of value ?? "") out += FOLD.get(ch) ?? ch;
  return out.replace(/[^a-z0-9 ]/g, "").replace(/ +/g, " ").replace(/^ | $/g, "");
}

/** Placeholder first names Sofía and imports write (finish-call.ts:423,435; the archive spec's "Unknown Caller"). */
const PLACEHOLDERS: ReadonlySet<string> = new Set(["caller", "unknown", "desconocido", "cliente", "customer", "na", "none", "sin nombre"]);
/** The first surname: leading particles kept attached, then the next word (app.contact_name_key's regex). */
const SURNAME = /^(((de|del|la|las|los|y|san|santa) )*[a-z0-9]+)/;

/** app.contact_name_key: "first|first surname", or null with no last name or a placeholder first name. */
export function nameKey(first: string | null | undefined, last: string | null | undefined): string | null {
  const f = nameFold(first);
  if (f === "" || PLACEHOLDERS.has(f)) return null;
  const s = SURNAME.exec(nameFold(last))?.[1] ?? "";
  return s === "" ? null : `${f}|${s}`;
}

/** contact_duplicate_flags.strength (0106's generated column): lower is stronger; same_name is last. */
export const DUPLICATE_REASON_STRENGTH: Readonly<Record<string, number>> = {
  same_phone: 1, same_email: 2, email_phone_conflict: 3, same_digits: 4, phone_country_twin: 4,
  phone_shared_new_person: 5, hidden_match: 6, phone_match_on_edit: 7, email_match_on_edit: 7,
  phone_country_pick: 7, same_name: 9,
};
export function reasonStrength(reason: string): number {
  return DUPLICATE_REASON_STRENGTH[reason] ?? 8;
}

export type ReasonLabel = "samePhone" | "sameDigits" | "sameEmail" | "sameName" | "other";
const LABEL: Readonly<Record<string, ReasonLabel>> = {
  same_phone: "samePhone", phone_shared_new_person: "samePhone", phone_match_on_edit: "samePhone", phone_country_pick: "samePhone",
  same_digits: "sameDigits", phone_country_twin: "sameDigits",
  same_email: "sameEmail", email_match_on_edit: "sameEmail",
  same_name: "sameName",
};
/** The words a pair is shown with (contacts.duplicates.reason.*). */
export function reasonLabel(reason: string): ReasonLabel {
  return LABEL[reason] ?? "other";
}

/** Owner ruling D7: a merge can be undone for 30 days. 0106's contact_merges_window check pins the same number. */
export const MERGE_UNDO_DAYS = 30;
```

Run Step 2's command. Expected: all pass. Paste the summary line. Add the `package.json` exports line and the `index.ts` line, then `pnpm --filter @bis/db exec tsc --noEmit -p .` (paste).

- [ ] **Step 4: The failing schema test.** Create `packages/db/src/test/contact-dedupe-schema.test.ts`. Copy `seedAccount` and `refusal` from `contact-archive-schema.test.ts` (read the file; the shapes are at its top). Then:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { nameKey, phoneNational, phoneFamily, reasonStrength, DUPLICATE_REASON_STRENGTH } from "../dedupe-keys";

/**
 * 0106 part A: the comparison keys and their parity, the flag trigger, the backfill's shapes, the list functions,
 * dismissal, the flag table's narrowed grants, the tombstone columns and their guard, contact_merges' grants and
 * policy, and the two replaced functions (blockers, held-by). RED BEFORE APPLY. Replica only (withRollback).
 */
type P = { first?: string | null; last?: string | null; phone?: string | null; email?: string | null };
async function person(c: Client, accountId: string, p: P = {}): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, last_name, phone, email, author_kind) values ($1, $2, $3, $4, $5, 'person') returning id",
    [accountId, p.first ?? null, p.last ?? null, p.phone ?? null, p.email ?? null]);
  return r!.id;
}
async function pairs(c: Client, accountId: string) {
  await actAsOwner(c);
  const { rows } = await c.query<{ a: string; b: string; reason: string }>(
    "select contact_a as a, contact_b as b, reason from public.contact_duplicate_flags where account_id = $1 order by 1, 2", [accountId]);
  return rows;
}
/** Postgres orders uuids as their lowercase hex strings (record.ts:368-369), so a JS sort gives contact_a. */
const pair = (x: string, y: string, reason: string) => { const [a, b] = [x, y].sort(); return { a: a!, b: b!, reason }; };
async function tombstone(c: Client, accountId: string, id: string, into: string) {
  await actAsOwner(c);
  await c.query("update public.contacts set merged_into = $3, merged_at = now() where account_id = $1 and id = $2", [accountId, id, into]);
}
```

Write these cases. Every "found by key" case uses two contacts that share NOTHING but the key under test (different phones, no emails, names that differ unless the name is the key), so no other key can satisfy the assertion (`bis-test-vacuity`).

```ts
describe("0106: the keys match their TypeScript twins", () => {
  const NAMES: [string | null, string | null][] = [
    ["María", "García López"], ["MARIA", "GARCIA"], ["maría", "garcía-lópez"], ["José", "Muñoz"], ["JOSÉ", "MUÑOZ"],
    ["Juan Carlos", "García"], ["Ana", "de la Garza Treviño"], ["Luis", "San Miguel"], ["Rosa", "Santa Cruz"],
    ["Pedro", "García y López"], ["Pedro", "Delgado"], ["Inés", "Peña"], ["Zoë", "Brontë"], ["Mary", "O'Brien"],
    ["Ana", "Ruiz\u00A0Díaz"], ["Ana\t", "Ruiz"], ["  Ana  ", "  Ruiz  "], ["Ana", ""], ["Ana", null], [null, "Ruiz"],
    ["Caller", "Prueba"], ["Unknown", "Caller"], ["Desconocido", "Pérez"], ["N/A", "Pérez"], ["Cliente", "López"],
    ["Ana", "de la"], ["Ana", "Ståhl"], ["İsmail", "Şahin"], ["李", "王"], ["Ana", "García\u3000López"],
  ];
  it.each(NAMES)("name_key = nameKey() for %j %j (mutation: drop chr(209) from the SQL map only -> the Muñoz rows FAIL)", (first, last) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "nk");
      const id = await person(c, a.accountId, { first, last });
      const { rows: [r] } = await c.query("select name_key from public.contacts where id = $1", [id]);
      expect(r.name_key).toBe(nameKey(first, last));
    }));

  const PHONES = ["+19562921696", "(956) 292-1696", "9562921696", "19562921696", "+528999221234", "+52 1 899 922 1234",
    "+5218999221234", "044 899 922 1234", "045 899 922 1234", "01 899 922 1234", "+44 20 7946 0958", "+5289992212345",
    "call after 5", "0123456789", ""];
  it.each(PHONES)("phone_national and phone_family = their twins for %j (mutation: drop the 521 branch in SQL only -> FAILS)", (phone) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pn");
      const id = await person(c, a.accountId, { first: "Key", phone: phone || null });
      const { rows: [r] } = await c.query("select phone_national, app.phone_family(phone) as fam from public.contacts where id = $1", [id]);
      expect(r).toEqual({ phone_national: phoneNational(phone || null), fam: phoneFamily(phone || null) });
    }));

  it("the generated strength equals reasonStrength for every reason (mutation: same_name 2 in SQL -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "st");
      for (const reason of [...Object.keys(DUPLICATE_REASON_STRENGTH), "merged_by_hand", "anything"]) {
        const x = await person(c, a.accountId, { first: `S ${reason}` });
        const y = await person(c, a.accountId, { first: `T ${reason}` });
        const [lo, hi] = [x, y].sort();
        const { rows: [r] } = await c.query(
          "insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1, $2, $3, $4) returning strength",
          [a.accountId, lo, hi, reason]);
        expect(r.strength, reason).toBe(reasonStrength(reason));
      }
    }));

  it("a signed-in Owner's insert and edit succeed and store both keys (correction 3; mutation: revoke execute on app.contact_name_key from authenticated -> 42501, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "own");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query(
        "insert into public.contacts (account_id, first_name, last_name, phone) values ($1, 'María', 'García', '+528999221234') returning id, name_key, phone_national",
        [a.accountId]);
      expect([r.name_key, r.phone_national]).toEqual(["maria|garcia", "8999221234"]);
      await c.query("update public.contacts set last_name = 'López' where id = $1", [r.id]);
    }));
});
```

Then the trigger, written in full in the same style:

| Case | Seed | Assertion | Mutation that must turn it red |
|---|---|---|---|
| same name, two surnames | `{María, García López, +19565550101}`, `{Maria, Garcia, +19565550102}` | `pairs` = `[pair(x, y, "same_name")]` | key on the whole folded last name |
| one first name is not another | `{Juan Carlos, García, …0103}`, `{Juan, García, …0104}` | `[]` | key on the first word of the first name |
| placeholders never pair | `{Caller, Prueba, …0105}` and `{Caller, Prueba, …0106}`; `{Unknown, Caller, …0107}` and `{Unknown, Caller, …0108}` (each with a LAST name, so the no-last-name rule cannot be what refuses them, and two different phones, so a phone pair cannot either: review m8d) | `[]` | delete the placeholder array |
| no last name, no key | `{Ana, null, …0109}` and `{Ana, null, …0110}` (two phones, review m8d) | `[]` and both `name_key` null | coalesce the last name to `''` |
| legacy +52 1 is the same phone | `{Uno, phone '+5218999221234'}`, `{Dos, '+528999221234'}` | `[pair(…, "same_phone")]` | drop the `521` branch |
| a +1 and a +52 of one ten digits | `{Uno, '+18999221234'}`, `{Dos, '+528999221234'}` | `[pair(…, "same_digits")]` | write `same_phone` whatever the family |
| email | `{Uno, email 'ANA@x.mx'}`, `{Dos, email 'ana+tag@x.mx'}` | `[pair(…, "same_email")]` | drop the email insert |
| strongest reason stands | one pair sharing phone AND email AND name | exactly one row, `same_phone` | run the name insert first |
| an edit files a pair | `{Uno, '+19565550111'}`, `{Dos, '+19565550112'}`, then `update … set phone = '+19565550111'` on Dos as an Owner | `same_phone` | trigger `after insert` only |
| a Technician's insert queues a pair outside their assignment | an unassigned `{Uno, '+19565550113'}`; the Technician (`actAsMember(…, "technician")`) inserts `{Dos, '+19565550113', assigned_to = their users.id}` | as owner, one `same_phone` row | trigger SECURITY INVOKER (the restrictive policy then refuses the insert, 42501) |
| a dismissal sticks | pair, then `update … set dismissed_at = now(), dismissed_by = 'u'` as owner, then edit both phones away and back | one row, still dismissed | `on conflict do update set dismissed_at = null` |
| a holding record never pairs | `insert … holds_shared_number true, first_name 'Caller', phone '+19565550115'` as owner (0098's shape), then `{Ana, '+19565550115'}` | `[]` | drop `not c.holds_shared_number` |
| a tombstone never pairs | `{Uno, '+19565550116'}`, `tombstone(Uno → Kept)`, then `{Dos, '+19565550116'}` | no row names Uno | drop `c.merged_into is null` |
| at most 20 per write | 22 contacts on one number, then a 23rd | the 23rd has exactly 20 rows | drop `limit 20` |
| second account | account B holds `{Ana, '+19565550117'}`; account A inserts `{Ana, '+19565550117'}` | A has `[]` | drop `c.account_id = new.account_id` |

The list functions and dismissal, in full in the same style. Call them as an Owner (`actAsMember(…, "owner")`) unless stated:

| Case | Assertion | Mutation |
|---|---|---|
| household members on one phone are hidden; the same two by email are shown | seed a household (`insert into public.client_groups (account_id, kind, name) values ($1, 'household', 'Casa')`, two `client_group_members`; read 0069 for the columns), then a phone pair and, on two other members of the same household, an email pair | `duplicate_pairs_page` has the email pair only | (a) drop the household filter; (b) apply it to every reason |
| a relationship hides a pair | a `contact_relationships` row (read 0070's checks for a valid `label_key`, use `'sibling'`) between a phone pair | hidden | drop the relationship filter |
| a tombstone side or a holding side hides a pair | flag rows inserted by hand as owner naming a tombstone, and one naming a holding record | hidden | drop either filter |
| rows and total agree across a page boundary | 3 pairs, all `same_phone`, two of them given the SAME `created_at` (`update … set created_at = '2026-10-01T00:00:00Z'` as owner) | page 1 (limit 2) + page 2 (after the last row of page 1) = all three, each once, ordered `(strength, created_at desc, id desc)`; `duplicate_pairs_count` = 3 | drop the `id` tiebreak from the cursor (page 2 repeats or loses a row) |
| phone before name | a `same_name` pair newer than a `same_phone` pair | the phone pair first | order by `created_at` alone |
| `duplicate_pairs_of` | three pairs naming X, one not | exactly X's three, strongest first | drop the `p_contact_id` term in `app.open_duplicate_pairs` |
| a Technician reads nothing | as a Technician | page `[]`, count 0 | drop `contact_duplicate_flags_technician_none` (0068) |
| second account | B's pair under A's id | page `[]`, count 0 | drop `f.account_id = p_account_id` |
| dismiss and undismiss | Owner dismisses: `{"status":"dismissed"}`, the pair leaves the page; undismiss: `{"status":"restored"}`, it is back; a second dismiss of a dismissed pair: `not_found` | | dismiss stamps nothing |
| who | Staff succeeds; a Technician is refused 42501; an Owner of an account with `client_access_enabled = false` is refused 42501; an Owner of account B passing A's flag id under A is refused 42501; **an Owner of A whose token names org B** is refused 42501 (seed ONE users row with Owner memberships in A and in B, then `actAs(c, { org_id: <B's org>, sub })`: `app.sees_all_customers(A)` is true for them, so only the account term can refuse; review m4) | | (a) drop the `sees_all_customers` term in `app.may_merge` → the Technician case; (b) drop BOTH coalesces around the account term and the whole expression (either alone still refuses; the 0103 probe) → the access-off case; (c) drop `coalesce(p_account_id = app.current_account_id(), false) and` → the Owner-of-A-with-B's-token case (the Owner of B alone is still refused by `sees_all_customers(A)`, so it cannot catch (c)) |
| service role | `set local role service_role` + `request.jwt.claims {"role":"service_role"}` and `p_actor 'svc'`: dismissed, `dismissed_by = 'svc'` | | drop the service term |

The grants, the guard and the replaced functions:

```ts
describe("0106: grants", () => {
  it("authenticated may insert the flag table's four columns and nothing else, and may not update or delete it (correction 2; mutation: grant update (dismissed_at) -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'INSERT') as t_ins,
                has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'UPDATE') as t_upd,
                has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'DELETE') as t_del,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'reason', 'INSERT') as c_reason,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'dismissed_at', 'INSERT') as c_dismissed,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'merge_id', 'INSERT') as c_merge,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'dismissed_at', 'UPDATE') as u_dismissed`);
      expect(p).toEqual({ t_ins: false, t_upd: false, t_del: false, c_reason: true, c_dismissed: false, c_merge: false, u_dismissed: false });
    }));

  it("an Owner's four-column insert still works through RLS (the writers of correction 2; mutation: drop the insert policy -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ins");
      const x = await person(c, a.accountId, { first: "X" });
      const y = await person(c, a.accountId, { first: "Y" });
      const [lo, hi] = [x, y].sort();
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1, $2, $3, 'email_phone_conflict')", [a.accountId, lo, hi]);
      expect((await pairs(c, a.accountId))).toEqual([{ a: lo, b: hi, reason: "email_phone_conflict" }]);
    }));

  it("authenticated holds no write on contact_merges and no write on merged_into (privilege reads; mutation: grant insert on contact_merges -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_merges', 'INSERT') as i,
                has_table_privilege('authenticated', 'public.contact_merges', 'UPDATE') as u,
                has_table_privilege('authenticated', 'public.contact_merges', 'DELETE') as d,
                has_column_privilege('authenticated', 'public.contacts', 'merged_into', 'UPDATE') as m`);
      expect(p).toEqual({ i: false, u: false, d: false, m: false });
    }));

  it("authenticated reads exactly the ten timeline columns of contact_merges, never a snapshot or the reply token (review m8c; mutation: grant select on public.contact_merges to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ col: string }>(
        `select a.attname as col from pg_attribute a
          where a.attrelid = 'public.contact_merges'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', 'public.contact_merges', a.attnum, 'SELECT')
          order by 1`);
      expect(rows.map((r) => r.col)).toEqual(["account_id", "id", "keep_id", "merged_at", "merged_by", "moved_counts",
        "other_id", "undo_until", "undone_at", "undone_by"]);
    }));
});
```

| Case | Assertion | Mutation |
|---|---|---|
| a signed-in update of a tombstone is refused | Owner updates a tombstone's `first_name`: 42501 (the Owner sees the row, so RLS is not what refuses it) | drop the guard's update branch |
| a signed-in insert cannot be born a tombstone | authenticated holds TABLE-level INSERT on contacts (`schema-grants-guard.test.ts:87-90`, `insertDeleteAndUpdate`), so a column list cannot refuse it: as an Owner, `insert into public.contacts (account_id, first_name, merged_into, merged_at) values (A, 'Born', <another contact>, now()) returning merged_into, merged_at` answers both null | drop the guard's insert branch |
| a signed-in delete of a tombstone is refused | Owner `delete from public.contacts where id = <tombstone>`: 42501 | drop the guard's delete branch |
| server code is not limited | `set local role service_role`: updating a tombstone's `first_name` succeeds | refuse service_role too |
| `contact_merges` read | (select `id` only: the client holds SELECT on ten columns, and `select *` would refuse 42501 for the wrong reason) an Owner of A reads A's row, not B's; a Technician reads the row of a kept record assigned to them and not one that is not | policy `using (true)`; policy in the house shape `app.is_agency() or account_id = app.current_account_id()` (the Technician half FAILS) |
| blockers name `merges` | a live merge row (insert one as owner: every NOT NULL column, `undo_until = merged_at + interval '30 days'`) on keep K and other O, O a tombstone: `contact_delete_blockers(A, [K, O])` answers both with `{merges}`; set `undone_at`, `undone_by`: neither | drop the clause; drop `undone_at is null` |
| the 30-day window is pinned | inserting a row with `undo_until = merged_at + interval '7 days'` fails `contact_merges_window` (23514) | drop the check |

- [ ] **Step 5: Run it red on `pre`.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55761/pre pnpm exec vitest run src/test/contact-dedupe-schema.test.ts`. Expected: every case fails; the first line reads `column "name_key" does not exist` or `function app.phone_family(text) does not exist`. Paste one.

- [ ] **Step 6: Write 0106 part A.** Create `packages/db/supabase/migrations/0106_contact_merge.sql`. The header follows 0103's sections (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK, `MIG/0103_contact_archive.sql:1-121`). State in it:
  - GRANTS: the flag table loses table INSERT, UPDATE and DELETE for authenticated and keeps INSERT on four columns (`EXPECTED_WRITES` changes; the digest moves 52 → 49); `contact_merges` SELECT on ten columns to authenticated through its policy (review m8c), all four to service_role; no client grant on `merged_into`/`merged_at`; the three key functions EXECUTE for authenticated and service_role (correction 3), `app.phone_family` and `app.may_merge` service_role and the owner only; the list functions authenticated and service_role; dismiss and undismiss authenticated and service_role; anon executes nothing (the default ACL grants anon by name, so every revoke names it). Three definers join `EXPECTED_DEFINERS` (29 → 32).
  - LOCKS AND COST: the four contacts columns go in ONE `alter table`, so `contacts` is rewritten once under ACCESS EXCLUSIVE; paste T1 Step 8's 10,000-contact time. Production held 53 contacts and 0 flags on 2026-10-29. `lock_timeout` 5s bounds only the wait.
  - LOAD-BEARING: from T4 on, the app names `merged_into` in `COLS` and every list read.
  - ROLLBACK, in order (roll the app back first; undo every live merge first, see part B): drop the dismiss pair; drop the four list functions; drop `app.open_duplicate_pairs`, `app.may_merge`; drop trigger `contacts_flag_pairs` and its function; drop trigger `contacts_tombstone_server_only` and its function; restore 0103's `contact_delete_blockers` body and 0092's `ai_contact_held_by` body (with 0096's `search_path`); drop index `tasks_contact_id`; drop the four flag indexes, the flag columns and the check; recreate `contact_duplicate_flags_member_all` exactly as `MIG/0033:78-81` and `grant insert, update, delete on public.contact_duplicate_flags to authenticated`; drop table `contact_merges`; drop the contacts indexes, the FK, the two checks and the four columns; drop the four key functions.

```sql
-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The comparison keys. A stored generated column runs its function as the WRITING role (proven on PG18,
--    2026-10-29), so these keep EXECUTE for authenticated and service_role, and call no service-only helper.
create function app.phone_national(p_phone text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when y.k is null then null
           when y.k ~ '^[0-9]{10}$' then y.k
           when y.k ~ '^521[0-9]{10}$' or y.k ~ '^04[45][0-9]{10}$'
             or y.k ~ '^52[0-9]{10}$' or y.k ~ '^01[0-9]{10}$' then pg_catalog.right(y.k, 10)
           else y.k
         end
    from (select case
                   when pg_catalog.length(x.d) = 11 and pg_catalog.left(x.d, 1) = '1' then pg_catalog.substr(x.d, 2)
                   else nullif(x.d, '')
                 end as k
            from (select pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) as x) as y
$$;

create function app.phone_family(p_phone text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when y.k is null then null
           when y.k ~ '^[0-9]{10}$' then 'us'
           when y.k ~ '^521[0-9]{10}$' or y.k ~ '^04[45][0-9]{10}$'
             or y.k ~ '^52[0-9]{10}$' or y.k ~ '^01[0-9]{10}$' then 'mx'
           else null
         end
    from (select case
                   when pg_catalog.length(x.d) = 11 and pg_catalog.left(x.d, 1) = '1' then pg_catalog.substr(x.d, 2)
                   else nullif(x.d, '')
                 end as k
            from (select pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) as x) as y
$$;

-- No lower(): one translate maps A-Z, four separators, six whitespace characters and the 48 accented letters,
-- then everything outside [a-z0-9 ] is dropped. The answer cannot depend on the database's ctype.
create function app.contact_name_fold(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(pg_catalog.translate(coalesce(p, ''), f.src, f.dst), '[^a-z0-9 ]', '', 'g'),
             ' +', ' ', 'g'),
           ' ')
    from (select 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-.,''' || (
                   select pg_catalog.string_agg(pg_catalog.chr(t.c), '' order by t.o)
                     from pg_catalog.unnest(array[9, 10, 11, 12, 13, 160,
                       192, 193, 194, 195, 196, 199, 200, 201, 202, 203, 204, 205, 206, 207, 209, 210, 211, 212, 213, 214, 217, 218, 219, 220,
                       224, 225, 226, 227, 228, 231, 232, 233, 234, 235, 236, 237, 238, 239, 241, 242, 243, 244, 245, 246, 249, 250, 251, 252])
                     with ordinality as t(c, o)) as src,
                 'abcdefghijklmnopqrstuvwxyz' || '    ' || '      '
                   || 'aaaaaceeeeiiiinooooouuuu' || 'aaaaaceeeeiiiinooooouuuu' as dst) as f
$$;

create function app.contact_name_key(p_first text, p_last text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when n.first = '' or n.first = any (array['caller', 'unknown', 'desconocido', 'cliente', 'customer', 'na', 'none', 'sin nombre'])
             or n.surname is null or n.surname = '' then null
           else n.first || '|' || n.surname
         end
    from (select app.contact_name_fold(p_first) as first,
                 pg_catalog.substring(app.contact_name_fold(p_last), '^(((de|del|la|las|los|y|san|santa) )*[a-z0-9]+)') as surname) as n
$$;

revoke all on function app.phone_national(text) from public, anon;
revoke all on function app.contact_name_fold(text) from public, anon;
revoke all on function app.contact_name_key(text, text) from public, anon;
grant execute on function app.phone_national(text) to authenticated, service_role;
grant execute on function app.contact_name_fold(text) to authenticated, service_role;
grant execute on function app.contact_name_key(text, text) to authenticated, service_role;
revoke all on function app.phone_family(text) from public, anon, authenticated;
grant execute on function app.phone_family(text) to service_role;

-- 2. The pointer and the keys, in ONE alter table: contacts is rewritten once.
alter table public.contacts
  add column merged_into uuid,
  add column merged_at timestamptz,
  add column phone_national text generated always as (app.phone_national(phone)) stored,
  add column name_key text generated always as (app.contact_name_key(first_name, last_name)) stored;
alter table public.contacts
  add constraint contacts_merged_pair check ((merged_into is null) = (merged_at is null)),
  add constraint contacts_not_merged_into_self check (merged_into is distinct from id),
  -- NO ACTION: a kept record with tombstones pointing at it cannot vanish under them.
  add constraint contacts_merged_into_fkey foreign key (account_id, merged_into) references public.contacts (account_id, id);
create index contacts_account_merged_into on public.contacts (account_id, merged_into) where merged_into is not null;
create index contacts_account_phone_national on public.contacts (account_id, phone_national) where phone_national is not null;
create index contacts_account_name_key on public.contacts (account_id, name_key) where name_key is not null;

-- 3. A tombstone is server code's alone (0098's contacts_holding_server_only shape: plain, not definer). For a signed-in
--    session: an insert is never born a tombstone; a tombstone is never updated or deleted; the pointer never changes.
create function app.contacts_tombstone_server_only() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.merged_into := null;
      new.merged_at := null;
      return new;
    end if;
    if old.merged_into is not null then
      raise exception 'A merged record is changed by server code only' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    new.merged_into := old.merged_into;
    new.merged_at := old.merged_at;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke all on function app.contacts_tombstone_server_only() from public, anon;
create trigger contacts_tombstone_server_only before insert or update or delete on public.contacts
  for each row execute function app.contacts_tombstone_server_only();

-- 4. The merge log (spec 4.2; corrections 7, 9, 15).
create table public.contact_merges (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  keep_id uuid not null,
  other_id uuid not null,
  merged_by text not null,
  merged_at timestamptz not null default pg_catalog.now(),
  undo_until timestamptz not null,
  keep_before jsonb not null,
  keep_after jsonb not null,
  choices jsonb not null,
  moved jsonb not null,
  moved_counts jsonb not null,
  removed jsonb not null,
  unread_handed integer not null default 0,
  other_reply_token text,
  undone_at timestamptz,
  undone_by text,
  constraint contact_merges_undone_pair check ((undone_at is null) = (undone_by is null)),
  constraint contact_merges_two check (keep_id <> other_id),
  constraint contact_merges_window check (undo_until = merged_at + interval '30 days'),
  constraint contact_merges_keep_fkey foreign key (account_id, keep_id) references public.contacts (account_id, id) on delete cascade,
  constraint contact_merges_other_fkey foreign key (account_id, other_id) references public.contacts (account_id, id) on delete cascade
);
create index contact_merges_keep on public.contact_merges (account_id, keep_id, merged_at desc, id desc);
create index contact_merges_other on public.contact_merges (account_id, other_id);
create unique index contact_merges_reply_token on public.contact_merges (other_reply_token)
  where other_reply_token is not null and undone_at is null;
alter table public.contact_merges enable row level security;
revoke all on public.contact_merges from anon, authenticated;
-- Ten columns only (plan review m8c): the policy below admits a Technician to the merges of a kept record assigned to
-- them, and the snapshots (removed, moved, keep_before, keep_after, choices) and other_reply_token are not theirs to
-- read. These are exactly the columns the timeline selects (Task 9).
grant select (id, account_id, keep_id, other_id, merged_by, merged_at, undo_until, moved_counts, undone_at, undone_by)
  on public.contact_merges to authenticated;
grant select, insert, update, delete on public.contact_merges to service_role;
-- Through the kept record, so contacts' own policies (0068's Technician fence included) decide (0103's log shape).
create policy contact_merges_read on public.contact_merges for select to authenticated
  using (exists (select 1 from public.contacts c where c.account_id = contact_merges.account_id and c.id = contact_merges.keep_id));

-- 5. The pair queue gains a decision and an order.
alter table public.contact_duplicate_flags
  add column dismissed_at timestamptz,
  add column dismissed_by text,
  add column merge_id bigint references public.contact_merges (id) on delete set null,
  add column strength smallint generated always as (case reason
    when 'same_phone' then 1 when 'same_email' then 2 when 'email_phone_conflict' then 3
    when 'same_digits' then 4 when 'phone_country_twin' then 4 when 'phone_shared_new_person' then 5
    when 'hidden_match' then 6 when 'phone_match_on_edit' then 7 when 'email_match_on_edit' then 7
    when 'phone_country_pick' then 7 when 'same_name' then 9 else 8 end) stored;
alter table public.contact_duplicate_flags
  add constraint contact_duplicate_flags_dismissed_pair check ((dismissed_at is null) = (dismissed_by is null));
create index contact_duplicate_flags_open on public.contact_duplicate_flags (account_id, strength, created_at desc, id desc)
  where dismissed_at is null and merge_id is null;
-- Correction 1: the pair index leads on account_id, so neither contact column had an index of its own.
create index contact_duplicate_flags_a on public.contact_duplicate_flags (contact_a);
create index contact_duplicate_flags_b on public.contact_duplicate_flags (contact_b);
create index contact_duplicate_flags_merge on public.contact_duplicate_flags (merge_id) where merge_id is not null;
create index tasks_contact_id on public.tasks (contact_id) where contact_id is not null;

-- Correction 2: the client keeps INSERT on four columns (the TypeScript writers); dismissal and merge_id are written
-- only by the definers below. 0068's restrictive Technician policy stays as it is.
drop policy contact_duplicate_flags_member_all on public.contact_duplicate_flags;
create policy contact_duplicate_flags_member_read on public.contact_duplicate_flags for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy contact_duplicate_flags_member_insert on public.contact_duplicate_flags for insert to authenticated
  with check (app.is_agency() or account_id = app.current_account_id());
revoke all on public.contact_duplicate_flags from anon, authenticated;
grant select on public.contact_duplicate_flags to authenticated;
grant insert (account_id, contact_a, contact_b, reason) on public.contact_duplicate_flags to authenticated;

-- 6. The database files every pair (spec 3.5). DEFINER: a Technician's own client cannot see a contact outside their
--    assignment (0068), and a pair it cannot see must still be queued. Strongest reason first; on conflict do nothing
--    keeps the first reason AND a dismissal. At most 20 matches per key per write.
create function app.contacts_flag_pairs() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.phone_national is not distinct from new.phone_national
     and old.email_key is not distinct from new.email_key and old.name_key is not distinct from new.name_key then
    return null;
  end if;
  if new.phone_national is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id),
           case when app.phone_family(new.phone) is not distinct from app.phone_family(m.phone) then 'same_phone' else 'same_digits' end
      from (select c.id, c.phone from public.contacts c
             where c.account_id = new.account_id and c.phone_national = new.phone_national and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  if new.email_key is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id), 'same_email'
      from (select c.id from public.contacts c
             where c.account_id = new.account_id and c.email_key = new.email_key and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  if new.name_key is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id), 'same_name'
      from (select c.id from public.contacts c
             where c.account_id = new.account_id and c.name_key = new.name_key and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  return null;
end $$;
revoke all on function app.contacts_flag_pairs() from public, anon, authenticated;
create trigger contacts_flag_pairs after insert or update of phone, email, first_name, last_name on public.contacts
  for each row when (new.merged_into is null and not new.holds_shared_number)
  execute function app.contacts_flag_pairs();

-- 7. The backfill, once: phone, then email, then name, so the strongest reason stands.
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id,
       case when app.phone_family(a.phone) is not distinct from app.phone_family(b.phone) then 'same_phone' else 'same_digits' end
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.phone_national = a.phone_national and a.id < b.id
 where a.phone_national is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id, 'same_email'
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.email_key = a.email_key and a.id < b.id
 where a.email_key is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id, 'same_name'
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.name_key = a.name_key and a.id < b.id
 where a.name_key is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;

-- 8. The one who-check (correction 20; 0103's shape, both coalesces: current_account_id() is NULL when client access
--    is off, and without them IF NOT (NULL) never raises).
create function app.may_merge(p_account_id uuid) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(
           coalesce(app.jwt() ->> 'role', '') = 'service_role'
           or coalesce(app.is_agency(), false)
           or (coalesce(p_account_id = app.current_account_id(), false)
               and coalesce(app.sees_all_customers(p_account_id), false)),
           false)
$$;
revoke all on function app.may_merge(uuid) from public, anon, authenticated, service_role;

-- 9. The open pairs, with the read-time filters (spec 6.2; correction 14). INVOKER: the caller's RLS decides, so a
--    Technician reads nothing (0068's restrictive policy). Rows and total share this one function. The contact
--    filter, the cursor and the limit are its OWN parameters (plan review m5): a function that sets search_path is
--    never inlined, so a filter its caller applied would run only after every open pair of the account was read.
create function app.open_duplicate_pairs(
  p_account_id uuid, p_contact_id uuid default null, p_after_strength smallint default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null, p_limit integer default null)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select f.id, f.contact_a, f.contact_b, f.reason, f.strength, f.created_at, a.first_name, a.last_name, b.first_name, b.last_name
    from public.contact_duplicate_flags f
    join public.contacts a on a.account_id = f.account_id and a.id = f.contact_a
    join public.contacts b on b.account_id = f.account_id and b.id = f.contact_b
   where f.account_id = p_account_id
     and f.dismissed_at is null and f.merge_id is null
     and (p_contact_id is null or f.contact_a = p_contact_id or f.contact_b = p_contact_id)
     and (p_after_id is null
          or f.strength > p_after_strength
          or (f.strength = p_after_strength
              and (f.created_at < p_after_created_at or (f.created_at = p_after_created_at and f.id < p_after_id))))
     and a.merged_into is null and b.merged_into is null
     and not a.holds_shared_number and not b.holds_shared_number
     and not exists (
       select 1 from public.contact_relationships r
        where r.account_id = f.account_id
          and ((r.contact_id = f.contact_a and r.related_contact_id = f.contact_b)
            or (r.contact_id = f.contact_b and r.related_contact_id = f.contact_a)))
     and not (f.reason in ('same_phone', 'same_digits', 'phone_country_twin', 'phone_shared_new_person', 'phone_match_on_edit', 'phone_country_pick')
              and exists (
                select 1 from public.client_group_members ma
                  join public.client_group_members mb on mb.account_id = ma.account_id and mb.client_group_id = ma.client_group_id
                  join public.client_groups g on g.account_id = ma.account_id and g.id = ma.client_group_id
                 where ma.account_id = f.account_id and ma.contact_id = f.contact_a
                   and mb.contact_id = f.contact_b and g.kind = 'household'))
   order by f.strength asc, f.created_at desc, f.id desc
   limit p_limit
$$;

create function public.duplicate_pairs_page(
  p_account_id uuid, p_limit integer, p_after_strength smallint default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select * from app.open_duplicate_pairs(p_account_id, null, p_after_strength, p_after_created_at, p_after_id,
                                         least(greatest(coalesce(p_limit, 50), 1), 101))
$$;

create function public.duplicate_pairs_count(p_account_id uuid) returns integer
language sql stable set search_path = pg_catalog, pg_temp as $$
  select pg_catalog.count(*)::integer from app.open_duplicate_pairs(p_account_id)
$$;

create function public.duplicate_pairs_of(p_account_id uuid, p_contact_id uuid)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select * from app.open_duplicate_pairs(p_account_id, p_contact_id, null, null, null, 20)
$$;

revoke all on function app.open_duplicate_pairs(uuid, uuid, smallint, timestamptz, uuid, integer) from public, anon;
grant execute on function app.open_duplicate_pairs(uuid, uuid, smallint, timestamptz, uuid, integer) to authenticated, service_role;
revoke all on function public.duplicate_pairs_page(uuid, integer, smallint, timestamptz, uuid) from public, anon;
grant execute on function public.duplicate_pairs_page(uuid, integer, smallint, timestamptz, uuid) to authenticated, service_role;
revoke all on function public.duplicate_pairs_count(uuid) from public, anon;
grant execute on function public.duplicate_pairs_count(uuid) to authenticated, service_role;
revoke all on function public.duplicate_pairs_of(uuid, uuid) from public, anon;
grant execute on function public.duplicate_pairs_of(uuid, uuid) to authenticated, service_role;

-- 10. "Not the same person" (D11): never suggested again, with Undo. Definers: the client holds no UPDATE here.
create function public.dismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_actor text;
begin
  if not app.may_merge(p_account_id) then
    raise exception 'dismiss_duplicate_pair: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  v_actor := case when coalesce(app.jwt() ->> 'role', '') = 'service_role' then nullif(p_actor, '')
                  else nullif(app.jwt() ->> 'sub', '') end;
  if v_actor is null then
    raise exception 'dismiss_duplicate_pair: no actor' using errcode = '22023';
  end if;
  update public.contact_duplicate_flags f set dismissed_at = pg_catalog.now(), dismissed_by = v_actor
   where f.account_id = p_account_id and f.id = p_flag_id and f.dismissed_at is null and f.merge_id is null
  returning f.id into v_id;
  return pg_catalog.jsonb_build_object('status', case when v_id is null then 'not_found' else 'dismissed' end);
end $$;

create function public.undismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.may_merge(p_account_id) then
    raise exception 'undismiss_duplicate_pair: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  update public.contact_duplicate_flags f set dismissed_at = null, dismissed_by = null
   where f.account_id = p_account_id and f.id = p_flag_id and f.dismissed_at is not null
  returning f.id into v_id;
  return pg_catalog.jsonb_build_object('status', case when v_id is null then 'not_found' else 'restored' end);
end $$;
revoke all on function public.dismiss_duplicate_pair(uuid, uuid, text) from public, anon;
grant execute on function public.dismiss_duplicate_pair(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.undismiss_duplicate_pair(uuid, uuid, text) from public, anon;
grant execute on function public.undismiss_duplicate_pair(uuid, uuid, text) to authenticated, service_role;
```

  - **Section 11, `contact_delete_blockers`:** `create or replace` with 0103's body EXACTLY (`MIG/0103_contact_archive.sql:243-283`, read it; same signature, `stable security definer set search_path = pg_catalog, pg_temp`) plus one more `union all` after `'deals'`:
    ```sql
            union all select 'merges' where exists (
              select 1 from public.contact_merges x
               where x.account_id = p_account_id and (x.keep_id = k.id or x.other_id = k.id) and x.undone_at is null)
    ```
    `create or replace` keeps 0103's grants; do not re-grant.
  - **Section 12, `ai_contact_held_by`:** `create or replace` with 0092's body EXACTLY (`MIG/0092_ai_contact_held_by_voice_log.sql`, the whole function), its `set search_path` written as `pg_catalog, pg_temp` (0096 moved it there; `ai-acts-schema.test.ts:957-962` pins that proconfig), plus, directly before "The backstop" block:
    ```sql
      -- 0106: a contact that is part of a merge (either side, not undone) is a person's decision, never hers to remove.
      if exists (select 1 from public.contact_merges x
                  where x.account_id = p_account_id and (x.keep_id = v_contact or x.other_id = v_contact) and x.undone_at is null) then
        v_held := v_held || 'contact_merges'::text;
      end if;
    ```
  - **Section 13, comments:** one `comment on` each for `contacts.merged_into`, `contacts.phone_national`, `contacts.name_key`, `contact_merges`, `contact_duplicate_flags.strength`, naming its one writer (0098 section 6's form).

Grep the file before applying: `grep -n "agency_visit\|access_log_page\|note_agency_open" packages/db/supabase/migrations/0106_contact_merge.sql` answers nothing; and a node byte check (memory `bis-local-db-replica`: Git Bash `grep -P` cannot run it) confirms ASCII only and no backslash: `node -e "const s=require('fs').readFileSync('packages/db/supabase/migrations/0106_contact_merge.sql');let bad=0;for(const b of s)if(b>127||b===92)bad++;console.log('non-ascii-or-backslash bytes:',bad)"` answers `0`. Paste both.

- [ ] **Step 7: Apply to `post` and run green.** `sh pg17-dm.sh post`, then Step 5's command against `/post`. Expected: all pass. Paste the summary line.
- [ ] **Step 8: The backfill and the cost.** In a copy `create database bf template pre`: insert as `postgres` one account and five contacts: `{Ana, Ruiz, +19565550201}`, `{Ana, Ruiz, +529565550201}`, `{Beto, Paz, email beto@x.mx}`, `{Roberto, Paz, email BETO@x.mx}`, `{Luis, Mar, +19565550299}`. Apply 0106 with `psql -1 -f`. Then `select reason, count(*) from public.contact_duplicate_flags group by 1 order by 1`. Expected exactly `same_digits 1`, `same_email 1` (Ana/Ana is a `same_name` too, but `same_digits` was written first). Comment out the phone backfill insert, rebuild `bf`, re-run: `same_name 1`, `same_email 1`. Paste both outputs. Then `sh pg17-dm.sh rw` and paste the apply time into the header's LOCKS AND COST. Then, in `rw` after the apply, file 2,000 open pairs (`update public.contacts set phone = '+19565550001' where … limit 2000` across pairs of rows, or direct flag inserts as owner) and paste `explain (analyze, buffers)` of `select * from public.duplicate_pairs_of(<account>, <a contact with pairs>)`, `… duplicate_pairs_page(<account>, 51)` and `… duplicate_pairs_count(<account>)` (review m5: the reviewer measured 515 ms at 20,000 contacts before the filters moved inside). `duplicate_pairs_of` and the page must read `contact_duplicate_flags` through `contact_duplicate_flags_a`/`_b` or `_open`, never a sequential scan; if the `p_contact_id is null or …` disjunction keeps the contact filter off the indexes on PG17, rewrite that term as `f.id in (select x.id from public.contact_duplicate_flags x where x.account_id = p_account_id and x.contact_a = p_contact_id union all select x.id from … x.contact_b = p_contact_id)` guarded by `p_contact_id is null or`, re-measure, and say so in your report.
- [ ] **Step 9: The pinned lists.** Edit, run each file on `post` (green) and on `pre` (red where noted), paste each red line:
  - `definer-search-path.test.ts`: add, in sorted position, `"app.contacts_flag_pairs()": PG_CATALOG_PG_TEMP`, `"public.dismiss_duplicate_pair(uuid,uuid,text)": PG_CATALOG_PG_TEMP`, `"public.undismiss_duplicate_pair(uuid,uuid,text)": PG_CATALOG_PG_TEMP`; the comment at `:25` becomes "The 32 SECURITY DEFINER functions in public and app at 0106 part A (0103's 29, 0104 and 0105 add none, 0106 part A adds three)"; the `it` name at `:70` and `toHaveLength` at `:75` say 32, `:84` `toBeGreaterThanOrEqual(32)`. Red on `pre`: `expected [ …29 rows… ] to have a length of 32`; paste the line vitest prints.
  - `schema-grants-guard.test.ts:79`: `"authenticated contact_duplicate_flags": ["INSERT(account_id)", "INSERT(contact_a)", "INSERT(contact_b)", "INSERT(reason)"],` with the comment `// 0106 (F-006): writes left with the two definers; the four-column insert stays for the TypeScript writers.`
  - `proposals-drop.test.ts:98`: run the digest query on `pre` FIRST and confirm `52|b66203ca5d355155540b520af510d120` (the replica is faithful); then read it on `post` and pin that value (expected count 49). Add to the comment above it: "0106 (F-006) removes authenticated's table INSERT, UPDATE and DELETE on contact_duplicate_flags (column INSERT stays, which this digest does not count): 52 → 49, read on a PG17 replica of 0001-0106; the orchestrator re-reads it on bis-ci after apply."
  - `ai-acts-schema.test.ts`: `FK_PAIRS` gains `"contacts contacts_merged_into_fkey"`, `"contact_merges contact_merges_keep_fkey"`, `"contact_merges contact_merges_other_fkey"`; the name at `:849` says 26, `toHaveLength(26)`; `FK_TABLES` gains `"contacts"` and `"contact_merges"` (23; the comment says 23). BLOCKERS gains one row: `["a merge naming the contact, not undone", "contact_merges", (c, s, z) => <insert a contact_merges row as owner with keep_id = z.z, other_id = a second contact of s.acct, every NOT NULL column, undo_until = merged_at + interval '30 days'>]`. The exempt list at `:693` gains `"contacts"` with the comment "contacts (0106): the merged_into pointer is always written with a contact_merges row, which the contact_merges clause reads". Red on pre: the FK guard's diff.
  - `contact-archive-schema.test.ts:643`: `expect(rows.map((r) => r.fk)).toEqual([]);` and the comment above it: "0106 (F-006) indexed contact_duplicate_flags.contact_a and .contact_b and tasks.contact_id: none is left." Rename the `it` to drop "except three older ones named here". Red on pre: the three names.
  - `account-teardown.ts:41-42`: `// 0106: the merge log, before contacts (it cascades with its contacts too; flags.merge_id is set null).` then `"contact_merges", "contact_archive_log", "contacts",`.
- [ ] **Step 10: Mutation probes (the reviewer runs each; paste the red line BY NAME).** Apply each to `post` with `create or replace function` (or `drop trigger`, `grant`, `drop policy`), run the WHOLE named file (never one `-t` filter), then rebuild `post` from `pre`:

| Change | Test that must go red |
|---|---|
| `app.contact_name_fold`: drop `209` and `241` from the array AND the `n` from both target strings | the Muñoz parity rows |
| `app.phone_national`: drop `or y.k ~ '^521[0-9]{10}$'` | the `+52 1` and `+5218999221234` parity rows; "legacy +52 1 is the same phone" |
| `app.contact_name_key`: `n.first = any(array[...])` removed | "placeholders never pair" |
| key on the whole folded last name (`app.contact_name_fold(p_last)` in place of the substring) | "same name, two surnames" |
| `revoke execute on function app.contact_name_key(text, text) from authenticated` | "a signed-in Owner's insert and edit succeed" (42501) |
| trigger: `'same_phone'` in place of the family case | "a +1 and a +52 of one ten digits" |
| trigger function without `security definer` | "a Technician's insert queues a pair" |
| trigger: `do update set dismissed_at = null, dismissed_by = null` | "a dismissal sticks" |
| trigger: drop `and not c.holds_shared_number` | "a holding record never pairs" |
| trigger: drop `and c.merged_into is null` | "a tombstone never pairs" |
| trigger: drop `limit 20` (all three) | "at most 20 per write" |
| `open_duplicate_pairs`: drop the household `and not (…)` | "household members on one phone are hidden" |
| `open_duplicate_pairs`: household filter applied to every reason | the same case's email half |
| `open_duplicate_pairs`: drop the relationship `not exists` | "a relationship hides a pair" |
| `app.open_duplicate_pairs`: drop `f.id < p_after_id` (keep the rest) | "rows and total agree across a page boundary" |
| `app.open_duplicate_pairs`: order by `f.created_at desc, f.id desc` only | "phone before name" |
| `app.may_merge`: drop the `sees_all_customers` term | dismiss "who" (the Technician half) |
| `app.may_merge`: drop BOTH the inner coalesce on the account term and the outer one | dismiss "who" (client access off); either alone still refuses |
| `app.may_merge`: drop `coalesce(p_account_id = app.current_account_id(), false) and` | dismiss "who" (the Owner of A whose token names org B; review m4) |
| `app.open_duplicate_pairs`: drop the `p_contact_id` term | "`duplicate_pairs_of`" |
| `drop policy contact_duplicate_flags_member_insert` | "an Owner's four-column insert still works through RLS" |
| `grant update (dismissed_at) on public.contact_duplicate_flags to authenticated` | "authenticated may insert the flag table's four columns" |
| tombstone guard: delete the `old.merged_into is not null` raise | "a signed-in update of a tombstone is refused" and "… delete …" |
| `contact_merges_read` policy `using (app.is_agency() or account_id = app.current_account_id())` | "`contact_merges` read" (Technician half) |
| blockers: drop `and x.undone_at is null` | "blockers name `merges`" (the undone half) |
| `ai_contact_held_by`: drop the new clause | the `contact_merges` BLOCKERS row in `ai-acts-schema.test.ts` |
| drop index `tasks_contact_id` | the index guard in `contact-archive-schema.test.ts`, naming `tasks.contact_id` |

- [ ] **Step 11: Commit.**

```bash
P="packages/db/supabase/migrations/0106_contact_merge.sql packages/db/src/dedupe-keys.ts packages/db/src/dedupe-keys.test.ts packages/db/package.json packages/db/src/index.ts packages/db/src/test/contact-dedupe-schema.test.ts packages/db/src/test/definer-search-path.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/proposals-drop.test.ts packages/db/src/test/ai-acts-schema.test.ts packages/db/src/test/contact-archive-schema.test.ts packages/db/src/account-teardown.ts"
git add $P
git commit -m "feat(db): 0106 part A: phone and name keys with their twins, the database files every duplicate pair, dismissals, the merge log and the tombstone guard" -- $P
```

---

### Task 2: Every new string, English and Spanish

**Tier:** low · **Owner:** bis-crm · **Wave:** 1

**Files:** Modify `apps/web/src/lib/messages.ts` (the `contacts.*` block after `contacts.archived.*` at `:5247`, `work.*` after `work.row.*` at `:3881`, `timeline.*` after `timeline.what.archive` at `:5565`) and `apps/web/src/lib/messages.test.ts` (a new `describe` after the archive block at `:2305-2440`).

**Interfaces:** Produces these keys. Every key has its `.es` twin on the next line. A `{count}` key has a `One` twin picked by `plural()`.

| Key | English | Spanish |
|---|---|---|
| `contacts.duplicates.title` | Possible duplicates | Posibles duplicados |
| `contacts.duplicates.link` | Possible duplicates | Posibles duplicados |
| `contacts.duplicates.count` / `countOne` | {count} possible duplicates / 1 possible duplicate | {count} posibles duplicados / 1 posible duplicado |
| `contacts.duplicates.banner` | May be the same person as {name} · {reason} | Puede ser la misma persona que {name} · {reason} |
| `contacts.duplicates.bannerMore` / `bannerMoreOne` | and {count} more / and 1 more | y {count} más / y 1 más |
| `contacts.duplicates.compare` | Compare | Comparar |
| `contacts.duplicates.reason.samePhone` | same phone number | mismo número de teléfono |
| `contacts.duplicates.reason.sameDigits` | same phone digits, saved as a US and a Mexican number | mismos dígitos, guardados como número de EE. UU. y de México |
| `contacts.duplicates.reason.sameEmail` | same email | mismo correo |
| `contacts.duplicates.reason.sameName` | same name | mismo nombre |
| `contacts.duplicates.reason.other` | found when a record was saved | se detectó al guardar un registro |
| `contacts.duplicates.foundOn` | Found {date} | Detectado el {date} |
| `contacts.duplicates.emptyTitle` | No possible duplicates | No hay posibles duplicados |
| `contacts.duplicates.emptyBody` | When two records look like the same customer (same phone, email or name), they show up here so you can merge them. | Cuando dos registros parecen ser el mismo cliente (mismo teléfono, correo o nombre), aparecen aquí para que los una. |
| `contacts.duplicates.listFailed` | Couldn't load possible duplicates. Try again. | No se pudieron cargar los posibles duplicados. Intente de nuevo. |
| `contacts.duplicates.notSame` | Not the same person | No es la misma persona |
| `contacts.duplicates.dismissed` | Got it. We won't suggest these two again. | Entendido. No volveremos a sugerir estos dos. |
| `contacts.duplicates.dismissFailed` | Couldn't save that. Nothing changed. Try again. | No se pudo guardar. No cambió nada. Intente de nuevo. |
| `contacts.duplicates.next` | Next | Siguiente |
| `contacts.duplicates.first` | Back to the start | Volver al principio |
| `work.duplicates` / `duplicatesOne` | {count} possible duplicate customers to check / 1 possible duplicate customer to check | {count} posibles clientes duplicados por revisar / 1 posible cliente duplicado por revisar |
| `contacts.merge.title` | Merge two records | Unir dos registros |
| `contacts.merge.keep` | Keep this one | Conservar este |
| `contacts.merge.swap` | Keep this one instead | Mejor conservar este |
| `contacts.merge.joins` | Joins the one you keep | Se une al que conserva |
| `contacts.merge.pick` | The two records don't agree on the {field}. Which one do we keep? | Los dos registros no coinciden en {field}. ¿Cuál conservamos? |
| `contacts.merge.field.firstName` | first name | el nombre |
| `contacts.merge.field.lastName` | last name | el apellido |
| `contacts.merge.field.email` | email | el correo |
| `contacts.merge.field.phone` | phone number | el teléfono |
| `contacts.merge.field.assignedTo` | person it's assigned to | la persona asignada |
| `contacts.merge.field.language` | language | el idioma |
| `contacts.merge.field.custom` | “{label}” field | campo “{label}” |
| `contacts.merge.alsoKeeps` | Also keeps: {list} | También conserva: {list} |
| `contacts.merge.otherNumber` | Calls and texts from {phone} will still reach {name}. | Las llamadas y los mensajes de {phone} seguirán llegando a {name}. |
| `contacts.merge.otherEmail` | Email from {email} will still reach {name}. | Los correos de {email} seguirán llegando a {name}. |
| `contacts.merge.moves` | Moves to {name}: {list} | Pasan a {name}: {list} |
| `contacts.merge.nothingMoves` | {name} has no history to move. | {name} no tiene historial que pasar. |
| `contacts.merge.count.messages` / `One` | {count} messages / 1 message | {count} mensajes / 1 mensaje |
| `contacts.merge.count.calls` / `One` | {count} calls / 1 call | {count} llamadas / 1 llamada |
| `contacts.merge.count.bookings` / `One` | {count} appointments / 1 appointment | {count} citas / 1 cita |
| `contacts.merge.count.documents` / `One` | {count} files / 1 file | {count} archivos / 1 archivo |
| `contacts.merge.count.opportunities` / `One` | {count} deals / 1 deal | {count} oportunidades / 1 oportunidad |
| `contacts.merge.count.notes` / `One` | {count} notes / 1 note | {count} notas / 1 nota |
| `contacts.merge.count.tasks` / `One` | {count} to-dos / 1 to-do | {count} pendientes / 1 pendiente |
| `contacts.merge.count.form_submissions` / `One` | {count} form answers / 1 form answer | {count} respuestas de formulario / 1 respuesta de formulario |
| `contacts.merge.action` | Merge | Unir |
| `contacts.merge.done` | Merged into {name} | Se unió con {name} |
| `contacts.merge.stale` | One of these records changed while you were looking. Here it is again with the new details. | Uno de estos registros cambió mientras lo revisaba. Aquí está de nuevo con los datos nuevos. |
| `contacts.merge.failed` | Couldn't merge. Nothing changed. Try again. | No se pudo unir. No cambió nada. Intente de nuevo. |
| `contacts.merge.loadFailed` | Couldn't load these two records. Try again. | No se pudieron cargar estos dos registros. Intente de nuevo. |
| `contacts.merge.undone` | Merge undone. {name} is back as their own record. | Se deshizo la unión. {name} volvió a tener su propio registro. |
| `contacts.merge.undoneKept` / `One` | {count} things that arrived after the merge stay with {name}. / 1 thing that arrived after the merge stays with {name}. | {count} cosas que llegaron después de la unión se quedan con {name}. / 1 cosa que llegó después de la unión se queda con {name}. |
| `contacts.merge.undoneEdits` | Kept what was changed after the merge: {list}. | Se conservó lo que se cambió después de la unión: {list}. |
| `contacts.merge.undoExpired` | This merge is more than 30 days old and can't be undone. | Esta unión tiene más de 30 días y ya no se puede deshacer. |
| `contacts.merge.undoLater` | This merge can't be undone yet: {name} was merged again since. Undo the newer merge first. | Esta unión todavía no se puede deshacer: {name} se volvió a unir después. Deshaga primero la unión más reciente. |
| `contacts.merge.undoFailed` | Couldn't undo the merge. Nothing changed. Try again. | No se pudo deshacer la unión. No cambió nada. Intente de nuevo. |
| `timeline.merged` | merged {name} into this record: {list} moved here | unió a {name} con este registro: {list} pasaron aquí |
| `timeline.mergedEmpty` | merged {name} into this record | unió a {name} con este registro |
| `timeline.mergeUndone` | undid the merge with {name} | deshizo la unión con {name} |
| `timeline.undoMerge` | Undo merge | Deshacer unión |
| `timeline.mergeOtherHidden` | another record | otro registro |
| `timeline.what.merge` | merge history | historial de uniones |

The timeline verbs are lower-case because the row draws "{mark} {verb}" (`timeline.archived`, `messages.ts:5549`).

- [ ] **Step 1: Failing test.** Add `describe("duplicates and merge copy, English and Spanish (F-006 plan Task 2)")` to `messages.test.ts` in the archive block's shape (`:2305-2440`): a `WANT` record holding every row above (both languages, both `One` twins), "has every key with exactly this text", "every English key has its .es twin on the very next line", and the usted/placeholder check the archive block carries. Add: no `WANT` value contains "survivor", "loser", "→", "{{" or "Undo" inside a sentence (the action is `common.undo`).
- [ ] **Step 2: Run red:** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n`. Expected `contacts.duplicates.title: expected undefined to be 'Possible duplicates'`. Paste it.
- [ ] **Step 3: Add the keys**, each English key followed by its `.es` line.
- [ ] **Step 4: Run green**, including `src/lib/i18n` (the accents guard, the ratchet and catalogue parity pass with NO baseline change). Paste the summary line.
- [ ] **Step 5: Mutation:** move one `.es` line out of position → "the .es twin on the very next line" fails; write "Une" into `contacts.merge.action.es` → "exactly this text" fails naming it.
- [ ] **Step 6: Commit:** `git commit -m "feat(contacts): duplicates and merge copy, English and Spanish" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

### Task 3: 0106 part B: the merge, its Undo, the preview and the backstop

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 2 (after T1 is committed on the branch)

**Files:**
- Modify: `packages/db/supabase/migrations/0106_contact_merge.sql` (append sections 14–19; extend the header's WHAT, GRANTS, ROLLBACK)
- Create: `packages/db/src/test/contact-merge-schema.test.ts`
- Modify: `packages/db/src/test/definer-search-path.test.ts` (32 → 36)

**Interfaces:** Consumes T1's objects. Produces `merge_contacts`, `undo_contact_merge`, `contact_merge_preview` and the `follow_merge` triggers with the signatures and answers in "Shared facts".

- [ ] **Step 1: The failing test.** Create `contact-merge-schema.test.ts`. Copy `seedAccount`, `refusal` and T1's `person` and `tombstone` helpers (T1's file; files stay disjoint). Add:

```ts
/** The fingerprints the compare screen sends back: contact_merge_preview's own `seen` (review m3). As owner: the
 *  preview is an invoker function and the owner role bypasses RLS. */
async function seenOf(c: Client, a: Acct, keep: string, other: string): Promise<{ keep: string; other: string }> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query("select public.contact_merge_preview($1, $2, $3) -> 'seen' as s", [a.accountId, keep, other]);
  return r.s;
}
/** As an Owner of the account: the app's path (the request client). `seen` defaults to a fresh preview. */
async function merge(c: Client, a: Acct, keep: string, other: string, choices: Record<string, string> = {},
                     seen?: { keep: string; other: string }) {
  seen ??= await seenOf(c, a, keep, other);
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query("select public.merge_contacts($1, $2, $3, $4::jsonb, $5::jsonb) as r",
    [a.accountId, keep, other, JSON.stringify(choices), JSON.stringify(seen)]);
  await actAsOwner(c);
  return r.r as { status: string; mergeId?: number; moved?: Record<string, number> };
}
async function undo(c: Client, a: Acct, mergeId: number) {
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query("select public.undo_contact_merge($1, $2) as r", [a.accountId, mergeId]);
  await actAsOwner(c);
  return r.r as { status: string; otherId?: string; keptNew?: number; keptEdits?: string[] };
}
```

`actAsMember` seeds a new users row per call (`db.ts:33-44`); that is fine inside one transaction. Each case seeds a keep K and an other O that share nothing but what the case needs.

**Moves, one `it.each` row per table** (spec 5.3). For each of `automation_log`, `bookings`, `calls`, `document_requests`, `documents`, `form_submissions`, `notes`, `opportunities`, `places`, `tasks`: seed ONE row on O (copy each minimal insert from the test file named: `contact-archive-schema.test.ts` for calls/forms/bookings/deals/documents/notes/tasks, `places.test.ts` for places, `document-requests*.test.ts` for document_requests, `automation-log-grants.test.ts` for automation_log; read each for its NOT NULL columns), merge K ← O, and assert the row's `contact_id` is K and its id is in `moved -> '<table>'` (read `select moved from public.contact_merges where id = $1` as owner). Name each `it` `"<table> moves to the kept record and is recorded (mutation: drop '<table>' from c_moves -> FAILS)"`.

**Conflict rows**, each in full:

| Case | Seed | Assertion | Mutation |
|---|---|---|---|
| a tag both had | one tag on K and O, a second only on O | the merge answers `merged` (the PK would refuse a blind move); O's shared tag row is in `removed.contact_tags`; K has both tags | drop the duplicate delete |
| a group both are in | a business group with K (is_billing false) and O (is_billing true, is_primary_contact true) | O's membership is in `removed`; K's membership has `is_billing` and `is_primary_contact` true; `moved.client_group_members_flags` holds K's prior flags | drop the flag OR |
| two primary groups | K primary in group G1; O primary in G2 | O's membership moved to K with `is_primary = false`; its id in `moved.client_group_members_unprimaried` | drop the unprimary step (the merge then fails `client_group_members_one_primary`) |
| a relationship between the two | a `sibling` row K–O | removed (it would be a self-row); in `removed.contact_relationships` | drop the self-row branch (`contact_relationships_not_self` fails the merge) |
| a relationship that repeats | K–X `sibling` and O–X `sibling` | O–X removed, K–X stays | drop the `unique_violation` handler |
| an active skip of one category | an active `insurance` skip on K and on O | O's removed | drop the handler |

**Rows that stay**: an `ai_acts` row, a `proposals` row and a `consent_events` row on O (seeds from `ai-acts-schema.test.ts:600-670`) still name O after the merge (mutation: add `ai_acts` to `c_moves` → the merge fails on `ai_acts_act_is_fixed`; the test asserts `merged` and the row on O).

**Threads**:

```ts
it("both threads: every message, call and inbound email ends on the kept thread, unread is the sum, the emptied thread is gone, its reply token recorded (mutation: skip the inbound_emails update -> the cascade deletes it, FAILS)", () =>
  withRollback(async (c) => {
    // Seed K and O each with a conversation (one per contact, 0005:24-25), O's with unread 2, a reply_token
    // ('aaaaaaaaaaaaaaaaaaaaaaaa', 24 hex: 0082's check) and: an sms message, a call with contact_id null and
    // conversation_id = O's thread, and an inbound_emails row (columns: recordInboundEmail, inbound-email.ts:155-178).
    // K's thread: unread 1, one message. Merge K <- O.
    // Assert: all three of O's rows are on K's thread; K's unread_count = 3; O's conversation id no longer exists;
    // contact_merges.other_reply_token = 'aaaaaaaaaaaaaaaaaaaaaaaa'; unread_handed = 2.
  }));
```

Write it in full, plus: "K has no thread: one is created and O's rows move to it" (assert `moved.conversation_created` is K's new thread id; mutation: re-point O's thread instead → `conversation_created` absent, FAILS) and "a revoked reply token is not recorded" (O's thread with `reply_token_revoked_at` set → `other_reply_token` null; mutation: record it regardless).

**Fields** (spec 5.2), each its own `it`:
- values come from the rows, not the client: K phone `+19565550301`, O phone `+19565550302`, `choices {phone: "other"}` → K's phone is O's, `phone_country_unconfirmed` O's (mutation: read the phone from `p_choices` → impossible; the realistic mutation is `case v_s_phone when 'other' then k.phone` → FAILS).
- a blank is filled from the other: K no email, O email → K has O's email, with no choice sent (mutation: `merge_side` without its blank branches).
- an unknown choice name or side is 22023 (`{"nickname":"keep"}`, `{"phone":"both"}`), through `refusal()`.
- language: staff beats a sign (K `es`/`call`, O `en`/`staff` → `en`); the earlier sign stands (K `es` call at T2, O `en` booking at T1 → `en`); a choice overrides (mutation: drop each branch in turn).
- custom: a key on one side only is kept; a key on both with different values takes `choices["custom.k"]`.
- marketing opt-out is the earliest; `reactivation_sent_at` the latest.
- archive: K archived, O not → K is active and `contact_archive_log` has one `restored` row by the merging person (mutation: keep K's archive). Both archived → K stays archived.
- `keep_before`/`keep_after` hold exactly `app.merge_fields_of`'s keys.
- **the fingerprint does not depend on the session's time zone** (plan-review minor, noted for T3 by T1 on 2026-10-29): for an unchanged row with `archived_at` set, `md5(app.merge_fields_of(row)::text)` read after `set local timezone = 'America/Chicago'` equals the one read under `UTC`, and `contact_merge_preview`'s `seen` read in a Chicago session merges (not `stale`) when sent back from a UTC session (mutation: drop `set timezone = 'UTC'` from `app.merge_fields_of` -> FAILS). Evidence (T1's PG17 replica): `to_jsonb('2026-10-29T12:00:00Z'::timestamptz)` prints `"2026-10-29T07:00:00-05:00"` in a Chicago session and `"2026-10-29T12:00:00+00:00"` in a UTC one, and a function declared `set timezone = 'UTC'` prints the latter in both.

**Refusals and who**: `same`; `not_found` (O in account B, merged under A: second account); `holding`; `already_merged` (O already a tombstone; mutation: drop the check → FAILS); `stale`, three cases: (1) O's `first_name` changed between `seenOf` and the merge; (2) **a write that never stamps `updated_at`**, as `assignment.ts:339` does: `update public.contacts set assigned_to = <a member's users.id> where id = O` with `updated_at` untouched (review m3; mutation: compare `updated_at` instead of the fingerprint → this case merges, FAILS); (3) `reactivation_sent_at` set the same way (`automations.ts:1855`'s shape). Mutation for all three: drop the check. A Technician is refused 42501; an Owner with client access off is refused 42501 (the NULL path, through `app.may_merge`); an Owner of A whose token names org B is refused 42501 (T1's seed shape; review m4); Staff succeeds; service role with `p_actor` succeeds and `merged_by = p_actor`; service role without `p_actor` is 22023.

**Chain**: A into B, then B into C → A's `merged_into` is C, and A is in the second merge's `moved.contacts` (mutation: drop the flatten).

**Flags**: the merged pair gets `merge_id`; with no pair, a `merged_by_hand` row is written with `merge_id` (mutation: skip it → FAILS); a pair O–X becomes K–X with its reason and dismissal kept, recorded in `moved.contact_duplicate_flags_added` and `removed.contact_duplicate_flags`. And the review's I1 shape, in full: K has NO email; O's email is `maria@x.mx`; X's is `MARIA@x.mx` (the trigger files O–X `same_email` when X is inserted); an Owner dismisses O–X; K, O and X share nothing else (three phones, no last names). Merge K ← O with no choices (K's blank email is filled from O). Assert: K–X exists, `same_email`, STILL DISMISSED, and is absent from `duplicate_pairs_page`; after Undo, no row names K–X and O–X is back, dismissed. Mutations: (a) run the re-file after the field update → K–X is undismissed and listed, FAILS; (b) drop the before/after record of the trigger's flags → after Undo K–X survives (a phantom), FAILS. A second shape for (b) alone: X has no pair with O at all because X was inserted while O held a different email; K gains O's email and the trigger files K–X fresh; after Undo it is gone.

**Preview equals the move**: seed O with two messages, a call by contact AND by thread (the same call), a booking, a document, a deal, a note, a to-do and a form answer; `contact_merge_preview(A, K, O)` as an Owner; merge; `contact_merges.moved_counts` equals the preview's `counts` exactly (`calls` = 1, not 2: the union). Mutation: count `calls` twice in the preview → FAILS. Preview refusals: `same`, `not_found`, `holding`, `already_merged`.

**Undo**:

| Case | Assertion | Mutation |
|---|---|---|
| everything comes back | after merge + undo: every moved row is on O again, every removed snapshot is back (a tag, a membership, a relationship, a skip, a flag), O's thread exists with its original id AND reply token, K's thread lost exactly O's rows, the pair's `merge_id` is null, `undone_at`/`undone_by` set | skip the `removed` re-inserts |
| ORDER: the tombstone is cleared first | with the `follow_merge` triggers installed, every row moved back is on O | move the "clear the tombstone" statement after the row moves (the triggers send them to K: FAILS). This is the test that proves the order |
| an edit after the merge is kept | change K's first name after the merge; undo → K keeps the edit, `keptEdits` = `["first_name"]`; untouched fields return | restore unconditionally |
| a text after the merge stays | insert a message on K's thread after the merge; undo → it is still on K's thread, `keptNew` = 1 | move every message on the thread instead of the recorded ids |
| a thread made by the merge goes away when empty | K had no thread; undo → K's thread is gone when nothing new reached it, and stays when a text did | |
| `expired` | as owner, `update contact_merges set merged_at = now() - interval '31 days', undo_until = now() - interval '1 day'` (both, or the window check refuses) | drop the window check |
| `later_merge` | (a) K merged into Z since; (b) another merge into K after this one; each refuses | drop the check: (b) then corrupts the first |
| `already_undone`; `not_found` (B's merge id under A) | | |
| who | the same four as the merge | |
| `merged_by_hand` is removed by its Undo; a suggested pair comes back | | clear `merge_id` on both |

**The backstop** (`follow_merge`):
- a task inserted (as owner) with O's id after the merge lands on K (mutation: drop `tasks_follow_merge`).
- **a write racing a merge waits for it and lands on K (plan review I2).** Two `pg.Client`s OUTSIDE `withRollback` (the second session must see committed rows), so the seed is committed and removed in `finally`:

```ts
import { Client as Pg } from "pg";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

it("an insert naming O while a merge holds its transaction waits, then lands on K (review I2; mutation: drop `for share` from app.follow_merge -> the task lands on O, FAILS)", async () => {
  const url = process.env.SUPABASE_DB_URL!;
  const setup = new Pg({ connectionString: url }), merger = new Pg({ connectionString: url }), writer = new Pg({ connectionString: url });
  await Promise.all([setup.connect(), merger.connect(), writer.connect()]);
  let agencyId = "", accountId = "", open = false;
  try {
    agencyId = (await setup.query("insert into public.agencies (name) values ('Race') returning id")).rows[0].id;
    accountId = (await setup.query(
      "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Race') returning id", [agencyId, `org_race_${RUN}`])).rows[0].id;
    const k = (await setup.query("insert into public.contacts (account_id, first_name, author_kind) values ($1, 'Keep', 'person') returning id", [accountId])).rows[0].id;
    const o = (await setup.query("insert into public.contacts (account_id, first_name, author_kind) values ($1, 'Other', 'person') returning id", [accountId])).rows[0].id;
    const seen = (await setup.query("select public.contact_merge_preview($1, $2, $3) -> 'seen' as s", [accountId, k, o])).rows[0].s;
    await merger.query("begin"); open = true;
    await merger.query("set local role service_role");
    await merger.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    const { rows: [m] } = await merger.query("select public.merge_contacts($1, $2, $3, '{}'::jsonb, $4::jsonb, 'race') as r", [accountId, k, o, JSON.stringify(seen)]);
    expect(m.r.status).toBe("merged");
    let settled = false;
    const late = writer.query("insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'late') returning contact_id", [accountId, o])
      .finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 500));
    expect(settled, "the insert waits on the merge's row lock").toBe(false);
    await merger.query("commit"); open = false;
    expect((await late).rows[0].contact_id).toBe(k);
  } finally {
    if (open) await merger.query("rollback");
    if (accountId) {
      for (const t of ACCOUNT_OWNED_TABLES) await setup.query(`delete from public.${t} where account_id = $1`, [accountId]);
      await setup.query("delete from public.accounts where id = $1", [accountId]);
    }
    if (agencyId) await setup.query("delete from public.agencies where id = $1", [agencyId]);
    await Promise.all([setup.end(), merger.end(), writer.end()]);
  }
});
```

  Whether the insert waits without the fix depends on the merge's lock on O, not on `follow_merge` (corrected 2026-10-29 by T1, measured on its PG17 replica with part A applied, a committed K and O, and one transaction holding both rows and updating O's `merged_into`): with section 16's `for update` the insert DOES wait, in its foreign-key check (`SELECT 1 FROM ONLY "public"."contacts" x WHERE "id" = $1 FOR KEY SHARE OF x` hit `statement_timeout` 3 s); with `for no key update` it does NOT wait (it returned in 24 ms naming O). So with the merge as written, `settled === false` holds with or without the fix, and the assertion that discriminates is WHERE it lands (on K, not O). Keep both assertions; if section 16 ever moves to `for no key update`, the wait assertion becomes the one the fix alone satisfies. Run the file with vitest's default isolation; this case must not share a connection with any `withRollback` case.
- **a late insert that collides with a row K already has (review m8b, documented):** after the merge, (a) `insert into public.contact_tags (contact_id, tag_id, account_id) values (O, <a tag K has>, A) on conflict (contact_id, tag_id) do nothing` (the shape `addTagToContact`'s upsert sends, `contacts.ts:1004-1006`) succeeds and leaves one row on K: ON CONFLICT is judged on the redirected row; (b) an active `insurance` skip inserted naming O when K already has one answers 23505 through `refusal()`. (b) is the designed answer: each such caller already reports a duplicate or a failure, and nothing is written. Say so in the trigger's comment.
- **every foreign-key table into contacts is accounted for by the merge (review m6):**

```ts
const C_MOVES = ["automation_log", "bookings", "calls", "document_requests", "documents", "form_submissions", "notes", "opportunities", "places", "tasks"];
const SPECIAL = ["client_group_members", "contact_duplicate_flags", "contact_relationships", "contact_tags", "conversations", "document_requirement_skips", "record_summaries"];
const STAYS = ["ai_acts", "consent_events", "contact_archive_log", "proposals"];
const SELF = ["contact_merges", "contacts"];
it("every table with a foreign key into contacts is moved, handled, kept or the merge's own, and c_moves is exactly C_MOVES (review m6; mutation: a new FK table -> FAILS naming it)", () =>
  withRollback(async (c) => {
    const { rows } = await c.query<{ t: string }>(
      `select distinct rc.relname as t from pg_constraint k join pg_class rc on rc.oid = k.conrelid
        where k.contype = 'f' and k.confrelid = 'public.contacts'::regclass order by 1`);
    expect(rows.map((r) => r.t)).toEqual([...C_MOVES, ...SPECIAL, ...STAYS, ...SELF].sort());
    const { rows: [fn] } = await c.query<{ src: string }>("select prosrc as src from pg_proc where oid = 'public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text)'::regprocedure");
    const code = fn!.src.replace(/--.*$/gm, "");   // a comment naming a table cannot satisfy this
    const lit = /c_moves constant text\[\] := array\[([^\]]*)\]/.exec(code)?.[1] ?? "";
    expect(lit.split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean)).toEqual(C_MOVES);
    for (const t of SPECIAL) expect(code, t).toContain(`public.${t}`);
    // The control: a throwaway FK table reds the first assertion, so the list cannot pass empty.
    await c.query("create table public.zz_fk_probe (account_id uuid, contact_id uuid, foreign key (account_id, contact_id) references public.contacts (account_id, id))");
    const { rows: after } = await c.query<{ t: string }>(
      `select distinct rc.relname as t from pg_constraint k join pg_class rc on rc.oid = k.conrelid
        where k.contype = 'f' and k.confrelid = 'public.contacts'::regclass order by 1`);
    expect(after.map((r) => r.t)).toContain("zz_fk_probe");   // the same query sees a new table, so the equality above can fail
  }));
```
- an `ai_acts` insert naming O lands on K (insert-only trigger).
- an update of a note's `contact_id` to O lands on K.
- `contact_relationships.related_contact_id` = O lands on K (the second function).
- the guard, from the catalogue:

```ts
it("every foreign key into contacts but the five named exclusions has a follow_merge trigger on its column (mutation: drop notes_follow_merge -> FAILS naming notes.contact_id)", () =>
  withRollback(async (c) => {
    // relname, never regclass::text: the latter prints "public.x" or "x" depending on the session's search_path.
    const { rows } = await c.query<{ fk: string }>(
      `select rc.relname || '.' || a.attname as fk
         from pg_constraint k
         join pg_class rc on rc.oid = k.conrelid
         join pg_attribute a on a.attrelid = k.conrelid
          and a.attnum = (select x from unnest(k.conkey) as x where x <> (select attnum from pg_attribute where attrelid = k.conrelid and attname = 'account_id') limit 1)
        where k.contype = 'f' and k.confrelid = 'public.contacts'::regclass
          and rc.relname not in ('contacts', 'contact_merges', 'contact_duplicate_flags', 'contact_archive_log', 'record_summaries')
          and not exists (
            select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
             where t.tgrelid = k.conrelid and not t.tgisinternal
               and p.proname = case when a.attname = 'related_contact_id' then 'follow_merge_related' else 'follow_merge' end)
        order by 1`);
    expect(rows.map((r) => r.fk)).toEqual([]);
    // Not vacuous: the same query without the not-exists lists 19 columns.
  }));
```

  Add the positive control the comment names (the count of 19 without `not exists`), so a mistyped exclusion list cannot pass an empty set (`bis-vacuous-test-shapes`, "an empty-set assertion whose own filter literals are unverified").

- [ ] **Step 2: Run red on T1's `post`** (part A only): `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55762/post pnpm exec vitest run src/test/contact-merge-schema.test.ts` on YOUR replica (port **55762**, a copy of T1's script). Expected: `function public.merge_contacts(...) does not exist`. Paste.

- [ ] **Step 3: Append part B.** Header additions: WHAT (the six functions and the 19 triggers), GRANTS (merge, undo: authenticated and service_role; preview: authenticated and service_role; the two helpers and the two trigger functions: owner only; four definers join `EXPECTED_DEFINERS`, 32 → 36), ROLLBACK first steps: "undo every live merge, newest first (`select id from contact_merges where undone_at is null order by id desc`), with `undo_contact_merge` as service_role and a `p_actor`; a merge past its window cannot be undone: the orchestrator lists those and the owner decides before any rollback; then drop the 19 triggers, the two follow functions, the three public functions and the two helpers".

```sql
-- 14. Two small helpers (owner only; the definers below call them as the owner).
-- Which side a field's value comes from: a blank never wins, equal values are the kept record's, and only a real
-- disagreement reads the person's choice.
create function app.merge_side(p_keep text, p_other text, p_choice text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when nullif(pg_catalog.btrim(coalesce(p_other, '')), '') is null then 'keep'
           when nullif(pg_catalog.btrim(coalesce(p_keep, '')), '') is null then 'other'
           when p_keep = p_other then 'keep'
           when p_choice = 'other' then 'other'
           else 'keep'
         end
$$;
create function app.merge_push(p_obj jsonb, p_key text, p_value jsonb) returns jsonb
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select coalesce(p_obj, '{}'::jsonb)
         || pg_catalog.jsonb_build_object(p_key, coalesce(p_obj -> p_key, '[]'::jsonb) || pg_catalog.jsonb_build_array(p_value))
$$;
revoke all on function app.merge_side(text, text, text) from public, anon, authenticated, service_role;
revoke all on function app.merge_push(jsonb, text, jsonb) from public, anon, authenticated, service_role;

-- The merge's ONE field list, as jsonb: keep_before, keep_after, the preview's fields, and (through md5) the
-- fingerprint stale compares (plan review m3: assignment.ts:339, contacts.ts:1295,1313,1540, automations.ts:1855 and
-- 0076:107 write contacts without stamping updated_at). STABLE, not immutable. to_jsonb prints a timestamptz in the
-- session's TimeZone, so the function pins it to UTC (plan-review minor, 2026-10-29): a fingerprint read in a session
-- that is not UTC (psql, a script, any caller outside PostgREST) must equal the one the merge computes.
create function app.merge_fields_of(p_row public.contacts) returns jsonb
language sql stable parallel safe set search_path = pg_catalog, pg_temp set timezone = 'UTC' as $$
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from pg_catalog.jsonb_each(pg_catalog.to_jsonb(p_row)) as e
   where e.key = any (array['first_name', 'last_name', 'email', 'phone', 'phone_country_unconfirmed', 'assigned_to',
     'custom', 'language', 'language_source', 'language_set_at', 'last_language_signal', 'last_language_signal_source',
     'last_language_signal_at', 'language_hint_kept_at', 'marketing_email_opted_out_at', 'dnd', 'reactivation_sent_at',
     'archived_at', 'archived_by'])
$$;
revoke all on function app.merge_fields_of(public.contacts) from public, anon;
grant execute on function app.merge_fields_of(public.contacts) to authenticated, service_role;

-- 15. The backstop (spec 7.2; correction 12): a write that names a tombstone lands on the kept record. DEFINER, so
--     the pointer is read whatever the writer's RLS sees. One primary-key read per write, FOR SHARE (plan review I2):
--     a write that began before a merge committed waits on the merge's row lock and then reads the COMMITTED pointer;
--     an unlocked read saw the pre-merge snapshot and the write landed on the hidden record.
create function app.follow_merge() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_to uuid;
begin
  if new.contact_id is not null then
    select k.merged_into into v_to from public.contacts k where k.id = new.contact_id for share;
    if v_to is not null then
      new.contact_id := v_to;
    end if;
  end if;
  return new;
end $$;
create function app.follow_merge_related() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_to uuid;
begin
  if new.related_contact_id is not null then
    select k.merged_into into v_to from public.contacts k where k.id = new.related_contact_id for share;
    if v_to is not null then
      new.related_contact_id := v_to;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.follow_merge() from public, anon, authenticated;
revoke all on function app.follow_merge_related() from public, anon, authenticated;
do $$
declare
  t text;
begin
  foreach t in array array['automation_log', 'bookings', 'calls', 'client_group_members', 'contact_relationships', 'contact_tags',
                           'conversations', 'document_requests', 'document_requirement_skips', 'documents', 'form_submissions',
                           'notes', 'opportunities', 'places', 'tasks'] loop
    execute pg_catalog.format(
      'create trigger %I before insert or update of contact_id on public.%I for each row execute function app.follow_merge()',
      t || '_follow_merge', t);
  end loop;
  -- Fixed rows (0091, 0088, 0054): their own triggers refuse an update, and a new row is not history yet.
  foreach t in array array['ai_acts', 'proposals', 'consent_events'] loop
    execute pg_catalog.format(
      'create trigger %I before insert on public.%I for each row execute function app.follow_merge()', t || '_follow_merge', t);
  end loop;
end $$;
create trigger contact_relationships_follow_merge_related before insert or update of related_contact_id
  on public.contact_relationships for each row execute function app.follow_merge_related();
```

Then **section 16, `public.merge_contacts`**. Write it as below; every statement is load-bearing, and the order is the spec's (who, lock, refuse, tombstone first, fields, rows, flags, log):

```sql
create function public.merge_contacts(
  p_account_id uuid, p_keep uuid, p_other uuid, p_choices jsonb, p_seen jsonb, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  c_moves constant text[] := array['automation_log', 'bookings', 'calls', 'document_requests', 'documents',
    'form_submissions', 'notes', 'opportunities', 'places', 'tasks'];
  v_actor text;
  k public.contacts%rowtype;
  o public.contacts%rowtype;
  v_oc public.conversations%rowtype;
  v_kc uuid;
  v_moved jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  v_choices jsonb := '{}'::jsonb;
  v_counts jsonb;
  v_ids text[];
  v_t text;
  v_key text;
  v_side text;
  v_s_first text; v_s_last text; v_s_email text; v_s_phone text; v_s_assigned text; v_s_lang text;
  v_custom jsonb;
  v_before jsonb;
  v_after jsonb;
  v_hand integer := 0;
  v_token text;
  v_pair uuid;
  v_new uuid;
  v_x uuid;
  v_km public.client_group_members%rowtype;
  v_merge bigint;
  v_flags_before uuid[];
  r record;
begin
  -- 1. Who (app.may_merge: a service_role JWT, the agency, or an Owner or Staff of this account whose token is in it).
  if not app.may_merge(p_account_id) then
    raise exception 'merge_contacts: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  v_actor := case when coalesce(app.jwt() ->> 'role', '') = 'service_role' then nullif(p_actor, '')
                  else nullif(app.jwt() ->> 'sub', '') end;
  if v_actor is null or p_keep is null or p_other is null
     or p_choices is null or pg_catalog.jsonb_typeof(p_choices) <> 'object'
     or p_seen is null or pg_catalog.jsonb_typeof(p_seen) <> 'object' then
    raise exception 'merge_contacts: an actor, two contacts, choices and seen are required' using errcode = '22023';
  end if;
  for v_key, v_side in select e.key, e.value #>> '{}' from pg_catalog.jsonb_each(p_choices) as e loop
    if v_side is null or v_side not in ('keep', 'other')
       or not (v_key in ('first_name', 'last_name', 'email', 'phone', 'assigned_to', 'language') or v_key like 'custom.%') then
      raise exception 'merge_contacts: unknown choice %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_keep = p_other then
    return pg_catalog.jsonb_build_object('status', 'same');
  end if;

  -- 2. Lock both contacts, then their conversations, each in id order (0103's order), then read them fresh.
  perform 1 from public.contacts c where c.account_id = p_account_id and c.id in (p_keep, p_other) order by c.id for update;
  select * into k from public.contacts c where c.account_id = p_account_id and c.id = p_keep;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select * into o from public.contacts c where c.account_id = p_account_id and c.id = p_other;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.conversations cv
   where cv.account_id = p_account_id and cv.contact_id in (p_keep, p_other) order by cv.id for update;

  -- 3. Refusals, each a status the screen can word. stale: either row's merge fields changed since the preview the
  --    screen showed (correction 19: a fingerprint, because several writers never stamp updated_at).
  if k.holds_shared_number or o.holds_shared_number then
    return pg_catalog.jsonb_build_object('status', 'holding');
  end if;
  if k.merged_into is not null or o.merged_into is not null then
    return pg_catalog.jsonb_build_object('status', 'already_merged');
  end if;
  if pg_catalog.md5(app.merge_fields_of(k)::text) is distinct from (p_seen ->> 'keep')
     or pg_catalog.md5(app.merge_fields_of(o)::text) is distinct from (p_seen ->> 'other') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  v_before := app.merge_fields_of(k);

  -- 4. The tombstone FIRST, then the chain flattened (one hop for every lookup), so the flag trigger, which skips a
  --    tombstone, never pairs the kept record with the one it absorbs while the fields below are written.
  update public.contacts set merged_into = p_keep, merged_at = pg_catalog.now()
   where account_id = p_account_id and id = p_other;
  with f as (update public.contacts set merged_into = p_keep
              where account_id = p_account_id and merged_into = p_other returning id)
  select coalesce(pg_catalog.array_agg(f.id::text), '{}') into v_ids from f;
  v_moved := v_moved || pg_catalog.jsonb_build_object('contacts', pg_catalog.to_jsonb(v_ids));

  -- 5. Flags, BEFORE the fields (plan review I1). Every other pair naming the other record is re-filed on the kept one
  --    with its reason AND its dismissal before the field update below can make the flag trigger file the same pair
  --    fresh (undismissed) and leave this re-file a silent, unrecorded conflict.
  select f.id into v_pair from public.contact_duplicate_flags f
   where f.account_id = p_account_id and f.contact_a = least(p_keep, p_other) and f.contact_b = greatest(p_keep, p_other);
  for r in select f.* from public.contact_duplicate_flags f
            where f.account_id = p_account_id and (f.contact_a = p_other or f.contact_b = p_other)
              and f.id is distinct from v_pair loop
    delete from public.contact_duplicate_flags where id = r.id;
    v_removed := app.merge_push(v_removed, 'contact_duplicate_flags', pg_catalog.to_jsonb(r) - 'strength');
    v_x := case when r.contact_a = p_other then r.contact_b else r.contact_a end;
    v_new := null;
    if v_x <> p_keep then
      insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason, dismissed_at, dismissed_by, created_at)
      values (p_account_id, least(p_keep, v_x), greatest(p_keep, v_x), r.reason, r.dismissed_at, r.dismissed_by, r.created_at)
      on conflict (account_id, contact_a, contact_b) do nothing
      returning id into v_new;
      if v_new is not null then
        v_moved := app.merge_push(v_moved, 'contact_duplicate_flags_added', pg_catalog.to_jsonb(v_new::text));
      end if;
    end if;
  end loop;

  -- 6. Fields (spec 5.2). A choice names a side; every value is read from the locked rows.
  v_s_first := app.merge_side(k.first_name, o.first_name, p_choices ->> 'first_name');
  v_s_last := app.merge_side(k.last_name, o.last_name, p_choices ->> 'last_name');
  v_s_email := app.merge_side(k.email, o.email, p_choices ->> 'email');
  v_s_phone := app.merge_side(k.phone, o.phone, p_choices ->> 'phone');
  v_s_assigned := app.merge_side(k.assigned_to::text, o.assigned_to::text, p_choices ->> 'assigned_to');
  if k.language is null then
    v_s_lang := 'other';
  elsif o.language is null or o.language = k.language then
    v_s_lang := 'keep';
  elsif p_choices ? 'language' then
    v_s_lang := p_choices ->> 'language';
  elsif k.language_source = 'staff' and o.language_source <> 'staff' then
    v_s_lang := 'keep';
  elsif o.language_source = 'staff' and k.language_source <> 'staff' then
    v_s_lang := 'other';
  elsif o.language_set_at < k.language_set_at then
    v_s_lang := 'other';
  else
    v_s_lang := 'keep';
  end if;
  v_custom := coalesce(o.custom, '{}'::jsonb) || coalesce(k.custom, '{}'::jsonb);
  for v_key in select e.key from pg_catalog.jsonb_each(coalesce(k.custom, '{}'::jsonb)) as e
                where coalesce(o.custom, '{}'::jsonb) ? e.key loop
    v_side := app.merge_side(k.custom ->> v_key, o.custom ->> v_key, p_choices ->> ('custom.' || v_key));
    if v_side = 'other' then
      v_custom := v_custom || pg_catalog.jsonb_build_object(v_key, o.custom -> v_key);
    end if;
    v_choices := v_choices || pg_catalog.jsonb_build_object('custom.' || v_key, v_side);
  end loop;
  v_choices := v_choices || pg_catalog.jsonb_build_object('first_name', v_s_first, 'last_name', v_s_last, 'email', v_s_email,
    'phone', v_s_phone, 'assigned_to', v_s_assigned, 'language', v_s_lang);

  -- The update below fires contacts_flag_pairs for K (a key K gains from O files K's pairs). Every flag it files is
  -- recorded, so the Undo removes it (plan review I1): the flag ids naming K, before and after.
  select coalesce(pg_catalog.array_agg(f.id), '{}') into v_flags_before from public.contact_duplicate_flags f
   where f.account_id = p_account_id and (f.contact_a = p_keep or f.contact_b = p_keep);
  update public.contacts c set
    first_name = case v_s_first when 'other' then o.first_name else k.first_name end,
    last_name = case v_s_last when 'other' then o.last_name else k.last_name end,
    email = case v_s_email when 'other' then o.email else k.email end,
    phone = case v_s_phone when 'other' then o.phone else k.phone end,
    phone_country_unconfirmed = case v_s_phone when 'other' then o.phone_country_unconfirmed else k.phone_country_unconfirmed end,
    assigned_to = case v_s_assigned when 'other' then o.assigned_to else k.assigned_to end,
    custom = v_custom,
    language = case v_s_lang when 'other' then o.language else k.language end,
    language_source = case v_s_lang when 'other' then o.language_source else k.language_source end,
    language_set_at = case v_s_lang when 'other' then o.language_set_at else k.language_set_at end,
    last_language_signal = case when k.last_language_signal is null then o.last_language_signal else k.last_language_signal end,
    last_language_signal_source = case when k.last_language_signal is null then o.last_language_signal_source else k.last_language_signal_source end,
    last_language_signal_at = case when k.last_language_signal is null then o.last_language_signal_at else k.last_language_signal_at end,
    language_hint_kept_at = coalesce(k.language_hint_kept_at, o.language_hint_kept_at),
    marketing_email_opted_out_at = least(k.marketing_email_opted_out_at, o.marketing_email_opted_out_at),
    dnd = case when coalesce(k.dnd, '{}'::jsonb) = '{}'::jsonb then o.dnd else k.dnd end,
    reactivation_sent_at = greatest(k.reactivation_sent_at, o.reactivation_sent_at),
    archived_at = case when o.archived_at is null then null else k.archived_at end,
    archived_by = case when o.archived_at is null then null else k.archived_by end,
    updated_at = pg_catalog.now()
   where c.account_id = p_account_id and c.id = p_keep;
  for v_new in select f.id from public.contact_duplicate_flags f
                where f.account_id = p_account_id and (f.contact_a = p_keep or f.contact_b = p_keep)
                  and not (f.id = any (v_flags_before)) order by f.id loop
    v_moved := app.merge_push(v_moved, 'contact_duplicate_flags_added', pg_catalog.to_jsonb(v_new::text));
  end loop;
  -- An archive is a person's act with a log row; inside a definer the 0103 log trigger (WHEN current_user =
  -- 'authenticated') does not fire, so the merge writes the row itself.
  if k.archived_at is not null and o.archived_at is null then
    insert into public.contact_archive_log (account_id, contact_id, action, author_kind, author_id)
    values (p_account_id, p_keep, 'restored', 'person', v_actor);
  end if;
  select app.merge_fields_of(c) into v_after from public.contacts c where c.id = p_keep;

  -- 7. Rows that simply move (spec 5.3).
  foreach v_t in array c_moves loop
    execute pg_catalog.format(
      'with m as (update public.%I set contact_id = $1 where account_id = $2 and contact_id = $3 returning id) '
      || 'select coalesce(pg_catalog.array_agg(m.id::text), ''{}'') from m', v_t)
      into v_ids using p_keep, p_account_id, p_other;
    v_moved := v_moved || pg_catalog.jsonb_build_object(v_t, pg_catalog.to_jsonb(v_ids));
  end loop;

  -- Tags: one both had is removed from the other first (PK contact_id, tag_id); the rest move, keyed by tag_id.
  for r in select g.* from public.contact_tags g
            where g.account_id = p_account_id and g.contact_id = p_other
              and exists (select 1 from public.contact_tags x where x.contact_id = p_keep and x.tag_id = g.tag_id) loop
    delete from public.contact_tags where contact_id = p_other and tag_id = r.tag_id;
    v_removed := app.merge_push(v_removed, 'contact_tags', pg_catalog.to_jsonb(r));
  end loop;
  with m as (update public.contact_tags set contact_id = p_keep
              where account_id = p_account_id and contact_id = p_other returning tag_id)
  select coalesce(pg_catalog.array_agg(m.tag_id::text), '{}') into v_ids from m;
  v_moved := v_moved || pg_catalog.jsonb_build_object('contact_tags', pg_catalog.to_jsonb(v_ids));

  -- Groups (0069:63-79, 0075): a group both are in keeps the kept membership with is_billing and is_primary_contact
  -- OR'd (the other's row is removed first: one primary contact per group); one main group per contact.
  for r in select m.* from public.client_group_members m
            where m.account_id = p_account_id and m.contact_id = p_other order by m.id loop
    select * into v_km from public.client_group_members x
     where x.account_id = p_account_id and x.contact_id = p_keep and x.client_group_id = r.client_group_id;
    if found then
      delete from public.client_group_members where id = r.id;
      v_removed := app.merge_push(v_removed, 'client_group_members', pg_catalog.to_jsonb(r));
      if (r.is_billing and not v_km.is_billing) or (r.is_primary_contact and not v_km.is_primary_contact) then
        v_moved := app.merge_push(v_moved, 'client_group_members_flags', pg_catalog.jsonb_build_object(
          'id', v_km.id, 'is_billing', v_km.is_billing, 'is_primary_contact', v_km.is_primary_contact));
        update public.client_group_members
           set is_billing = is_billing or r.is_billing, is_primary_contact = is_primary_contact or r.is_primary_contact
         where id = v_km.id;
      end if;
    elsif r.is_primary and exists (select 1 from public.client_group_members x
                                    where x.account_id = p_account_id and x.contact_id = p_keep and x.is_primary) then
      update public.client_group_members set contact_id = p_keep, is_primary = false where id = r.id;
      v_moved := app.merge_push(v_moved, 'client_group_members', pg_catalog.to_jsonb(r.id::text));
      v_moved := app.merge_push(v_moved, 'client_group_members_unprimaried', pg_catalog.to_jsonb(r.id::text));
    else
      update public.client_group_members set contact_id = p_keep where id = r.id;
      v_moved := app.merge_push(v_moved, 'client_group_members', pg_catalog.to_jsonb(r.id::text));
    end if;
  end loop;

  -- Relationships (0070): one between the two becomes a self-row and is removed; one that repeats a relationship
  -- the kept record already has trips a unique index and is removed. Each move records which side it moved.
  for r in select x.* from public.contact_relationships x
            where x.account_id = p_account_id and (x.contact_id = p_other or x.related_contact_id = p_other) order by x.id loop
    if (case when r.contact_id = p_other then p_keep else r.contact_id end)
       = (case when r.related_contact_id = p_other then p_keep else r.related_contact_id end) then
      delete from public.contact_relationships where id = r.id;
      v_removed := app.merge_push(v_removed, 'contact_relationships', pg_catalog.to_jsonb(r));
    else
      begin
        update public.contact_relationships
           set contact_id = case when contact_id = p_other then p_keep else contact_id end,
               related_contact_id = case when related_contact_id = p_other then p_keep else related_contact_id end
         where id = r.id;
        v_moved := app.merge_push(v_moved, 'contact_relationships', pg_catalog.jsonb_build_object(
          'id', r.id, 'contact', r.contact_id = p_other, 'related', r.related_contact_id = p_other));
      exception when unique_violation then
        delete from public.contact_relationships where id = r.id;
        v_removed := app.merge_push(v_removed, 'contact_relationships', pg_catalog.to_jsonb(r));
      end;
    end if;
  end loop;

  -- Skips (0081:81, one active skip per category).
  for r in select s.* from public.document_requirement_skips s
            where s.account_id = p_account_id and s.contact_id = p_other order by s.id loop
    begin
      update public.document_requirement_skips set contact_id = p_keep where id = r.id;
      v_moved := app.merge_push(v_moved, 'document_requirement_skips', pg_catalog.to_jsonb(r.id::text));
    exception when unique_violation then
      delete from public.document_requirement_skips where id = r.id;
      v_removed := app.merge_push(v_removed, 'document_requirement_skips', pg_catalog.to_jsonb(r));
    end;
  end loop;

  -- Threads (correction 8): always into the kept record's thread, made here when it has none. messages is NO ACTION
  -- on its thread (0005:33), calls SET NULL (0019:49) and inbound_emails CASCADE (0082:93-94): all three move BEFORE
  -- the emptied thread is removed, so a missed one fails the merge closed or is caught by the test.
  select * into v_oc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = p_other;
  if found then
    select cv.id into v_kc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = p_keep;
    if v_kc is null then
      insert into public.conversations (account_id, contact_id) values (p_account_id, p_keep) returning id into v_kc;
      v_moved := v_moved || pg_catalog.jsonb_build_object('conversation_created', v_kc);
    end if;
    -- messages.updated_at is left as it was (plan review m8a): an Undo could not put it back.
    with m as (update public.messages set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('messages', pg_catalog.to_jsonb(v_ids));
    with m as (update public.calls set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('calls_thread', pg_catalog.to_jsonb(v_ids));
    with m as (update public.inbound_emails set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('inbound_emails', pg_catalog.to_jsonb(v_ids));
    v_hand := coalesce(v_oc.unread_count, 0);
    v_moved := v_moved || pg_catalog.jsonb_build_object('conversation_assigned_before',
      (select pg_catalog.to_jsonb(cv.assigned_to) from public.conversations cv where cv.id = v_kc));
    update public.conversations cv
       set unread_count = cv.unread_count + v_hand,
           last_message_at = greatest(cv.last_message_at, v_oc.last_message_at),
           assigned_to = coalesce(cv.assigned_to, v_oc.assigned_to),
           updated_at = pg_catalog.now()
     where cv.id = v_kc;
    v_token := case when v_oc.reply_token is not null and v_oc.reply_token_revoked_at is null then v_oc.reply_token end;
    v_removed := v_removed || pg_catalog.jsonb_build_object('conversations', pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_oc)));
    delete from public.conversations where id = v_oc.id;
  end if;

  -- A cache: regenerated, never snapshotted.
  delete from public.record_summaries where account_id = p_account_id and contact_id in (p_keep, p_other);

  -- 8. The log, the pair resolved, the event.
  select pg_catalog.jsonb_build_object(
           'messages', pg_catalog.jsonb_array_length(coalesce(v_moved -> 'messages', '[]'::jsonb)),
           'calls', (select pg_catalog.count(distinct x) from (
                      select pg_catalog.jsonb_array_elements_text(coalesce(v_moved -> 'calls', '[]'::jsonb)) as x
                      union select pg_catalog.jsonb_array_elements_text(coalesce(v_moved -> 'calls_thread', '[]'::jsonb))) as u),
           'bookings', pg_catalog.jsonb_array_length(v_moved -> 'bookings'),
           'documents', pg_catalog.jsonb_array_length(v_moved -> 'documents'),
           'opportunities', pg_catalog.jsonb_array_length(v_moved -> 'opportunities'),
           'notes', pg_catalog.jsonb_array_length(v_moved -> 'notes'),
           'tasks', pg_catalog.jsonb_array_length(v_moved -> 'tasks'),
           'form_submissions', pg_catalog.jsonb_array_length(v_moved -> 'form_submissions'))
    into v_counts;
  insert into public.contact_merges (account_id, keep_id, other_id, merged_by, merged_at, undo_until, keep_before, keep_after,
                                     choices, moved, moved_counts, removed, unread_handed, other_reply_token)
  values (p_account_id, p_keep, p_other, v_actor, pg_catalog.now(), pg_catalog.now() + interval '30 days', v_before, v_after,
          v_choices, v_moved, v_counts, v_removed, v_hand, v_token)
  returning id into v_merge;
  if v_pair is null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason, merge_id)
    values (p_account_id, least(p_keep, p_other), greatest(p_keep, p_other), 'merged_by_hand', v_merge);
  else
    update public.contact_duplicate_flags set merge_id = v_merge where id = v_pair;
  end if;
  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'contact.merged', 'user', v_actor,
          pg_catalog.jsonb_build_object('contactId', p_keep, 'otherId', p_other, 'mergeId', v_merge));
  return pg_catalog.jsonb_build_object('status', 'merged', 'mergeId', v_merge, 'moved', v_counts);
end $$;
revoke all on function public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text) to authenticated, service_role;
```

  Read before you trust it: `contacts%rowtype` includes the generated columns (`select *` fills them; nothing writes them); `now()` is one instant per transaction, so `merged_at` and `undo_until` satisfy `contact_merges_window` exactly. If the replica disagrees with any line, the replica wins and your report says which line and why.

  **Section 17, `public.undo_contact_merge(p_account_id uuid, p_merge_id bigint, p_actor text default null) returns jsonb`**, SECURITY DEFINER, the same who-check and actor rule. In this order (spec 4.5, with corrections 5, 8):
  1. `select * into g from public.contact_merges where account_id = p_account_id and id = p_merge_id for update`; not found → `not_found`; `undone_at` set → `already_undone`; `now() > undo_until` → `expired`.
  2. Lock both contacts, then their conversations, in id order (as the merge). `later_merge` when the kept record is now a tombstone, or a merge into the kept record with a greater id is not undone.
  3. **Clear the tombstone FIRST**: `update contacts set merged_into = null, merged_at = null where account_id = p_account_id and id = g.other_id and merged_into = g.keep_id`; then un-flatten: `merged_into = g.other_id` for the ids in `g.moved -> 'contacts'` still pointing at `g.keep_id`. (The `follow_merge` triggers would otherwise send every row moved back straight to the kept record; the ORDER test pins it.)
  4. The thread: `v_kc` = the kept record's thread. When `g.removed ? 'conversations'`: re-insert the snapshot with an explicit column list (`id, account_id, contact_id, last_message_at, unread_count, assigned_to, created_at, updated_at, reply_token, reply_token_revoked_at`; never `inbox_visible`, which is generated, nor `contact_archived`, which its trigger derives), `unread_count` 0, `on conflict (id) do nothing`. Move back the recorded `messages`, `calls_thread` and `inbound_emails` ids still on `v_kc`, never setting `messages.updated_at` (review m8a). Hand back `least(g.unread_handed, <v_kc's unread>)` only when anything moved back (0098's rule, `MIG/0098:202-211`), and recompute both threads' `last_message_at` from their messages. Restore `v_kc.assigned_to` to `g.moved -> 'conversation_assigned_before'` only while it still holds the value the merge set. When `g.moved ? 'conversation_created'` and that thread now holds no message, call or inbound email, delete it.
  5. Rows: for each of `c_moves` (the same literal as the merge, with a comment saying so), `execute format('update public.%I set contact_id = $1 where account_id = $2 and contact_id = $3 and id::text = any ($4)', t) using g.other_id, p_account_id, g.keep_id, <ids>`. Tags by `tag_id`. Group memberships: FIRST restore each `client_group_members_flags` snapshot (`is_billing`, `is_primary_contact` back) on the kept membership, THEN re-insert the removed memberships (one primary contact per group), then move back the recorded ids and set `is_primary = true` again for `client_group_members_unprimaried`. Relationships: move back the recorded side(s) only where they still name the kept record; re-insert removed rows `on conflict do nothing`. Skips: same. Re-insert `removed` snapshots with `insert into public.<t> select (pg_catalog.jsonb_populate_record(null::public.<t>, e.x)).* from pg_catalog.jsonb_array_elements(coalesce(g.removed -> '<t>', '[]')) as e(x) on conflict do nothing` for `contact_tags`, `client_group_members`, `contact_relationships`, `document_requirement_skips`; for `contact_duplicate_flags` use an explicit column list (it has the generated `strength`).
  6. Flags: delete `contact_duplicate_flags_added`; re-insert the removed pairs; the merged pair: `delete` when its reason is `merged_by_hand` and its `merge_id` is this merge, else `merge_id = null` (the suggestion comes back).
  7. Fields, compare and restore, in groups that must move together (a group restores only when EVERY member still equals `keep_after`; the 0076 language checks and 0103's `contacts_archived_by_needs_at` would otherwise refuse a half): `[first_name]`, `[last_name]`, `[email]`, `[phone, phone_country_unconfirmed]`, `[assigned_to]`, `[custom]`, `[language, language_source, language_set_at]`, `[last_language_signal, last_language_signal_source, last_language_signal_at]`, `[language_hint_kept_at]`, `[marketing_email_opted_out_at]`, `[dnd]`, `[reactivation_sent_at]`, `[archived_at, archived_by]`. A group whose `keep_before` differs from `keep_after` and whose current value no longer equals `keep_after` is named in `keptEdits` (its first member's name). Compare with `pg_catalog.to_jsonb(<row>) -> <field>` on both sides, so timestamps compare in one format. Apply the patch with one `update public.contacts c set (<every field>) = (select p.<field>, … from pg_catalog.jsonb_populate_record(c, <patch>) as p), updated_at = now() where c.id = g.keep_id`. When the archive group is restored to an archived state, write one `archived` row to `contact_archive_log` with `author_kind 'person'` and the undoing person.
  8. `keptNew` = messages on `v_kc` created after `g.merged_at` + calls on the kept record with `started_at > g.merged_at` + inbound emails on `v_kc` received after it.
  9. Stamp `undone_at = now()`, `undone_by = v_actor`; insert the `contact.merge_undone` event (actor `user`, payload `contactId`, `otherId`, `mergeId`); answer `{"status":"undone","otherId":…,"keptNew":…,"keptEdits":[…]}`.
  Grants as the merge's.

  **Section 18, `public.contact_merge_preview(p_account_id uuid, p_keep uuid, p_other uuid) returns jsonb`**: `language plpgsql stable` INVOKER, `set search_path = pg_catalog, pg_temp`. Refusals in the merge's order (`same`; either id not in the account → `not_found`; `holding`; `already_merged`). It reads both rows whole (`contacts%rowtype`) and answers, beside the counts, `fields` = `{ keep: app.merge_fields_of(k), other: app.merge_fields_of(o) }` and `seen` = `{ keep: md5(app.merge_fields_of(k)::text), other: md5(app.merge_fields_of(o)::text) }`, all from one statement snapshot, so the screen shows exactly the values its `seen` vouches for (review m3). Then the counts, from the other record only: `messages` (all on its thread), `calls` (`contact_id = p_other` OR `conversation_id` = its thread, counted once), and `bookings`, `documents`, `opportunities`, `notes`, `tasks`, `form_submissions` by `contact_id`, each `account_id`-scoped. `revoke all … from public, anon; grant execute … to authenticated, service_role`.

  **Section 19, comments** on the four public functions and `contact_merges.other_reply_token`.

- [ ] **Step 4: Apply and run green** on a fresh `post` (pre + the whole 0106). Paste the summary. Re-run T1's `contact-dedupe-schema.test.ts` on the same `post` too (part B must not break part A). Paste.
- [ ] **Step 5: The definer list.** `definer-search-path.test.ts`: add `"app.follow_merge()"`, `"app.follow_merge_related()"`, `"public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text)"`, `"public.undo_contact_merge(uuid,bigint,text)"`, each `PG_CATALOG_PG_TEMP`, in sorted position; 32 → 36 in the comment and the three counts. Run it on `post` (green). Paste.
- [ ] **Step 6: Measure one big merge.** In a copy of `post`, seed O with 10,000 messages on its thread, merge, and paste the time (`\timing`) into the header's LOCKS AND COST beside T1's number.
- [ ] **Step 7: Mutation probes** (the reviewer runs each on `post`, whole file, paste the red line by name; rebuild `post` after each):

| Change | Test that must go red |
|---|---|
| drop `'notes'` from `c_moves` | the `notes` row of the moves `it.each` |
| tags: drop the duplicate delete loop | "a tag both had" |
| groups: drop the flag OR update | "a group both are in" |
| groups: drop the unprimary branch | "two primary groups" |
| relationships: drop the self-row branch | "a relationship between the two" |
| relationships: drop the `unique_violation` handler | "a relationship that repeats" |
| threads: drop the `inbound_emails` update | "both threads: …" |
| threads: re-point O's thread when K has none | "K has no thread" |
| `v_token` without the revoked test | "a revoked reply token is not recorded" |
| `phone = case v_s_phone when 'other' then k.phone …` | "values come from the rows" |
| `app.merge_side` without its two blank branches | "a blank is filled from the other" |
| language: drop the `staff` branches | the staff case |
| drop the `already_merged` check | `already_merged` |
| drop the `stale` check | `stale` |
| drop the flatten statement | "chain" |
| skip the `merged_by_hand` insert | the flags case |
| preview: count calls by contact and by thread separately | "preview equals the move" |
| undo: clear the tombstone AFTER the row moves | "ORDER: the tombstone is cleared first" |
| merge: move the section 5 flag re-file back after the field update | the Flags case, I1 shape (K–X undismissed) |
| merge: drop the `v_flags_before` record loop | the Flags case, I1 second shape (a phantom after Undo) |
| merge: compare `(p_seen ->> 'keep')::timestamptz` with `k.updated_at` as before | `stale` case (2), the write that never stamps `updated_at` |
| `app.follow_merge`: drop `for share` | "an insert naming O while a merge holds its transaction waits, then lands on K" |
| `app.merge_fields_of`: drop `set timezone = 'UTC'` | "the fingerprint does not depend on the session's time zone" |
| add `'tags'` (any word) to `c_moves` | "every table with a foreign key into contacts is accounted for" (the literal no longer equals C_MOVES) |
| merge: set `messages.updated_at = now()` again | add the assertion to "everything comes back": a moved message's `updated_at` equals its pre-merge value after merge AND after Undo (review m8a) |
| undo: restore every field unconditionally | "an edit after the merge is kept" |
| undo: move every message on the kept thread | "a text after the merge stays" |
| undo: drop the window check | `expired` |
| undo: drop the later-merge check | `later_merge` (b) |
| undo: skip the `removed` re-inserts | "everything comes back" |
| drop trigger `tasks_follow_merge` | "a task inserted with O's id lands on K" AND the catalogue guard naming `tasks.contact_id` |
| `app.follow_merge` without `security definer` | add this case and run it: a Technician assigned to K (and not to O) inserts a task with `assigned_to` = their own users id and `contact_id` = O (the foreign-key check ignores RLS, and `tasks_technician_insert` admits a task assigned to themselves); it must land on K. As an invoker the trigger cannot read O under their RLS, so the task stays on O: FAILS |

- [ ] **Step 8: Commit.**

```bash
P="packages/db/supabase/migrations/0106_contact_merge.sql packages/db/src/test/contact-merge-schema.test.ts packages/db/src/test/definer-search-path.test.ts"
git add $P
git commit -m "feat(db): 0106 part B: merge two contacts with every row logged, undo it for 30 days, and land late writes on the kept record" -- $P
```

---

### Task 4: Contact queries after a merge

**Tier:** medium · **Owner:** bis-crm · **Wave:** 2

**Files:**
- Modify: `packages/db/src/contacts.ts` (`COLS` `:80-81`; `findDuplicate` `:272-369`; `flagDuplicatesAfterWrite` `:411-440`; `flagMatchesOf` `:526-559`; `fillContactBlanksReport` `:635-711`; `withArchived` `:896-902`; `DELETE_BLOCK_REASONS` `:1339`; `setContactPhoneCountry`'s twin read `:1403-1405`)
- Modify: `packages/db/src/contact-import.ts:38-57` (`buildMatchIndex`)
- Create: `packages/db/src/contacts-merge-resolve.test.ts` (pure)
- Create: `packages/db/src/test/contact-merge-lookups-live.test.ts` (CI)
- Modify (pins, correction 6): `packages/db/src/test/contacts.test.ts`, `test/contacts-phone-live.test.ts`, `test/contact-import.test.ts`, `test/assignee-filters.test.ts`

**Interfaces:** Consumes T1's columns. Produces `COLS` with `merged_into` and `"merges"` in `DELETE_BLOCK_REASONS`. Exports nothing new (the barrel is T5's this wave).

- [ ] **Step 1: Pure failing tests.** Create `contacts-merge-resolve.test.ts` with a `recordingDb` copied from `packages/db/src/contacts-archive.test.ts` (read it: it records every call per query and answers per table). Cases:
  - `listContacts` and `countContacts`, for `archived` `"exclude"` AND `"only"`, each issue `is("merged_into", null)` (mutation: drop it from one branch of `withArchived` → that branch's case FAILS).
  - `findDuplicate` through `createContact`: the email read answers `[{ id: "T", merged_into: "K" }]` → `createContact` returns `{ id: "K", existing: true }` (mutation: drop the resolve → `T`).
  - an email match on T (→ K) and a phone match on K is NOT a conflict: no `email_phone_conflict` insert is recorded (mutation: compare before resolving → the insert is recorded).
  - `flagDuplicatesAfterWrite` (through `updateContact`) and `setContactPhoneCountry`'s twin read each issue `is("merged_into", null)`; so does `flagMatchesOf`'s candidate read.
  - `fillContactBlanksReport` on T: `getContact` answers `{ …, merged_into: "K" }`, then the kept row; the update is issued with `eq("id", "K")` (mutation: write T → FAILS).
  - `buildMatchIndex`: a row `{ id: "T", email: "a@x.mx", phone: "+19565550401", merged_into: "K" }` maps both keys to `"K"` (mutation: map to `T`).
  - `DELETE_BLOCK_REASONS` includes `"merges"`.
- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/contacts-merge-resolve.test.ts`. Paste the first failing line.
- [ ] **Step 3: Implement.**
  - `COLS`: append `, merged_into` to the ONE literal (`:80-81`). Extend the comment above it with one line: "`merged_into` (0106, F-006): the record page and the drawer redirect a merged-away record to the kept one off the SAME row."
  - `withArchived`: `return (archived === "only" ? f.not("archived_at", "is", null) : f.is("archived_at", null)).is("merged_into", null)` with the `f` type widened to return an object that has `is`; its doc gains "and never a merged-away record (0106), in either view".
  - `findDuplicate`: select `"id, merged_into"` in all three reads (`:283`, `:291`, `:357`); a hit's id is `merged_into ?? id`. Keep every other line. Its comment gains one paragraph: "0106: a merged-away record keeps its phone and email (owner ruling D8), so a hit on it answers the kept record; the one-hop pointer is all there is, because 0106 flattens chains."
  - `flagDuplicatesAfterWrite`, `flagMatchesOf` and `setContactPhoneCountry`'s twin read: `.is("merged_into", null)` beside each `holds_shared_number` filter.
  - `fillContactBlanksReport`: after `getContact`, `if (row.merged_into) { contactId = row.merged_into; row = await getContact(db, accountId, contactId) }` (rename the parameter to `requestedId` and use a local `contactId`), so a call that ends after its customer was merged fills the kept record. Throw as today when the kept row is missing.
  - `DELETE_BLOCK_REASONS`: append `"merges"`.
  - `buildMatchIndex`: select `"id, email, phone, holds_shared_number, merged_into"`; the mapped id is `merged_into ?? id`.
- [ ] **Step 4: Run green** (`src/contacts-merge-resolve.test.ts src/contacts-archive.test.ts src/contacts-phone.test.ts`) and `pnpm --filter @bis/db exec tsc --noEmit -p .` and `pnpm --filter web typecheck`. Paste the three.
- [ ] **Step 5: Live tests (written now, CI only).** `test/contact-merge-lookups-live.test.ts` with `withTestAccount` (`fixtures.ts:140`, `(fn: (db, accountId) => Promise<void>)`), nested for a second account. Make a tombstone directly on the service client (`update contacts set merged_into = K, merged_at = now()`; service_role is not limited by the guard): `createContact` with T's email answers K with `existing: true`; with T's phone, the same; `applyImportBatch` with T's email updates K; `listContacts`/`countContacts` (both views) leave T out while account B's identical contact stays in B's list.
- [ ] **Step 6: The reason pins (correction 6).** The database files the pair before the TypeScript writer runs, so the writer meets 23505 and still answers `flagged: true`. Change exactly these, rename each `it` to say "the database files …" where it now proves the trigger, and add a `flagged` assertion where the test had none, so the TypeScript writer is still covered:

| File:line | Today | After |
|---|---|---|
| `contacts.test.ts:302-322` | `email_match_on_edit` | `same_email`; add `expect(await updateContact(…)).toEqual({ flagged: true })` on the edit |
| `contacts.test.ts:324-341` | `phone_match_on_edit` | `same_phone`; same `flagged` addition |
| `contacts.test.ts:471-488` | `email_match_on_edit` (fill) | `same_email` |
| `contacts.test.ts:490-506` | `phone_match_on_edit` (fill) | `same_phone` |
| `contacts.test.ts:915-937` | `email_phone_conflict` | unchanged (no contact is written; read it and confirm) |
| `contacts.test.ts:1211-1219` | `phone_shared_new_person` | `same_phone` (`beto.flagged` stays true) |
| `contacts.test.ts:1221-1240` | `[]` under matchBy, `phone_country_twin` in the control | `[pair same_digits]` in BOTH; `mx.flagged` false vs `mxB.flagged` true is now what tells the two paths apart, so keep both assertions and rename the test to say so |
| `contacts.test.ts:1242-1260` | the mirrored case | the same change |
| `contacts.test.ts:1265-1286` | `phone_shared_new_person` | `same_phone` |
| `contacts.test.ts:1325-1350` (control in account B) | `phone_country_pick` | `same_phone` |
| `contacts-phone-live.test.ts:20-32`, `:38-50` | `phone_country_twin` | `same_digits` |
| `contacts-phone-live.test.ts:53-75` | `[]` before the pick, then `phone_country_pick` | `[{ reason: "same_digits" }]` before the pick (the direct twin insert is filed by the database at once) and the same single row after it; delete the comment's "Nothing flags the pair before the pick" sentence and the `mutation: drop the pick's flagDuplicatePair` clause from the name (that mutation can no longer fail: say so in your report) |
| `contact-import.test.ts:187-202` | `phone_match_on_edit` | `same_phone`; `flagged: 1` stays |
| `assignee-filters.test.ts:208-231` | `flagMatchesOf` returns 1, reason `hidden_match` | the pair is filed at the second insert: `flagMatchesOf` returns 0, one row, reason `same_phone`; rename to "a shared phone is filed by the database at insert; flagMatchesOf finds it filed and writes nothing" |

  These run in CI only. Before committing, read each changed test against the trigger (T1 section 6) and the seed's names: a case whose two contacts ALSO share a `name_key` gets that pair's strongest reason first (phone, then email, then name). Fixtures with no last name (`"Held"`, `"Other"`, `"Ana"`) never have a name key.
  Then sweep the rest: `grep -rln contact_duplicate_flags packages/db/src/test` names eleven files at `8f191334`. Beyond the four above and T1's three, checked while planning and unchanged: `technician-scope.test.ts:104,157,171` (its seed contacts "Mine", "Theirs", "Open" carry no phone, email or last name, so the trigger adds nothing and `rowCount` stays 1); `contact-dedupe-keys.test.ts:85-109` (service role keeps every privilege on the table; "A" and "B" carry no key); `same-account-fk-schema.test.ts:121-125` (the table still has exactly two FKs into contacts, so PGRST201 holds); `alert-phone-verification-grants.test.ts:155` (a comment). Re-read each and say so in your report; a new file in that grep is yours to read too.
- [ ] **Step 7: Mutation probes** (pure, local, by name): drop `.is("merged_into", null)` from `withArchived`; drop the resolve in `findDuplicate`; resolve AFTER the conflict check; drop the filter from `flagDuplicatesAfterWrite`; write T in `fillContactBlanksReport`; map T in `buildMatchIndex`.
- [ ] **Step 8: Commit** the ten paths: `feat(contacts): a merged-away record leaves every list, and every lookup by phone, email or id lands on the kept record`.

---

### Task 5: The merge wrappers

**Tier:** medium · **Owner:** bis-crm · **Wave:** 2

**Files:** Create `packages/db/src/contact-merge.ts`, `packages/db/src/contact-merge.test.ts` (pure), `packages/db/src/test/contact-merge-live.test.ts` (CI). Modify `packages/db/src/index.ts` (one block after the contacts exports at `:31`).

**Interfaces:** Produces the `contact-merge.ts` block in "Shared facts". Consumes T1's and T3's SQL by name (the pure tests need neither).

- [ ] **Step 1: Pure failing tests.** A fake client that records `rpc(name, args)` and answers per function name, and records `from("contacts")` reads:
  - `listDuplicatePairs` calls `duplicate_pairs_page` with `p_after_*` null on a cold start and the cursor's three values verbatim after (the `createdAt` string unchanged, never re-formatted through a `Date`, which drops microseconds and would repeat or skip a row at a page boundary), clamps `limit` to `1..DUPLICATE_PAGE_MAX + 1`, and maps rows to `DuplicatePair`.
  - `countDuplicatePairs` returns the number; THROWS on `null` (the head-count-null lesson; mutation: `?? 0` → FAILS).
  - `mergeContacts` sends `p_choices`, `p_seen` and `p_actor` (null when absent) and parses each status; an unknown shape THROWS (mutation: return it as `merged`).
  - `undoContactMerge` parses `undone` with `keptNew`/`keptEdits`, and the four refusals.
  - `contactMergePreview` parses `ok` with every `MERGE_COUNT_KEYS` key present as a number, `fields.keep`/`fields.other` as objects and `seen.keep`/`seen.other` as 32-character hex strings (any of them missing or malformed THROWS; mutation: default a missing `seen` to `""` → FAILS).
  - `dismissDuplicatePair` / `undismissDuplicatePair` return the status word.
  - `followMerge`: `merged_into` when set, the id itself when null or no row; throws on an error (mutation: swallow → returns the id).
  - `mergedIdsOf`: reads `contacts` with `eq("merged_into", keepId)` AND `eq("account_id", accountId)` (mutation: drop the account term → FAILS).
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement** `contact-merge.ts` with the exact names and types in "Shared facts". Each function: one RPC (or one read), `if (error) throw new Error(\`<name> failed: ${error.message}\`)`, a strict parse. Add the barrel block:

```ts
// 0106, F-006 part 1: possible duplicates, the merge and its Undo, and the pointer every lookup follows.
export {
  listDuplicatePairs, countDuplicatePairs, duplicatePairsOf, dismissDuplicatePair, undismissDuplicatePair,
  mergeContacts, undoContactMerge, contactMergePreview, followMerge, mergedIdsOf,
  DUPLICATE_PAGE_MAX, MERGE_COUNT_KEYS, MERGE_CHOICE_FIELDS,
  type DuplicatePair, type DuplicatePerson, type DuplicateCursor, type MergeChoice, type MergeInput, type MergeOutcome,
  type UndoMergeOutcome, type MergePreview, type MergeCountKey,
} from "./contact-merge";
```

- [ ] **Step 4: Run green** and `pnpm --filter @bis/db exec tsc --noEmit -p .`. Paste.
- [ ] **Step 5: Live tests (CI).** `contact-merge-live.test.ts`, `withTestAccount` nested for B: two contacts on one phone → `listDuplicatePairs` and `countDuplicatePairs` agree (1) and B's identical pair is not in A's; `dismissDuplicatePair(…, "user_test")` empties both; `undismiss` restores; `mergeContacts` with `actor: "user_test"` and `seen` from `contactMergePreview` → `merged`; a second preview, then an `assigned_to` write that does not stamp `updated_at`, then `mergeContacts` with the stale `seen` → `stale`; `followMerge(other)` = keep; `mergedIdsOf(keep)` = `[other]`; `undoContactMerge` → `undone`; `followMerge(other)` = other.
- [ ] **Step 6: Mutation probes** as named in Step 1, each red by name.
- [ ] **Step 7: Commit** the four paths: `feat(contacts): typed wrappers for possible duplicates, merge, undo and the merge pointer`.

---

### Task 6: Sofía and the tray after a merge

**Tier:** medium · **Owner:** bis-voice · **Wave:** 3

**Files:**
- Modify: `packages/db/src/voice.ts:755-772` (`listContactsOnNumber`)
- Create: `packages/db/src/voice-merge.test.ts` (pure), `packages/db/src/test/voice-merge-live.test.ts` (CI)
- Modify: `apps/web/src/lib/voice/identity/candidates.test.ts` (one case)
- Modify: `apps/web/src/lib/ai-acts/actions.ts:104,129,145,152,173,183` (the field Undo and Redo) and `apps/web/src/lib/ai-acts/actions.test.ts:39` (mock) plus cases
- Modify: `apps/web/src/lib/proposals/kinds/contact-field.ts:54-58,123-160` and `contact-field.test.ts`

**Interfaces:** Consumes `followMerge` (T5) and `merged_into` (T1). `NumberContactRow` does not change.

- [ ] **Step 1: Failing tests.**
  - `voice-merge.test.ts` (fake client): the number read answers `[{ id: "T", …, phone: "+19565550501", merged_into: "K" }]` and the kept read answers `[{ id: "K", first_name: "Ana", …, phone: "+19565550599" }]` → `rows` = `[{ id: "K", first_name: "Ana", …, phone: "+19565550501" }]`: the KEPT person, carrying the TOMBSTONE's phone (the number that matched), so `isCallerIdNumber` keeps them. Mutation: carry K's own phone → FAILS (this is the D8 claim: a call from the number the merge did not keep still reaches the kept customer). A number held by K and by T answers ONE row, K's own (mutation: no de-duplication → two rows). `truncated` is computed from the raw read.
  - `candidates.test.ts`: `realCandidates` over that resolved row keeps K for `+19565550501`; `isShared` is false for `[K]` and true for the unresolved `[K, T]` (the control).
  - `actions.test.ts`: an act on T whose `followMerge` answers K → `restoreContactFieldIf` is called with K (mutation: pass `act.contactId` → FAILS); the revalidated record path is K's.
  - `contact-field.test.ts`: `apply` and `inverse.undo` and `stillHolds` read and write K when the suggestion names T (partial mock: add `followMerge: vi.fn(async () => "K")`).
- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/voice-merge.test.ts` and `pnpm --filter web exec vitest run src/lib/voice/identity src/lib/ai-acts src/lib/proposals/kinds`. Paste one line each.
- [ ] **Step 3: Implement.**
  - `listContactsOnNumber`: select `merged_into` too; collect the kept ids of tombstone rows; read them in ONE query (`select <same columns> … in("id", keptIds).is("merged_into", null).eq("account_id", accountId)`); the answer is the live rows first, then each tombstone row replaced by its kept person with the tombstone's `phone`, skipping an id already present; keep the order (oldest first); `truncated` from the raw length. Doc comment: "0106 (F-006, owner ruling D8): a merged-away record keeps its number, and a call or text from it reaches the kept customer; a kept record and its own tombstone on one number are ONE person (isShared must not read two)."
  - `actions.ts`: in the field Undo and Redo, `const target = await followMerge(db, accountId, act.contactId)` before the reads and the write; use `target` for `getContact`, `restoreContactFieldIf` and the revalidated path.
  - `contact-field.ts`: `contactOrThrow` and the two writers resolve with `followMerge` first; `apply` passes the resolved id to `fillContactBlanksReport` (which also resolves since T4; resolving here keeps `before` read off the right row).
- [ ] **Step 4: Run green** plus `pnpm --filter web typecheck`. Paste.
- [ ] **Step 5: Live (CI).** `voice-merge-live.test.ts`: K and T on `+19565550511` with T a tombstone (service update) → `listContactsOnNumber` answers one row, K; T alone on `+19565550512` and K on another number → one row, K, phone `+19565550512`; account B's contact on the same number never appears in A's answer.
- [ ] **Step 6: Mutations** as named in Step 1.
- [ ] **Step 7: Commit** the listed paths: `feat(voice): a call or text from a merged-away number reaches the kept customer, and Sofía's Undo and the tray write to the kept record`.

---

### Task 7: Threads and mail after a merge

**Tier:** medium · **Owner:** bis-comms · **Wave:** 3

**Files:** Modify `packages/db/src/messaging.ts:121-155` (`ensureConversation`) and beside `:604-610` (a new `incrementUnreadForMessage`), `packages/db/src/index.ts` (the messaging export line `:60-64`: add `incrementUnreadForMessage`), `packages/db/src/inbound-email.ts:118-127` (`findReplyThread`) and `:325-345` (`matchSender`), `apps/web/src/app/api/sms/inbound/route.ts:236-257` (the unread bump), its `route.test.ts` and `route.consent.test.ts` (the `@bis/db` mocks gain `incrementUnreadForMessage`), and `apps/web/src/lib/messages-readers.test.ts:23` (`messaging.ts` count 14 → 15, the why text gains "one message's thread for its unread bump (0106: a merge can move it)"). Create `packages/db/src/messaging-merge.test.ts` (pure), `packages/db/src/test/messaging-merge-live.test.ts` (CI).

**Interfaces:** Consumes `followMerge` (T5), `contact_merges.other_reply_token` (T1), the merge (T3, live tests only).

- [ ] **Step 1: Failing tests (fake client).**
  - `ensureConversation(db, A, "T")`: the thread read for T answers none; `followMerge` (the `contacts` read) answers K; the next read is for K's thread and its id comes back, `created: false`. Mutation: insert for T after the miss → an insert is recorded, FAILS. The hot path (a thread found for the id asked) issues no `contacts` read (mutation: resolve first → an extra read, FAILS).
  - `matchSender(db, A, "K", "old@x.mx")`: K's own `email_key` differs; a read of `contacts` with `eq("merged_into", "K")` and `eq("email_key", <key>)` answers T → `{ contactId: "K", firstName: <K's>, lastName: <K's>, viaGroup: false }`. Mutation: drop that read → `null` (the mail would be held), FAILS.
  - `incrementUnreadForMessage(db, A, "m1")` reads `messages` by `id` AND `account_id` for its `conversation_id` and calls `increment_conversation_unread` with THAT thread (review m7: a merge between the message insert and the bump moved the message, and bumping the thread the route remembered was a silent no-op on a deleted row). A missing message THROWS (mutation: return quietly → FAILS). In `route.test.ts`, the bump is called with the id `createMessage` answered (mutation: `incrementUnreadCount(db, accountId, conversation.id)` as before → FAILS).
  - `findReplyThread(db, token)`: no conversation holds the token; `contact_merges` with `eq("other_reply_token", token)` and `is("undone_at", null)` answers `{ account_id, keep_id: "K" }`; `followMerge(K)` = K; K's thread answers → `{ conversationId: <K's thread>, accountId, contactId: "K", revoked: false, inboundDomain }` (read `inbound_domain` off the account as the main read does). An undone merge's token answers `null` (mutation: drop `is("undone_at", null)`).
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement** the four, each with a one-paragraph comment citing owner ruling D8 (or review m7) and correction 7. In `route.ts`, keep the id `createMessage` returns (`const created = await createMessage(…)`, held in a `let messageId: string | null` declared before the filing `try`) and call `incrementUnreadForMessage(db, accountId, messageId)` in the `if (firstFiling)` block in place of `incrementUnreadCount(db, accountId, conversation.id)`. Every other `incrementUnreadCount` caller is unchanged. `ensureConversation`: on a miss, `const resolved = await followMerge(db, accountId, contactId)`; if it differs, run the same find-or-insert for `resolved` (the 23505 re-select also uses `resolved`); emit `conversation.created` with `contactId: resolved`.
- [ ] **Step 4: Run green** (`src/messaging-merge.test.ts` and the existing pure messaging and inbound tests) plus `pnpm --filter @bis/db exec tsc --noEmit -p .` and `pnpm --filter web exec vitest run src/lib/email/inbound src/app/api/sms/inbound`. Paste.
- [ ] **Step 5: Live (CI).** Merge for real (`mergeContacts` on the service client, `actor`): O's thread had reply token `bbbbbbbbbbbbbbbbbbbbbbbb`; `findReplyThread` of it answers K's thread; after `undoContactMerge` it answers O's restored thread again. `ensureConversation(O)` after the merge answers K's thread; `matchSender(K, <O's email>)` answers K. Account B's merge never answers A's token. A message inserted on O's thread, then a merge, then `incrementUnreadForMessage` for that message bumps K's thread by one.
- [ ] **Step 6: Mutations** as named.
- [ ] **Step 7: Commit** every listed path: `feat(sms): a text or a reply to an old email from a merged-away customer lands on the kept customer's thread, and its unread count follows it`.

---

### Task 8: Reactivation's held release skips a tombstone

**Tier:** medium · **Owner:** bis-automations · **Wave:** 3

**Files:** Modify `packages/db/src/automations.ts:1741-1745` (`getDueReactivationById`). Create `packages/db/src/automations-merge.test.ts` (pure).

- [ ] **Step 1: Failing test** (the `recordingDb` of `automations-archive.test.ts`, copied): `getDueReactivationById` issues `is("merged_into", null)` on its contacts read; a fake that answers no row returns `{ due: null, why: "gone" }`. Mutation: drop the filter → the recorded call lacks it, FAILS.
- [ ] **Step 2: Run red**, paste. **Step 3:** add `.is("merged_into", null)` beside `.is("archived_at", null)` with the comment "0106 (F-006): a merged-away record's address is not a customer to check in with; its held release answers gone (the kept record has its own)." **Step 4: Run green** with `src/automations-archive.test.ts`; paste. **Step 5: Commit** the two paths: `fix(automations): a reactivation held before a merge never goes to the merged-away address`.

---

### Task 9: Merge rows on the timeline

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Modify: `packages/db/src/record.ts` (`TimelineSource`, `TIMELINE_SOURCES` `:277-281`; `TimelineEntry` `:329-362`; a `listContactMergeLog` beside `listContactArchiveLog` `:432-449`; one `settle("merge", …)` after `"archive"` at `:539`)
- Modify: `packages/db/src/test/record.test.ts:305,754,894`
- Create: `packages/db/src/test/record-merge-live.test.ts` (CI)
- Modify: `apps/web/src/lib/record/timeline-rows.ts` (`:57` WHAT map; the row builder, beside `case "archive"` `:206`), `author-mark.ts` (`:81`), `recent-rows.ts` (`:62`), `loaders.ts` (`loadTimeline` `:77-102`), and their tests
- Create: `apps/web/src/lib/contacts/merge-copy.ts`, `merge-copy.test.ts`
- Modify: `ACCT/contacts/[contactId]/activity-timeline.tsx:291-293` and create `activity-timeline.merge.test.ts`; `ACCT/groups/[groupId]/group-timeline.tsx:224-226` and its test
- Modify: `ACCT/contacts/[contactId]/page.test.ts:104` (mock: `mergedIdsOf`, `listTimelinePage`)

**Interfaces:** Produces `TimelineMerge`, the two entry kinds, `"merge"` in `TIMELINE_SOURCES`, and `mergeCountsList`. Consumes `contact_merges` (T1), `mergedIdsOf` and `MergeCountKey` (T5), T2's keys.

- [ ] **Step 1: Failing tests.**
  - `merge-copy.test.ts`: `mergeCountsList({ messages: 12, calls: 3, bookings: 1 }, tr, "en")` = `"12 messages, 3 calls, and 1 appointment"` (whatever `Intl.ListFormat("en", { type: "conjunction" })` joins; assert against `new Intl.ListFormat(…).format([…])` built from the catalogue strings, never a literal comma rule); `"es"` uses `contacts.merge.count.*.es`; zero counts are left out; `{}` → `""`. Mutation: ignore the `One` twin → the `1 appointment` case FAILS.
  - `timeline-rows.test.ts`: a `merge` entry draws `timeline.merged` with the other's display name and the list, `timeline.mergedEmpty` when no counts, `timeline.mergeOtherHidden` when `otherVisible` is false; a `mergeUndone` entry draws `timeline.mergeUndone`; WHAT has `merge: "timeline.what.merge"`.
  - `author-mark.test.ts`: `merge` → person `mergedBy`; `mergeUndone` → person `undoneBy` (mutation: swap them).
  - `recent-rows.test.ts`: both kinds → `null` body.
  - `loaders.test.ts`: `loadTimeline` calls `mergedIdsOf(db, A, "K")` and then `listTimelinePage(db, A, ["K", "T1"], …)`; when `mergedIdsOf` throws it logs and reads `["K"]` (mutation: drop the tombstone ids → FAILS).
  - `activity-timeline.merge.test.ts` (`renderToStaticMarkup`, as `activity-timeline.archive.test.ts` does; decode with `lib/rendered-text.ts`): a `merge` row renders its verb and an icon; a `mergeUndone` row renders its verb. No Undo control yet (T11 adds it).
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement.**
  - `record.ts`: `listContactMergeLog(db, accountId, who, page)`: two reads in the `documents` source's shape (`:516-535`): rows with `keep_id` in `who` paged on `merged_at`, and rows with `undone_at` not null paged on `undone_at` (`withTimelinePage`, `forContacts(…, "keep_id", who)`); select `id, keep_id, other_id, merged_by, merged_at, undo_until, undone_at, undone_by, moved_counts` (NEVER `moved`: it can hold thousands of ids, correction 15); then ONE `contacts` read of the other ids (`select id, first_name, last_name … in("id", otherIds)`) on the caller's client, so RLS decides whether the name shows (`otherVisible`). Entries: `{ kind: "merge", id: String(id), at: merged_at, contactId: keep_id, merge }` and `{ kind: "mergeUndone", id: String(id), at: undone_at, contactId: keep_id, merge }`. Add `settle("merge", () => listContactMergeLog(db, accountId, who, page))` after `"archive"`. `TIMELINE_SOURCES` becomes `[…, "archive", "merge", "suggestions", "ai_acts"]`.
  - `record.test.ts`: `:305` gains `"merge"` after `"archive"`; both `NINE` lists (`:754`, `:894`) gain `"merge"` at the end (rename nothing; the two `TEN`s derive from them).
  - `loaders.ts`: `loadTimeline` reads `mergedIdsOf` first (a failure logs `activity (merge set)` and reads `[contactId]`), then `listTimelinePage(db, accountId, [contactId, ...tombstones], before, { suggestions: true, aiActs: true, onError })`. `readActFacts` keeps the page's `contactId`.
  - `timeline-rows.ts`, `author-mark.ts`, `recent-rows.ts`, `activity-timeline.tsx`, `group-timeline.tsx`: one case each for `"merge"` and `"mergeUndone"` (icons `Merge` and `Undo2` from `lucide-react`, the archive cases' shape). Every exhaustive switch over `entry.kind` must compile: run `pnpm --filter web typecheck` and fix each one it names (`dashboard/styleguide/ai-acts-demo.tsx` builds entries; read whether it switches).
  - The barrel is NOT touched (T7 owns `index.ts` this wave): apps/web names the type as `Extract<TimelineEntry, { kind: "merge" }>["merge"]`; `TimelineEntry` is already exported.
- [ ] **Step 4: Run green** (`pnpm --filter web exec vitest run src/lib/record src/lib/contacts/merge-copy.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]"`), `pnpm --filter web typecheck`, `pnpm --filter @bis/db exec tsc --noEmit -p .`. Paste.
- [ ] **Step 5: Live (CI).** `record-merge-live.test.ts`: merge K ← O on the service client (an `ai_acts` row on O seeded first, from `ai-acts-schema.test.ts`'s seed); `listTimelinePage(db, A, [K, O])` shows the `merge` row AND O's act (correction 11; mutation: read `[K]` only → the act is missing); undo → a `mergeUndone` row; account B's merge never appears in A's page; `listContactTimelinePage(db, A, K).sources` includes `"merge"`.
- [ ] **Step 6: Mutations** as named.
- [ ] **Step 7: Commit** every listed path: `feat(contacts): merge and merge-undone rows on the record and household timelines, with the merged-away record's own history`.

---

### Task 10: Actions, the compare screen, the Possible duplicates view, the To do row

**Tier:** medium · **Owner:** bis-crm · **Wave:** 4

**Files:**
- Create: `ACCT/contacts/merge-actions.ts`, `merge-actions.test.ts`
- Create: `ACCT/contacts/merge/page.tsx`, `merge/loading.tsx`, `merge/merge-screen.tsx`, `merge/merge-screen.test.ts`, `merge/page.test.ts`
- Create: `apps/web/src/lib/contacts/merge-fields.ts`, `merge-fields.test.ts`; `apps/web/src/lib/contacts/duplicates.ts`, `duplicates.test.ts`
- Create: `ACCT/contacts/duplicates-list.tsx`, `duplicates-list.test.ts`
- Modify: `apps/web/src/lib/contacts/view.ts`, `view.test.ts`; `ACCT/contacts/page.tsx`, `page.test.ts`; `ACCT/contacts/export/route.get.test.ts` (one assertion)
- Modify: `ACCT/tasks/page.tsx` (beside the held-email count, `:76-83`), `ACCT/tasks/page.test.ts`
- Modify: `ACCT/technician-guards.test.ts:20-23`

**Interfaces:** Produces the four actions (signatures in "Shared facts"), the compare route, `ContactsView` = `"active" | "archived" | "duplicates"`. Consumes T5's wrappers, T2's keys, T9's `mergeCountsList`.

- [ ] **Step 1: `merge-fields.ts`, red then green.** Pure: `mergeConflicts(keep, other)` (each side the preview's `fields` object) answers the fields both hold differently (`first_name`, `last_name`, `email`, `phone`, `assigned_to`, `language`, and each `custom.<key>` on both sides), each with `{ field, keepValue, otherValue, preselect: "keep" | "other" }`. `preselect` is `"keep"` except for `language`, which follows 0106's rule (staff beats a sign; else the earlier `language_set_at`; mutation: always `"keep"` → the staff case FAILS). `alsoKeeps(keep, other)` lists the fields the rules fill from the other (a blank on the kept side). `otherReach(keep, other, choices)`: the other's phone when the kept phone after the choices differs from it, and the same for email (D8's two lines). Tests: a field equal on both sides is not a conflict (mutation: list every field); a blank is never a conflict; `custom` keys on one side only are not conflicts.
- [ ] **Step 2: `duplicates.ts`, red then green.** `toRowCursor(pair)` = `{ v: \`${pair.strength}|${pair.createdAt}\`, id: pair.id }` for `lib/cursor.ts`'s `encodeCursor`; `fromRowCursor(rc)` answers a `DuplicateCursor` or `undefined` for anything that does not parse (a strength outside 1–9, a `v` without exactly one `|`, an unparseable instant). Total, like `parseCursor` (`lib/cursor.ts:55`). `compareHref(accountId, pair, keep?)` builds `ACCT/contacts/merge?a=…&b=…[&keep=…]`.
- [ ] **Step 3: `merge-actions.ts`, red then green.** Mock `@/lib/auth`, `@/lib/db` and `@bis/db` in the pattern of `archive-actions.test.ts` (read it). Tests:
  - every action refuses a Technician (`seesWholeAccount` false) BEFORE any db call, and a non-uuid id (mutation: drop the role check → a db call is recorded).
  - `mergeContactsAction` validates `choices` (keys in `MERGE_CHOICE_FIELDS` or `custom.`, values `keep`/`other`) and `seen` (two strings matching `/^[0-9a-f]{32}$/`, the preview's md5 fingerprints) and passes them unchanged to `mergeContacts` on `dbForRequest()`; `merged` → `{ ok: true, mergeId, keptId }` and revalidates the list and both record paths; `stale` → `contacts.merge.stale`; every other status and a throw → `contacts.merge.failed` (logged with `loggableError`).
  - `undoMergeAction`: `undone` → `{ ok: true, … }`; `expired` → `contacts.merge.undoExpired`; `later_merge` → `contacts.merge.undoLater`; the rest → `contacts.merge.undoFailed`.
  - dismiss and undismiss: `dismissed`/`restored` → ok; otherwise `contacts.duplicates.dismissFailed`.
  - no action names `serviceDb` (the file must not appear in `in-account-service-reads.test.ts`), and none passes `duringPause` (writes stay refused while paused).
- [ ] **Step 4: The compare screen.** `merge/page.tsx` (server): `const access = await requireNotTechnician(accountId)`; parse `a`, `b`, `keep` (uuids; anything else → `notFound()`); `getContact` both on `dbForRequest()`; a missing one → `notFound()`; a holding record → `notFound()`; a tombstone → `redirect` to the duplicates view. Kept = `keep` when it is one of the two, else the older by `created_at` then `id` (owner ruling D4). Read `contactMergePreview` and `duplicatePairsOf(kept)` (for the reason line) in `Promise.all`; a failed preview, or a refusal status, renders the error state (`contacts.merge.loadFailed`, a Retry link to the same URL). The compared values are the PREVIEW's `fields` (never the two `getContact` rows, which only choose the kept side and catch a holding or merged record), and its `seen` travels to the action unchanged, so the fields shown and the fingerprints checked are one snapshot (correction 19). `merge/loading.tsx`: a skeleton of two columns (rule 7). `merge-screen.tsx` (client): two columns on a desk, one on a phone with the kept record first; each conflict a radio pair with its `preselect`; the also-keeps line; the two reach lines; the moves line (`contacts.merge.moves` with `mergeCountsList`, or `nothingMoves`); "Keep this one instead" a ghost link (`compareHref` with `keep` swapped); Cancel ghost; **Merge** the one primary. On Merge: `mergeContactsAction`; ok → toast `contacts.merge.done` with action `common.undo` calling `undoMergeAction(accountId, mergeId)` (the toast's Undo answers with `contacts.merge.undone` plus `undoneKept`/`undoneEdits` when they apply, or the failure key), then `router.push` to the kept record; `stale` → toast the key and `router.refresh()`; failed → toast the key, nothing moves. `merge-screen.test.ts` tests the exported handlers (the `assignSelected` style, as `archive-controls.test.ts`): Merge sends exactly the choices on screen (mutation: send every field), the toast's Undo calls `undoMergeAction` with the merge id the action returned (mutation: pass the pair), Merge is the only `variant="default"` button in the markup (rule 8).
- [ ] **Step 5: The list.** `view.ts`: `ContactsView` gains `"duplicates"`; `parseView("duplicates")` → `"duplicates"`; `withView` carries it; `archivedFilterOf("duplicates")` → `"exclude"`. `page.tsx`: when `view === "duplicates"` and `seesWholeAccount(access)`, read `listDuplicatePairs(db, accountId, { limit: PAGE_SIZE + 1, after: fromRowCursor(parseCursor(before)) })` and `countDuplicatePairs` and render `<DuplicatesList>` under the title `contacts.duplicates.title` with the count `contacts.duplicates.count`/`One`, the back link `contacts.archived.back`, the pager "Next"/"Back to the start" (`contacts.duplicates.next`/`first`, the 2026-10-17 amendment), and the empty state (title + body, rule 5). A Technician asking for the view gets the active list. The active view's toolbar gains a ghost link "Possible duplicates" (`contacts.duplicates.link`) for `wholeAccount`, beside "Archived". A failed read renders `contacts.duplicates.listFailed` with Retry. `duplicates-list.tsx` (client): one row per pair, `data-duplicate-row={pair.id}`; both names (`contactDisplayName`), the reason in words (`reasonLabel` → `contacts.duplicates.reason.*`), `contacts.duplicates.foundOn`; the whole row is the target (click and Enter → `router.push(compareHref(…))`, a visible `:focus-visible` ring, hover `--surface-3`); "Not the same person" a ghost button that stops propagation and calls `dismissPairAction`, toast `contacts.duplicates.dismissed` with `common.undo` → `undismissPairAction`. No checkbox. Tests: the page passes the parsed cursor and renders the count from `countDuplicatePairs`, never the rows' length (mutation: render `rows.length` → FAILS with count 7 and 3 rows); the row's dismiss does not navigate (mutation: drop `stopPropagation`).
- [ ] **Step 6: The To do row.** `tasks/page.tsx`: when `seesWholeAccount(access)`, read `countDuplicatePairs` best-effort beside `countHeldInboundEmails` (a throw is logged and the row omitted, `:76-83`'s shape); a count above 0 renders one row linking to `../contacts?view=duplicates` with `work.duplicates`/`One`. Test: 3 → the row and the link; 0 → none; a Technician → no read at all (mutation: read for everyone → the recorded call FAILS the Technician case).
- [ ] **Step 7: Pins.** `technician-guards.test.ts:20-23`: add `"contacts/merge/page.tsx"` to `PAGES`. `export/route.get.test.ts`: `?view=duplicates` exports the active contacts (`archived: "exclude"`).
- [ ] **Step 8: Run green**: `pnpm --filter web exec vitest run src/lib/contacts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" src/lib/billing/read-only.test.ts` and `pnpm --filter web typecheck`. Paste both. The last two files must pass UNCHANGED.
- [ ] **Step 9: Mutations** as named in Steps 1–6, each red by name.
- [ ] **Step 10: Commit** every listed path: `feat(contacts): a Possible duplicates view, a compare screen that merges with Undo, and a To do count`.

---

### Task 11: The record line, the drawer line, tombstone redirects, Undo merge on the timeline

**Tier:** medium · **Owner:** bis-frontend · **Wave:** 4 (typecheck and commit AFTER T10 has committed `merge-actions.ts`)

**Files:**
- Create: `ACCT/contacts/duplicate-line.tsx`, `duplicate-line.test.ts`
- Modify: `ACCT/contacts/[contactId]/page.tsx` (`:94-103`: the redirect after the holding redirect; the line in the `space-y-2` block with the archived banner), `page.test.ts`
- Modify: `ACCT/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`
- Modify: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts` (`:40-44`), `route.test.ts`, `route.reads.test.ts`; `apps/web/src/lib/contacts/drawer-summary.ts`, `drawer-summary.test.ts`
- Modify: `ACCT/contacts/[contactId]/activity-timeline.tsx` (the Undo merge control on a `merge` row), `activity-timeline.merge.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/merge-demo.tsx`, `merge-demo.test.ts`; modify `styleguide/page.tsx`

**Interfaces:** Consumes `duplicatePairsOf` (T5), `undoMergeAction` (T10), T9's rows, T2's keys.

- [ ] **Step 1: Failing tests.**
  - `duplicate-line.test.ts` (`renderToStaticMarkup` + `lib/rendered-text.ts`): with pairs `[same_phone with María García, same_name with José]` it renders `contacts.duplicates.banner` naming María and "same phone number", `bannerMoreOne`, and a "Compare" link to `compareHref` of the strongest pair (mutation: render the last pair → FAILS); with `[]` it renders nothing; with `canMerge` false it renders nothing (mutation: ignore `canMerge`).
  - `page.test.ts`: a contact row with `merged_into: "K"` → `redirect` to K's page (mutation: drop the redirect); the page passes `canMerge = seesWholeAccount(access)` to the line, and a Technician's page makes no `duplicatePairsOf` call; a throw from `duplicatePairsOf` costs only the line (the page renders).
  - `route.test.ts`: `getContact` answers a tombstone, then the kept row → the summary is the kept record's, with `contactId: "K"` (mutation: serve the tombstone).
  - `contact-drawer.wiring.test.ts`: the drawer renders the line from the summary's `duplicates` field in its header section, and its "Open full record" link uses the summary's `contactId`.
  - `activity-timeline.merge.test.ts`: a `merge` row with `undoUntil` in the future, no `undoneAt` and `canMerge` true renders a ghost "Undo merge" button whose handler calls `undoMergeAction(accountId, Number(mergeId))` (test the exported handler; mutation: pass the kept id → FAILS); past `undoUntil`, undone, or `canMerge` false → no button.
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement.** `duplicate-line.tsx`: one line, `role="status"` is NOT used (it is not news); text tokens only (`text-[var(--text-2)]`), the reason in words, a ghost "Compare" link. The page: `if (contact.merged_into) redirect(\`/dashboard/accounts/${accountId}/contacts/${contact.merged_into}\`)` directly after the holding redirect; read `duplicatePairsOf` in the page's `Promise.all` only when `seesWholeAccount(access)`, `.catch` → `[]` with a log. The summary route: after `getContact`, a `merged_into` re-reads the kept contact and continues with it; `DrawerSummary` gains `contactId: string` (if absent) and `duplicates: DuplicatePair[]` (read only for `seesWholeAccount`). The timeline's Undo merge: a ghost button, its result toasts `contacts.merge.undone` (with the two optional lines) or the error key, then `router.refresh()`. Styleguide: a `merge-demo.tsx` showing the line and a merge row, both themes, registered on the styleguide page.
- [ ] **Step 4: Run green** and `pnpm --filter web typecheck` (only after T10's commit). Paste.
- [ ] **Step 5: Mutations** as named.
- [ ] **Step 6: Commit** every listed path: `feat(contacts): "may be the same person" on the record and the drawer, merged records open the kept one, and Undo merge on the timeline`.

---

### Task 12: e2e

**Tier:** medium · **Owner:** bis-e2e-qa · **Wave:** 5 (after 0106 is on bis-ci, checklist step 4; CI's own e2e job runs it on its local stack earlier)

**Files:** Create `apps/web/e2e/contacts-merge.spec.ts`.

- [ ] **Step 1: Collision sweep.** `grep -ln "insert\|createContact" apps/web/e2e/*.spec.ts` and read each spec that creates two contacts on the per-run fixture account sharing a phone, an email, or a first name plus a last name, and then opens one of their records. For each: either the pair is hidden (household members on one phone; a relationship between them) or the spec's name locators are scoped (`getByRole("heading", …)`, a `data-*` scope). List each spec and its verdict in your report; fix a locator only by scoping it, never by weakening what it asserts.
- [ ] **Step 2: The spec.** Copy `fullFixture()`, `CLIENT_FIXTURE_FILE` and the timeout header from `contacts-archive.spec.ts:28-60`. Seed two contacts on the fixture account with the SERVICE client by direct insert (`createContact` would dedupe them into one): `"Merge Uno {STAMP}"` and `"Merge Dos {STAMP}"`, both on one phone made unique per run (`+1956555` + 4 digits from `STAMP`), no last names (so no name pair). Then, as the fixture Owner:
  1. Read the list's header total (`m["contacts.count"]` via the catalogue, the archive spec's helper `:104-120`).
  2. Open Uno's record: the line shows `m["contacts.duplicates.reason.samePhone"]` and a "Compare" link.
  3. Compare → the screen shows both names; Uno (older) is marked `m["contacts.merge.keep"]`.
  4. Click **Merge** (`getByRole("button", { name: m["contacts.merge.action"], exact: true })`). The toast reads `m["contacts.merge.done"]` with Uno's name; the page is Uno's record; the timeline shows the merge row.
  5. The list's total is one less than step 1 (relative, never absolute).
  6. Open Dos's old URL: it lands on Uno's record (the redirect).
  7. Click the timeline's "Undo merge": the toast reads `m["contacts.merge.undone"]` with Dos's name; the list's total is back to step 1's.
  8. The Possible duplicates view (`?view=duplicates`) lists the pair again; "Not the same person" removes it with an Undo toast; Undo brings it back.
  `afterAll`: nothing to delete by hand. Both contacts end live and unmerged; `contact_merges` holds an undone row that cascades with them, and the per-run fixture account is torn down whole (`auth.teardown.ts`).
- [ ] **Step 3:** The orchestrator runs the suite (one gate at a time). Paste the spec's lines.
- [ ] **Step 4: Commit** the path: `test(e2e): find a duplicate, merge it, follow the old link, undo it and dismiss a pair, on the fixture account`.

**Mutation probe:** in a scratch copy, make `undoMergeAction` return `{ ok: false, errorKey: "contacts.merge.undoFailed" }` unconditionally; step 7 must fail by name. Revert.

---

### Task 13: After F-118 merges: reconcile with the access log

**Tier:** low · **Owner:** bis-crm · **Wave:** after the orchestrator merges `main` (with F-118) into `feat/dedupe-merge` (checklist step 3)

**Files:** `ACCT/access-log-routes.test.ts` (F-118's T11 file), `ACCT/contacts/merge/page.tsx`, and whatever the merge left in conflict among the files below (read the conflict markers; never pick a side blind).

- [ ] **Step 1:** Classify `ACCT/contacts/merge/page.tsx` as a RECORD that calls `noteOpened` once per contact shown (spec §9: two views), after both contacts are proven and before any markup is returned. Classify `merge-actions.ts`'s four actions as NOT a record ("a write, logged in contact_merges; opens nothing"). The tombstone redirect on the record page logs nothing itself; the kept record's own page load logs the open.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]"` and `pnpm --filter web typecheck`. Paste.
- [ ] **Step 3:** Commit the paths: `chore(contacts): the compare screen logs each customer it shows for the agency (F-118)`.

Expected conflicts when `main` (with F-118) merges in: `ACCT/contacts/[contactId]/page.tsx` (F-118 T7 adds `noteOpened` near `:94-110`; T11 adds the tombstone redirect there: the redirect goes BEFORE `noteOpened`, so a merged-away record is never logged as opened), `ACCT/contacts/page.tsx` (F-118 T7), `apps/web/src/lib/messages.ts` (both add keys; keep both blocks), `apps/web/src/lib/billing/read-only.test.ts` (F-118 edits reason text only), `packages/db/src/account-teardown.ts` (F-118 adds a comment paragraph after `:46`). If F-118 lands before this branch's T10/T11, those tasks meet the same files instead and this task shrinks to Step 1.

---

## Orchestrator and owner checklist (in order)

1. **Wave gates.** Wave 2 starts only after T1's replica proof (Steps 7–10 lines) is in its report and its commit is on the branch. Wave 3 after T3, T4 and T5; wave 4 after T2 and T9.
2. **Push after wave 2 and after wave 4.** CI `verify` builds its own stack from the branch's migrations and runs every `*-live.test.ts` and the four re-pinned live files (T4 Step 6). Read the check runs for the HEAD SHA. The `e2e` job's migration check fails naming 0106 until step 5; that red is expected.
3. **F-118 first.** Wait until F-118's PR (0105) is merged to `main` AND 0105 is on bis-ci. Then `git merge main` into `feat/dedupe-merge` (merge, never rebase or force-push; bis-ci's push refuses a branch missing a migration already in its history). Resolve the conflicts T13 lists, run T13, then rebuild a PG17 replica of 0001–0106 (with 0105) and re-run T1's and T3's schema files and `definer-search-path.test.ts` on it (0105 adds no definer: still 36). Confirm `grep -n "agency_visit\|access_log_page\|note_agency_open" packages/db/supabase/migrations/0106_contact_merge.sql` is empty.
4. **0106 to bis-ci.** `ci-project-setup.yml` (push-dry-run, then push) from `feat/dedupe-merge`, in number order after 0105.
5. **The digest on bis-ci.** Read the client-write digest on bis-ci (the query in `proposals-drop.test.ts:89-97`, read-only) and confirm it equals the value T1 pinned. If not, the replica was not faithful: stop before production.
6. **Local e2e** (T12): check no `screenshots.yml` run is in progress, then one gate at a time.
7. **0106 to production.** Read-only first: `select count(*) from public.contacts; select count(*) from public.contact_duplicate_flags;` (expect about 53 and 0). Apply with MCP `apply_migration`, name `contact_merge`, the file's exact text (ASCII only, no backslash, so the `\u` escape trap does not apply).
8. **Parity** (`docs/runbooks/ci-supabase-project.md`): the new columns, `contact_merges`, the flag columns and policies, every new function's `pg_get_functiondef` md5 and the grants match between bis-ci and production.
9. **What the backfill found** (read-only, production): `select reason, count(*) from public.contact_duplicate_flags group by 1 order by 1;` Report it to the owner in one sentence ("BIS found N possible duplicates across M accounts: …").
10. **PR** from `feat/dedupe-merge`; squash-merge only after `verify` and `e2e` are green FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`).
11. **Owner, after deploy:** open Contacts → Possible duplicates on BIS's own account and decide any pair there (merge or "Not the same person"). No agent merges on a live account.
12. **Roadmap (owner ruling D10, 2026-10-29).** `docs/crm-features.md:1404-1406`: S-12 and F-006 no longer depend on S-04 ("Depends on" becomes "none" for S-12 and "S-12" for F-006), and S-04's row gains "when it lands, the merge also writes one change row per overwritten field (spec 2026-10-29-dedupe-merge §8)". Land it as a `docs(roadmap)` commit, and update the roadmap tracker's rows for F-006 and S-12.
13. **Ledger:** the 23 planning corrections (above), T4 Step 6's one mutation that can no longer fail, and the two deferred items below.

## Deferred (named, not built)

- **The agency dashboard's contact total** (`apps/web/src/app/(dashboard)/dashboard/page.tsx:20`) counts tombstones, as it counts archived contacts (the archive plan's own deferral). One later fix covers both.
- **Revoking `authenticated`'s table DELETE on `contacts`** (the archive plan's M7). The tombstone guard refuses a signed-in delete of a tombstone meanwhile.
- **Removing the TypeScript flag writers** the trigger now duplicates (`flagDuplicatesAfterWrite`, the country-pick flag, `flagMatchesOf`), once their `flagged` answers are read from the queue instead. Not part 1.

## Self-review (done while writing, 2026-10-29)

- **Spec coverage.** §3 keys and queue → T1 (with T4's pins). §4 data model → T1 (pointer, guard, log, queue) and T3 (merge, undo). §5 fields and rows → T3. §6.1 line → T11; §6.2 view → T10; §6.3 To do → T10; §6.4 compare and timeline → T10, T9, T11. §7.1 lookups → T4 (`findDuplicate`, flag writers, `getContact`, import), T6 (`listContactsOnNumber`), T7 (inbound email). §7.2 backstop → T3, plus `ensureConversation` in T7. §7.3 races → T3's lock order and refusals; the SMS FK race is the same `FilingFailed` path the route already has (`route.ts:180-192`, `:247-250`), so no new test is added there: the spec's "two clients, the merge holding the lock" case needs two connections, which `withRollback` cannot give; T3's `stale`/lock tests and CI's route tests cover the halves. §8 who → T1 (`app.may_merge`), T10 (actions). §9 F-118 → T13. §10 copy → T2. §11 tests → each task. §12 → this plan's waves (re-cut: the migration is two high tasks; the query layer two medium ones).
- **Placeholders.** T1's and T3's tables of cases name each seed and the existing file to copy its minimal insert from, rather than inventing NOT NULL column lists; that is deliberate (rule 1: the source wins). T3 section 17 is specified step by step rather than written out: the implementer writes it against T3's own Undo tests, which pin every step, and the ORDER test pins the one place a wrong order would pass review.
- **Type and name consistency.** `already_merged`/`already_undone`, `merged_by_hand`, `MERGE_COUNT_KEYS`, `moved_counts`, `followMerge`, `mergedIdsOf`, `duplicatePairsOf`, `undoMergeAction(accountId, mergeId: number)` and the compare route's `a`/`b`/`keep` are spelled the same in T1, T3, T5, T9, T10, T11 and T12.
- **Probes that could not fail as first written:** the spec's "drop the pick's flagDuplicatePair" (T4 Step 6) cannot fail once the trigger files the pair first; it is removed from the test's name and reported. The spec's "make the trigger SECURITY INVOKER" fails by an error (the restrictive policy refuses the insert), not by a missing row; the case asserts the row as owner, so either failure is red.

# Contacts data — paging, CSV import, CSV export

Design spec, 2026-09-09. Approved by danlo in chat before writing.

Sub-project 1 of the "Option A" sequence chosen from the CRM gap review
(artifact: https://claude.ai/code/artifact/837e2257-ce40-4d4b-9ba5-a9dfc48bf21b).
The remaining pieces of Option A — the weekly ROI email, then review generation
by SMS link — each get their own spec. **This spec is only the contacts list.**

---

## Why this first

Three findings from reading the source on 2026-09-09. All three are defects
rather than missing features, and they are the only items on the gap list
costing money today.

1. **`listContacts` is hard-capped at 100 rows** (`packages/db/src/contacts.ts:206`)
   with no cursor, no next page and no total. A client with 101 contacts cannot
   see the 101st — in the table or in the ⌘K palette. `calls` already paginates
   properly; contacts never got it.
2. **No CSV import.** Zero CSV code in the tree. Every new client's existing
   list is typed in by hand. This is a direct tax on agency onboarding hours and
   the first thing a CRM buyer tests.
3. **No CSV export.** Half a day next to the importer, and it answers the
   "what if we leave?" objection.

Import is also what makes paging *urgent* rather than theoretical: the first
successful import puts most accounts over 100 contacts immediately.

## Scope

**In:** contact list paging + total count; CSV import of contacts (with column
mapping, preview, dedupe); CSV export of the current view.

**Out, deliberately:** opportunity import (danlo's call — contacts-only is
about half the work and covers onboarding); saved views and filters (own spec);
duplicate *merge* for records already in the database (own spec, but it becomes
the obvious next thing once import ships); scheduled or API-based sync.

**No migration.** Every field this needs already exists on `contacts`:
`first_name`, `last_name`, `email`, `phone`, `company_name`, `source`, and the
`custom` jsonb column. Verified against the live schema.

---

## 1. Paging

Follow `calls`, which already solved this — `?before=` cursor, a `PAGE_SIZE`
constant, server-rendered next/prev links, no client state. Do not invent a
second paging idiom.

One thing to fix while passing through: `cursorFrom` is currently a private
function inside `calls/page.tsx` (line 32), not a shared helper. Copying it
would put two copies of the same parsing rule in the tree, and the contacts
version needs a different shape anyway (see the tuple below). Extract it to a
shared module — `lib/cursor.ts` — parameterised over the cursor shape, and have
`calls` use the extracted version. This is a targeted improvement to code the
work already touches, not unrelated refactoring: without it the "don't invent a
second idiom" rule cannot actually be followed.

`listContacts` changes:

- takes `before?: Cursor` and drops the bare `.limit(100)` default
- returns rows plus whether another page exists
- the search `.or()` filter and the cursor apply **together**, so searching a
  large list still pages

### The cursor must be a tuple, not a timestamp

`calls` orders by a timestamp alone. That is safe there and **not safe here**:
an import creates thousands of contacts inside the same millisecond, so
`created_at` is not unique and a timestamp-only cursor silently skips rows at
every page boundary.

The cursor is therefore `(created_at, id)`, compared as a tuple:

```
where (created_at, id) < (:cursor_created_at, :cursor_id)
order by created_at desc, id desc
```

This is the single most important correctness detail in the paging work, and it
is invisible until an import exists — which is precisely why both land together.

### Total count

The header reads "1,284 contacts". `countContacts` already exists
(`contacts.ts:257`) and already does the `{ count: "exact", head: true }` query —
but it counts the whole account and takes no search argument, so on a searched
list it would report the wrong number.

Give it the same optional `search` the list takes, so the count reflects the
filter rather than the page size, and its one existing caller (the account
dashboard, `dashboard/page.tsx:99`) keeps working unchanged by omitting it.

## 2. Import

Flow: **upload → map columns → preview → commit in batches.**

### Parse in the browser

The file is parsed client-side and never uploaded whole. Reasons, in order:

- Next caps Server Action bodies at 1 MB; `next.config.ts` already had to raise
  it to 2 MB for the logo upload, with a comment explaining the 413 it caused.
  A 20,000-row CSV would reintroduce that failure at a worse moment.
- The mapping and preview screens need parsed rows anyway.
- Commit payloads stay small and bounded.

**The server still validates every row.** Client-side parsing is a convenience,
never a trust boundary: email shape, phone normalisation, required-field and
account-scope checks all run server-side on data that arrives as JSON.

### Dependency: Papa Parse

The one new dependency in this spec. RFC-4180 parsing — quoted fields, embedded
commas and newlines, BOM, CRLF, ragged rows — is a well-known source of subtle
bugs, and a hand-rolled parser would be re-implementing it badly. Approved by
danlo.

### Mapping

Auto-match on column name (case- and space-insensitive), then let the user
correct any mapping. Targets:

- the real columns: `first_name`, `last_name`, `email`, `phone`,
  `company_name`, `source`
- **custom fields**, which write into the existing `contacts.custom` jsonb by
  the field's `field_key` (from `custom_fields` where `model = 'contact'`)
- **tags**, one column, comma-separated

Unmapped columns are ignored and named in the preview, so a user can see what
was dropped rather than wondering.

### Matching an existing contact

Match on **email or phone** through the existing `findDuplicate`
(`contacts.ts:72`, module-private — the spec previously named `findByEmail` /
`findByPhone`, which do not exist). It already handles the case that matters:
`(956) 292-1696` and `+19562921696` are the same person, compared on normalised
digits.

**Update semantics, stated precisely:** a non-empty CSV cell overwrites; a blank
CSV cell never overwrites. Re-importing the same file is therefore idempotent.

**Do not reuse `fillContactBlanks` for this.** It exists (`contacts.ts:151`) and
looks like the right helper, but its rule is different by design: it fills
*only* blank fields and never overwrites, because it serves the voice path where
a misheard name must not clobber a good record. Import needs the opposite on a
changed cell — otherwise "export → edit in Excel → re-import" silently applies
nothing, which is the main workflow this feature exists to support. Import uses
`findDuplicate` then `updateContact` with only the non-empty cells in the patch.

### The dedupe path will not survive a large import as-is

`findDuplicate`'s phone fallback, when an exact string match misses, **selects
every non-null phone on the account and compares in memory**. That is correct
and cheap for one contact at a time, which is all it has ever served. Called
once per CSV row it is O(n²): a 5,000-row import into a 5,000-contact account
does 5,000 full scans.

Import therefore builds the match index **once per import**, not per row: one
pass over the account's `id, email, phone`, normalised through the same
`phoneDigits` rule, held for the life of the job and updated as rows are
created. `findDuplicate` itself is left alone — every existing caller is
single-row and correct.

### Tags

Match existing tag names case-insensitively. Names with no match are **not**
created silently and **not** dropped silently: the preview lists them as
"create these N new tags?" behind a checkbox, defaulting to on. Silent creation
lets one typo'd spreadsheet permanently litter the tag list; silent dropping
loses data the user believed they imported.

### Preview

Before anything is written:

> will create **84** · update **12** · **3** rows have errors

Bad rows are listed with their line number and reason, and downloadable as a
CSV so they can be fixed and re-imported. Nothing is written until confirm.

### Commit

Batches of 200 rows through a Server Action. Progress is visible, and a failure
part-way leaves a **knowable** state ("rows 1–600 imported") rather than an
unknown one. Each batch is one transaction.

The import is recorded through `emit` (`packages/db/src/events.ts`) — file name,
counts, and the acting user — so an unexpected jump in contact count has an
explanation on the record.

## 3. Export

Exports **the current view** — the active search, and later the active filters —
not always-everything. Round-trips with import: the column set is exactly the
import's mapping targets, so export → edit in Excel → re-import updates rather
than duplicates.

Streamed rather than buffered, so it is not bounded by `PAGE_SIZE`, and it reads
through the same account-scope checks as the list.

---

## Testing

TDD per CLAUDE.md — every test watched failing for the right reason first.

The tests that carry real weight:

1. **Tuple cursor at a page boundary with identical timestamps.** Seed rows
   sharing one `created_at`, page through, assert every row is seen exactly
   once. Mutating the cursor back to timestamp-only must fail this.
2. **The create-vs-update decision table:** new email → create; matching email →
   update; matching phone, different email → update; blank cell → existing value
   survives.
3. **Round trip.** Export a set, re-import the exact file, assert **zero creates
   and zero field changes**. This is the strongest single test in the design:
   it exercises the parser, the mapping, the match rule and the update semantics
   at once.
4. **Access scope.** An import or export naming another account's contact must
   refuse. Real-db test, since `serviceDb` fixtures are blind to column grants.
5. **Malformed CSV** — quoted commas, embedded newlines, BOM, ragged rows —
   reaches the error list rather than throwing.

## Rollout

One PR, branch off `main`, merged only when CI `verify` and `e2e` are both green
on its head. Order within the branch: paging first (it stands alone and is
independently useful), then export (it makes import testable by producing a
known-good file), then import.

## Decisions on record

| Decision | Chosen | Rejected |
|---|---|---|
| Sequence across the whole gap list | A — fix the floor, then sell the ceiling | Revenue-first; parity sprint; defects-only |
| Import scope | Contacts only | Contacts + opportunities |
| Match behaviour | Update existing | Skip; overwrite; ask per import |
| Preview | Map + preview before commit | Straight-through import |
| Export scope | Current view | Always all; both as separate actions |
| Tags not matching | Offer to create, checkbox in preview | Create silently; drop silently |
| CSV parsing | Papa Parse, client-side | Hand-rolled parser; server-side parse |
| Cursor | `(created_at, id)` tuple | Timestamp only, as `calls` does |

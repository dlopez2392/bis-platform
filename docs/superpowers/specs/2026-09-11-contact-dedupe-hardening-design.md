# Contact dedupe hardening

**Status:** approved in conversation 2026-09-11 (danlo), spec for review.
**Scope:** `packages/db`'s contact dedupe path (`findDuplicate` / `createContact`), one migration, and one line of the CSV import result summary.
**Out of scope, deferred deliberately:** duplicate **merge**. See §2.

## 1. Why this, and not merge

The CRM review marked duplicate detection and merge as Do-next, on the argument that
CSV import shipped on 2026-09-10 and every import from then on can create duplicates
nothing in the product can clean up. Checked against the database and the code before
committing to it, that argument is **half true**, and the half that is false would have
cost a week:

- **There are zero duplicates.** Ten contacts total across both accounts: 0 duplicate
  emails, 0 duplicate normalized phones, 0 duplicate names.
- **Write-time dedupe already exists.** `createContact` calls `findDuplicate` on every
  insert, and the CSV import goes through that same path. Exact normalized email and
  digits-compared phone are already caught. This is why the import milestone's own
  mutation test could not move the duplicate counts — `createContact` re-found the
  duplicate every time.

What genuinely got worse when import shipped is not correctness. It is **cost**: see §3.

Merge is deferred until there is real duplicate data to build and verify it against.
The reparenting it requires is also larger than the review's "M" estimate — eight
tables reference `contacts` with four different delete rules (§6), so a merge that gets
the order wrong destroys the records it exists to preserve.

## 2. What this delivers

1. Dedupe stops scanning. Two indexed lookups replace a per-insert table scan.
2. The case where an incoming contact matches **two different** existing contacts stops
   being silent.
3. Nothing about who wins a match changes, so no existing caller shifts underneath.

## 3. The defect that matters: dedupe scans the account per insert

`findDuplicate`'s phone path has a fast path and a fallback. The fast path is an exact
string match on `contacts.phone`, which uses the `contacts_account_phone` index. The
fallback — reached whenever the two sides disagree on formatting, which is the common
case — does this:

```ts
const { data } = await db.from("contacts").select("id, phone")
  .eq("account_id", accountId).not("phone", "is", null);
const match = (data ?? []).find((row) => phoneDigits(row.phone) === key);
```

Every non-null phone on the account, pulled into memory, **once per inserted contact**.
At ten contacts that is free. At five thousand it is five thousand full scans against
the one Supabase project production runs on — and the CSV import walks straight into it
in 200-row batches. The import did not create this; it made it reachable.

## 4. Normalized keys as generated columns

Migration **0033** adds two generated columns to `contacts`, following the pattern
migration 0030 established for `contacts.sort_name`:

| column | value |
|---|---|
| `phone_key` | digits only, with a leading NANP `1` folded off when the result is 11 digits |
| `email_key` | lowercased, trimmed, `+suffix` stripped from the local part |

Both get an index on `(account_id, <key>)`. `findDuplicate` becomes two indexed equality
lookups with no in-memory comparison and no fallback branch.

The stored `phone` and `email` columns are **not** reshaped. They keep whatever shape
they were entered in; the keys are for comparison only. That is the existing contract of
`phoneDigits` and it does not change.

### 4.1 The risk this introduces, and what pays for it

The phone normalization now exists **twice** — `phoneDigits` in TypeScript and the SQL
expression generating the column — and two implementations of one rule drift silently.
A drifted key does not throw; it just stops matching, which is invisible until somebody
notices duplicate contacts months later.

So this is not optional: a **parity test** runs a table of real inputs through both the
database and `phoneDigits` and asserts they agree, input by input. `packages/db` tests
run against the real database, so this compares the actual generated column rather than a
re-implementation of it. At minimum the table covers `(956) 292-1696`, `+19562921696`,
`956-292-1696`, `19562921696`, `9562921696`, a number with an extension, and an empty
string.

`email_key`'s normalization is expressed once in SQL and once in TypeScript for the same
reason and gets the same treatment in the same test.

## 5. Both lookups always run

Today the email match returns early. It no longer does — both lookups run on every call,
because the second result is the thing worth knowing.

| case | returned | flagged |
|---|---|---|
| neither matches | new contact created | no |
| one matches | that contact | no |
| both match the **same** contact | that contact | no |
| both match **different** contacts | **the email match** | **yes** |

The email match winning is deliberately unchanged. A phone-wins rule is defensible on the
theory that a phone is harder to share than an email, but changing it would shift every
existing caller for no present benefit — there are no duplicates today for it to decide
differently about.

A new table **`contact_duplicate_flags`** records the pair: account, the two contact ids,
a reason, and when. Unique on the **ordered** pair (lower id first) so re-encountering the
same pair does not accumulate rows. `reason` is a text column with exactly one value for
now — `email_phone_conflict`, meaning the email and the phone pointed at different
contacts — rather than a boolean, so a later rule can add a value without a migration. This is the work queue merge will consume on the day
it is built, already populated, rather than having to go find duplicates itself.

### 5.1 One honest surface

There is no merge UI — that is the deferred work. But a flag nobody can see is the kind of
thing this codebase keeps catching, so it gets exactly one surface, at the moment it is
actionable: the **CSV import result summary**, which already reports created and updated
counts, gains a "N possible duplicates flagged" line. **N counts the pairs flagged by
this import run**, not the table's lifetime total — the summary reports what this import
did, and every other number on it already reads that way. No new screen, no link to a
page that does not exist yet.

## 6. Why merge is bigger than it looks (recorded for when it is built)

Eight tables reference `contacts`, with four different delete rules:

| rule | tables | what a naive delete of the loser does |
|---|---|---|
| `RESTRICT` / `NO ACTION` | `bookings`, `conversations`, `opportunities` | blocks the delete |
| `CASCADE` | `notes`, `tasks`, `contact_tags` | **destroys** the loser's notes and tasks |
| `SET NULL` | `calls`, `form_submissions` | **orphans** the call and submission history |

A merge must reparent all eight before the loser is touched, and the cascade rules mean an
error in that order is unrecoverable — on exactly the history a merge exists to preserve.
Whoever builds it should consider a tombstone (`merged_into`) over a delete, so the
operation is reversible.

## 7. Non-goals

- **Fuzzy name matching.** A contact holding only an email and one holding only a phone
  share no field; only a name could bridge them, and that buys false positives. Merging
  two different "John Smith" records is worse than leaving a duplicate. That belongs to
  merge, with a human confirming.
- **Gmail dot-folding.** `john.smith@` and `johnsmith@` are one mailbox *at Gmail only*;
  folding dots globally would wrongly match distinct people elsewhere. Plus-addressing is
  near-universal and is included; dots are not.
- **Reshaping stored values.** The keys are comparison-only.
- **Backfilling or resolving anything.** There is nothing to resolve — zero duplicates.

## 8. Tests

- **Parity** (§4.1): the generated columns against their TypeScript twins, per input.
- **The scan is gone**: `findDuplicate` no longer issues an unfiltered read of the
  account's contacts. This is a claim about code SHAPE — no behavioural test can see a
  path that no longer runs, since both implementations return the same contact — so it is
  pinned by a source read, this repo's established instrument for exactly that
  (`northern-lights.test.ts`, `clerk-layer.test.ts`), with a guard-the-guard assertion so
  renaming the function cannot silently empty it.
- **The four cases in §5's table**, each with its own test, including that a both-match
  case returns the email match *and* writes exactly one flag row.
- **Idempotence**: the same pair flagged twice leaves one row.
- **Unchanged behaviour**: the existing dedupe tests keep passing untouched. Any edit to
  them is a signal to stop — this spec changes performance and adds a flag, not who wins.

## 9. Done means

- `pnpm check`, `pnpm --filter web build`, and the full e2e suite green, each run with its
  exit code read directly.
- Migration 0033 applied via a separate pre-flight read first, per the house rule, and
  recorded so it is never re-applied.
- One named failing test per behavioural claim, reverted and diffed back.

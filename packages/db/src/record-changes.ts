import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorKind } from "./provenance";

/**
 * F-115 part 1 (S-04), Task 4: the reader for `public.record_changes` (migration 0111). The eight
 * types 0111's CHECK already lists; 0112 (Task 3) starts writing the other seven, this reader is
 * generic across all of them from day one.
 */
export type ChangeRecordType =
  | "contact" | "client_group" | "client_group_member" | "place" | "equipment"
  | "opportunity" | "contact_relationship" | "contact_tag";

/** One row of `record_changes`, camelCased. `xact` is `txid_current()`'s bigint as text (never a JS
 *  number: PostgREST can hand back a bigint past Number's safe range). `before`/`after` are the
 *  column's own JSON shape (a scalar for a normal field, an object for `custom`'s before/after is
 *  already the one key's value — the capture trigger stores `custom.<key>` as its own row). */
export type ChangeRow = {
  id: number; recordType: ChangeRecordType; recordId: string; contactId: string | null; clientGroupId: string | null;
  op: "insert" | "update" | "delete"; field: string | null; before: unknown; after: unknown; xact: string;
  authorKind: AuthorKind | null; authorId: string | null; via: string | null; createdAt: string;
};

/** One write, or several close writes by the same person, folded for the timeline (plan Task 4). A
 *  group's `steps` is one entry per original write (one per `xact`), oldest first; `rows` is every
 *  row across every step, for a caller that only wants the flat set. `via`/`authorKind`/`authorId`
 *  come from the group's NEWEST step: the collapse rule already requires every step to share the
 *  same author, so only `via` can differ step to step, and the newest write's reason is the one
 *  that reads truest for a group shown as one timeline row. */
export type ChangeGroup = {
  key: string; recordType: ChangeRecordType; recordId: string; authorKind: AuthorKind | null; authorId: string | null;
  via: string | null; at: string; firstAt: string; steps: ChangeRow[][]; rows: ChangeRow[];
};

/** Plan Task 4 Step 1/2: two writes on the same record by the same person this close together read
 *  as one edit, not two timeline rows. */
export const COLLAPSE_MINUTES = 10;

type Write = {
  recordType: ChangeRecordType; recordId: string; authorKind: AuthorKind | null; authorId: string | null;
  via: string | null; atMs: number; at: string; rows: ChangeRow[];
};

/** One write is every row sharing a transaction (`xact`) on the same record: the capture trigger
 *  (0111 section 4) resolves the author exactly once per transaction and writes it onto every row
 *  that transaction's statement produced, so every row of one write shares the same author and via. */
function toWrites(rows: readonly ChangeRow[]): Write[] {
  const byKey = new Map<string, Write>();
  for (const row of rows) {
    const key = `${row.recordType}:${row.recordId}:${row.xact}`;
    const existing = byKey.get(key);
    if (existing) { existing.rows.push(row); continue; }
    byKey.set(key, {
      recordType: row.recordType, recordId: row.recordId, authorKind: row.authorKind, authorId: row.authorId,
      via: row.via, atMs: Date.parse(row.createdAt), at: row.createdAt, rows: [row],
    });
  }
  return [...byKey.values()];
}

/** F-115 PR E fix (review I2): same author is not enough — a person's own manual edit immediately
 *  before or after their own merge/restore/accepted-suggestion write must never fold with it (the
 *  fold would otherwise either hide the manual edit under `foldVia`'s drop of the merge's own `via`,
 *  or blend the manual edit's `via: null` onto rows that belong to the merge). `via` compares by
 *  `===`, so `null === null` still folds two plain edits together exactly as before. */
function sameAuthor(a: Write, b: Write): boolean {
  return a.authorKind === b.authorKind && a.authorId === b.authorId && a.via === b.via;
}

function toGroup(steps: readonly Write[]): ChangeGroup {
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  return {
    key: `${last.recordType}:${last.recordId}:${last.rows[0]!.xact}`,
    recordType: last.recordType, recordId: last.recordId,
    authorKind: last.authorKind, authorId: last.authorId, via: last.via,
    at: last.at, firstAt: first.at,
    steps: steps.map((s) => s.rows),
    rows: steps.flatMap((s) => s.rows),
  };
}

/**
 * Plan Task 4 Step 1/2 (spec §3): one `ChangeGroup` per write, then adjacent writes on the SAME
 * record by the SAME author within `COLLAPSE_MINUTES` of each other fold into one group (several
 * `steps`). A different author, or a different record, never folds, however close in time. The
 * input's own order does not matter; the writes are re-sorted per record, oldest first, before the
 * collapse walk, and the groups come back in that same (record, then time) order — the caller
 * (record.ts) re-sorts every source's items together by `at` before slicing a page.
 *
 * F-115 PR E fix round 2 (review I1): folding two writes is no longer ONLY an author/time-window
 * question — a group must occupy a CONTIGUOUS run of the merged timeline, or two pages can disagree
 * about where it starts and ends (duplicating or skipping a row at the boundary; see record.ts's own
 * comment on the cursor this produces). `foreignAtMs` is every OTHER entry's own instant this page
 * already read — from every non-"changes" source AND from every OTHER record's own writes (a
 * household page merges several contacts' writes into one list; "foreign" means "not this record",
 * not "not a change row") — sorted once by the caller. Two adjacent writes of the SAME record fold
 * only when NOTHING in that combined set falls STRICTLY between their two instants; anything that
 * does splits them into two groups instead, each still correct on its own. This is necessarily
 * best-effort against what this ONE page actually read (bounded, like every other source here), never
 * a guarantee against an entry this page's own per-source limits left unread.
 */
export function groupChanges(rows: readonly ChangeRow[], foreignAtMs: readonly number[] = []): ChangeGroup[] {
  const writes = toWrites(rows);
  // Every write's own instant counts as a "foreign" blocker for every OTHER record's adjacent pair
  // (never for its own: two writes of the SAME record that are ADJACENT in that record's own
  // time-sorted list can have nothing of their OWN record between them, by definition of adjacent).
  const blockers = [...foreignAtMs, ...writes.map((w) => w.atMs)].sort((a, b) => a - b);
  const hasBetween = (lo: number, hi: number): boolean => blockers.some((t) => t > lo && t < hi);
  const byRecord = new Map<string, Write[]>();
  for (const w of writes) {
    const key = `${w.recordType}:${w.recordId}`;
    const list = byRecord.get(key);
    if (list) list.push(w); else byRecord.set(key, [w]);
  }
  const groups: ChangeGroup[] = [];
  for (const list of byRecord.values()) {
    list.sort((a, b) => a.atMs - b.atMs);
    let current: Write[] = [];
    for (const w of list) {
      const last = current[current.length - 1];
      if (last && sameAuthor(last, w) && w.atMs - last.atMs <= COLLAPSE_MINUTES * 60_000 && !hasBetween(last.atMs, w.atMs)) {
        current.push(w);
      } else {
        if (current.length > 0) groups.push(toGroup(current));
        current = [w];
      }
    }
    if (current.length > 0) groups.push(toGroup(current));
  }
  return groups;
}

/** The ids of the merge, Sofía-act and accepted-suggestion rows ALREADY on this timeline page — read
 *  off those sources' own entries, never fetched again here. */
export type ViaOnPage = { mergeIds: Set<string>; aiActIds: Set<string>; proposalIds: Set<string> };

const VIA = /^(merge|ai_act|proposal|restore):(.+)$/;

/**
 * Plan Task 4 Step 1/2 (spec risk 6; T1 review correction, orchestrator note 2): a change group whose
 * `via` names a merge, an AI act or an accepted suggestion that this SAME page already shows as its
 * own timeline row is dropped here, so the record page never says the same write twice. A `via` that
 * names one NOT on this page is kept (the plan's own test: "kept when the merge row is not on the
 * page"), because the only proof a row exists is that it was actually read — a `via` string proves
 * nothing by itself.
 *
 * `restore:<n>` is never folded, on purpose, however it got there: `via` is a header value a browser
 * sends on the client write path (0111 section 4), so `restore:999` can be forged by anyone who can
 * make an authenticated request, and a forged id must never be read as proof that change row 999
 * exists or build a link to it. There is also no `restoreIds` set to fold against — a put-back is a
 * NEW change row, never a second row for an old one, so there is nothing of its own for it to
 * duplicate on the same page.
 */
export function foldVia(groups: readonly ChangeGroup[], onPage: ViaOnPage): ChangeGroup[] {
  return groups.filter((g) => {
    const m = g.via ? VIA.exec(g.via) : null;
    if (!m) return true;
    const [, kind, id] = m;
    if (kind === "merge") return !onPage.mergeIds.has(id!);
    if (kind === "ai_act") return !onPage.aiActIds.has(id!);
    if (kind === "proposal") return !onPage.proposalIds.has(id!);
    return true; // restore:<n>, sql, seed, or anything else: never folded.
  });
}

type RawChangeRow = {
  id: number; record_type: ChangeRecordType; record_id: string; contact_id: string | null; client_group_id: string | null;
  op: "insert" | "update" | "delete"; field: string | null; before: unknown; after: unknown; xact: number | string;
  author_kind: AuthorKind | null; author_id: string | null; via: string | null; created_at: string;
};

function mapRow(r: RawChangeRow): ChangeRow {
  return {
    id: r.id, recordType: r.record_type, recordId: r.record_id, contactId: r.contact_id, clientGroupId: r.client_group_id,
    op: r.op, field: r.field, before: r.before, after: r.after, xact: String(r.xact),
    authorKind: r.author_kind, authorId: r.author_id, via: r.via, createdAt: r.created_at,
  };
}

const CHANGE_COLUMNS =
  "id, record_type, record_id, contact_id, client_group_id, op, field, before, after, xact, author_kind, author_id, via, created_at";

/**
 * F-115 PR C fix (review C1): a row-level cursor into `record_changes` — `created_at` ALONE is not
 * total, because every row of one write (one transaction) shares the identical instant (0111 section
 * 4: the capture trigger resolves `now()` once per transaction); `id` (the table's own bigint
 * identity) breaks that tie. Never exposed to the browser directly — see `encodeChangeCursorId` below
 * for the one place a value shaped like this DOES travel through a public, UUID-shaped cursor.
 *
 * `id` is OPTIONAL only on the very first external seed a caller cannot derive from a real row
 * (review I2: `record.ts`'s "changes" source, reading the OUTER merged-timeline cursor, which names a
 * row-level id only when the PREVIOUS page's last entry actually was a "change"). Without it,
 * `listChangeRows` filters on `created_at` alone — correct whenever `createdAt` does not exactly match
 * an unread row in THIS table (the overwhelmingly common case: that instant came from a different
 * source's row). Every cursor `listChangeRowsNoPartialWrite` builds INTERNALLY, from a row it actually
 * read, always carries both fields.
 */
export type ChangeRowCursor = { createdAt: string; id?: number };

/**
 * `col.lt.v OR (col.eq.v AND id.lt.n)`, quoted on the timestamp — the exact idiom
 * `timelineBeforeFilter` (timeline-cursor.ts) uses for a UUID id, except `id` here is a plain bigint:
 * never quoted or case-folded, just checked as a safe positive integer, so a value this module did not
 * itself produce can never reach the PostgREST filter grammar.
 *
 * F-115 PR E fix (review I1), briefly unused, restored in round 2 (re-review I1) once `listChangeRows`
 * (its own doc comment) and record.ts's cursor construction both went back to a REAL row's own
 * consistent `(created_at, id)` pair rather than a group-level pair that could mismatch two rows.
 */
export function changeRowBeforeFilter(column: string, before: { createdAt: string; id: number }): string {
  if (!Number.isSafeInteger(before.id) || before.id <= 0) {
    throw new TypeError("changeRowBeforeFilter: id must be a safe positive integer");
  }
  const v = `"${before.createdAt}"`;
  return `${column}.lt.${v},and(${column}.eq.${v},id.lt.${before.id})`;
}

/**
 * F-115 PR C fix (review I2): the "change" timeline entry's own `id`, in the one shape every reader of
 * the merged timeline already accepts — `apps/web/src/lib/cursor.ts`'s `parseTimelineCursor` and
 * `packages/db/src/timeline-cursor.ts`'s `timelineBeforeFilter` both require a UUID-shaped string for
 * EVERY kind's id, and `record_changes.id` is a plain bigint. Zero-padded to 32 hex digits and dashed
 * into the 8-4-4-4-12 shape: always matches the UUID regex, AND — because every encoding is the same
 * fixed width — sorts, as a lowercase-hex STRING (exactly how `compareTimelineEntries` and
 * `timelineBeforeFilter` compare ids), in the identical order the underlying integer would. `id` is
 * always positive (the table's `generated always as identity` starts at 1).
 */
export function encodeChangeCursorId(id: number): string {
  const hex = id.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CURSOR_ID_SHAPE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

/**
 * The exact inverse of `encodeChangeCursorId`, recognising ONLY a cursor id this module itself could
 * have produced — never trusted as proof anything exists by itself (the same caution `foldVia`'s own
 * doc comment already applies to a forged `via`). `null` for anything else, including a REAL random
 * UUID from a different source's row: interpreted as a 128-bit integer, a random UUID is virtually
 * never below `Number.MAX_SAFE_INTEGER` (about one chance in 2^75), so `Number.isSafeInteger` already
 * rejects it almost always; the round-trip re-encode is the exact, not probabilistic, check.
 */
export function decodeChangeCursorId(v: string): number | null {
  const m = CURSOR_ID_SHAPE.exec(v);
  if (!m) return null;
  const n = parseInt(m.slice(1, 6).join(""), 16);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return encodeChangeCursorId(n).toLowerCase() === v.toLowerCase() ? n : null;
}

/**
 * Plan Task 4 Step 2: on the caller's own client, so RLS (0111 section 6: Owners, Staff and the
 * agency; a Technician reads none) decides what comes back — there is no service-role path here. One
 * contact's (or a merge's tombstones') rows, or one household/business's own rows, newest first,
 * strictly before `before` when given.
 *
 * F-115 PR C fix (review C1): `before` is now the row-value idiom (`created_at`, `id`), not
 * `created_at` alone — every row of one write shares the identical `created_at` (0111 section 4), so
 * filtering on the timestamp alone would drop whichever of that write's rows did not make the
 * PREVIOUS page, forever (the next page's `created_at < before` excludes them too, since they share
 * that exact value). `before` is undefined for a cold start, exactly as before.
 *
 * F-115 PR E fix (review I1), REVERTED in round 2 (re-review I1): `id < before.id` ALONE briefly
 * replaced this (`record_changes.id` is `generated always as identity`, a monotonic insert-order
 * sequence) because the group-level cursor record.ts built had paired a MISMATCHED `(createdAt, id)` —
 * the group's NEWEST step's time with its OLDEST step's row id — and `id` alone sidesteps a mismatch
 * that `(created_at, id)` cannot. But `id` is assigned at INSERT time, while `created_at` is the
 * capture trigger's `now()` at TRANSACTION START (0111 section 4); a long-running transaction can
 * start before, and insert after, a short one that starts later — id order and created_at order then
 * disagree, and since the OUTER merged timeline sorts and pages by `at` (created_at), filtering
 * `record_changes` by `id` alone can SKIP a row whose id is smaller but whose created_at is actually
 * newer than the cursor (review round 2, case e). record.ts no longer builds a mismatched pair (its
 * own comment on `changesEntries` explains the fix: the group's own OLDEST STEP's `createdAt`, paired
 * with the SMALLEST id among THAT step's own rows — always one real write's own consistent pair), so
 * `changeRowBeforeFilter`'s `(created_at, id)` idiom is safe again, and — because created_at is the
 * PRIMARY bound, id only a same-instant tie-break — no longer vulnerable to id/time divergence either.
 */
export async function listChangeRows(
  db: SupabaseClient, accountId: string, scope: { contactIds: string[] } | { groupId: string },
  before: ChangeRowCursor | undefined, limit: number,
): Promise<ChangeRow[]> {
  if ("contactIds" in scope && scope.contactIds.length === 0) return [];
  let q = db.from("record_changes").select(CHANGE_COLUMNS).eq("account_id", accountId);
  q = "contactIds" in scope ? q.in("contact_id", scope.contactIds) : q.eq("client_group_id", scope.groupId);
  if (before) {
    q = before.id !== undefined
      ? q.or(changeRowBeforeFilter("created_at", { createdAt: before.createdAt, id: before.id }))
      : q.lt("created_at", before.createdAt);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`listChangeRows failed: ${error.message}`);
  return ((data ?? []) as RawChangeRow[]).map(mapRow);
}

/**
 * F-115 PR C fix (review I2): `listChangeRows` paged so it never cuts a write — "page on the row
 * cursor and group after." A write's rows all share one `created_at` (0111 section 4), so a batch is
 * only safe to hand to the grouper once nothing OLDER-OR-EQUAL to its own last row's instant remains
 * unread: phase 1 pages normally (the lossless row cursor) until `minRows` rows are in hand or the
 * source is exhausted; phase 2 then probes, one row at a time, for any sibling still sharing the LAST
 * kept row's exact `created_at` and absorbs it, repeating until a strictly older row (or none) turns
 * up — which is the first row of what the NEXT page will read, left there on purpose, never consumed
 * here. `pageSize` bounds each individual fetch (phase 1 and every phase-2 probe).
 *
 * `hasMore` answers "does anything OLDER than what I'm returning exist in this scope" — true exactly
 * when phase 2's last probe found that strictly-older row (proof positive), false when a probe (or
 * phase 1 itself) found nothing at all. The caller (record.ts) needs this because grouping can
 * collapse many rows into ONE timeline entry, so "did I return fewer than `minRows` rows" cannot
 * stand in for "is there a next page" the way it does for every other, non-collapsing source.
 */
export async function listChangeRowsNoPartialWrite(
  db: SupabaseClient, accountId: string, scope: { contactIds: string[] } | { groupId: string },
  before: ChangeRowCursor | undefined, minRows: number, pageSize: number,
): Promise<{ rows: ChangeRow[]; hasMore: boolean }> {
  const rows: ChangeRow[] = [];
  let cursor = before;
  let exhausted = false;
  while (rows.length < minRows) {
    const chunk = await listChangeRows(db, accountId, scope, cursor, pageSize);
    if (chunk.length === 0) { exhausted = true; break; }
    rows.push(...chunk);
    const last = chunk[chunk.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (chunk.length < pageSize) { exhausted = true; break; }
  }
  let hasMore = false;
  while (!exhausted && rows.length > 0) {
    const last = rows[rows.length - 1]!;
    const probe = await listChangeRows(db, accountId, scope, cursor, 1);
    if (probe.length === 0) break; // truly exhausted: nothing older exists at all
    const next = probe[0]!;
    if (next.createdAt !== last.createdAt) { hasMore = true; break; } // the next page's own first row; left unread on purpose
    rows.push(next);
    cursor = { createdAt: next.createdAt, id: next.id };
  }
  return { rows, hasMore };
}

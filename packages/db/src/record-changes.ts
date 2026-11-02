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

function sameAuthor(a: Write, b: Write): boolean {
  return a.authorKind === b.authorKind && a.authorId === b.authorId;
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
 */
export function groupChanges(rows: readonly ChangeRow[]): ChangeGroup[] {
  const writes = toWrites(rows);
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
      if (last && sameAuthor(last, w) && w.atMs - last.atMs <= COLLAPSE_MINUTES * 60_000) {
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
 * Plan Task 4 Step 2: on the caller's own client, so RLS (0111 section 6: Owners, Staff and the
 * agency; a Technician reads none) decides what comes back — there is no service-role path here. One
 * contact's (or a merge's tombstones') rows, or one household/business's own rows, newest first,
 * strictly before `before` when given (the page's own cursor value, never re-fetched past it).
 */
export async function listChangeRows(
  db: SupabaseClient, accountId: string, scope: { contactIds: string[] } | { groupId: string },
  before: string | undefined, limit: number,
): Promise<ChangeRow[]> {
  if ("contactIds" in scope && scope.contactIds.length === 0) return [];
  let q = db.from("record_changes").select(CHANGE_COLUMNS).eq("account_id", accountId);
  q = "contactIds" in scope ? q.in("contact_id", scope.contactIds) : q.eq("client_group_id", scope.groupId);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(`listChangeRows failed: ${error.message}`);
  return ((data ?? []) as RawChangeRow[]).map(mapRow);
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * F-006 part 1 (migration 0106, Task 5): the typed wrappers around the merge RPCs (`merge_contacts`,
 * `undo_contact_merge`, `contact_merge_preview`, the open-pairs trio and dismiss/undismiss), plus the
 * two plain reads every other domain follows a tombstone through (`followMerge`, `mergedIdsOf`).
 *
 * Every wrapper fails CLOSED: a database error throws, and an answer that is not one of the RPC's own
 * documented shapes throws too, rather than being coerced into a default status. The pure half of this
 * file's tests is `contact-merge.test.ts` (a fake client); the live half, against the real RPCs on the
 * CI project (0106 is not on bis-ci yet, so this file never runs locally against any Supabase project)
 * is `test/contact-merge-live.test.ts`.
 */

export type DuplicatePerson = { id: string; firstName: string | null; lastName: string | null };
export type DuplicatePair = {
  id: string; a: DuplicatePerson; b: DuplicatePerson; reason: string; strength: number; createdAt: string;
};
export type DuplicateCursor = { strength: number; createdAt: string; id: string };

/** `duplicate_pairs_page`'s own ceiling (`least(greatest(coalesce(p_limit, 50), 1), 101)`); the wrapper
 *  clamps to the same range so a caller's raw opts.limit never reaches PostgREST unclamped. */
export const DUPLICATE_PAGE_MAX = 100;

type RawPairRow = {
  id: string; contact_a: string; contact_b: string; reason: string; strength: number; created_at: string;
  a_first_name: string | null; a_last_name: string | null; b_first_name: string | null; b_last_name: string | null;
};

function mapPairRow(row: RawPairRow): DuplicatePair {
  return {
    id: row.id,
    a: { id: row.contact_a, firstName: row.a_first_name, lastName: row.a_last_name },
    b: { id: row.contact_b, firstName: row.b_first_name, lastName: row.b_last_name },
    reason: row.reason,
    strength: row.strength,
    createdAt: row.created_at,
  };
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? DUPLICATE_PAGE_MAX;
  // `??` only replaces null/undefined, never NaN — a caller that passes NaN (a bad query-string parse,
  // say) would otherwise fall straight through Math.trunc/max/min, every one of which answers NaN right
  // back, and `JSON.stringify(NaN)` is `null`, so the RPC would silently receive no limit at all rather
  // than the caller's mistake surfacing anywhere. Fails closed instead (review T4-fix).
  if (Number.isNaN(n)) throw new Error("clampLimit: NaN is not a valid limit");
  return Math.min(Math.max(Math.trunc(n), 1), DUPLICATE_PAGE_MAX + 1);
}

/**
 * `duplicate_pairs_page`: the possible-duplicates list, strongest-first then newest-first. The cursor's
 * three values travel to PostgREST EXACTLY as the caller passed them (never re-formatted through a
 * `Date`, which rounds to milliseconds and would repeat or skip a row at a page boundary where two pairs
 * share a `created_at` to the microsecond).
 */
export async function listDuplicatePairs(
  db: SupabaseClient, accountId: string, opts: { limit?: number; after?: DuplicateCursor } = {},
): Promise<DuplicatePair[]> {
  const { data, error } = await db.rpc("duplicate_pairs_page", {
    p_account_id: accountId,
    p_limit: clampLimit(opts.limit),
    p_after_strength: opts.after?.strength ?? null,
    p_after_created_at: opts.after?.createdAt ?? null,
    p_after_id: opts.after?.id ?? null,
  });
  if (error) throw new Error(`listDuplicatePairs failed: ${error.message}`);
  return ((data ?? []) as RawPairRow[]).map(mapPairRow);
}

/** `duplicate_pairs_count`: the same open pairs `listDuplicatePairs` pages, as one number. THROWS on a
 *  null answer (the head-count-null lesson: a failure read as zero reports an empty list as healthy). */
export async function countDuplicatePairs(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.rpc("duplicate_pairs_count", { p_account_id: accountId });
  if (error) throw new Error(`countDuplicatePairs failed: ${error.message}`);
  if (typeof data !== "number") throw new Error("countDuplicatePairs failed: no count returned");
  return data;
}

/** `duplicate_pairs_of`: at most 20 open pairs naming this one contact, strongest first (the record's own line). */
export async function duplicatePairsOf(db: SupabaseClient, accountId: string, contactId: string): Promise<DuplicatePair[]> {
  const { data, error } = await db.rpc("duplicate_pairs_of", { p_account_id: accountId, p_contact_id: contactId });
  if (error) throw new Error(`duplicatePairsOf failed: ${error.message}`);
  return ((data ?? []) as RawPairRow[]).map(mapPairRow);
}

type StatusAnswer = { status?: unknown };
function statusOf(data: unknown): string | undefined {
  const s = (data as StatusAnswer | null)?.status;
  return typeof s === "string" ? s : undefined;
}

/** `dismiss_duplicate_pair`: "not the same person", for good, with Undo (`undismissDuplicatePair`). */
export async function dismissDuplicatePair(
  db: SupabaseClient, accountId: string, flagId: string, actor?: string,
): Promise<"dismissed" | "not_found"> {
  const { data, error } = await db.rpc("dismiss_duplicate_pair", { p_account_id: accountId, p_flag_id: flagId, p_actor: actor ?? null });
  if (error) throw new Error(`dismissDuplicatePair failed: ${error.message}`);
  const status = statusOf(data);
  if (status === "dismissed" || status === "not_found") return status;
  throw new Error(`dismissDuplicatePair: unexpected answer ${JSON.stringify(data)}`);
}

/** `undismiss_duplicate_pair`: the dismiss's own Undo. */
export async function undismissDuplicatePair(
  db: SupabaseClient, accountId: string, flagId: string, actor?: string,
): Promise<"restored" | "not_found"> {
  const { data, error } = await db.rpc("undismiss_duplicate_pair", { p_account_id: accountId, p_flag_id: flagId, p_actor: actor ?? null });
  if (error) throw new Error(`undismissDuplicatePair failed: ${error.message}`);
  const status = statusOf(data);
  if (status === "restored" || status === "not_found") return status;
  throw new Error(`undismissDuplicatePair: unexpected answer ${JSON.stringify(data)}`);
}

/** A failed merge RPC, carrying PostgREST's error code (a SQLSTATE such as `40P01` deadlock or `23503`
 *  a foreign key violation) beside the message — `undoMergeAction` (apps/web) reads `.code` to tell a
 *  blocked Undo (something the merge re-inserts was deleted since) from any other failure. */
export class MergeRpcError extends Error {
  constructor(message: string, readonly code: string | undefined) { super(message); }
}

/** Postgres's deadlock_detected. */
const MERGE_DEADLOCK = "40P01";
/** How many times a merge RPC runs again after a deadlock (one retry: two calls at most) — fix round,
 *  carry-in 4, the same shape as client-groups.ts:52-56. `merge_contacts` and `undo_contact_merge` are
 *  each one transaction, so a 40P01 rolled all of it back and running the call again is safe; a SECOND
 *  40P01 surfaces as the usual failure (the action layer already maps any thrown error to
 *  contacts.merge.failed/undoFailed). */
const MERGE_DEADLOCK_RETRIES = 1;

/** The two merge RPCs' own call, retrying a deadlock once; every other error (including a second
 *  deadlock) throws a `MergeRpcError` carrying PostgREST's code. `wrapperName` names the THROWING
 *  function (`mergeContacts`/`undoContactMerge`), never the RPC's own snake_case name, matching the
 *  message shape both wrappers already carried before this helper existed. */
async function mergeRpc<T>(
  db: SupabaseClient, rpcName: string, wrapperName: string, args: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db.rpc(rpcName, args);
    if (!error) return data as T;
    const code = (error as { code?: string }).code;
    if (code === MERGE_DEADLOCK && attempt < MERGE_DEADLOCK_RETRIES) continue;
    throw new MergeRpcError(`${wrapperName} failed: ${error.message}`, code);
  }
}

export type MergeChoice = "keep" | "other";
export const MERGE_CHOICE_FIELDS = ["first_name", "last_name", "email", "phone", "assigned_to", "language"] as const;

/** `seen`: the two fingerprints `contactMergePreview` answered, sent back unchanged (plan correction 19);
 *  `merge_contacts` answers `stale` when either side no longer matches what the screen showed. */
export type MergeInput = {
  keepId: string; otherId: string; choices: Readonly<Record<string, MergeChoice>>;
  seen: { keep: string; other: string }; actor?: string;
};
export type MergeOutcome =
  | { status: "merged"; mergeId: number; moved: Record<string, number> }
  | { status: "same" | "not_found" | "holding" | "already_merged" | "stale" };

const MERGE_REFUSALS = ["same", "not_found", "holding", "already_merged", "stale"] as const;

/** `merge_contacts`: p_other into p_keep. Fails closed — an answer that is not exactly "merged" with a
 *  numeric mergeId and a moved object, or one of the five named refusals, throws rather than being read
 *  as a success (mutation: coercing an unknown shape to "merged" would silently report a merge that the
 *  database never made). */
export async function mergeContacts(db: SupabaseClient, accountId: string, input: MergeInput): Promise<MergeOutcome> {
  const data = await mergeRpc<unknown>(db, "merge_contacts", "mergeContacts", {
    p_account_id: accountId, p_keep: input.keepId, p_other: input.otherId,
    p_choices: input.choices, p_seen: input.seen, p_actor: input.actor ?? null,
  });
  const r = data as { status?: unknown; mergeId?: unknown; moved?: unknown } | null;
  if (
    r?.status === "merged" && typeof r.mergeId === "number" && typeof r.moved === "object" && r.moved !== null
    // "an object" alone let a non-numeric count through silently, read as a real per-table total by the
    // timeline's counts phrase (mutation: drop this check -> a string count reaches the caller unflagged).
    && Object.values(r.moved).every((v) => typeof v === "number")
  ) {
    return { status: "merged", mergeId: r.mergeId, moved: r.moved as Record<string, number> };
  }
  const refusal = MERGE_REFUSALS.find((s) => s === r?.status);
  if (refusal) return { status: refusal };
  throw new Error(`mergeContacts: unexpected answer ${JSON.stringify(data)}`);
}

export type UndoMergeOutcome =
  | { status: "undone"; otherId: string; keptNew: number; keptEdits: string[] }
  | { status: "not_found" | "already_undone" | "expired" | "later_merge" };

const UNDO_REFUSALS = ["not_found", "already_undone", "expired", "later_merge"] as const;

/** `undo_contact_merge`: within 30 days, newest-merge-first. Fails closed on any shape it does not name. */
export async function undoContactMerge(
  db: SupabaseClient, accountId: string, mergeId: number, actor?: string,
): Promise<UndoMergeOutcome> {
  const data = await mergeRpc<unknown>(
    db, "undo_contact_merge", "undoContactMerge", { p_account_id: accountId, p_merge_id: mergeId, p_actor: actor ?? null },
  );
  const r = data as { status?: unknown; otherId?: unknown; keptNew?: unknown; keptEdits?: unknown } | null;
  if (r?.status === "undone" && typeof r.otherId === "string" && typeof r.keptNew === "number" && Array.isArray(r.keptEdits)) {
    return { status: "undone", otherId: r.otherId, keptNew: r.keptNew, keptEdits: r.keptEdits.map(String) };
  }
  const refusal = UNDO_REFUSALS.find((s) => s === r?.status);
  if (refusal) return { status: refusal };
  throw new Error(`undoContactMerge: unexpected answer ${JSON.stringify(data)}`);
}

export const MERGE_COUNT_KEYS = ["messages", "calls", "bookings", "documents", "opportunities", "notes", "tasks", "form_submissions"] as const;
export type MergeCountKey = (typeof MERGE_COUNT_KEYS)[number];

export type MergePreview =
  | {
      status: "ok"; counts: Record<MergeCountKey, number>;
      fields: { keep: Record<string, unknown>; other: Record<string, unknown> }; seen: { keep: string; other: string };
    }
  | { status: "same" | "not_found" | "holding" | "already_merged" };

const PREVIEW_REFUSALS = ["same", "not_found", "holding", "already_merged"] as const;
const HEX32 = /^[0-9a-f]{32}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `contact_merge_preview`: the compare screen's one read. The `fields` and `seen` an "ok" answer carries
 *  are read as a strict shape — every `MERGE_COUNT_KEYS` key present and numeric, both `fields` sides
 *  plain objects, both `seen` sides 32-character hex — so a missing piece throws rather than being
 *  defaulted (mutation: defaulting a missing `seen` side to `""` would let the screen show a fingerprint
 *  `merge_contacts`' own stale check could never actually match). */
export async function contactMergePreview(db: SupabaseClient, accountId: string, keepId: string, otherId: string): Promise<MergePreview> {
  const { data, error } = await db.rpc("contact_merge_preview", { p_account_id: accountId, p_keep: keepId, p_other: otherId });
  if (error) throw new Error(`contactMergePreview failed: ${error.message}`);
  const r = data as { status?: unknown; counts?: unknown; fields?: unknown; seen?: unknown } | null;
  if (r?.status === "ok") {
    const rawCounts = r.counts;
    const fields = r.fields;
    const seen = r.seen;
    if (!isPlainObject(rawCounts) || !isPlainObject(fields) || !isPlainObject(seen)) {
      throw new Error(`contactMergePreview: unexpected answer ${JSON.stringify(data)}`);
    }
    const counts = {} as Record<MergeCountKey, number>;
    for (const key of MERGE_COUNT_KEYS) {
      const v = rawCounts[key];
      if (typeof v !== "number") throw new Error(`contactMergePreview: missing or non-numeric count "${key}"`);
      counts[key] = v;
    }
    const keepFields = fields.keep;
    const otherFields = fields.other;
    if (!isPlainObject(keepFields) || !isPlainObject(otherFields)) {
      throw new Error("contactMergePreview: fields.keep and fields.other must both be objects");
    }
    const keepSeen = seen.keep;
    const otherSeen = seen.other;
    if (typeof keepSeen !== "string" || typeof otherSeen !== "string" || !HEX32.test(keepSeen) || !HEX32.test(otherSeen)) {
      throw new Error("contactMergePreview: seen.keep and seen.other must both be 32-character hex strings");
    }
    return { status: "ok", counts, fields: { keep: keepFields, other: otherFields }, seen: { keep: keepSeen, other: otherSeen } };
  }
  const refusal = PREVIEW_REFUSALS.find((s) => s === r?.status);
  if (refusal) return { status: refusal };
  throw new Error(`contactMergePreview: unexpected answer ${JSON.stringify(data)}`);
}

/** Fix round, carry-in 6: the KEPT side of one merge row, so `undoMergeAction` can revalidate that
 *  record's page too (`undo_contact_merge`'s own JSON never echoes it back — only `otherId`). Null when
 *  no such merge row exists in this account; the caller's own status check already covers that case. */
export async function mergeKeptIdOf(db: SupabaseClient, accountId: string, mergeId: number): Promise<string | null> {
  const { data, error } = await db.from("contact_merges").select("keep_id")
    .eq("account_id", accountId).eq("id", mergeId).maybeSingle();
  if (error) throw new Error(`mergeKeptIdOf failed: ${error.message}`);
  return (data as { keep_id: string } | null)?.keep_id ?? null;
}

/**
 * The backstop every other domain calls before it writes: `merged_into` when the contact is a tombstone,
 * the id itself when it is not (or no row at all, which a deleted or never-existed id both answer the
 * same way — the caller's own read already decided whether the id should exist). THROWS on a database
 * error rather than swallowing it and answering the id as if nothing were wrong (that would send a write
 * straight at a hidden, merged-away record with no sign anything had gone wrong at all).
 */
export async function followMerge(db: SupabaseClient, accountId: string, contactId: string): Promise<string> {
  const { data, error } = await db.from("contacts").select("merged_into")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`followMerge failed: ${error.message}`);
  const row = data as { merged_into: string | null } | null;
  return row?.merged_into ?? contactId;
}

/** The tombstones pointing AT `keepId` — one hop, because 0106 flattens a chain of merges onto the
 *  record currently kept. Scoped to the account as well as the pointer, so a cross-tenant id collision
 *  (impossible in practice, since `merged_into` carries contacts' own account-scoped FK) can never widen
 *  what a caller on one account sees. */
export async function mergedIdsOf(db: SupabaseClient, accountId: string, keepId: string): Promise<string[]> {
  // 0106 flattens a chain of merges onto the record currently kept, so this is ordinarily a handful of
  // rows — but a corrupt or adversarial account must never make an unbounded read (review T4-fix).
  const { data, error } = await db.from("contacts").select("id")
    .eq("account_id", accountId).eq("merged_into", keepId).limit(1000);
  if (error) throw new Error(`mergedIdsOf failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorKind } from "./provenance";
import type { RowAuthor } from "./provenance";
import { requireAuthor, withAuthor } from "./row-author";
import type { ChangeRecordType, ChangeRow } from "./record-changes";
import { DOCUMENT_TRASH_DAYS } from "./document-rules";
import { restoreEquipment, restorePlace, type EquipmentRow, type PlaceRow, type PlaceCtx } from "./places";
import { restoreMembership, type GroupMemberSnapshot } from "./client-groups";
import { restoreRelationship } from "./relationships";
import type { RelationshipRow } from "./relationship-keys";
import { serviceDb } from "./service";

/**
 * F-115 Task 6 (spec §2.4; plan Task 6): "Put back" a changed field from `record_changes`, and
 * "Restore" a removed unit, member, tag, relationship or place for `RESTORE_DAYS`. Every write here
 * is a NEW row in the log (`via restore:<changeId>`); history is never rewritten.
 */

/** Spec §9 Q4: trash lives on each record for as long as a Document stays in its own trash
 *  (`document-rules.ts`'s `DOCUMENT_TRASH_DAYS`, 30). One constant, never two 30s that could drift. */
export const RESTORE_DAYS = DOCUMENT_TRASH_DAYS;
const RESTORE_MS = RESTORE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Put back (Rule 2): audited columns of these six types only. `client_group_member` and
 * `contact_tag` are Restore-only (plan Task 6 Rule 2's own type list omits them); a field change on
 * either never offers "Put back", even though `client_group_member`'s own fields ARE audited and do
 * generate update rows. `custom.<key>` is handled separately (only `contact` has a put-back RPC
 * today, `put_back_contact_custom`; see `canPutBack` below).
 */
const PUT_BACK_FIELDS: Readonly<Partial<Record<ChangeRecordType, readonly string[]>>> = {
  contact: ["first_name", "last_name", "email", "phone", "assigned_to", "dnd", "source", "marketing_email_opted_out_at", "language"],
  client_group: ["name", "kind", "billing_address"],
  place: ["label", "address", "landmark", "directions", "city", "region", "postal_code", "country", "archived_at", "contact_id", "client_group_id"],
  equipment: ["name", "make", "model", "serial", "notes", "installed_on", "warranty_until", "replaces_id"],
  opportunity: ["name", "pipeline_id", "stage_id", "status", "monetary_value", "assigned_to"],
  contact_relationship: [
    "related_contact_id", "label_key", "custom_label", "contact_form", "related_form",
    "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency",
  ],
};

/** The table a put-back's compare-and-swap writes to, by record type. Deliberately NOT a list for
 *  `client_group_member`/`contact_tag`: neither is in `PUT_BACK_FIELDS`, so `canPutBack` already
 *  refuses them before this map is ever read. */
const RECORD_TABLE: Readonly<Partial<Record<ChangeRecordType, string>>> = {
  contact: "contacts", client_group: "client_groups", place: "places", equipment: "equipment",
  opportunity: "opportunities", contact_relationship: "contact_relationships",
};

/**
 * F-115 PR C fix (review I3): fields that would otherwise qualify above but can never safely run
 * through the GENERIC compare-and-swap (`casUpdatePutBack`) — checked before anything else in
 * `canPutBack`, so each is refused `not_allowed` no matter what `PUT_BACK_FIELDS`/the custom-field
 * branch below would otherwise say.
 *   - "contact.dnd": jsonb. `casUpdatePutBack`'s CAS guard is a plain `.eq(field, after)`; `.eq` with
 *     a JS object serializes to the literal string "[object Object]" in the query, which can never
 *     genuinely match the live value — a guard that can never pass is not a guard, it is a silent no-op
 *     (or worse, a silent wrong match, depending on what a coincidental string happens to compare to).
 *   - "contact.custom" (bare, no `.<key>` suffix): only `custom.<key>` has a real compare-and-swap
 *     (`put_back_contact_custom`, keyed by ONE key). A bare `custom` row claims the WHOLE jsonb blob
 *     changed in one write, which this file has no per-key-safe way to put back.
 *   - "place.contact_id"/"place.client_group_id": coupled by `places_one_owner` (0069) — a place has
 *     EXACTLY one owner. Putting either column back alone, while the other still holds its "after"
 *     value, can leave a place with zero or two owners, which the table itself then refuses (or,
 *     worse, silently satisfies by coincidence if the other side also happens to be null).
 */
const PUT_BACK_EXCLUDED: ReadonlySet<string> = new Set([
  "contact.dnd", "contact.custom", "place.contact_id", "place.client_group_id",
]);

/** Postgres codes a put-back's own write can hit that mean "the write refused it," never a crash and
 *  never `history.notFound`: check_violation (23514), invalid_text_representation (22P02,
 *  e.g. a stale snapshot value that no longer casts to the column's type) and invalid_parameter_value
 *  (22023). Read as the honest-enough twin of a stale compare-and-swap: either way, nothing changed. */
const PG_REFUSED_WRITE: ReadonlySet<string> = new Set(["23514", "22P02", "22023"]);

/**
 * Pure (plan Task 6 Step 1). True only for an `update` row whose `field` is one of the type's own
 * AUDITED columns (a fresh, hand-built `ChangeRow` naming an EXCLUDED column, or a type this file
 * does not offer "Put back" for, both answer false — this does not merely trust `row.op === "update"`).
 * `custom.<key>` is put-back-eligible ONLY for `contact` (the only `put_back_contact_custom`-style RPC
 * that exists today); `opportunity.custom.<key>` and `client_group.custom.<key>` are AUDITED (they do
 * show on the timeline) but have no compare-and-swap function of their own yet (see the report).
 * `PUT_BACK_EXCLUDED` is checked FIRST, so it overrides every other true-producing branch below it.
 */
export function canPutBack(row: ChangeRow): boolean {
  if (row.op !== "update" || row.field === null) return false;
  if (PUT_BACK_EXCLUDED.has(`${row.recordType}.${row.field}`)) return false;
  if (row.field === "custom" || row.field.startsWith("custom.")) return row.recordType === "contact";
  const fields = PUT_BACK_FIELDS[row.recordType];
  return fields !== undefined && fields.includes(row.field);
}

/** Restore (Rule 3): these five types' own delete rows, and no others. */
const RESTORABLE_TYPES: ReadonlySet<ChangeRecordType> =
  new Set(["equipment", "client_group_member", "contact_tag", "contact_relationship", "place"]);

function isRestorableKind(row: ChangeRow): boolean {
  return row.op === "delete" && RESTORABLE_TYPES.has(row.recordType);
}

/**
 * Pure (plan Task 6 Step 1). False for the wrong op/type (see `isRestorableKind`) OR once
 * `RESTORE_DAYS` have passed since `row.createdAt`, true for every day up to and including day 29
 * (the boundary is `<`, so exactly `RESTORE_DAYS` days out is already false).
 */
export function canRestore(row: ChangeRow, now: Date): boolean {
  if (!isRestorableKind(row)) return false;
  return now.getTime() - Date.parse(row.createdAt) < RESTORE_MS;
}

/**
 * Plan Task 6 Rule 4: change ids are bigint, but `record_changes` is `generated always as identity`
 * starting at 1 — at one row per second it would take over 285 million years to pass
 * `Number.MAX_SAFE_INTEGER` (2^53), and the already-merged reader (`record-changes.ts`'s `ChangeRow.id`)
 * already chose `number`. Matching that chosen representation (rather than adding a second, string-based
 * one for only this task) is the deliberate choice here; this function is the refusal half of Rule 4:
 * a non-digit string, a string over 19 characters (more digits than a signed bigint can ever hold), a
 * negative or non-integer number, or a number past `Number.MAX_SAFE_INTEGER` all answer `null` rather
 * than being coerced into something that silently reads back the wrong row.
 */
export function parseChangeId(v: number | string): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (!/^[0-9]{1,19}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type RawChangeRow = {
  id: number; record_type: ChangeRecordType; record_id: string; contact_id: string | null; client_group_id: string | null;
  op: "insert" | "update" | "delete"; field: string | null; before: unknown; after: unknown; xact: number | string;
  author_kind: AuthorKind | null; author_id: string | null; via: string | null; created_at: string;
};
const CHANGE_ROW_COLUMNS =
  "id, record_type, record_id, contact_id, client_group_id, op, field, before, after, xact, author_kind, author_id, via, created_at";

/**
 * One change row by id, on the CALLER's own client: RLS (0111 section 6) decides what comes back, so
 * a Technician's own client reads nothing here (`not_found`, never a thrown refusal) and a wrong
 * account answers the same way. There is no service-role path in this read, on purpose (plan
 * correction 5's INVOKER rule applies the same way here as `listChangeRows`'s own doc comment says).
 */
async function getChangeRow(db: SupabaseClient, accountId: string, changeId: number): Promise<ChangeRow | null> {
  const { data, error } = await db.from("record_changes").select(CHANGE_ROW_COLUMNS)
    .eq("account_id", accountId).eq("id", changeId).maybeSingle();
  if (error) throw new Error(`record-restore: change row read failed: ${error.message}`);
  if (!data) return null;
  const r = data as RawChangeRow;
  return {
    id: r.id, recordType: r.record_type, recordId: r.record_id, contactId: r.contact_id, clientGroupId: r.client_group_id,
    op: r.op, field: r.field, before: r.before, after: r.after, xact: String(r.xact),
    authorKind: r.author_kind, authorId: r.author_id, via: r.via, createdAt: r.created_at,
  };
}

/** A field whose column is `timestamptz`: `to_jsonb`'s text rendering uses the WRITING session's own
 *  time zone (0111/0112's header comment), so two renderings of the SAME instant can differ by their
 *  numeric offset ("+00" vs "-05", plan Task 6's own test case). These two are the only `timestamptz`
 *  columns in `PUT_BACK_FIELDS` (every DATE column — `installed_on`, `warranty_until` — has no offset
 *  to disagree about, and every other audited field is a plain scalar or uuid). */
const TIMESTAMP_FIELDS: ReadonlySet<string> = new Set(["marketing_email_opted_out_at", "archived_at"]);

/**
 * F-115 PR C fix (review I3): the shared ending for every put-back write below. `PG_REFUSED_WRITE`
 * (23514/22P02/22023) reads as "the write refused it" — the honest-enough twin of a stale
 * compare-and-swap, so it answers `"changed"` too, logged WITH its code (never silently dropped);
 * anything else still throws, as every write here always has.
 */
function changedOrThrow(context: string, error: { message: string; code?: string }): "changed" {
  if (error.code !== undefined && PG_REFUSED_WRITE.has(error.code)) {
    console.error(`record-restore: ${context} refused (${error.code}): ${error.message}`);
    return "changed";
  }
  throw new Error(`record-restore: ${context} failed: ${error.message}`);
}

/**
 * The generic compare-and-swap a plain audited column's Put back runs (Rule 2): `update {[field]:
 * before} where id = recordId and field still equals after`, `.is()` for a null `after`, `.select("id")`
 * so zero rows reads as "changed". For the two `timestamptz` columns this reads the LIVE value first
 * and compares PARSED instants (never the stored `after` text) against it, then guards the write with
 * that SAME live text — never the `after` jsonb's own rendering — so the guard can never fail only
 * because the two renderings chose different offsets for one instant.
 */
async function casUpdatePutBack(
  db: SupabaseClient, table: string, accountId: string, recordId: string, field: string,
  before: unknown, after: unknown, author: RowAuthor, via: string,
): Promise<"put_back" | "changed"> {
  if (TIMESTAMP_FIELDS.has(field)) {
    const { data: cur, error: curErr } = await db.from(table).select(`id, ${field}`)
      .eq("account_id", accountId).eq("id", recordId).maybeSingle();
    if (curErr) throw new Error(`record-restore: ${table} read failed: ${curErr.message}`);
    if (!cur) return "changed";
    const liveRaw = (cur as unknown as Record<string, unknown>)[field] as string | null;
    const liveMs = liveRaw === null ? null : Date.parse(liveRaw);
    const afterMs = after === null ? null : Date.parse(after as string);
    if (liveMs !== afterMs) return "changed";
    let q = withAuthor(db.from(table).update({ [field]: before }), author, via)
      .eq("account_id", accountId).eq("id", recordId);
    q = liveRaw === null ? q.is(field, null) : q.eq(field, liveRaw);
    const { data, error } = await q.select("id");
    if (error) return changedOrThrow(`${table}.${field} update`, error);
    return (data ?? []).length === 0 ? "changed" : "put_back";
  }
  let q = withAuthor(db.from(table).update({ [field]: before }), author, via)
    .eq("account_id", accountId).eq("id", recordId);
  q = after === null ? q.is(field, null) : q.eq(field, after as string | number | boolean);
  const { data, error } = await q.select("id");
  if (error) return changedOrThrow(`${table}.${field} update`, error);
  return (data ?? []).length === 0 ? "changed" : "put_back";
}

/**
 * `custom.<key>` put-back (Rule 2): the RPC `put_back_contact_custom` IS the compare-and-swap (its own
 * `where (custom -> key) is not distinct from expected`), so this is a thin pass-through. `false`
 * (a stale key) and `null` (no row, or RLS hides it) both read as "changed", never thrown.
 */
async function putBackCustom(
  db: SupabaseClient, accountId: string, contactId: string, key: string,
  expected: unknown, value: unknown, author: RowAuthor, via: string,
): Promise<"put_back" | "changed"> {
  const { data, error } = await withAuthor(db.rpc("put_back_contact_custom", {
    p_account_id: accountId, p_contact_id: contactId, p_key: key,
    p_expected: expected ?? null, p_value: value ?? null,
  }), author, via);
  if (error) return changedOrThrow("put_back_contact_custom", error);
  return data === true ? "put_back" : "changed";
}

/**
 * `language` put-back (Rule 2's own "Language" case): `language_source`/`language_set_at` are NOT
 * audited columns (only `language` itself generates a change row), so this reads the CURRENT full
 * triple first — both to compare `language` against the history row's `after` and to guard the write
 * with the exact, freshly-read text (the same offset-mismatch reasoning as `TIMESTAMP_FIELDS` above,
 * since `language_set_at` is itself a `timestamptz`). Putting a value BACK is a fresh staff decision,
 * not a byte-exact replay: it stamps `language_source: "staff"` and `language_set_at: now` (matching
 * `setContactLanguage`'s own two columns), never the source that happened to be live before this edit,
 * which history does not even carry. Putting `language` back to NULL clears the other two together
 * (0076's `contacts_language_coherent`: all three null, or all three set).
 * The READ runs on the caller's own client (RLS-scoped); the WRITE runs on `serviceDb()`, because
 * `language`/`language_source`/`language_set_at` are not in the authenticated column UPDATE grant on
 * `contacts` (0053:137-140) — exactly why `setContactLanguage`/`restoreContactLanguage` both already
 * write on `serviceDb()` (apps/web's `contacts/actions.ts`).
 */
async function putBackLanguage(
  db: SupabaseClient, accountId: string, contactId: string, before: unknown, after: unknown, author: RowAuthor, via: string,
): Promise<"put_back" | "changed"> {
  const { data: cur, error: curErr } = await db.from("contacts")
    .select("language, language_source, language_set_at").eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (curErr) throw new Error(`record-restore: contact language read failed: ${curErr.message}`);
  if (!cur) return "changed";
  const row = cur as { language: string | null; language_source: string | null; language_set_at: string | null };
  if (row.language !== (after as string | null)) return "changed";
  const beforeLang = before as string | null;
  const patch = beforeLang === null
    ? { language: null, language_source: null, language_set_at: null }
    : { language: beforeLang, language_source: "staff", language_set_at: new Date().toISOString() };
  // language/language_source/language_set_at are NOT in the authenticated column UPDATE grant on
  // contacts (0053): setContactLanguage/restoreContactLanguage both write them on serviceDb() for
  // exactly this reason (apps/web's contacts/actions.ts), so this does too, with the FULL header
  // (service path, step 4) since there is no user-client path for this write at all.
  let q = withAuthor(serviceDb().from("contacts").update(patch), author, via).eq("account_id", accountId).eq("id", contactId);
  q = row.language === null ? q.is("language", null) : q.eq("language", row.language);
  q = row.language_source === null ? q.is("language_source", null) : q.eq("language_source", row.language_source);
  q = row.language_set_at === null ? q.is("language_set_at", null) : q.eq("language_set_at", row.language_set_at);
  const { data, error } = await q.select("id");
  if (error) return changedOrThrow("contact language update", error);
  return (data ?? []).length === 0 ? "changed" : "put_back";
}

/**
 * Put back a changed value (Rule 2). `not_found`: no such row, or the caller's own RLS hides it (a
 * Technician's client, or another account's id) — the CALLER never learns which. `not_allowed`:
 * the row exists but is not this kind of write (`canPutBack(row)` is false — wrong op, an EXCLUDED
 * field, `client_group_member`, `contact_tag`, or a `custom.<key>` outside `contact`). `changed`: the
 * live value no longer equals the row's `after` (a stale compare-and-swap). Every successful write is
 * a NEW change row (`via restore:<changeId>`), never a rewrite of this one.
 */
export async function putBackChange(
  db: SupabaseClient, accountId: string, changeId: number, author: RowAuthor,
): Promise<"put_back" | "changed" | "not_found" | "not_allowed"> {
  author = requireAuthor(db, author, "putBackChange");
  const row = await getChangeRow(db, accountId, changeId);
  if (!row) return "not_found";
  if (!canPutBack(row)) return "not_allowed";
  const via = `restore:${changeId}`;
  if (row.recordType === "contact" && row.field === "language") {
    return putBackLanguage(db, accountId, row.recordId, row.before, row.after, author, via);
  }
  if (row.field!.startsWith("custom.")) {
    const key = row.field!.slice("custom.".length);
    return putBackCustom(db, accountId, row.recordId, key, row.after, row.before, author, via);
  }
  const table = RECORD_TABLE[row.recordType]!;
  return casUpdatePutBack(db, table, accountId, row.recordId, row.field!, row.before, row.after, author, via);
}

/** Where a place's or a unit's restored row reports in the record's own event payload (places.ts's
 *  `PlaceCtx.subjectId`/`subjectKind`) — read off the change row's OWN `contactId`/`clientGroupId`,
 *  which 0112's capture already resolved for equipment from its place at write time. */
function placeSubject(row: ChangeRow): { subjectId: string; subjectKind: "contact" | "group" } {
  if (row.contactId) return { subjectId: row.contactId, subjectKind: "contact" };
  if (row.clientGroupId) return { subjectId: row.clientGroupId, subjectKind: "group" };
  return { subjectId: row.recordId, subjectKind: "contact" };
}

/** `PlaceDbError`/`RelationshipDbError` both carry PostgREST's SQLSTATE as `.code` (places.ts,
 *  relationships.ts); read structurally rather than importing either class only for an instanceof. */
function sqlstateOf(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? (e as { code?: string }).code : undefined;
}

/** F-115 PR C fix (review I3): the shared tail of every restore writer's catch block — 23505 and
 *  23503 unchanged (already_back / parent_gone); `PG_REFUSED_WRITE` (23514/22P02/22023, the old
 *  snapshot no longer fitting a constraint or type added since the row was deleted) now answers
 *  "failed", logged with its code, rather than throwing (never `history.notFound` either). */
function restoreOutcomeOf(e: unknown): "already_back" | "parent_gone" | "failed" | undefined {
  const code = sqlstateOf(e);
  if (code === "23505") return "already_back";
  if (code === "23503") return "parent_gone";
  if (code !== undefined && PG_REFUSED_WRITE.has(code)) {
    const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e);
    console.error(`record-restore: restore refused (${code}): ${message}`);
    return "failed";
  }
  return undefined;
}

async function restorePlaceRow(
  db: SupabaseClient, accountId: string, row: ChangeRow, author: RowAuthor, via: string,
): Promise<"restored" | "parent_gone" | "already_back" | "failed"> {
  const snapshot = row.before as PlaceRow;
  const ctx: PlaceCtx = { ...placeSubject(row), author };
  try {
    await restorePlace(db, accountId, snapshot, ctx, via);
    return "restored";
  } catch (e) {
    const outcome = restoreOutcomeOf(e);
    if (outcome) return outcome;
    throw e;
  }
}

async function restoreEquipmentRow(
  db: SupabaseClient, accountId: string, row: ChangeRow, author: RowAuthor, via: string,
): Promise<"restored" | "parent_gone" | "already_back" | "failed"> {
  const snapshot = row.before as EquipmentRow;
  const ctx: PlaceCtx = { ...placeSubject(row), author };
  try {
    await restoreEquipment(db, accountId, snapshot, ctx, via);
    return "restored";
  } catch (e) {
    const outcome = restoreOutcomeOf(e);
    if (outcome) return outcome;
    throw e;
  }
}

async function restoreRelationshipRow(
  db: SupabaseClient, accountId: string, row: ChangeRow, author: RowAuthor, via: string,
): Promise<"restored" | "parent_gone" | "already_back" | "failed"> {
  const snapshot = row.before as RelationshipRow;
  try {
    await restoreRelationship(db, accountId, snapshot, author, via);
    return "restored";
  } catch (e) {
    const outcome = restoreOutcomeOf(e);
    if (outcome) return outcome;
    throw e;
  }
}

/**
 * `restore_group_membership` (via `restoreMembership`) is service_role only (0069's grants, plan
 * Task 6's own reading note) AND its own `app.restore_member` answers "ok" for BOTH a fresh insert
 * and an already-present member, with no FK violation either way ("group/contact gone" is an explicit
 * existence check, never a thrown 23503). Neither distinction `restoreRemoved` promises comes from an
 * error code here, so this pre-checks existence (on the caller's own client — Owners/Staff already
 * read their account's groups) before ever calling the writer, then maps the writer's own "not_found"
 * (which means ONLY "group or contact gone": the already-a-member path never reaches it) to
 * `parent_gone`.
 *
 * F-115 PR C fix (review m1): "already back" is the (client_group_id, contact_id) PAIR, not the
 * ORIGINAL row's own id — a member re-added since the delete is a NEW `client_group_members` row (a
 * different id, the SAME pair), and that must answer `already_back` too, never a second "restored".
 * The pre-check still has a race window (two callers could both pass it before either inserts); a
 * 23505 from that race on the writer's own insert answers the same way, logged with its code.
 */
async function restoreMembershipRow(
  db: SupabaseClient, accountId: string, row: ChangeRow, author: RowAuthor, via: string,
): Promise<"restored" | "parent_gone" | "already_back" | "failed"> {
  const snapshot = row.before as GroupMemberSnapshot;
  const { data: existing, error: exErr } = await db.from("client_group_members").select("id")
    .eq("account_id", accountId).eq("client_group_id", snapshot.client_group_id).eq("contact_id", snapshot.contact_id)
    .maybeSingle();
  if (exErr) throw new Error(`record-restore: membership existence read failed: ${exErr.message}`);
  if (existing) return "already_back";
  try {
    const result = await restoreMembership(serviceDb(), accountId, snapshot, author, via);
    return result === "ok" ? "restored" : "parent_gone";
  } catch (e) {
    const outcome = restoreOutcomeOf(e);
    if (outcome) return outcome;
    throw e;
  }
}

/**
 * No existing writer inserts a specific `contact_tags` row by tag id (`addTagToContact` finds or
 * creates a tag BY NAME, which cannot reproduce the exact `(contact_id, tag_id)` pair history names,
 * and has no `via` of its own — plan Task 6's report explains the choice not to reuse it). `before`'s
 * only columns are `contact_id`, `tag_id`, `account_id` (0003: `contact_tags` has no `id`), so a plain
 * named-column insert is the whole job; the table's own foreign keys (both ON DELETE CASCADE) are
 * exactly `parent_gone`'s 23503 and the primary key is exactly `already_back`'s 23505 — no pre-check
 * needed, unlike membership above.
 */
async function restoreTagRow(
  db: SupabaseClient, accountId: string, row: ChangeRow, author: RowAuthor, via: string,
): Promise<"restored" | "parent_gone" | "already_back" | "failed"> {
  if (!row.contactId) throw new Error("record-restore: contact_tag change row has no contactId");
  const { error } = await withAuthor(db.from("contact_tags").insert({
    contact_id: row.contactId, tag_id: row.recordId, account_id: accountId,
  }), author, via);
  if (!error) return "restored";
  const outcome = restoreOutcomeOf(error);
  if (outcome) return outcome;
  throw new Error(`record-restore: contact_tags insert failed: ${error.message}`);
}

/**
 * Restore a removed unit, member, tag, relationship or place (Rule 3). `not_found`/`not_allowed` as
 * `putBackChange`'s own doc comment describes (here: the row's op isn't `delete`, or its type is not
 * one of the five). `expired`: `canRestore` says the 30-day window has passed. Every write re-inserts
 * `before` with the SAME id, through that type's existing writer, `via restore:<changeId>`.
 */
export async function restoreRemoved(
  db: SupabaseClient, accountId: string, changeId: number, author: RowAuthor, now: Date,
): Promise<"restored" | "expired" | "parent_gone" | "already_back" | "not_found" | "not_allowed" | "failed"> {
  author = requireAuthor(db, author, "restoreRemoved");
  const row = await getChangeRow(db, accountId, changeId);
  if (!row) return "not_found";
  if (!isRestorableKind(row)) return "not_allowed";
  if (!canRestore(row, now)) return "expired";
  const via = `restore:${changeId}`;
  switch (row.recordType) {
    case "place": return restorePlaceRow(db, accountId, row, author, via);
    case "equipment": return restoreEquipmentRow(db, accountId, row, author, via);
    case "contact_relationship": return restoreRelationshipRow(db, accountId, row, author, via);
    case "client_group_member": return restoreMembershipRow(db, accountId, row, author, via);
    case "contact_tag": return restoreTagRow(db, accountId, row, author, via);
    default: return "not_allowed"; // unreachable: isRestorableKind already limited row.recordType to the five above
  }
}

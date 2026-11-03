"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { putBackChange, restoreRemoved, parseChangeId, type RowAuthor } from "@bis/db";

/** Whatever `dbForRequest()` resolves to (archive-actions.ts's own pattern): avoids a direct
 *  `@supabase/supabase-js` import, which is not a dependency of the web app. */
type RequestDb = Awaited<ReturnType<typeof dbForRequest>>;

/**
 * F-115 Task 6 (plan Task 6; spec §2.4): Put back a changed value, and Restore a removed unit,
 * member, tag, relationship or place for 30 days. Beside `archive-actions.ts`, whose role check this
 * reuses exactly (Owners, Staff and the agency; never Technicians — Q3's own rule), because this is
 * the SAME "who may change a customer's record" question, not a new one.
 *
 * The group record page (`groups/[groupId]/page.tsx`) imports these same two actions directly, the
 * way it already imports `PlacesCard` from this same `contacts/` directory (S-03 part 2's own
 * precedent): `putBackChange`/`restoreRemoved` need only `accountId` and `changeId`, never a
 * contact or group id, so a second "twin" file beside the group page would just re-export these —
 * which is not what the plan's "if its actions live there" condition asks for once the existing
 * convention is a shared file, not a per-record-type one (see the report's Deviations section).
 */

export type HistoryActionResult =
  | { ok: true; undo: { changeId: number | null } }
  | { ok: false; message: string };

type RawRecordRef = {
  id: number; contact_id: string | null; client_group_id: string | null;
  record_id: string; field: string | null;
};

/** The record a change row names, read on the CALLER's own client (RLS-scoped) — just enough to
 *  decide which page(s) to revalidate after a successful write; never trusted as proof of anything
 *  the write itself does not already enforce. `record_id`/`field` feed `latestViaRowId` below (m3). */
async function readRecordRef(db: RequestDb, accountId: string, changeId: number): Promise<RawRecordRef | null> {
  const { data, error } = await db.from("record_changes").select("id, contact_id, client_group_id, record_id, field")
    .eq("account_id", accountId).eq("id", changeId).maybeSingle();
  if (error) throw new Error(`history-actions: change row read failed: ${error.message}`);
  return (data ?? null) as RawRecordRef | null;
}

/** The record page and, for a group row, the group page too (Rule: "Actions"). */
function recordPaths(accountId: string, ref: RawRecordRef | null): string[] {
  if (!ref) return [];
  const paths: string[] = [];
  if (ref.contact_id) paths.push(`/dashboard/accounts/${accountId}/contacts/${ref.contact_id}`);
  if (ref.client_group_id) paths.push(`/dashboard/accounts/${accountId}/groups/${ref.client_group_id}`);
  return paths;
}

/**
 * The newest change row this write itself produced, `via restore:<changeId>` — the "new change row
 * id" `undo.changeId` names (Rule: "Actions"). A client-sent `via` is never proof anything exists
 * (plan correction 9's own caution, carried into this feature): this reads it back from the row the
 * write just committed, on the SAME account, never from anything the browser claimed.
 *
 * F-115 PR C fix (review m3): `via` ALONE is not enough to prove this — 0111 section 4 lets the
 * `x-bis-author` header on ANY authenticated write carry `via: "restore:<digits>"`, so a caller
 * editing their OWN, unrelated record could cause a row to exist with the exact same `via` string
 * this write used. Matching `author_id` (this caller) AND `record_id` (the SAME record this write
 * just touched) closes that gap in practice: a forged `via` would need the attacker to also be
 * writing, as themselves, to the SAME record this undo is about — which only the real caller already
 * is. `field` narrows it further for a put-back (the row the undo writes back is always THAT field);
 * a restore's own row has no `field` (it is an insert/delete snapshot), so that filter is skipped.
 *
 * NOT matched: the write's own transaction (`xact`). By the time this runs the write has already
 * committed on its own PostgREST request/connection, and there is no RPC here that hands the caller
 * `txid_current()` back — matching the transaction exactly would need one. Chosen instead: the
 * (via, record_id, author_id[, field]) match above, which is the strongest check available without
 * adding that RPC.
 *
 * `null` when the lookup is inconclusive (observe mode writes with no header at all would not happen
 * here, since every write above sends one, but a read failure still answers `null` rather than
 * throwing after the write already landed) — the undo then falls back to the type's own remover.
 */
async function latestViaRowId(
  db: RequestDb, accountId: string, via: string, recordId: string, authorId: string, field: string | null,
): Promise<number | null> {
  try {
    let q = db.from("record_changes").select("id")
      .eq("account_id", accountId).eq("via", via).eq("record_id", recordId).eq("author_id", authorId);
    if (field !== null) q = q.eq("field", field);
    const { data, error } = await q.order("id", { ascending: false }).limit(1).maybeSingle();
    if (error) return null;
    return (data as { id: number } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Put back a changed value (Rule 2). Owners, Staff and the agency; refused BEFORE any read.
 * `.bind()`-able: `putBackAction.bind(null, accountId, locale)`.
 */
export async function putBackAction(
  accountId: string, locale: Locale, changeId: number | string,
): Promise<HistoryActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, message: t(m, "history.notAllowed", locale) };
  const id = parseChangeId(changeId);
  if (id === null) return { ok: false, message: t(m, "history.notFound", locale) };
  try {
    const db = await dbForRequest();
    const author: RowAuthor = { authorKind: "person", authorId: access.userId };
    const ref = await readRecordRef(db, accountId, id);
    const result = await putBackChange(db, accountId, id, author);
    if (result === "put_back") {
      for (const p of recordPaths(accountId, ref)) revalidatePath(p);
      const undoId = ref
        ? await latestViaRowId(db, accountId, `restore:${id}`, ref.record_id, access.userId, ref.field)
        : null;
      return { ok: true, undo: { changeId: undoId } };
    }
    if (result === "changed") return { ok: false, message: t(m, "history.putBack.changed", locale) };
    return { ok: false, message: t(m, "history.notFound", locale) }; // not_found | not_allowed
  } catch (e) {
    console.error(`putBackAction (account ${accountId}, change ${id}): ${loggableError(e)}`);
    return { ok: false, message: t(m, "history.notFound", locale) };
  }
}

/**
 * Restore a removed unit, member, tag, relationship or place for 30 days (Rule 3). Owners, Staff and
 * the agency; refused BEFORE any read. `.bind()`-able: `restoreAction.bind(null, accountId, locale)`.
 */
export async function restoreAction(
  accountId: string, locale: Locale, changeId: number | string,
): Promise<HistoryActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, message: t(m, "history.notAllowed", locale) };
  const id = parseChangeId(changeId);
  if (id === null) return { ok: false, message: t(m, "history.notFound", locale) };
  try {
    const db = await dbForRequest();
    const author: RowAuthor = { authorKind: "person", authorId: access.userId };
    const ref = await readRecordRef(db, accountId, id);
    const result = await restoreRemoved(db, accountId, id, author, new Date());
    if (result === "restored") {
      for (const p of recordPaths(accountId, ref)) revalidatePath(p);
      const undoId = ref
        ? await latestViaRowId(db, accountId, `restore:${id}`, ref.record_id, access.userId, ref.field)
        : null;
      return { ok: true, undo: { changeId: undoId } };
    }
    if (result === "expired") return { ok: false, message: t(m, "history.restore.expired", locale) };
    if (result === "parent_gone") return { ok: false, message: t(m, "history.restore.parentGone", locale) };
    if (result === "already_back") return { ok: false, message: t(m, "history.restore.alreadyBack", locale) };
    if (result === "failed") return { ok: false, message: t(m, "history.restore.failed", locale) };
    return { ok: false, message: t(m, "history.notFound", locale) }; // not_found | not_allowed
  } catch (e) {
    console.error(`restoreAction (account ${accountId}, change ${id}): ${loggableError(e)}`);
    return { ok: false, message: t(m, "history.notFound", locale) };
  }
}


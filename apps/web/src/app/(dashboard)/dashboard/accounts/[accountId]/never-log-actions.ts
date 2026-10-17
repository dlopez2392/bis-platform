"use server";

import { revalidatePath } from "next/cache";
import { addNeverLog, removeNeverLog, serviceDb } from "@bis/db";
import { parseNeverLogPattern, type NeverLogKind } from "@bis/db/never-log-rules";
import { requireAccountOwner } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";

/**
 * S-06 part 2, spec "The Never record list": Add and Remove, for the agency (Settings) and the
 * account's Owners (Branding). requireAccountOwner proves the caller (agency, or this account's Owner)
 * BEFORE any database call; every write is scoped to that account; an entry id is never trusted alone.
 * Logs carry the account id and loggableError only (kind, code, status), never the input.
 */
export type NeverLogView = { id: string; pattern: string; kind: NeverLogKind };
export type AddNeverLogActionResult = { ok: true; entry: NeverLogView } | { ok: false; error: "invalid" | "duplicate" | "full" | "failed" };
export type RemoveNeverLogActionResult = { ok: true; removed: NeverLogView | null } | { ok: false; error: "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const view = (e: NeverLogView): NeverLogView => ({ id: e.id, pattern: e.pattern, kind: e.kind });

/**
 * loggableError redacts an email-SHAPED match in the message, but a bare domain pattern ("supplier.com")
 * is not email-shaped and a constraint error can legally quote it back. This list's whole point is never
 * to log the pattern, so here only the kind/code/status prefix (before loggableError's own ": " message
 * separator) is kept — the message half is dropped rather than only partially redacted.
 */
function kindCodeStatus(e: unknown): string {
  const full = loggableError(e);
  const i = full.indexOf(": ");
  return i === -1 ? full : full.slice(0, i);
}

function revalidate(accountId: string) {
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
}

export async function addNeverLogAction(accountId: string, input: string): Promise<AddNeverLogActionResult> {
  const { userId } = await requireAccountOwner(accountId);
  const p = typeof input === "string" ? parseNeverLogPattern(input) : null;
  if (!p) return { ok: false, error: "invalid" };
  try {
    const r = await addNeverLog(serviceDb(), accountId, p, userId);
    if (r.outcome !== "added") return { ok: false, error: r.outcome };
    revalidate(accountId);
    return { ok: true, entry: view(r.entry) };
  } catch (e) {
    console.error(`addNeverLogAction: account ${accountId} failed: ${kindCodeStatus(e)}`);
    return { ok: false, error: "failed" };
  }
}

export async function removeNeverLogAction(accountId: string, id: string): Promise<RemoveNeverLogActionResult> {
  const { userId } = await requireAccountOwner(accountId);
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "failed" };
  try {
    const removed = await removeNeverLog(serviceDb(), accountId, id, userId);
    revalidate(accountId);
    return { ok: true, removed: removed ? view(removed) : null };
  } catch (e) {
    console.error(`removeNeverLogAction: account ${accountId} failed: ${kindCodeStatus(e)}`);
    return { ok: false, error: "failed" };
  }
}

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
 * Logs carry the account id and the error's diagnosis, never the submitted pattern — see
 * redactPattern below for how Add's catch keeps that true even though Remove's own catch (which
 * never sees a pattern) logs loggableError(e) in full.
 */
export type NeverLogView = { id: string; pattern: string; kind: NeverLogKind };
export type AddNeverLogActionResult = { ok: true; entry: NeverLogView } | { ok: false; error: "invalid" | "duplicate" | "full" | "failed" };
export type RemoveNeverLogActionResult = { ok: true; removed: NeverLogView | null } | { ok: false; error: "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const view = (e: NeverLogView): NeverLogView => ({ id: e.id, pattern: e.pattern, kind: e.kind });

/**
 * loggableError redacts an email-SHAPED match in the message, but a bare domain pattern
 * ("supplier.com") is not email-shaped and a constraint error can legally quote it back (the
 * leak this guards). This list's whole point is never to log the submitted pattern, so Add
 * replaces every occurrence of BOTH the raw input the caller typed and the pattern parseNeverLogPattern
 * derived from it — case-insensitively, since Postgres or the client may echo either casing — with
 * `<pattern>`, keeping the rest of loggableError's diagnosis (kind, code, status, any other text)
 * intact. Remove never sees the pattern at all (it holds only an id), so its own catch logs
 * loggableError(e) in full — there is nothing of the caller's to redact.
 */
function redactPattern(message: string, ...needles: string[]): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = message;
  for (const needle of new Set(needles.map((n) => n.trim()).filter(Boolean))) {
    out = out.replace(new RegExp(esc(needle), "gi"), "<pattern>");
  }
  return out;
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
    console.error(`addNeverLogAction: account ${accountId} failed: ${redactPattern(loggableError(e), input, p.pattern)}`);
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
    console.error(`removeNeverLogAction: account ${accountId} failed: ${loggableError(e)}`);
    return { ok: false, error: "failed" };
  }
}

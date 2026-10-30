"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import {
  mergeContacts, undoContactMerge, dismissDuplicatePair, undismissDuplicatePair, mergeKeptIdOf, MergeRpcError,
  MERGE_CHOICE_FIELDS, type MergeChoice,
} from "@bis/db";

/**
 * F-006 part 1 (plan Task 10, Step 3): merge, its Undo, and dismiss/undismiss of a possible-duplicate
 * pair. Owner ruling D9: Owners, Staff and the agency; never a Technician — refused BY ROLE here, before
 * any db call (archive-actions.ts's own pattern: a Technician's RLS would otherwise answer with no error
 * rather than refuse). Every write stays refused while the account is paused (this file never opts any
 * action out of that refusal — lib/billing/read-only.test.ts's allow-list stays unchanged), and every read
 * runs on the REQUEST client, never the service one (in-account-service-reads.test.ts's allow-list stays
 * unchanged).
 */

const HEX32 = /^[0-9a-f]{32}$/;
const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;
const contactPath = (accountId: string, contactId: string) => `/dashboard/accounts/${accountId}/contacts/${contactId}`;

function validChoices(choices: unknown): choices is Record<string, MergeChoice> {
  if (typeof choices !== "object" || choices === null || Array.isArray(choices)) return false;
  const allowed = new Set<string>(MERGE_CHOICE_FIELDS);
  for (const [key, value] of Object.entries(choices)) {
    if (value !== "keep" && value !== "other") return false;
    if (!allowed.has(key) && !key.startsWith("custom.")) return false;
  }
  return true;
}

function validSeen(seen: unknown): seen is { keep: string; other: string } {
  if (typeof seen !== "object" || seen === null) return false;
  const { keep, other } = seen as { keep?: unknown; other?: unknown };
  return typeof keep === "string" && HEX32.test(keep) && typeof other === "string" && HEX32.test(other);
}

export type MergeActionResult =
  | { ok: true; mergeId: number; keptId: string }
  | { ok: false; errorKey: "contacts.merge.stale" | "contacts.merge.failed" };

/** Merge `other` into `keep` (owner ruling D4: the screen already decided which is kept). `choices` and
 *  `seen` travel to `mergeContacts` UNCHANGED — the database is the one place they are interpreted. */
export async function mergeContactsAction(
  accountId: string,
  input: { keepId: string; otherId: string; choices: Record<string, MergeChoice>; seen: { keep: string; other: string } },
): Promise<MergeActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(input.keepId) || !isUuid(input.otherId)
    || !validChoices(input.choices) || !validSeen(input.seen)) {
    return { ok: false, errorKey: "contacts.merge.failed" };
  }
  try {
    const db = await dbForRequest();
    const r = await mergeContacts(db, accountId, {
      keepId: input.keepId, otherId: input.otherId, choices: input.choices, seen: input.seen,
    });
    if (r.status === "merged") {
      revalidatePath(contactsPath(accountId));
      revalidatePath(contactPath(accountId, input.keepId));
      revalidatePath(contactPath(accountId, input.otherId));
      return { ok: true, mergeId: r.mergeId, keptId: input.keepId };
    }
    // Fix round, minor 7: "already_merged", "holding" and "not_found" are the SAME situation a staff
    // member can fix by looking again — the pair on screen changed under them — never the generic
    // "try again" a retry cannot help. Reusing contacts.merge.stale also re-triggers onStale()
    // (merge-screen.tsx), which refreshes the page and lets it redirect to the duplicates view once a
    // merged-away side shows.
    if (r.status === "stale" || r.status === "already_merged" || r.status === "holding" || r.status === "not_found") {
      return { ok: false, errorKey: "contacts.merge.stale" };
    }
    return { ok: false, errorKey: "contacts.merge.failed" };
  } catch (e) {
    console.error(`contacts merge (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, errorKey: "contacts.merge.failed" };
  }
}

export type UndoMergeActionResult =
  | { ok: true; otherId: string; keptNew: number; keptEdits: string[] }
  | {
      ok: false;
      errorKey: "contacts.merge.undoExpired" | "contacts.merge.undoLater" | "contacts.merge.undoBlocked"
        | "contacts.merge.undoFailed";
    };

/** Owner ruling D7: within 30 days, newest-merge-first. The toast's own "Undo" and the timeline row's
 *  "Undo merge" both call this. Fix round, minor 5: a foreign-key error (23503) — a tag, group or
 *  contact Undo would re-insert was itself deleted since — maps to its own worded key, never the
 *  generic "try again" (there is nothing left to retry). Fix round, carry-in 6: a successful Undo
 *  revalidates the KEPT record's page too, read via `mergeKeptIdOf` (0106's own JSON never echoes it
 *  back), not only the other (now independent) record's. */
export async function undoMergeAction(accountId: string, mergeId: number): Promise<UndoMergeActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !Number.isInteger(mergeId) || mergeId <= 0) {
    return { ok: false, errorKey: "contacts.merge.undoFailed" };
  }
  try {
    const db = await dbForRequest();
    const r = await undoContactMerge(db, accountId, mergeId);
    if (r.status === "undone") {
      revalidatePath(contactsPath(accountId));
      revalidatePath(contactPath(accountId, r.otherId));
      const keptId = await mergeKeptIdOf(db, accountId, mergeId).catch(() => null);
      if (keptId) revalidatePath(contactPath(accountId, keptId));
      return { ok: true, otherId: r.otherId, keptNew: r.keptNew, keptEdits: r.keptEdits };
    }
    if (r.status === "expired") return { ok: false, errorKey: "contacts.merge.undoExpired" };
    if (r.status === "later_merge") return { ok: false, errorKey: "contacts.merge.undoLater" };
    return { ok: false, errorKey: "contacts.merge.undoFailed" };
  } catch (e) {
    console.error(`contacts merge undo (account ${accountId}): ${loggableError(e)}`);
    if (e instanceof MergeRpcError && e.code === "23503") return { ok: false, errorKey: "contacts.merge.undoBlocked" };
    return { ok: false, errorKey: "contacts.merge.undoFailed" };
  }
}

type DismissResult = { ok: true } | { ok: false; errorKey: "contacts.duplicates.dismissFailed" };

/** "Not the same person": for good, with Undo. The same people who may merge. */
export async function dismissPairAction(accountId: string, flagId: string): Promise<DismissResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(flagId)) return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
  try {
    const db = await dbForRequest();
    const status = await dismissDuplicatePair(db, accountId, flagId);
    if (status !== "dismissed") return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch (e) {
    console.error(`contacts duplicate dismiss (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
  }
}

/** The dismiss's own Undo. */
export async function undismissPairAction(accountId: string, flagId: string): Promise<DismissResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(flagId)) return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
  try {
    const db = await dbForRequest();
    const status = await undismissDuplicatePair(db, accountId, flagId);
    if (status !== "restored") return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch (e) {
    console.error(`contacts duplicate undismiss (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, errorKey: "contacts.duplicates.dismissFailed" };
  }
}

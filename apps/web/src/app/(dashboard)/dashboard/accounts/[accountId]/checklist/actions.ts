"use server";

import { revalidatePath } from "next/cache";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  setChecklistItem, addCustomChecklistItem, serviceDb, setA2pRegistration,
  a2pApprovalIsComplete, type A2pStatus,
} from "@bis/db";
import { m } from "@/lib/messages";

/** Same shape setup/actions.ts and voice/actions.ts use, declared per segment
 *  for their reason: this one runs from a client island that needs the failure
 *  to arrive as a value it can render, not a rejected promise. The two actions
 *  below it keep returning void — their panel does not toast. */
export type ActionResult = { ok: true } | { ok: false; error: string };

const A2P_STATUSES: readonly A2pStatus[] =
  ["not_started", "pending", "approved", "rejected"] as const;

/** States the narrowing rather than casting an unvalidated string into the
 *  union to satisfy `includes`. */
const isA2pStatus = (s: string): s is A2pStatus =>
  (A2P_STATUSES as readonly string[]).includes(s);

export async function setChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const itemKey = String(formData.get("itemKey") ?? "");
  if (!itemKey) throw new Error("itemKey required");

  await setChecklistItem(await dbForRequest(), accountId, itemKey,
    { done: formData.get("done") === "true" }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}

/**
 * Records what the carriers approved for this company. The A2P checklist item
 * now DERIVES from this (lib/checklist-catalogue.ts) rather than from a manual
 * tick, so this is the only way that item can read as done.
 *
 * serviceDb(), not dbForRequest() — deliberately, and for renameAccountAction's
 * reason exactly: migration 0013 revoked UPDATE on ALL of `accounts` from
 * `authenticated` and re-granted it column-by-column for seven branding
 * columns (0014 added `reply_to_email`, making the granted set eight —
 * client-branding-grants.test.ts pins it exactly, in both directions).
 * 0023 adds the `a2p_*` columns and does NOT grant them, so a
 * write through dbForRequest() (the `authenticated` role) fails with
 * "permission denied" on every real call — a failure only the e2e suite can
 * see, because unit tests mock the db client. The agency-only guard below runs
 * BEFORE the write and is the only thing standing behind it. Do not "fix" this
 * to dbForRequest(); that reintroduces the permission-denied failure.
 *
 * The READS on this page stay on dbForRequest() and must: RLS is right there.
 */
export async function setA2pRegistrationAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const status = String(formData.get("status") ?? "");
  if (!isA2pStatus(status)) {
    // A value the select cannot produce: a tampered or stale post. Its own
    // copy, not the generic write failure — telling an operator the save
    // failed when their PAGE is stale sends them to retry the same thing.
    return { ok: false, error: m["a2p.staleStatus"] };
  }
  const str = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  const patch = { brandId: str("brandId"), campaignId: str("campaignId"), status };

  // Checked here as well as in setA2pRegistration so the operator gets a
  // sentence that names the problem instead of the generic write failure the
  // catch below produces. The db-layer guard is the one that binds.
  if (!a2pApprovalIsComplete(patch)) {
    return { ok: false, error: m["a2p.approvedNeedsIds"] };
  }

  try {
    await setA2pRegistration(serviceDb(), accountId, patch, userId);
  } catch (e) {
    console.error(`setA2pRegistrationAction: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["a2p.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
  return { ok: true };
}

export async function addChecklistItemAction(
  accountId: string, formData: FormData,
): Promise<void> {
  // No userId needed: adding an item records no actor. Only completing one
  // does, via done_by.
  await requireAgencyOnlyAccountAccess(accountId);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");

  await addCustomChecklistItem(await dbForRequest(), accountId, title);

  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}

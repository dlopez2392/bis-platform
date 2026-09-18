"use server";

import { revalidatePath } from "next/cache";
import {
  getProposal, markProposalDecided, addTask, fillContactBlanks, moveOpportunityToStage,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

function callPath(accountId: string, callId: string): string {
  return `/dashboard/accounts/${accountId}/calls/${callId}`;
}

/**
 * Turns a machine-suggested next step into a real CRM record — the one
 * place in this feature where that boundary is crossed. `requireAccountAccess`
 * (not the agency-only variant): both a client and the agency review and act
 * on their own account's proposals.
 */
export async function acceptProposal(
  accountId: string, callId: string, proposalId: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  try {
    // Existence only — deliberately NOT also gating on `status === "pending"`
    // here. `markProposalDecided`'s compare-and-swap below already returns
    // false for exactly that case, so a second, non-atomic status check this
    // early could only ever duplicate that outcome; it could never be the
    // thing that catches a real race, because a race is, by definition, a
    // proposal that reads as "pending" HERE and stops being pending before
    // the CAS runs a moment later. Two racing accepts must both pass this
    // line and be decided ONLY by the CAS below, or "decide first" is a
    // fiction that a mutation test can't actually catch (see the report).
    const proposal = await getProposal(db, accountId, proposalId);
    if (!proposal) {
      return { ok: false, error: m["proposals.gone"] };
    }

    // For `opportunity_stage` ONLY, the world-still-holds check has to run
    // BEFORE the decide: `moveOpportunityToStage` validates that the target
    // stage belongs to the opportunity's pipeline but NOT that the
    // opportunity is still where the proposal thought it was, and a stage
    // that moved while this sat is a proposal about a world that no longer
    // exists. This is a read-then-write check, not a database constraint —
    // a second stage move landing between this read and the write below is
    // a real, if narrow, race window that nothing here closes atomically.
    if (proposal.kind === "opportunity_stage") {
      const p = proposal.payload;
      const { data, error } = await db.from("opportunities")
        .select("stage_id").eq("account_id", accountId).eq("id", p.opportunityId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || data.stage_id !== p.fromStageId) {
        return { ok: false, error: m["proposals.stageMoved"] };
      }
    }

    // DECIDE FIRST. This is a compare-and-swap on `status = 'pending'`, so
    // two reviewers racing produce exactly one winner. Writing the CRM
    // record first and stamping afterwards would let a double-click create
    // two tasks and then stamp one row twice.
    if (!await markProposalDecided(db, accountId, proposalId, "accepted", userId)) {
      return { ok: false, error: m["proposals.gone"] };
    }

    // THE EXISTING WRITE PATHS, always. Every validation, RLS policy, dedupe
    // key and event emission applies because these are the same functions a
    // human action calls. A second write path would be a second set of rules
    // to keep in step, and the one that skipped a check would be the one the
    // machine uses.
    if (proposal.kind === "task") {
      const p = proposal.payload;
      await addTask(db, accountId, {
        contactId: proposal.contactId ?? undefined,
        title: p.title, dueAt: p.dueAt ?? undefined,
      }, userId);
    } else if (proposal.kind === "contact_field") {
      const p = proposal.payload;
      if (!proposal.contactId) return { ok: false, error: m["proposals.failed"] };
      // fillContactBlanks IS the re-check: it writes only columns that are
      // still empty and returns the ones it actually wrote. An empty array
      // means a human filled it in the minutes since — which is not a
      // failure, it is the guard working.
      const written = await fillContactBlanks(
        db, accountId, proposal.contactId, { [p.field]: p.value }, userId,
      );
      if (written.length === 0) return { ok: false, error: m["proposals.contactFilled"] };
    } else {
      const p = proposal.payload;
      await moveOpportunityToStage(db, accountId, p.opportunityId, p.toStageId, userId);
    }
  } catch (e) {
    console.error(`acceptProposal: failed for ${proposalId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["proposals.failed"] };
  }

  revalidatePath(callPath(accountId, callId));
  revalidatePath("/dashboard/work");
  return { ok: true };
}

/**
 * Declines a suggestion. The row is KEPT with `status = 'dismissed'`, never
 * deleted: it is the only evidence the feature offered something and a
 * human declined, it is what a future accuracy measurement is computed
 * from, and a deleted row means the next pass proposes the same thing
 * again.
 */
export async function dismissProposal(
  accountId: string, callId: string, proposalId: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    if (!await markProposalDecided(await dbForRequest(), accountId, proposalId, "dismissed", userId)) {
      return { ok: false, error: m["proposals.gone"] };
    }
  } catch (e) {
    console.error(`dismissProposal: failed for ${proposalId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["proposals.failed"] };
  }
  revalidatePath(callPath(accountId, callId));
  revalidatePath("/dashboard/work");
  return { ok: true };
}

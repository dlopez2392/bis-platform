"use server";

import { revalidatePath } from "next/cache";
import {
  getProposal, markProposalDecided, addTask, fillContactBlanks, getContact,
  moveOpportunityToStage, type ContactFieldPayload, type SupabaseClient,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

function callPath(accountId: string, callId: string): string {
  return `/dashboard/accounts/${accountId}/calls/${callId}`;
}

const CONTACT_FIELD_COLUMN: Record<ContactFieldPayload["field"], "first_name" | "last_name" | "email" | "phone"> = {
  firstName: "first_name", lastName: "last_name", email: "email", phone: "phone",
};

function isBlank(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

/**
 * Puts an accepted proposal back to `pending` after the CRM write that was
 * supposed to follow the accept never landed — a thrown exception, or one
 * of this action's own "there is nothing to write" refusals reached AFTER
 * the compare-and-swap already ran. Scoped to THIS decision (`status =
 * 'accepted'` AND `decided_by = decidedBy`), so it can never claw back a
 * different, later, legitimate accept of the same proposal, and callers
 * only invoke this when they know the write did not land. Best-effort: if
 * the revert itself fails, the accept was already going to report failure
 * either way — this only logs so an operator can find the stranded row.
 */
async function revertToPending(
  db: SupabaseClient, accountId: string, proposalId: string, decidedBy: string,
): Promise<void> {
  const { error } = await db.from("call_proposals")
    .update({ status: "pending", decided_at: null, decided_by: null })
    .eq("account_id", accountId).eq("id", proposalId)
    .eq("status", "accepted").eq("decided_by", decidedBy);
  if (error) {
    console.error(
      `acceptProposal: failed to revert proposal ${proposalId} (account ${accountId}) back to pending: ` +
      error.message,
    );
  }
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

  // `decided` is true only once the compare-and-swap below is KNOWN to have
  // landed (set the line after it returns `true`, never before it), so an
  // exception thrown BY the CAS call itself leaves it false and skips the
  // revert below, which would be a no-op anyway but a wrong `decided=true`
  // in the log would mislead whoever reads it. `written` is true only once
  // the actual CRM mutation for this proposal's kind has landed — it
  // exists so a failure AFTER that point (revalidatePath, for example) can
  // never be mistaken for a failed write and claw the proposal back to
  // pending, which would let a second accept create a duplicate record.
  let db: SupabaseClient | undefined;
  let decided = false;
  let written = false;

  try {
    db = await dbForRequest();

    // Existence AND status. Two reviewers racing this line can both read
    // "pending" and both reach the CAS below, which is what actually
    // decides between them — this check exists to give an HONEST answer to
    // everyone else: a proposal already decided (by this reviewer's own
    // double click, or by someone else) must say so, not report on
    // whatever downstream state happens to look wrong next. Restored after
    // being dropped on the theory that it made the CAS-return-check
    // mutation unfalsifiable — true for a single `-t` filter, false for the
    // whole file: "decides BEFORE it writes, so a double accept creates
    // exactly ONE task" still reds if the CAS check is dropped, because two
    // concurrent callers both pass THIS read-then-write check before
    // either's CAS runs. Dropping this guard also had a real user-visible
    // cost: a double-click on an `opportunity_stage` proposal reported
    // "This opportunity has moved since the suggestion was made" — because
    // the re-read below ran before the CAS and saw the stage the FIRST
    // accept had just moved it to — instead of the true "Someone already
    // answered this one."
    const proposal = await getProposal(db, accountId, proposalId);
    if (!proposal || proposal.status !== "pending") {
      return { ok: false, error: m["proposals.gone"] };
    }
    // A proposal addressed through the wrong call's page. No UI path
    // produces this today, but nothing else checks it either.
    if (proposal.callId !== callId) {
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
      // Deleted and moved are different facts and deserve different words:
      // telling an operator their board moved when the deal is simply gone
      // is a lie about a board they can see with their own eyes.
      if (!data) {
        return { ok: false, error: m["proposals.opportunityGone"] };
      }
      if (data.stage_id !== p.fromStageId) {
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
    decided = true;

    // THE EXISTING WRITE PATHS, always. Every validation, RLS policy, dedupe
    // key and event emission applies because these are the same functions a
    // human action calls. A second write path would be a second set of rules
    // to keep in step, and the one that skipped a check would be the one the
    // machine uses.
    //
    // Every branch below that returns WITHOUT writing anything reverts the
    // stamp above first: the CAS having landed must never outlive the write
    // it was meant to gate. A branch that DOES write sets `written = true`
    // and never reverts, even if something later (revalidatePath) fails.
    if (proposal.kind === "task") {
      const p = proposal.payload;
      await addTask(db, accountId, {
        contactId: proposal.contactId ?? undefined,
        title: p.title, dueAt: p.dueAt ?? undefined,
      }, userId);
      written = true;
    } else if (proposal.kind === "contact_field") {
      const p = proposal.payload;
      if (!proposal.contactId) {
        await revertToPending(db, accountId, proposalId, userId);
        return { ok: false, error: m["proposals.failed"] };
      }
      // Read the field's CURRENT value before the re-check below so an
      // empty result from fillContactBlanks can be reported honestly: it
      // returns `[]` for two different reasons (the field is genuinely
      // already filled, or its own first-name-compatibility guard refused
      // a mismatched name), and reporting "already filled in" for the
      // second one is false — a real contact with `first_name` "Roberto"
      // and a blank `last_name` refusing a `lastName` proposal is not
      // "already filled in".
      const before = await getContact(db, accountId, proposal.contactId);
      const column = CONTACT_FIELD_COLUMN[p.field];
      const alreadyFilled = !!before && !isBlank((before as Record<string, unknown>)[column]);
      // fillContactBlanks IS the re-check: it writes only columns that are
      // still empty and returns the ones it actually wrote. An empty array
      // means either a human filled it in the minutes since, or the name
      // on file does not match closely enough to fill safely — either way,
      // this call itself wrote nothing, so the stamp above must come back.
      const filled = await fillContactBlanks(
        db, accountId, proposal.contactId, { [p.field]: p.value }, userId,
      );
      if (filled.length === 0) {
        await revertToPending(db, accountId, proposalId, userId);
        return {
          ok: false,
          error: alreadyFilled ? m["proposals.contactFilled"] : m["proposals.contactMismatch"],
        };
      }
      written = true;
    } else {
      const p = proposal.payload;
      await moveOpportunityToStage(db, accountId, p.opportunityId, p.toStageId, userId);
      written = true;
    }

    // Best-effort bookkeeping. Built from the PROPOSAL's own call id, not
    // the caller-supplied one — they are known equal by this point (checked
    // above), but the proposal's is the one actually true of the record
    // that changed. A failure here must never look like the accept itself
    // failed (the write above already landed) and must never trigger the
    // revert above (`written` is already true).
    revalidatePath(callPath(accountId, proposal.callId));
    revalidatePath("/dashboard/work");
    // The screen `proposals.accepted.toast` actually names ("Added to your
    // to-do list") — the agency-only roll-up above is a different screen.
    revalidatePath(`/dashboard/accounts/${accountId}/tasks`);
  } catch (e) {
    if (decided && !written && db) {
      await revertToPending(db, accountId, proposalId, userId);
    }
    // Whether the compare-and-swap already ran, and whether the write
    // landed, are the two facts an operator needs before touching this row
    // by hand.
    console.error(
      `acceptProposal: failed for ${proposalId} (account ${accountId}), ` +
      `decided=${decided}, written=${written}: ${String(e)}`,
    );
    // The write landed and only bookkeeping afterward failed — reporting
    // failure here would tell the client a task was never created when one
    // was.
    if (written) return { ok: true };
    return { ok: false, error: m["proposals.failed"] };
  }

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

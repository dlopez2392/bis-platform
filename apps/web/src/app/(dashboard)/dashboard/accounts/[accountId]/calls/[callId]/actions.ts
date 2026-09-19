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
  // `.select("id")` is what makes a no-op revert knowable: PostgREST
  // returns no error and no rows for an update matching nothing, which
  // would otherwise read as success (the identical trap `markProposalDecided`,
  // packages/db/src/call-proposals.ts, documents and this file failed to
  // copy). A revert that matches nothing is not a bug on its own — a
  // legitimate later decision may have already moved the row past this
  // one's scope — but it must never pass in silence.
  const { data, error } = await db.from("call_proposals")
    .update({ status: "pending", decided_at: null, decided_by: null })
    .eq("account_id", accountId).eq("id", proposalId)
    .eq("status", "accepted").eq("decided_by", decidedBy)
    .select("id");
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      // `call_proposals_one_pending_unique` (0040) constrains at most one
      // PENDING row per (call_id, kind, contact_id). A re-delivered hangup
      // webhook can re-run `generateProposals` while this one sits
      // `accepted` and insert a fresh pending row for the same trio; if
      // that lands inside this failure window, giving THIS row back to
      // `pending` too collides with it. The row stays `accepted` — stranded,
      // not silently swallowed.
      console.error(
        `acceptProposal: revert for proposal ${proposalId} (account ${accountId}) hit the one-pending ` +
        `unique index — a fresh pending proposal for the same call/kind/contact was likely generated ` +
        `while this one sat accepted; this row is stranded accepted: ${error.message}`,
      );
    } else {
      console.error(
        `acceptProposal: failed to revert proposal ${proposalId} (account ${accountId}) back to pending: ` +
        error.message,
      );
    }
    return;
  }
  if ((data ?? []).length === 0) {
    console.error(
      `acceptProposal: revert for proposal ${proposalId} (account ${accountId}, decided_by ${decidedBy}) ` +
      `matched no row — a different, later decision likely already moved it; nothing reverted.`,
    );
  }
}

/**
 * The write helper's own call threw AFTER the compare-and-swap already
 * stamped the proposal `accepted` — this can only mean the write is
 * AMBIGUOUS. `addTask`, `fillContactBlanks` and `moveOpportunityToStage`
 * each perform their real write, THEN a separate `emit` insert into
 * `events`, as two non-transactional round-trips (`addTask`,
 * packages/db/src/activities.ts:23-36): a throw from the second leaves the
 * first's row sitting in the database while the caller sees a failure.
 * Reverting here would tell the truth about NEITHER possibility and would
 * invite exactly the retry the failure copy suggests — which, if the first
 * round-trip DID land, creates a SECOND record on top of it. So this never
 * reverts: the proposal is left `accepted` (a real cost — an accepted
 * proposal whose record may not exist, discoverable only by the log line
 * below), and the message tells the user the truth instead of the CAS
 * path's confident "try again".
 */
function stranded(proposalId: string, callId: string, accountId: string, e: unknown): ActionResult {
  console.error(
    `acceptProposal: STRANDED — proposal ${proposalId} (call ${callId}, account ${accountId}) ` +
    `left accepted; its write may or may not have landed: ${String(e)}`,
  );
  return { ok: false, error: m["proposals.maybeFailed"] };
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
      // `status` alongside `stage_id` (fix-wave Important 4): a proposal
      // generated while the deal was open can sit pending past the point a
      // human marks it won or lost — which is a STATUS change, not
      // necessarily a stage move, so the common case (closed at the very
      // stage the proposal already named) would otherwise sail straight
      // past the stage-equality check below and reopen a decided deal.
      const { data, error } = await db.from("opportunities")
        .select("stage_id, status").eq("account_id", accountId).eq("id", p.opportunityId).maybeSingle();
      if (error) throw new Error(error.message);
      // Deleted and moved are different facts and deserve different words:
      // telling an operator their board moved when the deal is simply gone
      // is a lie about a board they can see with their own eyes.
      if (!data) {
        return { ok: false, error: m["proposals.opportunityGone"] };
      }
      // Checked BEFORE the stage-equality comparison, and with its OWN
      // message: "proposals.stageMoved" would be false here — the deal did
      // not move to another stage, it closed, which is why this is not
      // folded into that branch.
      if (data.status !== "open") {
        return { ok: false, error: m["proposals.opportunityClosed"] };
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
    //
    // The write helper's own call is wrapped in its own try/catch, distinct
    // from the outer one below: a throw from THAT specific call is the
    // ambiguous case `stranded()` documents, and returns immediately
    // without ever reaching the outer catch's revert.
    if (proposal.kind === "task") {
      const p = proposal.payload;
      try {
        await addTask(db, accountId, {
          contactId: proposal.contactId ?? undefined,
          title: p.title, dueAt: p.dueAt ?? undefined,
        }, userId);
      } catch (e) {
        return stranded(proposalId, callId, accountId, e);
      }
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
      let filled: string[];
      try {
        filled = await fillContactBlanks(
          db, accountId, proposal.contactId, { [p.field]: p.value }, userId,
        );
      } catch (e) {
        return stranded(proposalId, callId, accountId, e);
      }
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
      try {
        await moveOpportunityToStage(db, accountId, p.opportunityId, p.toStageId, userId);
      } catch (e) {
        return stranded(proposalId, callId, accountId, e);
      }
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
  // Mirrors `acceptProposal`'s own `written` flag: once the CAS below has
  // landed, a failure in bookkeeping (`revalidatePath`) must never be
  // reported as the dismiss itself having failed — that would tell the
  // caller to retry a write that already happened.
  let dismissed = false;
  try {
    const db = await dbForRequest();
    // Same check `acceptProposal` runs before it acts: a proposal addressed
    // through the wrong call's page must be refused, not decided.
    const proposal = await getProposal(db, accountId, proposalId);
    if (!proposal || proposal.callId !== callId) {
      return { ok: false, error: m["proposals.gone"] };
    }
    if (!await markProposalDecided(db, accountId, proposalId, "dismissed", userId)) {
      return { ok: false, error: m["proposals.gone"] };
    }
    dismissed = true;
    revalidatePath(callPath(accountId, callId));
    revalidatePath("/dashboard/work");
  } catch (e) {
    console.error(`dismissProposal: failed for ${proposalId} (account ${accountId}): ${String(e)}`);
    if (dismissed) return { ok: true };
    return { ok: false, error: m["proposals.failed"] };
  }
  return { ok: true };
}

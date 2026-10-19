import {
  getProposal, decideProposal, revertProposalDecision, setAppliedRef, expireProposals, listPendingSiblings,
  undoProposalDecision, expireAfterUndoCollision, restoreSiblings, listPeopleNames,
} from "@bis/db";
import {
  SYSTEM_DECIDER, UNDO_WINDOW_MS,
  type ContactFieldName, type ExpiredReason, type Proposal, type ProposalKind, type ProposalPayload,
} from "@bis/db/proposal-rules";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { loggableError } from "@/lib/loggable-error";
import { KINDS } from "./kinds";
import type { Applied, Db, DescribeCtx, EditCtx, EditInput, KindDef } from "./kinds/types";
import { localDateKey } from "./local-day";

/**
 * The decisions on an AI suggestion (item 8b-1, spec 4.4): Accept, Edit and accept, Discard and Undo.
 * Injected with both clients and never builds one (actions.ts does, and is the only file that names
 * the service getter):
 * - `db`, the REQUEST client: the read that authorises a decision (RLS: a row the reader may not see is
 *   "unavailable") and every CRM write and its inverse, so RLS refuses what the person could not do by hand;
 * - `writer`, the SERVICE client: every `proposals` write, each a compare-and-swap scoped by account and id.
 *
 * Logs carry ids and state words only, never a title, a value or the evidence (a customer's words).
 */
export type DecideDeps = {
  db: Db; writer: Db; accountId: string; userId: string; now: Date; zone: string; tr: Tr;
  /** Test seam only (plan deviation 20): awaited between the read and the compare-and-swap. The four
   *  actions never set it (actions.test.ts pins their deps' exact key set). */
  afterRead?: () => Promise<void>;
};
/** What a successful decision changed, for revalidation; actions.ts strips it before answering. */
export type DecisionTarget = { callId: string | null; contactId: string | null };
export type DecideOutcome =
  | { ok: true; status: "accepted" | "edited" | "dismissed"; toast: string; target: DecisionTarget }
  | { ok: false; error: string; field?: string };
export type UndoOutcome = { ok: true; message: string; target: DecisionTarget } | { ok: false; error: string };
export type { EditInput };

/** Every kind read through one shape: a row's kind picks its module, its payload is that module's. */
type AnyKind = KindDef<ProposalKind, ProposalPayload>;
const kindOfRow = (row: Proposal): AnyKind => KINDS[row.kind] as unknown as AnyKind;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const targetOf = (row: Proposal): DecisionTarget => ({ callId: row.callId, contactId: row.contactId });

const FIELD_LABEL: Record<ContactFieldName, MessageKey> = {
  firstName: "suggestions.field.firstName", lastName: "suggestions.field.lastName",
  email: "suggestions.field.email", phone: "suggestions.field.phone",
};

/** "Out of date: …" for a reason; `field_filled` names the field, lowercased, inside the sentence. */
function outOfDate(tr: Tr, reason: ExpiredReason, row: Proposal): string {
  const key = `suggestions.out.${reason}` as MessageKey;
  if (reason === "field_filled" && row.kind === "contact_field") {
    return tr.text(key, { field: tr.text(FIELD_LABEL[row.payload.field]).toLocaleLowerCase(tr.locale) });
  }
  return tr.text(key);
}

/** The answer to someone who reached a row that is no longer pending (spec 4.7). */
async function answered(d: DecideDeps, row: Proposal): Promise<{ ok: false; error: string }> {
  // Pending again (an Undo landed between our compare-and-swap and this re-read): nobody "answered" it.
  if (row.status === "pending") return fail(d.tr.text("suggestions.answer.failed"));
  if (row.decidedBy === SYSTEM_DECIDER || row.status === "expired") {
    return fail(outOfDate(d.tr, row.expiredReason ?? "aged", row));
  }
  let name: string | undefined;
  if (row.decidedBy) {
    try {
      name = (await listPeopleNames(d.db, [row.decidedBy]))[row.decidedBy];
    } catch (e) {
      console.error(`decide: decider's name not read for proposal ${row.id} (account ${d.accountId}): ${loggableError(e)}`);
    }
  }
  return fail(name
    ? d.tr.text("suggestions.answer.answeredBy", { name })
    : d.tr.text("suggestions.answer.answeredBySomeone"));
}

type StageRow = { id: string; name: string; position: number; pipeline_id: string };

/** The deal's pipeline and its stages, read on the request client; only a stage move has any. */
async function dealStages(d: DecideDeps, row: Proposal): Promise<{ pipelineId: string | null; stages: StageRow[] }> {
  if (row.kind !== "opportunity_stage") return { pipelineId: null, stages: [] };
  const deal = await d.db.from("opportunities").select("pipeline_id")
    .eq("account_id", d.accountId).eq("id", row.payload.opportunityId).maybeSingle();
  if (deal.error) throw new Error(`decide: deal read failed: ${deal.error.message}`);
  const pipelineId = (deal.data?.pipeline_id as string | undefined) ?? null;
  if (!pipelineId) return { pipelineId: null, stages: [] };
  const { data, error } = await d.db.from("pipeline_stages").select("id, name, position, pipeline_id")
    .eq("account_id", d.accountId).eq("pipeline_id", pipelineId).order("position");
  if (error) throw new Error(`decide: stages read failed: ${error.message}`);
  return { pipelineId, stages: (data ?? []) as StageRow[] };
}

async function editCtx(d: DecideDeps, row: Proposal): Promise<EditCtx> {
  const { pipelineId, stages } = await dealStages(d, row);
  return {
    zone: d.zone, now: d.now, pipelineIdOfDeal: pipelineId,
    stages: stages.map((s) => ({ id: s.id, position: s.position, pipelineId: s.pipeline_id })),
  };
}

async function stagesFor(d: DecideDeps, row: Proposal): Promise<DescribeCtx["stages"]> {
  const out: Record<string, { name: string; position: number }> = {};
  for (const s of (await dealStages(d, row)).stages) out[s.id] = { name: s.name, position: s.position };
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Accept `(id)` and Edit and accept `(id, edit)`, in spec 4.4's order: read (request client), age,
 * parse and validate (and P22), still holds, DECIDE (compare-and-swap, service client), then the write
 * (request client). Everything after the write is best-effort (plan fix I-4).
 */
export async function acceptSuggestion(d: DecideDeps, id: string, edit?: EditInput): Promise<DecideOutcome> {
  const row = await getProposal(d.db, d.accountId, id);                          // 1. request client, RLS
  if (!row) return fail(d.tr.text("suggestions.answer.unavailable"));
  if (row.status !== "pending") return await answered(d, row);
  if (Date.parse(row.expiresAt) <= d.now.getTime()) {                             // 2. age, server-side
    await decideProposal(d.writer, d.accountId, id, { to: "expired", reason: "aged", now: d.now });
    return fail(d.tr.text("suggestions.out.aged"));
  }
  const kind = kindOfRow(row);                                                     // 3. validate, P22
  let payload: ProposalPayload = row.payload;
  if (edit) {
    const v = kind.validateEdit(row.payload, edit, await editCtx(d, row));
    if (!v.ok) return { ok: false, error: d.tr.text(v.error.key, v.error.params), field: v.error.field };
    payload = v.payload;
  } else if (row.kind === "task" && row.payload.dueAt
             && localDateKey(new Date(row.payload.dueAt), d.zone) < localDateKey(d.now, d.zone)) {
    return fail(d.tr.text("suggestions.answer.pastDue"));
  }
  if (kind.needsContact && !row.contactId) {                                      // plan fix M8: nothing to write to
    console.error(`acceptSuggestion: proposal ${id} (account ${d.accountId}) of kind ${row.kind} has no customer; refused`);
    return fail(d.tr.text("suggestions.answer.failed"));
  }
  const holds = await kind.stillHolds(d.db, row);                                  // 4. still holds
  if (!holds.ok) {
    await decideProposal(d.writer, d.accountId, id, { to: "expired", reason: holds.reason, now: d.now });
    return fail(outOfDate(d.tr, holds.reason, row));
  }
  await d.afterRead?.();
  // An edit that normalises to the stored payload is a plain Accept, and the STORED payload is what is
  // written (orchestrator ruling): "edited" requires a change (0088's proposals_edited_changes).
  const edited = !sameJson(kind.normalise(payload, { zone: d.zone }), kind.normalise(row.payload, { zone: d.zone }));
  if (!edited) payload = row.payload;
  const decidedAt = d.now;
  if (!(await decideProposal(d.writer, d.accountId, id,                            // 5. decide first
    { to: edited ? "edited" : "accepted", decidedBy: d.userId, appliedPayload: payload, now: decidedAt }))) {
    const again = await getProposal(d.db, d.accountId, id);
    return again ? await answered(d, again) : fail(d.tr.text("suggestions.answer.unavailable"));
  }
  let applied: Applied;
  try {                                                                            // 6. the write, request client
    applied = await kind.apply({ db: d.db, accountId: d.accountId, userId: d.userId, contactId: row.contactId }, payload);
  } catch (e) {
    // Ambiguous: the write's own round-trips are not one transaction (its row, then its event), so it
    // may have landed. Never reverted, or a retry could write it twice.
    console.error(`acceptSuggestion: STRANDED - proposal ${id} (account ${d.accountId}) left decided; its write may or may not have landed: ${loggableError(e)}`);
    return fail(d.tr.text("suggestions.answer.maybeFailed"));
  }
  if (applied.noWrite) {
    try {
      // A collision (a fresh pending suggestion for the same call, kind and customer landed meanwhile) cannot
      // go back to pending; it would otherwise stay "accepted" with nothing written. It is out of date instead,
      // covered by the newer one, scoped to this decision's own instant.
      if ((await revertProposalDecision(d.writer, d.accountId, id, d.userId)) === "collision"
          && !(await expireAfterUndoCollision(d.writer, d.accountId, id, d.userId, d.now, decidedAt.toISOString()))) {
        console.error(`acceptSuggestion: proposal ${id} (account ${d.accountId}) wrote nothing, collided, and was not expired`);
      }
    } catch (e) {
      console.error(`acceptSuggestion: proposal ${id} (account ${d.accountId}) wrote nothing and was not given back: ${loggableError(e)}`);
    }
    return fail(outOfDate(d.tr, applied.noWrite, row));
  }
  // FROM HERE ON THE WRITE HAS LANDED (plan fix I-4): every step below is best-effort. A failure is
  // logged with ids only and the answer is still ok, never an error that would invite a second Accept.
  // Siblings before the ref, so the ref carries the ids it superseded in one write.
  let superseded: string[] = [];
  try {
    const target = kind.targetKey(payload, row.contactId);
    if (target && row.contactId) {
      const sibs = (await listPendingSiblings(d.db, d.accountId, { kind: row.kind, contactId: row.contactId, exceptId: id }, d.now))
        .filter((s) => kindOfRow(s).targetKey(s.payload, s.contactId) === target);
      superseded = await expireProposals(d.writer, d.accountId, sibs.map((s) => s.id), "superseded", decidedAt.toISOString());
    }
  } catch (e) {
    console.error(`acceptSuggestion: siblings not superseded for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  try {
    if (!(await setAppliedRef(d.writer, d.accountId, id, { ...applied.ref, superseded, flagged: !!applied.flagged }))) {
      console.error(`acceptSuggestion: applied_ref not stored for proposal ${id} (account ${d.accountId}); Undo will answer too late`);
    }
  } catch (e) {
    console.error(`acceptSuggestion: applied_ref not stored for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  let toast = d.tr.text("suggestions.status.accepted");                            // the fallback word
  try {
    toast = kind.toast(payload, d.tr, await stagesFor(d, row));
  } catch (e) {
    console.error(`acceptSuggestion: toast text not built for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  return { ok: true, status: edited ? "edited" : "accepted", toast, target: targetOf(row) };
}

/** Discard `(id)` (spec 4.4 item 2): the row is kept as dismissed; an aged row is marked aged by the
 *  app instead, so it never counts as a person's Discard. */
export async function discardSuggestion(d: DecideDeps, id: string): Promise<DecideOutcome> {
  const row = await getProposal(d.db, d.accountId, id);
  if (!row) return fail(d.tr.text("suggestions.answer.unavailable"));
  if (row.status !== "pending") return await answered(d, row);
  if (Date.parse(row.expiresAt) <= d.now.getTime()) {
    await decideProposal(d.writer, d.accountId, id, { to: "expired", reason: "aged", now: d.now });
    return fail(d.tr.text("suggestions.out.aged"));
  }
  if (!(await decideProposal(d.writer, d.accountId, id, { to: "dismissed", decidedBy: d.userId, now: d.now }))) {
    const again = await getProposal(d.db, d.accountId, id);
    return again ? await answered(d, again) : fail(d.tr.text("suggestions.answer.unavailable"));
  }
  return { ok: true, status: "dismissed", toast: d.tr.text("suggestions.toast.dismissed"), target: targetOf(row) };
}

type RefExtras = { superseded?: unknown; flagged?: unknown };

/**
 * Undo `(id)` (spec 4.4 item 3, P8, P9): the decider only, within UNDO_WINDOW_MS of the decision, for
 * accepted, edited or dismissed. After an Accept the INVERSE RUNS FIRST, while the row is still decided;
 * only then does the row go back to pending, by compare-and-swap scoped to the decider AND the decision
 * instant this Undo read (Task 4 review minor 4).
 */
export async function undoSuggestion(d: DecideDeps, id: string): Promise<UndoOutcome> {
  const row = await getProposal(d.db, d.accountId, id);
  if (!row) return fail(d.tr.text("suggestions.answer.unavailable"));
  const tooLate = fail(d.tr.text("suggestions.answer.tooLate"));
  const age = row.decidedAt ? d.now.getTime() - Date.parse(row.decidedAt) : Number.NaN;
  if (row.decidedBy !== d.userId || !row.decidedAt || !Number.isFinite(age) || age >= UNDO_WINDOW_MS) return tooLate;
  const decidedAt = row.decidedAt;

  if (row.status === "dismissed") {
    const moved = await undoProposalDecision(d.writer, d.accountId, id, { decidedBy: d.userId, from: ["dismissed"], now: d.now, decidedAt });
    if (moved !== "undone") {
      console.error(`undoSuggestion: proposal ${id} (account ${d.accountId}) Discard not undone: ${moved}`);
      return fail(d.tr.text("suggestions.answer.changed"));
    }
    return { ok: true, message: d.tr.text("suggestions.undone"), target: targetOf(row) };
  }
  if (row.status !== "accepted" && row.status !== "edited") return tooLate;
  // No applied_ref: a row copied from the old table, or an Accept by the old code. Nothing says what to
  // reverse, so it is refused before anything is read or written.
  if (row.appliedRef === null || typeof row.appliedRef !== "object") return tooLate;
  const kind = kindOfRow(row);
  if ("irreversible" in kind.inverse) return fail(d.tr.text(kind.inverse.irreversible));

  let result: "undone" | "changed";
  try {                                                                            // 1. the inverse, request client
    result = await kind.inverse.undo({ db: d.db, accountId: d.accountId, userId: d.userId, contactId: row.contactId }, row.appliedRef);
  } catch (e) {
    console.error(`undoSuggestion: STRANDED - proposal ${id} (account ${d.accountId}) left decided; its inverse may or may not have landed: ${loggableError(e)}`);
    return fail(d.tr.text("suggestions.answer.maybeFailed"));
  }
  if (result === "changed") return fail(d.tr.text("suggestions.answer.changed"));

  const stranded = (why: string) => {                                              // the record is back; the row is not
    console.error(`undoSuggestion: STRANDED - proposal ${id} (account ${d.accountId}): inverse done, status not moved (${why})`);
    return fail(d.tr.text("suggestions.answer.undoStranded"));
  };
  try {                                                                            // 2. the row, service client
    const moved = await undoProposalDecision(d.writer, d.accountId, id, { decidedBy: d.userId, from: ["accepted", "edited"], now: d.now, decidedAt });
    if (moved === "missed") return stranded("matched nothing");
    if (moved === "collision" && !(await expireAfterUndoCollision(d.writer, d.accountId, id, d.userId, d.now, decidedAt))) {
      return stranded("collision, and the expiry matched nothing");
    }
  } catch (e) {
    return stranded(loggableError(e));
  }

  const ref = row.appliedRef as RefExtras;
  const siblings = Array.isArray(ref.superseded) ? ref.superseded.filter((s): s is string => typeof s === "string") : [];
  try {                                                                            // 3. the siblings, best-effort
    await restoreSiblings(d.writer, d.accountId, siblings, decidedAt);
  } catch (e) {
    console.error(`undoSuggestion: siblings not given back for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  return { ok: true, message: d.tr.text(ref.flagged === true ? "suggestions.undoneDuplicate" : "suggestions.undone"), target: targetOf(row) };
}

/** The pages a decision changes (spec 4.4 step 9): the call page, the To do page, the agency Work page
 *  and the customer's record page. */
export function revalidateFor(accountId: string, row: { callId: string | null; contactId: string | null }): string[] {
  const base = `/dashboard/accounts/${accountId}`;
  return [
    ...(row.callId ? [`${base}/calls/${row.callId}`] : []),
    `${base}/tasks`,
    "/dashboard/work",
    ...(row.contactId ? [`${base}/contacts/${row.contactId}`] : []),
  ];
}

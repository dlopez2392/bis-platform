import type { SupabaseClient } from "@supabase/supabase-js";

export type ProposalKind = "task" | "contact_field" | "opportunity_stage";
export type ProposalStatus = "pending" | "accepted" | "dismissed";

export type TaskPayload = { title: string; dueAt: string | null };
export type ContactFieldPayload = {
  field: "firstName" | "lastName" | "email" | "phone"; value: string;
};
export type OpportunityStagePayload = {
  opportunityId: string; fromStageId: string; toStageId: string;
};
export type ProposalPayload = TaskPayload | ContactFieldPayload | OpportunityStagePayload;

export type CallProposal = {
  id: string; accountId: string; callId: string; contactId: string | null;
  kind: ProposalKind; payload: ProposalPayload; evidence: string;
  status: ProposalStatus; decidedAt: string | null; decidedBy: string | null;
  createdAt: string;
};

const COLS =
  "id, account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by, created_at";

type Row = {
  id: string; account_id: string; call_id: string; contact_id: string | null;
  kind: ProposalKind; payload: ProposalPayload; evidence: string;
  status: ProposalStatus; decided_at: string | null; decided_by: string | null;
  created_at: string;
};

function toProposal(r: Row): CallProposal {
  return {
    id: r.id, accountId: r.account_id, callId: r.call_id, contactId: r.contact_id,
    kind: r.kind, payload: r.payload, evidence: r.evidence, status: r.status,
    decidedAt: r.decided_at, decidedBy: r.decided_by, createdAt: r.created_at,
  };
}

/**
 * Writes one proposal, or returns null.
 *
 * NULL, NEVER A THROW. This runs inside the voice lifecycle's best-effort
 * tail, where the contract is that nothing about the call changes if
 * proposals fail. The two expected refusals — the partial unique index
 * (a re-run proposing the same thing twice) and the non-empty evidence
 * CHECK — are both normal outcomes of a pass doing its job, not faults.
 * The caller logs the count it got; it never reacts to a null.
 */
export async function insertProposal(
  db: SupabaseClient, accountId: string,
  input: {
    callId: string; contactId?: string | null; kind: ProposalKind;
    payload: ProposalPayload; evidence: string;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("call_proposals")
    .insert({
      account_id: accountId, call_id: input.callId,
      contact_id: input.contactId ?? null, kind: input.kind,
      payload: input.payload, evidence: input.evidence,
    })
    .select("id").single();
  if (error) {
    console.error(
      `insertProposal: refused for call ${input.callId} kind ${input.kind}: ${error.message}`,
    );
    return null;
  }
  return { id: data!.id as string };
}

export async function listProposalsForCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("call_id", callId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listProposalsForCall failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function listPendingProposals(
  db: SupabaseClient, accountId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("status", "pending")
    .order("created_at", { ascending: false })
    // Same backstop as listScreenedCalls: service_role has NO
    // statement_timeout, so an unbounded read is unbounded in production.
    .limit(500);
  if (error) throw new Error(`listPendingProposals failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function getProposal(
  db: SupabaseClient, accountId: string, id: string,
): Promise<CallProposal | null> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getProposal failed: ${error.message}`);
  return data ? toProposal(data as Row) : null;
}

/**
 * Decides a proposal, and reports whether it actually decided one.
 *
 * `.eq("status", "pending")` is the compare-and-swap: two reviewers
 * clicking Accept on the same proposal must not both succeed, and the
 * second one has to learn that it did nothing. `.select("id")` is what
 * makes that knowable — PostgREST returns no error and no rows for an
 * update matching nothing, which would otherwise read as success.
 */
export async function markProposalDecided(
  db: SupabaseClient, accountId: string, id: string,
  status: "accepted" | "dismissed", decidedBy: string,
): Promise<boolean> {
  const { data, error } = await db.from("call_proposals")
    .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq("account_id", accountId).eq("id", id).eq("status", "pending")
    .select("id");
  if (error) throw new Error(`markProposalDecided failed: ${error.message}`);
  return (data ?? []).length > 0;
}

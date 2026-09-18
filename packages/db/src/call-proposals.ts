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

/**
 * `kind` tied to its matching `payload`, so a mismatch (e.g. `kind: "task"`
 * carrying an `OpportunityStagePayload`) cannot typecheck. Before this
 * existed, `insertProposal` took a bare `{ kind: ProposalKind; payload:
 * ProposalPayload }` and any of the three payload shapes typechecked for
 * any kind — `payload` is unconstrained jsonb with no CHECK of its own, so
 * that type was the only guard, and it did not guard. A mismatch would
 * surface as a review card with an undefined title.
 */
export type ProposalInput =
  | { kind: "task"; payload: TaskPayload }
  | { kind: "contact_field"; payload: ContactFieldPayload }
  | { kind: "opportunity_stage"; payload: OpportunityStagePayload };

type CallProposalBase = {
  id: string; accountId: string; callId: string; contactId: string | null;
  evidence: string; status: ProposalStatus; decidedAt: string | null;
  decidedBy: string | null; createdAt: string;
};

/** Same discriminated shape as `ProposalInput`: a consumer narrows on
 *  `kind` to reach the matching `payload` type instead of casting. */
export type CallProposal =
  | (CallProposalBase & { kind: "task"; payload: TaskPayload })
  | (CallProposalBase & { kind: "contact_field"; payload: ContactFieldPayload })
  | (CallProposalBase & { kind: "opportunity_stage"; payload: OpportunityStagePayload });

const COLS =
  "id, account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by, created_at";

type Row = {
  id: string; account_id: string; call_id: string; contact_id: string | null;
  kind: ProposalKind; payload: unknown; evidence: string;
  status: ProposalStatus; decided_at: string | null; decided_by: string | null;
  created_at: string;
};

// The cast is the read boundary: Postgres's `kind` CHECK constrains the
// column to the three known strings but knows nothing about `payload`
// (unconstrained jsonb), so nothing on the wire ties them together — the
// pairing is trusted here, at the one place a row becomes a `CallProposal`,
// the same way `insertProposal`'s `ProposalInput` ties them on the way in.
function toProposal(r: Row): CallProposal {
  return {
    id: r.id, accountId: r.account_id, callId: r.call_id, contactId: r.contact_id,
    kind: r.kind, payload: r.payload, evidence: r.evidence, status: r.status,
    decidedAt: r.decided_at, decidedBy: r.decided_by, createdAt: r.created_at,
  } as CallProposal;
}

/**
 * Writes one proposal, or returns null.
 *
 * NULL, NEVER A THROW. This runs inside the voice lifecycle's best-effort
 * tail, where the contract is that nothing about the call changes if
 * proposals fail. The two expected refusals — the partial unique index
 * (a re-run proposing the same thing twice, `23505`) and the non-empty
 * evidence CHECK (`23514`) — are both normal outcomes of a pass doing its
 * job, not faults, and both log as such. Anything else (a dead connection,
 * a renamed column, a foreign key that no longer resolves) is a real fault
 * masquerading as "nothing to propose" if it logs the same way — it is
 * branched to its own, greppable log line instead. Either way the caller
 * gets null and never reacts to it; only the log line tells the two apart.
 *
 * The caller MUST pass the call's OWN account. There is no composite FK
 * tying `call_proposals.(account_id, call_id)` to `calls.(account_id, id)`,
 * so account A's id alongside account B's `callId` writes a row RLS then
 * shows to account A — including `evidence`, a verbatim quote from account
 * B's call. Not reachable today: no caller exists yet.
 */
export async function insertProposal(
  db: SupabaseClient, accountId: string,
  input: { callId: string; contactId?: string | null; evidence: string } & ProposalInput,
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("call_proposals")
    .insert({
      account_id: accountId, call_id: input.callId,
      contact_id: input.contactId ?? null, kind: input.kind,
      payload: input.payload, evidence: input.evidence,
    })
    .select("id").single();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505" || code === "23514") {
      console.error(
        `insertProposal: refused for call ${input.callId} kind ${input.kind}: ${error.message}`,
      );
    } else {
      console.error(
        `insertProposal: unexpected fault (code ${code || "none"}) for call ${input.callId} ` +
        `kind ${input.kind}: ${error.message}`,
      );
    }
    return null;
  }
  return { id: data!.id as string };
}

export async function listProposalsForCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("call_id", callId)
    .order("created_at", { ascending: false })
    // Same reasoning as countLinesTurningCallersAway (screened-calls.ts):
    // service_role's rolconfig carries no statement_timeout and
    // PostgREST's db-max-rows is unset, so an unbounded read is unbounded
    // in production.
    .limit(500);
  if (error) throw new Error(`listProposalsForCall failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function listPendingProposals(
  db: SupabaseClient, accountId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("status", "pending")
    .order("created_at", { ascending: false })
    // Same reasoning as countLinesTurningCallersAway (screened-calls.ts):
    // service_role's rolconfig carries no statement_timeout and
    // PostgREST's db-max-rows is unset, so an unbounded read is unbounded
    // in production.
    .limit(500);
  if (error) throw new Error(`listPendingProposals failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function getProposal(
  db: SupabaseClient, accountId: string, id: string,
): Promise<CallProposal | null> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("id", id)
    // `id` is the PK, so this is already bounded to at most one row — the
    // backstop the other two reads need has nothing to add here, but the
    // `.limit(1)` says so instead of leaving it to be re-derived.
    .limit(1).maybeSingle();
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

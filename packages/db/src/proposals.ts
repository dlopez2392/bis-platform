import type { SupabaseClient } from "@supabase/supabase-js";
import { brandDisplayName } from "./branding";
import {
  SYSTEM_DECIDER, parseTaskPayload, parseContactFieldPayload, parseOpportunityStagePayload,
  type Proposal, type ProposalInput, type ProposalKind, type ProposalSource, type ProposalStatus,
  type ExpiredReason, type EvidenceRef,
} from "./proposal-rules";

/**
 * One table for every AI suggestion (0088, item 8b-1; replaces call-proposals.ts). Every read and write
 * is scoped by `account_id`. The REQUEST client reads to authorise a decision (RLS); every write here
 * runs on the SERVICE client (0088 grants no client write), scoped by account, id and a status
 * compare-and-swap. Every write carries `.select("id")`: PostgREST returns no error and no rows for an
 * update matching nothing, which would otherwise read as success.
 *
 * Errors: every function here THROWS on a database error, except `insertProposal`, which never throws
 * (its doc). `setAppliedRef` and `expireProposals` included: a false or an empty list means "matched
 * nothing", never "the database failed".
 */

const COLS =
  "id, account_id, source, call_id, contact_id, kind, payload, applied_payload, applied_ref, evidence, " +
  "evidence_ref, evidence_lang, status, expired_reason, decided_at, decided_by, undone_at, undone_by, " +
  "expires_at, created_at";

type Row = {
  id: string; account_id: string; source: ProposalSource; call_id: string | null; contact_id: string | null;
  kind: ProposalKind; payload: unknown; applied_payload: unknown; applied_ref: unknown;
  evidence: string; evidence_ref: EvidenceRef; evidence_lang: "en" | "es" | null;
  status: ProposalStatus; expired_reason: ExpiredReason | null;
  decided_at: string | null; decided_by: string | null; undone_at: string | null; undone_by: string | null;
  expires_at: string; created_at: string;
};

/**
 * The read boundary. 0088's `kind` CHECK knows the three kinds but nothing ties `payload` to its kind,
 * so the payload is PARSED here by kind, never cast. A row whose payload does not fit is skipped and
 * logged by id (never the payload: it can carry a customer's words), so one bad row never takes a list
 * down and never reaches a screen as a card with an undefined title.
 */
function toProposal(r: Row, reader: string): Proposal | null {
  const base = {
    id: r.id, accountId: r.account_id, source: r.source, callId: r.call_id, contactId: r.contact_id,
    evidence: r.evidence, evidenceRef: r.evidence_ref, evidenceLang: r.evidence_lang,
    status: r.status, expiredReason: r.expired_reason,
    appliedPayload: r.applied_payload, appliedRef: r.applied_ref,
    decidedAt: r.decided_at, decidedBy: r.decided_by, undoneAt: r.undone_at, undoneBy: r.undone_by,
    expiresAt: r.expires_at, createdAt: r.created_at,
  };
  if (r.kind === "task") {
    const payload = parseTaskPayload(r.payload);
    if (payload) return { ...base, kind: "task", payload };
  } else if (r.kind === "contact_field") {
    const payload = parseContactFieldPayload(r.payload);
    if (payload) return { ...base, kind: "contact_field", payload };
  } else if (r.kind === "opportunity_stage") {
    const payload = parseOpportunityStagePayload(r.payload);
    if (payload) return { ...base, kind: "opportunity_stage", payload };
  }
  console.error(`${reader}: skipped proposal ${r.id}: payload does not fit kind ${String(r.kind)}`);
  return null;
}

function toProposals(rows: Row[], reader: string): Proposal[] {
  const out: Proposal[] = [];
  for (const r of rows) {
    const p = toProposal(r, reader);
    if (p) out.push(p);
  }
  return out;
}

const codeOf = (error: unknown) => (error as { code?: string }).code;

/**
 * Writes one suggestion, or returns null.
 *
 * NULL, NEVER A THROW. This runs inside the voice lifecycle's best-effort tail, where the contract is
 * that nothing about the call changes if suggestions fail. The two expected refusals, the one-pending
 * index (a re-run proposing the same thing twice, `23505`) and a CHECK (`23514`, the non-empty
 * evidence), are normal outcomes of a pass doing its job and log as such. Anything else (a dead
 * connection, a renamed column, a foreign key that no longer resolves, a missing NOT NULL) is a real
 * fault and gets its own, greppable line. Either way the caller gets null and never reacts to it.
 *
 * 0088's composite FK ties `(account_id, call_id)` to `calls (account_id, id)`, so account A's id with
 * account B's call is refused (`23503`, the fault line) rather than written to the wrong account.
 */
export async function insertProposal(
  db: SupabaseClient, accountId: string,
  input: {
    callId: string; contactId?: string | null; evidence: string; evidenceRef: EvidenceRef;
    evidenceLang: "en" | "es"; expiresAt: string;
  } & ProposalInput,
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("proposals")
    .insert({
      account_id: accountId, source: "call", call_id: input.callId,
      contact_id: input.contactId ?? null, kind: input.kind,
      payload: input.payload, evidence: input.evidence,
      evidence_ref: input.evidenceRef, evidence_lang: input.evidenceLang, expires_at: input.expiresAt,
    })
    .select("id").single();
  if (error) {
    const code = codeOf(error);
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

/** Every suggestion on one call, newest first, at most 500 (service_role has no statement_timeout and
 *  PostgREST's db-max-rows is unset, so an unbounded read is unbounded in production). */
export async function listProposalsForCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<Proposal[]> {
  const { data, error } = await db.from("proposals").select(COLS)
    .eq("account_id", accountId).eq("call_id", callId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`listProposalsForCall failed: ${error.message}`);
  return toProposals((data ?? []) as unknown as Row[], "listProposalsForCall");
}

/** The tray's read: pending and not aged (`expires_at > now`), newest first. Asks for 201 so the page
 *  can show 200 and say there are more (plan deviation 19). */
export async function listPendingProposals(
  db: SupabaseClient, accountId: string, now: Date = new Date(),
): Promise<Proposal[]> {
  const { data, error } = await db.from("proposals").select(COLS)
    .eq("account_id", accountId).eq("status", "pending").gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(201);
  if (error) throw new Error(`listPendingProposals failed: ${error.message}`);
  return toProposals((data ?? []) as unknown as Row[], "listPendingProposals");
}

/**
 * `listPendingProposals`'s cross-tenant twin, for `/dashboard/work`, agency-wide by construction the
 * way `listAgencyWork` is (work-queue.ts). Copies its accounts-join shape: read the rows, collect the
 * distinct account ids they carry, read only THOSE accounts' `brand_name` and zone, and resolve each
 * name through `brandDisplayName`, which takes no fallback, so a blank `brand_name` comes through as
 * `""`, never `accounts.name` (the agency's internal label).
 *
 * The 500 cap is GLOBAL, ordered newest first, not per account: one account's burst can crowd every
 * quiet account's suggestions off this screen with no trace.
 */
export async function listPendingProposalsForAgency(
  db: SupabaseClient, now: Date = new Date(),
): Promise<(Proposal & { brandName: string; timezone: string })[]> {
  const { data, error } = await db.from("proposals").select(COLS)
    .eq("status", "pending").gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`listPendingProposalsForAgency failed: ${error.message}`);
  const rows = toProposals((data ?? []) as unknown as Row[], "listPendingProposalsForAgency");
  if (rows.length === 0) return [];

  const accountIds = [...new Set(rows.map((r) => r.accountId))];
  const { data: accounts, error: aErr } = await db.from("accounts")
    .select("id, brand_name, timezone")
    .in("id", accountIds);
  if (aErr) throw new Error(`listPendingProposalsForAgency accounts read failed: ${aErr.message}`);

  const brandNameByAccount = new Map<string, string>();
  const timezoneByAccount = new Map<string, string>();
  for (const a of (accounts ?? []) as { id: string; brand_name: string | null; timezone: string }[]) {
    brandNameByAccount.set(a.id, brandDisplayName({
      brandName: a.brand_name, brandLogoPath: null, brandColor: null,
      brandNeutral: null, brandCorners: null, brandType: null,
      brandMode: null, replyToEmail: null,
    }));
    timezoneByAccount.set(a.id, a.timezone);
  }
  return rows.map((r) => ({
    ...r,
    brandName: brandNameByAccount.get(r.accountId) ?? "",
    // UTC only when the account row itself could not be read (not reachable: the id came off a row
    // read a moment ago), rather than throwing this best-effort screen away over one zone.
    timezone: timezoneByAccount.get(r.accountId) ?? "UTC",
  }));
}

/** One suggestion, or null. On the REQUEST client this is what authorises a decision (RLS). */
export async function getProposal(
  db: SupabaseClient, accountId: string, id: string,
): Promise<Proposal | null> {
  const { data, error } = await db.from("proposals").select(COLS)
    .eq("account_id", accountId).eq("id", id)
    .limit(1).maybeSingle();
  if (error) throw new Error(`getProposal failed: ${error.message}`);
  return data ? toProposal(data as unknown as Row, "getProposal") : null;
}

/** The customer's OTHER pending, not-aged suggestions of one kind (what an Accept supersedes), ≤ 50. */
export async function listPendingSiblings(
  db: SupabaseClient, accountId: string, q: { kind: ProposalKind; contactId: string; exceptId: string },
): Promise<Proposal[]> {
  const { data, error } = await db.from("proposals").select(COLS)
    .eq("account_id", accountId).eq("status", "pending").eq("kind", q.kind)
    .eq("contact_id", q.contactId).neq("id", q.exceptId)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`listPendingSiblings failed: ${error.message}`);
  return toProposals((data ?? []) as unknown as Row[], "listPendingSiblings");
}

/**
 * Decides a pending suggestion, and reports whether it actually decided one. `.eq("status",
 * "pending")` is the compare-and-swap (P15): two people pressing Accept on the same card must not both
 * succeed, and the second must learn that it did nothing. A CHECK refusal (an `edited` whose applied
 * payload equals the proposal, `proposals_edited_changes`) throws with the database's message, which
 * names the constraint.
 */
export async function decideProposal(
  writer: SupabaseClient, accountId: string, id: string,
  d:
    | { to: "accepted" | "edited"; decidedBy: string; appliedPayload: unknown; now: Date }
    | { to: "dismissed"; decidedBy: string; now: Date }
    | { to: "expired"; reason: ExpiredReason; now: Date },
): Promise<boolean> {
  const decided_at = d.now.toISOString();
  const patch =
    d.to === "expired"
      ? { status: "expired", decided_at, decided_by: SYSTEM_DECIDER, expired_reason: d.reason }
      : d.to === "dismissed"
        ? { status: "dismissed", decided_at, decided_by: d.decidedBy }
        : { status: d.to, decided_at, decided_by: d.decidedBy, applied_payload: d.appliedPayload };
  const { data, error } = await writer.from("proposals").update(patch)
    .eq("account_id", accountId).eq("id", id).eq("status", "pending")
    .select("id");
  if (error) throw new Error(`decideProposal failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Gives an Accept (or Edit and accept) back when its CRM write failed: accepted|edited -> pending,
 * clearing the decision and the applied columns, only while the row is still THIS decider's. No
 * `undone_*` stamp: nothing was done to undo. `23505` (a fresh pending suggestion for the same call,
 * kind and customer landed meanwhile) is `"collision"`; matching nothing is `"missed"`; both logged.
 */
export async function revertProposalDecision(
  writer: SupabaseClient, accountId: string, id: string, decidedBy: string,
): Promise<"reverted" | "missed" | "collision"> {
  const { data, error } = await writer.from("proposals")
    .update({ status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null })
    .eq("account_id", accountId).eq("id", id).in("status", ["accepted", "edited"]).eq("decided_by", decidedBy)
    .select("id");
  if (error) {
    if (codeOf(error) === "23505") {
      console.error(
        `revertProposalDecision: proposal ${id} (account ${accountId}) stays decided: ` +
        `a new suggestion for the same call is pending`,
      );
      return "collision";
    }
    throw new Error(`revertProposalDecision failed: ${error.message}`);
  }
  if ((data ?? []).length === 0) {
    console.error(`revertProposalDecision: proposal ${id} (account ${accountId}) was not ${decidedBy}'s decision to give back`);
    return "missed";
  }
  return "reverted";
}

/** What Undo needs to reverse the applied write (the task id, the field's prior value, the stage). */
export async function setAppliedRef(
  writer: SupabaseClient, accountId: string, id: string, ref: unknown,
): Promise<boolean> {
  const { data, error } = await writer.from("proposals").update({ applied_ref: ref })
    .eq("account_id", accountId).eq("id", id)
    .select("id");
  if (error) throw new Error(`setAppliedRef failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Marks pending suggestions out of date with one reason, all stamped with the SAME `decidedAt` (an
 * Accept stamps the siblings it supersedes with its own instant, so Undo can give back exactly those:
 * reviewer note 2). Answers the ids it moved; a row no longer pending is left alone.
 */
export async function expireProposals(
  writer: SupabaseClient, accountId: string, ids: string[], reason: ExpiredReason, decidedAt: string,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await writer.from("proposals")
    .update({ status: "expired", expired_reason: reason, decided_at: decidedAt, decided_by: SYSTEM_DECIDER })
    .eq("account_id", accountId).in("id", ids).eq("status", "pending")
    .select("id");
  if (error) throw new Error(`expireProposals failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Undo (P8, P9): the row goes back to pending, `decided_*`, `applied_*` and `expired_reason` cleared,
 * `undone_*` stamped, only while it is in one of `u.from` and still decided by `u.decidedBy`. `23505`
 * (a fresh pending suggestion for the same call, kind and customer) is `"collision"`, logged.
 */
export async function undoProposalDecision(
  writer: SupabaseClient, accountId: string, id: string,
  u: { decidedBy: string; from: ProposalStatus[]; now: Date },
): Promise<"undone" | "missed" | "collision"> {
  const { data, error } = await writer.from("proposals")
    .update({
      status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null,
      expired_reason: null, undone_at: u.now.toISOString(), undone_by: u.decidedBy,
    })
    .eq("account_id", accountId).eq("id", id).in("status", u.from).eq("decided_by", u.decidedBy)
    .select("id");
  if (error) {
    if (codeOf(error) === "23505") {
      console.error(
        `undoProposalDecision: proposal ${id} (account ${accountId}) cannot be pending again: ` +
        `a new suggestion for the same call is pending`,
      );
      return "collision";
    }
    throw new Error(`undoProposalDecision failed: ${error.message}`);
  }
  return (data ?? []).length > 0 ? "undone" : "missed";
}

/**
 * After an Undo met `"collision"`: the CRM write was already reversed, so the row is no longer the
 * decider's Accept. It becomes out of date (superseded by the newer pending suggestion), applied
 * columns cleared, only while it is still accepted|edited by that decider.
 */
export async function expireAfterUndoCollision(
  writer: SupabaseClient, accountId: string, id: string, decidedBy: string, now: Date,
): Promise<boolean> {
  const { data, error } = await writer.from("proposals")
    .update({
      status: "expired", expired_reason: "superseded", decided_by: SYSTEM_DECIDER, decided_at: now.toISOString(),
      applied_payload: null, applied_ref: null,
    })
    .eq("account_id", accountId).eq("id", id).in("status", ["accepted", "edited"]).eq("decided_by", decidedBy)
    .select("id");
  if (error) throw new Error(`expireAfterUndoCollision failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Undo gives back the siblings its Accept superseded (reviewer note 2): each one only while it is
 * still `expired / superseded`, decided by the app, at exactly `decidedAt` (the Accept's own instant),
 * so a sibling expired by another decision, or restored and decided since, stays. A sibling whose call
 * meanwhile got a new pending suggestion (`23505`) stays out of date and is reported in `collided`.
 */
export async function restoreSiblings(
  writer: SupabaseClient, accountId: string, ids: string[], decidedAt: string,
): Promise<{ restored: string[]; collided: string[] }> {
  const restored: string[] = [];
  const collided: string[] = [];
  for (const id of ids) {
    const { data, error } = await writer.from("proposals")
      .update({ status: "pending", decided_at: null, decided_by: null, expired_reason: null })
      .eq("account_id", accountId).eq("id", id).eq("status", "expired").eq("expired_reason", "superseded")
      .eq("decided_by", SYSTEM_DECIDER).eq("decided_at", decidedAt)
      .select("id");
    if (error) {
      if (codeOf(error) === "23505") {
        collided.push(id);
        console.error(
          `restoreSiblings: sibling ${id} (account ${accountId}) stays out of date: ` +
          `a new suggestion for the same call is pending`,
        );
        continue;
      }
      throw new Error(`restoreSiblings failed: ${error.message}`);
    }
    if ((data ?? []).length > 0) restored.push(id);
  }
  return { restored, collided };
}

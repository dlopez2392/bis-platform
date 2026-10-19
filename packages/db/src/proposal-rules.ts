/**
 * The fixed rules of an AI suggestion (item 8b-1, spec P3, P8, P10; plan deviation 2), in ONE module:
 * the lists 0088's CHECKs hold (test/proposals-schema.test.ts pins them against the SQL, both ways),
 * the windows, the payload types and the pure readers. Pure: no client, no I/O, imports nothing, safe in
 * the browser. Web code imports these from `@bis/db/proposal-rules`, never from the barrel, so no bare
 * `vi.mock("@bis/db", () => ({ ... }))` factory can blank them.
 */

export const PROPOSAL_KINDS = ["task", "contact_field", "opportunity_stage"] as const;
/** One clause per source in 0088's proposals_source_key; a new source adds its column and its clause. */
export const PROPOSAL_SOURCES = ["call"] as const;
export const PROPOSAL_STATUSES = ["pending", "accepted", "edited", "dismissed", "expired"] as const;
export const EXPIRED_REASONS = [
  "field_filled", "name_mismatch", "deal_moved", "deal_closed", "deal_gone", "superseded", "aged",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ExpiredReason = (typeof EXPIRED_REASONS)[number];

/** A pending suggestion is out of date this long after it was made (P10, P19). */
export const PROPOSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** The server accepts Undo for this long after the decision, by the decider only (P8). The consent
 *  controls' value (apps/web/src/lib/consent/staff-actions.ts:51). */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;
/** decided_by when the app, not a person, decided (out of date). Not a Clerk user id. */
export const SYSTEM_DECIDER = "system";

export type ContactFieldName = "firstName" | "lastName" | "email" | "phone";
export type TaskPayload = { title: string; dueAt: string | null };
export type ContactFieldPayload = { field: ContactFieldName; value: string };
export type OpportunityStagePayload = { opportunityId: string; fromStageId: string; toStageId: string };
export type ProposalPayload = TaskPayload | ContactFieldPayload | OpportunityStagePayload;

/**
 * `kind` tied to its matching `payload`, so a mismatch (`kind: "task"` carrying an
 * `OpportunityStagePayload`) cannot typecheck at `insertProposal`'s call site. `payload` is jsonb with
 * no CHECK of its own, so on the way IN this type is the guard; on the way OUT the `parse*` functions
 * below are.
 */
export type ProposalInput =
  | { kind: "task"; payload: TaskPayload }
  | { kind: "contact_field"; payload: ContactFieldPayload }
  | { kind: "opportunity_stage"; payload: OpportunityStagePayload };

/** Where in the call the evidence was said: the transcript index of the grounding caller turn and its
 *  instant; `{}` for a row with no turn on record (the copy, the mirror). */
export type EvidenceRef = { turn: number; at: string } | Record<string, never>;

type ProposalBase = {
  id: string; accountId: string; source: ProposalSource; callId: string | null; contactId: string | null;
  evidence: string; evidenceRef: EvidenceRef; evidenceLang: "en" | "es" | null;
  status: ProposalStatus; expiredReason: ExpiredReason | null;
  /** Parsed by the kind's registry module, never cast here. */
  appliedPayload: unknown; appliedRef: unknown;
  decidedAt: string | null; decidedBy: string | null; undoneAt: string | null; undoneBy: string | null;
  expiresAt: string; createdAt: string;
};

/** Same discriminated shape as `ProposalInput`: a consumer narrows on `kind` to reach the payload. */
export type Proposal =
  | (ProposalBase & { kind: "task"; payload: TaskPayload })
  | (ProposalBase & { kind: "contact_field"; payload: ContactFieldPayload })
  | (ProposalBase & { kind: "opportunity_stage"; payload: OpportunityStagePayload });

/**
 * P10: a pending row past `expires_at` is out of date to every reader, with the reason "aged"; nothing
 * sweeps it. Any other status is returned unchanged (its stored reason, if any, is the row's own
 * `expiredReason`; `reason` here is non-null only when this function derived the status).
 */
export function effectiveStatus(
  row: { status: ProposalStatus; expiresAt: string }, now: Date,
): { status: ProposalStatus; reason: ExpiredReason | null } {
  if (row.status === "pending" && Date.parse(row.expiresAt) <= now.getTime()) {
    return { status: "expired", reason: "aged" };
  }
  return { status: row.status, reason: null };
}

/** The instant a suggestion made at `now` goes out of date (plan deviation 4: the call's own instant). */
export function proposalExpiresAt(now: Date): string {
  return new Date(now.getTime() + PROPOSAL_MAX_AGE_MS).toISOString();
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const CONTACT_FIELD_NAMES: readonly string[] = ["firstName", "lastName", "email", "phone"] satisfies ContactFieldName[];

/** The read boundary for a task payload: null when the shape is wrong. Only the known keys come back;
 *  an absent `dueAt` reads as null (no due date), a non-string one is a wrong shape, and so is a string
 *  that is not an instant ("next week", ""): every screen formats it, and an Invalid Date throws there. */
export function parseTaskPayload(v: unknown): TaskPayload | null {
  if (!isObject(v) || typeof v.title !== "string") return null;
  const dueAt = v.dueAt ?? null;
  if (dueAt !== null && (typeof dueAt !== "string" || Number.isNaN(Date.parse(dueAt)))) return null;
  return { title: v.title, dueAt };
}

export function parseContactFieldPayload(v: unknown): ContactFieldPayload | null {
  if (!isObject(v) || typeof v.field !== "string" || !CONTACT_FIELD_NAMES.includes(v.field)) return null;
  if (typeof v.value !== "string") return null;
  return { field: v.field as ContactFieldName, value: v.value };
}

export function parseOpportunityStagePayload(v: unknown): OpportunityStagePayload | null {
  if (!isObject(v)) return null;
  const { opportunityId, fromStageId, toStageId } = v;
  if (typeof opportunityId !== "string" || typeof fromStageId !== "string" || typeof toStageId !== "string") return null;
  return { opportunityId, fromStageId, toStageId };
}

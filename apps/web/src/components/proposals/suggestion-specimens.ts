import type { Proposal } from "@bis/db/proposal-rules";

/**
 * Typed-out suggestion rows for the card's tests and the styleguide (item 8b-1, Task 7). Plain data:
 * no `@bis/db` value, no clock. The call was on Wed, Oct 14 2026 at 9:42 AM in America/Chicago.
 */
export const ZONE = "America/Chicago";
export const CALL_AT = "2026-10-14T14:42:00.000Z";
/** The day after the call, mid-morning in Chicago. */
export const NOW = new Date("2026-10-15T15:00:00.000Z");
export const ANA = "user_ana";
export const NAMES: Readonly<Record<string, string>> = { [ANA]: "Ana Lopez" };
export const STAGES = {
  st_new: { name: "New lead", position: 0 },
  st_quote: { name: "Quote sent", position: 1 },
  st_follow: { name: "Following up", position: 2 },
  st_won: { name: "Won", position: 3 },
} as const;
export const PIPELINE_STAGES = [
  { id: "st_new", name: "New lead", position: 0, pipelineId: "pl_1" },
  { id: "st_quote", name: "Quote sent", position: 1, pipelineId: "pl_1" },
  { id: "st_follow", name: "Following up", position: 2, pipelineId: "pl_1" },
  { id: "st_won", name: "Won", position: 3, pipelineId: "pl_1" },
  { id: "st_other", name: "Other pipeline stage", position: 1, pipelineId: "pl_2" },
] as const;

const base = {
  accountId: "acc_1", source: "call" as const, callId: "call_1", contactId: "con_1",
  evidence: "Can someone call me back about the quote next week?", evidenceRef: {}, evidenceLang: "en" as const,
  expiredReason: null, appliedPayload: null, appliedRef: null,
  decidedAt: null, decidedBy: null, undoneAt: null, undoneBy: null,
  expiresAt: "2026-11-13T14:42:00.000Z", createdAt: CALL_AT,
};
/** Decided at 9:42 AM on NOW's own day, so the decided line reads the time alone. */
export const DECIDED_AT = "2026-10-15T14:42:00.000Z";
const decided = { decidedAt: DECIDED_AT, decidedBy: ANA };

export const TITLE = "Call back about the quote";
export const rows = {
  pending: { ...base, id: "sg_pending", status: "pending", kind: "task",
    payload: { title: TITLE, dueAt: "2026-10-21T15:00:00.000Z" } },
  accepted: { ...base, ...decided, id: "sg_accepted", status: "accepted", kind: "contact_field",
    payload: { field: "phone", value: "+1 956 555 0142" } },
  edited: { ...base, ...decided, id: "sg_edited", status: "edited", kind: "task",
    payload: { title: TITLE, dueAt: null } },
  dismissed: { ...base, ...decided, id: "sg_dismissed", status: "dismissed", kind: "contact_field",
    payload: { field: "email", value: "rio@example.com" } },
  expired: { ...base, id: "sg_expired", status: "expired", expiredReason: "deal_moved", decidedAt: DECIDED_AT,
    decidedBy: "system", kind: "opportunity_stage",
    payload: { opportunityId: "opp_1", fromStageId: "st_new", toStageId: "st_quote" } },
  /** Pending in storage, past `expiresAt`: out of date to every reader (effectiveStatus). */
  aged: { ...base, id: "sg_aged", status: "pending", expiresAt: "2026-10-15T00:00:00.000Z", kind: "opportunity_stage",
    payload: { opportunityId: "opp_1", fromStageId: "st_new", toStageId: "st_quote" } },
  stage: { ...base, id: "sg_stage", status: "pending", kind: "opportunity_stage",
    payload: { opportunityId: "opp_1", fromStageId: "st_new", toStageId: "st_quote" } },
  field: { ...base, id: "sg_field", status: "pending", kind: "contact_field",
    payload: { field: "email", value: "rio@example.com" } },
  spanishEvidence: { ...base, id: "sg_es", status: "pending", evidenceLang: "es",
    evidence: "¿Me puede llamar el jueves?", kind: "task", payload: { title: TITLE, dueAt: null } },
} satisfies Record<string, Proposal>;

/** Every state the card shows, in the order a reader meets them. */
export const FIVE = ["pending", "accepted", "edited", "dismissed", "expired"] as const;
/** One pending row of each kind, for the three edit forms (to-do, field, stage). */
export const EDITS = ["pending", "field", "stage"] as const;

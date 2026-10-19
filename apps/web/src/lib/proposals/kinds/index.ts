import type { Proposal, ProposalKind } from "@bis/db/proposal-rules";
import { contactFieldKind } from "./contact-field";
import { opportunityStageKind } from "./opportunity-stage";
import { taskKind } from "./task";
import type { KindDef } from "./types";

/** The payload a kind carries, read off `Proposal`'s own discriminated union. */
export type PayloadOf<K extends ProposalKind> = Extract<Proposal, { kind: K }>["payload"];

/**
 * The kind registry (item 8b-1, spec 4.2): one module per kind, every screen and every decision reads
 * a suggestion through it. Server only. The keys equal `PROPOSAL_KINDS` (`index.test.ts`) and 0088's
 * CHECK (`packages/db/src/test/proposals-schema.test.ts`). No kind module reads a `@bis/db` value at
 * import time, so a bare `vi.mock("@bis/db", () => ({}))` can load this file.
 */
export const KINDS = {
  task: taskKind,
  contact_field: contactFieldKind,
  opportunity_stage: opportunityStageKind,
} satisfies { [K in ProposalKind]: KindDef<K, PayloadOf<K>> };

export function kindOf<K extends ProposalKind>(k: K): (typeof KINDS)[K] {
  return KINDS[k];
}

/** P16: reserved, not built. The tray takes the stop hold over after 1 Dec 2026 and counsel's step-6
 *  read, or with decision 6. No CHECK value, no module. */
export type ReservedKind = "consent_hold";

export type * from "./types";

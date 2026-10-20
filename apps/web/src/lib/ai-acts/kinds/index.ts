import type { AiAct, AiActKind } from "@bis/db/ai-act-rules";
import { bookingCancelledKind } from "./booking-cancelled";
import { bookingCreatedKind } from "./booking-created";
import { bookingRescheduledKind } from "./booking-rescheduled";
import { contactCreatedKind } from "./contact-created";
import { contactFieldFilledKind } from "./contact-field-filled";
import type { ActControl, ActFacts, ActKindDef, DescribeActCtx, StillSafe } from "./types";

/**
 * The act-kind registry (item 8c, spec 4.2, D5): one module per kind, every screen reads an act through it.
 * Server only (the client gets a built view, `view.ts`). Its keys equal `AI_ACT_KINDS` and 0091's CHECK
 * (`index.test.ts`).
 */
export const ACT_KINDS = {
  booking_created: bookingCreatedKind,
  booking_rescheduled: bookingRescheduledKind,
  booking_cancelled: bookingCancelledKind,
  contact_created: contactCreatedKind,
  contact_field_filled: contactFieldFilledKind,
} satisfies { [K in AiActKind]: ActKindDef<K> };

/** The kind's own module, typed to the act it is handed (TypeScript cannot pair a union's arms across a lookup). */
function defOf(act: AiAct): ActKindDef<AiActKind> {
  return ACT_KINDS[act.kind] as unknown as ActKindDef<AiActKind>;
}

export function describeAct(act: AiAct, ctx: DescribeActCtx): { verb: string; detail: string | null } {
  return defOf(act).describe(act, ctx);
}

export function stillSafeOf(act: AiAct, facts: ActFacts): StillSafe {
  return defOf(act).stillSafe(act, facts);
}

export function controlOf(act: AiAct): ActControl {
  return ACT_KINDS[act.kind].control;
}

export type * from "./types";
export { REASON_KEY, hasStarted, sameInstant } from "./types";

// S-47e (spec 5.1): the identity ladder. Decision 28: fixed in code, no account setting. The ONLY place a rung
// or a requirement is written. Pure.
import type { TradeModuleId } from "../modules";

export type Rung = 0 | 1 | 2 | 3;
export type IdentityAction = "read_existing" | "change_existing" | "book_new" | "leave_message";
type Requirements = Readonly<Record<IdentityAction, Rung>>;

/** Rung 3 (a one-time code) is declared and unbuilt: no action requires it (spec E1). */
export const NO_PACK: Requirements = { read_existing: 1, change_existing: 1, book_new: 0, leave_message: 0 };
export const PACK_REQUIREMENTS: Readonly<Record<TradeModuleId, Requirements>> = {
  // Equal to the no-pack row today (SD11), declared so a later change to the base row cannot move it silently.
  events: { read_existing: 1, change_existing: 1, book_new: 0, leave_message: 0 },
  insurance_pc: { read_existing: 2, change_existing: 2, book_new: 0, leave_message: 0 },
};

/** An id this build does not know reads as no pack (modules/index.ts:53-58's rule). */
export function requiredRung(action: IdentityAction, tradeModule: TradeModuleId | null | undefined): Rung {
  const row = tradeModule != null && Object.hasOwn(PACK_REQUIREMENTS, tradeModule)
    ? PACK_REQUIREMENTS[tradeModule]
    : NO_PACK;
  return row[action];
}

import type { BookingStatus } from "@bis/db";
import type { AiAct, AiActKind } from "@bis/db/ai-act-rules";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";

/**
 * The act-kind registry's shape (item 8c, plan Task 5 item 1; 8b's suggestion kinds, `lib/proposals/kinds`,
 * are the model). One module per kind: what the row says (`describe`), whether its Undo is still safe to
 * OFFER (`stillSafe`, pure, over one batched read, `facts.ts`), and which control undoes it. The write
 * itself is never here: each Undo runs through 0091's function or a compare-and-swap (`actions.ts`), which
 * is the authority; `stillSafe` is only the display (plan ambiguities H, I).
 *
 * Server only, but pure: no kind module reads a `@bis/db` value, at import time or at all, so a bare
 * `vi.mock("@bis/db", () => ({}))` factory can load this graph.
 */

/** One booking as the display needs it, keyed by id. `replacedBy` is the id of a booking whose
 *  `rescheduled_from_id` names this one; `slotTaken` is whether another live booking on the same calendar
 *  overlaps this one's range now (read only for the booking whose slot an Undo would put back). */
export type ActBookingFact = {
  status: BookingStatus; startsAt: string; endsAt: string; updatedAt: string;
  replacedBy: string | null; slotTaken: boolean;
};

export type ActFacts = {
  now: Date;
  bookings: Readonly<Record<string, ActBookingFact>>;
  /** The record's own row (`getContact`, the request client), or null when it could not be read. */
  contact: Record<string, unknown> | null;
  /** Act id -> `ai_contact_held_by`'s answer; read only for an Owner (or the agency). */
  heldBy: Readonly<Record<string, readonly string[]>>;
  /** Act id -> the person who last edited the field after the act (`lastFieldEditor`), or null. */
  editors: Readonly<Record<string, string | null>>;
  /** `requireAccountAccess().canManage`: the agency or this account's Owner (deletion is theirs, 0066). */
  canDelete: boolean;
  /** The contact's own future booked bookings (ids), read only when a cancelled-booking act is on the page:
   *  restoring one while they hold another would leave them with two (plan Task 5 item 1, review minor). */
  futureBooked: readonly string[];
};

export type ActReason =
  | "alreadyCancelled" | "alreadyHappened" | "rebooked" | "timePassed" | "timeTaken" | "oldTimeTaken"
  | "changed" | "changedBy" | "hasActivity" | "hasBooking" | "otherBooking" | "ownerOnly";

/** Each reason's words. `changedBy` takes `{name}`. */
export const REASON_KEY: Readonly<Record<ActReason, MessageKey>> = {
  alreadyCancelled: "aiActs.reason.alreadyCancelled", alreadyHappened: "aiActs.reason.alreadyHappened",
  rebooked: "aiActs.reason.rebooked", timePassed: "aiActs.reason.timePassed", timeTaken: "aiActs.reason.timeTaken",
  oldTimeTaken: "aiActs.reason.oldTimeTaken", changed: "aiActs.reason.changed", changedBy: "aiActs.reason.changedBy",
  hasActivity: "aiActs.reason.hasActivity", hasBooking: "aiActs.reason.hasBooking",
  otherBooking: "aiActs.reason.otherBooking", ownerOnly: "aiActs.reason.ownerOnly",
};

export type StillSafe = { ok: true } | { ok: false; reason: ActReason };
export type ActControl = "field" | "booking" | "contact";
export type DescribeActCtx = { tr: Tr; zone: string };

export type ActKindDef<K extends AiActKind> = {
  kind: K;
  describe(act: AiAct & { kind: K }, ctx: DescribeActCtx): { verb: string; detail: string | null };
  /** Pure: the display's answer, from the page's one facts read. */
  stillSafe(act: AiAct & { kind: K }, facts: ActFacts): StillSafe;
  control: ActControl;
};

/** An instant has passed when it is at or before `now` (0091: still safe only while `starts_at > p_now`). */
export const hasStarted = (iso: string, now: Date): boolean => Date.parse(iso) <= now.getTime();

/** Two stored instants are the same version when they name the same millisecond (a JS ISO string written
 *  in, PostgREST's `+00:00` form read back: A1). An unparseable one never matches. */
export const sameInstant = (a: string, b: string): boolean => {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
};

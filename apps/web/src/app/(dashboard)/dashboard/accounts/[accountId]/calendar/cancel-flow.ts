import { m } from "@/lib/messages";
import type { CancelNoticeChoice } from "./actions";

/** Whether a customer notice can go for one booking (`cancelNoticeAvailability`,
 *  `cancel-notice.ts`). Declared here, in a module the browser may load. */
export type NoticeAvailability = "available" | "no_email" | "suppressed_account" | "address_blocked";

export type CancelStep =
  | { kind: "probe" }
  | { kind: "dialog" }
  | { kind: "now"; toast: string };

/**
 * F-048 (fix round I1, M2): what the Calendar page's Cancel button does.
 * The dialog exists to compose a customer notice; where none can go, a
 * dialog would be the bare "Are you sure?" DESIGN.md rule 6 forbids, so the
 * button cancels at once, as D-036 did, and the toast says why the customer
 * was not told. With an email on file the server is asked first
 * (`cancelNoticeOptionAction`), because only it knows whether the account
 * sends and whether the address has bounced.
 */
export function cancelStep(contactEmail: string | null, availability: NoticeAvailability | null): CancelStep {
  if (!contactEmail?.trim()) return { kind: "now", toast: m["calendar.bookings.cancelledToast"] };
  if (availability === null) return { kind: "probe" };
  if (availability === "available") return { kind: "dialog" };
  if (availability === "address_blocked") return { kind: "now", toast: m["calendar.bookings.cancelledToastAddressBlocked"] };
  return { kind: "now", toast: m["calendar.bookings.cancelledToast"] };
}

/** A cancel that asks for no notice: the cancel-at-once path. */
export const NO_NOTICE: CancelNoticeChoice = { send: false, locale: "en", message: "" };

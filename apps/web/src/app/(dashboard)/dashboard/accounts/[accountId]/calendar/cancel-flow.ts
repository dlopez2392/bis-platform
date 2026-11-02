import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { CancelNoticeChoice, CancelNoticeOptionResult } from "./actions";

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
export function cancelStep(
  contactEmail: string | null,
  availability: NoticeAvailability | null,
  locale: Locale = "en",
): CancelStep {
  if (!contactEmail?.trim()) return { kind: "now", toast: t(m, "calendar.bookings.cancelledToast", locale) };
  if (availability === null) return { kind: "probe" };
  if (availability === "available") return { kind: "dialog" };
  if (availability === "address_blocked") {
    return { kind: "now", toast: t(m, "calendar.bookings.cancelledToastAddressBlocked", locale) };
  }
  return { kind: "now", toast: t(m, "calendar.bookings.cancelledToast", locale) };
}

/** A cancel that asks for no notice: the cancel-at-once path. */
export const NO_NOTICE: CancelNoticeChoice = { send: false, locale: "en", message: "" };

/**
 * The Calendar page's Cancel button, minus React (fix round 2, I-1): ask
 * the server only when there is an email on file, open the dialog only when
 * a notice can go, and otherwise cancel at once with the toast `cancelStep`
 * names. M-a: a probe that answers not-ok, or throws, FAILS OPEN to the
 * reversible action: cancel at once with no notice and the
 * we-haven't-told-them toast, so a broken read never stops the owner
 * cancelling.
 */
export async function runCancelButton(deps: {
  contactEmail: string | null;
  probe: () => Promise<CancelNoticeOptionResult>;
  openDialog: () => void;
  cancelNow: (noNoticeMessage: string) => Promise<unknown>;
  locale?: Locale;
}): Promise<void> {
  const locale = deps.locale ?? "en";
  const first = cancelStep(deps.contactEmail, null, locale);
  if (first.kind === "now") {
    await deps.cancelNow(first.toast);
    return;
  }
  let option: CancelNoticeOptionResult | null;
  try {
    option = await deps.probe();
  } catch {
    option = null;
  }
  if (!option || !option.ok) {
    await deps.cancelNow(t(m, "calendar.bookings.cancelledToast", locale));
    return;
  }
  const next = cancelStep(deps.contactEmail, option.notice, locale);
  if (next.kind === "dialog") deps.openDialog();
  else if (next.kind === "now") await deps.cancelNow(next.toast);
}

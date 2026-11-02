/**
 * The four phone-number statuses, named once.
 *
 * This mapping existed twice before this file — in the Voice page's settings
 * panel and in the setup wizard's shared step module, each with a comment
 * saying "never a new vocabulary for the same four values". The numbers
 * inventory would have been a third copy. The vocabulary rule is worth
 * keeping and is better kept by having one place to change.
 *
 * Not decoration on any of those screens: "Live" means a paying client's
 * callers are reaching that line right now, and both the wizard's move and
 * the inventory's move take it away from them.
 */

import type { PhoneNumberStatus } from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** S-10 T9b: was a module-level `Record<PhoneNumberStatus, string>` built
 *  once from `m[...]` at import time (English always, whatever the
 *  reader's language) — this file is loaded transitively by the client's
 *  own Branding page (step-shared.tsx's `NumberChip` re-exports
 *  `NUMBER_STATUS_LABEL` alongside it), even though nothing there actually
 *  renders a number's status. A lazy function, parameterised on locale,
 *  reads nothing at import time, so which pages transitively load this
 *  module stops mattering for the i18n ratchet. Every real caller today
 *  (the Voice page, the numbers inventory, the setup wizard) is
 *  agency-only, hence the English default — unchanged behaviour, not a new
 *  translation. */
const NUMBER_STATUS_KEY: Record<PhoneNumberStatus, MessageKey> = {
  provisioned: "voice.numbers.status.provisioned",
  testing: "voice.numbers.status.testing",
  live: "voice.numbers.status.live",
  released: "voice.numbers.status.released",
};

export function numberStatusLabel(status: PhoneNumberStatus, locale: Locale = "en"): string {
  return t(m, NUMBER_STATUS_KEY[status], locale);
}

/** Service state, most-committed first — the order the inventory sorts rows
 *  in and the order its count strip reads them out, so the screen says the
 *  same thing twice rather than two different things. */
export const NUMBER_STATUS_ORDER: readonly PhoneNumberStatus[] = [
  "live", "testing", "provisioned", "released",
];

/**
 * Status is dot + word, never colour alone (DESIGN.md rule 3) — these are the
 * dots. `released` is an OUTLINE rather than a fill: an out-of-service number
 * and a provisioned one are both "answering nobody", and the hollow disc is
 * what distinguishes the one you can reclaim at a glance.
 */
export const NUMBER_STATUS_DOT: Record<PhoneNumberStatus, string> = {
  live: "bg-success",
  testing: "bg-warning",
  provisioned: "bg-muted-foreground/50",
  released: "border border-muted-foreground/60 bg-transparent",
};

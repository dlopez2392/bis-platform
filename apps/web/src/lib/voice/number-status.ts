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
import { m } from "@/lib/messages";

export const NUMBER_STATUS_LABEL: Record<PhoneNumberStatus, string> = {
  provisioned: m["voice.numbers.status.provisioned"],
  testing: m["voice.numbers.status.testing"],
  live: m["voice.numbers.status.live"],
  released: m["voice.numbers.status.released"],
};

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

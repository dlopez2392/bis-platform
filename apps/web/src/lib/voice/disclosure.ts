// S-47a (decision 20): does Sofía say she is an AI on THIS call? Decided once, at call start, by the
// incoming route, and stamped on the call row it already writes. Server only (node:crypto): a
// "use client" module (voice-settings.tsx) must never import this file.
import { randomInt } from "node:crypto";
import type { DisclosureSetting } from "@bis/db";

/** The three settings, in the order the Voice page shows them. The twin of voice_profiles_disclosure_check. */
export const DISCLOSURE_VALUES = ["off", "trial", "on"] as const satisfies readonly DisclosureSetting[];

/** `disclose`: say the sentence and use the disclosed identity line (and what `calls.disclosed` gets).
 *  `setting`: which setting decided it, stamped as `calls.disclosure_setting` (D5) — null for Off, so an
 *  Off call is stamped with neither column and never counted. */
export type DisclosureDecision = { disclose: boolean; setting: "trial" | "on" | null };

/**
 * Off (and any value a stale or missing read hands us): no. On: yes. Trial: a fair coin from
 * `crypto.randomInt`, never `Math.random` (spec §5.1), whose answer is both what is said and what is
 * stamped, so the two halves the results card compares are the calls that heard it and the calls that did
 * not. Only Trial calls are compared; On calls carry `setting: "on"` and stay out of the card (D5).
 */
export function decideDisclosure(setting: DisclosureSetting | null | undefined): DisclosureDecision {
  if (setting === "on") return { disclose: true, setting: "on" };
  if (setting === "trial") return { disclose: randomInt(2) === 1, setting: "trial" };
  return { disclose: false, setting: null };
}

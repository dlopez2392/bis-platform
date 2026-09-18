// The zone a screen should render in, and whether it had to guess.
//
// THE PROBLEM THIS REPLACES. `accounts.timezone` is free text, and five
// screens each grew their own answer for an unusable value. Four call
// `safeZone(account.timezone, "UTC")`, which silently prints a Texas evening
// as the following day — the previous-day defect this repo has already
// shipped once. The work queue refuses to guess and omits the date. The
// account dashboard does BOTH, fifty lines apart.
//
// danlo, 2026-09-17: "I do not want to omit the dates so let's find a
// workaround."
//
// THE WORKAROUND, AND WHY IT IS NOT A COMPROMISE. The defect was never that
// UTC appeared. It was that UTC appeared SILENTLY, so whoever read the screen
// took it for local time. Returning the zone AND the fact that it is a guess
// lets the screen show a date — always — and say which zone the date is in.
// Nothing is omitted and nothing is hidden.
//
// #89 shut the door this bad value comes through: `createAccount` is the only
// write path for the column and now refuses an unusable zone. So this is for
// the rows that predate that, and for `agencies.timezone`, which is the same
// free-text shape and was never gated at all.
import { isUsableZone } from "./timezone";

/** Where the rendered zone came from. `account` is the only one that is not a guess. */
export type ZoneSource = "account" | "agency" | "fallback";

export interface ResolvedZone {
  /** Always usable — safe to hand straight to `Intl`. */
  zone: string;
  /**
   * TRUE when this is not the account's own zone.
   *
   * Keyed on WHOSE value was used, never on "did we end up at UTC". An
   * account genuinely set to UTC is correctly configured, and labelling it a
   * guess would slander every such account on the platform.
   */
  guessed: boolean;
  /** The zone name, for printing beside a date. A word, never a colour. */
  label: string;
  source: ZoneSource;
}

/** Last resort. Reached only when the agency's own zone is broken too. */
const LAST_RESORT = "UTC";

/**
 * Resolves the zone to render in, preferring the account's own, then the
 * agency's, then UTC.
 *
 * THE AGENCY BEFORE UTC, deliberately. The agency creates every account and
 * its clients are local to it — every account on this platform today is in
 * the Rio Grande Valley — so the agency's zone is right far more often than
 * UTC, which is right essentially never for a US business. And when it is
 * wrong it is wrong by an hour, not by six. UTC's only virtue was looking
 * obviously foreign; `guessed` does that job properly, which is what makes
 * preferring the likelier guess safe.
 *
 * TOTAL BY CONSTRUCTION: no input combination throws. This runs inside a page
 * render, where a RangeError blanks a dashboard — a worse outcome than any
 * wrong date.
 */
export function resolveZone(
  accountZone: string | undefined,
  agencyZone: string | undefined,
): ResolvedZone {
  if (isUsableZone(accountZone)) {
    const zone = accountZone as string;
    return { zone, guessed: false, label: zone, source: "account" };
  }
  if (isUsableZone(agencyZone)) {
    const zone = agencyZone as string;
    return { zone, guessed: true, label: zone, source: "agency" };
  }
  return { zone: LAST_RESORT, guessed: true, label: LAST_RESORT, source: "fallback" };
}

// The press-1 screen (docs/runbooks/voice-setup.md, "The press-1 screen").
//
// WHY IT EXISTS. The other guards in front of Sofía catch a SILENT caller and
// a caller who keeps calling. Neither catches a recorded message played from a
// different number every time: it talks, so it is not silent, and it is new
// every time, so it has no history. Each one is answered, and on a client's
// line each one is billed AI minutes. A recording cannot press a key, so a
// first-time caller to a listed number is asked to press 1 before the bridge
// to Sofía is built; a caller who presses 1 is put through exactly as before.
//
// WHY IT IS OFF UNLESS LISTED. Asking a real customer to press a key is a cost
// to that customer, and hanging up on one who did not is the worst failure
// this feature can have — worse than a robocall getting through. So nothing
// changes for any number until it is listed in VOICE_SCREEN_NUMBERS, and every
// path that is unsure (an uncleared call, a history we could not read) goes
// to the bridge, never to the question.
//
// Pure: no database, no logging. The route decides, logs and builds the
// document; this file only answers "should this call be asked?".

import { e164Of } from "./phone-number";

export type ScreenConfig = {
  /** Called numbers the screen runs on. Empty = the screen is off everywhere. */
  numbers: readonly string[];
  /** Callers who are ALWAYS asked on a listed number — the owner's proof switch. */
  alwaysFrom: readonly string[];
};

/**
 * Strict E.164 first — a half-typed value is ignored, never guessed at — then
 * the SAME normalisation the route gives the carrier's To/From (`e164Of`), so
 * a correctly typed Mexican mobile (`+521…`, which `e164Of` writes as `+52…`)
 * still matches. The same rule `fallback-drill.ts` applies to its two numbers.
 */
function e164List(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    const n = /^\+[1-9][0-9]{7,14}$/.test(v) ? e164Of(v) : null;
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Unset, empty or junk is OFF: a malformed value never turns the screen on. */
export function readScreenConfig(env: NodeJS.ProcessEnv = process.env): ScreenConfig {
  return {
    numbers: e164List(env.VOICE_SCREEN_NUMBERS),
    alwaysFrom: e164List(env.VOICE_SCREEN_ALWAYS_FROM),
  };
}

export type ScreenVerdict = { screen: false } | { screen: true; why: "first-time" | "forced" };

export type ScreenInput = {
  calledE164: string;
  callerE164: string | null;
  /** Every guard read succeeded and passed (the TeXML route's `cleared`). */
  cleared: boolean;
  /**
   * No ANSWERED call from this caller on this account in the reputation
   * window. A caller with no caller ID counts as first-time: there is no
   * history to vouch for them, and a withheld number is common for exactly
   * the calls this screen exists for. The route passes `false` when the
   * history did not say — unknown means bridge.
   */
  firstTimeCaller: boolean;
  /** The model-down fallback drill is engaged on this call. */
  drill: boolean;
  /** The agency's own phones (`agencyHandsets()`). */
  handsets: readonly string[];
};

/**
 * Ask only a FIRST-TIME caller, on a LISTED number, on a CLEARED call.
 *
 * Order matters and each step errs toward the bridge:
 *   1. Not listed → never. This is the off switch.
 *   2. Not cleared → never. A call whose guard reads failed goes to Sofía,
 *      where the SIP webhook gates it for real; this screen adds nothing a
 *      failed read could vouch for.
 *   3. The drill → never. It tests the fallback, and a question in front of
 *      it would test the question instead.
 *   4. VOICE_SCREEN_ALWAYS_FROM → always, even for a returning caller or one
 *      of the agency's own phones: it is how the owner hears the screen on a
 *      real call from his own phone before any client number is listed.
 *   5. The agency's own phones → never.
 *   6. Otherwise: first-time callers only.
 */
export function decideScreen(input: ScreenInput, cfg: ScreenConfig): ScreenVerdict {
  if (!cfg.numbers.includes(input.calledE164)) return { screen: false };
  if (!input.cleared) return { screen: false };
  if (input.drill) return { screen: false };
  const caller = input.callerE164;
  if (caller && cfg.alwaysFrom.includes(caller)) return { screen: true, why: "forced" };
  if (caller && input.handsets.includes(caller)) return { screen: false };
  return input.firstTimeCaller ? { screen: true, why: "first-time" } : { screen: false };
}

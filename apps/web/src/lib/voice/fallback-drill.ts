// The model-down fallback drill (docs/runbooks/voice-setup.md, "Drilling the
// model-down fallback").
//
// WHY IT EXISTS. The fallback runs only when Sofía's SIP leg never connects,
// and the one address that leg dials (`VOICE_OPENAI_PROJECT_ID`) is shared by
// every account. Without this switch, the only way to watch the fallback ring
// a real phone is to break that address for every client at once.
//
// WHAT IT DOES. While BOTH env vars are set, a call TO the drill number FROM
// the drill caller dials an address that can never resolve instead of Sofía.
// Every other caller to that number, and every other number, is untouched.
// The handoff token, the fallback ticket and the action URL are exactly what a
// real call carries, so everything after the failed leg is the production
// path: Telnyx's DialCallStatus, the ticket check, the transfer lookup, the
// second <Dial>, and the voice.sip_webhook error stamp. What it reproduces is
// ONE way to be unreachable — a name that does not resolve. An OpenAI timeout
// or 5xx may report a different DialCallStatus, and only after a longer ring.
//
// WHY BOTH NUMBERS. Every number BIS owns is live, so the called number alone
// would cut Sofía off from that line's real callers for as long as the switch
// was on. Requiring the caller too means a drill can run on a live line
// without touching anyone else. A stranger spoofing the drill caller gets only
// the fallback, which rings the account's own transfer number.
//
// WHY `.invalid`. RFC 6761 reserves it to never resolve, so the leg fails at
// DNS — no traffic reaches OpenAI or anyone else, and no stranger can ever
// register the name.

import { e164Of } from "./phone-number";

/** Never resolves (RFC 6761 §6.4). */
export const FALLBACK_DRILL_SIP_BASE = "sip:fallback-drill@fallback-drill.invalid;transport=tls";

/**
 * Strict E.164 first — a half-typed value is off, never guessed at — then the
 * SAME normalisation the route gives the carrier's To/From (`e164Of`), or a
 * correctly typed Mexican mobile (`+521…`, which `e164Of` writes as `+52…`)
 * would silently never match.
 */
function e164(value: string | undefined): string | null {
  const v = value?.trim();
  return v && /^\+[1-9][0-9]{7,14}$/.test(v) ? e164Of(v) : null;
}

/**
 * True only when BOTH `VOICE_FALLBACK_DRILL_TO` and `VOICE_FALLBACK_DRILL_FROM`
 * are valid E.164 numbers equal to this call's called and calling numbers.
 * Anything malformed is off: a half-configured drill must never cut off Sofía.
 */
export function fallbackDrillActive(
  calledE164: string | null, callerE164: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const to = e164(env.VOICE_FALLBACK_DRILL_TO);
  const from = e164(env.VOICE_FALLBACK_DRILL_FROM);
  return to !== null && from !== null && calledE164 === to && callerE164 === from;
}

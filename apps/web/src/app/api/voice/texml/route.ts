// Telnyx hits this for every inbound call on any client number and we answer
// with TeXML that bridges the call to the platform's OpenAI SIP connector.
//
// IT IS NO LONGER "BRIDGE OR REFUSE". Since the handoff feature the bridge
// also ARMS A CONTINUATION: `<Dial action=…>` names a second URL
// (`/api/voice/texml/handoff`) that Telnyx fetches when the SIP leg ends,
// carrying a token minted here and written in two places — onto the SIP URI
// as `X-BIS-Handoff` and into that URL's query string. So this route decides
// three things, not two: whether to answer at all, what to say if not, and
// WHAT HAPPENS AFTER SOFÍA. Without the action, closing the AI socket ends
// the call and a caller who was just told "one moment, I'll connect you"
// hears the line go dead; the handoff route is what keeps them connected.
// `dialXml` below owns the token; `xmlText` (now `./xml`, shared with the
// handoff route) owns the reason both of those values are escaped on the way
// into the document.
// Telnyx TELLS US the dialed number (To param) — the SIP leg to OpenAI does
// not reliably carry it — so we smuggle it onto the SIP URI as X-BIS-Called.
// URI ?X-headers ride the INVITE and surface in the webhook's sip_headers.
// On a request Telnyx signed, a third rides with them, `X-BIS-Signature`:
// this route's signed statement of the called number, the caller and the
// handoff token, which the webhook verifies before it resolves a tenant
// (`lib/voice/sip-handoff-signature.ts`).
// A number we don't know (or one not testing/live) gets a POLITE spoken
// refusal, never a crash and never another tenant's greeting (spec §7). A
// DISABLED profile or a caller OVER THE DAILY CAP also gets a spoken refusal
// here, in the profile's configured language — today the webhook declines
// those two cases SILENTLY (dead air), because it's the enforcement layer,
// not the UX layer. This route re-checks both with the exact same
// `decideLimit` semantics purely to give the caller words instead of dead
// air; the webhook (`/api/voice/incoming`) is untouched and stays
// authoritative — a stale/racy read here can only ever cost a wasted dial
// attempt, never a bypass. A DB failure fails OPEN and dials.
// Same shape for the repeat-offender refusal (spam-screening Guard 2): a
// caller whose ENTIRE recent history on this account is silent calls is
// refused here with the shared `decideReputation` predicate, BEFORE the
// bridge is emitted — a refusal costs nothing, a bridge starts billing — and
// hears the SAME sentence as any other refusal; only the log line names the
// reason.
// The press-1 screen (`lib/voice/call-screen.ts`) sits after every refusal
// and BEFORE the per-account forward and the bridge: on a number listed in
// VOICE_SCREEN_NUMBERS, a first-time caller on a cleared call is asked to
// press 1 (`<Gather>`), and only the keypress, at `./screen`, builds the
// bridge — through this file's own `answer()` with the screen skipped, so
// there is one copy of the dial markup, not two. Unlisted, nothing changes.
import { NextResponse, after } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import { callAnswerable } from "@/lib/voice/accept-gate";
import { agencyHandsets } from "@/lib/voice/caller-reputation";
import { decideScreen, readScreenConfig } from "@/lib/voice/call-screen";
import { logFormFields, readTelnyxForm } from "./telnyx-request";
import { newHandoffToken, resolveHandoffTarget } from "@/lib/voice/handoff";
import { signFallbackTicket } from "@/lib/voice/fallback-ticket";
import { SIP_HANDOFF_HEADER, signSipHandoff, sipHandoffSecretConfigured } from "@/lib/voice/sip-handoff-signature";
import { FALLBACK_DRILL_SIP_BASE, fallbackDrillActive } from "@/lib/voice/fallback-drill";
import { configuredOrigin } from "@/lib/email/origin";
import { stampHeartbeat } from "@/lib/ops/stamp";
import { xmlText } from "./xml";
import type { ScreenedCallInput, ForwardedCallInput } from "@bis/db";

export const runtime = "nodejs";

export type Languages = "en" | "es" | "both";
/**
 * `dial` carries what the route learned on the way there:
 *   - `accountId` / `forwardCalls`: the account the called number resolved
 *     to, and whether the agency has sent its calls straight to a person.
 *     Absent when the number could not be looked up (failing open).
 *   - `cleared`: EVERY guard read succeeded and passed. Only a cleared call
 *     may carry the model-down fallback ticket, so a caller the guards could
 *     not vouch for (a count read failed) is never forwarded to a person by
 *     the fallback; it gets today's hang-up.
 *   - `lookupFailed`: the number lookup itself threw — the one failure that
 *     is this route's own outage, stamped as such.
 *   - `phoneNumberId`: the called line's row, on a cleared call only — what
 *     a forwarded call's record (0059) points at.
 *   - `languages` / `firstTimeCaller`: on a cleared call only, for the
 *     press-1 screen — the profile's languages for its question, and whether
 *     this caller has NO answered call in the reputation window. Read from
 *     the same history batch as Guard 2, so the screen adds no DB read.
 */
type Routability =
  | {
    kind: "dial"; accountId?: string; phoneNumberId?: string; forwardCalls?: boolean;
    cleared?: boolean; lookupFailed?: boolean;
    languages?: Languages; firstTimeCaller?: boolean;
  }
  | { kind: "refuse"; languages: Languages; screened: ScreenedCallInput }
  | { kind: "cap"; languages: Languages; screened: ScreenedCallInput }
  // A caller whose whole recent history on this account is silent calls.
  // Speaks the SAME sentence as `refuse` on purpose — a robot learns nothing
  // from a distinct message, and a human who has somehow been caught by this
  // is told to try again later, which the rolling window makes true. Only the
  // log line distinguishes the reason.
  | { kind: "blocked"; languages: Languages; screened: ScreenedCallInput };

// COPY.refuse.en is byte-identical to the old REFUSAL constant's sentence —
// an existing test pins it, and a caller who's heard it before should hear
// exactly the same thing.
const COPY = {
  refuse: {
    en: "Sorry, this number can't take your call right now. Please try again later.",
    es: "Lo sentimos, este número no puede atender su llamada en este momento. Por favor intente más tarde.",
  },
  cap: {
    en: "We're sorry — we can't take more calls today. Please call back tomorrow.",
    es: "Lo sentimos — hoy ya no podemos atender más llamadas. Por favor llame mañana.",
  },
} as const;

/** The `<Say>` elements for one sentence in the profile's languages — English
 *  first when both, because order matters to a caller hearing it live. */
function says(languages: Languages, copy: { en: string; es: string }): string {
  const en = `<Say>${copy.en}</Say>`;
  const es = `<Say language="es-MX">${copy.es}</Say>`;
  return languages === "es" ? es : languages === "both" ? en + es : en;
}

function sayXml(languages: Languages, copy: { en: string; es: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${says(languages, copy)}<Hangup/></Response>`;
}

// The press-1 screen's words. A caller who hears these has done nothing
// wrong, so they say what to do and nothing about why.
const SCREEN_COPY = {
  prompt: {
    en: "Thanks for calling. To be connected, please press 1.",
    es: "Gracias por llamar. Para comunicarse, oprima 1.",
  },
  goodbye: {
    en: "Sorry, we didn't get that. Please call again anytime. Goodbye.",
    es: "Lo sentimos, no recibimos su respuesta. Puede llamar de nuevo cuando guste. Adiós.",
  },
} as const;

/**
 * Seconds Telnyx waits for the key after the question finishes. Telnyx's
 * `<Gather>` `timeout`: "Time in seconds between digits before the digits
 * are sent to your action URL. Telnyx will wait until all nested verbs have
 * been executed before beginning the timeout period." Range 1–120, default 5.
 */
export const SCREEN_TIMEOUT_SECONDS = 6;

/**
 * Where the keypress goes, WITHOUT the ask marker (`screenAsk` appends it).
 * `l` carries the profile's languages so the action route can speak without a
 * database read; `a` carries the account id for its log lines only. Neither
 * is trusted for anything else: the keypress re-runs this file's whole
 * routing, guards included.
 */
export function screenActionUrl(origin: string, languages: Languages, accountId: string): string {
  return `${origin}/api/voice/texml/screen?l=${languages}&a=${encodeURIComponent(accountId)}`;
}

/**
 * One ask. Every attribute is one Telnyx documents for `<Gather>`
 * (https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather):
 * `action`, `numDigits`, `timeout` — and NO `method`: Telnyx documents none
 * for `<Gather>`, and sends the action with the TeXML application's own method
 * (POST once TELNYX_PUBLIC_KEY is set; `./screen` answers both). An attribute
 * Telnyx rejects would mean no call at all, so nothing undocumented goes in.
 * `<Say>` is a documented child of `<Gather>`; both languages sit inside ONE
 * Gather so a key pressed during either sentence counts.
 *
 * `n` on the action URL says which ask this was, and that is ALL it decides:
 * which words `./screen` plays next. It is not covered by the carrier's
 * signature and is trusted for nothing else.
 */
function screenAsk(languages: Languages, action: string, n: 1 | 2): string {
  return `<Gather action="${xmlText(`${action}&n=${n}`)}" numDigits="1" timeout="${SCREEN_TIMEOUT_SECONDS}">${says(languages, SCREEN_COPY.prompt)}</Gather>`;
}

/**
 * The question: ASKED TWICE, then the goodbye — under either thing the
 * carrier might do when an ask times out with no key, because Telnyx's docs
 * do not say which it does:
 *   A. It falls through to the next verb: this document's second ask (n=2),
 *      then its goodbye and hang-up. Nothing reaches `./screen`, so nothing
 *      is logged after the "asking" line — the logs cannot see this decline.
 *   B. It fetches the action with no `Digits`: `./screen` answers the first
 *      ask (n=1) with `screenSecondAskXml` — the second ask — and only the
 *      second (n=2) with the goodbye, logged `declined (no-keypress)`.
 * Either way the caller hears the question twice and then the goodbye; never
 * once, never three times, never dead air. A person still lifting the phone
 * from their ear gets a second chance, and a recording loses only a few
 * seconds of carrier time (no AI minutes — nothing reaches Sofía until 1).
 */
export function screenXml(languages: Languages, action: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${screenAsk(languages, action, 1)}${screenAsk(languages, action, 2)}${says(languages, SCREEN_COPY.goodbye)}<Hangup/></Response>`;
}

/** `./screen`'s answer to a first ask with no key or a wrong one: the second
 *  ask, falling through to the goodbye if the carrier does. */
export function screenSecondAskXml(languages: Languages, action: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${screenAsk(languages, action, 2)}${says(languages, SCREEN_COPY.goodbye)}<Hangup/></Response>`;
}

/** What `./screen` answers a caller who pressed nothing, or another key. */
export function screenGoodbyeXml(languages: Languages): string {
  return sayXml(languages, SCREEN_COPY.goodbye);
}

async function classify(calledE164: string, callerE164: string | null): Promise<Routability> {
  // Lazy import: a module-scope DB import here breaks `next build` during
  // page-data collection (the demo's documented trap). Any failure anywhere
  // in this try (lookup, profile read) falls to the outer catch and fails
  // open to dial — the webhook resolver still gates authoritatively.
  try {
    const {
      serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince,
      countCallsByCallerSince, countCallerHistorySince, countForwardedCallsSince,
    } = await import("@bis/db");
    const { readLimitConfig, decideLimit, utcDayStart } = await import("@/lib/voice/call-limits");
    const {
      readReputationConfig, decideReputation, windowStart,
    } = await import("@/lib/voice/caller-reputation");
    const db = serviceDb();
    const row = await getPhoneNumberByE164(db, calledE164);
    if (!row || (row.status !== "testing" && row.status !== "live")) {
      // This decision is now spoken here (TeXML hangs up before dialing), so
      // the webhook's own "declined: unknown-number" log line never fires
      // for these calls — this is the only telemetry the cap/refusal path
      // gets. Caller E164 in logs is a ratified decision (the webhook's
      // "incoming call" log already logs callerNumber) — parity, not a new
      // exposure.
      console.log(`texml declined refuse-unknown for ${calledE164}, caller ${callerE164 ?? "unknown"}`);
      // ONE log line, TWO different facts — which is exactly the collapse
      // the `screened_calls` record un-does. No row at all is a wrong number
      // and nobody's outage; a number we own that is not live is turning
      // away every caller a paying client has.
      return {
        kind: "refuse", languages: "en",
        screened: {
          accountId: row?.account_id ?? null,
          phoneNumberId: row?.id ?? null,
          calledE164, callerE164,
          reason: row ? "not-live" : "unknown-number",
        },
      };
    }
    const profile = await getVoiceProfile(db, row.account_id);
    const gate = callAnswerable({ status: row.status, profile });
    if (!gate.answerable) {
      console.log(`texml declined refuse-disabled for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
      // `gate.reason` has always distinguished these two and nothing has ever
      // read it until now: "never set up" and "deliberately turned off" need
      // different answers from an operator.
      return {
        kind: "refuse", languages: profile?.languages ?? "en",
        screened: {
          accountId: row.account_id, phoneNumberId: row.id,
          calledE164, callerE164,
          reason: gate.reason === "no-profile" ? "no-profile" : "profile-disabled",
        },
      };
    }
    // Unreachable — callAnswerable's "no-profile" reason above already
    // returned for a null profile — but TypeScript can't see across that
    // predicate call, so this narrows `profile` for everything below.
    if (!profile) {
      return {
        kind: "refuse", languages: "en",
        screened: {
          accountId: row.account_id, phoneNumberId: row.id,
          calledE164, callerE164, reason: "no-profile",
        },
      };
    }
    // Cap and reputation UX only — the caller deserves words, not dead air.
    // The incoming webhook re-checks BOTH with the same shared predicates and
    // stays authoritative, so a stale count here (or the reads racing an
    // in-flight call) can only ever waste a dial attempt, never let a caller
    // through who should have been refused.
    //
    // KNOWN AND ACCEPTED, so the next reader does not rediscover it as a bug:
    // because the three reads share one `Promise.all` below, ANY of them
    // rejecting fails the whole batch and this block falls through to `dial`.
    // So a caller who is genuinely over the per-number cap, on a call where
    // only the history read failed, hears ringing and then dead air instead of
    // the cap sentence — the webhook still declines before `acceptCall`, so
    // the exposure is a worse ten seconds for one caller and zero billing.
    // That is exactly the "can only ever waste a dial attempt" envelope above,
    // and splitting the batch per-read would trade it for wall-clock on
    // Telnyx's answer deadline, which is the thing this route cannot spend.
    // The incoming webhook makes the opposite trade for the opposite reason:
    // it binds, it is not on the carrier's clock, and its two reads each carry
    // their own try/catch so neither can take the other down.
    let firstTimeCaller = false;
    try {
      const now = new Date();
      const dayStart = utcDayStart(now);
      const repCfg = readReputationConfig();
      // Independent reads — run them together, this route sits on Telnyx's
      // carrier answer-deadline. The third read joins the existing pair
      // rather than following them, so Guard 2 costs no wall-clock at all;
      // the fourth (forwarded calls, 0059) the same way.
      const [callsForAccount, callsForNumber, history, forwarded] = await Promise.all([
        countCallsSince(db, row.account_id, dayStart),
        callerE164 ? countCallsByCallerSince(db, row.account_id, callerE164, dayStart) : Promise.resolve(0),
        // A withheld caller has no history: zero of everything, which the
        // press-1 screen reads as first-time. Deliberate — there is nothing
        // to vouch for them, and a withheld number is common on exactly the
        // calls that screen exists for.
        callerE164
          ? countCallerHistorySince(db, row.account_id, callerE164, windowStart(now, repCfg.windowDays))
          : Promise.resolve({ spamCalls: 0, otherCalls: 0, answeredCalls: 0 }),
        countForwardedCallsSince(db, row.account_id, callerE164, dayStart),
      ]);
      // A call put through to a person writes no `calls` row (Sofía's webhook
      // never sees it), so the caps add the forwarded ones — or a robot
      // ringing while the forward is on, or while Sofía is down, would never
      // reach a cap. Reputation does NOT read them: a forwarded call has no
      // outcome to judge (0059's header).
      const forAccount = callsForAccount + forwarded.forAccount;
      const forNumber = callsForNumber + forwarded.forCaller;
      // Reputation first: a caller we already know to be a robot should not
      // be described by the day's volume. It is also the more actionable log
      // line of the two. Note the two verdicts read OPPOSITE senses —
      // `decideReputation` reports `blocked`, `decideLimit` reports
      // `allowed` — so each is read on its own field, never combined.
      //
      // That order is binding, not stylistic, and is pinned by the case
      // arranging a caller who is over the cap AND a repeat offender:
      // reversed, a known robot hears the cap's "call back tomorrow", which
      // invites it back, and the `blocked (repeat-spam)` line — the only
      // telemetry Guard 2 produces — is never written.
      const reputation = decideReputation(history, repCfg, callerE164);
      if (reputation.blocked) {
        console.log(`texml declined blocked (${reputation.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return {
          kind: "blocked", languages: profile.languages,
          screened: {
            accountId: row.account_id, phoneNumberId: row.id,
            calledE164, callerE164, reason: "repeat-spam",
          },
        };
      }
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return {
          kind: "cap", languages: profile.languages,
          screened: {
            accountId: row.account_id, phoneNumberId: row.id,
            calledE164, callerE164, reason: "over-cap",
          },
        };
      }
      // Strictly `=== 0`: a history that did not say (undefined) is NOT a
      // first-time caller. Unknown means bridge, never the question.
      firstTimeCaller = history.answeredCalls === 0;
    } catch (e) {
      console.error(`texml cap/reputation count failed for ${calledE164}: ${String(e)}`); // fail open
      return { kind: "dial", accountId: row.account_id, forwardCalls: profile.forward_calls === true, cleared: false };
    }
    return {
      kind: "dial", accountId: row.account_id, phoneNumberId: row.id,
      forwardCalls: profile.forward_calls === true, cleared: true,
      languages: profile.languages, firstTimeCaller,
    };
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return { kind: "dial", lookupFailed: true }; // fail open — the webhook still gates
  }
}

/**
 * Operator override: send every call on this number to a human instead of to
 * Sofía, for as long as the env var is set.
 *
 * Exists because Telnyx REFUSES its own per-number call forwarding on a
 * TeXML-utilizing number — "You cannot use automatic call forwarding with a
 * Call Control or TeXML-utilizing number. Please use the Call Control and/or
 * TeXML functionality to control your call behavior." This is that
 * functionality. The immediate need was a WhatsApp Business verification
 * code, which arrives by voice on a line an AI answers, but the general case
 * is worth having: any time a human must take this number back for a few
 * minutes, this is the lever.
 *
 * Deliberately placed AHEAD of the routability and cap checks in `respond`.
 * An override is an override: if an operator has taken the line back, a
 * disabled profile or a daily cap must not silently swallow the call they are
 * standing by for.
 *
 * `callerId` is OUR number, not the original caller's. Telnyx requires an
 * owned number on the outbound leg, and the caller's own number is not one.
 */
export function forwardTarget(env: NodeJS.ProcessEnv = process.env): string | null {
  return e164Of(env.VOICE_FORWARD_TO);
}

/**
 * One hour, the same billing ceiling the handoff dial carries and for the
 * same reason (`handoff/route.ts`, MAX_TRANSFER_SECONDS): once the person
 * answers, a forward is an ordinary per-minute leg on our trunk, and without
 * `timeLimit` nothing anywhere bounds it — a voicemail or IVR that answers
 * and never hangs up bills until the carrier gives up.
 */
export const FORWARD_TIME_LIMIT_SECONDS = 3600;

export function forwardXml(to: string, callerId: string | null): string {
  // `xmlText` on both, per `./xml`'s rule that everything interpolated goes
  // through it: both are E.164 today, which bounds the column, not this
  // function.
  const cid = callerId ? ` callerId="${xmlText(callerId)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial${cid} timeout="30" timeLimit="${FORWARD_TIME_LIMIT_SECONDS}">${xmlText(to)}</Dial></Response>`;
}

/**
 * The bridge to Sofía — and, since the handoff feature, the thing that lets
 * the call OUTLIVE her.
 *
 * `action` is the whole mechanism: when the SIP leg ends, Telnyx fetches that
 * URL and does whatever TeXML comes back, instead of hanging up on the
 * caller. Without it, closing the AI socket ends the call, and a caller who
 * has just been told "one moment, I'll connect you" hears the line go dead.
 *
 * ONE token is minted per response and written in BOTH places — onto the SIP
 * URI as `X-BIS-Handoff` (the webhook stores it on the call row) and into the
 * action URL's query string (the handoff route authenticates with it). Two
 * separately-minted tokens would type-check, emit valid TeXML, and mean the
 * action route can never find the call: a silent, unloggable dead end. That
 * equality is pinned by a test, not left to reading.
 *
 * It rides the dial with no `To` as well. ONLY WHILE VOICE_HANDOFF_ENFORCE IS
 * OFF can the webhook still resolve a tenant from its To/Diversion fallbacks
 * on such a call, and so answer it (and let its caller ask for a person).
 * With enforcement on, a call with no `To` carries no signature (there is no
 * called number to sign) and the webhook declines it.
 *
 * `unsignedBridge` is true when the secret is set but this request was not
 * Telnyx-signed, so the bridge goes out with no signature: the gap that
 * silently turns enforcement into "decline every call" (see below).
 */
function dialXml(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  cleared?: { accountId: string; callerE164: string | null }, drill = false,
): { body: string; unsignedBridge: boolean } {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return {
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Configuration error: the project identifier is not set.</Say><Hangup/></Response>`,
      unsignedBridge: false,
    };
  }
  // The secret is set, but this request was not Telnyx-signed (that only
  // happens with TELNYX_PUBLIC_KEY unset), so nothing below may sign it. With
  // VOICE_HANDOFF_ENFORCE on, the webhook declines every such call as
  // `absent` — and that reason is a stranger's, so the webhook raises no
  // alert. This line, and the voice.texml error stamp `answer` makes from
  // the flag, are where that outage becomes visible.
  const unsignedBridge = !authenticated && sipHandoffSecretConfigured();
  if (unsignedBridge) {
    console.error("texml: VOICE_HANDOFF_SECRET is set but this request was not Telnyx-signed (TELNYX_PUBLIC_KEY is unset) — this call carries no X-BIS-Signature, so VOICE_HANDOFF_ENFORCE would decline it at the SIP webhook");
  }
  const token = newHandoffToken();
  // The drill swaps ONLY the address: token, ticket and action URL below are
  // what a real call carries, so the drill tests the real path
  // (lib/voice/fallback-drill.ts).
  const base = drill ? FALLBACK_DRILL_SIP_BASE : `sip:${projectId}@sip.api.openai.com;transport=tls`;
  // The signature the SIP webhook checks before it resolves a tenant
  // (lib/voice/sip-handoff-signature.ts): this route's statement that the
  // call came through here, for this called number and this caller. ONLY on
  // a request Telnyx signed — an unauthenticated request can name any
  // To/From, and signing its answer would vouch for numbers nobody verified.
  // Every dial gets it, cleared or not: the webhook is where an uncleared
  // call is gated, and refusing to sign would turn this route's fail-open
  // read into a refusal there. Null with no secret (the rollout's first
  // step); the webhook only refuses an unsigned call once enforcement is on.
  const signature = authenticated && calledE164
    ? signSipHandoff(token, calledE164, callerE164, Date.now())
    : null;
  const params = [
    ...(calledE164 ? [`X-BIS-Called=${encodeURIComponent(calledE164)}`] : []),
    `X-BIS-Handoff=${encodeURIComponent(token)}`,
    ...(signature ? [`${SIP_HANDOFF_HEADER}=${encodeURIComponent(signature)}`] : []),
  ];
  const uri = `${base}?${params.join("&")}`;
  // The model-down fallback's ticket rides the same URL, and only for a call
  // every guard cleared (see `Routability`): if this SIP leg never connects,
  // the handoff route has no `calls` row to find the account by, and this is
  // the one signed statement of which account and number the call was for.
  const ticket = cleared && calledE164
    ? signFallbackTicket(token, cleared.accountId, calledE164, Date.now(), process.env, cleared.callerE164)
    : null;
  const action = `${origin}/api/voice/texml/handoff?t=${encodeURIComponent(token)}`
    + (ticket ? `&f=${encodeURIComponent(ticket)}` : "");
  // xmlText on BOTH: the URI's `&` separators are the live bug, and the
  // action URL is one appended query parameter away from the same one.
  return {
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial answerOnBridge="true" action="${xmlText(action)}" method="POST"><Sip>${xmlText(uri)}</Sip></Dial></Response>`,
    unsignedBridge,
  };
}

export function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/**
 * The per-account forward (operational-floor spec §3): the agency's "Send
 * calls straight to a person" switch, `voice_profiles.forward_calls`, sends a
 * call that would have gone to Sofía to the account's own transfer number.
 *
 * It REPLACES THE BRIDGE AND NOTHING ELSE. Every guard in front of Sofía —
 * an unknown or not-live number, a disabled profile, a repeat-spam caller,
 * the daily cap — still answers first, so a robot the guards would refuse is
 * never forwarded to somebody's personal phone.
 *
 * The target goes through the handoff feature's own `resolveHandoffTarget`,
 * own-number guard included: a transfer number that is one of this account's
 * own lines would ring straight back into this route, which would forward it
 * again, forever, on the tenant's trunk. Any failure here — a read that
 * throws, no transfer number, the loop guard — falls back to Sofía, which is
 * where the call was going anyway; never to dead air.
 */
async function accountForwardTarget(accountId: string): Promise<string | null> {
  try {
    const { serviceDb, getTransferPhone, listPhoneNumbersForAccount, getPhoneNumberByE164 } = await import("@bis/db");
    const db = serviceDb();
    const [transferPhone, owned] = await Promise.all([
      getTransferPhone(db, accountId),
      listPhoneNumbersForAccount(db, accountId),
    ]);
    const target = resolveHandoffTarget(
      transferPhone,
      owned.filter((n) => n.status === "testing" || n.status === "live").map((n) => n.e164),
    );
    if (!target.available) {
      console.log(`texml forward is on but unusable (${target.reason}) — Sofía answers, accountId ${accountId}`);
      return null;
    }
    // ANY number this platform owns, not only this account's: two accounts
    // forwarding to each other's lines would ping-pong a call between this
    // route's two forwards, and a forwarded call writes no row that a cap
    // could count. A number we own is never a person's phone.
    if (await getPhoneNumberByE164(db, target.to)) {
      console.log(`texml forward is on but its transfer number is a BIS line — Sofía answers, accountId ${accountId}`);
      return null;
    }
    return target.to;
  } catch (e) {
    console.error(`texml forward lookup failed — Sofía answers, accountId ${accountId}: ${String(e)}`);
    return null;
  }
}

/**
 * The forwarded call's record (0059), which the caps above count. In
 * `after()` and best-effort, exactly like the screened-call write in
 * `route()`, for the same two reasons: this route cannot spend Telnyx's
 * answer deadline, and a failed write must never cost the caller the forward.
 * A missed row under-counts one call; it never refuses one.
 */
function recordForwardedCallLater(input: ForwardedCallInput): void {
  try {
    after(async () => {
      try {
        const { serviceDb, recordForwardedCall } = await import("@bis/db");
        await recordForwardedCall(serviceDb(), input);
      } catch (e) {
        console.error(`texml: forwarded-call write failed (${input.kind}) for ${input.calledE164}: ${String(e)}`);
      }
    });
  } catch (e) {
    console.error(`texml: could not schedule the forwarded-call write (${input.kind}) for ${input.calledE164}: ${String(e)}`);
  }
}

/**
 * `authenticated` is true only for a POST whose Telnyx signature this route
 * verified (TELNYX_PUBLIC_KEY set). It decides one thing: whether the bridge
 * carries the signature the SIP webhook checks (`dialXml`).
 *
 * Exported for ONE other caller, the press-1 action (`./screen/route.ts`),
 * which calls it with `skipScreen` once the caller has pressed 1: every guard
 * re-runs, the forward is honoured, and the bridge is minted here with its own
 * token, signature and ticket — the same document this route would have sent
 * had the screen not been asked.
 */
export async function answer(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  opts: { skipScreen?: boolean } = {},
): Promise<NextResponse> {
  const result = await route(calledE164, callerE164, origin, authenticated, opts.skipScreen === true);
  // One stamp per answered request (lib/ops/stamp.ts). The route is down for
  // everyone only when it cannot look a number up; a refusal, a forward and a
  // bridge are all the route working. The second error is a bridge sent
  // unsigned while the secret is set (`dialXml`): this route's own
  // configuration failing every call it bridges once enforcement is on.
  stampHeartbeat("voice.texml", result.lookupFailed
    ? { ok: false, error: "the called number could not be looked up" }
    : result.unsignedBridge
      ? { ok: false, error: "VOICE_HANDOFF_SECRET is set but TeXML requests are not Telnyx-signed, so calls carry no signature" }
      : { ok: true });
  return result.response;
}

/**
 * The last resort of the press-1 action (`./screen/route.ts`) when something
 * in it throws: the plain bridge, uncleared — no ticket, no forward, no drill
 * — exactly the document this route sends when its own reads fail. The SIP
 * webhook still gates the call. Same `dialXml`, so still one copy of the
 * markup.
 */
export function bridgeAfterFailure(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
): NextResponse {
  return xmlResponse(dialXml(calledE164, callerE164, origin, authenticated).body);
}

async function route(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  skipScreen = false,
): Promise<{ response: NextResponse; lookupFailed: boolean; unsignedBridge: boolean }> {
  const done = (response: NextResponse, lookupFailed = false, unsignedBridge = false) =>
    ({ response, lookupFailed, unsignedBridge });
  const forward = forwardTarget();
  if (forward) {
    // Logged on EVERY forwarded call, not once at boot. This mode bypasses
    // Sofía entirely, and the failure it invites is leaving it on: a line
    // that quietly rings a personal mobile for a week is worse than one that
    // is briefly unavailable.
    console.log(`texml FORWARDING to ${forward} — Sofía is bypassed while VOICE_FORWARD_TO is set`);
    return done(xmlResponse(forwardXml(forward, calledE164)));
  }
  if (calledE164) {
    const result = await classify(calledE164, callerE164);
    if (result.kind !== "dial") {
      // ONE write site for all six refusals, not one per branch — six call
      // sites would be six chances for the next reason to forget one.
      //
      // `after()` because this route sits on Telnyx's carrier answer
      // deadline and its own comments say wall-clock is the one thing it
      // cannot spend. Same pattern, same reason, as incoming/route.ts's own
      // `after(() => runCallLifecycle(...))`.
      //
      // BEST-EFFORT, and that is a contract: a failed write OR A FAILED
      // SCHEDULE logs and changes nothing about the refusal, the spoken
      // copy, or the hang-up. The console.log lines in classify() are
      // untouched and remain the evidence if this write is itself broken.
      const screened = result.screened;
      try {
        // `after()` itself has synchronous throw paths distinct from the
        // callback rejecting (no work store; `errorWaitUntilNotAvailable`).
        // Neither is caught by the try/catch INSIDE the callback below, so
        // scheduling gets its own — otherwise the throw escapes `answer()`
        // (there is no enclosing catch in GET/POST) and Telnyx gets a 500
        // instead of the refusal document: dead air instead of the sentence
        // this whole branch exists to speak.
        after(async () => {
          try {
            // Lazy import: a module-scope DB import here breaks `next build`
            // during page-data collection — same reason as `classify()`'s own
            // lazy `@bis/db` import above.
            const { serviceDb, recordScreenedCall } = await import("@bis/db");
            await recordScreenedCall(serviceDb(), screened);
          } catch (e) {
            console.error(`texml: screened-call write failed (${screened.reason}) for ${screened.calledE164}: ${String(e)}`);
          }
        });
      } catch (e) {
        console.error(`texml: could not schedule the screened-call write (${screened.reason}) for ${screened.calledE164}: ${String(e)}`);
      }
    }
    if (result.kind === "refuse") return done(xmlResponse(sayXml(result.languages, COPY.refuse)));
    // Deliberately the same sentence as `refuse`, and deliberately ABOVE the
    // bridge: a refusal costs nothing, a bridge starts billing.
    if (result.kind === "blocked") return done(xmlResponse(sayXml(result.languages, COPY.refuse)));
    if (result.kind === "cap") return done(xmlResponse(sayXml(result.languages, COPY.cap)));
    // kind === "dial". The press-1 screen comes FIRST, ahead of the
    // per-account forward: a recording the screen exists to stop must not be
    // rung through to somebody's personal phone either. Only on a cleared
    // call (`decideScreen` owns that check, forced callers included), and
    // never on the keypress's own re-run.
    if (!skipScreen && result.accountId) {
      const accountId = result.accountId;
      const languages = result.languages ?? "en";
      let verdict: ReturnType<typeof decideScreen> = { screen: false };
      try {
        verdict = decideScreen({
          calledE164, callerE164, cleared: result.cleared === true,
          firstTimeCaller: result.firstTimeCaller === true,
          drill: fallbackDrillActive(calledE164, callerE164),
          handsets: agencyHandsets(),
        }, readScreenConfig());
      } catch (e) {
        // Pure code today; the catch is the contract that an env or parse
        // failure on the screen path can only ever mean "bridge".
        console.error(`texml screen check failed — bridging, accountId ${accountId}: ${String(e)}`);
      }
      if (verdict.screen) {
        // FORCED is logged on every call it engages, for the drill's reason:
        // the failure it invites is leaving it on.
        console.log(verdict.why === "forced"
          ? `texml screen FORCED on ${calledE164} from ${callerE164} — VOICE_SCREEN_ALWAYS_FROM is set, accountId ${accountId}`
          : `texml screen asking ${calledE164}, caller ${callerE164 ?? "unknown"} to press 1 (first-time), accountId ${accountId}`);
        return done(xmlResponse(screenXml(languages, screenActionUrl(origin, languages, accountId))));
      }
    }
    // The per-account forward, if the agency turned it on,
    // takes the place of the bridge; otherwise the same dial path as
    // calledE164 === null, carrying the fallback ticket when cleared.
    // Only a CLEARED call: a forwarded call never reaches Sofía's webhook, so
    // the webhook's re-check — what makes this route's fail-open safe — is
    // not there behind it. A call whose guard reads failed goes to Sofía,
    // where the webhook gates it for real, never to a person's phone.
    if (result.cleared && result.accountId && result.forwardCalls) {
      const to = await accountForwardTarget(result.accountId);
      if (to) {
        // Logged on every call for the reason the deployment-wide override
        // above logs: the failure this invites is leaving it on.
        console.log(`texml FORWARDING account ${result.accountId} to its transfer number — Sofía is bypassed while forward_calls is on`);
        recordForwardedCallLater({
          accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
          calledE164, callerE164, kind: "account-forward",
        });
        return done(xmlResponse(forwardXml(to, calledE164)));
      }
    }
    const cleared = result.cleared && result.accountId ? { accountId: result.accountId, callerE164 } : undefined;
    // The fallback drill engages only on a CLEARED call: that is the only call
    // the fallback serves, so on any other the drill would prove nothing and
    // just drop the caller. Logged every time, for the forward's reason: the
    // failure this invites is leaving it on.
    let drill = false;
    if (fallbackDrillActive(calledE164, callerE164)) {
      drill = cleared !== undefined;
      console.log(drill
        ? `texml FALLBACK DRILL on ${calledE164} from ${callerE164} — Sofía is deliberately unreachable on this call while VOICE_FALLBACK_DRILL_TO/FROM are set`
        : `texml fallback drill NOT engaged on ${calledE164} — the call was not cleared, so Sofía answers`);
    }
    const dial = dialXml(calledE164, callerE164, origin, authenticated, cleared, drill);
    return done(xmlResponse(dial.body), result.lookupFailed === true, dial.unsignedBridge);
  }
  const dial = dialXml(calledE164, callerE164, origin, authenticated);
  return done(xmlResponse(dial.body), false, dial.unsignedBridge);
}

/**
 * Where the `<Dial action=…>` URL must point. Telnyx is a server-to-server
 * caller, so `req.url`'s origin is the deployment's own vercel.app URL, not
 * the custom domain — APP_ORIGIN wins here for the same reason it wins in
 * `email/origin.ts` and in the incoming webhook (`incoming/route.ts:891`).
 * The fallback is still correct, just uglier in a log line.
 */
export function actionOrigin(req: Request): string {
  return configuredOrigin() ?? new URL(req.url).origin;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (process.env.TELNYX_PUBLIC_KEY?.trim()) {
    // Hardened mode: signature enforcement requires the TeXML app's Voice
    // Method flipped to POST first (see voice-setup runbook) — with the key
    // set, GET is closed entirely (405) because a GET has no signed body;
    // setting the key while the app still uses GET would 405 every live
    // call.
    return new NextResponse(null, { status: 405 });
  }
  const params = new URL(req.url).searchParams;
  // Never authenticated: GET only answers while TELNYX_PUBLIC_KEY is unset.
  return answer(e164Of(params.get("To")), e164Of(params.get("From")), actionOrigin(req), false);
}

export async function POST(req: Request): Promise<NextResponse> {
  // The body read and the signature gate live in `./telnyx-request`, shared
  // with the press-1 action so the two cannot drift. A body-read failure is
  // an empty body: with the key set that is a 403 (closed, correct for the
  // auth path); with it unset it parses to no To/From → dial (fail open).
  const read = await readTelnyxForm(req, "texml");
  if (!read.ok) return read.response;
  // Observation only, and only past the signature check: which fields does
  // Telnyx send, and is a caller-ID attestation among them? Unproven until a
  // real call's log says so — nothing may be built on it yet.
  logFormFields("texml", read.form);
  return answer(
    e164Of(read.form.get("To") || null), e164Of(read.form.get("From") || null),
    actionOrigin(req), read.authenticated,
  );
}

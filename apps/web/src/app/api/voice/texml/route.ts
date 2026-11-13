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
// The owner line (F-032 §4.1) sits AHEAD of the screen: on a Telnyx-signed
// request with a usable VOICE_HANDOFF_SECRET, one more read (beside the count
// batch, never inside it) asks whether the caller is a registered, verified
// team member of the dialed business. A hit hears ONE `<Gather>` for their
// PIN (or their call-in code) whose fallthrough is today's path for them: the
// bridge when every guard cleared, the refusal when one did not; a miss, a
// failed or late read, or any other caller gets exactly today's document.
import { NextResponse, after } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import { loggablePhone } from "@/lib/loggable-error";
import { callAnswerable } from "@/lib/voice/accept-gate";
import { agencyHandsets } from "@/lib/voice/caller-reputation";
import { decideScreen, readScreenConfig } from "@/lib/voice/call-screen";
import { logFormFields, readTelnyxForm } from "./telnyx-request";
import { newHandoffToken, resolveHandoffTarget } from "@/lib/voice/handoff";
import { signFallbackTicket } from "@/lib/voice/fallback-ticket";
import {
  OWNER_PASS_HEADER, SIP_HANDOFF_HEADER, signOwnerPass, signSipHandoff, sipHandoffSecretConfigured,
  type OwnerPassRole,
} from "@/lib/voice/sip-handoff-signature";
import { FALLBACK_DRILL_SIP_BASE, fallbackDrillActive } from "@/lib/voice/fallback-drill";
import { configuredOrigin } from "@/lib/email/origin";
import { stampHeartbeat } from "@/lib/ops/stamp";
import { sayLine, xmlText } from "./xml";
import { ownerLimitXml, ownerPinAskXml, ownerPinUrl, ownerVerifyAskXml } from "./owner-line-xml";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { pinPepperConfigured } from "@/lib/owner-line/secrets";
import { billingEnforced } from "@/lib/billing/enforce";
import type { Locale } from "@/lib/i18n/locale";
// Types only: erased at build time, so no module-scope @bis/db import (plan SC-18).
import type { ScreenedCallInput, ForwardedCallInput, OwnerLineLookup } from "@bis/db";

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
 *   - `phoneNumberId`: the called line's row, whenever the profile was read —
 *     what a forwarded or screened call's record (0059, 0039) points at.
 *   - `languages` / `firstTimeCaller`: the profile's languages (for the
 *     press-1 screen's question and the unavailable sentence), and whether
 *     this caller has NO answered call in the reputation window (cleared
 *     calls only). Read from the same history batch as Guard 2, so the screen
 *     adds no DB read. `languages` and `phoneNumberId` also ride an UNCLEARED
 *     call (a count read failed), for the unavailable sentence and its record.
 *   - `noVoice` (M7a PR-4, plan G9): set only when BILLING_ENFORCE is on and
 *     the account's verdict has no Sofía (paused, or a plan without the
 *     receptionist), with whether the call may still ring the business.
 *     Absent when the billing read failed (fail open: today's path).
 *   - `ownerLine` (F-032 §4.1): the caller is a registered, verified team
 *     member in a role the data path offers, and the step may be OFFERED on
 *     this call. Only ever on a cleared call, and never when the agency's
 *     forward is on, billing has no voice, or the fallback drill is engaged
 *     (SC-17: there the Gather's fallthrough would not be today's path).
 *     `personaName` is the profile's, for the ask's words.
 *   - `ownerSkipped` (Task 7 review C-1): the customer refusal an offered PIN
 *     or code ask skipped (owner ruling Q-C), and therefore the verbs that
 *     follow that ask. The call is still `cleared` for the ask itself, but the
 *     fallthrough is THIS refusal, never a ticketed bridge: the fallback
 *     ticket means every guard cleared, and one did not.
 */
type NoVoice = { reason: "billing-paused" | "plan-no-voice"; forward: boolean };
type OfferedOwnerLine = Extract<OwnerLineLookup, { status: "verify" | "pin" | "over_limit" }>;
type SkippedRefusal = { kind: "blocked" | "cap"; languages: Languages };
type Routability =
  | {
    kind: "dial"; accountId?: string; phoneNumberId?: string; forwardCalls?: boolean;
    cleared?: boolean; lookupFailed?: boolean;
    languages?: Languages; firstTimeCaller?: boolean;
    noVoice?: NoVoice;
    ownerLine?: OfferedOwnerLine; personaName?: string; ownerSkipped?: SkippedRefusal;
  }
  | { kind: "refuse"; languages: Languages; screened: ScreenedCallInput }
  | { kind: "cap"; languages: Languages; screened: ScreenedCallInput; personaName?: string }
  // A caller whose whole recent history on this account is silent calls.
  // Speaks the SAME sentence as `refuse` on purpose — a robot learns nothing
  // from a distinct message, and a human who has somehow been caught by this
  // is told to try again later, which the rolling window makes true. Only the
  // log line distinguishes the reason.
  | { kind: "blocked"; languages: Languages; screened: ScreenedCallInput; personaName?: string };

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
  // M7a PR-4 (plan G9; owner answers Q2 and I7): a paused account, or a plan
  // with no receptionist, when the call cannot or may no longer be forwarded.
  // Not the refusal sentence: nobody can pick up right now.
  unavailable: {
    en: "Thanks for calling. No one can take your call right now. Please call back later.",
    es: "Gracias por llamar. En este momento nadie puede atender su llamada. Por favor llame más tarde.",
  },
} as const;

/** The `<Say>` elements for one sentence in the profile's languages — English
 *  first when both, because order matters to a caller hearing it live. */
function says(languages: Languages, copy: { en: string; es: string }): string {
  const en = sayLine("en", copy.en);
  const es = sayLine("es", copy.es);
  return languages === "es" ? es : languages === "both" ? en + es : en;
}

function sayXml(languages: Languages, copy: { en: string; es: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${says(languages, copy)}<Hangup/></Response>`;
}

/** Which sentence each refusal speaks: `blocked` says `refuse`'s on purpose (see `Routability`). */
const REFUSAL_COPY = { refuse: COPY.refuse, blocked: COPY.refuse, cap: COPY.cap } as const;

/** A refusal's verbs, without the document around them: what follows an owner-line ask whose caller today's path
 *  would refuse (review C-1). `refusalXml` wraps the same string, so the two can never differ by a byte. */
function refusalVerbs(kind: keyof typeof REFUSAL_COPY, languages: Languages): string {
  return `${says(languages, REFUSAL_COPY[kind])}<Hangup/>`;
}

function refusalXml(kind: keyof typeof REFUSAL_COPY, languages: Languages): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${refusalVerbs(kind, languages)}</Response>`;
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

/**
 * The most the owner-line read may add to ANY signed call (review M-1; spec
 * §4.1: "This branch adds no audio and no delay to a customer's call").
 * Why 300 ms: the spike measured the read alone at p95 171-192 ms from a
 * residential link, about 150 ms of which is one round trip to us-east-1
 * (spike record §5), and 0.16 ms inside Postgres. On Vercel, a few
 * milliseconds from Supabase, a healthy read lands far inside this, so it
 * never trips on a working day. A read that hangs costs a caller at most
 * 0.3 s on top of the count batch it runs beside, well inside Telnyx's
 * answer deadline. Past it, the read is a miss: today's path, logged.
 */
export const OWNER_LINE_LOOKUP_DEADLINE_MS = 300;

/** `p`, or null once `ms` pass first (calling `onLate` then). The timer is cleared as soon as `p` settles. */
function withDeadline<T>(p: Promise<T>, ms: number, onLate: () => void): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => { onLate(); resolve(null); }, ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** The database module, as a type only: the value is always the lazy `await import("@bis/db")` (SC-18). */
type DbModule = typeof import("@bis/db");

/**
 * Billing's verdict on whether this account has a voice at all (M7a PR-4, plan G9): `NoVoice` when it does not, null
 * when it does. ONE read, shared by `classify` and `ownerLineStillOffered`, so the owner line re-reads exactly what
 * the answer route reads. Async, so a synchronous throw becomes a rejection the caller's own catch sees. Call it only
 * with BILLING_ENFORCE on (`billingEnforced()`), as both callers do.
 */
async function readNoVoice(
  dbModule: DbModule, db: ReturnType<DbModule["serviceDb"]>, accountId: string,
): Promise<NoVoice | null> {
  const standing = await dbModule.readBillingStanding(db, accountId);
  const { billingVerdict, voiceBlock } = await import("@/lib/billing/standing");
  return voiceBlock(billingVerdict(standing, true, new Date()));
}

/**
 * `ownerLineEligible` is true only on a Telnyx-signed request with a usable
 * VOICE_HANDOFF_SECRET that is not the press-1 re-run (`route`): the only
 * requests whose owner-pin action could ever be trusted (SC-14). False, the
 * owner line is not even read.
 */
async function classify(calledE164: string, callerE164: string | null, ownerLineEligible = false): Promise<Routability> {
  // Lazy import: a module-scope DB import here breaks `next build` during
  // page-data collection (the demo's documented trap). Any failure anywhere
  // in this try (lookup, profile read) falls to the outer catch and fails
  // open to dial — the webhook resolver still gates authoritatively.
  try {
    // The module is kept whole so `readBillingStanding` is touched only with
    // BILLING_ENFORCE on, inside the billing read's own catch below.
    const dbModule = await import("@bis/db");
    const {
      serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince,
      countCallsByCallerSince, countCallerHistorySince, countForwardedCallsSince,
    } = dbModule;
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
      // gets. The caller's number is masked (loggablePhone): it is personal
      // data. The called number stays whole: it is one of our own business
      // lines, and on this path no account row names it, so it is the only
      // thing in the log that says which line is unregistered.
      console.log(`texml declined refuse-unknown for ${calledE164}, caller ${loggablePhone(callerE164)}`);
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
      console.log(`texml declined refuse-disabled for ${calledE164}, caller ${loggablePhone(callerE164)}, accountId ${row.account_id}`);
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
    // M7a PR-4 (plan G9, review M1). Started now, awaited after the counts:
    // no added latency, and its own catch, so a billing failure is today's
    // path (fail open, logged) and never marks the call uncleared. An async
    // IIFE so the read STARTS before the counts below (its body runs
    // synchronously to the first await) and a synchronous throw becomes a
    // rejection the catch sees. `dial` returns wait for it, and so does ONE
    // other read: an owner-line hit's offer check (F-032 SC-17: is there
    // voice at all?), which runs after the counts, so it waits on a read that
    // has been in flight the whole time. A customer's refusal or cap never
    // waits for it.
    const accountId = row.account_id;
    const billingRead: Promise<NoVoice | null> = billingEnforced()
      ? readNoVoice(dbModule, db, accountId).catch((e: unknown) => {
        console.error(`texml billing read failed — Sofía answers, accountId ${accountId}: ${String(e)}`);
        return null;
      })
      : Promise.resolve(null);
    const withBilling = async (): Promise<{ noVoice?: NoVoice }> => {
      const noVoice = await billingRead;
      return noVoice ? { noVoice } : {};
    };
    // F-032 (§4.1): started BESIDE the count batch, never inside it. Inside a
    // Promise.all its rejection would reject the whole batch and fail the call
    // UNCLEARED (plan I-7; a test pins that it does not). An async IIFE, as
    // the billing read above, so even a synchronous throw becomes a rejection
    // its own catch sees, and a throw is a miss: today's path. A stranger's
    // call waits for max(), not +, and never for more than the deadline: a
    // read that hangs is a miss at OWNER_LINE_LOOKUP_DEADLINE_MS (review M-1;
    // spec §4.1, "no delay"). The account's local day is SQL's (Q-F).
    // Logged by account and error CLASS only (review M-5): never the caller's
    // number, and never the error's message, because the wrapper's
    // "unexpected answer" message quotes the RPC's answer (a name, the PIN
    // hash's parameters).
    // `ownerReadLate`: once the deadline has fired, the call has already taken
    // today's path and said so; a failure arriving after that is not news,
    // and a second "lookup failed" line would misdescribe the call (re-review
    // M-B), so the catch stays silent.
    let ownerReadLate = false;
    const ownerRead: Promise<OwnerLineLookup | null> = ownerLineEligible && callerE164
      ? withDeadline(
        (async () => dbModule.ownerLineAnswerLookup(db, accountId, callerE164, dbModule.OWNER_LINE_MAX_CALLS_PER_DAY))()
          .catch((e: unknown) => {
            if (!ownerReadLate) {
              console.error(`texml owner-line lookup failed (${e instanceof Error ? e.name : typeof e}) — today's path, accountId ${accountId}`);
            }
            return null;
          }),
        OWNER_LINE_LOOKUP_DEADLINE_MS,
        () => {
          ownerReadLate = true;
          console.error(`texml owner-line lookup timed out after ${OWNER_LINE_LOOKUP_DEADLINE_MS} ms — today's path, accountId ${accountId}`);
        },
      )
      : Promise.resolve(null);
    let ownerLine: OfferedOwnerLine | undefined;
    let ownerSkipped: SkippedRefusal | undefined;
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
      // F-032: only a role the data path offers (O-1 = F2: Owner and Staff;
      // the SQL lookup also answers for a Technician), and only where the
      // Gather's fallthrough IS today's path (SC-17): not with the agency's
      // forward on, the fallback drill engaged, or billing's no-voice. In those
      // states the person is a customer here, refusals and all.
      // Final review M-3: no PIN ask without a pepper. owner-pin could check no PIN at all (it would take today's path
      // anyway), so asking for one only costs the caller the ask. Same check owner-pin makes (pinPepperConfigured);
      // the call-in code is sha256 (secrets.ts) and needs none, so a `verify` hit is still asked.
      const looked = await ownerRead;
      const pepperless = looked?.status === "pin" && !pinPepperConfigured();
      if (pepperless) console.error(`texml owner line: OWNER_LINE_PIN_PEPPER is not set — no PIN ask, today's path, accountId ${row.account_id}`);
      const hit = looked && !pepperless && (looked.status === "verify" || looked.status === "pin" || looked.status === "over_limit")
        && OWNER_LINE_ROLES.includes(looked.role) ? looked : undefined;
      ownerLine = hit && profile.forward_calls !== true && !fallbackDrillActive(calledE164, callerE164)
        && !(await billingRead) ? hit : undefined;
      // Owner ruling Q-C: a registered, verified person about to be asked for
      // a PIN or a call-in code is never refused by the CUSTOMER checks
      // (repeat-spam, the per-caller cap, the per-account cap of 50). Their
      // own limit is the lookup's. Over that limit they are a customer again,
      // so every customer check applies.
      // The checks still RUN for an ask, and a refusal they reach becomes the
      // ask's fallthrough (`ownerSkipped`, review C-1). After the Gather,
      // Telnyx either posts to owner-pin, whose "today's path" re-runs this
      // function with the owner line skipped, or FALLS THROUGH to the next
      // verb without asking us (the screen's case A; Telnyx documents
      // neither). That next verb must therefore already be today's path:
      // the refusal a customer would hear, never a bridge carrying a fallback
      // ticket that says every guard cleared.
      const ownerAsk = ownerLine?.status === "verify" || ownerLine?.status === "pin";
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
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (ownerAsk) {
        // Reputation first here too: the refusal that follows the ask is the
        // one today's path would speak.
        const skipped: SkippedRefusal["kind"] | null = reputation.blocked ? "blocked" : !verdict.allowed ? "cap" : null;
        if (skipped) {
          console.log(`texml owner line: today's ${skipped} refusal follows the ask, accountId ${row.account_id}`);
          ownerSkipped = { kind: skipped, languages: profile.languages };
        }
      } else {
        if (reputation.blocked) {
          console.log(`texml declined blocked (${reputation.reason}) for ${calledE164}, caller ${loggablePhone(callerE164)}, accountId ${row.account_id}`);
          return {
            kind: "blocked", languages: profile.languages, personaName: profile.persona_name,
            screened: {
              accountId: row.account_id, phoneNumberId: row.id,
              calledE164, callerE164, reason: "repeat-spam",
            },
          };
        }
        if (!verdict.allowed) {
          console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${loggablePhone(callerE164)}, accountId ${row.account_id}`);
          return {
            kind: "cap", languages: profile.languages, personaName: profile.persona_name,
            screened: {
              accountId: row.account_id, phoneNumberId: row.id,
              calledE164, callerE164, reason: "over-cap",
            },
          };
        }
      }
      // Strictly `=== 0`: a history that did not say (undefined) is NOT a
      // first-time caller. Unknown means bridge, never the question.
      firstTimeCaller = history.answeredCalls === 0;
    } catch (e) {
      console.error(`texml cap/reputation count failed for ${calledE164}: ${String(e)}`); // fail open
      return {
        kind: "dial", accountId: row.account_id, phoneNumberId: row.id,
        forwardCalls: profile.forward_calls === true, cleared: false,
        languages: profile.languages, ...(await withBilling()),
      };
    }
    // The fail-open return above carries no `ownerLine`: an UNCLEARED call is
    // never offered the owner line.
    return {
      kind: "dial", accountId: row.account_id, phoneNumberId: row.id,
      forwardCalls: profile.forward_calls === true, cleared: true,
      languages: profile.languages, firstTimeCaller, personaName: profile.persona_name,
      ...(ownerLine ? { ownerLine } : {}), ...(ownerSkipped ? { ownerSkipped } : {}), ...(await withBilling()),
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
 *
 * `extra` (F-032): `ownerLine` adds the owner pass (a correct PIN only, via
 * `ownerLineBridge`); `wrap` puts the SAME `<Dial>` inside another document
 * (the owner line's asks, whose fallthrough it is). With neither, the body is
 * byte-identical to before.
 */
function dialXml(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  cleared?: { accountId: string; callerE164: string | null }, drill = false,
  extra: { ownerLine?: { accountId: string; userId: string; role: OwnerPassRole }; wrap?: (dial: string) => string } = {},
): { body: string; unsignedBridge: boolean } {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return {
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${sayLine("en", "Configuration error: the project identifier is not set.")}<Hangup/></Response>`,
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
  // F-032 §4.3: the owner pass, bound to THIS dial's handoff token, only for a
  // Telnyx-signed request (owner-pin refuses any other) and only with a usable
  // secret. A pass that cannot be signed is logged and the call reaches the
  // receptionist as a customer, never an error.
  const ownerPass = extra.ownerLine && authenticated && calledE164
    ? signOwnerPass(token, { ...extra.ownerLine, calledE164 }, Date.now())
    : null;
  if (extra.ownerLine && !ownerPass) {
    console.error(`texml: an owner pass could not be signed — this call reaches the receptionist, accountId ${extra.ownerLine.accountId}`);
  }
  const params = [
    ...(calledE164 ? [`X-BIS-Called=${encodeURIComponent(calledE164)}`] : []),
    `X-BIS-Handoff=${encodeURIComponent(token)}`,
    ...(signature ? [`${SIP_HANDOFF_HEADER}=${encodeURIComponent(signature)}`] : []),
    ...(ownerPass ? [`${OWNER_PASS_HEADER}=${encodeURIComponent(ownerPass)}`] : []),
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
  const dial = `<Dial answerOnBridge="true" action="${xmlText(action)}" method="POST"><Sip>${xmlText(uri)}</Sip></Dial>`;
  return {
    body: extra.wrap ? extra.wrap(dial) : `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${dial}</Response>`,
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
  const target = await resolveTransferTarget(accountId);
  if (target.to !== null) return target.to;
  // The three lines this wrapper has always logged, byte for byte (a test
  // pins them): an unusable target and a BIS line are logs, a failed read is
  // an error.
  if (target.why === "bis-line") {
    console.log(`texml forward is on but its transfer number is a BIS line — Sofía answers, accountId ${accountId}`);
  } else if (target.error !== undefined) {
    console.error(`texml forward lookup failed — Sofía answers, accountId ${accountId}: ${target.error}`);
  } else {
    console.log(`texml forward is on but unusable (${target.why}) — Sofía answers, accountId ${accountId}`);
  }
  return null;
}

/**
 * The account's transfer number, through the handoff feature's own
 * `resolveHandoffTarget` (own-number guard included) and the any-BIS-line
 * guard, or WHY there is none: `not-configured` / `own-number` (the
 * resolver's reasons), `bis-line`, or `lookup-failed` with the error. Shared
 * by the per-account forward and the billing forward (M7a PR-4, plan G9), so
 * both carry the same loop guards. Never throws.
 */
async function resolveTransferTarget(
  accountId: string,
): Promise<{ to: string } | { to: null; why: string; error?: string }> {
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
    if (!target.available) return { to: null, why: target.reason };
    // ANY number this platform owns, not only this account's: two accounts
    // forwarding to each other's lines would ping-pong a call between this
    // route's two forwards, and a forwarded call writes no row that a cap
    // could count. A number we own is never a person's phone.
    if (await getPhoneNumberByE164(db, target.to)) return { to: null, why: "bis-line" };
    return { to: target.to };
  } catch (e) {
    return { to: null, why: "lookup-failed", error: String(e) };
  }
}

/** A screened call's record (0039): every refusal, and the billing message. */
function recordScreenedCallLater(screened: ScreenedCallInput): void {
  // `after()` because this route sits on Telnyx's carrier answer
  // deadline and its own comments say wall-clock is the one thing it
  // cannot spend. Same pattern, same reason, as incoming/route.ts's own
  // `after(() => runCallLifecycle(...))`.
  //
  // BEST-EFFORT, and that is a contract: a failed write OR A FAILED
  // SCHEDULE logs and changes nothing about the refusal, the spoken
  // copy, or the hang-up. The console.log lines in classify() are
  // untouched and remain the evidence if this write is itself broken.
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

/**
 * The forwarded call's record (0059), which the caps above count. In
 * `after()` and best-effort, exactly like the screened-call write
 * (`recordScreenedCallLater`), for the same two reasons: this route cannot
 * spend Telnyx's answer deadline, and a failed write must never cost the
 * caller the forward. A missed row under-counts one call; it never refuses one.
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
 *
 * `skipOwnerLine` (F-032): the press-1 re-run and owner-pin's "today's path"
 * pass it, so a re-run never asks anyone for a PIN and every customer check
 * re-runs with the owner line out of the way.
 */
export async function answer(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  opts: { skipScreen?: boolean; skipOwnerLine?: boolean } = {},
): Promise<NextResponse> {
  const result = await route(
    calledE164, callerE164, origin, authenticated, opts.skipScreen === true, opts.skipOwnerLine === true,
  );
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

/** F-032 §4.2: a correct PIN. The bridge every call gets, plus the owner pass. Only owner-pin calls this, and only
 *  for a Telnyx-signed request, so `authenticated` is true by construction. Logged by account only. */
export function ownerLineBridge(
  calledE164: string, callerE164: string, origin: string,
  owner: { accountId: string; userId: string; role: OwnerPassRole },
): NextResponse {
  console.log(`texml owner line PIN ok — bridging with an owner pass, accountId ${owner.accountId}`);
  return xmlResponse(dialXml(calledE164, callerE164, origin, true,
    { accountId: owner.accountId, callerE164 }, false, { ownerLine: owner }).body);
}

/**
 * F-032 Task 9 review m-4: a correct PIN mints an owner pass only while today's path for this call still reaches
 * Sofía. The ask was offered only when it did (SC-17, decided in `classify`), but the PIN arrives seconds later, and
 * in between the agency may have turned its forward on, billing may have paused the account, a drill may be set, or
 * VOICE_FORWARD_TO may be set. Each is re-read here with the reads the answer route itself makes: the two env checks
 * (`forwardTarget`, `fallbackDrillActive`), `getVoiceProfile`'s `forward_calls`, and `readNoVoice`. False sends the
 * caller to today's path with no pass. A read that fails is false too, logged by error class: FAIL CLOSED to today's
 * path (the orchestrator's decision for owner-pin, review m-2). Never throws. Logged by account only.
 */
export async function ownerLineStillOffered(calledE164: string, callerE164: string, accountId: string): Promise<boolean> {
  const no = (why: string) => {
    console.log(`texml owner line PIN ok but ${why} — today's path, no owner pass, accountId ${accountId}`);
    return false;
  };
  if (forwardTarget()) return no("VOICE_FORWARD_TO");
  if (fallbackDrillActive(calledE164, callerE164)) return no("the fallback drill");
  try {
    const dbModule = await import("@bis/db");
    const db = dbModule.serviceDb();
    const [profile, noVoice] = await Promise.all([
      dbModule.getVoiceProfile(db, accountId),
      billingEnforced() ? readNoVoice(dbModule, db, accountId) : Promise.resolve(null),
    ]);
    if (profile?.forward_calls === true) return no("forward_calls");
    if (noVoice) return no("billing has no voice");
    return true;
  } catch (e) {
    console.error(`texml owner line PIN ok but today's states could not be read (${e instanceof Error ? e.name : typeof e}) — today's path, no owner pass, accountId ${accountId}`);
    return false;
  }
}

/** F-032 §4.2: a wrong PIN (below 3) or a wrong code. Asks again, falling through to today's bridge with no pass.
 *  The persona is read for the words only: a failed read says "Sofía", never an error. */
export async function ownerLineGatherAgain(
  calledE164: string, callerE164: string, origin: string,
  p: { kind: "pin" | "verify"; locale: Locale; accountId: string; name: string | null },
): Promise<NextResponse> {
  // The re-ask's fallthrough must be today's path too (review C-1): Telnyx may run it without asking us. So today's
  // verdicts are read again, with the owner line out of the way, and the persona comes from the same read.
  //   - A refusal (an unknown or not-live number, a disabled line, repeat spam, a cap): its sentence and hang-up.
  //   - A call every guard cleared, for THIS account, where Sofía is where today's path goes (no forward, no
  //     billing message, no drill): today's cleared bridge, fallback ticket included.
  //   - Anything else (a read failed, the number moved, or a state the first ask was never offered in): the
  //     UNCLEARED bridge, so no ticket vouches for it, and the SIP webhook gates the call as it does today.
  const today = await classify(calledE164, callerE164, false);
  const persona = (today.kind !== "refuse" && today.personaName) || "Sofía";
  const action = ownerPinUrl(origin);
  const doc = (fallthrough: string) => p.kind === "pin"
    ? ownerPinAskXml({ locale: p.locale, name: p.name, persona, action, retry: true, fallthrough })
    : ownerVerifyAskXml({ locale: p.locale, action, retry: true, fallthrough });
  if (today.kind !== "dial") return xmlResponse(doc(refusalVerbs(today.kind, today.languages)));
  const vouched = today.cleared === true && today.accountId === p.accountId && !today.noVoice && !today.forwardCalls
    && !fallbackDrillActive(calledE164, callerE164);
  return xmlResponse(dialXml(calledE164, callerE164, origin, true,
    vouched ? { accountId: p.accountId, callerE164 } : undefined, false, { wrap: doc }).body);
}

async function route(
  calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  skipScreen = false, skipOwnerLine = false,
): Promise<{ response: NextResponse; lookupFailed: boolean; unsignedBridge: boolean }> {
  const done = (response: NextResponse, lookupFailed = false, unsignedBridge = false) =>
    ({ response, lookupFailed, unsignedBridge });
  const forward = forwardTarget();
  if (forward) {
    // Logged on EVERY forwarded call, not once at boot. This mode bypasses
    // Sofía entirely, and the failure it invites is leaving it on: a line
    // that quietly rings a personal mobile for a week is worse than one that
    // is briefly unavailable.
    console.log(`texml FORWARDING to ${loggablePhone(forward)} — Sofía is bypassed while VOICE_FORWARD_TO is set`);
    return done(xmlResponse(forwardXml(forward, calledE164)));
  }
  if (calledE164) {
    const result = await classify(
      calledE164, callerE164, !skipOwnerLine && authenticated && sipHandoffSecretConfigured(),
    );
    if (result.kind !== "dial") {
      // ONE write site for all six refusals, not one per branch — six call
      // sites would be six chances for the next reason to forget one. (The
      // billing message below is the one other caller, with its own reason.)
      recordScreenedCallLater(result.screened);
    }
    if (result.kind === "refuse") return done(xmlResponse(refusalXml("refuse", result.languages)));
    // Deliberately the same sentence as `refuse`, and deliberately ABOVE the
    // bridge: a refusal costs nothing, a bridge starts billing.
    if (result.kind === "blocked") return done(xmlResponse(refusalXml("blocked", result.languages)));
    if (result.kind === "cap") return done(xmlResponse(refusalXml("cap", result.languages)));
    // F-032 §4.1: the owner line. AHEAD of the press-1 screen (SC-16), so a
    // registered person is never asked to press 1. `classify` offers it only
    // on a cleared call whose Gather can fall through to today's bridge (SC-17:
    // never with the agency's forward on, billing's no-voice, or the drill),
    // only to a role the data path offers, and only on a signed request (the
    // lookup is not even read otherwise; SC-14). Logged by account only.
    const ol = result.ownerLine;
    if (ol && result.cleared && result.accountId) {
      const locale: Locale = ol.language ?? ol.accountLanguage ?? "en";
      const persona = result.personaName || "Sofía";
      const accountId = result.accountId;
      const action = ownerPinUrl(origin);
      // What follows the ask is today's path (review C-1): the refusal the ask
      // skipped, when it skipped one, and no bridge is minted at all; otherwise
      // today's bridge, cleared because every guard really did clear.
      const skipped = result.ownerSkipped;
      const ask = (doc: (fallthrough: string) => string) => {
        if (skipped) return done(xmlResponse(doc(refusalVerbs(skipped.kind, skipped.languages))));
        const d = dialXml(calledE164, callerE164, origin, authenticated,
          { accountId, callerE164 }, false, { wrap: doc });
        return done(xmlResponse(d.body), false, d.unsignedBridge);
      };
      if (ol.status === "verify") {
        console.log(`texml owner line asking for a call-in code, accountId ${result.accountId}`);
        return ask((fallthrough) => ownerVerifyAskXml({ locale, action, retry: false, fallthrough }));
      }
      if (ol.status === "pin") {
        console.log(`texml owner line asking for a PIN, accountId ${result.accountId}`);
        return ask((fallthrough) => ownerPinAskXml({ locale, name: ol.name, persona, action, retry: false, fallthrough }));
      }
      // Over their own limit the person is a customer, so no refusal was
      // skipped and `skipped` is unset here: the line, then today's bridge.
      console.log(`texml owner line over its daily limit — today's path, accountId ${result.accountId}`);
      return ask((fallthrough) => ownerLimitXml({ locale, persona, fallthrough }));
    }
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
          ? `texml screen FORCED on ${calledE164} from ${loggablePhone(callerE164)} — VOICE_SCREEN_ALWAYS_FROM is set, accountId ${accountId}`
          : `texml screen asking ${calledE164}, caller ${loggablePhone(callerE164)} to press 1 (first-time), accountId ${accountId}`);
        return done(xmlResponse(screenXml(languages, screenActionUrl(origin, languages, accountId))));
      }
    }
    // M7a PR-4 (plan G9; owner answers Q2, Q5, I7): a paused account, or a
    // plan with no receptionist. After every guard and the screen; before the
    // per-account forward and the bridge. A CLEARED call the verdict still
    // lets ring the business (a pause under 30 days, or a plan without Sofía)
    // goes to the transfer number, with the per-account forward's loop
    // guards; anything else hears the short message. Both are recorded, and
    // the forwarded ones count toward the daily caps (0059). An uncleared
    // call is never forwarded: a forward has no webhook behind it to re-check.
    // Known (M13): a paused account in Closed today or Storm forwards in its
    // first 30 days like any other; this route reads no business status.
    if (result.accountId && result.noVoice) {
      const { reason, forward } = result.noVoice;
      const target = result.cleared && forward
        ? await resolveTransferTarget(result.accountId)
        : { to: null, why: forward ? "not cleared" : "paused 30 days or more" };
      if (target.to !== null) {
        console.log(`texml FORWARDING account ${result.accountId} to its transfer number — ${reason}`);
        recordForwardedCallLater({
          accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
          calledE164, callerE164, kind: reason,
        });
        return done(xmlResponse(forwardXml(target.to, calledE164)));
      }
      // A failed transfer-number read is an outage, not a setting: an error.
      const failed = "error" in target && target.error !== undefined;
      const line = `texml unavailable message for account ${result.accountId} — ${reason}, no forward (${failed ? `${target.why}: ${target.error}` : target.why})`;
      if (failed) console.error(line);
      else console.log(line);
      recordScreenedCallLater({
        accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
        calledE164, callerE164, reason,
      });
      return done(xmlResponse(sayXml(result.languages ?? "en", COPY.unavailable)));
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
        ? `texml FALLBACK DRILL on ${calledE164} from ${loggablePhone(callerE164)} — Sofía is deliberately unreachable on this call while VOICE_FALLBACK_DRILL_TO/FROM are set`
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

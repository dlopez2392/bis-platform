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
// `dialXml` below owns the token; `xmlText` owns the reason both of those
// values are escaped on the way into the document.
// Telnyx TELLS US the dialed number (To param) — the SIP leg to OpenAI does
// not reliably carry it — so we smuggle it onto the SIP URI as X-BIS-Called.
// URI ?X-headers ride the INVITE and surface in the webhook's sip_headers.
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
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/voice/phone-number";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { callAnswerable } from "@/lib/voice/accept-gate";
import { newHandoffToken } from "@/lib/voice/handoff";
import { configuredOrigin } from "@/lib/email/origin";

export const runtime = "nodejs";

type Languages = "en" | "es" | "both";
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: Languages }
  | { kind: "cap"; languages: Languages }
  // A caller whose whole recent history on this account is silent calls.
  // Speaks the SAME sentence as `refuse` on purpose — a robot learns nothing
  // from a distinct message, and a human who has somehow been caught by this
  // is told to try again later, which the rolling window makes true. Only the
  // log line distinguishes the reason.
  | { kind: "blocked"; languages: Languages };

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

function sayXml(languages: Languages, copy: { en: string; es: string }): string {
  const en = `<Say>${copy.en}</Say>`;
  const es = `<Say language="es-MX">${copy.es}</Say>`;
  const says = languages === "es" ? es : languages === "both" ? en + es : en;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${says}<Hangup/></Response>`;
}

async function classify(calledE164: string, callerE164: string | null): Promise<Routability> {
  // Lazy import: a module-scope DB import here breaks `next build` during
  // page-data collection (the demo's documented trap). Any failure anywhere
  // in this try (lookup, profile read) falls to the outer catch and fails
  // open to dial — the webhook resolver still gates authoritatively.
  try {
    const {
      serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince,
      countCallsByCallerSince, countCallerHistorySince,
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
      return { kind: "refuse", languages: "en" };
    }
    const profile = await getVoiceProfile(db, row.account_id);
    const gate = callAnswerable({ status: row.status, profile });
    if (!gate.answerable) {
      console.log(`texml declined refuse-disabled for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
      return { kind: "refuse", languages: profile?.languages ?? "en" };
    }
    // Unreachable — callAnswerable's "no-profile" reason above already
    // returned for a null profile — but TypeScript can't see across that
    // predicate call, so this narrows `profile` for everything below.
    if (!profile) {
      return { kind: "refuse", languages: "en" };
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
    try {
      const now = new Date();
      const dayStart = utcDayStart(now);
      const repCfg = readReputationConfig();
      // Independent reads — run them together, this route sits on Telnyx's
      // carrier answer-deadline. The third read joins the existing pair
      // rather than following them, so Guard 2 costs no wall-clock at all.
      const [forAccount, forNumber, history] = await Promise.all([
        countCallsSince(db, row.account_id, dayStart),
        callerE164 ? countCallsByCallerSince(db, row.account_id, callerE164, dayStart) : Promise.resolve(0),
        callerE164
          ? countCallerHistorySince(db, row.account_id, callerE164, windowStart(now, repCfg.windowDays))
          : Promise.resolve({ spamCalls: 0, otherCalls: 0 }),
      ]);
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
      const reputation = decideReputation(history, repCfg);
      if (reputation.blocked) {
        console.log(`texml declined blocked (${reputation.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return { kind: "blocked", languages: profile.languages };
      }
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return { kind: "cap", languages: profile.languages };
      }
    } catch (e) {
      console.error(`texml cap/reputation count failed for ${calledE164}: ${String(e)}`); // fail open
    }
    return { kind: "dial" };
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return { kind: "dial" }; // fail open — the webhook still gates
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
  return toE164(env.VOICE_FORWARD_TO);
}

export function forwardXml(to: string, callerId: string | null): string {
  const cid = callerId ? ` callerId="${callerId}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial${cid} timeout="30">${to}</Dial></Response>`;
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
 * It rides the dial with no `To` as well. The webhook can still resolve a
 * tenant from the To/Diversion fallbacks on such a call, so it can still be
 * answered — and its caller can still ask for a person.
 */
function dialXml(calledE164: string | null, origin: string): string {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Configuration error: the project identifier is not set.</Say><Hangup/></Response>`;
  }
  const token = newHandoffToken();
  const base = `sip:${projectId}@sip.api.openai.com;transport=tls`;
  const params = [
    ...(calledE164 ? [`X-BIS-Called=${encodeURIComponent(calledE164)}`] : []),
    `X-BIS-Handoff=${encodeURIComponent(token)}`,
  ];
  const uri = `${base}?${params.join("&")}`;
  const action = `${origin}/api/voice/texml/handoff?t=${encodeURIComponent(token)}`;
  // xmlText on BOTH: the URI's `&` separators are the live bug, and the
  // action URL is one appended query parameter away from the same one.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial answerOnBridge="true" action="${xmlText(action)}" method="POST"><Sip>${xmlText(uri)}</Sip></Dial></Response>`;
}

/**
 * Turns a VALUE into XML text. Everything this route interpolates into a
 * document — a URI, an action URL, a phone number — goes through here, and
 * the reason is one character.
 *
 * The SIP URI is CHARACTER DATA inside `<Sip>`, and a URI's own parameter
 * separator is `&`, which in XML 1.0 §2.4 begins an entity reference: a
 * strict parser reads `&X-BIS-Handoff` and reports a fatal error, a lenient
 * one silently drops the token. The bridge carried one URI parameter and no
 * separator until the handoff feature added a second, so the day that second
 * parameter appeared, every inbound call emitted a document that is not XML.
 * Nothing caught it: the whole suite asserted that a token was PRESENT, never
 * that the document parses. `wellformed.test.ts` now parses every document
 * this app emits, which is what makes the NEXT parameter safe.
 *
 * Escaping here rather than at the join keeps the URI a URI right up to the
 * moment it becomes XML — the same reason `encodeURIComponent` is applied to
 * the values and not to the whole string.
 */
function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function respond(calledE164: string | null, callerE164: string | null, origin: string): Promise<NextResponse> {
  const forward = forwardTarget();
  if (forward) {
    // Logged on EVERY forwarded call, not once at boot. This mode bypasses
    // Sofía entirely, and the failure it invites is leaving it on: a line
    // that quietly rings a personal mobile for a week is worse than one that
    // is briefly unavailable.
    console.log(`texml FORWARDING to ${forward} — Sofía is bypassed while VOICE_FORWARD_TO is set`);
    return xmlResponse(forwardXml(forward, calledE164));
  }
  if (calledE164) {
    const result = await classify(calledE164, callerE164);
    if (result.kind === "refuse") return xmlResponse(sayXml(result.languages, COPY.refuse));
    // Deliberately the same sentence as `refuse`, and deliberately ABOVE the
    // bridge: a refusal costs nothing, a bridge starts billing.
    if (result.kind === "blocked") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "cap") return xmlResponse(sayXml(result.languages, COPY.cap));
    // kind === "dial" → fall through to the same dial path as calledE164===null
  }
  return xmlResponse(dialXml(calledE164, origin));
}

/**
 * Where the `<Dial action=…>` URL must point. Telnyx is a server-to-server
 * caller, so `req.url`'s origin is the deployment's own vercel.app URL, not
 * the custom domain — APP_ORIGIN wins here for the same reason it wins in
 * `email/origin.ts` and in the incoming webhook (`incoming/route.ts:891`).
 * The fallback is still correct, just uglier in a log line.
 */
function actionOrigin(req: Request): string {
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
  return respond(toE164(params.get("To")), toE164(params.get("From")), actionOrigin(req));
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST, always — req.formData() consumes the body and the
  // Telnyx signature covers the exact raw bytes, not a re-serialized form.
  // Guarded: a body-read failure must not 500 where the old code fell
  // through to a dial — treat it as an empty body instead. That then flows
  // correctly either way: with the key set, an empty body fails the
  // signature check → 403 (fail-closed, correct for the auth path); with
  // the key unset, an empty body parses to no To/From → dial (the old
  // fail-open behavior, unchanged).
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error(`texml: failed to read request body: ${String(e)}`);
  }
  const form = new URLSearchParams(rawBody);
  // Attacker-claimed values, parsed before the signature check below has a
  // chance to pass — they're only trustworthy once it does, but they're
  // still worth logging on rejection so a 403 line says who claimed to be
  // calling whom. Named claimedTo/claimedFrom to keep that honest.
  const claimedTo = form.get("To") || null;
  const claimedFrom = form.get("From") || null;
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const timestamp = req.headers.get("telnyx-timestamp");
    const signatureB64 = req.headers.get("telnyx-signature-ed25519");
    // Sanitized through toE164 before logging — claimedTo/claimedFrom are
    // still unauthenticated at this point (that's the whole reason we're
    // rejecting), so raw interpolation would let a prober inject newlines or
    // control characters into the log stream and forge fake decline lines of
    // unbounded length. toE164 collapses anything that isn't a real phone
    // number to null, logged as "none".
    const safeTo = toE164(claimedTo) ?? "none";
    const safeFrom = toE164(claimedFrom) ?? "none";
    if (!timestamp || !signatureB64) {
      console.error(`texml: rejected request (missing-headers), claimedTo ${safeTo}, claimedFrom ${safeFrom}`);
      return new NextResponse(null, { status: 403 });
    }
    const ok = verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey });
    if (!ok) {
      console.error(`texml: rejected request (invalid-signature), claimedTo ${safeTo}, claimedFrom ${safeFrom}`);
      return new NextResponse(null, { status: 403 });
    }
  }
  return respond(toE164(claimedTo), toE164(claimedFrom), actionOrigin(req));
}

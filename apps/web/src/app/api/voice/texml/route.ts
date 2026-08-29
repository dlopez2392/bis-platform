// Telnyx hits this for every inbound call on any client number and we answer
// with TeXML that bridges the call to the platform's OpenAI SIP connector.
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
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/voice/phone-number";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { callAnswerable } from "@/lib/voice/accept-gate";

export const runtime = "nodejs";

type Languages = "en" | "es" | "both";
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: Languages }
  | { kind: "cap"; languages: Languages };

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
      serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince, countCallsByCallerSince,
    } = await import("@bis/db");
    const { readLimitConfig, decideLimit, utcDayStart } = await import("@/lib/voice/call-limits");
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
    // Cap UX only — the caller deserves words, not dead air. The incoming
    // webhook re-checks with the same decideLimit and stays authoritative,
    // so a stale count here (or the two reads racing an in-flight call) can
    // only ever waste a dial attempt, never let an over-cap caller through.
    try {
      const dayStart = utcDayStart(new Date());
      // Independent reads — run them together, this route sits on Telnyx's
      // carrier answer-deadline.
      const [forAccount, forNumber] = await Promise.all([
        countCallsSince(db, row.account_id, dayStart),
        callerE164 ? countCallsByCallerSince(db, row.account_id, callerE164, dayStart) : Promise.resolve(0),
      ]);
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return { kind: "cap", languages: profile.languages };
      }
    } catch (e) {
      console.error(`texml cap count failed for ${calledE164}: ${String(e)}`); // fail open
    }
    return { kind: "dial" };
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return { kind: "dial" }; // fail open — the webhook still gates
  }
}

function dialXml(calledE164: string | null): string {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Configuration error: the project identifier is not set.</Say><Hangup/></Response>`;
  }
  const base = `sip:${projectId}@sip.api.openai.com;transport=tls`;
  const uri = calledE164 ? `${base}?X-BIS-Called=${encodeURIComponent(calledE164)}` : base;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial answerOnBridge="true"><Sip>${uri}</Sip></Dial></Response>`;
}

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function respond(calledE164: string | null, callerE164: string | null): Promise<NextResponse> {
  if (calledE164) {
    const result = await classify(calledE164, callerE164);
    if (result.kind === "refuse") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "cap") return xmlResponse(sayXml(result.languages, COPY.cap));
    // kind === "dial" → fall through to the same dial path as calledE164===null
  }
  return xmlResponse(dialXml(calledE164));
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
  return respond(toE164(params.get("To")), toE164(params.get("From")));
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
  return respond(toE164(claimedTo), toE164(claimedFrom));
}

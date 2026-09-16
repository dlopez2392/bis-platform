// The last link in the handoff. Telnyx fetches this when the SECOND dial —
// the one `/api/voice/texml/handoff` placed to the business's own phone —
// ends, because that `<Dial>` carries this URL as its `action`.
//
// Two things happen here and nowhere else:
//
// 1. THE OUTCOME IS DECIDED. A dial that reached a person stamps the call
//    `transferred`; one that rang out leaves the row exactly as `finishCall`
//    wrote it (`abandoned` — from the socket's point of view the caller did
//    leave). Claiming a transfer that did not happen would be a lie on the
//    client's own dashboard, and the dashboard is the only place they can
//    see what this product did for them.
//
// 2. THE CALLER GETS WORDS. They were told seconds ago that they were being
//    put through. If nobody picked up, silence is the one unacceptable
//    ending — so a failed dial SPEAKS, in the profile's language, and only
//    then hangs up.
//
// Like its parent, this route FAILS CLOSED and always answers 200 with valid
// TeXML: an unknown token, a call that never asked, a missing status or any
// thrown error → `<Hangup/>`. A 5xx to Telnyx mid-call is worse than a clean
// hangup — the carrier's own error handling is what the caller would hear,
// and it is not words.
import { NextResponse } from "next/server";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { transferFailedLine } from "@/lib/voice/handoff";

export const runtime = "nodejs";

/**
 * The `DialCallStatus` values that mean A HUMAN WAS ON THE OTHER END.
 *
 * Both of these are in the documented set Telnyx sends on a `<Dial>` action
 * (alongside `busy`, `no-answer`, `failed` and `canceled`). `answered` is
 * here as well as `completed` because treating it as a failure would tell a
 * caller who had just finished talking to the business owner that nobody
 * could be reached, and file the call as abandoned.
 *
 * Everything NOT in this set — including a status nobody here has heard of —
 * is treated as "reached nobody", which fails closed in both directions at
 * once: an unrecognised status is not evidence a person picked up, and it is
 * not a reason to leave a caller listening to nothing either. The cost of
 * being wrong that way is an apology the caller did not need; the cost of the
 * other way is dead air plus a false `transferred` row.
 */
const REACHED_A_PERSON = new Set(["completed", "answered"]);

const HANGUP = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/**
 * `transferFailedLine` is COPY, and copy changes. It carries no `&` today,
 * but the day it gains one — "Mon & Fri", an em dash typed as an entity — the
 * document stops parsing and Telnyx plays the caller its own error handling
 * instead of the sentence. That is exactly how the bridge document broke when
 * a second SIP parameter was joined with a raw `&` (XML 1.0 §2.4), and 130
 * tests stayed green through it. The E164 columns interpolated elsewhere in
 * this directory are safe unescaped because a CHECK constraint bounds them;
 * a sentence is bounded by nothing.
 */
function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The failed-transfer document. ONE `<Say>`, not `sayXml`'s EN-then-ES pair:
 * this sentence answers the `handoffLine` the same caller heard seconds
 * earlier, which takes English on a `both` profile, and the two must match or
 * the caller is told they are being connected in one language and that it
 * failed in another. `language="es-MX"` is what makes the Spanish sound
 * Spanish rather than Spanish words read by an English voice.
 */
function failedXml(languages: "en" | "es" | "both"): string {
  const attr = languages === "es" ? ` language="es-MX"` : "";
  const line = escapeXmlText(transferFailedLine(languages));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say${attr}>${line}</Say><Hangup/></Response>`;
}

/**
 * Nothing in here reads the request. Same rule as the parent route, for the
 * same reason: the ONLY input is the token, the account comes from what the
 * token resolved to, and the write below is scoped by THAT account id.
 */
async function decide(token: string, status: string): Promise<string> {
  // Lazy import: a module-scope DB import breaks `next build` during
  // page-data collection (the documented trap this whole directory obeys).
  const { serviceDb, getCallByHandoffToken, getVoiceProfile, setCallOutcome } = await import("@bis/db");
  const db = serviceDb();

  // 1. The token is the credential, and this lookup is the only source of
  //    tenancy for everything below it.
  const call = await getCallByHandoffToken(db, token);
  if (!call) {
    console.log("handoff-result: no call for this token — hanging up");
    return HANGUP;
  }
  const accountId = call.account_id;

  // 2. The call actually asked for a person. This route holds the ONLY write
  //    in the feature, and with `TELNYX_PUBLIC_KEY` unset (today's state)
  //    anyone who can reach this URL holding a logged token can trigger it.
  //    A call with no `handoff_requested_at` was never handed to anybody, so
  //    stamping it would put a transfer on the client's dashboard that never
  //    happened.
  //
  //    DELIBERATELY NOT the parent route's ten-minute recency gate, and not
  //    any other clock bound. This request fires when the HUMAN conversation
  //    ends, which can be an hour after the caller asked; measuring from
  //    `handoff_requested_at` would hang up on a long, successful transfer
  //    and record it as abandoned. A bound measured from this route's own
  //    fact — the moment the transfer dial started — would be legitimate,
  //    but nothing persists that moment, so there is no honest clock to read.
  if (!call.handoff_requested_at) {
    console.log(`handoff-result: call ${call.id} never asked for a person — hanging up, accountId ${accountId}`);
    return HANGUP;
  }

  if (REACHED_A_PERSON.has(status)) {
    // The caller is on a line whose far end has already hung up; this
    // document only ends our side. No `<Say>`: they just finished a real
    // conversation and an apology now would be nonsense.
    //
    // Its own try/catch. A failure here is the quietest kind this product
    // has — the transfer WORKED, the caller was served, and only the row
    // stays wrong — so it has to be loud in the log and must not turn into
    // the outer catch's anonymous line.
    try {
      await setCallOutcome(db, accountId, call.id, "transferred");
      console.log(`handoff-result: call ${call.id} reached a person (${status}), accountId ${accountId}`);
    } catch (e) {
      console.error(`handoff-result: call ${call.id} transferred but the outcome did not save: ${String(e)}, accountId ${accountId}`);
    }
    return HANGUP;
  }

  // Nobody picked up. Leave the outcome as `finishCall` recorded it and tell
  // the caller the truth.
  console.log(`handoff-result: call ${call.id} reached nobody (${status}), accountId ${accountId}`);
  let languages: "en" | "es" | "both" = "en";
  try {
    const profile = await getVoiceProfile(db, accountId);
    if (profile) languages = profile.languages;
  } catch (e) {
    // Its own try/catch too, and this one is load-bearing: letting it reach
    // the outer catch would turn the wrong LANGUAGE into no words at all,
    // which is the single ending this route exists to prevent.
    console.error(`handoff-result: profile read failed for call ${call.id}, speaking English: ${String(e)}, accountId ${accountId}`);
  }
  return failedXml(languages);
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST — the signature covers the exact raw bytes, and this
  // route reads `DialCallStatus` out of those same bytes rather than calling
  // `req.formData()` afterwards on a consumed body.
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error(`handoff-result: failed to read request body: ${String(e)}`);
  }
  // Identical gate to `/api/voice/texml` and `/api/voice/texml/handoff`,
  // deliberately duplicated rather than inferred, so the three cannot drift
  // when TELNYX_PUBLIC_KEY is finally set (runbook Step 6). Unset today means
  // validation is OFF.
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const timestamp = req.headers.get("telnyx-timestamp");
    const signatureB64 = req.headers.get("telnyx-signature-ed25519");
    if (!timestamp || !signatureB64) {
      console.error("handoff-result: rejected request (missing-headers)");
      return new NextResponse(null, { status: 403 });
    }
    if (!verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey })) {
      console.error("handoff-result: rejected request (invalid-signature)");
      return new NextResponse(null, { status: 403 });
    }
  }

  // The token comes from THIS request's own query string — the one the parent
  // route wrote into the `action` URL. Never from the body, which is the
  // carrier's call-status form and is not ours.
  //
  // Deliberately NOT consumed or cleared at the end of this route, though
  // the end is where one-shot use would belong if it were wanted. Telnyx
  // retries a webhook it could not deliver, and a consumed token would turn
  // that retry into silence on a caller who is still on the line. The replay
  // this would close is bounded already: the stamp is idempotent, it only
  // ever writes `transferred` on a call that genuinely asked for a person,
  // and it is scoped to that call's own account.
  const token = new URL(req.url).searchParams.get("t")?.trim();
  if (!token) {
    console.log("handoff-result: no token on the action URL — hanging up");
    return xmlResponse(HANGUP);
  }

  // Missing status → hang up, and never touch the database. We do not know
  // what happened, so we can neither claim a transfer nor tell the caller
  // nobody answered; both would be inventions.
  const status = new URLSearchParams(rawBody).get("DialCallStatus")?.trim().toLowerCase();
  if (!status) {
    console.log("handoff-result: no DialCallStatus on the callback — hanging up");
    return xmlResponse(HANGUP);
  }

  try {
    // Never log the token itself: unlike a call id or a dialed number, this
    // value IS the authorisation.
    return xmlResponse(await decide(token, status));
  } catch (e) {
    console.error(`handoff-result: failed, hanging up: ${String(e)}`);
    return xmlResponse(HANGUP);
  }
}

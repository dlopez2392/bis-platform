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

/**
 * How long after the caller asked for a person this route will still WRITE.
 *
 * The gate below it (`handoff_requested_at` is set) proves the caller ASKED.
 * It does not prove anyone was DIALLED — the parent route can refuse, on no
 * transfer number, on an own-number loop, or on its own ten-minute expiry —
 * and with `TELNYX_PUBLIC_KEY` unset this route accepts
 * `DialCallStatus=completed` from whoever POSTs it. A token harvested from a
 * carrier or Vercel access log could therefore stamp `transferred` on a call
 * nobody was ever put through on, forever. That is a lie on the client's own
 * dashboard, which is the one place they see what this product did for them.
 *
 * Four hours, and deliberately NOT the parent's ten minutes. This request
 * fires when the HUMAN conversation ENDS, so the legitimate gap is "however
 * long two people talked", plus the handful of seconds before the dial and a
 * carrier retry. The longest realistic transferred conversation for the
 * businesses this serves is under an hour; four clears that several times
 * over, so no real transfer is ever refused, while a leaked token stops being
 * a permanent credential and becomes a same-morning one.
 *
 * It bounds the WRITE ONLY. Past it the caller is still spoken to on a failed
 * dial: a stale stamp costs a wrong row, and silence after "putting you
 * through" is the one ending this route exists to prevent.
 */
const MAX_WRITE_AGE_MS = 4 * 60 * 60_000;

/**
 * Outcomes that OUTRANK `transferred` and are never overwritten by it.
 *
 * The precedence question is real: a caller can book an appointment and THEN
 * ask for a person, which stamps `booked` at socket close and arrives here
 * claiming `transferred`. The rule, decided rather than left to whichever
 * write lands last: an outcome recording what the caller GOT beats one
 * recording where the call WENT. The booking is the thing the client pays for
 * and a transfer afterwards does not undo it; the same holds for a captured
 * lead and a taken message.
 *
 * `transferred` is in the set as itself, which makes a replayed callback — a
 * carrier retry, or the same logged token POSTed four times — a no-op instead
 * of four writes.
 *
 * What it leaves upgradable is `abandoned` and `spam`, and `abandoned` is
 * the case this whole feature exists for: it means "we cannot tell that this
 * caller got anything", which a dial that reached a person corrects. A value
 * outside the six is treated as upgradable too, so an unrecognised outcome
 * never loses a true transfer to nothing. (A row that has VANISHED is a
 * different branch entirely: the token lookup returns null and this route
 * hangs up before it gets here.)
 */
const OUTRANKS_TRANSFERRED = new Set(["booked", "lead", "message", "transferred"]);

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
 *
 * Three entities, not five: `"` and `'` are only special inside an ATTRIBUTE
 * VALUE, and this string is only ever character data between `<Say>` and
 * `</Say>`. The shared `xmlText` at `../xml` escapes all five because every
 * one of ITS callers also feeds an attribute — `action="${...}"`,
 * `callerId="${...}"` — where a quote would end the attribute early. Neither
 * is a subset of the other by accident: the rule is TEXT gets three, ANYTHING
 * THAT CAN LAND IN AN ATTRIBUTE gets five.
 *
 * That third site did arrive (the handoff dial, 2026-09-16), and the advice
 * this comment used to end with was taken: `xmlText` was PROMOTED out of
 * `../route.ts` into `../xml` and is now imported by both dial-emitting
 * routes rather than copied. This function stays separate, and stays three,
 * because its single caller can never be anything but character data.
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
  //    DELIBERATELY NOT the parent route's ten-minute recency gate: this
  //    request fires when the HUMAN conversation ends, which can be most of
  //    an hour after the caller asked, so ten minutes would hang up on a long
  //    successful transfer. The write gets its own, far more generous clock
  //    (`MAX_WRITE_AGE_MS`) below, inside the branch that writes — the SPOKEN
  //    line is bounded by nothing, because words cost nothing to be wrong
  //    about and silence costs everything.
  if (!call.handoff_requested_at) {
    console.log(`handoff-result: call ${call.id} never asked for a person — hanging up, accountId ${accountId}`);
    return HANGUP;
  }

  if (REACHED_A_PERSON.has(status)) {
    // The caller is on a line whose far end has already hung up; this
    // document only ends our side. No `<Say>`: they just finished a real
    // conversation and an apology now would be nonsense.

    // 3. And the ask is recent enough that a dial could plausibly still be
    //    ending. `Number.isFinite` refuses an unreadable stamp for the same
    //    reason the parent route does: a timestamp we cannot read is not one
    //    we can call fresh, and this is the write. A stamp in the future
    //    (clock skew) is treated as fresh — negative age is under the ceiling
    //    — because the alternative punishes a real caller for our clocks.
    const askedAt = Date.parse(call.handoff_requested_at);
    if (!Number.isFinite(askedAt) || Date.now() - askedAt > MAX_WRITE_AGE_MS) {
      console.log(`handoff-result: call ${call.id} reached a person (${status}) too long after the ask to record — hanging up, accountId ${accountId}`);
      return HANGUP;
    }

    // 4. What the row already says decides whether this stamp is an upgrade
    //    or a downgrade — and it came back on the TOKEN LOOKUP above, which
    //    is the only read here that had to happen. It used to come from
    //    `getCall`, a second round trip selecting CALL_DETAIL_COLS: a whole
    //    JSONB transcript and the summary, dragged across the wire to compare
    //    one short string.
    //
    //    THE ONE TRADE, so nobody reads this as free: the old shape re-read
    //    the outcome AFTER the recency gate, making it milliseconds fresher
    //    than a value read at the top of the function. Both shapes are
    //    equally racy against a `finishCall` landing in between — neither
    //    takes a lock — and the precedence set makes a lost race a no-op
    //    either way, because every outcome a late `finishCall` could write is
    //    already in it. The worst case is a row that keeps what `finishCall`
    //    gave it, which is what losing that race is supposed to mean.
    if (OUTRANKS_TRANSFERRED.has(call.outcome)) {
      console.log(`handoff-result: call ${call.id} already recorded ${call.outcome} — leaving it, accountId ${accountId}`);
      return HANGUP;
    }

    // Its own try/catch around the write. A failure here is the quietest kind
    // this product has — the transfer WORKED, the caller was served, and only
    // the row stays wrong — so it has to be loud in the log and must not turn
    // into the outer catch's anonymous line.
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

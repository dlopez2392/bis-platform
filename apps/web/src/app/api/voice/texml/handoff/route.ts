// Telnyx fetches this when the SIP leg to OpenAI ends — it is the `action`
// URL `/api/voice/texml` hangs on its `<Dial>`, and the only reason the
// caller is still connected at all once Sofía's socket has closed. Every
// call therefore arrives here, not just the transferred ones: the ordinary
// end of an ordinary call is this route answering `<Hangup/>`.
//
// THIS ROUTE FAILS CLOSED, and it is the one place in the voice path that
// does. Everywhere else — the daily cap counts, `startCallRow`, this route's
// own parent's DB lookups — a failure fails OPEN, because the worst case
// there is a caller who gets answered when they might not have been. Here
// "open" would mean dialling a number we could not confirm, on the tenant's
// own trunk, at the tenant's own per-minute cost, and possibly belonging to
// someone else entirely. So: an unknown token, a call that never asked, no
// transfer number, a target that is one of this account's own numbers, or
// any thrown error at all → `<Hangup/>`.
//
// It still answers 200 with valid TeXML on every one of those. A 5xx to
// Telnyx mid-call is worse than a clean hangup: the carrier's own error
// handling is what the caller would hear, and it is not words.
import { NextResponse } from "next/server";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { resolveHandoffTarget } from "@/lib/voice/handoff";
import { verifyFallbackTicket } from "@/lib/voice/fallback-ticket";
import { configuredOrigin } from "@/lib/email/origin";
import { stampHeartbeat } from "@/lib/ops/stamp";
import { xmlText } from "../xml";

export const runtime = "nodejs";

/**
 * How long the business's phone rings before we give up on it.
 *
 * NOT a close delay — `CLOSE_AFTER_GOODBYE_MS` (`incoming/route.ts:151`) is
 * how long a last sentence gets to reach the caller before a websocket
 * closes, measured in milliseconds against the model's playout. This is a
 * human being deciding whether to pick up, measured in seconds against a
 * ringing handset. Same-shaped number, unrelated quantity; deriving one from
 * the other would couple two things that must be tuned from different
 * evidence.
 */
const RING_SECONDS = 20;

/**
 * How long the carrier gets to decide whether a person or a machine answered.
 *
 * 2000ms, not the documented 3500ms default, and the reason is a risk rather
 * than a preference: if this `<Dial>`'s detection turns out to run in
 * Telnyx's SYNCHRONOUS mode, the bridge waits for the verdict and the caller
 * hears that wait as silence after the business says "hello". Async is the
 * expectation (see the `<Number>` comment below) but it is not measured, so
 * the worst case is bounded to two seconds instead of three and a half.
 *
 * Raise it toward the default once a real call shows the bridge is NOT
 * delayed — detection accuracy generally improves with more audio, and there
 * is no reason to pay for a shorter window than the vendor recommends if it
 * costs the caller nothing.
 */
const AMD_TIMEOUT_MS = 2000;

/**
 * The CEILING ON THE CONVERSATION. One hour, in seconds.
 *
 * `RING_SECONDS` above bounds the RINGING and stops there. The moment the
 * business picks up, this leg is an ordinary outbound PSTN call on the
 * tenant's own trunk, billed by the minute, and the AI leg's
 * `PHONE_MAX_CALL_SECONDS` (the 240s cost guardrail on the Realtime session)
 * is no longer anywhere in the path. Without `timeLimit` there is no ceiling
 * ON THIS LEG ANYWHERE IN THE PRODUCT: a voicemail greeting that
 * auto-answers, or an IVR that answers and never hangs up, plus a caller who
 * put the phone down and walked away, bills until a carrier times it out.
 * That is not hypothetical — "answered" is exactly what a business voicemail
 * looks like from here (see `handoff-result`), and it is indistinguishable
 * from a person.
 *
 * NOT DERIVED FROM `RING_SECONDS`, deliberately and for the same reason that
 * constant is not derived from `CLOSE_AFTER_GOODBYE_MS`: how long a handset
 * rings before a human gives up and how long two humans then talk are
 * unrelated quantities that move on unrelated evidence. Writing this as a
 * multiple of the ring timeout would mean retuning the ring — which is a UX
 * decision about a caller listening to a ringback — silently retunes a
 * BILLING ceiling.
 *
 * WHY AN HOUR. The value is chosen from what a real transferred conversation
 * costs, from both directions:
 *   * It must never cut a real one off mid-sentence. A caller who was handed
 *     to the owner and is arranging a roof inspection is having the most
 *     valuable conversation this product produces, and dropping it at a
 *     round number would be the platform hanging up on a paying customer
 *     with no explanation. The longest realistic transferred call for the
 *     businesses this serves is minutes, not tens of minutes; the sibling
 *     result route's own four-hour write window rests on the same judgement
 *     ("under an hour"). An hour therefore sits ABOVE every conversation
 *     that will actually happen.
 *   * It must turn "unbounded" into a number somebody can read off an
 *     invoice. An hour of outbound US PSTN is cents, and it is the WORST
 *     case per stuck call rather than the typical one — the typical leg ends
 *     when a person hangs up, long before this.
 * Anything materially tighter starts trading a real customer conversation
 * for a fraction of a cent; anything much looser stops being a ceiling.
 *
 * Telnyx documents the accepted range as 60–14400 seconds. 3600 is inside
 * it, and a value outside it is rejected — which means no dial at all, which
 * means dead air on a caller who was just told "one moment". `route.test.ts`
 * pins the value and the range together for that reason.
 */
const MAX_TRANSFER_SECONDS = 3600;

/**
 * How long after the caller asked for a person this token still opens the
 * door. Ten minutes, and the number is a compromise between two concrete
 * facts, not a round number.
 *
 * Why bounded at all: the token travels in the QUERY STRING of the `action`
 * URL, so it is written to Telnyx's request logs and Vercel's access logs —
 * places the `X-BIS-Handoff` SIP-header copy never reaches. A holder of a
 * logged token can fetch this route and read back the account's private
 * transfer number and one of its owned numbers. They cannot place a call:
 * nothing IN THIS ROUTE writes, and only Telnyx executes the TeXML we return.
 * So the loss here is DISCLOSURE OF A PRIVATE BUSINESS LINE, and until this
 * check it was unbounded in time.
 *
 * THE SAME TOKEN DOES WRITE, one field, in the sibling this route points at,
 * and this comment claimed otherwise until 2026-09-16.
 * `handoff-result` stamps the call `transferred` on a `DialCallStatus` it is
 * simply told, so a holder of a logged token can put a transfer that never
 * happened on the client's dashboard. That route carries its own bounds for
 * it: a four-hour ceiling on the WRITE measured from `handoff_requested_at`,
 * and a refusal to overwrite an outcome that outranks `transferred`, so a
 * replay is a no-op. The two ceilings are deliberately different quantities —
 * ten minutes to DIAL a person, four hours to RECORD a conversation that had
 * to happen first. `TELNYX_PUBLIC_KEY` is unset today, so there is no second
 * gate underneath either of them.
 *
 * Why ten and not two: the legitimate fetch happens seconds after the stamp —
 * Sofía says her line, the socket closes, Telnyx fetches this URL. But the
 * upper bound on the gap is the CALL's own length, not that handful of
 * seconds: if the socket close were ever delayed, the AI leg still runs to
 * `PHONE_MAX_CALL_SECONDS` (≤ 280s, ~4.7 minutes) before Telnyx comes here.
 * Ten minutes clears that worst case with room for a carrier retry, and still
 * turns a permanently-valid logged credential into a ten-minute one. Anything
 * under five would hang up on a real caller.
 *
 * Deliberately NOT single-use, and the token is deliberately NOT cleared:
 * Task 5's result route is pointed at `handoff-result?t=<the same token>`, so
 * consuming it here would break that route before it is written. If one-shot
 * consumption is ever wanted it belongs at the END of the result route.
 */
const MAX_TOKEN_AGE_MS = 10 * 60_000;

/**
 * The `DialCallStatus` values that mean the SIP leg to Sofía NEVER CONNECTED
 * (operational-floor spec §3, the model-down fallback). Telnyx documents the
 * enum — completed, busy, no-answer, canceled, failed — but not which
 * failure produces which value, so this is the set that cannot mean a
 * conversation happened:
 *   - `completed` is excluded: the leg connected, and an ordinary call ends
 *     that way.
 *   - `canceled` is excluded: the CALLER hung up while it rang, and dialling
 *     the business then rings a person for nobody.
 * The spec's "or DialCallDuration of 0" clause is deliberately not used:
 * Telnyx documents that field as conditional, so it can be absent, and a
 * `completed` leg is connected whatever its duration says.
 */
export const NEVER_CONNECTED = new Set(["failed", "busy", "no-answer"]);

const HANGUP = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>`;

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/**
 * The decision, as TeXML. Returns `null` for "hang up" so every refusal in
 * here is one word and the single `<Hangup/>` spelling lives in one place.
 *
 * Nothing in this function reads the request. That is deliberate and it is
 * the tenancy boundary of the whole feature: the ONLY input is the token,
 * the account comes from what the token resolved to, and every read after
 * that is scoped by THAT account id. A transfer that reached a number
 * belonging to a different account would be a real human answering a call
 * they have no relationship with, with no error anywhere.
 */
/**
 * THE MODEL-DOWN FALLBACK (operational-floor spec §3, decision 2): Sofía's
 * line did not connect, so ring the account's transfer number instead of
 * hanging up on the caller.
 *
 * Reached only when the token found NO call row — that row is written by
 * Sofía's own webhook, which never runs when OpenAI is unreachable — and only
 * on a signed ticket the TeXML route wrote for a call EVERY guard cleared
 * (`lib/voice/fallback-ticket.ts`). The ticket is the whole of the tenancy
 * here, exactly as the call row is for a requested handoff: the account and
 * the dialled number come from it and nothing else in the request.
 *
 * What it does NOT do, and why:
 *   - It does not stamp the call `transferred`: there is no call row to
 *     stamp. The record is the `voice.sip_webhook` error heartbeat below,
 *     which is what emails BIS that Sofía was unreachable, plus the log line.
 *   - It does not detect a machine or point a result route at the outcome:
 *     both read the call row, which does not exist.
 *   - It does not run for a webhook that DECLINED the call: the webhook
 *     declines by never accepting, which looks the same from here, but it
 *     runs the same guards the TeXML route already passed before signing the
 *     ticket. A decline after a clearance is the two reads racing, not a
 *     robot slipping through.
 *
 * Stamped as an error whether or not a transfer number exists: the outage is
 * Sofía being unreachable, and BIS needs to hear about it either way.
 */
async function modelDownFallback(
  token: string, ticketRaw: string | null, dialStatus: string | null,
): Promise<string | null> {
  if (!dialStatus || !NEVER_CONNECTED.has(dialStatus)) {
    console.log("handoff: no call for this token — hanging up");
    return null;
  }
  const ticket = verifyFallbackTicket(ticketRaw, token, Date.now());
  if (!ticket.ok) {
    console.log(`handoff: Sofía's leg did not connect (${dialStatus}) and there is no usable fallback ticket (${ticket.reason}) — hanging up`);
    return null;
  }
  const accountId = ticket.accountId;
  stampHeartbeat("voice.sip_webhook", { ok: false, error: `Sofia's line did not connect (DialCallStatus ${dialStatus})` });

  const { serviceDb, getTransferPhone, listPhoneNumbersForAccount, getPhoneNumberByE164 } = await import("@bis/db");
  const db = serviceDb();
  const [transferPhone, ownedRows] = await Promise.all([
    getTransferPhone(db, accountId),
    listPhoneNumbersForAccount(db, accountId),
  ]);
  const usable = ownedRows.filter((n) => n.status === "testing" || n.status === "live");
  const target = resolveHandoffTarget(transferPhone, usable.map((n) => n.e164));
  if (!target.available) {
    console.log(`handoff: Sofía's leg did not connect (${dialStatus}) and there is no transfer target (${target.reason}) — hanging up, accountId ${accountId}`);
    return null;
  }
  // ANY BIS line, not only this account's: while Sofía is down for everyone,
  // two accounts whose transfer numbers are each other's lines would hand a
  // caller back and forth through this fallback. A number we own is never
  // a person's phone.
  if (await getPhoneNumberByE164(db, target.to)) {
    console.log(`handoff: Sofía's leg did not connect (${dialStatus}) and the transfer number is a BIS line — hanging up, accountId ${accountId}`);
    return null;
  }
  // The number the caller dialled, when it is still one of this account's
  // usable lines; otherwise the same live-then-testing fallback the
  // requested handoff uses below, for the same reason (Telnyx refuses a
  // caller id we do not own).
  const callerId = (usable.find((n) => n.e164 === ticket.calledE164)
    ?? usable.find((n) => n.status === "live")
    ?? usable.find((n) => n.status === "testing"))?.e164 ?? null;
  const cid = callerId ? ` callerId="${xmlText(callerId)}"` : "";
  console.log(`handoff: Sofía's leg did not connect (${dialStatus}) — ringing the transfer number instead, accountId ${accountId}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial${cid} timeout="${RING_SECONDS}" timeLimit="${MAX_TRANSFER_SECONDS}" passDiversionHeader="true">${xmlText(target.to)}</Dial></Response>`;
}

async function decide(
  token: string, origin: string, ticketRaw: string | null = null, dialStatus: string | null = null,
): Promise<string | null> {
  // Lazy import: a module-scope DB import breaks `next build` during
  // page-data collection (the documented trap this whole directory obeys).
  const {
    serviceDb, getCallByHandoffToken, getTransferPhone, listPhoneNumbersForAccount,
  } = await import("@bis/db");
  const db = serviceDb();

  // 1. The token is the credential. This lookup is deliberately not
  //    account-scoped (see its doc comment in packages/db/src/voice.ts) —
  //    which is exactly why its result is the ONLY source of tenancy below.
  const call = await getCallByHandoffToken(db, token);
  if (!call) return modelDownFallback(token, ticketRaw, dialStatus);
  const accountId = call.account_id;

  // 2. The token says WHICH call; `handoff_requested_at` says the caller
  //    actually asked. Every call carries a token, so without this check
  //    every ordinary hangup would dial the business.
  if (!call.handoff_requested_at) {
    console.log(`handoff: call ${call.id} never asked for a person — hanging up, accountId ${accountId}`);
    return null;
  }

  // 3. And they asked RECENTLY. Everything past this point discloses the
  //    account's transfer number, so the gate sits above those reads, not
  //    next to the dial. `Number.isFinite` catches an unparseable stamp and
  //    refuses it: this route fails closed, and a timestamp we cannot read is
  //    not a timestamp we can call fresh. A stamp in the future (clock skew
  //    between the writer and this reader) is treated as fresh — negative age
  //    is under the ceiling — because the alternative punishes the caller for
  //    our own clocks.
  const askedAt = Date.parse(call.handoff_requested_at);
  if (!Number.isFinite(askedAt) || Date.now() - askedAt > MAX_TOKEN_AGE_MS) {
    console.log(`handoff: call ${call.id}'s request is too old to act on — hanging up, accountId ${accountId}`);
    return null;
  }

  // 4. Both reads scoped to the account the token resolved to, together —
  //    the caller is holding a silent line while this runs.
  //
  //    Owned numbers come from `listPhoneNumbersForAccount` filtered here to
  //    `testing`/`live`, NOT from `resolveSmsSender`: that helper returns no
  //    list at all for an account holding only a `testing` number, which is
  //    the shape of every account still walking the setup wizard, and the
  //    own-number loop guard would then silently not run for precisely the
  //    accounts this feature is first tried on. `incoming/route.ts:799-813`
  //    makes the same choice for the same reason.
  const [transferPhone, ownedRows] = await Promise.all([
    getTransferPhone(db, accountId),
    listPhoneNumbersForAccount(db, accountId),
  ]);
  const usable = ownedRows.filter((n) => n.status === "testing" || n.status === "live");
  const owned = usable.map((n) => n.e164);
  const target = resolveHandoffTarget(transferPhone, owned);
  if (!target.available) {
    console.log(`handoff: no target for call ${call.id} (${target.reason}) — hanging up, accountId ${accountId}`);
    return null;
  }

  // `callerId` is THE NUMBER THIS CALLER DIALLED — `calls.phone_number_id`,
  // which is the only place that fact survives (the design says so twice:
  // 2026-09-15-call-handoff-design.md:126 and :197-199, "the business sees
  // the BIS number that was dialled"). Not "any number this account owns":
  // an account with two live numbers would show its staff the first one in
  // the list, a number that account's customers never call, on a call that
  // came in on the second.
  //
  // It is still always one of OUR numbers, never the original caller's —
  // Telnyx requires an owned number on the outbound leg (the same constraint
  // `forwardXml` documents at texml/route.ts:182-184), which is why the
  // dialled row must ALSO be testing/live here: a number since released or
  // moved to another account is not ours to present, and Telnyx rejects the
  // leg, which is dead air. The list is the fallback for exactly that case,
  // live preferred over testing. Omitted rather than faked when there is
  // nothing at all — an account with no numbers cannot have received this
  // call, so that is belt-and-braces.
  const dialled = usable.find((n) => n.id === call.phone_number_id);
  const callerId = (dialled
    ?? usable.find((n) => n.status === "live")
    ?? usable.find((n) => n.status === "testing"))?.e164 ?? null;
  if (!callerId) {
    console.log(`handoff: dialling call ${call.id} with no owned caller id, accountId ${accountId}`);
  }
  const cid = callerId ? ` callerId="${xmlText(callerId)}"` : "";
  // `action` again, for the same reason the bridge carried one: the caller is
  // still ours after this dial ends, whether the business answered or not.
  // Task 5 owns what that route says.
  const result = `${origin}/api/voice/texml/handoff-result?t=${encodeURIComponent(token)}`;
  console.log(`handoff: dialling a person for call ${call.id}, accountId ${accountId}`);
  // `xmlText` on all three interpolated values — the SHARED escaper from
  // `../xml`, the same one the bridge uses, promoted out of `texml/route.ts`
  // rather than copied. Its comment there made the case for the action URL
  // already ("one appended query parameter away from the same one") and this
  // document did not get the lesson until 2026-09-16.
  //
  // All three are safe TODAY and that is precisely the trap: `origin` carries
  // one query parameter and `configuredOrigin()` strips only trailing slashes
  // so it would pass a second through verbatim; `target.to` and `callerId`
  // are E164 columns a CHECK constraint bounds, which bounds the COLUMN and
  // not this function (`resolveHandoffTarget` passes its argument through
  // untouched). An unescaped `&` or `"` here is not a wrong number — it is a
  // document Telnyx cannot parse, which is dead air on a caller who was just
  // told they are being put through.
  // THE NUMBER IS A `<Number>` ELEMENT NOW, NOT A BARE TEXT CHILD, and the
  // restructure is the price of asking the carrier what picked up.
  // `machineDetection` is an attribute of the NOUN — Telnyx documents it on
  // `<Number>` and `<Sip>`, not on `<Dial>` — so there is no way to enable
  // detection without wrapping the number. Every `<Dial>` attribute above is
  // untouched and stays exactly where it was; `handoff-dial-shape.test.ts`
  // pins all five, because this markup cost two production failures to get
  // right and a silent drop of `action` or `timeLimit` would undo one of them.
  //
  // NOTHING READS THE RESULT (0038). It is written to
  // `calls.transfer_answered_by` and ignored by the outcome stamp, the
  // text-back gate and the summary alike. The reason is the direction of the
  // error: a false `machine` would record a real conversation as a failed
  // transfer and text somebody "Sorry we missed you just now" minutes after
  // they spoke to a person — the sharpest failure this design has. So the
  // detection gets measured against real calls before it is allowed to decide
  // anything.
  //
  // ⚠️ THE ONE THING THIS COULD CHANGE FOR A CALLER, STATED PLAINLY BECAUSE IT
  // IS NOT SETTLED. Telnyx documents a SYNCHRONOUS AMD mode in which the
  // TeXML "is not executed until the results of AMD process are provided",
  // and an ASYNCHRONOUS one that runs in parallel. That distinction is
  // documented for the REST API's `AsyncAmd` parameter; for the `<Dial>` verb
  // the docs describe `amd` as a `statusCallbackEvent`, and an event
  // NOTIFICATION does not block. So async is the expectation — but it is an
  // expectation, not a measurement.
  //   IF IT IS ACTUALLY SYNCHRONOUS, the caller hears silence after the
  //   business picks up, for up to `machineDetectionTimeout`. That is why the
  //   timeout below is 2000ms rather than the 3500ms default: it bounds the
  //   worst case to something survivable while the question is open.
  //   THE TELL IS A PAUSE BETWEEN "hello?" AND THE CALLER HEARING IT. If that
  //   is reported, delete the three AMD attributes — the `<Number>` wrapper
  //   is harmless on its own — and the dial goes back to exactly what shipped
  //   in #84.
  //
  // `xmlText` on every interpolated value, for the reason the paragraph above
  // gives: the status-callback URL is one appended query parameter away from
  // the bug this file already fixed once.
  const amd = `${origin}/api/voice/texml/handoff-amd?t=${encodeURIComponent(token)}`;
  const number =
    `<Number machineDetection="Enable" machineDetectionTimeout="${AMD_TIMEOUT_MS}"`
    + ` statusCallback="${xmlText(amd)}" statusCallbackEvent="amd" statusCallbackMethod="POST">`
    + `${xmlText(target.to)}</Number>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial${cid} timeout="${RING_SECONDS}" timeLimit="${MAX_TRANSFER_SECONDS}" passDiversionHeader="true" action="${xmlText(result)}" method="POST">${number}</Dial></Response>`;
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST — the signature covers the exact raw bytes. Guarded the
  // same way the parent route guards it: a body-read failure is an empty
  // body, which with the key set fails the signature check (403) and with
  // the key unset changes nothing, because this route reads its only input
  // from the query string.
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error(`handoff: failed to read request body: ${String(e)}`);
  }
  // Identical gate to `/api/voice/texml`'s POST, deliberately duplicated
  // rather than inferred, so the two cannot drift when TELNYX_PUBLIC_KEY is
  // finally set (runbook Step 6). Unset today means validation is OFF.
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const timestamp = req.headers.get("telnyx-timestamp");
    const signatureB64 = req.headers.get("telnyx-signature-ed25519");
    if (!timestamp || !signatureB64) {
      console.error("handoff: rejected request (missing-headers)");
      return new NextResponse(null, { status: 403 });
    }
    if (!verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey })) {
      console.error("handoff: rejected request (invalid-signature)");
      return new NextResponse(null, { status: 403 });
    }
  }

  // The token comes from THIS request's own query string — the one we wrote
  // into the `action` URL ourselves. Never from the body, which is the
  // carrier's call-status form and is not ours.
  const query = new URL(req.url).searchParams;
  const token = query.get("t")?.trim();
  if (!token) {
    console.log("handoff: no token on the action URL — hanging up");
    return xmlResponse(HANGUP);
  }

  try {
    // Never log the token itself: unlike a call id or a dialed number, this
    // value IS the authorisation.
    // The carrier's status decides only WHETHER the fallback may run; who it
    // rings comes from the signed ticket. The status itself is signed only
    // once TELNYX_PUBLIC_KEY is set (unset today): until then a holder of a
    // logged action URL can claim `failed` for its ten minutes and read back
    // the transfer number — the same disclosure, and the same window, the
    // handoff token already documents above (MAX_TOKEN_AGE_MS).
    const dialStatus = new URLSearchParams(rawBody).get("DialCallStatus")?.trim().toLowerCase() || null;
    const xml = await decide(token, configuredOrigin() ?? new URL(req.url).origin, query.get("f"), dialStatus);
    return xmlResponse(xml ?? HANGUP);
  } catch (e) {
    console.error(`handoff: failed, hanging up rather than dialling: ${String(e)}`);
    return xmlResponse(HANGUP);
  }
}

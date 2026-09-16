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
import { configuredOrigin } from "@/lib/email/origin";

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
async function decide(token: string, origin: string): Promise<string | null> {
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
  if (!call) {
    console.log("handoff: no call for this token — hanging up");
    return null;
  }
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
  const cid = callerId ? ` callerId="${callerId}"` : "";
  // `action` again, for the same reason the bridge carried one: the caller is
  // still ours after this dial ends, whether the business answered or not.
  // Task 5 owns what that route says.
  const result = `${origin}/api/voice/texml/handoff-result?t=${encodeURIComponent(token)}`;
  console.log(`handoff: dialling a person for call ${call.id}, accountId ${accountId}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial${cid} timeout="${RING_SECONDS}" passDiversionHeader="true" action="${result}" method="POST">${target.to}</Dial></Response>`;
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
  const token = new URL(req.url).searchParams.get("t")?.trim();
  if (!token) {
    console.log("handoff: no token on the action URL — hanging up");
    return xmlResponse(HANGUP);
  }

  try {
    // Never log the token itself: unlike a call id or a dialed number, this
    // value IS the authorisation.
    const xml = await decide(token, configuredOrigin() ?? new URL(req.url).origin);
    return xmlResponse(xml ?? HANGUP);
  } catch (e) {
    console.error(`handoff: failed, hanging up rather than dialling: ${String(e)}`);
    return xmlResponse(HANGUP);
  }
}

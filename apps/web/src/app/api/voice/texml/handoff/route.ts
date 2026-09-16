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

  // 3. Both reads scoped to the account the token resolved to, together —
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
  const owned = ownedRows
    .filter((n) => n.status === "testing" || n.status === "live")
    .map((n) => n.e164);
  const target = resolveHandoffTarget(transferPhone, owned);
  if (!target.available) {
    console.log(`handoff: no target for call ${call.id} (${target.reason}) — hanging up, accountId ${accountId}`);
    return null;
  }

  // `callerId` is one of OUR numbers, never the original caller's: Telnyx
  // requires an owned number on the outbound leg (the same constraint
  // `forwardXml` documents at texml/route.ts:182-184). A live number is
  // preferred over a testing one so the business sees the number its
  // customers know. Omitted rather than faked when there is none — an
  // account with no numbers cannot have received this call in the first
  // place, so this is belt-and-braces, but a wrong callerId is a rejected
  // dial and dead air.
  const callerId = (ownedRows.find((n) => n.status === "live")
    ?? ownedRows.find((n) => n.status === "testing"))?.e164 ?? null;
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

// Telnyx's answering-machine verdict on the transferred leg — written down,
// acted on by nothing.
//
// 0037's spec says a voicemail "reads as a human, and cannot be told apart...
// nothing in the carrier payload distinguishes them". That is wrong, and
// three real calls on 2026-09-17 are why it matters: a transfer to a number
// whose voicemail answers comes back `completed`, gets stamped `transferred`,
// counts as the best outcome the product has, and suppresses the missed-call
// text-back. The caller reached a machine; the business is told they reached
// a person. Telnyx has offered detection all along — we never asked.
//
// SO THIS ROUTE OBSERVES AND NOTHING ELSE. It writes
// `calls.transfer_answered_by` (0038) and changes no decision anywhere: not
// the outcome stamp, not the text-back gate, not the summary.
//
// The reason is the DIRECTION of the error, and it is worth being explicit
// about because "just use the detection" is the obvious move. A false `human`
// costs nothing we are not already paying — that is today's behaviour. A
// false `machine` would record a real conversation as a failed transfer and
// text somebody "Sorry we missed you just now" minutes after they finished
// speaking to a person. That is the sharpest failure in this product's
// design, the one the whole handoff feature exists to prevent, and it is not
// a risk to take on a vendor's reputation. Measure on real calls, compare
// against what actually happened, then let something read the column.
import { NextResponse } from "next/server";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";

export const runtime = "nodejs";

/**
 * ⚠️ AN EMPTY BODY, AND NEVER TeXML. This is the one thing about this route
 * that could hurt a caller, so it is the first thing in the file.
 *
 * Telnyx documents a SYNCHRONOUS detection mode in which "the TeXML
 * instructions are not executed until the results of AMD process are
 * provided" and "the new instructions can be sent back as response to be
 * processed by the TeXML engine". We believe this `<Dial>` runs the
 * ASYNCHRONOUS mode, where the response is ignored — but that is an
 * expectation, not a measurement.
 *
 * If it is synchronous, then whatever this route returns becomes the call.
 * `<Response/>` would be an instruction list with nothing in it, which is a
 * hangup on a caller mid-transfer. So: no XML at all. There is no document
 * here for either mode to execute, and the call carries on exactly as it
 * would have without this route existing.
 *
 * 200 rather than 204 because a webhook sender that treats an unexpected
 * status as a delivery failure will retry, and a retry storm against a route
 * that writes to the calls table is worth not inviting.
 */
function ack(): NextResponse {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST — the signature covers the exact raw bytes, and the
  // verdict is parsed out of those same bytes rather than calling formData()
  // afterwards on a consumed body. Same shape as the three routes next door.
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error(`handoff-amd: failed to read request body: ${String(e)}`);
  }

  // Identical gate to `/api/voice/texml`, `/handoff` and `/handoff-result`,
  // deliberately duplicated rather than shared, so the four cannot drift when
  // TELNYX_PUBLIC_KEY is finally set (runbook Step 6). Unset today means
  // validation is OFF.
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const timestamp = req.headers.get("telnyx-timestamp");
    const signatureB64 = req.headers.get("telnyx-signature-ed25519");
    if (!timestamp || !signatureB64) {
      console.error("handoff-amd: rejected request (missing-headers)");
      return new NextResponse(null, { status: 403 });
    }
    if (!verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey })) {
      console.error("handoff-amd: rejected request (invalid-signature)");
      return new NextResponse(null, { status: 403 });
    }
  }

  // The token is from THIS request's query string — the one the handoff route
  // wrote into `statusCallback`. Never from the body, which is the carrier's
  // form and is not ours.
  const token = new URL(req.url).searchParams.get("t")?.trim();
  if (!token) {
    console.log("handoff-amd: no token on the callback URL — nothing to record");
    return ack();
  }

  // `AnsweredBy` is where Telnyx puts the verdict. Read raw and stored raw:
  // the documented values are `human`, `machine_start`, `fax` and `unknown`
  // for Enable mode, plus the three `machine_end_*` for DetectMessageEnd —
  // but the whole point of this phase is to find out what actually arrives,
  // so an unanticipated value must reach the column rather than be mapped to
  // something familiar on the way in. 0038 leaves the column unconstrained
  // for the same reason.
  const answeredBy = new URLSearchParams(rawBody).get("AnsweredBy")?.trim();
  if (!answeredBy) {
    console.log("handoff-amd: callback carried no AnsweredBy — nothing to record");
    return ack();
  }

  // EVERY failure below is swallowed. This route is a notebook, not a
  // decision: a call in progress must never be affected by a write that did
  // not land, and there is nothing a 5xx would buy — Telnyx would retry into
  // the same database.
  try {
    // Lazy import: a module-scope DB import breaks `next build` during
    // page-data collection, the rule this whole directory obeys.
    const { serviceDb, getCallByHandoffToken, setTransferAnsweredBy } = await import("@bis/db");
    const db = serviceDb();
    const call = await getCallByHandoffToken(db, token);
    if (!call) {
      console.log("handoff-amd: no call for this token — nothing to record");
      return ack();
    }
    // The account the TOKEN resolved to, never one from the request. The
    // token is the credential here exactly as it is for the other two routes.
    await setTransferAnsweredBy(db, call.account_id, call.id, answeredBy);
    // Logged as well as stored, and at a level that shows up: for the length
    // of the observe-only phase this line is how the detection gets compared
    // against what really happened on the call.
    console.log(
      `handoff-amd: call ${call.id} answered by "${answeredBy}", accountId ${call.account_id}`,
    );
  } catch (e) {
    console.error(`handoff-amd: could not record the verdict for token: ${String(e)}`);
  }
  return ack();
}

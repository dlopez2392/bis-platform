// The press-1 screen's action URL. `/api/voice/texml` asked a first-time
// caller to press 1 (`<Gather action=…>`, lib/voice/call-screen.ts); Telnyx
// sends the result here and plays whatever TeXML comes back.
//
// THREE ANSWERS, and which failures land on which is the whole design:
//   - "1": the bridge to Sofía, built by the main route's own `answer()` with
//     the screen skipped — every guard re-checked, the per-account forward
//     honoured, a fresh handoff token, the SIP signature and the fallback
//     ticket minted exactly as on any other call. One copy of the markup.
//   - Nothing, or another key, on an otherwise clean request: the goodbye and
//     a hang-up. This is the decline the screen exists for, and it never
//     reaches the SIP webhook, so no `calls` row is started and no AI minutes
//     are spent.
//   - Anything broken — no called number, a keypress value that is not a key,
//     a body that could not be read, any throw: THE BRIDGE. A real customer
//     hung up on is worse than a robocall getting through, and the SIP
//     webhook still gates every bridged call.
//
// WHAT THE REQUEST CARRIES (Telnyx's TeXML Gather callback,
// https://developers.telnyx.com/api-reference/callbacks/texml-gather): a
// form-urlencoded body, signed like every other TeXML request, with `To` and
// `From` documented as required and `Digits` "only present when input is
// dtmf". So a request with a called number and no `Digits` is read as "pressed
// nothing". That `To`/`From` really arrive on this callback is Telnyx's
// documentation, not something a call here has shown yet — a request without
// `To` bridges rather than guesses.
//
// The query string carries `l` (languages, for the goodbye) and `a` (the
// account id, for log lines). The Telnyx signature does not cover the query
// string, so neither is trusted for anything that matters: a wrong `l` changes
// the goodbye's language, a wrong `a` changes a log line, and the keypress
// path ignores both and re-resolves the account itself.
import { NextResponse } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import { actionOrigin, answer, bridgeAfterFailure, screenGoodbyeXml, type Languages } from "../route";
import { logFormFields, readTelnyxForm } from "../telnyx-request";

export const runtime = "nodejs";

/** One DTMF key. With `numDigits="1"` a real keypress is exactly one of these. */
const ONE_KEY = /^[0-9*#]$/;
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function languagesOf(raw: string | null): Languages {
  return raw === "es" || raw === "both" ? raw : "en";
}

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

/**
 * `fields` is where Telnyx put the keypress and the numbers: the signed body
 * on a POST, the query string on a GET. `query` is the action URL we wrote.
 */
async function decide(
  fields: URLSearchParams, query: URLSearchParams, origin: string, authenticated: boolean,
): Promise<NextResponse> {
  const calledE164 = e164Of(fields.get("To") || null);
  const callerE164 = e164Of(fields.get("From") || null);
  try {
    const rawAccount = query.get("a") ?? "";
    const accountLabel = ACCOUNT_ID.test(rawAccount) ? rawAccount : "unknown";
    const who = `for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${accountLabel}`;
    if (!calledE164) {
      console.log("texml screen: no called number on the keypress request — bridging");
      return await answer(null, callerE164, origin, authenticated, { skipScreen: true });
    }
    const digits = (fields.get("Digits") ?? "").trim();
    if (digits === "1") {
      console.log(`texml screen passed ${who}`);
      return await answer(calledE164, callerE164, origin, authenticated, { skipScreen: true });
    }
    if (digits === "" || ONE_KEY.test(digits)) {
      // The decline. Log only for now: `screened_calls.reason` is a closed
      // set (0039's CHECK), and a reason for this lands in its own migration
      // once the screen has been heard on a real call.
      console.log(`texml screen declined (${digits === "" ? "no-keypress" : "wrong-key"}) ${who}`);
      return xmlResponse(screenGoodbyeXml(languagesOf(query.get("l"))));
    }
    // Not a key at all. Never echoed: it is request input.
    console.log(`texml screen: the keypress value is not a key — bridging ${who}`);
    return await answer(calledE164, callerE164, origin, authenticated, { skipScreen: true });
  } catch (e) {
    console.error(`texml screen failed — bridging for ${calledE164 ?? "unknown"}: ${String(e)}`);
    return bridgeAfterFailure(calledE164, callerE164, origin, authenticated);
  }
}

/**
 * Telnyx sends a `<Gather>` action with the TeXML application's own method
 * (the Gather docs list no `method` attribute). GET therefore mirrors the main
 * route's: closed (405) once TELNYX_PUBLIC_KEY is set, because a GET carries
 * no signed body; answered without it, where nothing is authenticated anyway.
 */
export async function GET(req: Request): Promise<NextResponse> {
  if (process.env.TELNYX_PUBLIC_KEY?.trim()) return new NextResponse(null, { status: 405 });
  const query = new URL(req.url).searchParams;
  return decide(query, query, actionOrigin(req), false);
}

export async function POST(req: Request): Promise<NextResponse> {
  const read = await readTelnyxForm(req, "texml screen");
  if (!read.ok) return read.response;
  logFormFields("texml screen", read.form);
  return decide(read.form, new URL(req.url).searchParams, actionOrigin(req), read.authenticated);
}

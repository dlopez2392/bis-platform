import { serviceDb } from "@bis/db";
import { readUnsubscribeToken, recordUnsubscribe } from "@/lib/consent/unsubscribe";
import { loggableError } from "@/lib/loggable-error";

/**
 * The RFC 8058 one-click target (spec §4.3; plan X1, X2): the URL in every
 * customer email's List-Unsubscribe header. A mail client POSTs
 * "List-Unsubscribe=One-Click" here with no cookies; the token is the proof.
 * 200 with an empty body, never a redirect (X2: redirected POSTs turn into
 * GETs). 400 for a token that does not open; 503 when it could not be
 * recorded (no secret, or the ledger write failed), so the client may retry.
 * Public: proxy.ts protects only /dashboard (proxy.test.ts). Never logs the
 * token.
 */
export const dynamic = "force-dynamic";

const EMPTY = { "Cache-Control": "no-store" };

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const read = readUnsubscribeToken(token);
  if (!read.ok) {
    if (read.why === "not_configured") {
      console.error("one-click unsubscribe refused: CONSENT_TOKEN_SECRET is not set");
      return new Response(null, { status: 503, headers: EMPTY });
    }
    return new Response(null, { status: 400, headers: EMPTY });
  }
  try {
    await recordUnsubscribe(serviceDb(), read.payload, "one_click");
  } catch (e) {
    console.error(`one-click unsubscribe for account ${read.payload.a} not recorded: ${loggableError(e)}`);
    return new Response(null, { status: 503, headers: EMPTY });
  }
  return new Response(null, { status: 200, headers: EMPTY });
}

/** A client that opens the header URL instead of POSTing lands on the page (G6). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: new URL(`/u/${token}`, req.url).toString(), ...EMPTY } });
}

import { turnBriefOff } from "@/lib/brief/off";

/**
 * The daily brief's RFC 8058 one-click target (plan D7): the URL in the brief's List-Unsubscribe header. A mail
 * client POSTs "List-Unsubscribe=One-Click" here with no cookies; the signed token is the proof. 200 with an empty
 * body, never a redirect (a redirected POST becomes a GET); 400 for a token that does not open; 503 when it could
 * not be recorded (no secret, or the write failed), so the client may retry. Idempotent. Mirrors
 * /api/unsubscribe/[token]. Public: proxy.ts protects only /dashboard.
 *
 * GET never deletes. A mail scanner or a link prefetcher opens every URL in a message; it is redirected to the
 * page, whose button is what turns the brief off.
 */
export const dynamic = "force-dynamic";

const EMPTY = { "Cache-Control": "no-store" };

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const result = await turnBriefOff(token);
  if (result === "off") return new Response(null, { status: 200, headers: EMPTY });
  return new Response(null, { status: result === "bad_link" ? 400 : 503, headers: EMPTY });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: new URL(`/brief/off/${token}`, req.url).toString(), ...EMPTY } });
}

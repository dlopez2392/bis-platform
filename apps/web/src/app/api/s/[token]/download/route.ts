import { NextResponse } from "next/server";
import { serviceDb } from "@bis/db";
import { clientIp, hashIp } from "@/lib/forms/guards";
import { shareDownload } from "@/lib/document-shares/public-share";
import { loggableError } from "@/lib/loggable-error";

/**
 * POST /api/s/<token>/download (spec 4.2): no sign-in; the token is the proof (public-share.ts proves it
 * before anything else is read). Rate-limited per link and per address with the forms limiter's own
 * address hash. Never cached, never indexed, never sends a Referer on; never logs the token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let ipHash: string;
  try {
    ipHash = hashIp(clientIp(req.headers));
  } catch (e) {
    console.error(`document share download: no address key: ${loggableError(e)}`);
    return NextResponse.json({ error: "failed" }, { status: 503, headers: HEADERS });
  }
  const r = await shareDownload(serviceDb(), token, ipHash, new Date());
  return NextResponse.json(r.body, { status: r.status, headers: HEADERS });
}

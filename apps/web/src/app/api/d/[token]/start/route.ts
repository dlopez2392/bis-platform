import { NextResponse } from "next/server";
import { serviceDb } from "@bis/db";
import { customerStart } from "@/lib/document-requests/customer-upload";

/**
 * POST /api/d/<token>/start (spec 4.4): no sign-in; the token is the proof (customer-upload.ts proves
 * it before anything else is read). Never cached, never logs the token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  const r = await customerStart(serviceDb(), token, body, new Date());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

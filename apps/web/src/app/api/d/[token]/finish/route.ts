import { NextResponse } from "next/server";
import { serviceDb } from "@bis/db";
import { customerFinish } from "@/lib/document-requests/customer-upload";

/**
 * POST /api/d/<token>/finish (spec 4.4): no sign-in; the token is the proof (customer-upload.ts proves
 * it, then that the document is this request's). Never cached, never logs the token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // the finish waits for the scan (2a: up to 30 s)
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  const r = await customerFinish(serviceDb(), token, body, new Date());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

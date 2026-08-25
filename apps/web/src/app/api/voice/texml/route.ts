// Telnyx hits this for every inbound call on any client number and we answer
// with TeXML that bridges the call to the platform's OpenAI SIP connector.
// Telnyx TELLS US the dialed number (To param) — the SIP leg to OpenAI does
// not reliably carry it — so we smuggle it onto the SIP URI as X-BIS-Called.
// URI ?X-headers ride the INVITE and surface in the webhook's sip_headers.
// A number we don't know (or one not testing/live) gets a POLITE spoken
// refusal, never a crash and never another tenant's greeting (spec §7). A DB
// failure fails OPEN and dials — the webhook resolver still gates.
import { NextResponse } from "next/server";
import { toE164 } from "@/lib/voice/phone-number";

export const runtime = "nodejs";

const REFUSAL = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Sorry, this number can't take your call right now. Please try again later.</Say><Hangup/></Response>`;

async function isRoutable(calledE164: string): Promise<boolean | null> {
  // Lazy import: a module-scope DB import here breaks `next build` during
  // page-data collection (the demo's documented trap). null = lookup failed.
  try {
    const { serviceDb, getPhoneNumberByE164 } = await import("@bis/db");
    const row = await getPhoneNumberByE164(serviceDb(), calledE164);
    return !!row && (row.status === "testing" || row.status === "live");
  } catch (e) {
    console.error(`texml lookup failed for ${calledE164}: ${String(e)}`);
    return null; // fail open
  }
}

function dialXml(calledE164: string | null): string {
  const projectId = process.env.VOICE_OPENAI_PROJECT_ID;
  if (!projectId) {
    // Speak the misconfig: a broken deploy should be audible on a test call,
    // never silent dead air (demo lesson).
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Configuration error: the project identifier is not set.</Say><Hangup/></Response>`;
  }
  const base = `sip:${projectId}@sip.api.openai.com;transport=tls`;
  const uri = calledE164 ? `${base}?X-BIS-Called=${encodeURIComponent(calledE164)}` : base;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Dial answerOnBridge="true"><Sip>${uri}</Sip></Dial></Response>`;
}

function xmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function respond(calledE164: string | null): Promise<NextResponse> {
  if (calledE164) {
    const routable = await isRoutable(calledE164);
    if (routable === false) return xmlResponse(REFUSAL);
    // true → dial; null (lookup failed) → fail open, dial
  }
  return xmlResponse(dialXml(calledE164));
}

export async function GET(req: Request): Promise<NextResponse> {
  const to = new URL(req.url).searchParams.get("To");
  return respond(toE164(to));
}

export async function POST(req: Request): Promise<NextResponse> {
  let to: string | null = null;
  try {
    const form = await req.formData();
    to = String(form.get("To") ?? "") || null;
  } catch { /* fall through — still dial */ }
  return respond(toE164(to));
}

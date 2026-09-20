import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceDb, getPublishedFormByPublicId } from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { fileLead, trimValue } from "@/lib/forms/intake";
import { hashIp } from "@/lib/forms/guards";

/**
 * Machine intake for a published form — a second front door onto the same
 * pipeline the public form page runs.
 *
 * WHY IT EXISTS. bis-rgv.com's AI assistant captured leads in conversation
 * and, until this route, they went to the website's own legacy table and an
 * email — never to the CRM. The public form's server action cannot take them
 * (render token, honeypot, fill-time floor: browser guards). This route takes
 * JSON from a trusted server instead and hands it to `fileLead`, which does
 * exactly what the action does after its guards: one submission row, then
 * `enrich`.
 *
 * TRUST. A shared secret, `LEAD_INTAKE_SECRET`, compared in constant time —
 * the same contract as the cron route. Unset → 503 and zero queries, so an
 * unconfigured deployment can never be an open write path.
 *
 * SUNSET. The website assistant is moving onto the platform itself
 * (`api/assistant/[publicId]/chat`), where its `capture_lead` tool calls
 * `fileLead` directly with no secret in between. Once bis-rgv.com loads the
 * platform's widget this route has no caller and is removed.
 */
export const maxDuration = 30;
const MAX_BODY_BYTES = 32_768;

interface IntakeBody {
  locale?: unknown;
  answers?: unknown;
  attribution?: unknown;
  source?: unknown;
}

function authorized(header: string | null, secret: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  // Length is checked first — timingSafeEqual throws on mismatched lengths.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(
  req: Request, { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const secret = process.env.LEAD_INTAKE_SECRET;
  if (!secret) return NextResponse.json({ error: "intake is not configured" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: IntakeBody;
  try {
    body = JSON.parse(raw) as IntakeBody;
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !body.answers || typeof body.answers !== "object") {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }

  const { publicId } = await params;
  const db = serviceDb();
  const form = await getPublishedFormByPublicId(db, publicId);
  // Draft, archived and never-existed are all the same answer on purpose.
  if (!form) return NextResponse.json({ error: "unknown form" }, { status: 404 });

  const result = await fileLead(db, {
    form,
    answers: body.answers as Record<string, unknown>,
    locale: body.locale,
    source: trimValue(body.source) || "intake",
    attribution: typeof body.attribution === "object" ? body.attribution as Record<string, unknown> : null,
    origin: originFrom(req.headers),
    userAgent: req.headers.get("user-agent") ?? "",
  }, hashIp);

  if (!result.ok) {
    if (result.error === "invalid") {
      return NextResponse.json({ error: "invalid", fieldErrors: result.fieldErrors }, { status: 400 });
    }
    return NextResponse.json({ error: "not saved" }, { status: 500 });
  }
  return NextResponse.json(
    result.duplicate ? { ok: true, duplicate: true, submissionId: result.submissionId }
                     : { ok: true, submissionId: result.submissionId },
  );
}

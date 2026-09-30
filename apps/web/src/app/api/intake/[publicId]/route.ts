import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  serviceDb, getPublishedFormByPublicId, createSubmission, findRecentDuplicate,
  setSubmissionProcessingError, type FormField,
} from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { enrich } from "@/lib/forms/enrich";
import {
  DUPLICATE_WINDOW_MS, hashAnswers, hashIp, isValidEmail, isValidPhone, parseAttribution,
} from "@/lib/forms/guards";
import { normalizeLocale } from "@/lib/forms/public-strings";

/**
 * Machine intake for a published form — the second front door onto the same
 * pipeline the public form page runs.
 *
 * WHY IT EXISTS. bis-rgv.com's AI assistant captures leads in conversation.
 * Until this route they went to the website's own legacy table and an email,
 * and never reached the CRM: no contact, no thread, no unread badge, no
 * Monday number, nothing for Sofía to see. The public form's server action
 * cannot take them — it is guarded by a render token, a honeypot and a
 * fill-time floor, all of which only make sense for a browser. This route
 * takes JSON from a trusted server instead and then does exactly what the
 * action does after its guards: one submission row, then `enrich`.
 *
 * TRUST. A shared secret, `LEAD_INTAKE_SECRET`, compared in constant time —
 * the same contract as the cron route. Unset → 503 and zero queries, so an
 * unconfigured deployment can never be an open write path. The caller is the
 * agency's own site today; per-account keys are the natural follow-up the
 * day a client wants to pipe leads in from somewhere else.
 *
 * WHAT IT DOES NOT DO. It cannot grant SMS consent: consent is a box a person
 * ticks under the exact text they agreed to, and a conversation is not that.
 * Every consent field is recorded as NOT given, which is what keeps the
 * instant text from going out — the same rule the form applies to an
 * unticked optional box.
 */
export const maxDuration = 30;
const MAX_BODY_BYTES = 32_768;
const MAX_VALUE_CHARS = 5000;
const CONSENT_KIND = "consent";

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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_VALUE_CHARS) : "";
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

  const given = body.answers as Record<string, unknown>;
  const locale = normalizeLocale(str(body.locale), form.locale_default);
  const fields: FormField[] = form.fields;
  const answers = fields
    .filter((f) => f.kind !== CONSENT_KIND)
    .map((f) => ({ key: f.key, label: f.label, value: str(given[f.key]) }));

  const fieldErrors: Record<string, string> = {};
  for (const f of fields) {
    if (f.kind === CONSENT_KIND) continue;
    const value = answers.find((a) => a.key === f.key)?.value ?? "";
    if (f.required && value === "") { fieldErrors[f.key] = "required"; continue; }
    if (value === "") continue;
    if (f.kind === "core.email" && !isValidEmail(value)) fieldErrors[f.key] = "invalid";
    if (f.kind === "core.phone" && !isValidPhone(value)) fieldErrors[f.key] = "invalid";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: "invalid", fieldErrors }, { status: 400 });
  }

  const source = str(body.source).slice(0, 60) || "intake";
  const attribution = parseAttribution(new URLSearchParams(
    typeof body.attribution === "object" && body.attribution
      ? Object.fromEntries(Object.entries(body.attribution as Record<string, unknown>).map(([k, v]) => [k, str(v)]))
      : {},
  ));
  const now = new Date().toISOString();
  const base = {
    answers,
    attribution,
    consent: fields.filter((f) => f.kind === CONSENT_KIND)
      .map((f) => ({ key: f.key, given: false, text: f.label, at: now })),
    locale,
    // Not an IP: the caller is a server. Keyed on the source so duplicate
    // suppression scopes to it, the way it scopes to one visitor's address.
    ipHash: hashIp(`intake:${source}`),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    answersHash: hashAnswers(answers),
  };
  const consent = base.consent.length > 0 ? base.consent : null;

  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const duplicate = await findRecentDuplicate(db, form.id, base.ipHash, base.answersHash, since);
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true, submissionId: duplicate.id });

  let submissionId: string;
  try {
    ({ id: submissionId } = await createSubmission(db, form.account_id, form.id, { ...base, consent }));
  } catch (e) {
    // Nothing was written, so this is the one failure the caller must see —
    // it is what lets the website fall back to its own store.
    console.error(`intake ${publicId}: submission failed before the row existed: ${String(e)}`);
    return NextResponse.json({ error: "not saved" }, { status: 500 });
  }

  try {
    await enrich(db, form, submissionId, answers, attribution, originFrom(req.headers), locale,
      // No consent can be given here (see above), so any consent field on the
      // form means the instant text is withheld.
      base.consent.length > 0);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown enrichment failure";
    await setSubmissionProcessingError(db, form.account_id, submissionId, message);
    console.error(`intake ${publicId}: submission ${submissionId} enrichment failed: ${message}`);
  }

  return NextResponse.json({ ok: true, submissionId });
}

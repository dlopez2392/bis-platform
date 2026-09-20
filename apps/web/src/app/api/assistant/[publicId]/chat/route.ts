import { NextResponse } from "next/server";
import {
  streamText, tool, convertToModelMessages, stepCountIs, type UIMessage,
} from "ai";
import {
  serviceDb, getAssistantByPublicId, getForm, getBranding, brandDisplayName,
  getCalendarForAccount, getVoiceProfile, listPhoneNumbersForAccount,
  createAssistantSession, getAssistantSession, appendAssistantTurn, linkSessionLead,
  countAssistantTurnsForIpSince, countAssistantTurnsForAccountSince,
  type AssistantRow, type FormRow, type TranscriptEntry,
} from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { clientIp, hashIp, verifyRenderToken } from "@/lib/forms/guards";
import { fileLead } from "@/lib/forms/intake";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { assistantModel } from "@/lib/assistant/model";
import { fetchKnowledge } from "@/lib/assistant/knowledge";
import { leadInputSchema } from "@/lib/assistant/lead-tool";
import { buildAssistantPrompt, type AssistantLocale } from "@/lib/assistant/prompt";

/**
 * The website assistant's brain, hosted here for every tenant.
 *
 * A visitor on a client's website talks to `/a/[publicId]` (framed by
 * `assistant.js`); that page posts here. The assistant is an account-owned
 * object (`assistants`), so this one route serves every client: it reads the
 * tenant's business facts, branding, live phone line, booking calendar and
 * lead form, builds ONE platform prompt around them, and — when the tenant
 * has a published form — gives the model a `capture_lead` tool whose schema
 * is that form's fields and whose body is `fileLead`, the same pipeline the
 * public form and the machine intake run. No shared secret between the
 * website and the CRM any more: the platform is calling itself.
 *
 * TRUST. The page mints a render token bound to the public id (the public
 * form's mechanism, minus the fill-time floor — a conversation is not a
 * form); a request without one is 403 before any database read. Then two
 * caps, read before the model is called: per visitor (hashed IP) per hour and
 * per account per day, both counted from `assistant_turns`, so a scripted
 * client or a runaway tab is bounded and visible, the way 0041 bounds Sofía's
 * web sessions. Unconfigured model → 503 and zero model calls.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export const MAX_BODY_BYTES = 65_536;
export const MAX_MESSAGES = 30;
export const MAX_TEXT_CHARS = 2000;
export const TRANSCRIPT_CAP = 60;
export const IP_TURNS_PER_HOUR = 40;
export const ACCOUNT_TURNS_PER_DAY = 1500;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = {
  messages?: unknown;
  sessionId?: unknown;
  locale?: unknown;
  page?: unknown;
  token?: unknown;
};

function refuse(status: number, error: string): Response {
  return NextResponse.json({ error }, { status });
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof (p as { text?: unknown }).text === "string")
    .map((p) => p.text).join("\n").trim();
}

/** Only a UIMessage the client could legitimately send: user or assistant
 *  role, an array of parts, no text part past the ceiling. */
function validMessages(raw: unknown): UIMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  for (const m of raw as unknown[]) {
    if (!m || typeof m !== "object") return null;
    const { role, parts } = m as { role?: unknown; parts?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (!Array.isArray(parts)) return null;
    for (const p of parts as unknown[]) {
      if (!p || typeof p !== "object") return null;
      const part = p as { type?: unknown; text?: unknown };
      if (part.type === "text" && (typeof part.text !== "string" || part.text.length > MAX_TEXT_CHARS)) return null;
    }
  }
  const last = raw[raw.length - 1] as { role: string };
  if (last.role !== "user") return null;
  return raw as UIMessage[];
}

async function loadForm(db: ReturnType<typeof serviceDb>, assistant: AssistantRow): Promise<FormRow | null> {
  if (!assistant.form_id) return null;
  try {
    const form = await getForm(db, assistant.account_id, assistant.form_id);
    // A draft or archived form is not a lead sink: no tool, rather than a
    // row nobody is watching for.
    return form && form.status === "published" ? form : null;
  } catch (e) {
    console.error(`assistant ${assistant.public_id}: form read failed: ${String(e)}`);
    return null;
  }
}

export async function POST(
  req: Request, { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const { publicId } = await params;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return refuse(413, "too large");
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return refuse(400, "malformed");
  }
  if (!body || typeof body !== "object") return refuse(400, "malformed");

  // The token first: it costs nothing and it is what separates the page we
  // served from a script that found the URL.
  const token = typeof body.token === "string" ? body.token : "";
  const verdict = verifyRenderToken(token, Date.now(), publicId);
  if (!verdict.ok) return refuse(403, "forbidden");

  const messages = validMessages(body.messages);
  if (!messages) return refuse(400, "bad messages");

  const db = serviceDb();
  const assistant = await getAssistantByPublicId(db, publicId);
  // Disabled and never-existed are the same answer, on purpose.
  if (!assistant) return refuse(404, "not found");

  const model = await assistantModel();
  if (!model) {
    console.error(`assistant ${publicId}: no model configured (ASSISTANT_MODEL / provider key)`);
    return refuse(503, "unavailable");
  }

  const ipHash = hashIp(clientIp(req.headers));
  const now = Date.now();
  const [ipTurns, accountTurns] = await Promise.all([
    countAssistantTurnsForIpSince(db, ipHash, new Date(now - HOUR_MS).toISOString()),
    countAssistantTurnsForAccountSince(db, assistant.account_id, new Date(now - DAY_MS).toISOString()),
  ]);
  if (ipTurns >= IP_TURNS_PER_HOUR || accountTurns >= ACCOUNT_TURNS_PER_DAY) {
    return refuse(429, "rate_limited");
  }

  const locale: AssistantLocale = normalizeLocale(
    typeof body.locale === "string" ? body.locale : undefined, assistant.locale_default,
  );
  const page = typeof body.page === "string" ? body.page.slice(0, 500) : null;

  // The session: server-issued, echoed back to the page in a header, and the
  // only id the page ever holds. A stranger's id is refused, not adopted.
  let sessionId: string;
  let transcript: TranscriptEntry[] = [];
  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string" || !UUID.test(body.sessionId)) return refuse(400, "bad session");
    const session = await getAssistantSession(db, body.sessionId);
    if (!session || session.assistant_id !== assistant.id) return refuse(400, "bad session");
    sessionId = session.id;
    transcript = session.transcript;
  } else {
    ({ id: sessionId } = await createAssistantSession(db, {
      assistantId: assistant.id, accountId: assistant.account_id, ipHash, locale, pageUrl: page,
    }));
  }

  // Tenant facts. Each read is best-effort: a branding blip must cost the
  // visitor a logo, not an answer.
  const [account, branding, calendar, voice, phones, form] = await Promise.all([
    accountName(db, assistant.account_id),
    getBranding(db, assistant.account_id).catch(() => null),
    getCalendarForAccount(db, assistant.account_id).catch(() => null),
    getVoiceProfile(db, assistant.account_id).catch(() => null),
    listPhoneNumbersForAccount(db, assistant.account_id).catch(() => []),
    loadForm(db, assistant),
  ]);
  const origin = originFrom(req.headers);
  const packUrl = assistant.knowledge_urls[locale] ?? assistant.knowledge_urls.en;
  const pack = packUrl ? await fetchKnowledge(packUrl) : null;

  const businessName = (branding && brandDisplayName(branding)) || account || "this business";
  const system = buildAssistantPrompt({
    businessName,
    assistantName: assistant.name,
    locale,
    phones: voice?.enabled ? phones.filter((p) => p.status === "live").map((p) => p.e164) : [],
    email: branding?.replyToEmail ?? null,
    bookingLink: calendar && origin ? `${origin}/b/${calendar.public_id}?locale=${locale}` : null,
    knowledge: assistant.knowledge,
    packs: pack ? [pack] : [],
    faq: assistant.faq,
    leadFields: form ? form.fields : null,
    page,
  });

  const userAgent = req.headers.get("user-agent") ?? "";
  const tools = form
    ? {
        capture_lead: tool({
          description: `Save the visitor's details as a lead for ${businessName}. Call exactly once, only after you have every required detail.`,
          inputSchema: leadInputSchema(form.fields),
          execute: async (answers) => {
            const result = await fileLead(db, {
              form,
              answers: answers as Record<string, unknown>,
              locale,
              source: "website assistant",
              attribution: { utm_source: page ? safeHost(page) : "website", utm_medium: "ai-assistant" },
              origin,
              userAgent,
              ipHash,
            }, hashIp);
            if (!result.ok) return { ok: false as const };
            const contactId = await submissionContact(db, result.submissionId);
            await linkSessionLead(db, sessionId, result.submissionId, contactId).catch((e) =>
              console.error(`assistant ${publicId}: link session lead failed: ${String(e)}`));
            return { ok: true as const };
          },
        }),
      }
    : undefined;

  const lastUser = textOf(messages[messages.length - 1]!);
  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(messages),
    temperature: 0.4,
    maxOutputTokens: 700,
    // Without this the model stops the moment a tool returns and the visitor
    // sees nothing after "saving". Four steps covers capture_lead → speak.
    stopWhen: stepCountIs(4),
    tools,
    onFinish: async ({ text, totalUsage }) => {
      const at = new Date().toISOString();
      const next = [...transcript,
        { role: "user" as const, text: lastUser, at },
        { role: "assistant" as const, text: text.trim(), at },
      ].slice(-TRANSCRIPT_CAP);
      try {
        await appendAssistantTurn(db, {
          sessionId, accountId: assistant.account_id, ipHash, transcript: next,
          inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0,
        });
      } catch (e) {
        console.error(`assistant ${publicId}: turn record failed: ${String(e)}`);
      }
    },
    onError: ({ error }) => {
      console.error(`assistant ${publicId}: stream error: ${String(error)}`);
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { "x-bis-session": sessionId, "cache-control": "no-store" },
    onError: () => (locale === "es"
      ? "Perdona, el asistente no está disponible en este momento. Escríbenos o llámanos y te atendemos."
      : "Sorry, the assistant is unavailable right now. Send us a message or call and we will help."),
  });
}

async function accountName(db: ReturnType<typeof serviceDb>, accountId: string): Promise<string | null> {
  try {
    const { data } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();
    return (data as { name: string } | null)?.name ?? null;
  } catch {
    return null;
  }
}

function safeHost(page: string): string {
  try {
    return new URL(page).host || "website";
  } catch {
    return "website";
  }
}

async function submissionContact(db: ReturnType<typeof serviceDb>, submissionId: string): Promise<string | null> {
  try {
    const { data } = await db.from("form_submissions").select("contact_id").eq("id", submissionId).maybeSingle();
    return (data as { contact_id: string | null } | null)?.contact_id ?? null;
  } catch {
    return null;
  }
}

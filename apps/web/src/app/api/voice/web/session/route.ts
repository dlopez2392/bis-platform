// Mints a short-lived OpenAI Realtime client secret so a visitor on the
// marketing website can talk to Sofía in their browser, over WebRTC, instead
// of dialling the phone line.
//
// The persona is NOT redefined here. This route resolves the same tenant off
// the same published number the phone path resolves, reads the same voice
// profile, and calls the same `buildRealtimeSessionConfig`. The only
// departures are the two a browser forces (no tools, a hard length ceiling)
// and they are expressed by `web-demo.ts`, appended to the tenant's own
// instructions rather than replacing them. There is one Sofía.
//
// Authorization is the website's signed ticket, not CORS: CORS is a courtesy
// browsers extend and curl ignores. The Origin check is still made, because
// it is free and it stops another site embedding this, but the ticket is what
// actually decides. See `web-demo.ts` for why the rate limit lives on the
// website rather than here.
import { NextResponse } from "next/server";
import { buildRealtimeSessionConfig, type VoicePromptInput } from "@/lib/voice/session-config";
import {
  WEB_DEMO_MAX_SECONDS, webDemoNotice, parseAllowedOrigins, originAllowed, verifyTicket,
} from "@/lib/voice/web-demo";

export const runtime = "nodejs";

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: "voice/web/session", msg, ...extra }));
}

/** Echoes the caller's own origin, never `*`: the browser will not attach
 *  credentials to a wildcard, and echoing keeps the allowlist the only place
 *  the decision is made. `Vary` so a CDN cannot serve one origin's headers
 *  to another. */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function refuse(status: number, error: string, origin: string | null) {
  return NextResponse.json({ error }, {
    status, headers: origin ? corsHeaders(origin) : undefined,
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = parseAllowedOrigins(process.env.SOFIA_WEB_ORIGINS);
  if (!originAllowed(origin, allowed)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin!) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const allowed = parseAllowedOrigins(process.env.SOFIA_WEB_ORIGINS);
  if (!originAllowed(origin, allowed)) {
    log("refused: origin", { origin });
    return refuse(403, "forbidden", null);
  }

  const secret = process.env.SOFIA_WEB_SECRET;
  const calledNumber = process.env.SOFIA_WEB_NUMBER;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!secret || !calledNumber || !apiKey) {
    // Unconfigured is 503, never a silent success and never a session on a
    // default persona: the website renders its fallback and nobody is billed.
    log("refused: unconfigured", {
      hasSecret: !!secret, hasNumber: !!calledNumber, hasKey: !!apiKey,
    });
    return refuse(503, "unavailable", origin);
  }

  let ticket = "";
  try {
    const body = (await req.json()) as { ticket?: unknown };
    if (typeof body.ticket === "string") ticket = body.ticket;
  } catch {
    return refuse(400, "bad_request", origin);
  }
  const verdict = verifyTicket(secret, ticket, Date.now());
  if (!verdict.ok) {
    log("refused: ticket", { reason: verdict.reason });
    return refuse(403, "forbidden", origin);
  }

  // Lazy import, same reason as every other voice route: a module-scope DB
  // import breaks `next build` during page-data collection.
  const {
    serviceDb, getPhoneNumberByE164, getVoiceProfile, getOrCreateCalendar,
  } = await import("@bis/db");

  let sessionConfig: ReturnType<typeof buildRealtimeSessionConfig>;
  try {
    const db = serviceDb();
    const phoneRow = await getPhoneNumberByE164(db, calledNumber);
    if (!phoneRow || (phoneRow.status !== "testing" && phoneRow.status !== "live")) {
      log("refused: number not routable", { status: phoneRow?.status ?? "missing" });
      return refuse(503, "unavailable", origin);
    }
    const accountId = phoneRow.account_id;
    const profile = await getVoiceProfile(db, accountId);
    if (!profile || !profile.enabled) {
      log("refused: profile disabled", { accountId });
      return refuse(503, "unavailable", origin);
    }
    const { data: account, error } = await db
      .from("accounts").select("name, timezone").eq("id", accountId).single();
    if (error || !account) {
      log("refused: account lookup failed", { accountId, error: error?.message });
      return refuse(503, "unavailable", origin);
    }
    const acct = account as { name: string; timezone: string };
    const calendar = await getOrCreateCalendar(db, accountId, "voice", "ai");

    const greetingBase = profile.languages === "es" ? profile.greeting_es : profile.greeting_en;
    const greeting = greetingBase && greetingBase.trim()
      ? greetingBase
      : `Thanks for calling ${acct.name}. How can I help you today?`;

    const promptInput: VoicePromptInput = {
      personaName: profile.persona_name, businessName: acct.name, greeting,
      facts: profile.facts, services: profile.services, languages: profile.languages,
      // FALSE regardless of the tenant's own setting: no tools reach this
      // session, so a prompt that promises booking would promise something
      // that cannot happen. The notice below tells her where to send them.
      bookingEnabled: false,
      timezone: acct.timezone, slotDurationMinutes: calendar.slot_duration_minutes,
      afterHours: profile.after_hours, callerNumber: null,
      meetingType: calendar.meeting_type,
    };

    const base = buildRealtimeSessionConfig(promptInput, new Date());
    const appOrigin = process.env.APP_ORIGIN ?? "https://app.bis-rgv.com";
    sessionConfig = {
      ...base,
      // Belt and braces. `bookingEnabled: false` already yields no booking
      // tools; this makes "no tools reach a stranger's browser" true by
      // construction rather than by reading `toolSchemas`.
      tools: [],
      instructions: base.instructions + webDemoNotice({
        bookingUrl: calendar.enabled ? `${appOrigin}/b/${calendar.public_id}` : null,
        phoneNumber: process.env.SOFIA_WEB_DISPLAY_NUMBER ?? null,
      }),
    };
  } catch (e) {
    log("refused: resolve failed", { error: String(e) });
    return refuse(503, "unavailable", origin);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionConfig }),
    });
    if (!res.ok) {
      // Body deliberately not forwarded to the browser — it can carry
      // account and project detail a visitor has no business seeing.
      log("openai client_secrets failed", { status: res.status, body: (await res.text()).slice(0, 500) });
      return refuse(502, "unavailable", origin);
    }
    const data = (await res.json()) as { value?: string; expires_at?: number };
    if (!data.value) {
      log("openai client_secrets returned no value");
      return refuse(502, "unavailable", origin);
    }
    log("session minted");
    return NextResponse.json(
      { value: data.value, expiresAt: data.expires_at ?? null, maxSeconds: WEB_DEMO_MAX_SECONDS },
      { headers: { ...corsHeaders(origin!), "Cache-Control": "no-store" } },
    );
  } catch (e) {
    log("openai client_secrets threw", { error: String(e) });
    return refuse(502, "unavailable", origin);
  }
}

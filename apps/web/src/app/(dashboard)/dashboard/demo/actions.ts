"use server";

/**
 * F-140 slice 1: start one prospect demo (/dashboard/demo). Mints a short-lived OpenAI Realtime secret for
 * a session built from the TYPED business (lib/voice/prospect-demo.ts), the way api/voice/web/session mints
 * one for the website, and hands it to the agency's own browser.
 *
 * requireAgency() is the FIRST line, before any parse, count or mint: a client Owner, Staff or Technician
 * is redirected, a signed-out visitor sent to sign in. Nothing below it trusts the argument, which is
 * whatever the browser sent.
 *
 * Every cost check happens BEFORE the mint, and fails CLOSED (web/session's reasoning: failing open here
 * costs an unbounded number of sessions). The demo is recorded before the mint, so a minted session is
 * always one the next request counts. The secret is returned, never logged.
 */
import { serviceDb, countProspectDemosSince, recordProspectDemo } from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { m } from "@/lib/messages";
import {
  parseProspectDemo, buildProspectDemoSession,
  PROSPECT_DEMO_MAX_PER_USER_PER_DAY, PROSPECT_DEMO_WINDOW_MS,
} from "@/lib/voice/prospect-demo";
import { WEB_DEMO_MAX_SECONDS } from "@/lib/voice/web-demo";

export type ProspectDemoStart =
  | { ok: true; secret: string; expiresAt: number | null; maxSeconds: number; greeting: string; businessName: string }
  | { ok: false; error: string };

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: "agency/demo", msg, ...extra }));
}

const unavailable = (): ProspectDemoStart => ({ ok: false, error: m["prospectDemo.error.unavailable"] });

export async function startProspectDemoAction(raw: unknown): Promise<ProspectDemoStart> {
  const { userId } = await requireAgency();

  const parsed = parseProspectDemo(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log("refused: unconfigured");
    return unavailable();
  }

  const db = serviceDb();
  try {
    const since = new Date(Date.now() - PROSPECT_DEMO_WINDOW_MS).toISOString();
    const used = await countProspectDemosSince(db, userId, since);
    if (used >= PROSPECT_DEMO_MAX_PER_USER_PER_DAY) {
      log("refused: cap", { userId, used });
      return {
        ok: false,
        error: m["prospectDemo.error.cap"].replace("{max}", String(PROSPECT_DEMO_MAX_PER_USER_PER_DAY)),
      };
    }
    await recordProspectDemo(db, userId);
  } catch (e) {
    log("refused: cap check failed", { error: String(e) });
    return unavailable();
  }

  const { session, greeting } = buildProspectDemoSession(parsed.profile, new Date());
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) {
      // Status only: the body can carry project detail, and none of it helps the person holding the phone.
      log("openai client_secrets failed", { status: res.status });
      return unavailable();
    }
    const data = (await res.json()) as { value?: unknown; expires_at?: unknown };
    if (typeof data.value !== "string" || data.value === "") {
      log("openai client_secrets returned no value");
      return unavailable();
    }
    // The one line per demo. The business name is the only thing about the prospect it carries.
    log("demo minted", {
      userId, businessName: parsed.profile.businessName, trade: parsed.profile.trade,
      languages: parsed.profile.languages,
    });
    return {
      ok: true, secret: data.value,
      expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
      maxSeconds: WEB_DEMO_MAX_SECONDS, greeting, businessName: parsed.profile.businessName,
    };
  } catch (e) {
    log("openai client_secrets threw", { error: String(e) });
    return unavailable();
  }
}

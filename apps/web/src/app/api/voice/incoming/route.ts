// OpenAI Realtime-SIP webhook target (platform.openai.com > Settings >
// Webhooks, event `realtime.call.incoming`). This route and `/api/voice/texml`
// are the ONLY two voice entry points: Telnyx hits texml first, which bridges
// the call to OpenAI's SIP connector with the dialed number smuggled onto the
// SIP URI as `X-BIS-Called`; OpenAI then calls back HERE with that number in
// `sip_headers`, and this route is what resolves it to a tenant, decides
// whether to answer, and — if so — accepts the call and keeps it alive for
// its whole duration.
//
// Runs on the Node.js runtime (the `ws` package and the signature
// verification's `crypto.subtle` usage are not Edge-compatible), with a
// generous `maxDuration` because the call-scoped WebSocket loop in
// `runCallLifecycle` runs for the entire phone call, not just this request.
// 300 is the ceiling, not a guess: with Fluid Compute (default-on for all
// plans), Hobby's default AND maximum are both 300s (Vercel docs,
// "Duration limits" table).
//
// Three contracts worth stating up front, because getting any of them wrong
// fails SILENTLY (dead air or a rejected accept, not a thrown error):
//
//  1. FLAT accept body. `POST /v1/realtime/calls/{call_id}/accept` takes the
//     same flat session-create shape `buildRealtimeSessionConfig` already
//     returns (type/model/instructions/tools/audio at the top level) — NOT
//     nested under a `session` key. Nesting it is the documented way to get
//     a silent 4xx.
//
//  2. Accepting returns once the SIP leg is RINGING, not once media is
//     flowing. Sending the greeting immediately clips its first syllable —
//     that's why `runCallLifecycle` delays it by `PHONE_GREETING_DELAY_MS`
//     (default 900ms) rather than firing it the instant the socket opens.
//
//  3. Fail-open, deliberately, in exactly two places: the call-cap counts
//     (step 8 below — a DB blip must not turn away a real caller; losing a
//     prospect costs more than paying for one extra robocall) and
//     `startCallRow` (step 10 — a DB blip must not lose the call itself;
//     `finishCall` already tolerates a null `callRowId` and still gets the
//     staff alert out). Signature verification and account resolution are
//     NOT fail-open — those gate who gets to talk to a tenant's AI at all.
//
// Every branch past the initial config/signature checks acks the webhook
// with 200, `declined` or not: OpenAI's incoming-call webhook is not usefully
// retried, and simply never accepting the call IS how a decline is expressed.
// A stray 5xx here would only obscure the real failure, which is always
// visible in the `[voice/incoming]` log line at the point it happened.
import { NextRequest, NextResponse, after } from "next/server";
import OpenAI from "openai";
import WebSocket from "ws";
import {
  serviceDb, getPhoneNumberByE164, getVoiceProfile, countCallsSince, countCallsByCallerSince,
  startCallRow, getOrCreateCalendar,
  type Branding,
} from "@bis/db";
import { extractCallerNumber, extractCalledNumber, sipHeaderNames } from "@/lib/voice/sip-headers";
import { buildRealtimeSessionConfig, type VoicePromptInput } from "@/lib/voice/session-config";
import { processCallEvent } from "@/lib/voice/call-events";
import { emptyCallState } from "@/lib/voice/call-state";
import { finishCall, type FinishContext } from "@/lib/voice/finish-call";
import type { ToolContext } from "@/lib/voice/tools/registry";
import { readLimitConfig, decideLimit, utcDayStart } from "@/lib/voice/call-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

function log(...args: unknown[]) {
  console.log("[voice/incoming]", ...args);
}

// The `ACCOUNT_BRAND_COLS` shape from `packages/db/src/booking.ts:286` is not
// exported — that accessor is `listDueReminders`'s private implementation
// detail, not a public seam — so the identical column list is selected
// inline here rather than reaching into the package's internals.
const ACCOUNT_COLS =
  "name, timezone, brand_name, brand_logo_path, brand_color, brand_neutral, " +
  "brand_corners, brand_type, brand_mode, reply_to_email, from_email";

type AccountBrandRow = {
  name: string; timezone: string;
  brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
  brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
  brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
  reply_to_email: string | null; from_email: string | null;
};

async function loadAccountContext(
  db: ReturnType<typeof serviceDb>, accountId: string,
): Promise<AccountBrandRow> {
  const { data, error } = await db.from("accounts").select(ACCOUNT_COLS).eq("id", accountId).single();
  if (error || !data) {
    throw new Error(`voice/incoming: account lookup failed for ${accountId}: ${error?.message}`);
  }
  return data as unknown as AccountBrandRow;
}

// Accept endpoint per OpenAI's realtime-SIP guide: POST
// /v1/realtime/calls/{call_id}/accept, Bearer auth, flat session body (see
// contract #1 above). Throws on any non-ok response or network failure; the
// caller decides what "failed to accept" means for the webhook response.
async function acceptCall(callId: string, apiKey: string, sessionConfig: object): Promise<void> {
  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(sessionConfig),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`accept failed: ${res.status} ${detail}`);
  }
}

interface LifecycleArgs {
  callId: string;
  apiKey: string;
  greeting: string;
  callRowId: string | null;
  startedAt: Date;
  toolCtx: ToolContext;
  finishCtx: FinishContext;
}

/**
 * The call-scoped WebSocket loop — lives for the entire phone call, run in
 * the background via `after()` so it never delays the webhook's own 200.
 * State is a local `let`, in-process, no store: one call, one invocation,
 * dies with it (mirrors `call-state.ts`'s own doc comment).
 *
 * Ported shape from the reception demo's `runCallLifecycle`, re-pointed at
 * this platform's tested seams (`processCallEvent`, `finishCall`) in place
 * of the demo's own recorder/store.
 */
function runCallLifecycle(args: LifecycleArgs): Promise<void> {
  const { callId, apiKey, greeting, callRowId, startedAt, toolCtx, finishCtx } = args;
  let state = emptyCallState();
  let capTimer: NodeJS.Timeout | undefined;
  let closeTimer: NodeJS.Timeout | undefined;
  let greetTimer: NodeJS.Timeout | undefined;
  let settled = false;

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return new Promise<void>((resolve) => {
    // Idempotent: `close` and `error` can both fire for the same socket, and
    // this must run exactly once regardless of which (or both) arrive.
    const finish = async (reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(capTimer);
      clearTimeout(closeTimer);
      clearTimeout(greetTimer);
      log("call ended", { callId, reason });

      // finishCall is documented never-throws; this catch is belt-and-
      // suspenders against that contract changing out from under this route.
      try {
        await finishCall(state, finishCtx, { callRowId, startedAt, endedAt: new Date() });
      } catch (e) {
        log("finishCall threw unexpectedly", { callId, error: String(e) });
      }
      resolve();
    };

    ws.on("open", () => {
      log("call socket open", { callId });

      // Delayed on purpose (contract #2 above): accepting a SIP call returns
      // 200 once the leg is RINGING, not once media is flowing, so audio
      // sent immediately can clip. Tunable via PHONE_GREETING_DELAY_MS.
      const delayRaw = Number(process.env.PHONE_GREETING_DELAY_MS);
      const greetingDelayMs = Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 900;
      greetTimer = setTimeout(() => {
        try {
          ws.send(JSON.stringify({
            type: "response.create",
            response: { instructions: `Greet the caller with exactly: ${greeting}` },
          }));
        } catch (e) {
          log("greeting send failed", { callId, error: String(e) });
        }
      }, greetingDelayMs);

      // Cost guardrail: hard cap on call length. On fire, ask the model for
      // a brief goodbye, then close the socket ~5s later to let it play out.
      const capRaw = Number(process.env.PHONE_MAX_CALL_SECONDS);
      const maxSeconds = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 240;
      capTimer = setTimeout(() => {
        log("call cap reached, sending goodbye", { callId, maxSeconds });
        try {
          ws.send(JSON.stringify({
            type: "response.create",
            response: { instructions: "Politely wrap up and say a brief goodbye to the caller — we're out of time." },
          }));
        } catch {
          // socket may already be closing; the closeTimer below still fires.
        }
        closeTimer = setTimeout(() => {
          log("closing call socket after cap goodbye", { callId });
          ws.close();
        }, 5000);
      }, maxSeconds * 1000);
    });

    ws.on("message", async (raw) => {
      let event: any;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        log("failed to parse call event", { callId });
        return;
      }
      try {
        const result = await processCallEvent(state, toolCtx, event);
        state = result.state;
        for (const action of result.actions) {
          if (action.kind === "send") ws.send(JSON.stringify(action.payload));
        }
      } catch (e) {
        log("error processing call event", { callId, type: event?.type, error: String(e) });
      }
    });

    ws.on("close", (code, reason) => {
      void finish(`ws-close:${code}:${reason?.toString() ?? ""}`);
    });

    ws.on("error", (err) => {
      log("call socket error", { callId, error: String(err) });
      void finish("ws-error");
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // --- Step 1: server configuration -----------------------------------
  const secret = process.env.OPENAI_WEBHOOK_SECRET;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!secret || !apiKey) {
    log("missing OPENAI_WEBHOOK_SECRET or OPENAI_API_KEY — refusing to run open");
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  // --- Step 2: signature verification ----------------------------------
  // req.text() FIRST — unwrap needs the exact raw bytes the signature was
  // computed over; re-serializing a parsed body would not match.
  const rawBody = await req.text();
  const client = new OpenAI({ apiKey });

  let event: OpenAI.Webhooks.UnwrapWebhookEvent;
  try {
    event = await client.webhooks.unwrap(rawBody, req.headers, secret);
  } catch (e) {
    log("webhook signature verification failed", { error: String(e) });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Everything past this point acks 200 no matter what happens inside — see
  // the file header's "never a stray 5xx" note. An unexpected throw anywhere
  // below (an account row that violates its own FK integrity, say) logs and
  // falls through to the same ok:true a graceful decline would return.
  try {
    // --- Step 3: only handle the incoming-call event ---------------------
    if (event.type !== "realtime.call.incoming") {
      log("ignoring non-call webhook event", { type: event.type });
      return NextResponse.json({ ok: true });
    }

    const now = new Date();

    // --- Step 4: extract routing info, log NAMES never VALUES ------------
    const callId = event.data.call_id;
    const callerNumber = extractCallerNumber(event.data);
    const calledNumber = extractCalledNumber(event.data);
    log("incoming call", { callId, callerNumber, calledNumber, sipHeaderNames: sipHeaderNames(event.data) });

    // --- Step 5: unroutable ------------------------------------------------
    if (!calledNumber) {
      log("declined: unroutable — no called number on the SIP headers", { callId });
      return NextResponse.json({ ok: true, declined: "unroutable" });
    }

    // --- Step 6: resolve the tenant off the dialed number -----------------
    const db = serviceDb();
    const phoneRow = await getPhoneNumberByE164(db, calledNumber);
    if (!phoneRow || (phoneRow.status !== "testing" && phoneRow.status !== "live")) {
      log("declined: unknown-number", { callId, calledNumber });
      return NextResponse.json({ ok: true, declined: "unknown-number" });
    }
    const accountId = phoneRow.account_id;

    // --- Step 7: the tenant's voice profile must exist and be enabled -----
    const profile = await getVoiceProfile(db, accountId);
    if (!profile || !profile.enabled) {
      log("declined: disabled", { callId, accountId });
      return NextResponse.json({ ok: true, declined: "disabled" });
    }

    // --- Step 8: abuse caps, fail-open on a counting failure ---------------
    let capsAllowed = true;
    let capsReason: "per-number" | "per-account" | undefined;
    try {
      const dayStart = utcDayStart(now);
      const forAccount = await countCallsSince(db, accountId, dayStart);
      const forNumber = callerNumber ? await countCallsByCallerSince(db, accountId, callerNumber, dayStart) : 0;
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        capsAllowed = false;
        capsReason = verdict.reason;
      }
    } catch (e) {
      log("call-limit counts failed — failing open", { callId, accountId, error: String(e) });
    }
    if (!capsAllowed) {
      log("declined: call cap", { callId, accountId, reason: capsReason });
      return NextResponse.json({ ok: true, declined: capsReason });
    }

    // --- Step 9: account/branding context + the tenant's booking calendar -
    const accountRow = await loadAccountContext(db, accountId);
    const calendar = await getOrCreateCalendar(db, accountId, "voice", "ai");

    // --- Step 10: open the call row, fail-open (a DB blip must not lose
    // the call itself — finishCall tolerates a null callRowId). -----------
    let callRowId: string | null = null;
    try {
      const row = await startCallRow(db, accountId, { phoneNumberId: phoneRow.id, callerE164: callerNumber });
      callRowId = row.id;
    } catch (e) {
      log("startCallRow failed — proceeding without a row", { callId, accountId, error: String(e) });
    }

    // --- Step 11: accept the call -----------------------------------------
    const greetingBase = profile.languages === "es" ? profile.greeting_es : profile.greeting_en;
    const greeting = greetingBase && greetingBase.trim()
      ? greetingBase
      : `Thanks for calling ${accountRow.name}. How can I help you today?`;

    const promptInput: VoicePromptInput = {
      personaName: profile.persona_name, businessName: accountRow.name, greeting,
      facts: profile.facts, services: profile.services, languages: profile.languages,
      bookingEnabled: profile.booking_enabled, timezone: accountRow.timezone,
      slotDurationMinutes: calendar.slot_duration_minutes, afterHours: profile.after_hours,
      callerNumber,
    };
    const sessionConfig = buildRealtimeSessionConfig(promptInput, now);

    try {
      await acceptCall(callId, apiKey, sessionConfig);
    } catch (e) {
      log("failed to accept call", { callId, error: String(e) });
      return NextResponse.json({ ok: true });
    }
    log("call accepted", { callId });

    // --- Step 12: schedule the call-scoped lifecycle, ack immediately -----
    const branding: Branding = {
      brandName: accountRow.brand_name, brandLogoPath: accountRow.brand_logo_path,
      brandColor: accountRow.brand_color, brandNeutral: accountRow.brand_neutral,
      brandCorners: accountRow.brand_corners, brandType: accountRow.brand_type,
      brandMode: accountRow.brand_mode, replyToEmail: accountRow.reply_to_email,
    };
    // Cron-route precedent (`api/cron/reminders/route.ts`): this is a
    // webhook invocation, not a browser request forwarded through Vercel's
    // edge, so there is no forwarded-host chain to trust or distrust —
    // req.url's origin IS the deployment's own.
    const origin = new URL(req.url).origin;

    const toolCtx: ToolContext = {
      db, accountId, accountName: accountRow.name, timezone: accountRow.timezone,
      calendar, profile, branding, fromEmail: accountRow.from_email ?? null,
      callerNumber, origin,
    };
    const finishCtx: FinishContext = {
      db, accountId, accountName: accountRow.name, branding,
      notifyEmails: calendar.notify_emails, callerNumber, origin,
      profileLanguage: profile.languages,
    };

    after(() => runCallLifecycle({ callId, apiKey, greeting, callRowId, startedAt: now, toolCtx, finishCtx }));

    return NextResponse.json({ ok: true });
  } catch (e) {
    log("unexpected failure handling incoming call", { error: String(e) });
    return NextResponse.json({ ok: true });
  }
}

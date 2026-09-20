// The website's "Talk to Sofía" button reaches the SAME Sofía the phone line
// reaches — same persona, same greeting, same facts and services, built by
// `buildRealtimeSessionConfig` from the tenant's own voice profile. What
// differs is only what a browser cannot do, and that difference is expressed
// here rather than by maintaining a second prompt:
//
//   - No tools. The phone Sofía can book, reschedule and take a message
//     because a phone call is authenticated by the caller's own number and
//     runs inside our SIP webhook. A browser session is an anonymous
//     stranger on the public internet; giving that a path into a tenant's
//     calendar and contacts is a much larger decision than a demo needs, so
//     the web session is conversation only and says so out loud.
//   - A length the model is TOLD but nobody can enforce. A phone call runs
//     on a socket this server holds, so PHONE_MAX_CALL_SECONDS is a real
//     ceiling. A browser session does not: this server mints an ephemeral
//     secret and the browser talks to OpenAI directly, so it is never in
//     the media loop again — and OpenAI exposes no server-side session
//     lifetime (verified 2026-09-20). WEB_DEMO_MAX_SECONDS is therefore
//     ADVISORY: told to Sofía so she paces herself, returned to the client
//     so a well-behaved page can end the session. A page that does not, or
//     a client that skips the JS entirely, runs as long as it likes.
//     What IS enforced — server-side, before a secret is ever minted — is
//     HOW MANY sessions this route will agree to: see the three caps below
//     and `voice_web_sessions` (migration 0041).
//
// Everything in this file is pure so the wording and the arithmetic are
// unit-testable without a database, a network, or a browser.

/** How long one web session may run before the client ends it. Three minutes
 *  is long enough to ask a real question and hear a real answer. Sofía is
 *  told this number so she paces the conversation instead of being cut off
 *  mid-sentence — see the file header for why this is advisory, not a cap. */
export const WEB_DEMO_MAX_SECONDS = 180;

/**
 * The caps that ARE enforced, all counted in the database before a secret is
 * minted (`voice_web_sessions`, 0041). They bound the NUMBER of sessions,
 * which is the only thing this server still controls once the browser is
 * talking to OpenAI directly.
 *
 * Deliberately not env-tunable, unlike the phone path's knobs: those were
 * tuned against real calls, and there is no comparable traffic here yet.
 * The day a real number justifies a change, that is a code change with a
 * reason in its commit message rather than a value someone set in a
 * dashboard and nobody can explain.
 */
export const WEB_SESSION_WINDOW_MS = 600_000;
/** Per hashed IP, per window. Matches forms' RATE_LIMIT_MAX: a visitor with
 *  a real question does not need a sixth session in ten minutes. */
export const WEB_SESSION_MAX_PER_IP = 5;
/** The rolling 24h the per-account cap below counts over. */
export const WEB_SESSION_ACCOUNT_WINDOW_MS = 86_400_000;
/** Per account, per rolling 24h. The per-tenant ceiling: one client's public
 *  page must not be able to exhaust a shared budget on its own. */
export const WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY = 200;

/** Wall-clock ceiling in whole minutes, for prose. */
export function webDemoMinutes(seconds: number = WEB_DEMO_MAX_SECONDS): number {
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Appended to the tenant's own instructions, never a replacement for them.
 *
 * Says three things and no more: where the visitor is, that she cannot book
 * from here, and what to tell them instead. Written in the same plain
 * register as the rest of her prompt — a visitor who asks for an appointment
 * should hear a receptionist redirecting them, not a system explaining its
 * own limitations.
 */
export function webDemoNotice(input: {
  bookingUrl: string | null; phoneNumber: string | null; maxSeconds?: number;
}): string {
  const minutes = webDemoMinutes(input.maxSeconds ?? WEB_DEMO_MAX_SECONDS);
  const lines = [
    "",
    "## This conversation is happening on the website, not the phone",
    "",
    `You are talking to someone who clicked a button on the website to hear you. They are a stranger, not a known caller — you do not have their phone number, and you must not ask for it as though you already had it.`,
    `Keep this to about ${minutes} minutes. If you are still talking near the end, say you are glad they called and point them to the next step rather than starting something new.`,
    "",
    "You CANNOT book, reschedule or cancel anything in this conversation, and you cannot take a message that reaches anyone. Do not say you have booked, noted, saved or passed anything along — that would be a lie. When someone wants to book or to be contacted, say so plainly and send them to the right place:",
  ];
  if (input.bookingUrl) lines.push(`- To book: the scheduling page at ${input.bookingUrl}.`);
  if (input.phoneNumber) lines.push(`- To speak to someone who CAN book them in: ${input.phoneNumber}, which is this same line.`);
  if (!input.bookingUrl && !input.phoneNumber) {
    lines.push("- Ask them to use the contact form on this website.");
  }
  return lines.join("\n");
}

/** Origins allowed to open a web session, comma-separated in the env var.
 *  Compared exactly — scheme, host and port — never by suffix: a `endsWith`
 *  check would hand `bis-rgv.com.attacker.example` a session. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function originAllowed(origin: string | null, allowed: string[]): boolean {
  return origin !== null && allowed.includes(origin);
}

// --- The website's ticket ----------------------------------------------
// Minting a session costs money, so the endpoint that mints one must not be
// open to the whole internet. The bot check and the per-visitor rate limit
// that would decide this already exist and are already proven — on the
// WEBSITE (Vercel BotID plus an Upstash counter), not here. Rather than
// build a second, weaker copy of both in the platform, the website vouches
// for the visitor with a short-lived signed ticket and this route verifies
// it. CORS narrows who can ask from a browser; the ticket is what actually
// authorizes, because CORS is a browser courtesy and curl ignores it.
//
// Same shape and the same reasoning as `forms/guards.ts`'s render token, and
// single-use since 0041: the nonce returned by `verifyTicket` is inserted
// into `voice_web_sessions`, whose unique index refuses the second use. The
// short life is still the first line of defence; the store is the second.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** A ticket older than this is refused. Long enough for a click plus a slow
 *  network, far too short to be worth stealing and hoarding. */
export const TICKET_MAX_AGE_MS = 120_000;

/** Never HMAC with the raw shared secret. */
export function ticketKey(secret: string): Buffer {
  return createHash("sha256").update(`bis-sofia-web-ticket:${secret}`).digest();
}

export function signTicket(secret: string, nowMs: number, nonce: string = randomUUID()): string {
  const payload = `${nowMs}.${nonce}`;
  return `${payload}.${createHmac("sha256", ticketKey(secret)).update(payload).digest("base64url")}`;
}

export type TicketResult =
  | { ok: true; nonce: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyTicket(
  secret: string, ticket: string, nowMs: number, maxAgeMs: number = TICKET_MAX_AGE_MS,
): TicketResult {
  const parts = ticket.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [issuedRaw, nonce, given] = parts as [string, string, string];
  const issued = Number(issuedRaw);
  if (!Number.isFinite(issued) || !nonce) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", ticketKey(secret))
    .update(`${issuedRaw}.${nonce}`).digest("base64url");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual THROWS on a length mismatch rather
  // than returning false, which would surface as a 500 instead of a refusal.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  // Both directions. A ticket from the future is a clock problem or a forged
  // timestamp, and either way is not something to honour for two minutes.
  const age = nowMs - issued;
  if (age > maxAgeMs || age < -maxAgeMs) return { ok: false, reason: "expired" };
  // The nonce rides back out because it is the replay key: the caller
  // inserts it into voice_web_sessions, whose unique index is what finally
  // makes this ticket single-use. Until 0041 there was no store to do that
  // with, which is what the comment at the top of this file used to say.
  return { ok: true, nonce };
}

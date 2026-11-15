import { serviceDb, getGoogleConnectionStatus, type GoogleConnectionStatus } from "@bis/db";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import { googleCalendarConfig } from "@/lib/google/calendar-client";
import { loggableError } from "@/lib/loggable-error";
import type { GoogleDisconnectResult } from "./google-actions";

/**
 * S-22 slice 1, PR 3 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D3, D8, D12, D15, D16):
 * the Calendar page's "Google Calendar" card, read for the people who may change it (the agency and the account's
 * Owner, `canManage`; Staff and Technician get no card, D6). `null` is no card at all: the feature is dormant
 * without its environment (D15), or the reader may not manage it.
 *
 * The view is a WHITELIST. It carries the Google email and when we last checked, and nothing else from the row:
 * no scope, no expiry, no ciphertext, no id. The status accessor never selects the ciphertext (PR 1), and this
 * builder would not forward it if it did (google-card-data.test.ts pins both). Never throws: a failed read is
 * the card's own error state (DESIGN.md rule 5). Never logs a value.
 */
export type GoogleOutcome = "connected" | "denied" | "failed" | "paused";

/** What the Connect/Reconnect button turns into, and why. */
export type GoogleConnectOffer =
  | { kind: "link"; href: string }
  | { kind: "paused" }
  | { kind: "wrongOrigin"; origin: string };

export type GoogleCardBody =
  | { kind: "error" }
  | { kind: "empty"; connect: GoogleConnectOffer }
  | { kind: "connected"; email: string; lastCheckedAt: string | null }
  | { kind: "needsReconnect"; email: string; connect: GoogleConnectOffer };

export type GoogleCardView = { outcome: GoogleOutcome | null; body: GoogleCardBody };

const OUTCOMES: readonly string[] = ["connected", "denied", "failed", "paused"];

/** The `?google=` the callback leaves on the page: one of four words, anything else is ignored. */
export function parseGoogleOutcome(v: string | undefined): GoogleOutcome | null {
  return v !== undefined && OUTCOMES.includes(v) ? (v as GoogleOutcome) : null;
}

export type BuildGoogleCardInput = {
  accountId: string;
  /** The origin of the redirect URI (D8), or null when the feature is dormant. */
  redirectOrigin: string | null;
  canManage: boolean;
  isAgency: boolean;
  /** The account is paused for billing. Only a CLIENT is refused Connect by it; the agency never is. */
  paused: boolean;
  /** The origin this page was opened at. */
  origin: string;
  status: GoogleConnectionStatus | null | "error";
  outcome: GoogleOutcome | null;
};

export function buildGoogleCardView(a: BuildGoogleCardInput): GoogleCardView | null {
  if (a.redirectOrigin === null || !a.canManage) return null;
  const { outcome } = a;
  if (a.status === "error") return { outcome, body: { kind: "error" } };

  // Connecting switches access ON, so a paused client is refused; disconnecting only takes it away, so it stays.
  const connect: GoogleConnectOffer =
    !a.isAgency && a.paused ? { kind: "paused" }
    : a.origin !== a.redirectOrigin ? { kind: "wrongOrigin", origin: a.redirectOrigin }
    : { kind: "link", href: `/api/google-calendar/connect?account=${a.accountId}` };

  if (a.status === null) return { outcome, body: { kind: "empty", connect } };
  if (a.status.status === "needs_reconnect") {
    return { outcome, body: { kind: "needsReconnect", email: a.status.google_email, connect } };
  }
  return { outcome, body: { kind: "connected", email: a.status.google_email, lastCheckedAt: a.status.last_checked_at } };
}

export async function loadGoogleCardView(a: {
  accountId: string; isAgency: boolean; canManage: boolean; origin: string; outcome: GoogleOutcome | null;
}): Promise<GoogleCardView | null> {
  const cfg = googleCalendarConfig();
  if (!cfg || !a.canManage) return null;
  let status: GoogleConnectionStatus | null | "error";
  try {
    status = await getGoogleConnectionStatus(serviceDb(), a.accountId);
  } catch (e) {
    console.error(`calendar google card: status read failed for account ${a.accountId}: ${loggableError(e)}`);
    status = "error";
  }
  // Fails open (billingVerdictFor): a failed read is "not paused", and the connect route checks again.
  const paused = a.isAgency ? false : (await billingVerdictFor(a.accountId)).paused;
  return buildGoogleCardView({
    accountId: a.accountId, redirectOrigin: new URL(cfg.redirectUri).origin, canManage: a.canManage, isAgency: a.isAgency,
    paused, origin: a.origin, status, outcome: a.outcome,
  });
}

/** What Disconnect says when it is done: the toast, or the action's own error sentence. */
export function disconnectFeedback(r: GoogleDisconnectResult):
  { tone: "success"; key: "calendar.google.toast.disconnected" } | { tone: "error"; key: Extract<GoogleDisconnectResult, { ok: false }>["error"] } {
  return r.ok ? { tone: "success", key: "calendar.google.toast.disconnected" } : { tone: "error", key: r.error };
}

import { appendConsentEventGuarded, readConsentState, type ConsentMethod, type SupabaseClient } from "@bis/db";
import { openConsentToken, consentTokenSecrets, type ConsentTokenPayload } from "./token";

/**
 * The customer's own email stop and resubscribe (consent chain spec §4.3,
 * "Endpoints"), shared by the one-click endpoint and the /u page's actions.
 * Server only. Never logs a token or an address.
 *
 * Neither write carries a source_ref (spec §3, PR-2 S10: a token is a
 * reusable channel, never ONE event) — the guards make them idempotent:
 * an unsubscribe is refused over the customer's own stop (no second row) and
 * recorded over a staff one, so only the customer can lift it from then on
 * ((decision Q5), PR-2's S8 for texts); a resubscribe is refused when nothing is
 * stopped. Both write contact_id null, the token's contact in evidence (G3):
 * the contact may have been deleted since the email went out, and 0054's
 * composite key would refuse the row.
 */
export type TokenRead =
  | { ok: true; payload: ConsentTokenPayload }
  | { ok: false; why: "bad_token" | "not_configured" };

export function readUnsubscribeToken(token: unknown, env: NodeJS.ProcessEnv = process.env): TokenRead {
  const secrets = consentTokenSecrets(env);
  if (!secrets.current && !secrets.previous) return { ok: false, why: "not_configured" };
  const payload = openConsentToken(token, [secrets.current, secrets.previous]);
  return payload ? { ok: true, payload } : { ok: false, why: "bad_token" };
}

function evidenceOf(p: ConsentTokenPayload): Record<string, unknown> {
  return {
    issuedAt: new Date(p.i).toISOString(),
    ...(p.k ? { kind: p.k } : {}),
    ...(p.n ? { contactId: p.n } : {}),
  };
}

export async function recordUnsubscribe(
  db: SupabaseClient, p: ConsentTokenPayload, via: "one_click" | "unsubscribe_link",
): Promise<"stopped" | "already_stopped"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: p.a, channel: "email", address: p.t, action: "revoked", method: via,
    contactId: null, evidence: evidenceOf(p),
  }, "unless_customer_stopped");
  return r.outcome === "appended" ? "stopped" : "already_stopped";
}

export async function recordResubscribe(db: SupabaseClient, p: ConsentTokenPayload): Promise<"resubscribed" | "was_allowed"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: p.a, channel: "email", address: p.t, action: "resubscribed", method: "unsubscribe_page",
    contactId: null, evidence: evidenceOf(p),
  }, "if_stopped_or_held");
  return r.outcome === "appended" ? "resubscribed" : "was_allowed";
}

/** The customer's OWN ways to stop email (choice 19). Only these open the page on "You're unsubscribed". */
export const CUSTOMER_EMAIL_STOP_METHODS: readonly ConsentMethod[] = ["unsubscribe_link", "one_click"];

export type EmailStateRead = { state: "allowed" } | { state: "stopped"; method: ConsentMethod };

/** The address's email state, with the stop's METHOD (review R1-I1). A hold, which nothing writes for email, reads as stopped. */
export async function emailStateOf(db: SupabaseClient, p: ConsentTokenPayload): Promise<EmailStateRead> {
  const s = await readConsentState(db, p.a, "email", p.t);
  return s.state === "allowed" ? { state: "allowed" } : { state: "stopped", method: s.method };
}

/**
 * What the page opens on (decision Q5, review R1-I1). "You're unsubscribed"
 * ONLY over the customer's own stop. Over a stop staff made, the 0049 fold
 * made, or a hold, the customer has not acted yet: the page asks, and their
 * press is recorded under `unless_customer_stopped`, so from then on only they
 * can lift it (choice 19) and the drawer offers no Resume.
 */
export function pageStateOf(s: EmailStateRead): "ask" | "stopped" {
  return s.state === "stopped" && CUSTOMER_EMAIL_STOP_METHODS.includes(s.method) ? "stopped" : "ask";
}

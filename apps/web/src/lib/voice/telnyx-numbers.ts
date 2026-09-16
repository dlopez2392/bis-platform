/**
 * The carrier half of a phone number: reading and writing Telnyx's own voice
 * routing for the numbers this platform answers on.
 *
 * Shaped after lib/sms/telnyx.ts — same bearer auth, same explicit timeout,
 * same "throw with the body on a non-2xx" — because the reasoning there
 * applies here too: these calls sit inside a page render and a server action,
 * and a hanging carrier must not hold either open for the function's whole
 * timeout.
 *
 * Endpoints, verified against Telnyx's API reference rather than remembered:
 *   GET   /v2/phone_numbers?page[size]=…   list, with connection_id per number
 *   PATCH /v2/phone_numbers/{id}           body { connection_id }
 *
 * The LIST is deliberate. `filter[phone_number]` exists, but it matches on as
 * few as three digits, so a per-number lookup is both N requests and a
 * substring match that can return a neighbour. One listing, matched by exact
 * E.164 in `indexByE164`, is one request regardless of how many numbers the
 * inventory holds and cannot mismatch.
 */

import type { TelnyxNumberFacts } from "./number-routing";

const TELNYX_PHONE_NUMBERS_URL = "https://api.telnyx.com/v2/phone_numbers";

/** Inside a page render and a server action; the carrier does not get to
 *  hold either open for the platform's whole function timeout. */
const TIMEOUT_MS = 8_000;

/** Telnyx pages at 250 max. Four pages is a thousand numbers — far past any
 *  plausible size for this agency, and a hard stop rather than a `while(true)`
 *  that a malformed `meta` could spin forever. */
const PAGE_SIZE = 250;
const MAX_PAGES = 4;

export interface TelnyxNumber extends TelnyxNumberFacts {
  /** +E.164, exactly as Telnyx stores it. The join key — see indexByE164. */
  phoneNumber: string;
  /** Telnyx's own lifecycle state ("active", "port-pending", …). Carried for
   *  the operator's benefit; the routing verdict does not read it. */
  status: string | null;
}

type RawNumber = {
  id?: unknown;
  phone_number?: unknown;
  connection_id?: unknown;
  connection_name?: unknown;
  status?: unknown;
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

async function telnyxFetch(
  url: string, apiKey: string, init: RequestInit = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      // Never a cached carrier fact: this is the live state of a phone line,
      // and Next would otherwise happily serve a stale one into a page whose
      // whole purpose is to report what is true right now.
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`telnyx ${init.method ?? "GET"} ${url} failed (${res.status}): ${text}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every number on the Telnyx account this key can see.
 *
 * A row whose `id` or `phone_number` is missing is DROPPED rather than
 * half-parsed: both are the join key and the repair handle, and a record
 * carrying neither cannot be matched to one of our numbers or acted on. A
 * dropped row shows up as "absent" on the screen, which is the truthful
 * reading — we did not find it.
 */
export async function listTelnyxNumbers(apiKey: string): Promise<TelnyxNumber[]> {
  const out: TelnyxNumber[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${TELNYX_PHONE_NUMBERS_URL}?page[size]=${PAGE_SIZE}&page[number]=${page}`;
    const text = await telnyxFetch(url, apiKey);
    const parsed = JSON.parse(text) as { data?: unknown };
    const rows = Array.isArray(parsed.data) ? (parsed.data as RawNumber[]) : [];
    for (const r of rows) {
      const id = str(r.id);
      const phoneNumber = str(r.phone_number);
      if (!id || !phoneNumber) continue;
      out.push({
        id,
        phoneNumber,
        connectionId: str(r.connection_id),
        connectionName: str(r.connection_name),
        status: str(r.status),
      });
    }
    // A short page is the last page. Telnyx also returns `meta.total_pages`,
    // but a length check needs no trust in a field we would have to validate.
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Points one number's VOICE routing at a connection.
 *
 * The only write this module makes, and it writes exactly one field. Callers
 * pass our own TeXML application id and nothing else — see the action's own
 * guard. A PATCH that cleared a connection, or set an arbitrary one supplied
 * from a browser, would be a way to take a paying client's phone line down
 * from a web form.
 */
export async function setTelnyxVoiceConnection(
  apiKey: string, telnyxNumberId: string, connectionId: string,
): Promise<void> {
  await telnyxFetch(`${TELNYX_PHONE_NUMBERS_URL}/${encodeURIComponent(telnyxNumberId)}`, apiKey, {
    method: "PATCH",
    body: JSON.stringify({ connection_id: connectionId }),
  });
}

/**
 * The two values the carrier half needs, read once.
 *
 * `TELNYX_API_KEY` already exists for SMS. `TELNYX_VOICE_CONNECTION_ID` is
 * new: the id of the `BIS Platform Voice` TeXML application (runbook Step 3).
 * Either one missing means the routing column reports "unchecked" and no
 * repair is offered anywhere — never a guess, and never a write.
 */
export type TelnyxRoutingEnv = {
  TELNYX_API_KEY?: string;
  TELNYX_VOICE_CONNECTION_ID?: string;
};

export function telnyxRoutingConfig(
  env: TelnyxRoutingEnv = process.env as TelnyxRoutingEnv,
): { apiKey: string | null; connectionId: string | null } {
  return {
    apiKey: env.TELNYX_API_KEY?.trim() || null,
    connectionId: env.TELNYX_VOICE_CONNECTION_ID?.trim() || null,
  };
}

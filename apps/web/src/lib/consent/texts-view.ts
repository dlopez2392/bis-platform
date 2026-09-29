import {
  consentStateOf, newestDecidingRow, readConsentHistory,
  type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { keywordDisplay } from "./keywords";

/**
 * The contact's Texts row (consent chain spec §6), as data: what the ledger
 * says about their number, in the gate's own order (plan G18) — Stopped, On
 * hold, Check number, Allowed. Server-only (it reads the ledger and judges
 * the number); the row itself imports only the TYPES.
 */
export type TextsHow =
  | { kind: "keyword"; word: string }
  | { kind: "free_text"; excerpt: string | null; by: string | null }
  | { kind: "staff" }
  | { kind: "carrier" }
  | { kind: "unsubscribe_link" };

export type TextsView =
  | { kind: "no_number" }
  | { kind: "check_number" }
  | { kind: "allowed"; newestId: string | null }
  | { kind: "stopped"; eventId: string; since: string; how: TextsHow; canResume: boolean }
  | { kind: "held"; eventId: string; since: string; excerpt: string | null };

/** Choice 19: staff may resume only a stop staff recorded, staff confirmed, or staff's 0049 switch. */
export const RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "free_text", "backfill_0049"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function howOf(row: ConsentHistoryRow): TextsHow {
  switch (row.method) {
    case "keyword": return { kind: "keyword", word: keywordDisplay(str(row.evidence.keyword) ?? "STOP") };
    case "free_text": return { kind: "free_text", excerpt: str(row.evidence.excerpt), by: str(row.evidence.actorName) };
    case "carrier_block":
    case "backfill_telnyx": return { kind: "carrier" };
    case "unsubscribe_link":
    case "one_click":
    case "unsubscribe_page": return { kind: "unsubscribe_link" };
    default: return { kind: "staff" };   // staff, staff_undo, backfill_0049
  }
}

export function textsViewOf(rows: readonly ConsentHistoryRow[], number: { unconfirmed: boolean } | null): TextsView {
  if (number === null) return { kind: "no_number" };
  const state = consentStateOf(rows);
  if (state.state === "stopped") {
    const row = rows.find((r) => r.id === state.eventId);
    return {
      kind: "stopped", eventId: state.eventId, since: state.since,
      how: row ? howOf(row) : { kind: "staff" }, canResume: RESUMABLE_METHODS.includes(state.method),
    };
  }
  if (state.state === "held") {
    const row = rows.find((r) => r.id === state.eventId);
    return { kind: "held", eventId: state.eventId, since: state.since, excerpt: row ? str(row.evidence.excerpt) : null };
  }
  if (number.unconfirmed) return { kind: "check_number" };
  return { kind: "allowed", newestId: newestDecidingRow(rows)?.id ?? null };
}

/** The contact's Texts row, read. THROWS on an unreadable ledger (the row shows its error line). */
export async function readTextsView(
  db: SupabaseClient, accountId: string, contact: { phone: string | null; phone_country_unconfirmed?: boolean | null },
): Promise<TextsView> {
  const number = normalisePhone(contact.phone);
  if (!number) return { kind: "no_number" };
  const rows = await readConsentHistory(db, accountId, "sms", number.e164);
  return textsViewOf(rows, { unconfirmed: contact.phone_country_unconfirmed === true || number.unconfirmed });
}

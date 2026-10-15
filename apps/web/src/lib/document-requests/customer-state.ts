import { removedReason, type DocumentRequestItem } from "@bis/db/document-rules";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** Browser-safe: what the customer's page says about each file (spec 4.3), and when it re-reads (plan deviation 10). */
export type CustomerFileState = "checking" | "received" | "virus" | "password" | "unscannable";

/** Not ready (still uploading) is not shown. The reason a file was removed is 2a's removedReason, the one source. */
export function customerFileState(f: { ready: boolean; scanStatus: string; scanSignature: string | null }): CustomerFileState | null {
  if (!f.ready) return null;
  if (f.scanStatus === "clean") return "received";
  if (f.scanStatus === "pending") return "checking";
  const why = removedReason(f.scanStatus, f.scanSignature);
  return why === "virus" ? "virus" : why === "password" ? "password" : "unscannable";
}

export const CUSTOMER_STATE_KEY: Record<CustomerFileState, MessageKey> = {
  checking: "customerDocs.checking", received: "customerDocs.received",
  virus: "customerDocs.why.virus", password: "customerDocs.why.password", unscannable: "customerDocs.why.unscannable",
};

export function itemLabel(item: DocumentRequestItem, locale: "en" | "es"): string {
  return item.category === "other" && item.note ? item.note : t(m, `documents.category.${item.category}` as MessageKey, locale);
}
export const itemsSentence = (items: readonly DocumentRequestItem[], locale: "en" | "es"): string => items.map((i) => itemLabel(i, locale)).join(", ");

const FAST_MS = 5_000;
const SLOW_MS = 15_000;
const FAST_FOR_MS = 60_000;
const GIVE_UP_MS = 15 * 60_000;
export type CustomerFile = { state: CustomerFileState; ageMs: number };
/**
 * Re-read while a file is Checking, by the YOUNGEST Checking file's own age (server now minus its
 * version's created_at; plan review I9), never by when the page was opened: every 5 s for its first
 * minute, then every 15 s, and not after 15 minutes. One signature everywhere (plan review M6).
 */
export function nextCustomerPollMs(files: readonly CustomerFile[]): number | null {
  const ages = files.filter((f) => f.state === "checking").map((f) => f.ageMs);
  if (ages.length === 0) return null;
  const youngest = Math.min(...ages);
  if (youngest > GIVE_UP_MS) return null;
  return youngest <= FAST_FOR_MS ? FAST_MS : SLOW_MS;
}
/** The effect's key: it MUST change on every read, or the timer fires once (2a Task 9's defect). */
export const pollKey = (ms: number | null, reads: number): string => `${ms ?? "off"}:${reads}`;

/** A US/Canada number as a person reads it, "(956) 555-0123"; any other number unchanged. */
export function formatPhone(e164: string): string {
  const d = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return d ? `(${d[1]}) ${d[2]}-${d[3]}` : e164;
}

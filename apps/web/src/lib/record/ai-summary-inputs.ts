import { createHash } from "node:crypto";
import { contactFacts, listContactCalls, type SupabaseClient } from "@bis/db";

/**
 * The record summary's inputs (item 8a-2, spec 4.3, 4.4; plan deviations 8-12). Read on the REQUEST
 * client, so RLS (0068's Technician fence, 0077's Owners-only fence) decides as it does for the page; the
 * explicit owners_only = false removes the one row-level difference between members (spec 4.3), so every
 * reader who can open the record builds the same inputs. NEVER a message, email, chat or note body: the
 * last-talked fact reads conversations.id and messages.channel/created_at only (record.ts:58-71). No phone,
 * email, address, custom field or tag; every free text is redacted (plan fix M4). Every list is capped,
 * every text cut. THROWS on any failed read: a summary is never written from partial inputs.
 */
export type SummaryContact = { id: string; first_name: string | null; language: string | null; created_at: string; source: string | null };
export type SummaryInputs = {
  who: { firstName: string | null; language: "en" | "es" | null; since: string; source: string | null };
  facts: { bookingsMade: number; lastTalked: { channel: "text" | "email" | "call" | "chat"; on: string } | null; openDeals: { count: number; amount: number | null } };
  bookings: { at: string; status: string }[];
  nextBooking: { at: string; status: string } | null;
  deals: { name: string; stage: string | null; amount: number }[];
  todos: { title: string; due: string | null }[];
  documents: { title: string; category: string }[];
  calls: { on: string; outcome: string; summary: string }[];
};
export const INPUT_LIMITS = { bookings: 5, deals: 10, todos: 10, documents: 10, calls: 5, title: 120, summary: 600, short: 60 } as const;

const cut = (s: string | null | undefined, n: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const cutOrNull = (s: string | null | undefined, n: number): string | null => cut(s, n) || null;

function parts(iso: string, zone: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}
export const localDay = (iso: string, zone: string): string => { const x = parts(iso, zone); return `${x.y}-${x.m}-${x.d}`; };
export const localMinute = (iso: string, zone: string): string => { const x = parts(iso, zone); return `${x.y}-${x.m}-${x.d} ${x.h}:${x.min}`; };

/** Phone numbers and email addresses out of free text (I6). Seven or more digits is a number; an ISO date is not. */
export function redactContactDetails(text: string): string {
  return text
    .replace(/[^\s@<>()"]+@[^\s@<>()"]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\(?\d[\d\s().-]{5,}\d/g, (s) => (s.replace(/\D/g, "").length >= 7 && !/^\d{4}-\d{2}-\d{2}$/.test(s) ? "[number]" : s));
}

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`summary inputs: ${label} read failed: ${r.error.message}`);
  return (r.data ?? []) as T;
}

type BookingRow = { starts_at: string; status: string };

export async function buildSummaryInputs(
  db: SupabaseClient, a: { accountId: string; contact: SummaryContact; zone: string; now: Date },
): Promise<SummaryInputs> {
  const { accountId, contact, zone } = a;
  const contactId = contact.id;
  const L = INPUT_LIMITS;
  const [facts, bookings, next, deals, todos, documents, calls] = await Promise.all([
    contactFacts(db, accountId, contactId),
    db.from("bookings").select("starts_at, status").eq("account_id", accountId).eq("contact_id", contactId)
      .order("starts_at", { ascending: false }).limit(L.bookings),
    db.from("bookings").select("starts_at, status").eq("account_id", accountId).eq("contact_id", contactId)
      .eq("status", "booked").gte("starts_at", a.now.toISOString()).order("starts_at", { ascending: true }).limit(1),
    db.from("opportunities").select("name, monetary_value, stage_id").eq("account_id", accountId).eq("contact_id", contactId)
      .eq("status", "open").order("created_at", { ascending: false }).limit(L.deals),
    db.from("tasks").select("title, due_at").eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).order("created_at", { ascending: false }).limit(L.todos),
    db.from("documents").select("title, category").eq("account_id", accountId).eq("contact_id", contactId)
      .is("deleted_at", null).eq("owners_only", false).order("created_at", { ascending: false }).limit(L.documents),
    listContactCalls(db, accountId, contactId, L.calls, { excludeSpam: true }),
  ]);
  // contactFacts never throws (record.ts:99-112): a fact that answers { ok: false } is a failed read (plan deviation 11).
  if (!facts.bookingsMade.ok || !facts.lastTalked.ok || !facts.openDeals.ok) throw new Error("summary inputs: facts read failed");
  const dealRows = must<{ name: string; monetary_value: number | string; stage_id: string }[]>("opportunities", deals);
  const stageIds = [...new Set(dealRows.map((d) => d.stage_id))];
  const stages = new Map<string, string>();
  if (stageIds.length > 0) {
    const s = must<{ id: string; name: string }[]>("pipeline_stages",
      await db.from("pipeline_stages").select("id, name").eq("account_id", accountId).in("id", stageIds));
    for (const row of s) stages.set(row.id, row.name);
  }
  const booking = (b: BookingRow) => ({ at: localMinute(b.starts_at, zone), status: b.status });
  const nextRows = must<BookingRow[]>("bookings", next);
  const talked = facts.lastTalked.value;
  return {
    who: {
      firstName: cutOrNull(contact.first_name, L.short),
      language: contact.language === "en" || contact.language === "es" ? contact.language : null,
      since: localDay(contact.created_at, zone).slice(0, 7),
      // Every free text a person typed goes through the redactor (plan fix M4), not only call summaries.
      source: cutOrNull(redactContactDetails(contact.source ?? ""), L.short),
    },
    facts: {
      bookingsMade: facts.bookingsMade.value,
      lastTalked: talked ? { channel: talked.channel, on: localDay(talked.at, zone) } : null,
      openDeals: facts.openDeals.value,
    },
    bookings: must<BookingRow[]>("bookings", bookings).map(booking),
    nextBooking: nextRows[0] ? booking(nextRows[0]) : null,
    deals: dealRows.map((d) => ({ name: cut(redactContactDetails(d.name), L.title), stage: cutOrNull(stages.get(d.stage_id), L.short), amount: Number(d.monetary_value) })),
    todos: must<{ title: string; due_at: string | null }[]>("tasks", todos).map((t) => ({ title: cut(redactContactDetails(t.title), L.title), due: t.due_at ? localDay(t.due_at, zone) : null })),
    documents: must<{ title: string; category: string }[]>("documents", documents).map((d) => ({ title: cut(redactContactDetails(d.title), L.title), category: d.category })),
    calls: calls.map((k) => ({ on: localDay(k.started_at, zone), outcome: k.outcome, summary: cut(redactContactDetails(k.summary ?? ""), L.summary) })),
  };
}

/** Nothing to summarise (spec 4.3): the facts line alone says all there is, so the route answers none. */
export function hasSomethingToSay(i: SummaryInputs): boolean {
  return i.bookings.length > 0 || i.nextBooking !== null || i.deals.length > 0 || i.todos.length > 0
    || i.documents.length > 0 || i.calls.some((k) => k.summary !== "");
}

/** Keys sorted at every depth; arrays keep their order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The digest covers the prompt version too (plan deviation 12): a new prompt rewrites every cached paragraph. */
export function inputDigest(i: SummaryInputs, version: number): string {
  return createHash("sha256").update(canonicalJson({ v: version, inputs: i })).digest("hex");
}

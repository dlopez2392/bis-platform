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
export type SummaryContact = { id: string; first_name: string | null; last_name: string | null; language: string | null; created_at: string; source: string | null };
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

/** A date, with or without the hour after it (a match stops at ":"), is not a phone number: 2026-10-14,
 *  "2026-10-14 10" (of 10:30), 10/14/2026, 14.10.2026, 10-14-2026. Tested without a leading "(" or "+". */
const DATE_SHAPES = [/^\d{4}-\d{2}-\d{2}(\s+\d{1,2})?$/, /^\d{1,2}[-./]\d{1,2}[-./]\d{4}(\s+\d{1,2})?$/];

/** Phone numbers and email addresses out of free text (I6). Seven or more digits is a number, with spaces,
 *  dots, hyphens, en dashes, slashes or brackets between them; a date is not. */
export function redactContactDetails(text: string): string {
  return text
    .replace(/[^\s@<>()"]+@[^\s@<>()"]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\(?\d[\d\s().\-–/]{5,}\d/g, (s) => {
      const core = s.replace(/^[+(]+/, "");
      return s.replace(/\D/g, "").length >= 7 && !DATE_SHAPES.some((d) => d.test(core)) ? "[number]" : s;
    });
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Accents off ("García" -> "Garcia"), so a stored name and a typed one match either way round. */
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "");
/** A straight and a curly apostrophe are one character in a name: stored O'Brien is typed O’Brien, and back. */
const APOSTROPHE = "['’]";
/** A name as a pattern: accent-folded, escaped, either apostrophe, any run of spaces between its words. */
const namePattern = (s: string): string => escapeRe(fold(s)).replace(/['’]/g, APOSTROPHE).replace(/\s+/g, "\\s+");
/** A name as an any-case pattern, accent-folded: "Ana María" -> "[aA][nN][aA]\s+[mM][aA][rR][iI][aA]". Spelled
 *  out rather than the `i` flag, because the patterns that use it also need a case-SENSITIVE `\p{Lu}`. */
const anyCase = (s: string): string => fold(s).trim().split(/\s+/)
  .map((w) => [...w].map((ch) => {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    if (ch === "'" || ch === "’") return APOSTROPHE;
    return lo !== up && [...lo].length === 1 && [...up].length === 1 ? `[${lo}${up}]` : escapeRe(ch);
  }).join(""))
  .join("\\s+");
/** Not inside a longer word, in any script (\b knows only ASCII letters, so it would split "Núñez"). */
const L_ = "[\\p{L}\\p{N}]";
/** A capitalised word: a middle name, or a first name the stored record does not hold. */
const CAP_WORD = "\\p{Lu}\\p{L}*";
/** Honorifics before a name, in any case, accent-folded because matching runs on folded text ("Señora" is
 *  "senora", "Doña" is "dona"). What keeps "Señora" from being read as "Señor" is the REQUIRED separator after
 *  every honorific (a period or a space, never a letter), not the order of this list; it is kept longest first
 *  only for readability. The same separator makes "Dra." the "dra" honorific, not "Dr" + "a", and keeps "Dr"
 *  off the end of "Andr". Miss and Ms need their capital (round 3): "Don't miss Flores Road" and "the ms Mesa
 *  table" are not names. */
const LONG_HONORIFIC = `(?:${[
  ...["senorita", "senora", "senor", "licda", "sres", "sras", "srta", "dona", "dra", "sra", "mrs", "don", "mr", "sr"].map(anyCase),
  `M${anyCase("iss")}`,
  `M${anyCase("s")}`,
].join("|")})`;
/** Short honorifics that are also ordinary words or abbreviations ("Prof Price list", "Oak dr", "Ing Flores"):
 *  they need their period (round 4), except in all-capital text, where "DR FLORES" has no other reading. */
const SHORT_HONORIFICS = ["prof", "lic", "ing", "mx", "dr"];
const SHORT_HONORIFIC = `(?:${SHORT_HONORIFICS.map(anyCase).join("|")})`;
const SHORT_HONORIFIC_CAPS = `(?:${SHORT_HONORIFICS.map((h) => h.toUpperCase()).join("|")})`;
/** A name as it is written when it reads as a name: as stored or in full capitals (accents aside), never in
 *  any other case. "price" and "pRICE" are words; "Price" and "PRICE" may be the customer. */
const storedOrCaps = (c: string): string => {
  const stored = namePattern(c);
  const caps = namePattern(c.toUpperCase());
  return stored === caps ? stored : `(?:${stored}|${caps})`;
};
const FAMILY = `(?:${anyCase("familia")}|${anyCase("family")})`;

/** `re` runs on the accent-folded text; each match is replaced in the ORIGINAL text, so accents elsewhere
 *  survive. `by` may be a function of the match, given `orig(from, to)`: that span of the ORIGINAL text, in
 *  folded offsets. */
function replaceFolded(text: string, re: RegExp, by: string | ((m: RegExpExecArray, orig: (from: number, to: number) => string) => string)): string {
  const start: number[] = [];
  const end: number[] = [];
  let folded = "";
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = fold(ch);
    // A combining mark folds to nothing: it belongs to the character before it.
    if (f === "" && end.length > 0) end[end.length - 1] = i + ch.length;
    for (let k = 0; k < f.length; k++) { start.push(i); end.push(i + ch.length); }
    folded += f;
    i += ch.length;
  }
  let out = "";
  let at = 0;
  for (const m of folded.matchAll(re)) {
    if (m[0].length === 0) continue;
    const s = start[m.index]!;
    const orig = (from: number, to: number) => (to > from ? text.slice(start[from]!, end[to - 1]!) : "");
    out += text.slice(at, s) + (typeof by === "string" ? by : by(m as RegExpExecArray, orig));
    at = end[m.index + m[0].length - 1]!;
  }
  return out + text.slice(at);
}

/**
 * The customer's last name out of free text (review I1): the expiry pass writes "{first last}'s ID expires on
 * {date}" into To-do titles (lib/documents/expiry-task.ts). Owner ruling 2026-10-18, "only where it's a name":
 * - the full name becomes its first name as written there ("Ana María Flores" -> "Ana María"), which the model
 *   is given anyway. The first name matches in any case; the last name only as stored or in full capitals
 *   (orchestrator ruling, round 4), so "Will price the job" and "ana price check" stay. Up to two capitalised
 *   middle names may sit between, but only when the last name is NOT followed by another capitalised word:
 *   "Sra. Ana María Flores llamó" is a name, "Call Ana About Price Quote" and "Ana Fence Flores Road" are
 *   Title Case text, and deleting a word from them would leave no mark (round 4). Residual: a title that ends
 *   on the last name ("Call Ana About Price") still loses it.
 * - the last name on its own becomes "[name]" ONLY where it reads as a name: written as stored or in full
 *   capitals (accents aside) AND with a cue directly beside it: an honorific before it (Mrs. Flores, la señora
 *   Flores, Prof. Flores, DR FLORES), a possessive after it (Flores's, the Flores' office) or "family"/"familia"
 *   (the Flores family, familia Flores). So "a price for the fence", "Send Bill the bill" and "plantar flores"
 *   stay as they are. No words between an honorific and the last name (round 4): "Mr. Smith Lawn Price list"
 *   has the same shape as "Sra. Lupe María Flores", and the honorific-plus-first-name case is the full name's.
 * - a compound name ("de la Garza", "García López") is matched whole, by its final part, and (two parts
 *   only) by its first part, in those same cue positions; a lowercase particle ("de", "la") never alone.
 * ACCEPTED RESIDUAL (same ruling): a bare capitalised last name with no cue, such as "Flores called" at the
 * start of a sentence, passes through.
 */
export function redactName(text: string, first: string | null, last: string | null): string {
  const l = (last ?? "").trim();
  if (!l) return text;
  const f = (first ?? "").trim();
  let out = text;
  if (f) {
    // Group 1 is the first name as written (the stored one whole, or its first word plus one or two middle
    // names); it stays, and the last name after it goes. Middle names only when no capitalised word follows.
    const firstWord = f.split(/\s+/)[0]!;
    const last = storedOrCaps(l);
    const middles = `(?:\\s+${CAP_WORD}){1,2}(?=\\s+${last}(?!${L_})(?!\\s+\\p{Lu}))`;
    const full = new RegExp(`(?<!${L_})(${anyCase(f)}|${anyCase(firstWord)}(?:${middles})?)\\s+${last}(?!${L_})`, "gu");
    out = replaceFolded(out, full, (m, orig) => orig(m.index, m.index + m[1]!.length));
  }
  const parts = l.split(/[\s-]+/).filter(Boolean);
  // The whole stored name, then its final part and (two parts only) its first, a part only when it is
  // capitalised (so never the particle "de" or "la"); longest first, so "García López" goes before "García".
  const pieces = [...(parts.length > 1 ? [parts[parts.length - 1]!] : []), ...(parts.length === 2 ? [parts[0]!] : [])]
    .filter((c) => /^\p{Lu}/u.test(c));
  const candidates = [...new Set([l, ...pieces])].sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    // The stored form or full capitals, and nothing else: the capitalisation is half of "reads as a name".
    const n = storedOrCaps(c);
    const cue = [
      `(?<=(?<!${L_})${LONG_HONORIFIC}(?:\\.\\s*|\\s+))${n}(?!${L_})`,
      `(?<=(?<!${L_})${SHORT_HONORIFIC}\\.\\s*)${n}(?!${L_})`,
      `(?<=(?<!${L_})${SHORT_HONORIFIC_CAPS}\\s+)${namePattern(c.toUpperCase())}(?!${L_})`,
      `(?<!${L_})${n}(?=['’](?:[sS](?!${L_})|(?!${L_})))`,
      `(?<!${L_})${n}(?=\\s+${FAMILY}(?!${L_}))`,
      `(?<=(?<!${L_})${FAMILY}\\s+)${n}(?!${L_})`,
    ];
    out = replaceFolded(out, new RegExp(cue.join("|"), "gu"), "[name]");
  }
  return out;
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
  const failedFacts: string[] = [];
  // Every free text a person typed goes through both redactors (plan fix M4, review I1), BEFORE it is cut.
  const free = (t: string | null | undefined): string => redactContactDetails(redactName(t ?? "", contact.first_name, contact.last_name));
  const desc = { ascending: false } as const;
  const [facts, bookings, next, deals, todos, documents, calls] = await Promise.all([
    contactFacts(db, accountId, contactId, {
      onError: (name, e) => { failedFacts.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); },
    }),
    db.from("bookings").select("starts_at, status").eq("account_id", accountId).eq("contact_id", contactId)
      .order("starts_at", desc).order("id", desc).limit(L.bookings),
    db.from("bookings").select("starts_at, status").eq("account_id", accountId).eq("contact_id", contactId)
      .eq("status", "booked").gte("starts_at", a.now.toISOString())
      .order("starts_at", { ascending: true }).order("id", { ascending: true }).limit(1),
    db.from("opportunities").select("name, monetary_value, stage_id").eq("account_id", accountId).eq("contact_id", contactId)
      .eq("status", "open").order("created_at", desc).order("id", desc).limit(L.deals),
    db.from("tasks").select("title, due_at").eq("account_id", accountId).eq("contact_id", contactId)
      .is("completed_at", null).order("created_at", desc).order("id", desc).limit(L.todos),
    // Only a file with a ready version, as the Documents card lists it (packages/db/src/documents.ts):
    // an upload that never finished is on no screen, so it is not in the summary (final review I-2).
    db.from("documents").select("title, category").eq("account_id", accountId).eq("contact_id", contactId)
      .not("current_version_id", "is", null).is("deleted_at", null).eq("owners_only", false).order("created_at", desc).order("id", desc).limit(L.documents),
    listContactCalls(db, accountId, contactId, L.calls, { excludeSpam: true }),
  ]);
  // contactFacts never throws (record.ts:99-112): a fact that answers { ok: false } is a failed read (plan deviation 11),
  // named in the error through onError (review M7). Error text only, never a row.
  if (!facts.bookingsMade.ok || !facts.lastTalked.ok || !facts.openDeals.ok) {
    throw new Error(`summary inputs: facts read failed (${failedFacts.join("; ") || "unnamed"})`);
  }
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
      source: cutOrNull(free(contact.source), L.short),
    },
    facts: {
      bookingsMade: facts.bookingsMade.value,
      lastTalked: talked ? { channel: talked.channel, on: localDay(talked.at, zone) } : null,
      openDeals: facts.openDeals.value,
    },
    bookings: must<BookingRow[]>("bookings", bookings).map(booking),
    nextBooking: nextRows[0] ? booking(nextRows[0]) : null,
    deals: dealRows.map((d) => ({ name: cut(free(d.name), L.title), stage: cutOrNull(stages.get(d.stage_id), L.short), amount: Number(d.monetary_value) })),
    todos: must<{ title: string; due_at: string | null }[]>("tasks", todos).map((t) => ({ title: cut(free(t.title), L.title), due: t.due_at ? localDay(t.due_at, zone) : null })),
    documents: must<{ title: string; category: string }[]>("documents", documents).map((d) => ({ title: cut(free(d.title), L.title), category: d.category })),
    calls: calls.map((k) => ({ on: localDay(k.started_at, zone), outcome: k.outcome, summary: cut(free(k.summary), L.summary) })),
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

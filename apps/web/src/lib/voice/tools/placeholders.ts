// S-47b v3 (corpus run 2, 2026-10-22): a placeholder value never gets stored. ON EVERY ACCOUNT, not only the
// trade modules: the prompt has forbidden placeholders since v2, and run 2 still wrote "User", "Best time: no
// se indicó" and "Guests: not specified" into tool arguments, so the guard is in code. Narrow on purpose: a
// value is dropped only when it IS a placeholder, whole (or one whole "Label: value" segment of a one-line
// need, or one whole comma part of such a segment's value); a real value that merely contains one of these
// words ("Guest House LLC", "Usera", "Nonestop Plumbing", "anytime after 3pm") is never touched.
//
// What was dropped goes back to the model in the tool result (droppedNote), so she asks instead of guessing.
// A result with nothing dropped is byte-identical to what it was before this file.
//
// Pure and import-free: registry.ts (the phone), the concierge turn route (the website chat) and the corpus
// stub (modules/corpus-lib.ts, run by tsx with no alias resolution) all import THIS file, so the corpus
// shows what the live code does.

export type DroppedWhy = "placeholder" | "filler" | "email_name";
export type Dropped = { field: string; value: string; why: DroppedWhy };

/** Lower case, accents off, one space, no wrapping quotes or trailing punctuation. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^["'“”«»(\[]+/, "").replace(/["'“”«»)\].,;:!?]+$/, "").trim();
}

/** Says nothing was given, in any field. NOT "none" / "ninguno" / "ninguna" (review fix): those are real answers
 *  ("Current: none" is no current insurer, "Guests: none yet"), and dropping them loses information. */
const GENERIC = new Set([
  "not specified", "unspecified", "n/a", "not given",
  "no se indico", "no especificado", "no especificada", "sin especificar",
]);
/** "I don't know" is a real answer (review I-2: "Injuries: unknown" on an urgent message must survive), so these
 *  are stand-ins ONLY as a whole name or contact value, never inside a need, a message or notes. */
const UNKNOWN = new Set(["unknown", "desconocido", "desconocida"]);
/** A stand-in for a name. Multi-word phrases (contact-archive spec §7.2(c), §7.3) are Sofía's own observed
 *  stand-ins for "I don't have a name" — added here, not to UNKNOWN, because none of them is ever a placeholder
 *  CONTACT value (a phone or email). Whole-value match only (review of `norm`, above): "Anonymous Plumbing"
 *  contains "anonymous" but is not equal to it, so it is never touched. */
const NAME_STANDINS = new Set([
  "user", "guest", "customer", "cliente", "caller",
  "unknown caller", "no name", "not provided", "sin nombre", "no proporcionado", "no dio su nombre",
  "anonymous", "anonimo",
]);
/** "Any time" as a best time is a filler, not a time they gave (only ever judged as a best time, and only where
 *  what they said is known and never mentions it: review M-4). */
const FILLER_TIMES = new Set(["any time", "anytime", "cualquier hora", "a cualquier hora"]);
/** Best-time labels, letters only: "Best time", "Mejor hora". */
const BEST_TIME_KEYS = new Set(["besttime", "besttimetocall", "besttimetoreach", "mejorhora", "mejorhorario", "mejormomento"]);
const NAME_KEYS = new Set(["fullname", "name", "firstname", "lastname"]);
const keyOf = (s: string) => norm(s).replace(/[^a-z]/g, "");

export function isPlaceholderValue(value: string): boolean {
  return GENERIC.has(norm(value));
}
export function isPlaceholderName(value: string): boolean {
  const v = norm(value);
  return GENERIC.has(v) || UNKNOWN.has(v) || NAME_STANDINS.has(v);
}
/** A whole phone number or email value that is no contact at all. */
export function isPlaceholderContact(value: string): boolean {
  const v = norm(value);
  return GENERIC.has(v) || UNKNOWN.has(v);
}
export function isFillerBestTime(value: string): boolean {
  return FILLER_TIMES.has(norm(value));
}

/** Where a "Label: value" segment starts: the line's start, or after . ; , ! ? and a space. */
const LABEL = /(\p{L}+(?: \p{L}+){0,3}):[ \t]+/gu;
/** A period after one of these is an abbreviation, not the end of a segment (review M-3: "Mr. Smith: n/a"). */
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|sr|sra|srta|jr|e\.g|i\.e|etc|vs|\p{L})\.\s+$/iu;

/** What they said, as one lower-case accent-free line of words, so a phrase can be looked for whole. */
const saidLine = (said: readonly string[]) => ` ${said.map((t) => norm(t)).join(" ").replace(/[^a-z0-9]+/g, " ").replace(/anytime/g, "any time")} `;
/** A filler best time is one they never said themselves (any spelling of "any time"; "a cualquier hora" = "cualquier hora"). */
function saidTheFiller(value: string, said: readonly string[]): boolean {
  const phrase = norm(value).replace(/[^a-z0-9]+/g, " ").replace(/anytime/g, "any time").replace(/^a /, "").trim();
  return saidLine(said).includes(` ${phrase} `);
}

/**
 * Drops each "Label: value" segment whose value is a placeholder, and each whole comma part of a value that is one.
 * Text with no labels is judged whole. `dropped` lists what went, as written.
 *
 * A filler time under a best-time label is dropped only when `said` (what they said) is given and never mentions
 * it. With no `said` (the phone, whose transcript arrives asynchronously) "any time" is always kept.
 */
export function stripPlaceholderSegments(text: string, said?: readonly string[]): { text: string; dropped: string[] } {
  const input = text.trim();
  if (isPlaceholderValue(input)) return { text: "", dropped: [input] };
  const starts: Array<{ at: number; label: string; len: number }> = [];
  for (const m of input.matchAll(LABEL)) {
    const at = m.index ?? 0;
    const before = input.slice(0, at);
    if (at === 0 || (/[.;,!?]\s+$/.test(before) && !ABBREVIATION.test(before))) starts.push({ at, label: m[1]!, len: m[0].length });
  }
  if (starts.length === 0) return { text: input, dropped: [] };
  const dropped: string[] = [];
  let out = input.slice(0, starts[0]!.at);
  starts.forEach((s, i) => {
    const raw = input.slice(s.at, starts[i + 1]?.at ?? input.length);
    const rest = raw.slice(s.len);
    const tail = /[.;,!?]?\s*$/.exec(rest)![0];
    const value = rest.slice(0, rest.length - tail.length);
    const bestTime = BEST_TIME_KEYS.has(keyOf(s.label));
    const empty = (v: string) => isPlaceholderValue(v)
      || (bestTime && said !== undefined && isFillerBestTime(v) && !saidTheFiller(v, said));
    const parts = value.split(/,\s+/);
    const kept = parts.filter((p) => !empty(p));
    if (kept.length === parts.length) { out += raw; return; }
    if (kept.length === 0) { dropped.push(raw.trim()); return; }
    for (const p of parts) if (empty(p)) dropped.push(`${s.label}: ${p}`);
    out += `${s.label}: ${kept.join(", ")}${tail}`;
  });
  return { text: out.trim().replace(/[\s,;]+$/, "").replace(/ {2,}/g, " "), dropped };
}

function whyOf(segment: string): DroppedWhy {
  const m = /^(\p{L}+(?: \p{L}+){0,3}):\s*(.*)$/u.exec(segment);
  return m && BEST_TIME_KEYS.has(keyOf(m[1]!)) && isFillerBestTime(m[2]!) ? "filler" : "placeholder";
}
function stripField(field: string, value: string, said?: readonly string[]): { value: string; dropped: Dropped[] } {
  const r = stripPlaceholderSegments(value, said);
  return { value: r.text, dropped: r.dropped.map((v) => ({ field, value: v, why: whyOf(v) })) };
}

/** An email address alone, bounded by spaces or by , ; : / < > ( ) [ ] and quotes, so a name typed against it
 *  ("Dan,dan@x.com", "name:Dan,email:dan@x.com", "Dan<dan@x.com>") stays said (review I-1). */
const EMAIL = /[^\s,;:/<>()[\]"'“”«»]+@[^\s,;:/<>()[\]"'“”«»]+/g;
/** Accent- and case-insensitive whole words, with every email address (and only the address) taken out first. */
function saidWords(said: readonly string[]): Set<string> {
  return new Set(said.map((t) => norm(t.replace(EMAIL, " "))).join(" ").split(/[^a-z]+/).filter(Boolean));
}

/**
 * A name that came from their email address: every word of fullName is a word of the address's local part, and
 * they never said any of it (their email address itself does not count as saying it).
 */
export function nameTakenFromEmail(fullName: string, email: string, said: readonly string[]): boolean {
  const local = email.split("@")[0] ?? "";
  if (!email.includes("@") || !local) return false;
  const tokens = new Set(norm(local).split(/[^a-z]+/).filter(Boolean));
  const words = norm(fullName).split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0 || !words.every((w) => tokens.has(w))) return false;
  const heard = saidWords(said);
  return !words.some((w) => heard.has(w));
}

/** The phone capture_lead fields (free-form keys). Values arrive trimmed. No filler-time check: the phone cannot
 *  reliably know what the caller said when the tool runs, so "any time" is kept here. */
export function sanitizeLeadFields(raw: Record<string, string>): { fields: Record<string, string>; dropped: Dropped[] } {
  const fields: Record<string, string> = {};
  const dropped: Dropped[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!v) { fields[k] = v; continue; }
    const key = keyOf(k);
    const contact = key === "email" || key === "phone" || key === "callbacknumber";
    if (NAME_KEYS.has(key) && isPlaceholderName(v)) { dropped.push({ field: k, value: v, why: "placeholder" }); continue; }
    if (contact && isPlaceholderContact(v)) { dropped.push({ field: k, value: v, why: "placeholder" }); continue; }
    if (isPlaceholderValue(v)) { dropped.push({ field: k, value: v, why: "placeholder" }); continue; }
    if (NAME_KEYS.has(key) || contact) { fields[k] = v; continue; }
    const r = stripField(k, v);
    dropped.push(...r.dropped);
    if (r.value) fields[k] = r.value;
  }
  return { fields, dropped };
}

const WHY: Record<DroppedWhy, string> = {
  placeholder: "a placeholder, not something they said",
  filler: "a filler they never said; record a best time only if they give one",
  email_name: "taken from their email address; they never said it",
};

/** Model-facing: what was dropped and why, so she asks instead of guessing. Undefined when nothing was. */
export function droppedNote(dropped: readonly Dropped[], medium: "phone" | "web"): string | undefined {
  if (dropped.length === 0) return undefined;
  const list = dropped.map((d) => `${d.field} "${d.value}" (${WHY[d.why]})`).join("; ");
  const noName = medium === "phone" && dropped.some((d) => NAME_KEYS.has(keyOf(d.field)))
    ? " If they will not give their name, use take_message instead." : "";
  return `Left out of the record, because a record holds only what they said: ${list}. If you need any of it, ask them; never fill it in yourself.${noName}`;
}

/** The result unchanged when nothing was dropped; otherwise with the note. */
export function withDroppedNote<T extends object>(result: T, dropped: readonly Dropped[], medium: "phone" | "web"): T | (T & { note: string }) {
  const note = droppedNote(dropped, medium);
  return note === undefined ? result : { ...result, note };
}

/** registry.ts's REQUIRED fields for a phone lead. */
export const REQUIRED_LEAD_FIELDS = ["fullName", "need"] as const;

/** The phone capture_lead, whole: the fields to store and the answer the model hears. */
export function capturePhoneLead(rawFields: unknown, callerNumber: string | null): {
  fields: Record<string, string>; result: Record<string, unknown>;
} {
  const trimmed: Record<string, string> = {};
  const raw = (rawFields && typeof rawFields === "object") ? rawFields as Record<string, unknown> : {};
  for (const [k, v] of Object.entries(raw)) trimmed[k] = String(v ?? "").trim();
  const { fields, dropped } = sanitizeLeadFields(trimmed);
  if (!fields.callbackNumber && callerNumber) fields.callbackNumber = callerNumber;
  const missing = REQUIRED_LEAD_FIELDS.filter((f) => !fields[f]);
  const result = missing.length > 0 ? { ok: false, missing } : { ok: true };
  return { fields, result: withDroppedNote(result, dropped, "phone") };
}

/** take_message's body, trimmed and stripped. */
export function messageBody(raw: unknown): { body: string; dropped: Dropped[] } {
  const r = stripField("body", String(raw ?? "").trim());
  return { body: r.value, dropped: r.dropped };
}

/** book_appointment's name: a placeholder is no name. */
export function bookingName(raw: unknown): { name: string; dropped: Dropped[] } {
  const name = String(raw ?? "").trim();
  return name && isPlaceholderName(name)
    ? { name: "", dropped: [{ field: "name", value: name, why: "placeholder" }] }
    : { name, dropped: [] };
}

type WebLead = { fullName: string; email: string; phone: string; need: string };

/**
 * The website chat's capture_lead, after parseCaptureLead. `said` is every line the visitor typed, this turn's
 * included (the route has all of them, so the name-from-email check runs here; see the task report for why the
 * phone does not run it). A dropped name means no lead: the route's existing "unusable" path.
 */
export function sanitizeWebLead(lead: WebLead, said: readonly string[]): { lead: WebLead | null; dropped: Dropped[] } {
  const dropped: Dropped[] = [];
  if (isPlaceholderName(lead.fullName)) return { lead: null, dropped: [{ field: "fullName", value: lead.fullName, why: "placeholder" }] };
  if (nameTakenFromEmail(lead.fullName, lead.email, said)) return { lead: null, dropped: [{ field: "fullName", value: lead.fullName, why: "email_name" }] };
  const contact = (field: "email" | "phone") => {
    if (lead[field] && isPlaceholderContact(lead[field])) { dropped.push({ field, value: lead[field], why: "placeholder" }); return ""; }
    return lead[field];
  };
  const email = contact("email");
  const phone = contact("phone");
  const need = stripField("need", lead.need, said);
  dropped.push(...need.dropped);
  return { lead: { fullName: lead.fullName, email, phone, need: need.value }, dropped };
}

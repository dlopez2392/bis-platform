import { importFieldLabel, type ParsedRow } from "./csv";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-150 part 1: a phone shares its contacts as a vCard (`.vcf`) file, not a
 * CSV. This module turns that file's TEXT into the same shape the CSV path
 * already produces (`ParsedRow`), so the wizard's match step, confirm step,
 * server re-validation and duplicate check are all the EXISTING code —
 * nothing downstream of parsing is new. Parsing happens in the BROWSER
 * (DESIGN.md's CSV-import rule): this module never fetches, never uploads,
 * and the caller feeds it bytes already read from the chosen File.
 */

/** The one contact-shaped record a vCard block can produce. Every key is
 *  optional — a card is free to carry only some of these, or none, and a
 *  card with NONE of them is still returned (never dropped here): mapRows'
 *  existing "no email or phone" rejection is what skips and counts it, so
 *  the skipped-rows download already carries a reason for it with no new
 *  message needed (every CSV row already uses that same path). */
export type VCardContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
};

/** The fields a vCard can fill, in the order the match step's rows render
 *  them. Deliberately a SUBSET of IMPORT_FIELDS (csv.ts): `source` and
 *  `tags` have no vCard equivalent the spec calls for, and inventing one
 *  (e.g. CATEGORIES -> tags) would be a new contact-field mapping nobody
 *  asked for. */
export const VCARD_FIELDS = ["first_name", "last_name", "email", "phone", "company_name"] as const;
type VCardField = (typeof VCARD_FIELDS)[number];

/**
 * Detects a vCard by extension OR content, never by MIME alone — a phone's
 * share sheet hands the browser odd/missing MIME types for a `.vcf` far
 * more often than a desktop export does.
 *
 * Fix round M-7(c): the content check used to be `/^\s*BEGIN:VCARD/im`,
 * which matches that text on ANY line of the sniffed slice — a `.csv`
 * whose DATA happens to contain the literal words "BEGIN:VCARD" somewhere
 * (a pasted note, say) would misfire. Only the file's own first non-empty
 * line (after a leading BOM, which `.trim()` already strips — U+FEFF is
 * ECMAScript WhiteSpace) counts now, matching how a real vCard always
 * opens.
 */
export function looksLikeVCard(fileName: string, text: string): boolean {
  if (/\.vcf$/i.test(fileName)) return true;
  const firstLine = text.split(/\r\n|\r|\n/).map((l) => l.trim()).find((l) => l !== "");
  return firstLine !== undefined && /^BEGIN:VCARD$/i.test(firstLine);
}

/**
 * Fix round I-2 (RULING): raised from 25 MiB to 100 MiB. Parsing itself is
 * cheap even past 100 MB — PHOTO's (and any other unwanted property's)
 * folded continuation lines are dropped as they arrive, never copied, so
 * the scan stays linear in the file's own line count (`unfoldLines`
 * below). The real cost this ceiling guards is holding the WHOLE FILE in
 * memory at once (`file.arrayBuffer()`), which Papa.parse's streamed read
 * of a CSV never does — not the parse time itself.
 */
export const MAX_VCARD_FILE_BYTES = 104_857_600; // 100 MiB

export function vCardFileTooLarge(size: number): boolean {
  return size > MAX_VCARD_FILE_BYTES;
}

/**
 * Fix round I-1: the WHOLE FILE's own bytes, decoded once before any line
 * splitting happens. A phone that never declares an encoding at all can
 * still write raw 8-bit Latin-1/windows-1252 text (e.g. a bare 0xF1 byte
 * for "ñ", no `ENCODING=QUOTED-PRINTABLE` anywhere on the line it sits in)
 * — strict UTF-8 decoding throws on that lone byte (it is not a valid
 * UTF-8 sequence on its own), which is exactly the signal to fall back to
 * windows-1252 rather than silently losing the character to U+FFFD. A
 * genuinely UTF-8 file (the common case today) decodes on the first try
 * and is unaffected.
 */
export function decodeVCardBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}

type Prop = { name: string; params: string[]; rawValue: string };

function splitPhysicalLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Strips a `item1.`-style property group prefix (iPhone 3.0 exports group
 *  TEL/EMAIL/ADR under a shared `itemN.` label plus an `X-ABLabel` line this
 *  parser ignores) so `item1.TEL` reads as plain `TEL`. */
function stripGroup(head: string): string {
  const match = /^[A-Za-z0-9-]+\.(.+)$/.exec(head);
  return match ? match[1]! : head;
}

function propertyNameOf(line: string): string {
  const colon = line.indexOf(":");
  const head = colon === -1 ? line : line.slice(0, colon);
  const afterGroup = stripGroup(head);
  return (afterGroup.split(";")[0] ?? "").trim().toUpperCase();
}

/** The only properties this importer ever reads. Any OTHER property's
 *  folded continuation lines are dropped as they arrive, in `unfoldLines`
 *  below, rather than concatenated and then discarded — the difference
 *  between an O(n) scan and an O(n) scan that also copies megabytes of
 *  PHOTO/NOTE/ADR data it will never use. */
const KEPT_PROPERTIES = new Set(["N", "FN", "TEL", "EMAIL", "ORG"]);

function isKeptPropertyLine(line: string): boolean {
  return KEPT_PROPERTIES.has(propertyNameOf(line));
}

/**
 * Whether a line's own header declares QUOTED-PRINTABLE — vCard 2.1's
 * `ENCODING=QUOTED-PRINTABLE` param (3.0/4.0 spell it the same way) or
 * 2.1's bare, unlabelled `QUOTED-PRINTABLE` param.
 *
 * Fix round M-1: split out of the old `isQuotedPrintableSoftBreak`, which
 * re-derived "is this line still a pending soft break" from `current`'s
 * own trailing character AND header on every single line — including a
 * line belonging to an UNWANTED property, whose value this parser was
 * never going to read anyway. This half (does the PROPERTY declare QP at
 * all) is computed once, when the property starts; `pendingQpBreak` below
 * carries the other half (does the line we just consumed end in a bare
 * "=") forward without re-reading `current`.
 */
function declaresQuotedPrintable(line: string): boolean {
  const colon = line.indexOf(":");
  const head = colon === -1 ? line : line.slice(0, colon);
  return /(^|;)ENCODING=QUOTED-PRINTABLE(;|$)/i.test(head) || /(^|;)QUOTED-PRINTABLE(;|$)/i.test(head);
}

/** Fix round M-2(c): a QP value's own stray trailing "=" must never be read
 *  as a soft break onto a REAL `BEGIN:VCARD`/`END:VCARD` line — those are
 *  structure, never data, however a dangling "=" happens to line up. */
function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return /^BEGIN:VCARD$/i.test(trimmed) || /^END:VCARD$/i.test(trimmed);
}

/**
 * Turns physical lines (one per CRLF/LF/CR) into logical lines: RFC 6350
 * folding (a line starting with a single space or TAB continues the one
 * before it, that one leading character dropped) plus 2.1's
 * QUOTED-PRINTABLE soft break (a trailing `=` with no leading whitespace on
 * the next line, tracked here as `pendingQpBreak` rather than re-derived
 * per line — fix round M-1). A property this parser never reads (PHOTO
 * above all) has its continuation lines dropped in EITHER mechanism as
 * they arrive, so a multi-MB block costs one flag check per line, never a
 * copy — fixing the old code's quadratic cost on a QP-wrapped unwanted
 * property specifically (its fold branch already skipped the copy; its
 * soft-break-join branch did not). Fix round M-2(c): a soft break never
 * joins onto a literal `BEGIN:VCARD`/`END:VCARD` line.
 */
function unfoldLines(physical: string[]): string[] {
  const logical: string[] = [];
  let current = "";
  let hasCurrent = false;
  let currentIsUnwanted = false;
  let currentIsQP = false;
  let pendingQpBreak = false;

  function flush() {
    if (hasCurrent) logical.push(current);
    current = "";
    hasCurrent = false;
    currentIsUnwanted = false;
    currentIsQP = false;
    pendingQpBreak = false;
  }

  for (const raw of physical) {
    if (hasCurrent && (raw.startsWith(" ") || raw.startsWith("\t"))) {
      if (!currentIsUnwanted) current += raw.slice(1);
      pendingQpBreak = currentIsQP && raw.endsWith("=");
      continue;
    }
    if (hasCurrent && pendingQpBreak && !isStructuralLine(raw)) {
      if (!currentIsUnwanted) current = current.slice(0, -1) + raw;
      pendingQpBreak = currentIsQP && raw.endsWith("=");
      continue;
    }
    flush();
    current = raw;
    hasCurrent = true;
    currentIsUnwanted = !isKeptPropertyLine(current);
    currentIsQP = declaresQuotedPrintable(current);
    pendingQpBreak = currentIsQP && current.endsWith("=");
  }
  flush();
  return logical;
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = stripGroup(line.slice(0, colon));
  const segments = head.split(";");
  const name = (segments[0] ?? "").trim().toUpperCase();
  const params = segments.slice(1).map((p) => p.trim());
  return { name, params, rawValue: line.slice(colon + 1) };
}

/** QP hex escapes decode to raw BYTES, not characters — `Garc=C3=ADa` is the
 *  UTF-8 bytes for "García" split across two escapes, so the bytes are
 *  collected first and decoded as text once, never escape-by-escape (fix
 *  round I-1: WHICH text decoding applies is the property's own declared
 *  CHARSET, decided by the caller below). */
function decodeQuotedPrintableBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return new Uint8Array(bytes);
}

/** The three CHARSET values the fix round names; any other spelling (or
 *  none at all) falls back to the try-UTF-8-then-windows-1252 pair below —
 *  the same two-step `decodeVCardBytes` uses for the whole file. */
const CHARSET_LABEL: Record<string, string> = {
  "UTF-8": "utf-8", "ISO-8859-1": "iso-8859-1", "WINDOWS-1252": "windows-1252",
};

function charsetParamOf(params: string[]): string | undefined {
  for (const p of params) {
    const match = /^CHARSET=(.+)$/i.exec(p);
    if (match) return match[1];
  }
  return undefined;
}

function decodeBytesForCharset(bytes: Uint8Array, charsetParam: string | undefined): string {
  const label = charsetParam ? CHARSET_LABEL[charsetParam.toUpperCase()] : undefined;
  if (label) return new TextDecoder(label).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function isEncodedQuotedPrintable(params: string[]): boolean {
  return params.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p));
}

function decodeValue(prop: Prop): string {
  if (!isEncodedQuotedPrintable(prop.params)) return prop.rawValue;
  return decodeBytesForCharset(decodeQuotedPrintableBytes(prop.rawValue), charsetParamOf(prop.params));
}

/** 3.0/4.0 backslash escapes inside one already-split component: `\,` `\;`
 *  `\\` and `\n`/`\N` (a literal line break WITHIN the value). 2.1 does not
 *  use these, but applying the same unescape to a 2.1 value that never
 *  contains a backslash is a no-op, so one function covers both. */
function unescapeComponent(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits `value` on `delimiter`, but not one escaped with a backslash — so
 *  N's structural `;` separators split the name while an escaped `\;`
 *  inside a component (3.0/4.0) does not. */
function splitUnescaped(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      buf += ch + value[i + 1];
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** Splits a vCard 4.0 `TEL;VALUE=uri:tel:+15551234567` value down to the
 *  digits-and-punctuation a phone number actually is. Fix round M-7(a): the
 *  `tel:` URI (RFC 3966) can carry its OWN `;` parameters —
 *  `tel:+1-956-555-0101;ext=12` — which are not vCard parameters at all and
 *  are stripped along with the scheme. */
function stripTelUri(value: string): string {
  if (!/^tel:/i.test(value)) return value;
  const withoutScheme = value.slice(4);
  const semi = withoutScheme.indexOf(";");
  return semi === -1 ? withoutScheme : withoutScheme.slice(0, semi);
}

function hasParam(params: string[], test: RegExp): boolean {
  return params.some((p) => test.test(p));
}

const CELL_PARAM = /^(TYPE=)?.*\b(CELL|MOBILE)\b/i;
const INTERNET_PARAM = /^(TYPE=)?.*\bINTERNET\b/i;

/**
 * Fix round M-7(b) RULING: vCard's PREF is a 1–100 RANK — lower is more
 * preferred — not a yes/no flag. A bare `PREF` (2.1/3.0, no number) or a
 * `TYPE=...PREF...` form ranks as 1 (the best), matching how those are
 * written when nothing distinguishes one PREF-marked entry from another.
 * `undefined` means no PREF signal at all.
 */
function prefRank(params: string[]): number | undefined {
  for (const p of params) {
    const explicit = /^PREF=(\d+)$/i.exec(p);
    if (explicit) return Number(explicit[1]);
  }
  if (params.some((p) => /^PREF$/i.test(p) || /^TYPE=.*\bPREF\b/i.test(p))) return 1;
  return undefined;
}

function phoneScore(params: string[]): number {
  return hasParam(params, CELL_PARAM) ? 1 : 0;
}

/** Fix round M-7(b): a lower PREF rank must win decisively over the +1
 *  INTERNET nudge — `1000 - rank` keeps any rank under 999 ahead of a
 *  PREF-less INTERNET email, and a smaller rank always beats a larger one
 *  regardless of which appeared first in the file. */
function emailScore(params: string[]): number {
  const rank = prefRank(params);
  const prefScore = rank === undefined ? 0 : 1000 - rank;
  const internetScore = hasParam(params, INTERNET_PARAM) ? 1 : 0;
  return prefScore + internetScore;
}

/** First-wins on a tie (`>`, never `>=`): among several TEL or EMAIL lines
 *  with the same preference, the one that appeared first in the file is
 *  kept — matching "prefer CELL/mobile, else the first". */
function pickBest(candidates: { value: string; score: number }[]): string | undefined {
  let best: { value: string; score: number } | undefined;
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c;
  }
  return best?.value;
}

function splitFullName(fn: string): { firstName?: string; lastName?: string } {
  const trimmed = fn.trim();
  if (trimmed === "") return {};
  const space = trimmed.indexOf(" ");
  if (space === -1) return { firstName: trimmed };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1).trim() || undefined };
}

function buildContact(props: Prop[]): VCardContact {
  let firstName: string | undefined;
  let lastName: string | undefined;
  let fnFallback: string | undefined;
  let company: string | undefined;
  const emails: { value: string; score: number }[] = [];
  const phones: { value: string; score: number }[] = [];

  for (const prop of props) {
    switch (prop.name) {
      case "N": {
        if (firstName === undefined && lastName === undefined) {
          const comps = splitUnescaped(decodeValue(prop), ";").map((c) => unescapeComponent(c).trim());
          const family = comps[0];
          const given = comps[1];
          if (family) lastName = family;
          if (given) firstName = given;
        }
        break;
      }
      case "FN": {
        if (fnFallback === undefined) fnFallback = unescapeComponent(decodeValue(prop)).trim();
        break;
      }
      case "ORG": {
        if (company === undefined) {
          const comps = splitUnescaped(decodeValue(prop), ";").map((c) => unescapeComponent(c).trim());
          if (comps[0]) company = comps[0];
        }
        break;
      }
      case "EMAIL": {
        const value = unescapeComponent(decodeValue(prop)).trim();
        if (value) emails.push({ value, score: emailScore(prop.params) });
        break;
      }
      case "TEL": {
        const value = stripTelUri(unescapeComponent(decodeValue(prop)).trim());
        if (value) phones.push({ value, score: phoneScore(prop.params) });
        break;
      }
      default:
        break; // PHOTO, ADR, NOTE, AGENT and anything else this import does not carry.
    }
  }

  // Fix round M-3(a) RULING: a company card — FN carries the SAME text as
  // ORG, with no N at all — is a business, not a person; splitting that
  // text into first/last would invent a human name out of a company's own.
  if (firstName === undefined && lastName === undefined && fnFallback && fnFallback !== company) {
    const split = splitFullName(fnFallback);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  return {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(pickBest(emails) ? { email: pickBest(emails) } : {}),
    ...(pickBest(phones) ? { phone: pickBest(phones) } : {}),
    ...(company ? { company } : {}),
  };
}

/**
 * Parses one `.vcf` file's full (already-decoded — `decodeVCardBytes`)
 * text into one `VCardContact` per `BEGIN:VCARD`…`END:VCARD` block. A block
 * with no recognised property at all still produces an (empty) contact —
 * nothing is dropped HERE; `mapRows` is where "no email or phone" is
 * decided, identically for a vCard-sourced row and a spreadsheet one.
 *
 * Fix round M-2: a `BEGIN:VCARD` appearing before the current card's own
 * `END:VCARD` has closed is malformed either of two ways that share the
 * same syntax. An AGENT's embedded vCard — the standard way a 2.1/3.0 card
 * carries a second person inline — is swallowed whole (`agentDepth`) so it
 * never overwrites the outer card's own fields; told apart from a
 * genuinely missing `END:VCARD` (which instead closes the open card right
 * now, rather than losing it) by the one property line immediately before
 * the inner `BEGIN:`: an `AGENT:` line means "a nested person follows",
 * anything else means "this card forgot its own END".
 */
export function parseVCardText(text: string): VCardContact[] {
  const logical = unfoldLines(splitPhysicalLines(text));
  const contacts: VCardContact[] = [];
  let current: Prop[] | null = null;
  let agentDepth = 0;

  for (const raw of logical) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (agentDepth > 0) {
        agentDepth += 1;
        continue;
      }
      if (current !== null) {
        const lastProp = current[current.length - 1];
        if (lastProp && lastProp.name === "AGENT") {
          agentDepth = 1;
          continue;
        }
        // No END before this new card started: close the open one now,
        // rather than losing it when the fresh `current = []` below
        // overwrites it.
        contacts.push(buildContact(current));
      }
      current = [];
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (agentDepth > 0) {
        agentDepth -= 1;
        continue;
      }
      if (current) contacts.push(buildContact(current));
      current = null;
      continue;
    }
    if (agentDepth > 0) continue; // inside a swallowed nested (AGENT) card
    if (current) {
      const prop = parseLine(raw);
      if (prop) current.push(prop);
    }
  }
  if (current) contacts.push(buildContact(current));
  return contacts;
}

/** Fix round M-4: the skipped-rows download's own extra "name" column for a
 *  vCard source (the CSV download's own shape is untouched) — one
 *  best-effort display name per card, in the same order `vCardContactsToRows`
 *  numbers its rows, so "line 3, no email or phone" can also say "Ana Ruiz".
 *  Blank when a card truly carried neither a first nor a last name. */
export function vCardDisplayNames(contacts: VCardContact[]): string[] {
  return contacts.map((c) => [c.firstName, c.lastName].filter(Boolean).join(" "));
}

/**
 * Converts parsed vCard contacts into the SAME shape the CSV path's match
 * step already renders (`ParsedRow`, keyed by header), with the mapping
 * PRE-FILLED — every header here is one of the five fields this parser
 * understands, mapped to itself, so the match and confirm steps run
 * unchanged and the owner can still review or re-point any column. Headers
 * are the reader's own language (`importFieldLabel`), matching the labels
 * the dropdown already shows for these same fields.
 *
 * Fix round M-3(b) RULING: `company_name` is the one exception — it starts
 * UNMATCHED ("Don't import"), not pre-mapped to Business name. A vCard's
 * ORG is often the customer's own EMPLOYER, not the business this account
 * tracks for them; pre-mapping it would silently write someone else's
 * company onto the contact. The column still appears (with the ORG text
 * in it) so the owner can map it themselves when it IS the right business.
 */
export function vCardContactsToRows(
  contacts: VCardContact[],
  locale: Locale = "en",
): { headers: string[]; rows: ParsedRow[]; mapping: Record<string, string | null> } {
  const headers = VCARD_FIELDS.map((field) => importFieldLabel(field, locale));
  const mapping: Record<string, string | null> = {};
  VCARD_FIELDS.forEach((field, i) => {
    mapping[headers[i]!] = field === "company_name" ? null : field;
  });

  const fieldValue: Record<VCardField, keyof VCardContact> = {
    first_name: "firstName", last_name: "lastName", email: "email",
    phone: "phone", company_name: "company",
  };

  const rows: ParsedRow[] = contacts.map((contact, i) => {
    const values: Record<string, string> = {};
    VCARD_FIELDS.forEach((field, fi) => {
      values[headers[fi]!] = contact[fieldValue[field]] ?? "";
    });
    return { line: i + 1, values };
  });

  return { headers, rows, mapping };
}

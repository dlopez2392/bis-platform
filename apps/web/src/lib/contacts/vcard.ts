import { importFieldLabel, type ParsedRow } from "./csv";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-150 part 1: a phone shares its contacts as a vCard (`.vcf`) file, not a
 * CSV. This module turns that file's TEXT into the same shape the CSV path
 * already produces (`ParsedRow`), so the wizard's match step, confirm step,
 * server re-validation and duplicate check are all the EXISTING code —
 * nothing downstream of parsing is new. Parsing happens in the BROWSER
 * (DESIGN.md's CSV-import rule): this module never fetches, never uploads,
 * and the caller feeds it a string already read from the chosen File.
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
 */
export function looksLikeVCard(fileName: string, text: string): boolean {
  if (/\.vcf$/i.test(fileName)) return true;
  return /^\s*BEGIN:VCARD/im.test(text);
}

/**
 * A sane guard independent of the row cap below: a single vCard property
 * (PHOTO, almost always) can be tens of megabytes of folded base64, parsed
 * in one synchronous browser pass with no streaming the way Papa.parse
 * streams a File. The CSV path carries no file-size guard of its own (nothing
 * in that path reads `file.size`) because Papa.parse never holds the whole
 * file in memory at once; this path does, so it needs its own ceiling. Same
 * order of magnitude as the documents module's own per-file cap
 * (`DOCUMENT_MAX_BYTES`, 25 MiB) for one app-wide "that's a lot of file" line,
 * declared independently rather than imported — this module has no other
 * reason to depend on the documents feature.
 */
export const MAX_VCARD_FILE_BYTES = 26_214_400;

export function vCardFileTooLarge(size: number): boolean {
  return size > MAX_VCARD_FILE_BYTES;
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
 * True when `line` (the logical line built so far) is a QUOTED-PRINTABLE
 * value's soft line break: it ends in a single trailing `=` and its own
 * property declares the encoding — vCard 2.1's `ENCODING=QUOTED-PRINTABLE`
 * param (3.0/4.0 spell it the same way) or 2.1's bare, unlabelled
 * `QUOTED-PRINTABLE` param. This break carries NO leading whitespace on its
 * continuation (unlike RFC 6350 folding below), which is why it is checked
 * as its own case rather than folded into that one.
 */
function isQuotedPrintableSoftBreak(line: string): boolean {
  if (!line.endsWith("=")) return false;
  const colon = line.indexOf(":");
  const head = colon === -1 ? line : line.slice(0, colon);
  return /(^|;)ENCODING=QUOTED-PRINTABLE(;|$)/i.test(head) || /(^|;)QUOTED-PRINTABLE(;|$)/i.test(head);
}

/**
 * Turns physical lines (one per CRLF/LF/CR) into logical lines: RFC 6350
 * folding (a line starting with a single space or TAB continues the one
 * before it, that one leading character dropped) plus 2.1's
 * QUOTED-PRINTABLE soft break (a trailing `=` with no leading whitespace on
 * the next line). A property this parser never reads (PHOTO above all)
 * has its continuation lines dropped rather than appended, so a multi-MB
 * base64 block costs one string compare per line, never a copy.
 */
function unfoldLines(physical: string[]): string[] {
  const logical: string[] = [];
  let current = "";
  let hasCurrent = false;
  let currentIsUnwanted = false;

  function flush() {
    if (hasCurrent) logical.push(current);
    current = "";
    hasCurrent = false;
    currentIsUnwanted = false;
  }

  for (const raw of physical) {
    if (hasCurrent && (raw.startsWith(" ") || raw.startsWith("\t"))) {
      if (!currentIsUnwanted) current += raw.slice(1);
      continue;
    }
    if (hasCurrent && isQuotedPrintableSoftBreak(current)) {
      current = current.slice(0, -1) + raw;
      continue;
    }
    flush();
    current = raw;
    hasCurrent = true;
    currentIsUnwanted = !isKeptPropertyLine(current);
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
 *  collected first and decoded as UTF-8 once, never escape-by-escape. */
function decodeQuotedPrintable(value: string): string {
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
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function isEncodedQuotedPrintable(params: string[]): boolean {
  return params.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p));
}

function decodeValue(prop: Prop): string {
  return isEncodedQuotedPrintable(prop.params) ? decodeQuotedPrintable(prop.rawValue) : prop.rawValue;
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
 *  digits-and-punctuation a phone number actually is. */
function stripTelUri(value: string): string {
  return /^tel:/i.test(value) ? value.slice(4) : value;
}

function hasParam(params: string[], test: RegExp): boolean {
  return params.some((p) => test.test(p));
}

const CELL_PARAM = /^(TYPE=)?.*\b(CELL|MOBILE)\b/i;
const PREF_PARAM = /^(TYPE=)?.*\bPREF\b(=1)?/i;
const INTERNET_PARAM = /^(TYPE=)?.*\bINTERNET\b/i;

function phoneScore(params: string[]): number {
  return hasParam(params, CELL_PARAM) ? 1 : 0;
}

function emailScore(params: string[]): number {
  let score = 0;
  if (hasParam(params, PREF_PARAM)) score += 2;
  if (hasParam(params, INTERNET_PARAM)) score += 1;
  return score;
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
        break; // PHOTO, ADR, NOTE and anything else this import does not carry.
    }
  }

  if (firstName === undefined && lastName === undefined && fnFallback) {
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
 * Parses one `.vcf` file's full text into one `VCardContact` per
 * `BEGIN:VCARD`…`END:VCARD` block. A block with no recognised property at
 * all still produces an (empty) contact — nothing is dropped HERE; `mapRows`
 * is where "no email or phone" is decided, identically for a vCard-sourced
 * row and a spreadsheet one. An unterminated trailing block (no closing
 * `END:VCARD`) is still built at end of file rather than silently dropped.
 */
export function parseVCardText(text: string): VCardContact[] {
  const logical = unfoldLines(splitPhysicalLines(text));
  const contacts: VCardContact[] = [];
  let current: Prop[] | null = null;

  for (const raw of logical) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      current = [];
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (current) contacts.push(buildContact(current));
      current = null;
      continue;
    }
    if (current) {
      const prop = parseLine(raw);
      if (prop) current.push(prop);
    }
  }
  if (current) contacts.push(buildContact(current));
  return contacts;
}

/**
 * Converts parsed vCard contacts into the SAME shape the CSV path's match
 * step already renders (`ParsedRow`, keyed by header), with the mapping
 * PRE-FILLED — every header here is one of the five fields this parser
 * understands, mapped to itself, so the match and confirm steps run
 * unchanged and the owner can still review or re-point any column. Headers
 * are the reader's own language (`importFieldLabel`), matching the labels
 * the dropdown already shows for these same fields.
 */
export function vCardContactsToRows(
  contacts: VCardContact[],
  locale: Locale = "en",
): { headers: string[]; rows: ParsedRow[]; mapping: Record<string, string | null> } {
  const headers = VCARD_FIELDS.map((field) => importFieldLabel(field, locale));
  const mapping: Record<string, string | null> = {};
  VCARD_FIELDS.forEach((field, i) => { mapping[headers[i]!] = field; });

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

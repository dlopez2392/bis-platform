import type { MergeChoice } from "@bis/db";

/**
 * F-006 part 1 (plan Task 10, Step 1): the compare screen's field logic, pure and import-free beyond
 * the one shared type. Every rule here mirrors 0106's `app.merge_side` and its language rule
 * (`0106_contact_merge.sql:745-754,1001-1014`) character for character, so the screen's choices and the
 * database's own rule can never disagree: `keep`/`other` here are each the preview's `fields.keep` /
 * `fields.other` object (`contact_merge_preview`'s own snapshot), never the raw `getContact` rows.
 */

export type FieldConflict = { field: string; keepValue: unknown; otherValue: unknown; preselect: MergeChoice };

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** `app.merge_side`'s own shape: a blank side always loses to the non-blank one; equal values keep; the
 *  rest keeps unless told otherwise. Used both to decide "is this a conflict at all" and, in `otherReach`,
 *  to resolve what the kept record's field will actually read after the merge. */
function mergeSide(keepValue: unknown, otherValue: unknown, choice: MergeChoice | undefined): MergeChoice {
  if (isBlank(otherValue)) return "keep";
  if (isBlank(keepValue)) return "other";
  if (keepValue === otherValue) return "keep";
  return choice === "other" ? "other" : "keep";
}

const PLAIN_FIELDS = ["first_name", "last_name", "email", "phone", "assigned_to"] as const;

/** 0106's own rule (`:1001-1014`): staff beats a sign from either side; with neither side staff-set, the
 *  EARLIER signal wins (DESIGN.md: a customer's language is never overwritten by a later sign). */
function languagePreselect(keep: Record<string, unknown>, other: Record<string, unknown>): MergeChoice {
  const keepSource = keep.language_source;
  const otherSource = other.language_source;
  if (keepSource === "staff" && otherSource !== "staff") return "keep";
  if (otherSource === "staff" && keepSource !== "staff") return "other";
  const keepAt = typeof keep.language_set_at === "string" ? keep.language_set_at : null;
  const otherAt = typeof other.language_set_at === "string" ? other.language_set_at : null;
  if (keepAt !== null && otherAt !== null && otherAt < keepAt) return "other";
  return "keep";
}

function customOf(row: Record<string, unknown>): Record<string, unknown> {
  const c = row.custom;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

/** The fields the two records disagree on: both sides hold a real (non-blank) value, and they differ.
 *  `preselect` is "keep" for every field except `language`, which follows the rule above. */
export function mergeConflicts(keep: Record<string, unknown>, other: Record<string, unknown>): FieldConflict[] {
  const out: FieldConflict[] = [];
  for (const field of PLAIN_FIELDS) {
    const k = keep[field];
    const o = other[field];
    if (!isBlank(k) && !isBlank(o) && k !== o) out.push({ field, keepValue: k, otherValue: o, preselect: "keep" });
  }
  const kLang = keep.language;
  const oLang = other.language;
  if (!isBlank(kLang) && !isBlank(oLang) && kLang !== oLang) {
    out.push({ field: "language", keepValue: kLang, otherValue: oLang, preselect: languagePreselect(keep, other) });
  }
  const keepCustom = customOf(keep);
  const otherCustom = customOf(other);
  for (const key of Object.keys(keepCustom)) {
    // A key absent from `otherCustom` reads as `undefined` there, which `isBlank` already treats as
    // "nothing to disagree about" below — no separate `key in otherCustom` guard is reachable.
    const k = keepCustom[key];
    const o = otherCustom[key];
    if (!isBlank(k) && !isBlank(o) && k !== o) out.push({ field: `custom.${key}`, keepValue: k, otherValue: o, preselect: "keep" });
  }
  return out;
}

/** The fields the merge rules fill from the OTHER record because the kept side is blank — never shown
 *  as a choice (there is nothing to choose between), only stated as a fact ("Also keeps: …"). */
export function alsoKeeps(keep: Record<string, unknown>, other: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of PLAIN_FIELDS) {
    if (isBlank(keep[field]) && !isBlank(other[field])) out.push(field);
  }
  if (isBlank(keep.language) && !isBlank(other.language)) out.push("language");
  const keepCustom = customOf(keep);
  const otherCustom = customOf(other);
  for (const key of Object.keys(otherCustom)) {
    if (!(key in keepCustom) && !isBlank(otherCustom[key])) out.push(`custom.${key}`);
  }
  return out;
}

export type OtherReach = { phone?: string; email?: string };

/** D8's two lines: the other record's own phone/email, named only when the KEPT record's resolved value
 *  (after `choices`) will not read as that address — so calls, texts and mail to it still find the
 *  customer, and the screen says so. */
export function otherReach(
  keep: Record<string, unknown>, other: Record<string, unknown>, choices: Readonly<Record<string, MergeChoice>>,
): OtherReach {
  const out: OtherReach = {};
  const otherPhone = other.phone;
  if (typeof otherPhone === "string" && !isBlank(otherPhone)) {
    const side = mergeSide(keep.phone, otherPhone, choices.phone);
    const resolved = side === "other" ? otherPhone : keep.phone;
    if (resolved !== otherPhone) out.phone = otherPhone;
  }
  const otherEmail = other.email;
  if (typeof otherEmail === "string" && !isBlank(otherEmail)) {
    const side = mergeSide(keep.email, otherEmail, choices.email);
    const resolved = side === "other" ? otherEmail : keep.email;
    if (resolved !== otherEmail) out.email = otherEmail;
  }
  return out;
}

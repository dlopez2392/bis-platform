import type { Locale } from "@/lib/i18n/locale";
import { isUuid } from "@/lib/assign/action-guards";
import { cleanEdgeSpace, codePoints, validateInlineRule, type InlineRule } from "@/lib/inline-rule";
import type {
  PlaceRow, EquipmentRow, PlaceFields, PlacePatch, EquipmentFields, EquipmentPatch, PlaceOwner,
} from "@bis/db";

/**
 * What the browser sends for a property or a unit, re-validated on the server before any write
 * (spec section 6, 2026-10-11-places-and-equipment-design.md). Every text and date check runs
 * through `validateInlineRule(placeRule/equipmentRule(f))` (lib/inline-rule.ts, Task 3), so the
 * inline field and the server agree by construction. Pure, client- and server-safe.
 *
 * `InputError.key` is a messages.ts key the caller renders with `t(m, key, locale, params)`; the
 * places.* and equipment.* keys it can name (places.needOne, equipment.warrantyBeforeInstall) are
 * added by Task 5, after this module, so this module never imports `m`/`t` itself — only the raw
 * key strings, which are typed loosely as `string` for exactly that reason.
 */

export const PLACE_LIMITS = { label: 80, address: 300, landmark: 200, directions: 1000, city: 80, region: 80, postal_code: 12 } as const;
export const EQUIPMENT_LIMITS = { name: 80, make: 60, model: 60, serial: 60, notes: 1000 } as const;
export type PlaceTextField = keyof typeof PLACE_LIMITS;
export type EquipmentTextField = keyof typeof EQUIPMENT_LIMITS;
export type EquipmentDateField = "installed_on" | "warranty_until";

/** Every place field is optional (P6, lenient): the at-least-one rule lives separately. */
export function placeRule(field: PlaceTextField): InlineRule {
  return { kind: "text", max: PLACE_LIMITS[field], required: false };
}

/**
 * name is required. installed_on is required only when the unit IS a replacement (0071's
 * equipment_replacement_dated: a row with replaces_id must carry a date) and is never after the
 * account's own today. warranty_until is optional with no notAfter: a warranty can run years out.
 */
export function equipmentRule(
  field: EquipmentTextField | EquipmentDateField, today: string, unit?: Pick<EquipmentRow, "replaces_id">,
): InlineRule {
  if (field === "installed_on") return { kind: "date", required: Boolean(unit?.replaces_id), notAfter: today };
  if (field === "warranty_until") return { kind: "date", required: false };
  return { kind: "text", max: EQUIPMENT_LIMITS[field], required: field === "name" };
}

/** A messages.ts key naming why the input was refused. */
export type InputError = { key: string; params?: Record<string, string | number> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const isTimestamp = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Re-derives WHY a text rule failed without reparsing anything `validateInlineRule` already
 * decided: empty-and-required, or past the limit (those are the only two ways a text rule can
 * fail), told apart with the same `cleanEdgeSpace`/`codePoints` the rule itself uses.
 */
function textFieldResult(
  raw: string, required: boolean, max: number, locale: Locale,
): { ok: true; value: string } | { ok: false; error: InputError } {
  const res = validateInlineRule({ kind: "text", max, required }, raw, locale);
  if (res.ok) return res;
  const cleaned = cleanEdgeSpace(raw);
  return cleaned === ""
    ? { ok: false, error: { key: "inline.rule.required" } }
    : { ok: false, error: { key: "inline.rule.tooLong", params: { max } } };
}

/**
 * Same derivation for a date rule: empty-and-required, a date that will not parse, or one after
 * `rule.notAfter` — told apart by re-running the SAME rule with `notAfter` lifted, never by
 * reparsing the date here.
 */
function dateFieldResult(
  rule: InlineRule & { kind: "date" }, raw: string, locale: Locale,
): { ok: true; value: string } | { ok: false; error: InputError } {
  const res = validateInlineRule(rule, raw, locale);
  if (res.ok) return res;
  const cleaned = cleanEdgeSpace(raw);
  if (cleaned === "") return { ok: false, error: { key: "inline.rule.required" } };
  const withoutLimit = validateInlineRule({ ...rule, notAfter: undefined }, raw, locale);
  return withoutLimit.ok ? { ok: false, error: { key: "inline.rule.future" } } : { ok: false, error: { key: "inline.rule.badDate" } };
}

export function parseOwner(v: unknown): PlaceOwner | null {
  if (typeof v !== "string") return null;
  const i = v.indexOf(":");
  if (i < 0) return null;
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  if (!isUuid(id)) return null;
  if (kind === "contact") return { contactId: id, groupId: null };
  if (kind === "group") return { contactId: null, groupId: id };
  return null;
}

export function ownerValue(o: Pick<PlaceRow, "contact_id" | "client_group_id">): string {
  return o.contact_id !== null ? `contact:${o.contact_id}` : `group:${o.client_group_id}`;
}

const PLACE_TEXT_FIELDS = Object.keys(PLACE_LIMITS) as PlaceTextField[];
const PLACE_PATCH_FIELDS = [...PLACE_TEXT_FIELDS, "country"] as const;
type PlacePatchField = (typeof PLACE_PATCH_FIELDS)[number];
const isPlacePatchField = (v: string): v is PlacePatchField => (PLACE_PATCH_FIELDS as readonly string[]).includes(v);

function parseCountryValue(v: unknown): "US" | "MX" | null | undefined {
  if (v === "US" || v === "MX") return v;
  if (v === "" || v === undefined || v === null) return null;
  return undefined; // not a sanctioned option: never "CA"
}

/** The at-least-one rule (places_findable): read the row AFTER a change, never the changed field alone. */
function placeFound(after: { address: string | null; landmark: string | null; directions: string | null }): boolean {
  return Boolean(after.address || after.landmark || after.directions);
}

export function parsePlaceFields(raw: unknown, locale: Locale = "en"): { ok: true; fields: PlaceFields } | { ok: false; error: InputError } {
  const r = isRecord(raw) ? raw : {};
  const out: Record<string, string | null> = {};
  for (const field of PLACE_TEXT_FIELDS) {
    const res = textFieldResult(strOf(r[field]), false, PLACE_LIMITS[field], locale);
    if (!res.ok) return res;
    out[field] = res.value === "" ? null : res.value;
  }
  const country = parseCountryValue(r.country);
  if (country === undefined) return { ok: false, error: { key: "inline.invalidOption" } };
  if (!placeFound({ address: out.address ?? null, landmark: out.landmark ?? null, directions: out.directions ?? null })) {
    return { ok: false, error: { key: "places.needOne" } };
  }
  return { ok: true, fields: { ...out, country } as PlaceFields };
}

export function parsePlacePatch(
  field: unknown, value: unknown, current: Pick<PlaceRow, "address" | "landmark" | "directions">, locale: Locale = "en",
): { ok: true; patch: PlacePatch } | { ok: false; error: InputError } {
  if (typeof field !== "string" || !isPlacePatchField(field)) return { ok: false, error: { key: "inline.invalidOption" } };
  if (field === "country") {
    const country = parseCountryValue(value);
    return country === undefined ? { ok: false, error: { key: "inline.invalidOption" } } : { ok: true, patch: { country } };
  }
  const res = textFieldResult(strOf(value), false, PLACE_LIMITS[field], locale);
  if (!res.ok) return res;
  const next = res.value === "" ? null : res.value;
  if (field === "address" || field === "landmark" || field === "directions") {
    const after = { address: current.address, landmark: current.landmark, directions: current.directions, [field]: next };
    if (!placeFound(after)) return { ok: false, error: { key: "places.needOne" } };
  }
  return { ok: true, patch: { [field]: next } as PlacePatch };
}

const EQUIPMENT_TEXT_FIELDS = Object.keys(EQUIPMENT_LIMITS) as EquipmentTextField[];
const EQUIPMENT_DATE_FIELDS: readonly EquipmentDateField[] = ["installed_on", "warranty_until"];
const EQUIPMENT_PATCH_FIELDS = [...EQUIPMENT_TEXT_FIELDS, ...EQUIPMENT_DATE_FIELDS] as const;
type EquipmentPatchField = (typeof EQUIPMENT_PATCH_FIELDS)[number];
const isEquipmentPatchField = (v: string): v is EquipmentPatchField => (EQUIPMENT_PATCH_FIELDS as readonly string[]).includes(v);

/** equipment_warranty_order: a warranty cannot end before the install date (either side null is fine). */
function warrantyOrdered(installedOn: string | null, warrantyUntil: string | null): boolean {
  return !(installedOn !== null && warrantyUntil !== null && warrantyUntil < installedOn);
}

export function parseEquipmentFields(
  raw: unknown, today: string, opts: { replacement: boolean }, locale: Locale = "en",
): { ok: true; fields: EquipmentFields } | { ok: false; error: InputError } {
  const r = isRecord(raw) ? raw : {};
  const unit: Pick<EquipmentRow, "replaces_id"> = { replaces_id: opts.replacement ? "pending" : null };
  const out: Record<string, string | null> = {};
  for (const field of EQUIPMENT_TEXT_FIELDS) {
    const res = textFieldResult(strOf(r[field]), field === "name", EQUIPMENT_LIMITS[field], locale);
    if (!res.ok) return res;
    out[field] = res.value === "" ? null : res.value;
  }
  for (const field of EQUIPMENT_DATE_FIELDS) {
    const rule = equipmentRule(field, today, unit) as InlineRule & { kind: "date" };
    const res = dateFieldResult(rule, strOf(r[field]), locale);
    if (!res.ok) return res;
    out[field] = res.value === "" ? null : res.value;
  }
  if (!warrantyOrdered(out.installed_on ?? null, out.warranty_until ?? null)) {
    return { ok: false, error: { key: "equipment.warrantyBeforeInstall" } };
  }
  return { ok: true, fields: out as EquipmentFields };
}

export function parseEquipmentPatch(
  field: unknown, value: unknown, today: string,
  current: Pick<EquipmentRow, "installed_on" | "warranty_until" | "replaces_id">, locale: Locale = "en",
): { ok: true; patch: EquipmentPatch } | { ok: false; error: InputError } {
  if (typeof field !== "string" || !isEquipmentPatchField(field)) return { ok: false, error: { key: "inline.invalidOption" } };
  if (field === "installed_on" || field === "warranty_until") {
    const rule = equipmentRule(field, today, current) as InlineRule & { kind: "date" };
    const res = dateFieldResult(rule, strOf(value), locale);
    if (!res.ok) return res;
    const next = res.value === "" ? null : res.value;
    const after = {
      installed_on: field === "installed_on" ? next : current.installed_on,
      warranty_until: field === "warranty_until" ? next : current.warranty_until,
    };
    if (!warrantyOrdered(after.installed_on, after.warranty_until)) {
      return { ok: false, error: { key: "equipment.warrantyBeforeInstall" } };
    }
    return { ok: true, patch: { [field]: next } as EquipmentPatch };
  }
  const res = textFieldResult(strOf(value), field === "name", EQUIPMENT_LIMITS[field], locale);
  if (!res.ok) return res;
  return { ok: true, patch: { [field]: res.value === "" ? null : res.value } as EquipmentPatch };
}

const PLACE_ROW_KEYS = [
  "id", "account_id", "contact_id", "client_group_id", "label", "address", "landmark", "directions",
  "city", "region", "postal_code", "country", "archived_at", "created_by", "created_at", "updated_at",
] as const;

function validOptionalText(v: unknown, max: number): boolean {
  return v === null || (typeof v === "string" && cleanEdgeSpace(v) === v && codePoints(v) >= 1 && codePoints(v) <= max);
}

/** An Undo's snapshot comes back from the browser: every field is checked as 0071 would. */
export function parsePlaceSnapshot(v: unknown, accountId: string): PlaceRow | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== PLACE_ROW_KEYS.length || PLACE_ROW_KEYS.some((k) => !(k in v))) return null;
  const r = v as Record<(typeof PLACE_ROW_KEYS)[number], unknown>;
  if (!isUuid(r.id) || r.account_id !== accountId) return null;
  const hasContact = r.contact_id !== null, hasGroup = r.client_group_id !== null;
  if (hasContact === hasGroup) return null; // exactly one owner (places_one_owner)
  if (hasContact && !isUuid(r.contact_id)) return null;
  if (hasGroup && !isUuid(r.client_group_id)) return null;
  for (const field of PLACE_TEXT_FIELDS) {
    if (!validOptionalText(r[field], PLACE_LIMITS[field])) return null;
  }
  if (r.country !== null && r.country !== "US" && r.country !== "MX") return null;
  if (r.archived_at !== null && !isTimestamp(r.archived_at)) return null;
  if (r.created_by !== null && typeof r.created_by !== "string") return null;
  if (!isTimestamp(r.created_at) || !isTimestamp(r.updated_at)) return null;
  if (!placeFound({ address: r.address as string | null, landmark: r.landmark as string | null, directions: r.directions as string | null })) {
    return null;
  }
  return { ...(v as PlaceRow) };
}

const EQUIPMENT_ROW_KEYS = [
  "id", "account_id", "place_id", "name", "make", "model", "serial", "notes",
  "installed_on", "warranty_until", "replaces_id", "created_by", "created_at", "updated_at",
] as const;

/**
 * An Undo's snapshot comes back from the browser: every field is checked as 0071 would, and the
 * install date by the same not-after-the-account's-today rule an add or an edit runs, so a forged
 * Undo cannot plant a future date.
 */
export function parseEquipmentSnapshot(v: unknown, accountId: string, today: string): EquipmentRow | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== EQUIPMENT_ROW_KEYS.length || EQUIPMENT_ROW_KEYS.some((k) => !(k in v))) return null;
  const r = v as Record<(typeof EQUIPMENT_ROW_KEYS)[number], unknown>;
  if (!isUuid(r.id) || r.account_id !== accountId || !isUuid(r.place_id)) return null;
  if (typeof r.name !== "string" || !validOptionalText(r.name, EQUIPMENT_LIMITS.name)) return null;
  for (const field of ["make", "model", "serial", "notes"] as const) {
    if (!validOptionalText(r[field], EQUIPMENT_LIMITS[field])) return null;
  }
  for (const field of ["installed_on", "warranty_until"] as const) {
    if (r[field] !== null && (typeof r[field] !== "string" || !DATE_ONLY.test(r[field] as string))) return null;
  }
  if (r.installed_on !== null && !validateInlineRule(equipmentRule("installed_on", today), r.installed_on as string).ok) return null;
  if (r.replaces_id !== null && !isUuid(r.replaces_id)) return null;
  // equipment_not_self; Postgres compares uuids by value, so case does not make it another unit.
  if (r.replaces_id !== null && (r.replaces_id as string).toLowerCase() === (r.id as string).toLowerCase()) return null;
  if (r.replaces_id !== null && r.installed_on === null) return null; // equipment_replacement_dated
  if (!warrantyOrdered(r.installed_on as string | null, r.warranty_until as string | null)) return null;
  if (r.created_by !== null && typeof r.created_by !== "string") return null;
  if (!isTimestamp(r.created_at) || !isTimestamp(r.updated_at)) return null;
  return { ...(v as EquipmentRow) };
}

import {
  isRelationshipKey, SIDE_COLUMNS, type RelationshipKey, type RelationshipRow, type RelationshipSidesPatch, type WordForm,
} from "@bis/db/relationship-keys";
import { isUuid } from "@/lib/assign/action-guards";
import { RELATIONSHIP_LABELS } from "./relationship-labels";
import type { ViewPatch } from "./relationship-view";

/**
 * What the browser sends, re-validated on the server before any write (spec §6). Not a
 * "use server" module, so sync helpers may live here.
 */
export const CUSTOM_LABEL_MAX = 60;
/**
 * An explicit class, not .trim(): the zero-width space and the BOM count as edge space too, and
 * so do U+001C-001F and U+0085 (NEL) — JS's \s misses both, but PG17's ICU en_US.UTF-8
 * POSIX [:space:] (production/bis-ci), which 0070's CHECK (contact_relationships_custom_trimmed) uses,
 * includes them; missing either here means a label that passes this cleaning still 23514s in
 * the database.
 */
const EDGE_SPACE = /^[\s​﻿\u001c-\u001f\u0085]+|[\s​﻿\u001c-\u001f\u0085]+$/g;

export function cleanText(v: unknown): string {
  return typeof v === "string" ? v.replace(EDGE_SPACE, "") : "";
}

export function cleanCustomLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = cleanText(v);
  const chars = [...s].length; // char_length counts code points, as 0070's CHECK does
  return chars >= 1 && chars <= CUSTOM_LABEL_MAX ? s : null;
}

const isForm = (v: unknown): v is WordForm | null => v === null || v === "f" || v === "m";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type AddRelationshipInput = {
  subjectId: string;
  other: { kind: "existing"; contactId: string } | { kind: "new"; firstName: string; lastName: string; phone: string };
  labelKey: RelationshipKey;
  side: "a" | "b";
  customLabel: string | null;
  otherForm: WordForm | null;
  subjectForm: WordForm | null;
};

export function parseAddInput(v: unknown): { ok: true; input: AddRelationshipInput } | { ok: false; error: "self" | "invalid" } {
  const invalid = { ok: false as const, error: "invalid" as const };
  if (!isRecord(v) || !isRecord(v.other)) return invalid;
  const { subjectId, labelKey, side, otherForm, subjectForm } = v;
  if (!isUuid(subjectId) || !isRelationshipKey(labelKey) || (side !== "a" && side !== "b")) return invalid;
  if (!RELATIONSHIP_LABELS[labelKey].offer.includes(side)) return invalid;
  if (!isForm(otherForm) || !isForm(subjectForm)) return invalid;
  const customLabel = labelKey === "other" ? cleanCustomLabel(v.customLabel) : null;
  if (labelKey === "other" && customLabel === null) return invalid;
  const o = v.other;
  let other: AddRelationshipInput["other"];
  if (o.kind === "existing" && isUuid(o.contactId)) {
    if (o.contactId === subjectId) return { ok: false, error: "self" };
    other = { kind: "existing", contactId: o.contactId };
  } else if (o.kind === "new" && typeof o.firstName === "string" && typeof o.lastName === "string" && typeof o.phone === "string") {
    const firstName = cleanText(o.firstName), lastName = cleanText(o.lastName);
    if (!firstName && !lastName) return invalid;
    other = { kind: "new", firstName, lastName, phone: o.phone };
  } else {
    return invalid;
  }
  return { ok: true, input: { subjectId, other, labelKey, side, customLabel, otherForm, subjectForm } };
}

const VIEW_KEYS = ["namedForm", "subjectForm", "canPickUp", "isEmergency"] as const;

export function parseViewPatch(v: unknown): ViewPatch | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => !(VIEW_KEYS as readonly string[]).includes(k))) return null;
  const out: ViewPatch = {};
  for (const k of keys) {
    const val = v[k];
    if (k === "namedForm" || k === "subjectForm") { if (!isForm(val)) return null; out[k] = val; }
    else { if (typeof val !== "boolean") return null; out[k as "canPickUp" | "isEmergency"] = val; }
  }
  return out;
}

export function parseSidesPatch(v: unknown): RelationshipSidesPatch | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => !(SIDE_COLUMNS as readonly string[]).includes(k))) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const val = v[k];
    if (k.endsWith("_form") ? !isForm(val) : typeof val !== "boolean") return null;
    out[k] = val;
  }
  return out as RelationshipSidesPatch;
}

const ROW_KEYS = [
  "id", "account_id", "contact_id", "related_contact_id", "label_key", "custom_label", "contact_form", "related_form",
  "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency", "created_at", "updated_at",
] as const;
const isTimestamp = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** An Undo's snapshot comes back from the browser: every field is checked as 0070 would. */
export function parseRelationshipRow(v: unknown): RelationshipRow | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== ROW_KEYS.length || ROW_KEYS.some((k) => !(k in v))) return null;
  const r = v as Record<(typeof ROW_KEYS)[number], unknown>;
  if (![r.id, r.account_id, r.contact_id, r.related_contact_id].every(isUuid) || r.contact_id === r.related_contact_id) return null;
  if (!isRelationshipKey(r.label_key) || !isForm(r.contact_form) || !isForm(r.related_form)) return null;
  const customOk = r.label_key === "other"
    ? typeof r.custom_label === "string" && cleanCustomLabel(r.custom_label) === r.custom_label
    : r.custom_label === null;
  if (!customOk) return null;
  if (![r.contact_can_pick_up, r.contact_is_emergency, r.related_can_pick_up, r.related_is_emergency].every((b) => typeof b === "boolean")) return null;
  if (r.label_key === "emergency_contact" && r.contact_is_emergency !== true) return null;
  if (r.label_key === "authorized_pickup" && r.contact_can_pick_up !== true) return null;
  if (!isTimestamp(r.created_at) || !isTimestamp(r.updated_at)) return null;
  return { ...(v as RelationshipRow) };
}

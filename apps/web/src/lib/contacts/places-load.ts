import type { PlacesResponse } from "@/app/api/accounts/[accountId]/contacts/[contactId]/places/route";

/**
 * The Properties card's read, parsed (spec §8: it loads and fails on its own). Anything but a
 * well-formed 200 is the card's error state, so a server older or newer than this tab's bundle
 * gets "Couldn't load properties." instead of a row that throws in render.
 */
export type PlacesLoad = { status: "loading" } | { status: "error" } | { status: "ready"; data: PlacesResponse };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string";
const strOrNull = (v: unknown) => v === null || typeof v === "string";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (v: unknown) => v === null || (typeof v === "string" && DAY.test(v));
const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

const PLACE_TEXT = ["contact_id", "client_group_id", "label", "address", "landmark", "directions", "city", "region", "postal_code", "archived_at"] as const;
const UNIT_TEXT = ["make", "model", "serial", "notes", "replaces_id"] as const;

function isPlace(v: unknown): boolean {
  return isObj(v) && str(v.id) && str(v.account_id) && PLACE_TEXT.every((k) => strOrNull(v[k]))
    && (v.contact_id !== null) !== (v.client_group_id !== null)
    && (v.country === null || v.country === "US" || v.country === "MX")
    && str(v.created_at) && str(v.updated_at);
}

function isUnit(v: unknown): boolean {
  return isObj(v) && str(v.id) && str(v.account_id) && str(v.place_id) && str(v.name)
    && UNIT_TEXT.every((k) => strOrNull(v[k])) && dayOrNull(v.installed_on) && dayOrNull(v.warranty_until)
    && str(v.created_at) && str(v.updated_at);
}

const isGroup = (v: unknown) => isObj(v) && str(v.id) && str(v.kind) && str(v.name) && typeof v.isPrimary === "boolean";
/** S-03 part 2: the group's own route names the group it read; the contact's route never sends one. */
const isSubjectGroup = (v: unknown) =>
  v === undefined || (isObj(v) && str(v.id) && (v.kind === "household" || v.kind === "business") && str(v.name));

export async function placesLoadFrom(res: Response): Promise<PlacesLoad> {
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try { body = await res.json(); } catch { return { status: "error" }; }
  if (!isObj(body)) return { status: "error" };
  const s = body.subject;
  const ok = isObj(s) && str(s.id) && strOrNull(s.firstName) && strOrNull(s.lastName)
    && str(body.today) && DAY.test(body.today as string)
    && Array.isArray(body.groups) && body.groups.every(isGroup)
    && Array.isArray(body.places) && body.places.every(isPlace) && count(body.placeCount)
    && Array.isArray(body.equipment) && body.equipment.every(isUnit) && count(body.equipmentCount)
    && isSubjectGroup(body.group);
  return ok ? { status: "ready", data: body as PlacesResponse } : { status: "error" };
}

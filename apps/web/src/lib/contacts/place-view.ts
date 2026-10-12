import type { PlaceRow, EquipmentRow, ContactPlaceGroup } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * Pure view helpers for a contact's Properties card (spec section 8). Client- and server-safe: no
 * fetch. The fallback title and the owner-option labels are `places.untitled`, `places.onlyPerson`
 * and `places.sharedWith` in messages.ts, in the reader's language.
 */

/** Title fallback: a stored label, else the address's own first line, else the landmark, else "Property". */
export function placeTitle(p: Pick<PlaceRow, "label" | "address" | "landmark">, locale: Locale): string {
  if (p.label) return p.label;
  if (p.address) return p.address.split("\n")[0]!;
  if (p.landmark) return p.landmark;
  return t(m, "places.untitled", locale);
}

function regionZipOf(p: Pick<PlaceRow, "region" | "postal_code">): string {
  return [p.region, p.postal_code].filter((s): s is string => Boolean(s)).join(" ");
}

/** "McAllen, TX 78501"; null when there is nothing structured to show. */
export function cityLine(p: Pick<PlaceRow, "city" | "region" | "postal_code">): string | null {
  const parts = [p.city, regionZipOf(p)].filter((s): s is string => Boolean(s && s.length > 0));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Google Maps' search URL (spec 5.1, O8 — an assumption, not verified); null without an address. */
export function mapUrl(p: Pick<PlaceRow, "address" | "city" | "region" | "postal_code">): string | null {
  if (!p.address) return null;
  const parts = [p.address, p.city, regionZipOf(p)].filter((s): s is string => Boolean(s && s.length > 0));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

export type WarrantyStatus = { kind: "under" | "ended"; until: string } | null;

/** Under warranty through the last day itself (inclusive); ended the day after. */
export function warrantyStatus(warrantyUntil: string | null, today: string): WarrantyStatus {
  if (!warrantyUntil) return null;
  return warrantyUntil >= today ? { kind: "under", until: warrantyUntil } : { kind: "ended", until: warrantyUntil };
}

export type UnitView = { unit: EquipmentRow; history: { unit: EquipmentRow; replacedOn: string }[] };

/**
 * Current units (nothing replaces them) at each place, each with its history walked back through
 * `replaces_id`: a unit's "replaced on" date is the date its SUCCESSOR was installed, never its
 * own `installed_on` (C3 — that is read, never re-derived from the old unit's own row).
 */
export function equipmentByPlace(units: readonly EquipmentRow[]): Map<string, UnitView[]> {
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const replacedIds = new Set(units.filter((u) => u.replaces_id).map((u) => u.replaces_id as string));
  const out = new Map<string, UnitView[]>();
  for (const unit of units) {
    if (replacedIds.has(unit.id)) continue; // someone else's history, not current
    const history: { unit: EquipmentRow; replacedOn: string }[] = [];
    let current = unit;
    while (current.replaces_id) {
      const prev = byId.get(current.replaces_id);
      if (!prev) break;
      history.push({ unit: prev, replacedOn: current.installed_on as string });
      current = prev;
    }
    const list = out.get(unit.place_id) ?? [];
    list.push({ unit, history });
    out.set(unit.place_id, list);
  }
  return out;
}

/** Own first (rank 0), then the main group's (rank 1), then other groups' (rank 2); oldest first within a rank. */
export function placesInOrder(
  places: readonly PlaceRow[], subjectId: string, groups: readonly ContactPlaceGroup[],
): { active: PlaceRow[]; removed: PlaceRow[] } {
  const groupRank = new Map(groups.map((g) => [g.id, g.isPrimary ? 1 : 2] as const));
  const rankOf = (p: PlaceRow): number =>
    p.contact_id === subjectId ? 0 : p.client_group_id ? groupRank.get(p.client_group_id) ?? 2 : 2;
  const sorted = [...places].sort((a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0) return r;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { active: sorted.filter((p) => !p.archived_at), removed: sorted.filter((p) => Boolean(p.archived_at)) };
}

/** "Belongs to" options, Owner/Staff only: the subject first, then each of their groups. */
export function ownerOptions(
  subject: { id: string; name: string }, groups: readonly ContactPlaceGroup[], locale: Locale,
): { value: string; label: string }[] {
  const out = [{ value: `contact:${subject.id}`, label: t(m, "places.onlyPerson", locale, { name: subject.name }) }];
  for (const g of groups) {
    out.push({ value: `group:${g.id}`, label: t(m, "places.sharedWith", locale, { group: g.name }) });
  }
  return out;
}

/** The place's own group, when it belongs to one; null for a person's own property. */
export function sharedWith(p: Pick<PlaceRow, "client_group_id">, groups: readonly ContactPlaceGroup[]): ContactPlaceGroup | null {
  return p.client_group_id ? groups.find((g) => g.id === p.client_group_id) ?? null : null;
}

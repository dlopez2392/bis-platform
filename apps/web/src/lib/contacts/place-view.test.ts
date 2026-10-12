import { describe, it, expect } from "vitest";
import type { PlaceRow, EquipmentRow, ContactPlaceGroup } from "@bis/db";
import { placeTitle, cityLine, mapUrl, warrantyStatus, equipmentByPlace, placesInOrder, ownerOptions, sharedWith } from "./place-view";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const GROUP_MAIN = "44444444-4444-4444-8444-444444444444";
const GROUP_OTHER = "55555555-5555-4555-8555-555555555555";
const PLACE_A = "66666666-6666-4666-8666-666666666666";

function place(overrides: Partial<PlaceRow>): PlaceRow {
  return {
    id: "p", account_id: ACCOUNT, contact_id: SUBJECT, client_group_id: null,
    label: null, address: null, landmark: null, directions: null,
    city: null, region: null, postal_code: null, country: null,
    archived_at: null, created_by: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function unit(overrides: Partial<EquipmentRow>): EquipmentRow {
  return {
    id: "u", account_id: ACCOUNT, place_id: PLACE_A, name: "AC", make: null, model: null, serial: null, notes: null,
    installed_on: null, warranty_until: null, replaces_id: null,
    created_by: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("placeTitle", () => {
  it("label, else the address's first line, else the landmark, else 'Property' / 'Propiedad' in the reader's language (mutation: skip the first-line split -> FAILS)", () => {
    expect(placeTitle(place({ label: "Casa" }), "en")).toBe("Casa");
    expect(placeTitle(place({ address: "1204 Nolana Ave\nApt 3" }), "en")).toBe("1204 Nolana Ave");
    expect(placeTitle(place({ landmark: "blue house" }), "en")).toBe("blue house");
    expect(placeTitle(place({}), "en")).toBe("Property");
    expect(placeTitle(place({}), "es")).toBe("Propiedad");
  });
});

describe("mapUrl", () => {
  it("is Google Maps' search URL with the address, city, region and ZIP encoded, and null without an address (mutation: build it from the landmark -> FAILS)", () => {
    expect(mapUrl({ address: "1204 Nolana Ave #3", city: "McAllen", region: "TX", postal_code: "78501" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("1204 Nolana Ave #3, McAllen, TX 78501"),
    );
    expect(mapUrl({ address: null, city: "McAllen", region: "TX", postal_code: "78501" })).toBeNull();
  });
});

describe("cityLine", () => {
  it("joins city, region and ZIP, and is null with nothing to show", () => {
    expect(cityLine({ city: "McAllen", region: "TX", postal_code: "78501" })).toBe("McAllen, TX 78501");
    expect(cityLine({ city: null, region: null, postal_code: null })).toBeNull();
  });
});

describe("warrantyStatus", () => {
  it("under warranty through the last day itself, ended the day after (mutation: compare with > -> FAILS)", () => {
    expect(warrantyStatus("2026-10-11", "2026-10-11")).toEqual({ kind: "under", until: "2026-10-11" });
    expect(warrantyStatus("2026-10-10", "2026-10-11")).toEqual({ kind: "ended", until: "2026-10-10" });
    expect(warrantyStatus(null, "2026-10-11")).toBeNull();
  });
});

describe("equipmentByPlace", () => {
  it("a chain A -> B -> C shows C current, with B replaced on C's install date and A on B's (mutation: use the unit's own installed_on as replacedOn -> FAILS)", () => {
    const a = unit({ id: "a", installed_on: "2024-01-01" });
    const b = unit({ id: "b", installed_on: "2025-01-01", replaces_id: "a" });
    const c = unit({ id: "c", installed_on: "2026-01-01", replaces_id: "b" });
    const byPlace = equipmentByPlace([a, b, c]);
    expect(byPlace.get(PLACE_A)).toEqual([
      { unit: c, history: [{ unit: b, replacedOn: "2026-01-01" }, { unit: a, replacedOn: "2025-01-01" }] },
    ]);
  });

  it("two independent units at one place are both current", () => {
    const x = unit({ id: "x", name: "AC" });
    const y = unit({ id: "y", name: "Water heater" });
    expect(equipmentByPlace([x, y]).get(PLACE_A)).toEqual([{ unit: x, history: [] }, { unit: y, history: [] }]);
  });
});

describe("placesInOrder", () => {
  it("the person's own first, then the main group's, then other groups', each oldest first; removed ones apart", () => {
    const groups: ContactPlaceGroup[] = [
      { id: GROUP_MAIN, kind: "household", name: "The Garcias", isPrimary: true },
      { id: GROUP_OTHER, kind: "household", name: "Other household", isPrimary: false },
    ];
    const own = place({ id: "own", contact_id: SUBJECT, client_group_id: null, address: "1", created_at: "2026-02-01T00:00:00.000Z" });
    const mainGroup = place({ id: "main", contact_id: null, client_group_id: GROUP_MAIN, address: "2", created_at: "2026-01-01T00:00:00.000Z" });
    const otherGroup = place({ id: "other", contact_id: null, client_group_id: GROUP_OTHER, address: "3", created_at: "2026-01-01T00:00:00.000Z" });
    const removed = place({ id: "removed", contact_id: SUBJECT, client_group_id: null, address: "4", archived_at: "2026-03-01T00:00:00.000Z" });

    const { active, removed: removedList } = placesInOrder([otherGroup, removed, mainGroup, own], SUBJECT, groups);
    expect(active.map((p) => p.id)).toEqual(["own", "main", "other"]);
    expect(removedList.map((p) => p.id)).toEqual(["removed"]);
  });
});

describe("ownerOptions", () => {
  it("'{name} only' then 'Shared with {group}', values contact:/group:, in Spanish 'Solo de {name}'", () => {
    const groups: ContactPlaceGroup[] = [{ id: GROUP_MAIN, kind: "household", name: "The Garcias", isPrimary: true }];
    expect(ownerOptions({ id: SUBJECT, name: "Maria" }, groups, "en")).toEqual([
      { value: `contact:${SUBJECT}`, label: "Maria only" },
      { value: `group:${GROUP_MAIN}`, label: "Shared with The Garcias" },
    ]);
    expect(ownerOptions({ id: SUBJECT, name: "Maria" }, groups, "es")[0]).toEqual({
      value: `contact:${SUBJECT}`, label: "Solo de Maria",
    });
  });
});

describe("sharedWith", () => {
  it("finds the place's own group, or null when it belongs to a person", () => {
    const groups: ContactPlaceGroup[] = [{ id: GROUP_MAIN, kind: "household", name: "The Garcias", isPrimary: true }];
    expect(sharedWith({ client_group_id: GROUP_MAIN }, groups)).toEqual(groups[0]);
    expect(sharedWith({ client_group_id: null }, groups)).toBeNull();
  });
  it("a group not among the supplied groups (one the reader cannot see) is null, never a guessed group", () => {
    const groups: ContactPlaceGroup[] = [{ id: GROUP_MAIN, kind: "household", name: "The Garcias", isPrimary: true }];
    expect(sharedWith({ client_group_id: GROUP_OTHER }, groups)).toBeNull();
  });
});

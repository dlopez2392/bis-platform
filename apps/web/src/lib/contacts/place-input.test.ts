import { describe, it, expect } from "vitest";
import type { PlaceRow, EquipmentRow } from "@bis/db";
import {
  PLACE_LIMITS, parseOwner, ownerValue, parsePlaceFields, parsePlacePatch,
  parseEquipmentFields, parseEquipmentPatch, parsePlaceSnapshot, parseEquipmentSnapshot,
} from "./place-input";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "99999999-9999-4999-8999-999999999999";
const PLACE_ID = "22222222-2222-4222-8222-222222222222";
const CONTACT_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const OLD_EQUIP_ID = "66666666-6666-4666-8666-666666666666";

function basePlaceRow(overrides: Partial<PlaceRow> = {}): PlaceRow {
  return {
    id: PLACE_ID, account_id: ACCOUNT, contact_id: CONTACT_ID, client_group_id: null,
    label: null, address: "1204 Nolana Ave", landmark: null, directions: null,
    city: null, region: null, postal_code: null, country: null,
    archived_at: null, created_by: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseEquipmentRow(overrides: Partial<EquipmentRow> = {}): EquipmentRow {
  return {
    id: "55555555-5555-4555-8555-555555555555", account_id: ACCOUNT, place_id: PLACE_ID, name: "AC upstairs",
    make: null, model: null, serial: null, notes: null,
    installed_on: null, warranty_until: null, replaces_id: null,
    created_by: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parsePlaceFields", () => {
  it("keeps a lenient place: a landmark alone is enough, structured parts optional, nothing parsed out of the address", () => {
    const res = parsePlaceFields({ landmark: "the blue house past the canal", address: "  1204 Nolana Ave, Apt 3  " });
    expect(res).toEqual({
      ok: true,
      fields: {
        label: null, address: "1204 Nolana Ave, Apt 3", landmark: "the blue house past the canal", directions: null,
        city: null, region: null, postal_code: null, country: null,
      },
    });
  });

  it("refuses a place with no address, landmark or directions (places.needOne) (mutation: drop the at-least-one check -> FAILS)", () => {
    expect(parsePlaceFields({ label: "Casa" })).toEqual({ ok: false, error: { key: "places.needOne" } });
  });

  it("trims every field with the edge class and refuses one past its limit, naming the limit", () => {
    const over = "a".repeat(PLACE_LIMITS.city + 1);
    const res = parsePlaceFields({ address: "1 Main St", city: `  ${over}  ` });
    expect(res).toEqual({ ok: false, error: { key: "inline.rule.tooLong", params: { max: PLACE_LIMITS.city } } });
  });

  it("country is US, MX or empty, never CA", () => {
    expect(parsePlaceFields({ address: "1 Main St", country: "US" })).toMatchObject({ ok: true, fields: { country: "US" } });
    expect(parsePlaceFields({ address: "1 Main St", country: "" })).toMatchObject({ ok: true, fields: { country: null } });
    expect(parsePlaceFields({ address: "1 Main St", country: "CA" })).toEqual({ ok: false, error: { key: "inline.invalidOption" } });
  });
});

describe("parsePlacePatch", () => {
  it("clearing the last of address, landmark and directions is refused; clearing one of two is allowed (mutation: check the patch alone, not the row after it -> FAILS)", () => {
    const onlyAddress = { address: "1 Main St", landmark: null, directions: null };
    expect(parsePlacePatch("address", "", onlyAddress)).toEqual({ ok: false, error: { key: "places.needOne" } });

    const twoFields = { address: "1 Main St", landmark: "blue house", directions: null };
    expect(parsePlacePatch("address", "", twoFields)).toEqual({ ok: true, patch: { address: null } });
  });

  it("an unknown field is refused", () => {
    const current = { address: "1 Main St", landmark: null, directions: null };
    expect(parsePlacePatch("notAField", "x", current)).toEqual({ ok: false, error: { key: "inline.invalidOption" } });
  });
});

describe("equipmentRule / parseEquipmentFields / parseEquipmentPatch", () => {
  const today = "2026-10-11";

  it("a replacement needs its date and a date after today is refused (mutation: drop notAfter -> FAILS)", () => {
    expect(parseEquipmentFields({ name: "AC" }, today, { replacement: true })).toEqual({
      ok: false, error: { key: "inline.rule.required" },
    });
    expect(parseEquipmentFields({ name: "AC", installed_on: "2026-10-12" }, today, { replacement: true })).toEqual({
      ok: false, error: { key: "inline.rule.future" },
    });
    expect(parseEquipmentFields({ name: "AC", installed_on: today }, today, { replacement: true })).toEqual({
      ok: true,
      fields: { name: "AC", make: null, model: null, serial: null, notes: null, installed_on: today, warranty_until: null },
    });
  });

  it("a successor's install date cannot be cleared inline (0071 equipment_replacement_dated)", () => {
    const current = { installed_on: "2026-01-01", warranty_until: null, replaces_id: OLD_EQUIP_ID };
    expect(parseEquipmentPatch("installed_on", "", today, current)).toEqual({ ok: false, error: { key: "inline.rule.required" } });
  });

  it("a warranty ending before install is refused (equipment.warrantyBeforeInstall)", () => {
    expect(
      parseEquipmentFields({ name: "AC", installed_on: "2026-01-01", warranty_until: "2025-12-31" }, today, { replacement: false }),
    ).toEqual({ ok: false, error: { key: "equipment.warrantyBeforeInstall" } });

    const current = { installed_on: "2026-01-01", warranty_until: null, replaces_id: null };
    expect(parseEquipmentPatch("warranty_until", "2025-12-31", today, current)).toEqual({
      ok: false, error: { key: "equipment.warrantyBeforeInstall" },
    });
  });

  it("an unknown equipment field is refused (mutation: drop the field guard in parseEquipmentPatch -> FAILS)", () => {
    const current = { installed_on: "2026-01-01", warranty_until: null, replaces_id: null };
    expect(parseEquipmentPatch("notAField", "x", today, current)).toEqual({ ok: false, error: { key: "inline.invalidOption" } });
    expect(parseEquipmentPatch("replaces_id", OLD_EQUIP_ID, today, current)).toEqual({ ok: false, error: { key: "inline.invalidOption" } });
  });

  it("a warranty date in the future is fine", () => {
    expect(parseEquipmentFields({ name: "AC", warranty_until: "2099-01-01" }, today, { replacement: false })).toEqual({
      ok: true,
      fields: { name: "AC", make: null, model: null, serial: null, notes: null, installed_on: null, warranty_until: "2099-01-01" },
    });
  });
});

describe("parseOwner / ownerValue", () => {
  it("round-trips contact:<id> and group:<id>; anything else is null", () => {
    expect(parseOwner(`contact:${CONTACT_ID}`)).toEqual({ contactId: CONTACT_ID, groupId: null });
    expect(parseOwner(`group:${GROUP_ID}`)).toEqual({ contactId: null, groupId: GROUP_ID });
    expect(parseOwner("nonsense")).toBeNull();
    expect(parseOwner("contact:not-a-uuid")).toBeNull();
    expect(parseOwner(42)).toBeNull();
    expect(ownerValue({ contact_id: CONTACT_ID, client_group_id: null })).toBe(`contact:${CONTACT_ID}`);
    expect(ownerValue({ contact_id: null, client_group_id: GROUP_ID })).toBe(`group:${GROUP_ID}`);
  });
});

describe("parsePlaceSnapshot", () => {
  it("refuses another account's snapshot, a missing id, and a row with two owners (mutation: drop the account check -> FAILS)", () => {
    const row = basePlaceRow();
    expect(parsePlaceSnapshot(row, ACCOUNT)).toEqual(row);
    expect(parsePlaceSnapshot({ ...row, account_id: OTHER_ACCOUNT }, ACCOUNT)).toBeNull();
    expect(parsePlaceSnapshot({ ...row, id: undefined }, ACCOUNT)).toBeNull();
    expect(parsePlaceSnapshot({ ...row, client_group_id: GROUP_ID }, ACCOUNT)).toBeNull(); // two owners
  });
});

describe("parseEquipmentSnapshot", () => {
  it("round-trips a valid unit and refuses another account's snapshot or a replacement with no install date", () => {
    const row = baseEquipmentRow();
    expect(parseEquipmentSnapshot(row, ACCOUNT)).toEqual(row);
    expect(parseEquipmentSnapshot({ ...row, account_id: OTHER_ACCOUNT }, ACCOUNT)).toBeNull();
    expect(parseEquipmentSnapshot({ ...row, replaces_id: OLD_EQUIP_ID, installed_on: null }, ACCOUNT)).toBeNull();
  });

  it("refuses a unit that replaces itself, in either case (0071 equipment_not_self; mutation: drop the self check -> FAILS)", () => {
    // An id with hex LETTERS, so its upper- and lowercase forms differ: Postgres compares uuids by value.
    const LETTERED = "abcdef12-5555-4555-8555-55555555555a";
    const row = baseEquipmentRow({ id: LETTERED, installed_on: "2026-01-01" });
    expect(parseEquipmentSnapshot({ ...row, replaces_id: OLD_EQUIP_ID }, ACCOUNT)).toEqual({ ...row, replaces_id: OLD_EQUIP_ID });
    expect(parseEquipmentSnapshot({ ...row, replaces_id: LETTERED }, ACCOUNT)).toBeNull();
    expect(parseEquipmentSnapshot({ ...row, replaces_id: LETTERED.toUpperCase() }, ACCOUNT)).toBeNull();
  });
});

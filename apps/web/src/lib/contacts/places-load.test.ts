import { describe, it, expect } from "vitest";
import { placesLoadFrom } from "./places-load";

const PLACE = {
  id: "11111111-1111-4111-8111-111111111111", account_id: "a1",
  contact_id: "22222222-2222-4222-8222-222222222222", client_group_id: null,
  label: null, address: "1204 Nolana Ave", landmark: null, directions: null,
  city: "McAllen", region: "TX", postal_code: "78504", country: "US",
  archived_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};
const UNIT = {
  id: "33333333-3333-4333-8333-333333333333", account_id: "a1", place_id: PLACE.id, name: "AC upstairs",
  make: "Rheem", model: null, serial: null, notes: null, installed_on: "2020-05-01", warranty_until: null,
  replaces_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};
const BODY = {
  subject: { id: PLACE.contact_id, firstName: "Ana", lastName: null },
  today: "2026-10-12",
  groups: [{ id: "44444444-4444-4444-8444-444444444444", kind: "household", name: "Casa Reyes", isPrimary: true }],
  places: [PLACE], placeCount: 1, equipment: [UNIT], equipmentCount: 1,
};
const res = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("placesLoadFrom: the card's read, parsed", () => {
  it("a 200 with the response shape is ready", async () => {
    expect(await placesLoadFrom(res(BODY))).toEqual({ status: "ready", data: BODY });
  });

  it("anything else is the card's error state (mutation: trust any 200 body -> FAILS)", async () => {
    const withoutToday: Record<string, unknown> = { ...BODY };
    delete withoutToday.today;
    const placeWithoutId: Record<string, unknown> = { ...PLACE };
    delete placeWithoutId.id;
    const cases: [string, Response][] = [
      ["a 500", res(BODY, 500)],
      ["a body without today", res(withoutToday)],
      ["a place without id", res({ ...BODY, places: [placeWithoutId] })],
      ["a unit without a name", res({ ...BODY, equipment: [{ ...UNIT, name: null }] })],
      ["a group without a name", res({ ...BODY, groups: [{ ...BODY.groups[0], name: 3 }] })],
      ["a today that is not a date", res({ ...BODY, today: "Oct 12" })],
      ["non-JSON", res("<html>")],
      ["null", res("null")],
    ];
    for (const [what, r] of cases) expect(await placesLoadFrom(r), what).toEqual({ status: "error" });
  });
});

import { describe, it, expect } from "vitest";
import { makeTr } from "./copy";
import { groupHeaderActions, firstGroupMapUrl, memberName, memberFirstName, peoplePagerHrefs } from "./group-header";
import type { GroupMember, PlaceRow } from "@bis/db";

const tr = makeTr("en");
const ana: GroupMember = { memberId: "m1", contactId: "c1", firstName: "Ana", lastName: "García", phone: "+19565550100",
  email: "ana@example.com", role: null, isBilling: false, isPrimaryContact: true, joinedAt: "2026-10-01T00:00:00Z" };
const place = (over: Partial<PlaceRow>): PlaceRow => ({ id: "p", account_id: "a1", contact_id: null, client_group_id: "g1", label: null,
  address: null, landmark: null, directions: null, city: null, region: null, postal_code: null, country: null, archived_at: null,
  created_by: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...over });

describe("the group header (spec §8.1, D4, C14)", () => {
  it("Call, Text and Email go to the call-first member and name them; Call is the only primary (mutation: make Text primary -> FAILS)", () => {
    const a = groupHeaderActions({ accountId: "a1", primary: ana, canText: true, directionsUrl: null, tr });
    expect(a.map((x) => [x.id, x.label, x.href, Boolean(x.primary)])).toEqual([
      ["call", "Call Ana", "tel:+19565550100", true],
      ["text", "Text Ana", "/dashboard/accounts/a1/contacts/c1#compose-sms", false],
      ["email", "Email Ana", "/dashboard/accounts/a1/contacts/c1#compose-email", false],
    ]);
  });
  it("no visible call-first member: no Call, Text or Email, Directions stays (mutation: fall back to the first member -> FAILS)", () => {
    const a = groupHeaderActions({ accountId: "a1", primary: null, canText: true, directionsUrl: "https://maps.example/x", tr });
    expect(a.map((x) => x.id)).toEqual(["directions"]);
  });
  it("the label uses the display name when there is no first name, and Spanish says 'Mandar texto a'", () => {
    const es = makeTr("es");
    const noFirst = { ...ana, firstName: null };
    expect(groupHeaderActions({ accountId: "a1", primary: noFirst, canText: true, directionsUrl: null, tr: es }).map((x) => x.label))
      .toEqual(["Llamar a García", "Mandar texto a García", "Mandar correo a García"]);
    expect(memberFirstName({ firstName: null, lastName: null }, es)).toBe("(sin nombre)");
    expect(memberName({ firstName: "Ana", lastName: "García" }, tr)).toBe("Ana García");
  });
  it("Directions takes the group's first active addressed place before the call-first member's own (mutation: swap the two lists -> FAILS)", () => {
    const shared = place({ id: "p1", address: "1 Main St" });
    const removed = place({ id: "p0", address: "9 Gone St", archived_at: "2026-10-02T00:00:00Z" });
    const own = place({ id: "p2", contact_id: "c1", client_group_id: null, address: "2 Oak St" });
    expect(firstGroupMapUrl([removed, shared], [own])).toContain(encodeURIComponent("1 Main St"));
    expect(firstGroupMapUrl([removed], [own])).toContain(encodeURIComponent("2 Oak St"));
    expect(firstGroupMapUrl([], [])).toBeNull();
  });
  it("People's pager: More carries ?people=, Back to the start only when paged, and only ?locale= is kept", () => {
    const h = peoplePagerHrefs({ basePath: "/g", next: { v: "2026-10-01T00:00:00Z", id: "11111111-1111-4111-8111-111111111111" }, paged: true, locale: "es" });
    expect(h.moreHref).toMatch(/^\/g\?locale=es&people=[\w-]+#group-people$/);
    expect(h.firstHref).toBe("/g?locale=es#group-people");
    expect(peoplePagerHrefs({ basePath: "/g", next: null, paged: false, locale: "<x>" })).toEqual({ moreHref: null, firstHref: null });
  });
});

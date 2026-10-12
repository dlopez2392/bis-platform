import { describe, it, expect } from "vitest";
import type { PlaceRow } from "@bis/db";
import { headerActions, canTextFrom, firstMapUrl, telHref } from "./header-actions";

const base = { phone: "+19565550100", email: "ana@example.com", canText: true, directionsUrl: "https://maps.example/x" };

describe("the header's actions (spec §9.1)", () => {
  it("all four, in order, and Call is the ONLY primary (mutation: make Text primary -> FAILS)", () => {
    const a = headerActions(base);
    expect(a.map((x) => x.id)).toEqual(["call", "text", "email", "directions"]);
    expect(a.filter((x) => x.primary).map((x) => x.id)).toEqual(["call"]);
    expect(a.find((x) => x.id === "text")!.href).toBe("#compose-sms");
    expect(a.find((x) => x.id === "email")!.href).toBe("#compose-email");
    expect(a.find((x) => x.id === "directions")).toMatchObject({ href: "https://maps.example/x", external: true });
  });
  it.each([
    ["no phone hides Call", { phone: null }, "call"],
    ["no email hides Email", { email: null }, "email"],
    ["a closed text gate hides Text", { canText: false }, "text"],
    ["no addressed property hides Directions", { directionsUrl: null }, "directions"],
  ])("%s, never disabled", (_n, over, gone) => {
    const ids = headerActions({ ...base, ...over }).map((x) => x.id);
    expect(ids).not.toContain(gone);
    expect(ids).toHaveLength(3);
  });
  it("Call dials the E.164 form, else the digits; a phone with no digits has no Call", () => {
    expect(telHref("(956) 555-0100")).toBe("tel:+19565550100");
    expect(telHref("ext 55-01")).toBe("tel:5501");
    expect(telHref("call me")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("canTextFrom: exactly when the composer's text form would open", () => {
  const gate = { ok: true as const, from: "+19565559999", ownedNumbers: ["+19565559999"] };
  it("open only with a usable number, an open gate and no consent line (mutation: ignore smsBlockedLine -> FAILS)", () => {
    expect(canTextFrom({ phone: "+19565550100", smsGate: gate, smsBlockedLine: null })).toBe(true);
    expect(canTextFrom({ phone: null, smsGate: gate, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: null, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "+19565550100", smsGate: gate, smsBlockedLine: "Stopped texts on Oct 3" })).toBe(false);
  });
});

describe("firstMapUrl (D13): the first ADDRESSED property in the Properties card's own order", () => {
  const stamp = { account_id: "a", created_by: null, updated_at: "2026-10-01T00:00:00Z" };
  const place = (over: Partial<PlaceRow>): PlaceRow => ({
    id: "p", contact_id: "ana", client_group_id: null, label: null, address: null, landmark: null, directions: null,
    city: null, region: null, postal_code: null, country: null, archived_at: null, created_at: "2026-10-01T00:00:00Z", ...stamp, ...over,
  });
  it("own before the group's, oldest first, skipping removed and address-less ones (mutation: take the last -> the group's Third St, FAILS)", () => {
    const places = [
      place({ id: "g", contact_id: null, client_group_id: "g1", address: "3 Third St", created_at: "2026-09-01T00:00:00Z" }),
      place({ id: "old", address: "0 Gone St", archived_at: "2026-10-05T00:00:00Z", created_at: "2026-09-15T00:00:00Z" }),
      place({ id: "land", landmark: "past the canal", created_at: "2026-09-20T00:00:00Z" }),
      place({ id: "first", address: "1 First St", created_at: "2026-10-01T00:00:00Z" }),
      place({ id: "second", address: "2 Second St", created_at: "2026-10-02T00:00:00Z" }),
    ];
    const url = firstMapUrl(places, "ana", [{ id: "g1", kind: "household", name: "García", isPrimary: true }]);
    expect(url).toContain(encodeURIComponent("1 First St"));
    expect(firstMapUrl([place({ landmark: "x" })], "ana", [])).toBeNull();
  });
});

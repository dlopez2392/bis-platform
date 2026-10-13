import { describe, it, expect, vi } from "vitest";
import type { PlaceRow } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { e164Of } from "@/lib/voice/phone-number";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeTr } from "./copy";

// The composer imports sonner at module scope; nothing here calls it.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { smsFormBlock } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer";
import { headerActions, headerActionLabels, canTextFrom, firstMapUrl, telHref } from "./header-actions";

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
    ["an empty email hides Email", { email: "" }, "email"],
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
  it("a composeHref prefixes Text and Email's anchors (S-03 part 2 §8.1); without one, today's bare anchor (mutation: always prefix -> the contact page's case FAILS)", () => {
    const withHref = headerActions({ ...base, composeHref: "/dashboard/accounts/a1/contacts/c9" });
    expect(withHref.find((x) => x.id === "text")!.href).toBe("/dashboard/accounts/a1/contacts/c9#compose-sms");
    expect(withHref.find((x) => x.id === "email")!.href).toBe("/dashboard/accounts/a1/contacts/c9#compose-email");
    const bare = headerActions(base);
    expect(bare.find((x) => x.id === "text")!.href).toBe("#compose-sms");
    expect(bare.find((x) => x.id === "email")!.href).toBe("#compose-email");
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
  it("a phone that is there but not a usable number hides Text (mutation: Boolean(input.phone) instead of e164Of -> FAILS)", () => {
    expect(canTextFrom({ phone: "123", smsGate: gate, smsBlockedLine: null })).toBe(false);
    expect(canTextFrom({ phone: "call me", smsGate: gate, smsBlockedLine: null })).toBe(false);
  });
  it("parity: Text shows exactly when the composer's own smsFormBlock lets the form open, over every combination (mutation: Boolean(input.phone) -> FAILS on '123'; ignore the gate -> FAILS)", () => {
    const phones = [null, "", "123", "call me", "(956) 555-0100", "+19565550100"];
    const gates: (SmsGate | null)[] = [null, { ok: false, reason: "a2p_not_approved" }, { ok: false, reason: "no_live_number" }, gate];
    const lines = [null, "", "Stopped texts on Oct 3"];
    const disagreements: string[] = [];
    for (const phone of phones) for (const smsGate of gates) for (const smsBlockedLine of lines) {
      const composerOpens = smsFormBlock(smsGate, Boolean(e164Of(phone)), smsBlockedLine) === null;
      if (canTextFrom({ phone, smsGate, smsBlockedLine }) !== composerOpens) {
        disagreements.push(JSON.stringify({ phone, gate: smsGate && smsGate.ok, smsBlockedLine, composerOpens }));
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe("headerActionLabels (S-03 part 3 C8): the header's words have one home", () => {
  it("Spanish words for every action, and only Call names the person (mutation: a drawer-only map that says 'Phone' -> FAILS)", () => {
    const labelled = headerActionLabels(headerActions(base), makeTr("es"), "Ana García");
    expect(labelled.map((a) => a.label)).toEqual(["Llamar", "Mandar texto", "Mandar correo", "Cómo llegar"]);
    expect(labelled.map((a) => a.ariaLabel)).toEqual(["Llamar a Ana García", undefined, undefined, undefined]);
  });
  it("keeps every href, primary and external flag (mutation: rebuild the action without primary -> FAILS)", () => {
    const raw = headerActions({ ...base, composeHref: "/dashboard/accounts/a1/contacts/c1" });
    const labelled = headerActionLabels(raw, makeTr("en"), "Ana");
    expect(labelled.map(({ id, href, primary, external }) => ({ id, href, primary, external })))
      .toEqual(raw.map(({ id, href, primary, external }) => ({ id, href, primary, external })));
  });
  it("the record page labels its header through it and keeps no map of its own (mutation: restore the page's ACTION_KEY -> FAILS)", () => {
    const page = readFileSync(fileURLToPath(new URL(
      "../../app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx", import.meta.url)), "utf8");
    expect(page).not.toMatch(/ACTION_KEY/);
    expect(page).toMatch(/headerActionLabels\(headerActions\(\{/);
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

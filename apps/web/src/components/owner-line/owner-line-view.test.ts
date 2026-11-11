import { describe, it, expect } from "vitest";
import { ownerLineCardView, ownerLineCardApplies, nationalNumber } from "./owner-line-view";

const NOW = new Date("2026-11-09T20:00:00.000Z");
const base = { switchOn: true, number: "+19565550100", now: NOW, zone: "America/Chicago", locale: "en" as const, offered: true };
const enr = (over = {}) => ({ id: "e", e164: "+19565550142", verifiedAt: "2026-11-09T19:00:00Z", verifyExpiresAt: null,
  pinSetAt: "2026-11-09T19:01:00Z", lockedUntil: null, ...over });

describe("the card's status line in words (spec §3.1)", () => {
  it("ready: names the business's number in its national form", () => {
    expect(ownerLineCardView({ ...base, enrollment: enr() })).toEqual({ step: "ready", cell: "956-555-0142",
      status: { key: "ownerLine.card.status.ready", params: { number: "956-555-0100" } } });
  });
  it("the switch off says so, whatever else is ready (mutation: ignore switchOn -> FAILS)", () => {
    expect(ownerLineCardView({ ...base, switchOn: false, enrollment: enr() }).status.key).toBe("ownerLine.card.status.off");
  });
  it("locked: says until when, in the account's zone", () => {
    const v = ownerLineCardView({ ...base, enrollment: enr({ lockedUntil: "2026-11-09T20:30:00.000Z" }) });
    expect(v).toMatchObject({ step: "locked", status: { key: "ownerLine.card.status.locked", params: { time: "2:30 PM" } } });
  });
  it("no cell yet, or not verified: the cell step; verified without a PIN: the PIN step", () => {
    expect(ownerLineCardView({ ...base, enrollment: null }).step).toBe("cell");
    expect(ownerLineCardView({ ...base, enrollment: enr({ verifiedAt: null, pinSetAt: null }) }).step).toBe("cell");
    expect(ownerLineCardView({ ...base, enrollment: enr({ pinSetAt: null }) }).step).toBe("pin");
  });
  it("nationalNumber: US numbers read 956-555-0100; others stay E.164", () => {
    expect(nationalNumber("+19565550100")).toBe("956-555-0100");
    expect(nationalNumber("+528991234567")).toBe("+528991234567");
  });
});

/**
 * Task 6 brief's must #1 (Task 5 review m-3): a member whose role the owner line no longer offers (Staff demoted
 * to Technician) but who still holds an enrolment sees a card offering ONLY "Stop calling in" — a lost offer
 * outranks every other state the enrolment and the switch could otherwise show.
 */
describe("a role the owner line no longer offers (must #1)", () => {
  it("still enrolled: step is stopOnly regardless of the switch, a missing PIN or a lock (mutation: drop the !offered branch -> FAILS, since the switch-on+verified+PIN case would read 'ready')", () => {
    for (const over of [{}, { pinSetAt: null }, { lockedUntil: "2026-11-09T20:30:00.000Z" }]) {
      const v = ownerLineCardView({ ...base, offered: false, switchOn: true, enrollment: enr(over) });
      expect(v.step, JSON.stringify(over)).toBe("stopOnly");
      expect(v.status.key, JSON.stringify(over)).toBe("ownerLine.card.status.notOffered");
    }
    const vOff = ownerLineCardView({ ...base, offered: false, switchOn: false, enrollment: enr() });
    expect(vOff.step).toBe("stopOnly");
  });

  it("carries the enrolled cell, so the person can see what they are about to stop", () => {
    const v = ownerLineCardView({ ...base, offered: false, enrollment: enr({ e164: "+19565550199" }) });
    expect(v.cell).toBe("956-555-0199");
  });
});

describe("ownerLineCardApplies — must #1's second half: no card at all with neither an offer nor an enrolment", () => {
  it("an offered role always gets a card, enrolled or not", () => {
    expect(ownerLineCardApplies(true, false)).toBe(true);
    expect(ownerLineCardApplies(true, true)).toBe(true);
  });
  it("a role no longer offered gets a card only while an enrolment remains (mutation: return `offered` alone -> FAILS)", () => {
    expect(ownerLineCardApplies(false, true)).toBe(true);
    expect(ownerLineCardApplies(false, false)).toBe(false);
  });
});

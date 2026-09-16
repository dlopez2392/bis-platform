import { describe, it, expect } from "vitest";
import { resolveHandoffTarget, newHandoffToken, handoffLine, transferFailedLine } from "./handoff";

describe("resolveHandoffTarget", () => {
  it("is unavailable when no number is configured — the field IS the switch", () => {
    expect(resolveHandoffTarget(null, ["+19565061545"]))
      .toEqual({ available: false, reason: "not-configured" });
  });
  it("is available when a number is set and is not ours", () => {
    expect(resolveHandoffTarget("+19562921696", ["+19565061545"]))
      .toEqual({ available: true, to: "+19562921696" });
  });
  it("REFUSES a number this account owns — transferring there loops the caller back into Sofía", () => {
    expect(resolveHandoffTarget("+19565061545", ["+19565061545"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("refuses a SECOND owned number, not only the one calls arrive on", () => {
    // refusesAlertLoop's own history: it was widened from the single resolved
    // sender to every owned number because a second, still-provisioning number
    // was an unguarded loop.
    expect(resolveHandoffTarget("+19565550111", ["+19565061545", "+19565550111"]))
      .toEqual({ available: false, reason: "own-number" });
  });
  it("is available when the owned list is empty", () => {
    expect(resolveHandoffTarget("+19562921696", []))
      .toEqual({ available: true, to: "+19562921696" });
  });
});

describe("newHandoffToken", () => {
  it("is unguessable and unique across calls", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newHandoffToken()));
    expect(seen.size).toBe(500);
    for (const t of seen) expect(t).toMatch(/^[A-Za-z0-9_-]{22,}$/);
  });
});

describe("spoken lines", () => {
  it("say something in both languages, and `both` takes English like the greeting does", () => {
    expect(handoffLine("es")).not.toBe(handoffLine("en"));
    expect(handoffLine("both")).toBe(handoffLine("en"));
    expect(transferFailedLine("both")).toBe(transferFailedLine("en"));
  });
  it("the failure line does not promise a callback nobody scheduled", () => {
    // The caller was already told they were being put through. The line must
    // say plainly that nobody picked up — not "we will call you back", which
    // nothing in this flow arranges.
    expect(transferFailedLine("en").toLowerCase()).not.toContain("call you back");
  });
});

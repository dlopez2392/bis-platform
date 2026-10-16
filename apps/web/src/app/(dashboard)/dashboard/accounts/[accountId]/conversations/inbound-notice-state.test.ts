import { describe, it, expect } from "vitest";
import type { EmailView } from "@/lib/consent/email-view";
import { currentStopState } from "./inbound-notice-state";

/**
 * Fix round 1 (UI review, important #2): the notice must reflect the stop's
 * CURRENT state, not the filing-time snapshot `meta.consent` carries. Pure
 * so `message-thread.tsx` (the server component) can compute it without any
 * client-side guessing — no hydration mismatch.
 */
describe("currentStopState", () => {
  it("day 6: the stop is still the newest row and under 7 days old → current, not expired (mutation: ignore `how.expired` → FAILS)", () => {
    const view: EmailView = { kind: "stopped", eventId: "ev_1", since: "2026-10-10T00:00:00Z", how: { kind: "reply", expired: false }, canResume: false };
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, view)).toEqual({ stopIsCurrent: true, initiallyExpired: false, chipActionable: false });
  });

  it("day 8: still the newest row but past 7 days → current AND expired (mutation: always answer initiallyExpired:false → FAILS)", () => {
    const view: EmailView = { kind: "stopped", eventId: "ev_1", since: "2026-10-01T00:00:00Z", how: { kind: "reply", expired: true }, canResume: false };
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, view)).toEqual({ stopIsCurrent: true, initiallyExpired: true, chipActionable: false });
  });

  it("after a staff Undo: the ledger's newest row is allowed again, not this stop at all → not current (mutation: match on consent.kind alone → FAILS)", () => {
    const view: EmailView = { kind: "allowed", newestId: "ev_2" };
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, view)).toEqual({ stopIsCurrent: false, initiallyExpired: false, chipActionable: false });
  });

  it("superseded by a LATER event (a different stop is now newest): this message's own stop is not current (mutation: compare only view.kind, ignore eventId → FAILS)", () => {
    const view: EmailView = { kind: "stopped", eventId: "ev_9", since: "2026-10-12T00:00:00Z", how: { kind: "reply", expired: false }, canResume: false };
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, view).stopIsCurrent).toBe(false);
  });

  it("the newest row is stopped but by a DIFFERENT method (staff, not a reply): never read as this message's own current stop (mutation: drop the how.kind check → FAILS)", () => {
    const view: EmailView = { kind: "stopped", eventId: "ev_1", since: "2026-10-12T00:00:00Z", how: { kind: "staff" }, canResume: true };
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, view).stopIsCurrent).toBe(false);
  });

  it("no view at all (contact not visible, no email, or the read failed): reads as not current, not actionable (mutation: default stopIsCurrent to true → FAILS)", () => {
    expect(currentStopState({ kind: "stopped", eventId: "ev_1" }, undefined)).toEqual({ stopIsCurrent: false, initiallyExpired: false, chipActionable: false });
  });

  it("the maybe chip's button is actionable only while the address currently reads allowed (mutation: answer chipActionable:true for a stopped view → FAILS)", () => {
    const allowed: EmailView = { kind: "allowed", newestId: "ev_3" };
    const stopped: EmailView = { kind: "stopped", eventId: "ev_3", since: "2026-10-12T00:00:00Z", how: { kind: "staff" }, canResume: true };
    expect(currentStopState({ kind: "maybe" }, allowed)).toEqual({ stopIsCurrent: false, initiallyExpired: false, chipActionable: true });
    expect(currentStopState({ kind: "maybe" }, stopped)).toEqual({ stopIsCurrent: false, initiallyExpired: false, chipActionable: false });
  });

  it("consent kind 'none': always the all-false rest state", () => {
    expect(currentStopState({ kind: "none" }, undefined)).toEqual({ stopIsCurrent: false, initiallyExpired: false, chipActionable: false });
  });
});

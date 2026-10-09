import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { cancelStep, NO_NOTICE } from "./cancel-flow";

/**
 * F-048 fix round (I1, M2): the Cancel dialog exists to compose a customer
 * notice. Where no notice can go, a dialog would be a bare "Are you sure?",
 * which DESIGN.md rule 6 forbids, so Cancel cancels at once instead, as
 * D-036 did, and the toast says why the customer was not told.
 */
describe("cancelStep — the dialog only when there is a notice to compose", () => {
  it("no email on file: cancel at once, no probe, with the we-haven't-told-them toast (mutation: always open the dialog → FAILS)", () => {
    for (const email of [null, "", "   "]) {
      expect(cancelStep(email, null)).toEqual({ kind: "now", toast: m["calendar.bookings.cancelledToast"] });
    }
  });

  it("an email on file: ask the server first whether a notice can go", () => {
    expect(cancelStep("maria@example.com", null)).toEqual({ kind: "probe" });
  });

  it("a notice can go: open the dialog", () => {
    expect(cancelStep("maria@example.com", "available")).toEqual({ kind: "dialog" });
  });

  it("the address cannot receive email: cancel at once, and the toast says so (M2; mutation: open the dialog → FAILS)", () => {
    expect(cancelStep("maria@example.com", "address_blocked"))
      .toEqual({ kind: "now", toast: m["calendar.bookings.cancelledToastAddressBlocked"] });
    expect(m["calendar.bookings.cancelledToastAddressBlocked"]).toMatch(/can't receive/);
  });

  it("an account marked not to send, or an address gone by now: cancel at once, no dialog offering an email (M2)", () => {
    for (const a of ["suppressed_account", "no_email"] as const) {
      expect(cancelStep("maria@example.com", a)).toEqual({ kind: "now", toast: m["calendar.bookings.cancelledToast"] });
    }
  });

  it("cancelling at once asks for no notice at all", () => {
    expect(NO_NOTICE.send).toBe(false);
  });
});

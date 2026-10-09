import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { cancelStep, NO_NOTICE, runCancelButton } from "./cancel-flow";
import type { CancelNoticeOptionResult } from "./actions";

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

/**
 * Fix round 2 (I-1): the Cancel button's whole sequence, minus React, so it
 * is pinned and not only the decision it uses. M-a: a failed probe fails
 * OPEN to the reversible action, cancelling at once with no notice and the
 * we-haven't-told-them toast, so a broken read never stops the owner
 * cancelling.
 */
describe("runCancelButton — what pressing Cancel does (F-048 I-1, M-a)", () => {
  function harness(probeResult: (() => Promise<CancelNoticeOptionResult>) | CancelNoticeOptionResult) {
    const calls: string[] = [];
    const probe = vi.fn(async () => {
      calls.push("probe");
      return typeof probeResult === "function" ? probeResult() : probeResult;
    });
    const openDialog = vi.fn(() => { calls.push("dialog"); });
    const cancelNow = vi.fn(async (toast: string) => { calls.push(`now:${toast}`); });
    return { calls, probe, openDialog, cancelNow };
  }
  const HAVENT = m["calendar.bookings.cancelledToast"];
  const BLOCKED = m["calendar.bookings.cancelledToastAddressBlocked"];

  it("(1) no email on file: cancels at once and never asks the server (mutation L1: open the dialog at once without asking → FAILS)", async () => {
    const h = harness({ ok: true, notice: "available" });
    await runCancelButton({ contactEmail: null, ...h });
    expect(h.calls).toEqual([`now:${HAVENT}`]);
  });

  it("(2) a notice can go: asks the server, then opens the dialog (mutation L1 → the probe is skipped, FAILS)", async () => {
    const h = harness({ ok: true, notice: "available" });
    await runCancelButton({ contactEmail: "maria@example.com", ...h });
    expect(h.calls).toEqual(["probe", "dialog"]);
  });

  it("(3) the address cannot receive email: cancels at once with the blocked-address toast, no dialog", async () => {
    const h = harness({ ok: true, notice: "address_blocked" });
    await runCancelButton({ contactEmail: "maria@example.com", ...h });
    expect(h.calls).toEqual(["probe", `now:${BLOCKED}`]);
  });

  it("(4) an account marked not to send: cancels at once, no dialog offering an email", async () => {
    const h = harness({ ok: true, notice: "suppressed_account" });
    await runCancelButton({ contactEmail: "maria@example.com", ...h });
    expect(h.calls).toEqual(["probe", `now:${HAVENT}`]);
  });

  it("(5) the server answers not-ok: fails OPEN, cancelling at once with no notice and the we-haven't-told-them toast (mutation L2: a failed probe cancels nothing → FAILS)", async () => {
    const h = harness({ ok: false, error: "Could not update this booking." });
    await runCancelButton({ contactEmail: "maria@example.com", ...h });
    expect(h.calls).toEqual(["probe", `now:${HAVENT}`]);
  });

  it("(6) the probe throws: fails OPEN the same way, never a dialog (mutation L2 → FAILS)", async () => {
    const h = harness(async () => { throw new Error("stale action"); });
    await runCancelButton({ contactEmail: "maria@example.com", ...h });
    expect(h.calls).toEqual(["probe", `now:${HAVENT}`]);
  });
});

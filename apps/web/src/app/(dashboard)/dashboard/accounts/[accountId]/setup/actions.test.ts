import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The setup wizard's only write in this task: the two manual ticks (email
 * "skip for now", forwarding "confirmed at the carrier") that have no
 * derivable source anywhere in the database — see the header of
 * lib/setup/setup-status.ts for why those two, and only those two, are
 * stored rather than computed.
 *
 * The guard shape under test is the one voice/actions.ts established and its
 * own test pins: `requireAccountAccess` resolves for any authenticated caller
 * who legitimately owns the account, client or agency, so the ACTION is what
 * has to turn `isAgency: false` into a refusal — and it has to do that
 * BEFORE touching the database. `checklist_items` writes here run on
 * `serviceDb()`, which bypasses RLS entirely, so a guard that ran after the
 * write (or not at all) would let a client user tick their own setup steps
 * with nothing else standing in the way. Hence the not-called assertion
 * below, which is the actual boundary; the `{ ok: false }` return is only how
 * it is reported.
 */

const dbMocks = vi.hoisted(() => ({ setChecklistItem: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));

const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { setSetupTickAction } from "./actions";

beforeEach(() => {
  dbMocks.setChecklistItem.mockReset();
  dbMocks.setChecklistItem.mockResolvedValue(undefined);
  guardFixture.isAgency = true;
});

describe("setSetupTickAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await setSetupTickAction("a1", "emailSkipped", true);
    expect(r).toEqual({ ok: false });
    expect(dbMocks.setChecklistItem).not.toHaveBeenCalled();
  });

  it("ticks the email-skipped key through serviceDb, under the shared catalogue key", async () => {
    const r = await setSetupTickAction("a1", "emailSkipped", true);
    expect(r).toEqual({ ok: true });
    // The literal key matters as much as the call: the page READS
    // `SETUP_TICK_KEYS.emailSkipped` back out of `checklist_items`, so a typo
    // on either side loses the tick silently rather than failing.
    expect(dbMocks.setChecklistItem).toHaveBeenCalledWith(
      {}, "a1", "setup:email_skipped", { done: true }, "user_1",
    );
  });

  it("un-ticks forwarding with done:false rather than deleting the row", async () => {
    const r = await setSetupTickAction("a1", "forwardingDone", false);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setChecklistItem).toHaveBeenCalledWith(
      {}, "a1", "setup:forwarding_done", { done: false }, "user_1",
    );
  });
});

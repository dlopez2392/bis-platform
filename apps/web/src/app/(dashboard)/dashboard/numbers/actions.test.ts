import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getPhoneNumberById: vi.fn(),
  listAccounts: vi.fn(),
  listPhoneNumbersForAccount: vi.fn(),
  reassignPhoneNumber: vi.fn(),
  setPhoneNumberStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));

/**
 * Guard mock.
 *
 * Unlike the per-account voice actions — which mock `requireAccountAccess`
 * with a switchable `isAgency` field because they RETURN a refusal — these
 * two guard with `requireAgency`, which redirects. There is no account in
 * scope here to soften the answer with: a client reaching these functions is
 * not a permissions edge case, they are on a page that is not theirs.
 *
 * `redirect()` throws in Next, so the fixture below throws too: that is what
 * makes "the guard runs before any read" testable rather than merely
 * asserted in a comment.
 */
const guardFixture = vi.hoisted(() => ({ agency: true }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => {
    if (!guardFixture.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_agency" };
  },
}));

import { m } from "@/lib/messages";
import { moveNumberToAccountAction, releaseNumberAction } from "./actions";

const row = (over: Partial<{ id: string; account_id: string; e164: string; status: string }> = {}) => ({
  id: "num_1", account_id: "acct_source", e164: "+19567055146",
  telnyx_id: null, status: "released", ...over,
});

beforeEach(() => {
  Object.values(dbMocks).forEach((fn) => fn.mockReset());
  guardFixture.agency = true;
  dbMocks.getPhoneNumberById.mockResolvedValue(row());
  dbMocks.listAccounts.mockResolvedValue([
    { id: "acct_source", name: "Old Client", status: "active" },
    { id: "acct_dest", name: "New Client", status: "active" },
  ]);
  // The empty-destination case — the ordinary path. Tests about an occupied
  // destination override this explicitly.
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
  dbMocks.reassignPhoneNumber.mockResolvedValue(row({ account_id: "acct_dest" }));
  dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
});

describe("moveNumberToAccountAction", () => {
  /**
   * The boundary. This action takes BOTH ids from the browser — the one
   * structural guard the setup wizard's own move relies on ("a caller can
   * choose which number to take, never which account to give it to") does
   * not exist here, so the role check is the whole of it, and it must run
   * before any read is even issued.
   */
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.agency = false;
    await expect(moveNumberToAccountAction("num_1", "acct_dest")).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.getPhoneNumberById).not.toHaveBeenCalled();
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("moves the number and passes the acting user through for the timeline", async () => {
    const r = await moveNumberToAccountAction("num_1", "acct_dest");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.reassignPhoneNumber).toHaveBeenCalledWith({}, "num_1", "acct_dest", "user_agency");
  });

  /**
   * The invariant `deriveSetupStatus` has no step for: two active numbers on
   * one account. The picker already withholds an occupied company — this is
   * the check that holds when that render is stale.
   */
  it("refuses a destination that already has an active number", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "live" }]);
    const r = await moveNumberToAccountAction("num_1", "acct_dest");
    expect(r).toEqual({ ok: false, error: m["voice.moveDestinationOccupied"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  /**
   * Archived is the one account state that means "this company is over".
   * The picker already withholds it; this is the same rule re-established
   * from the database, for the tab that was open before someone archived it.
   */
  it("refuses an archived destination", async () => {
    dbMocks.listAccounts.mockResolvedValue([{ id: "acct_dest", name: "Closed Co", status: "archived" }]);
    const r = await moveNumberToAccountAction("num_1", "acct_dest");
    expect(r).toEqual({ ok: false, error: m["numbers.destinationArchived"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("allows a paused destination — pausing is not the end of a client", async () => {
    dbMocks.listAccounts.mockResolvedValue([{ id: "acct_dest", name: "Resting Co", status: "paused" }]);
    expect(await moveNumberToAccountAction("num_1", "acct_dest")).toEqual({ ok: true });
  });

  it("refuses a destination that no longer exists, with a sentence rather than a 500", async () => {
    // The FK on phone_numbers.account_id would reject this too — as an
    // exception nobody can act on.
    dbMocks.listAccounts.mockResolvedValue([{ id: "acct_other", name: "Someone Else", status: "active" }]);
    expect(await moveNumberToAccountAction("num_1", "acct_dest"))
      .toEqual({ ok: false, error: m["numbers.destinationMissing"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("allows a destination whose only number is released", async () => {
    // The churn case: the slot a departed client left behind is free again.
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "released" }]);
    expect(await moveNumberToAccountAction("num_1", "acct_dest")).toEqual({ ok: true });
  });

  /**
   * A move to where it already is is not harmless: `reassignPhoneNumber`
   * resets status to `provisioned` and emits a released/assigned pair on the
   * same timeline, so a double-click on a LIVE number would take the client's
   * line down and call it a success.
   */
  it("refuses a move onto the account that already holds the number", async () => {
    dbMocks.getPhoneNumberById.mockResolvedValue(row({ account_id: "acct_dest", status: "live" }));
    const r = await moveNumberToAccountAction("num_1", "acct_dest");
    expect(r).toEqual({ ok: false, error: m["numbers.sameAccount"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("reports a number that no longer exists rather than moving nothing", async () => {
    dbMocks.getPhoneNumberById.mockResolvedValue(null);
    expect(await moveNumberToAccountAction("num_gone", "acct_dest"))
      .toEqual({ ok: false, error: m["numbers.notFound"] });
  });

  it("turns a failed move into a refusal rather than a 500", async () => {
    dbMocks.reassignPhoneNumber.mockRejectedValue(new Error("boom"));
    expect(await moveNumberToAccountAction("num_1", "acct_dest"))
      .toEqual({ ok: false, error: m["voice.moveFailed"] });
  });

  it("rejects blank ids without touching the database", async () => {
    expect(await moveNumberToAccountAction("", "acct_dest")).toMatchObject({ ok: false });
    expect(await moveNumberToAccountAction("num_1", "  ")).toMatchObject({ ok: false });
    expect(dbMocks.getPhoneNumberById).not.toHaveBeenCalled();
  });
});

describe("releaseNumberAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.agency = false;
    await expect(releaseNumberAction("num_1")).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.getPhoneNumberById).not.toHaveBeenCalled();
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });

  /**
   * The account comes off the ROW, never off the caller.
   * `setPhoneNumberStatus` scopes its UPDATE by `account_id` as well as id,
   * so a browser-supplied account would turn the write into a silent no-op —
   * the operator would be told the line stopped answering while it kept
   * answering.
   */
  it("scopes the write to the account the number is actually on", async () => {
    dbMocks.getPhoneNumberById.mockResolvedValue(row({ account_id: "acct_holder", status: "live" }));
    const r = await releaseNumberAction("num_1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setPhoneNumberStatus)
      .toHaveBeenCalledWith({}, "acct_holder", "num_1", "released", "user_agency");
  });

  it("refuses a number that is already out of service", async () => {
    dbMocks.getPhoneNumberById.mockResolvedValue(row({ status: "released" }));
    const r = await releaseNumberAction("num_1");
    expect(r).toEqual({ ok: false, error: m["numbers.alreadyReleased"] });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });

  it("turns a failed release into a refusal rather than a 500", async () => {
    dbMocks.getPhoneNumberById.mockResolvedValue(row({ status: "live" }));
    dbMocks.setPhoneNumberStatus.mockRejectedValue(new Error("boom"));
    expect(await releaseNumberAction("num_1"))
      .toEqual({ ok: false, error: m["numbers.releaseFailed"] });
  });
});

import { describe, it, expect, vi } from "vitest";
import { redirect } from "next/navigation";
import { m } from "@/lib/messages";
import { settleCreateAccount } from "./create-account-feedback";

/**
 * What the create dialog does with the action's outcome, without a DOM: the
 * dialog hands `settleCreateAccount` the call and two callbacks, so the
 * branch a refusal takes is pinned here rather than in a component nobody in
 * this folder can submit.
 *
 * `redirect` is the REAL one from next/navigation, so the redirect case
 * exercises the real NEXT_REDIRECT error and the real `unstable_rethrow`
 * rather than a stand-in that agrees with itself.
 */
function ui() {
  return { close: vi.fn(), error: vi.fn() };
}

describe("settleCreateAccount", () => {
  it("shows the refusal the action returned, not the generic toast, and keeps the dialog open", async () => {
    const u = ui();
    await settleCreateAccount(
      async () => ({ ok: false as const, error: "Enter a business name." }), u);
    expect(u.error).toHaveBeenCalledTimes(1);
    expect(u.error).toHaveBeenCalledWith("Enter a business name.");
    expect(u.close).not.toHaveBeenCalled();
  });

  it("an unexpected throw still gets the generic toast", async () => {
    const u = ui();
    await settleCreateAccount(async () => { throw new Error("db is down"); }, u);
    expect(u.error).toHaveBeenCalledWith(m["accounts.createFailed"]);
    expect(u.close).not.toHaveBeenCalled();
  });

  it("a successful create's redirect propagates, untoasted, so the navigation happens", async () => {
    const u = ui();
    await expect(
      settleCreateAccount(async () => redirect("/dashboard/accounts/acct_1/setup"), u),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(u.error).not.toHaveBeenCalled();
    expect(u.close).not.toHaveBeenCalled();
  });

  it("an ok result closes the dialog", async () => {
    const u = ui();
    await settleCreateAccount(async () => ({ ok: true as const }), u);
    expect(u.close).toHaveBeenCalledTimes(1);
    expect(u.error).not.toHaveBeenCalled();
  });
});

// 2026-08-29: a settings Save clicked in a tab loaded before a redeploy
// posts to a server-action id that no longer exists — the invocation THROWS
// client-side, and the house `const result = await action(formData)` wrapper
// had no catch, so the operator got no toast, no error, nothing: a form that
// silently ignored Save. danlo hit exactly this mid-exit-gate (two deploys
// under his open tabs the same day) and read it, correctly, as data loss.
import { describe, it, expect, vi } from "vitest";
import { notifyActionResult } from "./action-feedback";

const MSG = { success: "Saved", crashed: "Could not save — reload and retry" };

function notifier() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("notifyActionResult", () => {
  it("ok result → success toast only", async () => {
    const n = notifier();
    await notifyActionResult(async () => ({ ok: true as const }), n, MSG);
    expect(n.success).toHaveBeenCalledWith("Saved");
    expect(n.error).not.toHaveBeenCalled();
  });

  it("failed result → error toast carrying the ACTION'S message, not the crash copy", async () => {
    const n = notifier();
    await notifyActionResult(
      async () => ({ ok: false as const, error: "Could not save booking settings." }), n, MSG);
    expect(n.error).toHaveBeenCalledWith("Could not save booking settings.");
    expect(n.success).not.toHaveBeenCalled();
  });

  it("a THROWING action — the stale-deployment case — surfaces the crash copy instead of vanishing", async () => {
    const n = notifier();
    await notifyActionResult(async () => { throw new Error("Failed to find Server Action"); }, n, MSG);
    expect(n.error).toHaveBeenCalledWith(MSG.crashed);
    expect(n.success).not.toHaveBeenCalled();
  });

  it("never rethrows — the form handler must not escalate to an error boundary over a toastable failure", async () => {
    const n = notifier();
    await expect(
      notifyActionResult(async () => { throw new Error("boom"); }, n, MSG),
    ).resolves.toBeUndefined();
  });
});

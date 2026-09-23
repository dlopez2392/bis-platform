import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { flipMarketingOptOut, type OptOutToast } from "./marketing-optout";

/**
 * The "No marketing emails" switch's behaviour, minus React: runs at once
 * (optimistic), reports a failure by putting the box back, and on success
 * offers an Undo that writes the OPPOSITE value (DESIGN.md rule 6). The
 * component (marketing-optout-switch.tsx) is a thin shell over this.
 */
function harness(saveResults: Array<{ ok: true } | { ok: false; error: string } | Error>) {
  const save = vi.fn<(optedOut: boolean) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => {
    const next = saveResults.shift() ?? { ok: true as const };
    if (next instanceof Error) throw next;
    return next;
  });
  const shown: boolean[] = [];
  const show = (checked: boolean) => { shown.push(checked); };
  let undo: (() => void) | null = null;
  const toast = {
    success: vi.fn((...[, opts]: [string, { action: { label: string; onClick: () => void } }]) => {
      undo = opts.action.onClick;
    }),
    error: vi.fn(),
  } satisfies OptOutToast;
  return { save, shown, show, toast, undo: () => undo };
}

describe("flipMarketingOptOut", () => {
  it("ticking saves `true`, shows it ticked at once, and toasts with an Undo", async () => {
    const h = harness([{ ok: true }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    expect(h.save).toHaveBeenCalledWith(true);
    expect(h.shown).toEqual([true]);
    expect(h.toast.success).toHaveBeenCalledWith(
      m["contact.marketingOptOut.onToast"],
      expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }),
    );
  });

  it("unticking toasts the 'turned back on' line", async () => {
    const h = harness([{ ok: true }]);
    await flipMarketingOptOut(false, h.save, h.show, h.toast);
    expect(h.save).toHaveBeenCalledWith(false);
    expect(h.toast.success.mock.calls[0]?.[0]).toBe(m["contact.marketingOptOut.offToast"]);
  });

  it("Undo writes the OPPOSITE value and puts the box back", async () => {
    const h = harness([{ ok: true }, { ok: true }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    const undo = h.undo();
    expect(undo).not.toBeNull();
    await (undo as unknown as () => Promise<void>)();
    expect(h.save.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(h.shown).toEqual([true, false]);
  });

  it("a failed Undo says so and leaves the box as the server has it", async () => {
    const h = harness([{ ok: true }, { ok: false, error: "nope" }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    await (h.undo() as unknown as () => Promise<void>)();
    expect(h.toast.error).toHaveBeenCalledWith("nope");
    expect(h.shown).toEqual([true, false, true]);
  });

  it("a refused save puts the box back and shows the action's own error, no success toast", async () => {
    const h = harness([{ ok: false, error: "Couldn't save" }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    expect(h.shown).toEqual([true, false]);
    expect(h.toast.error).toHaveBeenCalledWith("Couldn't save");
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("a save that REJECTS (stale tab after a redeploy) is reported, not swallowed", async () => {
    const h = harness([new Error("Failed to find Server Action")]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    expect(h.shown).toEqual([true, false]);
    expect(h.toast.error).toHaveBeenCalledWith(m["inline.crashed"]);
  });
});

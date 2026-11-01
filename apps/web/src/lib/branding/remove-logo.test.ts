import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { runRemoveLogo, type RemoveLogoResult, type RestoreLogoResult } from "./remove-logo";

function fakeToast() {
  let undo: (() => void) | null = null;
  return {
    toast: {
      success: vi.fn((_msg: string, opts?: { action: { label: string; onClick: () => void } }) => {
        undo = opts?.action.onClick ?? null;
      }),
      error: vi.fn(),
    },
    clickUndo: () => undo?.(),
  };
}

describe("runRemoveLogo — the pure sequencing behind the Branding card's Remove-logo button", () => {
  it("calls remove, flips the panel to 'no logo', and toasts success with an Undo action (mutation: skip show(false) → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: true, path: "acct_1/logo.png" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast } = fakeToast();

    expect(await runRemoveLogo(remove, restore, show, toast)).toBe(true);
    expect(show).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith(m["branding.logoRemoved"], expect.any(Object));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the server's error and does NOT flip the panel when remove refuses (mutation: call show(false) on failure too → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: false, error: "nope" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast } = fakeToast();

    expect(await runRemoveLogo(remove, restore, show, toast)).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("nope");
  });

  it("toasts the generic crashed message when remove throws, rather than letting it escape (mutation: drop the try/catch → the test's own await rejects, FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => { throw new Error("boom"); });
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast } = fakeToast();

    expect(await runRemoveLogo(remove, restore, show, toast)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });

  it("Undo calls restore with the EXACT path remove returned, and flips the panel back to 'has logo' on success (mutation: hardcode a different path, or drop show(true) → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: true, path: "acct_1/logo-xyz.png" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast, clickUndo } = fakeToast();

    await runRemoveLogo(remove, restore, show, toast);
    show.mockClear();
    clickUndo();
    await Promise.resolve();
    await Promise.resolve();

    expect(restore).toHaveBeenCalledWith("acct_1/logo-xyz.png");
    expect(show).toHaveBeenCalledWith(true);
  });

  it("Undo toasts the server's error and does NOT flip back when restore refuses (mutation: call show(true) regardless of r.ok → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: true, path: "acct_1/logo.png" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: false, error: "too late" }));
    const show = vi.fn();
    const { toast, clickUndo } = fakeToast();

    await runRemoveLogo(remove, restore, show, toast);
    show.mockClear();
    clickUndo();
    await Promise.resolve();
    await Promise.resolve();

    expect(show).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("too late");
  });

  it("Undo toasts the generic crashed message when restore throws", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: true, path: "acct_1/logo.png" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => { throw new Error("boom"); });
    const show = vi.fn();
    const { toast, clickUndo } = fakeToast();

    await runRemoveLogo(remove, restore, show, toast);
    clickUndo();
    await Promise.resolve();
    await Promise.resolve();

    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });
});

// Review fix round (S-10 T6, I-1): every m[...] read above was a bare
// English read regardless of the caller's own locale; `locale` is now an
// optional trailing parameter (default "en", every test above unaffected).
describe("runRemoveLogo — Spanish (S-10 T6)", () => {
  it("toasts success and its Undo label in Spanish (mutation: drop the locale param from the success toast → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => ({ ok: true, path: "acct_1/logo.png" }));
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast } = fakeToast();

    await runRemoveLogo(remove, restore, show, toast, "es");
    expect(toast.success).toHaveBeenCalledWith(m["branding.logoRemoved.es"], expect.any(Object));
    const opts = toast.success.mock.calls[0]![1] as { action: { label: string } };
    expect(opts.action.label).toBe(m["common.undo.es"]);
  });

  it("toasts the crashed sentence in Spanish when remove throws (mutation: drop the locale param from the crashed toast → FAILS)", async () => {
    const remove = vi.fn(async (): Promise<RemoveLogoResult> => { throw new Error("boom"); });
    const restore = vi.fn(async (): Promise<RestoreLogoResult> => ({ ok: true }));
    const show = vi.fn();
    const { toast } = fakeToast();

    await runRemoveLogo(remove, restore, show, toast, "es");
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed.es"]);
  });
});

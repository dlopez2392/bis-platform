import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_FEED_UNDO_SECONDS } from "@bis/db";
import { makeTr } from "@/lib/record/copy";
import { m } from "@/lib/messages";

/**
 * F-048 part 2: what the card's buttons DO, as plain async functions (assign-handlers.ts's shape), so the
 * toast, its Undo and a refusal are reached without a DOM. Replace and Turn off run at once and offer Undo
 * (DESIGN.md rule 6).
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { runMake, runWithUndo, FEED_TOAST_MS } = await import("./feed-card-handlers");

const tr = makeTr("en");
const UNDO = { feedId: "feed_old", revokedAt: "2026-10-28T12:00:00.123456+00:00", replacementId: "feed_new" };
type Opts = { duration?: number; action?: { label: string; onClick: () => void } };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

describe("runWithUndo", () => {
  it("Make a new link: toasts replaced with an Undo whose onClick undoes THIS result's undo, then toasts restored and refreshes", async () => {
    const refresh = vi.fn();
    const undo = vi.fn(async () => ({ ok: true as const, undo: null }));
    await runWithUndo(async () => ({ ok: true, undo: UNDO }), undo, tr, "calendar.feed.toast.replaced", refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    const [message, opts] = toasts.success.mock.calls[0]! as [string, Opts];
    expect(message).toBe(m["calendar.feed.toast.replaced"]);
    expect(opts.duration).toBe(FEED_TOAST_MS);
    expect(opts.action!.label).toBe(m["calendar.feed.undo"]);
    opts.action!.onClick();
    await flush();
    expect(undo).toHaveBeenCalledWith(UNDO);
    expect(toasts.success).toHaveBeenCalledTimes(2);
    expect(toasts.success.mock.calls[1]![0]).toBe(m["calendar.feed.toast.restored"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a refused Undo toasts its own sentence and does not say restored", async () => {
    const undo = vi.fn(async () => ({ ok: false as const, error: "calendar.feed.error.undoLate" as const }));
    await runWithUndo(async () => ({ ok: true, undo: UNDO }), undo, tr, "calendar.feed.toast.turnedOff", vi.fn());
    (toasts.success.mock.calls[0]![1] as Opts).action!.onClick();
    await flush();
    expect(toasts.error).toHaveBeenCalledWith(m["calendar.feed.error.undoLate"]);
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it("a refused result toasts its error key's sentence, offers no Undo and does not refresh", async () => {
    const refresh = vi.fn();
    await runWithUndo(async () => ({ ok: false, error: "calendar.feed.error.notMember" }), vi.fn(), tr, "calendar.feed.toast.turnedOff", refresh);
    expect(toasts.error).toHaveBeenCalledWith(m["calendar.feed.error.notMember"]);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a thrown action toasts failed", async () => {
    await runWithUndo(async () => { throw new Error("network"); }, vi.fn(), tr, "calendar.feed.toast.turnedOff", vi.fn());
    expect(toasts.error).toHaveBeenCalledWith(m["calendar.feed.error.failed"]);
  });

  it("an ok result with no Undo (nothing was live) refreshes and shows no Undo toast", async () => {
    const refresh = vi.fn();
    await runWithUndo(async () => ({ ok: true, undo: null }), vi.fn(), tr, "calendar.feed.toast.turnedOff", refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("speaks Spanish under es", async () => {
    await runWithUndo(async () => ({ ok: true, undo: UNDO }), vi.fn(), makeTr("es"), "calendar.feed.toast.turnedOff", vi.fn());
    const [message, opts] = toasts.success.mock.calls[0]! as [string, Opts];
    expect(message).toBe(m["calendar.feed.toast.turnedOff.es"]);
    expect(opts.action!.label).toBe(m["calendar.feed.undo.es"]);
  });

  it("the Undo toast lives exactly as long as the database honours the Undo (CALENDAR_FEED_UNDO_SECONDS)", () => {
    expect(FEED_TOAST_MS).toBe(CALENDAR_FEED_UNDO_SECONDS * 1000);
  });
});

describe("runMake", () => {
  it("refreshes on success with no toast", async () => {
    const refresh = vi.fn();
    await runMake(async () => ({ ok: true, undo: null }), tr, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("a refusal toasts its sentence and does not refresh", async () => {
    const refresh = vi.fn();
    await runMake(async () => ({ ok: false, error: "calendar.feed.error.unavailable" }), tr, refresh);
    expect(toasts.error).toHaveBeenCalledWith(m["calendar.feed.error.unavailable"]);
    expect(refresh).not.toHaveBeenCalled();
  });
});

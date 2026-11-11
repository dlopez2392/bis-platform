import { describe, it, expect, vi } from "vitest";

/**
 * R3 (fix round): `runFailedTransferDone`/`runAcceptBookingAct` each pass the FIRST action's own
 * `result.at` into the Undo's reopen/unaccept call -- never a fresh `new Date().toISOString()` read
 * at Undo-click time, which would race `clearTransferFollowup`/`unstampAiActAccepted`'s own
 * compare-and-swap (both require the EXACT instant the main action wrote).
 *
 * No real DOM renderer: same no-renderer, override-by-mock pattern as
 * `email-row.wiring.test.ts`/`texts-row.note.wiring.test.ts` (their own doc comments) --
 * `useTransition` fires its callback immediately (no concurrent scheduling to wait on) and
 * `useContext` (under `useLocale()`) answers "en" directly, so `WorkRowActions` is called as a plain
 * function and its returned element's own `onClick` is invoked directly, bypassing React's render
 * tree entirely.
 */
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [false, (cb: () => unknown) => { void cb(); }],
    useContext: () => "en",
  };
});
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { WorkRowActions } = await import("./work-row-actions");

type El = { type: unknown; props: Record<string, unknown> };
function isEl(n: unknown): n is El {
  return !!n && typeof n === "object" && "type" in (n as object);
}

const BASE_PROPS = {
  rawId: "row1", contactId: null, label: "x",
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
};

describe("runFailedTransferDone's Undo gets the FIRST result's `at` (R3; mutation: new Date().toISOString() -> FAILS)", () => {
  it("passes completeFailedTransfer's own `at` to reopenFailedTransfer's Undo, not a fresh timestamp", async () => {
    toasts.success.mockClear();
    const completeFailedTransfer = vi.fn(async () => ({ ok: true as const, at: "2020-01-01T00:00:00.000Z" }));
    const reopenFailedTransfer = vi.fn(async () => ({ ok: true as const }));
    const el = WorkRowActions({
      ...BASE_PROPS, source: "failed_transfer",
      completeFailedTransfer, reopenFailedTransfer, acceptBookingAct: vi.fn(), unacceptBookingAct: vi.fn(),
    } as unknown as Parameters<typeof WorkRowActions>[0]);
    if (!isEl(el)) throw new Error("WorkRowActions returned no element");

    await (el.props.onClick as () => Promise<void>)();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const [, opts] = toasts.success.mock.calls[0]!;
    const onUndo = (opts as unknown as { action: { onClick: () => unknown } }).action.onClick;
    onUndo();
    await vi.waitFor(() => expect(reopenFailedTransfer).toHaveBeenCalled());
    expect(reopenFailedTransfer).toHaveBeenCalledWith("row1", "2020-01-01T00:00:00.000Z");
  });
});

describe("runAcceptBookingAct's Undo gets the FIRST result's `at` (R3; mutation: new Date().toISOString() -> FAILS)", () => {
  it("passes acceptBookingAct's own `at` to unacceptBookingAct's Undo, not a fresh timestamp", async () => {
    toasts.success.mockClear();
    const acceptBookingAct = vi.fn(async () => ({ ok: true as const, at: "2020-01-01T00:00:00.000Z" }));
    const unacceptBookingAct = vi.fn(async () => ({ ok: true as const }));
    const el = WorkRowActions({
      ...BASE_PROPS, source: "booking_act",
      completeFailedTransfer: vi.fn(), reopenFailedTransfer: vi.fn(), acceptBookingAct, unacceptBookingAct,
    } as unknown as Parameters<typeof WorkRowActions>[0]);
    if (!isEl(el)) throw new Error("WorkRowActions returned no element");

    await (el.props.onClick as () => Promise<void>)();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const [, opts] = toasts.success.mock.calls[0]!;
    const onUndo = (opts as unknown as { action: { onClick: () => unknown } }).action.onClick;
    onUndo();
    await vi.waitFor(() => expect(unacceptBookingAct).toHaveBeenCalled());
    expect(unacceptBookingAct).toHaveBeenCalledWith("row1", "2020-01-01T00:00:00.000Z");
  });
});

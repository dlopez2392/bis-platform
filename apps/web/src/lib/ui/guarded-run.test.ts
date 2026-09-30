import { describe, it, expect, vi } from "vitest";
import { runGuarded } from "./guarded-run";

/** One write at a time for a guarded control (moved from the retired 0049 switch's module, review R3-M7). */
describe("runGuarded", () => {
  function starter() {
    const started: Array<Promise<void>> = [];
    const start = (cb: () => Promise<void>) => { started.push(cb()); };
    return { start, started };
  }

  it("runs the work inside `start` and is busy until it settles", async () => {
    const busy = { current: false };
    const { start, started } = starter();
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    runGuarded(busy, start, work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(started).toHaveLength(1);
    expect(busy.current).toBe(true);
    finish();
    await started[0];
    expect(busy.current).toBe(false);
  });

  it("refuses a second write while the first is still saving", () => {
    const busy = { current: false };
    const { start } = starter();
    const first = vi.fn(() => new Promise<void>(() => {}));
    const second = vi.fn(async () => {});
    runGuarded(busy, start, first);
    runGuarded(busy, start, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("answers whether it ran: true when it took the work, false when it refused", () => {
    const busy = { current: false };
    const { start } = starter();
    expect(runGuarded(busy, start, () => new Promise<void>(() => {}))).toBe(true);
    expect(runGuarded(busy, start, async () => {})).toBe(false);
  });

  it("is free again after a write that throws", async () => {
    const busy = { current: false };
    const { start, started } = starter();
    runGuarded(busy, start, async () => { throw new Error("boom"); });
    await started[0]!.catch(() => {});
    expect(busy.current).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { flipMarketingOptOut, optOutSinceLine, runGuarded, type OptOutToast } from "./marketing-optout";

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

/**
 * #122 m5: Undo used to write straight from the toast, outside the switch's
 * pending guard — so an Undo clicked while a tick was still saving (or a
 * second tick while an Undo was saving) raced two writes, and the last to
 * land won regardless of which the operator did last.
 */
describe("Undo runs through the same guard as the tick", () => {
  it("Undo hands its write to the injected runner; a runner that refuses means no write and no box move", async () => {
    const h = harness([{ ok: true }]);
    const refuse = vi.fn<(work: () => Promise<void>) => false>(() => false);
    await flipMarketingOptOut(true, h.save, h.show, h.toast, refuse);
    await (h.undo() as unknown as () => Promise<void>)();
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls.map((c) => c[0])).toEqual([true]);
    expect(h.shown).toEqual([true]);
  });
});

/**
 * #123 m2: a refused Undo used to be SILENT. Sonner dismisses the toast on the
 * click, so the operator's only way back was gone with nothing said. The
 * refusal now tells them what to do instead (use the box itself).
 */
describe("a refused Undo says so", () => {
  it("a runner that refuses (returns false) toasts that the last change is still saving", async () => {
    const h = harness([{ ok: true }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast, () => false);
    await (h.undo() as unknown as () => Promise<void>)();
    expect(h.toast.error).toHaveBeenCalledTimes(1);
    expect(h.toast.error).toHaveBeenCalledWith(
      m["contact.marketingOptOut.undoBusy"].replace("{label}", m["contact.marketingOptOut.label"]));
  });

  it("names the box by its label, so a renamed box is never sent to under its old name", async () => {
    const h = harness([{ ok: true }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast, () => false);
    await (h.undo() as unknown as () => Promise<void>)();
    const said = String(h.toast.error.mock.calls[0]?.[0]);
    expect(said).toContain(`“${m["contact.marketingOptOut.label"]}”`);
    expect(said).not.toMatch(/[{}]/);
  });

  it("an Undo that runs says nothing of the kind", async () => {
    const h = harness([{ ok: true }, { ok: true }]);
    await flipMarketingOptOut(true, h.save, h.show, h.toast);
    await (h.undo() as unknown as () => Promise<void>)();
    expect(h.save.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(h.toast.error).not.toHaveBeenCalled();
  });
});

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

/** An account's own zone, as `renderZone` answers for a usable one. */
const own = (zone: string) => ({ zone, guessed: false, label: zone });

describe("optOutSinceLine", () => {
  it("dates the stamp in the ACCOUNT's zone, not UTC's", () => {
    // 02:30 UTC on Sep 4 is still the evening of Sep 3 in Chicago.
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z", own("America/Chicago")))
      .toBe(m["contact.marketingOptOut.since"].replace("{date}", "Sep 3, 2026"));
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z", own("UTC")))
      .toBe(m["contact.marketingOptOut.since"].replace("{date}", "Sep 4, 2026"));
  });

  it("says nothing without a stamp, and nothing for one it cannot read", () => {
    expect(optOutSinceLine(null, own("UTC"))).toBeNull();
    expect(optOutSinceLine("not a date", own("UTC"))).toBeNull();
  });

  // A post-#124 tab talking to a pre-#124 server (a rollback while the tab is
  // open): that summary carries `timezone` and no `zone`. The line is dropped
  // rather than throwing, since a throw here takes the drawer down with it.
  it("says nothing, rather than throwing, when the summary carried no zone", () => {
    expect(() => optOutSinceLine("2026-09-04T02:30:00.000Z", undefined)).not.toThrow();
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z", undefined)).toBeNull();
  });
});

/**
 * #123 m3: when `renderZone` had to GUESS (the agency's zone, or UTC), the
 * date may be a day off, and every other dated screen says so. This line
 * names the zone it is printed in; the account's own zone reads as before.
 */
describe("optOutSinceLine: a guessed zone is named", () => {
  it("guessed: the line names the zone the date is printed in", () => {
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z", { zone: "UTC", guessed: true, label: "UTC" }))
      .toBe("Off since Sep 4, 2026 (UTC)");
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z",
      { zone: "America/Chicago", guessed: true, label: "America/Chicago" }))
      .toBe(m["contact.marketingOptOut.sinceGuessed"]
        .replace("{date}", "Sep 3, 2026").replace("{zone}", "America/Chicago"));
  });

  it("the account's own zone: byte-identical to the line before this change", () => {
    expect(optOutSinceLine("2026-09-04T02:30:00.000Z", own("America/Chicago"))).toBe("Off since Sep 3, 2026");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Pins the ONE line that turns the checkbox's answer into the write
 * (`onCheckedChange={(v) => flip(v === true)}`). #122 m1: inverting it to
 * `v !== true` stayed 89/89 green, because every other test drives
 * `flipMarketingOptOut` directly and never goes through the box.
 *
 * Its own file because it stubs the Checkbox (to capture the handler Radix
 * would call) and `useTransition` (the server renderer's `startTransition`
 * throws when called), and the render tests next door read the real box.
 */
type Handler = (v: boolean | "indeterminate") => void;
// Read back with a cast: TS narrows the reset to `undefined` in `mount` and
// cannot see the mock writing it during the render.
const captured: { onCheckedChange?: Handler } = {};
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: (props: { onCheckedChange?: (v: boolean | "indeterminate") => void }) => {
    captured.onCheckedChange = props.onCheckedChange;
    return null;
  },
}));
/** Every `useState` the render asked for, with its starting value and a
 *  setter that only RECORDS (#123 m4a). The server renderer's own setters do
 *  nothing observable after the render, so without this a flip that forgot
 *  to drop the "Off since" stamp stayed green. Found by starting value, not
 *  by call order, so reordering the hooks does not break it. */
const states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [false, (cb: () => unknown) => { void cb(); }],
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial, set];
    },
  };
});
const flip = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/contacts/marketing-optout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts/marketing-optout")>()),
  flipMarketingOptOut: (...args: unknown[]) => flip(...args),
}));
vi.mock("./actions", () => ({ setMarketingEmailOptOutAction: vi.fn() }));

const { MarketingOptOutSwitch } = await import("./marketing-optout-switch");

function mount(optedOutAt: string | null) {
  captured.onCheckedChange = undefined;
  renderToStaticMarkup(createElement(MarketingOptOutSwitch, {
    accountId: "a1", contactId: "c1", optedOutAt, zone: { zone: "UTC", guessed: false, label: "UTC" },
  }));
  const handler = captured.onCheckedChange as Handler | undefined;
  if (!handler) throw new Error("the switch rendered no onCheckedChange");
  return handler;
}

beforeEach(() => { flip.mockClear(); });

describe("MarketingOptOutSwitch wiring", () => {
  it("a tick (checked = true) writes the opt-out ON", () => {
    mount(null)(true);
    expect(flip).toHaveBeenCalledTimes(1);
    expect(flip.mock.calls[0]![0]).toBe(true);
  });

  it("an untick (checked = false) writes it OFF", () => {
    mount("2026-09-04T02:30:00.000Z")(false);
    expect(flip).toHaveBeenCalledTimes(1);
    expect(flip.mock.calls[0]![0]).toBe(false);
  });

  it("Radix's 'indeterminate' is not a tick: it writes OFF, never stamps", () => {
    mount(null)("indeterminate");
    expect(flip.mock.calls[0]![0]).toBe(false);
  });
});

/**
 * A flip drops the stamp the "Off since" line reads: after a tick the new
 * stamp is not on this screen, and after untick-then-Undo the server has
 * re-stamped, so the old date would be wrong (the switch's own comment).
 */
describe("MarketingOptOutSwitch: a flip forgets the old 'Off since' date", () => {
  it("clears the stamp the line reads, on the flip itself", () => {
    const STAMP = "2026-09-04T02:30:00.000Z";
    states.length = 0;
    const handler = mount(STAMP);
    // Exactly one piece of state starts at the stamp — the line's `since`.
    const since = states.filter((s) => s.initial === STAMP);
    expect(since).toHaveLength(1);
    expect(since[0]!.set).not.toHaveBeenCalled();
    handler(false);
    expect(since[0]!.set).toHaveBeenCalledWith(null);
  });
});

describe("MarketingOptOutSwitch: Undo shares the tick's guard", () => {
  it("the runner handed to Undo refuses while the tick's write is still saving", () => {
    // The tick's write never settles, so the guard stays held.
    flip.mockImplementationOnce(() => new Promise<void>(() => {}));
    mount(null)(true);
    const undoRunner = flip.mock.calls[0]![4] as (work: () => Promise<void>) => unknown;
    expect(typeof undoRunner).toBe("function");
    const undoWork = vi.fn(async () => {});
    // #123 m2: the refusal is REPORTED as `false` — what flipMarketingOptOut
    // reads to tell the operator. A runner that swallowed runGuarded's answer
    // would leave the refused Undo silent again.
    expect(undoRunner(undoWork)).toBe(false);
    expect(undoWork).not.toHaveBeenCalled();
  });

  it("…and runs Undo once the tick has settled", async () => {
    mount(null)(true);
    await Promise.resolve(); await Promise.resolve();
    const undoRunner = flip.mock.calls[0]![4] as (work: () => Promise<void>) => unknown;
    const undoWork = vi.fn(async () => {});
    expect(undoRunner(undoWork)).toBe(true);
    expect(undoWork).toHaveBeenCalledTimes(1);
  });
});

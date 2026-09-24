import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactRow } from "./contacts-table";

/**
 * Pins the drawer's USE of the summary parser: what its fetch effect stores
 * for a body the parser refuses. `summaryLoadFrom`'s own tests
 * (lib/contacts/summary.test.ts) cannot see the drawer going back to
 * `(await res.json()) as ContactSummary` — this can.
 *
 * No DOM renderer in apps/web, so the effect is captured rather than run by
 * React (the server renderer never runs effects), and `useState` records its
 * setters (the marketing-optout-switch.wiring.test.ts idiom). The Sheet is
 * stubbed out: the fetch effect lives in ContactDrawer itself, and nothing
 * under the Sheet is what this pins.
 */
const effects: Array<() => void | (() => void)> = [];
const states: { initial: unknown; set: ReturnType<typeof vi.fn> }[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => { effects.push(fn); },
    useState: (init: unknown) => {
      const initial = typeof init === "function" ? (init as () => unknown)() : init;
      const set = vi.fn();
      states.push({ initial, set });
      return [initial, set];
    },
  };
});
vi.mock("@/components/ui/sheet", () => {
  const none = () => null;
  return { Sheet: none, SheetContent: none, SheetDescription: none, SheetHeader: none, SheetTitle: none };
});
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn(), setMarketingEmailOptOutAction: vi.fn() }));
vi.mock("./[contactId]/actions", () => ({ addTagAction: vi.fn(), removeTagAction: vi.fn() }));

const { ContactDrawer } = await import("./contact-drawer");

const ROW: ContactRow = {
  id: "c1", first_name: "Maria", last_name: "Garcia", email: null, phone: null,
  company_name: null, created_at: "2026-09-01T00:00:00+00:00",
};

const GOOD = {
  tags: [{ id: "t1", name: "vip" }],
  recent: [{ kind: "note", label: "Note", at: "2026-09-01T10:00:00+00:00" }],
  marketing_email_opted_out_at: "2026-09-23T12:00:00+00:00",
  zone: { zone: "UTC", guessed: false, label: "UTC" },
};

function omit(key: keyof typeof GOOD): Record<string, unknown> {
  const body: Record<string, unknown> = { ...GOOD };
  delete body[key];
  return body;
}

/** Mounts the drawer, runs its fetch effect against `body`, and answers what
 *  the effect stored in `fetched`. */
async function load(body: unknown, ok = true): Promise<unknown> {
  effects.length = 0;
  states.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
  renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
  // `fetched` is the one piece of state that starts at null (`retryNonce`
  // starts at 0) — found by starting value, not hook order.
  const fetched = states.filter((s) => s.initial === null);
  expect(fetched).toHaveLength(1);
  expect(effects).toHaveLength(1);
  effects[0]!();
  await vi.waitFor(() => expect(fetched[0]!.set).toHaveBeenCalled());
  expect(fetched[0]!.set).toHaveBeenCalledTimes(1);
  return fetched[0]!.set.mock.calls[0]![0];
}

// A spy, not fake timers: `vi.waitFor` advances faked timers by its poll
// interval, which would move a faked Date under the assertion.
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ContactDrawer: the summary body is parsed, not cast", () => {
  it("a body without tags stores the error state, not a summary that would throw in render", async () => {
    expect(await load(omit("tags"))).toEqual({ contactId: "c1", result: { status: "error" } });
  });

  it("a body without the opt-out stamp stores the error state, not an unticked box", async () => {
    expect(await load(omit("marketing_email_opted_out_at"))).toEqual({ contactId: "c1", result: { status: "error" } });
  });

  it("a good body stores the PARSED summary, extra keys dropped, with the clock read in the callback", async () => {
    expect(await load({ ...GOOD, timezone: "UTC" })).toEqual({
      contactId: "c1", result: { status: "ready", summary: GOOD, nowMs: 1_700_000_000_000 },
    });
  });

  it("a body from before #124 (no zone) is still ready, with zone undefined", async () => {
    const stored = await load(omit("zone")) as { result: { status: string; summary: { zone?: unknown } } };
    expect(stored.result.status).toBe("ready");
    expect(stored.result.summary.zone).toBeUndefined();
  });

  it("a non-OK response stores the error state, even with a body that would parse", async () => {
    expect(await load(GOOD, false)).toEqual({ contactId: "c1", result: { status: "error" } });
  });

  it("a recent item of a kind this bundle does not know is dropped, and the rest still loads", async () => {
    const body = { ...GOOD, recent: [{ kind: "booking", label: "Booked", at: "2026-09-02T10:00:00+00:00" }, ...GOOD.recent] };
    expect(await load(body)).toEqual({
      contactId: "c1", result: { status: "ready", summary: GOOD, nowMs: 1_700_000_000_000 },
    });
  });
});

/**
 * The effect's cleanup (the contact changed, or a retry refired the fetch)
 * must stop THIS fetch writing, including when the response has already
 * landed and only its body is still being read. Otherwise a switched-away
 * contact's result overwrites the current one, or an older retry's body
 * overwrites a newer one.
 */
describe("ContactDrawer: a fetch cleaned up while its body is still being read never writes", () => {
  /** Mounts the drawer, runs its effect, and waits until the response's
   *  `json()` has been CALLED, i.e. the callback is past any check made
   *  before the body is read. Settling `json()` is left to the test. */
  async function mountPendingBody() {
    effects.length = 0;
    states.length = 0;
    let settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
    const json = vi.fn(() => new Promise<unknown>((resolve, reject) => { settle = { resolve, reject }; }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json })));
    renderToStaticMarkup(createElement(ContactDrawer, { accountId: "a1", row: ROW, onClose: () => {} }));
    const fetched = states.filter((s) => s.initial === null);
    expect(fetched).toHaveLength(1);
    expect(effects).toHaveLength(1);
    const cleanup = effects[0]!();
    expect(typeof cleanup).toBe("function");
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    return { set: fetched[0]!.set, cleanup: cleanup as () => void, settle };
  }

  /** Enough macrotask turns for fetch → then → json → parse → setFetched
   *  (and the .catch hop) to have run. The control below proves this flush
   *  is enough to see a write that happens. */
  async function flush() {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("control: with no cleanup, the same flush sees the write", async () => {
    const { set, settle } = await mountPendingBody();
    expect(set).not.toHaveBeenCalled();
    settle.resolve(GOOD);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("a body that parses after the cleanup is not stored", async () => {
    const { set, cleanup, settle } = await mountPendingBody();
    cleanup();
    settle.resolve(GOOD);
    await flush();
    expect(set).not.toHaveBeenCalled();
  });

  it("a body that fails to read after the cleanup does not store the error state either", async () => {
    const { set, cleanup, settle } = await mountPendingBody();
    cleanup();
    settle.reject(new SyntaxError("Unexpected token < in JSON"));
    await flush();
    expect(set).not.toHaveBeenCalled();
  });
});

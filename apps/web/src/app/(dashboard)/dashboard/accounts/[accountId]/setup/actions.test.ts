import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhoneNumberRow } from "@bis/db";
import type { SetupInputs } from "@/lib/setup/setup-status";
import type { ReadKey } from "@/lib/setup/setup-view";

/**
 * The setup wizard's only write in this task: the two manual ticks (email
 * "skip for now", forwarding "confirmed at the carrier") that have no
 * derivable source anywhere in the database — see the header of
 * lib/setup/setup-status.ts for why those two, and only those two, are
 * stored rather than computed.
 *
 * The guard shape under test is the one voice/actions.ts established and its
 * own test pins: `requireAccountAccess` resolves for any authenticated caller
 * who legitimately owns the account, client or agency, so the ACTION is what
 * has to turn `isAgency: false` into a refusal — and it has to do that
 * BEFORE touching the database. `checklist_items` writes here run on
 * `serviceDb()`, which bypasses RLS entirely, so a guard that ran after the
 * write (or not at all) would let a client user tick their own setup steps
 * with nothing else standing in the way. Hence the not-called assertion
 * below, which is the actual boundary; the `{ ok: false }` return is only how
 * it is reported.
 *
 * goLiveAction's re-check now goes through the single shared
 * `gatherSetupInputs` (lib/setup/setup-inputs.ts) rather than five separate
 * `@bis/db` reads — mocked at that module boundary below, per that module's
 * own doc comment ("NOT separately unit-tested" — its callers mock it as one
 * unit, the same way this file already mocked `@bis/db`'s individual reads
 * before this task). `gatherSetupInputs` resolves to `{ inputs, numbers,
 * failed }` (per-leg fault isolation, not a bare `SetupInputs`/a rejection) —
 * see that module's own doc comment for why.
 */

const dbMocks = vi.hoisted(() => ({
  setChecklistItem: vi.fn(),
  upsertVoiceProfile: vi.fn(), setPhoneNumberStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));

const setupInputsMocks = vi.hoisted(() => ({ gatherSetupInputs: vi.fn() }));
vi.mock("@/lib/setup/setup-inputs", () => setupInputsMocks);

const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { setSetupTickAction, goLiveAction } from "./actions";

/** Every mock this test suite touches, across both modules — the "not
 *  called before the guard settles" assertions check all of them, not just
 *  whichever one a given action happens to use. */
function allMocks() {
  return [...Object.values(dbMocks), setupInputsMocks.gatherSetupInputs];
}

const noFailures: Record<ReadKey, boolean> = {
  account: false, calendar: false, profile: false,
  numbers: false, calls: false, ticks: false,
};

/** The full rows `listPhoneNumbersForAccount` returns — `gatherSetupInputs`'s
 *  own `numbers` field (not `inputs.numbers`, which stays status-only). */
function readyNumbers(): PhoneNumberRow[] {
  return [{ id: "pn1", account_id: "a1", e164: "+19565550111", telnyx_id: null, status: "testing" }];
}

/** What `gatherSetupInputs` resolves to when every leg satisfies every
 *  go-live prerequisite: open hours on one day, a profile with the greeting
 *  the caller would actually hear plus facts, a non-released number, and at
 *  least one call already taken — none of the six legs failed. Each test
 *  below overrides exactly one piece, so a `notReady` (or a `.failed`) is
 *  provably that break. brandName/fromEmail are irrelevant to
 *  goLivePrereqsMet (see setup-status.ts) — filled in anyway so `inputs`
 *  stands on its own as a valid SetupInputs. */
function readyGathered(overrides: {
  inputs?: Partial<Omit<SetupInputs, "numbers">>;
  numbers?: PhoneNumberRow[];
  failed?: Partial<Record<ReadKey, boolean>>;
} = {}) {
  const numbers = overrides.numbers ?? readyNumbers();
  const inputs: SetupInputs = {
    brandName: "Acme", fromEmail: null,
    calendar: { enabled: true, open_hours: { mon: [["09:00", "17:00"]] } },
    profile: {
      greeting_en: "Thanks for calling Acme.", greeting_es: "",
      facts: "Open Monday to Friday.", enabled: false, languages: "en",
    },
    // Mirrors gatherSetupInputs's own real relationship between `numbers`
    // (full rows) and `inputs.numbers` (status-only) — see that module's
    // own doc comment for why the two fields exist side by side.
    numbers: numbers.map(({ status }) => ({ status })),
    callCount: 2,
    ticks: { emailSkipped: false, forwardingDone: false },
    ...overrides.inputs,
  };
  return { inputs, numbers, failed: { ...noFailures, ...overrides.failed } };
}

beforeEach(() => {
  allMocks().forEach((mock) => mock.mockReset());
  dbMocks.setChecklistItem.mockResolvedValue(undefined);
  setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered());
  dbMocks.upsertVoiceProfile.mockResolvedValue({});
  dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
  guardFixture.isAgency = true;
});

describe("setSetupTickAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await setSetupTickAction("a1", "emailSkipped", true);
    expect(r).toEqual({ ok: false });
    expect(dbMocks.setChecklistItem).not.toHaveBeenCalled();
  });

  it("ticks the email-skipped key through serviceDb, under the shared catalogue key", async () => {
    const r = await setSetupTickAction("a1", "emailSkipped", true);
    expect(r).toEqual({ ok: true });
    // The literal key matters as much as the call: the page READS
    // `SETUP_TICK_KEYS.emailSkipped` back out of `checklist_items`, so a typo
    // on either side loses the tick silently rather than failing.
    expect(dbMocks.setChecklistItem).toHaveBeenCalledWith(
      {}, "a1", "setup:email_skipped", { done: true }, "user_1",
    );
  });

  it("un-ticks forwarding with done:false rather than deleting the row", async () => {
    const r = await setSetupTickAction("a1", "forwardingDone", false);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setChecklistItem).toHaveBeenCalledWith(
      {}, "a1", "setup:forwarding_done", { done: false }, "user_1",
    );
  });

  it("reports a failed write rather than rejecting into the client island", async () => {
    // Uncaught, this REJECTS the server action — the client island's
    // `toast.error(m["setup.tickFailed"])` branch for `{ok:false}` is dead
    // code unless the write's own failure is caught and reported as a value,
    // the same idiom goLiveAction uses for its own writes below.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.setChecklistItem.mockRejectedValue(new Error("boom"));
    const r = await setSetupTickAction("a1", "emailSkipped", true);
    expect(r).toEqual({ ok: false });
    errSpy.mockRestore();
  });

  it("refuses a tick key that isn't in the catalogue, without touching the db", async () => {
    // `SETUP_TICK_KEYS[tick]` trusts a compile-time `keyof` on a value that
    // actually arrives over the wire from a browser — nothing stops a
    // tampered submission from sending `"constructor"` or any other
    // prototype-chain property name. The runtime guard is what stands
    // between that and `setChecklistItem` being called with `undefined`.
    const r = await setSetupTickAction(
      "a1",
      "constructor" as unknown as "emailSkipped",
      true,
    );
    expect(r).toEqual({ ok: false });
    expect(dbMocks.setChecklistItem).not.toHaveBeenCalled();
  });
});

/**
 * The one write on this page that turns a client's phone line on.
 *
 * The panel renders its button disabled until the page's own derivation says
 * the prerequisites are met — but that render is stale the instant it paints,
 * and a disabled attribute is a courtesy, not a control. So the enforcement
 * lives HERE: the action re-derives every prerequisite from live rows at
 * click time and refuses on its own evidence. The pins that matter below are
 * the not-called ones — a refusal that still wrote would be no refusal at all.
 */
describe("goLiveAction", () => {
  const writes = () => [dbMocks.upsertVoiceProfile, dbMocks.setPhoneNumberStatus];

  it("a non-agency caller is rejected before any db call — reads included", async () => {
    guardFixture.isAgency = false;
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.denied"] });
    // Not just the writes: a client session must not even get to read the
    // account's rows through serviceDb, which bypasses RLS entirely.
    allMocks().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when a prerequisite is unmet at click time, writing nothing", async () => {
    // `open_hours: {}` is the exit-gate state: `enabled: true` passes a naive
    // check while every day answers "no availability" on a real call.
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(
      readyGathered({ inputs: { calendar: { enabled: true, open_hours: {} } } }),
    );
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when the profile's primary-language greeting is empty", async () => {
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({
      inputs: {
        profile: {
          greeting_en: "", greeting_es: "Gracias por llamar.",
          facts: "Open Monday to Friday.", enabled: false, languages: "en",
        },
      },
    }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when no call has ever been taken", async () => {
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({ inputs: { callCount: 0 } }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when the only number on the account is released", async () => {
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({
      numbers: [{ id: "pn1", account_id: "a1", e164: "+19565550111", telnyx_id: null, status: "released" }],
    }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses — never 'not ready' — when gatherSetupInputs itself rejects", async () => {
    // Defensive belt-and-braces: gatherSetupInputs is per-leg fault-isolated
    // and should not reject in practice, but an exception escaping this
    // action unhandled would reject it outright — see the doc comment above
    // goLiveAction for why the try/catch stays regardless.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupInputsMocks.gatherSetupInputs.mockRejectedValue(new Error("boom"));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("refuses — never 'not ready' — when one of the five legs it reads came back failed", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({ failed: { calendar: true } }));
    const r = await goLiveAction("a1");
    // Blaming the operator's setup for a failed read would send them to fix
    // hours that are already fine.
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("ignores an accounts-leg failure — this action never read that table before unification", async () => {
    // Everything goLiveAction actually reads (calendar/profile/numbers/
    // calls/ticks) is fine; only the accounts leg (brand_name/from_email,
    // never used here) failed. An outage on a table this action was never
    // exposed to before must not turn a real "ready" into a false refusal.
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({ failed: { account: true } }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: true });
  });

  it("enables the profile and marks the number live once everything checks out", async () => {
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1", { enabled: true }, "user_1");
    expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn1", "live", "user_1");
  });

  it("skips a released number and takes the first live-able one", async () => {
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({
      numbers: [
        { id: "old", account_id: "a1", e164: "+19565550100", telnyx_id: null, status: "released" },
        { id: "pn2", account_id: "a1", e164: "+19565550111", telnyx_id: null, status: "provisioned" },
      ],
    }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn2", "live", "user_1");
  });

  it("reports a failed write rather than rejecting into the client island", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.setPhoneNumberStatus.mockRejectedValue(new Error("nope"));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    errSpy.mockRestore();
  });
});

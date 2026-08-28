import { describe, it, expect, vi, beforeEach } from "vitest";

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
 */

const dbMocks = vi.hoisted(() => ({
  setChecklistItem: vi.fn(),
  // goLiveAction's five re-reads plus its two writes. Everything the action
  // touches is mocked, so "not called" below means the guard really did stop
  // before the database, not that some other layer happened to swallow it.
  getCalendarForAccount: vi.fn(), getVoiceProfile: vi.fn(),
  listPhoneNumbersForAccount: vi.fn(), countCallsSince: vi.fn(),
  listChecklistState: vi.fn(),
  upsertVoiceProfile: vi.fn(), setPhoneNumberStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));

const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { setSetupTickAction, goLiveAction } from "./actions";

/** Rows that satisfy every go-live prerequisite: open hours on one day, a
 *  profile with the greeting the caller would actually hear plus facts, a
 *  non-released number, and at least one call already taken. Each test below
 *  breaks exactly one of these, so a `notReady` is provably that break. */
function readyFixture() {
  dbMocks.getCalendarForAccount.mockResolvedValue({
    enabled: true, open_hours: { mon: [["09:00", "17:00"]] },
  });
  dbMocks.getVoiceProfile.mockResolvedValue({
    greeting_en: "Thanks for calling Acme.", greeting_es: "",
    facts: "Open Monday to Friday.", enabled: false, languages: "en",
  });
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([
    { id: "pn1", status: "testing", e164: "+19565550111" },
  ]);
  dbMocks.countCallsSince.mockResolvedValue(2);
  dbMocks.listChecklistState.mockResolvedValue([]);
  dbMocks.upsertVoiceProfile.mockResolvedValue({});
  dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
}

beforeEach(() => {
  Object.values(dbMocks).forEach((mock) => mock.mockReset());
  dbMocks.setChecklistItem.mockResolvedValue(undefined);
  readyFixture();
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
    Object.values(dbMocks).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when a prerequisite is unmet at click time, writing nothing", async () => {
    // `open_hours: {}` is the exit-gate state: `enabled: true` passes a naive
    // check while every day answers "no availability" on a real call.
    dbMocks.getCalendarForAccount.mockResolvedValue({ enabled: true, open_hours: {} });
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when the profile's primary-language greeting is empty", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({
      greeting_en: "", greeting_es: "Gracias por llamar.",
      facts: "Open Monday to Friday.", enabled: false, languages: "en",
    });
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when no call has ever been taken", async () => {
    dbMocks.countCallsSince.mockResolvedValue(0);
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses when the only number on the account is released", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([
      { id: "pn1", status: "released", e164: "+19565550111" },
    ]);
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.notReady"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it("refuses — never 'not ready' — when a read it needs never answered", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.getCalendarForAccount.mockRejectedValue(new Error("boom"));
    const r = await goLiveAction("a1");
    // Blaming the operator's setup for a failed read would send them to fix
    // hours that are already fine.
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("enables the profile and marks the number live once everything checks out", async () => {
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1", { enabled: true }, "user_1");
    expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn1", "live", "user_1");
  });

  it("skips a released number and takes the first live-able one", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([
      { id: "old", status: "released", e164: "+19565550100" },
      { id: "pn2", status: "provisioned", e164: "+19565550111" },
    ]);
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

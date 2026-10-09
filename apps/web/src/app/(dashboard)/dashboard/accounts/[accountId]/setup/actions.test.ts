import { describe, it, expect, vi, beforeEach } from "vitest";

// Outside a real request, revalidatePath throws ("static generation store
// missing") rather than no-op'ing — voice/actions.test.ts and
// conversations/actions.test.ts mock it for the same reason. Only
// renameAccountAction in this file calls it (on its success path).
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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
 * `@bis/db` reads — mocked at THIS module's boundary below, the same way
 * this file already mocked `@bis/db`'s individual reads before this task.
 * `gatherSetupInputs` resolves to `{ inputs, numbers, failed }` (per-leg
 * fault isolation, not a bare `SetupInputs`/a rejection) — see that module's
 * own doc comment for why.
 *
 * Mocking it here proves this ACTION's own re-check logic (branding/hours/
 * voice_profile/number/test_call, the writes, the refusal), never
 * `gatherSetupInputs`'s own body — review round, Important 3 found that gap
 * mocked-at-the-boundary tests like this one cannot close by themselves
 * (mutating that function's own `permissions` line left every test in THIS
 * file green). `setup-inputs.test.ts` is the one file that exercises the
 * real function against a fake `db`.
 */

const dbMocks = vi.hoisted(() => ({
  setChecklistItem: vi.fn(),
  upsertVoiceProfile: vi.fn(), setPhoneNumberStatus: vi.fn(),
  // D-043: goLiveAction makes ONE write, `goLive` (0063, one transaction).
  // The two above stay mocked so the tests can pin that neither is called.
  goLive: vi.fn(),
  // renameAccountAction no longer writes `accounts` from the route. The final
  // review moved it onto `renameAccount` (packages/db/src/accounts.ts) —
  // where every other account-level write already lives — so what this file
  // spies is a `@bis/db` function like the other three, not a hand-rolled
  // `.from().update().eq()` chain. The two things that move bought (a
  // `.select("id")` that turns a zero-row update into a failure, and the
  // `account.renamed` event) are BOTH invisible from here by construction:
  // they are the helper's own behaviour, and the helper is mocked. Their
  // proof is packages/db/src/test/accounts.test.ts, against real Postgres.
  renameAccount: vi.fn(),
}));

/** The one object `serviceDb()` resolves to everywhere in this file. Kept as
 *  a single shared reference — rather than a fresh `{}` per call — so the
 *  actions that pass it straight through to a `@bis/db` function
 *  (setChecklistItem, goLive, renameAccount) can each assert "the same db
 *  instance flowed through"
 *  against this reference. */
const serviceDbInstance = vi.hoisted(() => ({ __serviceDb: true }));

vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => serviceDbInstance,
}));

const setupInputsMocks = vi.hoisted(() => ({ gatherSetupInputs: vi.fn() }));
vi.mock("@/lib/setup/setup-inputs", () => setupInputsMocks);

const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
  // Mirrors the real function's own shape: it builds on requireAccountAccess
  // and then redirects a non-agency caller (in real Next.js, a `redirect()`
  // throw the framework intercepts). renameAccountAction never catches this
  // — same as every other requireAgencyOnlyAccountAccess call site in this
  // tree (settings/actions.ts) — so the throw here has to actually escape,
  // not resolve to a value, for the "rejected before any db call" test below
  // to mean anything.
  // No parameter: the mock ignores the accountId the real guard takes, and
  // this eslint config has no argsIgnorePattern, so even an underscored
  // param trips no-unused-vars. Extra args are ignored at the call site.
  requireAgencyOnlyAccountAccess: async () => {
    if (!guardFixture.isAgency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_1" };
  },
}));

import { m } from "@/lib/messages";
import { setSetupTickAction, goLiveAction, renameAccountAction } from "./actions";

/** Every mock this test suite touches, across both modules — the "not
 *  called before the guard settles" assertions check all of them, not just
 *  whichever one a given action happens to use. */
function allMocks() {
  return [...Object.values(dbMocks), setupInputsMocks.gatherSetupInputs];
}

const noFailures: Record<ReadKey, boolean> = {
  account: false, calendar: false, profile: false,
  numbers: false, calls: false, ticks: false,
  forms: false, conversations: false,
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
      // website_assistant is not a go-live prerequisite (GO_LIVE_PREREQ_KEYS
      // unchanged) — these three are irrelevant to every test in this file,
      // filled in anyway so `inputs` stands on its own as a valid SetupInputs.
      concierge_enabled: false, concierge_form_id: null, public_id: null,
    },
    // Mirrors gatherSetupInputs's own real relationship between `numbers`
    // (full rows) and `inputs.numbers` (status-only) — see that module's
    // own doc comment for why the two fields exist side by side.
    numbers: numbers.map(({ status }) => ({ status })),
    callCount: 2,
    ticks: { emailSkipped: false, forwardingDone: false },
    publishedFormCount: 0,
    conciergeSiteConversation: false,
    // `null` reads as the full plan, same as `{}` — see
    // setup-status.ts's own doc comment. No test in this file is about the
    // CRM-only filter, so every one of them should keep seeing all ten
    // steps unless it overrides this explicitly.
    permissions: null,
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
  dbMocks.goLive.mockResolvedValue(undefined);
  // Already reset by the allMocks() loop above (renameAccount lives in
  // dbMocks); only the default resolved value needs setting here. `undefined`,
  // not `{ error: null }` — the real helper returns `Promise<void>` and
  // signals failure by THROWING, so a resolved value here would be a shape
  // the action never inspects.
  dbMocks.renameAccount.mockResolvedValue(undefined);
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
      serviceDbInstance, "a1", "setup:email_skipped", { done: true }, "user_1",
    );
  });

  it("un-ticks forwarding with done:false rather than deleting the row", async () => {
    const r = await setSetupTickAction("a1", "forwardingDone", false);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setChecklistItem).toHaveBeenCalledWith(
      serviceDbInstance, "a1", "setup:forwarding_done", { done: false }, "user_1",
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
  const writes = () => [dbMocks.goLive, dbMocks.upsertVoiceProfile, dbMocks.setPhoneNumberStatus];

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
          concierge_enabled: false, concierge_form_id: null, public_id: null,
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

  // docs/crm-features.md:883 — a CRM-only account (permissions.voice_
  // receptionist: false) has no voice_profile/number/test_call/go_live step
  // at all once `deriveSetupStatus` filters them out, so `goLivePrereqsMet`
  // is false by construction even though the base fixture is otherwise a
  // "ready" full-plan tenant (hours, voice_profile, number, test_call and
  // branding all done). This is the belt-and-braces half of the fix: the
  // button is also unreachable through the UI (no go_live step means no
  // GoLiveStep card renders at all), but this proves the SERVER re-check
  // refuses on its own evidence even if that button were somehow pressed
  // anyway.
  it("refuses as notReady for a CRM-only account, even with every PRESENT prerequisite done — writes nothing", async () => {
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({
      inputs: { permissions: { voice_receptionist: false } },
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

  it("refuses — never 'not ready' — when the accounts leg failed, now that branding gates go-live", async () => {
    // Mutation: leave `failed.account` out of `reReadFailed`. Branding is now
    // one of goLivePrereqsMet's checks (setup-status.ts), and branding reads
    // off the accounts leg's brandName — a failed read there is exactly as
    // unverifiable as a failed calendar/profile/numbers/calls/ticks read, so
    // it must be reported the same way: `setup.goLive.failed`, not a false
    // "ready" and not a misdirecting "not ready".
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupInputsMocks.gatherSetupInputs.mockResolvedValue(readyGathered({ failed: { account: true } }));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    writes().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it("goes live in ONE call, goLive, never the old two-write pair (D-043; mutation: restore the upsertVoiceProfile + setPhoneNumberStatus pair -> FAILS)", async () => {
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: true });
    // goLive enables the profile and sets the number live in one transaction
    // (0063), so a failure can no longer leave the profile on and the number
    // still testing. Two separate writes here would reintroduce exactly that.
    expect(dbMocks.goLive).toHaveBeenCalledTimes(1);
    expect(dbMocks.goLive).toHaveBeenCalledWith(serviceDbInstance, "a1", "pn1", "user_1");
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
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
    expect(dbMocks.goLive).toHaveBeenCalledWith(serviceDbInstance, "a1", "pn2", "user_1");
  });

  it("reports a refused or failed go-live as failed rather than rejecting into the client island", async () => {
    // goLive throws the database's refusal (another active number, no
    // profile, a number released since the re-check) or a transport error.
    // Every one of them is reported as `failed`: "Reload and try again" shows
    // the operator the real state, and nothing was written.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.goLive.mockRejectedValue(new Error("goLive failed: go_live: no such number on this account, or it was released"));
    const r = await goLiveAction("a1");
    expect(r).toEqual({ ok: false, error: m["setup.goLive.failed"] });
    errSpy.mockRestore();
  });
});

/**
 * The account's INTERNAL label (`accounts.name`) — the agency's own note
 * about this client. Not the client's public-facing name (branding owns
 * that), but not hidden from them either: the sidebar and the dashboard
 * greeting both read `brandName ?? account.name`, so an account with no
 * brand name set yet shows this label to the client. Agency-only to write,
 * and empty is REJECTED rather than cleared — unlike an inline contact
 * field, "" has no fallback in the client switcher, the dashboard greeting,
 * or the accounts list.
 *
 * 🔴 These unit tests are BLIND to column grants. `serviceDb()` is mocked
 * here to a plain in-memory object — it cannot fail the way the real
 * `service_role` Postgres connection could, and (the direction that actually
 * bit this action once already) it cannot PROVE the write is *permitted*
 * either, the way `dbForRequest()`'s `authenticated` role could and did fail
 * ("permission denied for column \"name\"" — see renameAccountAction's own
 * doc comment and migration 0013). A mock more permissive than the real
 * client proves nothing about grants; it only proves the action calls what
 * it's supposed to call, with the arguments it's supposed to send. The real
 * proof that this write is actually permitted against the live database is
 * the e2e rename test (Task 5), which runs against Postgres itself. This is a
 * standing hard lesson in this repo: serviceDb-backed fixtures have shipped
 * two defects behind green suites before this one.
 */
describe("renameAccountAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    await expect(renameAccountAction("acct1", "Valid Name")).rejects.toThrow();
    expect(dbMocks.renameAccount).not.toHaveBeenCalled();
  });

  it("rejects an empty name WITHOUT writing", async () => {
    const r = await renameAccountAction("acct1", "   ");
    expect(r).toEqual({ ok: false, error: expect.any(String) });
    // The write must never even be attempted — not just that `ok` is false.
    expect(dbMocks.renameAccount).not.toHaveBeenCalled();
  });

  it("trims the name and hands the guard's userId to the db helper as the actor", async () => {
    const r = await renameAccountAction("acct1", "  Rio Roofing  ");
    expect(r).toEqual({ ok: true });
    // The actor argument is the point of this assertion as much as the trim:
    // the previous raw-route write DISCARDED the userId the guard returns,
    // which is why a rename left no trace in `events` at all.
    expect(dbMocks.renameAccount).toHaveBeenCalledWith(
      serviceDbInstance, "acct1", "Rio Roofing", "user_1",
    );
  });

  it("returns ok:false instead of throwing when the write fails", async () => {
    // Covers BOTH failure shapes the helper has, because it has exactly one
    // channel for them: a PostgREST error and a zero-row update both leave
    // `renameAccount` throwing (packages/db/src/accounts.ts). The zero-row
    // case is the one that used to report `{ok:true}` from here — a "saved"
    // toast over a write that touched nothing.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.renameAccount.mockRejectedValue(new Error("renameAccount: no account acct1"));
    const r = await renameAccountAction("acct1", "Valid Name");
    expect(r).toEqual({ ok: false, error: m["setup.rename.failed"] });
    errSpy.mockRestore();
  });
});

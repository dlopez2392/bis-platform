import { describe, it, expect, vi, beforeEach } from "vitest";

// Outside a real request, revalidatePath throws ("static generation store
// missing") rather than no-op'ing — conversations/actions.test.ts mocks it
// for the same reason; the brief's skeleton omitted it but every action here
// calls it on the success path.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = vi.hoisted(() => ({
  upsertVoiceProfile: vi.fn(), assignPhoneNumber: vi.fn(),
  setPhoneNumberStatus: vi.fn(), getVoiceProfile: vi.fn(),
  reassignPhoneNumber: vi.fn(), listPhoneNumbersForAccount: vi.fn(),
  setTransferPhone: vi.fn(), enableConcierge: vi.fn(), disableConcierge: vi.fn(),
  getTransferPhone: vi.fn(), setForwardCalls: vi.fn(),
  // Task 18: the Spanish text-back box needs the account's brand name
  // (`defaultTextbackBody`'s own "a company name, never `accounts.name`"
  // rule) to compute our Spanish default.
  getBranding: vi.fn(),
  // S-47c: the knowledge save path (saveKnowledgeParts) reads these and calls the snapshot RPC.
  saveVoiceKnowledge: vi.fn(), listVoiceServices: vi.fn(),
  getLatestKnowledgeVersion: vi.fn(), readAccountTimezone: vi.fn(),
  // S-47d: every knowledge save also snapshots the planned closed days.
  listClosedDaysFrom: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));

/**
 * Guard mock.
 *
 * There is no branding/actions.test.ts to mirror — that file does not exist
 * in this tree. The one real precedent for mocking `@/lib/auth` at all is
 * conversations/actions.test.ts, which replaces `requireAccountAccess` with
 * a plain async stub returning `{ userId }`. branding/actions.ts calls that
 * very same function for its own guard preamble (`const { userId } = await
 * requireAccountAccess(accountId);`) — but branding's own file header
 * explains it was deliberately WIDENED from agency-only to admit clients too,
 * which is the opposite of what this surface needs. Voice must stay
 * agency-only (the nav item, the page, and every write here), the same
 * requirement settings/actions.ts enforces on `setClientAccessAction` via
 * this same function's `isAgency` field.
 *
 * So this mock extends the one real precedent with a switchable `isAgency`
 * fixture rather than hardcoding `{ userId }` alone: `requireAccountAccess`
 * already resolves (never throws/redirects) for an authenticated caller who
 * legitimately owns the account, agency or not — it only redirects for the
 * unauthenticated/no-account/wrong-account cases, which are not this guard's
 * concern. The action itself is what turns `isAgency: false` into a graceful
 * `{ ok: false }`, exactly the way settings/actions.ts's isAgency checks
 * reject a non-agency caller — those throw since their return type is
 * `void`/mixed; these actions are Result-typed throughout, so returning is
 * the right shape here instead.
 */
const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { defaultTextbackBody } from "@/lib/voice/textback-body";
import {
  saveVoiceProfileAction, assignNumberAction, setNumberStatusAction, moveNumberAction,
  setTransferPhoneAction, enableConciergeAction, disableConciergeAction, setForwardCallsAction,
  saveBusinessHoursAction, saveServicesAction,
} from "./actions";
import { revalidatePath } from "next/cache";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff" });
  dbMocks.getBranding.mockResolvedValue({ brandName: "Rio Roofing" });
  // The empty-destination case, i.e. the ordinary path every other
  // moveNumberAction test below exercises. Tests that care about an occupied
  // destination override this explicitly.
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
  // S-47c: the default profile's facts ("stuff") differ from what most cases submit, so every profile save
  // takes the SD14 path into the snapshot save; these are its working defaults.
  dbMocks.readAccountTimezone.mockResolvedValue("America/Chicago");
  dbMocks.getLatestKnowledgeVersion.mockResolvedValue(0);
  dbMocks.listVoiceServices.mockResolvedValue([]);
  dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "ok", version: 1 });
  dbMocks.listClosedDaysFrom.mockResolvedValue([]);
  guardFixture.isAgency = true;
});

describe("voice settings actions", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Sofía" }));
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
  it("saves the profile through serviceDb accessors", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", greeting_en: "Hello", languages: "both" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ persona_name: "Alex" }), expect.any(String));
  });
  it("parses textback_enabled off the checkbox convention and passes textback_body through", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({
      persona_name: "Alex", languages: "both", textback_enabled: "on", textback_body: "Custom body",
    }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ textback_enabled: true, textback_body: "Custom body" }), expect.any(String));
  });
  it("an absent textback_enabled checkbox (unchecked) saves false, and an empty body saves empty", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ textback_enabled: false, textback_body: "" }), expect.any(String));
  });
  it("a blank persona_name falls back to Sofía server-side — the client's `required` is not enforcement", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "  ", languages: "both" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ persona_name: "Sofía" }), expect.any(String));
  });
  it("rejects a non-E164-able number with no db call", async () => {
    const r = await assignNumberAction("a1", fd({ e164: "not-a-number" }));
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.assignPhoneNumber).not.toHaveBeenCalled();
  });
  it("normalizes and assigns a valid number", async () => {
    dbMocks.assignPhoneNumber.mockResolvedValue({ id: "pn1" });
    const r = await assignNumberAction("a1", fd({ e164: "(956) 555-0100", telnyxId: "uuid-1" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.assignPhoneNumber).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ e164: "+19565550100", telnyxId: "uuid-1" }), expect.any(String));
  });
  // D-042: the Voice page could give an account a SECOND active number — a
  // state the setup wizard and go-live cannot describe, and the text sender
  // silently picks the oldest live one. The same rule moveNumberAction
  // already enforces: a released number is a former number and does not count.
  describe("one active number per account (D-042)", () => {
    const row = (id: string, status: string) => ({ id, account_id: "a1", e164: `+1956555010${id.slice(-1)}`, status });

    it("assigning refuses, with no write, when the account already has an active number", async () => {
      dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "testing")]);
      const r = await assignNumberAction("a1", fd({ e164: "(956) 555-0109" }));
      expect(r).toEqual({ ok: false, error: m["voice.moveDestinationOccupied"] });
      expect(dbMocks.assignPhoneNumber).not.toHaveBeenCalled();
    });

    it("assigning goes through when the account's only numbers are released", async () => {
      dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "released")]);
      dbMocks.assignPhoneNumber.mockResolvedValue({ id: "pn2" });
      const r = await assignNumberAction("a1", fd({ e164: "(956) 555-0109" }));
      expect(r).toEqual({ ok: true });
      expect(dbMocks.assignPhoneNumber).toHaveBeenCalledOnce();
    });

    it("assigning refuses when the check itself fails — a save the operator can press again", async () => {
      dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("db down"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await assignNumberAction("a1", fd({ e164: "(956) 555-0109" }));
      errSpy.mockRestore();
      expect(r).toEqual({ ok: false, error: m["voice.numbers.assignFailed"] });
      expect(dbMocks.assignPhoneNumber).not.toHaveBeenCalled();
    });

    it("turning a released number back on refuses while another number is active", async () => {
      dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "live"), row("pn2", "released")]);
      for (const status of ["provisioned", "testing", "live"]) {
        const r = await setNumberStatusAction("a1", "pn2", status);
        expect(r).toEqual({ ok: false, error: m["voice.numbers.anotherActive"] });
      }
      expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
    });

    // Review minor 7: the same refusal reaches an account that ALREADY has two
    // active numbers, when one of them moves testing → live. Its words must be
    // true there too — that number was never off, so "turn it back on" is not.
    it("an already-active number on a two-number account is refused in words true for that case too", async () => {
      dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "live"), row("pn2", "testing")]);
      const r = await setNumberStatusAction("a1", "pn2", "live");
      expect(r).toEqual({ ok: false, error: m["voice.numbers.anotherActive"] });
      expect(m["voice.numbers.anotherActive"]).not.toMatch(/back on/i);
      expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
    });

    it("the active number's own status walk is not blocked by itself", async () => {
      dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "testing"), row("pn2", "released")]);
      dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
      const r = await setNumberStatusAction("a1", "pn1", "live");
      expect(r).toEqual({ ok: true });
      expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn1", "live", expect.any(String));
    });

    // Review minor 1: the fail-CLOSED branch. A status change that is not a
    // release, with the number list unreadable, must not write — it could be
    // making a second active number nobody checked for.
    it("a non-release status change refuses, with no write, when the active-number check cannot be read (mutation: fail open → FAILS)", async () => {
      dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("db down"));
      dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const status of ["provisioned", "testing", "live"]) {
        const r = await setNumberStatusAction("a1", "pn2", status);
        expect(r, status).toEqual({ ok: false, error: m["voice.numbers.statusUpdateFailed"] });
      }
      errSpy.mockRestore();
      expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
    });

    it("releasing is never gated — it is how two active numbers get back to one", async () => {
      dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("db down"));
      dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
      const r = await setNumberStatusAction("a1", "pn2", "released");
      expect(r).toEqual({ ok: true });
      expect(dbMocks.listPhoneNumbersForAccount).not.toHaveBeenCalled();
    });
  });

  it("going live requires a filled profile", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "", facts: "" });
    const r = await setNumberStatusAction("a1", "pn1", "live");
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });
  it("a normal status walk goes through", async () => {
    dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
    const r = await setNumberStatusAction("a1", "pn1", "testing");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setPhoneNumberStatus).toHaveBeenCalledWith({}, "a1", "pn1", "testing", expect.any(String));
  });
  it("an invalid status string is rejected", async () => {
    const r = await setNumberStatusAction("a1", "pn1", "banana");
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });

  /**
   * THE regression this repo has already shipped once, on a sibling column:
   * `calendars.followup_body`'s settings UI seeded the live default into a
   * real form value, so an untouched textarea submitted the default text as
   * if the operator had typed it, and that frozen text pinned itself into
   * the column on every unrelated save — breaking the "empty column means
   * use the live default at send time" contract `bookingFollowupEmail`
   * (and this column's own `defaultTextbackBody`) depends on.
   *
   * `textback_body`'s form field (voice-settings.tsx) is built specifically
   * to not have that failure mode: the textarea shows the default only as a
   * `placeholder`, never a `defaultValue`/`value`, so an untouched field
   * submits "" rather than the default text. That is a UI-only guarantee
   * with no automated check behind it — this repo's web tests run without a
   * DOM, and voice has no e2e spec. This test is the server-side half: it
   * proves the action itself saves the literal empty string for a
   * submission carrying no `textback_body`, and NOT any text
   * `defaultTextbackBody` would produce, so a future change to this action
   * that starts backfilling the default before saving — the exact shape of
   * the prior defect, just one file over — fails here immediately.
   */
  it("a submission with no textback_body saves empty, never the live default text", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both" }));
    expect(r).toEqual({ ok: true });
    const saved = dbMocks.upsertVoiceProfile.mock.calls[0]![2] as { textback_body: string };
    expect(saved.textback_body).toBe("");
    expect(saved.textback_body).not.toBe(defaultTextbackBody("Alex", "en"));
    expect(saved.textback_body).not.toBe(defaultTextbackBody("", "en"));
  });
});

/**
 * Called from the setup wizard's number step, not this page — but it belongs
 * here, with the guard and the result shape every other `phone_numbers` write
 * uses. `reassignPhoneNumber` moves a row BETWEEN accounts, so the caller's
 * own account is not the only tenant it touches; `serviceDb()` bypasses RLS
 * for both sides, which makes the `isAgency` check below the only thing
 * standing behind it.
 */
describe("moveNumberAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await moveNumberAction("a1", "pn1");
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("moves the number to the calling account through serviceDb", async () => {
    dbMocks.reassignPhoneNumber.mockResolvedValue({ id: "pn1", account_id: "a1" });
    const r = await moveNumberAction("a1", "pn1");
    expect(r).toEqual({ ok: true });
    // Argument order is load-bearing: (db, phoneNumberId, toAccountId, actor).
    // Swapping the two ids would move a number to itself and emit on the wrong
    // timelines, with no error anywhere.
    expect(dbMocks.reassignPhoneNumber).toHaveBeenCalledWith({}, "pn1", "a1", "user_1");
  });

  it("reports a thrown reassign rather than rejecting into the caller", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.reassignPhoneNumber.mockRejectedValue(new Error("matched no row"));
    const r = await moveNumberAction("a1", "pn1");
    expect(r).toEqual({ ok: false, error: m["voice.moveFailed"] });
    errSpy.mockRestore();
  });

  /**
   * The server-side twin of setup/page.tsx's own precondition: that page only
   * renders the move list when the destination has no number, but that render
   * is stale the moment it paints, and this action is reachable directly. A
   * released number on the destination does NOT count as occupied — same rule
   * `resolveAssignedNumber` (setup-view.ts) applies.
   */
  it("refuses when the destination already holds a non-released number, without calling reassign", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ id: "pn-existing", status: "testing" }]);
    const r = await moveNumberAction("a1", "pn1");
    expect(r).toEqual({ ok: false, error: m["voice.moveDestinationOccupied"] });
    expect(dbMocks.reassignPhoneNumber).not.toHaveBeenCalled();
  });

  it("a released number on the destination does not block the move", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ id: "pn-old", status: "released" }]);
    dbMocks.reassignPhoneNumber.mockResolvedValue({ id: "pn1", account_id: "a1" });
    const r = await moveNumberAction("a1", "pn1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.reassignPhoneNumber).toHaveBeenCalledWith({}, "pn1", "a1", "user_1");
  });

  it("a non-agency caller is rejected before the destination is even read", async () => {
    guardFixture.isAgency = false;
    await moveNumberAction("a1", "pn1");
    expect(dbMocks.listPhoneNumbersForAccount).not.toHaveBeenCalled();
  });
});

/**
 * The ONE way an account gets a `transfer_phone`, and therefore the only
 * thing that makes Sofía's "I'll put you through" reachable at all.
 *
 * Two properties this block exists to hold, both of which cost a real caller
 * if they slip:
 *
 * ① The owned-number guard reads `listPhoneNumbersForAccount` filtered to
 *    `testing`/`live` — the SAME source and filter as the runtime guard in
 *    `api/voice/texml/handoff/route.ts`, through the same
 *    `resolveHandoffTarget`. Never `resolveSmsSender`, which answers
 *    `no_live_number` for an account holding only a `testing` number: that is
 *    exactly the shape of an account still walking the setup wizard, i.e. the
 *    first accounts this ships to, and the guard would silently not run for
 *    them. A number that saves cleanly here and is refused at call time is a
 *    business that believes it is set up and a caller who gets hung up on.
 * ② Blank clears it to NULL, never `""` — 0037's CHECK refuses the empty
 *    string so that NULL stays the only spelling of "off".
 */
describe("setTransferPhoneAction", () => {
  // The account's own line. `testing`, deliberately: the status
  // `resolveSmsSender` would have hidden from this guard entirely.
  const OWNED = { id: "pn1", e164: "+19565550100", status: "testing" };

  it("the copy these refusals surface actually exists", () => {
    // Guards the whole block against vacuity: a mistyped key would make both
    // sides of every error assertion below `undefined` and pass.
    expect(m["voice.transfer.badE164"]).toBeTruthy();
    expect(m["voice.transfer.ownNumber"]).toBeTruthy();
    expect(m["voice.transfer.saveFailed"]).toBeTruthy();
  });

  it("saves a transfer number the agency typed", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([OWNED]);
    dbMocks.setTransferPhone.mockResolvedValue(undefined);
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "(956) 555-0199" }));
    expect(r).toEqual({ ok: true });
    // E.164 or NULL, never the raw string: the handoff route interpolates this
    // column straight into a TeXML document unescaped, and the E164 CHECK is
    // the only reason that is safe.
    expect(dbMocks.setTransferPhone).toHaveBeenCalledWith({}, "a1", "+19565550199", "user_1");
  });

  it("refuses a number that is not E.164", async () => {
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "ring the boss" }));
    expect(r).toEqual({ ok: false, error: m["voice.transfer.badE164"] });
    expect(dbMocks.setTransferPhone).not.toHaveBeenCalled();
  });

  it("refuses a number this account owns, with a reason the operator can act on", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([OWNED]);
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "956-555-0100" }));
    expect(r).toEqual({ ok: false, error: m["voice.transfer.ownNumber"] });
    expect(dbMocks.setTransferPhone).not.toHaveBeenCalled();
  });

  it("refuses a LIVE owned number too, not just a testing one", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ ...OWNED, status: "live" }]);
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550100" }));
    expect(r).toEqual({ ok: false, error: m["voice.transfer.ownNumber"] });
    expect(dbMocks.setTransferPhone).not.toHaveBeenCalled();
  });

  /**
   * The near misses. A guard that compared loosely — last four digits, a
   * `startsWith`, a substring — would refuse both of these, and the business
   * owner whose cell happens to share four digits with the office line would
   * be told, wrongly, that their own number is the office number. Neither
   * fixture catches the other's mutation: one differs in the LAST digit, the
   * other shares the whole last four and differs in the area code.
   */
  it("a number that merely resembles an owned one still saves", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([OWNED]);
    dbMocks.setTransferPhone.mockResolvedValue(undefined);
    const oneDigitOff = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550101" }));
    expect(oneDigitOff).toEqual({ ok: true });
    const sameLastFour = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19995550100" }));
    expect(sameLastFour).toEqual({ ok: true });
    expect(dbMocks.setTransferPhone).toHaveBeenNthCalledWith(1, {}, "a1", "+19565550101", "user_1");
    expect(dbMocks.setTransferPhone).toHaveBeenNthCalledWith(2, {}, "a1", "+19995550100", "user_1");
  });

  /**
   * The filter, pinned from the permissive side: `provisioned` and `released`
   * numbers do not carry calls, so neither blocks — which is exactly the set
   * the runtime guard skips. A guard widened to "any row this account has"
   * would refuse a number the call path would have dialled happily.
   */
  it("an owned number that is not in service does not block the save", async () => {
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([
      { id: "pn-new", e164: "+19565550100", status: "provisioned" },
      { id: "pn-old", e164: "+19565550188", status: "released" },
    ]);
    dbMocks.setTransferPhone.mockResolvedValue(undefined);
    expect(await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550100" }))).toEqual({ ok: true });
    expect(await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550188" }))).toEqual({ ok: true });
  });

  it("a blank value clears it — the field IS the switch", async () => {
    dbMocks.setTransferPhone.mockResolvedValue(undefined);
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "   " }));
    expect(r).toEqual({ ok: true });
    // NULL, never "". The column's CHECK refuses the empty string outright,
    // and a second spelling of "off" is one the settings screen and the call
    // path would read differently.
    expect(dbMocks.setTransferPhone).toHaveBeenCalledWith({}, "a1", null, "user_1");
    const written = dbMocks.setTransferPhone.mock.calls[0]![2];
    expect(written).not.toBe("");
  });

  it("turning it off works even when the numbers read is down", async () => {
    // Clearing cannot loop a caller anywhere, so it must not be gated on a
    // read that can fail — the off switch has to stay reachable.
    dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("db down"));
    dbMocks.setTransferPhone.mockResolvedValue(undefined);
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setTransferPhone).toHaveBeenCalledWith({}, "a1", null, "user_1");
  });

  it("a failed owned-number read refuses the save rather than guessing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("db down"));
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550199" }));
    expect(r).toEqual({ ok: false, error: m["voice.transfer.saveFailed"] });
    expect(dbMocks.setTransferPhone).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("reports a thrown write rather than rejecting into the caller", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.setTransferPhone.mockRejectedValue(new Error("no such account"));
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550199" }));
    expect(r).toEqual({ ok: false, error: m["voice.transfer.saveFailed"] });
    errSpy.mockRestore();
  });

  it("a client-role user cannot set it", async () => {
    // `authenticated` has no UPDATE grant on this column by design, so this
    // gate is the only thing standing behind the write — nothing in the
    // database is.
    guardFixture.isAgency = false;
    const r = await setTransferPhoneAction("a1", fd({ transfer_phone: "+19565550199" }));
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.setTransferPhone).not.toHaveBeenCalled();
    expect(dbMocks.listPhoneNumbersForAccount).not.toHaveBeenCalled();
  });
});

/**
 * The website assistant's on/off switch. `enableConcierge`/`disableConcierge`
 * (packages/db/src/concierge.ts) are the ONLY things standing behind this —
 * `voice_profiles` grants `authenticated` SELECT only, same as every other
 * write in this file — so the `isAgency` guard is load-bearing here too.
 */
describe("enableConciergeAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.enableConcierge).not.toHaveBeenCalled();
  });

  it("turns it on and hands back the address the snippet needs", async () => {
    dbMocks.enableConcierge.mockResolvedValue({ publicId: "pub_abc" });
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: true, publicId: "pub_abc" });
    expect(dbMocks.enableConcierge).toHaveBeenCalledWith({}, "a1", "form1");
  });

  /**
   * The accessor's own contract (concierge.ts): a missing `voice_profiles`
   * row throws with this exact substring, and it is a REAL state, not a bug
   * — the card is supposed to lock the toggle before this can ever fire, but
   * the action still has to answer sanely for a caller that bypasses the UI.
   */
  it("a missing profile row renders the same sentence the locked toggle shows", async () => {
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: no voice profile for this account"),
    );
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.lockedNoProfile"] });
  });

  /**
   * Post-5a: the MESSAGE is the discriminator. This is 0045's cross-tenant
   * RAISE text, and — per concierge.ts's own doc — it is ALSO what a form
   * deleted between the picker rendering and the submit reads as, which is
   * why the sentence allows for both rather than asserting either happened.
   *
   * The two failure modes must render as two DIFFERENT sentences — this test
   * and the one above pin that the strings are not the same one reused.
   */
  it("a cross-tenant (or since-deleted) form renders a DIFFERENT sentence than the missing-profile case", async () => {
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: form does not belong to this account"),
    );
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.wrongForm"] });
    expect(m["voice.assistant.wrongForm"]).not.toBe(m["voice.assistant.lockedNoProfile"]);
  });

  /**
   * Task 6 review, Minor: this branch returned without a `console.error` at
   * all — a real cross-tenant attempt (or a race against a just-deleted
   * form) left no trace naming WHICH account and WHICH form, unlike the
   * generic-failure branch just below, which already logs.
   */
  it("logs the account and form id on the cross-tenant/deleted-form branch, not just the sentence", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: form does not belong to this account"),
    );
    await enableConciergeAction("a1", "form1");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("a1"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("form1"));
    errSpy.mockRestore();
  });

  // D-108: the server refusal names the SAME missing piece the locked toggle
  // would have, for a caller that went around the card.
  it("a profile with no greeting renders the toggle's own greeting sentence", async () => {
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: profile not ready (greeting)"),
    );
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.lockedBlankGreeting"] });
  });

  it("a bilingual profile with no Spanish greeting renders the toggle's own Spanish-greeting sentence", async () => {
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: profile not ready (spanish_greeting)"),
    );
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.lockedBlankSpanishGreeting"] });
  });

  it("a profile with no facts renders the toggle's own facts sentence", async () => {
    dbMocks.enableConcierge.mockRejectedValue(
      new Error("enableConcierge failed: profile not ready (facts)"),
    );
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.lockedBlankFacts"] });
  });

  it("any other failure gets the generic sentence, logged rather than swallowed", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.enableConcierge.mockRejectedValue(new Error("enableConcierge failed: db down"));
    const r = await enableConciergeAction("a1", "form1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.enableFailed"] });
    errSpy.mockRestore();
  });
});

describe("disableConciergeAction", () => {
  it("a non-agency caller is rejected before any db call", async () => {
    guardFixture.isAgency = false;
    const r = await disableConciergeAction("a1");
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.disableConcierge).not.toHaveBeenCalled();
  });

  it("turns it off through serviceDb", async () => {
    dbMocks.disableConcierge.mockResolvedValue(undefined);
    const r = await disableConciergeAction("a1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.disableConcierge).toHaveBeenCalledWith({}, "a1");
  });

  it("reports a thrown disable rather than rejecting into the caller", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.disableConcierge.mockRejectedValue(new Error("disableConcierge matched no row"));
    const r = await disableConciergeAction("a1");
    expect(r).toEqual({ ok: false, error: m["voice.assistant.disableFailed"] });
    errSpy.mockRestore();
  });
});

describe("setForwardCallsAction (operational-floor spec §3)", () => {
  beforeEach(() => {
    guardFixture.isAgency = true;
    dbMocks.getTransferPhone.mockReset().mockResolvedValue("+19562921696");
    dbMocks.setForwardCalls.mockReset().mockResolvedValue(undefined);
  });

  it("the agency turns it on: written through setForwardCalls with the actor, so history shows who took the phones back", async () => {
    expect(await setForwardCallsAction("acct_1", true)).toEqual({ ok: true });
    expect(dbMocks.setForwardCalls).toHaveBeenCalledWith(expect.anything(), "acct_1", true, "user_1");
  });

  it("a client cannot reach it, and nothing is read or written (mutation: drop the isAgency check → FAILS)", async () => {
    guardFixture.isAgency = false;
    expect(await setForwardCallsAction("acct_1", true)).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.getTransferPhone).not.toHaveBeenCalled();
    expect(dbMocks.setForwardCalls).not.toHaveBeenCalled();
  });

  it("on with no transfer number is refused on the server, not only by the disabled switch (mutation: skip the check → FAILS)", async () => {
    dbMocks.getTransferPhone.mockResolvedValue(null);
    expect(await setForwardCallsAction("acct_1", true)).toEqual({ ok: false, error: m["voice.forward.needsTransfer"] });
    expect(dbMocks.setForwardCalls).not.toHaveBeenCalled();
  });

  it("off is never gated on a read: it works while the transfer-number read is down", async () => {
    dbMocks.getTransferPhone.mockRejectedValue(new Error("db down"));
    expect(await setForwardCallsAction("acct_1", false)).toEqual({ ok: true });
    expect(dbMocks.getTransferPhone).not.toHaveBeenCalled();
    expect(dbMocks.setForwardCalls).toHaveBeenCalledWith(expect.anything(), "acct_1", false, "user_1");
  });

  it("a failed read or write is one plain sentence, never the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.getTransferPhone.mockRejectedValue(new Error("db down"));
    expect(await setForwardCallsAction("acct_1", true)).toEqual({ ok: false, error: m["voice.forward.saveFailed"] });
    dbMocks.getTransferPhone.mockResolvedValue("+19562921696");
    dbMocks.setForwardCalls.mockRejectedValue(new Error("no voice profile for this account"));
    expect(await setForwardCallsAction("acct_1", true)).toEqual({ ok: false, error: m["voice.forward.saveFailed"] });
    vi.restoreAllMocks();
  });
});


// Task 18: the text-back card's Spanish box. `saveVoiceProfileAction` now
// reads the account's branding (for `defaultTextbackBody`'s brand name) and
// the current row (for the stored Spanish and its basis) before computing
// the next `textback_body_es`/`textback_body_es_basis` pair through
// `nextSpanishBox` (packages/db/src/messaging.ts) — the same pure function
// every other Spanish box in this PR saves through.
describe("saveVoiceProfileAction — the Spanish text-back box (Task 18)", () => {
  it("(a) Spanish equal to our default stores textback_body_es: null", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({
      greeting_en: "Hi", facts: "stuff", textback_body_es: "Suyo.", textback_body_es_basis: "Old.",
    });
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const defaultEs = defaultTextbackBody("Rio Roofing", "es");
    const r = await saveVoiceProfileAction("a1", fd({
      persona_name: "Alex", languages: "both", textback_body: "Custom body", body_es: defaultEs,
    }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ textback_body_es: null }), expect.any(String));
  });

  it("(b) an edited Spanish stores it, with the basis set to the saved English", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({
      greeting_en: "Hi", facts: "stuff", textback_body_es: null, textback_body_es_basis: null,
    });
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({
      persona_name: "Alex", languages: "both", textback_body: "Custom English.", body_es: "Nuestro propio texto.",
    }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ textback_body_es: "Nuestro propio texto.", textback_body_es_basis: "Custom English." }),
      expect.any(String));
  });

  it("(c) English over 1,000 characters is refused, with no save (plan deviation 6)", async () => {
    const r = await saveVoiceProfileAction("a1", fd({
      persona_name: "Alex", languages: "both", textback_body: "x".repeat(1001),
    }));
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("(d) Spanish over 1,000 characters is refused, with no save", async () => {
    const r = await saveVoiceProfileAction("a1", fd({
      persona_name: "Alex", languages: "both", textback_body: "Fine.", body_es: "x".repeat(1001),
    }));
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
});

/**
 * S-47a §5.4, ambiguity G: a form that does not carry the field (a Setup step, say) must never reset the
 * stored setting; an unknown value refuses the whole save rather than silently falling back to something.
 */
describe("saveVoiceProfileAction — the disclosure field (S-47a)", () => {
  it("disclosure=on carries through to the patch", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", disclosure: "on" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ disclosure: "on" }), expect.any(String));
  });

  it("an absent field leaves the stored setting alone — the patch carries NO disclosure key at all (mutation: default an absent field to 'off' → FAILS)", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both" }));
    expect(r).toEqual({ ok: true });
    const patch = dbMocks.upsertVoiceProfile.mock.calls[0]![2] as Record<string, unknown>;
    expect("disclosure" in patch).toBe(false);
  });

  it("an unknown value refuses the whole save, with no write", async () => {
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", disclosure: "maybe" }));
    expect(r).toEqual({ ok: false, error: m["voice.profile.saveFailed"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("a non-agency caller is refused before any write, even with disclosure=on in the form", async () => {
    guardFixture.isAgency = false;
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", disclosure: "on" }));
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
});

/**
 * S-47b section 5.6: ABSENT leaves the stored module alone (the S-47a rule for `disclosure` above);
 * "none" clears it (NULL = the general rules only); one of TRADE_MODULE_IDS sets it; anything else
 * refuses the whole save.
 */
describe("saveVoiceProfileAction — the trade_module field (S-47b)", () => {
  it("trade_module=events carries through to the patch", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", trade_module: "events" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ trade_module: "events" }), expect.any(String));
  });

  it("trade_module=none clears it to NULL (mutation: map 'none' to undefined → FAILS)", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", trade_module: "none" }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ trade_module: null }), expect.any(String));
  });

  it("an absent field leaves the stored module alone — the patch carries NO trade_module key at all (mutation: default absent to null → FAILS)", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both" }));
    expect(r).toEqual({ ok: true });
    const patch = dbMocks.upsertVoiceProfile.mock.calls[0]![2] as Record<string, unknown>;
    expect("trade_module" in patch).toBe(false);
  });

  it("an unknown value refuses the whole save, with no write", async () => {
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", trade_module: "law" }));
    expect(r).toEqual({ ok: false, error: m["voice.profile.saveFailed"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("a non-agency caller is refused before any write, even with trade_module=events in the form", async () => {
    guardFixture.isAgency = false;
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Alex", languages: "both", trade_module: "events" }));
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
});

// S-47c: the Business hours and Services & prices cards each save ONLY their own part, through the snapshot
// RPC (spec 5.7, C9); a refused save says why in the language of the page that posted it.
type KnowledgeCall = { actor: string; parts: Record<string, unknown>; payload: Record<string, unknown>; baseVersion: number };
const knowledgeCall = (i = 0) => dbMocks.saveVoiceKnowledge.mock.calls[i]![2] as KnowledgeCall;
const closedWeek = () => (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)
  .map((day) => ({ day, open: false, spans: [] as { from: string; to: string }[] }));

describe("saveBusinessHoursAction (S-47c)", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());
  const days = () => {
    const w = closedWeek();
    w[0] = { day: "mon", open: true, spans: [{ from: "08:00", to: "17:00" }] };
    w[4] = { day: "fri", open: true, spans: [{ from: "18:00", to: "00:00" }] };
    return w;
  };

  it("a non-agency caller is refused before any read or write", async () => {
    guardFixture.isAgency = false;
    const r = await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify(days()) }));
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
    expect(dbMocks.getVoiceProfile).not.toHaveBeenCalled();
  });

  it("a valid week saves parts whose ONLY key is business_hours, the canonical object, with the caller as actor (mutation: send another card's part too -> FAILS)", async () => {
    const r = await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify(days()) }));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.saveVoiceKnowledge).toHaveBeenCalledTimes(1);
    expect(dbMocks.saveVoiceKnowledge.mock.calls[0]![1]).toBe("a1");
    expect(Object.keys(knowledgeCall().parts)).toEqual(["business_hours"]);
    expect(knowledgeCall().parts.business_hours).toEqual({ mon: [["08:00", "17:00"]], fri: [["18:00", "24:00"]] });
    expect(knowledgeCall().actor).toBe("user_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/voice");
  });

  it("intent=clear saves parts exactly { business_hours: null }, whatever the days hold (mutation: validate the days on clear -> FAILS)", async () => {
    const r = await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "clear", days: JSON.stringify(closedWeek()) }));
    expect(r).toEqual({ ok: true });
    expect(knowledgeCall().parts).toEqual({ business_hours: null });
  });

  it("an overlap is refused in Spanish when the page is Spanish, with no RPC (mutation: answer in English -> FAILS)", async () => {
    const w = closedWeek();
    w[1] = { day: "tue", open: true, spans: [{ from: "08:00", to: "13:00" }, { from: "12:00", to: "18:00" }] };
    const r = await saveBusinessHoursAction("a1", fd({ locale: "es", intent: "save", days: JSON.stringify(w) }));
    const want = m["voice.hours.error.overlap.es"].replace("{day}", m["voice.hours.day.tue.es"]);
    expect(want).toBe("Martes: estas horas se cruzan.");
    expect(r).toEqual({ ok: false, error: want });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("no open day is refused with the noDay sentence, in English for any locale that is not es", async () => {
    const r = await saveBusinessHoursAction("a1", fd({ locale: "fr", intent: "save", days: JSON.stringify(closedWeek()) }));
    expect(r).toEqual({ ok: false, error: m["voice.hours.error.noDay"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("stale twice: the stale sentence, after two attempts; in Spanish on a Spanish page (mutation: no retry -> the call count FAILS)", async () => {
    dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "stale" });
    expect(await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify(days()) })))
      .toEqual({ ok: false, error: m["voice.knowledge.stale"] });
    expect(dbMocks.saveVoiceKnowledge).toHaveBeenCalledTimes(2);
    expect(await saveBusinessHoursAction("a1", fd({ locale: "es", intent: "save", days: JSON.stringify(days()) })))
      .toEqual({ ok: false, error: m["voice.knowledge.stale.es"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("no_profile, invalid and a failure each read their own sentence", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.saveVoiceKnowledge.mockResolvedValueOnce({ status: "no_profile" });
    expect(await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify(days()) })))
      .toEqual({ ok: false, error: m["voice.knowledge.noProfile"] });
    dbMocks.saveVoiceKnowledge.mockResolvedValueOnce({ status: "invalid" });
    expect(await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify(days()) })))
      .toEqual({ ok: false, error: m["voice.knowledge.invalid"] });
    dbMocks.saveVoiceKnowledge.mockRejectedValueOnce(new Error("saveVoiceKnowledge failed: boom"));
    expect(await saveBusinessHoursAction("a1", fd({ locale: "es", intent: "save", days: JSON.stringify(days()) })))
      .toEqual({ ok: false, error: m["voice.hours.saveFailed.es"] });
    errSpy.mockRestore();
  });

  it("a posted week that is not the card's shape is refused with no RPC", async () => {
    const r = await saveBusinessHoursAction("a1", fd({ locale: "en", intent: "save", days: JSON.stringify({ mon: [] }) }));
    expect(r).toEqual({ ok: false, error: m["voice.hours.saveFailed"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });
});

describe("saveServicesAction (S-47c)", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());
  const row = (o: Record<string, string> = {}) => ({
    name_en: "Haircut", name_es: "", description_en: "", description_es: "",
    price_kind: "fixed", amount: "25", amount_max: "", unit_en: "", unit_es: "", ...o,
  });

  it("a non-agency caller is refused before any read or write", async () => {
    guardFixture.isAgency = false;
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row()]) }));
    expect(r).toEqual({ ok: false, error: m["voice.agencyOnly"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
    expect(dbMocks.getVoiceProfile).not.toHaveBeenCalled();
  });

  it("saves parts whose ONLY key is services, each row validated into its stored shape", async () => {
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row(), row({ name_en: "Shave", price_kind: "free" })]) }));
    expect(r).toEqual({ ok: true });
    expect(Object.keys(knowledgeCall().parts)).toEqual(["services"]);
    expect(knowledgeCall().parts.services).toEqual([
      { name_en: "Haircut", name_es: null, description_en: null, description_es: null, price_kind: "fixed",
        amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null },
      { name_en: "Shave", name_es: null, description_en: null, description_es: null, price_kind: "free",
        amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/voice");
  });

  it("an empty list saves an empty list (removing every service is a save, not a refusal)", async () => {
    expect(await saveServicesAction("a1", fd({ locale: "en", services: "[]" }))).toEqual({ ok: true });
    expect(knowledgeCall().parts).toEqual({ services: [] });
  });

  it("the C16 row: a per_unit price with no Spanish unit names the row, with no RPC", async () => {
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([
      row(), row({ name_en: "Catering", price_kind: "per_unit", amount: "18", unit_en: "guest", unit_es: "" }),
    ]) }));
    expect(r).toEqual({ ok: false, error: "Add the unit in English and in Spanish for Catering." });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("the same refusal reads Spanish on a Spanish page", async () => {
    const r = await saveServicesAction("a1", fd({ locale: "es", services: JSON.stringify([
      row({ name_en: "Catering", price_kind: "per_unit", amount: "18", unit_en: "guest", unit_es: "" }),
    ]) }));
    expect(r).toEqual({ ok: false, error: "Agregue la unidad en inglés y en español para Catering." });
  });

  it("on an insurance profile (C13) a new row arrives as after_visit and a stored row's price is sent back unchanged (mutation: read insurance as false -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff", services: "", trade_module: "insurance_pc" });
    // The row IS stored (the C13 guard only lets a price through that is already on the list).
    dbMocks.listVoiceServices.mockResolvedValue([{ id: "r1", account_id: "a1", position: 1, created_at: "x",
      name_en: "Catering", name_es: null, description_en: null, description_es: null, price_kind: "per_unit",
      amount_cents: 1850, amount_max_cents: null, unit_en: "guest", unit_es: "invitado" }]);
    const stored = row({ name_en: "Catering", price_kind: "per_unit", amount: "18.50", unit_en: "guest", unit_es: "invitado" });
    const added = row({ name_en: "Auto policy review", price_kind: "", amount: "" });
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([stored, added]) }));
    expect(r).toEqual({ ok: true });
    expect(knowledgeCall().parts.services).toEqual([
      { name_en: "Catering", name_es: null, description_en: null, description_es: null, price_kind: "per_unit",
        amount_cents: 1850, amount_max_cents: null, unit_en: "guest", unit_es: "invitado" },
      { name_en: "Auto policy review", name_es: null, description_en: null, description_es: null, price_kind: "after_visit",
        amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
    ]);
  });

  it("on insurance (C13, C21) a hand-built NEW priced row is saved as after_visit, its price dropped (mutation: drop the insurance rule -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff", services: "", trade_module: "insurance_pc" });
    dbMocks.listVoiceServices.mockResolvedValue([]);
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row({ name_en: "Crafted", amount: "999" })]) }));
    expect(r).toEqual({ ok: true });
    expect(knowledgeCall().parts.services).toEqual([
      { name_en: "Crafted", name_es: null, description_en: null, description_es: null, price_kind: "after_visit",
        amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
    ]);
  });

  it("off insurance, a row with no kind is refused (the insurance rule is read from the profile, not the form)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff", services: "", trade_module: "events" });
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row({ name_en: "Tent", price_kind: "" })]) }));
    expect(r).toEqual({ ok: false, error: m["voice.services.error.amount"].replace("{name}", "Tent") });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("a failed profile read refuses with the card's own failure sentence and no RPC", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.getVoiceProfile.mockRejectedValue(new Error("db down"));
    const r = await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row()]) }));
    errSpy.mockRestore();
    expect(r).toEqual({ ok: false, error: m["voice.services.saveFailed"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("stale twice reads the stale sentence", async () => {
    dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "stale" });
    expect(await saveServicesAction("a1", fd({ locale: "en", services: JSON.stringify([row()]) })))
      .toEqual({ ok: false, error: m["voice.knowledge.stale"] });
  });

  it("a posted list that is not the card's shape is refused with no RPC", async () => {
    const r = await saveServicesAction("a1", fd({ locale: "en", services: "{}" }));
    expect(r).toEqual({ ok: false, error: m["voice.services.saveFailed"] });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });
});

describe("saveVoiceProfileAction — Facts and Services go through the snapshot (S-47c)", () => {
  beforeEach(() => {
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "Old facts.", services: "Old services." });
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
  });
  const form = (o: Record<string, string> = {}) =>
    fd({ persona_name: "Alex", languages: "both", facts: "New facts.", services: "Old services.", ...o });

  it("changed Facts: the RPC gets parts exactly { facts, services_text } BEFORE the profile write, and the patch carries neither (mutation: RPC after upsert -> FAILS)", async () => {
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: true });
    expect(knowledgeCall().parts).toEqual({ facts: "New facts.", services_text: "Old services." });
    expect(knowledgeCall().actor).toBe("user_1");
    expect(dbMocks.saveVoiceKnowledge.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.upsertVoiceProfile.mock.invocationCallOrder[0]!);
    const patch = dbMocks.upsertVoiceProfile.mock.calls[0]![2] as Record<string, unknown>;
    expect("facts" in patch).toBe(false);
    expect("services" in patch).toBe(false);
    expect(patch).toMatchObject({ persona_name: "Alex" });
  });

  it("changed Services text alone also goes through the RPC", async () => {
    expect(await saveVoiceProfileAction("a1", form({ facts: "Old facts.", services: "New services." }))).toEqual({ ok: true });
    expect(knowledgeCall().parts).toEqual({ facts: "Old facts.", services_text: "New services." });
  });

  it("the RPC refusing: nothing else is written, and the refusal says why (mutation: write the profile first -> FAILS)", async () => {
    dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "stale" });
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: false, error: m["voice.knowledge.stale"] });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
    dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "invalid" });
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: false, error: m["voice.knowledge.invalid"] });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.saveVoiceKnowledge.mockRejectedValue(new Error("saveVoiceKnowledge failed: down"));
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: false, error: m["voice.profile.saveFailed"] });
    errSpy.mockRestore();
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("unchanged Facts and Services: no RPC at all (SD14), and the profile still saves (mutation: always call the RPC -> FAILS)", async () => {
    expect(await saveVoiceProfileAction("a1", form({ facts: "Old facts.", services: "Old services." }))).toEqual({ ok: true });
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledTimes(1);
  });

  it("no profile yet: the profile is created first, then the knowledge part records version 1 (mutation: skip the RPC on create -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValueOnce(null);
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: true });
    expect(dbMocks.upsertVoiceProfile.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.saveVoiceKnowledge.mock.invocationCallOrder[0]!);
    expect(knowledgeCall().parts).toEqual({ facts: "New facts.", services_text: "Old services." });
    const patch = dbMocks.upsertVoiceProfile.mock.calls[0]![2] as Record<string, unknown>;
    expect("facts" in patch).toBe(false);
    expect("services" in patch).toBe(false);
  });

  it("no profile yet and the knowledge part fails: the profile save failure sentence (Save again takes the first path)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValueOnce(null);
    dbMocks.saveVoiceKnowledge.mockResolvedValue({ status: "stale" });
    expect(await saveVoiceProfileAction("a1", form())).toEqual({ ok: false, error: m["voice.profile.saveFailed"] });
    expect(dbMocks.upsertVoiceProfile).toHaveBeenCalledTimes(1);
  });
});

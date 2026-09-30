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
 * requirement settings/actions.ts enforces on `setClientAccessAction` and
 * `inviteClientAdminAction` via this same function's `isAgency` field.
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
  setTransferPhoneAction, enableConciergeAction, disableConciergeAction,
} from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff" });
  // The empty-destination case, i.e. the ordinary path every other
  // moveNumberAction test below exercises. Tests that care about an occupied
  // destination override this explicitly.
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
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

import { describe, it, expect, vi, beforeEach } from "vitest";

// Outside a real request, revalidatePath throws ("static generation store
// missing") rather than no-op'ing — conversations/actions.test.ts mocks it
// for the same reason; the brief's skeleton omitted it but every action here
// calls it on the success path.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = vi.hoisted(() => ({
  upsertVoiceProfile: vi.fn(), assignPhoneNumber: vi.fn(),
  setPhoneNumberStatus: vi.fn(), getVoiceProfile: vi.fn(),
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

import { saveVoiceProfileAction, assignNumberAction, setNumberStatusAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff" });
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
});

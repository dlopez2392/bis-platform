import { describe, it, expect, vi, beforeEach } from "vitest";

type Access = { userId: string; isAgency: boolean; role?: "owner" | "staff" | "technician" | null };
const requireAccountAccess = vi.fn<(accountId: string) => Promise<Access>>(async () => ({ userId: "user_1", isAgency: true }));
// Staff and roles (Task 6): bulkDeleteContactsAction's guard is
// requireAccountOwner, not requireAccountAccess — mocked separately so a
// Staff caller (the owner guard redirecting) can be exercised without
// touching the other actions in this file, which still use
// requireAccountAccess unchanged.
const requireAccountOwner = vi.fn<(accountId: string) => Promise<{ userId: string; isAgency: boolean }>>(async () => ({ userId: "user_1", isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccess(accountId),
  requireAccountOwner: (accountId: string) => requireAccountOwner(accountId),
}));
const dbForRequest = vi.fn(async () => ({}));
vi.mock("@/lib/db", () => ({ dbForRequest: () => dbForRequest() }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  updateContact: vi.fn(), deleteContacts: vi.fn(),
  addTagToContacts: vi.fn(), removeTagFromContacts: vi.fn(),
  // …plus whatever contacts/actions.ts already imports from @bis/db —
  // createContact, addTagToContact, etc. — stub them all or the module
  // import throws. Read the file's import list and cover it.
  createContact: vi.fn(),
  getContact: vi.fn(), setContactPhoneCountry: vi.fn(),
  // F-085 part 1: assignment, the caller's own users row, and the hidden-
  // match flags a Technician's insert has written by the service client.
  assignContacts: vi.fn(), undoAssignContacts: vi.fn(),
  readPersonId: vi.fn(async () => null as string | null), flagMatchesOf: vi.fn(),
  serviceDb: vi.fn(() => SERVICE),
  // S-02 Task 3c: the Business name writes the business group.
  setContactsBusiness: vi.fn(), undoSetBusiness: vi.fn(), GROUP_NAME_MAX: 120,
};
/** The service client and the request client, told apart by identity. */
const SERVICE = { tag: "service-db" };
const REQUEST = { tag: "request-db" };
vi.mock("@bis/db", () => dbMocks);

const {
  updateContactFieldAction, bulkDeleteContactsAction, bulkAddTagAction, bulkRemoveTagAction,
  setPhoneCountryAction, undoPhoneCountryAction,
  undoInlinePhoneEditAction, createContactAction,
  assignContactsAction, undoAssignContactsAction,
  setContactBusinessAction, undoContactBusinessAction,
} = await import("./actions");
const { m } = await import("@/lib/messages");

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
  requireAccountOwner.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
  dbForRequest.mockReset().mockResolvedValue({});
});

describe("updateContactFieldAction", () => {
  it("rejects a non-allowlisted field WITHOUT touching the db", async () => {
    const r = await updateContactFieldAction("a1", "c1", "custom" as never, "x");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
  });
  it("maps snake_case field to the ContactInput camel key, empty clears", async () => {
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "first_name", "  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).toHaveBeenCalledWith(
      {}, "a1", "c1", { firstName: "" }, "user_1",
    );
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });
  it("the Business name goes to the group, never to updateContact (S-02 §6 row 3; mutation: fall through to updateContact -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.setContactsBusiness.mockResolvedValue([{ contactId: "c1", status: "ok", added: "m2", removed: null }]);
    const r = await updateContactFieldAction("a1", "c1", "company_name", "  Acme  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
    expect(dbMocks.setContactsBusiness).toHaveBeenCalledWith(SERVICE, "a1", [{ contactId: "c1", name: "Acme" }], "user_1");
  });

  /**
   * The phone field's save hands back the server's OWN record of the prior
   * phone/flag and the ACTUAL stored value, so an inline Undo can restore
   * exactly what the server stored (review C1/I1, second version). Read
   * BEFORE the write, then AFTER — never the client's summary, and never
   * `norm.value` (the typed text, which rarely equals the stored column).
   */
  it("a phone save answers `undo` with the prior phone+flag (read BEFORE the write) and the value ACTUALLY stored (read AFTER), not the typed text (mutation: undo.editedPhone = norm.value → FAILS)", async () => {
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", phone: "+19565550100", phone_country_unconfirmed: true })
      .mockResolvedValueOnce({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "phone", "(956) 292-1696");
    expect(dbMocks.updateContact).toHaveBeenCalledWith({}, "a1", "c1", { phone: "(956) 292-1696" }, "user_1");
    expect(r).toEqual({
      ok: true,
      undo: { priorPhone: "+19565550100", priorUnconfirmed: true, editedPhone: "+19562921696" },
    });
  });

  // Round 4 (DESIGN.md rule 6): a first fill from empty is REVERSIBLE too —
  // it now gets a real `undo` (priorPhone: null), not a silent no-Undo save.
  // m4: a throw fetching the db client is a FAILED SAVE, not the "crashed"
  // toast (that is inline-field.tsx's own handling of a REJECTED server
  // action — a stale action id after a redeploy — never this).
  it("a throw getting the db client is 'Save failed', never left to reject the whole action (mutation: dbForRequest() outside the try → FAILS)", async () => {
    dbForRequest.mockRejectedValueOnce(new Error("no connection"));
    const r = await updateContactFieldAction("a1", "c1", "phone", "5551234567");
    expect(r).toEqual({ ok: false, error: "Save failed — please try again." });
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
  });

  it("a first fill from empty (no prior real number) still answers an `undo`, restoring to null (mutation: skip the read-back for a null prior → FAILS)", async () => {
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", phone: null, phone_country_unconfirmed: false })
      .mockResolvedValueOnce({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "phone", "(956) 292-1696");
    expect(r).toEqual({
      ok: true,
      undo: { priorPhone: null, priorUnconfirmed: false, editedPhone: "+19562921696" },
    });
  });
});

describe("bulkDeleteContactsAction", () => {
  it("passes through honest counts", async () => {
    dbMocks.deleteContacts.mockResolvedValue({ deleted: 2, skippedBlocked: 1 });
    const r = await bulkDeleteContactsAction("a1", ["x", "y", "z"]);
    expect(r).toEqual({ ok: true, deleted: 2, skippedBlocked: 1 });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.deleteContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkDeleteContactsAction("a1", ["x"]);
    expect(r.ok).toBe(false);
  });

  // Staff and roles (Task 6): delete is Owner-only. A Staff caller's
  // requireAccountOwner redirect must be rejected AS-IS — never caught and
  // turned into a swallowed { ok: false } — and deleteContacts must never
  // run first. (mutation: keep requireAccountAccess as the guard here →
  // FAILS, since that mock still resolves and lets deleteContacts through.)
  it("rejects with the owner guard's redirect before ever calling deleteContacts", async () => {
    const denied = new Error("REDIRECT:/dashboard/accounts/a1/dashboard");
    requireAccountOwner.mockRejectedValueOnce(denied);
    await expect(bulkDeleteContactsAction("a1", ["x"])).rejects.toBe(denied);
    expect(requireAccountOwner).toHaveBeenCalledWith("a1");
    expect(dbMocks.deleteContacts).not.toHaveBeenCalled();
  });
});

describe("bulkAddTagAction", () => {
  it("returns ok:true and spreads the tagId/applied/addedIds from addTagToContacts", async () => {
    dbMocks.addTagToContacts.mockResolvedValue({ tagId: "t9", applied: 2, addedIds: ["c2"] });
    const r = await bulkAddTagAction("a1", ["c1", "c2"], "urgent");
    expect(r).toEqual({ ok: true, tagId: "t9", applied: 2, addedIds: ["c2"] });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.addTagToContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkAddTagAction("a1", ["c1"], "urgent");
    expect(r.ok).toBe(false);
  });
  it("returns ok:false and does not call addTagToContacts when contactIds is empty", async () => {
    const r = await bulkAddTagAction("a1", [], "urgent");
    expect(r.ok).toBe(false);
    expect(dbMocks.addTagToContacts).not.toHaveBeenCalled();
  });
});

describe("bulkRemoveTagAction", () => {
  it("returns ok:true when removeTagFromContacts resolves", async () => {
    dbMocks.removeTagFromContacts.mockResolvedValue(undefined);
    const r = await bulkRemoveTagAction("a1", ["c1", "c2"], "t9");
    expect(r).toEqual({ ok: true });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.removeTagFromContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkRemoveTagAction("a1", ["c1"], "t9");
    expect(r.ok).toBe(false);
  });
});

/**
 * The Texts row's Check number pick and its undo (consent chain spec §6,
 * F-009). The phone module is REAL (@bis/db/phone is not mocked), so the
 * rewrite is the normaliser's own.
 */
describe("setPhoneCountryAction", () => {
  const flagged = { id: "c1", phone: "+15512345678", phone_country_unconfirmed: true };

  it("Mexico rewrites the SAME ten digits under +52, clears the flag, compare-and-set on the phone it read (mutation: expectedPhone = the new phone → FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(flagged);
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await setPhoneCountryAction("a1", "c1", "MX", "+15512345678");
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "+15512345678", phone: "+525512345678", unconfirmed: false }, "user_1");
    expect(r).toEqual({ ok: true, phone: "+525512345678", previous: { phone: "+15512345678", unconfirmed: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("US keeps +1 and still clears the flag; a raw legacy number is read, not refused", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", phone: "55 1234 5678", phone_country_unconfirmed: false });
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await setPhoneCountryAction("a1", "c1", "US", "55 1234 5678");
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "55 1234 5678", phone: "+15512345678", unconfirmed: false }, "user_1");
    expect(r).toMatchObject({ ok: true, previous: { phone: "55 1234 5678", unconfirmed: false } });
  });

  it("a country off the wire that is not US or MX writes nothing (mutation: drop the COUNTRIES check → FAILS)", async () => {
    const r = await setPhoneCountryAction("a1", "c1", "CA" as never, "+15512345678");
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });

  it("the number changed under the operator: 'changed', nothing revalidated", async () => {
    dbMocks.getContact.mockResolvedValue(flagged);
    dbMocks.setContactPhoneCountry.mockResolvedValue("changed");
    expect(await setPhoneCountryAction("a1", "c1", "MX", "+15512345678")).toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // Re-derived (round 3, fail-closed I3): a `seenPhone` this unreadable
  // NEVER matches (repickPhoneCountry(seenPhone, "US") is null for it, and
  // the fail-closed check refuses on that alone), so the seen-check now
  // answers "changed" before the later re-pick attempt ever runs — the old
  // expectation (`unreadable`) was the OLD open-check's path, no longer
  // reachable through this entry point once the seen phone itself cannot
  // be read. Input: "+44 20 7946 0958" as both stored and seen. Old: an
  // "unreadable" refusal. New: a "changed" refusal (measured on this tree).
  it("a number that is not ten national digits fails closed on the unread SEEN phone before ever reaching the re-pick attempt (mutation: fail open on an unreadable seenPhone → FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", phone: "+44 20 7946 0958", phone_country_unconfirmed: true });
    expect(await setPhoneCountryAction("a1", "c1", "MX", "+44 20 7946 0958")).toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  /**
   * Round 3, IMPORTANT: fails CLOSED. An empty seen phone (the drawer's
   * `?peek=` stub row used to send this) or any other unreadable seen
   * phone answers "changed" and writes nothing — never "no opinion,
   * proceed".
   */
  it("an empty seenPhone (a stub row) fails closed: 'changed', no write (mutation: seenReads !== null && … → FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(flagged);
    expect(await setPhoneCountryAction("a1", "c1", "MX", "")).toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("a db error is the failed line, logged, never thrown", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.getContact.mockRejectedValue(new Error("boom"));
    expect(await setPhoneCountryAction("a1", "c1", "MX", "+15512345678")).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(err.mock.calls[0]?.[0]).toContain("setPhoneCountryAction: account a1 contact c1");
    err.mockRestore();
  });

  it("a number no longer ambiguous is not re-coded: a stale row's pick answers 'changed' and writes nothing (review R3-I2; mutation: drop the still-ambiguous check → +529562921696 written, FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
    expect(await setPhoneCountryAction("a1", "c1", "MX", "+19562921696")).toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("refuses before any read when access is refused (review R3-M6; mutation: read the contact before the guard → FAILS)", async () => {
    requireAccountAccess.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(setPhoneCountryAction("a1", "c1", "MX", "+15512345678")).rejects.toThrow("NEXT_REDIRECT");
    expect(requireAccountAccess).toHaveBeenCalledWith("a1");
    expect(dbMocks.getContact).not.toHaveBeenCalled();
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  /**
   * Review I3: the compare-and-set is judged against the phone the OPERATOR
   * SAW (the row's own render), not merely the phone this call re-reads —
   * so a number someone else changed to another AMBIGUOUS number between
   * render and click is never re-coded unseen.
   */
  it("a number someone else changed to another ambiguous number, unseen by the operator, is 'changed', no write (review I3; mutation: drop the seenPhone check → FAILS)", async () => {
    // Tab 1 rendered with "+15512345678" (A); the stored number is now a
    // DIFFERENT ambiguous number, "+15629211234" (B, still both-valid).
    dbMocks.getContact.mockResolvedValue({ id: "c1", phone: "+15629211234", phone_country_unconfirmed: true });
    const r = await setPhoneCountryAction("a1", "c1", "MX", "+15512345678");
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });
});

describe("undoPhoneCountryAction", () => {
  it("puts back the previous phone and flag while the stored phone is the one the pick wrote", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "+15512345678", unconfirmed: true });
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "+525512345678", phone: "+15512345678", unconfirmed: true }, "user_1");
    expect(r).toEqual({ ok: true });
  });

  it("refuses a 'previous' that is a DIFFERENT number: the undo is never a general phone write (mutation: drop the same-number check → FAILS)", async () => {
    const r = await undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "+19562921696", unconfirmed: false });
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("refuses a flag that is not a real boolean", async () => {
    const r = await undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "+15512345678", unconfirmed: "true" as never });
    expect(r.ok).toBe(false);
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("the number changed since the pick: 'changed'", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("changed");
    expect(await undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "+15512345678", unconfirmed: true }))
      .toEqual({ ok: false, error: m["contact.phoneCountry.changed"] });
  });

  it("restores the normaliser's form, and keeps the flag for a number it still calls ambiguous, whatever the wire says (review R3-M12; mutation: write previous.phone and previous.unconfirmed as sent → FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    await undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "55 1234 5678", unconfirmed: false });
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "+525512345678", phone: "+15512345678", unconfirmed: true }, "user_1");
  });

  it("refuses before any write when access is refused (review R3-M6; mutation: write before the guard → FAILS)", async () => {
    requireAccountAccess.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(undoPhoneCountryAction("a1", "c1", "+525512345678", { phone: "+15512345678", unconfirmed: true }))
      .rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });
});

/**
 * The generic inline-edit undo's fix (Task 2's review I2, no other task in
 * this plan owns it): the phone field's undo restores BOTH the number and
 * the flag it had before this edit, through the same compare-and-set
 * `setContactPhoneCountry` uses, rather than resubmitting the prior TEXT
 * (which `updateContactFieldAction` would re-derive, and never re-flags a
 * number already carrying a country code — packages/db/src/phone.ts's
 * `international()` branch always answers `unconfirmed: false`).
 */
describe("undoInlinePhoneEditAction", () => {
  // Round 4 (DESIGN.md rule 6): the twin of the first-fill save above — its
  // Undo restores null (there was never a prior real number).
  it("undoes a first fill by restoring null (mutation: refuse a null priorPhone → FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+19562921696", priorPhone: null, priorUnconfirmed: false,
    });
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "+19562921696", phone: null, unconfirmed: false }, "user_1");
    expect(r).toEqual({ ok: true });
  });

  it("undoing a phone edit restores the prior number AND its flag (mutation: restore the number only → the flag comes back false, FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "+19565550100", priorUnconfirmed: true,
    });
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1", { expectedPhone: "+14155551234", phone: "+19565550100", unconfirmed: true }, "user_1");
    expect(r).toEqual({ ok: true });
  });

  it("the phone undo refuses without account access (mutation: drop requireAccountAccess → FAILS)", async () => {
    requireAccountAccess.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "+19565550100", priorUnconfirmed: true,
    })).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("a number that moved again since the edit is not overwritten by the undo, and says so in words that fit an inline edit (mutation: drop the compare-and-set → FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("changed");
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "+19565550100", priorUnconfirmed: true,
    });
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.inlineChanged"] });
  });

  // Round 4: null is now a VALID priorPhone (the first-fill case above).
  // A numeric (not null, not string) priorPhone is still refused.
  it("a numeric (not null, not string) priorPhone is refused, never written (mutation: drop the typeof priorPhone check → FAILS)", async () => {
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: 12345 as never, priorUnconfirmed: true,
    });
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("a crafted priorUnconfirmed that is not a real boolean is refused (m1; mutation: drop the typeof priorUnconfirmed check → FAILS)", async () => {
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "+19565550100", priorUnconfirmed: "true" as never,
    });
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  // Round 3 (CRITICAL): `editedPhone: null` is now VALID — a clear wipes the
  // column to null, and the Undo must be able to compare-and-set against
  // that. Anything ELSE non-string is still refused.
  it("a numeric (not null, not string) editedPhone is refused, never written (mutation: drop the typeof check for editedPhone → FAILS)", async () => {
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: 12345 as never, priorPhone: "+19565550100", priorUnconfirmed: true,
    });
    expect(r).toEqual({ ok: false, error: m["contact.phoneCountry.failed"] });
    expect(dbMocks.setContactPhoneCountry).not.toHaveBeenCalled();
  });

  it("revalidates the list AND the full contact page after a successful undo (m2; mutation: drop revalidateContact → FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "+19565550100", priorUnconfirmed: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  /**
   * The end-to-end regression this whole fix exists for: a FORMATTED typed
   * value (never exact E.164), through the REAL save → the real undo, comes
   * back byte-identical AND flagged. Exercises both actions together, with
   * `getContact` standing in for the account's row across the save's two
   * reads and the eventual (mocked) compare-and-set — the closest this
   * mock-`@bis/db` suite gets to the real write path without a live db.
   */
  it("a flagged stored number, edited with a FORMATTED typed value then undone, restores the byte-identical prior text AND the flag (mutation: undo.editedPhone = norm.value (the typed text) → FAILS)", async () => {
    const { updateContactFieldAction } = await import("./actions");
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", phone: "+19565550100", phone_country_unconfirmed: true })
      .mockResolvedValueOnce({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
    dbMocks.updateContact.mockResolvedValue(undefined);
    const saved = await updateContactFieldAction("a1", "c1", "phone", "(956) 292-1696");
    if (!saved.ok || !saved.undo) throw new Error("expected an undo payload");
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await undoInlinePhoneEditAction("a1", "c1", saved.undo);
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1",
      { expectedPhone: "+19562921696", phone: "+19565550100", unconfirmed: true },
      "user_1",
    );
    expect(r).toEqual({ ok: true });
  });

  /**
   * Round 3, CRITICAL. Measured on the pre-fix tree:
   * `{"undoPayload":null,"afterEdit":null,"undo":{"ok":true},"final":{"phone":"+15512345678","flag":false}}`
   * — clearing a flagged number produced NO undo payload (the old
   * `typeof after?.phone === "string"` guard rejected `null`), so Undo fell
   * back to `save(prior)` and the flag came back CONFIRMED. Now the save
   * answers a real `undo` for a clear too (`editedPhone: null`), and the
   * dedicated action compare-and-sets against a null stored phone.
   */
  it("a flagged number, CLEARED, then undone, comes back byte-identical AND flagged (mutation: reject a null editedPhone again → FAILS)", async () => {
    const { updateContactFieldAction } = await import("./actions");
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", phone: "+15512345678", phone_country_unconfirmed: true })
      .mockResolvedValueOnce({ id: "c1", phone: null, phone_country_unconfirmed: false });
    dbMocks.updateContact.mockResolvedValue(undefined);
    const saved = await updateContactFieldAction("a1", "c1", "phone", "");
    if (!saved.ok || !saved.undo) throw new Error("expected an undo payload for a clear");
    expect(saved.undo).toEqual({ priorPhone: "+15512345678", priorUnconfirmed: true, editedPhone: null });
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    const r = await undoInlinePhoneEditAction("a1", "c1", saved.undo);
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1",
      { expectedPhone: null, phone: "+15512345678", unconfirmed: true },
      "user_1",
    );
    expect(r).toEqual({ ok: true });
  });

  /**
   * NEW-10: the R3-M12 floor applies to the inline Undo exactly as it does
   * to the pick's own undo — the normaliser's OWN form of the prior text is
   * restored, and the flag is never cleared for a number the normaliser
   * still calls ambiguous, whatever the caller's `priorUnconfirmed` says.
   */
  it("restores the normaliser's form and keeps the flag for a number it still calls ambiguous, whatever the caller says (R3-M12 floor; mutation: write undo.priorPhone/priorUnconfirmed as sent → FAILS)", async () => {
    dbMocks.setContactPhoneCountry.mockResolvedValue("updated");
    await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: "55 1234 5678", priorUnconfirmed: false,
    });
    expect(dbMocks.setContactPhoneCountry).toHaveBeenCalledWith(
      {}, "a1", "c1",
      { expectedPhone: "+14155551234", phone: "+15512345678", unconfirmed: true },
      "user_1",
    );
  });
});

// D-013: Add contact used to save an all-blank contact, never checked an
// email/phone's SHAPE, and closed the dialog silently on a dedupe match.
const addForm = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("createContactAction (D-013)", () => {
  it("refuses an all-blank submission without ever calling createContact (mutation: drop the blank guard → FAILS)", async () => {
    const r = await createContactAction("a1", addForm({}));
    expect(r.kind).toBe("invalid");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("refuses a malformed email, reusing the SAME shape check inline editing uses (mutation: skip the email check → FAILS)", async () => {
    const r = await createContactAction("a1", addForm({ firstName: "Jo", email: "not-an-email" }));
    expect(r.kind).toBe("invalid");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("refuses a malformed phone (mutation: skip the phone check → FAILS)", async () => {
    const r = await createContactAction("a1", addForm({ firstName: "Jo", phone: "call after 5" }));
    expect(r.kind).toBe("invalid");
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("a name alone is enough — email/phone are not required", async () => {
    dbMocks.createContact.mockResolvedValueOnce({ existing: false, id: "new1" });
    const r = await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(r.kind).toBe("created");
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
  });

  it("reports a dedupe match plainly instead of closing silently (mutation: ignore result.existing → FAILS)", async () => {
    dbMocks.createContact.mockResolvedValueOnce({ existing: true, id: "existing1" });
    const r = await createContactAction("a1", addForm({ firstName: "Jo", email: "jo@x.com" }));
    expect(r).toEqual({ kind: "existing", contactId: "existing1" });
  });

  it("a real save revalidates the contacts list", async () => {
    dbMocks.createContact.mockResolvedValueOnce({ existing: false, id: "new1" });
    await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  it("does not revalidate on a dedupe match — nothing changed to show", async () => {
    dbMocks.createContact.mockResolvedValueOnce({ existing: true, id: "existing1" });
    await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F-085 part 1: Mine / Unassigned and the Technician (spec §8).
// ---------------------------------------------------------------------------
const U = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const STAFF: Access = { userId: "user_1", isAgency: false, role: "staff" };
const TECH: Access = { userId: "user_1", isAgency: false, role: "technician" };
const UNSETTLED: Access = { userId: "user_1", isAgency: false, role: null };

describe("createContactAction: a hand-added customer belongs to its author (spec §8)", () => {
  beforeEach(() => {
    dbForRequest.mockResolvedValue(REQUEST);
    dbMocks.readPersonId.mockReset().mockResolvedValue("p-me");
    dbMocks.flagMatchesOf.mockReset().mockResolvedValue(0);
    dbMocks.createContact.mockReset().mockResolvedValue({ existing: false, id: "new1", flagged: false });
  });

  it("Staff: assigned to the caller's own users row, flags on the request client, no service sweep (mutation: drop assignedTo -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    const r = await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(r).toEqual({ kind: "created" });
    expect(dbMocks.readPersonId).toHaveBeenCalledWith(REQUEST, "a1", "user_1");
    expect(dbMocks.createContact).toHaveBeenCalledWith(
      REQUEST, "a1", expect.objectContaining({ firstName: "Jo", assignedTo: "p-me" }), "user_1", "user", REQUEST,
    );
    expect(dbMocks.flagMatchesOf).not.toHaveBeenCalled();
  });

  it("a Technician: the flag writer is the service client, then the hidden matches are flagged on it (mutation: flagDb = db -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    const r = await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(r).toEqual({ kind: "created" });
    expect(dbMocks.createContact).toHaveBeenCalledWith(
      REQUEST, "a1", expect.objectContaining({ assignedTo: "p-me" }), "user_1", "user", SERVICE,
    );
    expect(dbMocks.flagMatchesOf).toHaveBeenCalledWith(SERVICE, "a1", "new1");
  });

  it("a Technician whose add matched an existing customer: no sweep, nothing new was made (mutation: sweep on existing -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.createContact.mockResolvedValueOnce({ existing: true, id: "old1", flagged: false });
    const r = await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(r).toEqual({ kind: "existing", contactId: "old1" });
    expect(dbMocks.flagMatchesOf).not.toHaveBeenCalled();
  });

  it("a failed sweep is logged and the customer still reads as created (mutation: let it throw -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.flagMatchesOf.mockRejectedValueOnce(new Error("flag write failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(r).toEqual({ kind: "created" });
    expect(spy.mock.calls.flat().join(" ")).toContain("flag write failed");
    spy.mockRestore();
  });

  // Fix round 1 (C1): since 0067 the agency's staff can have a users row
  // (the theme toggle), but never a membership in a client's company, so the
  // account-scoped read answers null and the customer lands Unassigned.
  it("the agency: the person read is scoped to THIS account, so its users row does not make the customer its own (mutation: readPersonId without the account -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue({ userId: "user_agency", isAgency: true, role: null });
    dbMocks.readPersonId.mockImplementation(async (...a: unknown[]) =>
      // What the database answers: a users row exists, a membership in a1 does not.
      (a.length === 3 && a[1] === "a1" ? null : "p-agency"));
    await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(dbMocks.readPersonId).toHaveBeenCalledWith(REQUEST, "a1", "user_agency");
    expect(dbMocks.createContact.mock.calls[0]![2]).toMatchObject({ assignedTo: null });
    expect(dbMocks.createContact.mock.calls[0]![5]).toBe(REQUEST);
  });

  it("a client whose role could not be settled takes the Technician's narrow path (fails closed)", async () => {
    requireAccountAccess.mockResolvedValue(UNSETTLED);
    await createContactAction("a1", addForm({ firstName: "Jo" }));
    expect(dbMocks.createContact.mock.calls[0]![5]).toBe(SERVICE);
    expect(dbMocks.flagMatchesOf).toHaveBeenCalledWith(SERVICE, "a1", "new1");
  });
});

describe("assignContactsAction (spec §8, A2, M4)", () => {
  beforeEach(() => {
    dbForRequest.mockResolvedValue(REQUEST);
    dbMocks.assignContacts.mockReset();
    revalidatePath.mockClear();
  });

  it("a Technician is refused and nothing is written (mutation: drop the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    expect(await assignContactsAction("a1", [U(1)], U(9))).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.assignContacts).not.toHaveBeenCalled();
  });

  it("a client whose role could not be settled is refused too (fails closed; mutation: refuse only role technician -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(UNSETTLED);
    expect(await assignContactsAction("a1", [U(1)], U(9))).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.assignContacts).not.toHaveBeenCalled();
  });

  it("Staff: assigns through the request client as the caller and hands back exactly what changed", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    const previous = [{ contactId: U(1), assignee: null, target: U(9), movedTaskIds: [U(5)] }];
    dbMocks.assignContacts.mockResolvedValueOnce(previous);
    expect(await assignContactsAction("a1", [U(1), U(2)], U(9))).toEqual({ ok: true, previous });
    expect(dbMocks.assignContacts).toHaveBeenCalledWith(REQUEST, "a1", [U(1), U(2)], U(9), "user_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  it("Unassigned (null) is a target like any other", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.assignContacts.mockResolvedValueOnce([]);
    expect(await assignContactsAction("a1", [U(1)], null)).toEqual({ ok: true, previous: [] });
    expect(dbMocks.assignContacts).toHaveBeenCalledWith(REQUEST, "a1", [U(1)], null, "user_1");
  });

  it.each([
    ["more than 500 ids", Array.from({ length: 501 }, (_, i) => U(i)), U(9)],
    ["no ids", [], U(9)],
    ["a non-UUID id", [U(1), "not-a-uuid"], U(9)],
    ["a non-UUID assignee", [U(1)], "someone"],
    ["a non-array", "x", U(9)],
  ] as const)("%s -> assign.failed with no write", async (_name, ids, target) => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await assignContactsAction("a1", ids as unknown as string[], target)).toEqual({ ok: false, error: "assign.failed" });
    expect(dbMocks.assignContacts).not.toHaveBeenCalled();
  });

  it("exactly 500 ids is allowed (the bound is inclusive)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.assignContacts.mockResolvedValueOnce([]);
    const ids = Array.from({ length: 500 }, (_, i) => U(i));
    expect(await assignContactsAction("a1", ids, U(9))).toEqual({ ok: true, previous: [] });
  });

  it.each([
    ["an RLS refusal (42501)", Object.assign(new Error("assignContacts failed: new row violates row-level security policy for table contacts"), { code: "42501" }), "assign.refused"],
    ["the same words with no code (fix round 1, m1: never the wording)", new Error("assignContacts failed: new row violates row-level security policy for table contacts"), "assign.failed"],
    ["a 42501 code", Object.assign(new Error("permission denied"), { code: "42501" }), "assign.refused"],
    ["anything else", new Error("assignment: the assignee is not a member of this account"), "assign.failed"],
  ] as const)("%s maps to its AssignError, logged (mutation: map everything to failed -> FAILS)", async (_name, err, expected) => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.assignContacts.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await assignContactsAction("a1", [U(1)], U(9))).toEqual({ ok: false, error: expected });
    expect(spy.mock.calls.flat().join(" ")).toContain("assignContactsAction: account a1:");
    spy.mockRestore();
  });

  it("logs through loggableError: an email in the message never reaches the log", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.assignContacts.mockRejectedValueOnce(new Error("boom for ana@example.com"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await assignContactsAction("a1", [U(1)], U(9));
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("[email]");
    expect(logged).not.toContain("ana@example.com");
    spy.mockRestore();
  });
});

describe("undoAssignContactsAction (CORRECTED 2026-10-11: exact undo, never regrouped)", () => {
  const previous = [
    { contactId: U(1), assignee: null, target: U(9), movedTaskIds: [U(5), U(6)] },
    { contactId: U(2), assignee: U(8), target: U(9), movedTaskIds: [] },
    { contactId: U(3), assignee: U(8), target: U(9), movedTaskIds: [U(7)] },
  ];
  beforeEach(() => {
    dbForRequest.mockResolvedValue(REQUEST);
    dbMocks.assignContacts.mockReset();
    dbMocks.undoAssignContacts.mockReset().mockResolvedValue({ restored: 3 });
    revalidatePath.mockClear();
  });

  // Final re-review: like the task Undo, an Undo that put back NOTHING (every
  // customer was handed on by someone since) says so; a partial put-back is ok.
  it("nothing put back -> assign.changed, and nothing revalidated (mutation: ignore the count -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.undoAssignContacts.mockResolvedValueOnce({ restored: 0 });
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: false, error: "assign.changed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("some put back is still ok (mutation: changed unless every entry came back -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.undoAssignContacts.mockResolvedValueOnce({ restored: 1 });
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: true });
  });

  it("a Technician is refused and nothing is written", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.undoAssignContacts).not.toHaveBeenCalled();
  });

  it("a client whose role could not be settled is refused too", async () => {
    requireAccountAccess.mockResolvedValue(UNSETTLED);
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: false, error: "assign.refused" });
    expect(dbMocks.undoAssignContacts).not.toHaveBeenCalled();
  });

  it("Staff: ONE undoAssignContacts call with the whole list, target and moved tasks included, and never assignContacts (mutation: regroup by assignee into assignContacts -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: true });
    expect(dbMocks.undoAssignContacts).toHaveBeenCalledTimes(1);
    expect(dbMocks.undoAssignContacts).toHaveBeenCalledWith(REQUEST, "a1", previous, "user_1");
    expect(dbMocks.assignContacts).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
  });

  const bad = (patch: Record<string, unknown>) => [{ ...previous[0]!, ...patch }];
  it.each([
    ["a non-array", "x"],
    ["an empty list", []],
    ["more than 500 entries", Array.from({ length: 501 }, (_, i) => ({ ...previous[1]!, contactId: U(i) }))],
    ["a null entry", [null]],
    ["a non-UUID contactId", bad({ contactId: "c1" })],
    ["a missing contactId", bad({ contactId: undefined })],
    ["a non-UUID assignee", bad({ assignee: "someone" })],
    ["a missing assignee", bad({ assignee: undefined })],
    ["a non-UUID target", bad({ target: 7 })],
    ["a missing target", bad({ target: undefined })],
    ["movedTaskIds not an array", bad({ movedTaskIds: U(5) })],
    ["a non-UUID moved task id", bad({ movedTaskIds: [U(5), "t2"] })],
    // Fix round 1 (m2): 500 entries x thousands of ids passed before.
    ["more than 5000 moved task ids in total",
      [0, 1].map((e) => ({ ...previous[0]!, contactId: U(e), movedTaskIds: Array.from({ length: 2501 }, (_, i) => U(e * 10000 + i)) }))],
  ] as const)("%s from the browser -> assign.failed with no write", async (_name, value) => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await undoAssignContactsAction("a1", value as never)).toEqual({ ok: false, error: "assign.failed" });
    expect(dbMocks.undoAssignContacts).not.toHaveBeenCalled();
  });

  it("exactly 5000 moved task ids in total is allowed (the cap is inclusive)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    const atCap = [0, 1].map((e) => ({ ...previous[0]!, contactId: U(e), movedTaskIds: Array.from({ length: 2500 }, (_, i) => U(e * 10000 + i)) }));
    expect(await undoAssignContactsAction("a1", atCap)).toEqual({ ok: true });
  });

  it.each([
    ["a not-a-member refusal", new Error("assignment: the assignee is not a member of this account"), "assign.failed"],
    ["an RLS refusal (42501)", Object.assign(new Error("undoAssignContacts failed: new row violates row-level security policy"), { code: "42501" }), "assign.refused"],
    ["the same words with no code (fix round 1, m1: never the wording)", new Error("undoAssignContacts failed: new row violates row-level security policy"), "assign.failed"],
    ["a 42501 code", Object.assign(new Error("denied"), { code: "42501" }), "assign.refused"],
  ] as const)("%s maps to its AssignError", async (_name, err, expected) => {
    requireAccountAccess.mockResolvedValue(STAFF);
    dbMocks.undoAssignContacts.mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await undoAssignContactsAction("a1", previous)).toEqual({ ok: false, error: expected });
    expect(spy.mock.calls.flat().join(" ")).toContain("undoAssignContactsAction: account a1:");
    spy.mockRestore();
  });
});

describe("setContactBusinessAction", () => {
  it("refuses a contact the request client cannot see, before any service write (mutation: drop the getContact proof -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(null);
    const r = await setContactBusinessAction("a1", "c9", "Acme");
    expect(r.ok).toBe(false);
    expect(dbMocks.setContactsBusiness).not.toHaveBeenCalled();
  });
  it("returns the server's own undo payload and the spelling it stored, read back after the write (I3: linking an existing business keeps ITS spelling; mutation: shown = the typed name -> FAILS)", async () => {
    const removed = { id: "m1", account_id: "a1", client_group_id: "g1", contact_id: "c1", role: null, is_primary: true, is_billing: false, created_at: "2026-01-01" };
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", company_name: "Old Co" })
      .mockResolvedValueOnce({ id: "c1", company_name: "Beta Roofing" });
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "ok", added: "m2", removed }]);
    expect(await setContactBusinessAction("a1", "c1", "beta roofing")).toEqual({ ok: true, shown: "Beta Roofing", undoPayload: { added: "m2", removed } });
  });
  it("an unchanged name returns no undo, and the spelling already stored (I3; mutation: shown = the typed name -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", company_name: "Beta" });
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "unchanged", added: null, removed: null }]);
    expect(await setContactBusinessAction("a1", "c1", "  beta ")).toEqual({ ok: true, shown: "Beta" });
  });
  it("a read-back that fails after the write committed still reports the save, showing the typed name", async () => {
    dbMocks.getContact.mockResolvedValueOnce({ id: "c1", company_name: null }).mockRejectedValueOnce(new Error("read failed"));
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "ok", added: "m2", removed: null }]);
    expect(await setContactBusinessAction("a1", "c1", "Beta")).toEqual({ ok: true, shown: "Beta", undoPayload: { added: "m2", removed: null } });
  });
  it("a read-back that finds no row after the write committed shows the typed name, never a blank (mutation: shown = after?.company_name ?? \"\" -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValueOnce({ id: "c1", company_name: null }).mockResolvedValueOnce(null);
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "ok", added: "m2", removed: null }]);
    expect(await setContactBusinessAction("a1", "c1", "Beta")).toEqual({ ok: true, shown: "Beta", undoPayload: { added: "m2", removed: null } });
  });
  it("refuses a name over 120 characters with plain words", async () => {
    const r = await setContactBusinessAction("a1", "c1", "x".repeat(121));
    expect(r).toEqual({ ok: false, error: m["contact.business.tooLong"] });
  });
  it("counts the 120 limit in characters as the database does, not UTF-16 units (M1; mutation: name.length -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", company_name: null });
    dbMocks.setContactsBusiness.mockResolvedValue([{ contactId: "c1", status: "ok", added: "m2", removed: null }]);
    expect((await setContactBusinessAction("a1", "c1", "🏠".repeat(120))).ok).toBe(true);
    expect(dbMocks.setContactsBusiness).toHaveBeenCalledTimes(1);
    expect(await setContactBusinessAction("a1", "c1", "🏠".repeat(121))).toEqual({ ok: false, error: m["contact.business.tooLong"] });
  });
  it("undo refuses a snapshot for another contact before any write", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    const bad = { added: null, removed: { contact_id: "c2" } } as never;
    expect((await undoContactBusinessAction("a1", "c1", bad)).ok).toBe(false);
    expect(dbMocks.undoSetBusiness).not.toHaveBeenCalled();
  });
  const ADDED = "00000000-0000-4000-8000-000000000002";
  it("undo hands the server exactly its own payload (the control for the refusal below)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.undoSetBusiness.mockResolvedValue("ok");
    expect(await undoContactBusinessAction("a1", "c1", { added: ADDED, removed: null })).toEqual({ ok: true });
    expect(dbMocks.undoSetBusiness).toHaveBeenCalledWith(SERVICE, "a1", "c1", ADDED, null);
  });
  // Final review I-B: undo_set_business now answers not_found for a snapshot naming a household or
  // another account's group (a forged Undo). The action must say the Undo failed, and refresh nothing.
  it("undo surfaces the database's refusal of a forged snapshot as a failed Undo, revalidating nothing (mutation: ignore undoSetBusiness's answer -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.undoSetBusiness.mockResolvedValue("not_found");
    const forged = { id: ADDED, account_id: "a1", client_group_id: "g-household", contact_id: "c1", role: null, is_primary: false, is_billing: false, is_primary_contact: false, created_at: "2026-01-01" };
    expect(await undoContactBusinessAction("a1", "c1", { added: null, removed: forged })).toEqual({ ok: false, error: "Undo failed — please try again." });
    expect(dbMocks.undoSetBusiness).toHaveBeenCalledWith(SERVICE, "a1", "c1", null, forged);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("undo refuses a contact the request client cannot see, before any service write (I1; mutation: drop the undo's getContact proof -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(null);
    dbMocks.undoSetBusiness.mockResolvedValue("ok");
    expect((await undoContactBusinessAction("a1", "c9", { added: ADDED, removed: null })).ok).toBe(false);
    expect(dbMocks.undoSetBusiness).not.toHaveBeenCalled();
  });
});

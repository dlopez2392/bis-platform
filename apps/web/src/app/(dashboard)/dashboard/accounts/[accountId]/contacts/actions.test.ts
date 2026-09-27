import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAccountAccess = vi.fn<(accountId: string) => Promise<{ userId: string; isAgency: boolean }>>(async () => ({ userId: "user_1", isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: (accountId: string) => requireAccountAccess(accountId),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const dbMocks = {
  updateContact: vi.fn(), deleteContacts: vi.fn(),
  addTagToContacts: vi.fn(), removeTagFromContacts: vi.fn(),
  // …plus whatever contacts/actions.ts already imports from @bis/db —
  // createContact, addTagToContact, etc. — stub them all or the module
  // import throws. Read the file's import list and cover it.
  createContact: vi.fn(),
  setMarketingEmailOptOut: vi.fn(),
  getContact: vi.fn(), setContactPhoneCountry: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const {
  updateContactFieldAction, bulkDeleteContactsAction, bulkAddTagAction, bulkRemoveTagAction,
  setMarketingEmailOptOutAction, setPhoneCountryAction, undoPhoneCountryAction,
  undoInlinePhoneEditAction,
} = await import("./actions");
const { m } = await import("@/lib/messages");

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_1", isAgency: true });
});

describe("updateContactFieldAction", () => {
  it("rejects a non-allowlisted field WITHOUT touching the db", async () => {
    const r = await updateContactFieldAction("a1", "c1", "custom" as never, "x");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
  });
  it("maps snake_case field to the ContactInput camel key, empty clears", async () => {
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "company_name", "  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).toHaveBeenCalledWith(
      {}, "a1", "c1", { companyName: "" }, "user_1",
    );
    expect(dbMocks.getContact).not.toHaveBeenCalled();
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

  it("a first fill from empty (no prior real number) answers no `undo`: nothing to restore through the dedicated path", async () => {
    dbMocks.getContact
      .mockResolvedValueOnce({ id: "c1", phone: null, phone_country_unconfirmed: false })
      .mockResolvedValueOnce({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "phone", "(956) 292-1696");
    expect(r).toEqual({ ok: true });
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
});

describe("bulkAddTagAction", () => {
  it("returns ok:true and spreads the tagId/applied from addTagToContacts", async () => {
    dbMocks.addTagToContacts.mockResolvedValue({ tagId: "t9", applied: 2 });
    const r = await bulkAddTagAction("a1", ["c1", "c2"], "urgent");
    expect(r).toEqual({ ok: true, tagId: "t9", applied: 2 });
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
 * The "No marketing emails" switch's server action. The db function
 * (setMarketingEmailOptOut, packages/db) is what scopes the write to the
 * account and THROWS when no row matched — another account's contact, or one
 * deleted meanwhile — so "refuses another account's contact" here is: that
 * throw becomes a reported failure, and nothing is revalidated as if it saved.
 */
describe("setMarketingEmailOptOutAction", () => {
  it("stamps the opt-out: passes the account, the contact, `true` and the signed-in user to the db", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    const r = await setMarketingEmailOptOutAction("a1", "c1", true);
    expect(r).toEqual({ ok: true });
    // The actor is `requireAccountAccess`'s userId (the mock above returns
    // "user_1"): the db function records WHO in the audit event it emits.
    expect(dbMocks.setMarketingEmailOptOut).toHaveBeenCalledWith({}, "a1", "c1", true, "user_1");
  });
  it("clears the opt-out: passes `false` through, not a truthy stand-in", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    const r = await setMarketingEmailOptOutAction("a1", "c1", false);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setMarketingEmailOptOut).toHaveBeenCalledWith({}, "a1", "c1", false, "user_1");
  });
  it("revalidates the list (the drawer's rows) and the full contact page after a save", async () => {
    dbMocks.setMarketingEmailOptOut.mockResolvedValue(undefined);
    await setMarketingEmailOptOutAction("a1", "c1", true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });
  it("refuses a contact of another account: the db's no-row throw is ok:false, nothing revalidated", async () => {
    dbMocks.setMarketingEmailOptOut.mockRejectedValue(
      new Error("setMarketingEmailOptOut: no contact c9 on account a1"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await setMarketingEmailOptOutAction("a1", "c9", true);
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
    errors.mockRestore();
  });
  it("logs a failed save with the account and contact ids and the db's own message", async () => {
    // The operator sees only "Couldn't save that"; the log is the one trace
    // of WHICH contact on WHICH account refused, and why.
    dbMocks.setMarketingEmailOptOut.mockRejectedValue(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await setMarketingEmailOptOutAction("a1", "c7", false);
    expect(r.ok).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    const line = errors.mock.calls[0]!.map(String).join(" ");
    expect(line).toContain("a1");
    expect(line).toContain("c7");
    expect(line).toContain("db down");
    errors.mockRestore();
  });
  it("rejects a value that is not a real boolean WITHOUT touching the db", async () => {
    // A server action's arguments arrive off the wire; the string "false" is
    // truthy and would STAMP the opt-out if it reached the db as-is.
    const r = await setMarketingEmailOptOutAction("a1", "c1", "false" as never);
    expect(r.ok).toBe(false);
    expect(dbMocks.setMarketingEmailOptOut).not.toHaveBeenCalled();
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

  it("a number that is not ten national digits is 'unreadable', never guessed", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1", phone: "+44 20 7946 0958", phone_country_unconfirmed: true });
    expect(await setPhoneCountryAction("a1", "c1", "MX", "+44 20 7946 0958")).toEqual({ ok: false, error: m["contact.phoneCountry.unreadable"] });
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

  it("a crafted priorPhone: null is refused, never written (mutation: drop the typeof priorPhone check → FAILS)", async () => {
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: "+14155551234", priorPhone: null as never, priorUnconfirmed: true,
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

  it("a non-string editedPhone is refused, never written", async () => {
    const r = await undoInlinePhoneEditAction("a1", "c1", {
      editedPhone: null as never, priorPhone: "+19565550100", priorUnconfirmed: true,
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
});

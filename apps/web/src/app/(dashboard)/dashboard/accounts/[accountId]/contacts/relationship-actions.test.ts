import { describe, it, expect, vi, beforeEach } from "vitest";
import { m } from "@/lib/messages";

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
const addContactByHand = vi.fn();
vi.mock("@/lib/contacts/add-contact-by-hand", () => ({ addContactByHand: (...a: unknown[]) => addContactByHand(...a) }));
const dbMocks = {
  getContact: vi.fn(), listContacts: vi.fn(), getRelationship: vi.fn(), addRelationship: vi.fn(),
  setRelationshipSides: vi.fn(), removeRelationship: vi.fn(), restoreRelationship: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const {
  addRelationshipAction, setRelationshipAction, undoSetRelationshipAction, removeRelationshipAction,
  undoRemoveRelationshipAction, searchRelatableContactsAction,
} = await import("./relationship-actions");

const A = "44444444-4444-4444-8444-444444444444";
const S = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
/** Has hex letters, so its upper- and lowercase forms differ (the digit-only ids above do not). */
const LETTERED = "abcdef12-1111-4111-8111-11111111111a";
const OWNER: Access = { userId: "user_1", isAgency: false, role: "owner", canManage: true };
const TECH: Access = { userId: "user_t", isAgency: false, role: "technician", canManage: false };
const UNSETTLED: Access = { userId: "user_u", isAgency: false, role: null, canManage: false };
const contact = (id: string, first: string) => ({ id, first_name: first, last_name: "Ramírez" });
const ROW = {
  id: R, account_id: A, contact_id: O, related_contact_id: S, label_key: "parent", custom_label: null,
  contact_form: "f", related_form: null, contact_can_pick_up: false, contact_is_emergency: false,
  related_can_pick_up: false, related_is_emergency: false, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};
const ADD = { subjectId: S, other: { kind: "existing", contactId: O }, labelKey: "parent", side: "a", customLabel: null, otherForm: "f", subjectForm: null };
/** A Technician who holds the record's customer (S) but not the other person (O). */
const onlySubjectVisible = async (_db: unknown, _a: string, id: string) => (id === S ? contact(S, "Sofía") : null);

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockResolvedValue(OWNER);
  dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === S ? contact(S, "Sofía") : id === O ? contact(O, "Ana") : null));
  dbMocks.addRelationship.mockResolvedValue(ROW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addRelationshipAction", () => {
  it("refuses a malformed add without touching the database", async () => {
    expect(await addRelationshipAction(A, { ...ADD, labelKey: "cousin" })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });
  it("refuses oneself", async () => {
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "existing", contactId: S } })).toEqual({ ok: false, error: "relationships.error.self" });
  });
  it("refuses oneself when the same id comes back in another case (mutation: compare ids case-sensitively -> FAILS)", async () => {
    // An id with hex LETTERS: S is all digits, so S.toUpperCase() === S and could not tell cases apart.
    dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id.toLowerCase() === LETTERED ? contact(LETTERED, "Sofía") : null));
    addContactByHand.mockResolvedValue({ id: LETTERED.toUpperCase(), existing: true });
    expect(await addRelationshipAction(A, { ...ADD, subjectId: LETTERED, other: { kind: "new", firstName: "Sofía", lastName: "", phone: "" } }))
      .toEqual({ ok: false, error: "relationships.error.self" });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("refuses when the record is not the caller's to see, before any write (mutation: skip the subject read -> FAILS)", async () => {
    // Only the record's own customer is hidden: an all-null read would let the OTHER person's
    // check refuse too, and the probe could not fail.
    dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === O ? contact(O, "Ana") : null));
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("a Technician cannot relate a person who is not theirs: both people must be visible (mutation: skip the other read -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("writes on the request client with the other person on side a, and answers the subject's view (mutation: swap the sides -> FAILS)", async () => {
    const r = await addRelationshipAction(A, ADD);
    expect(dbMocks.addRelationship).toHaveBeenCalledWith(REQUEST, A, expect.objectContaining({
      contactId: O, relatedContactId: S, labelKey: "parent", contactForm: "f", relatedForm: null }), "user_1");
    expect(r).toEqual({ ok: true, view: expect.objectContaining({ id: R, namedSide: "a", person: { id: O, firstName: "Ana", lastName: "Ramírez" } }) });
  });
  it("a new person goes through the shared hand-add helper with the caller's access, then is related (spec R4)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    const r = await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" } });
    expect(addContactByHand).toHaveBeenCalledWith(OWNER, REQUEST, A, { firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${A}/contacts`);
    expect(r.ok).toBe(true);
  });
  it("a Technician's new person is made with the Technician's own access, so the helper takes its narrow path", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "", phone: "" } });
    expect(addContactByHand).toHaveBeenCalledWith(TECH, REQUEST, A, { firstName: "Ana", lastName: undefined, phone: undefined });
  });
  it("a new person's phone that is not a phone is refused before anyone is created", async () => {
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "", phone: "call me" } }))
      .toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(addContactByHand).not.toHaveBeenCalled();
  });
  it("maps database refusals to copy, by code (mutation: map every error to failed -> FAILS)", async () => {
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "23505" });
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.duplicate" });
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "42501" });
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.refused" });
  });
  it("logs every refusal the database was not expected to raise, a 23514 included, but not a duplicate or a refusal (final review item 6; mutation: log only what maps to 'failed' -> FAILS)", async () => {
    const log = vi.mocked(console.error);
    for (const code of ["23505", "42501"]) {
      dbMocks.addRelationship.mockRejectedValueOnce({ code });
      await addRelationshipAction(A, ADD);
    }
    expect(log).not.toHaveBeenCalled();
    // 23514 still reads "Pick someone else." to the person, but a CHECK the app should have caught
    // first means the app and 0070 disagree: that must reach the log.
    for (const code of ["23514", "23503", "22P02"]) {
      dbMocks.addRelationship.mockRejectedValueOnce({ code });
      await addRelationshipAction(A, ADD);
    }
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("code=23514"), expect.stringContaining("code=23503"), expect.stringContaining("code=22P02"),
    ]);
    expect(String(log.mock.calls[0]![0])).toContain("addRelationshipAction");
  });
  it("an uppercase subjectId still finds the record and answers its view (Task 4 review, finding 2; mutation: drop the subjectId .toLowerCase() -> FAILS)", async () => {
    dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === LETTERED ? contact(LETTERED, "Sofía") : id === O ? contact(O, "Ana") : null));
    dbMocks.addRelationship.mockResolvedValue({ ...ROW, related_contact_id: LETTERED });
    const r = await addRelationshipAction(A, { ...ADD, subjectId: LETTERED.toUpperCase() });
    expect(r).toEqual({ ok: true, view: expect.objectContaining({ id: R, namedSide: "a", person: { id: O, firstName: "Ana", lastName: "Ramírez" } }) });
  });
  it("an uppercase other.contactId is written lowercase, as PostgREST will echo it (Task 4 review, finding 2; mutation: drop the other id's .toLowerCase() -> FAILS)", async () => {
    dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === S ? contact(S, "Sofía") : id === LETTERED ? contact(LETTERED, "Ana") : null));
    dbMocks.addRelationship.mockResolvedValue({ ...ROW, contact_id: LETTERED });
    const r = await addRelationshipAction(A, { ...ADD, other: { kind: "existing", contactId: LETTERED.toUpperCase() } });
    expect(dbMocks.addRelationship).toHaveBeenCalledWith(REQUEST, A, expect.objectContaining({ contactId: LETTERED, relatedContactId: S }), "user_1");
    expect(r.ok).toBe(true);
  });
  it("an existing other person who is the record's own customer in another case is oneself (mutation: drop the other id's .toLowerCase() -> FAILS)", async () => {
    dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === LETTERED ? contact(LETTERED, "Sofía") : null));
    expect(await addRelationshipAction(A, { ...ADD, subjectId: LETTERED, other: { kind: "existing", contactId: LETTERED.toUpperCase() } }))
      .toEqual({ ok: false, error: "relationships.error.self" });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("a new person who was created before the relationship failed comes back with the error, so a retry relates them instead of creating them twice (Task 4 review, finding 3; mutation: return the bare refusal -> FAILS)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "23505" });
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "" } }))
      .toEqual({ ok: false, error: "relationships.error.duplicate", contactId: O, created: true });
  });
  it("a new person who is saved but not readable on the caller's own client comes back refused WITH their id (final review item 5; mutation: return the bare refusal at the other-person read -> FAILS)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "" } }))
      .toEqual({ ok: false, error: "relationships.error.refused", contactId: O, created: true });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("a new person whose write came back with no view of this record comes back failed WITH their id (final review item 5; mutation: return the bare failure after the view read -> FAILS)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    // viewOf answers null only for a row that is not about the record (a hidden person is a view
    // with person: null): the write came back naming someone else.
    dbMocks.addRelationship.mockResolvedValueOnce({ ...ROW, related_contact_id: "55555555-5555-4555-8555-555555555555" });
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "" } }))
      .toEqual({ ok: false, error: "relationships.error.failed", contactId: O, created: true });
    expect(dbMocks.addRelationship).toHaveBeenCalledTimes(1);
  });
  it("a new person who matched someone already saved comes back with their id but NOT as created, so the dialog never says it saved them (final review item 7; mutation: report created for a match -> FAILS)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: true });
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "23505" });
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" } }))
      .toEqual({ ok: false, error: "relationships.error.duplicate", contactId: O, created: false });
  });
  it("a new person who turns out to be the record's own customer comes back as oneself, with no id to retry with", async () => {
    addContactByHand.mockResolvedValue({ id: S, existing: true });
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Sofía", lastName: "", phone: "" } }))
      .toEqual({ ok: false, error: "relationships.error.self" });
  });
  it("never pre-checks a pair: the reverse of a support label goes to the database, which decides (R7)", async () => {
    const reverse = { ...ADD, labelKey: "emergency_contact", side: "a", otherForm: null };
    await addRelationshipAction(A, reverse);
    expect(dbMocks.addRelationship).toHaveBeenCalledTimes(1);
    expect(dbMocks.getRelationship).not.toHaveBeenCalled();
  });
});

describe("setRelationshipAction and its Undo", () => {
  beforeEach(() => dbMocks.getRelationship.mockResolvedValue(ROW));
  it("writes the named person's side and returns what it was for Undo (mutation: write the subject's side -> FAILS)", async () => {
    dbMocks.setRelationshipSides.mockResolvedValue({ previous: { contact_can_pick_up: false }, row: { ...ROW, contact_can_pick_up: true } });
    const r = await setRelationshipAction(A, S, R, { canPickUp: true });
    expect(dbMocks.setRelationshipSides).toHaveBeenCalledWith(REQUEST, A, R, { contact_can_pick_up: true }, "user_1");
    expect(r).toEqual({ ok: true, undo: { contact_can_pick_up: false }, view: expect.objectContaining({ canPickUp: true }) });
  });
  it("a zero-row write is a refusal; a vanished row is gone", async () => {
    dbMocks.setRelationshipSides.mockResolvedValueOnce("refused");
    expect(await setRelationshipAction(A, S, R, { canPickUp: true })).toEqual({ ok: false, error: "relationships.error.refused" });
    dbMocks.getRelationship.mockResolvedValueOnce(null);
    expect(await setRelationshipAction(A, S, R, { canPickUp: true })).toEqual({ ok: false, error: "relationships.error.gone" });
  });
  it("a Technician with the other person hidden is refused before any write (mutation: drop the both-visible check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await setRelationshipAction(A, S, R, { canPickUp: true })).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
  });
  it("the Undo re-validates the columns the browser sends back (mutation: pass rawPrevious through -> FAILS)", async () => {
    expect(await undoSetRelationshipAction(A, S, R, { label_key: "spouse" })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
  });
  it("the Undo of an edit is refused for a role that could not be settled when a person is hidden, before any write", async () => {
    requireAccountAccess.mockResolvedValue(UNSETTLED);
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await undoSetRelationshipAction(A, S, R, { contact_can_pick_up: false })).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
  });
  it("an uppercase subject still writes the named person's side (Task 4 review, finding 2; mutation: drop the subject's .toLowerCase() -> FAILS)", async () => {
    dbMocks.getRelationship.mockResolvedValue({ ...ROW, related_contact_id: LETTERED });
    dbMocks.setRelationshipSides.mockResolvedValue({ previous: { contact_can_pick_up: false }, row: { ...ROW, related_contact_id: LETTERED, contact_can_pick_up: true } });
    const r = await setRelationshipAction(A, LETTERED.toUpperCase(), R, { canPickUp: true });
    expect(dbMocks.setRelationshipSides).toHaveBeenCalledWith(REQUEST, A, R, { contact_can_pick_up: true }, "user_1");
    expect(r.ok).toBe(true);
  });
  it("the Undo of an edit refuses a record that is not on the row, without a write (Task 4 review, finding 2; mutation: drop the isOn check -> FAILS)", async () => {
    const elsewhere = "55555555-5555-4555-8555-555555555555";
    expect(await undoSetRelationshipAction(A, elsewhere, R, { contact_can_pick_up: false })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
  });
  describe("a flag the label already is cannot be cleared (Task 4 review, finding 1: 0070's emergency and pickup CHECKs)", () => {
    const EMERGENCY = { ...ROW, label_key: "emergency_contact", contact_form: null, contact_is_emergency: true };
    const PICKUP = { ...ROW, label_key: "authorized_pickup", contact_form: null, contact_can_pick_up: true };
    it("an edit that clears the emergency flag on an emergency-contact row is refused before any write (mutation: drop the lockedFlag check -> FAILS)", async () => {
      dbMocks.getRelationship.mockResolvedValue(EMERGENCY);
      expect(await setRelationshipAction(A, S, R, { isEmergency: false })).toEqual({ ok: false, error: "relationships.error.invalid" });
      expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
    });
    it("an edit that clears the pickup flag on an authorized-pickup row is refused before any write", async () => {
      dbMocks.getRelationship.mockResolvedValue(PICKUP);
      expect(await setRelationshipAction(A, S, R, { canPickUp: false })).toEqual({ ok: false, error: "relationships.error.invalid" });
      expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
    });
    it("control: the same flag on the OTHER side of that row is free to change, so the check is the locked side only (mutation: refuse every isEmergency:false -> FAILS)", async () => {
      dbMocks.getRelationship.mockResolvedValue(EMERGENCY);
      dbMocks.setRelationshipSides.mockResolvedValue({ previous: { related_is_emergency: true }, row: EMERGENCY });
      // Seen from O's own record, the named person is S (side b): related_is_emergency, no CHECK.
      expect((await setRelationshipAction(A, O, R, { isEmergency: false })).ok).toBe(true);
      expect(dbMocks.setRelationshipSides).toHaveBeenCalledWith(REQUEST, A, R, { related_is_emergency: false }, "user_1");
    });
    it("an Undo payload that clears the emergency flag on an emergency-contact row is refused before any write (mutation: drop the Undo's label/column check -> FAILS)", async () => {
      dbMocks.getRelationship.mockResolvedValue(EMERGENCY);
      expect(await undoSetRelationshipAction(A, S, R, { contact_is_emergency: false })).toEqual({ ok: false, error: "relationships.error.invalid" });
      expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
    });
    it("an Undo payload that clears the pickup flag on an authorized-pickup row is refused before any write", async () => {
      dbMocks.getRelationship.mockResolvedValue(PICKUP);
      expect(await undoSetRelationshipAction(A, S, R, { contact_can_pick_up: false })).toEqual({ ok: false, error: "relationships.error.invalid" });
      expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
    });
    it("control: an Undo of the unlocked side's flag on that row still runs", async () => {
      dbMocks.getRelationship.mockResolvedValue(EMERGENCY);
      dbMocks.setRelationshipSides.mockResolvedValue({ previous: { related_is_emergency: true }, row: EMERGENCY });
      expect((await undoSetRelationshipAction(A, S, R, { related_is_emergency: false })).ok).toBe(true);
    });
  });
  it("the Undo of an edit restores the named side and answers the view", async () => {
    dbMocks.setRelationshipSides.mockResolvedValue({ previous: { contact_can_pick_up: true }, row: ROW });
    const r = await undoSetRelationshipAction(A, S, R, { contact_can_pick_up: false });
    expect(dbMocks.setRelationshipSides).toHaveBeenCalledWith(REQUEST, A, R, { contact_can_pick_up: false }, "user_1");
    expect(r).toEqual({ ok: true, view: expect.objectContaining({ id: R, canPickUp: false }) });
  });
});

describe("remove and its Undo", () => {
  it("remove hands back the snapshot; a refusal is refused", async () => {
    dbMocks.removeRelationship.mockResolvedValueOnce(ROW);
    expect(await removeRelationshipAction(A, R)).toEqual({ ok: true, snapshot: ROW });
    dbMocks.removeRelationship.mockResolvedValueOnce("refused");
    expect(await removeRelationshipAction(A, R)).toEqual({ ok: false, error: "relationships.error.refused" });
  });
  it("a Technician cannot remove a relationship with a hidden person, before any write", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.getRelationship.mockResolvedValue(ROW);
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await removeRelationshipAction(A, R)).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.removeRelationship).not.toHaveBeenCalled();
  });
  it("the Undo refuses another account's snapshot without a write, restores a good one, and says when the person is gone (mutation: drop the account check -> FAILS)", async () => {
    expect(await undoRemoveRelationshipAction(A, S, { ...ROW, account_id: O })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.restoreRelationship).not.toHaveBeenCalled();
    dbMocks.restoreRelationship.mockResolvedValueOnce(ROW);
    expect((await undoRemoveRelationshipAction(A, S, ROW)).ok).toBe(true);
    expect(dbMocks.restoreRelationship).toHaveBeenCalledWith(REQUEST, A, ROW, "user_1");
    dbMocks.restoreRelationship.mockRejectedValueOnce({ code: "23503" });
    expect(await undoRemoveRelationshipAction(A, S, ROW)).toEqual({ ok: false, error: "relationships.error.restore" });
  });
  it("the Undo refuses a snapshot that is not about the record it is shown on, without a write", async () => {
    const elsewhere = "55555555-5555-4555-8555-555555555555";
    expect(await undoRemoveRelationshipAction(A, elsewhere, ROW)).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.restoreRelationship).not.toHaveBeenCalled();
  });
  it("the Undo refuses a malformed snapshot from the browser (an extra column), without a write", async () => {
    expect(await undoRemoveRelationshipAction(A, S, { ...ROW, assigned_to: "x" })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.restoreRelationship).not.toHaveBeenCalled();
  });
  it("a narrow caller cannot restore a pair they cannot fully see: refused before the write (mutation: drop the both-visible check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(TECH);
    dbMocks.getContact.mockImplementation(onlySubjectVisible);
    expect(await undoRemoveRelationshipAction(A, S, ROW)).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.restoreRelationship).not.toHaveBeenCalled();
  });
  it("the database's own refusal of a restore (42501) reads as refused, not as 'couldn't put it back'", async () => {
    dbMocks.restoreRelationship.mockRejectedValueOnce({ code: "42501" });
    expect(await undoRemoveRelationshipAction(A, S, ROW)).toEqual({ ok: false, error: "relationships.error.refused" });
  });
});

describe("searchRelatableContactsAction", () => {
  it("needs two characters, leaves out the record's own customer, and stops at eight (mutation: drop the subject filter -> FAILS)", async () => {
    expect(await searchRelatableContactsAction(A, S, "a")).toEqual({ ok: true, hits: [] });
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
    dbMocks.listContacts.mockResolvedValue([S, ...Array.from({ length: 9 }, (_, i) => `2222222${i}-2222-4222-8222-222222222222`)]
      .map((id) => ({ id, first_name: "Ana", last_name: null, phone: null })));
    const r = await searchRelatableContactsAction(A, S, "Ana");
    expect(dbMocks.listContacts).toHaveBeenCalledWith(REQUEST, A, { search: "Ana", limit: 9 });
    expect(r.ok && r.hits.map((h) => h.id)).not.toContain(S);
    expect(r.ok && r.hits).toHaveLength(8);
  });
  it("leaves out the record's own customer even when the record's id arrives in another case", async () => {
    dbMocks.listContacts.mockResolvedValue([{ id: LETTERED, first_name: "Sofía", last_name: null, phone: null }]);
    const r = await searchRelatableContactsAction(A, LETTERED.toUpperCase(), "Sof");
    expect(r).toEqual({ ok: true, hits: [] });
  });
});

describe("relationship error copy", () => {
  it("every error the actions can answer has English and Spanish copy (mutation: delete one .es key -> FAILS)", () => {
    const keys = [
      "relationships.error.duplicate", "relationships.error.refused", "relationships.error.self", "relationships.error.gone",
      "relationships.error.restore", "relationships.error.invalid", "relationships.error.failed",
    ] as const;
    const catalogue = m as Record<string, string>;
    for (const k of keys) {
      expect(catalogue[k], k).toEqual(expect.any(String));
      expect(catalogue[`${k}.es`], `${k}.es`).toEqual(expect.any(String));
    }
    expect(catalogue["relationships.error.duplicate"]).toBe("That relationship is already there.");
  });
  it("'gone' reads as natural English and Spanish, not 'That changed since.' (final review item 7; mutation: restore the old line -> FAILS)", () => {
    const catalogue = m as Record<string, string>;
    expect(catalogue["relationships.error.gone"]).toBe("Someone changed or removed this. Reload the page to see it.");
    expect(catalogue["relationships.error.gone.es"]).toBe("Alguien cambió o quitó esto. Vuelva a cargar la página para verlo.");
  });
});

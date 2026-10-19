import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactFieldPayload, Proposal } from "@bis/db/proposal-rules";
import { makeTr } from "@/lib/record/copy";
import type { ApplyCtx, Db, DescribeCtx, EditCtx } from "./types";

const db = vi.hoisted(() => ({ getContact: vi.fn(), fillContactBlanksReport: vi.fn(), updateContact: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { contactFieldKind } from "./contact-field";

const ZONE = "America/Chicago";
const NOW = new Date("2026-10-19T15:00:00Z");
const en = makeTr("en");
const es = makeTr("es");
const dctx = (tr = en): DescribeCtx => ({ tr, zone: ZONE, stages: {}, now: NOW });
const ectx: EditCtx = { zone: ZONE, now: NOW, stages: [], pipelineIdOfDeal: null };
const fakeDb = { tag: "request-client" } as unknown as Db;
const actx: ApplyCtx = { db: fakeDb, accountId: "a1", userId: "user_1", contactId: "c1" };
const phone: ContactFieldPayload = { field: "phone", value: "+528990000000" };
const contact = (over: Record<string, unknown>) =>
  ({ id: "c1", first_name: null, last_name: null, email: null, phone: null, ...over });
const row = (payload: ContactFieldPayload, contactId: string | null = "c1") =>
  ({ kind: "contact_field", payload, accountId: "a1", contactId } as unknown as Proposal & { kind: "contact_field" });
const undo = (ref: unknown, ctx = actx) => {
  if (!("undo" in contactFieldKind.inverse)) throw new Error("irreversible");
  return contactFieldKind.inverse.undo(ctx, ref);
};

beforeEach(() => vi.clearAllMocks());

describe("contact_field: parse and describe", () => {
  it("parses its own payload and refuses the other kinds'", () => {
    expect(contactFieldKind.parse(phone)).toEqual(phone);
    expect(contactFieldKind.parse({ title: "Call", dueAt: null })).toBeNull();
    expect(contactFieldKind.parse({ opportunityId: "o1", fromStageId: "s1", toStageId: "s2" })).toBeNull();
  });

  it("reads the field and the value in the reader's language, with no English-only part", () => {
    expect(contactFieldKind.describe(phone, dctx()))
      .toEqual({ parts: [{ text: "Phone: (empty) → +528990000000" }], detail: null, pastDue: false });
    expect(contactFieldKind.describe(phone, dctx(es)))
      .toEqual({ parts: [{ text: "Teléfono: (vacío) → +528990000000" }], detail: null, pastDue: false });
  });
});

describe("contact_field: validateEdit", () => {
  it("a phone goes through spokenPhone (stored as said once it parses)", () => {
    expect(contactFieldKind.validateEdit(phone, { value: " 899 000 0000 " }, ectx))
      .toEqual({ ok: true, payload: { field: "phone", value: "899 000 0000" } });
  });

  it("refuses a phone that is not a number (spec probe :353)", () => {
    // Mutation: return { ok: true, payload: { ...stored, value: input.value } } -> FAILS.
    expect(contactFieldKind.validateEdit(phone, { value: "abc" }, ectx))
      .toEqual({ ok: false, error: { field: "value", key: "suggestions.edit.phoneInvalid" } });
  });

  it("an email is checked and lowercased; a bad one is refused", () => {
    const email: ContactFieldPayload = { field: "email", value: "x@y.com" };
    expect(contactFieldKind.validateEdit(email, { value: "Sam@Example.com" }, ectx))
      .toEqual({ ok: true, payload: { field: "email", value: "sam@example.com" } });
    expect(contactFieldKind.validateEdit(email, { value: "sam@" }, ectx))
      .toEqual({ ok: false, error: { field: "value", key: "suggestions.edit.emailInvalid" } });
  });

  it("an empty value is refused", () => {
    expect(contactFieldKind.validateEdit({ field: "firstName", value: "Ana" }, { value: "  " }, ectx))
      .toEqual({ ok: false, error: { field: "value", key: "suggestions.edit.valueRequired" } });
  });

  it("the field always comes from the stored payload, whatever the form posted (spec probe :352)", () => {
    // Mutation: read `field` from the input -> field "email", FAILS.
    expect(contactFieldKind.validateEdit(phone, { field: "email", value: "899 000 0000" }, ectx))
      .toEqual({ ok: true, payload: { field: "phone", value: "899 000 0000" } });
  });

  it("normalise: an unchanged edit equals the stored payload", () => {
    const e = contactFieldKind.validateEdit({ field: "email", value: "sam@example.com" }, { value: "SAM@example.com " }, ectx);
    if (!e.ok) throw new Error("refused");
    expect(contactFieldKind.normalise(e.payload)).toEqual(contactFieldKind.normalise({ field: "email", value: "sam@example.com" }));
  });
});

describe("contact_field: stillHolds (fillContactBlanks's own blank rule, placeholder included)", () => {
  it("a field filled since is out of date", async () => {
    db.getContact.mockResolvedValue(contact({ phone: "+15551234567" }));
    expect(await contactFieldKind.stillHolds(fakeDb, row(phone))).toEqual({ ok: false, reason: "field_filled" });
    expect(db.getContact).toHaveBeenCalledWith(fakeDb, "a1", "c1");
  });

  it("a blank field still holds", async () => {
    db.getContact.mockResolvedValue(contact({ phone: "  " }));
    expect(await contactFieldKind.stillHolds(fakeDb, row(phone))).toEqual({ ok: true });
  });

  it("'Caller' with no last name is the placeholder, so a first name is still fillable", async () => {
    // Mutation: drop the placeholder rule -> field_filled, FAILS (spec probe :354, second half).
    db.getContact.mockResolvedValue(contact({ first_name: "Caller", last_name: null }));
    expect(await contactFieldKind.stillHolds(fakeDb, row({ field: "firstName", value: "Ana" }))).toEqual({ ok: true });
  });

  it("'Caller' with a last name is a real name, so it is filled", async () => {
    db.getContact.mockResolvedValue(contact({ first_name: "Caller", last_name: "Lopez" }));
    expect(await contactFieldKind.stillHolds(fakeDb, row({ field: "firstName", value: "Ana" })))
      .toEqual({ ok: false, reason: "field_filled" });
  });

  it("a blank last name beside a real, different first name still holds (the mismatch is told after the fill)", async () => {
    db.getContact.mockResolvedValue(contact({ first_name: "Roberto", last_name: null }));
    expect(await contactFieldKind.stillHolds(fakeDb, row({ field: "lastName", value: "Smith" }))).toEqual({ ok: true });
  });
});

describe("contact_field: apply", () => {
  it("reads before, fills through fillContactBlanksReport, and stores the phone's E.164 as the value", async () => {
    db.getContact.mockResolvedValue(contact({ phone: null }));
    db.fillContactBlanksReport.mockResolvedValue({ fields: ["phone", "phone_country_unconfirmed"], flagged: true });
    const said = { field: "phone" as const, value: "899 000 0000" };
    expect(await contactFieldKind.apply(actx, said))
      .toEqual({ ref: { field: "phone", before: null, value: "+528990000000" }, flagged: true });
    expect(db.fillContactBlanksReport).toHaveBeenCalledWith(fakeDb, "a1", "c1", { phone: "899 000 0000" }, "user_1");
  });

  it("a first name filled over 'Caller' records 'Caller' as before", async () => {
    // Mutation: before: null always -> FAILS.
    db.getContact.mockResolvedValue(contact({ first_name: "Caller" }));
    db.fillContactBlanksReport.mockResolvedValue({ fields: ["first_name"], flagged: false });
    expect(await contactFieldKind.apply(actx, { field: "firstName", value: " Ana " }))
      .toEqual({ ref: { field: "firstName", before: "Caller", value: "Ana" }, flagged: false });
  });

  it("an email's stored form is lowercased", async () => {
    db.getContact.mockResolvedValue(contact({}));
    db.fillContactBlanksReport.mockResolvedValue({ fields: ["email"], flagged: false });
    const applied = await contactFieldKind.apply(actx, { field: "email", value: "Sam@Example.com" });
    expect(applied.ref).toEqual({ field: "email", before: null, value: "sam@example.com" });
  });

  it("a fill that wrote nothing says why: the field was filled, or the name on file does not match", async () => {
    db.fillContactBlanksReport.mockResolvedValue({ fields: [], flagged: false });
    db.getContact.mockResolvedValueOnce(contact({ phone: "+15551234567" }));
    expect((await contactFieldKind.apply(actx, phone)).noWrite).toBe("field_filled");
    db.getContact.mockResolvedValueOnce(contact({ first_name: "Roberto", last_name: null }));
    expect((await contactFieldKind.apply(actx, { field: "lastName", value: "Smith" })).noWrite).toBe("name_mismatch");
  });
});

describe("contact_field: inverse", () => {
  it("restores 'Caller' over a first name the Accept filled (spec probe :361)", async () => {
    // Mutation: restore "" instead of before -> FAILS.
    db.getContact.mockResolvedValue(contact({ first_name: "Ana" }));
    expect(await undo({ field: "firstName", before: "Caller", value: "Ana" })).toBe("undone");
    expect(db.updateContact).toHaveBeenCalledWith(fakeDb, "a1", "c1", { firstName: "Caller" }, "user_1");
  });

  it("restores null, not an empty string, to a name that was null (plan fix M16)", async () => {
    // Mutation: before ?? "" -> FAILS.
    db.getContact.mockResolvedValue(contact({ last_name: "Smith" }));
    expect(await undo({ field: "lastName", before: null, value: "Smith" })).toBe("undone");
    expect(db.updateContact).toHaveBeenCalledWith(fakeDb, "a1", "c1", { lastName: null }, "user_1");
  });

  it("a phone re-saved in another shape but the same number is still as Accept left it", async () => {
    db.getContact.mockResolvedValue(contact({ phone: "(899) 000-0000" }));
    expect(await undo({ field: "phone", before: null, value: "+528990000000" })).toBe("undone");
    expect(db.updateContact).toHaveBeenCalledWith(fakeDb, "a1", "c1", { phone: "" }, "user_1");
  });

  it("a field edited since is left alone", async () => {
    db.getContact.mockResolvedValue(contact({ email: "other@example.com" }));
    expect(await undo({ field: "email", before: null, value: "sam@example.com" })).toBe("changed");
    expect(db.updateContact).not.toHaveBeenCalled();
  });

  it("a row with no applied_ref, or no customer, is never undone", async () => {
    expect(await undo(null)).toBe("changed");
    expect(await undo({ field: "phone", value: 5 })).toBe("changed");
    expect(await undo({ field: "phone", before: null, value: "+528990000000" }, { ...actx, contactId: null })).toBe("changed");
    expect(db.updateContact).not.toHaveBeenCalled();
  });
});

describe("contact_field: toast and target", () => {
  it("targets the customer's field and names it", () => {
    expect(contactFieldKind.targetKey(phone, "c1")).toBe("contact:c1:phone");
    expect(contactFieldKind.toast(phone, en, {})).toBe("Phone saved");
    expect(contactFieldKind.toast(phone, es, {})).toBe("Teléfono guardado");
  });
});

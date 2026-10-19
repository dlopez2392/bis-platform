import { fillContactBlanksReport, getContact, updateContact } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { parseContactFieldPayload, type ContactFieldName, type ContactFieldPayload } from "@bis/db/proposal-rules";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { isValidEmail } from "@/lib/forms/guards";
import { spokenPhone } from "@/lib/voice/phone-number";
import type { Db, KindDef } from "./types";

/** generate.ts's limit on a contact-field value (MAX_TITLE_LEN). The generator clamps; an edit is told. */
const MAX_VALUE_LEN = 200;
const COLUMN: Record<ContactFieldName, "first_name" | "last_name" | "email" | "phone"> = {
  firstName: "first_name", lastName: "last_name", email: "email", phone: "phone",
};
const LABEL: Record<ContactFieldName, MessageKey> = {
  firstName: "suggestions.field.firstName", lastName: "suggestions.field.lastName",
  email: "suggestions.field.email", phone: "suggestions.field.phone",
};
const FIELDS: readonly string[] = Object.keys(COLUMN);

type ContactRow = Record<string, unknown>;
const blank = (v: unknown) => v == null || String(v).trim() === "";

/** fillContactBlanksReport's own blank rule (contacts.ts): null or empty after trim, and for a first
 *  name also our finish-call placeholder, "Caller" with no last name. */
function isBlankOn(row: ContactRow, field: ContactFieldName): boolean {
  if (field === "firstName" && row.first_name === "Caller" && blank(row.last_name)) return true;
  return blank(row[COLUMN[field]]);
}

/** The value as the fill stores it: a phone's E.164 (phoneFields), an email lowercased, a name trimmed. */
function storedForm(field: ContactFieldName, value: string): string {
  const v = value.trim();
  if (field === "phone") return normalisePhone(v)?.e164 ?? v;
  if (field === "email") return v.toLowerCase();
  return v;
}

/** Whether the column still holds what the Accept wrote, read the way the fill stored it. */
function stillAsWritten(field: ContactFieldName, current: unknown, value: string): boolean {
  if (typeof current !== "string") return false;
  return storedForm(field, current) === value;
}

type RefT = { field: ContactFieldName; before: string | null; value: string };
function readRef(ref: unknown): RefT | null {
  if (ref === null || typeof ref !== "object") return null;
  const r = ref as Record<string, unknown>;
  if (typeof r.field !== "string" || !FIELDS.includes(r.field) || typeof r.value !== "string") return null;
  if (r.before !== null && typeof r.before !== "string") return null;
  return { field: r.field as ContactFieldName, before: r.before, value: r.value };
}

async function contactOrThrow(db: Db, accountId: string, contactId: string | null): Promise<ContactRow> {
  if (!contactId) throw new Error("contact_field suggestion without a customer");
  const row = await getContact(db, accountId, contactId);
  if (!row) throw new Error(`contact_field: no contact ${contactId}`);
  return row as ContactRow;
}

const label = (field: ContactFieldName, tr: Tr) => tr.text(LABEL[field]);

export const contactFieldKind: KindDef<"contact_field", ContactFieldPayload> = {
  kind: "contact_field",
  sources: ["call"],
  needsContact: true,
  dataClass: "facts",
  parse: parseContactFieldPayload,

  describe(p, { tr }) {
    return {
      parts: [{ text: tr.text("suggestions.field", { field: label(p.field, tr), value: p.value }) }],
      detail: null, pastDue: false,
    };
  },

  editable: ["value"],

  validateEdit(stored, input) {
    const field = stored.field;
    const value = typeof input.value === "string" ? input.value.trim() : "";
    if (!value) return { ok: false, error: { field: "value", key: "suggestions.edit.valueRequired" } };
    if (value.length > MAX_VALUE_LEN) {
      return { ok: false, error: { field: "value", key: "inline.rule.tooLong", params: { max: MAX_VALUE_LEN } } };
    }
    if (field === "phone") {
      // As the generator stores it: as said, once it parses (generate.ts, review R2-C1).
      const said = spokenPhone(value, null);
      if (!said) return { ok: false, error: { field: "value", key: "suggestions.edit.phoneInvalid" } };
      return { ok: true, payload: { field, value: said } };
    }
    if (field === "email") {
      if (!isValidEmail(value)) return { ok: false, error: { field: "value", key: "suggestions.edit.emailInvalid" } };
      return { ok: true, payload: { field, value: value.toLowerCase() } };
    }
    return { ok: true, payload: { field, value } };
  },

  normalise(p) {
    const v = p.value.trim();
    if (p.field === "phone") return { field: p.field, value: spokenPhone(v, null) ?? v };
    if (p.field === "email") return { field: p.field, value: v.toLowerCase() };
    return { field: p.field, value: v };
  },

  async stillHolds(db, row) {
    const contact = await contactOrThrow(db, row.accountId, row.contactId);
    return isBlankOn(contact, row.payload.field) ? { ok: true } : { ok: false, reason: "field_filled" };
  },

  async apply({ db, accountId, userId, contactId }, p) {
    // `before` is read in the same request, just before the write: what Undo puts back.
    const contact = await contactOrThrow(db, accountId, contactId);
    const raw = contact[COLUMN[p.field]];
    const before = typeof raw === "string" ? raw : null;
    const ref = { field: p.field, before, value: storedForm(p.field, p.value) };
    const report = await fillContactBlanksReport(db, accountId, contactId!, { [p.field]: p.value }, userId);
    if (report.fields.length === 0) {
      // The fill writes nothing for two reasons, and they are told apart (the old action's split): the
      // field was filled already, or a last name would graft onto a different first name on file. Only
      // a last name has the second reason; any other field that read blank was filled in between.
      const mismatch = p.field === "lastName" && isBlankOn(contact, "lastName");
      return { ref, noWrite: mismatch ? "name_mismatch" : "field_filled" };
    }
    return { ref, flagged: report.flagged };
  },

  inverse: {
    async undo({ db, accountId, userId, contactId }, ref) {
      const r = readRef(ref);
      if (!r || !contactId) return "changed";
      const contact = await getContact(db, accountId, contactId);
      if (!contact || !stillAsWritten(r.field, (contact as ContactRow)[COLUMN[r.field]], r.value)) return "changed";
      // A name goes back exactly as it was, null included ("Caller" stays "Caller"); email and phone
      // take a string, and updateContact stores an empty one as null (toRow, phoneFields). The phone's
      // country flag is updateContact's to derive, not restored here.
      const patch = r.field === "firstName" || r.field === "lastName"
        ? { [r.field]: r.before }
        : { [r.field]: r.before ?? "" };
      await updateContact(db, accountId, contactId, patch, userId);
      return "undone";
    },
  },

  toast: (p, tr) => tr.text("suggestions.toast.field", { field: label(p.field, tr) }),
  targetKey: (p, contactId) => (contactId ? `contact:${contactId}:${p.field}` : null),
};

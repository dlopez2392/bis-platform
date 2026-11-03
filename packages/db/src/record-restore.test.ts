import { describe, it, expect } from "vitest";
import { canPutBack, canRestore, parseChangeId, RESTORE_DAYS } from "./record-restore";
import { DOCUMENT_TRASH_DAYS } from "./document-rules";
import type { ChangeRow } from "./record-changes";

/**
 * F-115 Task 6 (plan Task 6 Step 1): the pure decisions behind "Put back" and "Restore" — which
 * change rows offer each, and the 30-day Restore window. No Supabase client anywhere in this file.
 */

const BASE: ChangeRow = {
  id: 1, recordType: "contact", recordId: "11111111-1111-1111-1111-111111111111",
  contactId: "11111111-1111-1111-1111-111111111111", clientGroupId: null,
  op: "update", field: "first_name", before: "Dan", after: "Daniel", xact: "100",
  authorKind: "person", authorId: "user_1", via: null, createdAt: "2026-01-01T00:00:00+00:00",
};
const row = (patch: Partial<ChangeRow>): ChangeRow => ({ ...BASE, ...patch });

describe("RESTORE_DAYS", () => {
  it("is the document trash window, not a second 30", () => {
    expect(RESTORE_DAYS).toBe(DOCUMENT_TRASH_DAYS);
    expect(RESTORE_DAYS).toBe(30);
  });
});

describe("canPutBack", () => {
  it("is true for an audited field update on a contact", () => {
    expect(canPutBack(row({}))).toBe(true);
  });

  it("is true for every audited field across the put-back-eligible types", () => {
    expect(canPutBack(row({ recordType: "client_group", field: "name" }))).toBe(true);
    expect(canPutBack(row({ recordType: "place", field: "archived_at" }))).toBe(true);
    expect(canPutBack(row({ recordType: "place", field: "contact_id" }))).toBe(true);
    expect(canPutBack(row({ recordType: "equipment", field: "warranty_until" }))).toBe(true);
    expect(canPutBack(row({ recordType: "opportunity", field: "stage_id" }))).toBe(true);
    expect(canPutBack(row({ recordType: "contact_relationship", field: "label_key" }))).toBe(true);
  });

  it("is true for a contact's own custom.<key>", () => {
    expect(canPutBack(row({ field: "custom.referral_source" }))).toBe(true);
  });

  it("is false for an opportunity's or client_group's custom.<key> (no compare-and-swap exists for either)", () => {
    expect(canPutBack(row({ recordType: "opportunity", field: "custom.priority" }))).toBe(false);
    expect(canPutBack(row({ recordType: "client_group", field: "custom.flag" }))).toBe(false);
  });

  it("is false for an insert row", () => {
    expect(canPutBack(row({ op: "insert", field: null, before: null, after: { first_name: "Dan" } }))).toBe(false);
  });

  it("is false for a delete row", () => {
    expect(canPutBack(row({ op: "delete", field: null, before: { first_name: "Dan" }, after: null }))).toBe(false);
  });

  it("is false for contact_tag", () => {
    expect(canPutBack(row({ recordType: "contact_tag", recordId: "22222222-2222-2222-2222-222222222222", field: "name" }))).toBe(false);
  });

  it("is false for client_group_member, even on its own audited field", () => {
    expect(canPutBack(row({ recordType: "client_group_member", field: "role" }))).toBe(false);
  });

  it("is false for an EXCLUDED field (a hand-built row claiming an update on a column 0111/0112 never audits)", () => {
    expect(canPutBack(row({ field: "updated_at" }))).toBe(false);
    expect(canPutBack(row({ recordType: "contact", field: "reactivation_sent_at" }))).toBe(false);
  });
});

const deleteRow = (patch: Partial<ChangeRow>): ChangeRow => row({
  recordType: "equipment", op: "delete", field: null, before: { id: "x" }, after: null, ...patch,
});

describe("canRestore", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const dayMs = 24 * 60 * 60 * 1000;

  it("is true at day 29", () => {
    const now = new Date(Date.parse(createdAt) + 29 * dayMs);
    expect(canRestore(deleteRow({ createdAt }), now)).toBe(true);
  });

  it("is false at day 30 plus 1 ms (mutation: compare against 31 days instead of RESTORE_DAYS would make this pass incorrectly)", () => {
    const now = new Date(Date.parse(createdAt) + 30 * dayMs + 1);
    expect(canRestore(deleteRow({ createdAt }), now)).toBe(false);
  });

  it("is true for every restorable type", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    for (const recordType of ["equipment", "client_group_member", "contact_tag", "contact_relationship", "place"] as const) {
      expect(canRestore(deleteRow({ createdAt, recordType }), now)).toBe(true);
    }
  });

  it("is false for contact and opportunity (not restorable types)", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    expect(canRestore(deleteRow({ createdAt, recordType: "contact" }), now)).toBe(false);
    expect(canRestore(deleteRow({ createdAt, recordType: "opportunity" }), now)).toBe(false);
  });

  it("is false for an update row (op must be delete)", () => {
    const now = new Date(Date.parse(createdAt) + dayMs);
    expect(canRestore(row({ createdAt, recordType: "equipment", op: "update", field: "name" }), now)).toBe(false);
  });
});

describe("parseChangeId", () => {
  it("accepts a positive integer", () => {
    expect(parseChangeId(42)).toBe(42);
  });

  it("accepts a digit string", () => {
    expect(parseChangeId("42")).toBe(42);
  });

  it("accepts a 19-digit string within Number's safe range only if it stays safe (large example refused)", () => {
    // 19 nines is far past Number.MAX_SAFE_INTEGER; the digit-length check alone would accept it, so the
    // safe-integer check must still catch it (mutation: drop the safe-integer check -> this FAILS).
    expect(parseChangeId("9999999999999999999")).toBe(null);
  });

  it("refuses a 20-digit string (over the bigint-width cap) even if it happened to parse)", () => {
    expect(parseChangeId("123456789012345678901")).toBe(null);
  });

  it("refuses non-digit strings", () => {
    expect(parseChangeId("42abc")).toBe(null);
    expect(parseChangeId("-1")).toBe(null);
    expect(parseChangeId("4.2")).toBe(null);
    expect(parseChangeId("")).toBe(null);
  });

  it("refuses a non-integer or non-positive number", () => {
    expect(parseChangeId(4.2)).toBe(null);
    expect(parseChangeId(0)).toBe(null);
    expect(parseChangeId(-5)).toBe(null);
  });
});

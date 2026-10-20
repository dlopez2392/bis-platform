import { describe, it, expect } from "vitest";
import { parseAiAct, AI_ACT_KINDS, type NewAiAct } from "../ai-act-rules";

/**
 * Pure model tests (item 8c, plan Task 3): `parseAiAct` reads a raw `ai_acts` row (snake_case, exactly
 * as PostgREST returns it) and answers the typed `AiAct`, kind by kind, or null when any part does not
 * fit. No client, no I/O.
 */
const BASE = {
  id: "11111111-1111-1111-1111-111111111111",
  account_id: "22222222-2222-2222-2222-222222222222",
  contact_id: "33333333-3333-3333-3333-333333333333",
  actor: "voice",
  call_id: "44444444-4444-4444-4444-444444444444",
  chat_id: null,
  undone_at: null,
  undone_by: null,
  undo_notified: false,
  created_at: "2026-10-19T12:00:00Z",
};

describe("parseAiAct", () => {
  it("round-trips booking_created", () => {
    const row = {
      ...BASE, kind: "booking_created",
      target: { bookingId: "55555555-5555-5555-5555-555555555555" }, before: null,
      after: { startsAt: "2026-10-20T15:00:00Z", endsAt: "2026-10-20T16:00:00Z" },
    };
    const act = parseAiAct(row);
    expect(act).not.toBeNull();
    expect(act).toMatchObject({
      id: BASE.id, accountId: BASE.account_id, contactId: BASE.contact_id, actor: "voice",
      callId: BASE.call_id, chatId: null, kind: "booking_created",
      target: { bookingId: "55555555-5555-5555-5555-555555555555" },
      before: null, after: { startsAt: "2026-10-20T15:00:00Z", endsAt: "2026-10-20T16:00:00Z" },
      undoneAt: null, undoneBy: null, undoNotified: false, createdAt: BASE.created_at,
    });
  });

  it("round-trips booking_rescheduled", () => {
    const row = {
      ...BASE, kind: "booking_rescheduled",
      target: { bookingId: "a", fromBookingId: "b" },
      before: { startsAt: "2026-10-18T15:00:00Z", endsAt: "2026-10-18T16:00:00Z", version: "2026-10-18T14:00:00Z" },
      after: { startsAt: "2026-10-20T15:00:00Z", endsAt: "2026-10-20T16:00:00Z" },
    };
    expect(parseAiAct(row)).toMatchObject({ kind: "booking_rescheduled", target: row.target, before: row.before, after: row.after });
  });

  it("round-trips booking_cancelled", () => {
    const row = {
      ...BASE, kind: "booking_cancelled",
      target: { bookingId: "a" },
      before: { startsAt: "2026-10-18T15:00:00Z", endsAt: "2026-10-18T16:00:00Z" },
      after: { version: "2026-10-18T14:00:00Z" },
    };
    expect(parseAiAct(row)).toMatchObject({ kind: "booking_cancelled", target: row.target, before: row.before, after: row.after });
  });

  it("round-trips contact_created", () => {
    const row = { ...BASE, kind: "contact_created", target: { messageId: "m1", submissionId: "s1" }, before: null, after: null };
    expect(parseAiAct(row)).toMatchObject({ kind: "contact_created", target: row.target, before: null, after: null });
  });

  it("round-trips contact_created with an empty target (no message/submission)", () => {
    const row = { ...BASE, kind: "contact_created", target: {}, before: null, after: null };
    expect(parseAiAct(row)).toMatchObject({ kind: "contact_created", target: {} });
  });

  it("round-trips contact_field_filled", () => {
    const row = {
      ...BASE, kind: "contact_field_filled",
      target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" },
    };
    expect(parseAiAct(row)).toMatchObject({ kind: "contact_field_filled", target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" } });
  });

  it("drops a contact_field_filled row whose field is \"company\" (not a ContactFieldName)", () => {
    const row = { ...BASE, kind: "contact_field_filled", target: { field: "company" }, before: { value: null }, after: { value: "Acme" } };
    expect(parseAiAct(row)).toBeNull();
  });

  it("drops a row with an unknown kind", () => {
    expect(parseAiAct({ ...BASE, kind: "something_else", target: {}, before: null, after: null })).toBeNull();
  });

  it("drops a row whose source pair is wrong (voice with no call_id)", () => {
    const row = { ...BASE, call_id: null, kind: "contact_created", target: {}, before: null, after: null };
    expect(parseAiAct(row)).toBeNull();
  });

  it("drops a non-object row", () => {
    expect(parseAiAct(null)).toBeNull();
    expect(parseAiAct("x")).toBeNull();
  });

  it("every AI_ACT_KINDS member is covered by a passing case above", () => {
    expect(AI_ACT_KINDS).toEqual([
      "booking_created", "booking_rescheduled", "booking_cancelled", "contact_created", "contact_field_filled",
    ]);
  });

  it("type-checks NewAiAct's discriminated shape", () => {
    const n: NewAiAct = {
      kind: "contact_created", target: {}, before: null, after: null,
      actor: "webchat", callId: null, chatId: "chat1", contactId: "c1",
    };
    expect(n.kind).toBe("contact_created");
  });
});

// Accessors' contract (item 8c, plan Task 3): the account filter, the timeline page, and the booking
// undo wrapper's event emit. Who may read and write `ai_acts` (the member read, the Technician fence,
// the three functions' own grants) is proved in `ai-acts-schema.test.ts`. `withTestAccount` yields
// `serviceDb()`, which bypasses RLS and every grant: nothing here touches either.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  insertAiActs, getAiAct, listContactAiActs, undoAiBookingAct,
} from "../ai-acts";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus } from "../booking";
import type { NewAiAct } from "../ai-act-rules";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

async function seedCall(db: SupabaseClient, accountId: string): Promise<string> {
  const num = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
  expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: num.data!.id as string, caller_e164: "+19562921696" })
    .select("id").single();
  expect(call.error, `calls insert failed: ${call.error?.message}`).toBeNull();
  return call.data!.id as string;
}

async function eventsFor(db: SupabaseClient, accountId: string, type: string) {
  const { data, error } = await db.from("events").select("actor_type, actor_id, payload")
    .eq("account_id", accountId).eq("type", type);
  expect(error, `events read failed: ${error?.message}`).toBeNull();
  return (data ?? []) as { actor_type: string; actor_id: string; payload: Record<string, unknown> }[];
}

describe("ai-acts accessors", () => {
  it("insertAiActs then getAiAct round-trips every kind", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const acts: NewAiAct[] = [
        { kind: "booking_created", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "11111111-1111-1111-1111-111111111111" }, before: null,
          after: { startsAt: at(1), endsAt: at(2) } },
        { kind: "booking_rescheduled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "a", fromBookingId: "b" },
          before: { startsAt: at(1), endsAt: at(2), version: at(0) }, after: { startsAt: at(3), endsAt: at(4) } },
        { kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "c" }, before: { startsAt: at(1), endsAt: at(2) }, after: { version: at(0) } },
        { kind: "contact_created", actor: "voice", callId, chatId: null, contactId,
          target: {}, before: null, after: null },
        { kind: "contact_field_filled", actor: "voice", callId, chatId: null, contactId,
          target: { field: "firstName" }, before: { value: null }, after: { value: "Ana" } },
      ];
      await insertAiActs(db, accountId, acts);
      const { data: rows } = await db.from("ai_acts").select("id, kind").eq("account_id", accountId).order("created_at");
      expect(rows).toHaveLength(5);
      for (const r of rows as { id: string; kind: string }[]) {
        const act = await getAiAct(db, accountId, r.id);
        expect(act).not.toBeNull();
        expect(act!.kind).toBe(r.kind);
        expect(act!.contactId).toBe(contactId);
        expect(act!.callId).toBe(callId);
      }
    });
  });

  it("account B's id with A's act answers null while B holds a matching row (mutation: drop .eq(\"account_id\") -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const callA = await seedCall(dbA, accountA);
        const callB = await seedCall(dbB, accountB);
        const { id: contactA } = await createContact(dbA, accountA, { firstName: "Ana" }, "user_test");
        const { id: contactB } = await createContact(dbB, accountB, { firstName: "Bea" }, "user_test");
        await insertAiActs(dbA, accountA, [{ kind: "contact_created", actor: "voice", callId: callA, chatId: null, contactId: contactA, target: {}, before: null, after: null }]);
        await insertAiActs(dbB, accountB, [{ kind: "contact_created", actor: "voice", callId: callB, chatId: null, contactId: contactB, target: {}, before: null, after: null }]);
        const { data: rowsA } = await dbA.from("ai_acts").select("id").eq("account_id", accountA);
        const idA = (rowsA as { id: string }[])[0]!.id;
        // Account B asking for account A's id finds nothing, even though B holds a row of its own.
        expect(await getAiAct(dbB, accountB, idA)).toBeNull();
      });
    });
  });

  it("listContactAiActs pages across a cursor boundary, newest first", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const acts: NewAiAct[] = Array.from({ length: 3 }, (_, i): NewAiAct => ({
        kind: "contact_field_filled", actor: "voice", callId, chatId: null, contactId,
        target: { field: "firstName" }, before: { value: null }, after: { value: `v${i}` },
      }));
      // Insert one at a time so created_at strictly increases (the account's own clock).
      for (const a of acts) {
        await insertAiActs(db, accountId, [a]);
        await new Promise((r) => setTimeout(r, 10));
      }
      const page1 = await listContactAiActs(db, accountId, contactId, { limit: 2 });
      expect(page1).toHaveLength(2);
      expect(page1[0]!.after).toEqual({ value: "v2" });
      expect(page1[1]!.after).toEqual({ value: "v1" });
      const last = page1[1]!;
      const page2 = await listContactAiActs(db, accountId, contactId, { limit: 2, before: { v: last.createdAt, id: last.id } });
      expect(page2).toHaveLength(1);
      expect(page2[0]!.after).toEqual({ value: "v0" });
    });
  });

  it("undoAiBookingAct: a booking_created undo emits booking.status_changed (cancelled) with the undoer as actor", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const future = new Date(Date.now() + 48 * HOUR);
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: future, endsAt: new Date(future.getTime() + HOUR) }, "ai", "ai");
      await insertAiActs(db, accountId, [{
        kind: "booking_created", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: booking.id }, before: null,
        after: { startsAt: future.toISOString(), endsAt: new Date(future.getTime() + HOUR).toISOString() },
      }]);
      const { data: acts } = await db.from("ai_acts").select("id").eq("account_id", accountId);
      const actId = (acts as { id: string }[])[0]!.id;
      const by = "user_undoer";
      const outcome = await undoAiBookingAct(db, accountId, actId, by, new Date());
      expect(outcome).toBe("undone");
      const changed = await eventsFor(db, accountId, "booking.status_changed");
      expect(changed).toHaveLength(1);
      expect(changed[0]!.actor_id).toBe(by);
      expect(changed[0]!.payload).toMatchObject({ bookingId: booking.id, status: "cancelled" });
    });
  });

  it("undoAiBookingAct: a 'changed' outcome (the CAS failed) writes no event (mutation: emit before checking the outcome -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const future = new Date(Date.now() + 48 * HOUR);
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: future, endsAt: new Date(future.getTime() + HOUR) }, "ai", "ai");
      const cancelled = await setBookingStatus(db, accountId, booking.id, "cancelled", "user_test");
      await insertAiActs(db, accountId, [{
        kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: booking.id },
        before: { startsAt: future.toISOString(), endsAt: new Date(future.getTime() + HOUR).toISOString() },
        // A version OLDER than the actual cancel's updated_at: the CAS in 0091 will not match.
        after: { version: new Date(Date.parse(cancelled.updatedAt) - 1000).toISOString() },
      }]);
      const { data: acts } = await db.from("ai_acts").select("id").eq("account_id", accountId);
      const actId = (acts as { id: string }[])[0]!.id;
      const outcome = await undoAiBookingAct(db, accountId, actId, "user_undoer", new Date());
      expect(outcome).toBe("changed");
      // The setup's own cancel already wrote one booking.status_changed event (actor "user_test");
      // the undoer's own ("user_undoer") must be absent, since nothing moved.
      const byUndoer = (await eventsFor(db, accountId, "booking.status_changed")).filter((e) => e.actor_id === "user_undoer");
      expect(byUndoer).toHaveLength(0);
    });
  });
});

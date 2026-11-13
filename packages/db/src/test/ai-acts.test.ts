// Accessors' contract (item 8c, plan Task 3): the account filter, the timeline page, and the booking
// undo wrapper's event emit. Who may read and write `ai_acts` (the member read, the Technician fence,
// the three functions' own grants) is proved in `ai-acts-schema.test.ts`. `withTestAccount` yields
// `serviceDb()`, which bypasses RLS and every grant: nothing here touches either.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  insertAiActs, getAiAct, listContactAiActs, undoAiBookingAct,
  listPendingBookingActs, stampAiActAccepted, unstampAiActAccepted, stampAiActUndone,
} from "../ai-acts";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus, moveBooking } from "../booking";
import type { NewAiAct } from "../ai-act-rules";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

async function seedCall(db: SupabaseClient, accountId: string): Promise<string> {
  const num = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
  expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: num.data!.id as string, caller_e164: "+19565550196" })
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

  /**
   * Sofía's reschedule (registry.ts) moves through moveBooking and records its booking_rescheduled act
   * with `version: moved.cancelledAt`, the stamp moveBooking's cancel wrote. That stamp carries
   * microseconds (moveStamp), and 0091 restores the old booking only where
   * `updated_at = (before->>'version')::timestamptz`, exactly. So the stamp must reach the act unrounded:
   * the probe proves the real value undoes, and the control proves a millisecond-rounded one cannot.
   */
  describe("undoAiBookingAct on a reschedule moved by moveBooking (Sofía's reschedule race follow-up)", () => {
    // `day` keeps a retried setup clear of the earlier one's live booking (the no-overlap rule).
    const moveAsSofia = async (db: SupabaseClient, accountId: string, day = 0) => {
      const callId = await seedCall(db, accountId);
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const start = new Date(Date.now() + (48 + day * 72) * HOUR);
      const old = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: start, endsAt: new Date(start.getTime() + HOUR) }, "voice", "ai");
      const to = { startsAt: new Date(start.getTime() + 24 * HOUR), endsAt: new Date(start.getTime() + 25 * HOUR) };
      const moved = await moveBooking(db, accountId, old.id, to, "voice", "ai");
      const record = async (version: string): Promise<string> => {
        await insertAiActs(db, accountId, [{
          kind: "booking_rescheduled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: moved.id, fromBookingId: old.id },
          before: { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + HOUR).toISOString(), version },
          after: { startsAt: to.startsAt.toISOString(), endsAt: to.endsAt.toISOString() },
        }]);
        const { data: acts } = await db.from("ai_acts").select("id").eq("account_id", accountId);
        return (acts as { id: string }[])[0]!.id;
      };
      return { old, moved, record };
    };
    const statusOf = async (db: SupabaseClient, id: string) => {
      const { data, error } = await db.from("bookings").select("status").eq("id", id).maybeSingle();
      expect(error, `bookings read failed: ${error?.message}`).toBeNull();
      return (data as { status: string } | null)?.status ?? null;
    };

    it("P1: the act carrying moved.cancelledAt as its version undoes: the old booking is booked again and the new row is gone", async () => {
      await withTestAccount(async (db, accountId) => {
        const { old, moved, record } = await moveAsSofia(db, accountId);
        const actId = await record(moved.cancelledAt);
        expect(await undoAiBookingAct(db, accountId, actId, "user_undoer", new Date())).toBe("undone");
        expect(await statusOf(db, old.id)).toBe("booked");
        expect(await statusOf(db, moved.id)).toBeNull();
      });
    });

    it("control: the same act with its version cut to milliseconds (new Date(cancelledAt).toISOString()) is 'changed', and nothing moves", async () => {
      await withTestAccount(async (db, accountId) => {
        // moveStamp's three random microsecond digits are "000" one time in 1000, and then the rounded
        // value IS the stamp; move again until it is not, so the control can never pass vacuously.
        let setup = await moveAsSofia(db, accountId);
        for (let i = 1; i <= 3 && /\.\d{3}000Z$/.test(setup.moved.cancelledAt); i++) {
          setup = await moveAsSofia(db, accountId, i);
        }
        const { old, moved, record } = setup;
        const rounded = new Date(moved.cancelledAt).toISOString();
        expect(rounded, "the rounded version differs from the stamp").not.toBe(moved.cancelledAt);
        expect(rounded.slice(0, 23), "and only below the millisecond").toBe(moved.cancelledAt.slice(0, 23));
        const actId = await record(rounded);
        expect(await undoAiBookingAct(db, accountId, actId, "user_undoer", new Date())).toBe("changed");
        expect(await statusOf(db, old.id)).toBe("cancelled");
        expect(await statusOf(db, moved.id)).toBe("booked");
      });
    });
  });
});

describe("listPendingBookingActs (F-077 part 1)", () => {
  it("surfaces only control:booking kinds, un-undone and un-accepted (mutation: widen the kind filter to include contact_field_filled -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const booking = { kind: "booking_cancelled" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { bookingId: "bk_1" }, before: { startsAt: "2026-11-01T10:00:00Z", endsAt: "2026-11-01T11:00:00Z" },
        after: { version: "2026-11-01T09:00:00Z" } };
      const field = { kind: "contact_field_filled" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { field: "email" as const }, before: { value: null }, after: { value: "a@b.com" } };
      await insertAiActs(db, accountId, [booking, field]);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe("booking_act");
      expect(rows[0]!.bookingAct!.kind).toBe("booking_cancelled");
      expect(rows[0]!.contactId).toBe(contactId);
    });
  });

  it("excludes an already-accepted act (mutation: drop .is('accepted_at', null) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Bo" }, "user_test");
      const act = { kind: "booking_created" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { bookingId: "bk_2" }, before: null, after: { startsAt: "2026-11-02T10:00:00Z", endsAt: "2026-11-02T11:00:00Z" } };
      await insertAiActs(db, accountId, [act]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_created").single();
      await db.from("ai_acts").update({ accepted_at: new Date().toISOString(), accepted_by: "user_test" }).eq("id", row!.id);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows.map((r) => r.id)).not.toContain(`booking_act:${row!.id}`);
    });
  });

  it("excludes an act UNDONE on the record, seeded through stampAiActUndone itself, not a hand-set column (review I4; mutation: drop .is('undone_at', null) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Iv" }, "user_test");
      const act = { kind: "booking_rescheduled" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { bookingId: "bk_2b", fromBookingId: "bk_2a" },
        before: { startsAt: "2026-11-02T10:00:00Z", endsAt: "2026-11-02T11:00:00Z", version: "2026-11-02T09:00:00Z" },
        after: { startsAt: "2026-11-02T14:00:00Z", endsAt: "2026-11-02T15:00:00Z" } };
      await insertAiActs(db, accountId, [act]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_rescheduled").single();
      expect(await stampAiActUndone(db, accountId, row!.id, "user_owner", new Date())).toBe(true);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows.map((r) => r.id)).not.toContain(`booking_act:${row!.id}`);
    });
  });

  it("surfaces all three booking kinds, not just one (review I4; mutation: narrow BOOKING_ACT_KINDS to a single kind -> the other two disappear -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Jo" }, "user_test");
      await insertAiActs(db, accountId, [
        { kind: "booking_created", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_created" }, before: null, after: { startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T11:00:00Z" } },
        { kind: "booking_rescheduled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_resched", fromBookingId: "bk_resched_from" },
          before: { startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T11:00:00Z", version: "2026-11-03T09:00:00Z" },
          after: { startsAt: "2026-11-03T14:00:00Z", endsAt: "2026-11-03T15:00:00Z" } },
        { kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_cancelled" }, before: { startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T11:00:00Z" },
          after: { version: "2026-11-03T09:00:00Z" } },
      ]);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows.map((r) => r.bookingAct!.kind).sort()).toEqual(["booking_cancelled", "booking_created", "booking_rescheduled"]);
    });
  });

  it("is account-scoped: account A does not see account B's booking act", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const callId = await seedCall(dbB, accountB);
        const { id: contactId } = await createContact(dbB, accountB, { firstName: "Cy" }, "user_test");
        await insertAiActs(dbB, accountB, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_3" }, before: { startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T11:00:00Z" },
          after: { version: "2026-11-03T09:00:00Z" } }]);
        const rowsA = await listPendingBookingActs(dbA, accountA);
        expect(rowsA).toHaveLength(0);
      });
    });
  });
});

describe("stampAiActAccepted / unstampAiActAccepted (F-077 part 1)", () => {
  it("is a real compare-and-swap: the second stamp returns false (mutation: drop .is('accepted_at', null) -> the second call also returns true -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Dee" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: "bk_4" }, before: { startsAt: "2026-11-04T10:00:00Z", endsAt: "2026-11-04T11:00:00Z" },
        after: { version: "2026-11-04T09:00:00Z" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_cancelled").single();
      const at = new Date("2026-11-06T15:00:00Z");
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_a", at)).toBe(true);
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_b", new Date())).toBe(false);
    });
  });

  it("refuses to accept a non-booking-kind act, even one the queue never showed (review M1; mutation: drop .in('kind', BOOKING_ACT_KINDS) -> succeeds on a contact_field_filled act -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Hal" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "contact_field_filled", actor: "voice", callId, chatId: null, contactId,
        target: { field: "email" }, before: { value: null }, after: { value: "h@example.com" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "contact_field_filled").single();
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_a", new Date())).toBe(false);
    });
  });

  it("unstampAiActAccepted requires the SAME PERSON and the exact instant: right by/wrong instant and wrong by/right instant each return false, only the true pair clears it (review I3; mutation: drop .eq('accepted_by', by) -> a different person's Undo succeeds -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Em" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: "bk_5" }, before: { startsAt: "2026-11-05T10:00:00Z", endsAt: "2026-11-05T11:00:00Z" },
        after: { version: "2026-11-05T09:00:00Z" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_cancelled").single();
      const at1 = new Date("2026-11-06T15:00:00Z");
      await stampAiActAccepted(db, accountId, row!.id, "user_a", at1);

      // right person, wrong instant
      expect(await unstampAiActAccepted(db, accountId, row!.id, "user_a", new Date("2026-11-06T16:00:00Z"))).toBe(false);
      // wrong person, right instant
      expect(await unstampAiActAccepted(db, accountId, row!.id, "user_b", at1)).toBe(false);
      const { data: still } = await db.from("ai_acts").select("accepted_at, accepted_by").eq("id", row!.id).single();
      expect(still!.accepted_by).toBe("user_a");

      // the true pair
      expect(await unstampAiActAccepted(db, accountId, row!.id, "user_a", at1)).toBe(true);
    });
  });

  it("refuses to accept an act already undone on the record (review C1; mutation: drop .is('undone_at', null) -> returns true -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Flo" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: "bk_6" }, before: { startsAt: "2026-11-05T10:00:00Z", endsAt: "2026-11-05T11:00:00Z" },
        after: { version: "2026-11-05T09:00:00Z" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_cancelled").single();
      await stampAiActUndone(db, accountId, row!.id, "user_owner", new Date("2026-11-06T14:00:00Z"));
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_a", new Date("2026-11-06T15:00:00Z"))).toBe(false);
    });
  });

  it("both stamps are account-scoped: another account's id matches nothing (review I3; mutation: drop .eq('account_id', accountId) from either writer -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const callId = await seedCall(dbB, accountB);
        const { id: contactId } = await createContact(dbB, accountB, { firstName: "Gus" }, "user_test");
        await insertAiActs(dbB, accountB, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_7" }, before: { startsAt: "2026-11-05T10:00:00Z", endsAt: "2026-11-05T11:00:00Z" },
          after: { version: "2026-11-05T09:00:00Z" } }]);
        const { data: row } = await dbB.from("ai_acts").select("id").eq("account_id", accountB).eq("kind", "booking_cancelled").single();
        const at = new Date("2026-11-06T15:00:00Z");
        // account A's scope never matches account B's act, even on a service client that bypasses RLS
        expect(await stampAiActAccepted(dbA, accountA, row!.id, "user_a", at)).toBe(false);
        expect(await stampAiActAccepted(dbB, accountB, row!.id, "user_b", at)).toBe(true);
        expect(await unstampAiActAccepted(dbA, accountA, row!.id, "user_b", at)).toBe(false);
      });
    });
  });
});

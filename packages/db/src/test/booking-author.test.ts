import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, moveBooking, listContactBookings } from "../booking";

const span = (v: string) => ({ startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) });

describe("bookings name their author (S-03 1b, spec §5.2)", () => {
  it("the booking page's is the customer's, the receptionist's the AI's, a person's names them (mutation: write author_kind 'person' always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const pub = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-02T15:00:00Z"), ipHash: "h" }, "public", "system");
      const ai = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-03T15:00:00Z") }, "voice", "ai");
      const staff = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-04T15:00:00Z") }, "user_dan", "user");
      const { data } = await db.from("bookings").select("id, author_kind, author_id").in("id", [pub.id, ai.id, staff.id]);
      const by = (id: string) => (data ?? []).find((r: { id: string }) => r.id === id);
      expect(by(pub.id)).toMatchObject({ author_kind: "customer", author_id: null });
      expect(by(ai.id)).toMatchObject({ author_kind: "ai", author_id: null });
      expect(by(staff.id)).toMatchObject({ author_kind: "person", author_id: "user_dan" });
    }));
  it("a move records who moved it: the customer's move page (mutation: pass no author to moveBooking's insert -> NULL, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-04-02T15:00:00Z") }, "public", "system");
      const moved = await moveBooking(db, accountId, first.id, { ...span("2027-04-03T15:00:00Z"), ipHash: "h" }, "public", "system");
      const { data } = await db.from("bookings").select("author_kind").eq("id", moved.id).single();
      expect(data).toEqual({ author_kind: "customer" });
    }));
});

describe("listContactBookings (spec §6, §7)", () => {
  it("one page by (created_at desc, id desc), a reschedule carrying the start it replaced (mutation: drop the moved-from read -> null, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-05-02T15:00:00Z") }, "public", "system");
      const moved = await moveBooking(db, accountId, first.id, span("2027-05-03T15:00:00Z"), "public", "system");
      const rows = await listContactBookings(db, accountId, ana, { limit: 31 });
      expect(rows.map((r) => r.id)).toEqual([moved.id, first.id]);
      expect(Date.parse(rows[0]!.moved_from_starts_at!)).toBe(Date.parse("2027-05-02T15:00:00Z"));
      expect(rows[0]).toMatchObject({ status: "booked", author_kind: "customer" });
      expect(rows[1]).toMatchObject({ status: "cancelled", moved_from_starts_at: null });
      const older = await listContactBookings(db, accountId, ana, { limit: 31, before: { v: rows[0]!.created_at, id: rows[0]!.id } });
      expect(older.map((r) => r.id)).toEqual([first.id]);
    }));
});

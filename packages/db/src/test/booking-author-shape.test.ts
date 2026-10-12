import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBooking, moveBooking, listContactBookings } from "../booking";

/**
 * The same promises as booking-author.test.ts (live, proven on CI's in-runner stack, which has
 * 0073), checked here with no database so each can fail locally by name: what createBooking and
 * moveBooking insert, and how listContactBookings reads one page plus the starts it replaced.
 * A fake client records each call; `script` queues each table's answers in call order.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(script: Record<string, Answer[]> = {}) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const chain = (table: string) => {
    const next = (fallback: Answer) => script[table]?.shift() ?? fallback;
    const b: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "delete", "eq", "neq", "in", "is", "or", "order", "limit"]) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
    }
    b.single = async () => next({ data: { id: "new1" }, error: null });
    b.maybeSingle = async () => next({ data: null, error: null });
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(next({ data: [], error: null })).then(res, rej);
    return b;
  };
  const db = { from: (table: string) => chain(table), rpc: async () => ({ data: null, error: null }) };
  return { db: db as unknown as SupabaseClient, calls };
}

const input = {
  calendarId: "cal1", contactId: "c1",
  startsAt: new Date("2027-03-02T15:00:00Z"), endsAt: new Date("2027-03-02T16:00:00Z"),
};
const insertOf = (calls: { table: string; op: string; args: unknown[] }[]) =>
  calls.find((c) => c.table === "bookings" && c.op === "insert")?.args[0];

describe("createBooking sends its author (S-03 1b, no database)", () => {
  it("the booking page's is the customer's, with no id (mutation: write author_kind 'person' always -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await createBooking(db, "a1", input, "public", "system");
    expect(insertOf(calls)).toMatchObject({ author_kind: "customer", author_id: null });
  });

  it("the receptionist's is the AI's, a person's names them (mutation: drop author_kind/author_id from the insert -> FAILS)", async () => {
    const ai = fakeDb();
    await createBooking(ai.db, "a1", input, "voice", "ai");
    expect(insertOf(ai.calls)).toMatchObject({ author_kind: "ai", author_id: null });
    const staff = fakeDb();
    await createBooking(staff.db, "a1", input, "user_dan", "user");
    expect(insertOf(staff.calls)).toMatchObject({ author_kind: "person", author_id: "user_dan" });
  });
});

describe("moveBooking sends its author (S-03 1b, no database)", () => {
  it("the customer's move page writes a customer's row (mutation: pass a fixed 'user' actor to moveBooking's insert -> FAILS)", async () => {
    const { db, calls } = fakeDb({
      bookings: [
        { data: { id: "old1", calendar_id: "cal1", contact_id: "c1", note: null, booker_timezone: null, status: "booked" }, error: null },
        { data: { id: "new1" }, error: null },
        { data: [{ id: "old1" }], error: null },
      ],
    });
    const moved = await moveBooking(db, "a1", "old1", { startsAt: input.startsAt, endsAt: input.endsAt }, "public", "system");
    expect(moved.id).toBe("new1");
    expect(insertOf(calls)).toMatchObject({ author_kind: "customer", author_id: null, rescheduled_from_id: "old1" });
  });
});

describe("listContactBookings' page read (S-03 1b, spec §6, no database)", () => {
  const row = (id: string, from: string | null) => ({
    id, created_at: "2027-05-01T10:00:00+00:00", starts_at: "2027-05-03T15:00:00+00:00", status: "booked",
    note: null, author_kind: "customer", author_id: null, rescheduled_from_id: from,
  });

  it("a reschedule carries the start it replaced, read once for the page and scoped to the account (mutation: drop the moved-from read -> null, FAILS)", async () => {
    const { db, calls } = fakeDb({
      bookings: [
        { data: [row("b3", "b1"), row("b2", "b1"), row("b1", null)], error: null },
        { data: [{ id: "b1", starts_at: "2027-05-02T15:00:00+00:00" }], error: null },
      ],
    });
    const rows = await listContactBookings(db, "a1", "c1", { limit: 31 });
    expect(rows.map((r) => [r.id, r.moved_from_starts_at])).toEqual([
      ["b3", "2027-05-02T15:00:00+00:00"], ["b2", "2027-05-02T15:00:00+00:00"], ["b1", null],
    ]);
    const ins = calls.filter((c) => c.op === "in");
    expect(ins).toEqual([{ table: "bookings", op: "in", args: ["id", ["b1"]] }]);
    expect(calls.filter((c) => c.op === "eq" && c.args[0] === "account_id").map((c) => c.args[1])).toEqual(["a1", "a1"]);
  });

  it("asks for the author pair, newest first by (created_at, id), past the cursor, at most `limit` (mutation: drop withTimelinePage -> FAILS)", async () => {
    const { db, calls } = fakeDb({ bookings: [{ data: [row("b1", null)], error: null }] });
    const before = { v: "2027-05-01T10:00:00.123456+00:00", id: "00000000-0000-4000-8000-000000000001" };
    await listContactBookings(db, "a1", "c1", { limit: 31, before });
    const cols = String(calls.find((c) => c.op === "select")?.args[0]).split(",").map((s) => s.trim());
    expect(cols).toEqual(expect.arrayContaining(["author_kind", "author_id", "rescheduled_from_id", "created_at", "status"]));
    expect(calls.filter((c) => c.op === "order").map((c) => c.args)).toEqual([
      ["created_at", { ascending: false }], ["id", { ascending: false }],
    ]);
    expect(calls.filter((c) => c.op === "or")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([31]);
    expect(calls.filter((c) => c.op === "in")).toEqual([]);
  });

  it("throws on a read error, never an empty page (mutation: return [] on error -> FAILS)", async () => {
    const { db } = fakeDb({ bookings: [{ data: null, error: { message: "boom" } }] });
    await expect(listContactBookings(db, "a1", "c1", { limit: 31 })).rejects.toThrow("listContactBookings failed: boom");
  });
});

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  savePendingCancelNotice, listDueCancelNotices, deletePendingCancelNotice, readBookingStatus,
} from "./booking";

/**
 * F-048 follow-up (0100): the pending cancel notice's four accessors, without a
 * database. The fake records every call of each query in order and answers
 * what the test hands it, so a missing filter, a wrong comparison or a wrong
 * sort shows up as the call it is. The live round trip is
 * ./test/booking.test.ts ("F-048: the pending notice"), on CI.
 */
type Call = [string, ...unknown[]];
type Answer = { data?: unknown; error?: { message: string } | null };

function fake(answer: Answer = {}) {
  const queries: { table: string; calls: Call[] }[] = [];
  const db = {
    from(table: string) {
      const calls: Call[] = [];
      queries.push({ table, calls });
      const result = { data: answer.data ?? null, error: answer.error ?? null };
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      for (const op of ["select", "insert", "upsert", "update", "delete", "eq", "lte", "order", "limit", "maybeSingle"]) {
        chain[op] = (...args: unknown[]) => { calls.push([op, ...args]); return chain; };
      }
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

const ROW = {
  accountId: "acct_1", bookingId: "bk_1", version: "2026-10-27T15:00:00.123456+00:00", messageId: "msg_1",
  userId: "user_1", email: { to: "ana@example.com", subject: "s" }, dueAt: "2026-10-27T15:00:15.123Z",
};

describe("savePendingCancelNotice — the notice's durable copy, written in the cancel's own request", () => {
  it("upserts one row keyed by the booking, every column named (mutation: a plain insert → a second cancel of the same booking after an Undo is refused 23505 and that notice has no durable copy, FAILS)", async () => {
    const { db, queries } = fake();
    await savePendingCancelNotice(db, ROW);
    expect(queries).toEqual([{
      table: "booking_cancel_notices",
      calls: [["upsert", {
        booking_id: "bk_1", account_id: "acct_1", version: ROW.version, message_id: "msg_1",
        user_id: "user_1", email: ROW.email, due_at: ROW.dueAt,
      }, { onConflict: "booking_id" }]],
    }]);
  });

  it("THROWS on a write error, naming itself", async () => {
    const { db } = fake({ error: { message: "boom" } });
    await expect(savePendingCancelNotice(db, ROW)).rejects.toThrow("savePendingCancelNotice failed: boom");
  });
});

describe("listDueCancelNotices — the sweep's read", () => {
  it("reads rows due at or before the cutoff, oldest due first, bounded, with the booking's start (mutation: order descending, or drop the limit → FAILS)", async () => {
    const { db, queries } = fake({ data: [] });
    await listDueCancelNotices(db, "2026-10-27T15:00:00.000Z", 25);
    expect(queries).toEqual([{
      table: "booking_cancel_notices",
      calls: [
        ["select", "booking_id, account_id, version, message_id, user_id, email, due_at, created_at, bookings(starts_at)"],
        ["lte", "due_at", "2026-10-27T15:00:00.000Z"],
        ["order", "due_at", { ascending: true }],
        ["limit", 25],
      ],
    }]);
  });

  it("maps each row, and a booking the embed could not find answers startsAt null", async () => {
    const { db } = fake({
      data: [
        { booking_id: "bk_1", account_id: "acct_1", version: "v1", message_id: "msg_1", user_id: "u1", email: { to: "a" },
          due_at: "d1", created_at: "c1", bookings: { starts_at: "s1" } },
        { booking_id: "bk_2", account_id: "acct_2", version: "v2", message_id: "msg_2", user_id: "u2", email: { to: "b" },
          due_at: "d2", created_at: "c2", bookings: null },
      ],
    });
    expect(await listDueCancelNotices(db, "2026-10-27T15:00:00.000Z", 25)).toEqual([
      { bookingId: "bk_1", accountId: "acct_1", version: "v1", messageId: "msg_1", userId: "u1", email: { to: "a" }, dueAt: "d1", createdAt: "c1", startsAt: "s1" },
      { bookingId: "bk_2", accountId: "acct_2", version: "v2", messageId: "msg_2", userId: "u2", email: { to: "b" }, dueAt: "d2", createdAt: "c2", startsAt: null },
    ]);
  });

  it("THROWS on a read error", async () => {
    const { db } = fake({ error: { message: "boom" } });
    await expect(listDueCancelNotices(db, "x", 1)).rejects.toThrow("listDueCancelNotices failed: boom");
  });
});

describe("deletePendingCancelNotice — settles one notice's row, never a newer cancel's", () => {
  it("deletes only the row of this account, this booking AND this cancel's version (mutation: drop the version predicate → a newer cancel's row could go, FAILS)", async () => {
    const { db, queries } = fake({ data: [{ booking_id: "bk_1" }] });
    expect(await deletePendingCancelNotice(db, "acct_1", "bk_1", ROW.version)).toBe(true);
    expect(queries).toEqual([{
      table: "booking_cancel_notices",
      calls: [["delete"], ["eq", "account_id", "acct_1"], ["eq", "booking_id", "bk_1"], ["eq", "version", ROW.version], ["select", "booking_id"]],
    }]);
  });

  it("answers false when nothing matched, and THROWS on an error", async () => {
    expect(await deletePendingCancelNotice(fake({ data: [] }).db, "acct_1", "bk_1", "v")).toBe(false);
    await expect(deletePendingCancelNotice(fake({ error: { message: "boom" } }).db, "acct_1", "bk_1", "v"))
      .rejects.toThrow("deletePendingCancelNotice failed: boom");
  });
});

describe("readBookingStatus — what a notice that lost its claim reads", () => {
  it("reads this account's booking's status, or null when there is none (mutation: drop the account predicate → FAILS)", async () => {
    const { db, queries } = fake({ data: { status: "booked" } });
    expect(await readBookingStatus(db, "acct_1", "bk_1")).toBe("booked");
    expect(queries[0]!.calls).toEqual([["select", "status"], ["eq", "account_id", "acct_1"], ["eq", "id", "bk_1"], ["maybeSingle"]]);
    expect(await readBookingStatus(fake({ data: null }).db, "acct_1", "bk_1")).toBeNull();
  });

  it("THROWS on a read error", async () => {
    await expect(readBookingStatus(fake({ error: { message: "boom" } }).db, "acct_1", "bk_1"))
      .rejects.toThrow("readBookingStatus failed: boom");
  });
});

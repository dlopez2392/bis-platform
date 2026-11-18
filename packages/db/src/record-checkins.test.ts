import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listContactCheckins, TIMELINE_SOURCES } from "./record";

/**
 * F-072 PR 4 (plan D2): the record timeline's `checkins` source, against a fake that answers each TABLE with fixed
 * rows and records what was asked. The real queries are proven against PostgREST by the live suites; this proves the
 * shape of the entries the page gets: who, when, the job's day and (for "not great" only) the To-do's state.
 */
type Call = { table: string; method: string; args: unknown[] };
function fakeDb(answers: Record<string, unknown[]>, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const chainFor = (table: string): unknown => new Proxy({}, {
    get(_t, method: string) {
      if (method === "then") {
        return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          const error = Object.hasOwn(errors, table) ? { message: errors[table] } : null;
          return Promise.resolve({ data: error ? null : (answers[table] ?? []), error }).then(res, rej);
        };
      }
      return (...args: unknown[]) => { calls.push({ table, method, args }); return chainFor(table); };
    },
  });
  return { db: { from: (t: string) => chainFor(t) } as unknown as SupabaseClient, calls };
}

const ACCT = "acct-1";
const PAGE = { limit: 31 };
const checkin = (id: string, answer: string, booking: string, at = "2026-10-17T15:00:00.000000+00:00") =>
  ({ id, contact_id: "c1", booking_id: booking, answer, answered_at: at });

describe("listContactCheckins (plan D2)", () => {
  it("is a listed source, so a page names it when it fails", () => {
    expect(TIMELINE_SOURCES).toContain("checkins");
  });

  it("makes one customer entry per answer, with the job's day, and a To-do state for the not-great one only (mutation: read the To-do for every answer -> FAILS)", async () => {
    const { db, calls } = fakeDb({
      job_checkins: [checkin("k1", "great", "b1"), checkin("k2", "not_great", "b2"), checkin("k3", "not_great", "b3")],
      bookings: [{ id: "b1", starts_at: "2026-10-16T15:00:00Z" }, { id: "b2", starts_at: "2026-10-15T15:00:00Z" }],
      // k1's row is a stray (nothing creates a To-do for a great answer): even so the row must not claim one.
      tasks: [{ review_checkin_id: "k1", completed_at: null }, { review_checkin_id: "k2", completed_at: null }, { review_checkin_id: "k3", completed_at: "2026-10-18T10:00:00Z" }],
    });
    const out = await listContactCheckins(db, ACCT, "c1", PAGE);
    expect(out.map((e) => [e.kind, e.id, e.contactId, e.kind === "checkin" ? e.checkin : null])).toEqual([
      ["checkin", "k1", "c1", { answer: "great", bookingStartsAt: "2026-10-16T15:00:00Z", todo: null }],
      ["checkin", "k2", "c1", { answer: "not_great", bookingStartsAt: "2026-10-15T15:00:00Z", todo: "open" }],
      // A booking the reader cannot see (RLS) is a null day, never a failure; a completed To-do is done.
      ["checkin", "k3", "c1", { answer: "not_great", bookingStartsAt: null, todo: "done" }],
    ]);
    // The To-do read asks only about the not-great answers, and every read is scoped to the account.
    const todoIn = calls.find((c) => c.table === "tasks" && c.method === "in")!;
    expect(todoIn.args).toEqual(["review_checkin_id", ["k2", "k3"]]);
    for (const table of ["job_checkins", "bookings", "tasks"]) {
      expect(calls.some((c) => c.table === table && c.method === "eq" && c.args[0] === "account_id" && c.args[1] === ACCT), table).toBe(true);
    }
  });

  it("an answered not-great whose To-do does not exist yet carries no state (the sweep makes it; nothing is invented)", async () => {
    const { db } = fakeDb({ job_checkins: [checkin("k2", "not_great", "b2")], bookings: [{ id: "b2", starts_at: "2026-10-15T15:00:00Z" }], tasks: [] });
    const [e] = await listContactCheckins(db, ACCT, "c1", PAGE);
    expect(e!.kind === "checkin" && e.checkin.todo).toBeNull();
  });

  it("no answers means no follow-up reads at all", async () => {
    const { db, calls } = fakeDb({ job_checkins: [] });
    expect(await listContactCheckins(db, ACCT, "c1", PAGE)).toEqual([]);
    expect(calls.some((c) => c.table === "bookings" || c.table === "tasks")).toBe(false);
  });

  it("THROWS on a failed read, so the page names the source instead of showing a quiet timeline (mutation: swallow the error -> FAILS)", async () => {
    await expect(listContactCheckins(fakeDb({}, { job_checkins: "boom" }).db, ACCT, "c1", PAGE)).rejects.toThrow(/listContactCheckins failed: boom/);
    await expect(listContactCheckins(fakeDb({ job_checkins: [checkin("k1", "great", "b1")] }, { tasks: "no" }).db, ACCT, "c1", PAGE))
      .rejects.toThrow(/to-dos failed: no/);
    await expect(listContactCheckins(fakeDb({ job_checkins: [checkin("k1", "great", "b1")] }, { bookings: "no" }).db, ACCT, "c1", PAGE))
      .rejects.toThrow(/bookings failed: no/);
  });
});

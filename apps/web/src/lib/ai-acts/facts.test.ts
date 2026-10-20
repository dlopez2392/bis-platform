import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAct } from "@bis/db/ai-act-rules";

const bis = vi.hoisted(() => ({ getContact: vi.fn(), aiContactHeldBy: vi.fn(), lastFieldEditor: vi.fn() }));
vi.mock("@bis/db", () => bis);

import { readActFacts } from "./facts";

/**
 * The page's one facts read (item 8c, plan Task 5 item 2). The fake below answers each query from rows held
 * for TWO accounts and honours every filter the read chains (eq, neq, in, not in, lt, gt, limit), so a read
 * that forgets its account scope picks up the other account's rows and fails here.
 */

type Row = Record<string, unknown>;
type Call = { table: string; steps: [string, unknown[]][] };

function fakeDb(tables: Record<string, Row[]>, opts: { fail?: string } = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "lt", "gt", "not", "limit", "order"]) {
        chain[m] = (...args: unknown[]) => { call.steps.push([m, args]); return chain; };
      }
      chain.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
        if (opts.fail === table) return Promise.resolve({ data: null, error: { message: `${table} down` } }).then(ok, ko);
        let rows = [...(tables[table] ?? [])];
        let limit = Infinity;
        for (const [m, a] of call.steps) {
          const [col, v, w] = a as [string, unknown, unknown];
          if (m === "eq") rows = rows.filter((r) => r[col] === v);
          if (m === "neq") rows = rows.filter((r) => r[col] !== v);
          if (m === "in") rows = rows.filter((r) => (v as unknown[]).includes(r[col]));
          if (m === "lt") rows = rows.filter((r) => String(r[col]) < String(v));
          if (m === "gt") rows = rows.filter((r) => String(r[col]) > String(v));
          if (m === "not" && v === "in") {
            const ids = String(w).replace(/^\(|\)$/g, "").split(",");
            rows = rows.filter((r) => !ids.includes(String(r[col])));
          }
          if (m === "limit") limit = v as unknown as number;
        }
        return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(ok, ko);
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const NOW = new Date("2026-10-20T12:00:00.000Z");
const F1 = "2026-10-22T15:00:00.000Z";
const F1E = "2026-10-22T16:00:00.000Z";
const base = { accountId: "A", contactId: "c1", actor: "voice" as const, callId: "call1", chatId: null,
  createdAt: "2026-10-19T08:00:00.000Z", undoneAt: null, undoneBy: null, undoNotified: false };
const created = (id: string, bookingId: string): AiAct =>
  ({ ...base, id, kind: "booking_created", target: { bookingId }, before: null, after: { startsAt: F1, endsAt: F1E } });
const cancelled = (id: string, bookingId: string): AiAct =>
  ({ ...base, id, kind: "booking_cancelled", target: { bookingId }, before: { startsAt: F1, endsAt: F1E }, after: { version: "2026-10-19T08:00:00.000Z" } });
const moved = (id: string, bookingId: string, fromBookingId: string): AiAct =>
  ({ ...base, id, kind: "booking_rescheduled", target: { bookingId, fromBookingId }, before: { startsAt: F1, endsAt: F1E, version: "v" }, after: { startsAt: "2026-10-23T15:00:00.000Z", endsAt: "2026-10-23T16:00:00.000Z" } });
const contactMade = (id: string): AiAct => ({ ...base, id, kind: "contact_created", target: {}, before: null, after: null });
const filled = (id: string, value = "ana@example.com"): AiAct =>
  ({ ...base, id, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value } });

const bk = (id: string, account: string, over: Row = {}): Row => ({
  id, account_id: account, calendar_id: "cal1", contact_id: "c1", status: "booked", starts_at: F1, ends_at: F1E,
  updated_at: "2026-10-19T08:00:00.000Z", rescheduled_from_id: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  bis.getContact.mockResolvedValue({ id: "c1", first_name: "Ana", email: "ana@example.com" });
  bis.aiContactHeldBy.mockResolvedValue([]);
  bis.lastFieldEditor.mockResolvedValue("user_ana");
});

describe("readActFacts", () => {
  it("reads nothing at all for a page with no acts", async () => {
    const { db, calls } = fakeDb({});
    const f = await readActFacts(db, "A", "c1", [], { canDelete: true }, NOW);
    expect(calls).toEqual([]);
    expect(bis.getContact).not.toHaveBeenCalled();
    expect(f).toEqual({ now: NOW, bookings: {}, contact: null, heldBy: {}, editors: {}, canDelete: true, futureBooked: [] });
  });

  it("ONE bookings read for three booking acts, by their ids, scoped to the account (mutation: a read per act -> FAILS)", async () => {
    const { db, calls } = fakeDb({ bookings: [bk("b1", "A"), bk("b2", "A", { status: "cancelled" }), bk("b3", "A", { status: "cancelled" })] });
    await readActFacts(db, "A", "c1", [created("x1", "b1"), created("x2", "b2"), moved("x3", "b1", "b3")], { canDelete: true }, NOW);
    const reads = calls.filter((c) => c.table === "bookings" && c.steps.some(([m, a]) => m === "in" && a[0] === "id"));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.steps).toContainEqual(["eq", ["account_id", "A"]]);
    expect(reads[0]!.steps.find(([m]) => m === "in")![1][1]).toEqual(["b1", "b2", "b3"]);
  });

  it("another account's booking with the same id is never read as this one's (second account)", async () => {
    const { db } = fakeDb({ bookings: [bk("b1", "A", { status: "cancelled" }), bk("b1", "B", { status: "booked" }), bk("b9", "B", { rescheduled_from_id: "b1" })] });
    const f = await readActFacts(db, "A", "c1", [created("x1", "b1")], { canDelete: true }, NOW);
    expect(f.bookings.b1).toMatchObject({ status: "cancelled", replacedBy: null });
  });

  it("maps each booking, and names the booking that replaced one", async () => {
    const { db } = fakeDb({ bookings: [bk("b1", "A"), bk("b2", "A", { rescheduled_from_id: "b1" })] });
    const f = await readActFacts(db, "A", "c1", [created("x1", "b1")], { canDelete: true }, NOW);
    expect(f.bookings).toEqual({ b1: { status: "booked", startsAt: F1, endsAt: F1E, updatedAt: "2026-10-19T08:00:00.000Z", replacedBy: "b2", slotTaken: false } });
  });

  it("a cancelled booking's slot is taken when another live booking on its calendar overlaps; one on another calendar or another account is not", async () => {
    const overlap = { starts_at: "2026-10-22T15:30:00.000Z", ends_at: "2026-10-22T16:30:00.000Z" };
    const run = async (other: Row) => {
      const { db } = fakeDb({ bookings: [bk("b1", "A", { status: "cancelled" }), other] });
      return (await readActFacts(db, "A", "c1", [cancelled("x1", "b1")], { canDelete: true }, NOW)).bookings.b1!.slotTaken;
    };
    expect(await run(bk("bX", "A", { ...overlap, contact_id: "c2" }))).toBe(true);
    expect(await run(bk("bX", "A", { ...overlap, calendar_id: "cal2", contact_id: "c2" }))).toBe(false);
    expect(await run(bk("bX", "B", { ...overlap, contact_id: "c2" }))).toBe(false);
    expect(await run(bk("bX", "A", { ...overlap, status: "cancelled", contact_id: "c2" }))).toBe(false);
    expect(await run(bk("bX", "A", { starts_at: F1E, ends_at: "2026-10-22T17:00:00.000Z", contact_id: "c2" }))).toBe(false);
  });

  it("a move's old slot is not taken by the move's own new booking, which the Undo deletes", async () => {
    const { db } = fakeDb({ bookings: [bk("bOld", "A", { status: "cancelled" }), bk("bNew", "A", { starts_at: "2026-10-22T15:30:00.000Z", ends_at: "2026-10-22T16:30:00.000Z", rescheduled_from_id: "bOld" })] });
    const f = await readActFacts(db, "A", "c1", [moved("x1", "bNew", "bOld")], { canDelete: true }, NOW);
    expect(f.bookings.bOld!.slotTaken).toBe(false);
  });

  it("the contact's future booked bookings are read only when a cancelled-booking act is on the page, scoped to the account", async () => {
    const tables = { bookings: [bk("b1", "A", { status: "cancelled" }), bk("b2", "A"), bk("b8", "B"), bk("b3", "A", { starts_at: "2026-10-01T00:00:00.000Z" })] };
    const a = fakeDb(tables);
    expect((await readActFacts(a.db, "A", "c1", [cancelled("x1", "b1")], { canDelete: true }, NOW)).futureBooked).toEqual(["b2"]);
    const b = fakeDb(tables);
    await readActFacts(b.db, "A", "c1", [created("x1", "b2")], { canDelete: true }, NOW);
    expect(b.calls.filter((c) => c.steps.some(([m, x]) => m === "eq" && x[0] === "contact_id"))).toEqual([]);
  });

  it("holds are read per contact-created act only for an Owner (mutation: read them for everyone -> FAILS)", async () => {
    const { db } = fakeDb({});
    const owner = await readActFacts(db, "A", "c1", [contactMade("x1")], { canDelete: true }, NOW);
    expect(bis.aiContactHeldBy).toHaveBeenCalledWith(db, "A", "x1");
    expect(owner.heldBy).toEqual({ x1: [] });
    bis.aiContactHeldBy.mockClear();
    const staff = await readActFacts(db, "A", "c1", [contactMade("x1")], { canDelete: false }, NOW);
    expect(bis.aiContactHeldBy).not.toHaveBeenCalled();
    expect(staff).toMatchObject({ heldBy: {}, canDelete: false });
  });

  it("asks who edited a field only when the value moved, from the act's own time", async () => {
    const { db } = fakeDb({});
    const same = await readActFacts(db, "A", "c1", [filled("x1")], { canDelete: true }, NOW);
    expect(bis.lastFieldEditor).not.toHaveBeenCalled();
    expect(same.editors).toEqual({});
    bis.getContact.mockResolvedValue({ id: "c1", email: "other@example.com" });
    const moved2 = await readActFacts(db, "A", "c1", [filled("x1")], { canDelete: true }, NOW);
    expect(bis.lastFieldEditor).toHaveBeenCalledWith(db, "A", "c1", "email", "2026-10-19T08:00:00.000Z");
    expect(moved2.editors).toEqual({ x1: "user_ana" });
  });

  it("an undone act needs no answer: nothing is read for it", async () => {
    const { db, calls } = fakeDb({});
    await readActFacts(db, "A", "c1", [{ ...contactMade("x1"), undoneAt: "2026-10-20T00:00:00.000Z", undoneBy: "u" }], { canDelete: true }, NOW);
    expect(bis.aiContactHeldBy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("a failed read rejects (the loader turns it soft: every act unknown)", async () => {
    await expect(readActFacts(fakeDb({}, { fail: "bookings" }).db, "A", "c1", [created("x1", "b1")], { canDelete: true }, NOW)).rejects.toThrow(/bookings down/);
    bis.aiContactHeldBy.mockRejectedValue(new Error("held down"));
    await expect(readActFacts(fakeDb({}).db, "A", "c1", [contactMade("x1")], { canDelete: true }, NOW)).rejects.toThrow(/held down/);
  });
});

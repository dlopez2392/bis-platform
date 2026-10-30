import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removePlace, type PlaceRow, type PlaceCtx } from "./places";

/**
 * F-046 part 1 (plan Task 5): removePlace must count `bookings` as well as `equipment` before it
 * decides to delete a place, because a booking can name a place (bookings.place_id, migration
 * 0107, NO ACTION) and a job's address must never vanish out from under it. Fake only: the live
 * round trip (a job's place survives removePlace, and the FK race) is CI-only
 * (./test/places.test.ts, ./test/head-count-null.test.ts).
 *
 * Each `.from(table)` call gets its own chain with its own local method set, so the SAME table
 * ("places") can be queried twice in one call (getPlace's select, then a delete or an update) and
 * each occurrence answers on its own terms.
 */
type ErrShape = { message: string; code?: string };
type Call = { table: string; method: string; args: unknown[] };

function fakeDb(opts: {
  place?: Partial<PlaceRow> | null;
  equipment?: { count?: number | null; error?: ErrShape | null };
  bookings?: { count?: number | null; error?: ErrShape | null };
  delete?: { rows?: Partial<PlaceRow>[]; error?: ErrShape | null };
  update?: { rows?: Partial<PlaceRow>[] };
}) {
  const calls: Call[] = [];
  const chainFor = (table: string): unknown => {
    const localMethods = new Set<string>();
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "maybeSingle") {
          return (...args: unknown[]) => {
            calls.push({ table, method, args });
            return Promise.resolve({ data: opts.place ?? null, error: null });
          };
        }
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            let result: { data: unknown; error: unknown; count?: number | null };
            if (table === "equipment") {
              result = { data: null, error: opts.equipment?.error ?? null, count: opts.equipment?.count === undefined ? 0 : opts.equipment.count };
            } else if (table === "bookings") {
              result = { data: null, error: opts.bookings?.error ?? null, count: opts.bookings?.count === undefined ? 0 : opts.bookings.count };
            } else if (table === "places" && localMethods.has("delete")) {
              result = { data: opts.delete?.rows ?? [], error: opts.delete?.error ?? null };
            } else if (table === "places" && localMethods.has("update")) {
              result = { data: opts.update?.rows ?? [], error: null };
            } else {
              result = { data: null, error: null };
            }
            return Promise.resolve(result).then(res, rej);
          };
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); localMethods.add(method); return chain; };
      },
    });
    return chain;
  };
  const db = { from: (table: string) => chainFor(table) } as unknown as SupabaseClient;
  return { db, calls };
}

const has = (calls: Call[], table: string, method: string) => calls.some((c) => c.table === table && c.method === method);

const PLACE_ID = "11111111-1111-4111-8111-111111111111";
const PLACE: PlaceRow = {
  id: PLACE_ID, account_id: "acct_1", contact_id: "ana", client_group_id: null,
  label: null, address: "1 Main St", landmark: null, directions: null,
  city: null, region: null, postal_code: null, country: null,
  archived_at: null, created_by: "user_test", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const CTX: PlaceCtx = { subjectId: "ana", actorId: "user_test" };

describe("removePlace counts bookings too (F-046 part 1)", () => {
  it("no units but a job still books it: archives, and never calls delete (mutation: skip the bookings count -> the delete call is recorded, FAILS)", async () => {
    const { db, calls } = fakeDb({
      place: PLACE,
      equipment: { count: 0 },
      bookings: { count: 1 },
      update: { rows: [{ ...PLACE, archived_at: "2026-10-30T00:00:00Z" }] },
    });
    const r = await removePlace(db, "acct_1", PLACE_ID, CTX);
    expect(r).toMatchObject({ mode: "archived" });
    expect(has(calls, "places", "delete")).toBe(false);
    expect(has(calls, "places", "update")).toBe(true);
  });

  it("a null bookings count THROWS (mutation: restore `?? 0` -> resolves 0 and the delete is attempted, FAILS)", async () => {
    const { db, calls } = fakeDb({ place: PLACE, equipment: { count: 0 }, bookings: { count: null } });
    await expect(removePlace(db, "acct_1", PLACE_ID, CTX))
      .rejects.toThrow(/removePlace booking count failed: no count returned/);
    expect(has(calls, "places", "delete")).toBe(false);
  });

  it("a delete refused by bookings_place_fkey (a job landed between the count and the delete) falls through to archive instead of throwing (mutation: rethrow unconditionally -> FAILS)", async () => {
    const { db } = fakeDb({
      place: PLACE,
      equipment: { count: 0 },
      bookings: { count: 0 },
      delete: { error: { code: "23503", message: 'update or delete on table "places" violates foreign key constraint "bookings_place_fkey"' } },
      update: { rows: [{ ...PLACE, archived_at: "2026-10-30T00:00:00Z" }] },
    });
    const r = await removePlace(db, "acct_1", PLACE_ID, CTX);
    expect(r).toMatchObject({ mode: "archived" });
  });

  it("both counts zero: still deletes, as before (baseline — no job and no unit names it)", async () => {
    const { db, calls } = fakeDb({
      place: PLACE,
      equipment: { count: 0 },
      bookings: { count: 0 },
      delete: { rows: [PLACE] },
    });
    const r = await removePlace(db, "acct_1", PLACE_ID, CTX);
    expect(r).toMatchObject({ mode: "deleted" });
    expect(has(calls, "places", "delete")).toBe(true);
    expect(has(calls, "places", "update")).toBe(false);
  });
});

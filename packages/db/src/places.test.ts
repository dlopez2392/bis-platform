import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addPlace, addEquipment, type PlaceCtx } from "./places";

/**
 * F-115 (migration 0112, plan Task 3 Step 7): representative tests for the "places" and "equipment"
 * writer families (also: updatePlace, setPlaceOwner, removePlace, setPlaceArchived, restorePlace,
 * replaceEquipment, updateEquipment, removeEquipment, restoreEquipment) — the header is sent on the
 * write, and a missing author is refused before any query. Pure: the live round trip is
 * `test/places.test.ts`. Pattern follows `contacts-archive.test.ts`'s `recordingDb`.
 */
function recordingDb(answers: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const headers: { table: string; name: string; value: string }[] = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(answers[table] ?? { data: [], error: null }).then(res, rej);
        }
        if (method === "setHeader") {
          return (name: string, value: string) => { headers.push({ table, name, value }); return chain; };
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const db = { from: (table: string) => chainFor(table) } as unknown as SupabaseClient;
  return { db, calls, headers };
}

const AUTHOR = { authorKind: "person", authorId: "user_owner" } as const;
const CTX: PlaceCtx = { subjectId: "ana", author: AUTHOR };

describe("addPlace", () => {
  it("the insert carries the author on x-bis-author (F-115; mutation: drop withAuthor from the insert -> FAILS)", async () => {
    const { db, headers } = recordingDb({ places: { data: { id: "place-1" }, error: null } });
    await addPlace(db, "acct-1", { contactId: "ana", groupId: null }, {
      label: null, address: "1 Main St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null,
    }, CTX);
    expect(headers).toEqual([
      { table: "places", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the insert runs unattributed, FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(
      addPlace(db, "acct-1", { contactId: "ana", groupId: null },
        { label: null, address: "1 Main St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null },
        { subjectId: "ana", author: undefined as never }),
    ).rejects.toThrow("addPlace: a server write must say who made it");
    expect(calls).toEqual([]);
  });
});

describe("addEquipment", () => {
  it("the insert carries the author on x-bis-author (F-115; mutation: drop withAuthor from the insert -> FAILS)", async () => {
    const { db, headers } = recordingDb({ equipment: { data: { id: "unit-1" }, error: null } });
    await addEquipment(db, "acct-1", "place-1", {
      name: "AC", make: null, model: null, serial: null, notes: null, installed_on: null, warranty_until: null,
    }, CTX);
    expect(headers).toEqual([
      { table: "equipment", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the insert runs unattributed, FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(
      addEquipment(db, "acct-1", "place-1",
        { name: "AC", make: null, model: null, serial: null, notes: null, installed_on: null, warranty_until: null },
        { subjectId: "ana", author: undefined as never }),
    ).rejects.toThrow("addEquipment: a server write must say who made it");
    expect(calls).toEqual([]);
  });
});

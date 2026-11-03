import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addRelationship } from "./relationships";

/**
 * F-115 (migration 0112, plan Task 3 Step 7): `addRelationship` is the representative test for the
 * "relationships" writer family (also: setRelationshipSides, removeRelationship, restoreRelationship) —
 * the header is sent on the write, and a missing author is refused before any query. Pure: the live
 * round trip is `test/relationships.test.ts`. Pattern follows `contacts-archive.test.ts`'s `recordingDb`.
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
const INPUT = {
  contactId: "ana", relatedContactId: "luis", labelKey: "parent" as const, customLabel: null,
  contactForm: null, relatedForm: null, contactCanPickUp: false, contactIsEmergency: false,
  relatedCanPickUp: false, relatedIsEmergency: false,
};

describe("addRelationship", () => {
  it("the insert carries the author on x-bis-author (F-115; mutation: drop withAuthor from the insert -> FAILS)", async () => {
    const { db, headers } = recordingDb({ contact_relationships: { data: { id: "rel-1" }, error: null } });
    await addRelationship(db, "acct-1", INPUT, AUTHOR);
    expect(headers).toEqual([
      { table: "contact_relationships", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the insert runs unattributed, FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(addRelationship(db, "acct-1", INPUT, undefined as never))
      .rejects.toThrow("addRelationship: a server write must say who made it");
    expect(calls).toEqual([]);
  });
});

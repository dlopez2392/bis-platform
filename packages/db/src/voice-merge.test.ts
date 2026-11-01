import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listContactsOnNumber, CONTACTS_ON_NUMBER_LIMIT } from "./voice";

/**
 * Task 6 (F-006, migration 0106, owner ruling D8): Sofía's number lookup after a merge. Pure; the live
 * second-account rule and a real trigger-filed tombstone are CI-only (test/voice-merge-live.test.ts).
 *
 * `recordingDb` is `contacts-merge-resolve.test.ts`'s own (every call recorded, resolved on `then`,
 * answered per sequential `.from(table)` call): `listContactsOnNumber` now runs up to two distinct
 * queries against "contacts" in one call (the number read, then the kept-person batch read), and this
 * task's cases need those two reads to answer differently.
 */
type Answer = { data: unknown; error: unknown };
function recordingDb(responses: Record<string, Answer[]> = {}) {
  const calls: { table: string; method: string; args: unknown[]; call: number }[] = [];
  const nextIndex: Record<string, number> = {};
  let callCounter = 0;
  const db = {
    from: (table: string) => {
      const call = callCounter++;
      const idx = nextIndex[table] ?? 0;
      nextIndex[table] = idx + 1;
      const list = responses[table] ?? [];
      const answer: Answer = list[idx] ?? list[list.length - 1] ?? { data: [], error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, method: string) {
          if (method === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(res, rej);
          }
          return (...args: unknown[]) => { calls.push({ table, method, args, call }); return chain; };
        },
      });
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

function raw(over: Partial<{ id: string; first_name: string | null; last_name: string | null; phone: string | null; email_key: string | null; holds_shared_number: boolean; merged_into: string | null }>) {
  return {
    id: "x", first_name: "Ana", last_name: "Prueba", phone: "+19565550501", email_key: null,
    holds_shared_number: false, merged_into: null, ...over,
  };
}

describe("listContactsOnNumber after a merge (0106, owner ruling D8)", () => {
  it("a tombstone-only hit resolves to the kept person, carrying the TOMBSTONE's own phone (mutation: carry K's own phone -> FAILS)", async () => {
    const { db } = recordingDb({
      contacts: [
        { data: [raw({ id: "T", phone: "+19565550501", merged_into: "K" })], error: null },
        { data: [raw({ id: "K", first_name: "Ana", last_name: "Kept", phone: "+19565550599", merged_into: null })], error: null },
      ],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550501");
    expect(rows).toEqual([{
      id: "K", first_name: "Ana", last_name: "Kept", phone: "+19565550501", email_key: null, holds_shared_number: false,
    }]);
  });

  it("a number held by K's own live row AND by T's tombstone answers ONE row, K's own (mutation: no de-duplication -> two rows)", async () => {
    const { db } = recordingDb({
      contacts: [
        {
          data: [
            raw({ id: "K", first_name: "Ana", last_name: "Kept", phone: "+19565550502", merged_into: null }),
            raw({ id: "T", phone: "+19565550502", merged_into: "K" }),
          ],
          error: null,
        },
        { data: [raw({ id: "K", first_name: "Ana", last_name: "Kept", phone: "+19565550502", merged_into: null })], error: null },
      ],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550502");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: "K", first_name: "Ana", last_name: "Kept", phone: "+19565550502", email_key: null, holds_shared_number: false,
    });
  });

  it("no tombstone in the raw read issues no second query (mutation: always issue the kept read -> an extra 'contacts' call is recorded)", async () => {
    const { db, calls } = recordingDb({
      contacts: [{ data: [raw({ id: "live", merged_into: null })], error: null }],
    });
    await listContactsOnNumber(db, "A", "+19565550503");
    expect(calls.filter((c) => c.table === "contacts" && c.method === "select")).toHaveLength(1);
  });

  it("truncated is computed from the RAW read, before any tombstone substitution (mutation: compute it after de-duplication -> FAILS)", async () => {
    const rawRows = Array.from({ length: CONTACTS_ON_NUMBER_LIMIT + 1 }, (_, i) =>
      raw({ id: i === 0 ? "T" : `live${i}`, merged_into: i === 0 ? "K" : null }));
    const { db } = recordingDb({
      contacts: [
        { data: rawRows, error: null },
        { data: [raw({ id: "K", merged_into: null })], error: null },
      ],
    });
    const { truncated } = await listContactsOnNumber(db, "A", "+19565550504");
    expect(truncated).toBe(true);
  });

  it("live rows come first, then resolved tombstones, each side oldest first (mutation: interleave in raw order -> FAILS)", async () => {
    const { db } = recordingDb({
      contacts: [
        {
          data: [
            raw({ id: "T1", phone: "+19565550505", merged_into: "K1" }),
            raw({ id: "LiveFirst", phone: "+19565550505", merged_into: null }),
            raw({ id: "T2", phone: "+19565550505", merged_into: "K2" }),
          ],
          error: null,
        },
        {
          data: [
            raw({ id: "K1", first_name: "K1name", merged_into: null }),
            raw({ id: "K2", first_name: "K2name", merged_into: null }),
          ],
          error: null,
        },
      ],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550505");
    expect(rows.map((r) => r.id)).toEqual(["LiveFirst", "K1", "K2"]);
  });
});

describe("listContactsOnNumber { live: true } (F-046 follow-up: the Add job sheet's \"Use Ana?\" offer)", () => {
  it("leaves out an archived owner, so the sheet never offers someone it cannot book (mutation: ignore `live` -> FAILS)", async () => {
    const { db } = recordingDb({
      contacts: [{ data: [{ ...raw({ id: "ARCH" }), archived_at: "2026-10-01T00:00:00Z" }, { ...raw({ id: "LIVE", first_name: "Beto" }), archived_at: null }], error: null }],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550501", { live: true });
    expect(rows.map((r) => r.id)).toEqual(["LIVE"]);
  });

  it("leaves out a tombstone whose kept person is archived (the merged-away number resolves to nobody live)", async () => {
    const { db } = recordingDb({
      contacts: [
        { data: [{ ...raw({ id: "T", merged_into: "K" }), archived_at: null }], error: null },
        { data: [{ ...raw({ id: "K", first_name: "Ana", last_name: "Kept" }), archived_at: "2026-10-01T00:00:00Z" }], error: null },
      ],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550501", { live: true });
    expect(rows).toEqual([]);
  });

  it("without `live` an archived owner still comes back (callers on a call or a text still recognise them), in the six-column shape", async () => {
    const { db } = recordingDb({
      contacts: [{ data: [{ ...raw({ id: "ARCH" }), archived_at: "2026-10-01T00:00:00Z" }], error: null }],
    });
    const { rows } = await listContactsOnNumber(db, "A", "+19565550501");
    expect(rows).toEqual([{ id: "ARCH", first_name: "Ana", last_name: "Prueba", phone: "+19565550501", email_key: null, holds_shared_number: false }]);
  });
});

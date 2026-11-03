import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGroupWithMember, updateGroup, setContactsBusiness } from "./client-groups";

/**
 * F-115 (migration 0112, plan Task 3 Step 7, LOAD-BEARING 4 — group writes are service-only): the
 * representative tests for the "groups" writer family (also: addContactToGroup, setContactsBusiness,
 * undoSetBusiness, setGroupPrimaryContact, setPrimaryMembership, removeMembership, restoreMembership,
 * updateMembership) — one RPC writer (`createGroupWithMember`) and one direct `.update()` writer
 * (`updateGroup`). The header is sent on the write, and a missing author is refused before any query.
 * Pure: the live round trip is `test/client-groups.test.ts`. Pattern follows `contact-merge.test.ts`'s
 * `fakeDb` (a builder with `setHeader`, since `withAuthor` calls it before the rpc/query is awaited).
 */
function fakeDb(opts: { rpc?: Record<string, unknown>; from?: Record<string, unknown> } = {}) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  const fromCalls: { table: string; method: string; args: unknown[] }[] = [];
  const headers: { fn: string; name: string; value: string }[] = [];
  const db = {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const answer = (opts.rpc ?? {})[name] ?? { data: null, error: null };
      const builder = {
        setHeader(headerName: string, value: string) { headers.push({ fn: name, name: headerName, value }); return builder; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(answer).then(res, rej); },
      };
      return builder;
    },
    from: (table: string) => {
      const answer = (opts.from ?? {})[table] ?? { data: null, error: null };
      const chain: unknown = new Proxy({}, {
        get(_t, method: string) {
          if (method === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(answer).then(res, rej);
          }
          if (method === "setHeader") {
            return (name: string, value: string) => { headers.push({ fn: `from:${table}`, name, value }); return chain; };
          }
          return (...args: unknown[]) => { fromCalls.push({ table, method, args }); return chain; };
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, rpcCalls, fromCalls, headers };
}

const AUTHOR = { authorKind: "person", authorId: "user_owner" } as const;

describe("createGroupWithMember", () => {
  it("the RPC carries the author on x-bis-author (F-115; mutation: drop withAuthor from the rpc call -> FAILS)", async () => {
    const { db, headers } = fakeDb({
      rpc: { create_group_with_member: { data: { status: "ok", group_id: "g1", member_id: "m1", existed: false, name: "Garcia" }, error: null } },
      from: { events: { data: null, error: null } },
    });
    await createGroupWithMember(db, "acct-1", "ana", "household", "Garcia", null, AUTHOR);
    expect(headers).toEqual([
      { fn: "create_group_with_member", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the rpc runs unattributed, FAILS)", async () => {
    const { db, rpcCalls } = fakeDb();
    await expect(createGroupWithMember(db, "acct-1", "ana", "household", "Garcia", null, undefined as never))
      .rejects.toThrow("createGroupWithMember: a server write must say who made it");
    expect(rpcCalls).toEqual([]);
  });
});

describe("updateGroup", () => {
  it("the update carries the author on x-bis-author (F-115; mutation: drop withAuthor from the update -> FAILS)", async () => {
    const { db, headers } = fakeDb({
      from: {
        client_groups: { data: { id: "g1", kind: "household", name: "Old", billing_address: null }, error: null },
        events: { data: null, error: null },
      },
    });
    await updateGroup(db, "acct-1", "g1", { name: "New" }, AUTHOR);
    expect(headers).toEqual([
      { fn: "from:client_groups", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner" }) },
    ]);
  });

  it("a missing author is refused before any query (F-115; mutation: drop requireAuthor -> the update runs unattributed, FAILS)", async () => {
    const { db, fromCalls } = fakeDb();
    await expect(updateGroup(db, "acct-1", "g1", { name: "New" }, undefined as never))
      .rejects.toThrow("updateGroup: a server write must say who made it");
    expect(fromCalls).toEqual([]);
  });
});

// F-115 M3 (demo/seed.ts): setContactsBusiness gained the same optional `via` createOpportunity
// already had, so the demo seed's business-name write can name itself "seed" too.
describe("setContactsBusiness", () => {
  it("passes an optional via through to the RPC's author header (F-115 M3; mutation: drop via from withAuthor -> FAILS)", async () => {
    const { db, headers } = fakeDb({
      rpc: { set_contacts_business: { data: [{ contact_id: "c1", status: "ok", removed: null, added: "m1" }], error: null } },
      from: { events: { data: null, error: null } },
    });
    await setContactsBusiness(db, "acct-1", [{ contactId: "c1", name: "Acme" }], AUTHOR, "seed");
    expect(headers).toEqual([
      { fn: "set_contacts_business", name: "x-bis-author", value: JSON.stringify({ kind: "person", id: "user_owner", via: "seed" }) },
    ]);
  });
});

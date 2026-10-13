import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listGroupMembers, countGroupMembers, listGroupPeople, setGroupPrimaryContact, removeMembership,
  GROUP_MEMBERS_PAGE_SIZE, GROUP_ACTIVITY_CAP,
} from "../client-groups";
import { addPlace, listGroupPlaces } from "../places";
import { listOpenDealsFor, GROUP_DEALS_SHOWN } from "../opportunities";

/**
 * S-03 part 2's group reads and write on a fake client (no database; client-groups-guards.test.ts
 * is the precedent). This pins the QUERY each function builds and what it does with the answer, so
 * the mutation probes named below run locally; group-members.test.ts proves the same functions
 * against PostgREST on CI `verify`.
 */

type Call = [string, unknown[]];
type Query = { table: string; calls: Call[] };
type Answer = { data?: unknown; count?: number | null; error?: { message: string; code?: string } | null };

function recordingDb(respond: (q: Query) => Answer, rpcAnswer?: unknown) {
  const queries: Query[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const q: Query = { table, calls: [] };
      queries.push(q);
      const answer = () => {
        const a = respond(q);
        return { data: a.data ?? null, count: a.count === undefined ? null : a.count, error: a.error ?? null };
      };
      const chain: Record<string, unknown> = new Proxy({}, {
        get(_t, k) {
          if (k === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
          if (k === "maybeSingle" || k === "single") return async () => { q.calls.push([String(k), []]); return answer(); };
          return (...a: unknown[]) => { q.calls.push([String(k), a]); return chain; };
        },
      });
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: rpcAnswer, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, queries, rpcs };
}

const has = (q: Query, k: string, ...a: unknown[]) => q.calls.some(([ck, ca]) => ck === k && JSON.stringify(ca) === JSON.stringify(a));
const G = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const T = "2026-10-13T12:00:00.000001+00:00";
const row = (i: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, contact_id: `c${i}`, role: null, is_billing: false,
  is_primary_contact: false, created_at: T, contacts: { first_name: `P${i}`, last_name: "Garcia", phone: null, email: null }, ...over,
});

describe("listGroupMembers (spec §6, C10)", () => {
  it("reads the holder apart and keeps them OUT of the page's rows (mutation: drop .eq('is_primary_contact', false) -> FAILS)", async () => {
    const { db, queries } = recordingDb((q) => has(q, "maybeSingle") ? { data: row(9, { is_primary_contact: true }) } : { data: [row(1)] });
    const page = await listGroupMembers(db, "acct", G);
    const [held, rest] = [queries.find((q) => has(q, "maybeSingle"))!, queries.find((q) => !has(q, "maybeSingle"))!];
    expect(has(held, "eq", "is_primary_contact", true)).toBe(true);
    expect(has(rest, "eq", "is_primary_contact", false)).toBe(true);
    for (const q of [held, rest]) {
      expect(has(q, "eq", "account_id", "acct")).toBe(true);
      expect(has(q, "eq", "client_group_id", G)).toBe(true);
    }
    expect(page.primary).toMatchObject({ contactId: "c9", isPrimaryContact: true, firstName: "P9" });
    expect(page.members.map((m) => m.contactId)).toEqual(["c1"]);
  });

  it("asks for one row past the page, ordered (created_at, id), and hands back the last SHOWN row as the cursor (mutation: limit(limit) -> next is always null, FAILS)", async () => {
    const rows = Array.from({ length: GROUP_MEMBERS_PAGE_SIZE + 1 }, (_, i) => row(i + 1));
    const { db, queries } = recordingDb((q) => has(q, "maybeSingle") ? { data: null } : { data: rows });
    const page = await listGroupMembers(db, "acct", G);
    const rest = queries.find((q) => !has(q, "maybeSingle"))!;
    expect(has(rest, "order", "created_at", { ascending: true })).toBe(true);
    expect(has(rest, "order", "id", { ascending: true })).toBe(true);
    expect(has(rest, "limit", GROUP_MEMBERS_PAGE_SIZE + 1)).toBe(true);
    expect(page.members).toHaveLength(GROUP_MEMBERS_PAGE_SIZE);
    expect(page.next).toEqual({ v: T, id: rows[GROUP_MEMBERS_PAGE_SIZE - 1]!.id });
    expect(page.primary).toBeNull();
  });

  it("past a cursor it breaks a created_at tie on id (mutation: compare created_at only -> FAILS)", async () => {
    const { db, queries } = recordingDb((q) => has(q, "maybeSingle") ? { data: null } : { data: [] });
    await listGroupMembers(db, "acct", G, { after: { v: T, id: M.toUpperCase() } });
    const rest = queries.find((q) => !has(q, "maybeSingle"))!;
    expect(rest.calls.filter(([k]) => k === "or")).toEqual([["or", [`created_at.gt."${T}",and(created_at.eq."${T}",id.gt.${M})`]]]);
  });

  it("refuses a malformed cursor before any read (mutation: drop the isTimelineInstant/uuid check -> the raw text reaches .or(), FAILS)", async () => {
    for (const after of [{ v: "not-a-time", id: M }, { v: T, id: "x),id.gt.(0" }]) {
      const { db, queries } = recordingDb(() => ({ data: [] }));
      await expect(listGroupMembers(db, "acct", G, { after })).rejects.toThrow(TypeError);
      expect(queries.flatMap((q) => q.calls.filter(([k]) => k === "or"))).toEqual([]);
    }
  });

  it("a read error throws, never reads as an empty group (mutation: ignore page.error -> FAILS)", async () => {
    const { db } = recordingDb((q) => has(q, "maybeSingle") ? { data: null } : { error: { message: "down" } });
    await expect(listGroupMembers(db, "acct", G)).rejects.toThrow(/listGroupMembers failed: down/);
  });
});

describe("countGroupMembers and listGroupPeople", () => {
  it("countGroupMembers throws on a count-less answer (mutation: return count ?? 0 -> resolves 0, FAILS)", async () => {
    const { db } = recordingDb(() => ({ count: null }));
    await expect(countGroupMembers(db, "acct", G)).rejects.toThrow("countGroupMembers failed: no count returned");
  });

  it("countGroupMembers is an exact HEAD count of this group in this account", async () => {
    const { db, queries } = recordingDb(() => ({ count: 7 }));
    expect(await countGroupMembers(db, "acct", G)).toBe(7);
    expect(has(queries[0]!, "select", "id", { count: "exact", head: true })).toBe(true);
    expect(has(queries[0]!, "eq", "client_group_id", G)).toBe(true);
  });

  it("listGroupPeople defaults to GROUP_ACTIVITY_CAP in joined order and drops a row whose contact the caller cannot see (mutation: drop the contacts !== null filter -> FAILS)", async () => {
    const { db, queries } = recordingDb(() => ({ data: [
      { contact_id: "c1", contacts: { first_name: "Ana", last_name: null } },
      { contact_id: "c2", contacts: null },
    ] }));
    expect(await listGroupPeople(db, "acct", G)).toEqual([{ contactId: "c1", firstName: "Ana", lastName: null }]);
    expect(has(queries[0]!, "limit", GROUP_ACTIVITY_CAP)).toBe(true);
    expect(has(queries[0]!, "order", "created_at", { ascending: true })).toBe(true);
  });
});

describe("setGroupPrimaryContact and removeMembership's event", () => {
  it("calls 0075's function with the three named arguments and hands back the previous holder", async () => {
    const { db, rpcs, queries } = recordingDb(() => ({}), { status: "ok", previous: M });
    expect(await setGroupPrimaryContact(db, "acct", G, null, "user_1")).toEqual({ status: "ok", previous: M });
    expect(rpcs).toEqual([{ fn: "set_group_primary_contact", args: { p_account_id: "acct", p_group_id: G, p_member_id: null } }]);
    const ev = queries.find((q) => q.table === "events")!;
    expect(ev.calls[0]![1][0]).toMatchObject({ type: "client_group.member_updated", payload: { groupId: G, memberId: null, previous: M, fields: ["is_primary_contact"] } });
  });

  it("a refusal is not_found and records no event (mutation: emit before the status check -> FAILS)", async () => {
    const { db, queries } = recordingDb(() => ({}), { status: "not_found" });
    expect(await setGroupPrimaryContact(db, "acct", G, M, "user_1")).toEqual({ status: "not_found" });
    expect(queries.filter((q) => q.table === "events")).toEqual([]);
  });

  it("removeMembership's event says whether the removed member was who we call first (mutation: drop wasPrimaryContact -> FAILS)", async () => {
    for (const flag of [true, false]) {
      const removed = { id: M, account_id: "acct", client_group_id: G, contact_id: "c1", role: null, is_primary: false, is_billing: false, is_primary_contact: flag, created_at: T };
      const { db, queries } = recordingDb(() => ({}), { status: "ok", removed });
      await removeMembership(db, "acct", M, "user_1");
      const ev = queries.find((q) => q.table === "events")!;
      expect((ev.calls[0]![1][0] as { payload: unknown }).payload).toEqual({ memberId: M, contactId: "c1", groupId: G, wasPrimaryContact: flag });
    }
  });
});

describe("places: a group subject and the group's own places (C12)", () => {
  const fields = { label: "The house", address: "1 Main St", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null };

  it("an event taken from a group's page names groupId and never contactId; a contact's still names contactId (mutation: ignore subjectKind -> FAILS)", async () => {
    for (const [ctx, want, not] of [
      [{ subjectId: G, subjectKind: "group" as const, actorId: "user_1" }, { groupId: G }, "contactId"],
      [{ subjectId: "c1", actorId: "user_1" }, { contactId: "c1" }, "groupId"],
    ] as const) {
      const { db, queries } = recordingDb((q) => q.table === "places" ? { data: { id: "p1" } } : {});
      await addPlace(db, "acct", { contactId: null, groupId: G }, fields, ctx);
      const payload = (queries.find((q) => q.table === "events")!.calls[0]![1][0] as { payload: Record<string, unknown> }).payload;
      expect(payload).toEqual({ ...want, placeId: "p1" });
      expect(payload).not.toHaveProperty(not);
    }
  });

  it("listGroupPlaces filters on client_group_id alone, never a member's own (mutation: an .or() with contact_id -> FAILS), and groups is []", async () => {
    const { db, queries } = recordingDb((q) => q.table === "places" ? { data: [{ id: "p1" }], count: 1 } : { data: [], count: 0 });
    expect(await listGroupPlaces(db, "acct", G)).toEqual({ groups: [], places: [{ id: "p1" }], placeCount: 1, equipment: [], equipmentCount: 0 });
    const places = queries.find((q) => q.table === "places")!;
    expect(has(places, "eq", "client_group_id", G)).toBe(true);
    expect(places.calls.some(([k]) => k === "or")).toBe(false);
    expect(queries.some((q) => q.table === "client_group_members" || q.table === "client_groups")).toBe(false);
  });

  it("listGroupPlaces throws on a count-less answer (mutation: placeCount ?? places.length -> FAILS) and refuses a non-uuid", async () => {
    const { db } = recordingDb(() => ({ data: [], count: null }));
    await expect(listGroupPlaces(db, "acct", G)).rejects.toThrow("listGroupPlaces failed: no count returned");
    await expect(listGroupPlaces(db, "acct", "x")).rejects.toThrow(/not a uuid/);
  });

  it("listGroupPlaces throws on a count-less equipment answer (mutation: count ?? equipment.length -> FAILS)", async () => {
    const { db } = recordingDb((q) => q.table === "places" ? { data: [{ id: "p1" }], count: 1 } : { data: [], count: null });
    await expect(listGroupPlaces(db, "acct", G)).rejects.toThrow("listGroupPlaces failed: no equipment count returned");
  });
});

describe("listOpenDealsFor (C13)", () => {
  it("open deals of the set only, newest first, capped, with an exact count (mutation: drop .eq('status','open') -> FAILS)", async () => {
    const { db, queries } = recordingDb(() => ({ data: [{ id: "o1", contact_id: "c2" }], count: 41 }));
    expect(await listOpenDealsFor(db, "acct", ["c1", "c2"])).toEqual({ deals: [{ id: "o1", contact_id: "c2" }], count: 41 });
    const q = queries[0]!;
    expect(has(q, "eq", "status", "open")).toBe(true);
    expect(has(q, "in", "contact_id", ["c1", "c2"])).toBe(true);
    expect(has(q, "order", "created_at", { ascending: false })).toBe(true);
    expect(has(q, "limit", GROUP_DEALS_SHOWN)).toBe(true);
  });

  it("an empty set reads nothing; a count-less answer throws (mutation: count ?? deals.length -> FAILS)", async () => {
    const empty = recordingDb(() => ({}));
    expect(await listOpenDealsFor(empty.db, "acct", [])).toEqual({ deals: [], count: 0 });
    expect(empty.queries).toEqual([]);
    const { db } = recordingDb(() => ({ data: [], count: null }));
    await expect(listOpenDealsFor(db, "acct", ["c1"])).rejects.toThrow("listOpenDealsFor failed: no count returned");
  });
});

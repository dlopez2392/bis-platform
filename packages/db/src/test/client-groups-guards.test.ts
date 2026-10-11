import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createGroupWithMember, addContactToGroup, searchGroups, setContactsBusiness, listContactGroups,
  GROUP_ROLE_MAX, GROUP_OTHERS_SHOWN,
} from "../client-groups";

/**
 * Review fixes on a fake client (no database — see assignment-guards.test.ts
 * for the precedent). Two things pinned here:
 *
 * 1. searchGroups must refuse a term that SANITIZES to nothing before it ever
 *    queries. A bare "%", "*" or "\" survives `term.trim()` (none of them are
 *    whitespace) but sanitizeSearchTerm strips all three to "", and `%${s}%`
 *    with s = "" is the pattern "%%" — which matches every row, not none.
 * 2. roleTooLong must measure a role's length after trimming ONLY the
 *    database's own whitespace class (`app.group_ws`: space, \t, \n, \v, \f,
 *    \r, U+00A0) — not JS's `.trim()`, which ALSO strips characters the
 *    database's class does not (U+FEFF among them). `.trim()` is therefore
 *    not just imprecise but can let a role THROUGH the TS guard that the
 *    database's `client_group_members_role_check` (23514) would still
 *    refuse: a role of 58 ordinary characters plus three U+FEFF is 61
 *    characters by the database's own count (U+FEFF is not in its class, so
 *    nothing trims it off the end), but JS's `.trim()` strips those same
 *    three characters, reporting 58 — UNDER the cap. That is the opposite
 *    of harmless: it is exactly the raw-23514 leak this guard exists to
 *    prevent, just for a rarer input than a plain over-length string.
 */

function throwingDb(what: string): SupabaseClient {
  return {
    from() { throw new Error(`${what}: must not query`); },
    rpc() { throw new Error(`${what}: must not call rpc`); },
  } as unknown as SupabaseClient;
}

describe("searchGroups refuses a term that sanitizes to nothing, before it ever queries (mutation: drop `if (!s) return [];` -> FAILS)", () => {
  for (const term of ["%", "*", "\\"]) {
    it(`a bare ${JSON.stringify(term)} makes no query and returns []`, async () => {
      expect(await searchGroups(throwingDb("searchGroups"), "acct", term)).toEqual([]);
    });
  }
});

function recordingRpcDb(rpcAnswer: unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from() {
      // emit()'s events insert on the happy path; always succeeds, unrecorded.
      return { insert: async () => ({ error: null }) };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: rpcAnswer, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("roleTooLong measures the database's own whitespace class, not JS's broader .trim() (mutation: swap it back for role.trim().length -> FAILS)", () => {
  const paddedWithFeff = "x".repeat(58) + "﻿﻿﻿"; // 61 chars; JS .trim() reports 58, the DB's class reports 61
  const atTheCap = "x".repeat(GROUP_ROLE_MAX); // 60 plain characters: not too long by either measure

  it("a role that is 61 characters by the database's class, but only 58 by JS's .trim(), is still refused before any query (createGroupWithMember)", async () => {
    expect(await createGroupWithMember(throwingDb("createGroupWithMember"), "acct", "contact", "household", "Garcia", paddedWithFeff, "actor"))
      .toEqual({ status: "too_long" });
  });
  it("same, for addContactToGroup", async () => {
    expect(await addContactToGroup(throwingDb("addContactToGroup"), "acct", "contact", "group", paddedWithFeff, "actor"))
      .toEqual({ status: "too_long" });
  });
  it("a role at exactly GROUP_ROLE_MAX plain characters is NOT refused: it reaches the database", async () => {
    const { db, calls } = recordingRpcDb({ status: "ok", group_id: "g1", member_id: "m1", existed: false, name: "Garcia" });
    const r = await createGroupWithMember(db, "acct", "contact", "household", "Garcia", atTheCap, "actor");
    expect(r).toEqual({ status: "ok", groupId: "g1", memberId: "m1", existed: false, name: "Garcia" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("create_group_with_member");
  });
});

/**
 * Final review (deadlock ruling): set_contacts_business is one transaction per
 * call, so a 40P01 rolled ALL of it back and a retry is safe. The wrapper keeps
 * PostgREST's error code, retries a deadlock up to twice, and emits once.
 */
function scriptedRpcDb(answers: { data?: unknown; error?: { code: string; message: string } }[]) {
  let rpcCalls = 0;
  let inserts = 0;
  const db = {
    from() { return { insert: async () => { inserts++; return { error: null }; } }; },
    rpc: async () => {
      const a = answers[Math.min(rpcCalls, answers.length - 1)]!;
      rpcCalls++;
      return { data: a.data ?? null, error: a.error ?? null };
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls: () => rpcCalls, inserts: () => inserts };
}
const DEADLOCK = { code: "40P01", message: "deadlock detected" };
const OK_ROW = [{ contact_id: "c1", status: "ok", removed: null, added: "m1" }];

describe("setContactsBusiness retries a deadlock (mutation: drop the 40P01 retry -> FAILS)", () => {
  it("a deadlock then success: retried, answers the second call's rows, and emits ONCE", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }, { data: OK_ROW }]);
    const r = await setContactsBusiness(s.db, "acct", [{ contactId: "c1", name: "Acme" }], "actor");
    expect(r).toEqual([{ contactId: "c1", status: "ok", removed: null, added: "m1" }]);
    expect(s.rpcCalls()).toBe(2);
    expect(s.inserts()).toBe(1);
  });
  it("gives up after two retries: three calls, then the deadlock is thrown, and nothing is emitted", async () => {
    const s = scriptedRpcDb([{ error: DEADLOCK }]);
    await expect(setContactsBusiness(s.db, "acct", [{ contactId: "c1", name: "Acme" }], "actor")).rejects.toThrow(/deadlock detected/);
    expect(s.rpcCalls()).toBe(3);
    expect(s.inserts()).toBe(0);
  });
  it("any other error is not retried (mutation: retry every error -> FAILS)", async () => {
    const s = scriptedRpcDb([{ error: { code: "57014", message: "canceling statement due to statement timeout" } }, { data: OK_ROW }]);
    await expect(setContactsBusiness(s.db, "acct", [{ contactId: "c1", name: "Acme" }], "actor")).rejects.toThrow(/statement timeout/);
    expect(s.rpcCalls()).toBe(1);
  });
});

/**
 * Final review minor 10: the co-member read is bounded. It asks for at most
 * GROUP_OTHERS_SHOWN names per group and an exact count, which PostgREST takes
 * under the caller's RLS, so "and N more" counts only rows the caller may see.
 */
function listDb(memberRows: unknown[], others: Record<string, { rows: unknown[]; count: number }>) {
  const limits: number[] = [];
  const countModes: unknown[] = [];
  const db = {
    from() {
      let groupId = "";
      let isOthers = false;
      const chain = {
        select(_cols: string, opts?: { count?: string }) { if (opts) { isOthers = true; countModes.push(opts.count); } return chain; },
        eq(col: string, v: string) { if (col === "client_group_id") groupId = v; return chain; },
        neq() { return chain; },
        order() { return chain; },
        limit(n: number) {
          limits.push(n);
          const o = others[groupId] ?? { rows: [], count: 0 };
          return Promise.resolve({ data: o.rows.slice(0, n), count: o.count, error: null });
        },
        then(res: (v: unknown) => unknown) { return Promise.resolve(isOthers ? { data: [], error: null } : { data: memberRows, error: null }).then(res); },
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, limits, countModes };
}

describe("listContactGroups bounds the co-member read and says how many more (minor 10; mutation: drop the limit -> FAILS)", () => {
  const member = (id: string, groupId: string) => ({
    id, role: null, is_primary: id === "m1", is_billing: false, created_at: `2026-01-0${id.slice(1)}`,
    client_groups: { id: groupId, kind: "business", name: `G ${groupId}`, billing_address: null },
  });
  const other = (n: number, groupId: string) => ({ client_group_id: groupId, contact_id: `c${n}`, contacts: { first_name: `P${n}`, last_name: null } });

  it("asks each group for at most GROUP_OTHERS_SHOWN names with an exact count, and moreOthers is the rest", async () => {
    const big = Array.from({ length: GROUP_OTHERS_SHOWN + 3 }, (_, i) => other(i, "g1"));
    const { db, limits, countModes } = listDb([member("m1", "g1"), member("m2", "g2")], {
      g1: { rows: big, count: GROUP_OTHERS_SHOWN + 3 },
      g2: { rows: [other(99, "g2")], count: 1 },
    });
    const groups = await listContactGroups(db, "acct", "me");
    expect(limits).toEqual([GROUP_OTHERS_SHOWN, GROUP_OTHERS_SHOWN]);
    expect(countModes).toEqual(["exact", "exact"]);
    expect(groups.map((g) => [g.groupId, g.others.length, g.moreOthers])).toEqual([
      ["g1", GROUP_OTHERS_SHOWN, 3],
      ["g2", 1, 0],
    ]);
  });
  it("a group whose co-members the caller cannot see (a Technician: RLS returns none, count 0) shows no names and no more", async () => {
    const { db } = listDb([member("m1", "g1")], { g1: { rows: [], count: 0 } });
    const [g] = await listContactGroups(db, "acct", "me");
    expect(g).toMatchObject({ others: [], moreOthers: 0 });
  });
});

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGroupWithMember, addContactToGroup, searchGroups, GROUP_ROLE_MAX } from "../client-groups";

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

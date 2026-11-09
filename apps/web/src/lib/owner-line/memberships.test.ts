import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@bis/db";
import { listMyMemberships, myMembership } from "./memberships";

/**
 * F-032 §3.1: a person's own memberships, for one "Call in to your business" card each. A fake PostgREST builder
 * that records every filter and answers per table; the filters the DATABASE applies (scope, the person's Clerk id,
 * the accounts asked for, the number statuses) are asserted as calls, and what this module filters itself is
 * asserted on its answers.
 */
type Op = [string, ...unknown[]];
function fakeDb(answers: Record<string, { data: unknown; error: { message: string } | null }>) {
  const log: { table: string; ops: Op[] }[] = [];
  const db = {
    from(table: string) {
      const entry = { table, ops: [] as Op[] };
      log.push(entry);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "is", "not", "order", "limit"]) {
        builder[op] = (...args: unknown[]) => { entry.ops.push([op, ...args]); return builder; };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(answers[table] ?? { data: [], error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, log };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const row = (account_id: string, role: string, accounts: Record<string, unknown> | null) =>
  ({ account_id, user_id: `u-${account_id.slice(0, 1)}`, role, users: { clerk_user_id: "user_clerk_me" }, accounts });
const open = (brand_name: string | null) => ({ client_access_enabled: true, status: "active", brand_name, name: "INTERNAL LABEL (trial)" });

describe("listMyMemberships / myMembership (F-032 §3.1)", () => {
  it("asks the database for this person's ACCOUNT memberships only, by their own Clerk id (mutation: drop the clerk_user_id filter -> FAILS)", async () => {
    const f = fakeDb({ memberships: { data: [], error: null } });
    expect(await listMyMemberships(f.db, "user_clerk_me")).toEqual([]);
    const ops = f.log.find((l) => l.table === "memberships")!.ops;
    expect(ops).toContainEqual(["eq", "scope", "account"]);
    expect(ops).toContainEqual(["eq", "users.clerk_user_id", "user_clerk_me"]);
    expect(f.log.map((l) => l.table)).toEqual(["memberships"]);   // no number read for nobody
  });

  it("two businesses: each card carries its OWN number, never the other's, and a live number beats a testing one (mutation: drop the account_id match in the number pick -> FAILS)", async () => {
    const f = fakeDb({
      memberships: { data: [row(A, "staff", open("Rio Roofing")), row(B, "owner", open("Valle Lawn"))], error: null },
      phone_numbers: { data: [
        { account_id: B, e164: "+19565550200", status: "testing" },
        { account_id: A, e164: "+19565550101", status: "testing" },
        { account_id: A, e164: "+19565550100", status: "live" },
      ], error: null },
    });
    const list = await listMyMemberships(f.db, "user_clerk_me");
    expect(list).toEqual([
      { accountId: A, userId: "u-1", role: "staff", businessName: "Rio Roofing", number: "+19565550100" },
      { accountId: B, userId: "u-2", role: "owner", businessName: "Valle Lawn", number: "+19565550200" },
    ]);
    const nums = f.log.find((l) => l.table === "phone_numbers")!.ops;
    expect(nums).toContainEqual(["in", "account_id", [A, B]]);
    expect(nums).toContainEqual(["in", "status", ["live", "testing"]]);
  });

  it("a business with client access off, or archived, is not offered (mutation: drop either filter -> FAILS)", async () => {
    const f = fakeDb({
      memberships: { data: [
        row(A, "staff", open("Rio Roofing")),
        row(B, "staff", { ...open("Off Co"), client_access_enabled: false }),
        row(C, "staff", { ...open("Gone Co"), status: "archived" }),
        row(D, "staff", null),
      ], error: null },
      phone_numbers: { data: [], error: null },
    });
    expect((await listMyMemberships(f.db, "user_clerk_me")).map((m) => m.accountId)).toEqual([A]);
    expect(f.log.find((l) => l.table === "phone_numbers")!.ops).toContainEqual(["in", "account_id", [A]]);
  });

  it("the business's name is its brand name, never accounts.name; no number reads as null", async () => {
    const f = fakeDb({ memberships: { data: [row(A, "staff", open(null))], error: null }, phone_numbers: { data: [], error: null } });
    const [only] = await listMyMemberships(f.db, "user_clerk_me");
    expect(only!.businessName).not.toContain("INTERNAL");
    expect(only!.businessName).toBe("");
    expect(only!.number).toBeNull();
  });

  it("myMembership returns the business asked for, and null for one the person is not on (second account)", async () => {
    const f = fakeDb({
      memberships: { data: [row(A, "staff", open("Rio Roofing")), row(B, "owner", open("Valle Lawn"))], error: null },
      phone_numbers: { data: [], error: null },
    });
    expect((await myMembership(f.db, "user_clerk_me", B))?.userId).toBe("u-2");
    expect(await myMembership(f.db, "user_clerk_me", C)).toBeNull();
  });

  it("a failed read throws, naming itself (never an empty list that reads as 'not a member')", async () => {
    await expect(listMyMemberships(fakeDb({ memberships: { data: null, error: { message: "boom" } } }).db, "x"))
      .rejects.toThrow("listMyMemberships failed: boom");
    await expect(listMyMemberships(fakeDb({
      memberships: { data: [row(A, "staff", open("Rio"))], error: null },
      phone_numbers: { data: null, error: { message: "nope" } },
    }).db, "x")).rejects.toThrow("listMyMemberships numbers failed: nope");
  });
});

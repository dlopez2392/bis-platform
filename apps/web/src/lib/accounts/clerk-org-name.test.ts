import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@bis/db";
import { syncClerkOrgName, type ClerkOrgWriter } from "./clerk-org-name";

// D-005: Clerk's invitation email names the Clerk organisation, and that name
// was set once, at creation, and never again. These fakes stand in for the
// account read and the Clerk Backend API; no real provider is called.

function fakeDb(row: { clerk_org_id: string | null } | null, error: { message: string } | null = null) {
  const eqs: Array<[string, unknown]> = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("accounts");
      return {
        select: (cols: string) => {
          expect(cols).toBe("clerk_org_id");
          return {
            eq: (col: string, val: unknown) => {
              eqs.push([col, val]);
              return { maybeSingle: async () => ({ data: row, error }) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, eqs };
}

function fakeClerk(fail?: Error) {
  const calls: Array<[string, { name: string }]> = [];
  const clerk: ClerkOrgWriter = {
    organizations: {
      updateOrganization: async (id, params) => {
        calls.push([id, params]);
        if (fail) throw fail;
        return {};
      },
    },
  };
  return { clerk, calls };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe("syncClerkOrgName (D-005)", () => {
  it("renames THIS account's Clerk organisation to the given name (mutation: skip the update → FAILS; update by account id instead of org id → FAILS)", async () => {
    const { db, eqs } = fakeDb({ clerk_org_id: "org_abc" });
    const { clerk, calls } = fakeClerk();
    expect(await syncClerkOrgName(db, async () => clerk, "acct_1", "Rio Roofing")).toBe(true);
    expect(eqs).toEqual([["id", "acct_1"]]);
    expect(calls).toEqual([["org_abc", { name: "Rio Roofing" }]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails soft: a Clerk error is logged as a warning naming the org, and never thrown (mutation: rethrow → FAILS)", async () => {
    const { db } = fakeDb({ clerk_org_id: "org_abc" });
    const { clerk } = fakeClerk(new Error("clerk 503"));
    expect(await syncClerkOrgName(db, async () => clerk, "acct_1", "Rio Roofing")).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("org_abc");
  });

  it("fails soft when the account read fails, or the account has no Clerk organisation", async () => {
    const { clerk, calls } = fakeClerk();
    expect(await syncClerkOrgName(fakeDb(null, { message: "boom" }).db, async () => clerk, "acct_1", "X")).toBe(false);
    expect(await syncClerkOrgName(fakeDb({ clerk_org_id: null }).db, async () => clerk, "acct_1", "X")).toBe(false);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("fails soft when the Clerk client itself cannot be built (a missing key)", async () => {
    const { db } = fakeDb({ clerk_org_id: "org_abc" });
    expect(await syncClerkOrgName(db, async () => { throw new Error("no key"); }, "acct_1", "X")).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});

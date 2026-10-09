import { describe, it, expect, vi } from "vitest";
import { STALE_AFTER_MS } from "./stale";
import { emptySweepReport, sweepClerkOrgs, sweepClerkUsers, sweepStaleAccounts, type ClerkForSweep } from "./sweep";

// A real stamp shape (see stale.test.ts), old enough to be stale against NOW.
const STAMP = 1786412389258;
const NOW = STAMP + STALE_AFTER_MS + 1;

/** Builds a paged fake of Clerk's org list: `total` orgs named
 *  `E2E Co <STAMP>-<n>` (all stale) plus one FRESH org appended at the very
 *  end — landing it on the last page — named with a stamp moments before
 *  `NOW`, so it must survive the sweep. Clerk's own `limit`/`offset` shape
 *  (`getOrganizationList`, `PaginatedResourceResponse.totalCount`) is
 *  reproduced exactly: `data` sliced to the requested page, `totalCount` the
 *  full remaining count. */
function fakeOrgs(staleCount: number) {
  // Subtracting `i` (not adding) keeps every one of these OLDER than STAMP,
  // and STAMP itself is already `STALE_AFTER_MS + 1` before NOW — adding `i`
  // would claw the later entries back under the staleness window instead.
  const stale = Array.from({ length: staleCount }, (_, i) => ({
    id: `org_stale_${i}`,
    name: `E2E Co ${STAMP - i}`,
  }));
  const fresh = { id: "org_fresh", name: `E2E Co ${NOW - 1000}` };
  const all = [...stale, fresh];
  const deleted: string[] = [];
  const getOrganizationList = vi.fn(
    async ({ limit, offset }: { limit?: number; offset?: number }) => {
      const l = limit ?? 100;
      const o = offset ?? 0;
      return { data: all.slice(o, o + l), totalCount: all.length };
    },
  );
  const deleteOrganization = vi.fn(async (id: string) => {
    deleted.push(id);
  });
  const clerk = {
    users: { getUserList: vi.fn(), deleteUser: vi.fn() },
    organizations: { getOrganizationList, deleteOrganization },
  } as unknown as ClerkForSweep;
  return { clerk, all, deleted, getOrganizationList };
}

describe("sweepClerkOrgs", () => {
  it("pages past the first 100 and deletes every stale org, keeping a fresh one on page 2", async () => {
    const { clerk, deleted, getOrganizationList } = fakeOrgs(150);
    const report = emptySweepReport();

    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ false);

    // 151 total (150 stale + 1 fresh) needs two pages at limit 100: 100 + 51.
    expect(getOrganizationList).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    expect(getOrganizationList).toHaveBeenCalledWith({ limit: 100, offset: 100 });

    expect(report.clerkOrgs).toHaveLength(150);
    expect(deleted).toHaveLength(150);
    expect(deleted).not.toContain("org_fresh");
    expect(report.errors).toEqual([]);
  });

  it("does not delete anything in dry-run mode, but still reports it", async () => {
    const { clerk, deleted } = fakeOrgs(150);
    const report = emptySweepReport();

    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ true);

    expect(report.clerkOrgs).toHaveLength(150);
    expect(deleted).toHaveLength(0);
  });

  // The mutation this pins: reverting to a single `getOrganizationList({ limit:
  // 100 })` call reads only the newest 100 orgs. With 150 stale orgs, the 50
  // oldest never come back from the fake at all, so this fails on count alone.
  it("MUTATION GUARD: reading only the first page misses everything past offset 100", async () => {
    const { clerk } = fakeOrgs(150);
    const report = emptySweepReport();

    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ true);

    expect(report.clerkOrgs.length).toBeGreaterThan(100);
  });

  it("stops on an empty page instead of looping forever", async () => {
    const getOrganizationList = vi.fn(async () => ({ data: [], totalCount: 0 }));
    const clerk = {
      users: { getUserList: vi.fn(), deleteUser: vi.fn() },
      organizations: { getOrganizationList, deleteOrganization: vi.fn() },
    } as unknown as ClerkForSweep;
    const report = emptySweepReport();

    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, true);

    expect(getOrganizationList).toHaveBeenCalledTimes(1);
    expect(report.clerkOrgs).toEqual([]);
  });

  it("reports (not throws) when the Clerk call fails", async () => {
    const getOrganizationList = vi.fn(async () => {
      throw new Error("clerk is down");
    });
    const clerk = {
      users: { getUserList: vi.fn(), deleteUser: vi.fn() },
      organizations: { getOrganizationList, deleteOrganization: vi.fn() },
    } as unknown as ClerkForSweep;
    const report = emptySweepReport();

    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, true);

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain("clerk orgs");
  });
});

describe("sweepClerkUsers", () => {
  /** Same two-page shape as fakeOrgs, for the user list's own query param
   *  (`query: "e2e-"`) and email-keyed staleness. */
  function fakeUsers(staleCount: number) {
    const stale = Array.from({ length: staleCount }, (_, i) => ({
      id: `user_stale_${i}`,
      emailAddresses: [{ emailAddress: `e2e-client-${STAMP - i}@example.com` }],
    }));
    const fresh = {
      id: "user_fresh",
      emailAddresses: [{ emailAddress: `e2e-client-${NOW - 1000}@example.com` }],
    };
    const all = [...stale, fresh];
    const deleted: string[] = [];
    const getUserList = vi.fn(
      async ({ limit, offset }: { query?: string; limit?: number; offset?: number }) => {
        const l = limit ?? 100;
        const o = offset ?? 0;
        return { data: all.slice(o, o + l), totalCount: all.length };
      },
    );
    const deleteUser = vi.fn(async (id: string) => {
      deleted.push(id);
    });
    const clerk = {
      users: { getUserList, deleteUser },
      organizations: { getOrganizationList: vi.fn(), deleteOrganization: vi.fn() },
    } as unknown as ClerkForSweep;
    return { clerk, deleted, getUserList };
  }

  it("pages past the first 100 and deletes every stale user, keeping a fresh one on page 2", async () => {
    const { clerk, deleted, getUserList } = fakeUsers(150);
    const report = emptySweepReport();

    await sweepClerkUsers(clerk, report, NOW, STALE_AFTER_MS, false);

    expect(getUserList).toHaveBeenCalledWith({ query: "e2e-", limit: 100, offset: 0 });
    expect(getUserList).toHaveBeenCalledWith({ query: "e2e-", limit: 100, offset: 100 });
    expect(report.clerkUsers).toHaveLength(150);
    expect(deleted).toHaveLength(150);
    expect(deleted).not.toContain("user_fresh");
  });
});

/**
 * The accounts leg must take each stale fixture account's Clerk org with it,
 * BY ID. D-005 renames an org to its brand name on every Branding save, and
 * the per-run fixture's brand is "Rio Roofing <stamp>" (auth.setup.ts), so
 * after client-branding.spec runs, its org no longer matches any fixture
 * NAME pattern and sweepClerkOrgs can never find it: a killed run used to
 * strand it for good.
 */
describe("sweepStaleAccounts — the Clerk org behind each stale fixture account", () => {
  function fakeDb(rows: Array<{ id: string; name: string; clerk_org_id: string | null }>) {
    const deletes: string[] = [];
    const db = {
      from: (table: string) => ({
        select: () => ({ like: async () => ({ data: rows, error: null }) }),
        delete: () => ({
          eq: async (_col: string, val: string) => { deletes.push(`${table}:${val}`); return { error: null }; },
        }),
      }),
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
    };
    return { db: db as unknown as Parameters<typeof sweepStaleAccounts>[0], deletes };
  }
  function fakeClerk(fail?: (id: string) => unknown) {
    const order: string[] = [];
    const deleteOrganization = vi.fn(async (id: string) => {
      order.push(`org:${id}`);
      const err = fail?.(id);
      if (err) throw err;
    });
    const clerk = {
      users: { getUserList: vi.fn(), deleteUser: vi.fn() },
      organizations: { getOrganizationList: vi.fn(), deleteOrganization },
    } as unknown as ClerkForSweep;
    return { clerk, deleteOrganization, order };
  }
  const STALE_ROW = { id: "acct_stale", name: `E2E Client Co ${STAMP}`, clerk_org_id: "org_renamed_to_brand" };
  const FRESH_ROW = { id: "acct_fresh", name: `E2E Client Co ${NOW - 1000}`, clerk_org_id: "org_fresh" };
  const REAL_ROW = { id: "acct_real", name: "E2E Client Co-op 1786412389258", clerk_org_id: "org_real" };

  it("deletes a stale fixture account's org by its clerk_org_id, before the row, and touches no other org (mutation: drop the org delete → FAILS)", async () => {
    const { db, deletes } = fakeDb([STALE_ROW, FRESH_ROW, REAL_ROW]);
    // Org FIRST: if the row went first and the Clerk call then failed, nothing
    // would be left that points at the org at all.
    let rowAlreadyGone: boolean | undefined;
    const { clerk, deleteOrganization } = fakeClerk(() => { rowAlreadyGone = deletes.includes("accounts:acct_stale"); });
    const report = emptySweepReport();
    await sweepStaleAccounts(db, clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ false);
    expect(deleteOrganization.mock.calls).toEqual([["org_renamed_to_brand"]]);
    expect(rowAlreadyGone).toBe(false);
    expect(report.clerkOrgs).toEqual([{ id: "org_renamed_to_brand", name: STALE_ROW.name }]);
    expect(deletes).toContain("accounts:acct_stale");
    expect(deletes.some((d) => d.endsWith("acct_fresh") || d.endsWith("acct_real"))).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it("dry run reports the org and deletes nothing", async () => {
    const { db, deletes } = fakeDb([STALE_ROW]);
    const { clerk, deleteOrganization } = fakeClerk();
    const report = emptySweepReport();
    await sweepStaleAccounts(db, clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ true);
    expect(report.clerkOrgs).toEqual([{ id: "org_renamed_to_brand", name: STALE_ROW.name }]);
    expect(deleteOrganization).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });

  it("an org already gone (404) is not an error; any other Clerk failure is reported and the row still goes", async () => {
    const gone = Object.assign(new Error("not found"), { status: 404 });
    const a = fakeClerk(() => gone);
    const r1 = emptySweepReport();
    await sweepStaleAccounts(fakeDb([STALE_ROW]).db, a.clerk, r1, NOW, STALE_AFTER_MS, false);
    expect(r1.errors).toEqual([]);

    const b = fakeClerk(() => Object.assign(new Error("clerk 503"), { status: 503 }));
    const r2 = emptySweepReport();
    const d2 = fakeDb([STALE_ROW]);
    await sweepStaleAccounts(d2.db, b.clerk, r2, NOW, STALE_AFTER_MS, false);
    expect(r2.errors).toHaveLength(1);
    expect(r2.errors[0]).toContain("org_renamed_to_brand");
    expect(d2.deletes).toContain("accounts:acct_stale");
  });
});

describe("sweepClerkOrgs after the accounts leg", () => {
  it("skips an org the accounts leg already took by id: one report line, one delete (mutation: no skip → FAILS)", async () => {
    const { clerk, deleted } = fakeOrgs(1); // org_stale_0 is "E2E Co <stamp>", still named as created
    const report = emptySweepReport();
    report.clerkOrgs.push({ id: "org_stale_0", name: `E2E Co ${STAMP}` });
    await sweepClerkOrgs(clerk, report, NOW, STALE_AFTER_MS, /* dryRun */ false);
    expect(report.clerkOrgs.filter((o) => o.id === "org_stale_0")).toHaveLength(1);
    expect(deleted).not.toContain("org_stale_0");
  });
});

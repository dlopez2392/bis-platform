import { describe, it, expect, vi } from "vitest";
import { STALE_AFTER_MS } from "./stale";
import { emptySweepReport, sweepClerkOrgs, sweepClerkUsers, type ClerkForSweep } from "./sweep";

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
   *  (`query: "e2e-client-"`) and email-keyed staleness. */
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

    expect(getUserList).toHaveBeenCalledWith({ query: "e2e-client-", limit: 100, offset: 0 });
    expect(getUserList).toHaveBeenCalledWith({ query: "e2e-client-", limit: 100, offset: 100 });
    expect(report.clerkUsers).toHaveLength(150);
    expect(deleted).toHaveLength(150);
    expect(deleted).not.toContain("user_fresh");
  });
});

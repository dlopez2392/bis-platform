import { describe, it, expect } from "vitest";
import { orphanedOrgs, type ClerkOrgSummary } from "./orphans";

/**
 * The case that prompted this: a Clerk org for a real customer existed with no
 * `accounts` row, so the invitation sent, the sign-in failed, and the first
 * person to find out was the customer.
 */
const org = (id: string, name: string, createdAt?: number): ClerkOrgSummary =>
  ({ id, name, ...(createdAt === undefined ? {} : { createdAt }) });

describe("orphanedOrgs", () => {
  it("finds an org with no account row", () => {
    const orgs = [org("org_woodworks", "956 Woodworks"), org("org_linked", "Test Client One")];
    const accounts = [{ clerk_org_id: "org_linked" }];

    expect(orphanedOrgs(orgs, accounts).map((o) => o.name)).toEqual(["956 Woodworks"]);
  });

  it("reports nothing when every org is linked", () => {
    const orgs = [org("org_a", "A"), org("org_b", "B")];
    const accounts = [{ clerk_org_id: "org_a" }, { clerk_org_id: "org_b" }];

    expect(orphanedOrgs(orgs, accounts)).toEqual([]);
  });

  /**
   * The false-positive that would matter most: an operator glances at this
   * band, sees a healthy company listed as broken, and stops trusting it. Ids
   * must match exactly — never by name, which is not unique and not stable.
   */
  it("matches on org id, not on name", () => {
    const orgs = [org("org_new", "956 Woodworks")];
    // Same display name, different org — a renamed or re-created company.
    const accounts = [{ clerk_org_id: "org_old" }];

    expect(orphanedOrgs(orgs, accounts).map((o) => o.id)).toEqual(["org_new"]);
  });

  it("does not report an account whose org is gone", () => {
    // The opposite fault, deliberately out of scope — see the module comment.
    expect(orphanedOrgs([], [{ clerk_org_id: "org_vanished" }])).toEqual([]);
  });

  it("lists the oldest orphan first, so the longest-broken one leads", () => {
    const orgs = [org("org_c", "Newest", 300), org("org_a", "Oldest", 100), org("org_b", "Middle", 200)];

    expect(orphanedOrgs(orgs, []).map((o) => o.name)).toEqual(["Oldest", "Middle", "Newest"]);
  });

  it("keeps an org with no timestamp rather than dropping it", () => {
    // Clerk always sends createdAt; a missing one must not make a broken
    // company invisible, which is the one outcome this whole band exists to
    // prevent.
    const orgs = [org("org_dated", "Dated", 100), org("org_undated", "Undated")];

    expect(orphanedOrgs(orgs, []).map((o) => o.name)).toEqual(["Undated", "Dated"]);
  });

  it("handles no orgs and no accounts", () => {
    expect(orphanedOrgs([], [])).toEqual([]);
  });
});

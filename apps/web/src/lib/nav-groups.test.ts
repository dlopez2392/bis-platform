import { describe, expect, it } from "vitest";
import { buildNavGroups } from "./nav-groups";

const BASE = "/dashboard/accounts/acct_1";

function hrefs(groups: ReturnType<typeof buildNavGroups>) {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}

describe("buildNavGroups", () => {
  it("returns one flat, unlabeled group at the agency top level (no base)", () => {
    const groups = buildNavGroups(null, true);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    expect(hrefs(groups)).toEqual(["/dashboard/accounts", "/dashboard/blueprints"]);
  });

  it("groups in-account items under OVERVIEW / CRM / COMMUNICATIONS / GROWTH, in that order", () => {
    const groups = buildNavGroups(BASE, true);
    expect(groups.map((g) => g.label)).toEqual([
      "nav.group.overview",
      "nav.group.crm",
      "nav.group.communications",
      "nav.group.growth",
    ]);
  });

  it("places Dashboard, Contacts/Opportunities, Conversations/Calls/Voice, Forms/Calendar per the brief's grouping map (agency)", () => {
    const [overview, crm, comms, growth] = buildNavGroups(BASE, true);
    // Checklist joined OVERVIEW on 2026-09-05: the page hosts the A2P
    // registration panel that gates SMS, and nothing in the nav reached it.
    expect(overview!.items.map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.checklist"]);
    expect(crm!.items.map((i) => i.labelKey)).toEqual(["nav.contacts", "nav.opportunities"]);
    expect(comms!.items.map((i) => i.labelKey)).toEqual(["nav.conversations", "nav.calls", "nav.voice"]);
    expect(growth!.items.map((i) => i.labelKey)).toEqual(["nav.forms", "nav.calendar"]);
  });

  it("shows Voice to the agency and hides it from a client", () => {
    const agencyComms = buildNavGroups(BASE, true)[2]!;
    const clientComms = buildNavGroups(BASE, false)[2]!;
    expect(agencyComms.items.map((i) => i.labelKey)).toContain("nav.voice");
    expect(clientComms.items.map((i) => i.labelKey)).not.toContain("nav.voice");
  });

  it("shows Branding to a client and hides it from the agency", () => {
    const agencyGrowth = buildNavGroups(BASE, true)[3]!;
    const clientGrowth = buildNavGroups(BASE, false)[3]!;
    // Checklist is agency-only, matching the route's own
    // requireAgencyOnlyAccountAccess. Asserted in BOTH directions so hiding it
    // cannot be quietly dropped — though the route, not this list, is the
    // actual boundary.
    expect(buildNavGroups(BASE, true)[0]!.items.map((i) => i.labelKey)).toContain("nav.checklist");
    expect(buildNavGroups(BASE, false)[0]!.items.map((i) => i.labelKey)).not.toContain("nav.checklist");
    expect(clientGrowth.items.map((i) => i.labelKey)).toContain("nav.branding");
    expect(agencyGrowth.items.map((i) => i.labelKey)).not.toContain("nav.branding");
  });

  it("never includes a Setup item, for either audience", () => {
    for (const isAgency of [true, false]) {
      const groups = buildNavGroups(BASE, isAgency);
      const labelKeys = groups.flatMap((g) => g.items.map((i) => i.labelKey));
      expect(labelKeys).not.toContain("nav.setup");
    }
  });

  it("prefixes every in-account href with the given base", () => {
    const groups = buildNavGroups(BASE, true);
    for (const href of hrefs(groups)) {
      expect(href.startsWith(BASE)).toBe(true);
    }
  });
});

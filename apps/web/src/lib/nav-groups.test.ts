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
    expect(hrefs(groups)).toEqual([
      "/dashboard/accounts", "/dashboard/blueprints", "/dashboard/work", "/dashboard/numbers",
      "/dashboard/screened",
    ]);
  });

  it("offers the numbers inventory at the top level and nowhere inside an account", () => {
    // Agency-scope only, and NOT repeated inside an account: the inventory
    // spans every company, so a copy under one company's nav would say
    // something false about its scope. The route guards itself with
    // requireAgency regardless — this list is convenience, never the
    // boundary.
    expect(hrefs(buildNavGroups(null, true))).toContain("/dashboard/numbers");
    for (const isAgency of [true, false]) {
      expect(hrefs(buildNavGroups(BASE, isAgency))).not.toContain("/dashboard/numbers");
    }
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
    // Tasks joined directly under Dashboard on 2026-09-14 (Work Queue Task 3).
    expect(overview!.items.map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.tasks", "nav.website", "nav.checklist"]);
    expect(crm!.items.map((i) => i.labelKey)).toEqual(["nav.contacts", "nav.opportunities"]);
    expect(comms!.items.map((i) => i.labelKey)).toEqual(["nav.conversations", "nav.calls", "nav.activity", "nav.voice"]);
    expect(growth!.items.map((i) => i.labelKey)).toEqual(["nav.forms", "nav.calendar", "nav.automations"]);
  });

  it("shows Tasks and Website to both audiences, directly below Dashboard in that order", () => {
    // Mutation: gate either item on isAgency — the client case fails.
    for (const isAgency of [true, false]) {
      const [overview] = buildNavGroups(BASE, isAgency);
      expect(overview!.items.slice(0, 3).map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.tasks", "nav.website"]);
    }
  });

  it("shows Activity to both audiences, directly after Calls (mutation: gate it on isAgency → the client case FAILS)", () => {
    for (const isAgency of [true, false]) {
      const comms = buildNavGroups(BASE, isAgency)[2]!.items.map((i) => i.labelKey);
      expect(comms.indexOf("nav.activity")).toBe(comms.indexOf("nav.calls") + 1);
    }
  });

  it("shows Voice to the agency and hides it from a client", () => {
    const agencyComms = buildNavGroups(BASE, true)[2]!;
    const clientComms = buildNavGroups(BASE, false)[2]!;
    expect(agencyComms.items.map((i) => i.labelKey)).toContain("nav.voice");
    expect(clientComms.items.map((i) => i.labelKey)).not.toContain("nav.voice");
  });

  it("shows Automations to the agency and hides it from a client", () => {
    const agencyGrowth = buildNavGroups(BASE, true)[3]!;
    const clientGrowth = buildNavGroups(BASE, false)[3]!;
    expect(agencyGrowth.items.map((i) => i.labelKey)).toContain("nav.automations");
    expect(clientGrowth.items.map((i) => i.labelKey)).not.toContain("nav.automations");
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

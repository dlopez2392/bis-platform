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
    expect(overview!.items.map((i) => i.labelKey)).toEqual(["nav.dashboard"]);
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

import { describe, expect, it } from "vitest";
import { buildNavGroups } from "./nav-groups";

const BASE = "/dashboard/accounts/acct_1";

function hrefs(groups: ReturnType<typeof buildNavGroups>) {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}

describe("buildNavGroups", () => {
  it("returns one flat, unlabeled group at the agency top level (no base)", () => {
    const groups = buildNavGroups(null, true, false);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeNull();
    expect(hrefs(groups)).toEqual([
      "/dashboard/accounts", "/dashboard/blueprints", "/dashboard/work", "/dashboard/numbers",
      "/dashboard/screened", "/dashboard/plans",
    ]);
  });

  it("offers the numbers inventory at the top level and nowhere inside an account", () => {
    // Agency-scope only, and NOT repeated inside an account: the inventory
    // spans every company, so a copy under one company's nav would say
    // something false about its scope. The route guards itself with
    // requireAgency regardless — this list is convenience, never the
    // boundary.
    expect(hrefs(buildNavGroups(null, true, false))).toContain("/dashboard/numbers");
    for (const isAgency of [true, false]) {
      expect(hrefs(buildNavGroups(BASE, isAgency, true))).not.toContain("/dashboard/numbers");
    }
  });

  it("offers Plans at the top level and nowhere inside an account (mutation: add it to an in-account group → FAILS)", () => {
    // Plans are agency-wide (0051: agency-scoped, agency-only RLS). A copy
    // inside one company's nav would say something false about its scope.
    expect(hrefs(buildNavGroups(null, true, false))).toContain("/dashboard/plans");
    for (const isAgency of [true, false]) {
      expect(hrefs(buildNavGroups(BASE, isAgency, true))).not.toContain("/dashboard/plans");
    }
  });

  it("groups in-account items under OVERVIEW / CRM / COMMUNICATIONS / GROWTH, in that order", () => {
    const groups = buildNavGroups(BASE, true, false);
    expect(groups.map((g) => g.label)).toEqual([
      "nav.group.overview",
      "nav.group.crm",
      "nav.group.communications",
      "nav.group.growth",
    ]);
  });

  it("places Dashboard, Contacts/Documents/Opportunities, Conversations/Calls/Voice, Forms/Calendar per the brief's grouping map (agency)", () => {
    const [overview, crm, comms, growth] = buildNavGroups(BASE, true, false);
    // Checklist joined OVERVIEW on 2026-09-05: the page hosts the A2P
    // registration panel that gates SMS, and nothing in the nav reached it.
    // Tasks joined directly under Dashboard on 2026-09-14 (Work Queue Task 3).
    expect(overview!.items.map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.tasks", "nav.website", "nav.checklist"]);
    expect(crm!.items.map((i) => i.labelKey)).toEqual(["nav.contacts", "nav.documents", "nav.opportunities"]);
    expect(comms!.items.map((i) => i.labelKey)).toEqual(["nav.conversations", "nav.calls", "nav.activity", "nav.voice"]);
    expect(growth!.items.map((i) => i.labelKey)).toEqual(["nav.forms", "nav.calendar", "nav.automations"]);
  });

  // S-07 3a (spec 3.1, decision E2; DESIGN.md's sidebar pattern amended
  // 2026-10-17): Documents sits right after Contacts in CRM for every role,
  // with its own icon.
  it("Documents sits right after Contacts in CRM for every role, with its own icon (spec 3.1, E2; mutation: append it after Opportunities -> FAILS)", () => {
    for (const groups of [
      buildNavGroups(BASE, true, false),
      buildNavGroups(BASE, false, true),
      buildNavGroups(BASE, false, false),
      buildNavGroups(BASE, false, false, true),
    ]) {
      const crm = groups.find((g) => g.label === "nav.group.crm")!;
      expect(crm.items[0]).toEqual({ href: `${BASE}/contacts`, labelKey: "nav.contacts", iconKey: "contacts" });
      expect(crm.items[1]).toEqual({ href: `${BASE}/documents`, labelKey: "nav.documents", iconKey: "documents" });
    }
  });

  it("shows Tasks and Website to both audiences, directly below Dashboard in that order", () => {
    // Mutation: gate either item on isAgency — the client case fails.
    for (const isAgency of [true, false]) {
      const [overview] = buildNavGroups(BASE, isAgency, true);
      expect(overview!.items.slice(0, 3).map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.tasks", "nav.website"]);
    }
  });

  it("shows Activity to both audiences, directly after Calls (mutation: gate it on isAgency → the client case FAILS)", () => {
    for (const isAgency of [true, false]) {
      const comms = buildNavGroups(BASE, isAgency, true)[2]!.items.map((i) => i.labelKey);
      expect(comms.indexOf("nav.activity")).toBe(comms.indexOf("nav.calls") + 1);
    }
  });

  it("shows Voice to the agency and hides it from a client", () => {
    const agencyComms = buildNavGroups(BASE, true, false)[2]!;
    const clientComms = buildNavGroups(BASE, false, true)[2]!;
    expect(agencyComms.items.map((i) => i.labelKey)).toContain("nav.voice");
    expect(clientComms.items.map((i) => i.labelKey)).not.toContain("nav.voice");
  });

  it("shows Automations to the agency and hides it from a client", () => {
    const agencyGrowth = buildNavGroups(BASE, true, false)[3]!;
    const clientGrowth = buildNavGroups(BASE, false, true)[3]!;
    expect(agencyGrowth.items.map((i) => i.labelKey)).toContain("nav.automations");
    expect(clientGrowth.items.map((i) => i.labelKey)).not.toContain("nav.automations");
  });

  it("shows Branding to a client and hides it from the agency", () => {
    const agencyGrowth = buildNavGroups(BASE, true, false)[3]!;
    const clientGrowth = buildNavGroups(BASE, false, true)[3]!;
    // Checklist is agency-only, matching the route's own
    // requireAgencyOnlyAccountAccess. Asserted in BOTH directions so hiding it
    // cannot be quietly dropped — though the route, not this list, is the
    // actual boundary.
    expect(buildNavGroups(BASE, true, false)[0]!.items.map((i) => i.labelKey)).toContain("nav.checklist");
    expect(buildNavGroups(BASE, false, true)[0]!.items.map((i) => i.labelKey)).not.toContain("nav.checklist");
    expect(clientGrowth.items.map((i) => i.labelKey)).toContain("nav.branding");
    expect(agencyGrowth.items.map((i) => i.labelKey)).not.toContain("nav.branding");
  });

  // Staff and roles (spec §4): Billing now also gates on isOwner. A client
  // Staff session (false, false) never sees it; a client Owner (false, true)
  // keeps it last in Overview exactly as before; the agency never sees it,
  // whatever isOwner says (it is not even a client, so the value is
  // meaningless to it — asserted both ways so that can't be mistaken for a
  // pass by accident).
  it("Billing is a CLIENT-OWNER nav item, last in Overview; a client Staff and the agency never see it (mutation: ignore isOwner → the Staff case FAILS; show it to the agency → FAILS; drop it for the Owner → FAILS)", () => {
    const overview = (isAgency: boolean, isOwner: boolean) =>
      buildNavGroups(BASE, isAgency, isOwner).find((g) => g.label === "nav.group.overview")!;
    expect(overview(false, true).items.at(-1)).toEqual({ href: `${BASE}/billing`, labelKey: "nav.billing", iconKey: "billing" });
    expect(overview(false, false).items.map((i) => i.labelKey)).not.toContain("nav.billing");
    expect(overview(true, true).items.map((i) => i.labelKey)).not.toContain("nav.billing");
    expect(overview(true, false).items.map((i) => i.labelKey)).not.toContain("nav.billing");
  });

  // Team never joins this list at all, for any role — it lives in the
  // sidebar's pinned footer (AppSidebar) and in the palette only (D-xxx,
  // Task 8), never as a scrolling nav row.
  it("never includes a Team item, for any role", () => {
    for (const isAgency of [true, false]) {
      for (const isOwner of [true, false]) {
        const labelKeys = buildNavGroups(BASE, isAgency, isOwner).flatMap((g) => g.items.map((i) => i.labelKey));
        expect(labelKeys).not.toContain("nav.team");
      }
    }
  });

  it("never includes a Setup item, for either audience", () => {
    for (const isAgency of [true, false]) {
      const groups = buildNavGroups(BASE, isAgency, true);
      const labelKeys = groups.flatMap((g) => g.items.map((i) => i.labelKey));
      expect(labelKeys).not.toContain("nav.setup");
    }
  });

  // F-085 part 1 (spec §9): a Technician works their own customers and
  // nothing else. Hiding is convenience; requireNotTechnician is the boundary.
  it("a Technician sees exactly To do, Contacts, Documents, Conversations, Calls and Calendar, in the groups' order (mutation: leave Website in for a Technician -> FAILS)", () => {
    const groups = buildNavGroups(BASE, false, false, true);
    expect(hrefs(groups)).toEqual([
      `${BASE}/tasks`, `${BASE}/contacts`, `${BASE}/documents`, `${BASE}/conversations`, `${BASE}/calls`, `${BASE}/calendar`,
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "nav.group.overview", "nav.group.crm", "nav.group.communications", "nav.group.growth",
    ]);
  });

  // Snapshot of the hrefs taken from the code BEFORE the Technician
  // parameter existed: Owner, Staff and the agency must not move.
  // S-07 3a added Documents after Contacts (comment, not just code) in
  // every one of these snapshots.
  it("Owner, Staff and agency output is unchanged by the Technician parameter, whether passed false or omitted (mutation: apply the Technician list to Staff -> FAILS)", () => {
    const owner = [
      `${BASE}/dashboard`, `${BASE}/tasks`, `${BASE}/website`, `${BASE}/billing`,
      `${BASE}/contacts`, `${BASE}/documents`, `${BASE}/pipeline`,
      `${BASE}/conversations`, `${BASE}/calls`, `${BASE}/activity`,
      `${BASE}/forms`, `${BASE}/calendar`, `${BASE}/branding`,
    ];
    const staff = owner.filter((h) => h !== `${BASE}/billing`);
    const agency = [
      `${BASE}/dashboard`, `${BASE}/tasks`, `${BASE}/website`, `${BASE}/checklist`,
      `${BASE}/contacts`, `${BASE}/documents`, `${BASE}/pipeline`,
      `${BASE}/conversations`, `${BASE}/calls`, `${BASE}/activity`, `${BASE}/voice`,
      `${BASE}/forms`, `${BASE}/calendar`, `${BASE}/automations`,
    ];
    expect(hrefs(buildNavGroups(BASE, false, true))).toEqual(owner);
    expect(hrefs(buildNavGroups(BASE, false, true, false))).toEqual(owner);
    expect(hrefs(buildNavGroups(BASE, false, false))).toEqual(staff);
    expect(hrefs(buildNavGroups(BASE, false, false, false))).toEqual(staff);
    expect(hrefs(buildNavGroups(BASE, true, false))).toEqual(agency);
    expect(hrefs(buildNavGroups(BASE, true, false, false))).toEqual(agency);
  });

  it("the agency top level is untouched by the Technician parameter (base null)", () => {
    expect(hrefs(buildNavGroups(null, true, false, true))).toEqual(hrefs(buildNavGroups(null, true, false)));
  });

  it("prefixes every in-account href with the given base", () => {
    const groups = buildNavGroups(BASE, true, false);
    for (const href of hrefs(groups)) {
      expect(href.startsWith(BASE)).toBe(true);
    }
  });
});

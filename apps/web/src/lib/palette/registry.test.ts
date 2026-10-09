import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNavGroups } from "@/lib/nav-groups";
import { buildPaletteEntries, filterEntries } from "./registry";

const BASE = "/dashboard/accounts/acc_1";
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Code only: line/block comments (and so JSX comments) removed, string and
 * template contents kept. Same scanner as app-sidebar.test.ts and
 * link-site-card.test.ts: a source pin satisfied by a commented-out line
 * proved nothing (review of cd495636) — and the first version of the
 * parity test below passed with `id="branding"` moved into a comment one
 * line above the real (now id-less) <Card>, which is exactly that trap.
 */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    out += c;
  }
  return out;
}

describe("buildPaletteEntries", () => {
  it("registers EVERY nav destination — the contract's own parity rule", () => {
    for (const isAgency of [true, false]) {
      const navHrefs = buildNavGroups(BASE, isAgency).flatMap((g) => g.items.map((i) => i.href));
      expect(navHrefs.length).toBeGreaterThan(0); // the check below is vacuous otherwise
      const entryHrefs = new Set(
        buildPaletteEntries(BASE, isAgency)
          .filter((e) => e.kind === "href")
          .map((e) => (e as { href: string }).href),
      );
      for (const href of navHrefs) expect(entryHrefs).toContain(href);
    }
  });

  it("hides agency-only destinations and settings from a client", () => {
    const client = buildPaletteEntries(BASE, false);
    expect(client.some((e) => e.agencyOnly)).toBe(false);
    expect(client.some((e) => e.group === "settings")).toBe(false);
    // Voice is the agency's receptionist config, not the client's own data.
    expect(client.some((e) => e.kind === "href" && e.href === `${BASE}/voice`)).toBe(false);
    // Positive control: the client's palette is not simply empty.
    expect(client.some((e) => e.kind === "href" && e.href === `${BASE}/contacts`)).toBe(true);
  });

  it("gives the agency every settings section, each with its own anchor", () => {
    const settings = buildPaletteEntries(BASE, true).filter((e) => e.group === "settings");
    expect(settings.length).toBeGreaterThanOrEqual(4);
    for (const entry of settings) {
      expect(entry.kind).toBe("href");
      expect((entry as { href: string }).href).toMatch(
        new RegExp(`^${BASE}/settings#[a-z-]+$`),
      );
    }
  });

  it("registers the alert-phone settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:alert-phone");
    expect(entry).toBeTruthy();
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#alert-phone`);
  });

  it("registers the billing settings section, agency only (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true).find((e) => e.id === "settings:billing");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#billing`);
    expect(buildPaletteEntries(BASE, false).some((e) => e.id === "settings:billing")).toBe(false);
  });

  // D-080: Branding, Weekly report and Website are real cards on the
  // Settings page (settings/page.tsx renders <BrandingPanel>, <WeeklyReportCard
  // id="weekly-report">, <LinkSiteCard id="website">) but none had a
  // SETTINGS_SECTIONS entry, so DESIGN.md's "settings sections must be
  // registered in the palette index" went unmet for all three.
  it("registers the branding settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true).find((e) => e.id === "settings:branding");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#branding`);
  });

  it("registers the weekly report settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true).find((e) => e.id === "settings:weekly-report");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#weekly-report`);
  });

  it("registers the website settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true).find((e) => e.id === "settings:website");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#website`);
  });

  it("finds the website assistant by the words an operator would type", () => {
    const entries = buildPaletteEntries(BASE, true);
    const voice = entries.find((e) => e.id === `nav:${BASE}/voice`)!;
    // MUTATION: remove the NAV_KEYWORDS entry — this FAILS, and an operator
    // typing "widget" finds nothing.
    for (const word of ["website", "widget", "chat", "concierge"]) {
      expect(voice.keywords).toContain(word);
    }
  });

  // D-062: an operator typing any one of the five automation recipes by name
  // found nothing — only no-show/reminder/review words were registered.
  it("finds Automations by referral, reactivation, quote, confirmation and instant reply (mutation: drop any of these from NAV_KEYWORDS → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true);
    const automations = entries.find((e) => e.id === `nav:${BASE}/automations`)!;
    for (const word of ["referral", "reactivation", "quote", "confirmation", "instant reply"]) {
      expect(automations.keywords).toContain(word);
    }
  });

  it("has no duplicate ids and no entry without a label", () => {
    for (const isAgency of [true, false]) {
      const entries = buildPaletteEntries(BASE, isAgency);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      for (const e of entries) expect(e.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("outside an account offers only the top-level destinations", () => {
    const entries = buildPaletteEntries(null, true);
    const hrefs = entries.filter((e) => e.kind === "href").map((e) => (e as { href: string }).href);
    expect(hrefs).toContain("/dashboard/accounts");
    expect(hrefs).toContain("/dashboard/blueprints");
    // Derived from buildNavGroups, so a nav destination cannot exist without
    // a palette entry — this asserts the newest one actually made it through.
    expect(hrefs).toContain("/dashboard/numbers");
    expect(hrefs).toContain("/dashboard/plans");
    expect(hrefs.some((h) => h.includes("/contacts"))).toBe(false);
  });

  it("finds Plans by the words an operator types for it (mutation: drop its NAV_KEYWORDS entry → FAILS)", () => {
    const entries = buildPaletteEntries(null, true);
    for (const word of ["billing", "pricing", "stripe"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain("nav:/dashboard/plans");
    }
  });

  it("finds a client's Billing page by the words a business owner types for it (mutation: drop its NAV_KEYWORDS entry → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, false);
    for (const word of ["invoice", "card", "receipt"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain(`nav:${BASE}/billing`);
    }
  });

  it("offers no action that writes tenant data", () => {
    // The safety line the spec draws: navigation and safe actions only. If a
    // future action id appears here, it has to be justified against that rule.
    const actions = buildPaletteEntries(BASE, true).filter((e) => e.kind === "action");
    expect(actions.map((a) => (a as { actionId: string }).actionId)).toEqual(["toggle-theme"]);
  });

  // D-080, review round: `id="branding"` (and every other settings anchor)
  // was unpinned — nothing proved the Settings page actually has a Card
  // wearing the anchor a SETTINGS_SECTIONS entry points at. A registry
  // entry pointing at a href that scrolls to nothing is a defect this
  // suite could not see before, since registry.ts never reads the page.
  // Reads the SOURCE of every card component the Settings page renders
  // (not the registry's own private list — this must catch the registry
  // AND the markup drifting apart, in either direction) and checks each
  // settings-group entry's anchor appears as a real `id="<anchor>"`.
  it("every settings anchor the palette registers is a REAL id on a Settings card (mutation: remove id=\"branding\" from branding-panel.tsx → FAILS)", () => {
    const cardFiles = [
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/website/link-site-card.tsx",
      "../../components/alert-phone-card.tsx",
      "../../components/branding-panel.tsx",
    ];
    const allSources = cardFiles
      .map((f) => stripComments(readFileSync(path.join(here, f), "utf8")))
      .join("\n");

    const anchors = buildPaletteEntries(BASE, true)
      .filter((e) => e.group === "settings")
      .map((e) => (e as { href: string }).href.split("#")[1]!);
    expect(anchors.length).toBeGreaterThan(0); // the loop below is vacuous otherwise

    for (const anchor of anchors) {
      expect(allSources, `no id="${anchor}" found on any Settings card`).toContain(`id="${anchor}"`);
    }
  });
});

describe("filterEntries", () => {
  const entries = buildPaletteEntries(BASE, true);

  it("returns everything for an empty query", () => {
    expect(filterEntries(entries, "   ")).toHaveLength(entries.length);
  });

  it("matches case-insensitively on the label", () => {
    expect(filterEntries(entries, "contac").some((e) => e.label === "Contacts")).toBe(true);
  });

  it("matches on keywords the label does not contain", () => {
    // "Opportunities" is what the nav calls it; an operator types "deals".
    expect(filterEntries(entries, "deals").some((e) => e.label === "Opportunities")).toBe(true);
  });

  it("finds the tasks route by keyword even though its own label is 'To do'", () => {
    // nav-groups.ts's `nav.tasks` label reads "To do" — an operator typing
    // the route's own name ("task") found nothing on a route literally
    // called /tasks and full of records called tasks (NAV_KEYWORDS had no
    // "/tasks" entry at all).
    expect(filterEntries(entries, "task").some((e) => e.label === "To do")).toBe(true);
  });

  it("requires every term, so a multi-word query narrows", () => {
    expect(filterEntries(entries, "custom fields").some((e) => e.label === "Custom fields")).toBe(true);
    expect(filterEntries(entries, "custom zzz")).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(filterEntries(entries, "zzzzqqq")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNavGroups } from "@/lib/nav-groups";
import { buildPaletteEntries, filterEntries } from "./registry";
import { m } from "@/lib/messages";

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
  it("registers EVERY nav destination — the contract's own parity rule, in all three roles", () => {
    // Staff and roles: the agency's own isOwner value is meaningless (it is
    // not a client at all), so it is asserted with both values to make sure
    // neither role is skipped by this loop.
    for (const [isAgency, isOwner] of [[true, false], [false, true], [false, false]] as const) {
      const navHrefs = buildNavGroups(BASE, isAgency, isOwner).flatMap((g) => g.items.map((i) => i.href));
      expect(navHrefs.length).toBeGreaterThan(0); // the check below is vacuous otherwise
      const entryHrefs = new Set(
        buildPaletteEntries(BASE, isAgency, isOwner)
          .filter((e) => e.kind === "href")
          .map((e) => (e as { href: string }).href),
      );
      for (const href of navHrefs) expect(entryHrefs).toContain(href);
    }
  });

  it("hides agency-only destinations and settings from a client", () => {
    const client = buildPaletteEntries(BASE, false, true);
    expect(client.some((e) => e.agencyOnly)).toBe(false);
    expect(client.some((e) => e.group === "settings")).toBe(false);
    // Voice is the agency's receptionist config, not the client's own data.
    expect(client.some((e) => e.kind === "href" && e.href === `${BASE}/voice`)).toBe(false);
    // Positive control: the client's palette is not simply empty.
    expect(client.some((e) => e.kind === "href" && e.href === `${BASE}/contacts`)).toBe(true);
  });

  it("gives the agency every settings section, each with its own anchor", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    expect(settings.length).toBeGreaterThanOrEqual(4);
    for (const entry of settings) {
      expect(entry.kind).toBe("href");
      expect((entry as { href: string }).href).toMatch(
        new RegExp(`^${BASE}/settings#[a-z-]+$`),
      );
    }
  });

  it("registers the alert-phone settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:alert-phone");
    expect(entry).toBeTruthy();
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#alert-phone`);
  });

  it("registers the billing settings section, agency only (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:billing");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#billing`);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:billing")).toBe(false);
  });

  // D-080: Branding, Weekly report and Website are real cards on the
  // Settings page (settings/page.tsx renders <BrandingPanel>, <WeeklyReportCard
  // id="weekly-report">, <LinkSiteCard id="website">) but none had a
  // SETTINGS_SECTIONS entry, so DESIGN.md's "settings sections must be
  // registered in the palette index" went unmet for all three.
  it("registers the branding settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:branding");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#branding`);
  });

  it("registers the weekly report settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:weekly-report");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#weekly-report`);
  });

  it("registers the website settings section (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:website");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#website`);
  });

  it("registers the required documents settings section (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const entry = entries.find((e) => e.id === "settings:required-documents");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#required-documents`);
    expect(entry?.group).toBe("settings");
    expect(entry?.agencyOnly).toBe(true);
    expect(filterEntries(entries, "checklist").some((e) => e.id === "settings:required-documents")).toBe(true);
    expect(filterEntries(entries, "documentos").some((e) => e.id === "settings:required-documents")).toBe(true);
  });

  // S-53: the company's trade (settings/trade-card.tsx, #trade). Agency only, like every SETTINGS_SECTIONS entry.
  it("registers the trade settings section, agency only, found by 'giro' (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:trade");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#trade`);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:trade")).toBe(false);
    expect(filterEntries(settings, "giro").some((e) => e.id === "settings:trade")).toBe(true);
    // The palette jumps to a section BY NAME (DESIGN.md), so it names the card's own title (design check M6).
    expect((entry as { label: string } | undefined)?.label).toBe(m["vetting.card.title"]);
    expect(filterEntries(settings, "trade").some((e) => e.id === "settings:trade")).toBe(true);
  });

  it("registers the AI settings section, agency only, found by 'budget' and 'ia' (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const entry = entries.find((e) => e.id === "settings:ai");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#ai`);
    expect(entry?.agencyOnly).toBe(true);
    expect(filterEntries(entries, "budget").some((e) => e.id === "settings:ai")).toBe(true);
    expect(filterEntries(entries, "presupuesto").some((e) => e.id === "settings:ai")).toBe(true);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:ai")).toBe(false);
  });

  // Staff and roles (Task 8): a client Owner gets a direct `nav:team` entry;
  // a client Staff does not. Not a SETTINGS_SECTIONS anchor — see
  // registry.ts's own comment on why — so this is checked by id/href, not
  // by the `group: "settings"` anchor-parity loop below.
  it("registers nav:team for a client Owner, pointing at this account's /team; a client Staff never gets it (mutation: drop the isOwner check → the Staff assertion FAILS)", () => {
    const owner = buildPaletteEntries(BASE, false, true).find((e) => e.id === "nav:team");
    expect((owner as { href: string } | undefined)?.href).toBe(`${BASE}/team`);
    expect(buildPaletteEntries(BASE, false, false).some((e) => e.id === "nav:team")).toBe(false);
  });

  it("registers settings:team for the agency, pointing at this account's /team (mutation: drop the entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:team");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/team`);
    // Never offered to a client under either id — Team's agency entry point
    // is a different surface from the client Owner's own nav:team above.
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:team")).toBe(false);
  });

  it("finds Team by the words an operator or a business owner would type (mutation: drop the keywords → FAILS)", () => {
    for (const word of ["staff", "invite"]) {
      expect(filterEntries(buildPaletteEntries(BASE, true, false), word).map((e) => e.id)).toContain("settings:team");
      expect(filterEntries(buildPaletteEntries(BASE, false, true), word).map((e) => e.id)).toContain("nav:team");
    }
  });

  // S-47d Task 12 (spec 5.6.3): the Closed days card. All six words, in both languages
  // (mutation: drop one → FAILS).
  it("finds Calendar by closed days, holiday and vacation, in English and Spanish (mutation: drop one of the six → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const calendar = entries.find((e) => e.id === `nav:${BASE}/calendar`)!;
    for (const word of ["closed days", "holiday", "vacation", "días cerrados", "feriado", "vacaciones"]) {
      expect(calendar.keywords).toContain(word);
    }
  });

  // F-048 part 2 (review M5): the Bookings on your phone card. Every word, in both languages.
  it("finds Calendar by phone calendar, subscribe, iPhone, Google calendar and Outlook, in English and Spanish (mutation: drop one → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const calendar = entries.find((e) => e.id === `nav:${BASE}/calendar`)!;
    for (const word of ["phone calendar", "subscribe", "ical", "ics", "iphone", "google calendar", "outlook", "calendario del teléfono", "suscribirse"]) {
      expect(calendar.keywords, word).toContain(word);
    }
  });

  // F-046 part 1 (plan Task 7): the Agenda card. Every word, in both languages.
  it("finds Calendar by agenda, schedule and add job, in English and Spanish (mutation: drop one of the five → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const calendar = entries.find((e) => e.id === `nav:${BASE}/calendar`)!;
    for (const word of ["agenda", "schedule", "add job", "trabajo", "agregar trabajo"]) {
      expect(calendar.keywords, word).toContain(word);
    }
  });

  it("finds the website assistant by the words an operator would type", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const voice = entries.find((e) => e.id === `nav:${BASE}/voice`)!;
    // MUTATION: remove the NAV_KEYWORDS entry — this FAILS, and an operator
    // typing "widget" finds nothing.
    for (const word of ["website", "widget", "chat", "concierge"]) {
      expect(voice.keywords).toContain(word);
    }
  });

  // S-47c (plan Task 9; spec 5.7): the Voice page's two new cards — Business hours, Services & prices.
  it("finds the receptionist's hours and prices by the words an operator would type, in English and Spanish (mutation: drop any of these from NAV_KEYWORDS → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const voice = entries.find((e) => e.id === `nav:${BASE}/voice`)!;
    for (const word of ["hours", "prices", "services", "horario", "precios"]) {
      expect(voice.keywords).toContain(word);
    }
  });

  // D-062: an operator typing any one of the five automation recipes by name
  // found nothing — only no-show/reminder/review words were registered.
  it("finds Automations by referral, reactivation, quote, confirmation and instant reply (mutation: drop any of these from NAV_KEYWORDS → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const automations = entries.find((e) => e.id === `nav:${BASE}/automations`)!;
    for (const word of ["referral", "reactivation", "quote", "confirmation", "instant reply"]) {
      expect(automations.keywords).toContain(word);
    }
  });

  // S-06 part 2: the Never record list lives inside the Sending address card (agency-only Settings);
  // the client Owner's copy is on /branding, whose own keywords stay as they were.
  it("finds the Never record list by the words an operator types, agency only (mutation: drop the keywords → FAILS)", () => {
    for (const q of ["never record", "block", "ignore sender"]) {
      expect(filterEntries(buildPaletteEntries(BASE, true, false), q).map((e) => e.id), q).toContain("settings:sending-address");
      expect(filterEntries(buildPaletteEntries(BASE, false, true), q).map((e) => e.id), q).not.toContain("settings:sending-address");
    }
  });

  it("has no duplicate ids and no entry without a label", () => {
    for (const [isAgency, isOwner] of [[true, false], [false, true], [false, false]] as const) {
      const entries = buildPaletteEntries(BASE, isAgency, isOwner);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      for (const e of entries) expect(e.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("outside an account offers only the top-level destinations", () => {
    const entries = buildPaletteEntries(null, true, false);
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
    const entries = buildPaletteEntries(null, true, false);
    for (const word of ["billing", "pricing", "stripe"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain("nav:/dashboard/plans");
    }
  });

  it("finds a client's Billing page by the words a business owner types for it (mutation: drop its NAV_KEYWORDS entry → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, false, true);
    for (const word of ["invoice", "card", "receipt"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain(`nav:${BASE}/billing`);
    }
  });

  it("offers no action that writes tenant data", () => {
    // The safety line the spec draws: navigation and safe actions only. If a
    // future action id appears here, it has to be justified against that rule.
    const actions = buildPaletteEntries(BASE, true, false).filter((e) => e.kind === "action");
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
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/required-documents-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx",
      // S-53: the Trade card (settings:trade).
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-card.tsx",
      "../../app/(dashboard)/dashboard/accounts/[accountId]/website/link-site-card.tsx",
      "../../components/alert-phone-card.tsx",
      "../../components/branding-panel.tsx",
    ];
    const allSources = cardFiles
      .map((f) => stripComments(readFileSync(path.join(here, f), "utf8")))
      .join("\n");

    const anchors = buildPaletteEntries(BASE, true, false)
      .filter((e) => e.group === "settings")
      .map((e) => (e as { href: string }).href.split("#")[1]!);
    expect(anchors.length).toBeGreaterThan(0); // the loop below is vacuous otherwise

    for (const anchor of anchors) {
      expect(allSources, `no id="${anchor}" found on any Settings card`).toContain(`id="${anchor}"`);
    }
  });
});

describe("filterEntries", () => {
  const entries = buildPaletteEntries(BASE, true, false);

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

  // S-07 3a (spec 3.1, decision E2): the Documents page is findable by its
  // own words, in both languages (mutation: no NAV_KEYWORDS entry -> FAILS).
  it("the Documents page is findable by its words in both languages (mutation: no NAV_KEYWORDS entry -> FAILS)", () => {
    const base = buildPaletteEntries(BASE, false, false);
    expect(filterEntries(base, "vencen").some((e) => e.id === `nav:${BASE}/documents`)).toBe(true);
    expect(filterEntries(base, "expiring").some((e) => e.id === `nav:${BASE}/documents`)).toBe(true);
  });

  // S-07 3a (spec 3.3): a client Owner's Required documents entry opens the
  // Documents page's own card; Staff, a Technician and the agency get no
  // such entry.
  it("a client Owner's Required documents opens the Documents page's card; Staff, a Technician and the agency get no such entry (mutations: drop the isOwner check -> the Staff case FAILS; point it at settings -> FAILS)", () => {
    const owner = buildPaletteEntries(BASE, false, true);
    expect(owner).toContainEqual(
      expect.objectContaining({ id: "nav:required-documents", href: `${BASE}/documents#required-documents`, agencyOnly: false, group: "navigation" }),
    );
    expect(buildPaletteEntries(BASE, false, false).some((e) => e.id === "nav:required-documents")).toBe(false);
    expect(buildPaletteEntries(BASE, false, false, true).some((e) => e.id === "nav:required-documents")).toBe(false);
    expect(buildPaletteEntries(BASE, true, false).some((e) => e.id === "nav:required-documents")).toBe(false);
    expect(buildPaletteEntries(BASE, true, false).some((e) => e.id === "settings:required-documents")).toBe(true);
  });

  // F-118 part 1 (plan Task 10; spec 6.1, owner ruling 9): the Team page's
  // own "BIS access" section — readable by a client Owner and by the
  // agency, never by Staff or a Technician (requireAccountOwner itself
  // keeps both off the Team page regardless of this entry).
  it("nav:bis-access opens the Team page's BIS access section for an Owner and for the agency; Staff, a Technician and the top level (no account) get none (mutations: drop `isAgency ||` -> the agency case FAILS; drop the guard entirely -> the Staff case FAILS)", () => {
    const owner = buildPaletteEntries(BASE, false, true);
    expect(owner).toContainEqual(
      expect.objectContaining({ id: "nav:bis-access", href: `${BASE}/team#bis-access`, agencyOnly: false, group: "navigation" }),
    );
    const agency = buildPaletteEntries(BASE, true, false);
    expect(agency).toContainEqual(
      expect.objectContaining({ id: "nav:bis-access", href: `${BASE}/team#bis-access`, agencyOnly: false, group: "navigation" }),
    );
    expect(buildPaletteEntries(BASE, false, false).some((e) => e.id === "nav:bis-access")).toBe(false);
    expect(buildPaletteEntries(BASE, false, false, true).some((e) => e.id === "nav:bis-access")).toBe(false);
    expect(buildPaletteEntries(null, true, false).some((e) => e.id === "nav:bis-access")).toBe(false);
  });

  it("nav:bis-access is findable by its own words, in English and Spanish, for an Owner (mutation: drop a keyword -> FAILS)", () => {
    const owner = buildPaletteEntries(BASE, false, true);
    expect(filterEntries(owner, "visitas").some((e) => e.id === "nav:bis-access")).toBe(true);
    expect(filterEntries(owner, "who looked").some((e) => e.id === "nav:bis-access")).toBe(true);
  });
});

// F-085 part 1 (spec §9): the ⌘K index leaves out every route a Technician
// cannot enter, and Team; their own Preferences stays.
describe("Technician", () => {
  const REFUSED = ["/dashboard", "/website", "/pipeline", "/activity", "/forms", "/branding", "/billing", "/contacts/import", "/checklist", "/voice", "/automations", "/settings", "/setup"];

  it("offers no nav: entry for a refused route and no Team entry (mutation: drop the Technician argument from buildNavGroups -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, false, false, true);
    const ids = entries.map((e) => e.id);
    for (const suffix of REFUSED) expect(ids, `nav:${BASE}${suffix}`).not.toContain(`nav:${BASE}${suffix}`);
    expect(ids).not.toContain("nav:team");
    expect(ids).not.toContain("settings:team");
    expect(entries.some((e) => e.agencyOnly)).toBe(false);
  });

  it("still offers their own six destinations and Preferences", () => {
    const ids = buildPaletteEntries(BASE, false, false, true).map((e) => e.id);
    for (const suffix of ["/tasks", "/contacts", "/documents", "/conversations", "/calls", "/calendar"]) {
      expect(ids).toContain(`nav:${BASE}${suffix}`);
    }
    expect(ids).toContain("nav:preferences");
  });

  it("registers every Technician nav destination (the parity rule, fourth role)", () => {
    const navHrefs = buildNavGroups(BASE, false, false, true).flatMap((g) => g.items.map((i) => i.href));
    const entryHrefs = new Set(buildPaletteEntries(BASE, false, false, true).flatMap((e) => (e.kind === "href" ? [e.href] : [])));
    expect(navHrefs.length).toBe(6);
    for (const href of navHrefs) expect(entryHrefs).toContain(href);
  });
});

// Mis preferencias (F-096, Task 6): a person's own page, not an account's,
// so it is offered with or without an account in scope, to both roles.
describe("Preferences", () => {
  it.each([[true, null], [false, "/dashboard/accounts/a"], [true, "/dashboard/accounts/a"]] as const)(
    "offers Preferences to everyone (isAgency=%s, base=%s) (mutation: mark it agencyOnly or emit it only with a base -> FAILS)",
    (isAgency, base) => {
      const e = buildPaletteEntries(base, isAgency, false).find((x) => x.id === "nav:preferences");
      expect(e).toMatchObject({ kind: "href", href: "/dashboard/preferences", agencyOnly: false });
      expect(filterEntries([e!], "idioma")).toHaveLength(1);
    });
});

describe("buildPaletteEntries in Spanish (S-10 T1)", () => {
  it("labels every entry in the reader's language (mutation: ignore the locale → English labels, FAILS)", () => {
    const es = buildPaletteEntries(BASE, false, true, false, "es");
    expect(es.find((e) => e.id === `nav:${BASE}/contacts`)?.label).toBe("Contactos");
    expect(es.find((e) => e.id === "action:toggle-theme")?.label).toBe(m["palette.action.toggleTheme.es"]);
  });

  it("keeps the English label findable in Spanish: typing 'contacts' still finds Contactos (mutation: drop the English keyword → FAILS)", () => {
    const hits = filterEntries(buildPaletteEntries(BASE, false, true, false, "es"), "contacts");
    expect(hits.map((e) => e.label)).toContain("Contactos");
  });

  it("an agency settings section is labelled in Spanish too (mutation: keep section.label English → FAILS)", () => {
    const es = buildPaletteEntries(BASE, true, false, false, "es");
    expect(es.find((e) => e.id === "settings:billing")?.label).toBe("Facturación");
  });

  it("English stays the default, label for label (mutation: default the locale to es → FAILS)", () => {
    expect(buildPaletteEntries(BASE, false, true).map((e) => e.label))
      .toEqual(buildPaletteEntries(BASE, false, true, false, "en").map((e) => e.label));
    expect(buildPaletteEntries(BASE, false, true).find((e) => e.id === `nav:${BASE}/contacts`)?.label).toBe("Contacts");
  });
});

describe("one wording for the theme switch (S-10 review M-10)", () => {
  it("the palette action and the topbar toggle say the same thing in Spanish (mutation: reword one → FAILS)", () => {
    expect(m["palette.action.toggleTheme.es"]).toBe(m["theme.toggle.es"]);
  });
});

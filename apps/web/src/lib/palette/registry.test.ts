import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNavGroups } from "@/lib/nav-groups";
import { buildPaletteEntries, filterEntries, type PaletteEntry } from "./registry";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
// The SUBPATH, not "@bis/db" — same discipline registry.ts itself documents.
import { nameFold } from "@bis/db/dedupe-keys";

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

  it("registers the alert-phone settings section (mutation: remove the manifest's settings-section entry → FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:alert-phone");
    expect(entry).toBeTruthy();
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#alert-phone`);
  });

  it("registers the billing settings section, agency only (mutation: remove the manifest's settings-section entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:billing");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#billing`);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:billing")).toBe(false);
  });

  // D-080: Branding, Weekly report and Website are real cards on the
  // Settings page (settings/page.tsx renders <BrandingPanel>, <WeeklyReportCard
  // id="weekly-report">, <LinkSiteCard id="website">) but none had a
  // settings-section manifest entry, so DESIGN.md's "settings sections must be
  // registered in the palette index" went unmet for all three.
  it("registers the branding settings section (mutation: remove the manifest's settings-section entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:branding");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#branding`);
  });

  it("registers the weekly report settings section (mutation: remove the manifest's settings-section entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:weekly-report");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#weekly-report`);
  });

  it("registers the website settings section (mutation: remove the manifest's settings-section entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true, false).find((e) => e.id === "settings:website");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#website`);
  });

  it("registers the required documents settings section (mutation: remove the manifest's settings-section entry -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const entry = entries.find((e) => e.id === "settings:required-documents");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#required-documents`);
    expect(entry?.group).toBe("settings");
    expect(entry?.agencyOnly).toBe(true);
    expect(filterEntries(entries, "checklist").some((e) => e.id === "settings:required-documents")).toBe(true);
    expect(filterEntries(entries, "documentos").some((e) => e.id === "settings:required-documents")).toBe(true);
  });

  // S-53: the company's trade (settings/trade-card.tsx, #trade). Agency only, like every settings-section manifest entry.
  it("registers the trade settings section, agency only, found by 'giro' (mutation: remove the manifest's settings-section entry -> FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:trade");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#trade`);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:trade")).toBe(false);
    expect(filterEntries(settings, "giro").some((e) => e.id === "settings:trade")).toBe(true);
    // The palette jumps to a section BY NAME (DESIGN.md), so it names the card's own title (design check M6).
    expect((entry as { label: string } | undefined)?.label).toBe(m["vetting.card.title"]);
    expect(filterEntries(settings, "trade").some((e) => e.id === "settings:trade")).toBe(true);
  });

  it("registers the AI settings section, agency only, found by 'budget' and 'ia' (mutation: remove the manifest's settings-section entry -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const entry = entries.find((e) => e.id === "settings:ai");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#ai`);
    expect(entry?.agencyOnly).toBe(true);
    expect(filterEntries(entries, "budget").some((e) => e.id === "settings:ai")).toBe(true);
    expect(filterEntries(entries, "presupuesto").some((e) => e.id === "settings:ai")).toBe(true);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:ai")).toBe(false);
  });

  // Staff and roles (Task 8): a client Owner gets a direct `nav:team` entry;
  // a client Staff does not. Not a settings-section manifest anchor — see
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
    // MUTATION: remove the ENTRY_KEYWORDS entry — this FAILS, and an operator
    // typing "widget" finds nothing.
    for (const word of ["website", "widget", "chat", "concierge"]) {
      expect(voice.keywords).toContain(word);
    }
  });

  // S-47c (plan Task 9; spec 5.7): the Voice page's two new cards — Business hours, Services & prices.
  it("finds the receptionist's hours and prices by the words an operator would type, in English and Spanish (mutation: drop any of these from ENTRY_KEYWORDS → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const voice = entries.find((e) => e.id === `nav:${BASE}/voice`)!;
    for (const word of ["hours", "prices", "services", "horario", "precios"]) {
      expect(voice.keywords).toContain(word);
    }
  });

  // D-062: an operator typing any one of the five automation recipes by name
  // found nothing — only no-show/reminder/review words were registered.
  it("finds Automations by referral, reactivation, quote, confirmation and instant reply (mutation: drop any of these from ENTRY_KEYWORDS → FAILS)", () => {
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

  it("finds Plans by the words an operator types for it (mutation: drop its ENTRY_KEYWORDS entry → FAILS)", () => {
    const entries = buildPaletteEntries(null, true, false);
    for (const word of ["billing", "pricing", "stripe"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain("nav:/dashboard/plans");
    }
  });

  it("finds a client's Billing page by the words a business owner types for it (mutation: drop its ENTRY_KEYWORDS entry → FAILS)", () => {
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
  // wearing the anchor a settings-section manifest entry points at. A registry
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
      "../../app/(dashboard)/dashboard/accounts/[accountId]/settings/link-site-card.tsx",
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
    // called /tasks and full of records called tasks (ENTRY_KEYWORDS had no
    // "nav:tasks" entry at all).
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
  // own words, in both languages (mutation: no ENTRY_KEYWORDS entry -> FAILS).
  it("the Documents page is findable by its words in both languages (mutation: no ENTRY_KEYWORDS entry -> FAILS)", () => {
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

// F-095 part 1 (spec 2026-11-06-palette-v2-design.md): palette v2, Spanish
// keywords and accent-insensitive, bidirectional matching.

/** Every role combination buildPaletteEntries can produce (spec §4.4: "all
 *  four roles — agency, client Owner, client Staff, Technician"). */
const ALL_ROLE_COMBINATIONS = [
  { name: "agency", base: BASE, isAgency: true, isOwner: false, isTechnician: false },
  { name: "client Owner", base: BASE, isAgency: false, isOwner: true, isTechnician: false },
  { name: "client Staff", base: BASE, isAgency: false, isOwner: false, isTechnician: false },
  { name: "Technician", base: BASE, isAgency: false, isOwner: false, isTechnician: true },
] as const;

/** Spec §4.4: the folded, ≥4-letter words of a label — a one-word label
 *  whose English and Spanish render may coincide (e.g. "CRM", "Voz" is only
 *  3 letters) contributes nothing, which the completeness test below treats
 *  as "nothing to prove" rather than a failure. */
function significantWords(label: string): string[] {
  return nameFold(label).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
}

describe("F-095 part 1: every entry's own Spanish label is findable from an English session (mutation: revert words() to its one-way `locale === \"en\" ? keywords : [...]` form → every multi-word label entry FAILS)", () => {
  it.each(ALL_ROLE_COMBINATIONS)("role=$name", ({ base, isAgency, isOwner, isTechnician }) => {
    const entries = buildPaletteEntries(base, isAgency, isOwner, isTechnician, "en");
    expect(entries.length).toBeGreaterThan(0); // the loop below is vacuous otherwise
    for (const entry of entries) {
      // Risk 6.3.4: a future `entries.push` site that computes `label(key)`
      // but forgets to thread `labelKey` alongside it would silently exempt
      // itself from this entire check — so every entry must carry one.
      expect(entry.labelKey, `${entry.id} has no labelKey`).toBeDefined();
      const esLabel = t(m, entry.labelKey!, "es");
      const need = significantWords(esLabel);
      if (need.length === 0) continue; // e.g. action/nav labels that are a single short word
      const haystack = nameFold([entry.label, ...entry.keywords].join(" "));
      expect(
        need.some((w) => haystack.includes(w)),
        `${entry.id} ("${entry.label}") has no reachable Spanish word for "${esLabel}" (needed one of: ${need.join(", ")})`,
      ).toBe(true);
    }
  });
});

describe("F-095 part 1: accent-insensitive matching, both ways", () => {
  // Test 1 (spec §6.4.1): the brief's own worked example. "citas" carries no
  // accent to begin with, so this alone cannot prove the fold runs — it
  // proves the ALIAS itself is registered (test 2 below is the real fold
  // test). Mutation: drop "citas" from ENTRY_KEYWORDS["nav:calendar"] → FAILS.
  it("finds Calendar by typing 'citas', the brief's own worked example (mutation: drop the keyword → FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    expect(filterEntries(entries, "citas").map((e) => e.id)).toContain(`nav:${BASE}/calendar`);
  });

  // Test 2 (spec §6.4.2, adjusted per working rule 2 — see the task report):
  // against the REAL nav:setup entry this cannot fail, because the table's
  // own second, redundant ASCII keyword ("configuracion", added below for
  // belt-and-braces per §4.2) already matches a folded query regardless of
  // whether the haystack itself is folded — run and confirmed: a full
  // revert of filterEntries to the plain, unfolded substring test still
  // passes this exact query against the real registry. A synthetic entry
  // whose ONLY stored word carries the accent isolates the property: typing
  // WITHOUT an accent must still find a keyword stored WITH one, which can
  // only happen if the HAYSTACK is folded. Mutation: replace the fold with
  // `.toLowerCase()` in filterEntries → FAILS, because
  // "configuracion".includes("configuración") is false without it.
  it("finds a card typing 'configuracion' (no accent) when the ONLY stored keyword carries the accent (mutation: use .toLowerCase() instead of the fold in filterEntries → FAILS)", () => {
    const accentedOnly: PaletteEntry = {
      kind: "href", id: "x:accented-only", label: "Some other card", group: "settings",
      agencyOnly: true, keywords: ["configuración"], href: "/x",
    };
    expect(filterEntries([accentedOnly], "configuracion").map((e) => e.id)).toContain("x:accented-only");
  });

  // Test 3 (spec §6.4.3, adjusted per working rule 2 for the same reason as
  // test 2 above — run and confirmed: the full revert mutation above does
  // NOT break the real nav:setup query either, for the same redundant-alias
  // reason). The companion, reverse case: the ONLY stored word omits the
  // accent and the typed query carries it, proving the QUERY side must be
  // folded too, not just the haystack. Mutation: replace the fold with
  // `.toLowerCase()` in filterEntries → FAILS, because
  // "configuración".includes("configuracion") is false without it (the
  // haystack's "o" never matches the query's un-folded "ó").
  it("finds a card typing 'configuración' (with the accent) when the ONLY stored keyword omits it (mutation: use .toLowerCase() instead of the fold in filterEntries → FAILS)", () => {
    const asciiOnly: PaletteEntry = {
      kind: "href", id: "x:ascii-only", label: "Some other card", group: "settings",
      agencyOnly: true, keywords: ["configuracion"], href: "/x",
    };
    expect(filterEntries([asciiOnly], "configuración").map((e) => e.id)).toContain("x:ascii-only");
  });

  // Test 4 (spec §6.4.4, §0/§7's corrected mapping): "configuración"/
  // "configuracion" find Setup, and do NOT find Settings — directly encodes
  // the brief's corrected example so it cannot regress to the brief's wrong
  // one. Mutation: attach the keyword to nav:settings instead of nav:setup
  // → the "does NOT find Settings" half FAILS.
  it("'configuración' and 'configuracion' find Setup and do NOT find Settings (mutation: attach the keyword to nav:settings instead → the 'does NOT find Settings' half FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    for (const q of ["configuración", "configuracion"]) {
      const ids = filterEntries(entries, q).map((e) => e.id);
      expect(ids, q).toContain("nav:setup");
      expect(ids, q).not.toContain("nav:settings");
    }
  });
});

describe("F-095 part 1: Spanish aliases beyond the label (spec §4.2, mutation: drop the keyword → FAILS)", () => {
  const agency = buildPaletteEntries(BASE, true, false);
  const owner = buildPaletteEntries(BASE, false, true);

  it("finds Calendar by horario and disponibilidad", () => {
    for (const q of ["horario", "disponibilidad"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/calendar`);
    }
  });

  it("finds Pipeline by oportunidades and embudo", () => {
    for (const q of ["oportunidades", "embudo"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/pipeline`);
    }
  });

  it("finds the sending-address settings by correo, dominio and remitente", () => {
    for (const q of ["correo", "dominio", "remitente"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:sending-address");
    }
  });

  it("finds the toggle-theme action by oscuro, claro, apariencia and tema", () => {
    for (const q of ["oscuro", "claro", "apariencia", "tema"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("action:toggle-theme");
    }
  });

  it("finds Contacts by contactos, clientes and prospectos", () => {
    for (const q of ["contactos", "clientes", "prospectos"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/contacts`);
    }
  });

  it("finds Dashboard by inicio and panel", () => {
    for (const q of ["inicio", "panel"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/dashboard`);
    }
  });

  it("finds Calls by llamadas and teléfono", () => {
    for (const q of ["llamadas", "teléfono"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/calls`);
    }
  });

  it("finds Forms by formularios", () => {
    expect(filterEntries(agency, "formularios").map((e) => e.id)).toContain(`nav:${BASE}/forms`);
  });

  it("finds Conversations by conversaciones, mensajes and bandeja", () => {
    for (const q of ["conversaciones", "mensajes", "bandeja"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain(`nav:${BASE}/conversations`);
    }
  });

  it("finds a client Owner's own Branding page by marca, logotipo and colores", () => {
    for (const q of ["marca", "logotipo", "colores"]) {
      expect(filterEntries(owner, q).map((e) => e.id), q).toContain(`nav:${BASE}/branding`);
    }
  });

  it("finds the client-access settings by acceso and invitación", () => {
    for (const q of ["acceso", "invitación"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:client-access");
    }
  });

  it("finds the custom-fields settings by campo", () => {
    expect(filterEntries(agency, "campo").map((e) => e.id)).toContain("settings:custom-fields");
  });

  it("finds the custom-values settings by valor", () => {
    expect(filterEntries(agency, "valor").map((e) => e.id)).toContain("settings:custom-values");
  });

  it("finds the alert-phone settings by texto, alerta and aviso", () => {
    for (const q of ["texto", "alerta", "aviso"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:alert-phone");
    }
  });

  it("finds the billing settings by suscripción, factura and pago", () => {
    for (const q of ["suscripción", "factura", "pago"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:billing");
    }
  });

  it("finds the branding settings by logotipo, colores and marca", () => {
    for (const q of ["logotipo", "colores", "marca"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:branding");
    }
  });

  it("finds the weekly-report settings by reporte, lunes and destinatarios", () => {
    for (const q of ["reporte", "lunes", "destinatarios"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:weekly-report");
    }
  });

  it("finds the website settings by tráfico, análisis and dominio", () => {
    for (const q of ["tráfico", "análisis", "dominio"]) {
      expect(filterEntries(agency, q).map((e) => e.id), q).toContain("settings:website");
    }
  });

  it("finds Settings by ajustes", () => {
    expect(filterEntries(agency, "ajustes").map((e) => e.id)).toContain("nav:settings");
  });

  it("finds Team by equipo — the client Owner's nav:team and the agency's settings:team", () => {
    expect(filterEntries(owner, "equipo").map((e) => e.id)).toContain("nav:team");
    expect(filterEntries(agency, "equipo").map((e) => e.id)).toContain("settings:team");
  });
});

describe("F-095 part 1: ranking (spec §4.3)", () => {
  it("ranks a label match ahead of a keyword-only match (mutation: remove the tier sort, return filter order only → the keyword-only entry FAILS to come second when it was registered first)", () => {
    const keywordOnly: PaletteEntry = {
      kind: "href", id: "x:keyword-only", label: "Some random card", group: "settings",
      agencyOnly: true, keywords: ["more ajustes words"], href: "/x",
    };
    const labelMatch: PaletteEntry = {
      kind: "href", id: "x:label-match", label: "Ajustes", group: "navigation",
      agencyOnly: true, keywords: [], href: "/y",
    };
    // keywordOnly registered FIRST — without the tier sort, filter() alone
    // would keep it first.
    const result = filterEntries([keywordOnly, labelMatch], "ajustes");
    expect(result.map((e) => e.id)).toEqual(["x:label-match", "x:keyword-only"]);
  });
});

// F-087 fix round, finding 2 (owner ruling 2026-11-06): KEEP, the palette
// side of the same change pinned in nav-groups.test.ts. A non-agency caller
// with no account in scope (base === null) now gets none of the agency's
// six top-level destinations — previously impossible to reach in practice,
// but nothing stopped buildNavGroups(null, ...) from returning them to one.
describe("buildPaletteEntries — a non-agency caller at the top level gets none of the six agency-top destinations (F-087 fix round, finding 2, KEEP)", () => {
  it("a client (not agency) with no account in scope gets no agency-top hrefs (mutation: drop the audience check for agency-top scope → FAILS)", () => {
    const entries = buildPaletteEntries(null, false, false);
    const hrefs = entries.filter((e) => e.kind === "href").map((e) => (e as { href: string }).href);
    for (const h of ["/dashboard/accounts", "/dashboard/blueprints", "/dashboard/work", "/dashboard/numbers", "/dashboard/screened", "/dashboard/plans", "/dashboard"]) {
      expect(hrefs, h).not.toContain(h);
    }
  });

  it("a Technician with no account in scope gets no agency-top hrefs (mutation: drop the audience check for agency-top scope → FAILS)", () => {
    const entries = buildPaletteEntries(null, false, false, true);
    const hrefs = entries.filter((e) => e.kind === "href").map((e) => (e as { href: string }).href);
    expect(hrefs).not.toContain("/dashboard/accounts");
  });
});

// F-087 fix round, finding 3a (owner ruling 2026-11-06): KEEP. The seven
// ex-hand-pushed entries (Preferences, nav:team, settings:team, Required
// documents, BIS access, Settings, Setup) now flow through the SAME
// `words()` call every manifest-derived entry gets, so the OTHER
// language's own label joins their keywords too (F-095's own rule,
// §4.4) — the one-off hand-pushes used to carry only their own
// hand-written keyword arrays, with no cross-language label word.
describe("buildPaletteEntries — the ex-hand-pushed entries are findable by the other language's own label too (F-087 fix round, finding 3a, KEEP)", () => {
  it("an English session finds Preferences by its Spanish label word 'preferencias' (mutation: revert to the hand-pushed, one-way keyword list → FAILS)", () => {
    const en = buildPaletteEntries("/dashboard/accounts/acc_1", true, false, false, "en");
    expect(filterEntries(en, "preferencias").map((e) => e.id)).toContain("nav:preferences");
  });

  it("a Spanish session finds Settings by its English label word 'settings' (mutation: revert to the hand-pushed, one-way keyword list → FAILS)", () => {
    const es = buildPaletteEntries("/dashboard/accounts/acc_1", true, false, false, "es");
    expect(filterEntries(es, "settings").map((e) => e.id)).toContain("nav:settings");
  });
});

// F-087 fix round, finding 3b (owner ruling 2026-11-06): the consolidation
// moved `settings:team` to right after `nav:team` in the manifest's own
// array, which put it BEFORE nav:bis-access/nav:settings/nav:setup in an
// agency session's ⌘K list — origin/main pushed it LAST among this exact
// set of five (nav:preferences first, then nav:bis-access, nav:settings,
// nav:setup, settings:team). Pins the restored order directly, not through
// an intermediate "same ids, any order" check.
// F-032 Task 6: the "Call in to your business" card (Preferences) and the switch card (Team).
describe("F-032 Task 6: owner-line keywords on Preferences and Team", () => {
  it("finds Preferences by owner line, call in, pin and llamar (mutation: drop one of the four -> FAILS by name)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const prefs = entries.find((e) => e.id === "nav:preferences")!;
    for (const word of ["owner line", "call in", "pin", "llamar"]) {
      expect(prefs.keywords, word).toContain(word);
      expect(filterEntries(entries, word).map((e) => e.id), word).toContain("nav:preferences");
    }
  });

  it("finds Team (the agency's settings:team) by call in and owner line (mutation: drop either -> FAILS by name)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const team = entries.find((e) => e.id === "settings:team")!;
    for (const word of ["call in", "owner line"]) {
      expect(team.keywords, word).toContain(word);
      expect(filterEntries(entries, word).map((e) => e.id), word).toContain("settings:team");
    }
  });
});

describe("buildPaletteEntries — the agency's in-account ⌘K order matches origin/main (F-087 fix round, finding 3b)", () => {
  it("nav:preferences, nav:bis-access, nav:settings, nav:setup, settings:team, in that order (mutation: move the settings:team manifest row back above nav:required-documents → FAILS)", () => {
    const entries = buildPaletteEntries("/dashboard/accounts/acc_1", true, false);
    const ids = entries.filter((e) => e.kind === "href").map((e) => e.id);
    const order = ids.filter((id) =>
      ["nav:preferences", "nav:bis-access", "nav:settings", "nav:setup", "settings:team"].includes(id),
    );
    expect(order).toEqual(["nav:preferences", "nav:bis-access", "nav:settings", "nav:setup", "settings:team"]);
  });
});

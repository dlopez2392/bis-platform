import { buildNavGroups } from "@/lib/nav-groups";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

export type PaletteGroup = "navigation" | "settings" | "actions";

/** Actions are NAVIGATION-SAFE only (DESIGN.md rule 6 governs destructive
 *  work on its own surfaces). Nothing that writes tenant data belongs here:
 *  a fuzzy match is one keystroke from Enter. */
export type PaletteActionId = "toggle-theme";

export type PaletteEntry = {
  id: string;
  label: string;
  group: PaletteGroup;
  /** Belt-and-braces only. `buildPaletteEntries` never EMITS an agency-only
   *  entry for a client — this flag exists so a test can assert that, and so a
   *  future consumer cannot re-add one by accident. Hiding an entry is not
   *  authorization; every route still guards itself. */
  agencyOnly: boolean;
  /** Words an operator might type that the label does not contain. */
  keywords: string[];
} & (
  | { kind: "href"; href: string }
  | { kind: "action"; actionId: PaletteActionId }
);

/**
 * Settings sections, each pointing at an anchor on the settings page.
 *
 * DESIGN.md's command-palette pattern ends with "Settings sections must be
 * registered in the palette index" — this list IS that index, and the anchors
 * match the `id` attributes on the page's own sections. Settings is gated by
 * `requireAgencyOnlyAccountAccess` (settings/page.tsx), so every entry here is
 * agency-only.
 */
const SETTINGS_SECTIONS: { anchor: string; labelKey: MessageKey; keywords: string[] }[] = [
  { anchor: "client-access", labelKey: "palette.settings.clientAccess", keywords: ["login", "invite", "portal"] },
  { anchor: "sending-address", labelKey: "palette.settings.sendingAddress", keywords: ["email", "from", "domain", "never record", "block", "ignore sender"] },
  { anchor: "custom-fields", labelKey: "palette.settings.customFields", keywords: ["field", "crm"] },
  { anchor: "custom-values", labelKey: "palette.settings.customValues", keywords: ["value", "variable", "merge"] },
  { anchor: "alert-phone", labelKey: "palette.settings.alertPhone", keywords: ["sms", "text", "notify", "lead alert"] },
  { anchor: "billing", labelKey: "palette.settings.billing", keywords: ["plan", "subscription", "invoice", "stripe", "complimentary", "payment"] },
  // D-080: three real cards on this same page (settings/page.tsx's
  // <BrandingPanel>, <WeeklyReportCard id="weekly-report">, <LinkSiteCard
  // id="website">) had no entry here at all.
  { anchor: "branding", labelKey: "palette.settings.branding", keywords: ["logo", "colors", "theme", "brand name"] },
  { anchor: "weekly-report", labelKey: "palette.settings.weeklyReport", keywords: ["email report", "monday", "recipients"] },
  { anchor: "website", labelKey: "palette.settings.website", keywords: ["analytics", "traffic", "vercel", "domain", "link site"] },
  // S-07 2c: the required-documents list (settings/required-documents-card.tsx)
  { anchor: "required-documents", labelKey: "palette.settings.requiredDocuments", keywords: ["documents", "checklist", "required", "missing", "vault", "documentos", "requeridos"] },
  // Item 8a-1: the agency's AI card (settings/ai-card.tsx, #ai).
  { anchor: "ai", labelKey: "palette.settings.ai", keywords: ["ai", "budget", "spend", "switch", "summaries", "suggestions", "ia", "presupuesto"] },
  // S-53: the company's trade (settings/trade-card.tsx, #trade).
  { anchor: "trade", labelKey: "palette.settings.trade", keywords: ["trade", "industry", "business type", "vetting", "giro", "restaurant", "sofia", "web chat"] },
];

/** Extra search words per nav destination, keyed by the href SUFFIX so this
 *  survives a base change. A destination with no entry simply has none. */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/contacts": ["people", "customers", "leads"],
  // S-07 3a (spec 3.1): the document vault's account-wide list.
  "/documents": ["files", "vault", "expiring", "expired", "expiry", "insurance", "permit", "license", "warranty", "documentos", "archivos", "vencen", "vencidos"],
  "/pipeline": ["deals", "opportunities", "sales"],
  "/conversations": ["messages", "inbox", "sms", "email"],
  "/calls": ["phone", "receptionist", "sofia"],
  // "activity" added 2026-09-21 (cleanup item 2): the nav label changed to
  // "What went out" to stop colliding with the dashboard's own Activity
  // card, but the old word should still find this page.
  "/activity": ["history", "activity", "what went out", "sent", "waiting", "held", "skipped", "quiet hours", "usage", "log"],
  "/forms": ["lead form", "intake"],
  // "closed days"/"holiday"/"vacation"/"días cerrados"/"feriado"/"vacaciones" added S-47d (spec 5.6.3):
  // the Closed days card.
  // "phone calendar"/"subscribe"/"ical"/"ics"/"iphone"/"google calendar"/"outlook"/"calendario del teléfono"/
  // "suscribirse" added F-048 part 2: the Bookings on your phone card.
  "/calendar": ["booking", "availability", "hours", "closed days", "holiday", "vacation", "días cerrados", "feriado", "vacaciones",
    "phone calendar", "subscribe", "ical", "ics", "iphone", "google calendar", "outlook", "calendario del teléfono", "suscribirse",
    // F-046 part 1: the agenda card.
    "agenda", "schedule", "add job", "trabajo", "agregar trabajo"],
  "/tasks": ["task", "tasks", "to-do", "todo"],
  "/branding": ["logo", "colors", "theme"],
  // "hours"/"prices"/"services"/"horario"/"precios" added S-47c (spec 5.7): the Business hours and
  // Services & prices cards.
  "/voice": ["receptionist", "sofia", "ai", "website", "widget", "chat", "concierge", "bubble", "transfer", "forward", "person", "phones", "hours", "prices", "services", "horario", "precios"],
  "/automations": ["no-show", "no show", "text reminder", "reminder", "reviews", "review requests", "google review", "follow up", "text", "referral", "reactivation", "quote", "confirmation", "instant reply"],
  "/dashboard/accounts": ["companies", "clients"],
  "/dashboard/blueprints": ["templates"],
  "/dashboard/numbers": ["phone", "telnyx", "did", "line", "inventory", "reassign"],
  "/dashboard/screened": ["refused", "blocked", "spam", "declined", "rejected", "turned away"],
  "/dashboard/plans": ["billing", "pricing", "stripe", "subscription", "tier", "allowance", "overage"],
  "/billing": ["invoice", "invoices", "card", "payment", "plan", "subscription", "receipt"],
};

function keywordsFor(href: string, base: string | null): string[] {
  const suffix = base && href.startsWith(base) ? href.slice(base.length) : href;
  return NAV_KEYWORDS[suffix] ?? [];
}

/**
 * Every palette destination and action for this caller.
 *
 * Navigation entries are DERIVED from `buildNavGroups` rather than re-listed,
 * so a nav destination cannot exist without a palette entry — which is exactly
 * what DESIGN.md's registration rule asks for, enforced by construction rather
 * than by a promise. `registry.test.ts` asserts the parity in both roles.
 *
 * `base` is the in-account prefix (`/dashboard/accounts/<id>`), or null at the
 * agency top level where there is no account in scope.
 */
export function buildPaletteEntries(
  base: string | null, isAgency: boolean, isOwner: boolean, isTechnician = false, locale: Locale = "en",
): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  // S-10: the label is in the reader's language; in Spanish its English
  // twin joins the keywords, so a bilingual owner who types "contacts" still
  // finds Contactos. (Spanish KEYWORDS for every entry are F-095.)
  const label = (key: MessageKey) => t(m, key, locale);
  const words = (key: MessageKey, keywords: string[]) =>
    locale === "en" ? keywords : [...keywords, m[key].toLowerCase()];

  // A Technician (F-085 part 1, spec §9): the nav already leaves out every
  // route they cannot enter, so deriving from it leaves them out here too.
  for (const group of buildNavGroups(base, isAgency, isOwner, isTechnician)) {
    for (const item of group.items) {
      entries.push({
        kind: "href",
        id: `nav:${item.href}`,
        label: label(item.labelKey),
        group: "navigation",
        agencyOnly: false, // buildNavGroups already withheld agency-only items
        keywords: words(item.labelKey, keywordsFor(item.href, base)),
        href: item.href,
      });
    }
  }

  // Mis preferencias (F-096, Task 6): a person's OWN page, not an
  // account's, so it is offered to every caller, with or without an account
  // in scope. Not a nav item (it lives in the user menu), so registered here.
  entries.push({
    kind: "href", id: "nav:preferences", label: label("prefs.palette"), group: "navigation", agencyOnly: false,
    keywords: ["preferences", "language", "idioma", "español", "spanish", "english", "theme", "dark", "light", "appearance", "my"],
    href: "/dashboard/preferences",
  });

  // Staff and roles (Task 8): a client Owner reaches team management
  // directly — the sidebar footer's own destination, not a Settings-page
  // anchor, so it is registered like any other nav destination rather than
  // through SETTINGS_SECTIONS below. Staff never get this entry, nor does a
  // Technician (never an Owner).
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href",
      id: "nav:team",
      label: label("nav.team"),
      group: "navigation",
      agencyOnly: false,
      keywords: ["team", "staff", "people", "invite", "users", "logins", "employees"],
      href: `${base}/team`,
    });
  }

  // S-07 3a (spec 3.3): a client Owner edits the required-documents list on
  // the Documents page's own card (#required-documents). The agency keeps
  // Settings' card (SETTINGS_SECTIONS); Staff and a Technician get neither.
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href", id: "nav:required-documents", label: label("palette.settings.requiredDocuments"), group: "navigation", agencyOnly: false,
      keywords: ["documents", "checklist", "required", "missing", "documentos", "requeridos"],
      href: `${base}/documents#required-documents`,
    });
  }

  // F-118 part 1 (owner ruling 9): the Team page's own "BIS access"
  // section — every visit BIS has made to this account, its reason and
  // what it opened — reached by an Owner directly and by the agency.
  // Staff and a Technician never get this entry, and never reach the Team
  // page at all (requireAccountOwner itself keeps them off it, so hiding
  // this entry is convenience, not the authorization — same discipline as
  // every other entry in this file).
  if (base && (isAgency || isOwner)) {
    entries.push({
      kind: "href", id: "nav:bis-access", label: label("accessLog.title"), group: "navigation", agencyOnly: false,
      keywords: ["bis", "access", "log", "visits", "who looked", "acceso", "registro", "visitas"],
      href: `${base}/team#bis-access`,
    });
  }

  if (base && isAgency) {
    entries.push({
      kind: "href",
      id: "nav:settings",
      label: label("nav.settings"),
      group: "navigation",
      agencyOnly: true,
      keywords: ["configuration", "preferences"],
      href: `${base}/settings`,
    });
    entries.push({
      kind: "href",
      id: "nav:setup",
      label: label("nav.setup"),
      group: "navigation",
      agencyOnly: true,
      keywords: ["wizard", "activation", "onboarding", "go live"],
      href: `${base}/setup`,
    });
    // The agency's own entry point into this client's team management: the
    // Team page (`/team`), which admits the agency and shows the same card
    // as Settings. Not a SETTINGS_SECTIONS anchor, although Settings does
    // carry an `id="team"` card since Task 10: that card renders only while
    // client access is on (spec §8), so `settings#team` would scroll to
    // nothing whenever access is off, which is the defect registry.test.ts's
    // anchor-parity check (D-080) exists to catch. /team always answers,
    // with the access-off note when access is off. A plain navigation entry
    // (`group: "navigation"`) like `nav:settings`/`nav:setup` above, keeping
    // the `palette.settings.team` label and its keywords, so the agency finds
    // it by typing "team" or "staff".
    entries.push({
      kind: "href",
      id: "settings:team",
      label: label("palette.settings.team"),
      group: "navigation",
      agencyOnly: true,
      keywords: ["team", "staff", "invite", "logins", "people"],
      href: `${base}/team`,
    });
    for (const section of SETTINGS_SECTIONS) {
      entries.push({
        kind: "href",
        id: `settings:${section.anchor}`,
        label: label(section.labelKey),
        group: "settings",
        agencyOnly: true,
        keywords: words(section.labelKey, section.keywords),
        href: `${base}/settings#${section.anchor}`,
      });
    }
  }

  entries.push({
    kind: "action",
    id: "action:toggle-theme",
    label: label("palette.action.toggleTheme"),
    group: "actions",
    agencyOnly: false,
    keywords: ["dark", "light", "appearance", "theme"],
    actionId: "toggle-theme",
  });

  return entries;
}

/**
 * Pure substring matching over label + keywords.
 *
 * The palette runs cmdk with `shouldFilter={false}` and calls this instead, for
 * two reasons: the live half's server results must NOT be re-filtered by a
 * client-side matcher that never saw the row's other columns, and matching that
 * lives in a pure function is testable in this app's vitest, which has no DOM.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = [entry.label, ...entry.keywords].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

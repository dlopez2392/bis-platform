import { buildNavGroups } from "@/lib/nav-groups";
import { m } from "@/lib/messages";

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
const SETTINGS_SECTIONS: { anchor: string; label: string; keywords: string[] }[] = [
  { anchor: "client-access", label: m["palette.settings.clientAccess"], keywords: ["login", "invite", "portal"] },
  { anchor: "sending-address", label: m["palette.settings.sendingAddress"], keywords: ["email", "from", "domain"] },
  { anchor: "custom-fields", label: m["palette.settings.customFields"], keywords: ["field", "crm"] },
  { anchor: "custom-values", label: m["palette.settings.customValues"], keywords: ["value", "variable", "merge"] },
  { anchor: "alert-phone", label: m["palette.settings.alertPhone"], keywords: ["sms", "text", "notify", "lead alert"] },
  { anchor: "billing", label: m["palette.settings.billing"], keywords: ["plan", "subscription", "invoice", "stripe", "complimentary", "payment"] },
  // D-080: three real cards on this same page (settings/page.tsx's
  // <BrandingPanel>, <WeeklyReportCard id="weekly-report">, <LinkSiteCard
  // id="website">) had no entry here at all.
  { anchor: "branding", label: m["palette.settings.branding"], keywords: ["logo", "colors", "theme", "brand name"] },
  { anchor: "weekly-report", label: m["palette.settings.weeklyReport"], keywords: ["email report", "monday", "recipients"] },
  { anchor: "website", label: m["palette.settings.website"], keywords: ["analytics", "traffic", "vercel", "domain", "link site"] },
];

/** Extra search words per nav destination, keyed by the href SUFFIX so this
 *  survives a base change. A destination with no entry simply has none. */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/contacts": ["people", "customers", "leads"],
  "/pipeline": ["deals", "opportunities", "sales"],
  "/conversations": ["messages", "inbox", "sms", "email"],
  "/calls": ["phone", "receptionist", "sofia"],
  // "activity" added 2026-09-21 (cleanup item 2): the nav label changed to
  // "What went out" to stop colliding with the dashboard's own Activity
  // card, but the old word should still find this page.
  "/activity": ["history", "activity", "what went out", "sent", "waiting", "held", "skipped", "quiet hours", "usage", "log"],
  "/forms": ["lead form", "intake"],
  "/calendar": ["booking", "availability", "hours"],
  "/tasks": ["task", "tasks", "to-do", "todo"],
  "/branding": ["logo", "colors", "theme"],
  "/voice": ["receptionist", "sofia", "ai", "website", "widget", "chat", "concierge", "bubble", "transfer", "forward", "person", "phones"],
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
export function buildPaletteEntries(base: string | null, isAgency: boolean, isOwner: boolean): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  for (const group of buildNavGroups(base, isAgency, isOwner)) {
    for (const item of group.items) {
      entries.push({
        kind: "href",
        id: `nav:${item.href}`,
        label: m[item.labelKey],
        group: "navigation",
        agencyOnly: false, // buildNavGroups already withheld agency-only items
        keywords: keywordsFor(item.href, base),
        href: item.href,
      });
    }
  }

  // Mis preferencias (F-096, Task 6): a person's OWN page, not an
  // account's, so it is offered to every caller, with or without an account
  // in scope. Not a nav item (it lives in the user menu), so registered here.
  entries.push({
    kind: "href", id: "nav:preferences", label: m["prefs.palette"], group: "navigation", agencyOnly: false,
    keywords: ["preferences", "language", "idioma", "español", "spanish", "english", "theme", "dark", "light", "appearance", "my"],
    href: "/dashboard/preferences",
  });

  // Staff and roles (Task 8): a client Owner reaches team management
  // directly — the sidebar footer's own destination, not a Settings-page
  // anchor, so it is registered like any other nav destination rather than
  // through SETTINGS_SECTIONS below. Staff never get this entry.
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href",
      id: "nav:team",
      label: m["nav.team"],
      group: "navigation",
      agencyOnly: false,
      keywords: ["team", "staff", "people", "invite", "users", "logins", "employees"],
      href: `${base}/team`,
    });
  }

  if (base && isAgency) {
    entries.push({
      kind: "href",
      id: "nav:settings",
      label: m["nav.settings"],
      group: "navigation",
      agencyOnly: true,
      keywords: ["configuration", "preferences"],
      href: `${base}/settings`,
    });
    entries.push({
      kind: "href",
      id: "nav:setup",
      label: m["nav.setup"],
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
      label: m["palette.settings.team"],
      group: "navigation",
      agencyOnly: true,
      keywords: ["team", "staff", "invite", "logins", "people"],
      href: `${base}/team`,
    });
    for (const section of SETTINGS_SECTIONS) {
      entries.push({
        kind: "href",
        id: `settings:${section.anchor}`,
        label: section.label,
        group: "settings",
        agencyOnly: true,
        keywords: section.keywords,
        href: `${base}/settings#${section.anchor}`,
      });
    }
  }

  entries.push({
    kind: "action",
    id: "action:toggle-theme",
    label: m["palette.action.toggleTheme"],
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

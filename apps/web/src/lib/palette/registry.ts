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
];

/** Extra search words per nav destination, keyed by the href SUFFIX so this
 *  survives a base change. A destination with no entry simply has none. */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/contacts": ["people", "customers", "leads"],
  "/pipeline": ["deals", "opportunities", "sales"],
  "/conversations": ["messages", "inbox", "sms", "email"],
  "/calls": ["phone", "receptionist", "sofia"],
  "/forms": ["lead form", "intake"],
  "/calendar": ["booking", "availability", "hours"],
  "/tasks": ["task", "tasks", "to-do", "todo"],
  "/branding": ["logo", "colors", "theme"],
  "/voice": ["receptionist", "sofia", "ai"],
  "/automations": ["no-show", "no show", "text reminder", "reminder", "reviews", "review requests", "google review", "follow up", "text"],
  "/dashboard/accounts": ["companies", "clients"],
  "/dashboard/blueprints": ["templates"],
  "/dashboard/numbers": ["phone", "telnyx", "did", "line", "inventory", "reassign"],
  "/dashboard/screened": ["refused", "blocked", "spam", "declined", "rejected", "turned away"],
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
export function buildPaletteEntries(base: string | null, isAgency: boolean): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  for (const group of buildNavGroups(base, isAgency)) {
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

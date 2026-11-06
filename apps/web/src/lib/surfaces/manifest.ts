import type { MessageKey } from "../messages";

/**
 * F-087 part 1 (spec `docs/superpowers/specs/2026-11-06-surface-manifest-design.md`):
 * one typed map of every surface a menu offers — the sidebar's scrolling
 * nav, the sidebar's pinned footer, and the ⌘K palette's own extra pushes —
 * read by `nav-groups.ts`'s `buildNavGroups` and `palette/registry.ts`'s
 * `buildPaletteEntries` instead of each re-typing its own list. Pure and
 * framework-free, same discipline `nav-groups.ts`'s own doc comment states
 * for why: no React, no DB, unit-testable without a DOM.
 *
 * DISPLAY ONLY, NEVER AUTHORISATION (spec §3's own words): `audience`
 * decides what a menu *offers*, never what a request *admits*. Every route
 * keeps its own guard (`requireAgency`, `requireAgencyOnlyAccountAccess`,
 * `requireAccountOwner`, `requireAccountAccess`, …) exactly as before this
 * manifest existed.
 *
 * Named rather than the icon itself, same reason `nav-groups.ts` used to
 * give for `NavIconKey`: `app-sidebar.tsx` owns the actual icon components
 * and maps this key to one when rendering. `NavIconKey` now lives here
 * (nav-groups.ts re-exports it unchanged) because this module is the lower
 * one in the dependency direction — nav-groups.ts reads SURFACE_MANIFEST,
 * so a type nav-groups.ts needed could not live there without a circular
 * import back into this file.
 */
export type NavIconKey =
  | "dashboard"
  | "tasks"
  | "website"
  | "contacts"
  | "documents"
  | "opportunities"
  | "conversations"
  | "calls"
  | "activity"
  | "forms"
  | "calendar"
  | "branding"
  | "voice"
  | "automations"
  | "accounts"
  | "blueprints"
  | "numbers"
  | "checklist"
  | "work"
  | "screened"
  | "plans"
  | "billing";

/** Spec §2.1. "action" has no entry in SURFACE_MANIFEST yet (part 1's own
 *  table, row 4, deliberately excludes the toggle-theme push — it stays a
 *  hand-pushed `PaletteEntry` in registry.ts, outside this manifest) — kept
 *  in the union for the shape the spec gives, not because anything uses it
 *  today. */
export type SurfaceKind = "page" | "settings-section" | "action";

export type SurfaceScope = "agency-top" | "account" | "person";

export type SurfaceAudience = {
  agency: boolean;
  /** true = every client role (Owner and Staff); "owner" = client Owner only. */
  client: boolean | "owner";
  /** A further narrowing of `client`, never a fourth audience value (spec
   *  §2.1's own words): meaningful only when `client` is not `false`. */
  technician: boolean;
};

export type SurfaceEntry = {
  /** Stable and base-independent — used for the keyword lookup (Q3: a
   *  separate, palette-only, id-keyed table in registry.ts) and, for every
   *  entry that is NOT nav-rendered (see `iconKey` below), as the literal
   *  exposed `PaletteEntry.id` too. A nav-rendered entry's exposed palette
   *  id stays `nav:${href}` (base-baked), matching every id
   *  `registry.test.ts` already pins — this field is not that id for those
   *  entries. */
  id: string;
  kind: SurfaceKind;
  scope: SurfaceScope;
  /** `nav.group.*` for the scrolling nav; null for everything else
   *  (settings-section anchors, the footer-only/standalone extras, the
   *  agency's flat top-level list — which has no header row at all). */
  group: MessageKey | null;
  /** Existing m/t() key — no new strings for an existing surface (DESIGN.md
   *  DoD; spec's own invariant). */
  labelKey: MessageKey;
  route: (base: string | null) => string;
  audience: SurfaceAudience;
  /** The real `id="…"` the page carries, for a `settings-section` entry's
   *  anchor. Entries that reach a page by a `#fragment` for some OTHER
   *  reason (`nav:required-documents`, `nav:bis-access`) carry the fragment
   *  inside `route()`'s own output instead — the widened navigation-anchor
   *  probe (spec §4, probe 3) reads it from there, regardless of `kind`. */
  anchor?: string;
  /** Present only on an entry that renders as an icon+label row in the
   *  scrolling nav — the sidebar's footer, the palette's standalone extras
   *  and every settings-section anchor never carry one. `buildNavGroups`
   *  filters on exactly this (never on `scope`/`group` alone, which the
   *  agency's new top-level `/dashboard` entry — scope "agency-top", group
   *  null, same as the flat nav list's own six items — would otherwise be
   *  indistinguishable from). */
  iconKey?: NavIconKey;
};

function hasIcon(e: SurfaceEntry): e is SurfaceEntry & { iconKey: NavIconKey } {
  return e.iconKey !== undefined;
}

/** Narrows the manifest to the entries `buildNavGroups` renders — the
 *  scrolling nav's own `iconKey`-bearing rows for the given scope. */
export function navCandidates(
  scope: "account" | "agency-top",
): (SurfaceEntry & { iconKey: NavIconKey })[] {
  // Two filter passes, not one combined boolean expression: `hasIcon`'s own
  // type predicate only narrows the array type when it is passed directly
  // as the callback — `(e) => e.scope === scope && hasIcon(e)` is a plain
  // boolean-returning function to TypeScript, not that predicate.
  return SURFACE_MANIFEST.filter((e) => e.scope === scope).filter(hasIcon);
}

/**
 * Whether a caller in this role sees this entry at all — display only,
 * never authorisation (every call site still relies on the route's own
 * guard). Agency wins outright; a Technician is a further narrowing of
 * `client` (never a fourth value); `client: "owner"` needs `isOwner`;
 * plain `client: true` admits every client role.
 */
export function audienceIncludes(
  audience: SurfaceAudience, isAgency: boolean, isOwner: boolean, isTechnician: boolean,
): boolean {
  if (isAgency) return audience.agency;
  if (isTechnician) return audience.technician;
  if (audience.client === "owner") return isOwner;
  return audience.client === true;
}

export function surfaceById(id: string): SurfaceEntry {
  const entry = SURFACE_MANIFEST.find((e) => e.id === id);
  if (!entry) throw new Error(`surfaceById: no manifest entry with id "${id}"`);
  return entry;
}

// ---------------------------------------------------------------------------
// The entries. Order within a `group`/the agency's flat top-level list is
// the RENDER order — buildNavGroups preserves it (a stable filter), so it
// must match today's output exactly (nav-groups.test.ts's own exhaustive
// snapshots are the regression guard).
// ---------------------------------------------------------------------------

export const SURFACE_MANIFEST: SurfaceEntry[] = [
  // --- OVERVIEW -------------------------------------------------------
  {
    id: "nav:dashboard", kind: "page", scope: "account", group: "nav.group.overview",
    labelKey: "nav.dashboard", iconKey: "dashboard", route: (base) => `${base}/dashboard`,
    audience: { agency: true, client: true, technician: false },
  },
  {
    id: "nav:tasks", kind: "page", scope: "account", group: "nav.group.overview",
    labelKey: "nav.tasks", iconKey: "tasks", route: (base) => `${base}/tasks`,
    // Both audiences, directly under Dashboard, AND a Technician's own
    // landing (F-085 part 1, spec §9).
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:website", kind: "page", scope: "account", group: "nav.group.overview",
    labelKey: "nav.website", iconKey: "website", route: (base) => `${base}/website`,
    audience: { agency: true, client: true, technician: false },
  },
  {
    id: "nav:checklist", kind: "page", scope: "account", group: "nav.group.overview",
    labelKey: "nav.checklist", iconKey: "checklist", route: (base) => `${base}/checklist`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:billing", kind: "page", scope: "account", group: "nav.group.overview",
    labelKey: "nav.billing", iconKey: "billing", route: (base) => `${base}/billing`,
    // Staff and roles: a client Owner only, never the agency (it is not
    // even a client membership — Billing is the agency's own /dashboard/plans).
    audience: { agency: false, client: "owner", technician: false },
  },

  // --- CRM -------------------------------------------------------------
  {
    id: "nav:contacts", kind: "page", scope: "account", group: "nav.group.crm",
    labelKey: "nav.contacts", iconKey: "contacts", route: (base) => `${base}/contacts`,
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:documents", kind: "page", scope: "account", group: "nav.group.crm",
    labelKey: "nav.documents", iconKey: "documents", route: (base) => `${base}/documents`,
    // S-07 3a: every role, a Technician too (RLS bounds their rows; the
    // page itself calls requireAccountAccess only).
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:pipeline", kind: "page", scope: "account", group: "nav.group.crm",
    labelKey: "nav.opportunities", iconKey: "opportunities", route: (base) => `${base}/pipeline`,
    audience: { agency: true, client: true, technician: false },
  },

  // --- COMMUNICATIONS ----------------------------------------------------
  {
    id: "nav:conversations", kind: "page", scope: "account", group: "nav.group.communications",
    labelKey: "nav.conversations", iconKey: "conversations", route: (base) => `${base}/conversations`,
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:calls", kind: "page", scope: "account", group: "nav.group.communications",
    labelKey: "nav.calls", iconKey: "calls", route: (base) => `${base}/calls`,
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:activity", kind: "page", scope: "account", group: "nav.group.communications",
    labelKey: "nav.activity", iconKey: "activity", route: (base) => `${base}/activity`,
    audience: { agency: true, client: true, technician: false },
  },
  {
    id: "nav:voice", kind: "page", scope: "account", group: "nav.group.communications",
    labelKey: "nav.voice", iconKey: "voice", route: (base) => `${base}/voice`,
    audience: { agency: true, client: false, technician: false },
  },

  // --- GROWTH --------------------------------------------------------
  {
    id: "nav:forms", kind: "page", scope: "account", group: "nav.group.growth",
    labelKey: "nav.forms", iconKey: "forms", route: (base) => `${base}/forms`,
    audience: { agency: true, client: true, technician: false },
  },
  {
    id: "nav:calendar", kind: "page", scope: "account", group: "nav.group.growth",
    labelKey: "nav.calendar", iconKey: "calendar", route: (base) => `${base}/calendar`,
    audience: { agency: true, client: true, technician: true },
  },
  {
    id: "nav:automations", kind: "page", scope: "account", group: "nav.group.growth",
    labelKey: "nav.automations", iconKey: "automations", route: (base) => `${base}/automations`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:branding", kind: "page", scope: "account", group: "nav.group.growth",
    labelKey: "nav.branding", iconKey: "branding", route: (base) => `${base}/branding`,
    // Clients only (Owner and Staff) — the agency sees the same panel on
    // the account's Settings card; never a Technician (F-085 part 1).
    audience: { agency: false, client: true, technician: false },
  },

  // --- The agency's flat top-level list (no group header; scope agency-top) ---
  {
    id: "nav:accounts", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.accounts", iconKey: "accounts", route: () => "/dashboard/accounts",
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:blueprints", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.blueprints", iconKey: "blueprints", route: () => "/dashboard/blueprints",
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:work", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.work", iconKey: "work", route: () => "/dashboard/work",
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:numbers", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.numbers", iconKey: "numbers", route: () => "/dashboard/numbers",
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:screened", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.screened", iconKey: "screened", route: () => "/dashboard/screened",
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:plans", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.plans", iconKey: "plans", route: () => "/dashboard/plans",
    audience: { agency: true, client: false, technician: false },
  },

  // --- The agency's own /dashboard: spec finding (a), owner ruling Q2 ---
  // (2026-11-06). No `iconKey`: it does NOT join the flat top-level list
  // above (no visible nav change) — it is reachable today only by the
  // wordmark and the footer's own fallback link (app-sidebar.tsx), and from
  // 2026-11-06 by ⌘K too (spec probe 7), both reading this ONE entry.
  {
    id: "nav:/dashboard", kind: "page", scope: "agency-top", group: null,
    labelKey: "nav.dashboard", route: () => "/dashboard",
    audience: { agency: true, client: false, technician: false },
  },

  // --- Person scope: not an account's, offered with or without one -------
  {
    id: "nav:preferences", kind: "page", scope: "person", group: null,
    labelKey: "prefs.palette", route: () => "/dashboard/preferences",
    audience: { agency: true, client: true, technician: true },
  },

  // --- Account-scoped standalone extras: no iconKey, never in the scrolling nav ---
  {
    // Staff and roles: a client Owner's own entry point into Team.
    id: "nav:team", kind: "page", scope: "account", group: null,
    labelKey: "nav.team", route: (base) => `${base}/team`,
    audience: { agency: false, client: "owner", technician: false },
  },
  {
    // The agency's own entry point into the SAME page — /team admits both
    // (team/page.tsx's own requireAccountOwner), so this is a second menu
    // id for one shared route, not a second guard.
    id: "settings:team", kind: "page", scope: "account", group: null,
    labelKey: "palette.settings.team", route: (base) => `${base}/team`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    // S-07 3a (spec 3.3): a client Owner edits the required-documents list
    // on the Documents page's own card.
    id: "nav:required-documents", kind: "page", scope: "account", group: null,
    labelKey: "palette.settings.requiredDocuments", route: (base) => `${base}/documents#required-documents`,
    audience: { agency: false, client: "owner", technician: false },
  },
  {
    // F-118 part 1 (owner ruling 9): the Team page's own "BIS access"
    // section, reached by an Owner directly and by the agency.
    id: "nav:bis-access", kind: "page", scope: "account", group: null,
    labelKey: "accessLog.title", route: (base) => `${base}/team#bis-access`,
    audience: { agency: true, client: "owner", technician: false },
  },
  {
    id: "nav:settings", kind: "page", scope: "account", group: null,
    labelKey: "nav.settings", route: (base) => `${base}/settings`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "nav:setup", kind: "page", scope: "account", group: null,
    labelKey: "nav.setup", route: (base) => `${base}/setup`,
    audience: { agency: true, client: false, technician: false },
  },

  // --- Settings-section anchors (D-080) -----------------------------------
  {
    id: "settings:client-access", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.clientAccess", anchor: "client-access",
    route: (base) => `${base}/settings#client-access`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:sending-address", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.sendingAddress", anchor: "sending-address",
    route: (base) => `${base}/settings#sending-address`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:custom-fields", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.customFields", anchor: "custom-fields",
    route: (base) => `${base}/settings#custom-fields`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:custom-values", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.customValues", anchor: "custom-values",
    route: (base) => `${base}/settings#custom-values`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:alert-phone", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.alertPhone", anchor: "alert-phone",
    route: (base) => `${base}/settings#alert-phone`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:billing", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.billing", anchor: "billing",
    route: (base) => `${base}/settings#billing`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    // D-080: three real cards (BrandingPanel, WeeklyReportCard, LinkSiteCard)
    // had no entry at all — branding, weekly-report and website below.
    id: "settings:branding", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.branding", anchor: "branding",
    route: (base) => `${base}/settings#branding`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:weekly-report", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.weeklyReport", anchor: "weekly-report",
    route: (base) => `${base}/settings#weekly-report`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:website", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.website", anchor: "website",
    route: (base) => `${base}/settings#website`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    id: "settings:required-documents", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.requiredDocuments", anchor: "required-documents",
    route: (base) => `${base}/settings#required-documents`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    // Item 8a-1: the agency's AI card.
    id: "settings:ai", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.ai", anchor: "ai",
    route: (base) => `${base}/settings#ai`,
    audience: { agency: true, client: false, technician: false },
  },
  {
    // S-53: the company's trade.
    id: "settings:trade", kind: "settings-section", scope: "account", group: null,
    labelKey: "palette.settings.trade", anchor: "trade",
    route: (base) => `${base}/settings#trade`,
    audience: { agency: true, client: false, technician: false },
  },
];

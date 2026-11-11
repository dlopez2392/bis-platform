import { audienceIncludes, navCandidates, type NavIconKey } from "./surfaces/manifest";
import type { MessageKey } from "./messages";

// F-087 part 1: NavIconKey now lives in surfaces/manifest.ts (the lower
// module in the dependency direction — this file reads SURFACE_MANIFEST
// via navCandidates, so a type this file needed could not live here without
// a circular import). Re-exported so every existing import of it from
// "@/lib/nav-groups" (app-sidebar.tsx) keeps working unchanged.
export type { NavIconKey } from "./surfaces/manifest";

export type NavItemSpec = {
  href: string;
  labelKey: MessageKey;
  iconKey: NavIconKey;
};

export type NavGroupSpec = {
  /** null for the flat agency top-level group — DESIGN.md's grouped-nav
   *  pattern applies only inside an account; Companies/Blueprints stay a
   *  single ungrouped list, so there is no header row to hide or show. */
  label: MessageKey | null;
  items: NavItemSpec[];
};

/** Render order of the four in-account groups (DESIGN.md's sidebar pattern:
 *  OVERVIEW / CRM / COMMUNICATIONS / GROWTH). */
const GROUP_ORDER: MessageKey[] = [
  "nav.group.overview", "nav.group.crm", "nav.group.communications", "nav.group.growth",
];

/**
 * The in-account/top-level nav structure, grouped per DESIGN.md's sidebar
 * pattern and F-087 part 1's own SURFACE_MANIFEST (surfaces/manifest.ts) —
 * a filter-and-group over the manifest's `iconKey`-bearing entries, rather
 * than inlined literals. Pure and framework-free by design — see
 * NavIconKey above.
 *
 * Setup is deliberately absent: it leaves the nav entirely (Task 3 re-homes
 * it in the footer as a setup-progress meter, per DESIGN.md's "Setup" key
 * pattern). The manifest's own `nav:setup` entry carries no `iconKey` for
 * exactly this reason — it never becomes a `navCandidates` row.
 *
 * A Technician (F-085 part 1, spec §9) needs no special-cased branch here
 * any more: every one of the 16 in-account entries already carries its own
 * `audience.technician` flag (manifest.ts), and filtering the SAME
 * group-ordered candidates by that flag reproduces their exact six-item,
 * four-group subset — the group each item keeps is the one it already had.
 */
export function buildNavGroups(
  base: string | null, isAgency: boolean, isOwner: boolean, isTechnician = false,
): NavGroupSpec[] {
  const scope = base === null ? "agency-top" : "account";
  const candidates = navCandidates(scope).filter(
    (entry) => audienceIncludes(entry.audience, isAgency, isOwner, isTechnician),
  );

  if (base === null) {
    return [{ label: null, items: candidates.map((entry) => toNavItem(entry, base)) }];
  }

  return GROUP_ORDER.map((label) => ({
    label,
    items: candidates.filter((entry) => entry.group === label).map((entry) => toNavItem(entry, base)),
  }));
}

function toNavItem(
  entry: { route: (base: string | null) => string; labelKey: MessageKey; iconKey: NavIconKey },
  base: string | null,
): NavItemSpec {
  return { href: entry.route(base), labelKey: entry.labelKey, iconKey: entry.iconKey };
}

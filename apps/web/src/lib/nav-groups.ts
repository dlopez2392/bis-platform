import type { MessageKey } from "./messages";

/**
 * Named rather than the icon itself: this module is pure (no React, no
 * lucide-react) so it can be unit-tested without a DOM, per the Task 2
 * brief. app-sidebar.tsx owns the actual icon components and maps this key
 * to one when rendering.
 */
export type NavIconKey =
  | "dashboard"
  | "contacts"
  | "opportunities"
  | "conversations"
  | "calls"
  | "forms"
  | "calendar"
  | "branding"
  | "voice"
  | "accounts"
  | "blueprints";

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

/**
 * The in-account/top-level nav structure, grouped per DESIGN.md's sidebar
 * pattern (OVERVIEW / CRM / COMMUNICATIONS / GROWTH) and the Task 2 brief's
 * grouping map. Pure and framework-free by design — see NavIconKey above.
 *
 * Setup is deliberately absent: it leaves the nav entirely (Task 3 re-homes
 * it in the footer as a setup-progress meter, per DESIGN.md's "Setup" key
 * pattern). Removing it here now, ahead of that footer work landing, is
 * still correct — a stale in-progress link is worse than a temporarily
 * missing one.
 */
export function buildNavGroups(base: string | null, isAgency: boolean): NavGroupSpec[] {
  if (base === null) {
    return [
      {
        label: null,
        items: [
          { href: "/dashboard/accounts", labelKey: "nav.accounts", iconKey: "accounts" },
          { href: "/dashboard/blueprints", labelKey: "nav.blueprints", iconKey: "blueprints" },
        ],
      },
    ];
  }

  return [
    {
      label: "nav.group.overview",
      items: [
        { href: `${base}/dashboard`, labelKey: "nav.dashboard", iconKey: "dashboard" },
      ],
    },
    {
      label: "nav.group.crm",
      items: [
        { href: `${base}/contacts`, labelKey: "nav.contacts", iconKey: "contacts" },
        { href: `${base}/pipeline`, labelKey: "nav.opportunities", iconKey: "opportunities" },
      ],
    },
    {
      label: "nav.group.communications",
      items: [
        { href: `${base}/conversations`, labelKey: "nav.conversations", iconKey: "conversations" },
        // BOTH audiences — the client's own business data, not agency
        // configuration. See app-sidebar.tsx's calls-item comment for why
        // this stays visible where Voice (immediately below) does not.
        { href: `${base}/calls`, labelKey: "nav.calls", iconKey: "calls" },
        // Agency only. The route itself is still gated independently by
        // requireAgencyOnlyAccountAccess and by the isAgency check inside
        // every action in ./voice/actions.ts — hiding the link here is
        // convenience, not the boundary.
        ...(isAgency
          ? ([{ href: `${base}/voice`, labelKey: "nav.voice", iconKey: "voice" }] satisfies NavItemSpec[])
          : []),
      ],
    },
    {
      label: "nav.group.growth",
      items: [
        { href: `${base}/forms`, labelKey: "nav.forms", iconKey: "forms" },
        { href: `${base}/calendar`, labelKey: "nav.calendar", iconKey: "calendar" },
        // Clients only — the agency reaches the same panel from Settings.
        // The route itself still works for the agency; hiding a link is
        // not authorization.
        ...(isAgency
          ? []
          : ([{ href: `${base}/branding`, labelKey: "nav.branding", iconKey: "branding" }] satisfies NavItemSpec[])),
      ],
    },
  ];
}

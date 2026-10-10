"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  MessagesSquare,
  Calendar,
  Globe,
  FileText,
  Settings,
  Building2,
  Layers, ListChecks, ListTodo,
  PanelLeftClose,
  PanelLeft,
  ArrowLeft,
  Palette,
  Phone,
  PhoneIncoming,
  PhoneForwarded,
  Zap,
  ShieldAlert,
  Activity,
  CreditCard,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher, type AccountOption } from "@/components/account-switcher";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { buildNavGroups, type NavIconKey } from "@/lib/nav-groups";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
// Conversations' unread badge and the footer's setup meter both read from
// this one shared background fetch — see shell-data.tsx's own doc comment
// for why the read lives in the [accountId] segment (via shell-actions.ts)
// rather than this component's own layout ancestor, and for the
// paired-state/derive-by-account-match shape that used to live here as two
// separate effects before this task coalesced them into one.
import { useShellData } from "@/components/shell-data";

type NavItem = { href: string; label: string; icon: LucideIcon };

// Task 11 (Spanish-runtime lane), fix round 1: consumed by the styleguide's
// pseudo-locale overflow demo (locale-nav-demo.tsx) so its container can
// reproduce THIS row's real truncation geometry — real width, real padding,
// real gap, real icon size, real truncate class — rather than a second,
// hand-copied set of the same literals that could silently drift from this
// one. NOT wired back into SidebarLink's own render below: this file's own
// app-sidebar.test.ts already pins the exact literal strings below
// (`"w-16 sm:w-[236px]"`, the Link's `"sm:justify-start sm:px-2.5"`, the
// label span's `"hidden min-w-0 flex-1 truncate sm:block"`) byte for byte,
// and composing them through these constants changed each literal's exact
// substring, breaking three of those pins for no behavioural difference.
// app-sidebar-nav-geometry.test.ts instead source-scans THIS file and
// asserts each constant's value is still a literal substring of the real
// render, so a value changing on one side without the other is still
// caught — just via a parity read rather than a single shared call site.
export const SIDEBAR_EXPANDED_WIDTH_CLASS = "w-16 sm:w-[236px]";
export const NAV_ROW_GAP_CLASS = "gap-2.5";
export const NAV_ROW_EXPANDED_PADDING_CLASS = "sm:px-2.5";
export const NAV_ICON_SIZE_CLASS = "size-4";
export const NAV_LABEL_TRUNCATE_CLASS = "min-w-0 flex-1 truncate";

// The pure nav-groups module maps hrefs/labelKeys only (see its own doc
// comment for why); this component owns the actual icon components and the
// one place that maps an icon key to one.
const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  tasks: ListTodo,
  website: Globe,
  contacts: Users,
  opportunities: KanbanSquare,
  conversations: MessagesSquare,
  // `PhoneIncoming` rather than `Phone` so Calls stays distinguishable from
  // Voice in the agency's sidebar, where both appear.
  calls: PhoneIncoming,
  activity: Activity,
  forms: FileText,
  calendar: Calendar,
  branding: Palette,
  voice: Phone,
  automations: Zap,
  accounts: Building2,
  blueprints: Layers,
  // `PhoneForwarded` rather than `Phone`: the top-level inventory and the
  // in-account Voice settings are different screens, and the arrow is the
  // honest glyph for the one whose whole purpose is moving a line from one
  // company to another.
  numbers: PhoneForwarded,
  checklist: ListChecks,
  // Same icon as `tasks` — the two never render in the same sidebar (`base`
  // selects one nav shape or the other, never both), and it is the same
  // feature at a different scope: one account's to-dos vs. every account's.
  work: ListTodo,
  // `ShieldAlert` rather than `Shield`: this screen is not a security
  // setting, it is a list of things that were turned away.
  screened: ShieldAlert,
  // `CreditCard`: the screen is what clients are charged, not a report.
  plans: CreditCard,
  // `Receipt`, not `CreditCard`: the client's page is what they were billed
  // and will be, not the agency's price list.
  billing: Receipt,
};

// Active when pathname matches href exactly, or is nested under it (href + "/…").
// Pass exact=true for items whose href is a strict prefix of a sibling item's
// href (e.g. the agency-scope "/dashboard" footer link, which every dashboard
// route is nested under) so only one nav item is ever active at a time.
function isNavActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  accounts,
  defaultCollapsed,
  isAgency,
  clientBrandName,
  clientLogoUrl,
  clientAccentColor,
  clientTimezone,
}: {
  accounts: AccountOption[];
  defaultCollapsed: boolean;
  isAgency: boolean;
  /** What this company's own customers call it, when the agency has set it.
   *  Undefined for the agency, which gets the switcher instead, and for an
   *  unbranded client — who then gets NO identity block at all (D-072: this
   *  used to fall back to `clientAccountName`, the agency's own internal
   *  label, e.g. "Rio Roofing — trial", which is not for the client's eyes
   *  and carried no other purpose once removed — effectively unreachable in
   *  practice, since `brand_name` is seeded at account creation and go-live
   *  requires the Branding step, but "effectively" is not "never"). */
  clientBrandName?: string;
  /** Already resolved server-side — see BrandingPanel for why this is a URL
   *  and not a storage path. */
  clientLogoUrl?: string;
  /** Already lightened server-side to stay visible on the dark sidebar.
   *  Undefined for the agency and for an unbranded client, both of which keep
   *  the globals.css tokens — including their deliberate light/dark tuning,
   *  which a flat override would discard. */
  clientAccentColor?: string;
  /** The client's own account timezone — same shape as the other client*
   *  props above: resolved server-side in this layout, from the account
   *  row auth.ts's resolveClientAccessState reads, not from an
   *  [accountId] URL segment this layout never receives. Second identity-
   *  block line, mirroring AccountSwitcher's own timezone line below. */
  clientTimezone?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();
  const locale = useLocale();

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar_collapsed=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const match = pathname.match(ACCOUNT_ROUTE_RE);
  const activeAccountId = match?.[1];
  const base = activeAccountId ? `/dashboard/accounts/${activeAccountId}` : null;

  // The Conversations badge's count and the footer's setup meter both come
  // from the one shared shell fetch (shell-data.tsx) — replacing what used
  // to be two separate pathname-keyed effects here. `useShellData()` already
  // does the accountId-paired derive-by-match this component's own two
  // effects used to do individually; a missing snapshot (off-account, not
  // yet fetched, or a stale account's leftover data) and a client's own
  // `setup: null` (the server's call, never this component's — Setup is
  // agency-only data) both collapse to the same "hidden" fallback here.
  const snapshot = useShellData();
  const unreadTotal = snapshot?.unreadTotal ?? 0;
  const setupProgress = snapshot?.setup ?? { done: 0, total: 0 };

  // Grouping, audience filtering and href construction all live in the pure
  // nav-groups module (unit-tested there without React); this component only
  // resolves labelKey → copy and iconKey → icon component per item.
  const groups = buildNavGroups(base, isAgency).map((group) => ({
    label: group.label,
    items: group.items.map(
      (item): NavItem => ({ href: item.href, label: t(m, item.labelKey, locale), icon: NAV_ICONS[item.iconKey] }),
    ),
  }));

  // A client has no agency scope to return to, so there is no footer item
  // for them at all — not Settings (agency-only, see requireAgencyOnlyAccountAccess),
  // not the agency's own top-level Dashboard link.
  const footer: NavItem | null = !isAgency
    ? null
    : base
      ? { href: `${base}/settings`, label: t(m, "nav.settings", locale), icon: Settings }
      : { href: "/dashboard", label: t(m, "nav.dashboard", locale), icon: LayoutDashboard };

  // Only shown inside an account, and only for the agency — a client has
  // nothing to go "back" to. Its href ("/dashboard/accounts") is a string
  // prefix of every in-account route, so — like the footer's agency-scope
  // link — it needs an exact match or it would light up alongside whichever
  // account nav item is actually active.
  const backToAgency: NavItem = { href: "/dashboard/accounts", label: t(m, "shell.backToAgency", locale), icon: ArrowLeft };

  // What the identity block below calls this company: the brand name, full
  // stop (D-072). No fallback to the agency's own internal account label —
  // `clientLabel ? (...) : null` below already degrades to no identity
  // block at all for the unbranded case.
  const clientLabel = clientBrandName;

  return (
    <aside
      style={clientAccentColor
        ? ({ "--sidebar-accent": clientAccentColor } as React.CSSProperties)
        : undefined}
      // DESIGN.md rule 10: the sidebar itself is exactly one viewport tall
      // and pinned there (h-dvh + sticky), so its middle nav — the one
      // child below given overflow-y-auto — is what scrolls, while the
      // footer cluster after it stays on screen at every viewport height.
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col gap-1.5 sidebar-chrome border-r border-[var(--sidebar-line)] px-3 pt-3.5 text-sidebar-foreground transition-[width] duration-200",
        // F-107 (rider part): the footer cluster (Settings + the setup
        // meter) must stay "pinned and visible at every viewport height"
        // (rule 10) — on a phone that includes the home-indicator gesture
        // bar, which --safe-bottom (tokens.css) adds on top of the existing
        // 14px bottom padding rather than replacing it.
        //
        // ASSUMPTION (per WebKit's documented behaviour, not verified on a
        // device from this repo): `env(safe-area-inset-bottom)` reports 0
        // unless the document OPTS IN with a `viewport-fit=cover` viewport
        // meta/`viewport.viewportFit` — apps/web sets neither today (`grep
        // -rn viewportFit apps/web` is empty), so --safe-bottom is INERT in
        // this app right now, on every phone, notched or not: this padding
        // is currently always the plain 14px it was before. Enabling
        // `viewportFit: "cover"` is part of F-107's second part (the
        // bottom-tab shell), not this rider — turning it on changes how
        // the WHOLE page paints under the status bar too, which is a
        // bigger decision than one sidebar's bottom padding.
        "pb-[calc(0.875rem+var(--safe-bottom))]",
        // Below `sm` (640px — narrower than either of DESIGN.md's rider
        // widths, 375 and 320) the sidebar is ALWAYS the 64px collapsed
        // width, whatever `collapsed` says: a phone has no overlay to
        // expand it into yet (the bottom-tab shell, F-107's second part, is
        // where one would live), so there is nothing honest for the toggle
        // to do there, and it is hidden instead (below). Only at sm+ does
        // `collapsed` get to pick the width.
        collapsed ? "w-16" : "w-16 sm:w-[236px]",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center",
          !collapsed && (isAgency ? "sm:justify-between" : "sm:justify-end"),
        )}
      >
        {/* The agency's wordmark, and only the agency's. A client used to see
            "BIS" here — the single most visible instance of the problem this
            milestone exists to fix — with the company they were actually in
            named in smaller type directly below it. Rather than print their
            brand twice in a 224px column, the identity block below is the one
            place a client's brand appears. It renders in both collapsed and
            expanded states, which this row does not.

            It was also a dead link for them: "/dashboard" is agency-only and
            bounces a client straight back out.

            `hidden sm:inline-block`, not a `collapsed`-keyed JSX removal
            like the rest of this row's own logic: below `sm` this stays out
            of the layout regardless of `collapsed`, for the same phone-has-
            no-overlay reason the toggle button beside it is hidden too. */}
        {collapsed || !isAgency ? null : (
          <Link
            href="/dashboard"
            className="hidden px-1 text-sm font-semibold text-[var(--sidebar-text-strong)] sm:inline-block"
          >
            {t(m, "shell.brand", locale)}
          </Link>
        )}
        {/* F-107 (rider part): hidden below `sm`, not merely inert. The
            sidebar is unconditionally collapsed on a phone (above), so
            toggling here would have nothing to expand INTO — there is no
            off-canvas overlay yet, that is F-107's second part — and a
            control with no visible effect is worse than no control. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t(m, "shell.expand", locale) : t(m, "shell.collapse", locale)}
          className="hidden rounded-[var(--radius-ctl)] p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)] sm:inline-flex"
        >
          {collapsed ? (
            <PanelLeft className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </button>
      </div>

      {isAgency ? (
        <AccountSwitcher
          accounts={accounts}
          activeAccountId={activeAccountId}
          collapsed={collapsed}
        />
      ) : clientLabel ? (
        // Same slot and spacing as the switcher, so the nav below sits where it
        // does for the agency — but no border, hover or chevron, because there
        // is nothing to switch to and it must not look clickable.
        <div
          className={cn(
            // F-107 (rider part): mobile-first — the collapsed LOOK
            // (centered, no horizontal padding) is the base below `sm`
            // regardless of `collapsed`; `sm:` only restores the expanded
            // spacing, and only when the user isn't ALSO collapsed at that
            // width.
            "flex w-full items-center gap-2 justify-center px-0 py-2 text-sidebar-foreground",
            !collapsed && "sm:justify-start sm:px-2",
          )}
          // Unconditional for the same reason as SidebarLink's own title
          // (F-107 r1 review): the name/timezone text below is `hidden`
          // below `sm` even when `collapsed` is false.
          title={clientLabel}
        >
          <span
            className={cn(
              "flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] text-[13px] font-bold",
              // A logo is artwork with its own background, usually drawn for a
              // light one. Sitting it on a white chip keeps a dark-on-
              // transparent mark legible against this dark sidebar; without a
              // logo the chip is the mockup's avatar — the full-strength 135°
              // gradient carrying white ink.
              clientLogoUrl ? "bg-white p-0.5" : "bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))] text-[var(--sidebar-text-strong)]",
            )}
          >
            {clientLogoUrl ? (
              // Plain <img>, as in BrandingPanel: a small asset already on a
              // public CDN path. object-contain so a wide or tall logo is
              // letterboxed into the chip rather than cropped or stretched.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={clientLogoUrl}
                // F-107 r2 review, item 6: always decorative. Round 1 made
                // this unconditionally `clientLabel` to fix a missing name
                // at phone width, but that double-announced it at desktop
                // (the visible name text right beside it is ALSO read).
                // The name span just below is now always in the a11y tree
                // (`sr-only`, restored to visible via `sm:not-sr-only`
                // only when not collapsed) — exactly one source for the
                // name in every state, so this can safely go back to "".
                alt=""
                className="size-full object-contain"
              />
            ) : (
              // The mockup's .avatar carries the account's INITIAL, not a
              // generic building glyph (northern-lights.html:44).
              <span aria-hidden>{clientLabel.trim().charAt(0).toUpperCase()}</span>
            )}
          </span>
          {/* F-107 r2 review, item 6: ALWAYS rendered now (round 1 had
              `{collapsed ? null : (...)}`, which removed this from the
              a11y tree too, in both the phone AND desktop-collapsed
              cases). `sr-only` is the base — present for assistive tech,
              invisible to sighted users — and `sm:not-sr-only` restores
              the original visible two-line block, but only when not
              collapsed: at desktop-collapsed (sm+, collapsed=true) it
              correctly stays sr-only, same as phone width. */}
          <span className={cn("min-w-0 flex-1 sr-only", !collapsed && "sm:not-sr-only")}>
            <span className="block truncate text-sm font-medium">{clientLabel}</span>
            <span className="block truncate text-[11px] text-sidebar-foreground/60">
              {clientTimezone ?? ""}
            </span>
          </span>
        </div>
      ) : null}

      {isAgency && base ? (
        <div className="border-b border-sidebar-border pb-2">
          <SidebarLink
            item={backToAgency}
            collapsed={collapsed}
            active={isNavActive(pathname, backToAgency.href, true)}
          />
        </div>
      ) : null}

      {/* -mx-3 px-3 cancels then re-adds the aside's own padding on the SCROLL
          container itself: overflow-y-auto also clips the x axis, and the active
          rail sits 12px left of its item (the mockup's left: -12px). Inside the
          nav's own padding area it survives; against a bare content edge it was
          clipped away entirely. */}
      <nav className="-mx-3 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3">
        {groups.map((group, i) => (
          // Label when present; only the agency top-level group has
          // label=null and falls back to an index-based key.
          <div key={group.label ?? `group-${i}`} className="flex flex-col gap-0.5">
            {group.label ? (
              // No label row in the icon-only rail. `hidden` is
              // display:none, which removes it from the accessibility tree
              // exactly as unmounting would — that's fine (it's
              // role="presentation" decoration either way); hidden just
              // keeps the markup stable across collapse toggles.
              //
              // Mobile-first (F-107, rider part): `hidden` is now the BASE
              // regardless of `collapsed` — a phone is always icon-only —
              // and `sm:block` only restores it at desktop widths, and only
              // when the user isn't ALSO collapsed there.
              <div
                role="presentation"
                className={cn(
                  "px-2.5 pt-3.5 pb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-[var(--sidebar-muted)] uppercase",
                  "hidden",
                  !collapsed && "sm:block",
                )}
              >
                {t(m, group.label, locale)}
              </div>
            ) : null}
            {group.items.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                active={isNavActive(pathname, item.href)}
                // Only the Conversations item carries a badge — this
                // account's unread total, read above via getUnreadTotal.
                // Every other item gets undefined, which SidebarLink treats
                // as zero (hidden).
                unreadCount={base && item.href === `${base}/conversations` ? unreadTotal : undefined}
              />
            ))}
          </div>
        ))}
      </nav>

      {footer ? (
        // DESIGN.md rule 10 / "Sidebar" key pattern: pinned, always visible —
        // `mt-auto` (belt-and-braces with `<nav>`'s own flex-1 above, which
        // already pushes this to the bottom) plus the aside's h-dvh/sticky
        // keep this cluster on screen at every viewport height, however long
        // the nav list above scrolls.
        <div className="mt-auto border-t border-sidebar-border pt-2">
          <SidebarLink
            item={footer}
            collapsed={collapsed}
            active={isNavActive(pathname, footer.href, !base)}
          />
          {/* Agency in-account only (base set) — the agency top-level footer
              (Dashboard link, base === null) has no account to meter, and a
              client never reaches this branch at all (footer is null for
              them). Hidden at done === total: a genuinely complete setup and
              the read's own failure fold both land here, and Setup leaving
              the nav on completion means this row IS its nav presence — see
              shell-actions.ts. */}
          {base && setupProgress.done !== setupProgress.total ? (
            <SetupMeterLink
              base={base}
              collapsed={collapsed}
              done={setupProgress.done}
              total={setupProgress.total}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function SidebarLink({
  item,
  collapsed,
  active,
  unreadCount,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  /** Undefined or 0 both render no badge — see the brief's "hidden when 0". */
  unreadCount?: number;
}) {
  const Icon = item.icon;
  const hasUnread = (unreadCount ?? 0) > 0;
  // The visible pill caps at "99+" — it has room for two digits, not the
  // three-plus a very active inbox could reach. The aria-label above (and
  // below) keeps the REAL count regardless: capping the announced number
  // too would tell a screen-reader user something false.
  const unreadDisplay = (unreadCount ?? 0) > 99 ? "99+" : unreadCount;
  return (
    <Link
      href={item.href}
      // F-107 r1 review: below `sm`, the visible label span (further down)
      // is `hidden` even when `collapsed` is false — the icon is
      // `aria-hidden` and the active-rail mark is `aria-hidden`, so with
      // the old `collapsed ? item.label : undefined` this Link's
      // accessible name was EMPTY at phone width whenever there was no
      // unread badge (every nav item but Conversations). `title` is now
      // unconditional too, for sighted hover at the same phone width this
      // was broken at — a visible tooltip was never wrong for an expanded
      // desktop row, it just had nothing to add there.
      title={item.label}
      // Unconditional for the same reason: the unread count rides on the
      // LINK's accessible name, never on the badge spans (both aria-hidden
      // below) — accessible-name computation prefers name-from-content, so
      // a labelled span inside the link would REPLACE "Conversations" with
      // "5 unread" in the collapsed state — and aria-label on a generic
      // <span> is ignored by some screen-reader pairs anyway (naming
      // prohibited on the generic role).
      aria-label={hasUnread ? `${item.label} (${unreadCount} unread)` : item.label}
      className={cn(
        // Mobile-first (F-107, rider part): "justify-center px-0" — the
        // collapsed look — is the BASE below `sm`, whatever `collapsed`
        // says; `sm:` only restores the expanded spacing, and only when the
        // user isn't ALSO collapsed at that width.
        "relative flex items-center gap-2.5 rounded-[var(--radius-ctl)] justify-center px-0 py-2 text-[13.5px] font-medium transition-colors",
        !collapsed && "sm:justify-start sm:px-2.5",
        active
          ? "bg-sidebar-accent/15 font-medium text-[var(--sidebar-text-strong)] shadow-[inset_0_1px_0_var(--sidebar-line)]"
          : "text-[var(--sidebar-text)] hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]",
      )}
    >
      {active ? (
        <span
          data-slot="nav-rail"
          // -left-3 cancels the aside's 12px padding, so the rail sits flush
          // with the sidebar's own edge exactly as the mockup's
          // `.nav.active::before { left: -12px }` does.
          className="absolute inset-y-[7px] -left-3 w-[3px] rounded-[3px] bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-tint-2))]"
          aria-hidden
        />
      ) : null}
      <span className="relative flex shrink-0">
        <Icon className="size-4 opacity-90" strokeWidth={1.8} aria-hidden />
        {hasUnread ? (
          // Dot rather than the pill below, since there is no room for a
          // count beside a centered icon — collapsed, OR (F-107, rider
          // part) below `sm`, where the row is always icon-only regardless
          // of `collapsed`. Rendered whenever there's an unread count and
          // hidden by CSS rather than JS-removed, so this element and the
          // pill below can trade places purely on viewport width without a
          // re-render. Purely decorative — the count is announced via the
          // Link's aria-label above.
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sidebar-accent",
              !collapsed && "sm:hidden",
            )}
            aria-hidden
          />
        ) : null}
      </span>
      {collapsed ? null : (
        <span className="hidden min-w-0 flex-1 truncate sm:block">{item.label}</span>
      )}
      {hasUnread ? (
        // Visual-only: the Link's aria-label already carries "(N unread)",
        // so exposing this span's text too would double-announce the count.
        // Mirrors the dot above: hidden by default (collapsed, or below
        // `sm`), shown only at sm+ when not collapsed.
        <span
          className={cn(
            "hidden min-w-4 shrink-0 rounded-full bg-sidebar-accent/15 px-1.5 text-center text-[10px] font-medium text-sidebar-accent",
            !collapsed && "sm:inline-block",
          )}
          aria-hidden
        >
          {unreadDisplay}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The footer's setup-progress meter — not a plain NavItem/SidebarLink
 * (nav-groups.ts has no "setup" icon key at all; Task 2's own comment there
 * says why: Setup left the nav for good, this row is its whole nav
 * presence). Its own bespoke row instead: label + right-aligned `done/total`
 * above a 2px accent-on-white/10 bar, both wrapped in one Link so the whole
 * row is the click target, matching every other nav row in this file.
 *
 * `title` mirrors SidebarLink's collapsed-tooltip convention (plain label,
 * only when collapsed). `aria-label` carries the count ALWAYS, not only when
 * non-zero like the unread badge above — there is no "zero" reading for
 * setup progress that would make the count worth omitting, every render of
 * this row has *some* steps left (see the done!==total guard that gates
 * whether it renders at all). Same rule as SidebarLink's own aria-label:
 * lives on the Link, never on a labelled span inside it — the bar below is
 * `aria-hidden`, a value with no ARIA role of its own to carry, exactly the
 * accessibility finding Task 2's review left for this task to apply.
 */
function SetupMeterLink({
  base,
  collapsed,
  done,
  total,
}: {
  base: string;
  collapsed: boolean;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const progressText = m["setup.progress"]
    .replace("{done}", String(done))
    .replace("{total}", String(total));
  return (
    <Link
      href={`${base}/setup`}
      // Unconditional for the same reason SidebarLink's own title is now
      // unconditional (F-107 r1 review): the label/count row below is
      // `hidden` below `sm` even when `collapsed` is false, so sighted
      // hover needs the tooltip there too, not only when desktop-collapsed.
      title={m["nav.setup"]}
      aria-label={`${m["nav.setup"]} (${progressText})`}
      className={cn(
        // Mobile-first (F-107, rider part): no horizontal padding is the
        // BASE below `sm`, whatever `collapsed` says — same reasoning as
        // every other row in this file. "Collapsed: no room for the
        // label/count row (hidden below), so this link keeps only the bar
        // — full rail-button width" now also describes the phone case.
        "flex flex-col gap-1.5 rounded-[var(--radius-ctl)] px-0 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]",
        !collapsed && "sm:px-2.5",
      )}
    >
      {collapsed ? null : (
        <span className="hidden items-center justify-between gap-2 sm:flex">
          <span className="truncate">{m["nav.setup"]}</span>
          <span className="shrink-0 font-mono text-xs text-sidebar-foreground/60 tabular-nums">
            {done}/{total}
          </span>
        </span>
      )}
      <span className="h-[5px] w-full overflow-hidden rounded-full bg-[var(--meter-bg)]" aria-hidden>
        <span className="block h-full rounded-full bg-[linear-gradient(90deg,var(--sidebar-accent),var(--sidebar-tint-2))]" style={{ width: `${percent}%` }} />
      </span>
    </Link>
  );
}

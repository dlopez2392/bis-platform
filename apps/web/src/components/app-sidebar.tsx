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
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher, type AccountOption } from "@/components/account-switcher";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { buildNavGroups, type NavIconKey } from "@/lib/nav-groups";
import { ACCOUNT_ROUTE_RE } from "@/lib/account-route";
// Conversations' unread badge and the footer's setup meter both read from
// this one shared background fetch — see shell-data.tsx's own doc comment
// for why the read lives in the [accountId] segment (via shell-actions.ts)
// rather than this component's own layout ancestor, and for the
// paired-state/derive-by-account-match shape that used to live here as two
// separate effects before this task coalesced them into one.
import { useShellData } from "@/components/shell-data";

type NavItem = { href: string; label: string; icon: LucideIcon };

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
  clientAccountName,
  clientBrandName,
  clientLogoUrl,
  clientAccentColor,
  clientTimezone,
}: {
  accounts: AccountOption[];
  defaultCollapsed: boolean;
  isAgency: boolean;
  /** The client's own company name. Undefined for the agency, which gets the
   *  switcher instead. Clients have no switcher — hiding it removed the only
   *  place the account name appeared, so they could not tell which company
   *  they were looking at, and the only branding on screen was the agency's. */
  clientAccountName?: string;
  /** What this company's own customers call it, when the agency has set it.
   *  Takes precedence over clientAccountName, which stays the agency's
   *  internal label ("Rio Roofing — trial") and is not for the client's eyes. */
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
   *  that's already been looked up for clientAccountName (auth.ts's
   *  resolveClientAccessState reads it off the same row), not from an
   *  [accountId] URL segment this layout never receives. Second identity-
   *  block line, mirroring AccountSwitcher's own timezone line below. */
  clientTimezone?: string;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();

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
      (item): NavItem => ({ href: item.href, label: m[item.labelKey], icon: NAV_ICONS[item.iconKey] }),
    ),
  }));

  // A client has no agency scope to return to, so there is no footer item
  // for them at all — not Settings (agency-only, see requireAgencyOnlyAccountAccess),
  // not the agency's own top-level Dashboard link.
  const footer: NavItem | null = !isAgency
    ? null
    : base
      ? { href: `${base}/settings`, label: m["nav.settings"], icon: Settings }
      : { href: "/dashboard", label: m["nav.dashboard"], icon: LayoutDashboard };

  // Only shown inside an account, and only for the agency — a client has
  // nothing to go "back" to. Its href ("/dashboard/accounts") is a string
  // prefix of every in-account route, so — like the footer's agency-scope
  // link — it needs an exact match or it would light up alongside whichever
  // account nav item is actually active.
  const backToAgency: NavItem = { href: "/dashboard/accounts", label: m["shell.backToAgency"], icon: ArrowLeft };

  // What the identity block below calls this company. The brand name is what
  // their own customers know them by; the account name is the agency's
  // internal label and only stands in when no brand is set.
  const clientLabel = clientBrandName ?? clientAccountName;

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
        "sticky top-0 flex h-dvh shrink-0 flex-col gap-1.5 sidebar-chrome border-r border-[var(--sidebar-line)] px-3 py-3.5 text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-[236px]",
      )}
    >
      <div
        className={cn(
          "flex items-center",
          collapsed ? "justify-center" : isAgency ? "justify-between" : "justify-end",
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
            bounces a client straight back out. */}
        {collapsed || !isAgency ? null : (
          <Link href="/dashboard" className="px-1 text-sm font-semibold text-[var(--sidebar-text-strong)]">
            {m["shell.brand"]}
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? m["shell.expand"] : m["shell.collapse"]}
          className="rounded p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]"
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
            "flex w-full items-center gap-2 px-2 py-2 text-sidebar-foreground",
            collapsed && "justify-center px-0",
          )}
          title={collapsed ? clientLabel : undefined}
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
                // Decorative when the name is right beside it; the accessible
                // name when collapsed hides that text.
                alt={collapsed ? clientLabel : ""}
                className="size-full object-contain"
              />
            ) : (
              // The mockup's .avatar carries the account's INITIAL, not a
              // generic building glyph (northern-lights.html:44).
              <span aria-hidden>{clientLabel.trim().charAt(0).toUpperCase()}</span>
            )}
          </span>
          {collapsed ? null : (
            // Same two-line shape as AccountSwitcher's own name/timezone
            // block: name on top, timezone below at the shared 11px size.
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{clientLabel}</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/60">
                {clientTimezone ?? ""}
              </span>
            </span>
          )}
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
              <div
                role="presentation"
                className={cn(
                  "px-2.5 pt-3.5 pb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-[var(--sidebar-muted)] uppercase",
                  collapsed && "hidden",
                )}
              >
                {m[group.label]}
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
      title={collapsed ? item.label : undefined}
      // The unread count rides on the LINK's accessible name, never on the
      // badge spans (both aria-hidden below): accessible-name computation
      // prefers name-from-content, so a labelled span inside the link would
      // REPLACE "Conversations" with "5 unread" in the collapsed state —
      // and aria-label on a generic <span> is ignored by some screen-reader
      // pairs anyway (naming prohibited on the generic role).
      aria-label={hasUnread ? `${item.label} (${unreadCount} unread)` : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13.5px] font-medium transition-colors",
        collapsed && "justify-center px-0",
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
        {hasUnread && collapsed ? (
          // Collapsed state: a dot rather than the pill below, since there is
          // no room for a count beside a centered icon. Purely decorative —
          // the count is announced via the Link's aria-label above.
          <span
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-sidebar-accent"
            aria-hidden
          />
        ) : null}
      </span>
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {hasUnread && !collapsed ? (
        // Visual-only: the Link's aria-label already carries "(N unread)",
        // so exposing this span's text too would double-announce the count.
        <span
          className="min-w-4 shrink-0 rounded-full bg-sidebar-accent/15 px-1.5 text-center text-[10px] font-medium text-sidebar-accent"
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
      title={collapsed ? m["nav.setup"] : undefined}
      aria-label={`${m["nav.setup"]} (${progressText})`}
      className={cn(
        "flex flex-col gap-1.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]",
        // Collapsed: no room for the label/count row (hidden below), so this
        // link keeps only the bar — full rail-button width, same reasoning
        // as every other collapsed row's `px-0` above.
        collapsed && "px-0",
      )}
    >
      {collapsed ? null : (
        <span className="flex items-center justify-between gap-2">
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

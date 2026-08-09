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
  FileText,
  Settings,
  Building2,
  Layers,
  PanelLeftClose,
  PanelLeft,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { AccountSwitcher, type AccountOption } from "@/components/account-switcher";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

type NavItem = { href: string; label: string; icon: LucideIcon };

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
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const pathname = usePathname();

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar_collapsed=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const match = pathname.match(/^\/dashboard\/accounts\/([^/]+)/);
  const activeAccountId = match?.[1];
  const base = activeAccountId ? `/dashboard/accounts/${activeAccountId}` : null;
  const items: NavItem[] = base
    ? [
        { href: `${base}/dashboard`, label: m["nav.dashboard"], icon: LayoutDashboard },
        { href: `${base}/contacts`, label: m["nav.contacts"], icon: Users },
        { href: `${base}/pipeline`, label: m["nav.opportunities"], icon: KanbanSquare },
        { href: `${base}/conversations`, label: m["nav.conversations"], icon: MessagesSquare },
        { href: `${base}/forms`, label: m["nav.forms"], icon: FileText },
        { href: `${base}/calendar`, label: m["nav.calendar"], icon: Calendar },
      ]
    : [
        { href: "/dashboard/accounts", label: m["nav.accounts"], icon: Building2 },
        { href: "/dashboard/blueprints", label: m["nav.blueprints"], icon: Layers },
      ];

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
      className={cn(
        "flex shrink-0 flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
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
          <Link href="/dashboard" className="px-1 text-sm font-semibold text-white">
            {m["shell.brand"]}
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? m["shell.expand"] : m["shell.collapse"]}
          className="rounded p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-white/5 hover:text-sidebar-foreground"
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
              "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded",
              // A logo is artwork with its own background, usually drawn for a
              // light one. Sitting it on a white chip keeps a dark-on-
              // transparent mark legible against this dark sidebar; the tinted
              // chip stays for the generic icon, which is drawn to suit it.
              clientLogoUrl ? "bg-white p-0.5" : "bg-sidebar-accent/20 text-sidebar-accent",
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
              <Building2 className="size-4" aria-hidden />
            )}
          </span>
          {collapsed ? null : (
            <span className="block min-w-0 flex-1 truncate text-sm font-medium">
              {clientLabel}
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

      <nav className="flex flex-1 flex-col gap-0.5">
        {items.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={isNavActive(pathname, item.href)}
          />
        ))}
      </nav>

      {footer ? (
        <div className="border-t border-sidebar-border pt-2">
          <SidebarLink
            item={footer}
            collapsed={collapsed}
            active={isNavActive(pathname, footer.href, !base)}
          />
        </div>
      ) : null}
    </aside>
  );
}

function SidebarLink({
  item,
  collapsed,
  active,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-white/10 font-medium text-white"
          : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground",
      )}
    >
      {active ? (
        <span
          className="absolute left-0 h-5 w-0.5 rounded-r bg-sidebar-accent"
          aria-hidden
        />
      ) : null}
      <Icon className="size-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

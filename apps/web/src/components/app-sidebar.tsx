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
  Settings,
  Building2,
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
}: {
  accounts: AccountOption[];
  defaultCollapsed: boolean;
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
        { href: `${base}/calendar`, label: m["nav.calendar"], icon: Calendar },
      ]
    : [{ href: "/dashboard/accounts", label: m["nav.accounts"], icon: Building2 }];

  const footer: NavItem = base
    ? { href: `${base}/settings`, label: m["nav.settings"], icon: Settings }
    : { href: "/dashboard", label: m["nav.dashboard"], icon: LayoutDashboard };

  // Only shown inside an account. Its href ("/dashboard/accounts") is a
  // string prefix of every in-account route, so — like the footer's
  // agency-scope link — it needs an exact match or it would light up
  // alongside whichever account nav item is actually active.
  const backToAgency: NavItem = { href: "/dashboard/accounts", label: m["shell.backToAgency"], icon: ArrowLeft };

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? null : (
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

      <AccountSwitcher
        accounts={accounts}
        activeAccountId={activeAccountId}
        collapsed={collapsed}
      />

      {base ? (
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

      <div className="border-t border-sidebar-border pt-2">
        <SidebarLink
          item={footer}
          collapsed={collapsed}
          active={isNavActive(pathname, footer.href, !base)}
        />
      </div>
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

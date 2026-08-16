import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { serviceDb, listAccounts, brandLogoUrl } from "@bis/db";
import type { AppClaims } from "@/lib/auth";
import { resolveSidebarAccent } from "@/lib/branding/color";
import { getTenantAccessState, getTenantBranding } from "@/lib/branding/tenant-theme-reader";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";

// generateMetadata and the layout body below are separate invocations that
// need the same answers the root layout also needs for the very same tenant
// -- getTenantAccessState and getTenantBranding (in
// apps/web/src/lib/branding/tenant-theme-reader.ts) are the shared,
// request-cached readers both layouts import, so a /dashboard/* request
// resolves the caller and reads their branding exactly once no matter how
// many of these two call them. The root layout also calls getRequestTheme
// there -- the ONLY place resolveThemeMode gets invoked for the request, and
// the ONLY place the derived token set is emitted, on <body>. This file has
// no theme of its own to emit: it used to paint a themed div here, but
// body's own CSS (globals.css's `background`/`color`/`font-family` on the
// `body` selector) resolves custom properties against body's OWN values, not
// a descendant's, so overriding them on a div inside body changed nothing --
// and every Radix portal plus Sonner's Toaster mount straight into
// document.body, outside that div, so they stayed unbranded too. For the
// agency, resolveClientAccessState returns on the role claim alone and never
// reaches the database at all.

/**
 * The browser tab is chrome too. It read "BIS Platform" for everyone, which
 * put the agency's name in front of a client on every screen — the same leak
 * this milestone removes from the sidebar, just in the one piece of the window
 * the app does not draw itself.
 *
 * The agency's own tab is untouched, and a client with no branding falls back
 * to their company name rather than to the agency's.
 */
export async function generateMetadata(): Promise<Metadata> {
  const state = await getTenantAccessState();
  if (state.status !== "ok") return {};
  const branding = await getTenantBranding(state.id);
  return {
    title: branding.brandName ?? state.name,
    // The root layout's description names Bespoke Intelligent Solutions
    // outright. Dropped rather than rewritten: a client's workspace has no
    // business carrying the agency's marketing copy in its <head>.
    description: null,
    // The last piece of the tab. M3 fixed the title and deliberately left the
    // icon, so a client's staff read their own company name all day beside
    // the agency's mark. Emitted only when they actually have a logo —
    // omitting the key lets the app's own icon stand, which is the right
    // fallback for an unbranded client and for the agency.
    //
    // Their uploaded logo as-is: it has already passed the magic-byte
    // allowlist, and the alternative is generating a second, square,
    // favicon-sized derivative at upload time — a resize pipeline this
    // milestone does not need. Browsers scale it.
    ...(branding.brandLogoPath
      ? { icons: { icon: brandLogoUrl(branding.brandLogoPath) } }
      : {}),
  };
}

// Shared chrome for both audiences. Authorization for what's INSIDE an
// account is handled by [accountId]/layout.tsx's requireAccountAccess; this
// layout only needs to know who is allowed into the /dashboard tree at all,
// and which role to render.
//
// The agency-only leaves directly under here — dashboard/page.tsx,
// dashboard/accounts/page.tsx, dashboard/blueprints/page.tsx — guard
// themselves with requireAgency(), the same defense-in-depth shape Task 5
// used for Settings and the checklist: this layout stops navigation for a
// client into the [accountId] subtree's own account, but it cannot see which
// leaf route is being requested, so it must not be the only thing keeping a
// client out of those three agency-wide reads.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;
  const isAgency = claims.app_role === "agency_admin";
  let clientState: Awaited<ReturnType<typeof getTenantAccessState>> | null = null;

  if (!isAgency) {
    // Distinguish "off" from "none" here rather than collapsing both to a
    // redirect to "/" — without this, a client whose access was just
    // turned off (a real account, switch flipped false) landed on the
    // same generic "not set up as an agency admin" message an unlinked
    // user sees, instead of the explicit /no-access?reason=off page
    // [accountId]/layout.tsx already shows for the same situation one
    // level down. This layout runs first, so it was the one place that
    // distinction was getting lost before a client with a specific
    // account URL ever reached that more precise guard.
    clientState = await getTenantAccessState();
    const state = clientState;
    if (state.status === "off") redirect("/no-access?reason=off");
    // Was `redirect("/")`, which lands on landing.noAccess.body — copy
    // written for the agency ("This account isn't set up as an agency
    // admin..."). A client with no resolvable account at all needs the
    // same explicit no-access page as the "off" case above, just the
    // other reason, so it reads as a provisioning gap rather than an
    // error (design spec section 8). "/" still correctly serves a
    // signed-in user with no app_role and no org at all — this redirect
    // only fires once we already know the caller isn't the agency.
    if (state.status === "none") redirect("/no-access?reason=none");
  }

  const [accounts, cookieStore, branding] = await Promise.all([
    isAgency ? listAccounts(serviceDb()) : Promise.resolve([]),
    cookies(),
    // Only a client's chrome wears a brand. The agency's stays BIS on purpose,
    // so this read never happens for them — there is nothing to resolve.
    clientState?.status === "ok"
      ? getTenantBranding(clientState.id)
      : Promise.resolve(null),
  ]);
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "true";

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, timezone: a.timezone }))}
        defaultCollapsed={collapsed}
        isAgency={isAgency}
        clientAccountName={clientState?.status === "ok" ? clientState.name : undefined}
        clientBrandName={branding?.brandName ?? undefined}
        clientLogoUrl={branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : undefined}
        clientAccentColor={resolveSidebarAccent(branding?.brandColor ?? null) ?? undefined}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar isAgency={isAgency} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

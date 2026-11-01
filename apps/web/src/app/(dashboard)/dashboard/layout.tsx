import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { serviceDb, listAccounts, brandLogoUrl, brandDisplayName } from "@bis/db";
import type { AppClaims } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { resolveSidebarAccent } from "@/lib/branding/color";
import { getTenantAccessState, getTenantBranding } from "@/lib/branding/tenant-theme-reader";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { ShellDataProvider } from "@/components/shell-data";
import { CommandPalette } from "@/components/command-palette";
import { Ground } from "@/components/ground";
import { ensureAccountRole, readStoredRole } from "@/lib/team/ensure-role";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { LocaleProvider } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";

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
 * The agency's own tab is untouched. D-072: a client with no branding yet
 * names no company at all — never `state.name` (`accounts.name`, the
 * agency's own private label on this client, e.g. "Rio Roofing — trial"),
 * the exact leak `brandDisplayName`'s own "no fallback, deliberately" rule
 * exists to close. Omitting the key (brandDisplayName returns "", and `||`
 * turns that into `undefined`) lets Next's metadata merging fall through to
 * the root layout's own "BIS Platform" title, the same way the public forms/
 * booking/chat tab titles fall back to a GENERIC word (`publicTabTitle`),
 * never to the private label — this is effectively unreachable once
 * Branding is set (every account's `brand_name` is seeded at creation and
 * go-live requires the step), but "effectively" is not "never".
 */
export async function generateMetadata(): Promise<Metadata> {
  const state = await getTenantAccessState();
  if (state.status !== "ok") return {};
  const branding = await getTenantBranding(state.id);
  return {
    title: brandDisplayName(branding) || undefined,
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

  const [accounts, cookieStore, branding, role, prefs] = await Promise.all([
    isAgency ? listAccounts(serviceDb()) : Promise.resolve([]),
    cookies(),
    // Only a client's chrome wears a brand. The agency's stays BIS on purpose,
    // so this read never happens for them — there is nothing to resolve.
    clientState?.status === "ok"
      ? getTenantBranding(clientState.id)
      : Promise.resolve(null),
    // Staff and roles: the caller's Owner/Staff/Technician role in THIS
    // account, for the sidebar footer's Team link, the palette's own Team
    // entries and (F-085 part 1) a Technician's own nav and ⌘K index.
    // `ensureAccountRole` is React cache()'d per request on its FULL
    // argument list — accountId, orgId, userId, AND the 4th `stored`
    // argument — not just the first three. `requireAccountAccess`
    // (lib/auth.ts) always calls it with an explicit 4th argument (the
    // in-flight `readStoredRole` promise it starts beside the account
    // read); calling it here with only 3 args, leaving `stored` to default
    // inside `ensureAccountRole` itself, makes a DIFFERENT cache entry even
    // though accountId/orgId/userId all match — cache() keys on every
    // argument, including a missing one (review round 1, I1: proved
    // against the installed react@19.2.4 that the underlying function then
    // runs twice, and on the fallback path that is a second
    // `reconcileMembership` Clerk call per page load). The fix is to pass
    // the IDENTICAL 4th argument here: `readStoredRole` is itself
    // cache()'d on (accountId, clerkUserId), so calling it with the same
    // two values `requireAccountAccess` will use returns the SAME promise
    // instance in this request, making this call and that one the same
    // cache entry — one `ensureAccountRoleWith` execution, not two. Always
    // null for the agency (never a client membership, plan deviation 6)
    // and for a client whose account did not resolve to "ok".
    clientState?.status === "ok" && claims.org_id
      ? ensureAccountRole(clientState.id, claims.org_id, userId, readStoredRole(clientState.id, userId))
      : Promise.resolve(null),
    // Mis preferencias: the caller's own language and theme. For a client
    // this rides on the same cached stored-person read readStoredRole (just
    // above) derives from; for the agency it is one indexed users read,
    // started here beside the rest. Never rejects (defaults on a fault).
    getPersonPrefs(),
  ]);
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "true";
  // Both false for the agency (role null). A Technician is never an Owner.
  // isTechnician is the narrow view, failing closed like requireNotTechnician
  // (fix round 1): a Technician, or a client whose role could not be settled,
  // gets To do's five destinations, never Staff's full list of screens that
  // would only send them back to To do.
  const isOwner = role === "owner";
  const isTechnician = !seesWholeAccount({ isAgency, role });

  // Fix round 1 (Task 6 review): AppSidebar and Topbar render HERE, as
  // siblings of <main>{children}</main> — not inside
  // [accountId]/layout.tsx, which wraps only {children}. A LocaleProvider
  // mounted one level down (as the original cut of this task did) never
  // reaches the chrome, so useLocale() there always read the context's
  // default ("en") regardless of the account's own language. This is the
  // one place both the sidebar and the topbar actually sit below a shared
  // ancestor, so it is the one place the provider can cover both.
  //
  // For the agency, `clientState` stays null (set only inside the
  // `!isAgency` branch above) and `isOperator: true` ignores the account:
  // operators stay English only until they choose otherwise (owner decision
  // 1, 2026-10-10; mis preferencias): a person's own `userLanguage` wins
  // for everyone, and with no choice the agency gets English and a client
  // the account's language. No per-account read happens on agency routes. `clientState.language` is widened onto
  // resolveClientAccessState's existing read (lib/auth.ts →
  // getAccountByOrgId, packages/db/src/accounts.ts) — no second query.
  // S-10 T9a (decided, with evidence): `requestLocale` here deliberately
  // receives NO third argument. Next.js gives `searchParams` to PAGES only
  // — a layout's own props are `{ params, children }`, nothing more (this
  // is a framework constraint, not an oversight to wire shut) — so
  // `?locale=`/`?locale=pseudo` can never reach the shell this layout
  // builds (the sidebar, the topbar, ⌘K): only a real `users.language` row
  // does, same as production. The design spec's §10 "the QA locale
  // override never reaches the shell" finding and §5.2's G9 row record the
  // consequence for the build checks: the shell's own G9 overflow proof
  // needs a real Spanish e2e session (spanish-dashboard.spec.ts's "the
  // shell:" test), never a `?locale=` query on any other account.
  const locale = requestLocale({
    account: clientState?.status === "ok"
      ? { language: clientState.language as Locale | null }
      : null,
    isOperator: isAgency,
    userLanguage: prefs.language,
  });

  return (
    // ShellDataProvider wraps the whole chrome, not just the two components
    // that read from it: it mounts one pathname-keyed effect that both
    // AppSidebar (unread badge, setup meter) and Topbar's TopbarPresence
    // child consume via useShellData() — see shell-data.tsx's own doc
    // comment for why this single fetch replaces what used to be three
    // separate per-navigation POSTs.
    <ShellDataProvider>
      <LocaleProvider locale={locale}>
        {/* No `lang` on the shell as a whole yet (decision D, 2026-10-10):
            the account switcher and the Clerk menus are still English, and
            the root is still <html lang="en"> until S-10 T7 sets it from the
            locale. `lang={locale}` sits on each converted part instead: the
            sidebar's <nav> and toggle and its setup meter (app-sidebar.tsx),
            the presence wrapper (topbar-presence.tsx), the ⌘K search
            triggers and its portalled dialog (command-palette.tsx), the
            theme toggle, the dashboard's error and not-found pages, and the
            dashboard KPI row ([accountId]/dashboard/page.tsx). */}
        <div className="relative flex min-h-screen">
          <Ground />
          <AppSidebar
            accounts={accounts.map((a) => ({ id: a.id, name: a.name, timezone: a.timezone }))}
            defaultCollapsed={collapsed}
            isAgency={isAgency}
            isOwner={isOwner}
            isTechnician={isTechnician}
            // D-072 review round: the SAME trimmed, never-raw resolver the
            // tab title and the greeting now also go through, so all three
            // surfaces read the brand name the same way.
            clientBrandName={branding ? brandDisplayName(branding) || undefined : undefined}
            clientLogoUrl={branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : undefined}
            clientAccentColor={resolveSidebarAccent(branding?.brandColor ?? null) ?? undefined}
            clientTimezone={clientState?.status === "ok" ? clientState.timezone : undefined}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* The palette mounts ONCE for the whole dashboard tree. This
                layout sits ABOVE the [accountId] segment, so it cannot pass an
                account id down and does not try — CommandPalette derives the
                current account from the pathname, the same way ShellDataProvider
                above it already does. */}
            <Topbar isAgency={isAgency} palette={<CommandPalette isAgency={isAgency} isOwner={isOwner} isTechnician={isTechnician} />} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </LocaleProvider>
    </ShellDataProvider>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { serviceDb, listAccounts } from "@bis/db";
import { resolveClientAccessState, type AppClaims } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";

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
    const state = await resolveClientAccessState();
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

  const [accounts, cookieStore] = await Promise.all([
    isAgency ? listAccounts(serviceDb()) : Promise.resolve([]),
    cookies(),
  ]);
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "true";

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, timezone: a.timezone }))}
        defaultCollapsed={collapsed}
        isAgency={isAgency}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar isAgency={isAgency} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

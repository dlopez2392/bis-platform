import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";

// Design spec section 6: "No 'Back to agency', no Blueprints, no account
// switcher in the topbar." OrganizationSwitcher is Clerk's own org chrome —
// "Manage organization" lets a member rename the org (permanently diverging
// Clerk from accounts.name, since section 7 deliberately ships no
// Clerk->Postgres sync), invite/remove members, change roles, and a
// non-admin member can "Leave organization" and strand themselves with no
// in-app way back. None of that is for a client to touch, so it only
// renders for the agency.
export function Topbar({ isAgency }: { isAgency: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-card px-6">
      <ThemeToggle />
      {isAgency ? <OrganizationSwitcher hidePersonal /> : null}
      <UserButton />
    </header>
  );
}

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarPresence } from "@/components/topbar-presence";

// Design spec section 6: "No 'Back to agency', no Blueprints, no account
// switcher in the topbar." OrganizationSwitcher is Clerk's own org chrome —
// "Manage organization" lets a member rename the org (permanently diverging
// Clerk from accounts.name, since section 7 deliberately ships no
// Clerk->Postgres sync), invite/remove members, change roles, and a
// non-admin member can "Leave organization" and strand themselves with no
// in-app way back. None of that is for a client to touch, so it only
// renders for the agency.
export function Topbar({
  isAgency,
  palette,
}: {
  isAgency: boolean;
  /** P6's ⌘K trigger. Taken as an already-RENDERED node rather than imported
   *  here, so this header keeps its server-component status while the palette
   *  itself stays a client component. An ELEMENT is serializable across the
   *  RSC boundary; a function prop would not be — that is the exact React
   *  Flight violation that 500'd the whole setup page in P5. */
  palette?: React.ReactNode;
}) {
  return (
    <header className="flex h-[54px] shrink-0 items-center justify-end gap-[14px] border-b border-[var(--top-line)] bg-transparent px-[22px]">
      {/* The mockup puts the search control on the LEFT of the bar at 300px
          wide, with everything else pushed right (northern-lights.html:60-62).
          F-107 (rider part): hidden below `sm` — the trigger inside
          (command-palette.tsx's Button) is `shrink-0 whitespace-nowrap`, so
          a narrower box here would not shrink it, it would just overflow
          the topbar. A phone's own search affordance (a plain icon, per
          §6.3 "Surface 2. The phone shell") is sequenced into F-107's
          SECOND part with the rest of that surface; ⌘K itself still works
          below `sm`, for the rare phone with a hardware keyboard — this
          only hides the visible trigger that does not fit. */}
      {palette ? (
        <div className="mr-auto hidden w-[300px] min-w-0 items-center sm:flex">{palette}</div>
      ) : null}
      {/* Task 5: DESIGN.md's "AI presence" pattern — in-account only, both
          audiences, renders nothing outside an account or with no enabled
          voice profile. A "use client" child so the pathname-keyed read it
          needs doesn't cost this header its server-component status; see
          topbar-presence.tsx's own doc comment. Leading position, ahead of
          the right-aligned cluster below — this header stays `justify-end`
          unchanged, so a null render here costs nothing structurally. */}
      <TopbarPresence />
      <ThemeToggle />
      {isAgency ? <OrganizationSwitcher hidePersonal /> : null}
      <UserButton />
    </header>
  );
}

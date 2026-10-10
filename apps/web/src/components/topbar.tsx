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
    // F-107 r1 review (item 3): tighter gap/padding below `sm` only — the
    // mockup's 22px/14px values (restored at sm+) left the icon-only search
    // trigger (item 8) + ThemeToggle + OrganizationSwitcher + UserButton
    // about 20px over the 311px available at 375px wide (measured: all
    // three pushed ~20px past the header's own LEFT edge, since `justify-
    // end` sends overflow leftward, which `document.documentElement.
    // scrollWidth` cannot see — the bounds check above this file's own
    // topbar.test.ts pin exists for is what caught it).
    <header className="flex h-[54px] shrink-0 items-center justify-end gap-2 border-b border-[var(--top-line)] bg-transparent px-3 sm:gap-[14px] sm:px-[22px]">
      {/* The mockup puts the search control on the LEFT of the bar at 300px
          wide, with everything else pushed right (northern-lights.html:60-62).
          F-107 r1 review (item 8): command-palette.tsx now renders its own
          icon-only trigger below `sm` and hides its 300px-wide one there
          instead of this wrapper hiding the whole thing — so this div just
          follows suit: unconstrained width (the icon trigger's own size)
          below `sm`, the mockup's 300px only at sm+. */}
      {palette ? (
        <div className="mr-auto flex min-w-0 items-center sm:w-[300px]">{palette}</div>
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

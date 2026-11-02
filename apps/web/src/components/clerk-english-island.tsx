"use client";

import { useRef } from "react";
import { UNSAFE_PortalProvider } from "@clerk/nextjs";

/**
 * S-10 T9b: Clerk's topbar widgets (OrganizationSwitcher for the agency,
 * UserButton through UserMenu for everyone) as one English island. Owner
 * decision Q6 (2026-10-31): they stay English until F-117 brings Clerk's own
 * Spanish, while the shell around them reads the person's language
 * (dashboard/layout.tsx), so without this a Spanish shell would label
 * "Manage account" and "Sign out" Spanish for a screen reader.
 *
 * The wrapper's lang="en" covers the two triggers. Clerk renders their
 * popovers (the user menu, the organization list) and its account modals
 * through a portal, into <body> by default — outside this wrapper, where they
 * would inherit the Spanish <html lang> instead (measured on a production
 * build before this provider existed: the open user menu read "es"). Clerk's
 * UNSAFE_PortalProvider is its own hook for choosing that container
 * (@clerk/shared's PortalProvider.d.ts: "a custom container for Clerk
 * floating UI elements (popovers, modals, tooltips, etc.)"), so the portals
 * land inside this island and read "en". The container is its own zero-size,
 * absolutely positioned child, not the island itself: the island is a flex
 * row with a gap, and Clerk's portal wrapper is a plain static <div>, which
 * as a flex item would shift both triggers by one gap whenever a menu opened.
 * Out of flow, it takes no space and no gap. Nothing up the topbar's ancestor
 * chain sets a transform, filter, overflow clip or z-index, so a popover or a
 * fixed modal mounted here positions and stacks exactly as it did in <body>
 * (phone-width.spec.ts opens the organization switcher at 375px and checks
 * it stays on screen; spanish-dashboard.spec.ts reads the open menu's lang).
 * The UNSAFE_ prefix is Clerk's: if a Clerk upgrade drops it, the import
 * fails the build rather than silently mislabelling the menus.
 *
 * Known seam, stated rather than hidden: UserMenu adds ONE item of ours,
 * Preferences, whose label follows the reader's locale ("Preferencias"), and
 * Clerk's UserButton.Link takes that label as a plain string, so no element
 * of ours exists to carry `lang="es"` on it. It reads inside this island.
 *
 * The gap is the header's own (topbar.tsx): the two widgets used to be its
 * direct flex children, spaced by it.
 */
export function ClerkEnglishIsland({ children }: { children: React.ReactNode }) {
  const portalRef = useRef<HTMLDivElement>(null);
  return (
    <div lang="en" className="flex items-center gap-2 sm:gap-[14px]">
      <UNSAFE_PortalProvider getContainer={() => portalRef.current}>{children}</UNSAFE_PortalProvider>
      <div ref={portalRef} data-clerk-portal="" className="absolute" />
    </div>
  );
}

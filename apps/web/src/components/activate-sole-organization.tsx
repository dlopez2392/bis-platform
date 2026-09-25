"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { soleOrganizationToActivate } from "@/lib/auth/sole-organization";

/**
 * Gives a signed-in user with exactly one organization an ACTIVE one.
 *
 * Renders nothing. It exists because Clerk keeps the active organization on
 * the session, `force_organization_selection` is off, and the only chrome that
 * would set it — <OrganizationSwitcher/> — renders for the agency alone. A
 * client could therefore accept a valid invitation, sign in, and be told they
 * had no company, with no control anywhere to fix it. See
 * lib/auth/sole-organization.ts for which organization gets picked and why the
 * agency is never one of them.
 *
 * Mounted in the root layout so it covers every surface a client can land on
 * signed-in but unactivated — `/`, `/no-access`, and `/sign-in` — rather than
 * only the one page someone remembered to put it on.
 */
export function ActivateSoleOrganization() {
  const { isLoaded: authLoaded, isSignedIn, orgId } = useAuth();
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true,
  });
  const router = useRouter();
  // Once per mount. `setActive` resolving does not guarantee the next render
  // sees an `orgId` — the session token has to come back first — and without
  // this the effect would fire again on that in-between render and loop.
  const attempted = useRef(false);

  useEffect(() => {
    if (!authLoaded || !listLoaded || !setActive || attempted.current) return;

    const organization = soleOrganizationToActivate({
      signedIn: Boolean(isSignedIn),
      activeOrgId: orgId,
      memberships: (userMemberships?.data ?? []).map((mem) => ({
        organizationId: mem.organization.id,
      })),
    });
    if (!organization) return;

    attempted.current = true;
    void setActive({ organization })
      // A full navigation, not router.refresh(): the new claim arrives in a
      // re-issued session cookie, and `/` is the one page that reads the
      // resolved state and sends a client on to their own dashboard. This runs
      // once, on a path that was previously a dead end, so the reload costs
      // nothing anyone was going to keep.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full page load so the re-issued session cookie's new claim is read fresh, not a client-side transition
      .then(() => { window.location.assign("/"); })
      .catch((e: unknown) => {
        // Leave the page as it was. A failure here is a worse day than it
        // already was, not a reason to replace one confusing screen with a
        // blank one.
        console.error("could not activate the user's only organization:", String(e));
      });
  }, [authLoaded, listLoaded, setActive, isSignedIn, orgId, userMemberships, router]);

  return null;
}

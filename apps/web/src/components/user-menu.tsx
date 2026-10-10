"use client";

import { UserButton } from "@clerk/nextjs";
import { SlidersHorizontal } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * Clerk's user menu with one item of ours, Preferences (F-096), rendered
 * above Clerk's own "Manage account" and "Sign out", which stay. A client
 * component because `UserButton.MenuItems` is a static property of a client
 * reference that topbar.tsx (a server component) cannot read, and
 * `UserButton.Link`'s `label` is a plain string
 * (@clerk/react types-BnGFcHu4.d.mts: UserButtonLinkProps = { href; label:
 * string; labelIcon }), so it is resolved here with useLocale().
 */
export function UserMenu() {
  const locale = useLocale();
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          label={t(m, "prefs.menuItem", locale)}
          labelIcon={<SlidersHorizontal className="size-4" aria-hidden />}
          href="/dashboard/preferences"
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}

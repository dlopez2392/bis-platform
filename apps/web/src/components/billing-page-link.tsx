"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The billing banners' "Go to Billing" link (M7a PR-4, design review M2): the banners are the
 * account LAYOUT's, so they also render on the Billing page itself, where a link to the page you are
 * on is noise. It renders nothing there. A client component only for usePathname; outside the app
 * router (a unit render) the path is unknown and the link shows.
 */
export function BillingPageLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === href) return null;
  return (
    <Link href={href} className="underline underline-offset-2">
      {children}
    </Link>
  );
}

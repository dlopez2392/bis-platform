import type { Metadata } from "next";
import { PublicHtml } from "@/components/public/public-html";
import { readCheckinToken } from "@/lib/checkin/token";

export const metadata: Metadata = {
  // The page's own generateMetadata sets its title, robots and referrer.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/r/<token>`'s root layout (F-072): the same unauthenticated shape as `/u` and `/d` (no dashboard tokens, no
 * ClerkProvider, no theme preference) through the shared `PublicHtml` shell; `app/` declares no root layout (R10),
 * so a tree without one fails `next build`. At this dynamic segment so it can read `params`: `<html lang>` is the
 * language inside the token's signature, which needs NO database read, so the shell can never fail on one and
 * `error.tsx` always has somewhere to render. A token that does not verify gets English, and its page shows both
 * languages stacked, each in its own `lang`.
 */
export default async function CheckinLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const read = readCheckinToken(token);
  return <PublicHtml lang={read.ok ? read.payload.l : "en"}>{children}</PublicHtml>;
}

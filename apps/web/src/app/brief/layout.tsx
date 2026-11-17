import type { Metadata } from "next";

export const metadata: Metadata = {
  // The page's own metadata sets its title, robots and referrer.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/brief/off/<token>` (F-082): the page the daily brief's "Turn this off" link opens. The same unauthenticated shape
 * as `/u`: no dashboard tokens, no ClerkProvider, no theme preference. `app/` declares no root layout (R10), so a
 * tree without one fails `next build`. Clerk's proxy is kept off this tree (proxy.ts's matcher) for `/u`'s reason:
 * a signed-in owner's cookie would otherwise turn this document request into a handshake redirect.
 */
export default function BriefLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

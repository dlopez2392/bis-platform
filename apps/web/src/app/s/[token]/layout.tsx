import type { Metadata } from "next";
import { PublicHtml } from "@/components/public/public-html";
import { loadPageSafe } from "./data";

export const metadata: Metadata = {
  // The page's own generateMetadata sets its title, robots and referrer.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/s/<token>`'s root layout (S-07 3b, spec 4.2): the `/d` tree's unauthenticated shape (no dashboard
 * tokens, no ClerkProvider, no theme preference, no auth read) through the shared `PublicHtml` shell.
 * `<html lang>` is the ACCOUNT's language, read through the page's cached loader. `loadPageSafe` never
 * throws, so the shell always stands and `error.tsx` has somewhere to render.
 */
export default async function SharedFileLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = await loadPageSafe(token);
  return <PublicHtml lang={page?.language ?? "en"}>{children}</PublicHtml>;
}

import type { Metadata } from "next";
import { PublicHtml } from "@/components/public/public-html";
import { loadPageSafe } from "./data";

export const metadata: Metadata = {
  // The page's own generateMetadata sets its title, robots and referrer.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/d/<token>`'s root layout (S-07 2b): the same unauthenticated shape as `/u`, `/f` and `/b` — no
 * dashboard tokens, no ClerkProvider, no theme preference — through the shared `PublicHtml` shell.
 * At this dynamic segment so it can read `params`, and `<html lang>` is the request's own language,
 * read through the page's cached loader. `loadPageSafe` never throws, so the shell always stands and
 * `error.tsx` has somewhere to render when the page's own call to the same read throws.
 */
export default async function CustomerDocsLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const page = await loadPageSafe(token);
  return <PublicHtml lang={page?.language ?? "en"}>{children}</PublicHtml>;
}

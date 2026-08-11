import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { deriveTheme } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";
import { getRequestTheme } from "@/lib/branding/tenant-theme-reader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The two tenant-selectable faces carry `preload: false`, and that is the
// whole point of declaring them here rather than assuming the browser is
// clever. next/font/google defaults to `preload: true`, which emits a
// <link rel="preload" as="font"> for EVERY family declared in the root
// layout on EVERY route — measured on a production build, not assumed. Most
// tenants use neither of these, so preloading both would have made every
// visitor download two font files nothing on the page paints with. With
// preload off they are still in the stylesheet and still fetched the moment
// a tenant's `--font-sans` points at one; only the eager hint is dropped.
// Geist stays preloaded because it is the default and is always painted.
//
// The cost, stated plainly: a tenant who DOES pick one of these two loses the
// preload hint on their own pages, so their first paint can flash the fallback
// face. That is the trade — two wasted downloads for every visitor on every
// route, against one late-swapping heading for the minority who chose a
// non-default face. Revisit if a tenant complains; the honest fix is loading
// the selected face per-tenant, which build-time `next/font` cannot do.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  preload: false,
});

// A serif that holds up at table-row sizes, not a display face. Swappable:
// deriveTheme names it in one place (FONT.serif) and this is the other.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "BIS Platform",
  description: "The all-in-one client platform by Bespoke Intelligent Solutions.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // This layout also wraps /sign-in and /no-access, where there is no tenant
  // to ask -- and, same as the dashboard shell, no tenant for a signed-out
  // caller or the agency either. getRequestTheme (the shared, request-cached
  // reader in lib/branding/tenant-theme-reader.ts) degrades to "no tenant,
  // light mode" quietly in all four cases: it never throws and never
  // redirects, so this layout gains no new failure mode and the redirects
  // stay owned by dashboard/layout.tsx.
  //
  // This is the ONLY place either layout resolves a theme mode now: this
  // layout takes `providerDefault` for the class next-themes puts on <html>,
  // and (below) `serverMode` from the exact same call to derive the tokens it
  // now also paints. They cannot disagree except in the one documented case
  // -- brand_mode "follow" with no cookie yet to override it, where the
  // server paints light and hands next-themes "system" on purpose. For a
  // /dashboard/* request the tenant read itself is not doubled:
  // getRequestTheme is cache()'d and the dashboard shell imports the same
  // binding, so React dedupes the underlying account, branding, and cookie
  // reads to one each per request.
  const { inputs, serverMode, providerDefault } = await getRequestTheme();
  // The agency's chrome stays BIS. Not by a conditional inside the derivation
  // -- by never having a theme to emit, so there is no branch to invert later.
  const theme = deriveTheme(inputs, serverMode);

  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} h-full antialiased`}
      >
        <body
          suppressHydrationWarning
          className="min-h-full flex flex-col"
          // Emitted HERE, on <body>, and not on a themed div further down the
          // tree (where it lived until this fix). globals.css declares
          // `background`/`color`/`font-family` directly on the `body`
          // selector, which resolves custom properties against body's OWN
          // `:root` values -- overriding those properties on a descendant
          // changes nothing about body's rendering, so brand_type never
          // applied and the page canvas + base text stayed BIS underneath a
          // tenant's warm cards. Radix's Portal (dropdown-menu, dialog,
          // popover, select, tooltip, sheet) and Sonner's Toaster below also
          // mount into document.body, OUTSIDE that old div -- so every
          // portalled surface stayed BIS too. Putting the attribute on body
          // itself covers all of it: body's own CSS, and everything a portal
          // ever mounts as body's direct child.
          //
          // A style ATTRIBUTE, not a generated stylesheet: tenant values in
          // CSS text would lose React's entity-escaping, which is the only
          // reason the finding in the brand-colour spec stops at "integrity"
          // and not "XSS". data-tenant-theme is how e2e asserts both its
          // presence for a themed client and its ABSENCE for the agency.
          {...(theme ? { style: themeStyle(theme), "data-tenant-theme": "" } : {})}
        >
          <ThemeProvider defaultTheme={providerDefault}>
            {children}
            <Toaster richColors position="bottom-right" />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

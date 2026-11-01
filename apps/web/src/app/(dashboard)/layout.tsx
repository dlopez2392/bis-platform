import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";
import { headers } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { ThemeProvider } from "@/components/theme-provider";
import { ActivateSoleOrganization } from "@/components/activate-sole-organization";
import { Toaster } from "@/components/ui/sonner";
import { deriveTheme } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";
import { getRequestTheme } from "@/lib/branding/tenant-theme-reader";
import { resolveClientAccessState } from "@/lib/auth";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale } from "@/lib/i18n/request-locale";
import { resolveRootLang } from "@/lib/i18n/accept-language";
import type { Locale } from "@/lib/i18n/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bricolage is no longer the display face: the mockup's .dir-a overrides
// --f-disp to Geist 600 (northern-lights.html:157), so --font-display points
// at var(--font-geist-sans) and nothing reads --font-bricolage any more. The
// family stays declared here — removing it is a separate call — but it must
// NOT preload: next/font/google would emit a <link rel="preload" as="font">
// on every dashboard route for a face no element paints.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  preload: false,
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
  // Declared here rather than as `app/favicon.ico`, and that is the whole
  // reason a client can have their own. A file-convention icon is emitted for
  // every route in the tree and takes precedence over the metadata object, so
  // a nested generateMetadata could not override it — measured: the client's
  // workspace kept serving /favicon.ico with the icons key set. The file now
  // lives in public/ at the same URL, so nothing about the agency's own tab
  // changes; it is simply overridable now, and dashboard/layout.tsx overrides
  // it for a branded client.
  icons: { icon: "/favicon.ico" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // This layout also wraps /sign-in and /no-access, where there is no tenant
  // to ask -- and, same as the dashboard shell, no tenant for a signed-out
  // caller or the agency either. getRequestTheme (the shared, request-cached
  // reader in lib/branding/tenant-theme-reader.ts) degrades to "no tenant"
  // quietly in all four cases -- light for a signed-out caller, dark for the
  // agency (resolveThemeMode's `isOperator`, owner decision 2026-10-06): it
  // never throws and never redirects, so this layout gains no new failure
  // mode and the redirects stay owned by dashboard/layout.tsx.
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
  const { inputs, serverMode, providerDefault, userTheme } = await getRequestTheme();
  // The agency's chrome stays BIS. Not by a conditional inside the derivation
  // -- by never having a theme to emit, so there is no branch to invert later.
  const theme = deriveTheme(inputs, serverMode);

  // S-10 T7 (spec §6 T7, §7 Q5): <html lang> is the resolved locale (DESIGN.md
  // amendment, replacing decision D of 2026-10-10, which put `lang` on
  // converted subtrees only). Signed in: the SAME resolution
  // dashboard/layout.tsx's own shell already uses for its LocaleProvider —
  // the person's own choice, then (for a client only) the account's
  // language, English for an operator with no choice. Signed out (no
  // userId; this covers /sign-in, /, /no-access and /billing-done, where
  // every real session was already redirected to its own dashboard before
  // reaching this far): the browser's own Accept-Language.
  //
  // Agency-only pages and Clerk's own widgets carry their OWN `lang="en"`
  // override on their own wrapping element (same pattern every other
  // converted subtree in this app already uses) — this is the coarse,
  // outer default they override, not a value every descendant must match.
  const { userId } = await auth();
  let sessionLocale: Locale | null = null;
  if (userId) {
    const [clientState, prefs] = await Promise.all([resolveClientAccessState(), getPersonPrefs()]);
    const isAgency = clientState.status === "agency";
    sessionLocale = requestLocale({
      account: clientState.status === "ok" ? { language: clientState.language as Locale | null } : null,
      isOperator: isAgency,
      userLanguage: prefs.language,
    });
  }
  const lang = resolveRootLang(sessionLocale, (await headers()).get("accept-language"));

  return (
    <ClerkProvider>
      <html
        lang={lang}
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} ${bricolage.variable} h-full antialiased`}
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
          <ThemeProvider defaultTheme={providerDefault} userTheme={userTheme}>
            {/* Renders nothing. Inside ClerkProvider and above every page, so
                it covers each surface a client can reach signed-in but with no
                active organization — /, /no-access and /sign-in — instead of
                only whichever one someone remembered. It is a no-op for the
                agency, who is a member of more than one organization, and for
                anyone whose session already has one. */}
            <ActivateSoleOrganization />
            {children}
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

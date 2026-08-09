import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { resolveThemeMode, THEME_COOKIE } from "@/lib/branding/theme-mode";
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
  // Only the cookie is read here, and `null` is passed for the tenant's own
  // default: this layout also wraps /sign-in and /no-access, where there is no
  // tenant to ask. A tenant's default reaches next-themes through the cookie
  // the sync component writes on first resolve.
  //
  // NOT YET TRUE, and deliberately so — the tenant half of this milestone is a
  // later task: nothing calls resolveThemeMode with a real brand_mode yet, and
  // no derived tokens are emitted anywhere. Once the dashboard shell resolves
  // the same two facts through this same function, the tokens it emits and the
  // class next-themes sets here will agree by construction. Until then this
  // call decides one thing only: which class the document starts with.
  const cookieStore = await cookies();
  const { providerDefault } = resolveThemeMode(
    cookieStore.get(THEME_COOKIE)?.value, null,
  );

  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} h-full antialiased`}
      >
        <body suppressHydrationWarning className="min-h-full flex flex-col">
          <ThemeProvider defaultTheme={providerDefault}>
            {children}
            <Toaster richColors position="bottom-right" />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

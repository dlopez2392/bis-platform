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
  // Only the cookie is read here. This layout also wraps /sign-in and
  // /no-access, where there is no tenant to ask, and the tenant's own default
  // reaches next-themes through the cookie the sync below writes on first
  // resolve. The dashboard layout resolves the same two facts through the same
  // function, so the tokens it emits and the class next-themes sets agree.
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

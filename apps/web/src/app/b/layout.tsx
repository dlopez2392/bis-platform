import type { Metadata } from "next";
import { Geist, Inter, Source_Serif_4 } from "next/font/google";

// Same three faces `brand_type` can name, declared for the same reason
// `app/f/layout.tsx` declares them: this tree has its own root layout and
// never sees the dashboard's, so without these declarations `deriveTheme`'s
// `var(--font-geist-sans)` and friends resolve to nothing on this route — the
// whole `font` shorthand in `booking-page.tsx`'s CSS goes invalid and a
// themed tenant silently loses their type scale. The exact inert-token
// failure M4a shipped, verbatim, on a second unauthenticated route.
//
// All three carry `preload: false`, matching `f/layout.tsx`: an unthemed
// booking page paints the system stack and downloads no font at all, which is
// the common case for a link shared in a text message rather than embedded.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif", subsets: ["latin"], preload: false,
});

export const metadata: Metadata = {
  title: "Booking",
  // `app/` is a separate root layout tree from the dashboard's (see below), so
  // this one needs its own default. The page's own `generateMetadata`
  // overrides this with the client's logo when they have one.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/b/<publicId>` is a stranger's own screen — reached directly, never
 * embedded — but is otherwise the same unauthenticated shape as `/f`: no
 * dashboard token layer, no `globals.css`, no `ClerkProvider`, no
 * `ThemeProvider`/`Toaster`, and no shared `class="dark"`. A visitor booking
 * an appointment must never inherit anyone else's theme preference, and this
 * route has no business loading Clerk's client JS at all.
 *
 * Without this file, Next served this segment with NO `<html>`/`<body>` at
 * all — quirks mode, a WCAG lang failure, and the browser's default 8px body
 * margin showing up as a gutter around `booking-page.tsx`'s own padding — on
 * top of the missing font variables above. Same "multiple root layouts"
 * pattern as `app/f`: `app/b` and `app/(dashboard)` are sibling top-level
 * segments, each with its own root layout, and `app/` itself declares none.
 */
export default function PublicBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      {/* The token set is painted on <main> by the page (`publicFormTheme`),
          same as `/f`, and the body is transparent for the same reason `/f`'s
          is: `/b` IS embedded — `embed.js` has a `data-booking` variant, and
          bis-rgv.com's contact page frames it. This used to paint nothing
          here on the reasoning that `/b` was only ever a direct destination;
          the first real embed on a dark host page showed the browser's
          default white body around a dark <main>. A visitor reaching the
          bare page directly sees no difference: <main> still paints its own
          background, and the unthemed fallback is transparent-on-white. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

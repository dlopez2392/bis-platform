import type { Metadata } from "next";
import { Geist, Inter, Source_Serif_4 } from "next/font/google";

// Same three faces `brand_type` can name, declared for the same reason
// `app/f/layout.tsx` and `app/b/layout.tsx` declare them: this tree has its
// own root layout and never sees the dashboard's, so without these
// declarations `deriveTheme`'s `var(--font-geist-sans)` and friends resolve
// to nothing on this route and a themed tenant's typeface silently falls
// back — the exact inert-token failure M4a shipped, on a third
// unauthenticated route.
//
// `preload: false`, matching both siblings: an unthemed chat page paints the
// system stack and downloads no font at all, which is the common case for a
// widget embedded before its account has touched the branding panel.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif", subsets: ["latin"], preload: false,
});

export const metadata: Metadata = {
  title: "Chat",
  // `app/` is a separate root layout tree from the dashboard's, so this one
  // needs its own default. The page's own `generateMetadata` overrides this
  // with the client's brand name and logo when they have one.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/c/<publicId>` is a stranger's own screen, reached from a client's own
 * website (embedded or linked directly) and fully unauthenticated — same
 * shape as `/f` and `/b`: no dashboard token layer, no `globals.css`, no
 * `ClerkProvider`, no `ThemeProvider`/`Toaster`, and no shared `class="dark"`
 * — a dashboard visitor's own theme preference must never leak into a
 * stranger's chat widget, and this route has no business loading Clerk's
 * client JS at all.
 *
 * Without this file Next serves this segment with NO `<html>`/`<body>` at
 * all (`/b/layout.tsx`'s own comment records exactly this failure) — on top
 * of the missing font variables above. Same "multiple root layouts" pattern:
 * `app/c`, `app/f`, `app/b` and `app/(dashboard)` are sibling top-level
 * segments, each with its own root layout, and `app/` itself declares none.
 *
 * NOT in Task 3's file list — the brief's scope omitted it, but the page
 * cannot render at all without it (see this task's report for the full
 * reasoning). Added as a deliberate, documented deviation rather than a
 * silent one.
 */
export default function ConciergeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      {/* The token set is painted on <main> by the page (`publicFormTheme`),
          same as `/f` and `/b`. Transparent for the same reason: the widget
          may sit inside a host page's own floating-bubble container. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

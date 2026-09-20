import type { Metadata } from "next";
import { Geist, Inter, Source_Serif_4 } from "next/font/google";

// The three faces `brand_type` can name, declared here for the same reason
// `app/f/layout.tsx` and `app/b/layout.tsx` both declare them: this tree has
// its own root layout and never sees the dashboard's, so without these
// declarations `deriveTheme`'s `var(--font-geist-sans)` and friends resolve
// to nothing on this route — the inert-token failure M4a shipped, verbatim,
// on the two sibling public routes.
//
// All three carry `preload: false`, matching `f/layout.tsx` and
// `b/layout.tsx`: an unthemed assistant paints the system stack and
// downloads no font at all, which is the common case for a widget embedded
// on someone else's page.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif", subsets: ["latin"], preload: false,
});

export const metadata: Metadata = {
  title: "Assistant",
  // `app/` is a separate root layout tree from the dashboard's (see below),
  // so this one needs its own default. The page's own `generateMetadata`
  // overrides this with the client's logo when they have one, same as `/f`
  // and `/b`.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/a/<publicId>` is reachable directly and embedded (`?embed=1`) on someone
 * else's site — the same unauthenticated shape `/f` and `/b` already
 * document: no dashboard token layer, no `globals.css`, no `ClerkProvider`,
 * no `ThemeProvider`/`Toaster`, and no shared `class="dark"`. A visitor
 * chatting with a client's assistant must never inherit anyone else's theme
 * preference, and this route has no business loading Clerk's client JS at
 * all.
 *
 * Without this file, Next would serve this segment with NO `<html>`/`<body>`
 * at all — quirks mode, a WCAG lang failure, and the browser's default 8px
 * body margin fighting the widget's own layout — on top of the missing font
 * variables above. Same "multiple root layouts" pattern as `app/f` and
 * `app/b`: `app/a` is a sibling top-level segment, each with its own root
 * layout, and `app/` itself declares none.
 */
export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      {/* Transparent for the same reason `/f` and `/b` are: this route is
          embedded far more often than it is visited directly — every one of
          `assistant.js`'s iframes carries `allowtransparency` — and the
          launcher circle painting its own opaque rectangle around itself
          would show as a visible box on a host page it should float over. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

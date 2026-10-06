import { Geist, Inter, Source_Serif_4 } from "next/font/google";

/**
 * The `<html>`/`<body>` shell shared by all three public, unauthenticated
 * root-layout trees (`app/f`, `app/b`, `app/c`) — a client's customer reaches
 * each from the outside world with no dashboard token layer, no
 * `globals.css`, no `ClerkProvider`, no `ThemeProvider`/`Toaster`, and no
 * shared `class="dark"`. Each tree used to declare this SAME shell (the three
 * `next/font/google` faces `brand_type` can name, `<html lang="en">` always,
 * a zero-margin transparent `<body>`) as its own copy — three places that
 * could not help drifting apart, and the reason F-102 exists: all three
 * hard-coded `lang="en"` regardless of the document's own language.
 *
 * `lang` is the one thing each tree supplies itself (see each tree's own
 * `layout.tsx` for how it is resolved) — this component does not guess it.
 *
 * `preload: false` on every face, matching what all three copies already
 * agreed on: an unthemed page paints the system stack and downloads no font
 * at all, which is the common case for an embed or a link shared in a text
 * message, and preloading would spend a font request on most visitors for a
 * face nothing on their page uses.
 */
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif", subsets: ["latin"], preload: false,
});

export type PublicLocale = "en" | "es";

export function PublicHtml({
  lang, children,
}: {
  lang: PublicLocale;
  children?: React.ReactNode;
}) {
  return (
    <html lang={lang} className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      {/* Transparent and zero-margin on every tree: the token set (when a
          tenant is themed) rides on `<main>`, painted by the page itself, so
          an embed with no theme — or a transparent one — keeps showing the
          host page through it. See each page's own `publicFormTheme` call. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

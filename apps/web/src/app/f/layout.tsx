import type { Metadata } from "next";
import { Geist, Inter, Source_Serif_4 } from "next/font/google";

// The three faces `brand_type` can name, declared here because this tree has
// its own root layout and never sees the dashboard's. `deriveTheme` emits
// `var(--font-geist-sans)` and friends; without these declarations those
// variables resolve to nothing on this route and a tenant's typeface silently
// falls back — the same inert-token failure M4a shipped for a whole milestone.
//
// All three carry `preload: false`, and unlike the dashboard that includes the
// default. Geist is preloaded there because it is always painted; here it is
// not — an unthemed form paints the system stack and downloads no font at all,
// which is the majority of embeds. Preloading it would spend a font request on
// most visitors for a face nothing on their page uses.
//
// The stated cost: a tenant who engages the theme by setting only, say, a
// neutral still resolves to FONT.geist, so their form now downloads a font
// where it downloaded none. That follows from "any one control engages the
// whole theme", which is how the workspace already behaves.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif", subsets: ["latin"], preload: false,
});

export const metadata: Metadata = {
  title: "Form",
  // `app/` is a separate root layout tree from the dashboard's, so this one
  // needs its own default now that the icon is config rather than a file
  // convention (see (dashboard)/layout.tsx for why it moved). The form's own
  // page overrides this with the client's logo when they have one.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/f/<publicId>` is embedded in an iframe on someone else's site and is
 * fully unauthenticated — it must not inherit the dashboard's token layer.
 * This layout defines its own `<html>`/`<body>` rather than nesting inside
 * `app/(dashboard)/layout.tsx`: no `globals.css` (its
 * `body { background: var(--background) }` would defeat
 * `theme.transparentBackground` and paint every embed as a grey card), no
 * `ClerkProvider` (this route needs no auth, and loading Clerk's client JS on
 * every embed view is pure waste), no `ThemeProvider`/`Toaster`, and no
 * shared `class="dark"` — a dashboard visitor's own theme preference must
 * never leak into a stranger's embedded form. The form's own theme (see
 * `[publicId]/page.tsx`) is the only thing that may put `.dark` on the page.
 *
 * This relies on Next.js's "multiple root layouts" pattern: `app/(dashboard)`
 * and `app/f` are sibling top-level segments, each with its own root layout,
 * and neither `app/` itself declares a layout above them. That is why the
 * dashboard's former `app/layout.tsx` moved to `app/(dashboard)/layout.tsx`
 * rather than staying where it was — a layout.tsx directly in `app/` would
 * wrap this tree too and reintroduce everything above.
 */
export default function PublicFormLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      {/* Still transparent, and still no globals.css: the token set is painted
          on <main> by the page, so an embed with no theme — or a transparent
          one — keeps showing the host page through it. */}
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

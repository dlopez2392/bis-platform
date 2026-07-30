import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Form",
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
    <html lang="en">
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

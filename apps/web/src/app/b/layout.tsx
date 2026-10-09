import type { Metadata } from "next";
import { PublicHtml } from "@/components/public/public-html";

export const metadata: Metadata = {
  title: "Booking",
  // `app/` is a separate root layout tree from the dashboard's (see below), so
  // this one needs its own default. Each page's own `generateMetadata`
  // overrides this with a localized, brand-aware title (F-102) and the
  // client's logo when they have one.
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
 * top of the missing font variables `PublicHtml` now declares once for all
 * three public trees. Same "multiple root layouts" pattern as `app/f`:
 * `app/b` and `app/(dashboard)` are sibling top-level segments, each with
 * its own root layout, and `app/` itself declares none.
 *
 * `lang` is hard-coded to `"en"` here, UNLIKE `app/f/[publicId]/layout.tsx`
 * and `app/c/[publicId]/layout.tsx` — and this is deliberate, not a leftover
 * of the old bug (F-102, defect :881). Those two trees moved their layout
 * DOWN to `[publicId]` because the form and the voice profile each carry
 * their own `locale_default`/`languages` column to read instead. A calendar
 * carries no such column (confirmed by reading `packages/db/src/booking.ts`
 * — no `locale`/`language` field on `calendars` or `bookings`), so there is
 * NO per-document default to read even if this layout moved down too; the
 * only locale signal on `/b` is `?locale=` (`embed.js`'s `data-locale`, or a
 * confirmation/reminder email's own link), which no layout — moved down or
 * not — can ever see (searchParams are not passed to ANY layout, by Next's
 * own design; confirmed against `next/dist/build/.../next-types-plugin`'s
 * own `LayoutProps`, which carries `params` only). So `/b`'s `<html lang>`
 * stays "en" exactly as before. See this task's report for the full
 * reasoning and the two remedies that would unblock it (a `locale` column on
 * `bookings`, or a deliberately re-reviewed carve-out in `proxy.ts`, which
 * `proxy.test.ts` currently pins shut for `/b`, `/f`, `/c` and `/u` as a
 * whole — see that file's own mutation note before touching it).
 *
 * `/b`'s dead ends are branded by the segment layouts beside each page that
 * can reach one (D-109; `app/b/[publicId]/(book)/layout.tsx` and
 * `.../cancel/[token]/layout.tsx`), never here: this root layout cannot read
 * the calendar without a query on every `/b` request.
 */
export default function PublicBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicHtml lang="en">{children}</PublicHtml>;
}

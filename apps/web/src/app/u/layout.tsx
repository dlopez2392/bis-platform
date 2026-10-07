import type { Metadata } from "next";
import { Geist, Inter, Source_Serif_4 } from "next/font/google";

// The three faces `brand_type` can name, declared for the reason app/b and
// app/f declare them: this tree has its own root layout and never sees the
// dashboard's, so without them publicFormTheme's `var(--font-geist-sans)` and
// friends resolve to nothing. preload:false: an unthemed page paints the
// system stack and downloads no font.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  // The page's own metadata sets its title, robots and referrer.
  icons: { icon: "/favicon.ico" },
};

/**
 * `/u/<token>` (consent chain PR-3): the unsubscribe page a customer reaches
 * from an email's footer. The same unauthenticated shape as `/b` and `/f`: no
 * dashboard tokens, no ClerkProvider, no theme preference, no `class="dark"`.
 * `app/` declares no root layout (R10), so a tree without one fails `next
 * build`. The page is English and Spanish stacked; each half carries its own
 * `lang`, and the document's is English.
 */
export default function UnsubscribeLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${inter.variable} ${sourceSerif.variable}`}>
      <body style={{ margin: 0, background: "transparent" }}>{children}</body>
    </html>
  );
}

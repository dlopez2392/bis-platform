import type { CSSProperties, ReactNode } from "react";
import { brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";

/**
 * A booking link's dead end in the business's own brand (D-109): the logo,
 * the name and the SAME tenant theme the live booking page paints on its
 * `<main>`, around whatever the colocated `not-found.tsx` renders. The
 * not-found's text (`app/b/not-found.tsx`) reads `var(--foreground, …)`, so
 * it picks up the brand's colours here through ordinary inheritance and
 * paints its literal fallback everywhere else.
 *
 * Used only by the two `/b` segment layouts, and only when the link names a
 * REAL calendar: an id that never existed stays neutral, the split `/f` and
 * `/c` already draw. No `?theme=` here: a layout never sees search params, so
 * this paints the account's own stored mode, as `/f`'s layout does.
 *
 * `--public-measure` is the booking flow's 480px column, the width
 * `deadEndTextStyle` gives the not-found's own text, so the logo sits over
 * the words it heads; the ground and height match `.bis-booking-page`.
 */
export function BrandedDeadEnd({ branding, children }: { branding: Branding; children: ReactNode }) {
  const theme = publicFormTheme(branding, false, null);
  const style = {
    ...theme.style,
    "--public-measure": "480px",
    background: "var(--background, transparent)",
    minHeight: "100vh",
  } as CSSProperties;
  return (
    <div data-booking-dead-end="" style={style} {...(theme.themed ? { "data-tenant-theme": "" } : {})}>
      {theme.darkCss ? <style>{theme.darkCss}</style> : null}
      <PublicBrand
        name={branding.brandName}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      {children}
    </div>
  );
}

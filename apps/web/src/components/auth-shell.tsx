import type { ReactNode } from "react";
import { Ground } from "@/components/ground";
import { BisMark } from "@/components/bis-mark";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The frame every signed-out screen renders through: /sign-in, / and
 * /no-access.
 *
 * One shell rather than three, because those three had already drifted apart —
 * / and /no-access each mounted their own Ground and their own glass card,
 * while /sign-in was a bare <SignIn /> on a flat page with no Ground at all.
 * Re-creating that divergence is exactly what this work exists to remove.
 *
 * The left rail is the DASHBOARD SIDEBAR'S CHROME, applying the existing
 * `sidebar-chrome` utility rather than restating its values. That surface is
 * dark in BOTH themes (a recorded decision), which is what makes this
 * recognisable as the product before a word is read, and what gives the light
 * theme an anchor it otherwise lacks. It is chrome, not a fifth content
 * surface.
 *
 * There is deliberately NO navigation in it, and no setup meter. A rail full
 * of links nobody signed in can follow is decoration pretending to be
 * structure. The direction mockup drew one and it was cut.
 *
 * Below 640px the rail becomes a horizontal brand bar across the top of the
 * card so the form keeps full width on a phone; the rail's micro-copy drops
 * there rather than wrapping under the wordmark.
 */
export function AuthShell({ children, locale = "en" }: {
  children: ReactNode;
  /** S-10 T7 (spec §7 Q5): the BROWSER's language, since nobody is
   *  authenticated on any page this shell wraps — the caller (each
   *  signed-out page) resolves it via `localeFromAcceptLanguage` and passes
   *  it down as a prop, same discipline as every other converted component
   *  on this screen (never `useLocale()`, which has nothing to read here —
   *  there is no `LocaleProvider` above a signed-out page). Optional,
   *  default "en", so every existing call site is unaffected. */
  locale?: Locale;
}) {
  return (
    <main lang={locale} className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <Ground />
      {/* Deliberately NOT overflow-hidden. Clerk renders things that overflow
          the card on purpose — a "Last used" badge on the Google button, any
          POPOVER (a phone/country-code dropdown, say) — and clipping the card
          cut the badge off (measured: its right edge landed 11px past the
          card's). The rail rounds its OWN corners instead, at the specific
          corners that are actually a card edge, so the card's radius still
          reads correctly with nothing clipped. */}
      <div className="flex w-full max-w-[840px] flex-col rounded-xl border border-border bg-card glass sm:flex-row">
        <div
          data-slot="auth-rail"
          className="sidebar-chrome flex shrink-0 items-center gap-3 rounded-t-xl border-b border-[var(--sidebar-line)] px-6 py-5 sm:w-[200px] sm:flex-col sm:items-start sm:gap-2 sm:border-b-0 sm:border-r sm:py-8 sm:rounded-tr-none sm:rounded-bl-xl"
        >
          <BisMark size={28} className="text-[var(--sidebar-text-strong)]" />
          {/* "shell.brand" is "shell"'s own namespace, not this task's — read
              through t() regardless (falls back to the identical English
              "BIS" with no twin, which is also the correct Spanish: a brand
              abbreviation, not a word to translate). */}
          <span className="text-sm font-semibold text-[var(--sidebar-text-strong)]">
            {t(m, "shell.brand", locale)}
          </span>
          <span className="hidden text-xs text-[var(--sidebar-muted)] sm:block">
            {t(m, "signIn.railCopy", locale)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 px-6 py-8 sm:px-8">
          {children}
        </div>
      </div>
    </main>
  );
}

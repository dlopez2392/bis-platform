import type { ReactNode } from "react";
import { Ground } from "@/components/ground";
import { BisMark } from "@/components/bis-mark";
import { m } from "@/lib/messages";

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
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <Ground />
      <div className="flex w-full max-w-[840px] flex-col overflow-hidden rounded-xl border border-border bg-card glass sm:flex-row">
        <div
          data-slot="auth-rail"
          className="sidebar-chrome flex shrink-0 items-center gap-3 border-b border-[var(--sidebar-line)] px-6 py-5 sm:w-[200px] sm:flex-col sm:items-start sm:gap-2 sm:border-b-0 sm:border-r sm:py-8"
        >
          <BisMark size={28} className="text-[var(--sidebar-text-strong)]" />
          <span className="text-sm font-semibold text-[var(--sidebar-text-strong)]">
            {m["shell.brand"]}
          </span>
          <span className="hidden text-xs text-[var(--sidebar-muted)] sm:block">
            {m["signIn.railCopy"]}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 px-6 py-8 sm:px-8">
          {children}
        </div>
      </div>
    </main>
  );
}

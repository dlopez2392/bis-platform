/**
 * The booking flow's one stylesheet, rendered as a <style> tag by every page
 * that draws its markup: the booking page (`booking-page.tsx`, with the
 * picker it shares, `slot-picker.tsx`) and the move page
 * (`move/[token]/move-form.tsx`, F-048). A plain module, not a component file,
 * so both client components import the SAME string, and
 * `booking-page.test.ts` checks every bis-booking-* class either renders
 * against it.
 *
 * Moved here verbatim from booking-page.tsx (F-048); the history below is
 * that file's.
 */
// Every themeable value rides the same `var(--token, <fallback>)` convention
// `f/[publicId]/form.css` established — an unthemed account renders exactly
// these fallbacks, a themed one inherits the tokens `publicFormTheme` already
// put on `<main>` in page.tsx. Embedded here rather than a new stylesheet:
// this route has no other CSS file, and this is the one client component on
// it, rendered (and therefore this tag emitted) on both the server-rendered
// first paint and after hydration alike — including the brand header markup
// `page.tsx` renders as this component's sibling.
export const BOOKING_CSS = `
/* --public-measure is this page's own column width, read by the shared brand
   header in styles/public-brand.css. The header is a SIBLING of .bis-booking,
   not a child, so without it the client's logo hung at the far left while the
   column it heads sat centred — the bug /f had already fixed for itself. The
   three .bis-booking-brand* rules that used to live here moved to that shared
   sheet along with the form's copies of them.

   Everything themeable still rides the same var(--token, <fallback>)
   convention that f/[publicId]/form.css established. Tints are derived from
   those same tokens with color-mix rather than introduced as new literals, so
   a client's accent colours the selected day, the today dot and the focus
   ring without anyone adding a token per shade. */
.bis-booking-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 520px; }
.bis-booking {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 520px; margin: 0 auto;
  --bis-accent: var(--form-accent, #6d28d9);
  --bis-tint: color-mix(in oklab, var(--bis-accent) 10%, transparent);
  --bis-ring: color-mix(in oklab, var(--bis-accent) 35%, transparent);
}

/* --- Where you are: three dots, the current step named -------------------
   The markup (\`steps\` above) shipped without a single rule, so every booking
   page — including the one framed on bis-rgv.com — rendered a browser-default
   numbered list of all three step names. Now the dots carry the position and
   only the CURRENT step's name is visible, in a tinted pill; the other two
   names stay in the accessibility tree, which is what the markup's own
   comment always promised. A step already passed fills its dot. */
.bis-booking-steps { list-style: none; margin: 0 0 16px; padding: 0; display: flex; align-items: center; gap: 6px; }
.bis-booking-step { display: inline-flex; align-items: center; gap: 8px; }
.bis-booking-step-dot {
  width: 8px; height: 8px; border-radius: 999px; flex: none;
  background: color-mix(in oklab, var(--foreground, #18181b) 18%, transparent);
}
.bis-booking-step:has(~ .is-current) .bis-booking-step-dot,
.bis-booking-step.is-current .bis-booking-step-dot { background: var(--bis-accent); }
.bis-booking-step.is-current { padding: 4px 10px 4px 8px; border-radius: 999px; background: var(--bis-tint); }
.bis-booking-step-name {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
.bis-booking-step.is-current .bis-booking-step-name {
  position: static; width: auto; height: auto; margin: 0; overflow: visible; clip-path: none;
  font-size: 13px; font-weight: 500;
}

/* --- The month, and the week arrows ------------------------------------- */
.bis-booking-monthrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.bis-booking-month { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.bis-booking-navs { display: flex; gap: 4px; }
.bis-booking-nav {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  font: inherit; color: inherit; cursor: pointer;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-ctl, 8px);
  background: var(--card, #ffffff);
  transition: background-color 150ms ease, border-color 150ms ease;
}
.bis-booking-nav:hover:not(:disabled) { background: var(--bis-tint); border-color: var(--bis-accent); }

/* --- The week strip ------------------------------------------------------ */
.bis-booking-days {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-bottom: 12px;
}
.bis-booking-day {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  font: inherit; color: inherit; cursor: pointer;
  padding: 8px 4px 10px;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-ctl, 8px);
  background: var(--card, #ffffff);
  transition: background-color 150ms ease, border-color 150ms ease;
}
.bis-booking-day:hover:not(:disabled):not(.is-selected) { background: var(--bis-tint); border-color: var(--bis-accent); }
/* Weekday small and quiet, the date the thing you actually read. Both were
   the same size on one line before, which made seven chips a wall of text. */
.bis-booking-day-weekday {
  font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-day-date { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.1; }
.bis-booking-day.is-selected {
  border-color: var(--bis-accent); background: var(--bis-accent);
  color: var(--form-accent-foreground, #ffffff);
}
.bis-booking-day.is-selected .bis-booking-day-weekday { color: inherit; opacity: 0.8; }
/* Today is marked, not merely selectable. Nothing on the strip said which day
   was today unless it happened to be the selected one. */
.bis-booking-day-dot {
  position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 999px;
  background: var(--bis-accent);
}
.bis-booking-day.is-selected .bis-booking-day-dot { background: currentColor; }
.bis-booking-day:disabled, .bis-booking-nav:disabled { opacity: 0.35; cursor: not-allowed; }

.bis-booking-tzlabel {
  font-size: 12px; color: var(--muted-foreground, #71717a); margin: 0 0 12px;
}

/* --- Times, grouped by part of the day ----------------------------------- */
.bis-booking-slotarea { display: flex; flex-direction: column; gap: 16px; }
.bis-booking-group { display: flex; flex-direction: column; gap: 8px; }
.bis-booking-grouplabel {
  margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.bis-booking-slot {
  font: inherit; font-variant-numeric: tabular-nums;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-ctl, 8px);
  background: var(--card, #ffffff); color: inherit; padding: 10px 6px; cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}
/* Hover shifts the surface; the outline is reserved for focus, so a keyboard
   user can still tell where they are. Before this both did the same thing. */
.bis-booking-slot:hover { background: var(--bis-tint); border-color: var(--bis-accent); }

/* --- Loading, shaped like what is coming --------------------------------- */
.bis-booking-skeletons { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.bis-booking-skeleton {
  height: 40px; border-radius: var(--radius-ctl, 8px);
  background: color-mix(in oklab, var(--foreground, #18181b) 8%, transparent);
  animation: bis-booking-pulse 1.4s ease-in-out infinite;
}
.bis-booking-skeleton:nth-child(2n) { animation-delay: 0.15s; }
.bis-booking-skeleton:nth-child(3n) { animation-delay: 0.3s; }
@keyframes bis-booking-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.bis-booking-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* --- Empty and error ------------------------------------------------------ */
.bis-booking-empty {
  border: 1px dashed var(--border, #d4d4d8); border-radius: var(--radius-card, 12px);
  padding: 20px 16px; text-align: center;
}
.bis-booking-empty-title { margin: 0; font-weight: 600; }
.bis-booking-empty-hint { margin: 4px 0 0; font-size: 13px; color: var(--muted-foreground, #71717a); }
/* The token, not the literal. #b91c1c measures 2.93:1 on all three dark ramps
   — under AA, on the sentence that tells a customer their email address is
   wrong. --form-error is already emitted to this page by publicFormTheme and
   is already lifted to 4.5:1 at source (public-form-theme.ts); /f has read it
   since M4b. The e2e journey (booking.spec.ts, P7) measures this. */
.bis-booking-error { color: var(--form-error, #b91c1c); margin: 0 0 8px; }

/* --- The time you picked -------------------------------------------------- */
.bis-booking-chosen {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-card, 12px);
  background: var(--bis-tint);
  padding: 12px 14px; margin: 0 0 16px;
}
.bis-booking-chosen-label {
  margin: 0; font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted-foreground, #71717a);
}
.bis-booking-chosen-when { margin: 2px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.bis-booking-change {
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid var(--border, #d4d4d8); border-radius: 999px;
  background: var(--card, #ffffff); color: inherit; padding: 6px 12px;
  transition: border-color 150ms ease;
}
.bis-booking-change:hover { border-color: var(--bis-accent); }

/* --- F-048: the move page — the booking being moved, and the other way out.
   The current time is read, not acted on, so it sits on the plain card
   ground rather than the chosen card's tint. */
.bis-booking-current {
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-card, 12px);
  background: var(--card, #ffffff);
  padding: 12px 14px; margin: 0 0 16px;
}
.bis-booking-current-when { margin: 2px 0 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
/* A link that can no longer move anything says why, in the cancel page's
   title weight. */
.bis-booking-status { margin: 0 0 8px; font-size: 17px; font-weight: 600; }
.bis-booking-alt { margin: 20px 0 0; text-align: center; font-size: 13px; }
.bis-booking-alt a { color: var(--muted-foreground, #71717a); }

/* --- The form ------------------------------------------------------------- */
.bis-booking-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.bis-booking-row label { font-size: 13px; font-weight: 500; }
.bis-booking-optional { font-weight: 400; color: var(--muted-foreground, #71717a); }
.bis-booking input[type="text"], .bis-booking input[type="email"], .bis-booking input[type="tel"], .bis-booking textarea {
  width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit;
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-ctl, 8px);
  background: var(--card, #ffffff); color: inherit;
  transition: border-color 150ms ease;
}
.bis-booking-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.bis-booking-submit {
  font: inherit; font-weight: 600; border: none; border-radius: var(--radius-ctl, 8px);
  background: var(--bis-accent); color: var(--form-accent-foreground, #ffffff);
  padding: 12px 18px; cursor: pointer; width: 100%;
  transition: filter 150ms ease;
}
.bis-booking-submit:hover:not(:disabled) { filter: brightness(0.94); }
.bis-booking-submit:disabled { opacity: 0.6; cursor: not-allowed; }

/* One focus treatment for every control on the page, so nothing is ever
   focused without being obviously focused. */
.bis-booking button:focus-visible,
.bis-booking input:focus-visible,
.bis-booking textarea:focus-visible,
.bis-booking a:focus-visible {
  outline: 2px solid var(--bis-accent); outline-offset: 2px;
}
.bis-booking input:focus, .bis-booking textarea:focus { border-color: var(--bis-accent); }

/* --- Booked --------------------------------------------------------------- */
.bis-booking-success {
  border: 1px solid var(--border, #d4d4d8); border-radius: var(--radius-card, 12px);
  background: var(--card, #ffffff);
  padding: 24px 20px; text-align: center;
}
.bis-booking-check {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 999px; margin-bottom: 12px;
  background: var(--bis-tint); color: var(--bis-accent);
}
.bis-booking-success-title { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 4px; }
.bis-booking-success-when { margin: 0 0 12px; font-weight: 600; }
.bis-booking-success-body { color: var(--muted-foreground, #71717a); margin: 0 0 16px; }
.bis-booking-calendar { margin: 0 0 8px; font-weight: 600; }
.bis-booking-calendar a { color: var(--bis-accent); }
.bis-booking-cancel-hint { font-size: 13px; color: var(--muted-foreground, #71717a); margin: 0; }

/* --- Ours, quietly ---------------------------------------------------------
   DESIGN.md's booking page ends on a small "Powered by BIS". It rendered as a
   browser-default blue underlined link — the loudest thing on a page that is
   meant to wear the client's brand, not ours. */
.bis-booking-poweredby { margin: 20px 0 0; text-align: center; font-size: 12px; color: var(--muted-foreground, #71717a); }
.bis-booking-poweredby a { color: inherit; text-decoration: none; }
.bis-booking-poweredby a:hover { color: var(--foreground, #18181b); text-decoration: underline; text-underline-offset: 3px; }

@media (prefers-reduced-motion: reduce) {
  .bis-booking *, .bis-booking-skeleton { transition: none !important; animation: none !important; }
}
`;

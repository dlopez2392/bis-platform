/**
 * The check-in page's own stylesheet, shared by `page.tsx` and `error.tsx` (the page's <style> never renders when
 * the page threw, so the boundary carries its own copy of the same rules). The /u and /d convention:
 * `var(--token, fallback)`, so an unthemed account renders exactly these fallbacks and a themed one the tokens
 * publicFormTheme put on <main>. Public trees never load globals.css, so the fallbacks are the light tokens' own
 * values. The three answers are equal tiles on purpose (DESIGN.md rule 8, the chooser amendment: mutually exclusive
 * single-step actions, none more correct, so no primary); the review button, alone on its screen, is the primary.
 * No backticks inside this literal. Browser-safe: no import.
 */
export const CHECKIN_CSS = `
.bis-checkin-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
.bis-checkin {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-checkin-lang + .bis-checkin-lang { margin-top: 16px; }
.bis-checkin-title { font-size: 20px; font-weight: 600; margin: 8px 0 4px; overflow-wrap: anywhere; }
.bis-checkin-detail { color: var(--muted-foreground, #71717a); margin: 0; overflow-wrap: anywhere; }
.bis-checkin-sentence { margin: 0; overflow-wrap: anywhere; }
.bis-checkin-yours { color: var(--muted-foreground, #71717a); margin: 8px 0 0; overflow-wrap: anywhere; }
.bis-checkin-alert { margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--border, #e4e4e7); border-left: 4px solid var(--form-error, #B91C1C); border-radius: var(--radius, 0.5rem); }
.bis-checkin-alert .bis-checkin-title { font-size: 15px; margin: 0; }
.bis-checkin-tiles { display: grid; gap: 12px; margin: 20px 0 0; }
.bis-checkin-tile, .bis-checkin-primary {
  display: flex; align-items: center; justify-content: center; width: 100%; min-height: 56px; box-sizing: border-box;
  font: inherit; font-size: 17px; font-weight: 600; border-radius: var(--radius, 0.5rem); padding: 12px 18px; cursor: pointer;
  transition: opacity 150ms ease, border-color 150ms ease;
}
.bis-checkin-tile { border: 1px solid var(--border, #e4e4e7); background: var(--card, #ffffff); color: var(--foreground, #18181b); }
.bis-checkin-tile:hover { border-color: var(--form-accent, #6d28d9); }
.bis-checkin-primary { border: none; background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff); }
.bis-checkin-primary:hover { opacity: 0.9; }
.bis-checkin-tile:focus-visible, .bis-checkin-primary:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
.bis-checkin-review { margin: 20px 0 0; }
.bis-checkin-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-checkin-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-checkin-poweredby a:hover { text-decoration: underline; }
.bis-checkin-poweredby a:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .bis-checkin-tile, .bis-checkin-primary { transition: none; } }
`;

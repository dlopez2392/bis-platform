/**
 * The customer's document page's own stylesheet, shared by `page.tsx` and `error.tsx` (the page's
 * <style> never renders when the page threw, so the boundary carries its own copy of the same rules).
 * `/u`'s convention (its UNSUB_CSS): `var(--token, fallback)`, so an unthemed account renders exactly
 * these fallbacks and a themed one the tokens publicFormTheme put on <main>. Public trees never load
 * globals.css, so the fallbacks are the light tokens' own values (tokens.css:93-95 for the three state
 * colours). The red dot is --form-error, which publicFormTheme lifts per mode against the tenant's own
 * ground (--crit measured 2.92:1 on a dark tenant, Task 9 review); --good and --warn are never set on a
 * public tree, so they stay the light fallbacks. No backticks inside this literal. Browser-safe: no import.
 */
export const DOCREQ_CSS = `
.bis-docreq-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
.bis-docreq {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-docreq-lang + .bis-docreq-lang { margin-top: 16px; }
.bis-docreq-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; overflow-wrap: anywhere; }
.bis-docreq-detail { color: var(--muted-foreground, #71717a); margin: 0; overflow-wrap: anywhere; }
.bis-docreq-detail + .bis-docreq-detail { margin-top: 8px; }
.bis-docreq-items { list-style: none; margin: 16px 0 0; padding: 0; }
.bis-docreq-item { padding: 16px 0; }
.bis-docreq-item + .bis-docreq-item { border-top: 1px solid var(--border, #e4e4e7); }
.bis-docreq-label { font-weight: 600; margin: 0; overflow-wrap: anywhere; }
.bis-docreq-lines { list-style: none; margin: 4px 0 0; padding: 0; }
.bis-docreq-lines:empty { margin: 0; }
.bis-docreq-line { display: flex; align-items: flex-start; gap: 8px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bis-docreq-line + .bis-docreq-line { margin-top: 4px; }
.bis-docreq-dot { flex: none; width: 8px; height: 8px; border-radius: 999px; margin-top: 7px; }
.bis-docreq-dot--good { background: var(--good, #15803D); }
.bis-docreq-dot--warn { background: var(--warn, #B45309); }
.bis-docreq-dot--crit { background: var(--form-error, #B91C1C); }
.bis-docreq-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
.bis-docreq-primary, .bis-docreq-ghost {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px; box-sizing: border-box;
  font: inherit; font-weight: 600; border-radius: var(--radius, 0.5rem); padding: 10px 18px; cursor: pointer;
  transition: opacity 150ms ease, border-color 150ms ease;
}
.bis-docreq-primary { border: none; background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff); }
.bis-docreq-ghost { border: 1px solid var(--border, #e4e4e7); background: transparent; color: var(--foreground, #18181b); }
.bis-docreq-primary:hover { opacity: 0.9; }
.bis-docreq-ghost:hover { border-color: var(--muted-foreground, #71717a); }
.bis-docreq-primary:focus-visible, .bis-docreq-ghost:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
.bis-docreq-photo { display: none; }
@media (pointer: coarse), (max-width: 767px) { .bis-docreq-photo { display: inline-flex; } }
.bis-docreq-call { margin: 24px 0 0; color: var(--muted-foreground, #71717a); overflow-wrap: anywhere; }
.bis-docreq-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-docreq-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-docreq-poweredby a:hover { text-decoration: underline; }
.bis-docreq-poweredby a:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .bis-docreq-primary, .bis-docreq-ghost { transition: none; } }
`;

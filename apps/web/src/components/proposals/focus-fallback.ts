/**
 * A suggestion list's fallback focus targets (item 8b-2; design review I3, spec 4.5), as the list's
 * `data-focus-fallback` attribute: CSS selectors in order, tried once no card of the plan is left
 * (suggestion-actions.tsx's focusPlan). A plain module, no directive: server components (the sections)
 * write the attribute and the client card reads it, so neither may import the other's file for it.
 */
export const FALLBACK_SEP = "|";

export const focusFallback = (...selectors: string[]): string => selectors.join(FALLBACK_SEP);

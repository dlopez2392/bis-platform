/**
 * The account switcher's avatar chip has no logo concept — accounts carry no
 * uploaded mark, only a client's own identity block does (app-sidebar.tsx's
 * clientLogoUrl prop, resolved from that account's branding row) — so its
 * chip falls back straight to this: the active account's own first
 * character, uppercased. `Array.from` rather than a plain index read so a
 * name starting with a surrogate-pair character (an emoji, some non-BMP
 * scripts) yields that whole character instead of half of one.
 *
 * Blank/whitespace-only names return "" deliberately: the caller's own
 * generic-icon fallback is what renders then, the same one shown when there
 * is no active account at all — one no-letter chip look, not two.
 */
export function accountInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return Array.from(trimmed)[0]!.toLocaleUpperCase();
}

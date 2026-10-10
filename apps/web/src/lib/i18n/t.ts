// Generalises the interpolation every call site in this repo today does by
// hand with `.replace("{x}", value)` (see messages.ts's own callers), and
// the two-key plural convention messages.ts already hand-rolls
// (shell.presence.idleShort / idleShortOne) — same shape, named once.
import type { Locale } from "./locale";

function interpolate(raw: string, params?: Record<string, string | number>): string {
  if (!params) return raw;
  let out = raw;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Looks up `${key}.es` when locale is "es", falling back to `key` itself
 *  when no Spanish twin exists yet (a ratchet-gate violation to catch, not
 *  a runtime crash to cause). */
export function t(
  catalogue: Record<string, string>,
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const raw = locale === "es" ? catalogue[`${key}.es`] ?? catalogue[key] : catalogue[key];
  return interpolate(raw ?? key, params);
}

/** `baseKey` holds the "other" form (e.g. "calls.count" → "{count} calls");
 *  `${baseKey}One` holds the singular (e.g. "calls.countOne" → "1 call").
 *  Both get the SAME .es-suffix treatment `t()` uses. Intl.PluralRules
 *  decides "one" vs "other" per locale's own rules, not a hard-coded
 *  count===1 check — the mechanism generalises past English/Spanish's
 *  shared two-way split even though this catalogue's data does not yet
 *  need a third form. */
export function plural(
  catalogue: Record<string, string>,
  baseKey: string,
  count: number,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const category = new Intl.PluralRules(locale === "es" ? "es-US" : "en-US").select(count);
  const key = category === "one" ? `${baseKey}One` : baseKey;
  return t(catalogue, key, locale, params);
}

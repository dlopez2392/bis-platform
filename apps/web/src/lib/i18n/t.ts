// Generalises the interpolation every call site in this repo today does by
// hand with `.replace("{x}", value)` (see messages.ts's own callers), and
// the two-key plural convention messages.ts already hand-rolls
// (shell.presence.idleShort / idleShortOne) — same shape, named once.
import type { Locale } from "./locale";

type Catalogue = Readonly<Record<string, string>>;

/** The keys of the catalogue passed in — for `m` (declared `as const`) that
 *  is `keyof typeof m`, the compile-time check the spec promised (I4): a
 *  typo'd key is a type error, not a runtime fallback to the raw key. An
 *  ad-hoc `Record<string, string>` (tests) still accepts any string. */
export type CatalogueKey<C extends Catalogue> = Extract<keyof C, string>;

/** A base key whose `${key}One` singular twin exists in the catalogue. */
export type PluralKey<C extends Catalogue> = {
  [K in CatalogueKey<C>]: `${K}One` extends keyof C ? K : never;
}[CatalogueKey<C>];

function interpolate(raw: string, params?: Record<string, string | number>): string {
  if (!params) return raw;
  let out = raw;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Looks up `${key}.es` when locale is "es", falling back to the English
 *  `key` when no Spanish twin exists yet (a ratchet-gate violation to catch, not
 *  a runtime crash to cause). Falls back to the raw key itself only if
 *  neither the Spanish twin nor the English key are found — which a typed
 *  catalogue makes unreachable for `m`. */
export function t<C extends Catalogue>(
  catalogue: C,
  key: CatalogueKey<C>,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const lookup: Record<string, string | undefined> = catalogue;
  const raw = locale === "es" ? lookup[`${key}.es`] ?? lookup[key] : lookup[key];
  return interpolate(raw ?? key, params);
}

/** `baseKey` holds the "other" form (e.g. "calls.count" → "{count} calls");
 *  `${baseKey}One` holds the singular (e.g. "calls.countOne" → "1 call").
 *  Both get the SAME .es-suffix treatment `t()` uses. Intl.PluralRules
 *  decides "one" vs "other" per locale's own rules, not a hard-coded
 *  count===1 check — the mechanism generalises past English/Spanish's
 *  shared two-way split even though this catalogue's data does not yet
 *  need a third form. `baseKey` is typed to keys that HAVE a One twin. */
export function plural<C extends Catalogue>(
  catalogue: C,
  baseKey: PluralKey<C>,
  count: number,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const category = new Intl.PluralRules(locale === "es" ? "es-US" : "en-US").select(count);
  const key = (category === "one" ? `${baseKey}One` : baseKey) as CatalogueKey<C>;
  return t(catalogue, key, locale, params);
}

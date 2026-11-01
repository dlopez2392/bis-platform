// S-10 T7 (spec §6 T7, §7 Q5). The browser's own language picks ONLY the
// signed-out pages (/sign-in, /, /no-access, /billing-done) — after sign-in,
// the person's own choice, then the account's language, still governs
// (requestLocale/resolveLocale, unchanged by this file). Nothing here is a
// third member of the `Locale` union or a new precedence rule for a signed-in
// request.
import type { Locale } from "./locale";

type Range = { tag: string; q: number; index: number };

/** `Accept-Language: es-MX,en;q=0.5` → ranges `[{tag:"es-mx",q:1,index:0},
 *  {tag:"en",q:0.5,index:1}]`. A missing `;q=` defaults to 1 (RFC 9110 §12.4.2).
 *  Malformed q-values (non-numeric, out of 0-1) fall back to 0 rather than
 *  throwing — a header is attacker-controlled input, never trusted raw. */
function parseRanges(header: string): Range[] {
  return header.split(",").map((part, index) => {
    const [rawTag, ...params] = part.trim().split(";").map((s) => s.trim());
    const tag = (rawTag ?? "").toLowerCase();
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key === "q") {
        const parsed = Number(value);
        q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
      }
    }
    return { tag, q, index };
  }).filter((r) => r.tag !== "");
}

/** The language SUBTAG only — "es-mx" and "es" both read as "es", "*" reads
 *  as "*" (never a locale, so it can never win). */
function languageOf(tag: string): string {
  return tag.split("-")[0] ?? "";
}

/**
 * Ranked by q descending, ties broken by the ORIGINAL list order (a stable
 * sort — Array.prototype.sort is stable per spec since ES2019, and this repo
 * targets a modern enough runtime that nothing here re-sorts by hand). The
 * first ranked range whose language is "es" or "en" decides; everything else
 * (French, the "*" wildcard, a header with no es/en range at all) defers to
 * the next range, and an empty result defaults to English — the signed-out
 * screens' own existing default before this file existed.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "en";
  const ranked = parseRanges(header).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const r of ranked) {
    const lang = languageOf(r.tag);
    if (lang === "es" || lang === "en") return lang;
  }
  return "en";
}

/**
 * G8: the root layout's own locale helper, unit-tested directly rather than
 * through the (async, Clerk-reading) layout component itself. `sessionLocale`
 * is the person's own resolved locale when signed in, `null` when nobody is
 * — the root layout is the one caller that decides which of those two it is
 * and passes the right one in; this function makes no such decision itself.
 */
export function resolveRootLang(
  sessionLocale: Locale | null,
  acceptLanguageHeader: string | null | undefined,
): Locale {
  if (sessionLocale) return sessionLocale;
  return localeFromAcceptLanguage(acceptLanguageHeader);
}

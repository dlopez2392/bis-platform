import { m, type MessageKey } from "@/lib/messages";
import { t, plural, type PluralKey } from "@/lib/i18n/t";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";

type Params = Record<string, string | number>;

/** The record page's server strings: `t`/`plural`, plus the QA pseudo-locale (dashboard/page.tsx's `p()`). */
export type Tr = {
  locale: Locale;
  text: (key: MessageKey, params?: Params) => string;
  count: (key: PluralKey<typeof m>, n: number, params?: Params) => string;
};

export function makeTr(locale: Locale, pseudo = false): Tr {
  const wrap = (s: string) => (pseudo ? pseudoLocale(s) : s);
  return {
    locale,
    text: (key, params) => wrap(t(m, key, locale, params)),
    count: (key, n, params) => wrap(plural(m, key, n, locale, { count: n, ...params })),
  };
}

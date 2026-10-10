"use client";
import { createContext, useContext } from "react";
import type { Locale } from "@/lib/i18n/locale";

const LocaleContext = createContext<Locale>("en");

/** Seeded once from the server's already-resolved value (requestLocale) —
 *  no localStorage, no cookie, no client-only signal to disagree with the
 *  server about. Mis preferencias (F-096, later) is where a REAL client-
 *  side toggle and its own cookie would be added; this lane has none. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** Outside a `LocaleProvider` (no account-scoped layout above it in the
 *  tree) this returns the context's default, `"en"` — never a throw. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

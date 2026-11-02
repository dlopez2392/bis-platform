"use client";

import { useEffect } from "react";
import { createDocumentLang } from "@/lib/i18n/document-lang";

/**
 * S-10 T9b: one claim on the document's <html lang> (lib/i18n/document-lang.ts
 * decides which claim wins and why). Renders nothing. The shell mounts one
 * with the reader's resolved locale (dashboard/layout.tsx); every English
 * island mounts one with `island` (components/english-only.tsx).
 *
 * In an effect, not during render: the root layout server-renders "en" and
 * React does not reconcile <html>'s attributes against the DOM on hydration
 * (it carries suppressHydrationWarning, and its `lang` prop never changes),
 * so the attribute set here stands until this component unmounts, when the
 * cleanup gives it back. That cleanup is what keeps a soft navigation out of
 * the dashboard tree (to /no-access, or /sign-in after signing out) from
 * leaving a Spanish <html lang> behind on a page that never asked for one.
 * The server HTML is already right below <html>: the shell and each island
 * carry their own server-rendered `lang`.
 */
const documentLang = createDocumentLang(() =>
  typeof document === "undefined" ? null : document.documentElement,
);

export function DocumentLang({ lang, island = false }: { lang: string; island?: boolean }) {
  useEffect(() => documentLang.claim(lang, island), [lang, island]);
  return null;
}

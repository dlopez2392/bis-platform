"use client";

import { createContext, useContext } from "react";
import type { PublicLocale } from "./public-html";

/**
 * Threads the document's own resolved default language from a `[publicId]`
 * segment's Server Component layout down to its `not-found.tsx`/`error.tsx`
 * boundaries — both of which Next renders with ZERO props (confirmed by
 * reading `next/dist/server/app-render/create-component-tree.js`:
 * `createElement(Component, null)`), so neither can read `params` the way
 * `layout.tsx` does.
 *
 * A Server Component CAN render a Client Component's `<Context.Provider>` —
 * that is the documented, supported shape for crossing the server/client
 * boundary with a value that isn't a prop on the leaf itself, and it is a
 * better fit here than `?locale=` alone: `useSearchParams()` (what both
 * boundaries already use) sees the OVERRIDE a host embed or an email link
 * may carry, but not the document's own default to fall back to when no
 * override is present — before this, a Spanish-default draft form's
 * not-found page still rendered its two lines of English (F-102 review
 * round, fix 3).
 *
 * Defaults to "en" only as the Provider-less case (a component rendered
 * outside any `[publicId]` layout, which should not happen in practice);
 * every real render path sets it explicitly.
 */
const PublicLocaleContext = createContext<PublicLocale>("en");

export function PublicLocaleProvider({
  lang, children,
}: {
  lang: PublicLocale;
  children?: React.ReactNode;
}) {
  return <PublicLocaleContext.Provider value={lang}>{children}</PublicLocaleContext.Provider>;
}

/** The document's own default language, as the nearest `[publicId]` layout
 *  resolved it (including its own "fell back to en because the read failed"
 *  case) — callers still let an explicit `?locale=` outrank this. */
export function usePublicLocaleDefault(): PublicLocale {
  return useContext(PublicLocaleContext);
}

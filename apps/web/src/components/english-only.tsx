import { DocumentLang } from "@/components/document-lang";

/**
 * S-10 T9b: an English island. Owner decision Q4 (2026-10-31): the agency's
 * own screens (its top-level pages, and Settings, Setup, Checklist, Voice and
 * Automations inside an account) stay English and carry lang="en", while the
 * shell around them reads the person's own language (a staff member can pick
 * Español on Mis preferencias). Without this, a Spanish-speaking operator's
 * <html lang="es"> and the shell's own lang would mislabel every English word
 * on those pages for a screen reader and for the browser's translate offer.
 *
 * Two halves, both needed:
 *  - the wrapper's server-rendered lang="en", so the HTML is right before any
 *    script runs;
 *  - an island claim on the document (document-lang.ts), so what the page
 *    portals into <body> (its dialogs, menus and toasts, which sit OUTSIDE
 *    this wrapper) inherits "en" from <html> as well.
 *
 * Parts of these pages that DO follow the operator's language (the trade
 * card, the AI card, Voice's disclosure copy, …) carry their own
 * lang={locale}. Rendered INLINE, that outranks this wrapper's, because it is
 * the nearer ancestor. PORTALLED content does not sit inside this wrapper at
 * all: it inherits <html lang>, which this island has made "en", so any
 * dialog, menu or select list in the operator's language must carry its own
 * lang (the AI card's confirm dialog, Voice's services kind list; review M-2).
 * And a page that is the operator's language end to end does not go in an
 * island at all (agency-only-lang.test.ts's NOT_ENGLISH).
 */
export function EnglishOnly({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en" data-english-only="">
      <DocumentLang lang="en" island />
      {children}
    </div>
  );
}

/** The same island as a segment layout: `export { EnglishOnlyLayout as default }`
 *  in an agency-only route's layout.tsx covers its page, loading.tsx and
 *  error UI together (agency-only-lang.test.ts checks every such route). */
export function EnglishOnlyLayout({ children }: { children: React.ReactNode }) {
  return <EnglishOnly>{children}</EnglishOnly>;
}

/**
 * S-10 T9b: who decides the signed-in <html lang>.
 *
 * The root layout (app/(dashboard)/layout.tsx) renders <html lang="en"> and
 * makes NO session, account or preference read to decide it: it wraps
 * /sign-in, /no-access and every path outside the proxy matcher, where a bare
 * auth() throws (layout.test.ts, whose readers all throw). The language is
 * known one level down, in dashboard/layout.tsx, which already resolves it for
 * the shell. A layout cannot set an attribute on an ancestor while rendering,
 * so the shell (and each English island inside it) CLAIMS the document's
 * language from the browser instead, through components/document-lang.tsx,
 * and this store decides which claim wins:
 *
 *  - an English island (an agency-only page, owner decision Q4 of
 *    2026-10-31) outranks the shell, so a Spanish-speaking operator's
 *    agency-only page reads lang="en" at the document level too, which is
 *    what its portalled dialogs and menus inherit;
 *  - otherwise the shell's resolved locale;
 *  - with no claim at all (the dashboard tree unmounted by a soft navigation
 *    to /no-access or /sign-in), the root layout's own server value.
 *
 * Claims are keyed by identity, never by language, so releasing one of two
 * identical claims leaves the other standing.
 */

/** What the root layout server-renders on <html>, and so what the document returns to. */
export const ROOT_DOCUMENT_LANG = "en";

export type DocumentLangClaim = { lang: string; island: boolean };

export function resolveDocumentLang(claims: Iterable<DocumentLangClaim>): string {
  let shell: string | null = null;
  let island: string | null = null;
  for (const c of claims) {
    if (c.island) island = c.lang;
    else shell = c.lang;
  }
  return island ?? shell ?? ROOT_DOCUMENT_LANG;
}

/** `target` is read on every change, so a store created at module scope in a
 *  server render (no `document`) simply writes nothing. */
export function createDocumentLang(target: () => { lang: string } | null) {
  const claims = new Map<symbol, DocumentLangClaim>();
  const apply = () => {
    const el = target();
    if (el) el.lang = resolveDocumentLang(claims.values());
  };
  return {
    /** Returns the release function: the shape a React effect's cleanup wants. */
    claim(lang: string, island: boolean): () => void {
      const id = Symbol("document-lang");
      claims.set(id, { lang, island });
      apply();
      return () => {
        claims.delete(id);
        apply();
      };
    },
  };
}

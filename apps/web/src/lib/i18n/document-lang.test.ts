// S-10 T9b: the signed-in <html lang>. The root layout renders lang="en" and
// reads nothing to decide it (layout.test.ts); the dashboard shell and every
// English island then CLAIM the document's language from the browser, and
// this store decides which claim wins. Pure, so it is tested without a DOM.
import { describe, it, expect } from "vitest";
import { createDocumentLang, resolveDocumentLang, ROOT_DOCUMENT_LANG } from "./document-lang";

describe("resolveDocumentLang", () => {
  it("is the root layout's own value when nothing claims the document", () => {
    expect(ROOT_DOCUMENT_LANG).toBe("en");
    expect(resolveDocumentLang([])).toBe("en");
  });

  it("is the shell's locale when only the shell claims it", () => {
    expect(resolveDocumentLang([{ lang: "es", island: false }])).toBe("es");
  });

  it("lets an English island outrank the shell, whichever mounted first (mutation: last claim wins regardless of kind -> FAILS)", () => {
    // React runs a child's effect BEFORE its parent's, so on a first load the
    // agency-only page's island claims the document before the shell does.
    expect(resolveDocumentLang([{ lang: "en", island: true }, { lang: "es", island: false }])).toBe("en");
    expect(resolveDocumentLang([{ lang: "es", island: false }, { lang: "en", island: true }])).toBe("en");
  });
});

describe("createDocumentLang", () => {
  it("writes the winning claim to the target and puts the root value back when every claim is released", () => {
    const html = { lang: "en" };
    const doc = createDocumentLang(() => html);
    const releaseShell = doc.claim("es", false);
    expect(html.lang).toBe("es");
    const releaseIsland = doc.claim("en", true);
    expect(html.lang).toBe("en");
    // A soft navigation from an agency-only page back to a client page: the
    // island unmounts, the shell's claim stands again.
    releaseIsland();
    expect(html.lang).toBe("es");
    // Leaving the dashboard tree (to /no-access, say) without a reload: the
    // root layout stays mounted, so the document must return to ITS value.
    releaseShell();
    expect(html.lang).toBe("en");
  });

  it("releases only its own claim, even when two claims carry the same language (mutation: release by language, not by id -> FAILS)", () => {
    const html = { lang: "en" };
    const doc = createDocumentLang(() => html);
    const first = doc.claim("es", false);
    doc.claim("es", false);
    first();
    expect(html.lang).toBe("es");
  });

  it("does nothing when there is no document to write to (a server render)", () => {
    const doc = createDocumentLang(() => null);
    expect(() => doc.claim("es", false)()).not.toThrow();
  });
});

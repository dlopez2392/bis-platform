import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { SubmitButton } from "./submit-button";

/**
 * Review fix round (S-10 T6, I-1): SubmitButton's "Saving..." text read
 * m["common.saving"] directly — English regardless of the reader's own
 * locale. `locale` is an optional prop (default "en", so every other
 * caller of this widely-shared button — 34 files, all agency-only or not
 * yet bilingual — is unaffected); only the client Branding panel passes
 * its own resolved locale.
 */
describe("SubmitButton — Spanish (S-10 T6)", () => {
  it("shows the children text when not pending, in either locale (unaffected)", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: false, locale: "es" } as never, "Guardar"));
    expect(html).toContain("Guardar");
  });

  it("shows 'Guardando...' while pending and locale is es (mutation: hard-code m['common.saving'] → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: true, locale: "es" } as never, "Save"));
    expect(html).toContain(m["common.saving.es"]);
    expect(html).not.toContain(m["common.saving"]);
  });

  it("defaults to English when no locale is given, so every pre-existing caller is unaffected (mutation: default to es → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: true } as never, "Save"));
    expect(html).toContain(m["common.saving"]);
  });
});

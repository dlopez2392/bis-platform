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

// S-10 T9a: calendar's ClosedDaysCard "Agregar días cerrados" button
// clipped the viewport by 6px under the pseudo-locale's +35% padding
// (e2e/spanish-dashboard.spec.ts's own G9 loop, found live) — the Button
// underneath carries `whitespace-nowrap` with no width to wrap against, and
// this is the one caller that needed to override it. `className` is
// additive and optional: every pre-existing caller (34 files) passes none
// and is unaffected.
describe("SubmitButton — className is forwarded onto the Button (S-10 T9a)", () => {
  it("merges an explicit className onto the rendered <button> (mutation: drop the className prop → FAILS)", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitButton, { pending: false, className: "whitespace-normal" } as never, "Save"),
    );
    expect(html).toMatch(/<button[^>]*class="[^"]*\bwhitespace-normal\b/);
  });

  it("with no className, the button renders exactly as before (mutation: force a className unconditionally → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(SubmitButton, { pending: false } as never, "Save"));
    expect(html).not.toContain("whitespace-normal");
  });
});

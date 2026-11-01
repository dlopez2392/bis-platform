import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthShell } from "./auth-shell";

describe("AuthShell — the signed-out frame (spec §4)", () => {
  // A plain paragraph on purpose: the "no navigation" assertion below reads
  // the WHOLE markup, so the children must contribute no links of their own.
  const html = renderToStaticMarkup(
    createElement(AuthShell, null, createElement("p", null, "child content")),
  );

  it("mounts the lit ground — /sign-in never had one", () => {
    expect(html).toContain('data-slot="ground"');
  });

  it("reuses the sidebar's chrome rather than inventing a fifth surface", () => {
    expect(html).toContain("sidebar-chrome");
    // The values belong to globals.css. Restating any of them here is the
    // thing this assertion exists to catch.
    expect(html).not.toContain("backdrop-filter");
    expect(html).not.toContain("--sidebar-ground");
  });

  it("gives the rail the slot the e2e measures", () => {
    expect(html).toContain('data-slot="auth-rail"');
  });

  it("carries the mark and the wordmark, and NO navigation", () => {
    expect(html).toContain('data-slot="bis-mark"');
    expect(html).toContain(">BIS<");
    // A rail full of links nobody can follow is decorative chrome pretending
    // to be structure. The direction mockup drew one; it was rejected.
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<a ");
  });

  it("uses no colour literal — tokens only", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/);
  });

  it("renders its children", () => {
    expect(html).toContain("child content");
  });
});

// S-10 T7 (spec §6 T7, §7 Q5): the rail's own copy ("by Bespoke Intelligent
// Solutions") follows the resolved locale, same as every signed-out page's
// own text — the browser's language, since nobody is authenticated here.
describe("AuthShell in Spanish", () => {
  it("defaults to English when no locale is passed (every existing call site above is unaffected)", () => {
    const en = renderToStaticMarkup(
      createElement(AuthShell, null, createElement("p", null, "child content")),
    );
    expect(en).toContain("by Bespoke Intelligent Solutions");
  });

  it("renders the rail copy in Spanish and wraps the shell in lang={locale} (mutation: leave railCopy as m[...] → FAILS)", () => {
    const es = renderToStaticMarkup(
      createElement(AuthShell, { locale: "es" } as never, createElement("p", null, "child content")),
    );
    expect(es).toContain("por Bespoke Intelligent Solutions");
    expect(es).toContain('lang="es"');
  });
});


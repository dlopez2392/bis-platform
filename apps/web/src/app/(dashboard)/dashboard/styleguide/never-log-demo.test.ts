import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { NeverLogDemo } = await import("./never-log-demo");

describe("styleguide: the Never record list (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(NeverLogDemo));

  it("loaded (English and Spanish), empty and error (mutation: drop a state → FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-never-log"');
    expect(html.match(/data-never-log=""/g)).toHaveLength(4);
    expect(html.match(/data-never-log-entry=/g)).toHaveLength(4); // two entries, in English and in Spanish
    expect(html.match(/data-never-log-empty=""/g)).toHaveLength(1);
    expect(html.match(/data-never-log-error=""/g)).toHaveLength(1);
    expect(renderedText(html)).toContain("Mail from addresses or domains you add here is never saved.");
  });

  it("the Spanish box is the Spanish catalogue's, under lang=es (mutation: render it in English → FAILS)", () => {
    const es = html.slice(html.indexOf('lang="es"'));
    expect(renderedText(es.slice(0, es.indexOf("data-never-log-empty")))).toContain("Todo el dominio");
    expect(renderedText(es.slice(0, es.indexOf("data-never-log-empty")))).toContain("No registrar nunca");
  });

  it("is on the styleguide page, under the list's own title (mutation: drop the line → FAILS)", () => {
    const page = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/import \{ NeverLogDemo \} from "\.\/never-log-demo";/);
    expect(page).toMatch(/<Section title=\{t\(m, "neverLog\.title", "en"\)\}[^>]*>\s*<NeverLogDemo \/>/);
  });
});

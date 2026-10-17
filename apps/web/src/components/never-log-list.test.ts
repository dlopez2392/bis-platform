import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { NeverLogList } from "./never-log-list";

const ENTRIES = [{ id: "n1", pattern: "billing@supplier.com", kind: "address" as const }, { id: "n2", pattern: "supplier.com", kind: "domain" as const }];
const html = (entries: typeof ENTRIES | null, locale: "en" | "es" = "en") => renderToStaticMarkup(createElement(NeverLogList, {
  entries, locale, idPrefix: "t", add: async () => ({ ok: false as const, error: "failed" as const }), remove: async () => ({ ok: false as const, error: "failed" as const }),
}));

describe("NeverLogList (spec 'The Never record list'; rule 5's three states)", () => {
  it("loaded: each entry with its kind in words and its Remove, ghost buttons only, lang set (mutation: drop lang → FAILS; a default-variant Add → a second primary, FAILS)", () => {
    const h = html(ENTRIES);
    expect(h).toContain('data-never-log=""');
    expect(h).toContain('lang="en"');
    expect(h).toContain('data-never-log-entry="billing@supplier.com"');
    expect(h).toContain('data-never-log-entry="supplier.com"');
    const text = renderedText(h);
    expect(text).toContain("Never record");
    expect(text).toContain("Whole domain");
    expect(text).toContain("Address or domain");
    expect(h).toContain('aria-label="Remove supplier.com"');
    expect(h).not.toMatch(/data-variant="default"/);
  });

  it("empty: the sentence that sells it, and the input (mutation: render the empty line when entries exist → FAILS)", () => {
    expect(renderedText(html([]))).toContain("Mail from addresses or domains you add here is never saved.");
    expect(html([])).toContain("<input");
    expect(html(ENTRIES)).not.toContain("data-never-log-empty");
  });

  it("error: the load-failed line and no input (mutation: show an empty list on a failed read → FAILS)", () => {
    const h = html(null);
    expect(h).toContain("data-never-log-error");
    expect(h).not.toContain("data-never-log-empty");
    expect(renderedText(h)).toContain("We couldn't load this list. Reload the page to try again.");
    expect(h).not.toContain("<input");
  });

  it("Spanish, end to end (mutation: one key read in English → FAILS)", () => {
    const text = renderedText(html(ENTRIES, "es"));
    expect(html(ENTRIES, "es")).toContain('lang="es"');
    for (const s of ["No registrar nunca", "Todo el dominio", "Dirección o dominio", "Agregar", "Quitar"]) expect(text, s).toContain(s);
    expect(html(ENTRIES, "es")).toContain('aria-label="Quitar supplier.com"');
    expect(renderedText(html([], "es"))).toContain("El correo de las direcciones o dominios que agregue aquí nunca se guarda.");
    expect(renderedText(html(null, "es"))).toContain("No pudimos cargar esta lista. Vuelva a cargar la página para intentarlo de nuevo.");
  });

  it("tokens only: no hex, no literal radius or shadow (mutation: text-[#c00] → FAILS)", () => {
    const h = html(ENTRIES) + html(null);
    expect(h).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(h).not.toMatch(/rounded-\[(?!var\()/);
    expect(h).not.toMatch(/shadow-\[(?!var\()/);
  });
});

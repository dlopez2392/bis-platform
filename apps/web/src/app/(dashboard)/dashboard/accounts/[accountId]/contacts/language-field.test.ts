import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ setContactLanguageAction: vi.fn(), restoreContactLanguageAction: vi.fn(), keepContactLanguageHintAction: vi.fn() }));
vi.mock("@/components/locale-provider", () => ({ useLocale: () => "en" }));
const { LanguageField } = await import("./language-field");

const SET = { value: "es" as const, valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null };
const render = (view: Parameters<typeof LanguageField>[0]["view"]) =>
  renderToStaticMarkup(createElement(LanguageField, { accountId: "a1", contactId: "c1", view, onChanged: () => {} }));

describe("LanguageField (S-09 §8.2)", () => {
  it("set: a labelled row in the 92px column, the endonym in its own lang, then the phrase (mutation: drop lang on the endonym -> FAILS)", () => {
    const html = render(SET);
    expect(html).toMatch(/data-language-row="" data-language="es"/);
    expect(html).toContain("grid-cols-[92px_minmax(0,1fr)]");
    expect(html).toMatch(/<dt[^>]*>Language<\/dt>/);
    expect(html).toMatch(/<span lang="es">Español<\/span>/);
    expect(html).toMatch(/data-language-phrase="">from their booking \(Oct 3\)</);
  });

  it("not set: the Choose placeholder and the whole Not set sentence; no hint", () => {
    const html = render({ value: null, valueLabel: null, phrase: "Not set. Messages go out in English.", hint: null });
    expect(html).toMatch(/data-language=""/);
    expect(html).toContain("Choose");
    expect(html).toContain("Not set. Messages go out in English.");
    expect(html).not.toContain("data-language-hint");
  });

  it("the hint: its sentence and two GHOST buttons, never a primary (rule 8; mutation: variant default -> FAILS)", () => {
    const html = render({ ...SET, hint: { language: "en", text: "Spoke English on the last call. Switch to English?" } });
    const hint = html.slice(html.indexOf("data-language-hint"));
    expect(hint).toContain("Spoke English on the last call. Switch to English?");
    expect(hint.match(/data-variant="ghost"/g)).toHaveLength(2);
    expect(hint).not.toContain('data-variant="default"');
    expect(hint).toMatch(/>Switch<\/button>/);
    expect(hint).toMatch(/>Keep<\/button>/);
  });

  it("every control is a real tap target with a visible focus ring (DESIGN.md DoD; mutation: drop focus-visible:ring -> FAILS)", () => {
    const html = render({ ...SET, hint: { language: "en", text: "x" } });
    for (const el of html.match(/<button[^>]*>/g) ?? []) {
      expect(el).toContain("min-h-11");
      expect(el).toContain("focus-visible:ring");
    }
    const trigger = html.match(/<button[^>]*role="combobox"[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain("focus-visible:ring");
  });

  // review I1: swapping <SelectValue> for a plain <span> breaks Radix's own positioning (it needs
  // the real valueNode to measure against, select.tsx:56's default / @radix-ui/react-select's
  // SelectContentImpl) and its focus wiring — SelectValue must stay mounted in BOTH states.
  it("SelectValue stays mounted set or not (mutation: swap it for a bare span -> FAILS)", () => {
    for (const view of [SET, { value: null, valueLabel: null, phrase: "Not set. Messages go out in English.", hint: null }]) {
      const html = render(view);
      expect(html).toContain('data-slot="select-value"');
    }
  });
});

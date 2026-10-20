import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DisclosureResultsView, DisclosureResultsSkeleton } from "./disclosure-results-view";
import type { DisclosureResultsView as ResultsView } from "@/lib/voice/disclosure-results";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

const LOADED: ResultsView = {
  state: "loaded",
  said: { counted: 8, bookedPct: 38, hungUpPct: 13, askedPersonPct: 25 },
  didnt: { counted: 3, bookedPct: 33, hungUpPct: 33, askedPersonPct: 0 },
  notEnough: true,
  notCounted: 2,
};

function html(view: ResultsView | { state: "error" }, locale: "en" | "es" = "en"): string {
  return renderToStaticMarkup(
    createElement(DisclosureResultsView, { view, tr: makeTr(locale), accountId: "acct-1" }),
  );
}

function cell(out: string, half: "said" | "didnt", name: string): string {
  const re = new RegExp(`data-half="${half}"[\\s\\S]*?data-cell="${name}"[^>]*>([^<]*)<`);
  const match = re.exec(out);
  if (!match) throw new Error(`cell ${half}/${name} not found in: ${out}`);
  return renderedText(match[1]!);
}

describe("DisclosureResultsView — loaded, English", () => {
  const out = html(LOADED);

  it("renders each cell's exact text (mutation: render hungUpPct in the askedPerson cell → FAILS)", () => {
    expect(cell(out, "said", "counted")).toBe("8");
    expect(cell(out, "said", "booked")).toBe("38%");
    expect(cell(out, "said", "hungUp")).toBe("13%");
    expect(cell(out, "said", "askedPerson")).toBe("25%");
    expect(cell(out, "didnt", "counted")).toBe("3");
    expect(cell(out, "didnt", "booked")).toBe("33%");
    expect(cell(out, "didnt", "hungUp")).toBe("33%");
    expect(cell(out, "didnt", "askedPerson")).toBe("0%");
  });

  it("renders the labels, the not-enough line and the footnote", () => {
    const text = renderedText(out);
    expect(text).toContain("Calls counted");
    expect(text).toContain("Booked");
    expect(text).toContain("Hung up early");
    expect(text).toContain("Asked for a person");
    expect(text).toContain("Not enough calls yet to tell.");
    expect(text).toContain("2 calls not counted (spam, or outside the trial)");
  });
});

describe("DisclosureResultsView — loaded, Spanish", () => {
  const out = html(LOADED, "es");

  it("renders Spanish labels, percent spacing and lang=es", () => {
    const text = renderedText(out);
    expect(text).toContain("Dijo que era IA");
    expect(text).toContain("Pidieron hablar con una persona");
    expect(cell(out, "said", "booked")).toBe("38 %");
    expect(text).toContain("Todavía no hay suficientes llamadas para saberlo.");
    expect(text).toContain("2 llamadas no contadas (spam, o fuera de la prueba)");
    expect(out).toContain('lang="es"');
  });
});

describe("DisclosureResultsView — notEnough false, notCounted singular", () => {
  it("omits the not-enough line, and the footnote is singular (mutation: render the not-enough line unconditionally → FAILS)", () => {
    const text = renderedText(html({ ...LOADED, notEnough: false, notCounted: 1 }));
    expect(text).not.toContain("Not enough calls yet to tell.");
    expect(text).toContain("1 call not counted (spam, or outside the trial)");
  });
});

describe("DisclosureResultsView — a half with no counted calls", () => {
  it("shows 'No calls yet', never 0%", () => {
    const out = html({
      state: "loaded",
      said: { counted: 2, bookedPct: 1, hungUpPct: 0, askedPersonPct: 0 },
      didnt: { counted: 0, bookedPct: null, hungUpPct: null, askedPersonPct: null },
      notEnough: true,
      notCounted: 0,
    });
    expect(cell(out, "didnt", "booked")).toBe("No calls yet");
    expect(cell(out, "didnt", "hungUp")).toBe("No calls yet");
    expect(cell(out, "didnt", "askedPerson")).toBe("No calls yet");
  });
});

describe("DisclosureResultsView — empty", () => {
  it("no numbers, just the two sentences", () => {
    const text = renderedText(html({ state: "empty" }));
    expect(text).toContain("No calls since the trial started.");
    expect(text).toContain("Choose Trial above and save.");
    expect(text).not.toMatch(/\d%/);
  });
});

describe("DisclosureResultsView — error", () => {
  it("the error sentence and one ghost Retry link", () => {
    const out = html({ state: "error" });
    const text = renderedText(out);
    expect(text).toContain("Couldn't load how calls went.");
    expect(out).toMatch(/<a[^>]*href="\/dashboard\/accounts\/acct-1\/voice"[^>]*>Retry<\/a>/);
  });
});

describe("DisclosureResultsView — never declares a winner, never a hero", () => {
  it("in every state: no data-hero, no primary button, no comparative verdict (mutation: add a primary button → FAILS)", () => {
    for (const view of [LOADED, { state: "empty" as const }, { state: "error" as const }]) {
      const out = html(view);
      expect(out).not.toContain("data-hero");
      expect(out).not.toMatch(/data-variant="default"/);
      expect(out).not.toContain("btn-primary");
      expect(renderedText(out)).not.toMatch(/better|worse|winner|won|lost/i);
    }
  });
});

describe("DisclosureResultsSkeleton", () => {
  it("renders a card shaped like the loaded content, aria-busy", () => {
    const out = renderToStaticMarkup(createElement(DisclosureResultsSkeleton));
    expect(out).toContain('aria-busy="true"');
    expect(out).toMatch(/data-slot="skeleton"/);
  });
});

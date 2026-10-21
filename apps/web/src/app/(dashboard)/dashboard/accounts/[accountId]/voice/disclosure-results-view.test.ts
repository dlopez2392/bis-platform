import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DisclosureResultsView, DisclosureResultsSkeleton } from "./disclosure-results-view";
import type { DisclosureResultsView as ResultsView } from "@/lib/voice/disclosure-results";
import type { DisclosureSetting } from "@bis/db";
import { makeTr } from "@/lib/record/copy";
import { renderedText } from "@/lib/rendered-text";

const LOADED: ResultsView = {
  state: "loaded",
  said: { counted: 8, bookedPct: 38, hungUpPct: 13, askedPersonPct: 25 },
  didnt: { counted: 3, bookedPct: 33, hungUpPct: 33, askedPersonPct: 0 },
  notEnough: true,
  notCounted: 2,
};

const RETRY = "/dashboard/accounts/acct-1/voice?from=setup&locale=es";

function html(
  view: ResultsView | { state: "error" }, locale: "en" | "es" = "en", setting: DisclosureSetting = "trial",
): string {
  return renderToStaticMarkup(
    createElement(DisclosureResultsView, { view, tr: makeTr(locale), setting, retryHref: RETRY }),
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

describe("DisclosureResultsView — empty, by the STORED setting", () => {
  it("on Trial: calls are counted as they end, and no Choose-Trial action (mutation: ignore the setting -> FAILS)", () => {
    const text = renderedText(html({ state: "empty", notCounted: 0 }, "en", "trial"));
    expect(text).toContain("No calls since the trial started.");
    expect(text).toContain("Each Trial call is counted here once it ends.");
    expect(text).not.toContain("Choose Trial above and save.");
    expect(text).not.toMatch(/\d%/);
  });

  it("on Trial, Spanish: usted", () => {
    const text = renderedText(html({ state: "empty", notCounted: 0 }, "es", "trial"));
    expect(text).toContain("No hay llamadas desde que empezó la prueba.");
    expect(text).toContain("Cada llamada de Prueba se cuenta aquí cuando termina.");
  });

  for (const setting of ["off", "on"] as const) {
    it(`on ${setting}: what appears here and the action, never "since the trial started" (mutation: render the Trial sentences -> FAILS)`, () => {
      const text = renderedText(html({ state: "empty", notCounted: 0 }, "en", setting));
      expect(text).toContain("Once a trial runs, how calls went with and without saying it's an AI shows here.");
      expect(text).toContain("Choose Trial above and save.");
      expect(text).not.toContain("since the trial started");
      expect(text).not.toContain("Each Trial call is counted here once it ends.");
    });
  }

  it("on Off, Spanish: usted", () => {
    const text = renderedText(html({ state: "empty", notCounted: 0 }, "es", "off"));
    expect(text).toContain("Cuando haga una prueba, aquí verá cómo fueron las llamadas al decir que es una IA y al no decirlo.");
    expect(text).toContain("Elija Prueba arriba y guarde.");
  });

  it("the footnote renders in the empty state too, so an On line sees its calls were not counted (mutation: drop the footnote from the empty branch -> FAILS)", () => {
    expect(renderedText(html({ state: "empty", notCounted: 4 }, "en", "on"))).toContain("4 calls not counted (spam, or outside the trial)");
    expect(renderedText(html({ state: "empty", notCounted: 1 }, "es", "on"))).toContain("1 llamada no contada (spam, o fuera de la prueba)");
    expect(renderedText(html({ state: "empty", notCounted: 0 }, "en", "on"))).not.toContain("not counted");
  });
});

describe("DisclosureResultsView — error", () => {
  it("the error sentence and one ghost Retry link", () => {
    const out = html({ state: "error" });
    const text = renderedText(out);
    expect(text).toContain("Couldn't load how calls went.");
    // Fix round: Retry keeps the page's own query (?from=, ?locale=) — mutation: drop the query -> FAILS.
    expect(out).toMatch(/<a[^>]*href="\/dashboard\/accounts\/acct-1\/voice\?from=setup&amp;locale=es"[^>]*>Retry<\/a>/);
  });
});

describe("DisclosureResultsView — never declares a winner, never a hero", () => {
  it("in every state: no data-hero, no primary button, no comparative verdict (mutation: add a primary button → FAILS)", () => {
    for (const view of [LOADED, { state: "empty" as const, notCounted: 3 }, { state: "error" as const }]) {
      const out = html(view);
      expect(out).not.toContain("data-hero");
      expect(out).not.toMatch(/data-variant="default"/);
      expect(out).not.toContain("btn-primary");
      expect(renderedText(out)).not.toMatch(/better|worse|winner|won|lost/i);
    }
  });
});

describe("DisclosureResultsView — one column on a phone (fix round: the styleguide ran 19px past a 375px viewport)", () => {
  it("the halves stack below sm and sit side by side from sm up, loaded and skeleton alike (mutation: back to grid-cols-2 -> FAILS)", () => {
    expect(html(LOADED)).toContain('class="grid grid-cols-1 gap-4 sm:grid-cols-2"');
    const sk = renderToStaticMarkup(createElement(DisclosureResultsSkeleton));
    expect(sk).toMatch(/class="[^"]*grid grid-cols-1 gap-4 sm:grid-cols-2/);
    expect(sk).not.toMatch(/(^|[" ])grid-cols-2/);
  });
});

describe("DisclosureResultsSkeleton", () => {
  it("renders a card shaped like the loaded content, aria-busy", () => {
    const out = renderToStaticMarkup(createElement(DisclosureResultsSkeleton));
    expect(out).toContain('aria-busy="true"');
    expect(out).toMatch(/data-slot="skeleton"/);
  });
});

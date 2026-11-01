import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { LogStatusPill } from "./log-status-pill";

/**
 * LogStatusPill is a thin wrapper over the shared DotPill since the design
 * follow-ups (2026-09-23). What the wrapper itself decides: the treatment,
 * the ROOMY padding (the history table has no plain badge beside it to
 * match), and the `data-status` its rows are addressed by.
 */
describe("LogStatusPill", () => {
  it.each(["sent", "held", "skipped", "failed"] as const)("%s: its own treatment, the roomy padding and data-status", (status) => {
    // Mutation: render the DotPill `dense` → reds BY NAME on all four.
    const html = renderToStaticMarkup(createElement(LogStatusPill, { status }));
    const tag = html.match(/^<span[^>]*>/)![0];
    for (const cls of ["py-1", "pr-2.5", "pl-2"]) expect(tag).toContain(cls);
    for (const cls of STATUS_TREATMENTS[status].chip.split(" ")) expect(tag).toContain(cls);
    expect(tag).toContain(`data-status="${status}"`);
    expect(html).toContain(STATUS_TREATMENTS[status].dot);
    expect(html).toContain(`</span>${STATUS_TREATMENTS[status].label}</span>`);
  });
});

// S-10 fix round I5: the Spanish word had no render test of its own; a pill
// back on STATUS_TREATMENTS[status].label (English, built at load) stayed green.
describe("LogStatusPill — the reader's language", () => {
  it("reads 'Omitido' for a skipped row under es (mutation: label={treatment.label} → FAILS)", () => {
    const text = renderedText(renderToStaticMarkup(createElement(LogStatusPill, { status: "skipped", locale: "es" })));
    expect(text).toContain(m["activity.status.skipped.es"]);
    expect(text).toContain("Omitido");
    expect(text).not.toContain(STATUS_TREATMENTS.skipped.label);
  });

  it("wears the pseudo-locale under the QA override (mutation: ignore pseudo → FAILS)", () => {
    const text = renderedText(renderToStaticMarkup(createElement(LogStatusPill, { status: "skipped", locale: "en", pseudo: true })));
    expect(text).toContain(pseudoLocale(STATUS_TREATMENTS.skipped.label));
  });
});

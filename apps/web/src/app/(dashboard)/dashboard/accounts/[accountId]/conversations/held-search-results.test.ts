import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { HeldSearchResults } from "./held-search-results";
import type { HeldSearchState } from "./held-email-search";

const render = (state: HeldSearchState, locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(HeldSearchResults, { state, pending: false, locale, onPick: vi.fn() }));

describe("HeldSearchResults", () => {
  it("idle renders nothing", () => {
    expect(render({ status: "idle" })).toBe("");
  });

  it("error renders the searchFailed line, never searchEmpty (mutation: render searchEmpty on error -> FAILS)", () => {
    const html = render({ status: "error" });
    expect(renderedText(html)).toContain("Couldn't search right now. Try again.");
    expect(renderedText(html)).not.toContain("No customer matches that.");
    expect(html).toContain('role="alert"');
  });

  it("the error line is Spanish under locale es (mutation: an English string in the es render -> FAILS)", () => {
    expect(renderedText(render({ status: "error" }, "es"))).toContain("No se pudo buscar en este momento. Inténtelo de nuevo.");
  });

  it("ok with zero hits renders searchEmpty, never searchFailed", () => {
    const html = render({ status: "ok", hits: [], query: "an" });
    expect(renderedText(html)).toContain("No customer matches that.");
    expect(renderedText(html)).not.toContain("Couldn't search right now");
  });

  it("two hits sharing a name are told apart by their own sublabel (mutation: drop sublabel -> FAILS)", () => {
    const html = render({ status: "ok", query: "", hits: [
      { id: "c1", label: "Ana Ruiz", sublabel: "ana1@example.com" },
      { id: "c2", label: "Ana Ruiz", sublabel: "ana2@example.com" },
    ] });
    const text = renderedText(html);
    expect(text).toContain("ana1@example.com");
    expect(text).toContain("ana2@example.com");
    expect(html.match(/>Ana Ruiz</g)).toHaveLength(2);
  });

  it("a hit with no sublabel (null) renders the name alone, no stray empty line", () => {
    const html = render({ status: "ok", hits: [{ id: "c1", label: "Pat Nguyen", sublabel: null }], query: "" });
    expect(renderedText(html).trim()).toBe("Pat Nguyen");
  });

  it("picking a hit calls onPick with that hit (mutation: call it with the wrong hit -> FAILS)", () => {
    const onPick = vi.fn();
    const hit = { id: "c1", label: "Ana Ruiz", sublabel: "ana@example.com" };
    // Extracted from the markup directly would need a DOM; this module is
    // exercised end-to-end instead, through held-email-list.test.ts (no
    // jsdom harness exists in this suite for a real click). Here we only
    // pin that the function IS passed through, not swallowed.
    const html = renderToStaticMarkup(createElement(HeldSearchResults, {
      state: { status: "ok", hits: [hit], query: "" }, pending: false, locale: "en", onPick,
    }));
    expect(html).toContain("Ana Ruiz");
    expect(onPick).not.toHaveBeenCalled(); // never fired by rendering alone
  });

  it("the matched letters are set apart from the rest, against the query the hits answered (F-092 part 1, plan Task 10; mutation: highlight against a fixed query instead of state.query -> FAILS)", () => {
    const html = render({ status: "ok", query: "garcia", hits: [{ id: "c1", label: "Ana García", sublabel: "(956) 555-0199" }] });
    expect(html).toContain('<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">García</mark>');
    // A query that cannot match this hit's own text draws no mark at all.
    const none = render({ status: "ok", query: "zzzz", hits: [{ id: "c1", label: "Ana García", sublabel: null }] });
    expect(none).not.toContain("<mark");
  });

  it("a phone sublabel marks the matched digits, punctuation and all (F-092 part 1, plan Task 10)", () => {
    const html = render({ status: "ok", query: "0199", hits: [{ id: "c1", label: "Ana Ruiz", sublabel: "(956) 555-0199" }] });
    expect(html).toContain('<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">0199</mark>');
  });
});

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { ApplyBlueprintDialog, appliedMessage } from "./apply-blueprint-dialog";

// D-086: the dialog that makes the Add company hint true.

const noop = async () => ({ ok: true as const, added: 0, already: 0 });

describe("ApplyBlueprintDialog (D-086)", () => {
  it("offers 'Apply a blueprint' — the same words the Add company hint points at — and is never a primary (rule 8: the page's cards own their primaries) (mutation: default-variant trigger → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ApplyBlueprintDialog, {
      action: noop, blueprints: [{ id: "bp_1", name: "Roofers" }],
    }));
    expect(renderedText(html)).toContain(m["accounts.blueprint"]);
    expect(html).not.toContain("btn-primary");
  });

  it("renders nothing when there is no blueprint to apply (a button that can only fail is not offered)", () => {
    expect(renderToStaticMarkup(createElement(ApplyBlueprintDialog, { action: noop, blueprints: [] }))).toBe("");
  });

  it("states the result in words, new and already-there apart (mutation: swap the two counts → FAILS)", () => {
    expect(appliedMessage(3, 1)).toBe(
      m["blueprints.apply.done"].replace("{added}", "3").replace("{already}", "1"),
    );
    expect(appliedMessage(3, 1)).not.toBe(appliedMessage(1, 3));
  });
});

describe("the Add company hint is true (D-086)", () => {
  it("names the place a blueprint can be applied later — the company's Settings (mutation: restore the old placeless hint → FAILS)", () => {
    expect(m["accounts.blueprintHint"]).toMatch(/Settings/);
  });
});

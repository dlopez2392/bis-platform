import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { renderedText } from "@/lib/rendered-text";

const { SurfaceStateStates } = await import("./surface-state-states");

describe("styleguide: the five surface states (F-088 PR 2)", () => {
  const html = renderToStaticMarkup(createElement(SurfaceStateStates));
  it("shows every state in English, Spanish and the pseudo-locale (mutation: drop a state -> FAILS)", () => {
    for (const state of ["live", "needs_setup", "waiting", "bigger_plan", "absent"]) {
      expect(html.match(new RegExp(`data-surface-state="${state}"`, "g"))).toHaveLength(state === "needs_setup" ? 9 : 3);
    }
    const text = renderedText(html);
    expect(text).toContain(m["surface.state.bigger_plan"]);
    expect(text).toContain(m["surface.state.bigger_plan.es"]);
    expect(text).toContain(pseudoLocale(m["surface.state.bigger_plan"]));
  });
  it("carries no button and no padlock; only the bigger-plan note links", () => {
    expect(html).not.toContain("<button");
    expect(html.match(/<a /g)).toHaveLength(3);
  });
});

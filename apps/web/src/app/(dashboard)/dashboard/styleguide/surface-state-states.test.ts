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
      // Sofía's seven notes plus the three Plan-and-billing rows (bigger plan, chat setup, texting waiting), x 3 columns.
      const expected = ({ needs_setup: 12, waiting: 6, bigger_plan: 6, live: 3, absent: 3 } as Record<string, number>)[state]!;
      expect(html.match(new RegExp(`data-surface-state="${state}"`, "g"))).toHaveLength(expected);
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
  it("shows the Plan and billing row layout (align start) with the chat's and texting's words, in all three columns", () => {
    expect(html.match(/data-surface-rows/g)).toHaveLength(3);
    const text = renderedText(html);
    for (const key of ["surface.chat.setting_up", "surface.texting.carrier_review"] as const) {
      expect(text).toContain(m[key]);
      expect(text).toContain(m[`${key}.es` as const]);
      expect(text).toContain(pseudoLocale(m[key]));
    }
    expect(html).toContain("items-start");
  });
});

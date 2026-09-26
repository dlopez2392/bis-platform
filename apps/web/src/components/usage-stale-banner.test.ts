import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { UsageStaleBanner } = await import("./usage-stale-banner");

const render = (count: number) => renderToStaticMarkup(createElement(UsageStaleBanner, { count }));

describe("UsageStaleBanner", () => {
  it("renders NOTHING at zero, so it clears itself once usage reaches Stripe (mutation: always render → FAILS)", () => {
    expect(render(0)).toBe("");
  });

  it("says ONE client in the singular (mutation: always use the plural string → FAILS)", () => {
    expect(renderedText(render(1))).toContain(m["work.usageStale.one"]);
  });

  it("counts clients in the plural above one (mutation: as above → FAILS)", () => {
    expect(renderedText(render(3))).toContain(m["work.usageStale.many"].replace("{n}", "3"));
  });

  it("says it in WORDS, not by colour alone: the whole visible text is exactly the sentence and the link, nothing more or less (mutation: delete the sentence, keep the tint → FAILS; add or drop any word → FAILS)", () => {
    expect(renderedText(render(2)).replace(/\s+/g, " ").trim())
      .toBe(`${m["work.usageStale.many"].replace("{n}", "2")} ${m["work.usageStale.action"]}`);
  });

  it("links to the Plans page, where a missing or refused Stripe key is explained (mutation: drop or change the href → FAILS)", () => {
    expect(render(2)).toContain('href="/dashboard/plans"');
    expect(renderedText(render(2))).toContain(m["work.usageStale.action"]);
  });
});

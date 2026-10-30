import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { BisAccessDemo } = await import("./bis-access-demo");

/** F-118 part 1 (design review F6): the BIS access kit in English AND Spanish, like forwarding-demo/places-demo. */
describe("styleguide: BIS access in both languages", () => {
  const html = renderToStaticMarkup(createElement(BisAccessDemo));
  /** Everything from the block's marker on: the Spanish pair is rendered after the English set. */
  const from = (id: string) => html.slice(html.indexOf(`data-bis-access-demo="${id}"`));

  it("the Spanish pair sits under lang=es: the tiles and the rows read Spanish (mutation: render the Spanish pair in English -> FAILS)", () => {
    expect(html).toMatch(/<div[^>]*lang="es"[^>]*data-bis-access-demo="es"/);
    const es = renderedText(from("es"));
    expect(es).toContain(m["accessLog.enter.legend.es"]);
    expect(es).toContain(m["accessLog.reason.support.es"]);
    expect(es).toContain("Cliente · María López");
    expect(es).toContain(m["accessLog.summary.nothing.es"]);
  });

  it("the English set is still there, ahead of the Spanish (mutation: drop the English set -> FAILS)", () => {
    const text = renderedText(html);
    expect(text.indexOf(m["accessLog.reason.support"])).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(m["accessLog.reason.support"])).toBeLessThan(text.indexOf(m["accessLog.reason.support.es"]));
  });
});

describe("ReasonTiles: a long label wraps inside its tile (design review F3)", () => {
  it("every tile's label sits in choice-tiles.tsx's own min-w-0 break-words span (mutation: render the bare label -> FAILS)", async () => {
    const { ReasonTiles } = await import("@/components/access-log/reason-tiles");
    const html = renderToStaticMarkup(createElement(ReasonTiles, {
      legend: "Pick one", options: [{ value: "setup", label: "Configuración" }, { value: "fix", label: "Arreglar un problema" }],
    }));
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toMatch(/<span class="min-w-0 break-words">[^<]+<\/span><\/button>/);
  });
});

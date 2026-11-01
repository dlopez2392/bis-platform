import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { PipelineBoard, type BoardColumn } from "./pipeline-board";

/** S-10 T3: the board's empty state and its column's "drop here" line read the reader's language,
 *  through the board's own LocaleProvider (set by the pipeline page). */
const EMPTY: BoardColumn[] = [{ stage: { id: "s1", name: "New", position: 0 }, totalValue: 0, opportunities: [] }];

function render(board: BoardColumn[], locale: "en" | "es") {
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale, children: createElement(PipelineBoard, {
      board, moveAction: vi.fn(async () => {}), updateAction: vi.fn(async () => {}),
    }) }),
  );
}

describe("PipelineBoard in the reader's language (S-10 T3)", () => {
  it("in Spanish, the empty state and the column's drop line read Spanish (mutation: read m[...] directly -> FAILS)", () => {
    const html = render(EMPTY, "es");
    expect(html).toContain(m["pipeline.empty.title.es"]);
    expect(html).toContain(m["pipeline.empty.body.es"]);
    expect(html).toContain(m["pipeline.dropHere.es"]);
    expect(html).not.toContain(m["pipeline.empty.title"]);
  });
  it("in English, nothing changes", () => {
    const html = render(EMPTY, "en");
    expect(html).toContain(m["pipeline.empty.title"]);
    expect(html).toContain(m["pipeline.dropHere"]);
  });
});

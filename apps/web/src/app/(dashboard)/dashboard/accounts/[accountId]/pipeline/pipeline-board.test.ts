import { describe, it, expect, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { contactDisplayName } from "@/lib/format";
import { LocaleProvider } from "@/components/locale-provider";
import { PipelineBoard, type BoardColumn } from "./pipeline-board";

/** S-10 T3: the board's empty state and its column's "drop here" line read the reader's language,
 *  through the board's own LocaleProvider (set by the pipeline page). */
const EMPTY: BoardColumn[] = [{ stage: { id: "s1", name: "New", position: 0 }, totalValue: 0, opportunities: [] }];

/** S-10 leftovers (#317 follow-up): the column total, the card's own monetary value, and the
 *  card's contact name all read m[...]/formatCurrency/contactDisplayName with NO locale, so a
 *  Spanish-preferring reader still saw an English-tagged currency string and the English
 *  "(no name)" placeholder on an unnamed deal's card. */
const WITH_DEAL: BoardColumn[] = [{
  stage: { id: "s1", name: "New", position: 0 },
  totalValue: 1500,
  opportunities: [{
    id: "o1", name: "Roof repair", monetary_value: 1500, status: "open",
    contact: { id: "c1", first_name: null, last_name: null },
  }],
}];

// See lib/format.test.ts's own copy of this helper: a bare `vi.spyOn(Intl, "NumberFormat")`
// with no implementation returns an object with no `.format` method (Vitest 4.1.10 / Node
// 24.13.0's own internal-slots trap on a native constructor) — this restores real construction
// through a saved original reference so the spy still records call args without breaking it.
function spyOnNumberFormat() {
  const Original = Intl.NumberFormat;
  return vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
    this: unknown,
    ...args: unknown[]
  ) {
    return new (Original as new (...a: unknown[]) => unknown)(...args);
  } as never);
}

function render(board: BoardColumn[], locale: "en" | "es") {
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(PipelineBoard, {
      board, moveAction: vi.fn(async () => {}), updateAction: vi.fn(async () => {}),
    })),
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

  it("the column total and the card's own value both pass es-US to Intl.NumberFormat, and an unnamed deal's card reads the Spanish placeholder (mutation: call formatCurrency/contactDisplayName with no locale -> FAILS)", () => {
    const spy = spyOnNumberFormat();
    let html: string;
    try {
      html = render(WITH_DEAL, "es");
      // Both the column header's subtotal and the card's own value go through formatCurrency —
      // every call this render made must have been tagged es-US, never the en-US default.
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) expect(call[0]).toBe("es-US");
    } finally {
      spy.mockRestore();
    }
    expect(html).toContain(contactDisplayName({ first_name: null, last_name: null }, "es"));
    expect(html).not.toContain(m["contact.noName"]);
  });

  it("in English, the same deal reads the English placeholder and an en-US currency tag", () => {
    const spy = spyOnNumberFormat();
    let html: string;
    try {
      html = render(WITH_DEAL, "en");
      for (const call of spy.mock.calls) expect(call[0]).toBe("en-US");
    } finally {
      spy.mockRestore();
    }
    expect(html).toContain(m["contact.noName"]);
  });
});

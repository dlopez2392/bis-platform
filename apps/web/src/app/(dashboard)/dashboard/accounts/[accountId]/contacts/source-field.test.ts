import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";

// Server actions are stubbed: this renders, nothing is clicked (the click-to-
// edit flow is e2e, same posture as email-row.test.ts/texts-row.test.ts).
vi.mock("./actions", () => ({ updateContactFieldAction: vi.fn() }));

const { SourceField } = await import("./source-field");

const html = (source: string | null, sourceHint: string | null) =>
  renderToStaticMarkup(createElement(SourceField, { accountId: "a1", contactId: "c1", source, sourceHint }));

describe("SourceField — F-157's drawer line", () => {
  it("shows the raw source as the editable value, with the computed hint beside it", () => {
    const out = renderedText(html("form: Contact us", "Found through ChatGPT"));
    expect(out).toContain("form: Contact us");
    expect(out).toContain("Found through ChatGPT");
  });

  it("a known source with no hint shows only the value, never a stray caption (mutation: always render a <p> → FAILS, an empty one would still match toContain checks elsewhere but this asserts the exact count)", () => {
    const out = html("voice", null);
    expect(out.match(/<p[^>]*>/g) ?? []).toHaveLength(0);
  });

  it("nothing captured shows 'Source unknown' in plain words, never guessed, with an editable empty value (mutation: fall back to a guessed word like 'Direct' → FAILS)", () => {
    const out = renderedText(html(null, m["contact.source.unknown"]));
    expect(out).toContain(m["contact.source.unknown"]);
    expect(out).toContain(m["inline.empty"]); // InlineField's own empty-state affordance
  });

  it("the label reads 'Source' (DESIGN.md: a small inline edit, not form+Save — this is one InlineField, no surrounding <form>)", () => {
    const out = html("voice", null);
    expect(renderedText(out)).toContain(m["contact.source.label"]);
    expect(out).not.toContain("<form");
  });
});

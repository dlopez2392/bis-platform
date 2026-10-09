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

  /**
   * Review round 2, minor 4: round 1's m2 fix SLICED the hint text in JS
   * and relied on `aria-label` to carry the full fact — two real bugs.
   * `aria-label` has no naming effect on a `<p>` (ARIA's generic/paragraph
   * role is explicitly excluded from the elements `aria-label` can name;
   * a screen reader reads the plain text content instead, which was the
   * CLAMPED, already-cut string) and `String.slice` cuts by UTF-16 code
   * unit, which can split a surrogate pair in half. Fixed by rendering the
   * FULL, unsliced text and clamping visually with CSS (`truncate`) —
   * nothing to slice, nothing for an ineffective `aria-label` to work
   * around. `clampHint` (lib/contacts/lead-source.ts) is now dead and
   * removed.
   */
  it("renders the FULL hint text, unsliced, letting CSS truncate it visually (mutation: slice the text before rendering → FAILS)", () => {
    const long = "Referred by " + "a".repeat(200);
    const out = html("form: Contact us", long);
    expect(renderedText(out)).toContain(long);
  });

  it("the hint <p> truncates with CSS, not a trailing ellipsis character in the text itself (mutation: drop the truncate class → FAILS)", () => {
    const out = html("form: Contact us", "Found through ChatGPT");
    expect(out).toMatch(/<p[^>]*\btruncate\b[^>]*>Found through ChatGPT<\/p>/);
  });

  it("carries the full hint as a native title (a real tooltip on hover), and no aria-label on the <p> itself — ARIA forbids naming a paragraph with one, so it would be silently ignored (mutation: add aria-label back to the <p> → FAILS)", () => {
    const out = html("form: Contact us", "Found through ChatGPT");
    const hintTag = out.match(/<p[^>]*>Found through ChatGPT<\/p>/)?.[0];
    expect(hintTag, "the hint <p>").toBeTruthy();
    expect(hintTag).toContain('title="Found through ChatGPT"');
    expect(hintTag).not.toContain("aria-label");
  });
});

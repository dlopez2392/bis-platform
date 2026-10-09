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
   * role is explicitly excluded from the elements `aria-label` can name)
   * and `String.slice` cuts by UTF-16 code unit, which can split a
   * surrogate pair in half. Review round 3, item 3: round 2's own CSS fix
   * (`truncate`, a one-line visual clip) hid `custom.referred_by` — the
   * source question's answer, shown ONLY on this line — from any
   * keyboard or touch user, who cannot hover a `title` tooltip to recover
   * the clipped part. Fixed again: the text WRAPS (`break-words`, no
   * truncate, no line-clamp) so nothing is ever hidden from anyone.
   */
  it("renders the FULL hint text, unsliced, wrapping rather than clipped (mutation: slice the text, or clip it with CSS, before rendering → FAILS)", () => {
    const long = "Referred by " + "a".repeat(200);
    const out = html("form: Contact us", long);
    expect(renderedText(out)).toContain(long);
  });

  it("the hint <p> wraps long text instead of clipping it — no truncate, no line-clamp (mutation: add either class back → FAILS)", () => {
    const out = html("form: Contact us", "Found through ChatGPT");
    const hintTag = out.match(/<p[^>]*>Found through ChatGPT<\/p>/)?.[0];
    expect(hintTag, "the hint <p>").toBeTruthy();
    expect(hintTag).not.toMatch(/\btruncate\b/);
    expect(hintTag).not.toMatch(/\bline-clamp-\d+\b/);
  });

  it("carries no title and no aria-label on the <p> — the full text is always on screen already (wrapped), so neither adds anything a sighted-mouse-only tooltip or an ignored ARIA attribute would (mutation: add either back → FAILS)", () => {
    const out = html("form: Contact us", "Found through ChatGPT");
    const hintTag = out.match(/<p[^>]*>Found through ChatGPT<\/p>/)?.[0];
    expect(hintTag, "the hint <p>").toBeTruthy();
    expect(hintTag).not.toContain("title=");
    expect(hintTag).not.toContain("aria-label");
  });
});

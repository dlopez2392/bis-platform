import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import type { TextsLoad } from "@/lib/consent/texts-row";

// Server actions are stubbed: this renders, nothing is clicked (the clicks are e2e, Task 15).
vi.mock("./actions", () => ({ setPhoneCountryAction: vi.fn(), undoPhoneCountryAction: vi.fn() }));
vi.mock("./texts-actions", () => ({
  stopTextsAction: vi.fn(), undoStopTextsAction: vi.fn(), resumeTextsAction: vi.fn(),
  confirmStopAction: vi.fn(), notAStopAction: vi.fn(), undoHoldDecisionAction: vi.fn(),
}));

const { TextsRow } = await import("./texts-row");

const ready = (view: Extract<TextsLoad, { status: "ready" }>["view"]): TextsLoad =>
  ({ status: "ready", view, zone: "America/Chicago", phone: "+15512345678" });
const html = (load: TextsLoad) => renderToStaticMarkup(createElement(TextsRow, { accountId: "a1", contactId: "c1", load }));
/** One button's opening tag, by its visible label. */
const button = (markup: string, label: string) => {
  const at = markup.indexOf(`>${label}<`);
  if (at < 0) return null;
  return markup.slice(markup.lastIndexOf("<button", at), at + 1);
};
/** The whole element (a div) carrying this test id, children included. */
const inside = (markup: string, testid: string): string => {
  const at = markup.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  const open = markup.lastIndexOf("<div", at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let t = tags.exec(markup); t; t = tags.exec(markup)) {
    depth += t[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(open, tags.lastIndex);
  }
  return "";
};

describe("TextsRow — every state of spec §6", () => {
  it("loading is a two-row skeleton; no status word (mutation: render one skeleton → FAILS)", () => {
    const out = html({ status: "loading" });
    expect(out).toContain('data-testid="texts-row-skeleton"');
    expect(out.match(/data-slot="skeleton"/g) ?? []).toHaveLength(2);
    expect(renderedText(out)).not.toContain("Allowed");
  });

  it("an error is the block's own line with Retry, never a guessed state (mutation: render allowed → FAILS)", () => {
    const out = renderToStaticMarkup(createElement(TextsRow, { accountId: "a1", contactId: "c1", load: { status: "error" }, onRetry: () => {} }));
    expect(renderedText(out)).toContain(m["contact.texts.loadFailed"]);
    expect(button(out, m["common.retry"])).not.toBeNull();
  });

  it("no textable number is no row (mutation: render allowed → FAILS)", () => {
    expect(html(ready({ kind: "no_number" }))).toBe("");
  });

  it("Allowed: dot + word, and one GHOST 'Stop texts' (rules 3, 8; mutation: default variant → FAILS)", () => {
    const out = html(ready({ kind: "allowed", newestId: null }));
    expect(out).toContain('data-state="allowed"');
    expect(renderedText(out)).toContain("Allowed");
    expect(out).toMatch(/<span class="[^"]*bg-success[^"]*" aria-hidden/);
    expect(button(out, m["contact.texts.stopTexts"])).toContain('data-variant="ghost"');
  });

  it("Stopped by the customer: since and how, the START line, and NO Resume (choice 19; mutation: offer Resume for every stop → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-10-04T02:30:00Z", how: { kind: "keyword", word: "STOP" }, canResume: false }));
    const text = renderedText(out);
    expect(text).toContain("Since Oct 3, 2026 · they texted STOP");
    expect(text).toContain(m["contact.texts.customerOnly"]);
    expect(button(out, m["contact.texts.resume"])).toBeNull();
  });

  it("Stopped by staff: a ghost 'Resume texts…' and no START line (mutation: invert canResume → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true }));
    expect(button(out, m["contact.texts.resume"])).toContain('data-variant="ghost"');
    expect(renderedText(out)).not.toContain(m["contact.texts.customerOnly"]);
  });

  it("On hold: what they wrote, and two ghost buttons, Confirm stop and Not a stop (mutation: drop Not a stop → FAILS)", () => {
    const out = html(ready({ kind: "held", eventId: "h", since: "2026-10-04T02:30:00Z", excerpt: "remove me" }));
    expect(renderedText(out)).toContain("They wrote “remove me”. Texts are on hold.");
    expect(button(out, m["contact.texts.confirmStop"])).toContain('data-variant="ghost"');
    expect(button(out, m["contact.texts.notAStop"])).toContain('data-variant="ghost"');
  });

  it("Check number keeps PR-1's own test id on the WHOLE state — the status word, the line and both country buttons inside it — because PR-1's e2e reads the word through it (review R3-I2; mutation: wrap only the line and the buttons → the word falls outside, FAILS)", () => {
    const block = inside(html(ready({ kind: "check_number" })), "phone-country-row");
    expect(renderedText(block)).toContain(m["contact.phoneCountry.word"]);
    expect(renderedText(block)).toContain(m["contact.phoneCountry.line"]);
    expect(block).toContain('data-testid="texts-row-status"');
    expect(button(block, m["contact.phoneCountry.mx"])).not.toBeNull();
    expect(button(block, m["contact.phoneCountry.us"])).not.toBeNull();
  });

  it("the status line is the first child of ONE wrapper in every ready state, Check number included, so React keeps the same node — and its focus — when the state changes (review R3-N2; mutation: a wrapper of its own for Check number, the bare status line elsewhere → FAILS)", () => {
    const sameShape = /<div class="space-y-1\.5"( data-testid="phone-country-row")?><div[^>]*data-testid="texts-row-status"/;
    for (const view of [{ kind: "allowed", newestId: null }, { kind: "check_number" },
      { kind: "held", eventId: "h", since: "2026-10-04T02:30:00Z", excerpt: "remove me" }] as const) {
      expect(html(ready(view)), view.kind).toMatch(sameShape);
    }
  });

  it("the status is a focus target, so an action keeps the keyboard in the row (review R3-M9; mutation: drop tabIndex → FAILS)", () => {
    expect(html(ready({ kind: "allowed", newestId: null }))).toMatch(/data-testid="texts-row-status"[^>]*tabindex="-1"|tabindex="-1"[^>]*data-testid="texts-row-status"/);
  });
});

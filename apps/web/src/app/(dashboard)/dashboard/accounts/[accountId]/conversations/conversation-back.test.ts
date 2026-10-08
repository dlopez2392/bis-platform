import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { shouldGoBackOnEscape, ConversationBack } from "./conversation-back";

/**
 * D-021's keyboard half: Esc goes back to the list. Pure decision, tested
 * without a DOM (concierge-chat.tsx's `shouldCloseOnKey` pattern) — the
 * actual `window.addEventListener("keydown", …)` wiring (plus the
 * "is the Back link even on screen" visibility check, which needs a real
 * layout and is not exercised here) calls this.
 *
 * Guarded against firing while the operator is mid-draft in the composer's
 * textarea, the subject input, a SELECT, or any contentEditable region: an
 * accidental Esc (dismissing a browser autocomplete suggestion, closing an
 * IME composition, say) must not throw away an unsent reply by navigating
 * off the thread.
 */
const key = (over: Partial<{ key: string; defaultPrevented: boolean; isComposing: boolean }> = {}) =>
  ({ key: "Escape", defaultPrevented: false, isComposing: false, ...over });
const active = (over: Partial<{ tagName: string | null | undefined; isContentEditable: boolean }> = {}) =>
  ({ tagName: null, isContentEditable: false, ...over });

describe("shouldGoBackOnEscape (D-021, review fix)", () => {
  it("is true for Escape with no editable element focused (mutation: return false unconditionally → FAILS)", () => {
    expect(shouldGoBackOnEscape(key(), active({ tagName: "BODY" }))).toBe(true);
    expect(shouldGoBackOnEscape(key(), active())).toBe(true);
  });

  it("is false for any other key", () => {
    expect(shouldGoBackOnEscape(key({ key: "Enter" }), active({ tagName: "BODY" }))).toBe(false);
    expect(shouldGoBackOnEscape(key({ key: "a" }), active())).toBe(false);
  });

  it("is false while the composer's textarea, an input, or a select is focused, so an in-progress draft is never discarded by a stray Esc", () => {
    expect(shouldGoBackOnEscape(key(), active({ tagName: "TEXTAREA" }))).toBe(false);
    expect(shouldGoBackOnEscape(key(), active({ tagName: "INPUT" }))).toBe(false);
    expect(shouldGoBackOnEscape(key(), active({ tagName: "SELECT" }))).toBe(false);
  });

  it("is false inside a contentEditable region (mutation: drop the isContentEditable check → FAILS)", () => {
    expect(shouldGoBackOnEscape(key(), active({ tagName: "DIV", isContentEditable: true }))).toBe(false);
  });

  it("is false when the keydown was already handled (defaultPrevented) or is part of an IME composition (mutation: drop either guard → FAILS)", () => {
    expect(shouldGoBackOnEscape(key({ defaultPrevented: true }), active())).toBe(false);
    expect(shouldGoBackOnEscape(key({ isComposing: true }), active())).toBe(false);
  });
});

describe("ConversationBack (D-021, review fix: selection survives a page change)", () => {
  it("renders a Back link to the base conversations path, hidden at the lg breakpoint where both panes already show", () => {
    const html = renderToStaticMarkup(createElement(ConversationBack, {
      base: "/dashboard/accounts/a1/conversations",
    }));
    expect(html).toContain('href="/dashboard/accounts/a1/conversations"');
    expect(html).toMatch(/class="[^"]*\blg:hidden\b/);
  });

  // DESIGN.md "Paged lists": "Selection survives a page change." Opening a
  // thread from page 2 of the inbox and pressing Back must return to page
  // 2, not silently reset to page 1 — the bug this review caught (`base`
  // alone, with no `before`, is page one).
  it("carries the current `before` cursor in its href when given one (mutation: drop `before` from the href → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ConversationBack, {
      base: "/dashboard/accounts/a1/conversations",
      before: "CURSOR123",
    }));
    expect(html).toContain('href="/dashboard/accounts/a1/conversations?before=CURSOR123"');
  });

  it("falls back to the bare base href when there is no cursor (page one)", () => {
    const html = renderToStaticMarkup(createElement(ConversationBack, {
      base: "/dashboard/accounts/a1/conversations",
      before: undefined,
    }));
    expect(html).toContain('href="/dashboard/accounts/a1/conversations"');
    expect(html).not.toContain("before=");
  });
});

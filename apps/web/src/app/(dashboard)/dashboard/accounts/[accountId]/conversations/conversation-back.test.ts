import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { shouldGoBackOnEscape, ConversationBack } from "./conversation-back";

/**
 * D-021's keyboard half: Esc goes back to the list. Pure decision, tested
 * without a DOM (concierge-chat.tsx's `shouldCloseOnKey` pattern) — the
 * actual `window.addEventListener("keydown", …)` wiring is one line that
 * calls this.
 *
 * Guarded against firing while the operator is mid-draft in the composer's
 * textarea or the subject input: an accidental Esc (dismissing a browser
 * autocomplete suggestion, say) must not throw away an unsent reply by
 * navigating off the thread.
 */
describe("shouldGoBackOnEscape (D-021)", () => {
  it("is true for Escape with no editable element focused (mutation: return false unconditionally → FAILS)", () => {
    expect(shouldGoBackOnEscape("Escape", "BODY")).toBe(true);
    expect(shouldGoBackOnEscape("Escape", null)).toBe(true);
  });

  it("is false for any other key", () => {
    expect(shouldGoBackOnEscape("Enter", "BODY")).toBe(false);
    expect(shouldGoBackOnEscape("a", null)).toBe(false);
  });

  it("is false while the composer's textarea or an input is focused, so an in-progress draft is never discarded by a stray Esc", () => {
    expect(shouldGoBackOnEscape("Escape", "TEXTAREA")).toBe(false);
    expect(shouldGoBackOnEscape("Escape", "INPUT")).toBe(false);
  });
});

describe("ConversationBack (D-021)", () => {
  it("renders a Back link to the base conversations path, hidden at the lg breakpoint where both panes already show", () => {
    const html = renderToStaticMarkup(createElement(ConversationBack, {
      base: "/dashboard/accounts/a1/conversations",
    }));
    expect(html).toContain('href="/dashboard/accounts/a1/conversations"');
    expect(html).toMatch(/class="[^"]*\blg:hidden\b/);
  });
});

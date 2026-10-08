import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Imported at module scope by the composer; never called during a server render.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EmailComposer } from "./email-composer";

/**
 * D-015. The body field was a single-line `<input>`, which cannot hold a
 * typed Enter at all (a browser strips a newline from an `<input
 * type="text">`'s value before it ever reaches `value`) — so no email sent
 * from this composer could ever carry a paragraph break, however the
 * operator typed it. A `<textarea>` is the fix: it holds `\n` in its value,
 * and — since nothing here adds a keydown handler — pressing Enter inside it
 * inserts a newline rather than submitting the form, so the explicit Send
 * button (not Shift+Enter) is the one way to send, unchanged from today.
 */
describe("EmailComposer's body field (D-015)", () => {
  it("renders the body as a textarea, not a single-line input (mutation: revert to <Input> → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(EmailComposer, {
      contactId: "c1",
      action: async () => {},
    }));
    expect(html).toContain('<textarea');
    expect(html).toMatch(/<textarea[^>]*name="body"/);
    // Not also rendered as a single-line input for body — that would be
    // *coexisting* inputs, not a fix.
    expect(html).not.toMatch(/<input[^>]*name="body"/);
  });
});

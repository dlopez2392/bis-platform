import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailSendButton } from "./send-button";

/**
 * EmailSendButton (shared by both email composers: the contact timeline and
 * Conversations). DESIGN DoD, phone tap targets: the default `Button` size
 * is `h-9` (36px), under the 44px floor — the record timeline's own
 * min-h-11 md:min-h-8 idiom.
 */
describe("EmailSendButton: phone tap target", () => {
  it("is at least 44px tall on a phone, the desktop height unchanged (mutation: drop min-h-11 -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(EmailSendButton, {}));
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain("min-h-11");
    expect(button).toContain("md:min-h-8");
  });
});

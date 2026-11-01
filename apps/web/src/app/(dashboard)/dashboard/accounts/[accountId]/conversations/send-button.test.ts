import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
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

// S-10 T4: the default label/pendingLabel were bare m[] reads, English on every
// locale (no caller happens to rely on the default today, but a future one would).
describe("EmailSendButton: Spanish default labels (S-10 T4)", () => {
  function render(locale: "en" | "es") {
    return renderToStaticMarkup(
      createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(EmailSendButton, {})),
    );
  }

  it("defaults to the Spanish label under a Spanish locale (mutation: default to English always -> FAILS)", () => {
    expect(render("es")).toContain("Enviar");
    expect(render("es")).not.toContain(">Send<");
  });

  it("still defaults to the English label under English", () => {
    expect(render("en")).toContain(">Send<");
  });
});

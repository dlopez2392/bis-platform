import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import { renderedText } from "@/lib/rendered-text";
import { EmbedSnippet } from "./embed-snippet";

/**
 * S-10 T4: the calendar's thin wrapper over the shared embed card
 * (`components/embed-snippet.tsx`) passed English copy as literal defaults
 * (`m["calendar.embed.*"]`), never asking for the reader's own locale.
 */
function render(over: Partial<ComponentProps<typeof EmbedSnippet>> = {}, locale: "en" | "es" = "en"): string {
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(EmbedSnippet, {
      origin: "https://example.com", publicId: "pub_1", enabled: true, ...over,
    })),
  );
}

describe("EmbedSnippet (calendar) — Spanish (S-10 T4)", () => {
  it("renders its title, copy button and public-link label in Spanish (mutation: render English under es -> FAILS)", () => {
    const html = render({}, "es");
    expect(html).toContain("Insertar");
    expect(html).toContain("Copiar");
    expect(html).toContain("Enlace directo");
    expect(html).not.toContain(">Embed<");
    expect(html).not.toContain(">Copy<");
  });

  it("renders the disabled hint in Spanish when bookings are off", () => {
    const html = render({ enabled: false }, "es");
    expect(renderedText(html)).toContain('Active "Aceptar citas"');
  });

  it("still renders English under the English locale (mutation: hard-code Spanish -> FAILS)", () => {
    const html = render({}, "en");
    expect(html).toContain(">Embed<");
    expect(html).toContain(">Copy<");
  });
});

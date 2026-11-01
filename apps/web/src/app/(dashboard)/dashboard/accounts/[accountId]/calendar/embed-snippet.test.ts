import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { EmbedSnippet } from "./embed-snippet";

/**
 * S-10 T4: the calendar's thin wrapper over the shared embed card
 * (`components/embed-snippet.tsx`) passed English copy as literal defaults
 * (`m["calendar.embed.*"]`), never asking for the reader's own locale.
 *
 * S-10 review I-2: `locale`/`pseudo` are props, like every other card on
 * `calendar/page.tsx` (ClosedDaysCard, FeedCard, JobDrawer) — never the
 * ambient LocaleProvider, which the layout seeds once and cannot see this
 * page's own `?locale=` QA override.
 */
function render(over: Partial<ComponentProps<typeof EmbedSnippet>> = {}, locale: Locale = "en", pseudo = false): string {
  return renderToStaticMarkup(
    createElement(EmbedSnippet, {
      origin: "https://example.com", publicId: "pub_1", enabled: true, locale, pseudo, ...over,
    }),
  );
}

describe("EmbedSnippet (calendar) — Spanish (S-10 T4)", () => {
  it("renders its title, copy button and public-link label in Spanish (mutation: render English under es -> FAILS)", () => {
    const html = render({}, "es");
    expect(html).toContain("Código para su sitio web");
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

  it("takes its locale from its own prop, never the ambient LocaleProvider (mutation: read useLocale() instead of the prop -> FAILS; S-10 review I-2)", () => {
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "en" } as ComponentProps<typeof LocaleProvider>, createElement(EmbedSnippet, {
        origin: "https://example.com", publicId: "pub_1", enabled: true, locale: "es", pseudo: false,
      })),
    );
    expect(html).toContain("Código para su sitio web");
    expect(html).not.toContain(">Embed<");
  });

  it("pads with the pseudo-locale when its pseudo prop is on, the same way every other card on this page does (mutation: ignore the pseudo prop -> FAILS; S-10 review I-2)", () => {
    const html = render({}, "en", true);
    expect(html).toContain(pseudoLocale(t(m, "calendar.embed.title", "en")));
    expect(html).not.toContain(">Embed<");
  });
});

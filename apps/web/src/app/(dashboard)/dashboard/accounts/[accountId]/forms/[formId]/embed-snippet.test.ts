import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { EmbedSnippet } from "./embed-snippet";

function html(props: {
  locale: string; readerLocale?: Locale; pseudo?: boolean; published?: boolean;
}): string {
  return renderToStaticMarkup(createElement(EmbedSnippet, {
    origin: "https://app.example.com", publicId: "pub_1",
    locale: props.locale, readerLocale: props.readerLocale, pseudo: props.pseudo,
    published: props.published ?? true,
  }));
}

/**
 * S-10 T5 part 2's named trap: this wrapper already carried a `locale` prop
 * that means the FORM's own customer-facing language (`form.locale_default`
 * — forwarded verbatim into the embed's `data-locale` attribute, which the
 * PUBLIC page reads to render in that language for a visitor). That prop
 * must stay untouched. `readerLocale` is a DISTINCT, new prop for the
 * OPERATOR reading this dashboard card — the title, the hint, the copy
 * button. The two can disagree on one render (an English-reading operator
 * editing a form whose own language is Spanish, or the reverse), and this
 * is the test that proves they are wired to the right half of the card.
 */
describe("EmbedSnippet: the FORM's own language and the READER's are two different props (S-10 T5 part 2, the known trap)", () => {
  it("forwards `locale` (the FORM's language) to data-locale untouched, regardless of readerLocale (mutation: swap which prop feeds data-locale → FAILS)", () => {
    const out = html({ locale: "es", readerLocale: "en" });
    expect(renderedText(out)).toContain('data-locale="es"');
    expect(renderedText(out)).not.toContain('data-locale="en"');
  });

  it("an English-reading operator sees an English card around a Spanish-language form's snippet (mutation: read readerLocale off `locale` instead → FAILS)", () => {
    const out = html({ locale: "es", readerLocale: "en" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.embed"]);
    expect(text).not.toContain(m["forms.embed.es"]);
    expect(text).toContain('data-locale="es"');
  });

  it("a Spanish-reading operator sees a Spanish card around an English-language form's snippet — the reverse pairing (mutation: read readerLocale off `locale` instead → FAILS)", () => {
    const out = html({ locale: "en", readerLocale: "es" });
    const text = renderedText(out);
    expect(text).toContain(m["forms.embed.es"]);
    expect(text).not.toContain(m["forms.embed"]);
    expect(renderedText(out)).toContain('data-locale="en"');
  });

  it("every card string the operator reads is Spanish when readerLocale is 'es': title, hint, copy button and the public-link label (mutation: hard-code any one in English → FAILS)", () => {
    const text = renderedText(html({ locale: "en", readerLocale: "es" }));
    expect(text).toContain(m["forms.embed.es"]);
    expect(text).toContain(m["forms.embedHint.es"]);
    expect(text).toContain(m["forms.copy.es"]);
    expect(text).toContain(m["forms.publicLink.es"]);
  });

  it("the disabled hint (unpublished form) is Spanish too, for a Spanish-reading operator (mutation: hard-code English → FAILS)", () => {
    const text = renderedText(html({ locale: "en", readerLocale: "es", published: false }));
    expect(text).toContain(m["forms.embedNotPublished.es"]);
  });

  it("defaults readerLocale to English with no prop given, so an uncalled-out caller keeps today's behaviour (mutation: default to Spanish → FAILS)", () => {
    const text = renderedText(html({ locale: "en" }));
    expect(text).toContain(m["forms.embed"]);
    expect(text).not.toContain(m["forms.embed.es"]);
  });

  it("the QA pseudo-locale reaches the card's title (mutation: drop pseudo from makeTr → FAILS)", () => {
    const text = renderedText(html({ locale: "en", readerLocale: "en", pseudo: true }));
    expect(text).toContain(pseudoLocale(m["forms.embed"]));
  });
});

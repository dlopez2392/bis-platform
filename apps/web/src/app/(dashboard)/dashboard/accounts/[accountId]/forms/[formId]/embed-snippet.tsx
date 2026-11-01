"use client";

import { EmbedSnippet as SharedEmbedSnippet } from "@/components/embed-snippet";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/** A thin wrapper over the shared `components/embed-snippet.tsx` card — kept
 *  as its own file/export so `forms/[formId]/page.tsx` doesn't change, and
 *  so the snippet still forwards `data-locale`, which the shared card has
 *  no reason to know about on its own.
 *
 * S-10 T5 part 2's named trap, pinned in embed-snippet.test.ts: `locale`
 * and `readerLocale` are TWO DIFFERENT LANGUAGES and must never be
 * collapsed into one prop. `locale` is the FORM's own customer-facing
 * language (`form.locale_default`) — forwarded, unread by this component,
 * straight into the embed's `data-locale` attribute, which the PUBLIC page
 * reads to render in that language for a VISITOR. `readerLocale` is the
 * OPERATOR's own language, reading THIS dashboard card — the card title,
 * the hint, the copy button, the public-link label. An English-speaking
 * operator editing a Spanish-language form (or the reverse) needs both at
 * once: an English card wrapped around a `data-locale="es"` snippet. */
export function EmbedSnippet({
  origin, publicId, locale, readerLocale = "en", pseudo = false, published,
}: {
  origin: string;
  publicId: string;
  /** The FORM's own language (`form.locale_default`) — never the reader's. */
  locale: string;
  /** The OPERATOR's own language, reading this card — never the form's. */
  readerLocale?: Locale;
  pseudo?: boolean;
  published: boolean;
}) {
  const tr = makeTr(readerLocale, pseudo);
  return (
    <SharedEmbedSnippet
      attribute="data-form"
      publicId={publicId}
      origin={origin}
      title={tr.text("forms.embed")}
      hint={tr.text("forms.embedHint")}
      disabledHint={tr.text("forms.embedNotPublished")}
      enabled={published}
      copyLabel={tr.text("forms.copy")}
      copiedLabel={tr.text("forms.copied")}
      publicLinkLabel={tr.text("forms.publicLink")}
      extraAttrs={`data-locale="${locale}"`}
    />
  );
}

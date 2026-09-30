"use client";

import { EmbedSnippet as SharedEmbedSnippet } from "@/components/embed-snippet";
import { m } from "@/lib/messages";

/** A thin wrapper over the shared `components/embed-snippet.tsx` card — kept
 *  as its own file/export so `forms/[formId]/page.tsx` doesn't change, and
 *  so the snippet still forwards `data-locale`, which the shared card has
 *  no reason to know about on its own. */
export function EmbedSnippet({
  origin, publicId, locale, published,
}: { origin: string; publicId: string; locale: string; published: boolean }) {
  return (
    <SharedEmbedSnippet
      attribute="data-form"
      publicId={publicId}
      origin={origin}
      title={m["forms.embed"]}
      hint={m["forms.embedHint"]}
      disabledHint={m["forms.embedNotPublished"]}
      enabled={published}
      copyLabel={m["forms.copy"]}
      copiedLabel={m["forms.copied"]}
      publicLinkLabel={m["forms.publicLink"]}
      extraAttrs={`data-locale="${locale}"`}
    />
  );
}

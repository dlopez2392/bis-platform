"use client";

import { EmbedSnippet as SharedEmbedSnippet } from "@/components/embed-snippet";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { useLocale } from "@/components/locale-provider";

/** A thin wrapper over the shared `components/embed-snippet.tsx` card —
 *  kept as its own file/export so `calendar/page.tsx` doesn't change, and
 *  so the snippet still forwards a fixed `data-min-height="560"`: the
 *  booking widget's week strip + slot grid + form needs more room than a
 *  typical lead form and has no natural resize signal of its own to
 *  auto-fit with. */
export function EmbedSnippet({
  origin, publicId, enabled,
}: { origin: string; publicId: string; enabled: boolean }) {
  const locale = useLocale();
  return (
    <SharedEmbedSnippet
      attribute="data-booking"
      publicId={publicId}
      origin={origin}
      title={t(m, "calendar.embed.title", locale)}
      hint={t(m, "calendar.embed.hint", locale)}
      disabledHint={t(m, "calendar.embed.disabledHint", locale)}
      enabled={enabled}
      copyLabel={t(m, "calendar.embed.copy", locale)}
      copiedLabel={t(m, "calendar.embed.copied", locale)}
      publicLinkLabel={t(m, "calendar.embed.publicLink", locale)}
      extraAttrs={`data-min-height="560"`}
    />
  );
}

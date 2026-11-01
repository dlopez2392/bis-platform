"use client";

import { EmbedSnippet as SharedEmbedSnippet } from "@/components/embed-snippet";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";

/** A thin wrapper over the shared `components/embed-snippet.tsx` card —
 *  kept as its own file/export so `calendar/page.tsx` doesn't change, and
 *  so the snippet still forwards a fixed `data-min-height="560"`: the
 *  booking widget's week strip + slot grid + form needs more room than a
 *  typical lead form and has no natural resize signal of its own to
 *  auto-fit with.
 *
 *  S-10 review I-2: `locale`/`pseudo` are props, like every other card on
 *  `calendar/page.tsx` (ClosedDaysCard, FeedCard, JobDrawer) — never the
 *  ambient LocaleProvider, which the layout seeds once and cannot see this
 *  page's own `?locale=` QA override (`requestLocale`/`requestPseudoMode`,
 *  page.tsx:112). */
export function EmbedSnippet({
  origin, publicId, enabled, locale, pseudo = false,
}: { origin: string; publicId: string; enabled: boolean; locale: Locale; pseudo?: boolean }) {
  const tr = makeTr(locale, pseudo);
  return (
    <SharedEmbedSnippet
      attribute="data-booking"
      publicId={publicId}
      origin={origin}
      title={tr.text("calendar.embed.title")}
      hint={tr.text("calendar.embed.hint")}
      disabledHint={tr.text("calendar.embed.disabledHint")}
      enabled={enabled}
      copyLabel={tr.text("calendar.embed.copy")}
      copiedLabel={tr.text("calendar.embed.copied")}
      publicLinkLabel={tr.text("calendar.embed.publicLink")}
      extraAttrs={`data-min-height="560"`}
    />
  );
}

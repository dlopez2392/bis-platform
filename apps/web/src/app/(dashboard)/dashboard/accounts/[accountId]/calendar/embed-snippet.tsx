"use client";

import { EmbedSnippet as SharedEmbedSnippet } from "@/components/embed-snippet";
import { m } from "@/lib/messages";

/** A thin wrapper over the shared `components/embed-snippet.tsx` card —
 *  kept as its own file/export so `calendar/page.tsx` doesn't change, and
 *  so the snippet still forwards a fixed `data-min-height="560"`: the
 *  booking widget's week strip + slot grid + form needs more room than a
 *  typical lead form and has no natural resize signal of its own to
 *  auto-fit with. */
export function EmbedSnippet({
  origin, publicId, enabled,
}: { origin: string; publicId: string; enabled: boolean }) {
  return (
    <SharedEmbedSnippet
      attribute="data-booking"
      publicId={publicId}
      origin={origin}
      title={m["calendar.embed.title"]}
      hint={m["calendar.embed.hint"]}
      disabledHint={m["calendar.embed.disabledHint"]}
      enabled={enabled}
      copyLabel={m["calendar.embed.copy"]}
      copiedLabel={m["calendar.embed.copied"]}
      publicLinkLabel={m["calendar.embed.publicLink"]}
      extraAttrs={`data-min-height="560"`}
    />
  );
}

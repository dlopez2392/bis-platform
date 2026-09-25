"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one copy-the-snippet card.
 *
 * Extracted when the concierge widget would have been the THIRD near-copy —
 * `calendar/embed-snippet.tsx` already said in its own comment that it
 * "mirrors `forms/[formId]/embed-snippet.tsx` exactly". Both prior call
 * sites moved onto this in the same commit, as thin wrappers that keep
 * their own exported name and prop shape (so neither page.tsx importer
 * changes) and supply the copy and the one `data-*` attribute each surface
 * needs that the other does not (forms forwards `data-locale`; calendar
 * forwards a fixed `data-min-height`) via `extraAttrs`, rather than forking
 * this component per surface.
 */
export function EmbedSnippet({
  attribute,
  publicId,
  origin,
  title,
  hint,
  disabledHint,
  enabled,
  copyLabel,
  copiedLabel,
  publicLinkLabel,
  extraAttrs,
  surface = "1",
}: {
  attribute: "data-form" | "data-booking" | "data-concierge";
  publicId: string;
  origin: string;
  title: string;
  hint: string;
  disabledHint: string;
  enabled: boolean;
  copyLabel: string;
  copiedLabel: string;
  publicLinkLabel: string;
  /** An extra `key="value"` pair the snippet needs beyond `${attribute}="${publicId}"`. */
  extraAttrs?: string;
  /** Which surface-ladder step this card paints from (fix-round review,
   *  MINOR 7). Default `"1"` — every existing call site (forms, calendar,
   *  the Voice page's own `ConciergeCard`) already sits directly on
   *  `--surface-0`/the page, so `bg-card` (`--surface-1`) is correct there
   *  unchanged. `"2"` is for a caller that nests this INSIDE another card
   *  (the setup wizard's pane, itself `--surface-1`) — DESIGN.md's ladder
   *  puts a nested panel one step up, `--surface-2`, never surface-1 on
   *  surface-1. */
  surface?: "1" | "2";
}) {
  const [copied, setCopied] = useState(false);
  const path = attribute === "data-form" ? "f" : attribute === "data-booking" ? "b" : "c";
  const snippet =
    `<script src="${origin}/embed.js"\n        ${attribute}="${publicId}"${extraAttrs ? `\n        ${extraAttrs}` : ""}></script>`;
  const link = `${origin}/${path}/${publicId}`;

  return (
    <Card className={cn(surface === "2" && "bg-[var(--surface-2)]")}>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {enabled ? (
          <>
            <p className="text-xs text-muted-foreground">{hint}</p>
            <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs text-secondary-foreground">
              <code>{snippet}</code>
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? copiedLabel : copyLabel}
            </Button>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-card-foreground">{publicLinkLabel}</p>
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-xs text-primary underline"
              >
                {link}
              </a>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{disabledHint}</p>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

/** Mirrors `forms/[formId]/embed-snippet.tsx` exactly, for `/b/` + a
 *  `data-booking` attribute and a fixed 560px height instead of the form
 *  widget's own sizing — the booking widget's week strip + slot grid + form
 *  needs more room than a typical lead form and has no natural resize
 *  signal of its own to auto-fit with. */
export function EmbedSnippet({
  origin, publicId, enabled,
}: { origin: string; publicId: string; enabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const snippet =
    `<script src="${origin}/embed.js"\n        data-booking="${publicId}"\n        data-min-height="560"></script>`;
  const link = `${origin}/b/${publicId}`;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{m["calendar.embed.title"]}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {enabled ? (
          <>
            <p className="text-xs text-muted-foreground">{m["calendar.embed.hint"]}</p>
            <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs text-secondary-foreground">
              <code>{snippet}</code>
            </pre>
            <Button
              type="button" variant="outline" size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? m["calendar.embed.copied"] : m["calendar.embed.copy"]}
            </Button>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-card-foreground">{m["calendar.embed.publicLink"]}</p>
              <a href={link} target="_blank" rel="noreferrer"
                 className="block break-all text-xs text-primary underline">
                {link}
              </a>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{m["calendar.embed.disabledHint"]}</p>
        )}
      </CardContent>
    </Card>
  );
}

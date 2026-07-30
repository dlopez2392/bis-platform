"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export function EmbedSnippet({
  origin, publicId, locale, published,
}: { origin: string; publicId: string; locale: string; published: boolean }) {
  const [copied, setCopied] = useState(false);
  const snippet =
    `<script src="${origin}/embed.js"\n        data-form="${publicId}"\n        data-locale="${locale}"></script>`;
  const link = `${origin}/f/${publicId}`;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{m["forms.embed"]}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {published ? (
          <>
            <p className="text-xs text-muted-foreground">{m["forms.embedHint"]}</p>
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
              {copied ? m["forms.copied"] : m["forms.copy"]}
            </Button>
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-card-foreground">{m["forms.publicLink"]}</p>
              <a href={link} target="_blank" rel="noreferrer"
                 className="block break-all text-xs text-primary underline">
                {link}
              </a>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{m["forms.embedNotPublished"]}</p>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";

export function BrandingPanel({
  brandName,
  logoUrl,
  action,
}: {
  brandName: string | null;
  /** Already resolved server-side. The panel must not build this itself —
   *  brandLogoUrl lives in @bis/db, and importing that here would pull the
   *  service-role client into the browser bundle. */
  logoUrl: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // Bumped on success to reset the file input, so the chosen filename stops
  // being displayed next to a preview that has already moved on to it.
  const [fileKey, setFileKey] = useState(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["branding.title"]}</CardTitle>
        <CardDescription>{m["branding.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={async (formData) => {
            const result = await action(formData);
            if (result.ok) {
              toast.success(m["branding.saved"]);
              setFileKey((k) => k + 1);
            } else {
              toast.error(result.error);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">{m["branding.name"]}</Label>
            <Input id="brand-name" name="brandName" defaultValue={brandName ?? ""} />
            <p className="text-xs text-muted-foreground">{m["branding.nameHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-logo">{m["branding.logo"]}</Label>
            <Input
              key={fileKey}
              id="brand-logo"
              name="logo"
              type="file"
              // A filter for the file picker, nothing more. The server decides
              // the format from the decoded bytes — this attribute is a hint to
              // the browser and anyone can send whatever they like regardless.
              accept="image/png,image/jpeg,image/webp"
            />
            <p className="text-xs text-muted-foreground">{m["branding.logoHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-card-foreground">{m["branding.currentLogo"]}</p>
            {logoUrl ? (
              // Plain <img>, not next/image: this is a small asset on a public
              // CDN path, and routing it through the optimizer would mean
              // configuring a remote pattern for the Supabase host to gain
              // nothing. max-h keeps a tall upload from stretching the panel.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={brandName ?? m["branding.logo"]}
                className="max-h-12 w-auto rounded-md border border-border bg-background p-1"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{m["branding.noLogo"]}</p>
            )}
          </div>

          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

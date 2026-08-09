"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { m } from "@/lib/messages";
import { FORM_ACCENT_FALLBACK, SIDEBAR_BG, resolveFormAccent,
         resolveSidebarAccent } from "@/lib/branding/color";

export function BrandingPanel({
  brandName,
  brandColor,
  logoUrl,
  action,
}: {
  brandName: string | null;
  brandColor: string | null;
  /** Already resolved server-side. The panel must not build this itself —
   *  brandLogoUrl lives in @bis/db, and importing that here would pull the
   *  service-role client into the browser bundle. */
  logoUrl: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  // Bumped on success to reset the file input, so the chosen filename stops
  // being displayed next to a preview that has already moved on to it.
  const [fileKey, setFileKey] = useState(0);
  const [color, setColor] = useState(brandColor ?? "");

  // Derived live from what is typed, through the same resolvers the two real
  // surfaces use — so this shows the actual outcome, not the input. Both
  // re-validate, so a half-typed hex simply previews the fallback.
  //
  // This is the only place raw color values belong in an inline style: they
  // ARE the subject. It exists because the sidebar value is one the operator
  // cannot predict — a dark brand is lightened to stay legible on a dark
  // sidebar, and spec §5.1 accepted that hue-preserving shift specifically on
  // the grounds that this preview would show it before saving.
  const previewAccent = resolveFormAccent(color);
  const previewSidebar = resolveSidebarAccent(color);

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
            <Label htmlFor="brand-color">{m["branding.color"]}</Label>
            <div className="flex items-center gap-2">
              {/* The TEXT field is what submits. A bare <input type="color">
                  always posts a value whether or not anyone touched it — that
                  is exactly how every form in this database ended up storing an
                  explicit violet nobody chose. The picker only writes here. */}
              <Input
                id="brand-color"
                name="brandColor"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#0f766e"
                className="font-mono"
              />
              <input
                type="color"
                aria-label={m["branding.color"]}
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : FORM_ACCENT_FALLBACK}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 shrink-0 rounded-md border border-border bg-background p-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">{m["branding.colorHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-card-foreground">{m["branding.colorPreview"]}</p>
            <div className="flex items-center gap-3">
              {/* What the client's own customers see on the lead form: the
                  colour as chosen, with the text colour derived to stay
                  legible on it. */}
              <span
                className="rounded-md px-4 py-2 text-sm font-medium"
                style={{
                  backgroundColor: previewAccent.accent,
                  color: previewAccent.accentForeground,
                  borderRadius: "var(--radius)",
                }}
              >
                {m["branding.previewSubmit"]}
              </span>
              {/* What the client sees in their own sidebar. Rendered on the
                  real sidebar background because that is the whole point —
                  a dark brand is lightened here and nowhere else, and this
                  is where the operator finds that out. */}
              <span
                className="flex items-center gap-2 rounded-md px-3 py-2"
                style={{ backgroundColor: SIDEBAR_BG }}
              >
                <span
                  className="h-4 w-1 rounded-r"
                  style={{ backgroundColor: previewSidebar ?? "var(--sidebar-accent)" }}
                />
                <span className="text-xs" style={{ color: "#d4d4d8" }}>
                  {m["branding.previewSidebar"]}
                </span>
              </span>
            </div>
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

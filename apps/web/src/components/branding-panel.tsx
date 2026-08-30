"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/app/(dashboard)/dashboard/accounts/submit-button";
import { m } from "@/lib/messages";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { FORM_ACCENT_FALLBACK, SIDEBAR_BG, resolveSidebarAccent } from "@/lib/branding/color";
import { panelCopy, type BrandingAudience } from "@/lib/branding/panel-copy";
import { publicFormTheme } from "@/lib/branding/public-form-theme";
import { deriveTheme, type CornerName, type ModeName, type NeutralName, type TypeName } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";
import { MAX_LOGO_BYTES } from "@/lib/branding/validate-logo";

/** "" is always first: it is how the operator clears the input again. */
function RadioRow({
  legend, name, value, onChange, options, hint,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly (readonly [string, string])[];
  hint?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map(([optionValue, label]) => (
          <label key={optionValue} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            {label}
          </label>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </fieldset>
  );
}

export function BrandingPanel({
  // WHO is reading, which selects every string that names whose brand this is
  // — see panel-copy.ts. Defaulted to the agency so the Settings card is
  // byte-identical to what it rendered before.
  //
  // This was two props (title + description) and that was the bug: it made the
  // heading configurable and left five hints hardcoded in the agency's voice,
  // so the client's own page told them the colour applies to "their sidebar".
  // One audience switch cannot be half-applied.
  audience = "agency",
  brandName,
  replyToEmail,
  brandColor,
  brandNeutral,
  brandCorners,
  brandType,
  brandMode,
  logoUrl,
  action,
}: {
  audience?: BrandingAudience;
  brandName: string | null;
  replyToEmail: string | null;
  brandColor: string | null;
  brandNeutral: NeutralName | null;
  brandCorners: CornerName | null;
  brandType: TypeName | null;
  brandMode: ModeName | null;
  /** Already resolved server-side. The panel must not build this itself —
   *  brandLogoUrl lives in @bis/db, and importing that here would pull the
   *  service-role client into the browser bundle. */
  logoUrl: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const copy = panelCopy(audience);

  // Bumped on success to reset the file input, so the chosen filename stops
  // being displayed next to a preview that has already moved on to it.
  const [fileKey, setFileKey] = useState(0);
  const [color, setColor] = useState(brandColor ?? "");
  const [neutral, setNeutral] = useState<string>(brandNeutral ?? "");
  const [corners, setCorners] = useState<string>(brandCorners ?? "");
  const [typeface, setTypeface] = useState<string>(brandType ?? "");
  const [mode, setMode] = useState<string>(brandMode ?? "");
  // Which side of the theme the specimen is showing. Not the tenant's default
  // and not the operator's own theme: the panel has to show both, because
  // derivation produces two sets and only one of them is on screen elsewhere.
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  // Derived live from what is typed, through the same resolvers the two real
  // surfaces use — so this shows the actual outcome, not the input. Both
  // re-validate, so a half-typed hex simply previews the fallback.
  //
  // This is the only place raw color values belong in an inline style: they
  // ARE the subject. It exists because the sidebar value is one the operator
  // cannot predict — a dark brand is lightened to stay legible on a dark
  // sidebar, and spec §5.1 accepted that hue-preserving shift specifically on
  // the grounds that this preview would show it before saving.
  // The unthemed swatch below previews the PUBLIC FORM's Submit button, so it
  // goes through the public form's own resolver rather than resolveFormAccent.
  // M4b made those two answers differ: the form now lifts the brand colour
  // until it is visible on what it sits on and can carry a legible label, so
  // a colour in the dead luminance band (#8b5cf6 and its neighbours) renders
  // differently there than the raw value this used to show. A preview that
  // shows the input rather than the outcome is the thing this panel exists
  // not to be.
  //
  // Safe in a client component for the reason the module is written that way:
  // it is pure, and `Branding` crosses into it as a type only.
  const previewAccent = publicFormTheme({
    brandName: null, brandLogoPath: null, brandColor: color,
    brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
    replyToEmail: null,
  }, false).formAccent;
  const previewSidebar = resolveSidebarAccent(color);

  // The same function the shell calls, on the same inputs. A second
  // implementation here is exactly how a preview starts lying.
  const previewTheme = deriveTheme({
    color, neutral: (neutral || null) as NeutralName | null,
    corners: (corners || null) as CornerName | null,
    type: (typeface || null) as TypeName | null,
    mode: (mode || null) as ModeName | null,
  }, previewMode);

  return (
    <Card>
      <CardHeader>
        {/* The client's page is this panel and nothing else, and its
            PageHeader already prints the same string — rendering both put
            "Your branding" on screen twice, stacked. In Settings the panel is
            one card among several and needs its own heading. */}
        {audience === "agency" ? <CardTitle>{copy.title}</CardTitle> : null}
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={async (formData) => {
            // Refuse an oversized logo here, before the request leaves the
            // browser. Next caps a Server Action body at 1 MB and answers 413
            // itself, so for exactly the files our 512 KB rule exists to reject,
            // the action never ran and production showed a bare "something went
            // wrong" with no idea what to change. The server still enforces the
            // same limit twice — this is the message, not the guarantee.
            const picked = formData.get("logo");
            if (picked instanceof File && picked.size > MAX_LOGO_BYTES) {
              toast.error(m["branding.tooLarge"]);
              return;
            }
            // notifyActionResult so a stale-deployment tab's REJECTED save
            // toasts instead of vanishing (2026-08-29 calendar-settings,
            // live). The success callback keeps this form's extra step: the
            // file input remounts so a re-pick of the same file re-fires.
            await notifyActionResult(() => action(formData), {
              success: (msg) => { toast.success(msg); setFileKey((k) => k + 1); },
              error: toast.error,
            }, { success: m["branding.saved"], crashed: m["common.actionCrashed"] });
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="brand-name">{m["branding.name"]}</Label>
            <Input id="brand-name" name="brandName" defaultValue={brandName ?? ""} />
            <p className="text-xs text-muted-foreground">{copy.nameHint}</p>
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
            <Label htmlFor="reply-to-email">{m["branding.replyTo"]}</Label>
            {/* type="email" for the keyboard and the browser's own nudge only.
                The address is validated server-side in setBrandingAction: this
                is a client component and must not import @/lib/forms/guards,
                which pulls node:crypto into the browser bundle. */}
            <Input
              id="reply-to-email"
              name="replyToEmail"
              type="email"
              defaultValue={replyToEmail ?? ""}
            />
            <p className="text-xs text-muted-foreground">{copy.replyToHint}</p>
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
            <p className="text-xs text-muted-foreground">{copy.colorHint}</p>
          </div>

          <RadioRow
            legend={m["branding.neutral"]}
            name="brandNeutral"
            value={neutral}
            onChange={setNeutral}
            hint={copy.neutralHint}
            options={[
              ["", m["branding.themeDefault"]],
              ["warm", m["branding.neutralWarm"]],
              ["cool", m["branding.neutralCool"]],
              ["slate", m["branding.neutralSlate"]],
            ]}
          />
          <RadioRow
            legend={m["branding.corners"]}
            name="brandCorners"
            value={corners}
            onChange={setCorners}
            options={[
              ["", m["branding.themeDefault"]],
              ["sharp", m["branding.cornersSharp"]],
              ["soft", m["branding.cornersSoft"]],
              ["round", m["branding.cornersRound"]],
            ]}
          />
          <RadioRow
            legend={m["branding.type"]}
            name="brandType"
            value={typeface}
            onChange={setTypeface}
            options={[
              ["", m["branding.themeDefault"]],
              ["geist", m["branding.typeGeist"]],
              ["inter", m["branding.typeInter"]],
              ["serif", m["branding.typeSerif"]],
            ]}
          />
          <RadioRow
            legend={m["branding.mode"]}
            name="brandMode"
            value={mode}
            onChange={setMode}
            hint={copy.modeHint}
            options={[
              ["", m["branding.themeDefault"]],
              ["light", m["branding.modeLight"]],
              ["dark", m["branding.modeDark"]],
              ["follow", copy.modeFollow],
            ]}
          />

          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-card-foreground">{m["branding.colorPreview"]}</p>
              {/* Only shown when there is a derived theme to switch. With no
                  theme the preview below is the two-swatch fallback, which has
                  no light and dark form — a control that changes nothing is
                  worse than no control, because it reads as broken. */}
              {previewTheme ? (
                <div className="flex gap-2">
                  {(["light", "dark"] as const).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPreviewMode(pm)}
                      className={`rounded-md border px-2 py-0.5 text-xs ${
                        previewMode === pm ? "border-primary text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      {pm === "light" ? m["branding.previewLight"] : m["branding.previewDark"]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {previewTheme ? (
              // The derived tokens, scoped to this box. The specimen is the
              // only honest way to show a full theme: the operator is choosing
              // surfaces and type, not just an accent.
              <div
                data-testid="theme-specimen"
                style={themeStyle(previewTheme)}
                className="flex gap-3 rounded-md border border-border bg-background p-3"
              >
                <span
                  className="flex items-center gap-2 rounded-md px-3 py-2"
                  style={{ backgroundColor: previewTheme.sidebar }}
                >
                  <span className="h-4 w-1 rounded-r" style={{ backgroundColor: previewTheme.sidebarAccent }} />
                  <span className="text-xs" style={{ color: previewTheme.sidebarForeground }}>
                    {m["branding.previewSidebar"]}
                  </span>
                </span>
                <span className="flex-1 rounded-md border border-border bg-card p-3"
                      style={{ borderRadius: "var(--radius)", fontFamily: "var(--font-sans)" }}>
                  <span className="block text-sm font-medium text-card-foreground">{m["branding.previewHeading"]}</span>
                  <span className="block text-xs text-muted-foreground">{m["branding.previewBody"]}</span>
                  <span
                    className="mt-2 inline-block px-4 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: previewTheme.primary,
                      color: previewTheme.primaryForeground,
                      borderRadius: "var(--radius)",
                    }}
                  >
                    {m["branding.previewSubmit"]}
                  </span>
                </span>
              </div>
            ) : (
              // Colour-only, or nothing set: the two original swatches, because
              // that is still exactly what those accounts get.
              <div className="flex items-center gap-3">
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
            )}
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

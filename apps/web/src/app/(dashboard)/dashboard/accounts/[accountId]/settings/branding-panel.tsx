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
import { deriveTheme, type CornerName, type ModeName, type NeutralName, type TypeName } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";

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
  brandName,
  brandColor,
  brandNeutral,
  brandCorners,
  brandType,
  brandMode,
  logoUrl,
  action,
}: {
  brandName: string | null;
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
  const previewAccent = resolveFormAccent(color);
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

          <RadioRow
            legend={m["branding.neutral"]}
            name="brandNeutral"
            value={neutral}
            onChange={setNeutral}
            hint={m["branding.neutralHint"]}
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
            hint={m["branding.modeHint"]}
            options={[
              ["", m["branding.themeDefault"]],
              ["light", m["branding.modeLight"]],
              ["dark", m["branding.modeDark"]],
              ["follow", m["branding.modeFollow"]],
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

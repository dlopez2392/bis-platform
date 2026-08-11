# M4a Per-Tenant Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client company's workspace wears that company's design — surfaces, type, corners and colour — derived server-side from five stored inputs, with contrast guaranteed by construction.

**Architecture:** Four check-constrained enum columns join `accounts.brand_color`. A pure module turns those five inputs plus a resolved light/dark mode into a full token set, lifting the brand colour's lightness until it clears WCAG thresholds against each surface it lands on. The client workspace shell emits that set as CSS custom properties in a `style` attribute; the agency shell emits nothing and stays BIS.

**Tech Stack:** Next.js 16 App Router (RSC), React 19.2.4, Tailwind v4 (`@theme inline`), next-themes, Supabase/PostgREST, Clerk, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-09-per-tenant-theme-design.md`

## Global Constraints

- **Never put a tenant-controlled value into CSS text.** Tokens go in a `style` attribute only. React does not strip `;` from style values (verified against React 19.2.4), so every value is validated at the boundary; a generated `<style>` block loses React's entity-escaping and is out of scope by decision.
- **Contrast thresholds:** text ≥ 4.5:1, non-text UI ≥ 3:1 (WCAG 1.4.11). Enforced inside derivation, not by review.
- **Fail to default, never to unreadable** — the posture `resolveFormRadius` already takes.
- **The agency view never wears a client's brand.** The agency shell must emit no theme style attribute at all.
- **The sidebar does not invert.** `sidebar` comes from the dark end of the ladder in both modes; `globals.css` states this invariant and `lightenForSidebar` exists because of it.
- **Null in all five columns must reproduce today's rendering exactly**, and `brand_color` alone must keep PR #10's accents-only behaviour. The derived theme engages only when at least one of the four NEW inputs is set.
- Tests are run serially; all known flakes on this repo are contention. Never pipe a gate command through `grep`/`tail` — a pipe eats the exit code, which has hidden real failures on this repo twice.
- A file-level `"use server"` module may export **only** async functions. Constants and sync helpers go in a sibling module.

---

## File Structure

**Create:**
- `packages/db/supabase/migrations/0012_tenant_theme.sql` — four enum columns
- `apps/web/src/lib/branding/neutral-ramps.ts` — the three verified ladders (data only)
- `apps/web/src/lib/branding/theme.ts` — `ThemeInputs`, `ResolvedTheme`, `ensureContrast`, `deriveTheme`
- `apps/web/src/lib/branding/theme.test.ts` — unit + combinatorial contrast sweep
- `apps/web/src/lib/branding/theme-style.ts` — `ResolvedTheme` → validated custom-property map
- `apps/web/src/lib/branding/theme-style.test.ts`
- `apps/web/src/lib/branding/theme-mode.ts` — cookie name + `resolveThemeMode`
- `apps/web/src/lib/branding/theme-mode.test.ts`
- `apps/web/src/lib/branding/tenant-theme.ts` — one `cache()`d per-request read shared by both layouts
- `apps/web/src/components/theme-cookie-sync.tsx` — writes the resolved mode to a cookie
- `apps/web/e2e/tenant-theme.spec.ts`

**Modify:**
- `packages/db/src/branding.ts` — `Branding` type, `setBranding` input, `getBranding` select
- `packages/db/src/test/branding.test.ts` — existing `toEqual` assertions gain four nulls, plus new cases
- `packages/db/src/blueprints.ts:368` — blank `theme` on apply
- `packages/db/src/test/blueprints.test.ts` — assert it is blanked
- `apps/web/src/lib/forms/safe-theme.ts` — export the shared length validator
- `apps/web/src/app/(dashboard)/layout.tsx` — two more fonts, async, provider wiring
- `apps/web/src/components/theme-provider.tsx` — `enableSystem`, injectable default
- `apps/web/src/components/theme-toggle.tsx` — write the cookie on click
- `apps/web/src/app/(dashboard)/dashboard/layout.tsx` — emit the style attribute
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts` — parse four inputs
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx` — four controls + specimen preview
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` — pass the four values
- `apps/web/src/lib/messages.ts` — new strings
- `apps/web/e2e/auth.setup.ts:169` — the client fixture gains theme inputs

---

## Task 1: Migration and data layer

**Files:**
- Create: `packages/db/supabase/migrations/0012_tenant_theme.sql`
- Modify: `packages/db/src/branding.ts:71-75` (type), `:88-98` (setBranding), `:129-140` (getBranding)
- Test: `packages/db/src/test/branding.test.ts`

**Interfaces:**
- Produces: `Branding` gains `brandNeutral: "warm"|"cool"|"slate"|null`, `brandCorners: "sharp"|"soft"|"round"|null`, `brandType: "geist"|"inter"|"serif"|null`, `brandMode: "light"|"dark"|"follow"|null`. `setBranding`'s input object gains the same four as optional fields with the same `undefined` = leave-alone semantics.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0012_tenant_theme.sql`:

```sql
-- The four inputs that turn brand_color from an accent into a theme. All
-- nullable, like every branding column before them: null means unset, every
-- surface falls back, and applying this changes nothing for existing accounts.
--
-- Check constraints here, unlike 0011_brand_color.sql which deliberately kept
-- validation app-side. The difference is not a change of heart: brand_color is
-- a FORMAT (#rrggbb) that a future milestone might widen, while these four are
-- CLOSED SETS. A closed set in the column is the strongest available answer to
-- the finding in 2026-08-08-brand-color-design.md -- a tenant-controlled string
-- reaching a serialized style attribute can append arbitrary CSS declarations,
-- and migration 0006 grants a client `for all` on their own forms. For these
-- four inputs the database itself refuses to store the hostile value, so the
-- injection class is dead at the source rather than mitigated downstream.
alter table public.accounts
  add column brand_neutral text check (brand_neutral in ('warm','cool','slate')),
  add column brand_corners text check (brand_corners in ('sharp','soft','round')),
  add column brand_type    text check (brand_type    in ('geist','inter','serif')),
  add column brand_mode    text check (brand_mode    in ('light','dark','follow'));
```

- [ ] **Step 2: Apply it to the dev database**

Run: `cd packages/db && supabase db push --db-url "$SUPABASE_DB_URL"`
Expected: `Applying migration 0012_tenant_theme.sql...` then `Finished supabase db push.`

If `SUPABASE_DB_URL` is unset, `pnpm --filter @bis/db db:push` will fail silently on a missing env — it does not source `packages/db/.env`, a recorded gap. Export the variable in the shell first.

- [ ] **Step 3: Write the failing tests**

Add to `packages/db/src/test/branding.test.ts`:

```ts
  it("round-trips all four theme inputs", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, {
        brandNeutral: "warm", brandCorners: "round",
        brandType: "serif", brandMode: "dark",
      }, "user_test");

      expect(await getBranding(db, accountId)).toEqual({
        brandName: null, brandLogoPath: null, brandColor: null,
        brandNeutral: "warm", brandCorners: "round",
        brandType: "serif", brandMode: "dark",
      });
    });
  });

  // The security claim in the spec is "dead at the source". That is a claim
  // about the DATABASE, so it has to be proven by a write that is refused --
  // reading the migration proves nothing.
  it("refuses a value outside the closed set", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(setBranding(db, accountId,
        // The shape a hostile value would take: a real enum member with a
        // smuggled declaration behind a semicolon.
        { brandCorners: "round;position:fixed;inset:0" as never }, "user_test",
      )).rejects.toThrow(/setBranding failed/);

      expect((await getBranding(db, accountId)).brandCorners).toBeNull();
    });
  });
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @bis/db test -- branding.test.ts`
Expected: FAIL. The round-trip test fails because `getBranding` returns only three keys; the constraint test fails because `setBranding` does not forward `brandCorners`, so nothing is written and no error is raised.

- [ ] **Step 5: Extend the type**

In `packages/db/src/branding.ts`, replace the `Branding` type (lines 70-75):

```ts
/** What a surface needs to wear a company's brand. All null = not branded. */
export type Branding = {
  brandName: string | null;
  brandLogoPath: string | null;
  brandColor: string | null;
  brandNeutral: "warm" | "cool" | "slate" | null;
  brandCorners: "sharp" | "soft" | "round" | null;
  brandType: "geist" | "inter" | "serif" | null;
  brandMode: "light" | "dark" | "follow" | null;
};
```

- [ ] **Step 6: Extend setBranding**

Replace the signature and patch-building block (lines 88-98):

```ts
export async function setBranding(
  db: SupabaseClient,
  accountId: string,
  input: {
    brandName?: string | null; brandLogoPath?: string | null; brandColor?: string | null;
    brandNeutral?: Branding["brandNeutral"]; brandCorners?: Branding["brandCorners"];
    brandType?: Branding["brandType"]; brandMode?: Branding["brandMode"];
  },
  actorId: string,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.brandName !== undefined) patch.brand_name = input.brandName;
  if (input.brandLogoPath !== undefined) patch.brand_logo_path = input.brandLogoPath;
  if (input.brandColor !== undefined) patch.brand_color = input.brandColor;
  if (input.brandNeutral !== undefined) patch.brand_neutral = input.brandNeutral;
  if (input.brandCorners !== undefined) patch.brand_corners = input.brandCorners;
  if (input.brandType !== undefined) patch.brand_type = input.brandType;
  if (input.brandMode !== undefined) patch.brand_mode = input.brandMode;
  if (Object.keys(patch).length === 0) return;
```

Leave the rest of the function untouched — the `.select("id")` guard and the `emit` call are unchanged.

- [ ] **Step 7: Extend getBranding**

Replace its query and return (lines 132-139):

```ts
  const { data, error } = await db.from("accounts")
    .select("brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getBranding failed: ${error.message}`);
  return {
    brandName: data?.brand_name ?? null,
    brandLogoPath: data?.brand_logo_path ?? null,
    brandColor: data?.brand_color ?? null,
    brandNeutral: data?.brand_neutral ?? null,
    brandCorners: data?.brand_corners ?? null,
    brandType: data?.brand_type ?? null,
    brandMode: data?.brand_mode ?? null,
  };
```

- [ ] **Step 8: Fix the pre-existing assertions this widens**

`branding.test.ts` has three existing `toEqual({ brandName, brandLogoPath, brandColor })` assertions (around lines 13, 37, 57). `toEqual` is exact, so all three now fail. Add the four new keys as `null` to each — do **not** switch them to `toMatchObject`, because exactness is what caught a silent clear on this function before.

- [ ] **Step 9: Run the whole db suite**

Run: `pnpm --filter @bis/db test`
Expected: PASS, with the two new branding cases included. These tests hit the shared dev database through `withTestAccount`, so run them serially and do not run two copies at once.

- [ ] **Step 10: Commit**

```bash
git add packages/db/supabase/migrations/0012_tenant_theme.sql packages/db/src/branding.ts packages/db/src/test/branding.test.ts
git commit -m "feat(db): store the four per-tenant theme inputs as closed sets"
```

---

## Task 2: Stop copying a tenant's CSS across accounts

**Files:**
- Modify: `packages/db/src/blueprints.ts:368`
- Test: `packages/db/src/test/blueprints.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no signature change. `applyBlueprint` writes `theme: {}` for every form it creates.

Capture keeps carrying `theme` (line 154, 198) so the bundle format does not change and M4b can decide what to do with it. Only apply stops trusting it.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/test/blueprints.test.ts`, inside the existing apply describe block:

```ts
  // forms.theme is tenant-controlled CSS input, and migration 0006 grants a
  // client `for all` on their own forms. Cloning it verbatim carried one
  // tenant's style values into another account -- the notify_emails failure
  // mode by a different door, and the reachability half of the finding in
  // 2026-08-08-brand-color-design.md.
  it("does not carry a captured form theme into the target account", async () => {
    await withTestAccount(async (db, sourceId) => {
      const { id: formId } = await createForm(db, sourceId, "Themed form", "user_test");
      await updateForm(db, sourceId, formId, {
        theme: { mode: "dark", radius: "9px;position:fixed;inset:0" },
      }, "user_test");
      const bundle = await captureBlueprint(db, sourceId, "themed", "user_test");

      await withTestAccount(async (_db2, targetId) => {
        await applyBlueprint(db, targetId, bundle, "user_test");
        const { data } = await db.from("forms").select("theme").eq("account_id", targetId);
        expect(data).toHaveLength(1);
        expect(data![0]!.theme).toEqual({});
      });
    });
  });
```

Add a second case in the same block, pinning the other half of spec §7 — that a brand does not travel with a blueprint at all. Nothing in `blueprints.ts` selects the `brand_*` columns today, so this passes on the first run; it exists so a later milestone adding branding to a bundle has to argue with a red test instead of shipping one client dressed as another:

```ts
  it("leaves the target account's own branding alone", async () => {
    await withTestAccount(async (db, sourceId) => {
      await setBranding(db, sourceId, {
        brandName: "Rio Roofing", brandColor: "#1e3a8a", brandNeutral: "warm",
      }, "user_test");
      const bundle = await captureBlueprint(db, sourceId, "branded", "user_test");

      await withTestAccount(async (_db2, targetId) => {
        await applyBlueprint(db, targetId, bundle, "user_test");
        expect(await getBranding(db, targetId)).toEqual({
          brandName: null, brandLogoPath: null, brandColor: null,
          brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
        });
      });
    });
  });
```

This one needs `setBranding` and `getBranding` imported into `blueprints.test.ts`.

Check the surrounding block for the exact helper names and argument order used by neighbouring apply tests (`captureBlueprint`/`applyBlueprint` signatures and whether a bundle is passed by value or re-read); match them rather than the shapes above if they differ.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bis/db test -- blueprints.test.ts`
Expected: FAIL — received `{ mode: "dark", radius: "9px;position:fixed;inset:0" }`, the source account's values on another account's form.

- [ ] **Step 3: Blank it on apply**

In `packages/db/src/blueprints.ts`, at the form insert (line 368), change `theme: f.theme` to `theme: {}` and put the reason above it:

```ts
        name: f.name, status: "draft", fields: f.fields,
        // NOT f.theme. Theme values are tenant-controlled CSS input that
        // reaches a style attribute; carrying them across accounts is the same
        // class of leak as cloning notify_emails, and it is how a hostile
        // radius became reachable in the first place. A form applied from a
        // blueprint inherits its own account's brand instead.
        theme: {},
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bis/db test -- blueprints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/blueprints.ts packages/db/src/test/blueprints.test.ts
git commit -m "fix(blueprints): stop copying a tenant's form theme across accounts"
```

---

## Task 3: The neutral ladders and the derivation

**Files:**
- Create: `apps/web/src/lib/branding/neutral-ramps.ts`, `apps/web/src/lib/branding/theme.ts`
- Modify: `apps/web/src/lib/branding/color.ts` — add `ensureContrast` beside the private helpers it needs
- Test: `apps/web/src/lib/branding/theme.test.ts`, `apps/web/src/lib/branding/color.test.ts`

**Interfaces:**
- Consumes: `parseHexColor`, `contrastRatio`, `readableTextOn` from `@/lib/branding/color`.
- Produces:
  - `NEUTRAL_RAMPS: Record<NeutralName, Ramp>`
  - `ensureContrast(hex: string, against: string, target: number): string | null` — **exported from `color.ts`, not `theme.ts`**
  - `deriveTheme(inputs: ThemeInputs, mode: "light" | "dark"): ResolvedTheme | null`
  - types `NeutralName`, `CornerName`, `TypeName`, `ModeName`, `ThemeInputs`, `ResolvedTheme`

**Decision taken before execution:** `ensureContrast` lives in `color.ts`. It is colour math, and the four helpers it needs — `channels`, `rgbToHsl`, `hueToRgb`, `hslToHex` — are already private there. Copying them into `theme.ts` would duplicate a logic block verbatim. **Do not rewrite `lightenForSidebar` in terms of it**: that function's `0.95` lightness ceiling and upward-only walk are pinned by existing tests in `color.test.ts`, and re-expressing it is a behaviour change disguised as a cleanup. Leave it exactly as it is, directly above its own generalization, so the overlap is visible to the next reader.

Every value below was verified numerically before this plan was written: all three ladders clear fg/bg at 16–17:1, muted text at 5.8–6.9:1 on card while staying quieter than the primary foreground, and sidebar text at over 12:1. **Do not retune these by eye** — the sweep in Step 5 is what holds them.

- [ ] **Step 1: Write the ramp table**

Create `apps/web/src/lib/branding/neutral-ramps.ts`:

```ts
/**
 * The three neutral ladders a tenant picks between. Chosen values, not
 * computed ones: a derived grey scale is one more thing to be subtly wrong,
 * and these are pinned by the contrast sweep in theme.test.ts.
 *
 * `sidebar` and `sidebarBorder` sit outside the light/dark split on purpose.
 * globals.css states the sidebar is dark in BOTH themes and does not invert,
 * and lightenForSidebar exists precisely because a dark brand scores 1.62:1
 * there. A light-mode tenant with a light sidebar would silently move the
 * background the 3:1 accent guarantee is measured against.
 */
export type NeutralName = "warm" | "cool" | "slate";

export type RampSteps = {
  bg: string; card: string; subtle: string;
  border: string; mutedFg: string; fg: string;
};

export type Ramp = {
  light: RampSteps;
  dark: RampSteps;
  sidebar: string;
  sidebarBorder: string;
};

export const NEUTRAL_RAMPS: Record<NeutralName, Ramp> = {
  slate: {
    light: { bg: "#f8fafc", card: "#ffffff", subtle: "#eef2f7", border: "#dde3ea", mutedFg: "#5b6673", fg: "#0f172a" },
    dark:  { bg: "#0d1117", card: "#161b22", subtle: "#20262e", border: "#2c333c", mutedFg: "#9aa4b2", fg: "#e8edf3" },
    sidebar: "#111721", sidebarBorder: "#232b36",
  },
  warm: {
    light: { bg: "#faf9f7", card: "#ffffff", subtle: "#f2efea", border: "#e3ded6", mutedFg: "#6b6357", fg: "#1c1917" },
    dark:  { bg: "#12100e", card: "#1b1815", subtle: "#262220", border: "#332e2a", mutedFg: "#a8a09a", fg: "#f0ebe6" },
    sidebar: "#171310", sidebarBorder: "#2a2420",
  },
  cool: {
    light: { bg: "#f7f9fb", card: "#ffffff", subtle: "#eaf0f6", border: "#d8e1ea", mutedFg: "#556475", fg: "#101a24" },
    dark:  { bg: "#0b1016", card: "#141b23", subtle: "#1e262f", border: "#2a333e", mutedFg: "#93a2b3", fg: "#e6edf4" },
    sidebar: "#0e141c", sidebarBorder: "#202932",
  },
};

/** Unchanged from globals.css: the sidebar's text is the same in both themes. */
export const SIDEBAR_FOREGROUND = "#d4d4d8";
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/branding/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio } from "./color";
import { NEUTRAL_RAMPS, type NeutralName } from "./neutral-ramps";
import { deriveTheme, type CornerName, type TypeName } from "./theme";

const NEUTRALS: NeutralName[] = ["warm", "cool", "slate"];
const CORNERS: CornerName[] = ["sharp", "soft", "round"];
const TYPES: TypeName[] = ["geist", "inter", "serif"];
const MODES = ["light", "dark"] as const;

// Black and white are the interesting ones: an achromatic input can only move
// along lightness, and white has to DARKEN on a light background while black
// has to lighten. A one-directional walk passes the rest and fails these two.
const ADVERSARIAL = [null, "#000000", "#ffffff", "#fde047", "#808080", "#1e3a8a", "#6d28d9"];

describe("deriveTheme", () => {
  it("returns null when nothing is set, so today's rendering is untouched", () => {
    expect(deriveTheme(
      { color: null, neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  // PR #10 shipped brand_color as accents-only. An agency that set just a
  // colour must not find its clients' chrome repainted by a deploy.
  it("returns null for a colour with no other input", () => {
    expect(deriveTheme(
      { color: "#1e3a8a", neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  it("engages as soon as one of the four new inputs is set", () => {
    const t = deriveTheme(
      { color: null, neutral: "warm", corners: null, type: null, mode: null }, "light",
    );
    expect(t?.background).toBe(NEUTRAL_RAMPS.warm.light.bg);
  });

  it("keeps the sidebar dark in light mode", () => {
    const light = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "light",
    );
    const dark = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "dark",
    );
    expect(light?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
    expect(dark?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
  });

  it("maps corners to concrete lengths", () => {
    const of = (corners: CornerName) => deriveTheme(
      { color: null, neutral: "slate", corners, type: null, mode: null }, "light",
    )?.radius;
    expect(of("sharp")).toBe("0.125rem");
    expect(of("soft")).toBe("0.625rem");
    expect(of("round")).toBe("1rem");
  });

  it("maps type to a font variable from a closed set", () => {
    const of = (type: TypeName) => deriveTheme(
      { color: null, neutral: "slate", corners: null, type, mode: null }, "light",
    )?.fontSans;
    expect(of("geist")).toBe("var(--font-geist-sans)");
    expect(of("inter")).toBe("var(--font-inter)");
    expect(of("serif")).toBe("var(--font-source-serif)");
  });

  it("ignores a colour that is not a real hex", () => {
    const t = deriveTheme(
      { color: "red; position:fixed", neutral: "slate", corners: null, type: null, mode: null },
      "light",
    );
    expect(t?.primary).toBe("#7c3aed"); // the BIS light default, not the input
  });

  // The whole point of the milestone: no combination of stored inputs can
  // produce an illegible screen.
  it("clears every contrast threshold for every combination", () => {
    for (const neutral of NEUTRALS)
      for (const corners of CORNERS)
        for (const type of TYPES)
          for (const mode of MODES)
            for (const color of ADVERSARIAL) {
              const t = deriveTheme({ color, neutral, corners, type, mode: null }, mode)!;
              const where = `${neutral}/${corners}/${type}/${mode}/${color}`;

              // text
              expect(contrastRatio(t.foreground, t.background), `fg on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.cardForeground, t.card), `card fg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.background), `muted on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.card), `muted on card ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.secondaryForeground, t.secondary), `secondary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.primaryForeground, t.primary), `on primary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.accentForeground, t.accent), `on accent ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.sidebarForeground, t.sidebar), `sidebar text ${where}`).toBeGreaterThanOrEqual(4.5);

              // non-text UI
              expect(contrastRatio(t.primary, t.card), `primary on card ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.ring, t.background), `ring on bg ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.ring, t.card), `ring on card ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.sidebarAccent, t.sidebar), `sidebar accent ${where}`).toBeGreaterThanOrEqual(3);

              // hierarchy: muted text must stay quieter than primary text
              expect(contrastRatio(t.mutedForeground, t.background), `muted quieter ${where}`)
                .toBeLessThan(contrastRatio(t.foreground, t.background));
            }
  });
});

```

And append this block to the EXISTING `apps/web/src/lib/branding/color.test.ts`, since `ensureContrast` ships in `color.ts` (see the decision above). It needs `ensureContrast` added to that file's existing import from `./color`:

```ts
describe("ensureContrast", () => {
  it("lightens a dark colour on a dark surface", () => {
    const out = ensureContrast("#1e3a8a", "#111721", 3)!;
    expect(contrastRatio(out, "#111721")).toBeGreaterThanOrEqual(3);
    expect(out).not.toBe("#1e3a8a");
  });

  it("darkens a light colour on a light surface", () => {
    const out = ensureContrast("#ffffff", "#f8fafc", 3)!;
    expect(contrastRatio(out, "#f8fafc")).toBeGreaterThanOrEqual(3);
  });

  it("returns the input untouched when it already clears", () => {
    expect(ensureContrast("#000000", "#ffffff", 3)).toBe("#000000");
  });

  // A synthetic target, NOT one of the ramps: every real ladder can lift every
  // adversarial colour to 3:1 (verified), so no ramp value reaches this branch.
  // Asserting it against a real surface would produce a test that passes for
  // the wrong reason and invites someone to "fix" working code.
  it("gives up rather than returning something unreadable", () => {
    expect(ensureContrast("#808080", "#808080", 21)).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter web test -- theme.test.ts`
Expected: FAIL, `Failed to resolve import "./theme"`.

- [ ] **Step 4: Add `ensureContrast` to `color.ts`**

Append to `apps/web/src/lib/branding/color.ts`, directly below `lightenForSidebar` so the two sit together. `lightenForSidebar` itself is **not** touched — its `LIGHTEN_CEILING` of 0.95 and upward-only walk are pinned by that file's existing tests, and re-expressing it in terms of this function would be a behaviour change wearing a cleanup's clothes:

```ts
const CONTRAST_STEP = 0.02;

/**
 * Walks lightness until `hex` clears `target` against `against`, preserving
 * hue and saturation exactly — a dark navy becomes a lighter navy, never a
 * more convenient hue.
 *
 * The general form of lightenForSidebar above, which does the same walk
 * against one hardcoded background. It lives here rather than in theme.ts
 * because the channel and HSL helpers it needs are already here, and copying
 * them would duplicate a logic block verbatim.
 *
 * Tries the direction with more headroom first, then the other: a near-white
 * brand on a light background has to DARKEN, and a single upward walk is
 * exactly why an earlier draft reported pure white as unliftable.
 *
 * Returns null when neither direction reaches the target, so the caller can
 * fall back to a default rather than ship something unreadable.
 */
export function ensureContrast(hex: string, against: string, target: number): string | null {
  if (contrastRatio(hex, against) >= target) return hex;
  const [h, s, start] = rgbToHsl(...channels(hex));
  const directions = 1 - start >= start ? [1, -1] : [-1, 1];
  for (const dir of directions) {
    let l = start;
    let out = hex;
    for (let i = 0; i < 100 && contrastRatio(out, against) < target; i++) {
      const next = l + dir * CONTRAST_STEP;
      if (next > 1 || next < 0) break;
      l = next;
      out = hslToHex(h, s, l);
    }
    if (contrastRatio(out, against) >= target) return out;
  }
  return null;
}
```

Then write the derivation. Create `apps/web/src/lib/branding/theme.ts`:

```ts
/**
 * Turns the five stored inputs into a full token set.
 *
 * Pure and I/O-free, the same contract color.ts holds and for the same
 * reason: a hook body cannot be tested in this repo, so every decision that
 * matters lives in a function that can be. The combinatorial sweep in
 * theme.test.ts is what makes "an unreadable screen is impossible" a fact
 * rather than an intention.
 */
import { contrastRatio, ensureContrast, parseHexColor, readableTextOn } from "./color";
import { NEUTRAL_RAMPS, SIDEBAR_FOREGROUND, type NeutralName } from "./neutral-ramps";

export type { NeutralName };
export type CornerName = "sharp" | "soft" | "round";
export type TypeName = "geist" | "inter" | "serif";
export type ModeName = "light" | "dark" | "follow";

export type ThemeInputs = {
  color: string | null;
  neutral: NeutralName | null;
  corners: CornerName | null;
  type: TypeName | null;
  mode: ModeName | null;
};

export type ResolvedTheme = {
  background: string; foreground: string;
  card: string; cardForeground: string;
  popover: string; popoverForeground: string;
  primary: string; primaryForeground: string;
  secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string;
  accent: string; accentForeground: string;
  border: string; input: string; ring: string;
  sidebar: string; sidebarForeground: string;
  sidebarAccent: string; sidebarBorder: string;
  radius: string;
  fontSans: string;
};

const RADIUS: Record<CornerName, string> = {
  sharp: "0.125rem", soft: "0.625rem", round: "1rem",
};

/** A closed set, so this never carries user text into a CSS value. */
const FONT: Record<TypeName, string> = {
  geist: "var(--font-geist-sans)",
  inter: "var(--font-inter)",
  serif: "var(--font-source-serif)",
};

/** What globals.css uses today, per mode. Every fallback lands here. */
const BIS = {
  light: { primary: "#7c3aed", accent: "#0891b2", ring: "#7c3aed", sidebarAccent: "#8b5cf6" },
  dark:  { primary: "#8b5cf6", accent: "#22d3ee", ring: "#8b5cf6", sidebarAccent: "#a78bfa" },
} as const;

/**
 * Null means "emit nothing" — the shell then renders exactly the tokens
 * globals.css already sets, byte for byte.
 *
 * A colour on its own also returns null: PR #10 shipped brand_color as
 * accents-only through AppSidebar's own prop, and an agency that set only a
 * colour must not discover its clients' chrome repainted by a deploy. The
 * theme engages when the agency picks one of the four newer inputs.
 */
export function deriveTheme(
  inputs: ThemeInputs,
  mode: "light" | "dark",
): ResolvedTheme | null {
  if (!inputs.neutral && !inputs.corners && !inputs.type && !inputs.mode) return null;

  const ramp = NEUTRAL_RAMPS[inputs.neutral ?? "slate"];
  const steps = ramp[mode];
  const bis = BIS[mode];
  const brand = parseHexColor(inputs.color);

  // Each accent lands on a different surface, so each is lifted against the
  // surface it actually sits on rather than against one representative.
  const primary = (brand && ensureContrast(brand, steps.card, 3)) ?? bis.primary;
  const accent = (brand && ensureContrast(brand, steps.card, 3)) ?? bis.accent;
  const sidebarAccent = (brand && ensureContrast(brand, ramp.sidebar, 3)) ?? bis.sidebarAccent;

  // The ring appears on both the page background and on cards, so clearing
  // one is not enough: lift against the background, then lift the result
  // again if the card is the harder of the two.
  let ring = (brand && ensureContrast(brand, steps.bg, 3)) ?? bis.ring;
  if (contrastRatio(ring, steps.card) < 3) {
    ring = ensureContrast(ring, steps.card, 3) ?? bis.ring;
  }

  return {
    background: steps.bg,
    foreground: steps.fg,
    card: steps.card,
    cardForeground: steps.fg,
    popover: steps.card,
    popoverForeground: steps.fg,
    primary,
    primaryForeground: readableTextOn(primary),
    secondary: steps.subtle,
    secondaryForeground: steps.fg,
    muted: steps.subtle,
    // Deliberately NOT readableTextOn: that snaps to maximum contrast and
    // would erase the hierarchy muted text exists to create. The ramp's own
    // step is quieter than the foreground and still clears 4.5:1, which the
    // sweep asserts both ways.
    mutedForeground: steps.mutedFg,
    accent,
    accentForeground: readableTextOn(accent),
    border: steps.border,
    input: steps.border,
    ring,
    sidebar: ramp.sidebar,
    sidebarForeground: SIDEBAR_FOREGROUND,
    sidebarAccent,
    sidebarBorder: ramp.sidebarBorder,
    radius: RADIUS[inputs.corners ?? "soft"],
    fontSans: FONT[inputs.type ?? "geist"],
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web test -- theme.test.ts`
Expected: PASS, including the sweep (3 × 3 × 3 × 2 × 7 = 378 derivations).

If the sweep fails on a specific combination, the ramp is wrong, not the threshold. Do not lower a threshold to make it pass.

- [ ] **Step 6: Mutation-check the sweep**

Temporarily change `mutedForeground: steps.mutedFg` to `mutedForeground: steps.border`, run the sweep, and confirm it FAILS on the muted-on-card assertion. Then revert. A sweep that passes either way is proving nothing — this repo has shipped tests that survived deleting the code they covered.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/branding/neutral-ramps.ts apps/web/src/lib/branding/theme.ts apps/web/src/lib/branding/theme.test.ts apps/web/src/lib/branding/color.ts apps/web/src/lib/branding/color.test.ts
git commit -m "feat(branding): derive a full token set from five inputs with contrast guaranteed"
```

---

## Task 4: Serialize the token set safely

**Files:**
- Create: `apps/web/src/lib/branding/theme-style.ts`, `apps/web/src/lib/branding/theme-style.test.ts`
- Modify: `apps/web/src/lib/forms/safe-theme.ts`

**Interfaces:**
- Consumes: `ResolvedTheme` from Task 3.
- Produces: `themeStyle(theme: ResolvedTheme): React.CSSProperties` — a custom-property map ready to spread into a `style` prop. `safe-theme.ts` additionally exports `resolveCssLength(value, fallback)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/branding/theme-style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveTheme } from "./theme";
import { themeStyle } from "./theme-style";

const theme = deriveTheme(
  { color: "#1e3a8a", neutral: "slate", corners: "round", type: "serif", mode: null },
  "light",
)!;

describe("themeStyle", () => {
  it("emits every token as a CSS custom property", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--background"]).toBe("#f8fafc");
    expect(style["--radius"]).toBe("1rem");
    expect(style["--font-sans"]).toBe("var(--font-source-serif)");
    expect(style["--sidebar-accent"]).toBe(theme.sidebarAccent);
  });

  // --radius-sm/md/lg are defined in globals.css as calc() over var(--radius).
  // Custom properties are substituted per element, so overriding --radius is
  // enough and re-emitting the derived ones would be a second source of truth.
  it("does not re-emit the radii globals.css derives", () => {
    const style = themeStyle(theme) as Record<string, string>;
    expect(style["--radius-sm"]).toBeUndefined();
    expect(style["--radius-lg"]).toBeUndefined();
  });

  // Spec §4.2: status colours carry meaning and pipeline stages are semantic
  // identity, so neither is a tenant's to set. Emitting them at all would let
  // a future edit make a red stop reading as red.
  it("never emits the tokens that are not a tenant's to set", () => {
    const style = themeStyle(theme) as Record<string, string>;
    for (const token of ["--destructive", "--success", "--warning",
                         "--stage-1", "--stage-2", "--stage-3",
                         "--stage-4", "--stage-5", "--stage-6"]) {
      expect(style[token], token).toBeUndefined();
    }
  });

  // Defence in depth. Nothing should be able to reach this function with a
  // hostile value -- four inputs are DB-constrained and the colour is
  // hex-validated -- but this is the last gate before a style attribute, and
  // the whole finding was that a value here can append CSS declarations.
  it("drops a value that is not a plain colour or length", () => {
    const hostile = { ...theme, background: "#fff;position:fixed;inset:0", radius: "9px;color:red" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#f8f8fb"); // BIS light default
    expect(style["--radius"]).toBe("0.625rem");
  });

  it("rejects even valid CSS it cannot prove is declaration-free", () => {
    const hostile = { ...theme, background: "var(--x)", radius: "calc(1rem + 2px)" };
    const style = themeStyle(hostile) as Record<string, string>;
    expect(style["--background"]).toBe("#f8f8fb");
    expect(style["--radius"]).toBe("0.625rem");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- theme-style.test.ts`
Expected: FAIL, `Failed to resolve import "./theme-style"`.

- [ ] **Step 3: Export the shared length validator**

In `apps/web/src/lib/forms/safe-theme.ts`, add below `resolveFormRadius` (keeping that function and its doc comment exactly as they are, since the public form calls it):

```ts
/**
 * The same rule resolveFormRadius applies, with the caller's fallback. Shared
 * rather than reimplemented: one place decides what a safe CSS length is.
 */
export function resolveCssLength(value: string | undefined | null, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  return CSS_LENGTH.test(v) ? v : fallback;
}
```

- [ ] **Step 4: Write the serializer**

Create `apps/web/src/lib/branding/theme-style.ts`:

```ts
/**
 * The last gate before a tenant's values reach the DOM.
 *
 * React serializes a style object into a style ATTRIBUTE and does not strip
 * `;` (verified against React 19.2.4), so a value here can append arbitrary
 * further CSS declarations to the element. Nothing should be able to arrive
 * hostile — four of the five inputs are closed sets the database enforces and
 * the fifth is hex-validated — but "should not" is not a guarantee, and this
 * function is cheap.
 */
import type { CSSProperties } from "react";
import { parseHexColor } from "./color";
import { resolveCssLength } from "@/lib/forms/safe-theme";
import type { ResolvedTheme } from "./theme";

/** globals.css's own light values, used when a token fails validation. */
const SAFE = {
  color: "#f8f8fb",
  radius: "0.625rem",
  fontSans: "var(--font-geist-sans)",
} as const;

const FONT_ALLOWLIST = new Set([
  "var(--font-geist-sans)", "var(--font-inter)", "var(--font-source-serif)",
]);

const c = (v: string) => parseHexColor(v) ?? SAFE.color;

export function themeStyle(theme: ResolvedTheme): CSSProperties {
  return {
    "--background": c(theme.background),
    "--foreground": c(theme.foreground),
    "--card": c(theme.card),
    "--card-foreground": c(theme.cardForeground),
    "--popover": c(theme.popover),
    "--popover-foreground": c(theme.popoverForeground),
    "--primary": c(theme.primary),
    "--primary-foreground": c(theme.primaryForeground),
    "--secondary": c(theme.secondary),
    "--secondary-foreground": c(theme.secondaryForeground),
    "--muted": c(theme.muted),
    "--muted-foreground": c(theme.mutedForeground),
    "--accent": c(theme.accent),
    "--accent-foreground": c(theme.accentForeground),
    "--border": c(theme.border),
    "--input": c(theme.input),
    "--ring": c(theme.ring),
    "--sidebar": c(theme.sidebar),
    "--sidebar-foreground": c(theme.sidebarForeground),
    "--sidebar-accent": c(theme.sidebarAccent),
    "--sidebar-border": c(theme.sidebarBorder),
    // Not re-emitting --radius-sm/md/lg: globals.css derives them with calc()
    // over var(--radius), and custom properties are substituted per element,
    // so overriding the base is enough.
    "--radius": resolveCssLength(theme.radius, SAFE.radius),
    // An allowlist rather than a pattern. This value is a var() reference,
    // which resolveCssLength correctly refuses, and it never contains user
    // text -- deriveTheme builds it from a closed set.
    "--font-sans": FONT_ALLOWLIST.has(theme.fontSans) ? theme.fontSans : SAFE.fontSans,
  } as CSSProperties;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web test -- theme-style.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the public form still passes**

Run: `pnpm --filter web test -- safe-theme.test.ts`
Expected: PASS — `resolveFormRadius` was not modified, only added beside.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/branding/theme-style.ts apps/web/src/lib/branding/theme-style.test.ts apps/web/src/lib/forms/safe-theme.ts
git commit -m "feat(branding): validate every token on its way to the style attribute"
```

---

## Task 5: Resolve which mode the server should paint

**Files:**
- Create: `apps/web/src/lib/branding/theme-mode.ts`, `apps/web/src/lib/branding/theme-mode.test.ts`

**Interfaces:**
- Produces: `THEME_COOKIE = "bis-theme"`, `resolveThemeMode(cookie: string | undefined, brandMode: ModeName | null): { serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system" }`

`serverMode` decides which token set is emitted. `providerDefault` is handed to next-themes so its `.dark` class agrees with those tokens on the first paint. They are returned together because they must be decided from the same two facts — computing them in two places is how they would drift.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/branding/theme-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveThemeMode, THEME_COOKIE } from "./theme-mode";

describe("resolveThemeMode", () => {
  it("lets the user's stored choice win over the tenant default", () => {
    expect(resolveThemeMode("light", "dark")).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode("dark", "light")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("falls back to the tenant default with no cookie", () => {
    expect(resolveThemeMode(undefined, "dark")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("falls back to light with neither", () => {
    expect(resolveThemeMode(undefined, null)).toEqual({ serverMode: "light", providerDefault: "light" });
  });

  // The one honest wrinkle in the spec: the server cannot know the OS
  // preference, so it paints light and hands next-themes "system" to correct
  // on mount. One frame, once per browser -- the cookie sync writes on resolve.
  it("paints light but defers to the OS when the tenant says follow", () => {
    expect(resolveThemeMode(undefined, "follow")).toEqual({ serverMode: "light", providerDefault: "system" });
  });

  it("still lets a stored choice beat follow", () => {
    expect(resolveThemeMode("dark", "follow")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });

  it("ignores a cookie value that is not a mode", () => {
    expect(resolveThemeMode("dark;position:fixed", "light")).toEqual({ serverMode: "light", providerDefault: "light" });
  });

  it("names the cookie", () => {
    expect(THEME_COOKIE).toBe("bis-theme");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- theme-mode.test.ts`
Expected: FAIL, `Failed to resolve import "./theme-mode"`.

- [ ] **Step 3: Write the resolver**

Create `apps/web/src/lib/branding/theme-mode.ts`:

```ts
/**
 * Which mode the server paints, and what next-themes must agree with.
 *
 * next-themes stores the user's choice in localStorage, which a server
 * component cannot read — so without a cookie the server cannot know which of
 * the two token sets to emit, and every navigation flashes the wrong theme.
 * The cookie exists for that one reason. Sidebar collapse is already
 * cookie-persisted, so this follows the house pattern.
 */
import type { ModeName } from "./theme";

export const THEME_COOKIE = "bis-theme";

export function resolveThemeMode(
  cookie: string | undefined,
  brandMode: ModeName | null,
): { serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system" } {
  if (cookie === "light" || cookie === "dark") {
    return { serverMode: cookie, providerDefault: cookie };
  }
  if (brandMode === "light" || brandMode === "dark") {
    return { serverMode: brandMode, providerDefault: brandMode };
  }
  if (brandMode === "follow") {
    return { serverMode: "light", providerDefault: "system" };
  }
  return { serverMode: "light", providerDefault: "light" };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter web test -- theme-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/branding/theme-mode.ts apps/web/src/lib/branding/theme-mode.test.ts
git commit -m "feat(branding): resolve the paintable mode from cookie then tenant default"
```

---

## Task 6: Fonts, provider, and the cookie the toggle writes

**Files:**
- Create: `apps/web/src/components/theme-cookie-sync.tsx`
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`, `apps/web/src/components/theme-provider.tsx`, `apps/web/src/components/theme-toggle.tsx`

**Interfaces:**
- Consumes: `THEME_COOKIE` from Task 5.
- Produces: `ThemeProvider` accepts `defaultTheme?: "light" | "dark" | "system"`. `<ThemeCookieSync />` keeps the cookie equal to the resolved mode.

- [ ] **Step 1: Load the two new families**

In `apps/web/src/app/(dashboard)/layout.tsx`, extend the font import and add two loaders beside the existing ones:

```ts
import { Geist, Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";
```

```ts
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// A serif that holds up at table-row sizes, not a display face. Swappable:
// deriveTheme names it in one place (FONT.serif) and this is the other.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});
```

Add both variables to the `<html>` className:

```tsx
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} h-full antialiased`}
```

Declaring a family costs nothing until something paints with it — a browser fetches only the face it actually uses, so a tenant pays for one.

- [ ] **Step 2: Make the layout async and read the cookie**

Still in `apps/web/src/app/(dashboard)/layout.tsx`, import `cookies`, `resolveThemeMode` and `THEME_COOKIE`, then make the component async and resolve the provider default:

```tsx
import { cookies } from "next/headers";
import { resolveThemeMode, THEME_COOKIE } from "@/lib/branding/theme-mode";
```

```tsx
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Only the cookie is read here. This layout also wraps /sign-in and
  // /no-access, where there is no tenant to ask, and the tenant's own default
  // reaches next-themes through the cookie the sync below writes on first
  // resolve. The dashboard layout resolves the same two facts through the same
  // function, so the tokens it emits and the class next-themes sets agree.
  const cookieStore = await cookies();
  const { providerDefault } = resolveThemeMode(
    cookieStore.get(THEME_COOKIE)?.value, null,
  );
```

and pass it down:

```tsx
          <ThemeProvider defaultTheme={providerDefault}>
```

- [ ] **Step 3: Accept the default in the provider**

Replace `apps/web/src/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ThemeCookieSync } from "@/components/theme-cookie-sync";

export function ThemeProvider({
  children,
  defaultTheme = "light",
}: {
  children: React.ReactNode;
  /** Resolved server-side from the cookie, so the first paint matches the
   *  token set the dashboard shell emitted. */
  defaultTheme?: "light" | "dark" | "system";
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      // On, so a tenant's brand_mode = 'follow' means something. It was off
      // when the toggle shipped in PR #2 and there was nothing to follow.
      enableSystem
      disableTransitionOnChange
    >
      <ThemeCookieSync />
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 4: Write the cookie sync**

Create `apps/web/src/components/theme-cookie-sync.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { THEME_COOKIE } from "@/lib/branding/theme-mode";

/**
 * Keeps the cookie equal to whatever next-themes actually resolved, so the
 * next request paints the right token set on the server.
 *
 * An effect is the only place the resolved value exists — with
 * enableSystem on, "system" is not known until the browser answers. This
 * effect sets no state, which is what keeps it clear of
 * react-hooks/set-state-in-effect, the rule that shaped the toggle's icon
 * handling in PR #2. Renders nothing.
 */
export function ThemeCookieSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    document.cookie = `${THEME_COOKIE}=${resolvedTheme}; path=/; max-age=31536000; samesite=lax`;
  }, [resolvedTheme]);

  return null;
}
```

- [ ] **Step 5: Write the cookie on click too**

In `apps/web/src/components/theme-toggle.tsx`, replace the `onClick` so the cookie is written in the same gesture rather than a frame later:

```tsx
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        // The sync effect would also catch this, but writing it here means the
        // very next request is correct even if the user navigates immediately.
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
```

and add the import:

```tsx
import { THEME_COOKIE } from "@/lib/branding/theme-mode";
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter web typecheck`
Expected: no output, exit 0.

Run: `pnpm --filter web lint`
Expected: no errors. If `react-hooks/set-state-in-effect` fires, the effect is setting state — it must only touch `document.cookie`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/layout.tsx apps/web/src/components/theme-provider.tsx apps/web/src/components/theme-cookie-sync.tsx apps/web/src/components/theme-toggle.tsx
git commit -m "feat(web): load the two brand fonts and persist the resolved mode in a cookie"
```

---

## Task 7: Emit the theme on the client workspace shell

**Files:**
- Create: `apps/web/src/lib/branding/tenant-theme.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx:109-137`

**Interfaces:**
- Consumes: `deriveTheme`, `themeStyle`, `resolveThemeMode`, `THEME_COOKIE`, `Branding`.
- Produces: `themeInputsFrom(branding: Branding): ThemeInputs` — the one place the DB shape becomes the derivation shape.

- [ ] **Step 1: Write the mapper**

Create `apps/web/src/lib/branding/tenant-theme.ts`:

```ts
/**
 * The DB row shape to the derivation shape, in one place. Both the shell and
 * the Settings preview go through this, so neither can invent its own mapping.
 */
import type { Branding } from "@bis/db";
import type { ThemeInputs } from "./theme";

export function themeInputsFrom(branding: Branding | null): ThemeInputs {
  return {
    color: branding?.brandColor ?? null,
    neutral: branding?.brandNeutral ?? null,
    corners: branding?.brandCorners ?? null,
    type: branding?.brandType ?? null,
    mode: branding?.brandMode ?? null,
  };
}
```

- [ ] **Step 2: Emit it in the shell**

In `apps/web/src/app/(dashboard)/dashboard/layout.tsx`, add the imports:

```ts
import { deriveTheme } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";
import { themeInputsFrom } from "@/lib/branding/tenant-theme";
import { resolveThemeMode, THEME_COOKIE } from "@/lib/branding/theme-mode";
```

After the existing `const collapsed = ...` line (which already has `cookieStore` in hand, so this costs no new read):

```tsx
  // The agency's chrome stays BIS. Not by a conditional inside the derivation
  // -- by never having a theme to emit, so there is no branch to invert later.
  const inputs = themeInputsFrom(branding);
  const { serverMode } = resolveThemeMode(
    cookieStore.get(THEME_COOKIE)?.value,
    inputs.mode,
  );
  const theme = deriveTheme(inputs, serverMode);
```

Then give the outer wrapper the style, keeping its classes exactly as they are:

```tsx
    <div
      className="flex min-h-screen"
      // A style ATTRIBUTE, not a generated stylesheet: tenant values in CSS
      // text would lose React's entity-escaping, which is the only reason the
      // finding in the brand-colour spec stops at "integrity" and not "XSS".
      // data-tenant-theme is how e2e asserts both its presence for a themed
      // client and its ABSENCE for the agency.
      {...(theme ? { style: themeStyle(theme), "data-tenant-theme": "" } : {})}
    >
```

Leave the `clientAccentColor={resolveSidebarAccent(...)}` prop in place. It is what still paints a colour-only tenant's sidebar accents under PR #10 semantics, and `--sidebar-accent` from a full theme simply overrides it when one exists.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Look at it**

Run: `pnpm --filter web dev` and sign in as the agency, then as the client fixture.

Expected: the agency dashboard is unchanged and its outer div has no `style`. The client's workspace is unchanged too — until Task 8 gives you a way to set the inputs, no account has any, and `deriveTheme` returns null. That "nothing changed" is the §9 rollout guarantee, so confirm it rather than assuming it. Port 3000 is usually held by an unrelated app; expect 3001.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/branding/tenant-theme.ts apps/web/src/app/\(dashboard\)/dashboard/layout.tsx
git commit -m "feat(web): paint the client workspace from its tenant's derived theme"
```

---

## Task 8: The Settings controls and the specimen preview

**Files:**
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts:64-119`, `.../settings/branding-panel.tsx`, `.../settings/page.tsx:142-150`

**Interfaces:**
- Consumes: `deriveTheme` and `themeStyle` (the panel builds `ThemeInputs` from its own form state, so it does not use `themeInputsFrom` — that one maps a DB row), the four `*_NAMES` allowlists added in Step 2, and `setBranding`'s widened input.
- Produces: `BrandingPanel` gains props `brandNeutral`, `brandCorners`, `brandType`, `brandMode`.

- [ ] **Step 1: Add the strings**

In `apps/web/src/lib/messages.ts`, after `"branding.previewSidebar"` (line 65):

```ts
  "branding.neutral": "Surfaces",
  "branding.neutralHint": "The greys behind their content. Warm leans beige, cool leans blue, slate is neutral.",
  "branding.neutralWarm": "Warm",
  "branding.neutralCool": "Cool",
  "branding.neutralSlate": "Slate",
  "branding.corners": "Corners",
  "branding.cornersSharp": "Sharp",
  "branding.cornersSoft": "Soft",
  "branding.cornersRound": "Round",
  "branding.type": "Typeface",
  "branding.typeGeist": "Geist",
  "branding.typeInter": "Inter",
  "branding.typeSerif": "Serif",
  "branding.mode": "Default appearance",
  "branding.modeHint": "What their staff see on a first visit. They can still switch it themselves.",
  "branding.modeLight": "Light",
  "branding.modeDark": "Dark",
  "branding.modeFollow": "Follow their device",
  "branding.badTheme": "Pick one of the offered options.",
  "branding.themeDefault": "Default",
  "branding.previewHeading": "Recent activity",
  "branding.previewBody": "Maria Garcia · updated 2 hours ago",
  "branding.previewLight": "Light",
  "branding.previewDark": "Dark",
```

Spanish is a translation file, not a refactor — follow whatever the file already does for the existing `branding.*` keys.

- [ ] **Step 2: Parse the four inputs in the action**

In `actions.ts`, add a sibling constant module import and the parsing. Because `actions.ts` is a `"use server"` module it may export only async functions, so the allowlists go in the file it already imports from — put them at the top of `apps/web/src/lib/branding/theme.ts` instead and import from there:

```ts
export const NEUTRAL_NAMES = ["warm", "cool", "slate"] as const;
export const CORNER_NAMES = ["sharp", "soft", "round"] as const;
export const TYPE_NAMES = ["geist", "inter", "serif"] as const;
export const MODE_NAMES = ["light", "dark", "follow"] as const;
```

and import them into `actions.ts` alongside its existing colour import:

```ts
import { CORNER_NAMES, MODE_NAMES, NEUTRAL_NAMES, TYPE_NAMES } from "@/lib/branding/theme";
```

Then in `setBrandingAction`, after the colour block (line 79):

```ts
  // A closed set on the way in as well as in the column. The constraint is the
  // real guarantee; this exists so a typo in the form returns a message
  // instead of a Postgres error the operator cannot act on.
  function pickOne<T extends readonly string[]>(
    field: string, allowed: T,
  ): T[number] | null | false {
    const raw = String(formData.get(field) ?? "").trim();
    if (raw === "") return null;
    return (allowed as readonly string[]).includes(raw) ? (raw as T[number]) : false;
  }

  const brandNeutral = pickOne("brandNeutral", NEUTRAL_NAMES);
  const brandCorners = pickOne("brandCorners", CORNER_NAMES);
  const brandType = pickOne("brandType", TYPE_NAMES);
  const brandMode = pickOne("brandMode", MODE_NAMES);
  if (brandNeutral === false || brandCorners === false || brandType === false || brandMode === false) {
    return { ok: false, error: m["branding.badTheme"] };
  }
```

and widen both `setBranding` calls at line 113 so the four travel with the rest:

```ts
      brandLogoPath
        ? { brandName, brandLogoPath, brandColor, brandNeutral, brandCorners, brandType, brandMode }
        : { brandName, brandColor, brandNeutral, brandCorners, brandType, brandMode },
```

- [ ] **Step 3: Pass the stored values into the panel**

In `settings/page.tsx`, extend the `<BrandingPanel>` props (line 142-150), keeping the existing `key` remount trick:

```tsx
          brandNeutral={branding.brandNeutral}
          brandCorners={branding.brandCorners}
          brandType={branding.brandType}
          brandMode={branding.brandMode}
```

- [ ] **Step 4: Add the controls and the specimen**

In `branding-panel.tsx`, widen the props and state, then add the controls after the existing colour field (after line 108) and replace the preview block (lines 110-143).

Props and state:

```tsx
import { deriveTheme, type CornerName, type ModeName, type NeutralName, type TypeName } from "@/lib/branding/theme";
import { themeStyle } from "@/lib/branding/theme-style";
```

```tsx
  brandNeutral: NeutralName | null;
  brandCorners: CornerName | null;
  brandType: TypeName | null;
  brandMode: ModeName | null;
```

```tsx
  const [neutral, setNeutral] = useState<string>(brandNeutral ?? "");
  const [corners, setCorners] = useState<string>(brandCorners ?? "");
  const [typeface, setTypeface] = useState<string>(brandType ?? "");
  const [mode, setMode] = useState<string>(brandMode ?? "");
  // Which side of the theme the specimen is showing. Not the tenant's default
  // and not the operator's own theme: the panel has to show both, because
  // derivation produces two sets and only one of them is on screen elsewhere.
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  // The same function the shell calls, on the same inputs. A second
  // implementation here is exactly how a preview starts lying.
  const previewTheme = deriveTheme({
    color, neutral: (neutral || null) as NeutralName | null,
    corners: (corners || null) as CornerName | null,
    type: (typeface || null) as TypeName | null,
    mode: (mode || null) as ModeName | null,
  }, previewMode);
```

**Decision taken before execution:** one local `RadioRow`, used four times, rather than four near-identical `<fieldset>` blocks. Native radios inside a `<fieldset>`, so an empty value stays expressible and no new UI primitive is needed. Define it in the same file, above `BrandingPanel`:

```tsx
function RadioRow({
  legend, name, value, onChange, options, hint,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  /** "" is always first: it is how the operator clears the input again. */
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
```

Then four usages, after the colour field:

```tsx
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
```

Replace the whole preview block with the specimen. It keeps the two existing swatches — they are what proves the sidebar lightening — and adds real chrome around them:

```tsx
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-card-foreground">{m["branding.colorPreview"]}</p>
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
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0 from both. Run them as separate commands if you need to read the output — do not pipe either one.

- [ ] **Step 6: Exercise it by hand**

Run the dev server, open an account's Settings, and confirm:
- picking `warm` + `round` + `serif` switches the specimen to a beige card with round corners and a serif heading, and toggling the specimen's Light/Dark changes both the surfaces and the sidebar swatch
- Save reports "Branding updated"
- a colour with no other input still shows the two-swatch preview, unchanged
- clearing every radio back to Default and saving returns the account to unbranded

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/branding/theme.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings"
git commit -m "feat(settings): pick a tenant's surfaces, corners, typeface and default mode"
```

---

## Task 9: Prove it in a browser

**Files:**
- Create: `apps/web/e2e/tenant-theme.spec.ts`
- Modify: `apps/web/e2e/auth.setup.ts:169`

**Interfaces:**
- Consumes: the client fixture that `auth.setup.ts` already creates and `auth.teardown.ts` already deletes.

- [ ] **Step 1: Give the fixture a theme**

In `apps/web/e2e/auth.setup.ts`, extend the existing call at line 169:

```ts
  await setBranding(db, accountId, {
    brandName, brandLogoPath, brandColor,
    // One fixture, both halves: a dark default proves the mode path, and
    // #1e3a8a (already the fixture's colour, at 1.62:1 on a dark sidebar)
    // proves the lift ran, exactly as it does for the sidebar accent today.
    brandNeutral: "warm", brandCorners: "round", brandMode: "dark",
  }, user.id);
```

Leave `brandType` unset so the default branch stays covered by a real render.

- [ ] **Step 2: Write the spec**

Create `apps/web/e2e/tenant-theme.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { NEUTRAL_RAMPS } from "../src/lib/branding/neutral-ramps";

const fixture = JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf8"));

const prop = (selector: string, name: string) => async (page: import("@playwright/test").Page) =>
  page.locator(selector).first().evaluate(
    (el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name,
  );

test.describe("tenant theme", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client's workspace paints its tenant's derived tokens", async ({ page }) => {
    await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);

    // Computed style, not a class name: a class proves a string was written,
    // not that anything reached the renderer.
    const bg = await prop("[data-tenant-theme]", "--background")(page);
    expect(bg).toBe(NEUTRAL_RAMPS.warm.dark.bg);

    const radius = await prop("[data-tenant-theme]", "--radius")(page);
    expect(radius).toBe("1rem");

    // #1e3a8a scores 1.62:1 on a dark sidebar, so an unlifted value here
    // would mean the guarantee never ran.
    const accent = await prop("[data-tenant-theme]", "--sidebar-accent")(page);
    expect(accent).not.toBe("#1e3a8a");
  });

  test("the user's toggle beats the tenant default and survives a reload", async ({ page }) => {
    await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts`);
    await page.getByTestId("theme-toggle").click();

    await expect.poll(() => prop("[data-tenant-theme]", "--background")(page))
      .toBe(NEUTRAL_RAMPS.warm.light.bg);

    // The reload is the point. localStorage alone would repaint on mount; only
    // the cookie makes the SERVER emit the light set.
    await page.reload();
    expect(await prop("[data-tenant-theme]", "--background")(page))
      .toBe(NEUTRAL_RAMPS.warm.light.bg);
  });
});

test.describe("agency chrome", () => {
  test("carries no tenant theme at all", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The absence IS the assertion. "BIS by construction" is a claim about
    // there being no branch to invert, and an unverified claim is a comment.
    await expect(page.locator("[data-tenant-theme]")).toHaveCount(0);
  });
});
```

The default `storageState` for the agency describe block comes from `playwright.config.ts`; check how `client-access.spec.ts` scopes its two audiences and match it rather than assuming.

- [ ] **Step 3: Run the spec**

Run: `pnpm --filter web test:e2e -- tenant-theme.spec.ts`
Expected: 3 passed. The setup project runs first and creates the fixture regardless of the filter.

- [ ] **Step 4: Mutation-check the two claims that matter**

Temporarily revert the style attribute in the dashboard layout to `style={undefined}` and confirm the first test fails. Then temporarily make the toggle skip the cookie write and confirm the reload assertion fails while the pre-reload one still passes — that difference is the entire reason the cookie exists. Revert both.

- [ ] **Step 5: Run the full e2e suite**

Run: `pnpm --filter web test:e2e`
Expected: every previously passing spec still passes, plus the 3 new ones. The suite shares the dev database, so run it once, serially, and let the teardown project delete the fixture.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/tenant-theme.spec.ts apps/web/e2e/auth.setup.ts
git commit -m "test(e2e): a client wears its theme, the agency wears none"
```

---

## Task 10: Gates, then the production migration

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run the full gate**

Run each separately and read each exit code. Never chain them through a pipe — a pipe eats the exit code, which has hidden real failures on this repo twice:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter web test:e2e
pnpm --filter web build
```

Expected: exit 0 from all five. Record the actual test counts rather than "all passing" — the number is the evidence.

- [ ] **Step 2: Confirm the rollout guarantee on an unbranded account**

With the dev server running, open an account that has no branding at all and confirm its workspace renders exactly as it did before this branch, and that its outer div has no `style` attribute. This is the §9 claim that makes the migration safe to apply to production.

- [ ] **Step 3: Commit anything the gates changed**

```bash
git add -A
git commit -m "chore: gate fixes for the per-tenant theme"
```

- [ ] **Step 4: Hand the production migration to danlo**

Do **not** apply `0012_tenant_theme.sql` to production autonomously. It is additive and reversible, but the production database is shared and holds one real account and one real contact. Report:

- the migration path and that it is four nullable columns with check constraints
- that null in all five columns reproduces today's rendering, so applying it before the code deploys is safe in either order
- the exact gate numbers from Step 1

---

## Deviations from the spec, and why

Recorded rather than silent, because both refine §6 and §4:

1. **The spec's §6 precedence resolves one value; the implementation returns two.** `resolveThemeMode` also returns `providerDefault`, because next-themes has to set `.dark` on `<html>` in agreement with the tokens the shell emitted, and only the root layout can give it a default. Without this half, a first-visit user on a `brand_mode = 'dark'` tenant would get the tenant's dark *tokens* under a light `.dark`-less document, so every `dark:` utility would disagree with them — worse than the flash the cookie exists to remove. This is the concrete answer to the spec's own §11 open question about where the toggle writes the cookie.

2. **§11's `secondary` vs `muted` question is answered "same step".** Both take the ramp's `subtle`, which is what `globals.css` does today in both themes. A second quiet surface with no screen asking for one is a token nobody can name the purpose of.

3. **The ladder has six steps, not five.** §4.1 mapped five steps and §4.3 said `muted-foreground` takes "the lowest ladder step that still clears 4.5:1". A named `mutedFg` step per ramp is that rule, resolved once when the ramps were written and then asserted by the sweep, rather than searched at runtime.

Both were verified numerically before this plan was written: every ladder clears fg/bg at 16–17:1 and muted text at 5.8–6.9:1 on card while staying quieter than the primary foreground, and every adversarial brand colour — including pure black and pure white — is liftable to 3:1 on all three ladders' light background, dark background and sidebar. That last fact is why Task 3 Step 2's fallback test uses a synthetic surface: **no real ramp value can reach `ensureContrast`'s null branch**, so a test aimed at a real surface would pass for the wrong reason.

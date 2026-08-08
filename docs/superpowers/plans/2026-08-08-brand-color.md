# Brand Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client company's brand color drives the accent on their public lead form and their sidebar, replacing BIS violet.

**Architecture:** One nullable `accounts.brand_color` column plus a pure, unit-testable color module. Two resolver functions (`resolveFormAccent`, `resolveSidebarAccent`) are the only way surfaces consume it, so neither can forget the render-time re-validation. The per-form accent picker is removed rather than layered under a precedence rule.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Supabase Postgres, `@bis/db` workspace package, Vitest, Playwright, Tailwind v4 semantic tokens. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-brand-color-design.md` — read it before Task 1.

**Branch:** `docs/brand-color`, cut from `main` @ `46068bb`.

## Global Constraints

- **Branding is agency-only.** The Settings page and its actions are gated by `requireAgencyOnlyAccountAccess(accountId)`. There is no client-facing write path and none may be introduced.
- **`brand_color` reaches a CSS custom property on a page anonymous strangers load.** Validate on write AND again on read. Anything not exactly `#rrggbb` is treated as unset. Never interpolate an unvalidated string into CSS.
- **`accountId` on any server action is bound server-side** via `.bind(null, accountId)`, never a hidden input. A previous milestone shipped 12 latent IDORs from exactly that mistake.
- **A `"use server"` file may export only async functions.** Sync helpers go in a sibling module.
- **All user-visible strings from the `m` catalog**; semantic Tailwind tokens only, no raw colors in dashboard components.
- **Query-level faults fail loud** and name the failing query. But **decorative reads on customer-facing paths degrade rather than break the page** — the M3 review finding: a logo, or a color, is not worth the lead.
- **No new npm dependencies.** In particular do not add a color library; the module in Task 1 is ~80 lines.
- **Do NOT delete or modify pre-existing data in the shared dev database.** Restore anything you toggle.
- **Five gates green before every commit**, each as its own unpiped command: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter web build` · `pnpm --filter web test:e2e`

### Testing notes specific to this codebase

- **Judge a red e2e run by WALL CLOCK first.** Cold ≈ 6-8 min, warm ≈ 2.1-2.6 min. Two consecutive reds is NOT proof of a regression — this exact pattern cost 45 minutes on M3. Order of checks: re-run → run the failing spec alone (~1 min) → audit the dev DB read-only.
- **A `packages/db` flake has hit three files** (`activities`, `checklist`, `crm-config`), each passing on isolated rerun. Rerun alone before diagnosing.
- `apps/web` has no `.tsx` unit-test harness. Do not invent one — verify components via `pnpm --filter web build`, the E2E suite, and reading.
- Do not run ad-hoc browser walkthroughs against the shared dev database.

---

## File Structure

**`packages/db`**
- Create `supabase/migrations/0011_brand_color.sql` — the column.
- Modify `src/branding.ts` — `Branding` type, `setBranding`, `getBranding`.
- Modify `src/forms.ts` — drop `accent` from `FormTheme`.
- Modify `src/test/branding.test.ts` — brandColor coverage.

**`apps/web`**
- Create `src/lib/branding/color.ts` — pure color math and the two resolvers. No I/O.
- Create `src/lib/branding/color.test.ts`
- Modify `src/lib/messages.ts` — new strings, remove `forms.accent`.
- Modify `.../settings/actions.ts` — validate and persist `brandColor`.
- Modify `.../settings/branding-panel.tsx` — the control.
- Modify `src/app/f/[publicId]/page.tsx`, `public-form.tsx`, `form.css` — the form surface.
- Modify `src/app/(dashboard)/dashboard/layout.tsx`, `src/components/app-sidebar.tsx` — the sidebar surface.
- Modify `.../forms/[formId]/form-editor.tsx`, `.../forms/actions.ts`, `src/lib/forms/editor-helpers.ts` + its test — remove the per-form picker.
- Modify `e2e/auth.setup.ts`, `e2e/client-access.spec.ts` — coverage.

---

## Task 1: The color module

Pure and I/O-free on purpose, so it can be unit-tested and mutation-tested. This mirrors `validate-logo.ts`, which was the one piece of M3 that could be verified cleanly.

**Files:**
- Create: `apps/web/src/lib/branding/color.ts`
- Create: `apps/web/src/lib/branding/color.test.ts`

**Interfaces:**
- Produces:
  - `parseHexColor(input: string | null | undefined): string | null`
  - `relativeLuminance(hex: string): number`
  - `contrastRatio(a: string, b: string): number`
  - `readableTextOn(hex: string): "#ffffff" | "#111111"`
  - `lightenForSidebar(hex: string): string`
  - `resolveFormAccent(brandColor: string | null): { accent: string; accentForeground: string }`
  - `resolveSidebarAccent(brandColor: string | null): string | null`
  - `FORM_ACCENT_FALLBACK: "#6d28d9"`, `SIDEBAR_BG: "#1e1b2e"`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/branding/color.test.ts`. Every numeric expectation below was measured on 2026-08-08, not estimated.

```ts
import { describe, it, expect } from "vitest";
import {
  parseHexColor, contrastRatio, readableTextOn, lightenForSidebar,
  resolveFormAccent, resolveSidebarAccent, FORM_ACCENT_FALLBACK, SIDEBAR_BG,
} from "./color";

describe("parseHexColor", () => {
  it("accepts #rrggbb and normalizes to lowercase", () => {
    expect(parseHexColor("#0F766E")).toBe("#0f766e");
    expect(parseHexColor("  #1e3a8a  ")).toBe("#1e3a8a");
  });

  // This value reaches a CSS custom property on a page anonymous strangers
  // load. `url(...)` there makes a customer's browser issue that request —
  // an unvetted outbound call from the least-trusted surface in the product.
  it("rejects anything that is not exactly #rrggbb", () => {
    for (const bad of [
      "red", "#abc", "#GGGGGG", "rgb(0,0,0)", "url(https://evil.example/x.png)",
      "#6d28d9; background:url(x)", "var(--x)", "", "   ", "#0f766e0f",
    ]) {
      expect(parseHexColor(bad)).toBeNull();
    }
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe("contrastRatio", () => {
  // Pins the WCAG formula itself. If this drifts, every threshold below is
  // meaningless.
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#6d28d9", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#6d28d9"), 10);
  });

  it("matches measured values for the colors this feature cares about", () => {
    expect(contrastRatio("#6d28d9", "#ffffff")).toBeCloseTo(7.10, 2);
    expect(contrastRatio("#8b5cf6", SIDEBAR_BG)).toBeCloseTo(3.96, 2);
    expect(contrastRatio("#1e3a8a", SIDEBAR_BG)).toBeCloseTo(1.62, 2);
  });
});

describe("readableTextOn", () => {
  it("picks white on dark colors and near-black on light ones", () => {
    expect(readableTextOn("#6d28d9")).toBe("#ffffff");
    expect(readableTextOn("#1e3a8a")).toBe("#ffffff");
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#fde047")).toBe("#111111");
    expect(readableTextOn("#ffffff")).toBe("#111111");
  });
});

describe("lightenForSidebar", () => {
  // The sidebar is always dark (#1e1b2e). A navy brand is invisible there
  // untreated — 1.62:1 — which is the whole reason this function exists.
  it("raises a too-dark color past 3:1 against the sidebar", () => {
    const out = lightenForSidebar("#1e3a8a");
    expect(out).not.toBe("#1e3a8a");
    expect(contrastRatio(out, SIDEBAR_BG)).toBeGreaterThanOrEqual(3);
  });

  it("leaves a color that already clears 3:1 untouched", () => {
    expect(lightenForSidebar("#0f766e")).toBe("#0f766e"); // measured 3.07
    expect(lightenForSidebar("#8b5cf6")).toBe("#8b5cf6"); // measured 3.96
    expect(lightenForSidebar("#fde047")).toBe("#fde047"); // measured 12.73
  });

  // Fidelity over legibility, decided in spec section 5: a company's hue is
  // never silently changed, only lightened.
  it("preserves hue", () => {
    expect(lightenForSidebar("#1e3a8a")).toBe("#3a62d4");
  });

  it("handles an achromatic color without dividing by zero", () => {
    const out = lightenForSidebar("#000000");
    expect(contrastRatio(out, SIDEBAR_BG)).toBeGreaterThanOrEqual(3);
  });
});

describe("resolvers", () => {
  it("falls back to BIS violet with white text when unset", () => {
    expect(resolveFormAccent(null)).toEqual({
      accent: FORM_ACCENT_FALLBACK, accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent(null)).toBeNull();
  });

  // The second half of the validate-twice rule. A row written by some future
  // path that forgot to check must not reach CSS.
  it("treats an invalid stored value as unset", () => {
    expect(resolveFormAccent("url(https://evil.example/x.png)")).toEqual({
      accent: FORM_ACCENT_FALLBACK, accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent("red")).toBeNull();
  });

  it("resolves a valid color differently for each surface", () => {
    // Same brand, two answers: the form shows it as-is, the sidebar lightens
    // it to stay visible on a dark background.
    expect(resolveFormAccent("#1e3a8a")).toEqual({
      accent: "#1e3a8a", accentForeground: "#ffffff",
    });
    expect(resolveSidebarAccent("#1e3a8a")).toBe("#3a62d4");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter web exec vitest run src/lib/branding/color.test.ts`
Expected: FAIL — cannot find module `./color`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/branding/color.ts`:

```ts
/**
 * Color math for brand accents. Pure and I/O-free on purpose, so it can be
 * unit-tested and mutation-tested — the same reason validate-logo.ts is
 * separate from the action that uses it.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** BIS violet. What an unbranded form has always used. */
export const FORM_ACCENT_FALLBACK = "#6d28d9";
/** --sidebar in globals.css. The sidebar is dark in BOTH themes by design. */
export const SIDEBAR_BG = "#1e1b2e";
/** WCAG 1.4.11 for non-text UI components, which is what these accents are. */
const SIDEBAR_MIN_RATIO = 3;
const LIGHTEN_STEP = 0.02;
const LIGHTEN_CEILING = 0.95;

/**
 * The only way a color enters this module.
 *
 * Deliberately strict: this value ends up in a CSS custom property on a page
 * served to the client's customers, so "looks like a color" is not good
 * enough. A named color or a url() would both be accepted by CSS.
 */
export function parseHexColor(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return HEX.test(v) ? v : null;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of white or near-black is legible on this color. */
export function readableTextOn(hex: string): "#ffffff" | "#111111" {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, "#111111")
    ? "#ffffff"
    : "#111111";
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l]; // achromatic; hue is undefined, not zero-ish
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    : max === gn ? ((bn - rn) / d + 2) / 6
    : ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Raises lightness until the color is visible on the dark sidebar.
 *
 * Hue and saturation are preserved exactly (spec section 5): a very dark navy
 * becomes a lighter navy rather than shifting toward a more legible hue.
 * Silently changing a company's hue is the worse failure, and the Settings
 * preview shows the operator the result before they save.
 *
 * Returns the input unchanged when it already clears the threshold, and the
 * best it managed if it runs out of headroom.
 */
export function lightenForSidebar(hex: string): string {
  const [h, s, startL] = rgbToHsl(...channels(hex));
  let l = startL;
  let out = hex;
  while (contrastRatio(out, SIDEBAR_BG) < SIDEBAR_MIN_RATIO && l < LIGHTEN_CEILING) {
    l = Math.min(LIGHTEN_CEILING, l + LIGHTEN_STEP);
    out = hslToHex(h, s, l);
  }
  return out;
}

/**
 * The public form's accent and the text color that stays legible on it.
 *
 * Re-validates rather than trusting the stored value — the second half of the
 * validate-on-write-and-on-read rule. Surfaces call this instead of deriving
 * their own, so none of them can forget.
 */
export function resolveFormAccent(
  brandColor: string | null,
): { accent: string; accentForeground: string } {
  const accent = parseHexColor(brandColor) ?? FORM_ACCENT_FALLBACK;
  return { accent, accentForeground: readableTextOn(accent) };
}

/** The sidebar's accent, or null to leave today's light/dark-tuned tokens alone. */
export function resolveSidebarAccent(brandColor: string | null): string | null {
  const c = parseHexColor(brandColor);
  return c ? lightenForSidebar(c) : null;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter web exec vitest run src/lib/branding/color.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the contrast assertions can fail**

Temporarily change `SIDEBAR_MIN_RATIO` from `3` to `1`, rerun, and confirm the
"raises a too-dark color past 3:1" and "preserves hue" tests go RED. Revert.
Record what you observed in your report. An assertion that cannot fail is
worse than none.

- [ ] **Step 6: Gates and commit**

`pnpm typecheck` · `pnpm lint` · `pnpm test`

```bash
git add apps/web/src/lib/branding
git commit -m "feat(web): pure color module for brand accents"
```

---

## Task 2: Migration 0011 and brandColor in the branding service

**Files:**
- Create: `packages/db/supabase/migrations/0011_brand_color.sql`
- Modify: `packages/db/src/branding.ts`
- Modify: `packages/db/src/test/branding.test.ts`

**Interfaces:**
- Produces: `Branding` gains `brandColor: string | null`; `setBranding`'s input gains `brandColor?: string | null`.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0011_brand_color.sql`:

```sql
-- Nullable like brand_name and brand_logo_path before it: null means "no
-- brand color", every surface falls back, and shipping this changes nothing
-- for existing accounts.
--
-- Stored as a #rrggbb string rather than three smallints because that is the
-- form both consumers want -- a CSS custom property and a color input -- and
-- the form the value is validated in. Validation is app-side; no check
-- constraint here, so a future format change does not need a migration.
alter table public.accounts add column brand_color text;
```

- [ ] **Step 2: Apply it to the dev database**

```bash
cd packages/db
set -a && . ./.env && set +a
npx supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
```
Expected: `Would push these migrations: 0011_brand_color.sql` and nothing else.

Then apply for real with `--yes` instead of `--dry-run`.

The CLI prints a Docker warning about caching its migrations catalog. That is
its local-dev catalog cache and has nothing to do with whether the DDL applied
— ignore it.

- [ ] **Step 3: Verify by reading the column back**

Do not trust the push output. Run:

```bash
node -e "
const {Client}=require('pg');
(async()=>{
const c=new Client({connectionString:process.env.SUPABASE_DB_URL});
await c.connect();
const r=await c.query(\"select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='brand_color'\");
console.log(JSON.stringify(r.rows));
await c.end();})()"
```
Expected: one row, `text`, `YES`.

- [ ] **Step 4: Write the failing tests**

Add to `packages/db/src/test/branding.test.ts`, inside the existing
`describe("branding service", ...)`:

```ts
  it("writes and reads brand_color", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandColor: "#1e3a8a" }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBe("#1e3a8a");
    });
  });

  it("leaves brandColor alone when omitted, and clears it on explicit null", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandColor: "#1e3a8a" }, "user_test");

      // Same load-bearing distinction as brandLogoPath: the Settings action
      // omits fields it is not editing, and omission must not wipe them.
      await setBranding(db, accountId, { brandName: "Rio Roofing" }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBe("#1e3a8a");

      await setBranding(db, accountId, { brandColor: null }, "user_test");
      expect((await getBranding(db, accountId)).brandColor).toBeNull();
    });
  });
```

Also update the existing `"sets both fields, reads them back"` test's
`toEqual` to include `brandColor: null`, and the
`"reads an account that does not exist as unbranded"` test to expect
`{ brandName: null, brandLogoPath: null, brandColor: null }`.

- [ ] **Step 5: Run and watch it fail**

Run: `pnpm --filter @bis/db exec vitest run src/test/branding.test.ts`
Expected: FAIL — `brandColor` is not a property of the returned object.

- [ ] **Step 6: Implement**

In `packages/db/src/branding.ts`, extend the type:

```ts
/** What a surface needs to wear a company's brand. All null = not branded. */
export type Branding = {
  brandName: string | null;
  brandLogoPath: string | null;
  brandColor: string | null;
};
```

Extend `setBranding`'s input and patch:

```ts
export async function setBranding(
  db: SupabaseClient,
  accountId: string,
  input: { brandName?: string | null; brandLogoPath?: string | null; brandColor?: string | null },
  actorId: string,
): Promise<void> {
  const patch: Record<string, string | null> = {};
  if (input.brandName !== undefined) patch.brand_name = input.brandName;
  if (input.brandLogoPath !== undefined) patch.brand_logo_path = input.brandLogoPath;
  if (input.brandColor !== undefined) patch.brand_color = input.brandColor;
  if (Object.keys(patch).length === 0) return;
  // ... rest unchanged, including the `.select("id")` row check
```

Extend `getBranding`'s select and return:

```ts
  const { data, error } = await db.from("accounts")
    .select("brand_name, brand_logo_path, brand_color").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getBranding failed: ${error.message}`);
  return {
    brandName: data?.brand_name ?? null,
    brandLogoPath: data?.brand_logo_path ?? null,
    brandColor: data?.brand_color ?? null,
  };
```

- [ ] **Step 7: Run and watch it pass**

Run: `pnpm --filter @bis/db exec vitest run src/test/branding.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 8: Gates and commit**

`pnpm typecheck` · `pnpm lint` · `pnpm test`

```bash
git add packages/db
git commit -m "feat(db): brand_color on accounts"
```

---

## Task 3: The Settings control

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx`

**Interfaces:**
- Consumes: `parseHexColor` (Task 1); `setBranding` (Task 2).

- [ ] **Step 1: Message strings**

In `apps/web/src/lib/messages.ts`, add beside the existing `branding.*` block:

```ts
  "branding.color": "Brand color",
  "branding.colorHint": "Used for buttons and highlights on their lead forms and in their sidebar. Leave blank for the default.",
  "branding.badColor": "Enter a color as a hex code, like #0f766e.",
  "branding.colorPreview": "Preview",
```

- [ ] **Step 2: Validate and persist in the action**

In `settings/actions.ts`, add the import:

```ts
import { sniffImageType, MAX_LOGO_BYTES } from "@/lib/branding/validate-logo";
import { parseHexColor } from "@/lib/branding/color";
```

Inside `setBrandingAction`, after the `brandName` line, add:

```ts
  // Empty clears it, exactly like brandName above. Anything present must be a
  // real hex color: this string ends up in a CSS custom property on a page
  // anonymous strangers load, so "looks close enough" is not a standard.
  const rawColor = String(formData.get("brandColor") ?? "").trim();
  const brandColor = rawColor === "" ? null : parseHexColor(rawColor);
  if (rawColor !== "" && brandColor === null) {
    return { ok: false, error: m["branding.badColor"] };
  }
```

Then include it in both `setBranding` calls by changing the input expression:

```ts
      brandLogoPath ? { brandName, brandLogoPath, brandColor } : { brandName, brandColor },
```

- [ ] **Step 3: The control**

In `branding-panel.tsx`, add `brandColor` to the props:

```ts
export function BrandingPanel({
  brandName,
  brandColor,
  logoUrl,
  action,
}: {
  brandName: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  action: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [fileKey, setFileKey] = useState(0);
  const [color, setColor] = useState(brandColor ?? "");
```

Add this block between the logo field and the "Current logo" preview:

```tsx
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
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6d28d9"}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 shrink-0 rounded-md border border-border bg-background p-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">{m["branding.colorHint"]}</p>
          </div>
```

Mount it in `settings/page.tsx` by adding the prop:

```tsx
        <BrandingPanel
          brandName={branding.brandName}
          brandColor={branding.brandColor}
          logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
          action={boundSetBranding}
        />
```

- [ ] **Step 4: Gates and commit**

All five.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings" apps/web/src/lib/messages.ts
git commit -m "feat(web): set a company's brand color from Settings"
```

---

## Task 4: The public lead form wears the brand color

**Files:**
- Modify: `apps/web/src/app/f/[publicId]/page.tsx`
- Modify: `apps/web/src/app/f/[publicId]/public-form.tsx`
- Modify: `apps/web/src/app/f/[publicId]/form.css`

**Interfaces:**
- Consumes: `resolveFormAccent` (Task 1); `Branding.brandColor` (Task 2).

Note: this task stops *reading* `theme.accent`. Task 6 removes the control that
*writes* it. Between the two the editor shows a control with no effect — that is
expected within this branch and is not a defect to "fix" early.

- [ ] **Step 1: Pass the accent from the page**

In `page.tsx`, replace the `<PublicForm ... theme={form.theme} ...>` usage by
adding the resolved accent. Add the import:

```ts
import { resolveFormAccent } from "@/lib/branding/color";
```

and just before the `return`:

```ts
  const accent = resolveFormAccent(branding.brandColor);
```

then pass it:

```tsx
      <PublicForm
        fields={form.fields}
        theme={form.theme}
        accent={accent}
        locale={locale}
```

- [ ] **Step 2: Consume it in the form**

In `public-form.tsx`, add to the props type and destructuring:

```ts
export function PublicForm({
  fields,
  theme,
  accent,
  locale,
  strings,
  renderToken,
  attribution,
  action,
}: {
  fields: FormField[];
  theme: FormTheme;
  /** Resolved server-side from the account's brand color, already validated. */
  accent: { accent: string; accentForeground: string };
  locale: "en" | "es";
```

and change the style block:

```tsx
      style={{
        // Themed rather than inheriting the host page: an iframe cannot read the
        // host's CSS, so these are what stop the form looking pasted in.
        //
        // The accent comes from the ACCOUNT's brand color, not from
        // theme.accent — a company has one brand, not one per form. See
        // docs/superpowers/specs/2026-08-08-brand-color-design.md section 2.1.
        "--accent": accent.accent,
        "--accent-foreground": accent.accentForeground,
        "--radius": theme.radius ?? "0.5rem",
        background: theme.transparentBackground ? "transparent" : undefined,
      } as React.CSSProperties}
```

- [ ] **Step 3: Stop hardcoding the button text color**

In `form.css`, change the `.bis-form-submit` rule from `color: #fff;` to
`color: var(--accent-foreground, #fff);`:

```css
.bis-form-submit {
  padding: 9px 18px; font: inherit; font-weight: 500; cursor: pointer;
  color: var(--accent-foreground, #fff);
  background: var(--accent); border: 0; border-radius: var(--radius);
}
```

The fallback keeps the rule meaningful if the property is ever absent.

- [ ] **Step 4: Gates and commit**

All five. `forms.spec.ts` must pass unchanged — an unbranded form renders as
before, because `resolveFormAccent(null)` yields exactly `#6d28d9` and
`#ffffff`.

```bash
git add "apps/web/src/app/f/[publicId]"
git commit -m "feat(web): the public lead form wears the client's brand color"
```

---

## Task 5: The client sidebar wears the brand color

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `resolveSidebarAccent` (Task 1).

- [ ] **Step 1: Resolve it in the layout**

In `dashboard/layout.tsx`, add the import:

```ts
import { resolveSidebarAccent } from "@/lib/branding/color";
```

and pass the prop:

```tsx
        clientBrandName={branding?.brandName ?? undefined}
        clientLogoUrl={branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : undefined}
        clientAccentColor={resolveSidebarAccent(branding?.brandColor ?? null) ?? undefined}
```

- [ ] **Step 2: Apply it in the sidebar**

In `app-sidebar.tsx`, add to the props:

```ts
  clientAccentColor,
}: {
  // ... existing props
  /** Already lightened server-side to stay visible on the dark sidebar.
   *  Undefined for the agency and for an unbranded client, both of which keep
   *  the globals.css tokens — including their deliberate light/dark tuning,
   *  which a flat override would discard. */
  clientAccentColor?: string;
}) {
```

and set it as an inline custom property on the `<aside>`, overriding the token
for that subtree only:

```tsx
    <aside
      style={clientAccentColor
        ? ({ "--sidebar-accent": clientAccentColor } as React.CSSProperties)
        : undefined}
      className={cn(
        "flex shrink-0 flex-col gap-3 bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
```

This reaches both existing consumers without touching either: the active-item
indicator (`bg-sidebar-accent`) and the icon chip
(`bg-sidebar-accent/20 text-sidebar-accent`).

- [ ] **Step 3: Gates and commit**

All five. `shell.spec.ts` and `theme.spec.ts` must pass unchanged — they are the
proof the agency's chrome is untouched.

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(web): a client's sidebar accents follow their brand color"
```

---

## Task 6: Remove the per-form accent picker

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/[formId]/form-editor.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/actions.ts`
- Modify: `apps/web/src/lib/forms/editor-helpers.ts`
- Modify: `apps/web/src/lib/forms/editor-helpers.test.ts`
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `packages/db/src/forms.ts`

Stored `theme.accent` values are left in the JSON, unread. No migration — per-form
color stays reversible if it is ever wanted back.

- [ ] **Step 1: Remove the control**

In `form-editor.tsx`, delete this block entirely:

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="form-accent">{m["forms.accent"]}</Label>
            <Input id="form-accent" name="accent" type="color"
                   defaultValue={form.theme.accent ?? "#6d28d9"} className="h-9 w-20 p-1" />
          </div>
```

- [ ] **Step 2: Stop writing it**

In `forms/actions.ts`, change the merge call to drop `accent`:

```ts
  const theme = mergeFormTheme(current.theme, {
    transparentBackground: formData.get("transparent") === "on",
  });
```

In `editor-helpers.ts`, update the signature and body, and revise the doc
comment's second paragraph:

```ts
/**
 * ... (keep the existing first paragraph about not clobbering mode/radius)
 *
 * `transparentBackground` is what the editor manages, so it is always taken
 * from `edits`. `accent` used to live here too; the account's brand color
 * replaced it (see the 2026-08-08 brand-color spec), so the editor no longer
 * writes it and stored values are left in place, unread.
 */
export function mergeFormTheme(
  stored: FormTheme | undefined,
  edits: { transparentBackground: boolean },
): FormTheme {
  return {
    ...(stored ?? {}),
    transparentBackground: edits.transparentBackground,
  };
}
```

- [ ] **Step 3: Update the helper's tests**

In `editor-helpers.test.ts`, the three accent-related expectations must change.
Replace the existing `mergeFormTheme` tests with:

```ts
  it("keeps keys the editor does not manage", () => {
    const stored = { mode: "dark" as const, radius: "1rem", transparentBackground: true };
    const merged = mergeFormTheme(stored, { transparentBackground: false });
    expect(merged).toEqual({ mode: "dark", radius: "1rem", transparentBackground: false });
  });

  it("handles an absent stored theme", () => {
    const merged = mergeFormTheme(undefined, { transparentBackground: false });
    expect(merged).toEqual({ transparentBackground: false });
  });

  // A form saved before the brand color replaced per-form accents keeps its
  // stored accent key untouched. Nothing reads it; no migration rewrites it.
  it("leaves a legacy accent key in place without reading it", () => {
    const stored = { accent: "#111111", transparentBackground: false } as FormTheme;
    const merged = mergeFormTheme(stored, { transparentBackground: true });
    expect((merged as Record<string, unknown>).accent).toBe("#111111");
  });
```

- [ ] **Step 4: Remove the string and the type field**

In `messages.ts`, delete the `"forms.accent": "Accent color",` line.

In `packages/db/src/forms.ts`, remove `accent?: string;` from `FormTheme`:

```ts
export type FormTheme = {
  radius?: string;
  mode?: "light" | "dark" | "auto";
  transparentBackground?: boolean;
};
```

The legacy test above casts through `FormTheme`, which is why it uses `as
FormTheme` and reads the key via `Record<string, unknown>`.

- [ ] **Step 5: Gates and commit**

All five.

```bash
git add apps/web packages/db
git commit -m "refactor: remove the per-form accent picker, superseded by brand color"
```

---

## Task 7: End-to-end coverage and the final gate

**Files:**
- Modify: `apps/web/e2e/auth.setup.ts`
- Modify: `apps/web/e2e/client-access.spec.ts`

The fixture color is `#1e3a8a`, chosen deliberately: it renders **differently on
the two surfaces** — as itself on the form, lightened to `#3a62d4` on the
sidebar — so one fixture proves both resolvers. A color that needed no
lightening would let a broken `resolveSidebarAccent` pass.

- [ ] **Step 1: Give the fixture account a brand color**

In `auth.setup.ts`, change the `setBranding` call:

```ts
  const brandColor = "#1e3a8a";
  await setBranding(db, accountId, { brandName, brandLogoPath, brandColor }, user.id);
```

and add it to the fixture file payload:

```ts
    JSON.stringify({ accountId, clerkOrgId: org.id, clerkUserId: user.id, email, companyName,
                     contactName, brandName, brandLogoPath, brandColor, formPublicId }),
```

Add `brandColor: string;` to the `ClientFixture` type in **both**
`client-access.spec.ts` and `auth.teardown.ts`.

- [ ] **Step 2: Assert the sidebar accent, computed**

In `client-access.spec.ts`, after the existing sidebar logo assertions, add:

```ts
  // Computed style, not a class name: a class assertion passes while the
  // custom property is unset, which is exactly the failure being guarded.
  // #1e3a8a scores 1.62:1 on the dark sidebar and is lightened to #3a62d4 to
  // clear 3:1 — so this value ALSO proves the lightening ran.
  await expect(sidebar.locator("nav span.bg-sidebar-accent").first())
    .toHaveCSS("background-color", "rgb(58, 98, 212)");
```

- [ ] **Step 3: Assert the public form's button, computed**

In the anonymous public-form test, after the existing brand assertions, add:

```ts
    // The form shows the brand color as chosen, unlightened — the same value
    // the sidebar had to lighten. One fixture, two resolvers, both proved.
    const submit = page.locator(".bis-form-submit");
    await expect(submit).toHaveCSS("background-color", "rgb(30, 58, 138)");
    await expect(submit).toHaveCSS("color", "rgb(255, 255, 255)");
```

- [ ] **Step 4: Prove each new assertion can fail**

Three mutations, each applied alone and reverted:

1. In `dashboard/layout.tsx`, pass `clientAccentColor={undefined}`.
   Expected: the sidebar assertion goes red, receiving the default `#8b5cf6`
   as `rgb(139, 92, 246)`.
2. In `page.tsx` for `f/[publicId]`, pass `accent={resolveFormAccent(null)}`.
   Expected: the button background assertion goes red, receiving
   `rgb(109, 40, 217)`.
3. In `color.ts`, make `readableTextOn` always return `"#111111"`.
   Expected: the button text assertion goes red, receiving `rgb(17, 17, 17)`.

Record exactly what you observed for each. Revert all three.

- [ ] **Step 5: All five gates**

Each as its own unpiped command, with real output captured.

**Judge a red e2e run by wall clock before diagnosing it.** Cold ≈ 6-8 min,
warm ≈ 2.1-2.6. Re-run first; then run the failing spec alone; then audit the
dev DB read-only. Two consecutive reds is not proof.

- [ ] **Step 6: Confirm no residue**

The fixture creates a Clerk user, a Clerk org, an account row, a contact, a
form, and a storage object; teardown removes all of them. Verify afterwards:

```bash
cd packages/db && set -a && . ./.env && set +a && node -e "
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
const c=new Client({connectionString:process.env.SUPABASE_DB_URL});await c.connect();
const a=await c.query(\"select count(*)::int n, count(*) filter (where name like 'E2E Client Co%')::int e2e from public.accounts\");
const f=await c.query('select count(*)::int n from public.forms');
console.log('accounts:',JSON.stringify(a.rows[0]),' forms:',f.rows[0].n);
await c.end();
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data}=await db.storage.from('brand-logos').list('',{limit:100});
console.log('bucket:',JSON.stringify((data||[]).map(o=>o.name)));})()"
```
Expected: `e2e: 0`, `forms: 0`, `bucket: []`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): brand color reaches both surfaces, resolved per surface"
```

---

## Self-Review

**Spec coverage.** §3 data → Task 2. §4 validation on write → Task 3 Step 2; on
read → Task 1's resolvers, used by Tasks 4 and 5. §5 color module → Task 1. §5.1
resolvers → Task 1. §6.1 form → Task 4. §6.2 sidebar → Task 5. §7 Settings
control, text-field-submits → Task 3 Step 3. §8 fallbacks → Task 1's resolver
tests plus Task 4 Step 4 (`forms.spec.ts` unchanged). §9 removals → Task 6. §10
testing → Tasks 1, 2, 7. §11 out of scope → nothing in this plan touches email,
`--primary`, custom domains, or fonts.

**Type consistency.** `resolveFormAccent` returns `{ accent, accentForeground }`
in Task 1 and is destructured under that exact shape in Task 4. `Branding`
gains `brandColor` in Task 2 and is read as `branding.brandColor` in Tasks 3, 4
and 5. `clientAccentColor` is named identically in the layout (Task 5 Step 1)
and the sidebar (Step 2). `mergeFormTheme`'s edits parameter loses `accent` in
Task 6 Step 2 and its tests are updated in the same task.

**Known gaps, deliberately left:**
- Task 3's panel has no live preview of the derived button and sidebar colors,
  which the spec §7 mentions. The hex value and picker swatch give immediate
  feedback, and a preview is a pure addition if it is wanted later. Flagged
  rather than silently dropped.
- `lightenForSidebar` preserves hue exactly, so a very dark brand becomes a
  lighter version of the same hue rather than a more legible one. Spec §5
  records this as decided, not overlooked.
- No `check` constraint on `brand_color` in Postgres; validation is app-side at
  both ends. A row written directly via SQL could hold anything, which is why
  the read path re-validates.

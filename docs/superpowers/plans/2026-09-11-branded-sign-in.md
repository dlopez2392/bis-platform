# Branded Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the three signed-out screens (`/sign-in`, `/`, `/no-access`) one shell carrying the platform's mark and the dashboard sidebar's chrome, and restyle Clerk's `<SignIn />` through tokens.

**Architecture:** A new `AuthShell` renders `Ground` + one glass card split `[rail | content]`, where the rail reuses the existing `sidebar-chrome` utility — the one surface that is dark in both themes. Clerk is restyled by passing **our own class names** through `appearance.elements`, with `cssLayerName` putting Clerk's stylesheet in a lower cascade layer so those classes win without `!important`.

**Tech Stack:** Next.js App Router (server components), Tailwind v4 (`@utility` / `@layer` in `globals.css`), `@clerk/nextjs@7.6.1`, Vitest (`renderToStaticMarkup`, no DOM), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-branded-sign-in-design.md`. Section references below (§4, §7…) point at it.

## Global Constraints

- **Tokens only.** No hard-coded colour, radius or shadow in any component (`DESIGN.md`). `globals.css` and `tokens.css` stay the only places values are declared; components consume them.
- **Tailwind v4 dropped the `[--var]` shorthand.** Write `text-[var(--sidebar-text-strong)]`, never `text-[--sidebar-text-strong]` — the short form emits invalid CSS silently.
- **Never restate `sidebar-chrome`'s values.** The rail applies the utility; it does not copy `background-color` / `background-image` / `backdrop-filter`.
- **No new `!important`.** If a Clerk style is winning, the cascade layer (Task 5) is wrong — fix that, don't escalate specificity. `globals.css` already carries exactly two, both inside the `@media (prefers-reduced-motion: reduce)` block; those are correct and stay — a motion guard that can be out-specified is not a guard. Do not "clean them up."
- **No theme toggle on any signed-out screen.** `theme-mode.ts` records a shipped bug where a cookie written at `/sign-in` outranked every tenant's `brand_mode` permanently.
- **No tagline under "Sign in."** Cut deliberately (spec §10). The vertical gap is a spacing problem; do not solve it by writing a sentence.
- **Repo is PR-only.** Never push `main`. All work lands on `design/branded-sign-in`.
- **Every git/pnpm command starts from the repo root**, `C:/Users/danlo/bis-platform`. The shell's cwd persists between calls and a wrong cwd makes `pnpm check` exit 1 with "Missing script".

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/components/bis-mark.tsx` | **Create.** The platform mark, one path, `currentColor`. |
| `apps/web/src/components/bis-mark.test.ts` | **Create.** Static-markup pins. |
| `apps/web/src/components/auth-shell.tsx` | **Create.** Ground + card + rail frame for all three signed-out screens. |
| `apps/web/src/components/auth-shell.test.ts` | **Create.** Static-markup pins, including "no navigation". |
| `apps/web/src/lib/messages.ts` | **Modify.** Two new strings. |
| `apps/web/src/app/(dashboard)/no-access/page.tsx` | **Modify.** Adopt the shell, drop its own card. |
| `apps/web/src/app/(dashboard)/page.tsx` | **Modify.** Adopt the shell, drop its own card. |
| `apps/web/src/app/(dashboard)/globals.css` | **Modify.** Declare the `clerk` cascade layer first. |
| `apps/web/src/lib/branding/clerk-layer.test.ts` | **Create.** Pins the layer declaration and its position. |
| `apps/web/src/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx` | **Modify.** The shell + the Clerk `appearance` map. |
| `apps/web/e2e/signed-out.spec.ts` | **Create.** All signed-out assertions, both themes. |
| `DESIGN.md` | **Modify.** Rule 9. |

---

### Task 1: The BIS mark

BIS's logo has existed all along in exactly one place — a 256×256 PNG frame inside `apps/web/public/favicon.ico` — and nothing in the app has ever drawn it. This re-cuts it as a single path so it can take a colour.

**Files:**
- Create: `apps/web/src/components/bis-mark.tsx`
- Test: `apps/web/src/components/bis-mark.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BisMark({ size?: number; className?: string })` — an `<svg data-slot="bis-mark">`. Default `size` is `28`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/bis-mark.test.ts`. This follows `ground.test.ts` exactly — the house pattern is `renderToStaticMarkup`, never a DOM renderer.

```ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BisMark } from "./bis-mark";

describe("BisMark — the platform mark (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(BisMark));

  it("is decorative and findable in the DOM", () => {
    expect(html).toContain('data-slot="bis-mark"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("knocks the triangle out as a HOLE rather than painting it", () => {
    // ONE path with evenodd is what makes the triangle transparent. Two
    // shapes would force every caller to say what is behind the mark, and
    // would be the wrong dark the moment it sat on the sidebar's chrome.
    expect(html).toContain('fill-rule="evenodd"');
    expect(html.match(/<path/g) ?? []).toHaveLength(1);
  });

  it("takes its colour from the caller — no literal", () => {
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
  });

  it("renders at the caller's size", () => {
    const big = renderToStaticMarkup(createElement(BisMark, { size: 40 }));
    expect(big).toContain('width="40"');
    expect(big).toContain('height="40"');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/components/bis-mark.test.ts
```

Expected: FAIL — `Failed to resolve import "./bis-mark"`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/bis-mark.tsx`:

```tsx
/**
 * BIS's own mark: a triangle knocked out of a disc.
 *
 * It has existed all along in exactly ONE place — a 256×256 frame inside
 * public/favicon.ico — and nothing in the app has ever drawn it. Re-cut here
 * as a single path so it can take a colour, instead of being a black-and-white
 * raster that only sits correctly on one ground.
 *
 * One path with `fillRule="evenodd"`, and that is the load-bearing detail: the
 * triangle is a genuine HOLE, not a second shape painted the surface colour.
 * That is what lets the same component sit on the sidebar's dark chrome, on a
 * glass card and over the lit ground without any caller telling it what is
 * behind — a triangle filled `--surface-0` would be the wrong dark on the rail.
 *
 * The disc paints `currentColor`, so a caller sets it with a text colour class
 * and the mark follows the theme. No colour literal lives here.
 */
const MARK_PATH = "M0 24A24 24 0 1 1 48 24A24 24 0 1 1 0 24ZM24 11.5L35.8 33L12.2 33Z";

export function BisMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      data-slot="bis-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={className}
    >
      <path d={MARK_PATH} fillRule="evenodd" fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/components/bis-mark.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Mutation-check the one claim that matters**

Change `fill="currentColor"` to `fill="#ffffff"`, re-run, and confirm the **"takes its colour from the caller"** test fails **by name**. A `-t` filter that matches nothing skips silently, so read the failing test's name, not just the exit code. Revert the change and re-run to green.

- [ ] **Step 6: Commit**

```
cd C:/Users/danlo/bis-platform && git add apps/web/src/components/bis-mark.tsx apps/web/src/components/bis-mark.test.ts && git commit -m "feat(brand): draw the BIS mark, for the first time anywhere but the favicon"
```

---

### Task 2: The AuthShell

**Files:**
- Create: `apps/web/src/components/auth-shell.tsx`
- Create: `apps/web/src/components/auth-shell.test.ts`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `BisMark` from Task 1; the existing `Ground` from `@/components/ground`; `m` from `@/lib/messages`.
- Produces: `AuthShell({ children }: { children: ReactNode })`. Emits `data-slot="auth-rail"` on the rail — **the e2e in Tasks 3 and 6 measures that box**, so the attribute is load-bearing, not decoration.

- [ ] **Step 1: Add the rail's string**

In `apps/web/src/lib/messages.ts`, immediately after the `"landing.noAccess.body"` line, add:

```ts
  // The signed-out shell's rail. This is the line that does real work on
  // /sign-in: it answers "whose software is this", which is the question
  // somebody following a weekly bookmark actually has. There is deliberately
  // no tagline under the "Sign in" heading — see the spec, §10.
  "signIn.railCopy": "by Bespoke Intelligent Solutions",
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/auth-shell.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthShell } from "./auth-shell";

describe("AuthShell — the signed-out frame (spec §4)", () => {
  // A plain paragraph on purpose: the "no navigation" assertion below reads
  // the WHOLE markup, so the children must contribute no links of their own.
  const html = renderToStaticMarkup(
    createElement(AuthShell, null, createElement("p", null, "child content")),
  );

  it("mounts the lit ground — /sign-in never had one", () => {
    expect(html).toContain('data-slot="ground"');
  });

  it("reuses the sidebar's chrome rather than inventing a fifth surface", () => {
    expect(html).toContain("sidebar-chrome");
    // The values belong to globals.css. Restating any of them here is the
    // thing this assertion exists to catch.
    expect(html).not.toContain("backdrop-filter");
    expect(html).not.toContain("--sidebar-ground");
  });

  it("gives the rail the slot the e2e measures", () => {
    expect(html).toContain('data-slot="auth-rail"');
  });

  it("carries the mark and the wordmark, and NO navigation", () => {
    expect(html).toContain('data-slot="bis-mark"');
    expect(html).toContain(">BIS<");
    // A rail full of links nobody can follow is decorative chrome pretending
    // to be structure. The direction mockup drew one; it was rejected.
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<a ");
  });

  it("uses no colour literal — tokens only", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*[\d.]/);
  });

  it("renders its children", () => {
    expect(html).toContain("child content");
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/components/auth-shell.test.ts
```

Expected: FAIL — `Failed to resolve import "./auth-shell"`.

- [ ] **Step 4: Write the component**

Create `apps/web/src/components/auth-shell.tsx`:

```tsx
import type { ReactNode } from "react";
import { Ground } from "@/components/ground";
import { BisMark } from "@/components/bis-mark";
import { m } from "@/lib/messages";

/**
 * The frame every signed-out screen renders through: /sign-in, / and
 * /no-access.
 *
 * One shell rather than three, because those three had already drifted apart —
 * / and /no-access each mounted their own Ground and their own glass card,
 * while /sign-in was a bare <SignIn /> on a flat page with no Ground at all.
 * Re-creating that divergence is exactly what this work exists to remove.
 *
 * The left rail is the DASHBOARD SIDEBAR'S CHROME, applying the existing
 * `sidebar-chrome` utility rather than restating its values. That surface is
 * dark in BOTH themes (a recorded decision), which is what makes this
 * recognisable as the product before a word is read, and what gives the light
 * theme an anchor it otherwise lacks. It is chrome, not a fifth content
 * surface.
 *
 * There is deliberately NO navigation in it, and no setup meter. A rail full
 * of links nobody signed in can follow is decoration pretending to be
 * structure. The direction mockup drew one and it was cut.
 *
 * Below 640px the rail becomes a horizontal brand bar across the top of the
 * card so the form keeps full width on a phone; the rail's micro-copy drops
 * there rather than wrapping under the wordmark.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <Ground />
      <div className="flex w-full max-w-[840px] flex-col overflow-hidden rounded-xl border border-border bg-card glass sm:flex-row">
        <div
          data-slot="auth-rail"
          className="sidebar-chrome flex shrink-0 items-center gap-3 border-b border-[var(--sidebar-line)] px-6 py-5 sm:w-[200px] sm:flex-col sm:items-start sm:gap-2 sm:border-b-0 sm:border-r sm:py-8"
        >
          <BisMark size={28} className="text-[var(--sidebar-text-strong)]" />
          <span className="text-sm font-semibold text-[var(--sidebar-text-strong)]">
            {m["shell.brand"]}
          </span>
          <span className="hidden text-xs text-[var(--sidebar-muted)] sm:block">
            {m["signIn.railCopy"]}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 px-6 py-8 sm:px-8">
          {children}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/components/auth-shell.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```
cd C:/Users/danlo/bis-platform && git add apps/web/src/components/auth-shell.tsx apps/web/src/components/auth-shell.test.ts apps/web/src/lib/messages.ts && git commit -m "feat(auth): one shell for the signed-out screens, railed in the sidebar's chrome"
```

---

### Task 3: `/no-access` adopts the shell

The cheapest surface to prove the shell on: no Clerk form, and it renders for a signed-out caller.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/no-access/page.tsx`
- Create: `apps/web/e2e/signed-out.spec.ts`

**Interfaces:**
- Consumes: `AuthShell` from Task 2.
- Produces: `e2e/signed-out.spec.ts`, whose file-level `test.use({ storageState: { cookies: [], origins: [] } })` Tasks 4 and 6 extend rather than duplicate.

- [ ] **Step 1: Write the failing e2e**

Create `apps/web/e2e/signed-out.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

// Explicitly no storage state. playwright.config.ts gives the "chromium"
// project the agency's saved session, and every assertion in this file is
// about what a person who is NOT signed in sees. Same idiom as
// client-access.spec.ts's public-form describe.
test.use({ storageState: { cookies: [], origins: [] } });

// The mode a signed-out request paints comes from ONE place: the bis-theme
// cookie (resolveThemeMode(cookie, null) — there is no tenant to ask). There
// is deliberately no theme toggle on these screens, so setting the cookie is
// how a test reaches dark, and it is also exactly what a returning user who
// once clicked the toggle arrives with.
const THEME_COOKIE = "bis-theme";

async function visit(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
  path: string,
  mode: "light" | "dark",
) {
  if (mode === "dark") {
    await page.context().addCookies([
      { name: THEME_COOKIE, value: "dark", url: baseURL ?? "http://localhost:3000" },
    ]);
  }
  await page.goto(path);
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`));
}

for (const mode of ["light", "dark"] as const) {
  test(`/no-access renders through the shell in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/no-access", mode);

    // MEASURED, not queried. The dashboard checklist's meter shipped as a
    // 0x0 inline element and passed every presence check there was, in both
    // themes, at every value. A locator being "visible" is not a box.
    const rail = page.locator('[data-slot="auth-rail"]');
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);
    expect(box!.height, `rail height in ${mode}`).toBeGreaterThan(0);

    const mark = page.locator('[data-slot="bis-mark"]');
    const markBox = await mark.boundingBox();
    expect(markBox, "the mark has no box at all").not.toBeNull();
    expect(markBox!.width, `mark width in ${mode}`).toBeGreaterThan(0);

    // The rail is chrome, and the two themes need DIFFERENT assertions. One
    // luminance probe across both was a NO-OP in dark: `.dark` sets
    // --sidebar-ground to `transparent`, so backgroundColor resolves to
    // "rgba(0, 0, 0, 0)", a /\d+/g regex reads that as r=g=b=0, and the
    // assertion passed unconditionally no matter what the rail rendered.
    //
    // LIGHT is the load-bearing half: --sidebar-ground is an opaque #0B0A12,
    // so backgroundColor IS the rail's real colour, and the claim worth making
    // is that the rail does NOT invert with the theme.
    //
    // DARK gets the contract instead: the rail is transparent ON PURPOSE so
    // the lit ground reads through (tokens.css says exactly that in its own
    // comment), and the visible wash comes from sidebar-chrome's
    // background-IMAGE, which getComputedStyle().backgroundColor never
    // reflects. Pinning the transparency is a real, falsifiable claim — give
    // the dark rail an opaque fill and the aurora stops showing through and
    // this fails.
    const railBg = await rail.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (mode === "light") {
      // [\d.]+ , not \d+ : the old regex also dropped the fractional alpha, so
      // a fully transparent rail would have been read as opaque black.
      const channels = (railBg.match(/[\d.]+/g) ?? []).map(Number);
      expect(channels.length, `could not parse rail bg "${railBg}"`).toBeGreaterThanOrEqual(3);
      const [r = 255, g = 255, b = 255, a = 1] = channels;
      expect(a, `rail bg ${railBg} must be opaque in light`).toBe(1);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      expect(luminance, `rail bg ${railBg} must be dark in light mode`).toBeLessThan(0.3);
    } else {
      expect(railBg, "the dark rail must stay transparent so the lit ground reads through")
        .toMatch(/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$|^transparent$/);
    }

    // Both branches above read background-COLOR, and in dark that is
    // `transparent` whether the chrome applied or not — delete `sidebar-chrome`
    // from the rail's class list entirely and the dark assertion still passes,
    // on the browser's UA default, with no wash and no blur on screen. These
    // two close that hole: the gradient and the blur exist ONLY because the
    // utility landed, so they are what proves it did.
    const [railImage, railBlur] = await rail.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundImage, s.backdropFilter] as const;
    });
    expect(railImage, `the rail lost sidebar-chrome's wash in ${mode}`)
      .toContain("linear-gradient");
    if (mode === "dark") {
      // The VALUE, not the class. Lightning CSS once folded a hand-written
      // -webkit- twin into the prefixed form and dropped the standard property
      // outright: nothing blurred anywhere and the suite stayed green.
      expect(railBlur, "the dark rail must keep --glass-filter's blur").toBe("blur(14px)");
    }

    // No theme toggle on a signed-out screen, ever (spec §6). This is not a
    // style preference: theme-mode.ts records a shipped bug where a cookie
    // written at /sign-in — a route with no tenant, so it resolves light —
    // outranked every tenant's brand_mode permanently, and a company that
    // chose a dark default never saw one. A toggle here re-opens that path.
    await expect(page.getByTestId("theme-toggle")).toHaveCount(0);

    // The page's own content survived the move into the shell.
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
}

test("the rail collapses to a brand bar on a phone", async ({ page, baseURL }) => {
  // Spec §4.2. Below 640px the card is one column and the rail is a bar
  // across the top, so the form keeps full width. Asserted by GEOMETRY, not
  // by the presence of a Tailwind class: `sm:flex-row` being in the class
  // attribute proves the string was typed, not that the layout responded.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, baseURL, "/no-access", "light");

  const rail = page.locator('[data-slot="auth-rail"]');
  const narrow = await rail.boundingBox();
  expect(narrow, "the rail has no box at 390px").not.toBeNull();
  // A bar spans the card. Asserted against a width the 200px column cannot
  // reach, rather than against its own height — the rail stretches to the
  // card, so a height comparison would ride on how tall THIS page's content
  // happens to be and could flip on a page with one line less.
  expect(narrow!.width, "the rail should span the card below 640px").toBeGreaterThan(300);

  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = await rail.boundingBox();
  expect(wide, "the rail has no box at 1280px").not.toBeNull();
  expect(wide!.width, "the rail should be the 200px column above 640px")
    .toBeLessThan(230);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: FAIL — no element matches `[data-slot="auth-rail"]`, because `/no-access` still renders its own card.

If the run instead dies with **"port in use"**, a stray `next start` from an earlier session is holding 3000. Kill only a PID whose command line is your own `next start`; never kill danlo's other node processes.

- [ ] **Step 3: Rewrite the page**

Replace the whole of `apps/web/src/app/(dashboard)/no-access/page.tsx`:

```tsx
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const off = reason === "off";
  return (
    // The shell owns Ground and the card now. This page used to mount its own
    // of each — and so did the landing page, while /sign-in mounted neither.
    // Its inner glass card is GONE rather than nested: a card inside a card is
    // a fifth surface by another name (DESIGN.md rule 2). The block is
    // left-aligned for the same reason — the rail makes the card asymmetric,
    // and centred text in the right-hand column reads as a mistake.
    <AuthShell>
      <div className="flex flex-col items-start gap-3">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {off ? m["clientAccess.off.title"] : m["clientAccess.none.title"]}
        </p>
        <p className="text-sm text-muted-foreground">
          {off ? m["clientAccess.off.body"] : m["clientAccess.none.body"]}
        </p>
        <SignOutButton>
          <Button variant="outline">{m["landing.signOut"]}</Button>
        </SignOutButton>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 4: Run the e2e and make sure it passes**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: PASS, 3 tests — light, dark, and the phone collapse.

- [ ] **Step 5: Commit**

```
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/no-access/page.tsx" apps/web/e2e/signed-out.spec.ts && git commit -m "feat(auth): /no-access moves onto the shell, and the rail is measured not queried"
```

---

### Task 4: The landing page adopts the shell

**Files:**
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
- Modify: `apps/web/e2e/signed-out.spec.ts`

**Interfaces:**
- Consumes: `AuthShell` from Task 2; the `visit` helper defined in Task 3's spec.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/e2e/signed-out.spec.ts`, inside the existing `for (const mode of ...)` loop, after the `/no-access` test:

```ts
  test(`/ renders through the shell in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/", mode);

    const rail = page.locator('[data-slot="auth-rail"]');
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);

    // Copy is unchanged by this work — if it moved, that is a regression, not
    // a redesign.
    await expect(
      page.getByRole("heading", { name: "BIS Platform" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: the two new tests FAIL — no `[data-slot="auth-rail"]` on `/`. The three existing tests still pass.

- [ ] **Step 3: Rewrite the page**

Replace the whole of `apps/web/src/app/(dashboard)/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";
import { resolveClientAccount, type AppClaims } from "@/lib/auth";

export default async function Home() {
  const { userId, sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims | null;
  const hasAccess = claims?.app_role === "agency_admin";

  const clientAccount = await resolveClientAccount();
  if (clientAccount) redirect(`/dashboard/accounts/${clientAccount.id}/dashboard`);

  // Ground and the card belong to AuthShell now; this page used to mount its
  // own of each. Copy is untouched — only the frame around it changed.
  return (
    <AuthShell>
      {/* Title and tagline sit OUTSIDE the branch, exactly as they did before:
          in the old file they were unconditional siblings of the three-armed
          ternary, so they rendered above the no-access card too. Nesting them
          in the else-arm silently drops both for a signed-in non-agency user —
          a real, reachable state that no test in this repo exercises, since
          nothing signs in at `/`. Copy is unchanged by this work. */}
      <h1 className="font-display text-4xl font-[650] tracking-[-0.01em] text-foreground">
        {m["landing.title"]}
      </h1>
      <p className="max-w-md text-balance text-muted-foreground">{m["landing.tagline"]}</p>

      {userId && !hasAccess ? (
        <div className="flex flex-col items-start gap-3">
          <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{m["landing.noAccess.title"]}</p>
          <p className="text-sm text-muted-foreground">{m["landing.noAccess.body"]}</p>
          <SignOutButton>
            <Button variant="outline">{m["landing.signOut"]}</Button>
          </SignOutButton>
        </div>
      ) : (
        <Button asChild size="lg" className="self-start">
          <Link href="/dashboard">
            {userId ? m["landing.goToDashboard"] : m["landing.signIn"]}
          </Link>
        </Button>
      )}
    </AuthShell>
  );
}
```

Note the branch collapse: the old file had three arms, two of which rendered byte-identical title/tagline/button blocks differing only in the button's label. One arm with a ternary on the label is the same output with one copy of the markup.

- [ ] **Step 4: Run the e2e and make sure it passes**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/page.tsx" apps/web/e2e/signed-out.spec.ts && git commit -m "feat(auth): the landing page moves onto the shell, three arms become one"
```

---

### Task 5: The Clerk cascade layer

This task ships no visible change. It exists because it is the single point of failure for all of Task 6: if the layer is missing or misnamed, our classes silently lose to Clerk's stylesheet, the page looks approximately right in a screenshot, and nothing goes red.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/globals.css`
- Create: `apps/web/src/lib/branding/clerk-layer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a CSS cascade layer named `clerk`, declared **before** Tailwind's, so Tailwind utilities outrank Clerk's own rules. Task 6 passes the same literal string as `appearance.cssLayerName`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/branding/clerk-layer.test.ts`:

```ts
// The CSS is data, so the test reads it — same shape as
// northern-lights.test.ts and design-foundation.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(path.join(here, "../../app/(dashboard)/globals.css"), "utf8");

describe("the clerk cascade layer (spec §7)", () => {
  it("is declared", () => {
    expect(globals).toMatch(/@layer\s+clerk\s*;/);
  });

  it("is declared BEFORE tailwind is imported", () => {
    // Layer priority follows declaration order: first declared is weakest.
    // Declaring `clerk` before `@import "tailwindcss"` is the entire reason
    // our utility classes beat Clerk's own rules WITHOUT !important. Move it
    // after, and the styling silently stops applying while the page still
    // renders — no error, no red test, just Clerk's defaults.
    const layerAt = globals.search(/@layer\s+clerk\s*;/);
    const tailwindAt = globals.indexOf('@import "tailwindcss"');
    expect(layerAt).toBeGreaterThanOrEqual(0);
    expect(tailwindAt).toBeGreaterThanOrEqual(0);
    expect(layerAt).toBeLessThan(tailwindAt);
  });

  it("never resorts to !important to win the cascade", () => {
    // COMMENTS ARE STRIPPED FIRST, and that is not incidental: this file's own
    // commentary discusses `!important` by name, so a whole-file substring
    // match reports a declaration that does not exist. hero.test.ts fell into
    // exactly this trap — a tightened regex still matched `/* the hero one */`
    // — and its own negative control is what caught it.
    const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    // Of the DECLARATIONS that remain, the only !important belongs to the
    // prefers-reduced-motion override, where it is correct and required — a
    // motion guard that can be out-specified is not a guard. Strip that block;
    // there must be none left. If a Clerk style is winning, this layer is
    // wrong, and escalating specificity hides that instead of fixing it.
    const withoutMotionGuard = code.replace(
      /@media\s*\(prefers-reduced-motion[\s\S]*?\n\}/,
      "",
    );
    expect(withoutMotionGuard).not.toContain("!important");
    // Guard the guard: if the reduced-motion block is ever removed or
    // reshaped, the strip above silently stops covering anything and this
    // test quietly weakens into a tautology.
    expect(globals).toContain("prefers-reduced-motion");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/lib/branding/clerk-layer.test.ts
```

Expected: FAIL on the first two — no `@layer clerk;` in the file.

- [ ] **Step 3: Declare the layer**

Edit `apps/web/src/app/(dashboard)/globals.css`. The file currently begins:

```css
@import "../../styles/tokens.css";
@import "tailwindcss";
```

Make it begin:

```css
/* Clerk's own stylesheet goes here, and this line must stay FIRST.
   Layer priority follows declaration order, so a layer declared before
   Tailwind's is weaker than every Tailwind utility — which is what lets the
   class names we hand Clerk through `appearance.elements` win without a
   single `!important`. A `@layer` statement is one of the two rules CSS
   allows to precede `@import`. Move this below the imports and the sign-in
   page quietly reverts to Clerk's defaults while still rendering. */
@layer clerk;
@import "../../styles/tokens.css";
@import "tailwindcss";
```

- [ ] **Step 4: Run the tests and make sure they pass**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web exec vitest run src/lib/branding/clerk-layer.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the build actually emits it**

A source-text test proves the file says it; it does not prove Lightning CSS kept it. Build and grep the emitted CSS:

```
cd C:/Users/danlo/bis-platform && pnpm --filter web build
```

Then:

```
cd C:/Users/danlo/bis-platform && grep -ro "@layer[^{;]*clerk[^{;]*[;{]" apps/web/.next/static | head
```

Expected: at least one match naming `clerk`. **If there is no match, stop and report it** — the whole styling approach in Task 6 rests on this, and the fallback (declaring the full order explicitly as `@layer clerk, theme, base, components, utilities;`) is a decision to raise, not to make silently.

- [ ] **Step 6: Commit**

```
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/globals.css" apps/web/src/lib/branding/clerk-layer.test.ts && git commit -m "feat(auth): give Clerk its own cascade layer, so our classes win without !important"
```

---

### Task 6: The sign-in page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/e2e/signed-out.spec.ts`

**Interfaces:**
- Consumes: `AuthShell` (Task 2), the `clerk` layer (Task 5), the `visit` helper (Task 3).
- Produces: the finished page. Nothing later depends on it.

- [ ] **Step 1: Add the heading string**

In `apps/web/src/lib/messages.ts`, directly above the `"signIn.railCopy"` line added in Task 2:

```ts
  "signIn.title": "Sign in",
```

Two strings for this screen, and deliberately no third — see the spec, §10.

- [ ] **Step 2: Write the failing test**

Append to `apps/web/e2e/signed-out.spec.ts`, inside the existing `for (const mode of ...)` loop:

```ts
  test(`/sign-in wears the shell and the restyled Clerk form in ${mode}`, async ({ page, baseURL }) => {
    await visit(page, baseURL, "/sign-in", mode);

    const rail = page.locator('[data-slot="auth-rail"]');
    const box = await rail.boundingBox();
    expect(box, "the rail has no box at all").not.toBeNull();
    expect(box!.width, `rail width in ${mode}`).toBeGreaterThan(0);
    expect(box!.height, `rail height in ${mode}`).toBeGreaterThan(0);

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Nobody is authenticated here, so there is no tenant and the root layout
    // must not have painted one. This is the assertion that keeps a future
    // "let's brand sign-in per client" change honest.
    await expect(page.locator("body")).not.toHaveAttribute("data-tenant-theme");

    // Clerk's own form still works. Without this, every assertion above is
    // satisfied by a page that renders a beautiful shell around nothing.
    const email = page.getByLabel(/email/i).first();
    await expect(email).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();

    // The probe that matters: read the resolved VALUE, not the class name.
    // Asserting the class is present passes even when Clerk's stylesheet won
    // the cascade — the same failure mode as the backdrop-filter regression
    // that shipped green because the test pinned the class rather than the
    // computed style.
    // Anchored, NOT /continue/i: the Google button reads "Continue with
    // Google" and matches a loose regex too, and it comes first in the DOM —
    // so `.first()` on a loose match would probe the wrong button and pass
    // for the wrong reason.
    const submit = page.getByRole("button", { name: /^Continue$/ });
    await expect(submit).toBeVisible();
    const bg = await submit.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg, `the primary button in ${mode} is not painting --gradient-primary`)
      .toContain("linear-gradient");
  });
```

- [ ] **Step 3: Run it to make sure it fails**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: the two new tests FAIL — no `[data-slot="auth-rail"]` on `/sign-in`. The five earlier tests still pass.

- [ ] **Step 4: Rewrite the page**

Replace the whole of `apps/web/src/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import type { ComponentProps } from "react";
import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

/**
 * Clerk restyled through OUR class names, not through `appearance.variables`.
 *
 * `elements` accepts `string | CSSObject` per @clerk/react's own types, so a
 * class name is a first-class value here — which keeps every colour in
 * tokens.css (DESIGN.md: components consume tokens only) and makes light/dark
 * follow the existing `.dark` class with no Clerk theme swap and no flash.
 *
 * `variables` is deliberately unused. `{ colorPrimary: 'var(--accent)' }` would
 * typecheck — CssColor is a bare `string` — but Clerk derives a whole shade
 * scale from that value at runtime, which needs a colour it can parse. It
 * compiles and may simply not work, which is the worst of both.
 *
 * `cssLayerName` is what makes any of this apply: it puts Clerk's stylesheet in
 * the `clerk` layer, declared first in globals.css and therefore weaker than
 * every Tailwind utility. Without it these classes lose and nothing says so.
 *
 * `satisfies` rather than a plain const: it keeps excess-property checking on
 * the object literal, so a mistyped element key is a typecheck error instead of
 * a line that silently styles nothing.
 */
const appearance = {
  cssLayerName: "clerk",
  layout: {
    // Our mark is in the rail. Clerk must not draw a second one.
    logoPlacement: "none",
  },
  elements: {
    // Clerk's header is "Sign in to {applicationName}" — which on the current
    // instance reads "Sign in to BIS Platform (dev)". Ours replaces it.
    header: "hidden",
    // The shell already IS the card. Flattened rather than restyled: a card
    // inside a card is a fifth surface by another name (DESIGN.md rule 2).
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-0 bg-transparent",
    card: "w-full shadow-none border-0 bg-transparent p-0 gap-3",
    main: "gap-3",
    footer: "bg-transparent",
    socialButtonsBlockButton:
      "h-9 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-transparent text-sm font-medium text-foreground",
    dividerLine: "bg-border",
    dividerText: "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground",
    formFieldLabel: "text-xs font-medium text-muted-foreground",
    formFieldInput:
      "h-9 rounded-[var(--radius-ctl)] border border-[var(--input-line)] bg-[var(--input-bg)] text-sm text-foreground",
    formButtonPrimary:
      "btn-primary h-9 rounded-[var(--radius-ctl)] text-sm font-semibold normal-case",
  },
} satisfies ComponentProps<typeof SignIn>["appearance"];

export default function Page() {
  return (
    // This route is a catch-all: it also renders Clerk's TASK screens, such as
    // /sign-in/tasks/choose-organization, which is a different component of
    // theirs inside the same shell. Nothing here may fix a height or assume
    // the sign-in card's contents — and Clerk can inject a Smart CAPTCHA
    // mid-flow, so the card has to be free to grow.
    <AuthShell>
      <h1 className="font-display text-2xl font-[650] tracking-[-0.02em] text-foreground">
        {m["signIn.title"]}
      </h1>
      <SignIn appearance={appearance} />
    </AuthShell>
  );
}
```

- [ ] **Step 5: Run the new e2e and make sure it passes**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e signed-out.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Run the FULL e2e suite — this is the step that matters**

```
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e
```

`auth.setup.ts` visits `/sign-in` and then clicks a **"Choose an organization"** button at `/sign-in/tasks/choose-organization` — a different Clerk component rendered through this same catch-all route. If the shell or the `appearance` map breaks that screen, **every spec in the suite fails at setup**, not just this one. A green `signed-out.spec.ts` proves nothing about it, because that spec never signs in.

Expected: the whole suite green, ~5 min. Judge a red spec by wall clock first and re-run it alone before believing it — the suite shares one database with CI.

- [ ] **Step 7: Mutation-check the probe**

Delete `btn-primary` from `formButtonPrimary`, re-run `signed-out.spec.ts`, and confirm the **computed-style** assertion fails by name in both modes. If it still passes, the probe is theatre and the layer (Task 5) or the element key is wrong — report it rather than weakening the test. Restore and re-run to green.

- [ ] **Step 8: Commit**

```
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/sign-in/[[...sign-in]]/page.tsx" apps/web/src/lib/messages.ts apps/web/e2e/signed-out.spec.ts && git commit -m "feat(auth): the sign-in page finally wears the product"
```

---

### Task 7: Amend DESIGN.md rule 9

**Files:**
- Modify: `DESIGN.md` (rule 9, lines 95-96)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Pure documentation, separable on purpose — a reviewer can reject this wording while accepting the code.

- [ ] **Step 1: Replace the rule**

In `DESIGN.md`, replace:

```
9. Client-customer surfaces (booking page, forms, emails, login) always carry
   the client's logo + brand color from the theming engine.
```

with:

```
9. Client-customer surfaces (booking page, forms, emails) always carry the
   client's logo + brand color from the theming engine. **Login is the one
   exception and carries the platform's mark and accent instead** — nobody is
   authenticated at `/sign-in`, so `getRequestTheme()` resolves "no tenant" and
   there is no account whose brand could be read. Do not "fix" this by branding
   sign-in per tenant without first solving how the tenant is identified before
   authentication (2026-09-11).
```

The parenthetical reason is load-bearing. Without it the rule reads as an omission somebody will later close.

- [ ] **Step 2: Check nothing else cites the old wording**

```
cd C:/Users/danlo/bis-platform && grep -rn "rule 9\|rule-9" --include=*.md --include=*.ts --include=*.tsx . | grep -v node_modules
```

Expected: hits in this plan and the spec only. Anything else that quotes the old text needs updating in this commit.

- [ ] **Step 3: Commit**

```
cd C:/Users/danlo/bis-platform && git add DESIGN.md && git commit -m "docs(design): rule 9 says what login can actually do"
```

---

## Final verification

- [ ] **Whole-suite gates, unpiped.** A pipe masks the exit code; redirect and read `$?`.

```
cd C:/Users/danlo/bis-platform && pnpm check > check.log 2>&1; echo "check exit: $?"
cd C:/Users/danlo/bis-platform && pnpm --filter web build > build.log 2>&1; echo "build exit: $?"
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e > e2e.log 2>&1; echo "e2e exit: $?"
```

All three must be `0`. `pnpm check` as a whole, not the touched suites — it has caught what targeted runs could not.

- [ ] **Photograph all three screens in both themes on the BUILT app**, not the styleguide, and not `next dev`. A visual treatment that was only ever checked on a component page has shipped here before while 25 real surfaces went untouched.

- [ ] **Probe the computed style on a restyled Clerk element in both themes** and record the values. "The class is on the element" is not evidence.

- [ ] **Confirm `apps/web/public/favicon.ico` is untouched** — `git status` should never have listed it.

- [ ] Delete `check.log`, `build.log`, `e2e.log` with absolute paths.

- [ ] Push the branch and open the PR. **Merge only when CI `verify` AND `e2e` are both green on the PR's current head commit** — read the check runs via REST (`/commits/<sha>/check-runs`), never infer from an earlier run, and never push `main`.

## Known risks, carried from the spec

- **Clerk's `elements` keys are a public API; its internal DOM is not.** A Clerk release can re-shape the card. The computed-style probe is what turns that from a silent visual regression into a red test.
- **`cssLayerName` is the entire basis for our classes applying.** Task 5 step 5 is the only place its real effect is checked.
- **`captchaWidgetType` is `"smart"`** — Clerk can inject a challenge into the card mid-flow. Nothing in the shell may fix a height.
- **Renaming the Clerk app is danlo's, outside this PR.** Hiding Clerk's header removes "BIS Platform (dev)" from the card either way; only a production instance removes the Development-mode banner (spec §8).

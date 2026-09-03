# Design Phase 7 — Client-customer surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the booking flow's three live defects, collapse three
near-duplicate brand headers into one shared component, and add the two
contract items that are genuinely additive (step dots, Powered-by footer).

**Architecture:** No new data, no new routes, no schema change, no new
dependency. One new shared component plus one shared stylesheet; one new pure
derivation function; four localised edits. The theming engine is not modified —
this phase only makes two pages *consume* tokens it already emits to them.

**Tech Stack:** Next.js App Router (public routes `/b` and `/f`), plain CSS
(these routes are deliberately outside the dashboard's Tailwind layer),
vitest (no DOM), Playwright.

## Global Constraints

- **Tokens only for what this phase touches** — no new hard-coded colours,
  radii or shadows. Existing `var(--token, <literal>)` fallbacks are the
  house pattern on these routes and stay.
- **Do NOT add a card, border or shadow to `/b`.** Both public surfaces
  deliberately paint none — a recorded M4b decision (`form.css:9-12`).
- **Do NOT change what `themeStyle()` / `publicFormTheme()` emit.** Consuming
  an already-emitted token is in scope; changing the engine is not.
- **Public copy goes in `lib/booking/public-strings.ts`, in BOTH languages.**
  `lib/messages.ts` is the single-locale dashboard catalogue — booking copy was
  deliberately moved out of it by PR #22.
- **`/f` is live and carries real customers.** Its rendering must not move.
  `public-form-theme.spec.ts` (5 tests) and `client-access.spec.ts` are the
  proof and must pass unchanged in behaviour.
- Renders correctly in dark AND light; the public routes get their mode from
  `publicFormTheme` + the `?theme=` host hint, not from a `.dark` class.
- Copy passes the "landscaper at 7 AM" read.

## One change from the approved design, and why

The approved design included a fifth fix: giving `b/error.tsx`'s inline styles
the `var(--token, literal)` shape. **It is dropped.** Reading the file shows the
literals are deliberate and documented — its own comment says "inline CSS, no
`m` message catalog (this boundary must render even if the failure is somehow
in a message-catalog import), no shadcn primitives". More decisively, an error
boundary REPLACES the page content, so the `<main style={style}>` that carries
the tenant tokens never rendered: `var(--foreground, …)` there would resolve to
the fallback 100% of the time. Adding it would make the file *look*
token-compliant while changing nothing, which is worse than leaving an honest
literal. Flagged to danlo rather than silently dropped.

## File Structure

**Create**
- `apps/web/src/components/public-brand.tsx` — the one brand header for all
  three public surfaces.
- `apps/web/src/styles/public-brand.css` — its one stylesheet.
- `apps/web/src/lib/booking/steps.ts` — pure step derivation.
- `apps/web/src/lib/booking/steps.test.ts`

**Modify**
- `apps/web/src/app/f/[publicId]/form-brand.tsx` — deleted, replaced by the shared component.
- `apps/web/src/app/f/[publicId]/page.tsx` — import the shared component + stylesheet.
- `apps/web/src/app/f/[publicId]/form.css` — brand rules removed (they move to the shared sheet).
- `apps/web/src/app/b/[publicId]/page.tsx` — shared brand; `--public-measure`.
- `apps/web/src/app/b/[publicId]/booking-page.tsx` — error token, step dots, footer, brand CSS removed.
- `apps/web/src/app/b/[publicId]/cancel/[token]/page.tsx` — shared brand, error token, `?theme=`, footer.
- `apps/web/src/lib/booking/public-strings.ts` — step + footer copy, both locales.
- `apps/web/e2e/public-form-theme.spec.ts` — two locator strings.
- `apps/web/e2e/client-access.spec.ts` — one locator string.
- `apps/web/e2e/booking.spec.ts` — new assertions.

---

### Task 1: One shared brand header, with a measure

Closes design fixes **2** (brand header has no measure — a live layout bug on
`/b` and the cancel page) and **4** (three near-duplicate headers).

**Files:**
- Create: `apps/web/src/components/public-brand.tsx`
- Create: `apps/web/src/styles/public-brand.css`
- Delete: `apps/web/src/app/f/[publicId]/form-brand.tsx`
- Modify: `apps/web/src/app/f/[publicId]/page.tsx`, `apps/web/src/app/f/[publicId]/form.css`
- Modify: `apps/web/src/app/b/[publicId]/page.tsx`, `apps/web/src/app/b/[publicId]/booking-page.tsx`
- Modify: `apps/web/src/app/b/[publicId]/cancel/[token]/page.tsx`
- Modify: `apps/web/e2e/public-form-theme.spec.ts`, `apps/web/e2e/client-access.spec.ts`

**Interfaces:**
- Produces: `PublicBrand({ name, logoUrl }: { name: string | null; logoUrl: string | null }): JSX.Element | null`
  — returns `null` when both are absent. Tasks 4 and 5 render beside it.
- Produces the CSS custom property `--public-measure`, which each route sets to
  its own column width. Default `34rem`.

**The measure is per-route and that is the point.** `/f`'s column is `34rem`
(`form.css:97-100`); `/b`'s and the cancel page's are `480px`
(`booking-page.tsx:388`, `cancel/[token]/page.tsx:161`). A single hard-coded
measure in the shared sheet would misalign two of the three surfaces — the
exact bug being fixed.

- [ ] **Step 1: Write the failing e2e assertion, INSIDE the existing journey**

`booking.spec.ts` is deliberately ONE long test, and says so at `:12-18`:
*"every later step depends on state the earlier ones created (the calendar's
public URL, the booking's cancel link), so splitting it would mean re-deriving
that state per test."* Adding standalone tests would fight that design and
re-derive `publicPath` for each. **Extend the journey instead.**

`publicPath` is derived at `booking.spec.ts:249` and the anonymous visitor's
page is `anonPage` (`:253`). Immediately after the existing
`await anonPage.goto(publicPath);` at `:256`, insert:

```ts
    // --- P7: the brand header tracks the column it heads -------------------
    // The same property public-form-theme.spec.ts:118-129 already pins for
    // /f. The brand header is a SIBLING of the booking column, not a child,
    // so it needs the column's own measure or the client's logo hangs at the
    // far left while the page it belongs to sits centred.
    await anonPage.setViewportSize({ width: 1280, height: 800 });
    const boxOf = async (selector: string) => {
      const b = await anonPage.locator(selector).boundingBox();
      if (!b) throw new Error(`${selector} has no box — it did not render`);
      return b;
    };
    const column = await boxOf(".bis-booking");
    const brand = await boxOf(".bis-brand");
    expect(Math.abs(brand.x - column.x), "the brand header tracks the column")
      .toBeLessThanOrEqual(1);
```

The fixture account is branded (`auth.setup.ts` writes `brandName` and
`brandLogoPath`), so `PublicBrand` renders rather than returning null — that
is what makes this assertion meaningful rather than vacuous.

⚠️ The viewport change persists for the rest of the journey. Set it back to the
project default immediately after this block if any later step depends on the
narrower default — check `playwright.config.ts`'s `devices["Desktop Chrome"]`
viewport and restore it explicitly rather than assuming.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx playwright test booking -g "brand header tracks"`
Expected: FAIL — either `.bis-brand has no box` (the class does not exist yet)
or an x-offset far greater than 1px (today's bug).

- [ ] **Step 3: Write the shared component**

Create `apps/web/src/components/public-brand.tsx`:

```tsx
/**
 * The brand header above every public, customer-facing page — the lead form,
 * the booking page and the cancel page.
 *
 * One component and one stylesheet replace three near-identical copies that
 * had drifted apart: the form's capped its logo at 40px and gave the row the
 * form's own measure, while the booking and cancel copies used a fixed 28px
 * logo and NO measure at all, so on a wide viewport the client's logo hung at
 * the far left while the column it heads sat centred.
 *
 * Returns null rather than an empty wrapper when there is nothing to show:
 * an unbranded form must still render exactly what it rendered before M4b,
 * byte for byte.
 *
 * The measure is deliberately NOT baked in here — each route sets
 * `--public-measure` to its own column width, because they differ (34rem for
 * the form, 480px for the booking flow). Hard-coding one would misalign two
 * of the three surfaces, which is the bug this component exists to fix.
 */
export function PublicBrand({
  name,
  logoUrl,
}: {
  name: string | null;
  logoUrl: string | null;
}) {
  if (!name && !logoUrl) return null;

  return (
    <div className="bis-brand">
      {logoUrl ? (
        // Decorative: when the brand name is beside it the text already carries
        // the meaning, and when it is not, there is no text to honestly borrow
        // — inventing alt copy for a logo we know nothing about would be worse
        // than leaving it silent.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="bis-brand-logo" />
      ) : null}
      {name ? <span className="bis-brand-name">{name}</span> : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the shared stylesheet**

Create `apps/web/src/styles/public-brand.css`. These values are `form.css:68-76`
verbatim — the form's rendering must not move — plus the measure, generalised:

```css
/* The brand header shared by /f, /b and /b/.../cancel.
   Values are the form's, unchanged: it is the one of the three that was
   reviewed, measured and shipped, so it is the one the others converge on. */
.bis-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 0;
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  /* THE MEASURE. The brand header is a SIBLING of the column it heads, not a
     child, so it needs the column's own width or the logo hangs to the left of
     the content it belongs to. Each route sets --public-measure; 34rem is the
     form's, and the default only because the form is the surface this came
     from. */
  max-width: var(--public-measure, 34rem);
  margin-inline: auto;
}
/* Capped in both directions so a large upload cannot dominate the page a
   customer came to in order to book or fill in a form. */
.bis-brand-logo {
  max-height: 40px;
  max-width: 180px;
  width: auto;
  height: auto;
  object-fit: contain;
}
.bis-brand-name { font-size: 17px; font-weight: 600; }
```

- [ ] **Step 5: Migrate the form (the proven surface) — rendering must not move**

In `apps/web/src/app/f/[publicId]/page.tsx`: delete the `FormBrand` import, add

```tsx
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
```

and replace the `<FormBrand … />` usage with `<PublicBrand … />`, keeping the
same props. Delete `apps/web/src/app/f/[publicId]/form-brand.tsx`.

In `form.css`, delete the now-duplicated rules: `.bis-form-brand` (`:68-72`),
`.bis-form-brand-logo` (`:75`), `.bis-form-brand-name` (`:76`), and remove
`.bis-form-brand` from the shared measure rule at `:97-100` so it reads:

```css
.bis-form {
  max-width: 34rem;
  margin-inline: auto;
}
```

Keep every surrounding comment in `form.css` — they document why the measure
exists and why this is not a card.

- [ ] **Step 6: Update the two e2e locators**

Both assertions are behavioural (a bounding box and an image src), so only the
selector string changes and the safety net is preserved intact:

- `apps/web/e2e/public-form-theme.spec.ts:123` — `box(".bis-form-brand")` → `box(".bis-brand")`
- `apps/web/e2e/client-access.spec.ts:228` — `page.locator(".bis-form-brand-logo")` → `page.locator(".bis-brand-logo")`

- [ ] **Step 7: Prove the form did not move**

Run: `cd apps/web && npx playwright test public-form-theme client-access`
Expected: PASS, all tests. These are the regression proof for the one surface
in this phase that already had real customers on it.

- [ ] **Step 8: Migrate the booking page**

In `apps/web/src/app/b/[publicId]/page.tsx`: add the two imports from Step 5,
and replace the inlined brand `<div className="bis-booking-brand">…</div>`
block (`:142-152`) with:

```tsx
        <PublicBrand
          name={branding.brandName}
          logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        />
```

The surrounding `{(branding.brandName || branding.brandLogoPath) ? ( … ) : null}`
conditional goes away — `PublicBrand` owns that decision now.

In `booking-page.tsx`'s `BOOKING_CSS`, delete `.bis-booking-brand`,
`.bis-booking-brand-logo` and `.bis-booking-brand-name` (`:382-384`), and set
the measure on the page root:

```css
.bis-booking-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
```

- [ ] **Step 9: Migrate the cancel page**

Same two imports. Replace the inlined brand block
(`cancel/[token]/page.tsx:120-128`) with the same `<PublicBrand … />` call, and
in `CANCEL_CSS` delete `.bis-cancel-brand`, `.bis-cancel-brand-logo`,
`.bis-cancel-brand-name` (`:157-159`) and set the measure:

```css
.bis-cancel-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
```

- [ ] **Step 10: Run the new assertion and the full booking spec**

Run: `cd apps/web && npx playwright test booking public-form-theme client-access`
Expected: PASS, including the Step 1 assertion that previously failed.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm --filter web typecheck && pnpm --filter web lint
git add apps/web/src/components/public-brand.tsx apps/web/src/styles/public-brand.css apps/web/src/app/f apps/web/src/app/b apps/web/e2e
git commit -m "fix(public): one brand header, with the measure the booking flow never had"
```

---

### Task 2: The error colour, on the two pages that hard-code it

Closes design fix **1** — a live AA failure on a revenue surface.

**Files:**
- Modify: `apps/web/src/app/b/[publicId]/booking-page.tsx:412`
- Modify: `apps/web/src/app/b/[publicId]/cancel/[token]/page.tsx:173`
- Modify: `apps/web/e2e/booking.spec.ts`

**Interfaces:**
- Consumes `--form-error`, already emitted to both pages by
  `publicFormTheme` — `public-form-theme.ts:176` is
  `ensureContrast(FORM_ERROR, theme.background, 4.5) ?? theme.foreground`, with
  the unthemed default `#b91c1c` at `:82`. Both pages already call
  `publicFormTheme` and already receive it; they simply never read it.

- [ ] **Step 1: Write the failing e2e assertion, inside the journey**

Reaching the error is deterministic: the form is `noValidate`
(`booking-page.tsx:293`) and validation lives SERVER-side —
`actions.ts:195` returns `{ ok: false, error: s.required }` for an empty
submit, which renders `.bis-booking-error` at `booking-page.tsx:358-360`.

In `booking.spec.ts`, after the journey clicks a slot
(`await anonPage.locator("button.bis-booking-slot").first().click();`, `:259`)
and BEFORE it fills the form, insert:

```ts
    // --- P7: the error a customer reads must clear AA ----------------------
    // The fixture is a THEMED tenant (warm / dark). A raw #b91c1c measures
    // 2.93:1 on all three dark ramps — under AA, on the sentence that tells
    // someone their email address is wrong. The form tokenised this exact
    // value for this exact reason (form.css:60); this page had not.
    // Submitting empty is the cheapest way to render the error: the form is
    // noValidate and actions.ts:195 rejects server-side.
    await anonPage.getByRole("button", { name: /confirm booking/i }).click();
    const bookingError = anonPage.locator(".bis-booking-error").first();
    await expect(bookingError).toBeVisible();
    const errorColour = await bookingError.evaluate((el) => getComputedStyle(el).color);
    const pageBackground = await anonPage.locator(".bis-booking-page").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(pageBackground, "the page must paint an opaque background to measure against")
      .not.toBe("rgba(0, 0, 0, 0)");
    expect(paintedContrast(errorColour, pageBackground),
      "the error a customer reads must clear AA against the page it sits on")
      .toBeGreaterThanOrEqual(4.5);
```

and add `paintedContrast` to the existing `./support` import at `:4`.

⚠️ Two real risks, both to CHECK rather than assume. First, the empty submit
must not consume the held slot or otherwise disturb the journey's later steps —
it returns `ok: false` so no booking is written, but confirm the slot is still
selected afterwards and the form still renders before continuing. Second,
`.bis-booking-page` sets `background: var(--background, transparent)`: on an
UNTHEMED account that resolves to literal `transparent` and the ratio would be
meaningless. The assertion above fails loudly in that case rather than passing
vacuously — if the fixture turns out unthemed, measure against the element that
actually paints instead of weakening the check.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx playwright test booking`
Expected: FAIL with a ratio near 2.93 on the themed fixture.

- [ ] **Step 3: Read the token that is already there**

`booking-page.tsx:412` — replace:

```css
.bis-booking-error { color: #b91c1c; margin: 0 0 8px; }
```

with:

```css
.bis-booking-error { color: var(--form-error, #b91c1c); margin: 0 0 8px; }
```

`cancel/[token]/page.tsx:173` — replace:

```css
.bis-cancel-error { color: #b91c1c; margin: 12px 0 0; }
```

with:

```css
.bis-cancel-error { color: var(--form-error, #b91c1c); margin: 12px 0 0; }
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/web && npx playwright test booking -g "legible"`
Expected: PASS — the token is contrast-corrected to 4.5:1 at source.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/b" apps/web/e2e/booking.spec.ts
git commit -m "fix(booking): the error a customer reads clears AA on a dark tenant"
```

---

### Task 3: The cancel page honours the host theme hint

Closes design fix **3**.

**Files:**
- Modify: `apps/web/src/app/b/[publicId]/cancel/[token]/page.tsx:108`

**Interfaces:**
- Consumes `parseHostMode(value: string | null | undefined): HostMode | null`
  from `@/lib/branding/public-form-theme` (`:102`).

`cancel/[token]/page.tsx:108` calls `publicFormTheme(branding, false)` with no
third argument, so `hostMode` defaults to null and a `?theme=dark` host embeds
a light cancel page. The page ALREADY reads `searchParams` and already parses
`?locale=` at `:92-93`.

- [ ] **Step 1: Write the failing test**

The journey already captures the cancel link at `booking.spec.ts:284`
(`const cancelHref = await cancelLink.getAttribute("href");`) and visits it at
`:314`. Insert this immediately BEFORE that visit, so it runs while the
booking is still live:

```ts
    // --- P7: the host's colour mode reaches the cancel page too -------------
    // It is the second page of the same flow, in the same iframe. PR #22
    // added ?locale= to this page and left ?theme= out, so a dark host site
    // embedded a light cancel page.
    // Asserted as a DIFFERENCE between hinted and unhinted rather than
    // against a hard-coded rgb: the tenant's own light background is not
    // necessarily white, and pinning a literal would make this pass for the
    // wrong reason the day the fixture's ramp changes.
    await anonPage.goto(cancelHref!);
    const unhinted = await anonPage.locator(".bis-cancel-page").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await anonPage.goto(`${cancelHref!}${cancelHref!.includes("?") ? "&" : "?"}theme=dark`);
    const hinted = await anonPage.locator(".bis-cancel-page").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(hinted, "a dark host hint must change what the cancel page paints")
      .not.toBe(unhinted);
```

⚠️ These two loads are read-only GETs of the cancel PAGE — they must not
cancel anything. The page only cancels on the form's submit (`CancelForm`),
which this block never clicks, so the journey's later "cancel via the captured
link, then idempotent replay" steps at `:314-321` still exercise a live
booking. Confirm that ordering holds when you insert it.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx playwright test booking`
Expected: FAIL — the hinted and unhinted pages paint identically today.

- [ ] **Step 3: Pass the hint**

Add to the imports:

```tsx
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
```

and at `:108` replace:

```tsx
  const { style, darkCss, themed } = publicFormTheme(branding, false);
```

with:

```tsx
  // The third argument the booking page has had since PR #22 and this page
  // did not: a host site that renders this in an iframe names its own colour
  // mode with ?theme=, and the cancel page is the second page of that same
  // flow. Read with the same `typeof` guard as ?locale= two lines above.
  const { style, darkCss, themed } = publicFormTheme(
    branding, false, parseHostMode(typeof query.theme === "string" ? query.theme : undefined),
  );
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/web && npx playwright test booking`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/b/[publicId]/cancel" apps/web/e2e/booking.spec.ts
git commit -m "fix(booking): the cancel page reads the host theme hint too"
```

---

### Task 4: Step dots

DESIGN.md's Booking-page key pattern asks for step dots. The page is already a
three-state flow and the state already exists — nothing new is tracked.

**Files:**
- Create: `apps/web/src/lib/booking/steps.ts`, `apps/web/src/lib/booking/steps.test.ts`
- Modify: `apps/web/src/lib/booking/public-strings.ts`
- Modify: `apps/web/src/app/b/[publicId]/booking-page.tsx`

**Interfaces:**
- Produces: `type BookingStep = 1 | 2 | 3` and
  `bookingStep(state: { selectedSlot: string | null; succeeded: boolean }): BookingStep`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/booking/steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bookingStep } from "./steps";

describe("bookingStep", () => {
  it("starts at pick-a-time", () => {
    expect(bookingStep({ selectedSlot: null, succeeded: false })).toBe(1);
  });

  it("advances to your-details once a slot is chosen", () => {
    expect(bookingStep({ selectedSlot: "2026-09-04T15:00:00Z", succeeded: false })).toBe(2);
  });

  it("shows confirmed once the booking succeeded", () => {
    expect(bookingStep({ selectedSlot: "2026-09-04T15:00:00Z", succeeded: true })).toBe(3);
  });

  it("treats success as final even if a slot is somehow still held", () => {
    // The success branch early-returns in the component, so this ordering is
    // what keeps the indicator from claiming step 2 on a confirmed booking.
    expect(bookingStep({ selectedSlot: null, succeeded: true })).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/booking/steps.test.ts`
Expected: FAIL — cannot resolve `./steps`.

- [ ] **Step 3: Write the derivation**

Create `apps/web/src/lib/booking/steps.ts`:

```ts
/**
 * Where the visitor is in the booking flow, derived from state the page
 * already holds — no new state, and nothing to keep in step.
 *
 * Pure and in `lib/` rather than beside the component because this app's
 * vitest has no DOM (`vitest.config.ts` includes only `*.test.ts`), so logic
 * that lives in a `.tsx` file cannot be unit-tested at all.
 */
export type BookingStep = 1 | 2 | 3;

export const BOOKING_STEP_COUNT = 3;

export function bookingStep(
  state: { selectedSlot: string | null; succeeded: boolean },
): BookingStep {
  // Success first: the component's success branch early-returns and never
  // renders the picker, so a confirmed booking is step 3 regardless of what
  // is still held in `selectedSlot`.
  if (state.succeeded) return 3;
  if (state.selectedSlot) return 2;
  return 1;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/web && npx vitest run src/lib/booking/steps.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the copy, both languages**

In `apps/web/src/lib/booking/public-strings.ts`, add to the `en` block:

```ts
    stepsLabel: "Booking progress",
    step1: "Pick a time",
    step2: "Your details",
    step3: "Confirmed",
```

and to the `es` block:

```ts
    stepsLabel: "Progreso de la reserva",
    step1: "Elige un horario",
    step2: "Tus datos",
    step3: "Confirmado",
```

- [ ] **Step 6: Render the indicator**

In `booking-page.tsx`, add the import and derive the step:

```tsx
import { bookingStep, BOOKING_STEP_COUNT } from "@/lib/booking/steps";
```

```tsx
  const step = bookingStep({ selectedSlot, succeeded: result?.ok === true });
```

Add this markup as the FIRST child of the `.bis-booking` wrapper in **both**
return branches — the success branch at `:219-232` early-returns and does not
render the week strip, so an indicator placed only in the main branch would
vanish exactly when it reaches step 3:

```tsx
      <ol className="bis-booking-steps" aria-label={strings.stepsLabel}>
        {([1, 2, 3] as const).map((n) => (
          <li
            key={n}
            className={`bis-booking-step${n === step ? " is-current" : ""}`}
            {...(n === step ? { "aria-current": "step" as const } : {})}
          >
            <span className="bis-booking-step-dot" aria-hidden />
            {/* The NAME, not the dot, carries the meaning: DESIGN.md rule 3
                forbids status by colour alone. Only the current step's name
                is visible; the other two stay in the accessibility tree so
                the list reads as a three-step flow. */}
            <span className="bis-booking-step-name">
              {n === 1 ? strings.step1 : n === 2 ? strings.step2 : strings.step3}
            </span>
          </li>
        ))}
      </ol>
```

and the rules in `BOOKING_CSS`:

```css
.bis-booking-steps { display: flex; align-items: center; gap: 8px; list-style: none; margin: 0 0 12px; padding: 0; }
.bis-booking-step { display: flex; align-items: center; gap: 6px; }
.bis-booking-step-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--muted-foreground, #71717a); opacity: 0.4; }
.bis-booking-step.is-current .bis-booking-step-dot { background: var(--form-accent, #6d28d9); opacity: 1; }
/* Visually hidden, still announced — the two steps the visitor is not on. */
.bis-booking-step-name {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.bis-booking-step.is-current .bis-booking-step-name {
  position: static; width: auto; height: auto; margin: 0; overflow: visible;
  clip: auto; white-space: normal;
  font-size: 13px; color: var(--muted-foreground, #71717a);
}
```

`BOOKING_STEP_COUNT` is exported for the test and any future "step N of 3"
copy; it is not rendered today. If the reviewer objects to an unused export,
delete it rather than inventing a use.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter web typecheck && pnpm --filter web lint
git add apps/web/src/lib/booking "apps/web/src/app/b"
git commit -m "feat(booking): step dots, with the step name carrying the meaning"
```

---

### Task 5: "Powered by BIS"

DESIGN.md's Booking-page pattern ends with a "Powered by BIS" footer. There are
zero matches for `Powered by` in the repo today.

**Scope:** the booking page and the cancel page — the two pages of one flow,
seen by one visitor. **Not the lead form**, which has its own reviewed
treatment this phase has no reason to disturb.

**Files:**
- Modify: `apps/web/src/lib/booking/public-strings.ts`
- Modify: `apps/web/src/app/b/[publicId]/booking-page.tsx`
- Modify: `apps/web/src/app/b/[publicId]/cancel/[token]/page.tsx`
- Modify: `apps/web/e2e/booking.spec.ts`

- [ ] **Step 1: Add the copy, both languages**

A brand name does not translate, so the value is identical in both blocks —
present in both so a future reader does not think one locale is missing it:

```ts
    poweredBy: "Powered by BIS",
```

- [ ] **Step 2: Write the failing assertion**

In `booking.spec.ts`, in the same block Task 1 added after
`await anonPage.goto(publicPath);`:

```ts
    await expect(anonPage.getByText("Powered by BIS")).toBeVisible();
```

and in Task 3's block, after the unhinted cancel-page load:

```ts
    await expect(anonPage.getByText("Powered by BIS")).toBeVisible();
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd apps/web && npx playwright test booking`
Expected: FAIL — the string does not exist yet.

- [ ] **Step 4: Render it**

In `booking-page.tsx`, as the LAST child of `.bis-booking` in **both** return
branches:

```tsx
      <p className="bis-booking-poweredby">
        <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">
          {strings.poweredBy}
        </a>
      </p>
```

and in `CANCEL_CSS`'s page, the same with `bis-cancel-poweredby`.

Rules for `BOOKING_CSS` (and the `bis-cancel-` twin in `CANCEL_CSS`):

```css
.bis-booking-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-booking-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-booking-poweredby a:hover { text-decoration: underline; }
```

`target="_blank"` with `rel="noopener noreferrer"`: this page is frequently
embedded in an iframe on the client's own site, and a same-tab navigation
would replace the booking form the visitor is in the middle of using.

**If danlo wants attribution without a link**, delete the `<a>` and render
`{strings.poweredBy}` directly — the copy and the rules already work either
way. This is the one element in the phase whose presence is a business
decision rather than a design one.

- [ ] **Step 5: Run and confirm it passes**

Run: `cd apps/web && npx playwright test booking`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/booking/public-strings.ts "apps/web/src/app/b" apps/web/e2e/booking.spec.ts
git commit -m "feat(booking): Powered by BIS on the booking and cancel pages"
```

---

### Task 6: `/styleguide` gains the new component, then the gates

DESIGN.md's definition of done: "`/styleguide` page updated if a new
component/variant was added." `PublicBrand` is one.

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`

- [ ] **Step 1: Add the section**

`PublicBrand` is a plain server-safe component with no client hooks, so it can
be rendered directly. Its stylesheet must be imported by the styleguide too, or
it renders unstyled:

```tsx
import { PublicBrand } from "@/components/public-brand";
import "@/styles/public-brand.css";
```

```tsx
        <Section title="Public brand header" file="components/public-brand.tsx">
          <div className="w-full">
            <PublicBrand name="Rio Roofing" logoUrl={null} />
          </div>
        </Section>
```

`logoUrl={null}` deliberately: the styleguide has no tenant logo to borrow and
inventing one would misrepresent the component's sizing. The name-only case is
a real state — it is what an account with branding but no upload renders.

- [ ] **Step 2: Run the full gates**

```bash
pnpm check
pnpm --filter web build
cd apps/web && npx playwright test
```

Expected: `pnpm check` exit 0; build compiles; full e2e green.

⚠️ `contacts-drawer.spec.ts:348` is a known contention flake. If it is the ONLY
red, re-run that spec alone before treating it as a regression — it passes
16/16 in isolation. Never diagnose an e2e failure while a second run is alive.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/styleguide"
git commit -m "docs(styleguide): the shared public brand header"
```

---

## Final gates before merge

- [ ] `pnpm check` — exit 0
- [ ] `pnpm --filter web build`
- [ ] full `pnpm --filter web test:e2e`
- [ ] **Screenshot pass, both themes:** the booking page at steps 1, 2 and 3;
      the cancel page; and the lead form — the last one specifically to prove
      the dedupe moved nothing on the surface that already had customers.
- [ ] Review gate (no autonomous merge — danlo's standing rule)
- [ ] danlo screenshot gate

## Self-review notes

Spec coverage: fix 1 → Task 2; fix 2 → Task 1; fix 3 → Task 3; fix 4 → Task 1;
step dots → Task 4; Powered-by → Task 5; `/styleguide` DoD → Task 6. The spec's
fifth fix (`b/error.tsx`) is dropped with its reason recorded above and flagged
to danlo.

Corrected during self-review, after reading `booking.spec.ts` rather than
assuming its shape. The first draft added three standalone tests, each
re-deriving the calendar's public URL. That file is deliberately ONE long
journey and says so at `:12-18` — every later step depends on state an earlier
one created. All four new e2e assertions now EXTEND that journey at the points
where the state already exists (`publicPath` at `:249`, `anonPage` at `:253`,
`cancelHref` at `:284`), which is both less code and faithful to the file's
documented design. Verified while correcting it: booking validation is
server-side (`actions.ts:195`) on a `noValidate` form, so an empty submit
renders `.bis-booking-error` deterministically — the plan no longer guesses at
how to reach that state.

Three `⚠️` notes remain, and they are checks rather than placeholders: restore
the viewport after the width change; confirm the empty submit does not disturb
the journey's later steps; confirm the cancel-page GETs do not cancel anything.
Each names exactly what to verify and what to do if it does not hold.

Known-vacuous risk, stated rather than hidden: the AA assertion measures
against `.bis-booking-page`'s background, which is
`var(--background, transparent)`. On an unthemed account that resolves to
`transparent` and the ratio would be meaningless — so the plan asserts the
background is not `rgba(0, 0, 0, 0)` first, making the test fail loudly instead
of passing for the wrong reason.

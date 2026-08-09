# M4a Per-Tenant Theme — Design

**Goal:** A client company's workspace wears that company's design — surfaces, type, corners and colour — instead of BIS's, from four picked inputs plus the brand colour that already exists.

**Status:** Decisions approved 2026-08-09. Not yet planned or executed.

**Program context:** this is the first of four sub-projects in the M4 white-labeling program. M4b is the public form appearance editor, M4c is client-editable branding, M4d is email branding and custom domains. M4a comes first because it defines the theme model the other three read; building an editor before the model settles means building over a moving target.

---

## 1. Why

M3 gave each account a `brand_name` and a logo. PR #10 gave it a `brand_color` that drives the public form's Submit button and the client sidebar's accents. Everything else a client's staff look at all day — backgrounds, cards, tables, buttons, type, corner radius — is still BIS violet on BIS surfaces.

The decision taken 2026-08-09 is that a tenant's design reaches the **whole client workspace chrome**, not just its accents. The agency's own view never wears a client's brand.

That single decision changes the shape of the problem. With one accent colour, a special case was enough. With the whole chrome, two things stop being optional:

- **every** token becomes tenant-controlled, so the `style`-attribute injection risk covers the whole set rather than one value
- **contrast becomes a correctness property.** `brand_color` needed `readableTextOn` and `lightenForSidebar` for one value on two surfaces. Fifteen screens of chrome cannot be checked by eye per tenant.

Both are answered by construction below rather than by review.

## 2. Decisions

| Question | Decision | Reasoning |
|---|---|---|
| How far the tenant's design reaches | **The whole client workspace chrome.** Agency view always BIS | The client's staff should not be looking at the agency's product. The agency shell is the control surface and stays recognisably ours. |
| How the theme is specified | **Five inputs total — `brand_color` plus four new — with every token derived server-side** | An unreadable screen becomes impossible by construction. Derivation is pure functions, which is the only shape this codebase can honestly unit-test. |
| Tenant mode vs the user's toggle | **Tenant sets the default; the user's toggle still wins and persists** | The topbar toggle exists because PR #2 found dark mode shipped unreachable. Taking it back away from a client's staff is a regression, not a feature. |
| How the server learns the user's mode | **A cookie, written alongside next-themes' storage** | The server cannot read localStorage, so without a cookie it cannot know which of the two token sets to emit and every navigation flashes the wrong theme. Sidebar collapse is already cookie-persisted, so this is the house pattern. |
| Storage shape | **Four typed, check-constrained columns — not a `theme` jsonb** | The check constraints make four of the five inputs values the database itself refuses to store hostile content in. A jsonb blob is exactly what let an unvalidated key ride along unnoticed on `forms.theme`. |
| Per-client favicon | **Out of M4a**, tracked separately | It reads the logo, not the theme; it needs its own icon route and its own cache verification. Keeping it out leaves M4a one coherent thing. |

## 3. Data

```sql
alter table public.accounts
  add column brand_neutral text check (brand_neutral in ('warm','cool','slate')),
  add column brand_corners text check (brand_corners in ('sharp','soft','round')),
  add column brand_type    text check (brand_type    in ('geist','inter','serif')),
  add column brand_mode    text check (brand_mode    in ('light','dark','follow'));
```

All nullable, joining `brand_color` from migration 0011. Null means unset and every surface falls back to the BIS default, so the migration is additive and existing accounts are untouched.

The check constraints are load-bearing, not decoration — see §7.

## 4. Derivation

One pure, I/O-free module, `apps/web/src/lib/branding/theme.ts`, beside `color.ts` for the same stated reason that one is separate from its surfaces.

```ts
export type ThemeInputs = {
  color: string | null;                              // free-form hex, validated
  neutral: "warm" | "cool" | "slate" | null;
  corners: "sharp" | "soft" | "round" | null;
  type: "geist" | "inter" | "serif" | null;
  mode: "light" | "dark" | "follow" | null;
};

export function deriveTheme(
  inputs: ThemeInputs,
  mode: "light" | "dark",
): ResolvedTheme;
```

`mode` is a separate parameter rather than read from `inputs.mode` because the resolved mode depends on the request (§6), while the rest of the inputs depend only on the account.

### 4.1 What each input does

| Input | Effect |
|---|---|
| `neutral` | Selects one of three checked-in 5-step surface ladders per mode. A chosen ramp beats a computed one and it is fewer moving parts. Steps map to `background`, `card`, `secondary`/`muted`, `border`/`input`, `foreground`. |
| `color` | Drives the accent family: `primary`, `accent`, `ring`, `sidebar-accent`, and their foregrounds. |
| `corners` | `sharp` → `0.125rem`, `soft` → `0.625rem` (today's value), `round` → `1rem`. |
| `type` | Reassigns `--font-sans` only. `geist` → `var(--font-geist-sans)`, `inter` → `var(--font-inter)`, `serif` → `var(--font-source-serif)`. |

### 4.2 What is derived and what is fixed

Derived: `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `border`, `input`, `ring`, `sidebar`, `sidebar-foreground`, `sidebar-accent`, `sidebar-border`, `radius`.

**The sidebar keeps its existing invariant.** `globals.css` states that the sidebar is dark in both themes and does not invert, and `lightenForSidebar` exists precisely because a dark brand scores 1.62:1 there. Derivation preserves that: `sidebar` and `sidebar-border` come from the **dark end of the tenant's neutral ladder regardless of the resolved mode**, so the sidebar becomes the tenant's dark neutral rather than BIS's, and stays a dark surface. Without this rule a light-mode tenant would get a light sidebar and the 3:1 accent guarantee would be measuring against the wrong background.

Fixed, and deliberately not tenant-controlled:

- `destructive`, `success`, `warning` — status colours carry meaning. A red that stops reading as red is a defect, not a brand expression.
- `stage-1` … `stage-6` — pipeline stages are semantic identity, not brand, and deriving six mutually distinguishable hues from one colour is a different problem than this milestone solves.

### 4.3 Contrast, enforced inside the derivation

- every foreground comes from `readableTextOn(surface)` → **≥ 4.5:1** (WCAG AA body text), with one deliberate exception: `muted-foreground` is not snapped to maximum contrast, because doing so would erase the visual hierarchy it exists to create. It takes the **lowest ladder step that still clears 4.5:1** against its surface — quieter than the primary foreground, never illegible.
- accent-bearing non-text UI — nav indicator, focus ring, borders that carry meaning — goes through `ensureContrast(value, background, 3)` → **≥ 3:1**. This is `lightenForSidebar` generalized; the `#1e3a8a → #3a62d4` case is exactly this function's existing proof.
- `ring` must clear 3:1 against **both** `background` and `card`, because focus rings appear on both.

`ensureContrast` walks lightness away from the background, choosing the direction with more headroom (a near-white brand must darken, not lighten). If neither direction reaches the target within its iteration cap, it **falls back to the BIS default for that token** rather than returning something unreadable — the same fail-to-default posture `resolveFormRadius` takes, for the same reason: a surface that renders wrong is better than a surface that renders illegibly.

## 5. Delivery

The resolved tokens ride a **`style` attribute on the client workspace shell**, the mechanism `app-sidebar.tsx:116` already uses for `--sidebar-accent`, with every value passed through the boundary validator (§7).

Not a generated `<style>` block. A stylesheet means concatenating tenant values into CSS *text*, where React's entity-escaping no longer applies and the escaping argument has to be made from scratch. The attribute path keeps the analysis that PR #10 already did.

The **agency shell emits no style attribute at all** — the agency view is BIS by construction, not by a conditional that a later edit could invert. That absence is asserted by an e2e test (§8), because an unverified by-construction claim is just a comment.

The theme read joins the already-cached `getClientBranding` call in `(dashboard)/dashboard/layout.tsx`, so it costs no additional query — the same `cache()` dedupe that made branded tab titles free.

## 6. Mode resolution

Precedence, per request:

1. the `bis-theme` cookie (`light` | `dark`), if present
2. the account's `brand_mode`, when it is `light` or `dark`
3. `light`

The cookie is written by the existing topbar toggle in addition to next-themes' own storage: `SameSite=Lax`, one year, readable by script since the client writes it. `enableSystem` must be turned **on** for `brand_mode = 'follow'` to mean anything; it is off today.

**The one honest wrinkle:** with `brand_mode = 'follow'` and no cookie yet, the server cannot know the OS preference, so it emits the light set and next-themes corrects on mount — one frame, once per browser, because the provider writes the cookie as soon as it resolves. Every later navigation is server-correct. Users on `light`/`dark` tenants, and every user who has ever toggled, never see it at all.

## 7. Security contract

The brand-colour review established that a tenant-controlled string reaching a serialized `style` attribute can append **arbitrary CSS declarations**, because React does not strip `;` (verified against React 19.2.4). It is not XSS — quotes are entity-escaped and CSS cannot execute script — but it is a real integrity break, and `theme.radius` was **reachable**: migration 0006 grants a client `for all` on their own forms.

Four terms:

1. **Enums as check constraints.** `brand_neutral`, `brand_corners`, `brand_type` and `brand_mode` are closed sets the database refuses to store anything else in. For those four inputs the injection class is dead at the source, not mitigated downstream. Only `brand_color` is free-form, and it already has `parseHexColor`.
2. **One boundary validator.** `apps/web/src/lib/forms/safe-theme.ts` generalizes into the validator for every derived value that reaches a `style` attribute, keeping its reject-even-valid-`calc()`/`var()` posture. No second implementation.
3. **Account-level theme is never part of a blueprint.** A blueprint is agency configuration; a brand belongs to one tenant. Capturing it would dress a new client in the previous client's identity — the `notify_emails` failure mode by a different door.
4. **`forms.theme` is blanked on blueprint apply.** `blueprints.ts` captures it at line 154, carries it at 198 and writes it verbatim at 368, so a tenant-controlled CSS value is copied across accounts today. One line on the exclusion list removes the only known cross-account copy of these values.

## 8. Testing

**Unit** — the combinatorial sweep is the centrepiece: all 3 × 3 × 3 × 2 = 54 combinations of (`neutral` × `corners` × `type` × `mode`), each against adversarial brand colours — pure black, pure white, neon yellow, mid grey, and null — asserting every derived pair clears its threshold. Cheap because derivation is pure. Also: `ensureContrast` direction choice and its fallback, and cookie precedence.

**Database** — the check constraints reject a hostile value. The claim in §7 is "dead at the source"; that has to be proven by execution, not by reading the migration.

**End-to-end** — a real client session, because the Cobija consent gate shipped four Criticals that 949 green tests could not see, all of them in the code path that decides what a user reaches:

- a client's workspace paints derived tokens, asserted on **computed style**, not a class name
- the toggle flips, and the choice survives a reload via the cookie
- the agency shell carries **no** style attribute
- `auth.setup.ts`'s existing client fixture gains theme inputs, so one fixture proves both resolvers as it already does for colour

**Two disciplines carried forward:** every new test is verified by reverting the code it covers and watching it fail, and at least one check is a real navigation.

## 9. Fallbacks and rollout

| State | Result |
|---|---|
| All five columns null | Exactly today's look. The shell emits the BIS defaults it emits now. |
| `brand_color` set, the rest null | Today's PR #10 behaviour — accents only. |
| Some subset set | Each input falls back independently; there is no combination that produces a half-rendered theme. |
| Agency view | Never reads these columns. |

Additive migration, reversible by dropping four columns, and nothing outside this feature reads them.

## 10. Out of scope

Recorded, each with its own spec later:

- **M4b** — the public form appearance editor. `forms.theme` already honours `mode` and `radius` and nothing in the UI can set them; once the account theme exists this becomes inherit-from-brand with an override.
- **M4c** — client-editable branding. A client write path and client-uploaded images, which M3 avoided on purpose. Needs the generalized validator from M4a first.
- **M4d** — outbound email branding and per-client sending domains, and custom domains. Real DNS/DKIM/certificate infrastructure, and it carries the recorded `reply-to` gap: every client reply lands in the BIS mailbox today.
- **Per-client favicon** — split out of M4a as its own small item.
- A heading/body font split. One family for both in v0.

## 11. Open questions for planning

- The concrete serif family. Source Serif 4 unless the planner finds a better fit for a business CRM; it must be a `next/font` Google family so it loads on the same build-time path as Geist and Inter.
- The three neutral ladders' exact ten values (five steps × two modes). They are chosen, not computed, so they need writing down before Task 1 — and each ladder has to satisfy §4.3 against every one of the adversarial brand colours, which may constrain how dark the darkest light-mode step can be.
- Whether `secondary` and `muted` should stay the same ladder step, as they are today in both themes, or separate once there is a real ramp to draw from.
- Where the toggle writes the cookie. next-themes owns the click today, so this is either a wrapper around its `setTheme` or an effect on its resolved value — the effect form must not trip `react-hooks/set-state-in-effect`, which is the rule that shaped the toggle's icon handling in PR #2.

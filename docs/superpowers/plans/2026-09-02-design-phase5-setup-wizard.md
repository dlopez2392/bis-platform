# Design Phase 5 — Setup Wizard Two-Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the setup wizard's single scrolling stack of nine cards with a stepper rail beside one step's detail pane, add inline account rename, and break up the 30KB `setup-panel.tsx`.

**Architecture:** All nine detail bodies render server-side in ONE pass from the page's existing `gatherSetupInputs` read set; a client shell owns which one is visible and mirrors it to `?step=<key>` with shallow `pushState` (the P4 `usePeek` pattern). No server round trip and no extra reads on a step click. Step derivation (`setup-status.ts`) and view semantics (`setup-view.ts`) are READ-ONLY this phase.

**Tech Stack:** Next.js App Router, React client components, shadcn primitives, sonner, Vitest (node env — NO DOM, so component behavior is proven by pure-logic units + e2e), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-design-phase5-setup-wizard-design.md` — decisions there are LOCKED.

## Global Constraints

- Tokens only — no hard-coded colors/radii/shadows. Radii 8/11/999px. Reuse the existing `TONE` map's token classes in `setup-panel.tsx` rather than inventing new ones.
- **Status is never colour alone — icon/dot PLUS the word** (DESIGN.md rule 3).
- **FIVE rail states**, from `kindOf(step, isNext)` in `lib/setup/setup-view.ts`: `done` · `next` (the current/selected one) · `open` (to do) · `skipped` · `unknown` ("couldn't check"). `kindOf` checks `unknown` BEFORE `done` deliberately — never reorder it, and never render a failed-read step as locked.
- **Locked is derived, never invented.** Only two steps lock: `test_call` (needs an assigned number AND a saved profile — `canEnableTestCalls`) and `go_live` (needs the four `GO_LIVE_PREREQ_KEYS`). The other seven never lock.
- A locked step is ALWAYS selectable and its pane names the unmet prerequisites. Never a dead click.
- The wizard is agency-only: every new action uses `requireAgencyOnlyAccountAccess`.
- New actions return `{ ok: true } | { ok: false; error: string }` and are called through `notifyActionResult` (`@/lib/forms/action-feedback`) so stale-tab rejections toast.
- Selection uses SHALLOW `window.history.pushState` — never `router.push` (an RSC re-render per step click is the thing approach A exists to avoid).
- `accountId` stays server-bound on every action (`.bind(null, accountId)`); it must never travel as a form field.
- Commit after every task. Full gates (`pnpm check`, build, e2e) run in the final task; run the focused tests named per task as you go.
- **Do NOT run repo-root `pnpm check` mid-phase** (double-runs suites; has hung). Use `pnpm --filter web ...`.
- e2e: run Playwright directly from `apps/web` (`npx playwright test <file> --reporter=line`) — the pnpm `--` passthrough does NOT filter in this repo. Never run two Playwright runs at once (same port, same Supabase project → meaningless failures).

---

### Task 1: rail-state + step-selection pure logic

**Files:**
- Create: `apps/web/src/lib/setup/setup-rail.ts`
- Test: `apps/web/src/lib/setup/setup-rail.test.ts`

**Interfaces:**
- Consumes: `SetupStepView`, `StateKind`, `kindOf`, `GO_LIVE_PREREQ_KEYS` from `./setup-view`; `SetupStepKey` from `./setup-status`.
- Produces:
  - `SETUP_STEP_KEYS: readonly SetupStepKey[]` — the canonical nine, in order.
  - `isLockedStep(key, views: SetupStepView[]): boolean` — locked exactly when `lockedPrereqKeys(key, views)` is non-empty.
    > **Corrected after review — do not reintroduce the `opts` version.** This originally read `isLockedStep(key, opts: { canTestCall, prereqsMet })`. `canTestCall` comes from `canEnableTestCalls`, which answers "should the *Enable test calls* button be live?" — and goes FALSE once the number reaches `testing`, a state that already means the number answers calls. That let `isLockedStep` say LOCKED while `lockedPrereqKeys` returned `[]`, i.e. a locked `test_call` pane with an empty reason list under it. Deriving the lock from the prerequisites themselves makes that divergence impossible by construction.
  - `lockedPrereqKeys(key, views: SetupStepView[]): SetupStepKey[]` — the unmet prerequisite keys to name in a locked pane (empty when not locked); the single source of truth the lock itself is derived from.
  - `defaultStepKey(views: SetupStepView[]): SetupStepKey` — first not-done step, else the last step.
  - `parseStepParam(raw: string | null | undefined, views: SetupStepView[]): SetupStepKey` — valid key → itself; missing/unknown/malformed → `defaultStepKey(views)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  SETUP_STEP_KEYS, isLockedStep, lockedPrereqKeys, defaultStepKey, parseStepParam,
} from "./setup-rail";
import type { SetupStepView } from "./setup-view";

const view = (
  key: SetupStepView["key"], over: Partial<SetupStepView> = {},
): SetupStepView => ({ key, done: false, skipped: false, unknown: false, ...over });

// Nine views in canonical order, all not-done unless overridden.
function views(over: Partial<Record<SetupStepView["key"], Partial<SetupStepView>>> = {}) {
  return SETUP_STEP_KEYS.map((k) => view(k, over[k] ?? {}));
}

describe("SETUP_STEP_KEYS", () => {
  it("is the canonical nine in wizard order", () => {
    expect(SETUP_STEP_KEYS).toEqual([
      "account", "branding", "hours", "voice_profile", "number",
      "email", "forwarding", "test_call", "go_live",
    ]);
  });
});

describe("isLockedStep", () => {
  it("locks ONLY test_call and go_live, and only when their prerequisites are unmet", () => {
    const unmet = views(); // nothing done
    const metViews = views(SETUP_STEP_KEYS.reduce(
      (a, k) => ({ ...a, [k]: { done: true } }),
      {} as Record<SetupStepView["key"], Partial<SetupStepView>>,
    ));
    expect(isLockedStep("test_call", unmet)).toBe(true);
    expect(isLockedStep("go_live", unmet)).toBe(true);
    expect(isLockedStep("test_call", metViews)).toBe(false);
    expect(isLockedStep("go_live", metViews)).toBe(false);
    for (const k of ["account", "branding", "hours", "voice_profile", "number", "email", "forwarding"] as const) {
      expect(isLockedStep(k, unmet)).toBe(false);
    }
  });
});

describe("lockedPrereqKeys", () => {
  it("names go_live's unmet prerequisites, including an UNKNOWN one", () => {
    // hours done, voice_profile unknown (read failed), number done, test_call not done
    const v = views({
      hours: { done: true },
      voice_profile: { done: true, unknown: true },
      number: { done: true },
    });
    expect(lockedPrereqKeys("go_live", v)).toEqual(["voice_profile", "test_call"]);
  });
  it("is empty for a step that does not lock", () => {
    expect(lockedPrereqKeys("branding", views())).toEqual([]);
  });
});

describe("defaultStepKey", () => {
  it("is the first not-done step", () => {
    expect(defaultStepKey(views({ account: { done: true }, branding: { done: true } })))
      .toBe("hours");
  });
  it("falls back to the last step when everything is done", () => {
    const all = SETUP_STEP_KEYS.reduce((a, k) => ({ ...a, [k]: { done: true } }), {});
    expect(defaultStepKey(views(all))).toBe("go_live");
  });
});

describe("parseStepParam", () => {
  const v = views({ account: { done: true } });
  it("accepts a valid key", () => expect(parseStepParam("number", v)).toBe("number"));
  it("falls back for missing, unknown and malformed values", () => {
    expect(parseStepParam(null, v)).toBe("branding");
    expect(parseStepParam(undefined, v)).toBe("branding");
    expect(parseStepParam("not_a_step", v)).toBe("branding");
    expect(parseStepParam("", v)).toBe("branding");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && npx vitest run src/lib/setup/setup-rail.test.ts`
Expected: FAIL — cannot resolve `./setup-rail`.

- [ ] **Step 3: Implement `setup-rail.ts`**

```ts
import type { SetupStepKey } from "./setup-status";
import { GO_LIVE_PREREQ_KEYS, type SetupStepView } from "./setup-view";

// Pure module, same discipline as setup-status.ts / setup-view.ts: no db, no
// React, no Date. Everything the two-pane rail needs to decide WHICH step is
// shown and WHICH steps are locked lives here so it is reachable by a test —
// vitest.config.ts does not include .tsx files.

/** The canonical nine, in the order the wizard walks them. Mirrors the array
 *  `deriveSetupStatus` returns; kept here so the rail can order itself
 *  without depending on that function having been called. */
export const SETUP_STEP_KEYS: readonly SetupStepKey[] = [
  "account", "branding", "hours", "voice_profile", "number",
  "email", "forwarding", "test_call", "go_live",
] as const;

/**
 * Which steps can be LOCKED. Exactly two — `test_call` and `go_live` — the
 * other seven are independent and are NEVER locked; claiming otherwise would
 * invent a dependency the derivation does not have.
 *
 * A step is locked exactly when `lockedPrereqKeys` names at least one unmet
 * prerequisite for it — the SAME list the pane renders under the lock, so the
 * two can never disagree.
 *
 * ⚠️ REJECTED IN REVIEW, recorded so it is not reintroduced: this function was
 * first specified as `isLockedStep(key, { canTestCall, prereqsMet })`, taking
 * its gates from the caller. `canTestCall` comes from `canEnableTestCalls`
 * (setup-view.ts), which answers "should the *Enable test calls* button be
 * live?" — a narrower question that goes FALSE once the number's status
 * reaches `testing`, precisely because a number already in testing mode does
 * not need enabling. But `testing` is in `LIVE_NUMBER_STATUSES`, so at that
 * point `number` and `voice_profile` both read `done: true` and
 * `lockedPrereqKeys` is empty: the opts version rendered `test_call` LOCKED
 * with no reason to show under it.
 */
export function isLockedStep(key: SetupStepKey, views: SetupStepView[]): boolean {
  return lockedPrereqKeys(key, views).length > 0;
}

/**
 * The unmet prerequisites to NAME in a locked step's pane.
 *
 * `!done || unknown` — not `!done` alone. The same reasoning setup-panel.tsx
 * records for the go-live blocked list: an UNKNOWN prerequisite must be named,
 * because `buildSetupViews` refuses go-live on it while `!done` alone might
 * not catch it if a prerequisite ever gains a second read behind it.
 */
export function lockedPrereqKeys(
  key: SetupStepKey, views: SetupStepView[],
): SetupStepKey[] {
  if (key === "go_live") {
    return views
      .filter((v) => GO_LIVE_PREREQ_KEYS.includes(v.key) && (!v.done || v.unknown))
      .map((v) => v.key);
  }
  if (key === "test_call") {
    return views
      .filter((v) => (v.key === "number" || v.key === "voice_profile") && (!v.done || v.unknown))
      .map((v) => v.key);
  }
  return [];
}

/** Preselected step: the first one not yet done. When everything is done the
 *  wizard has nothing outstanding, so it opens on the last step (go-live)
 *  rather than an arbitrary one. */
export function defaultStepKey(views: SetupStepView[]): SetupStepKey {
  return views.find((v) => !v.done)?.key ?? SETUP_STEP_KEYS[SETUP_STEP_KEYS.length - 1]!;
}

/** `?step=` → a real key. Anything missing, unknown or malformed falls back
 *  to the default rather than rendering an empty pane. */
export function parseStepParam(
  raw: string | null | undefined, views: SetupStepView[],
): SetupStepKey {
  if (raw && (SETUP_STEP_KEYS as readonly string[]).includes(raw)) {
    return raw as SetupStepKey;
  }
  return defaultStepKey(views);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/web && npx vitest run src/lib/setup/setup-rail.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/setup/setup-rail.ts apps/web/src/lib/setup/setup-rail.test.ts
git commit -m "feat(setup): pure rail-state and step-selection logic"
```

---

### Task 2: renameAccountAction

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts` (append)
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts` (append)

**Interfaces:**
- Consumes: `requireAgencyOnlyAccountAccess` from `@/lib/auth`, `dbForRequest` from `@/lib/db`, `revalidatePath` from `next/cache`.
- Produces: `renameAccountAction(accountId: string, value: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing tests** (append; MIRROR the mocking idiom already at the top of `actions.test.ts` — read it first and reuse its `vi.mock` blocks rather than writing new ones)

```ts
describe("renameAccountAction", () => {
  it("rejects an empty name WITHOUT writing", async () => {
    const r = await renameAccountAction("acct1", "   ");
    expect(r).toEqual({ ok: false, error: expect.any(String) });
    // assert no update reached the db — use whatever spy the file's existing
    // dbForRequest mock exposes for `.from("accounts").update(...)`
  });

  it("trims and writes a real name", async () => {
    const r = await renameAccountAction("acct1", "  Rio Roofing  ");
    expect(r).toEqual({ ok: true });
    // assert the update payload was { name: "Rio Roofing" } (plus any
    // updated_at the implementation sets)
  });

  it("returns ok:false instead of throwing when the write fails", async () => {
    // make the mocked update return/throw an error
    const r = await renameAccountAction("acct1", "Valid Name");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts"`
Expected: FAIL — `renameAccountAction is not a function`.

- [ ] **Step 3: Implement** (append to `setup/actions.ts`, matching the file's existing action shape)

```ts
/**
 * Rename the account's INTERNAL label (`accounts.name`) — the agency's own
 * note about this client, e.g. "Rio Roofing — trial". Not the client's
 * public-facing name: branding owns that, and a client sees their brand name
 * everywhere this label would otherwise leak (dashboard greeting, sidebar
 * identity — see P3).
 *
 * Empty is REJECTED rather than allowed to clear, unlike an inline contact
 * field: an account with no name breaks the client switcher, the dashboard
 * greeting and the accounts list, none of which have a fallback for "".
 */
export async function renameAccountAction(
  accountId: string, value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAgencyOnlyAccountAccess(accountId);
  const name = value.trim();
  if (!name) return { ok: false, error: m["setup.rename.empty"] };
  try {
    const db = await dbForRequest();
    const { error } = await db.from("accounts").update({ name }).eq("id", accountId);
    if (error) throw new Error(error.message);
  } catch {
    return { ok: false, error: m["setup.rename.failed"] };
  }
  revalidatePath(`/dashboard/accounts/${accountId}/setup`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
  revalidatePath("/dashboard/accounts");
  return { ok: true };
}
```

Message keys (add near the other `setup.` keys in `apps/web/src/lib/messages.ts`):

```ts
"setup.rename.empty": "A company needs a name — this one can't be blank.",
"setup.rename.failed": "Couldn't rename this company. Try again.",
"setup.rename.label": "Company name",
"setup.rename.help": "Your own label for this client — they never see it. The name their customers see comes from Branding.",
```

NOTE: verify whether `accounts` has an `updated_at` column before setting one
(read `packages/db/supabase/migrations/0001_tenancy.sql`); include it only if
it exists.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts"`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts" apps/web/src/lib/messages.ts
git commit -m "feat(setup): rename an account's internal label, empty rejected"
```

---

### Task 3: extract per-step detail modules

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/steps/step-shared.ts` (types + the shared `STEP_COPY`/`STEP_PATH`/`TONE` maps moved out of setup-panel.tsx)
- Create: nine modules under `.../setup/steps/`: `account.tsx`, `branding.tsx`, `hours.tsx`, `voice-profile.tsx`, `number.tsx`, `email.tsx`, `forwarding.tsx`, `test-call.tsx`, `go-live.tsx`
- Modify: `.../setup/setup-panel.tsx` (shrinks to a shell that maps over the steps and renders the module for each)

**Interfaces:**
- Consumes: everything `StepActions` consumes today — read `setup-panel.tsx:474-500` for the exact prop list (`step, kind, base, href, assignedNumber, movableNumbers, hasVoiceProfile, tickAction, goLiveAction, moveNumberAction, enableTestCallsAction, prereqsMet, blockedReason`).
- Produces: each module exports `export function <Key>Step(props: StepDetailProps): React.ReactNode` where `StepDetailProps` is declared once in `step-shared.ts` and is the SAME prop bag `StepActions` takes today (plus `accountName: string | null` and `renameAction` for `account.tsx` — see Task 4).

**This task is a MECHANICAL EXTRACTION. Behavior must not change.** The rail
and the two-pane layout arrive in Task 4; at the end of this task the page
must still render exactly as it does today.

- [ ] **Step 1: Read the whole of `setup-panel.tsx` before moving anything.**

It is 30KB; `StepActions` is one big per-key branch building `rows` / `note` /
`panel`. Each new module takes ONE key's branch verbatim — including every
comment, which encodes hard-won reasoning (the movable-number "unknown" rule,
the test-call four-case matrix, the forwarding number semantics). Comments
move WITH their code; do not summarize or drop them.

- [ ] **Step 2: Move the shared maps to `step-shared.ts`**

`STEP_COPY`, `STEP_PATH`, `TONE`, and the small presentational helpers used by
more than one step (`NumberChip`, `NumberStatusChip`) go here, exported. Keep
their comments.

- [ ] **Step 3: Create the nine modules, one branch each**

Each file is small and single-purpose. Example shape (adapt per key):

```tsx
import type { StepDetailProps } from "./step-shared";

export function BrandingStep({ href }: StepDetailProps): React.ReactNode {
  // …exactly the branding branch's current JSX, comments included
}
```

- [ ] **Step 4: Reduce `setup-panel.tsx` to a shell**

It keeps: the `nextKey` / `blocked` / `blockedReason` derivation (lines
~218-240 — move it VERBATIM, comments included; it encodes why `!done ||
unknown` rather than `!done`), `SetupProgress`, and the map over steps that
renders each module. `StepActions` disappears, replaced by a lookup:

```tsx
const STEP_DETAIL: Record<SetupStepKey, (p: StepDetailProps) => React.ReactNode> = {
  account: AccountStep, branding: BrandingStep, hours: HoursStep,
  voice_profile: VoiceProfileStep, number: NumberStep, email: EmailStep,
  forwarding: ForwardingStep, test_call: TestCallStep, go_live: GoLiveStep,
};
```

- [ ] **Step 5: Prove nothing changed**

Run: `cd apps/web && npx tsc --noEmit` (exit 0) and `pnpm --filter web lint`
(0 errors), then `pnpm --filter web build` (exit 0 — this file sits on a real
page and a client/server boundary mistake surfaces at build).
Then run the setup e2e ALONE: `cd apps/web && npx playwright test setup.spec.ts --reporter=line` — it must pass UNCHANGED, since behavior did not change. That spec is the proof this extraction was faithful.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup"
git commit -m "refactor(setup): one module per wizard step, panel becomes a shell"
```

---

### Task 4: the two-pane shell + rail

**Files:**
- Create: `.../setup/setup-rail.tsx` (the rail; client)
- Create: `.../setup/setup-shell.tsx` (owns selection + `?step=`; client)
- Modify: `.../setup/setup-panel.tsx` (renders shell + rail + the selected detail)
- Modify: `.../setup/page.tsx` (pass `accountName` and the bound `renameAccountAction`)
- Modify: `.../setup/steps/account.tsx` (the inline rename)
- Modify: `apps/web/src/lib/messages.ts` (rail state words)

**Interfaces:**
- Consumes: `SETUP_STEP_KEYS`, `isLockedStep`, `lockedPrereqKeys`, `defaultStepKey`, `parseStepParam` (Task 1); `kindOf`, `canEnableTestCalls` (setup-view.ts); `InlineField` from `@/components/inline-field` (P4); `renameAccountAction` (Task 2).
- Produces: the two-pane wizard.

- [ ] **Step 1: `setup-shell.tsx` — selection + shallow URL**

Model it on `apps/web/src/lib/contacts/use-peek.ts` (P4), which was hardened
through two fix waves. The rules that matter, all learned there:
- URL is the single source of truth via `useSyncExternalStore` — do NOT keep a
  second copy in `useState` and do NOT call setState in an effect (the repo's
  `react-hooks/set-state-in-effect` rule is an ERROR).
- `subscribe` listens to `popstate`; `pushState`/`replaceState` do not fire it,
  so `select()` must notify subscribers itself.
- Server snapshot returns `null`; the component resolves the default key from
  `parseStepParam(null, views)` when the store reads null.
- Selecting a step uses `pushState` (Back walks steps). Do not use
  `router.push`.

```tsx
"use client";
// …store + subscribe + notify exactly as use-peek.ts does, with PARAM="step".
export function useSetupStep(views: SetupStepView[]) {
  const raw = useSyncExternalStore(subscribe, readStep, () => null);
  const selected = parseStepParam(raw, views);
  const select = useCallback((key: SetupStepKey) => { /* pushState + notify */ }, []);
  return { selected, select };
}
```

- [ ] **Step 2: `setup-rail.tsx`**

Renders `SETUP_STEP_KEYS` in order. Per entry: state marker + the state WORD +
the step title. Locked entries are rendered with the lock marker but remain
`<button>`s (always selectable — spec decision 2). The selected entry gets
`aria-current="step"`.

Keyboard: ↑/↓ move focus between rail entries, Enter/Space selects, visible
`focus-visible` ring — same shape as P4's table rows
(`contacts-table.tsx`'s row handler is the precedent; it guards with
`e.target !== e.currentTarget`).

State words (add to `messages.ts`, and use them — never colour alone):

```ts
"setup.state.done": "Done",
"setup.state.next": "Current",
"setup.state.open": "To do",
"setup.state.skipped": "Skipped",
"setup.state.unknown": "Couldn't check",
"setup.state.locked": "Locked",
"setup.locked.blockedBy": "Finish these first: {steps}",
```

🔴 `kindOf` returns `unknown` BEFORE `done` — a step whose read failed renders
"Couldn't check", never "Done" and never "Locked". Compute locked ONLY for a
step that is not `unknown`.

- [ ] **Step 3: `setup-panel.tsx` becomes the two-pane layout**

```tsx
<div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
  <SetupRail ... />
  <div>{STEP_DETAIL[selected]({ ...props })}</div>
</div>
```

All nine details are still computed from props already in hand; only the
selected one is rendered. Keep `SetupProgress` above the two panes.

A LOCKED selected step renders, above its normal body, the blocked list from
`lockedPrereqKeys(selected, views)` mapped through `STEP_COPY[...].title`,
using `setup.locked.blockedBy`, with each named step a button that selects
that step in the rail. Reuse `blockedReason` for `go_live` (it already exists
and already handles the unknown case) rather than deriving a second string.

- [ ] **Step 4: the rename in `steps/account.tsx`**

Replace the dead help copy with an `InlineField`:

```tsx
<InlineField
  label={m["setup.rename.label"]}
  field="first_name"            // see NOTE below
  value={accountName}
  save={(v) => renameAction(v)}
/>
<p className="text-muted-foreground text-xs">{m["setup.rename.help"]}</p>
```

🔴 NOTE: `InlineField`'s `field` prop is typed `EditableField` (the five
CONTACT columns) and is used for `normalizeFieldInput`'s validation branch.
An account name is not a contact field. Do NOT pass a lie. Choose ONE and say
which in your report:
(a) widen `InlineField` to accept an optional `validate` callback and pass a
name validator (preferred — small, keeps one component), or
(b) add a tiny `InlineText` sibling component for non-contact values.
Either way the trim/empty rule lives in ONE place and matches
`renameAccountAction`'s server-side rejection.

`page.tsx` passes `accountName` (already read there, line ~62) and
`renameAccountAction.bind(null, accountId)` down.

- [ ] **Step 5: Gates**

`cd apps/web && npx tsc --noEmit` · `pnpm --filter web lint` (0 errors) ·
`pnpm --filter web test -- --run` (unit suite green) · `pnpm --filter web build`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup" apps/web/src/lib/messages.ts apps/web/src/components/inline-field.tsx
git commit -m "feat(setup): two-pane wizard - stepper rail, one step at a time, inline rename"
```

---

### Task 5: e2e

**Files:**
- Modify: `apps/web/e2e/setup.spec.ts` (its existing assertions must keep passing; add the new ones)

**Rules:** mutations ONLY on the per-run fixture account (`readClientFixture()`); `Test Client One` read-only. Server actions POST to the current URL — never `waitForResponse(method+URL)`; assert UI outcomes. Seed in `beforeAll`, not test bodies (Playwright retries re-run bodies).

- [ ] **Step 1: Add the new tests**

Cover, each pinning a spec requirement:
1. **rail selection swaps the pane with NO navigation** — click a rail entry, assert the detail heading changed AND the URL gained `?step=<key>` (assert no full page load, e.g. by stamping `window.__wizardMark` before the click and asserting it survives).
2. **deep link** — `goto(...?step=number)` renders the number step selected.
3. **Back** — select two steps, `goBack()`, assert the previous step is selected.
4. **bad param** — `?step=not_a_step` falls back to the first not-done step, pane not empty.
5. **locked step is selectable and names blockers** — on a fresh fixture account select `go_live`, assert the pane lists the unmet prerequisites and the go-live button is disabled.
6. **first-incomplete preselect** — fresh account, no `?step=`, assert the expected step is current.
7. **inline rename mutation check** — rename, reload, assert it stuck; and assert an empty value is rejected (error toast, name unchanged).

- [ ] **Step 2: Run the spec ALONE until green**

Run: `cd apps/web && npx playwright test setup.spec.ts --reporter=line`
🔴 Nothing else on port 3000; no second Playwright run alive.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/setup.spec.ts
git commit -m "test(e2e): two-pane wizard selection, deep link, locked steps, rename"
```

---

### Task 6: gates + screenshots + review

- [ ] **Step 1: Full gates**

```bash
pnpm check                    # typecheck + lint + db + web — exit 0
pnpm --filter web build
cd apps/web && npx playwright test --reporter=line   # FULL suite green
```
Fix anything red and re-run the full set. Do not call a failure pre-existing without evidence from the pre-change revision.

- [ ] **Step 2: Screenshot pass, both themes**

Recipe that works (proven this session): a completed e2e run leaves
`e2e/.auth/state.json` and a production build → `pnpm --filter web start` →
a Playwright script placed INSIDE `apps/web` (pnpm module isolation means a
scratchpad script cannot resolve `@playwright/test`). 🔴 Do NOT rebuild while
that server runs — it poisons `.next` and produces phantom page errors.
Shots: rail showing a MIX of states (done/current/to-do/locked, and a
"couldn't check" if one can be induced) · a locked step's pane with its
blocker list · the rename step · one ordinary step's pane · light AND dark.
Save to the session scratchpad `design-shots-p5/`, verify them yourself by
reading the images, then send to danlo.

- [ ] **Step 3: Ledger + final review**

Append the P5 record to `.superpowers/sdd/progress.md`, push the branch, run
the final whole-branch review (most capable model), fix wave if it returns
findings, re-review, then danlo's merge gate.

---

## Self-review notes (already applied)

- **Spec coverage:** two-pane layout (T4) · five rail states incl. `unknown` (T1 logic, T4 render) · locked-with-reason for exactly two steps (T1 + T4) · always-selectable locked steps (T4) · first-incomplete preselect + `?step=` parse/fallback (T1 + T4) · shallow URL, no RSC re-render (T4) · rename with empty rejected (T2 + T4) · decomposition of the 30KB panel (T3) · testing + screenshots (T5, T6). Every spec section maps to a task.
- **Type consistency:** `SetupStepKey` is the one vocabulary throughout; `StepDetailProps` is declared once in `step-shared.ts` and consumed by all nine modules; `kindOf`/`canEnableTestCalls`/`GO_LIVE_PREREQ_KEYS` are imported, never re-derived.
- **Known judgment call the reviewer should weigh:** Task 4 Step 4's `InlineField` `field`-prop mismatch — the implementer must pick (a) or (b) and justify it, not pass a contact-column lie.
- **Deliberate ordering:** the mechanical extraction (T3) lands and is proven by the UNCHANGED setup e2e before any layout change (T4), so a behavior regression can be attributed to one or the other.

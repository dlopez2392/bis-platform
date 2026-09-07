# Brand-name resolver (no fallback to the agency's label) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No customer-facing surface can show the agency's internal `accounts.name` label: the resolver loses the parameter that carried it, the voice prompt uses the resolver, a brand name is seeded at creation, required on save and at go-live, and the live rows without one are backfilled.

**Architecture:** `brandDisplayName(branding)` and `emailBrand(branding)` take ONE argument; every call site drops the label (the compiler is the checklist), the two old cron due-rows and `AccountBrandInfo` lose `accountName`, the four `?? "BIS"` literals go, and both voice prompt builders read the resolver. Migration 0028 is a one-line data backfill. Three product guards make a blank name unreachable.

**Tech Stack:** as PR #30 (Next.js 16, Supabase/PostgREST, vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-07-brand-name-resolver-design.md`. Everything below was read from source on 2026-09-07 at `2851207`; re-read a line before editing it if `main` has moved.

## Global Constraints

- **Branch `feat/brand-name-resolver` off `main` AFTER PR #30 merges** (`git fetch origin && git checkout -b feat/brand-name-resolver origin/main`); PR-only repo, never push `main`, merge only when CI `verify` + `e2e` are green on the PR's current head and danlo says so. Verify the branch in the same command that commits: `B="$(git branch --show-current)"; [ "$B" = "feat/brand-name-resolver" ] && git commit … || echo "BRANCH MOVED TO $B"`.
- **Migration 0028 is applied ONCE via the Supabase MCP `apply_migration` on `tlbkbmlrfafquucsmsmm` after a pre-flight read; never re-apply; 0025–0027 are applied — never touch.** The db tests and e2e share that project with production.
- Every new test names its mutation; grep the mutated text count before trusting a mutation run (a sed that matched nothing read as a pass once on 2026-09-07). `cd /c/Users/danlo/bis-platform…` at the start of every command. vitest filters: a path with `[brackets]` matches nothing — use a bracket-free substring; run the db suite ALONE; `cd apps/web && npx playwright test <file>` for one spec (`pnpm --filter web test:e2e -- <file>` runs the whole suite).
- Baseline at `2851207` (after PR #30): db 220 · web ≈1404 · e2e 72 — record the real numbers from the first `pnpm check`.

## File Structure

- `packages/db/supabase/migrations/0028_brand_name_backfill.sql` — CREATE.
- `packages/db/src/accounts.ts:13` — MODIFY: `createAccount` seeds `brand_name: input.name`. Test in `packages/db/src/test/accounts.test.ts` (create if absent; else append).
- `packages/db/src/branding.ts:186-188` — MODIFY: `brandDisplayName(branding)`; doc rewritten. `packages/db/src/test/branding.test.ts:18-25` — flip.
- `packages/db/src/booking.ts:59,81,384,413,529,638` — MODIFY: `accountName` removed from `DueReminder`, `DueFollowup`, `AccountBrandInfo`, `loadAccountBrandInfo`, both list functions. `packages/db/src/automations.ts:243,377,482` — `brandDisplayName(info.branding)`. Tests in `packages/db/src/test/booking.test.ts` / `automations.test.ts` that read `accountName` on rows — remove those assertions (grep `accountName`).
- `apps/web/src/lib/email/templates/shell.ts:33-35,55-57` — MODIFY: one-argument resolver and `emailBrand`. `shell.test.ts:19-21` flip; `brand-name-parity.test.ts:10-33` new cases.
- `emailBrand(` call sites (11): `f/[publicId]/actions.ts:548,616` · `b/[publicId]/actions.ts:394` · `b/[publicId]/cancel/[token]/actions.ts:165` · `conversations/actions.ts:61` · `passes/reminders.ts:44` · `passes/followups.ts:67` · `lib/voice/finish-call.ts:245` · `lib/voice/tools/registry.ts:240,339` (+ any the compiler finds). `brandDisplayName(` call sites (7): `automations/page.tsx:51` · `voice/page.tsx:74` · `finish-call.ts:338` · `packages/db/src/automations.ts` ×3 (+ any found).
- `apps/web/src/app/api/voice/incoming/route.ts:494-517` and `apps/web/src/app/api/voice/web/session/route.ts:118-124` — MODIFY: `businessName` and the default greeting from the resolver. `incoming/route.test.ts` — one assertion.
- `apps/web/src/lib/setup/setup-status.ts:112-115` — MODIFY: `&& isDone("branding")`; `setup-status.test.ts:293+` — new cases. `setup/actions.ts:100-135` — MODIFY: the `accounts` leg gates; `setup/actions.test.ts` — one case. Doc comment at `setup/actions.ts:175-195` (`renameAccountAction`) — revise the sentence that says a fresh account has no `brand_name`.
- `branding/actions.ts:43` — MODIFY: blank refused with `m["branding.nameRequired"]`; `components/branding-panel.tsx:188` — `required`; `lib/messages.ts` — the key; new `branding/actions.test.ts` (model on `automations/actions.test.ts`).
- `apps/web/src/lib/automations/sentinel.test.ts:49,53` — fixture rows lose `accountName`; add a `@ts-expect-error` pin per row type. `automations/page.test.ts:98-101` — flip.

---

### Task 1: Branch, migration 0028 (backfill) — pre-flight list for danlo, apply once, post-verify

- [ ] **Step 1: Branch off the merged main**
```bash
cd /c/Users/danlo/bis-platform && git fetch origin && git checkout -b feat/brand-name-resolver origin/main && git log --oneline -1 && git status --porcelain | head -3
```
Expected: HEAD is PR #30's merge commit; only this plan and the spec are untracked (they are committed in Step 5).

- [ ] **Step 2: Pre-flight read (`execute_sql`) — the list danlo reviews**
```sql
select id, name, brand_name, client_access_enabled, created_at::date as created
from accounts where brand_name is null or btrim(brand_name) = '' order by created_at;
```
Expected (2026-09-07): `Test Client One` (client access on) plus the `Fixture Co` orphans. Record every id in the ledger. Flag any `name` containing "—", "trial" or "test" as needing a manual edit afterwards (today: none of the affected names does; `Test Client One` is the e2e fixture and keeps its name). **If a real client appears in the list, show danlo before applying.**

- [ ] **Step 3: Write and apply the migration**
`packages/db/supabase/migrations/0028_brand_name_backfill.sql`:
```sql
-- 0028: the customer-facing name is mandatory from here on (spec
-- 2026-09-07-brand-name-resolver-design.md). `brandDisplayName` no longer
-- falls back to `accounts.name` — the agency's internal label — so every
-- account needs a `brand_name`. One-time backfill from the label for the
-- rows that have none (read and reviewed before this ran: the e2e fixture and
-- test-account orphans; no real client). From this migration on,
-- createAccount seeds brand_name, the Branding save refuses a blank, and
-- go-live requires the branding step. No constraint: a client holds UPDATE on
-- brand_name (0013) and a NOT NULL would turn a blank into a Postgres error
-- the operator cannot act on; the application rule is the guard.
update public.accounts set brand_name = name where brand_name is null or btrim(brand_name) = '';
```
Apply: `apply_migration` name `0028_brand_name_backfill`, the exact SQL. Post-verify: `select count(*) from accounts where brand_name is null or btrim(brand_name) = ''` → **0**, and `select count(*) from accounts where brand_name = name` equals the pre-flight count plus any that already matched. Ledger: **MIGRATION 0028 APPLIED — NEVER RE-APPLY**, with the ids.

- [ ] **Step 4: `createAccount` seeds the brand name — test first (real db), then the one-line change**
Append to `packages/db/src/test/accounts.test.ts` (create the file with the `withTestAccount`-style imports of `automations.test.ts` if it does not exist):
```ts
it("createAccount seeds brand_name from the name it is given — no account is ever nameless to a customer", async () => {
  // Mutation: drop `brand_name: input.name` from the insert.
  await withTestAccount(async (db, accountId) => {
    const { data } = await db.from("accounts").select("name, brand_name").eq("id", accountId).single();
    expect(data).toEqual({ name: "Fixture Co", brand_name: "Fixture Co" });
  });
});
```
Run → fails (`brand_name: null`). Then `packages/db/src/accounts.ts:13`: add `brand_name: input.name,` to the insert object. Run → passes. Then the whole db suite alone.

- [ ] **Step 5: Commit** (migration, accounts.ts, its test, the spec, this plan).

---

### Task 2: The product guards — Branding save, go-live gate, the `accounts` leg

- [ ] **Step 1: Branding save refuses a blank (test first).** Create `.../branding/actions.test.ts` modelled on `automations/actions.test.ts` (mock `next/cache`, `@bis/db` with `setBranding: vi.fn()` + `serviceDb`, `@/lib/auth` `requireAccountAccess`). Tests: a blank or whitespace `brandName` → `{ ok: false, error: m["branding.nameRequired"] }` and `setBranding` not called (mutation: restore `|| null`); a normal name still saves. Then `branding/actions.ts:43`:
```ts
  const brandName = String(formData.get("brandName") ?? "").trim();
  // Customers see this name on every email, text and the booking page; it
  // is never blank from here on (spec 2026-09-07-brand-name-resolver).
  if (!brandName) return { ok: false, error: m["branding.nameRequired"] };
```
`messages.ts`: `"branding.nameRequired": "Customers see this name on every email and text. Give the company a name before saving.",` next to `branding.badColor`. `components/branding-panel.tsx:188`: add `required` to the input.

- [ ] **Step 2: Go-live requires branding (test first).** In `setup-status.test.ts`'s `goLivePrereqsMet` describe add: every other step done but `branding` undone → `false` (mutation: drop `isDone("branding")`); all done including branding, email undone → still `true` (the existing guard). Then `setup-status.ts:114`: `return isDone("hours") && isDone("voice_profile") && isDone("number") && isDone("test_call") && isDone("branding");` and revise the comment at 107-111 (branding is now included; email/forwarding still excluded).

- [ ] **Step 3: `goLiveAction` stops ignoring the `accounts` leg (test first).** In `setup/actions.test.ts` add: `gatherSetupInputs` resolving `failed.account = true` → `{ ok: false, error: m["setup.goLive.failed"] }` (mutation: leave `failed.account` out of `reReadFailed`). Then `setup/actions.ts:128`: `const reReadFailed = failed.account || failed.calendar || …` and rewrite the doc comment at 100-109 (the action now reads six legs because branding gates go-live). Also revise `renameAccountAction`'s comment (`setup/actions.ts:175-195`): a fresh account DOES have a `brand_name` now (seeded), and the customer surfaces read `brandDisplayName(branding)`.

- [ ] **Step 4: Run** `npx vitest run "setup" "branding"` (bracket-free substrings), typecheck, lint; mutations; commit.

---

### Task 3: The resolver loses its parameter; every call site, both due-rows, the voice prompt, the flipped tests

- [ ] **Step 1: Flip the three tests and the parity test FIRST, watch them fail.**
  - `shell.test.ts:19-21` → `it("returns the EMPTY string, never the account name, when no brand name is set", () => { expect(emailBrand(UNBRANDED).name).toBe(""); });` (the `accountName` argument is gone).
  - `packages/db/src/test/branding.test.ts:18-25` → `brandDisplayName({ ...base, brandName: null })` is `""`; `brandName: ""` is `""`; `brandName: "  "` is `""`; `brandName: "Rio Roofing"` is `"Rio Roofing"`.
  - `brand-name-parity.test.ts` → cases `[["Rio Roofing"], [null], [""], ["  "]]` mapped through both one-argument copies, equal; `emailBrandNamed(b, "Rio Roofing")` equals `emailBrand(b)` when `b.brandName = "Rio Roofing"`.
  - `automations/page.test.ts:98-101` → name stays `"Rio Roofing — trial"` in the fixture, `brandName` null → `expect((await render()).review!.brandName).toBe("")`.
  Run the four files → fail on arity/values.

- [ ] **Step 2: The two resolver copies.**
`shell.ts:33-35`:
```ts
export function brandDisplayName(branding: Branding): string {
  return branding.brandName?.trim() || "";
}
```
and `emailBrand(branding: Branding): EmailBrand { return emailBrandNamed(branding, brandDisplayName(branding)); }`. Rewrite the doc (14-32): there is no fallback; a blank is unreachable through the product (creation seed, save rule, go-live gate, 0028); the two copies stay pinned by the parity test. Same body and doc in `packages/db/src/branding.ts:186-188`.

- [ ] **Step 3: Typecheck is the checklist.** `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` now list every call site passing a second argument. Fix each by deleting the argument and, where a variable existed only to feed it, the variable: the four `account?.name ?? "BIS"` sites (drop `name` from those `.select(...)` lists ONLY if nothing else reads it — `f/[publicId]/actions.ts` `receipt`/`notify` select `name`; check `notify`'s use first), `passes/reminders.ts:44`, `passes/followups.ts:67`, `finish-call.ts:245,338`, `tools/registry.ts:240,339`, `automations/page.tsx:51` (becomes `brandName: brandDisplayName(branding)`; the `accounts` read keeps `timezone`), `voice/page.tsx:74`, `packages/db/src/automations.ts:243,377,482`.

- [ ] **Step 4: The rows lose the label.** `packages/db/src/booking.ts`: remove `accountName` from `DueReminder` (59), `DueFollowup` (81), `AccountBrandInfo` (384), `loadAccountBrandInfo` (413), `listDueReminders` (529), `listDueFollowups` (638); if `ACCOUNT_BRAND_COLS` (369-371) lists `name` only for this, drop it. `FinishContext.accountName` / `ToolContext.accountName` (`finish-call.ts:22`, `tools/registry.ts:30`, set at `incoming/route.ts:528,533`): remove if nothing else reads them after Step 3 (grep). Update every test fixture the compiler names (`sentinel.test.ts:49,53`, `passes/reminders.test.ts`, `passes/followups.test.ts`, `route.test.ts` fixtures, `packages/db` tests asserting `accountName` on rows — replace with `expect(row).not.toHaveProperty("accountName")`).

- [ ] **Step 5: Voice.** `incoming/route.ts`: move the `branding` block (512-517) ABOVE `promptInput` (496); `businessName: brandDisplayName(branding)`; the default greeting at 494 uses the same value. `web/session/route.ts:118-124`: build `branding` from `acct` the same way (extend its select with the seven brand columns if needed) and use the resolver for both. In `incoming/route.test.ts` add: an account row with `name: "Rio Roofing — trial"`, `brand_name: "Rio Roofing"` → the session config / prompt contains `"Rio Roofing"` and not `"— trial"` (find the existing test that inspects `buildRealtimeSessionConfig`'s output or the prompt string and model on it; mutation: `businessName: accountRow.name`).

- [ ] **Step 6: Sentinel pins.** `sentinel.test.ts`: the two old rows drop `accountName`; add
```ts
  it("no cron row type carries the agency's label any more", () => {
    // @ts-expect-error — DueReminder has no accountName
    const r: DueReminder = { ...REMINDER_ROW, accountName: INTERNAL_LABEL };
    // @ts-expect-error — DueFollowup has no accountName
    const f: DueFollowup = { ...FOLLOWUP_ROW, accountName: INTERNAL_LABEL };
    void r; void f;
  });
```
(import the two types from `@bis/db`; name the fixture objects). The label scan and `toContain(BRAND)` stay.

- [ ] **Step 7: Run** the automations tree, cron route, voice, email templates, db suite (alone), typecheck, lint; mutations (a `?? accountName` reintroduced in ONE copy → the parity test bites; `businessName: accountRow.name` → the voice test bites); commit.

---

### Task 4: Gates, ledger, review, PR — no merge

- [ ] `pnpm check` · `pnpm --filter web build` · full e2e (uncontended; fetch first; merge `origin/main` in if it moved). Record real counts.
- [ ] Eyeball on the built app: the Branding page refuses a blank name with the new message; the setup wizard's go-live button is disabled with branding undone for a throwaway account and enabled once a name is saved; an email preview (any template test's HTML) carries the brand name. Throwaway rows deleted afterwards.
- [ ] Ledger: migration 0028 ids; the orphan `Fixture Co` accounts listed for danlo's cleanup decision; gates; mutations.
- [ ] `superpowers:requesting-code-review` with claims: (1) no code path passes `accounts.name` to any customer-facing string — grep `accountName` and `.name` in the customer routes, the passes, voice; (2) both resolver copies are identical and one-argument; (3) `createAccount` seeds, save refuses blank, go-live requires branding, `goLiveAction` gates on the accounts leg; (4) 0028 backfilled only the listed rows; (5) every flipped test asserts the empty string, not the label; (6) the e2e fixture `Test Client One` still renders its name everywhere (it was backfilled).
- [ ] Push, PR (`gh pr create`, REST fallback), CI green on the head, danlo merges (REST PUT), verify the deploy, smoke.

## Self-review (2026-09-07)
Spec coverage: Decision 1 → Task 1 Steps 2–3; Decision 2 → Task 1 Step 4, Task 2; Decision 3 → Task 3 Steps 1–4, 6; Decision 4 → Task 3 Step 5; Decision 5 → nothing (out of scope, stated). Placeholders: none — call-site edits are enumerated and the compiler closes the list. Type consistency: `brandDisplayName(branding)`/`emailBrand(branding)` one argument everywhere; `emailBrandNamed(branding, name)` unchanged.

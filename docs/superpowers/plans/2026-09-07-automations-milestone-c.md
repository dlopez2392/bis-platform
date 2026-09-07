# Automations Milestone C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text a new web-form lead from the company's own number the moment their submission lands, in the language they filled the form in — the platform's first INLINE automation recipe (`instant_reply`), configured on the Automations page and off by default.

**Architecture:** No cron, no registry entry. The public form action gains a fourth independent block after the receipt email that calls one new module, `lib/automations/instant-reply.ts`, which decides (recipe on, phone parsed, consent not withheld, A2P gate, 24h per-thread hold, daily cap), sends through the existing write-then-send SMS helper, stamps the submission row, and returns one outcome. Migration 0027 adds the stamp column, the catalogue key and one partial index. The shared SMS helpers take a narrower context type so the inline caller never builds an email provider. The Automations page gains a fourth card with an English and a Spanish textarea, each previewing the verbatim string that sends.

**Tech Stack:** Next.js 16.2.11 App Router (apps/web), Supabase Postgres + PostgREST via `@supabase/supabase-js` (packages/db), Clerk, vitest, Playwright, Telnyx behind `getSmsProvider()`.

**Spec:** `docs/superpowers/specs/2026-09-07-automations-milestone-c-design.md` (commit `14c0fbd` on `feat/automations-c`). Every signature below was read from `main` @ `2293b74` on 2026-09-07; the B plan (`2026-09-06-automations-milestone-b.md`) is the template this plan copies for task shape and mutation discipline.

## Global Constraints

- **Branch:** all work on `feat/automations-c` (it exists: one commit, the spec, on `origin/main` = `2293b74`). **The repo is PR-only (PR #25): never push `main`.** Land through a PR; merge only when CI jobs `verify` AND `e2e` are green on the PR's CURRENT head, and only when danlo says to (no autonomous merges).
- **Parallel sessions move this working tree.** Every command that writes or commits verifies the branch IN THE SAME COMMAND: `B="$(git branch --show-current)"; [ "$B" = "feat/automations-c" ] && git commit ... || echo "BRANCH MOVED TO $B"`. Fetch before every decision; if `origin/main` moved, merge it INTO the branch and re-run every gate on the combined tree.
- **Migration 0027 is applied ONCE, by the orchestrating session, via the Supabase MCP `apply_migration` tool on project `tlbkbmlrfafquucsmsmm`**, after the pre-flight read in Task 1 Step 6. The e2e suite and `packages/db` tests share that ONE project with production. **Never re-apply. Never `db:push`. 0025 and 0026 are applied — never touch them.**
- **Off by default:** the recipe needs an `automations` row with `recipe_key = 'instant_reply'` and `enabled = true` that no account has. Nothing changes for any client on deploy, and in production the A2P gate (`a2p_not_approved`, no approved client; `TELNYX_API_KEY` unset) stops every send even if a row were enabled. **The e2e suite must NEVER enable this recipe on the fixture account.**
- **The brand-name leak:** the send path composes NOTHING — it sends the saved text verbatim — and `InstantReplyInput` carries no name at all (pinned with `@ts-expect-error` in the sentinel, the `PassContext` precedent). Only the settings page's prefilled defaults use `brandName`, resolved the way the other three cards resolve it.
- **Caps:** `AUTOMATION_DAILY_CAP = 25` per account per rolling 24h (`DAILY_CAP_WINDOW_MS`), counted on `form_submissions.instant_reply_sent_at`. No per-tick cap: there is no tick. The hold is its own constant, `INSTANT_REPLY_THREAD_HOLD_MS = 24h`, read through `hasRecentOutboundSms` (Task 5).
- **One attempt, no retry, no failure-marker column, no `stampWithRetry`.** The receipt email already went; a failed text is a visible failed `messages` row; the per-thread hold — not the stamp — is the double-text guard.
- **Providers come from `harness.ts` only** (`imports.test.ts`): the inline module gets its lazy SMS getter from `lazySmsProvider()` in `harness.ts`, never from `@/lib/sms`.
- **Copy:** plain language a business owner would text; `{name}` in `messages.ts` is filled by code on the settings page, never by an operator and never at send time; every default stays inside GSM-7 (no em dash, Spanish with no á/í/ó/ú) and its segment count is MEASURED in a test. Tú form, to match the receipt email (`lead-receipt.ts`). UI uses the existing components exactly as `sms-reminder-card.tsx` does; no hard-coded colours.
- **Every test names its mutation.** A test whose mutation leaves it green is not finished. Read the failed test NAME, never just the exit code — a `-t` filter that matches nothing passes silently.
- **`pnpm check` = typecheck + lint + db tests + web tests.** Baseline at `2293b74`: db 213 · web 1329 · e2e 71/71. Run gates with `cmd > out.txt 2>&1; echo "exit=$?"` — pipes mask exit codes. Run the db suite ALONE (it hits the real, production-shared database). Never run e2e while a live voice/video test is in progress (it wipes Test Client One's calendar by design).
- **Bash cwd persists across calls: every git/pnpm/vitest command starts with `cd /c/Users/danlo/bis-platform...`.** Never shell-`cp` the double-bracketed route paths — Read/Write/Edit only. Windows git refuses `/c/...` pathspecs in `git add`: use repo-relative paths.

## Decisions this plan makes where the spec is silent (flag to danlo, do not re-litigate the ones in the spec)

1. **Grants: 0027 changes NONE, and the spec's "pin the client role's standing" pins what the live project actually holds.** The pre-flight (2026-09-07, before this plan) found `form_submissions` carries Supabase's DEFAULT table-level grants — `authenticated` AND `anon` each hold `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` — with RLS on and ONE policy, `form_submissions_member_all` (`app.is_agency() OR account_id = app.current_account_id()`, ALL, to `authenticated`). So `anon` reaches nothing (no policy) and a member reaches only their own account's rows. The new column inherits exactly that. Residual, stated: a member of an account could UPDATE their own submissions' stamp (their own cap, their own texting bill; no cross-tenant reach — pinned as `rowCount 0`). Revoking table-level UPDATE to match the bookings pattern is a wider change than C and is NOT done here.
2. **The hold is its own constant** (`INSTANT_REPLY_THREAD_HOLD_MS`), not `SMS_RETRY_COOLDOWN_MS`: that one is about a FAILED attempt, this one about a successful send, and the two must be free to move apart.
3. **An empty body for the submission's locale at send time skips as `disabled`** (silent). It is reachable only by a direct database edit — the save action refuses to enable with a blank text — so it is a guard, not a feature.
4. **Card prefill:** the defaults appear only when NO row exists. A stored row shows exactly what it stores (a stored `""` shows empty), read leniently like `automations-settings.tsx`'s `formDefaults`. There is no empty-means-default: the send path sends verbatim, and the action refuses to enable with a blank, so the preview never shows a string that would not send.
5. **`now` is `new Date()` at the seam** in the form action (the action has no single tick instant); the module measures the hold and the cap from that one value.
6. **Logging lives inside the module**, not the action: `smsGate`, `dailyCap`, `failed` and an unstamped `sent` are `console.error`ed there; `disabled`, `noPhone`, `consentWithheld`, `recentText` are silent. The action logs only a crash of the module itself.
7. **The sentinel gains a describe rather than a new file**, and the module test mocks `@/lib/sms` + `@/lib/email` exactly as `harness.test.ts` does, because the module reaches the provider only through `harness.ts`.

## Pre-flight facts read on the LIVE project 2026-09-07 (before this plan; Task 1 re-reads them before applying)

- `automations_recipe_key_check` = `CHECK ((recipe_key = ANY (ARRAY['review_request'::text, 'no_show_nudge'::text, 'sms_reminder'::text])))`.
- `form_submissions.instant_reply_sent_at` does not exist; `consent jsonb` and `locale text` do. Indexes: `form_submissions_account_form`, `form_submissions_contact`, `form_submissions_pkey`, `form_submissions_rate`.
- `relrowsecurity = true` on `form_submissions` and `automations`; policies on `form_submissions`: exactly `form_submissions_member_all` (ALL, authenticated).
- Latest applied migration: `20260906210908 0026_automations_b`.

---

## File Structure

**packages/db**
- `supabase/migrations/0027_instant_reply.sql` — CREATE. The stamp column, the catalogue +1, one partial index. No grants.
- `src/automations.ts` — MODIFY. `RecipeKey` +1; new section: `InstantReplyConfig`, `parseInstantReplyConfig`, `stampInstantReplySent`, `countInstantRepliesSince`.
- `src/index.ts` — MODIFY. Exports.
- `src/test/automations-grants.test.ts` — MODIFY (append). 0027 column + catalogue, watched failing first; the live standing on `form_submissions` pinned; the cross-tenant stamp reaches zero rows.
- `src/test/automations.test.ts` — MODIFY (append). Parser, stamp, count (real database).

**apps/web — lib**
- `src/lib/automations/caps.ts` — MODIFY. `INSTANT_REPLY_THREAD_HOLD_MS`.
- `src/lib/automations/send-sms.ts` — MODIFY. `SmsSendContext = Pick<PassContext, "db" | "sms">`; the two helpers take it. Its test file is NOT edited (the proof).
- `src/lib/automations/harness.ts` — MODIFY. `lazySmsProvider()` extracted; `buildPassContext` uses it. `harness.test.ts` — MODIFY (append two tests).
- `src/lib/automations/instant-reply-copy.ts` + `.test.ts` — CREATE. `defaultInstantReplyBody(brandName, language)`, measured.
- `src/lib/automations/instant-reply.ts` + `.test.ts` — CREATE. `sendInstantReply(input): Promise<InstantReplyOutcome>` and its types.
- `src/lib/automations/sentinel.test.ts` — MODIFY. Four mocks added; one describe appended. `imports.test.ts` — MODIFY. Two file names added to the reach guard.
- `src/lib/messages.ts` — MODIFY. Four default bodies (Task 4) and the card's copy (Task 7).

**apps/web — the seam**
- `src/app/f/[publicId]/actions.ts` — MODIFY. `enrich` gains `consentWithheld`; hoists `conversationId`, `phoneE164`; the fourth block after the receipt.
- `src/app/f/[publicId]/actions.test.ts` — MODIFY. One module mock; one describe appended (seven tests).

**apps/web — the page**
- `src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts` — MODIFY. `saveInstantReplyAction`.
- `.../automations/instant-reply-card.tsx` — CREATE.
- `.../automations/page.tsx` — MODIFY. Fourth row read, fourth card.
- `.../automations/actions.test.ts`, `page.test.ts` — MODIFY (append). `apps/web/e2e/automations.spec.ts` — MODIFY (append one describe).

---

### Task 1: Migration 0027 — proven by tests written and watched failing first, applied once, committed with this plan

**Files:**
- Create: `packages/db/supabase/migrations/0027_instant_reply.sql`
- Modify: `packages/db/src/test/automations-grants.test.ts` (append)
- Commit also: `docs/superpowers/plans/2026-09-07-automations-milestone-c.md` (this file)

**Interfaces:**
- Produces: column `form_submissions.instant_reply_sent_at timestamptz null`; catalogue key `'instant_reply'`; index `form_submissions_instant_reply_sent`. Task 2's data layer reads and writes the column; Task 7's action writes the key.

- [ ] **Step 1: Fetch, confirm the branch and its base, tree clean — in one command**

```bash
cd /c/Users/danlo/bis-platform && git fetch origin --prune 2>&1 | tail -1; B="$(git branch --show-current)"; echo "ON: $B @ $(git rev-parse --short HEAD)"; git status --porcelain | head -3; echo "--- on the branch, not on origin/main:"; git log --oneline origin/main..HEAD; echo "--- on origin/main, not on the branch (expect NONE; if any: git merge origin/main first):"; git log --oneline HEAD..origin/main
```
Expected: `ON: feat/automations-c @ 14c0fbd`, an empty porcelain, exactly `14c0fbd docs(automations): Milestone C design …` above the second marker, nothing below it. If the branch is anything else, `git checkout feat/automations-c` and repeat.

- [ ] **Step 2: Write the migration**

Create `packages/db/supabase/migrations/0027_instant_reply.sql`:

```sql
-- 0027: Automations Milestone C — the instant reply to a new web-form lead.
-- The INLINE recipe: it fires from the public form action the moment a
-- submission lands (docs/superpowers/specs/2026-09-07-automations-milestone-c-
-- design.md), not from the cron. Three things, in the 0026 shape:
--
-- 1. THE DEDUPE STAMP. `form_submissions.instant_reply_sent_at`, send-then-
--    stamp like every other recipe. Null = no text was sent for this
--    submission. It is NOT the primary double-text guard — that is the 24h
--    per-thread hold (hasRecentOutboundSms) the send path reads — it is the
--    evidence the daily cap counts.
-- 2. THE CATALOGUE grows by one key. Postgres names an inline column CHECK
--    <table>_<column>_check; the pre-flight read confirms the name before
--    this runs.
-- 3. ONE partial index so the cap count (account, stamp >= now - 24h) is an
--    index-only read.
--
-- Grants: NONE change. form_submissions carries Supabase's default table-
-- level grants (`authenticated` AND `anon` hold SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER); RLS is on with ONE policy,
-- form_submissions_member_all (the agency, or account_id = the caller's own
-- account), so anon reaches nothing and a member reaches only their own
-- account's rows. The new column inherits exactly that standing, pinned in
-- automations-grants.test.ts. OFF BY DEFAULT: the recipe needs an enabled
-- `instant_reply` automations row that no account has.

alter table public.form_submissions add column instant_reply_sent_at timestamptz;

alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in ('review_request', 'no_show_nudge', 'sms_reminder', 'instant_reply'));

create index form_submissions_instant_reply_sent
  on public.form_submissions (account_id, instant_reply_sent_at)
  where instant_reply_sent_at is not null;
```

- [ ] **Step 3: Append the 0027 proofs to the grants test**

Append to `packages/db/src/test/automations-grants.test.ts` (after the `0026 automations B` describe; `seedTwoAccounts` is already defined above it):

```ts
/**
 * 0027, at the level that can see it. Watched failing BEFORE the migration:
 * the column read comes back empty, the catalogue insert is refused with
 * 23514, and the cross-tenant test dies on 42703 (no such column) — the
 * proof none of them passes by accident.
 *
 * The standing on form_submissions is NOT the bookings pattern (bookings
 * revokes client UPDATE). It carries Supabase's default table-level grants
 * for `authenticated`, and RLS's single member policy is the fence — read on
 * the live project 2026-09-07 before 0027 was written. These tests pin THAT
 * standing, so a later revoke or a new policy shows up here, not in
 * production. Mutation: change the expected grant list and watch it fail.
 */
describe("0027 instant reply", () => {
  it("form_submissions carries the stamp column", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'form_submissions'
            and column_name = 'instant_reply_sent_at'`,
      );
      expect(rows).toEqual([{ column_name: "instant_reply_sent_at", data_type: "timestamp with time zone" }]);
    });
  });

  it("the recipe catalogue accepts instant_reply", async () => {
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await c.query("insert into automations (account_id, recipe_key) values ($1, 'instant_reply')", [a]);
      const { rows } = await c.query(
        "select recipe_key from automations where account_id = $1 order by recipe_key", [a]);
      expect(rows.map((r: any) => r.recipe_key)).toEqual(["instant_reply", "review_request"]);
    });
  });

  it("the client role's standing on form_submissions is the Supabase default — table-level grants, RLS as the fence", async () => {
    await withRollback(async (c) => {
      const { rows: grants } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'form_submissions' and grantee = 'authenticated'
          order by privilege_type`,
      );
      expect(grants.map((g) => g.privilege_type)).toEqual(
        ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]);
      const { rows: rls } = await c.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = 'public.form_submissions'::regclass");
      expect(rls).toEqual([{ relrowsecurity: true }]);
      const { rows: policies } = await c.query<{ policyname: string; cmd: string }>(
        "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'form_submissions'");
      expect(policies).toEqual([{ policyname: "form_submissions_member_all", cmd: "ALL" }]);
    });
  });

  // RLS, not a grant, is what keeps a client off another account's stamp: the
  // cross-tenant UPDATE is not refused, it matches NO row. Pinned as rowCount,
  // never as "something failed".
  it("a client stamps its own account's submission (1 row) and reaches zero rows of another account's", async () => {
    await withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      const { subA, subB } = await seedOneSubmissionEach(c, a, b);
      await actAs(c, { org_id: "org_AUTO_A" });
      const own = await c.query(
        "update form_submissions set instant_reply_sent_at = now() where id = $1", [subA]);
      expect(own.rowCount).toBe(1);
      const other = await c.query(
        "update form_submissions set instant_reply_sent_at = now() where id = $1", [subB]);
      expect(other.rowCount).toBe(0);
    });
  });
});

async function seedOneSubmissionEach(c: any, a: string, b: string) {
  const { rows: [fa] } = await c.query(
    "insert into forms (account_id, public_id, name) values ($1, 'pub_AUTO_A', 'Quote') returning id", [a]);
  const { rows: [fb] } = await c.query(
    "insert into forms (account_id, public_id, name) values ($1, 'pub_AUTO_B', 'Quote') returning id", [b]);
  const { rows: [sa] } = await c.query(
    "insert into form_submissions (account_id, form_id) values ($1, $2) returning id", [a, fa.id]);
  const { rows: [sb] } = await c.query(
    "insert into form_submissions (account_id, form_id) values ($1, $2) returning id", [b, fb.id]);
  return { subA: sa.id as string, subB: sb.id as string };
}
```

- [ ] **Step 4: Run and watch the right three fail**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts -t "0027" > /c/Users/danlo/AppData/Local/Temp/claude/c-t1-fail.txt 2>&1; echo "exit=$?"; grep -E "✓|×|✗|FAIL|passed|failed|column_name|23514|42703" /c/Users/danlo/AppData/Local/Temp/claude/c-t1-fail.txt | head -20
```
Expected: `exit=1`; **1 passed** (the standing pin — it pins today's state) and **3 failed**, BY NAME: "carries the stamp column" (rows `[]`), "accepts instant_reply" (`23514`), "stamps its own account's submission" (`42703` — no such column). If the standing pin FAILS, stop: the live grants differ from the pre-flight — re-read them and fix the expectation before anything else.

- [ ] **Step 5: Typecheck the db package (nothing moves yet)**

```bash
cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t1-tc.txt 2>&1; echo "exit=$?"; tail -3 /c/Users/danlo/AppData/Local/Temp/claude/c-t1-tc.txt
```
Expected: `exit=0`. (If the package name differs, `grep '"name"' packages/db/package.json` and use that.)

- [ ] **Step 6: Pre-flight read, then apply 0027 — orchestrating session only, via the Supabase MCP**

Pre-flight (`execute_sql` on project `tlbkbmlrfafquucsmsmm`):
```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'form_submissions'
      and column_name = 'instant_reply_sent_at') as c_col,
  (select string_agg(conname || ' = ' || pg_get_constraintdef(oid), ' | ')
    from pg_constraint where conrelid = 'public.automations'::regclass and contype = 'c') as checks,
  (select version::text || ' ' || name from supabase_migrations.schema_migrations
    order by version desc limit 1) as latest,
  (select string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'form_submissions' and grantee = 'authenticated') as client_grants;
```
Expected: `c_col` **0** · `checks` exactly one entry named **`automations_recipe_key_check`** listing `review_request`, `no_show_nudge`, `sms_reminder` and nothing else · `latest` **`20260906210908 0026_automations_b`** · `client_grants` **`DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`**. **If any differs — a different constraint name, the column present, a later migration, different grants — STOP and report; do not apply.**

Apply: `apply_migration` with `name: "0027_instant_reply"` and the exact SQL of the file from Step 2.

Post-verify (`execute_sql`):
```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'form_submissions'
      and column_name = 'instant_reply_sent_at') as c_col,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.automations'::regclass and conname = 'automations_recipe_key_check') as check_def,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'form_submissions'
    and indexname = 'form_submissions_instant_reply_sent') as idx,
  (select string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'form_submissions' and grantee = 'authenticated') as client_grants;
```
Expected: `c_col` 1 · `check_def` names all FOUR keys · `idx` 1 · `client_grants` unchanged. Record in the ledger: **MIGRATION 0027 APPLIED — NEVER RE-APPLY.**

- [ ] **Step 7: Run the proofs and see them pass, then the whole db suite ALONE**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t1a.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/c-t1a.txt
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run > /c/Users/danlo/AppData/Local/Temp/claude/c-t1b.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/c-t1b.txt
```
Expected: both `exit=0`; grants file 9 + 4 = **13 passed**; db suite = 213 + 4 = **217**.

- [ ] **Step 8: Commit (the plan document rides along)**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add packages/db/supabase/migrations/0027_instant_reply.sql packages/db/src/test/automations-grants.test.ts docs/superpowers/plans/2026-09-07-automations-milestone-c.md && git commit -q -m "feat(db): 0027 — instant-reply stamp on form_submissions, catalogue +1, cap index; the live client standing pinned

Watched failing first: column [], 23514 on the catalogue, 42703 on the stamp. No grants change:
form_submissions keeps Supabase's default table grants with RLS's member policy as the fence." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 2: The data layer — the parser, the stamp, the cap count, proven on the real database

**Files:**
- Modify: `packages/db/src/automations.ts` (the `RecipeKey` line and its doc; a new section appended at the end of the file)
- Modify: `packages/db/src/index.ts` (the `./automations` export block)
- Modify: `packages/db/src/test/automations.test.ts` (append)

**Interfaces:**
- Consumes: column `form_submissions.instant_reply_sent_at` (Task 1); `createForm(db, accountId, { name, fields }, actorId)` and `createSubmission(db, accountId, formId, { answers })` from `../forms` (existing).
- Produces, all exported from `@bis/db`:
  - `type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply"`
  - `type InstantReplyConfig = { bodyEs: string }`
  - `parseInstantReplyConfig(raw: unknown): InstantReplyConfig | null`
  - `stampInstantReplySent(db: SupabaseClient, submissionId: string): Promise<void>`
  - `countInstantRepliesSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>`
  - `getAutomation(db, accountId, "instant_reply")` — existing, now legal for the new key.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/test/automations.test.ts`. First extend the two import blocks at the top of the file:

```ts
import { createForm, createSubmission } from "../forms";
```
and add to the `from "../automations"` import list:
```ts
  parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
```
Then append at the end of the file:

```ts
describe("instant reply — data layer (Milestone C, the inline recipe)", () => {
  it("parseInstantReplyConfig accepts exactly a string bodyEs; everything else is null", () => {
    // Mutation: return { bodyEs: String(bodyEs) } and the non-string cases pass.
    expect(parseInstantReplyConfig({ bodyEs: "Hola" })).toEqual({ bodyEs: "Hola" });
    expect(parseInstantReplyConfig({ bodyEs: "" })).toEqual({ bodyEs: "" });
    expect(parseInstantReplyConfig({ bodyEs: "Hola", extra: 1 })).toEqual({ bodyEs: "Hola" });
    for (const bad of [null, undefined, "Hola", 7, [], {}, { bodyEs: null }, { bodyEs: 3 }, { bodyEs: ["x"] }]) {
      expect(parseInstantReplyConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("stampInstantReplySent writes the stamp idempotently; countInstantRepliesSince counts only stamps after the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: formId } = await createForm(db, accountId, { name: "Quote", fields: [] }, "user_test");
      const mk = () => createSubmission(db, accountId, formId, { answers: [] });
      const a = await mk(); const b = await mk(); const c = await mk();
      const before = new Date();
      await stampInstantReplySent(db, a.id);
      await stampInstantReplySent(db, a.id);
      await stampInstantReplySent(db, b.id);
      void c;
      const { data } = await db.from("form_submissions").select("id, instant_reply_sent_at")
        .eq("account_id", accountId);
      const rows = data as { id: string; instant_reply_sent_at: string | null }[];
      expect(rows.filter((r) => r.instant_reply_sent_at).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect(rows.find((r) => r.id === c.id)!.instant_reply_sent_at).toBeNull();
      // Mutation: drop `.gte(...)` and the future floor counts 2.
      expect(await countInstantRepliesSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countInstantRepliesSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });

  it("countInstantRepliesSince never counts another account's stamps", async () => {
    // Mutation: drop `.eq("account_id", accountId)` and accountA counts 1.
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { id: formB } = await createForm(db, accountB, { name: "Quote", fields: [] }, "user_test");
        const s = await createSubmission(db, accountB, formB, { answers: [] });
        await stampInstantReplySent(db, s.id);
        const floor = new Date(Date.now() - 60_000).toISOString();
        expect(await countInstantRepliesSince(db, accountB, floor)).toBe(1);
        expect(await countInstantRepliesSince(db, accountA, floor)).toBe(0);
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts -t "instant reply" > /c/Users/danlo/AppData/Local/Temp/claude/c-t2-fail.txt 2>&1; echo "exit=$?"; grep -E "×|✗|FAIL|is not a function|has no exported|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/c-t2-fail.txt | head -8
```
Expected: `exit=1`, three failures naming the three tests (the module has no such exports — vitest reports the missing export or `is not a function`).

- [ ] **Step 3: The `automations.ts` edits**

Change the doc line and the type near the top of `packages/db/src/automations.ts`:

```ts
 * The catalogue is fixed (the CHECK in 0025 + 0026 + 0027 mirrors `RecipeKey`).
 */
export type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply";
```

Append at the END of the file:

```ts
// ---------------------------------------------------------------------------
// Recipe: instant reply to a new web-form lead (Milestone C — INLINE, not cron)
// ---------------------------------------------------------------------------

/**
 * TWO bodies: English lives in `automations.body` — the column every recipe
 * treats as "the text that sends" — and Spanish lives here. The submission's
 * locale picks. No channel (the recipe IS a text), no link, no window: the
 * form action calls the send path the moment a submission lands
 * (apps/web/src/lib/automations/instant-reply.ts), so there is no due-list
 * and no `listEnabled` shape for this recipe — the inline read is
 * `getAutomation(db, accountId, "instant_reply")`, one row.
 */
export type InstantReplyConfig = { bodyEs: string };

/** Same contract as parseReviewRequestConfig: validated on read AND write,
 *  null means "treat as missing". Length is the save action's business
 *  (AUTOMATION_BODY_MAX_LENGTH lives in the web app); this checks shape. */
export function parseInstantReplyConfig(raw: unknown): InstantReplyConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { bodyEs } = raw as Record<string, unknown>;
  if (typeof bodyEs !== "string") return null;
  return { bodyEs };
}

/**
 * SEND-THEN-STAMP, on the SUBMISSION row (0027): one text per submission at
 * most, and the count the daily cap reads. Not the double-text guard — that
 * is the 24h per-thread hold the send path reads through
 * hasRecentOutboundSms — so a missed stamp undercounts by one and re-texts
 * no one, which is why the inline caller does not retry it.
 */
export async function stampInstantReplySent(db: SupabaseClient, submissionId: string): Promise<void> {
  const { error } = await db.from("form_submissions")
    .update({ instant_reply_sent_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (error) throw new Error(`stampInstantReplySent failed: ${error.message}`);
}

/** The daily cap's input (AUTOMATION_DAILY_CAP over DAILY_CAP_WINDOW_MS):
 *  this account's stamps at or after `sinceIso`. Index-only through
 *  form_submissions_instant_reply_sent (0027). */
export async function countInstantRepliesSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("instant_reply_sent_at", sinceIso);
  if (error) throw new Error(`countInstantRepliesSince failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 4: Export from `index.ts`**

In `packages/db/src/index.ts`, the `from "./automations"` export block: after the line `SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,` add

```ts
         parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
```
and after `type DueSmsReminder` (before `} from "./automations";`) add `, type InstantReplyConfig` so the tail reads:
```ts
         type DueSmsReminder, type InstantReplyConfig } from "./automations";
```

- [ ] **Step 5: Run the new tests, then the whole db suite ALONE**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t2a.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/c-t2a.txt
cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t2-tc.txt 2>&1; echo "typecheck exit=$?"
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run > /c/Users/danlo/AppData/Local/Temp/claude/c-t2b.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/c-t2b.txt
```
Expected: all `exit=0`; automations file +3; db suite = 217 + 3 = **220**.

- [ ] **Step 6: Mutation check (record in the commit message)**

Apply each, run `npx vitest run src/test/automations.test.ts -t "instant reply"`, read the FAILED TEST NAME, revert, `git diff --stat` back to the intended change only:
1. In `parseInstantReplyConfig`, replace `if (typeof bodyEs !== "string") return null;` with `return { bodyEs: String(bodyEs) };` → "accepts exactly a string bodyEs" fails.
2. In `countInstantRepliesSince`, delete `.eq("account_id", accountId)` → "never counts another account's stamps" fails.
3. In `countInstantRepliesSince`, delete `.gte("instant_reply_sent_at", sinceIso)` → "counts only stamps after the floor" fails (future floor counts 2).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts && git commit -q -m "feat(db): instant-reply data layer — config parser, submission stamp, per-account cap count

Mutations: String(bodyEs) → parser test; drop account filter → cross-account test; drop floor → count test." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 3: The shared SMS helpers take a narrower context; the lazy SMS getter is defined once

**Files:**
- Modify: `apps/web/src/lib/automations/send-sms.ts` (one type, two signatures; its test file is NOT edited — the proof)
- Modify: `apps/web/src/lib/automations/harness.ts` (extract `lazySmsProvider`)
- Modify: `apps/web/src/lib/automations/harness.test.ts` (one import, two tests appended)

**Interfaces:**
- Produces: `export type SmsSendContext = Pick<PassContext, "db" | "sms">` from `send-sms.ts`; `sendAutomationSms(ctx: SmsSendContext, input: AutomationSmsInput): Promise<SentSms>` and `markAutomationSmsSent(ctx: SmsSendContext, accountId: string, sent: SentSms, what: string): Promise<void>` (bodies unchanged); `export function lazySmsProvider(): () => SmsProvider` from `harness.ts`. Task 5 builds `{ db, sms: lazySmsProvider() }`.
- Every pass keeps passing its full `PassContext` — a full context satisfies the Pick, so `passes/*.ts`, their tests, `send-sms.test.ts`, `sentinel.test.ts` and `route.test.ts` do not change.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/automations/harness.test.ts`, change the import on line 9 to

```ts
import { buildPassContext, runPasses, lazySmsProvider } from "./harness";
```
and append at the end of the file:

```ts
describe("lazySmsProvider — ONE definition of lazy, shared by the cron and the inline recipe", () => {
  it("constructs nothing until called, then once — the second call returns the same provider", () => {
    // Mutation: make it eager (`const sms = getSmsProvider(); return () => sms`).
    smsFactory.getSmsProvider.mockReturnValue({ isFake: true, send: async () => ({ providerMessageId: "s" }) });
    const sms = lazySmsProvider();
    expect(smsFactory.getSmsProvider).not.toHaveBeenCalled();
    const first = sms();
    expect(sms()).toBe(first);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(1);
  });

  it("a throwing factory is retried on the next call rather than cached as a failure", () => {
    smsFactory.getSmsProvider
      .mockImplementationOnce(() => { throw new Error("TELNYX_API_KEY unset"); })
      .mockReturnValue({ isFake: true, send: async () => ({ providerMessageId: "s" }) });
    const sms = lazySmsProvider();
    expect(() => sms()).toThrow("TELNYX_API_KEY unset");
    expect(sms().isFake).toBe(true);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(2);
  });
});
```
(`smsFactory` is the file's existing hoisted mock of `@/lib/sms`, reset in its `beforeEach`.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/harness.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t3-fail.txt 2>&1; echo "exit=$?"; grep -E "×|✗|FAIL|lazySmsProvider|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/c-t3-fail.txt | head -6
```
Expected: `exit=1`; the two new tests fail (`lazySmsProvider is not a function`), every existing test still passes.

- [ ] **Step 3: `harness.ts` — extract the getter**

Replace the existing `buildPassContext` in `apps/web/src/lib/automations/harness.ts` (lines 14–23) with:

```ts
/**
 * The LAZY SMS getter, defined once. `getSmsProvider()` throws in production
 * while TELNYX_API_KEY is unset (by design — no A2P-approved client yet), so
 * nothing constructs it until a send has actually been decided; memoised on
 * the first success, retried on the next call after a throw. buildPassContext
 * hands one to every cron tick; the inline instant reply (instant-reply.ts)
 * takes one for a single form submission. This module is the only one allowed
 * to touch the factory (imports.test.ts), which is why the getter lives here
 * and not beside its inline caller.
 */
export function lazySmsProvider(): () => SmsProvider {
  let sms: SmsProvider | null = null;
  return () => (sms ??= getSmsProvider());
}

export function buildPassContext(
  input: { db: SupabaseClient; now: Date; origin: string },
): PassContext {
  return { ...input, email: getEmailProvider(), sms: lazySmsProvider() };
}
```

- [ ] **Step 4: `send-sms.ts` — the narrower context**

In `apps/web/src/lib/automations/send-sms.ts`, directly after `import type { PassContext } from "./context";` add:

```ts
/**
 * What the two helpers below actually need: the client and the LAZY SMS
 * getter — not the whole cron context. A full PassContext satisfies this
 * (it is a Pick), so every pass keeps handing over `ctx` unchanged; the
 * inline instant reply (instant-reply.ts, Milestone C) builds exactly these
 * two fields and never constructs the email provider it has no use for.
 */
export type SmsSendContext = Pick<PassContext, "db" | "sms">;
```
and change the two signatures — nothing else in either body:
```ts
export async function sendAutomationSms(ctx: SmsSendContext, input: AutomationSmsInput): Promise<SentSms> {
```
```ts
export async function markAutomationSmsSent(
  ctx: SmsSendContext, accountId: string, sent: SentSms, what: string,
): Promise<void> {
```

- [ ] **Step 5: Run the automations tree, the cron route, typecheck, lint — and prove the untouched files are untouched**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/c-t3a.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t3a.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t3-tc.txt 2>&1; echo "typecheck exit=$?"; pnpm --filter web lint > /c/Users/danlo/AppData/Local/Temp/claude/c-t3-lint.txt 2>&1; echo "lint exit=$?"
cd /c/Users/danlo/bis-platform && git status --porcelain apps/web/src/lib/automations apps/web/src/app/api/cron
```
Expected: all `exit=0`; the porcelain lists exactly `send-sms.ts`, `harness.ts`, `harness.test.ts` — `send-sms.test.ts`, `passes/*`, `sentinel.test.ts`, `route.test.ts` are NOT modified (that is the proof the narrowing changed no behaviour).

- [ ] **Step 6: Mutation check, then commit**

Mutation: in `harness.ts` make the getter eager (`const sms = getSmsProvider(); return () => sms;`) → "constructs nothing until called" AND the existing "buildPassContext — the SMS provider is LAZY" both fail by name. Revert.

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add apps/web/src/lib/automations/send-sms.ts apps/web/src/lib/automations/harness.ts apps/web/src/lib/automations/harness.test.ts && git commit -q -m "refactor(automations): SmsSendContext = Pick<PassContext, db | sms>; lazySmsProvider() defined once in the harness

send-sms.test.ts, the five passes and route.test.ts unchanged and green — the proof. Mutation: eager getter → two lazy tests fail." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 4: The copy — four defaults in `messages.ts`, one function, segment counts measured

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (four keys, after `"automations.smsReminder.defaultBody"`)
- Create: `apps/web/src/lib/automations/instant-reply-copy.ts`
- Create: `apps/web/src/lib/automations/instant-reply-copy.test.ts`

**Interfaces:**
- Produces: `defaultInstantReplyBody(brandName: string, language: "en" | "es"): string`. Task 7's card calls it for the prefill. NOTHING at send time calls it.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/automations/instant-reply-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultInstantReplyBody } from "./instant-reply-copy";

// The counts below are MEASURED, not chosen: if a run reports a different
// `chars`, pin the observed number (the textback-body.test.ts rule). The
// claims that must hold are the encoding and the segment count.

describe("defaultInstantReplyBody — English", () => {
  it("names the company and is ONE GSM-7 segment for a GSM-7 name", () => {
    const en = defaultInstantReplyBody("Rio Roofing", "en");
    expect(en).toBe("Hi, this is Rio Roofing. We got your message and will be in touch shortly. Reply here if you'd like to add anything.");
    const s = segmentsFor(en);
    expect(s.encoding).toBe("gsm7");
    expect(s.chars).toBe(116);
    expect(s.segments).toBe(1);
  });

  it("an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    const s = segmentsFor(defaultInstantReplyBody("García Roofing", "en"));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });

  it("a blank or whitespace-only name drops the opening clause instead of inventing one", () => {
    // Mutation: return the template with "" in place of the name → "Hi, this is ."
    const blank = defaultInstantReplyBody("", "en");
    expect(defaultInstantReplyBody("   ", "en")).toBe(blank);
    expect(blank).toBe("We got your message and will be in touch shortly. Reply here if you'd like to add anything.");
    expect(blank).not.toMatch(/\bour team\b/);
    expect(segmentsFor(blank)).toMatchObject({ encoding: "gsm7", segments: 1 });
  });

  it("a company name containing $ patterns is inserted literally", () => {
    // Mutation: plain-string replace → "$&" expands to "{name}".
    expect(defaultInstantReplyBody("Cash $& Carry", "en")).toContain("Cash $& Carry");
    expect(defaultInstantReplyBody("A$'B", "es")).toContain("A$'B");
  });
});

describe("defaultInstantReplyBody — Spanish", () => {
  it("answers a Spanish submission in Spanish, tú form like the receipt email, naming the company", () => {
    const es = defaultInstantReplyBody("Rio Roofing", "es");
    expect(es).toBe("Hola, somos Rio Roofing. Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.");
    expect(es).not.toBe(defaultInstantReplyBody("Rio Roofing", "en"));
  });

  it("costs ONE segment — no á/í/ó/ú anywhere in the Spanish copy, deliberately", () => {
    // Mutation: write "aquí" into the Spanish default → ucs2, 2 segments.
    const s = segmentsFor(defaultInstantReplyBody("Rio Roofing", "es"));
    expect(s.encoding).toBe("gsm7");
    expect(s.chars).toBe(130);
    expect(s.segments).toBe(1);
    expect(defaultInstantReplyBody("", "es")).not.toMatch(/[áíóú]/);
  });

  it("the blank-name variant stands alone as a sentence and stays one segment", () => {
    const blank = defaultInstantReplyBody("", "es");
    expect(blank).toBe("Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.");
    expect(segmentsFor(blank)).toMatchObject({ encoding: "gsm7", segments: 1 });
  });
});

describe("no em dash in any default — it is outside GSM-7 and would double every text", () => {
  it("all four variants", () => {
    for (const [name, lang] of [["Rio Roofing", "en"], ["", "en"], ["Rio Roofing", "es"], ["", "es"]] as const) {
      expect(defaultInstantReplyBody(name, lang)).not.toContain("—");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/instant-reply-copy.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t4-fail.txt 2>&1; echo "exit=$?"; grep -E "Failed to resolve|Cannot find|failed" /c/Users/danlo/AppData/Local/Temp/claude/c-t4-fail.txt | head -3
```
Expected: `exit=1`, the module cannot be resolved.

- [ ] **Step 3: The four keys in `messages.ts`**

In `apps/web/src/lib/messages.ts`, directly after the line
`"automations.smsReminder.defaultBody": "Reply to this text if you need to make a change.",`
insert:

```ts
  // The instant reply to a new web-form lead (Milestone C) — sent the moment
  // a submission with a phone number lands, in the language the form was
  // filled in (the submission's locale), so it matches the receipt email the
  // same person gets in the same minute. TWO defaults per language: `{name}`
  // is the house placeholder, filled with the customer-facing brand name on
  // the settings page ONLY — the send path sends the saved text verbatim and
  // never resolves a name; the NoName variants drop the opening clause rather
  // than invent a noun. Every one of the four is ONE GSM-7 segment for a
  // GSM-7 company name (measured in instant-reply-copy.test.ts). The Spanish
  // is written with no á/í/ó/ú, the text-back's rule (voice.textback.*), and
  // in the tú form the receipt email uses ("Recibimos tu mensaje…"). No em
  // dash anywhere: it is outside GSM-7.
  "automations.instantReply.defaultBodyEn": "Hi, this is {name}. We got your message and will be in touch shortly. Reply here if you'd like to add anything.",
  "automations.instantReply.defaultBodyNoNameEn": "We got your message and will be in touch shortly. Reply here if you'd like to add anything.",
  "automations.instantReply.defaultBodyEs": "Hola, somos {name}. Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.",
  "automations.instantReply.defaultBodyNoNameEs": "Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.",
```

- [ ] **Step 4: The copy module**

Create `apps/web/src/lib/automations/instant-reply-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * What a new web-form lead receives when the operator has not written their
 * own text — the PREFILL on the settings card, and nothing else. The send
 * path (instant-reply.ts) sends the SAVED text verbatim; this function never
 * runs at send time, which is what makes the instant reply the one recipe
 * that cannot leak a name in its send path at all.
 *
 * `brandName` is the CUSTOMER-FACING name (brandDisplayName, page.tsx). A
 * blank one drops the opening clause instead of inventing "our team" — the
 * text-back's rule (voice/textback-body.ts), for the same reason: a text
 * signed by an invented company reads like a machine wrote it.
 *
 * `language` is the form's locale — the language the PERSON filled the form
 * in, the receipt email's own signal — so the text and the email a lead gets
 * in the same minute speak the same language. Both defaults are ONE GSM-7
 * segment for a GSM-7 company name and two for an accented one, measured
 * (not assumed) in instant-reply-copy.test.ts.
 *
 * Function replacement, not a plain string: a company name containing `$&`
 * or `$'` would otherwise be re-interpreted by String.replace.
 */
export function defaultInstantReplyBody(brandName: string, language: "en" | "es"): string {
  if (!brandName.trim()) {
    return language === "es"
      ? m["automations.instantReply.defaultBodyNoNameEs"]
      : m["automations.instantReply.defaultBodyNoNameEn"];
  }
  const template = language === "es"
    ? m["automations.instantReply.defaultBodyEs"]
    : m["automations.instantReply.defaultBodyEn"];
  return template.replace("{name}", () => brandName);
}
```

- [ ] **Step 5: Run, mutate, commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/instant-reply-copy.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t4.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t4.txt
```
Expected: `exit=0`, **8 passed**. If a `chars` assertion is the ONLY failure, pin the observed number and re-run (the claim is the encoding and the segment count).

Mutations (apply, run, read the failed NAME, revert): (1) in the Spanish default write `Responde aquí` → "costs ONE segment" fails (ucs2); (2) replace `() => brandName` with `brandName` → "$ patterns" fails; (3) return the template for a blank name → "drops the opening clause" fails.

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add apps/web/src/lib/messages.ts apps/web/src/lib/automations/instant-reply-copy.ts apps/web/src/lib/automations/instant-reply-copy.test.ts && git commit -q -m "feat(automations): instant-reply defaults — EN/ES, GSM-7 measured, name dropped when blank, never composed at send time

Mutations: 'aquí' → ucs2 test; plain-string replace → \$ test; template on blank → clause test." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 5: The inline module — decide, send, stamp, one outcome; the sentinel and the import guard extended

**Files:**
- Modify: `apps/web/src/lib/automations/caps.ts` (append `INSTANT_REPLY_THREAD_HOLD_MS`)
- Create: `apps/web/src/lib/automations/instant-reply.ts`
- Create: `apps/web/src/lib/automations/instant-reply.test.ts`
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (four mocks, one factory mock, one describe)
- Modify: `apps/web/src/lib/automations/imports.test.ts` (two file names in the reach guard)

**Interfaces:**
- Consumes: `getAutomation`, `parseInstantReplyConfig`, `hasRecentOutboundSms(db, accountId, conversationId, since: Date)`, `countInstantRepliesSince`, `stampInstantReplySent` from `@bis/db` (Task 2 + existing); `resolveSmsSender(db, accountId)` from `@/lib/sms/sender`; `sendAutomationSms(ctx: SmsSendContext, …)`, `markAutomationSmsSent(ctx, accountId, sent, what)`, `type SentSms`, `type SmsSendContext` from `./send-sms`; `lazySmsProvider()` from `./harness` (Task 3); `AUTOMATION_DAILY_CAP`, `DAILY_CAP_WINDOW_MS` from `./caps`.
- Produces, from `instant-reply.ts`:
  ```ts
  export type InstantReplyInput = {
    db: SupabaseClient; now: Date;
    accountId: string; submissionId: string; contactId: string; conversationId: string;
    phoneE164: string | null; locale: "en" | "es"; consentWithheld: boolean;
  };
  export type InstantReplySkip = "noPhone" | "consentWithheld" | "disabled" | "smsGate" | "recentText" | "dailyCap";
  export type InstantReplyOutcome =
    | { kind: "sent"; unstamped: boolean }
    | { kind: "failed"; error: string }
    | { kind: "skipped"; reason: InstantReplySkip; detail?: string };
  export async function sendInstantReply(input: InstantReplyInput): Promise<InstantReplyOutcome>;
  ```
  Task 6 calls `sendInstantReply` once from the form action.

- [ ] **Step 1: The constant**

Append to `apps/web/src/lib/automations/caps.ts`:

```ts
/**
 * The instant reply's per-thread hold (Milestone C, the inline recipe): a
 * new web-form lead is not texted when their thread already carries a
 * non-failed outbound text younger than this. `hasRecentOutboundSms`'s "ANY
 * outbound text counts" semantics — which made it the WRONG store for the
 * cron recipes' cooldown (a noon reminder would have silenced the next
 * morning's review request) — are exactly right here: if the company already
 * texted this person today, a generic "we got your message" is redundant.
 * Its own constant, not SMS_RETRY_COOLDOWN_MS: that one is about a FAILED
 * attempt, this one about a successful send, and they must be free to move
 * apart.
 */
export const INSTANT_REPLY_THREAD_HOLD_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/automations/instant-reply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getAutomation: vi.fn(), hasRecentOutboundSms: vi.fn(), countInstantRepliesSince: vi.fn(),
  stampInstantReplySent: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));
// The factories, mocked exactly as harness.test.ts mocks them: this module
// reaches the SMS provider only through harness.ts's lazySmsProvider
// (imports.test.ts forbids anything else), so the factory is where the
// provider under test comes from.
const smsFactory = vi.hoisted(() => ({ getSmsProvider: vi.fn() }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => smsFactory.getSmsProvider() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }),
}));

import { AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS, INSTANT_REPLY_THREAD_HOLD_MS } from "./caps";
import { sendInstantReply, type InstantReplyInput } from "./instant-reply";

const NOW = new Date("2026-09-10T15:00:00Z");
const smsSend = vi.fn();

function input(overrides: Partial<InstantReplyInput> = {}): InstantReplyInput {
  return {
    db: {} as never, now: NOW, accountId: "acct_1", submissionId: "sub_1", contactId: "ct_1",
    conversationId: "convo_1", phoneE164: "+19565550101", locale: "en", consentWithheld: false,
    ...overrides,
  };
}
const EN = "Hi, this is Rio Roofing. We got your message.";
const ES = "Hola, somos Rio Roofing. Recibimos tu mensaje.";
const ROW = {
  id: "au_ir", account_id: "acct_1", recipe_key: "instant_reply", enabled: true,
  body: EN, config: { bodyEs: ES },
  created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
};
const errors = () => vi.mocked(console.error).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.getAutomation.mockResolvedValue(ROW);
  dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
  dbMocks.countInstantRepliesSince.mockResolvedValue(0);
  dbMocks.stampInstantReplySent.mockResolvedValue(undefined);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  smsFactory.getSmsProvider.mockReset()
    .mockReturnValue({ isFake: true, send: (...a: unknown[]) => smsSend(...a) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendInstantReply — the free checks come before any read", () => {
  it("no parsed phone → noPhone, and nothing is read", async () => {
    // Mutation: read the automation before the phone check.
    expect(await sendInstantReply(input({ phoneE164: null }))).toEqual({ kind: "skipped", reason: "noPhone" });
    expect(dbMocks.getAutomation).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it("a withheld consent box → consentWithheld, nothing read, nothing logged", async () => {
    expect(await sendInstantReply(input({ consentWithheld: true }))).toEqual({ kind: "skipped", reason: "consentWithheld" });
    expect(dbMocks.getAutomation).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });
});

describe("sendInstantReply — the recipe row", () => {
  it("no row, an OFF row, an unparseable config, or a blank body for the locale → disabled; the gate is never consulted", async () => {
    // Mutation: send when the config parser returns null.
    for (const row of [null, { ...ROW, enabled: false }, { ...ROW, config: {} }, { ...ROW, body: "   " }]) {
      dbMocks.getAutomation.mockResolvedValue(row);
      expect((await sendInstantReply(input())).kind, JSON.stringify(row)).toBe("skipped");
      expect((await sendInstantReply(input()) as { reason: string }).reason).toBe("disabled");
    }
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);   // disabled is normal; it would log once per submission otherwise
  });

  it("reads exactly this account's instant_reply row, once", async () => {
    await sendInstantReply(input());
    expect(dbMocks.getAutomation).toHaveBeenCalledTimes(1);
    expect(dbMocks.getAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply");
  });
});

describe("sendInstantReply — the gates", () => {
  it("an account that cannot text → smsGate with the gate's reason, logged; the thread is never read", async () => {
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "smsGate", detail: "a2p_not_approved" });
    expect(dbMocks.hasRecentOutboundSms).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("cannot text (a2p_not_approved)");
  });

  it("a non-failed outbound text in the thread inside the hold → recentText, silent; the hold is measured from `now`", async () => {
    // Mutation: pass `now` instead of now − hold, or read a different thread.
    dbMocks.hasRecentOutboundSms.mockResolvedValue(true);
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "recentText" });
    expect(dbMocks.hasRecentOutboundSms).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "convo_1", new Date(NOW.getTime() - INSTANT_REPLY_THREAD_HOLD_MS));
    expect(dbMocks.countInstantRepliesSince).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it("the daily cap: the 25th stamp inside 24h blocks the 26th text, logged; 24 lets it through", async () => {
    // Mutation: `>` instead of `>=`.
    dbMocks.countInstantRepliesSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "dailyCap" });
    expect(dbMocks.countInstantRepliesSince).toHaveBeenCalledWith(
      expect.anything(), "acct_1", new Date(NOW.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("daily cap");

    dbMocks.countInstantRepliesSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    expect((await sendInstantReply(input())).kind).toBe("sent");
  });
});

describe("sendInstantReply — the send", () => {
  it("English: provider → conversation → message row → send → STAMP → mark sent, the saved body VERBATIM", async () => {
    // Mutation: stamp before the send, or compose a lead around the body.
    expect(await sendInstantReply(input())).toEqual({ kind: "sent", unstamped: false });
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: EN }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: EN });
    expect(dbMocks.stampInstantReplySent).toHaveBeenCalledWith(expect.anything(), "sub_1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(order(smsFactory.getSmsProvider)).toBeLessThan(order(dbMocks.createMessage));
    expect(order(dbMocks.createMessage)).toBeLessThan(order(smsSend));
    expect(order(smsSend)).toBeLessThan(order(dbMocks.stampInstantReplySent));
    expect(order(dbMocks.stampInstantReplySent)).toBeLessThan(order(dbMocks.updateMessageStatus));
    expect(errors()).toEqual([]);
  });

  it("Spanish: the locale picks config.bodyEs, trimmed, and nothing else changes", async () => {
    // Mutation: send `row.body` for every locale.
    dbMocks.getAutomation.mockResolvedValue({ ...ROW, config: { bodyEs: `  ${ES}  ` } });
    expect(await sendInstantReply(input({ locale: "es" }))).toEqual({ kind: "sent", unstamped: false });
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: ES });
  });

  it("a provider failure: the row is marked failed, NOTHING is stamped, the outcome is `failed` with the message, and it does not throw", async () => {
    smsSend.mockRejectedValue(new Error("carrier 503"));
    expect(await sendInstantReply(input())).toEqual({ kind: "failed", error: "carrier 503" });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier 503" }, "automation", "system");
    expect(dbMocks.stampInstantReplySent).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("carrier 503");
  });

  it("a throwing factory (TELNYX_API_KEY unset) is a `failed` outcome with NOTHING written to the inbox", async () => {
    smsFactory.getSmsProvider.mockImplementation(() => { throw new Error("TELNYX_API_KEY unset"); });
    expect(await sendInstantReply(input())).toEqual({ kind: "failed", error: "TELNYX_API_KEY unset" });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a stamp that fails AFTER a successful send: sent + unstamped, logged, the row still marked sent", async () => {
    // Mutation: rethrow the stamp error.
    dbMocks.stampInstantReplySent.mockRejectedValue(new Error("pgrst 503"));
    expect(await sendInstantReply(input())).toEqual({ kind: "sent", unstamped: true });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(errors().join("\n")).toContain("not stamped");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/instant-reply.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t5-fail.txt 2>&1; echo "exit=$?"; grep -E "Failed to resolve|Cannot find|failed" /c/Users/danlo/AppData/Local/Temp/claude/c-t5-fail.txt | head -3
```
Expected: `exit=1`, the module cannot be resolved.

- [ ] **Step 4: The module**

Create `apps/web/src/lib/automations/instant-reply.ts`:

```ts
import {
  getAutomation, parseInstantReplyConfig, hasRecentOutboundSms, countInstantRepliesSince,
  stampInstantReplySent, type SupabaseClient,
} from "@bis/db";
import { resolveSmsSender } from "@/lib/sms/sender";
import { AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS, INSTANT_REPLY_THREAD_HOLD_MS } from "./caps";
import { lazySmsProvider } from "./harness";
import { sendAutomationSms, markAutomationSmsSent, type SentSms, type SmsSendContext } from "./send-sms";

/**
 * Milestone C — the INLINE recipe: a text to a new web-form lead from the
 * company's own number, the moment their submission lands, in the language
 * they filled the form in. Called ONCE per submission by the public form
 * action (f/[publicId]/actions.ts), last, after the staff alert and the
 * receipt email, inside the action's own try/catch. Not a pass: there is no
 * due-list, no tick, no registry entry.
 *
 * ONE outcome per call, never a throw for a business reason. The free checks
 * run before any read; an account with the recipe off pays exactly one
 * indexed read per submission. Then, in order: the A2P gate (the same gate
 * as every send, fails closed) → the 24h per-thread hold (THE double-text
 * guard, new and returning contacts alike; one conversation exists per
 * contact) → the daily cap (25/account/24h, counted on the submission
 * stamp) → the shared write-then-send path → the stamp → mark sent.
 *
 * The body is the SAVED text, sent VERBATIM — nothing composed around it, no
 * name resolved — which is what makes this the one recipe whose send path
 * cannot leak `accounts.name` at all (the sentinel pins it, and
 * InstantReplyInput carries no name for a recipe author to reach).
 *
 * Logging (console.error, the passes' convention): `smsGate`, `dailyCap`,
 * `failed` and an unstamped `sent` — each something an operator or the next
 * session would want to see. `disabled`, `noPhone`, `consentWithheld` and
 * `recentText` are normal and stay silent; `disabled` in particular would
 * otherwise log once per submission for every account without the recipe.
 */
export type InstantReplyInput = {
  db: SupabaseClient;
  /** The submission instant, passed in by the action so the hold and the cap
   *  measure from ONE "now". */
  now: Date;
  accountId: string;
  submissionId: string;
  contactId: string;
  /** The lead's thread — every lead opens one (`enrich`), and one exists per
   *  (account, contact), so a returning contact's second submission lands in
   *  the same thread the hold reads. */
  conversationId: string;
  /** `toE164(rawPhone)`: null when the person typed nothing, or something the
   *  parser could not read. A number stored as typed is NOT textable. */
  phoneE164: string | null;
  /** The submission's normalized locale — the language the person filled the
   *  form in, the receipt email's own signal. Picks the body. */
  locale: "en" | "es";
  /** True when any consent checkbox on the form was left unticked. Required
   *  ones cannot be submitted unticked, so this is an OPTIONAL box a person
   *  deliberately skipped. */
  consentWithheld: boolean;
};

export type InstantReplySkip =
  | "noPhone" | "consentWithheld" | "disabled" | "smsGate" | "recentText" | "dailyCap";

export type InstantReplyOutcome =
  | { kind: "sent"; unstamped: boolean }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: InstantReplySkip; detail?: string };

const WHAT = "instant reply";

export async function sendInstantReply(input: InstantReplyInput): Promise<InstantReplyOutcome> {
  const { db, now, accountId, submissionId } = input;

  // The free checks first — no read for a submission that could never text.
  const to = input.phoneE164;
  if (!to) return { kind: "skipped", reason: "noPhone" };
  if (input.consentWithheld) return { kind: "skipped", reason: "consentWithheld" };

  // ONE indexed read for every account with the recipe off — the whole cost
  // of this feature for a client who never turned it on.
  const row = await getAutomation(db, accountId, "instant_reply");
  if (!row || !row.enabled) return { kind: "skipped", reason: "disabled" };
  const config = parseInstantReplyConfig(row.config);
  if (!config) return { kind: "skipped", reason: "disabled", detail: "invalid config" };
  // Reachable only by a direct database edit — the save action refuses to
  // enable with a blank text — so a guard, not a feature.
  const body = (input.locale === "es" ? config.bodyEs : row.body).trim();
  if (!body) return { kind: "skipped", reason: "disabled", detail: `empty ${input.locale} body` };

  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} cannot text (${gate.reason})`);
    return { kind: "skipped", reason: "smsGate", detail: gate.reason };
  }

  const holdSince = new Date(now.getTime() - INSTANT_REPLY_THREAD_HOLD_MS);
  if (await hasRecentOutboundSms(db, accountId, input.conversationId, holdSince)) {
    return { kind: "skipped", reason: "recentText" };
  }

  const capSince = new Date(now.getTime() - DAILY_CAP_WINDOW_MS).toISOString();
  if (await countInstantRepliesSince(db, accountId, capSince) >= AUTOMATION_DAILY_CAP) {
    console.error(`${WHAT} skipped for submission ${submissionId}: account ${accountId} is at its daily cap (${AUTOMATION_DAILY_CAP}/24h)`);
    return { kind: "skipped", reason: "dailyCap" };
  }

  // The provider comes from the harness's lazy getter and from nowhere else
  // (imports.test.ts): constructed only now, after the send is decided.
  const ctx: SmsSendContext = { db, sms: lazySmsProvider() };
  let sent: SentSms;
  try {
    sent = await sendAutomationSms(ctx, {
      accountId, contactId: input.contactId, to, from: gate.from, body,
      // Nothing retries an instant reply, so there is no attempt marker to write.
      onProviderFailure: async () => {},
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${WHAT} failed for submission ${submissionId}: ${error}`);
    return { kind: "failed", error };
  }

  // SEND-THEN-STAMP, no retry: the per-thread hold is the double-text guard;
  // the stamp is the cap's evidence — a miss undercounts by one and re-texts
  // no one.
  let unstamped = false;
  try {
    await stampInstantReplySent(db, submissionId);
  } catch (e) {
    unstamped = true;
    console.error(`${WHAT}: text sent but submission ${submissionId} not stamped: ${String(e)}`);
  }
  await markAutomationSmsSent(ctx, accountId, sent, WHAT);
  return { kind: "sent", unstamped };
}
```

- [ ] **Step 5: The sentinel — four mocks, the factory, one describe**

In `apps/web/src/lib/automations/sentinel.test.ts`:

(a) Add four entries to the hoisted `dbMocks` object (after `listDueSmsReminders: vi.fn(), stampSmsReminderSent: vi.fn(), stampSmsReminderFailed: vi.fn(),`):
```ts
  getAutomation: vi.fn(), hasRecentOutboundSms: vi.fn(), countInstantRepliesSince: vi.fn(), stampInstantReplySent: vi.fn(),
```

(b) After the existing `vi.mock("@/lib/sms/sender", …)` line add the factory mock (the registered passes never call it — they get `ctx.sms` — so this changes nothing for the existing test):
```ts
// The inline recipe reaches its provider through harness.ts's lazySmsProvider,
// i.e. through this factory; the registered passes get theirs on ctx.
const inlineSmsSend = vi.fn(async () => ({ providerMessageId: "s-inline" }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => ({ isFake: true, send: inlineSmsSend }) }));
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }) }));
```

(c) After `import type { PassContext } from "./context";` add:
```ts
import { sendInstantReply, type InstantReplyInput } from "./instant-reply";
```

(d) Append at the end of the file:
```ts
const INLINE_INPUT: InstantReplyInput = {
  db: {} as never, now: TICK, accountId: "acct_1", submissionId: "sub_1", contactId: "ct_9",
  conversationId: "convo_1", phoneE164: "+19565550109", locale: "en", consentWithheld: false,
};

describe("the sentinel — the inline recipe (instant reply) has no name to leak", () => {
  it("its input type carries no account name at all — a recipe author cannot leak what they cannot reach", () => {
    // Mutation: add `accountName: string` to InstantReplyInput and this compiles.
    // @ts-expect-error — InstantReplyInput has no accountName
    const bad: InstantReplyInput = { ...INLINE_INPUT, accountName: INTERNAL_LABEL };
    void bad;
  });

  it("every argument of the SMS send and the message row is the SAVED body, free of the label", async () => {
    // Mutation: prefix the body with `accounts.name` inside the module — there is no such value to reach.
    dbMocks.getAutomation.mockResolvedValue({
      id: "au_ir", account_id: "acct_1", recipe_key: "instant_reply", enabled: true,
      body: `Hi, this is ${BRAND}. We got your message.`, config: { bodyEs: `Hola, somos ${BRAND}.` },
      created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    });
    dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
    dbMocks.countInstantRepliesSince.mockResolvedValue(0);
    dbMocks.stampInstantReplySent.mockResolvedValue(undefined);
    dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_inline" });
    dbMocks.updateMessageStatus.mockResolvedValue(undefined);
    inlineSmsSend.mockClear();
    dbMocks.createMessage.mockClear();

    expect(await sendInstantReply(INLINE_INPUT)).toEqual({ kind: "sent", unstamped: false });

    const everything = [...inlineSmsSend.mock.calls, ...dbMocks.createMessage.mock.calls]
      .map((args) => JSON.stringify(args)).join("\n");
    expect(inlineSmsSend).toHaveBeenCalledTimes(1);   // guards the fixture: it actually sent
    expect(everything).not.toContain("— trial");
    expect(everything).not.toContain(INTERNAL_LABEL);
    expect(everything).toContain(BRAND);
  });
});
```

- [ ] **Step 6: The import guard reaches the two new files**

In `apps/web/src/lib/automations/imports.test.ts`, extend the `arrayContaining` list in "the scan actually reaches the pass files":
```ts
      ["harness.ts", "context.ts", "registry.ts", "passes/reminders.ts", "passes/followups.ts",
       "passes/review-request.ts", "send-sms.ts", "passes/no-show-nudge.ts", "passes/sms-reminder.ts",
       "instant-reply.ts", "instant-reply-copy.ts"],
```

- [ ] **Step 7: Run the automations tree, the cron route, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/c-t5a.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t5a.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t5-tc.txt 2>&1; echo "typecheck exit=$?"; pnpm --filter web lint > /c/Users/danlo/AppData/Local/Temp/claude/c-t5-lint.txt 2>&1; echo "lint exit=$?"
```
Expected: all `exit=0`; instant-reply.test.ts **13 passed**, sentinel +2, imports guard green with 11 files (the first imports test would name `instant-reply.ts` if it imported a factory — it does not).

- [ ] **Step 8: Mutation check (record in the commit message)**

Apply each, run `npx vitest run src/lib/automations/instant-reply.test.ts src/lib/automations/sentinel.test.ts`, read the failed NAME, revert:
1. Move `const row = await getAutomation(...)` above the phone check → "no parsed phone → noPhone, and nothing is read" fails.
2. Change `>= AUTOMATION_DAILY_CAP` to `>` → "the daily cap" fails (25 lets it through).
3. Pass `now` to `hasRecentOutboundSms` instead of `holdSince` → "measured from `now`" fails.
4. Move the stamp above `sendAutomationSms` → "provider → … → STAMP → mark sent" (order) AND "a provider failure … NOTHING is stamped" fail.
5. Send `row.body` for every locale → "Spanish: the locale picks config.bodyEs" fails.
6. In the module compose `\`${accountId}: ${body}\`` — the only string in reach — the sentinel still passes (nothing to leak); instead add `accountName: string` to `InstantReplyInput` → the `@ts-expect-error` line becomes an unused directive and typecheck fails. Revert.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add apps/web/src/lib/automations/caps.ts apps/web/src/lib/automations/instant-reply.ts apps/web/src/lib/automations/instant-reply.test.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/lib/automations/imports.test.ts && git commit -q -m "feat(automations): the inline instant reply — free checks, one row read, A2P gate, 24h thread hold, daily cap, write-then-send, stamp; sentinel + import guard extended

Mutations: read-before-phone; > for >=; hold from now; stamp-before-send; body for every locale; accountName on the input type." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 6: The seam — the form action calls the module last, after the receipt, and never lets it fail the submission

**Files:**
- Modify: `apps/web/src/app/f/[publicId]/actions.ts` (one import; the `enrich` call at line 236; `enrich`'s signature; two hoisted locals; one assignment after `ensureConversation`; the fourth block after the receipt)
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts` (one hoisted mock + `vi.mock`; one `beforeEach` line; one describe appended)

**Interfaces:**
- Consumes: `sendInstantReply(input: InstantReplyInput)` from `@/lib/automations/instant-reply` (Task 5); `toE164` (existing import); `base.consent` (`[{ key, given, text, at }] | null`, existing).
- Produces: nothing new for later tasks. The behaviour: every accepted submission with a contact and a thread calls the module exactly once, last.

- [ ] **Step 0: Confirm which tests will see the new import (the `@bis/db` factory-mock blast radius)**

```bash
cd /c/Users/danlo/bis-platform/apps/web && grep -rlE "from \"\./actions\"|f/\[publicId\]/actions" src --include=*.test.ts --include=*.test.tsx | xargs grep -lE "submitFormAction" 
```
Expected: exactly `src/app/f/[publicId]/actions.test.ts` and `src/app/f/[publicId]/actions.returning-lead.test.ts`. The first mocks `@bis/db` with a factory and gets the module mock below; the second uses the real database, where the fixture account has no `instant_reply` row (→ `disabled`, one indexed read). Any OTHER file listed must also mock `@/lib/automations/instant-reply` — add the same two lines there before Step 2.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/f/[publicId]/actions.test.ts`:

(a) After the `sendMock` / `vi.mock("@/lib/email", …)` block add:
```ts
const instantReplyMock = vi.fn();
vi.mock("@/lib/automations/instant-reply", () => ({
  sendInstantReply: (...a: unknown[]) => instantReplyMock(...a),
}));
```

(b) In `beforeEach`, after `incrementUnreadCountMock.mockReset();` add:
```ts
  instantReplyMock.mockReset().mockResolvedValue({ kind: "skipped", reason: "disabled" });
```

(c) Append at the end of the file:
```ts
describe("submitFormAction — the instant reply to the person who wrote in (Milestone C)", () => {
  const withPhone = (over: Record<string, unknown> = {}) => formRow({
    fields: [
      { key: "first_name", kind: "core.first_name", label: "Name", required: false },
      { key: "email", kind: "core.email", label: "Email", required: false },
      { key: "phone", kind: "core.phone", label: "Phone", required: false },
    ],
    notify_emails: [],
    ...over,
  });
  const token = () => signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
  const PHONE = "956-555-0101";

  it("runs LAST — after the receipt — with the E.164 phone, the page's locale, the contact, the thread and the consent flag", async () => {
    // Mutation: call it before the receipt, or pass the raw phone.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token(), locale: "es", first_name: "María", email: "customer@example.com", phone: PHONE,
    }));
    expect(result.status).toBe("success");
    expect(instantReplyMock).toHaveBeenCalledTimes(1);
    const arg = instantReplyMock.mock.calls[0]![0];
    expect(arg).toMatchObject({
      accountId: "acct_1", submissionId: "sub_1", contactId: "contact_1", conversationId: "convo_1",
      phoneE164: "+19565550101", locale: "es", consentWithheld: false,
    });
    expect(arg.now).toBeInstanceOf(Date);
    // The receipt is sendMock's only call here (no alert addresses), and the
    // instant reply comes after it.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(instantReplyMock.mock.invocationCallOrder[0]!).toBeGreaterThan(sendMock.mock.invocationCallOrder[0]!);
  });

  it("passes a null phone when the form asked for none", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone({ fields: [
      { key: "email", kind: "core.email", label: "Email", required: false },
    ] }));
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", email: "a@example.com" }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ phoneE164: null, locale: "en" });
  });

  it("reports consentWithheld when an OPTIONAL consent box was left unticked, and false once it is ticked", async () => {
    // Mutation: derive it from `required` instead of `given`.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone({ fields: [
      { key: "phone", kind: "core.phone", label: "Phone", required: false },
      { key: "ok_to_text", kind: "consent", label: "You may text me", required: false },
    ] }));
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ consentWithheld: true });

    instantReplyMock.mockClear();
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE, ok_to_text: "on" }));
    expect(instantReplyMock.mock.calls[0]![0]).toMatchObject({ consentWithheld: false });
  });

  it("a returning contact still qualifies — the thread hold, not `existing`, is the dedupe", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    createContactMock.mockResolvedValue({ id: "contact_1", existing: true });
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock).toHaveBeenCalledTimes(1);
  });

  it("a THROWING instant reply never fails the submission and never writes processing_error", async () => {
    // Mutation: drop the try/catch around the call.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    instantReplyMock.mockRejectedValue(new Error("module exploded"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(result.status).toBe("success");
    expect(setSubmissionProcessingErrorMock).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("is never reached by a spam-rejected or duplicate submission", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    // Honeypot filled.
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE, [HONEYPOT_FIELD]: "bot" }));
    // Rate-limited.
    countRecentSubmissionsMock.mockResolvedValue(RATE_LIMIT_MAX);
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    // Duplicate.
    countRecentSubmissionsMock.mockResolvedValue(0);
    findRecentDuplicateMock.mockResolvedValue({ id: "sub_0" });
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(instantReplyMock).not.toHaveBeenCalled();
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it("is skipped when the contact work failed — no thread, nothing to reply into", async () => {
    // Mutation: call it whenever the submission row exists.
    getPublishedFormByPublicIdMock.mockResolvedValue(withPhone());
    createContactMock.mockRejectedValue(new Error("contacts down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale: "en", phone: PHONE }));
    expect(result.status).toBe("success");
    expect(instantReplyMock).not.toHaveBeenCalled();
    quiet.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/f/[[]publicId]/actions.test.ts" -t "instant reply" > /c/Users/danlo/AppData/Local/Temp/claude/c-t6-fail.txt 2>&1; echo "exit=$?"; grep -E "×|✗|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/c-t6-fail.txt | head -10
```
Expected: `exit=1`, **4 failed · 3 passed**. The four that assert a CALL fail by name — "runs LAST", "null phone", "consentWithheld", "returning contact" — because nothing calls the mock yet; "THROWING", "never reached" and "skipped when the contact work failed" pass vacuously for the same reason. Read the names. (If the bracketed path glob matches nothing, pass the path without the `[[]` escape and confirm vitest reports 1 file — a filter that matches nothing passes silently.)

- [ ] **Step 3: The `actions.ts` edits**

(a) After `import { toE164 } from "@/lib/voice/phone-number";` add:
```ts
import { sendInstantReply } from "@/lib/automations/instant-reply";
```

(b) Replace the `enrich` call (currently `await enrich(db, form, submissionId, answers, base.attribution, originFrom(h), locale);`) with:
```ts
      await enrich(db, form, submissionId, answers, base.attribution, originFrom(h), locale,
        // Any consent box left unticked — an OPTIONAL one, since `validate`
        // above refuses a required one unticked — means no instant text
        // (Milestone C, spec §1). Derived here, where the record is built.
        (base.consent ?? []).some((c) => !c.given));
```

(c) `enrich`'s signature — after the `locale` parameter add one:
```ts
  /** The language the form was submitted in — the receipt's language. */
  locale: "en" | "es",
  /** True when any consent checkbox was left unticked — the instant reply's
   *  "no" (Milestone C, spec §1). */
  consentWithheld: boolean,
): Promise<void> {
```

(d) Directly after `let contactId: string | null = null;` add:
```ts
  // Hoisted for the instant reply below: the thread `enrich` opens and the
  // parsed phone the contact row stored. Both stay null when the contact
  // work failed — there is then no thread to put a text in.
  let conversationId: string | null = null;
  let phoneE164: string | null = null;
```

(e) Inside the enrichment `try`, replace
```ts
    const rawPhone = byKind.get("core.phone") || "";
    const created = await createContact(db, accountId, {
```
with
```ts
    const rawPhone = byKind.get("core.phone") || "";
    phoneE164 = rawPhone ? toE164(rawPhone) : null;
    const created = await createContact(db, accountId, {
```
and, in the same call, replace the `phone:` line
```ts
      phone: rawPhone ? (toE164(rawPhone) ?? rawPhone) : undefined,
```
with
```ts
      phone: rawPhone ? (phoneE164 ?? rawPhone) : undefined,
```
(the comment above it stays; the behaviour is identical — parseable → E.164, unparseable → as typed).

(f) Directly after `const convo = await ensureConversation(db, accountId, contactId, "form", "system");` add:
```ts
    conversationId = convo.id;
```

(g) After the receipt block — i.e. after
```ts
  } catch (e) {
    console.error(`form ${form.id} submission ${submissionId} receipt failed: ${String(e)}`);
  }
```
and BEFORE `if (errors.length > 0) {` — insert:
```ts
  // The instant reply (Milestone C): a text to the person, from the company's
  // own number, in the language of the page — last, after both emails, and
  // independent of them. The module decides (recipe on, phone parsed, consent
  // not withheld, the A2P gate, the 24h per-thread hold, the daily cap),
  // sends write-then-send so a provider failure is a visible failed text in
  // the inbox, and logs every outcome worth seeing. Like the receipt: never
  // `processing_error` (that means "nobody was told about this lead"), never
  // the submitter's result. Skipped outright when the contact work above
  // failed — no thread, nothing to reply into.
  if (contactId && conversationId) {
    try {
      await sendInstantReply({
        db, now: new Date(), accountId, submissionId, contactId, conversationId,
        phoneE164, locale, consentWithheld,
      });
    } catch (e) {
      console.error(`form ${form.id} submission ${submissionId} instant reply crashed: ${String(e)}`);
    }
  }
```

- [ ] **Step 4: Run the action tests (mocked), then the real-database one ALONE, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/f/[[]publicId]/actions.test.ts" > /c/Users/danlo/AppData/Local/Temp/claude/c-t6a.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t6a.txt
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/f/[[]publicId]/actions.returning-lead.test.ts" > /c/Users/danlo/AppData/Local/Temp/claude/c-t6b.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t6b.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t6-tc.txt 2>&1; echo "typecheck exit=$?"; pnpm --filter web lint > /c/Users/danlo/AppData/Local/Temp/claude/c-t6-lint.txt 2>&1; echo "lint exit=$?"
```
Expected: all `exit=0`; `actions.test.ts` 20 + 7 = **27 passed**; the returning-lead file green unchanged (the real fixture account has no `instant_reply` row → `disabled`).

- [ ] **Step 5: Mutation check (record in the commit message)**

Apply each, run `npx vitest run "src/app/f/[[]publicId]/actions.test.ts" -t "instant reply"`, read the failed NAME, revert:
1. Move the new block ABOVE the `receipt(...)` try → "runs LAST" fails (call order).
2. Pass `phoneE164: rawPhone`-equivalent by changing `phoneE164 = rawPhone ? toE164(rawPhone) : null` to `phoneE164 = rawPhone || null` → "runs LAST" fails (`+19565550101` expected).
3. Derive consent from `c.given === true` inverted (`.some((c) => c.given)`) → "consentWithheld" fails.
4. Remove the `try/catch` around `sendInstantReply` → "THROWING" fails.
5. Change the guard to `if (contactId || conversationId)` and set `conversationId = "x"` before the try → "skipped when the contact work failed" fails.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add "apps/web/src/app/f/[publicId]/actions.ts" "apps/web/src/app/f/[publicId]/actions.test.ts" && git commit -q -m "feat(forms): the instant reply fires last from the public form action — after the receipt, its own try/catch, never the submission's result

Mutations: block before the receipt; raw phone; consent inverted; try/catch dropped; guard loosened." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 7: The Automations page — the save action, the fourth card, the page wiring, the end-to-end check

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (thirteen card keys, after `"automations.smsReminder.saveFailed"`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts` (one import; `saveInstantReplyAction`)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/instant-reply-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/page.tsx` (fourth read, fourth card)
- Modify: `.../automations/actions.test.ts` (append), `.../automations/page.test.ts` (mocks + append), `apps/web/e2e/automations.spec.ts` (append)

**Interfaces:**
- Consumes: `upsertAutomation(db, accountId, "instant_reply", { enabled, body, config }, userId)` and `parseInstantReplyConfig` from `@bis/db` (Task 2); `defaultInstantReplyBody` (Task 4); `AUTOMATION_BODY_MAX_LENGTH`; `segmentsFor`; the `SmsGate` type; the page's existing `brandName`/`smsGate` plumbing.
- Produces: `saveInstantReplyAction(accountId: string, formData: FormData): Promise<ActionResult>` reading `enabled`, `body_en`, `body_es`; `InstantReplyCard({ automation, brandName, smsGate, saveAction })`; test ids `instant-reply-card`, `instant-reply-preview-en/-es`, `instant-reply-count-en/-es`; labels "English message" / "Spanish message".

- [ ] **Step 1: Write the failing action tests**

In `.../automations/actions.test.ts`, extend the import to
```ts
import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction, saveInstantReplyAction } from "./actions";
```
and append at the end of the file:

```ts
describe("saveInstantReplyAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "Hi", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + the English text in body + the Spanish text in config.bodyEs, both trimmed", async () => {
    // Mutation: store the Spanish text untrimmed, or in body.
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "  Hi there  ", body_es: " Hola " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply",
      { enabled: true, body: "Hi there", config: { bodyEs: "Hola" } }, "user_1");
  });

  it("turning it on needs BOTH texts — either one blank is refused with copy that says so", async () => {
    // Mutation: require only the English text.
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "Hi", body_es: "   " })))
      .toEqual({ ok: false, error: m["automations.instantReply.bodiesRequired"] });
    expect(await saveInstantReplyAction("acct_1", fd({ enabled: "on", body_en: "", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.instantReply.bodiesRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves an OFF row with blank texts, so the operator can come back to it", async () => {
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "", body_es: "" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply",
      { enabled: false, body: "", config: { bodyEs: "" } }, "user_1");
  });

  it("the cap applies to EITHER text", async () => {
    // Mutation: cap only body_en.
    const long = "x".repeat(AUTOMATION_BODY_MAX_LENGTH + 1);
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: long, body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "Hi", body_es: long })))
      .toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a database failure comes back as a toastable failure", async () => {
    dbMocks.upsertAutomation.mockRejectedValue(new Error("down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveInstantReplyAction("acct_1", fd({ body_en: "Hi", body_es: "Hola" })))
      .toEqual({ ok: false, error: m["automations.instantReply.saveFailed"] });
    quiet.mockRestore();
  });
});
```

- [ ] **Step 2: Write the failing page tests**

In `.../automations/page.test.ts`:

(a) The `./actions` mock gains a line:
```ts
  saveInstantReplyAction: async () => ({ ok: true }),
```
(b) `captured` gains a slot and the card is mocked like the other three:
```ts
const captured = vi.hoisted(() => ({
  review: null as Props | null, noShow: null as Props | null, sms: null as Props | null, instant: null as Props | null,
}));
```
```ts
vi.mock("./instant-reply-card", () => ({
  InstantReplyCard: (props: Props) => { captured.instant = props; return null; },
}));
```
(c) `ROWS` gains:
```ts
  instant_reply: { ...base, id: "au4", recipe_key: "instant_reply", enabled: false, body: "Hi", config: { bodyEs: "Hola" } },
```
(d) `render()` resets the new slot too:
```ts
  captured.review = captured.noShow = captured.sms = captured.instant = null;
```
(e) Append inside the `describe("automations page", …)` block (before its closing `});`):
```ts
  it("hands the instant-reply card ITS OWN row, the customer-facing name for its defaults, and the SMS gate", async () => {
    // Mutation: hand it the review row, or accounts.name.
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.instant!.automation).toEqual(ROWS.instant_reply);
    expect(c.instant!.brandName).toBe("Rio Roofing");
    expect(c.instant!.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
    expect(dbMock.getAutomation).toHaveBeenCalledWith(expect.anything(), "a1", "instant_reply");
  });
```
and inside `describe("automations page — no calendar yet", …)`:
```ts
  it("the instant-reply card renders too — it has no calendar to depend on", async () => {
    dbMock.getCalendarForAccount.mockResolvedValue(null);
    const c = await render();
    expect(c.instant).not.toBeNull();
  });
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[[]accountId]/automations" > /c/Users/danlo/AppData/Local/Temp/claude/c-t7-fail.txt 2>&1; echo "exit=$?"; grep -E "×|✗|passed|failed|is not a function|Failed to resolve" /c/Users/danlo/AppData/Local/Temp/claude/c-t7-fail.txt | head -12
```
Expected: `exit=1`; the six new action tests fail (`saveInstantReplyAction is not a function`); the page file fails to load (`./instant-reply-card` cannot be resolved). Confirm vitest reports 2 files.

- [ ] **Step 4: The card's copy in `messages.ts`**

Directly after `"automations.smsReminder.saveFailed": "Could not save text reminders.",` insert:

```ts
  "automations.instantReply.title": "Instant reply to new leads",
  "automations.instantReply.body": "The moment someone submits one of your forms with a phone number, text them from your number in the language they used, on top of the email receipt they already get. Off until you turn it on, and only for companies whose A2P registration is approved.",
  "automations.instantReply.enabled": "Send an instant reply",
  "automations.instantReply.messageEn": "English message",
  "automations.instantReply.messageEnHint": "Sent to people who filled the form in English. Sent exactly as written.",
  "automations.instantReply.messageEs": "Spanish message",
  "automations.instantReply.messageEsHint": "Sent to people who filled the form in Spanish. Sent exactly as written.",
  "automations.instantReply.previewEn": "English preview",
  "automations.instantReply.previewEs": "Spanish preview",
  "automations.instantReply.save": "Save instant reply",
  "automations.instantReply.saved": "Instant reply saved",
  "automations.instantReply.saveFailed": "Could not save the instant reply.",
  "automations.instantReply.bodiesRequired": "Write both the English and the Spanish message before turning this on.",
```

- [ ] **Step 5: The save action**

In `.../automations/actions.ts`, extend the `@bis/db` import:
```ts
import {
  serviceDb, upsertAutomation, parseReviewRequestConfig, parseNoShowNudgeConfig, parseInstantReplyConfig,
  type ReviewRequestChannel,
} from "@bis/db";
```
and append at the end of the file:

```ts
export async function saveInstantReplyAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  // Trimmed on write: the send path trims before sending, and the preview
  // must show the string that sends. English rides in `body`, the column
  // every recipe treats as "the text that sends"; Spanish in config.bodyEs.
  const bodyEn = String(formData.get("body_en") ?? "").trim();
  const bodyEs = String(formData.get("body_es") ?? "").trim();
  if (bodyEn.length > AUTOMATION_BODY_MAX_LENGTH || bodyEs.length > AUTOMATION_BODY_MAX_LENGTH) {
    return { ok: false, error: m["automations.bodyTooLong"] };
  }
  // No empty-means-default for this recipe: the send path sends the saved
  // text VERBATIM, so enabling with a blank text would text a blank.
  if (enabled && (!bodyEn || !bodyEs)) return { ok: false, error: m["automations.instantReply.bodiesRequired"] };

  // The send path's own parser, on write — the review request's discipline.
  const config = parseInstantReplyConfig({ bodyEs });
  if (!config) return { ok: false, error: m["automations.instantReply.saveFailed"] };

  try {
    await upsertAutomation(serviceDb(), accountId, "instant_reply", { enabled, body: bodyEn, config }, userId);
  } catch (e) {
    console.error(`saveInstantReplyAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.instantReply.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
```

- [ ] **Step 6: The card**

Create `.../automations/instant-reply-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor, type SmsSegments } from "@/lib/sms/segments";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { defaultInstantReplyBody } from "@/lib/automations/instant-reply-copy";
import type { ActionResult } from "./actions";

/**
 * What the two textareas start with. NO row yet → the defaults, so the first
 * visit shows a real, sendable message per language. A stored row → exactly
 * what it stores, read leniently (an odd stored config must be SHOWN so the
 * operator can fix it, not hidden by the parser the send path refuses it
 * with — automations-settings.tsx's formDefaults precedent). There is no
 * empty-means-default here: the send path sends the saved text VERBATIM and
 * the action refuses to enable with a blank, so the preview never shows a
 * string that would not send.
 */
function storedBodies(row: AutomationRow | null, brandName: string): { en: string; es: string } {
  if (!row) return { en: defaultInstantReplyBody(brandName, "en"), es: defaultInstantReplyBody(brandName, "es") };
  const cfg = row.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return { en: row.body ?? "", es: typeof cfg.bodyEs === "string" ? cfg.bodyEs : "" };
}

function countText(p: SmsSegments): string {
  return m["compose.smsSegments"].replace("{chars}", String(p.chars)).replace("{segments}", String(p.segments));
}

export function InstantReplyCard({
  automation, brandName, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx) — only the
   *  DEFAULTS use it; a send carries the saved text, never a name. */
  brandName: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = storedBodies(automation, brandName);
  // Controlled, so the counters recompute on every keystroke — the
  // message-composer / voice-settings precedent.
  const [bodyEn, setBodyEn] = useState(stored.en);
  const [bodyEs, setBodyEs] = useState(stored.es);

  // THE PREVIEW IS THE STRING THAT SENDS: the trimmed text, nothing composed
  // around it (the send path trims and sends it verbatim), counted by the
  // same counter every SMS surface uses.
  const previewEn = bodyEn.trim();
  const previewEs = bodyEs.trim();

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.instantReply.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="instant-reply-card">
      <CardHeader>
        <CardTitle>{m["automations.instantReply.title"]}</CardTitle>
        <CardDescription>{m["automations.instantReply.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="instant-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="instant-enabled">{m["automations.instantReply.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            // Text only: the reason a reply would be skipped, up front.
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="instant-body-en">{m["automations.instantReply.messageEn"]}</Label>
            <Textarea
              id="instant-body-en" name="body_en" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.instantReply.messageEnHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instant-preview-en">{m["automations.instantReply.previewEn"]}</Label>
            <output id="instant-preview-en" className="block rounded-md border border-input px-3 py-2 text-sm" data-testid="instant-reply-preview-en">{previewEn}</output>
            <p className="text-xs text-muted-foreground" data-testid="instant-reply-count-en">{countText(segmentsFor(previewEn))}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="instant-body-es">{m["automations.instantReply.messageEs"]}</Label>
            <Textarea
              id="instant-body-es" name="body_es" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={bodyEs}
              onChange={(e) => setBodyEs(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.instantReply.messageEsHint"]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instant-preview-es">{m["automations.instantReply.previewEs"]}</Label>
            <output id="instant-preview-es" className="block rounded-md border border-input px-3 py-2 text-sm" data-testid="instant-reply-preview-es">{previewEs}</output>
            <p className="text-xs text-muted-foreground" data-testid="instant-reply-count-es">{countText(segmentsFor(previewEs))}</p>
          </div>

          <SubmitButton pending={pending}>{m["automations.instantReply.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```
(`SmsSegments` is exported from `@/lib/sms/segments`; if the type import trips lint, replace `SmsSegments` with `ReturnType<typeof segmentsFor>`.)

- [ ] **Step 7: The page**

In `.../automations/page.tsx`:

(a) Imports — add the card and the action:
```ts
import { SmsReminderCard } from "./sms-reminder-card";
import { InstantReplyCard } from "./instant-reply-card";
import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction, saveInstantReplyAction } from "./actions";
```
(b) The `Promise.all` — a fourth row read, and the destructuring to match:
```ts
  const [review, noShow, smsReminder, instantReply, account, smsGate, calendar, origin] = await Promise.all([
    getAutomation(db, accountId, "review_request"),
    getAutomation(db, accountId, "no_show_nudge"),
    getAutomation(db, accountId, "sms_reminder"),
    getAutomation(db, accountId, "instant_reply"),
```
(everything else in the array unchanged).
(c) After the `<SmsReminderCard … />` element add:
```tsx
        <InstantReplyCard
          automation={instantReply}
          brandName={account.brandName}
          smsGate={smsGate}
          saveAction={saveInstantReplyAction.bind(null, accountId)}
        />
```

- [ ] **Step 8: Run the page and action tests, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[[]accountId]/automations" > /c/Users/danlo/AppData/Local/Temp/claude/c-t7a.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/c-t7a.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck > /c/Users/danlo/AppData/Local/Temp/claude/c-t7-tc.txt 2>&1; echo "typecheck exit=$?"; pnpm --filter web lint > /c/Users/danlo/AppData/Local/Temp/claude/c-t7-lint.txt 2>&1; echo "lint exit=$?"
```
Expected: all `exit=0`; actions file +6, page file +2.

- [ ] **Step 9: The end-to-end check — the card, both previews, never saved**

Append to `apps/web/e2e/automations.spec.ts`:

```ts
test.describe("the Automations page — Milestone C card", () => {
  test("the instant-reply card previews both texts verbatim, each one segment, and the counter follows the text", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);

    const card = page.getByTestId("instant-reply-card");
    await expect(card.getByText("Instant reply to new leads", { exact: true })).toBeVisible();
    await expect(card.getByTestId("instant-reply-preview-en")).toContainText("We got your message");
    await expect(card.getByTestId("instant-reply-count-en")).toContainText("1 message(s)");
    await expect(card.getByTestId("instant-reply-preview-es")).toContainText("Recibimos tu mensaje");
    await expect(card.getByTestId("instant-reply-count-es")).toContainText("1 message(s)");

    // Typing redraws the preview and the counter — the counter counts the
    // string that sends, nothing composed around it.
    await card.getByLabel("English message").fill("Got it, thanks!");
    await expect(card.getByTestId("instant-reply-preview-en")).toHaveText("Got it, thanks!");
    await expect(card.getByTestId("instant-reply-count-en")).toContainText("15 characters");
    // Nothing is saved — the form is never submitted. e2e shares the
    // production database; this recipe must NEVER be enabled here.
  });
});
```

Run it ALONE first (the house rule for a red e2e is "alone, judged by wall clock"):
```bash
cd /c/Users/danlo/bis-platform && pnpm --filter web test:e2e -- e2e/automations.spec.ts > /c/Users/danlo/AppData/Local/Temp/claude/c-t7-e2e.txt 2>&1; echo "e2e exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/c-t7-e2e.txt
```
Expected: `exit=0`, the automations spec's 7 + 1 = **8 passed** (the B ledger recorded 7 for this file). If the fixture account's brand name is accented, the counts read `2 message(s)` — that is the copy test's documented case, not a defect; pin the observed value and note it in the ledger.

- [ ] **Step 10: Mutation check, then commit**

Apply each, run the two unit files, read the failed NAME, revert:
1. In the action, require only `bodyEn` when enabling → "needs BOTH texts" fails.
2. In the action, store `config: { bodyEs: String(formData.get("body_es") ?? "") }` (untrimmed) → "both trimmed" fails.
3. In `page.tsx`, hand the card `review` instead of `instantReply` → "ITS OWN row" fails.
4. In the card, render `defaultInstantReplyBody(brandName, "en")` in the preview instead of `previewEn` → the e2e "the counter follows the text" fails (`toHaveText("Got it, thanks!")`).

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git add apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/instant-reply-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/page.test.ts" apps/web/e2e/automations.spec.ts && git commit -q -m "feat(automations): Instant reply card — English and Spanish texts, each previewed verbatim with its segment count; both required to enable; capped

Mutations: EN-only requirement; untrimmed ES; wrong row to the card; default in the preview." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 8: Gates on the whole tree, the eyeball, the ledger, the review, the PR — no merge

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored ledger — append)
- No source changes unless a gate fails.

- [ ] **Step 1: The three gates, uncontended, exit codes read from `$?`**

Nothing else may be running against this repo (a parallel `next dev`, another vitest run) — contended suites go red on wall clock, not behaviour. Fetch first: `origin/main` moves during long gates; if it has, merge it INTO the branch and re-run every gate on the combined tree.

```bash
cd /c/Users/danlo/bis-platform && git fetch origin && git log --oneline feat/automations-c..origin/main | head -5; echo "commits-on-main-not-in-branch-above (expect none; if any: git merge origin/main, resolve, re-run ALL gates)"
cd /c/Users/danlo/bis-platform && pnpm check > /c/Users/danlo/AppData/Local/Temp/claude/gate-c-check.txt 2>&1; echo "check exit=$?"; grep -E "Tests +[0-9]+ passed|Test Files" /c/Users/danlo/AppData/Local/Temp/claude/gate-c-check.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web build > /c/Users/danlo/AppData/Local/Temp/claude/gate-c-build.txt 2>&1; echo "build exit=$?"
cd /c/Users/danlo/bis-platform && pnpm --filter web test:e2e > /c/Users/danlo/AppData/Local/Temp/claude/gate-c-e2e.txt 2>&1; echo "e2e exit=$?"; tail -8 /c/Users/danlo/AppData/Local/Temp/claude/gate-c-e2e.txt
```
Expected: all three `exit=0`. Unit counts at least: db 213 + 4 (Task 1) + 3 (Task 2) = **220**; web 1329 + 2 (harness) + 8 (copy) + 13 (module) + 2 (sentinel) + 7 (form action) + 6 (save action) + 2 (page) = **1369**; e2e **72/72** (71 + 1). Record the ACTUAL numbers; a shortfall means a test was not written. Any red: re-run that spec ALONE first and judge by wall clock before believing it (`shell.spec.ts`'s sidebar-collapse test is the current flake; one re-run is fine).

- [ ] **Step 2: The things no gate covers — eyeball them, and say so in the ledger**

Start the built app locally (`pnpm --filter web start` after the build above; kill only YOUR `next start` PID afterwards, never danlo's node processes) and open the Automations page for a test account: the fourth card renders after Text reminders; both textareas are prefilled with the defaults naming the company; each preview is the textarea's text and each counter reads `1 message(s)`; typing in one textarea moves only its own preview and counter; the A2P notice shows for an unapproved account. Then the seam, on a THROWAWAY test account only (never Test Client One, never a real client): with the recipe OFF, submit its public form once and confirm the server log shows NO instant-reply line (one silent indexed read); enable the recipe for that account with both defaults saved, submit again with a phone, and confirm ONE log line `instant reply skipped for submission …: account … cannot text (a2p_not_approved)`; then set the row back to OFF (or delete it) and confirm. Record what was seen. Stated residuals: a member of an account can UPDATE their own submissions' stamp (Decision 1); the prefilled defaults inherit `brandDisplayName`'s `accounts.name` fallback exactly as the other three cards do (the open Decision 2 from Milestone B's review, its own PR); a real text to a real lead cannot be exercised until an account is A2P-approved and `TELNYX_API_KEY` is set.

- [ ] **Step 3: Ledger entry**

Append to `.superpowers/sdd/progress.md`:

```
## === AUTOMATIONS MILESTONE C (instant reply) on branch feat/automations-c, base 2293b74 ===
MIGRATION 0027 APPLIED TO PROD (tlbkbmlrfafquucsmsmm) <date> -- NEVER RE-APPLY.
  Pre-flight: 0026 latest, column absent, check = automations_recipe_key_check (3 keys),
  client grants on form_submissions = DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE.
  Post-verified: column 1, check names 4 keys, index 1, client grants UNCHANGED (no grants in 0027;
  RLS member policy is the fence — pinned in automations-grants.test.ts).
Tasks 1-7 committed (<first sha>..<last sha>). send-sms.test.ts, passes/*, route.test.ts: untouched
(verified with git status --porcelain); harness.test.ts: additions only.
GATES on the branch: check <exit> (db <n> . web <n>) . build <exit> . e2e <n>/<n>.
MUTATION PASS: <list each mutation and the test that failed>.
EYEBALLED: <the fourth card, two previews + two counters, the A2P notice; the seam on a throwaway
account: silent with the recipe off, ONE a2p_not_approved line with it on; row reset to off>.
INERT ON DEPLOY: no account has an enabled instant_reply row; in production every send would stop
at the A2P gate anyway (no approved client, TELNYX_API_KEY unset). The form action does one extra
indexed read per accepted submission with a phone.
DECISIONS MADE WHERE THE SPEC WAS SILENT (plan header): no grant changes, live standing pinned;
INSTANT_REPLY_THREAD_HOLD_MS its own constant; blank locale body = disabled; defaults only when no
row; now = new Date() at the seam; logging inside the module; sentinel describe not a new file.
STILL OPEN FOR DANLO (from B's review): the text reminder's single attempt; brandDisplayName's
accounts.name fallback (recommended: its own small PR).
▶ NEXT: review -> fix waves re-reviewed -> PR -> CI green on the head -> danlo merges -> verify the
deploy (build log names the commit) -> smoke / 200 . cron 401 -> nothing else to watch: the recipe
is inline and off.
```

- [ ] **Step 4: Request review — do NOT merge**

Invoke `superpowers:requesting-code-review` against the branch's full diff (`git diff main...feat/automations-c`). Highest-consequence claims for the reviewer to verify independently (numbered, so the report can be checked claim by claim): (1) the recipe fires ONLY from the public form action, last, after the receipt, inside its own try/catch, and every spam-rejected path and a failed enrichment never reach it; (2) the send path composes nothing and reads no account name — `InstantReplyInput` has no name field (`@ts-expect-error` pinned) and the sentinel scans the send; (3) the five cron passes, `send-sms.test.ts`, `harness.test.ts`'s existing tests and `route.test.ts` are unchanged and green — the `Pick` narrowing and the `lazySmsProvider` extraction changed no behaviour; (4) the hold reads `hasRecentOutboundSms` with `now − 24h` on the lead's own thread and the cap counts the stamp with `now − 24h`, both from the ONE `now` the action passed; (5) no module under `lib/automations` except the harness imports a provider factory (`imports.test.ts` now reaches 11 files); (6) migration 0027 changed no grants, the pinned standing matches the live project, and a client's cross-tenant stamp reaches zero rows under RLS; (7) the card's previews are the verbatim strings, enabling requires both texts, each is capped at 1000, and the e2e never submits the form; (8) `SUBMISSION_COLS` is unchanged, so the dashboard never reads the stamp. Fix waves are re-reviewed; fixes introduce defects.

- [ ] **Step 5: Open the PR, wait for CI on its head, hand it to danlo**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-c" ] && git push -u origin feat/automations-c 2>&1 | tail -2 || echo "BRANCH MOVED TO $B"
```
Then create the PR (the REST API if `gh pr create` hits the GraphQL rate limit, as it did on 2026-09-06):
```bash
cd /c/Users/danlo/bis-platform && gh pr create --base main --head feat/automations-c --title "Automations Milestone C: instant reply to new web-form leads" --body-file /c/Users/danlo/AppData/Local/Temp/claude/pr-body-c.md 2>&1 | tail -2
```
where `pr-body-c.md` carries the ledger's gates line, the migration note, the seven plan decisions, the two still-open B decisions, and ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01CR9FFbMZBVwxnwtTfzHhYT
```
Read the check runs on the PR's head (`gh api repos/dlopez2392/bis-platform/commits/<head sha>/check-runs`) — both `verify` and `e2e` must be `success` on THAT sha. A red `e2e` with no plausible cause is re-run once (`gh run rerun <run id> --failed`); a second red is investigated, not re-run. **Merging is danlo's call** ("no autonomous merges"); when he says go, `gh api -X PUT repos/dlopez2392/bis-platform/pulls/<n>/merge -f merge_method=merge`, then verify the production deployment's build log names the merge commit and smoke `/` (200), `/api/cron/reminders` (401), `/b/bogus` (404). There is no tick to watch for this milestone: the recipe is inline and off.

---

## Plan self-review (done at authoring time, 2026-09-07)

**Spec coverage.** Spec §1 (scope = the web-form lead's text; the eight trigger conditions in order; last after both emails; never `processing_error`; one attempt) → Task 5 (the module's order: free checks, row, gate, hold, cap, send, stamp) and Task 6 (the seam after the receipt, the guard on contact + thread, the consent flag, the try/catch, the spam-path proofs). §2 (migration 0027: stamp column, catalogue key, partial index, no grants with the standing pinned; the parser, the single-account read, the stamp, the count; `SUBMISSION_COLS` unchanged) → Tasks 1 and 2 — with Decision 1 recording that the live standing is Supabase's default table grants under RLS, not a revoke. §3 (the module's exported shape and outcomes, the free-checks-first order, the `SmsSendContext` narrowing, `lazySmsProvider`, the action's block, which outcomes log, no retry on the stamp) → Tasks 3, 5, 6; the spec's `logInstantReplyOutcome` helper became logging inside the module (Decision 6) — same lines, one fewer export. §4 (the four defaults with the GSM-7 rules and tú form, `defaultInstantReplyBody`, the measured counts including the accented name, the card's title/description/controls/ids, both texts required, the cap, the parser on write) → Tasks 4 and 7. §5 (every test named in the spec: module, sentinel with the `@ts-expect-error` pin, form action incl. the returning lead and the module-level mock, copy, save action and page, real-database parser/stamp/count and the grants pin under `withRollback` + `actAs`, the e2e that never enables, the gates against the 2293b74 baseline) → Tasks 1–8. "Decisions taken in this pass" → the Global Constraints (scope, trigger, two bodies, seam, cap, one attempt, storage). The two open B decisions are carried in the ledger and the PR body, not built.

**Placeholders.** None: every step carries its code, every command its expected output, every migration step its pre-flight and post-verify SQL with expected values read from the live project on 2026-09-07. The seven plan decisions are listed in the header for danlo to overrule before execution.

**Type consistency.** `RecipeKey` includes `"instant_reply"` (Task 2) and Tasks 5 and 7 pass exactly that string; `InstantReplyConfig = { bodyEs: string }` and `parseInstantReplyConfig(raw): InstantReplyConfig | null` in Tasks 2, 5, 7; `stampInstantReplySent(db, submissionId)` and `countInstantRepliesSince(db, accountId, sinceIso)` in Tasks 2 and 5 with the Task 5 test asserting `sinceIso` as an ISO string and the hold's `since` as a `Date` (matching `hasRecentOutboundSms(db, accountId, conversationId, since: Date)`); `SmsSendContext = Pick<PassContext, "db" | "sms">` in Task 3 and the object literal `{ db, sms: lazySmsProvider() }` in Task 5; `sendAutomationSms(ctx, { accountId, contactId, to, from, body, onProviderFailure })` → `SentSms` and `markAutomationSmsSent(ctx, accountId, sent, what)` unchanged from B in Task 5; `lazySmsProvider(): () => SmsProvider` in Tasks 3 and 5; `InstantReplyInput`'s nine fields are identical in the module, its test's `input()` helper, the sentinel's `INLINE_INPUT`, and the action's call in Task 6 (`db, now, accountId, submissionId, contactId, conversationId, phoneE164, locale, consentWithheld`); `InstantReplyOutcome` shapes asserted in Task 5 match the module's returns key-for-key (`detail` present only on `smsGate` and the two `disabled` variants); `defaultInstantReplyBody(brandName, language)` in Tasks 4 and 7; `saveInstantReplyAction(accountId, formData)` reads `enabled`, `body_en`, `body_es` — the card's `name` attributes — and writes `{ enabled, body: bodyEn, config: { bodyEs } }`, which is what the Task 7 tests assert; the page hands `InstantReplyCard` `{ automation, brandName, smsGate, saveAction }`, which is what the page test captures; the e2e's labels ("English message") and test ids (`instant-reply-card`, `instant-reply-preview-en/-es`, `instant-reply-count-en/-es`) are the card's.

**Departures from the spec's letter, each explained where it happens.** (1) No grants change and no refusal-SQLSTATE pin — the live standing has no refusal to pin; the cross-tenant fence is RLS's zero rows (Decision 1, Task 1). (2) Logging inside the module rather than a separate `logInstantReplyOutcome` export (Decision 6). (3) The sentinel is extended with a describe instead of a new file (Decision 7).

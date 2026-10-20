# Sofía says she is an AI, PR S-47a (F-034, decision 20, migration 0093): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner, 2026-10-19, binding; spec §9): read each task's tier before dispatching it.

**Goal:** an agency-only, per-account setting (Off / Trial / On) decides whether Sofía says, right after the operator's greeting and in that greeting's language, that she is an AI assistant and that the call is transcribed. On Trial a fair coin decides per call. Every Trial or On call is stamped `calls.disclosed`. The website chat is labelled AI (header and first message) on Trial or On. An agency-only card on the Voice page compares the two halves without declaring a winner.

**Architecture:**
- Migration 0093 adds `voice_profiles.disclosure` (text, NOT NULL, default `'off'`, CHECK) and `calls.disclosed` (boolean, nullable). No grant, no policy: both tables are already server-written only (0019/0020/0053).
- `@bis/db`: the row type and `PROFILE_COLS` gain `disclosure`; `startCallRow` writes `disclosed` when given; `getDisclosureResults` reads the card's counts with head counts.
- Web: `lib/voice/disclosure.ts` decides per call (`crypto.randomInt`); `openingGreeting` appends the spoken sentence; `buildSystemPrompt` swaps the IDENTITY line; the incoming route wires both and stamps on the row it already writes; the chat page and turn route read the same setting; the Voice page gets the three-way choice inside the profile form (its own Save) and the results card under it.

**Tech stack:** Next.js App Router (server components, server actions), Supabase Postgres + PostgREST, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-disclosure-design.md` at `09684fea`. D1–D4 are owner-approved and not reopened. Every file:line below was read at `09684fea` (= `main` `aeb01371` + the spec).

**Base:** `feat/s47a-disclosure` at `09684fea`.
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s47a` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s47a`).
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally.
- `<KIT8C>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/ec121ebe-7e97-4a98-9a73-44be5c530909/scratchpad/s15e-kit` (`replica.sh`, `pgrst.sh`; read 2026-10-20).

Path abbreviations:
- `…/voice/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/`
- `…/c/` = `apps/web/src/app/c/[publicId]/`
- `…/turn/` = `apps/web/src/app/api/concierge/[publicId]/turn/`
- `…/incoming/` = `apps/web/src/app/api/voice/incoming/`
- `…/styleguide/` = `apps/web/src/app/(dashboard)/dashboard/styleguide/`

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | Pre-reads, digest, A-checks (orchestrator) | — | orchestrator | — |
| 1 | Migration 0093 and its proof | **HIGH** | bis-db-schema (opus) | opus bis-reviewer with mutation probes on the replica; re-review on any change; orchestrator applies once |
| 2 | Every new key, English and Spanish | LOW | bis-crm | none |
| 3 | The spoken sentence (`openingGreeting`) and the IDENTITY swap (`buildSystemPrompt`) | MEDIUM | bis-voice | one sonnet review |
| 4 | `@bis/db` row/cols/stamp; `decideDisclosure`; the incoming route resolves and stamps; every `VoiceProfileRow` literal | MEDIUM | bis-voice | one sonnet review |
| 5 | The website chat: label, first message, chat prompt line | LOW | bis-voice | none |
| 6 | `getDisclosureResults` and the pure results view | LOW | bis-voice | none |
| 7 | The Voice page: the three-way setting, the action, the results card, styleguide, i18n baselines | LOW | bis-frontend | none |
| 8 | The e2e spec | LOW | bis-e2e-qa | none |
| 9 | Whole-branch final review, design review, ONE fix agent | — | bis-reviewer (opus), bis-design-reviewer (opus), one fixer | checkpoint |
| 10 | Rollout | — | orchestrator | — |

**Why Task 4 is MEDIUM, not HIGH (spec §9):** the stamp rides the insert the route already makes fail-open (`…/incoming/route.ts:1088-1097`), so a failed insert still leaves the call answered, exactly as today. Task 4's reviewer must PROVE it: with `startCallRow` rejecting, the call is still accepted with the decided greeting and prompt, and the log line carries ids and the error class only. If it does not hold, the orchestrator re-tiers the fix HIGH.

**Order (waves; tasks in one wave share no file):**
- **Wave A** (parallel): Tasks 1, 2, 3.
  - Task 1: `packages/db/supabase/migrations/0093_ai_disclosure.sql`, `packages/db/src/test/ai-disclosure-schema.test.ts`.
  - Task 2: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.test.ts`.
  - Task 3: `apps/web/src/lib/voice/{greeting,system-prompt,session-config}.ts` (+ the two tests), and ONE line of `…/incoming/route.ts` (`:1118`).
- **Wave B:** Task 4, after Tasks 1 (0093 on its replica) and 3 (`route.ts`).
- **Wave C** (parallel, after Task 4; Task 5 also after Task 2):
  - Task 5: `…/c/{page.tsx,concierge-chat.tsx,concierge.css}` and tests, `…/turn/route.ts` and test.
  - Task 6: `packages/db/src/voice.ts` (one new function), `packages/db/src/test/disclosure-results.test.ts`, `apps/web/src/lib/voice/disclosure-results.ts` (+ test).
- **Wave D:** Task 7 (after Tasks 2, 5, 6), then Task 8.
- **Then:** Task 9, then Task 10.
- The orchestrator pushes after Task 1's review approves, so CI `verify` applies 0093 on the CLI's PostgreSQL early, and applies 0093 to bis-ci then (Task 10 step 1), so the PR's `e2e` migration check (`.github/scripts/ci-migrations-applied.sh`) can go green.

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0093_ai_disclosure.sql` | 1 | new |
| `packages/db/src/test/ai-disclosure-schema.test.ts` | 1 | new: shape, CHECK, defaults, grants, client/agency refusals |
| `apps/web/src/lib/messages.ts` (+ one `describe` in `messages.test.ts`) | 2 | 25 new keys + `.es` twins |
| `apps/web/src/lib/voice/greeting.ts` (+ `greeting.test.ts`) | 3 | third parameter; the two spoken sentences |
| `apps/web/src/lib/voice/system-prompt.ts:72` (+ `system-prompt.test.ts`) | 3 | the disclosed IDENTITY line |
| `apps/web/src/lib/voice/session-config.ts:10-42` | 3 | `disclosed?: boolean` on `VoicePromptInput` |
| `…/incoming/route.ts:1118` | 3 | passes `{ disclose: false, … }` (no behaviour change); Task 4 replaces it |
| `packages/db/src/voice.ts:11-26`, `:66-70`, `:295-307` | 4 | `DisclosureSetting`, `disclosure` on the row and in `PROFILE_COLS`, `startCallRow`'s `disclosed` |
| `packages/db/src/test/voice.test.ts` (beside `:662`) | 4 | the stamp case |
| `apps/web/src/lib/voice/disclosure.ts` (+ `disclosure.test.ts`) | 4 | new: `DISCLOSURE_VALUES`, `decideDisclosure` |
| `…/incoming/route.ts:1088-1128` (+ `route.test.ts`, `lifecycle.test.ts`) | 4 | resolve, stamp, greeting, prompt, the log line |
| every `VoiceProfileRow` literal the web typecheck names (expected: `…/voice/voice-settings.tsx:34-41` `DEFAULT_PROFILE`, `…/voice/{page,voice-settings}.test.ts`, `…/c/{data,layout,page}.test.ts`, `apps/web/src/app/api/voice/texml/{route,screen/route,wellformed}.test.ts`, `apps/web/src/lib/voice/tools/registry.test.ts`, `apps/web/e2e/{forward-calls,phone-width}.spec.ts`) | 4 | `disclosure: "off"` |
| `…/c/page.tsx:99-154`, `…/c/concierge-chat.tsx:292-335`, `:485-507`, `…/c/concierge.css` (after `:113`) (+ `page.test.ts`, `concierge-chat.test.ts`) | 5 | label, first message |
| `…/turn/route.ts:430-450` (+ `route.test.ts`) | 5 | `disclosed` into the chat prompt |
| `packages/db/src/voice.ts` (new `getDisclosureResults`) + `packages/db/src/test/disclosure-results.test.ts` | 6 | new read |
| `apps/web/src/lib/voice/disclosure-results.ts` (+ test) | 6 | new: `DISCLOSURE_MIN_PER_HALF`, `disclosureResultsView` |
| `…/voice/page.tsx`, `…/voice/voice-settings.tsx` (`VoiceProfileForm` `:52-299`, `VoiceSettings` `:989-1036`), `…/voice/actions.ts:63-140` (+ their tests) | 7 | the setting, the save, the card slot |
| `…/voice/disclosure-results-view.tsx` (new, server-safe), `…/voice/disclosure-results-card.tsx` (new, async server) (+ `disclosure-results-view.test.ts`) | 7 | the card |
| `…/styleguide/page.tsx`, `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 7 | specimens; baselines |
| `apps/web/e2e/ai-disclosure.spec.ts` | 8 | new |

**Not touched:**
- `apps/web/src/app/api/voice/web/session/route.ts` (the browser "Talk to Sofía" demo). `disclosed` is optional and defaults to false there, so its prompt is byte-identical (ambiguity C).
- `apps/web/src/app/api/voice/texml/**` and `lib/voice/call-screen.ts` (the press-1 screen): unchanged (spec §5.1). A screened call never reaches the incoming route, so it is never stamped.
- `lib/concierge/strings.ts`: the new chat strings go in `messages.ts` (spec §6; ambiguity D).

---

## The model (every task reads this; names are binding)

### 0093

| Column | Type and rule |
|---|---|
| `voice_profiles.disclosure` | `text not null default 'off' constraint voice_profiles_disclosure_check check (disclosure in ('off', 'trial', 'on'))` |
| `calls.disclosed` | `boolean`, nullable, no default. Set once at call start for Trial/On; null for Off and every call before 0093 |

Grants: **none added.** `authenticated` has table SELECT on both tables (`0019_voice_core.sql:42`, `:67`) and no write verb (`0020_voice_grants_revoke.sql:7-13`); `anon` has nothing; `service_role` writes through default privileges. A new column inherits exactly that, so an Owner (any client member) can read `disclosure` and can never write it (decision 28), and nobody but the server writes `calls.disclosed`. This is `0058_voice_forward_calls.sql`'s "the absence is the control" reasoning, cited in the header. The client-write digest is UNCHANGED.

### `@bis/db` (Task 4 unless noted)

```ts
// packages/db/src/voice.ts
export type DisclosureSetting = "off" | "trial" | "on";
// VoiceProfileRow gains (after forward_calls):
  /** 0093. Off / Trial / On: whether Sofía says she is an AI after the greeting. Agency-written
   *  through serviceDb() by saveVoiceProfileAction; authenticated has SELECT only (0020). */
  disclosure: DisclosureSetting;
// PROFILE_COLS ends: "public_id, concierge_enabled, concierge_form_id, forward_calls, disclosure"
// startCallRow's input gains: disclosed?: boolean   (named in the insert only when not undefined)

// Task 6:
export type DisclosureHalf = { counted: number; booked: number; abandoned: number };
export type DisclosureResults = { said: DisclosureHalf; didnt: DisclosureHalf; notCounted: number };
export async function getDisclosureResults(db: SupabaseClient, accountId: string): Promise<DisclosureResults>;
```

**What "counted" means (ambiguity A):** a call row of this account with `ended_at is not null`, `disclosed is not null`, and `outcome <> 'spam'`. `calls.outcome` defaults to `'abandoned'` at insert (`0019_voice_core.sql:53`), so a call still in progress (or one whose `finishCall` never ran) would otherwise read as "hung up early"; `ended_at` is what `finishCallRow` writes (`voice.ts:505`). `notCounted` = finished calls with `disclosed is null` OR `outcome = 'spam'` (the footnote's "spam, or before the trial").

### Web

```ts
// apps/web/src/lib/voice/disclosure.ts (Task 4; server only: imports node:crypto)
export const DISCLOSURE_VALUES = ["off", "trial", "on"] as const;
export type DisclosureDecision = { disclose: boolean; stamp: boolean | null };
export function decideDisclosure(setting: DisclosureSetting | null | undefined): DisclosureDecision;

// apps/web/src/lib/voice/greeting.ts (Task 3)
export type GreetingDisclosure = { disclose: boolean; personaName: string };
export function openingGreeting(profile: GreetingProfile, businessName: string, disclosure: GreetingDisclosure): { instruction: string };

// apps/web/src/lib/voice/session-config.ts (Task 3): VoicePromptInput gains
  disclosed?: boolean;   // optional, default false = byte-identical prompt

// apps/web/src/lib/voice/disclosure-results.ts (Task 6; pure)
export const DISCLOSURE_MIN_PER_HALF = 30;
export type DisclosureColumnView = { counted: number; bookedPct: number | null; hungUpPct: number | null };
export type DisclosureResultsView =
  | { state: "empty" }
  | { state: "loaded"; said: DisclosureColumnView; didnt: DisclosureColumnView; notEnough: boolean; notCounted: number };
export function disclosureResultsView(r: DisclosureResults): DisclosureResultsView;
```

### The spoken sentences (Task 3; speech, not UI, so constants in `greeting.ts`, spec §6)

- EN: `I'm {persona}, an AI assistant. This call is transcribed so the team can follow up.`
- ES: `Soy {persona}, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento.`

### The disclosed IDENTITY line (Task 3; replaces `system-prompt.ts:72` only when `disclosed`)

```
IDENTITY — You have already told the ${audienceWord} that you are ${input.personaName}, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then ${wouldRatherTalkToAPerson} if they would rather talk to a person. Never claim to be human. Answer as ${input.businessName} and get straight to what the ${audienceWord} needs.
```

`wouldRatherTalkToAPerson` (`:56-60`) already resolves to the handoff offer, "offer to take a message" or the web's `capture_lead` follow-up, so "offer a person (or a message)" holds per surface.

---

## Assumptions (each with its check)

- **A1** No other lane has claimed 0093. Check: Task 0, `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0093*'` prints nothing, and `ls packages/db/supabase/migrations | tail -1` is `0092_ai_contact_held_by_voice_log.sql`.
- **A2** Both projects are at 0092. Check: Task 0, `select max(version) from supabase_migrations.schema_migrations` on both, read-only.
- **A3** `voice_profiles` and `calls` carry no column-level write grant for `anon`/`authenticated` today, so a new column is unwritable by clients. Check: Task 1 case 5 (`information_schema.column_privileges`), run on `pre` AND `post`.
- **A4** The incoming route test file can partially mock `node:crypto` without breaking the OpenAI webhook path: `unwrap` is already mocked (`unwrapMock`, `…/incoming/route.test.ts`), and the partial mock spreads the real module. Check: Task 4 runs the whole `route.test.ts` and `lifecycle.test.ts` green with the mock in place.
- **A5** The client fixture user (`e2e/.auth/client-state.json`, `auth.setup.ts:129-200`) is the fixture org's Owner. Check: Task 8 reads `auth.setup.ts` and states the role in its report; if it is not an Owner, the spec's "a client Owner" case uses whatever Owner session exists, or Task 8 STOPS.
- **A6** `requireAgencyOnlyAccountAccess` (`apps/web/src/lib/auth.ts:98-104`) redirects a client to `accountHome` (`/dashboard/accounts/<id>/dashboard` for an Owner), so a client Owner never renders the Voice page. Check: Task 8 test 4 asserts the URL.
- **A7** The partial `.or("disclosed.is.null,outcome.eq.spam")` filter combined with `.not("ended_at", "is", null)` ANDs the two in PostgREST. Check: Task 6's fixture has a NOT-ended null-stamp row that must NOT be in `notCounted`.

---

## Global constraints (short form; the 8c plan's "Global constraints", `docs/superpowers/plans/2026-10-19-ai-acts-reversible-pr8c.md:233-294`, and the 8b-1 plan's, `…-pr8b1.md:144-271`, bind where this is silent)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout`, `--amend` or `rm -rf` under `<WT>` (memory "No rm -rf on worktrees").
  - Stage new files with `git add -- <new paths>`; commit with `git commit -m "…" -- <every path>`, never `-A` or `.`.
  - Never push (the orchestrator pushes). Never touch `main`.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Databases:**
  - Until Task 10 step 1 has applied 0093 to bis-ci, no `@bis/db` vitest and no live web test runs against bis-ci (the new `PROFILE_COLS` names a column bis-ci lacks). Each runs on your own PG18 replica.
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>`; never create either.
  - **0093 is applied only by the orchestrator**, only through `supabase db push` (`ci-project-setup.yml`) and MCP `apply_migration`. Never by bare `psql` or a SQL editor.
- **The replica kit:** build `<SCRATCH>/s47a-kit/` from `<KIT8C>` with `sed` and show the `diff`. Only these lines may differ:
  - `replica.sh:6`: `WT=` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s47a`.
  - `replica.sh:31`: `*0091_*` becomes `*0093_*`.
  - `replica.sh:36-41`: `0091_ai_acts.sql` becomes `0093_ai_disclosure.sql` (twice), and the three messages `post = pre + 0093`, `0093 FAILED`, `post = pre (no 0093 yet)`.
  - `pgrst.sh:6`: `SECRET=` becomes `s47a-local-postgrest-jwt-secret-not-used-anywhere-real-0000`.
  - `pre` = every migration through 0092; `post` = `pre` + 0093.
  - Stop your own kit only, by the four steps in `…-pr8b1.md` "The replica kit" (`touch stop`; stop YOUR `postgrest.exe` by path; stop the gateway listener by port; `pg_ctl stop -m fast`). Never `taskkill /IM postgrest.exe`.
- **Ports:** this lane uses **55700-55709** only.

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer (withRollback only) | 55700 | — | — |
  | Task 1 reviewer | 55701 | — | — |
  | Task 4 implementer, then Task 6 implementer (Task 4 stops its kit first) | 55702 | 55703 | 55704 |
  | Task 4 reviewer | 55705 | 55706 | 55707 |
  | Task 9 reviewer (after Task 1's reviewer has stopped) | 55701 | 55708 | 55709 |
- **Faithfulness:** the client-write digest (the query at `…-pr8b1.md:301-311`) on `pre` must equal bis-ci's value that Task 0 reads after 0092. 0093 must leave it UNCHANGED on `post`.
- **SQL byte rules for 0093:**
  - ASCII only and no backslash: `LC_ALL=C tr -d '\000-\177' < f | wc -c` prints `0`, and `grep -nF '\' f` prints nothing. "Sofia", never "Sofía", in this file.
  - `$` only in `$$` pairs: exactly 4 `$` characters (one `do` block).
  - No `cascade` keyword. No `begin;`/`commit;` wrapper.
  - `lock_timeout` set inside the first `do` block by `pg_catalog.set_config('lock_timeout', '5s', true)` (`0091_ai_acts.sql:45-51`, `0092`'s section 0).
- **Tests must be able to fail:**
  - The implementer runs each named mutation, pastes the failing assertion line, and reverts by hand (`cmp` against `git show HEAD:<path> > <SCRATCH>/<dir>/orig`).
  - Every account-scoped read has a second-account case in which the OTHER account holds matching rows.
  - Spoken sentences, prompt lines and copy are asserted as typed-out literals, never built by the function under test. Spanish twins asserted beside English.
  - The memory "Vacuous test shapes" applies (no `toBeTruthy` on content; no WANT built from the code; read the run count after a `-t` filter).
- **`@bis/db` mocks:**
  - Web imports only TYPES from `@bis/db` in `lib/voice/disclosure.ts` and `lib/voice/disclosure-results.ts` (`import type`). No import-time `@bis/db` value read in either.
  - Task 7 runs `grep -rln 'vi.mock("@bis/db", () => ({' apps/web/src | xargs grep -lE "from ['\"]\./(page|voice-settings)['\"]"` and adds `getDisclosureResults` to each bare factory it lists whose test renders the Voice page (expected: `…/voice/page.test.ts`). A different output is a finding to read.
- **Never call a function exported from a `"use client"` module on the server.** `voice-settings.tsx` is `"use client"` (`:1`); the results card's view is a separate server-safe file.
- **Copy:**
  - Every UI string through `tr.text(key, params)` / `tr.count(key, n, params)` (`apps/web/src/lib/record/copy.ts:15-22`) or `t(m, key, locale, params)` (`apps/web/src/lib/i18n/t.ts`), with its `.es` twin. Spanish is **usted**.
  - No JSX literal copy with a letter in it.
  - No plumbing words ("disclosure", "stamp", "coin", "flag", "trial arm", "variant", "null").
  - The persona is `{persona}`, never a typed "Sofía", in every key.
  - `messages.ts` is **Task 2's only**. A later task that finds a key missing STOPS and reports.
- **Logs:** ids and codes only. Never a caller number, a name, a transcript word, a greeting, or the decided value of the coin beside a caller's number. The coin's value may be logged with the call id.
- **Running tests:**
  - Only the affected files, by path: `pnpm --filter web exec vitest run "<path>" …`.
  - `pnpm --filter web typecheck` in every task touching `.ts`/`.tsx`; `pnpm --filter @bis/db typecheck` in every task touching `packages/db/src`. Both GREEN at every commit; a task that cannot keep them green STOPS.
  - `pnpm --filter web exec eslint "<touched files>"`.
  - `@bis/db` suites only on your replica, from `packages/db`: `node node_modules/vitest/vitest.mjs run <files>` after `export SUPABASE_DB_URL=postgres://postgres@localhost:<pg>/post` (withRollback) or `source <dir>/env-run.sh` (withTestAccount). Capture the exit code to a file with nothing after the command in the same block.
  - Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`); never Playwright beyond `--list` (memory "Agent test scope").
- **e2e:**
  - Fixture account only (`e2e/.auth/client-fixture.json`), never `Test Client One`.
  - Every row written is deleted or restored in `afterAll`, each `error` checked, then re-read.
  - Role names exact (`{ name: "On", exact: true }`). A React boolean `data-*` renders `"true"`.

---

## Task 0: Pre-reads (orchestrator)

- [ ] A1: `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0093*'` prints nothing; the newest migration file is `0092_ai_contact_held_by_voice_log.sql`.
- [ ] Read-only MCP `execute_sql` on **both** `odnobiodsftffphuuosz` (bis-ci) and `tlbkbmlrfafquucsmsmm` (production):
  1. `select max(version) from supabase_migrations.schema_migrations;` (A2: 0092's apply on both).
  2. The Faithfulness digest (`…-pr8b1.md:301-311`) on bis-ci.
  3. `select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'voice_profiles' and column_name = 'disclosure') or (table_name = 'calls' and column_name = 'disclosed'));` → `0` on both.
  4. Production only: BIS's own account id and its voice profile row exists: `select a.id, vp.id is not null as has_profile from public.accounts a left join public.voice_profiles vp on vp.account_id = a.id where a.name ilike 'BIS%';` (record the id for Task 10).
- [ ] **STOP** if read 1 is not 0092 on both, or read 3 is non-zero anywhere.
- [ ] Ledger line `s47a T0: …` with every value. Put the digest into Task 1's and Task 4's briefs.

---

## Task 1 (HIGH): Migration 0093 and its proof (bis-db-schema, opus)

**Files:**
- Create: `packages/db/supabase/migrations/0093_ai_disclosure.sql`
- Create: `packages/db/src/test/ai-disclosure-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.voice_profiles.disclosure` (`text`, `'off'|'trial'|'on'`, default `'off'`), `public.calls.disclosed` (`boolean`, nullable), constraint `voice_profiles_disclosure_check`.

- [ ] **Step 1: Build the kit** (Global constraints) on 55700 and show the `diff` against `<KIT8C>`. Confirm `pre`'s digest equals Task 0's bis-ci value.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/ai-disclosure-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0093_ai_disclosure.sql: voice_profiles.disclosure (Off / Trial / On) and calls.disclosed (the per-call
 * stamp). RED BEFORE APPLY: every case names a column that does not exist yet. The grants cases are the
 * control: authenticated has SELECT and no write verb on both tables (0019/0020), and 0093 adds none, so a
 * client Owner can read the setting and never write it (decision 28), and only the server stamps a call.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function seed(c: Client, label: string): Promise<{ accountId: string; orgId: string; callId: string }> {
  await actAsOwner(c);
  const orgId = `org_disc_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Disc') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Disclosure', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  const { rows: [phone] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [account!.id, testPhoneNumber()]);
  const { rows: [call] } = await c.query<{ id: string }>(
    "insert into public.calls (account_id, phone_number_id) values ($1, $2) returning id", [account!.id, phone!.id]);
  return { accountId: account!.id, orgId, callId: call!.id };
}

describe("0093 voice_profiles.disclosure", () => {
  it("is text, NOT NULL, default 'off' (mutation: default 'on' → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'disclosure'`);
      expect(rows).toEqual([{ data_type: "text", is_nullable: "NO", column_default: "'off'::text" }]);
    }));

  it("a profile created without it reads 'off'", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "default");
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
    }));

  it("takes each of off, trial, on", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "each");
      for (const v of ["trial", "on", "off"]) {
        await c.query("update public.voice_profiles set disclosure = $2 where account_id = $1", [accountId, v]);
        const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
        expect(rows).toEqual([{ disclosure: v }]);
      }
    }));

  it("refuses any fourth value by voice_profiles_disclosure_check (mutation: drop the CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "check");
      await expect(c.query("update public.voice_profiles set disclosure = 'maybe' where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_profiles_disclosure_check" });
    }));

  it("refuses NULL: 'off' has one spelling (mutation: drop NOT NULL → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "null");
      await expect(c.query("update public.voice_profiles set disclosure = null where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23502" });
    }));
});

describe("0093 calls.disclosed", () => {
  it("is boolean, nullable, with no default (mutation: default false → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = 'disclosed'`);
      expect(rows).toEqual([{ data_type: "boolean", is_nullable: "YES", column_default: null }]);
    }));

  it("a call inserted without it reads null, and true and false both store", () =>
    withRollback(async (c) => {
      const { callId } = await seed(c, "stamp");
      const read = async () => (await c.query("select disclosed from public.calls where id = $1", [callId])).rows;
      expect(await read()).toEqual([{ disclosed: null }]);
      await c.query("update public.calls set disclosed = true where id = $1", [callId]);
      expect(await read()).toEqual([{ disclosed: true }]);
      await c.query("update public.calls set disclosed = false where id = $1", [callId]);
      expect(await read()).toEqual([{ disclosed: false }]);
    }));
});

describe("0093 grants: readable by the account, written only by the server", () => {
  it("column privileges (mutation: grant update (disclosure) on voice_profiles to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'SELECT') as vp_auth_select,
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'UPDATE') as vp_auth_update,
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'INSERT') as vp_auth_insert,
           has_column_privilege('anon', 'public.voice_profiles', 'disclosure', 'SELECT') as vp_anon_select,
           has_column_privilege('service_role', 'public.voice_profiles', 'disclosure', 'UPDATE') as vp_service_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'SELECT') as c_auth_select,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'UPDATE') as c_auth_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'INSERT') as c_auth_insert,
           has_column_privilege('anon', 'public.calls', 'disclosed', 'SELECT') as c_anon_select,
           has_column_privilege('service_role', 'public.calls', 'disclosed', 'UPDATE') as c_service_update`);
      expect(r).toEqual({
        vp_auth_select: true, vp_auth_update: false, vp_auth_insert: false, vp_anon_select: false, vp_service_update: true,
        c_auth_select: true, c_auth_update: false, c_auth_insert: false, c_anon_select: false, c_service_update: true,
      });
    }));

  it("no column-level INSERT/UPDATE grant on either table for authenticated, anon or PUBLIC (A3; 0020's posture)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name in ('voice_profiles', 'calls')
            and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE')`);
      expect(rows).toEqual([]);
    }));

  it("a client member reads their setting and is refused writing it (mutation: grant the column → the update succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "client");
      await actAs(c, { org_id: orgId, sub: "user_disc_client" });
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
      await expect(c.query("update public.voice_profiles set disclosure = 'on' where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("the agency's own token is refused too: the agency writes through serviceDb", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency");
      await actAs(c, { app_role: "agency_admin", sub: "user_disc_agency" });
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
      await expect(c.query("update public.voice_profiles set disclosure = 'on' where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("a client member cannot stamp a call (mutation: grant update (disclosed) on calls to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { callId, orgId } = await seed(c, "callstamp");
      await actAs(c, { org_id: orgId, sub: "user_disc_client2" });
      const { rows } = await c.query("select disclosed from public.calls where id = $1", [callId]);
      expect(rows).toEqual([{ disclosed: null }]);
      await expect(c.query("update public.calls set disclosed = true where id = $1", [callId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("both columns carry a comment naming who writes them", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ t: string; d: string | null }>(
        `select c.relname as t, col_description(c.oid, a.attnum) as d
           from pg_attribute a join pg_class c on c.oid = a.attrelid
          where (c.relname = 'voice_profiles' and a.attname = 'disclosure')
             or (c.relname = 'calls' and a.attname = 'disclosed') order by c.relname`);
      expect(rows.map((r) => r.t)).toEqual(["calls", "voice_profiles"]);
      expect(rows[0]!.d).toContain("incoming call route");
      expect(rows[1]!.d).toContain("saveVoiceProfileAction");
    }));
});
```

If `actAs` with only `org_id` does not satisfy RLS for a client after 0068 (the read case returns `[]`), use the membership helper `db.ts:27-43` documents and say so in the report; the read assertion must stay.

- [ ] **Step 3: Run on `pre` to verify it fails.** `export SUPABASE_DB_URL=postgres://postgres@localhost:55700/pre; node node_modules/vitest/vitest.mjs run src/test/ai-disclosure-schema.test.ts` → every case FAILS except the column-privileges-empty case (A3, green on `pre` by design; it can only fail in the direction of an added grant). Record the counts.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0093_ai_disclosure.sql`:

```sql
-- 0093_ai_disclosure.sql - Sofia says she is an AI: the per-account setting and the per-call stamp
-- (S-47 part a; F-034; decision 20)
-- (docs/superpowers/specs/2026-10-20-ai-disclosure-design.md section 4;
--  docs/superpowers/plans/2026-10-20-ai-disclosure-pr47a.md, Task 1)
--
-- WHY. Decision 20 (owner, 2026-10-05): every assistant discloses by default, measured first. No account
-- has real call volume, so a before/after trial would measure nothing; instead a Trial account splits its
-- calls by a fair coin, and each call records which half it was in.
--
-- TWO COLUMNS:
--   public.voice_profiles.disclosure text not null default 'off', one of off, trial, on.
--     off: Sofia says she is automated only when asked (today's behaviour). on: she says it after the
--     greeting on every call. trial: a fair coin per call decides. NOT NULL so 'off' has one spelling
--     (0058's argument about forward_calls).
--   public.calls.disclosed boolean, nullable. Written once, at call start, by the incoming call route,
--     for every call whose profile was trial or on: true if she said it, false if not. NULL for an off
--     account and for every call before this file. The results card counts only non-null rows.
--
-- WHO WRITES THEM. disclosure: the agency only, through serviceDb(), behind the app's agency check, in
-- saveVoiceProfileAction (the Voice page's own Save). calls.disclosed: the server only, in startCallRow.
--
-- GRANTS: NONE, and the absence is the control (0058's DO NOT FIX, word for word in spirit).
--   authenticated has table SELECT on voice_profiles and calls (0019) and no write verb on either (0020
--   revoked insert, update, delete, truncate, references and trigger; 0053 revoked maintain), so a column
--   added today inherits exactly that: a client Owner reads the setting and never writes it (decision 28:
--   guardrails are never owner-editable), and nobody but the server stamps a call. That includes the
--   agency's own authenticated token. anon has nothing on either table (0020) and gains nothing.
--   service_role writes through the project's default privileges. The client-write digest is unchanged.
--
-- NO RLS POLICY CHANGE. voice_profiles_tenant and calls_tenant (0019) are row policies and cover every
-- column added today.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. The migration goes BEFORE the code: the
-- build after this file selects disclosure on every voice profile read (PROFILE_COLS), and PostgREST
-- fails a select naming a column it does not know.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build never names either column; the default fills
-- disclosure on its profile inserts, and calls.disclosed stays null on its call inserts.
--
-- ROLLBACK (roll the app back first), in this order:
--   alter table public.calls drop column disclosed;            (only on an owner decision: it drops the
--                                                               trial's per-call record)
--   alter table public.voice_profiles drop column disclosure;  (its CHECK goes with it)
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (0091's reason: inside a do block, so it is always in
--    the block's transaction). Both ALTERs take ACCESS EXCLUSIVE on tables the call path reads on every call.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The setting.
alter table public.voice_profiles
  add column disclosure text not null default 'off'
    constraint voice_profiles_disclosure_check check (disclosure in ('off', 'trial', 'on'));

comment on column public.voice_profiles.disclosure is
  'Whether the receptionist says she is an AI right after the greeting: off (only when asked), trial (a fair coin per call), on (every call). The website chat is labelled AI on trial or on. Agency-written through serviceDb() by saveVoiceProfileAction; authenticated has SELECT and deliberately no UPDATE.';

-- 2. The per-call stamp.
alter table public.calls
  add column disclosed boolean;

comment on column public.calls.disclosed is
  'Set once at call start by the incoming call route (startCallRow) when the profile was trial or on: true if the receptionist said she is an AI, false if not. NULL for an off account and for every call before 0093. Server-written only.';
```

- [ ] **Step 5: Re-build the kit** (it applies 0093 to `post` with `psql -1`) and run on `post`: `export SUPABASE_DB_URL=postgres://postgres@localhost:55700/post; node node_modules/vitest/vitest.mjs run src/test/ai-disclosure-schema.test.ts src/test/voice-forward-grants.test.ts src/test/schema-grants-guard.test.ts src/test/server-only-writes-grants.test.ts` → all green (the `withTestAccount` cases in `voice-forward-grants` need PostgREST; if this kit has none, run only its `withRollback` describes with `-t "0058"` and read the run count).

- [ ] **Step 6: Run each mutation** on `post` (edit the migration, rebuild the kit, run, paste the failing line, edit back, `cmp`):
  1. `default 'on'` → "is text, NOT NULL, default 'off'" FAILS.
  2. drop the `constraint … check (…)` clause → "refuses any fourth value" FAILS.
  3. append `grant update (disclosure) on public.voice_profiles to authenticated;` → "column privileges" and "a client member reads … refused" FAIL.
  4. `add column disclosed boolean default false` → "is boolean, nullable, with no default" FAILS.

- [ ] **Step 7: Digest and bytes.** The digest on `post` equals `pre`'s. `LC_ALL=C tr -d '\000-\177' < packages/db/supabase/migrations/0093_ai_disclosure.sql | wc -c` → `0`; `grep -nF '\' …` → nothing; `grep -o '\$' … | wc -l` → `4`; `grep -niw cascade …` → nothing. Record `md5sum`.

- [ ] **Step 8: Commit.**

```bash
git add -- packages/db/supabase/migrations/0093_ai_disclosure.sql packages/db/src/test/ai-disclosure-schema.test.ts
git commit -m "db: the AI disclosure setting on each voice profile (off, trial, on) and each call's stamp, server-written only (S-47a, migration 0093)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- packages/db/supabase/migrations/0093_ai_disclosure.sql packages/db/src/test/ai-disclosure-schema.test.ts
```

**Acceptance:** every case green on `post`, red on `pre` except A3's; every mutation fails by name; digest unchanged; md5 in the report.

**Review (HIGH):** opus bis-reviewer on 55701. It applies 0093 to a fresh `pre` copy through `psql -1` only, re-runs mutations 2 and 3 plus one of its own (suggested: `grant update on public.calls to authenticated`, which the column-privileges case must catch via `has_column_privilege`), checks the bytes and the md5, and reads `pg_constraint` for `voice_profiles_disclosure_check` itself. A re-review follows any change. The md5 that reaches bis-ci is the reviewed one.

---

## Task 2 (LOW): Every new key (bis-crm)

**Files:** `apps/web/src/lib/messages.ts` (new keys appended after the `voice.forward.*` block, `:1974-1981`, and a `concierge.*` pair at the end of the public-surface keys); one `describe` appended to `apps/web/src/lib/messages.test.ts`.

**Interfaces:** Produces the keys below; Tasks 5 and 7 read them by name.

Each key's `.es` twin sits on the next line. Plural pair: `X` + `XOne` (the `contacts.count`/`contacts.countOne` shape, `messages.ts:539`; `PluralKey`, `lib/i18n/t.ts:16-18`); read how `contacts.countOne`'s twin is spelled and copy that shape.

| Key | English | Spanish (usted) |
|---|---|---|
| `voice.disclosure.legend` | Tell callers {persona} is an AI | Decir a quien llama que {persona} es una IA |
| `voice.disclosure.off` | Off | Desactivado |
| `voice.disclosure.offHint` | {persona} says she's an AI only when someone asks. | {persona} dice que es una IA solo cuando se lo preguntan. |
| `voice.disclosure.trial` | Trial | Prueba |
| `voice.disclosure.trialHint` | Half the calls, picked at random, hear it right after the greeting, so the two halves can be compared below. The website chat always says it. | La mitad de las llamadas, elegidas al azar, lo escuchan justo después del saludo, para comparar las dos mitades abajo. El chat del sitio web siempre lo dice. |
| `voice.disclosure.on` | On | Activado |
| `voice.disclosure.onHint` | Every call hears it right after the greeting, and the website chat says it too. | Todas las llamadas lo escuchan justo después del saludo, y el chat del sitio web también lo dice. |
| `voice.disclosure.nextCall` | Changes apply from the next call. Calls already made keep what they heard. | Los cambios aplican desde la siguiente llamada. Las llamadas ya hechas conservan lo que escucharon. |
| `voice.disclosure.results.title` | Saying it's an AI: how calls went | Decir que es una IA: cómo fueron las llamadas |
| `voice.disclosure.results.period` | Every finished call since Trial or On was first chosen. | Todas las llamadas terminadas desde que se eligió Prueba o Activado por primera vez. |
| `voice.disclosure.results.said` | Said it was AI | Dijo que era IA |
| `voice.disclosure.results.didnt` | Didn't | No lo dijo |
| `voice.disclosure.results.counted` | Calls counted | Llamadas contadas |
| `voice.disclosure.results.booked` | Booked | Agendaron |
| `voice.disclosure.results.hungUp` | Hung up early | Colgaron antes |
| `voice.disclosure.results.percent` | {percent}% | {percent} % |
| `voice.disclosure.results.noneYet` | No calls yet | Aún no hay llamadas |
| `voice.disclosure.results.notEnough` | Not enough calls yet to tell. | Todavía no hay suficientes llamadas para saberlo. |
| `voice.disclosure.results.notCounted` | {count} calls not counted (spam, or before the trial) | {count} llamadas no contadas (spam, o de antes de la prueba) |
| `voice.disclosure.results.notCountedOne` | 1 call not counted (spam, or before the trial) | 1 llamada no contada (spam, o de antes de la prueba) |
| `voice.disclosure.results.empty` | No calls since the trial started. | No hay llamadas desde que empezó la prueba. |
| `voice.disclosure.results.emptyAction` | Choose Trial or On above and save. Each call is counted here once it ends. | Elija Prueba o Activado arriba y guarde. Cada llamada se cuenta aquí cuando termina. |
| `voice.disclosure.results.error` | Couldn't load how calls went. | No se pudo cargar cómo fueron las llamadas. |
| `concierge.aiLabel` | {persona} · AI assistant | {persona} · asistente de IA |
| `concierge.aiIntro` | I'm {persona}, an AI assistant. This chat is saved so the team can follow up. | Soy {persona}, una asistente de inteligencia artificial. Este chat se guarda para que el equipo le dé seguimiento. |

(`common.retry`, `messages.ts:300`, is reused for the card's error state; no new key.)

- [ ] **Step 1: Write the failing test** appended to `messages.test.ts`:

```ts
describe("S-47a keys (AI disclosure)", () => {
  const pairs: Array<[string, string, string]> = [
    ["voice.disclosure.legend", "Tell callers {persona} is an AI", "Decir a quien llama que {persona} es una IA"],
    ["voice.disclosure.trialHint", "Half the calls, picked at random, hear it right after the greeting, so the two halves can be compared below. The website chat always says it.", "La mitad de las llamadas, elegidas al azar, lo escuchan justo después del saludo, para comparar las dos mitades abajo. El chat del sitio web siempre lo dice."],
    ["voice.disclosure.results.notEnough", "Not enough calls yet to tell.", "Todavía no hay suficientes llamadas para saberlo."],
    ["voice.disclosure.results.notCounted", "{count} calls not counted (spam, or before the trial)", "{count} llamadas no contadas (spam, o de antes de la prueba)"],
    ["voice.disclosure.results.notCountedOne", "1 call not counted (spam, or before the trial)", "1 llamada no contada (spam, o de antes de la prueba)"],
    ["concierge.aiLabel", "{persona} · AI assistant", "{persona} · asistente de IA"],
    ["concierge.aiIntro", "I'm {persona}, an AI assistant. This chat is saved so the team can follow up.", "Soy {persona}, una asistente de inteligencia artificial. Este chat se guarda para que el equipo le dé seguimiento."],
  ];
  it.each(pairs)("%s reads exactly, with its Spanish twin (mutation: drop the .es line → FAILS)", (key, en, es) => {
    const cat = m as Record<string, string>;
    expect(cat[key]).toBe(en);
    expect(cat[`${key}.es`]).toBe(es);
  });

  it("every voice.disclosure.* and concierge.ai* key has a Spanish twin and no plumbing word", () => {
    const cat = m as Record<string, string>;
    const keys = Object.keys(cat).filter((k) => (k.startsWith("voice.disclosure.") || k.startsWith("concierge.ai")) && !k.endsWith(".es"));
    expect(keys.length).toBe(25);
    for (const k of keys) {
      expect(cat[`${k}.es`], k).toEqual(expect.any(String));
      expect(`${cat[k]} ${cat[`${k}.es`]}`.toLowerCase(), k).not.toMatch(/disclos|stamp|coin|null|variant/);
    }
  });
});
```

- [ ] **Step 2:** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys absent).
- [ ] **Step 3:** Add the 25 keys and 25 twins (table above) to `messages.ts`.
- [ ] **Step 4:** Re-run → PASS. Mutation: delete `concierge.aiIntro.es` → the `it.each` row FAILS; restore. Run `src/lib/i18n/ratchet.test.ts` → PASS (new keys twinned, so the catalogue baseline needs no change).
- [ ] **Step 5:** `pnpm --filter web typecheck`; eslint on both files. Commit `copy: the AI disclosure setting, its results card and the website chat's AI label, English and Spanish (S-47a)` with the trailers, `-- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`.

---

## Task 3 (MEDIUM): The spoken sentence and the IDENTITY swap (bis-voice)

**Files:**
- Modify: `apps/web/src/lib/voice/greeting.ts` (whole file, 56 lines), `apps/web/src/lib/voice/greeting.test.ts`
- Modify: `apps/web/src/lib/voice/system-prompt.ts:62-74`, `apps/web/src/lib/voice/system-prompt.test.ts`
- Modify: `apps/web/src/lib/voice/session-config.ts:10-42`
- Modify: `…/incoming/route.ts:1118` (one line, no behaviour change)

**Interfaces:**
- Produces: `openingGreeting(profile, businessName, { disclose, personaName })`, `GreetingDisclosure`; `VoicePromptInput.disclosed?: boolean`. Task 4 passes the decision into both; Task 5 passes `disclosed` on the web.

- [ ] **Step 1: Write the failing tests.** In `greeting.test.ts`, add `const OFF = { disclose: false, personaName: "Sofía" } as const;` and pass `OFF` as the third argument to EVERY existing call (the expected strings do not change: that is the byte-identical proof, spec §7). Then append:

```ts
const ON = { disclose: true, personaName: "Sofía" } as const;

describe("openingGreeting — off is byte-identical to before S-47a", () => {
  it("en, es and both with disclose false equal the pre-S-47a instructions exactly (mutation: append the sentence regardless of disclose → FAILS)", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Hi, thanks for calling Rio Roofing.");
    expect(openingGreeting(profile("es"), "Rio Roofing Co", OFF).instruction)
      .toBe("Greet the caller with exactly: Hola, gracias por llamar a Rio Roofing.");
    expect(openingGreeting(profile("both"), "Rio Roofing Co", OFF).instruction).toBe(
      "Greet the caller with these two greetings, word for word, one right after the other: "
      + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
      + 'English: "Hi, thanks for calling Rio Roofing." Spanish: "Hola, gracias por llamar a Rio Roofing."');
  });
});

describe("openingGreeting — disclose true says the AI sentence after the greeting, in its language (D3)", () => {
  it("en", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with exactly: Hi, thanks for calling Rio Roofing. "
      + "I'm Sofía, an AI assistant. This call is transcribed so the team can follow up.");
  });
  it("es (mutation: use the English sentence for es → FAILS)", () => {
    expect(openingGreeting(profile("es"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with exactly: Hola, gracias por llamar a Rio Roofing. "
      + "Soy Sofía, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento.");
  });
  it("both: English greeting + English sentence, then Spanish greeting + Spanish sentence (mutation: swap the two sentences → FAILS)", () => {
    expect(openingGreeting(profile("both"), "Rio Roofing Co", ON).instruction).toBe(
      "Greet the caller with these two greetings, word for word, one right after the other: "
      + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
      + 'English: "Hi, thanks for calling Rio Roofing. I\'m Sofía, an AI assistant. This call is transcribed so the team can follow up." '
      + 'Spanish: "Hola, gracias por llamar a Rio Roofing. Soy Sofía, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento."');
  });
  it("names the account's own persona, and falls back to Sofía for a blank one", () => {
    expect(openingGreeting(profile("en"), "Rio Roofing Co", { disclose: true, personaName: "Alex" }).instruction)
      .toContain("I'm Alex, an AI assistant.");
    expect(openingGreeting(profile("en"), "Rio Roofing Co", { disclose: true, personaName: "  " }).instruction)
      .toContain("I'm Sofía, an AI assistant.");
  });
});
```

In `system-prompt.test.ts` append:

```ts
describe("buildSystemPrompt — the IDENTITY line follows what was said (S-47a)", () => {
  const OLD = "IDENTITY — Do not volunteer that you are automated and do not introduce yourself by name unless asked.";
  const PHONE_DISCLOSED =
    "IDENTITY — You have already told the caller that you are Sofía, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then offer to take a message if they would rather talk to a person. Never claim to be human. Answer as Rio Roofing and get straight to what the caller needs.";
  const WEB_DISCLOSED =
    "IDENTITY — You have already told the visitor that you are Sofía, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then use capture_lead to get their name and a way to reach them, and say the team will follow up if they would rather talk to a person. Never claim to be human. Answer as Rio Roofing and get straight to what the visitor needs.";

  it("disclosed false (and absent) is byte-identical to before (mutation: always use the disclosed line → FAILS)", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: false }), now)).toBe(buildSystemPrompt(base, now));
    expect(buildSystemPrompt(base, now)).toContain(OLD);
  });
  it("disclosed true on the phone swaps the line, and only that line", () => {
    const p = buildSystemPrompt(baseInput({ disclosed: true }), now);
    expect(p).toContain(PHONE_DISCLOSED);
    expect(p).not.toContain(OLD);
    expect(p.replace(PHONE_DISCLOSED, "X")).toBe(buildSystemPrompt(base, now).replace(/IDENTITY — [^\n]*/, "X"));
  });
  it("disclosed true with a transfer number offers the transfer", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: true, handoffAvailable: true }), now))
      .toContain("Then offer to put them through to someone on the team if they would rather talk to a person.");
  });
  it("disclosed true on the web says visitor and the capture_lead follow-up", () => {
    expect(buildSystemPrompt(baseInput({ disclosed: true, medium: "web" }), now)).toContain(WEB_DISCLOSED);
  });
  it("'Never claim to be human.' is on every call either way (mutation: drop it from the disclosed line → FAILS)", () => {
    for (const disclosed of [false, true]) {
      for (const medium of ["phone", "web"] as const) {
        const identity = buildSystemPrompt(baseInput({ disclosed, medium }), now).split("\n").find((l) => l.startsWith("IDENTITY"));
        expect(identity, `${disclosed}/${medium}`).toContain("Never claim to be human.");
      }
    }
  });
});
```

- [ ] **Step 2:** `pnpm --filter web exec vitest run src/lib/voice/greeting.test.ts src/lib/voice/system-prompt.test.ts` → FAIL (typecheck-level: third argument and `disclosed` unknown; then the new cases).

- [ ] **Step 3: Implement.** `greeting.ts` — add below `spanishGreeting` (`:15`):

```ts
/** What a caller hears after the greeting when this call discloses (spec D3, owner 2026-10-20). Speech,
 *  not UI: constants here, pinned word for word in both languages by greeting.test.ts. */
function aiSentence(lang: "en" | "es", persona: string): string {
  return lang === "es"
    ? `Soy ${persona}, una asistente de inteligencia artificial. Esta llamada se transcribe para que el equipo le dé seguimiento.`
    : `I'm ${persona}, an AI assistant. This call is transcribed so the team can follow up.`;
}

/** Whether THIS call says it, decided per call by the incoming route (`decideDisclosure`). */
export type GreetingDisclosure = { disclose: boolean; personaName: string };
```

and change `openingGreeting` (`:37-56`) to:

```ts
export function openingGreeting(
  profile: GreetingProfile, businessName: string, disclosure: GreetingDisclosure,
): { instruction: string } {
  const persona = disclosure.personaName.trim() || "Sofía";
  // Off: the greeting alone, so the instruction is byte-identical to before S-47a.
  const said = (greeting: string, lang: "en" | "es") =>
    disclosure.disclose ? `${greeting} ${aiSentence(lang, persona)}` : greeting;
  if (profile.languages === "both") {
    const en = said(englishGreeting(profile, businessName), "en");
    const es = said(spanishGreeting(profile, businessName), "es");
    return {
      instruction:
        "Greet the caller with these two greetings, word for word, one right after the other: "
        + "first the English one, then the Spanish one. Do not translate, shorten or combine them. "
        // JSON-quoted (review minor 4): a greeting with its own quotation
        // marks cannot blur where it ends and the next label begins.
        + `English: ${JSON.stringify(en)} Spanish: ${JSON.stringify(es)}`,
    };
  }
  const text = profile.languages === "es"
    ? said(spanishGreeting(profile, businessName), "es")
    : said(englishGreeting(profile, businessName), "en");
  return { instruction: `Greet the caller with exactly: ${text}` };
}
```

Extend the doc comment above it with one paragraph: the D3 sentence follows each greeting in that greeting's language when `disclose`; off is byte-identical.

`session-config.ts` — add after `medium?` (`:41`):

```ts
  /**
   * S-47a: this conversation has ALREADY been told it is talking to an AI (the phone's opening sentence,
   * or the chat's label and first message). OPTIONAL and defaulting to false, so every caller that does not
   * pass it (the browser voice demo) gets a byte-identical prompt.
   */
  disclosed?: boolean;
```

`system-prompt.ts` — replace the IDENTITY element of `lines` (`:72`) with `identityLine,` and declare above `const lines` (after `toneMedium`, `:67`):

```ts
  // S-47a (decision 20): when this caller or visitor has already been told she is an AI, the line says so
  // and has her confirm it plainly if asked. Otherwise it is the pre-S-47a line, byte for byte.
  // "Never claim to be human." is in both.
  const identityLine = input.disclosed
    ? `IDENTITY — You have already told the ${audienceWord} that you are ${input.personaName}, an AI assistant. If they ask whether they are speaking with a person, a human, a bot, a robot, or an AI, confirm it plainly: you are an AI assistant. Then ${wouldRatherTalkToAPerson} if they would rather talk to a person. Never claim to be human. Answer as ${input.businessName} and get straight to what the ${audienceWord} needs.`
    : `IDENTITY — Do not volunteer that you are automated and do not introduce yourself by name unless asked. Just answer as ${input.businessName} and get straight to what the ${audienceWord} needs. If a ${audienceWord} asks directly whether they are speaking with a person, a human, a bot, a robot, or an AI, answer honestly and briefly that you are an automated assistant, then ${wouldRatherTalkToAPerson} if they would rather talk to a person. Never claim to be human.`;
```

(The `: …` branch is `:72`'s text moved verbatim; `git diff -w` must show it unchanged.)

`…/incoming/route.ts:1118` becomes:

```ts
    const opening = openingGreeting(profile, businessName, { disclose: false, personaName: profile.persona_name });
```

(Task 4 replaces `false` with the decision; today's behaviour is unchanged.)

- [ ] **Step 4:** Re-run both files → PASS. Run each named mutation (four in the tests above), paste the failing line, revert, `cmp`. Run `src/lib/voice/session-config.test.ts`, `…/incoming/lifecycle.test.ts`, `…/incoming/route.test.ts`, `src/app/api/voice/web/session/route.test.ts`, `…/turn/route.test.ts` unchanged → PASS (their greetings and prompts are byte-identical).
- [ ] **Step 5:** `pnpm --filter web typecheck`; eslint on touched files. Commit `voice: Sofía can say she is an AI after the greeting, in its language, and her identity line follows what was said; off is byte-identical (S-47a)` with the trailers, naming all six paths.

**Review (MEDIUM):** one sonnet bis-reviewer. It checks `git diff -w` on `system-prompt.ts` shows the off branch identical to `HEAD~`'s `:72`, re-runs one mutation of its choice, and confirms no other prompt line moved.

---

## Task 4 (MEDIUM): Decide, stamp, wire (bis-voice)

**Files:**
- Modify: `packages/db/src/voice.ts:11-26` (row), `:66-70` (`PROFILE_COLS`), `:295-307` (`startCallRow`), and the doc comment above `startCallRow` (`:263-294`, one paragraph).
- Modify: `packages/db/src/test/voice.test.ts` (one case beside `:662`).
- Create: `apps/web/src/lib/voice/disclosure.ts`, `apps/web/src/lib/voice/disclosure.test.ts`.
- Modify: `…/incoming/route.ts:1077-1128` (+ import), `…/incoming/route.test.ts`, `…/incoming/lifecycle.test.ts`.
- Modify: every `VoiceProfileRow` literal the web typecheck names (File map), adding `disclosure: "off"`.

**Interfaces:**
- Consumes: Task 1's columns (replica), Task 3's `openingGreeting` third argument and `disclosed`.
- Produces: `DisclosureSetting`, `VoiceProfileRow.disclosure`, `startCallRow(…, { …, disclosed?: boolean })`, `DISCLOSURE_VALUES`, `decideDisclosure(setting) → { disclose, stamp }`.

- [ ] **Step 1: Build your kit** on 55702/55703/55704 with PostgREST (`replica.sh 55702 <dir>`, then `pgrst.sh 55702 55703 55704 <dir>`).

- [ ] **Step 2: Write the failing tests.**

`apps/web/src/lib/voice/disclosure.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const randomIntMock = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt: (...a: unknown[]) => randomIntMock(...a),
}));

import { decideDisclosure, DISCLOSURE_VALUES } from "./disclosure";

beforeEach(() => randomIntMock.mockReset());

describe("decideDisclosure", () => {
  it("off, null and undefined: no sentence, no stamp, and no coin is drawn", () => {
    for (const s of ["off", null, undefined] as const) {
      expect(decideDisclosure(s)).toEqual({ disclose: false, stamp: null });
    }
    expect(randomIntMock).not.toHaveBeenCalled();
  });
  it("on: always says it and stamps true, with no coin (mutation: stamp null for on → FAILS)", () => {
    expect(decideDisclosure("on")).toEqual({ disclose: true, stamp: true });
    expect(randomIntMock).not.toHaveBeenCalled();
  });
  it("trial: crypto.randomInt(2) is the coin, and the stamp is what it decided (mutation: Math.random() < 0.5 → FAILS)", () => {
    randomIntMock.mockReturnValueOnce(1);
    expect(decideDisclosure("trial")).toEqual({ disclose: true, stamp: true });
    randomIntMock.mockReturnValueOnce(0);
    expect(decideDisclosure("trial")).toEqual({ disclose: false, stamp: false });
    expect(randomIntMock.mock.calls).toEqual([[2], [2]]);
  });
  it("lists exactly the three settings the CHECK allows", () => {
    expect(DISCLOSURE_VALUES).toEqual(["off", "trial", "on"]);
  });
});
```

`packages/db/src/test/voice.test.ts`, inside `describe("call handoff accessors", …)` after the `:662` case:

```ts
  it("startCallRow stamps disclosed when given true or false, and leaves it null when not (S-47a; mutation: write disclosed: input.disclosed ?? false → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const said = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, disclosed: true });
      const didnt = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null, disclosed: false });
      const off = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: null });
      const { data, error } = await db.from("calls").select("id, disclosed").in("id", [said.id, didnt.id, off.id]);
      expect(error, `calls select failed: ${error?.message}`).toBeNull();
      const byId = Object.fromEntries((data ?? []).map((r: { id: string; disclosed: boolean | null }) => [r.id, r.disclosed]));
      expect(byId).toEqual({ [said.id]: true, [didnt.id]: false, [off.id]: null });
    });
  });
```

`…/incoming/route.test.ts` — add a partial `node:crypto` mock at the top beside the other hoisted mocks (A4):

```ts
const randomIntMock = vi.hoisted(() => vi.fn(() => 1));
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomInt: (...a: unknown[]) => randomIntMock(...a),
}));
```

reset it in the existing `beforeEach` (`randomIntMock.mockReset().mockReturnValue(1);`), and append:

```ts
describe("POST /api/voice/incoming — saying she is an AI (S-47a)", () => {
  const acceptedInstructions = () => {
    const [, init] = fetchMock.mock.calls[0]!;
    return (JSON.parse(String((init as { body: string }).body)) as { instructions: string }).instructions;
  };
  const DISCLOSED = "IDENTITY — You have already told the caller that you are Sofía, an AI assistant.";
  const OLD = "IDENTITY — Do not volunteer that you are automated";

  it("off (no setting on the row): no stamp named and the old identity line — the existing shape assertion still holds", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1", { phoneNumberId: "pn1", callerE164: "+19562921696" });
    expect(acceptedInstructions()).toContain(OLD);
    expect(randomIntMock).not.toHaveBeenCalled();
  });

  it("on: stamped true and the disclosed identity line (mutation: pass disclosed: false into the prompt → FAILS)", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, disclosure: "on" });
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
      { phoneNumberId: "pn1", callerE164: "+19562921696", disclosed: true });
    expect(acceptedInstructions()).toContain(DISCLOSED);
  });

  it("trial: the coin's answer is both what is stamped and what the prompt says (mutation: stamp true regardless → the 0 case FAILS)", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, disclosure: "trial" });
    randomIntMock.mockReturnValue(0);
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(randomIntMock).toHaveBeenCalledWith(2);
    expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
      { phoneNumberId: "pn1", callerE164: "+19562921696", disclosed: false });
    expect(acceptedInstructions()).toContain(OLD);
  });

  it("a declined call (profile switched off) draws no coin and writes no row", async () => {
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, enabled: false, disclosure: "trial" });
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(randomIntMock).not.toHaveBeenCalled();
    expect(startCallRowMock).not.toHaveBeenCalled();
  });

  it("a failed stamp: the call is still answered as decided, and the log carries ids and the error class only (mutation: add callerNumber to the log → FAILS)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, disclosure: "on" });
    startCallRowMock.mockRejectedValue(new Error("startCallRow failed: boom"));
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(afterMock).toHaveBeenCalledOnce();
    expect(acceptedInstructions()).toContain(DISCLOSED);
    const line = logSpy.mock.calls.find((c) => String(c[1]).startsWith("startCallRow failed"));
    expect(line, "the failure is logged").toBeDefined();
    expect(Object.keys(line![2] as object).sort()).toEqual(["accountId", "callId", "error"]);
    expect(JSON.stringify(line)).not.toContain("+19562921696");
    logSpy.mockRestore();
  });
});
```

(The decline case uses the disabled-profile decline already in this file, `:272`; if that decline returns before the profile's `disclosure` is ever read, the assertion still binds: no coin, no row.)

`…/incoming/lifecycle.test.ts`, inside `describe("runCallLifecycle — Important #4 ①: greeting payload", …)` (`:489`):

```ts
  it("disclosure on: the greeting timer sends the greeting and then the AI sentence (S-47a; mutation: pass disclose: false to openingGreeting → FAILS)", async () => {
    vi.useFakeTimers();
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, disclosure: "on" });
    const { ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const greetingCall = calls.find((c) => String(c[0]).includes("Greet the caller with exactly:"));
    expect(String(greetingCall![0])).toContain(
      "Hi, thanks for calling Rio Roofing. I'm Sofía, an AI assistant. This call is transcribed so the team can follow up.");
  });
```

If `lifecycle.test.ts`'s `PROFILE_ROW` (`:186`) has `languages: "both"`, use the `"both"` JSON-quoted English half instead and say so in the report; the asserted words do not change. If `lifecycle.test.ts` needs the same `node:crypto` partial mock for `trial`, it does not: this case uses `on`.

- [ ] **Step 3: Run to verify failures.** Web: `pnpm --filter web exec vitest run src/lib/voice/disclosure.test.ts "src/app/api/voice/incoming/route.test.ts" "src/app/api/voice/incoming/lifecycle.test.ts"` → the new cases FAIL. DB (on `post`, `source <dir>/env-run.sh`): `node node_modules/vitest/vitest.mjs run src/test/voice.test.ts -t "startCallRow stamps"` → FAIL; read the run count (1 test).

- [ ] **Step 4: Implement.**

`packages/db/src/voice.ts` — above `export type VoiceProfileRow` (`:11`):

```ts
/** 0093. Off / Trial / On (spec S-47a §4): the TypeScript twin of voice_profiles_disclosure_check. */
export type DisclosureSetting = "off" | "trial" | "on";
```

in `VoiceProfileRow`, after `forward_calls: boolean;` (`:25`):

```ts
  /** 0093. Whether Sofía says she is an AI right after the greeting. Agency-written through serviceDb()
   *  by saveVoiceProfileAction; authenticated has SELECT only (0020). */
  disclosure: DisclosureSetting;
```

`PROFILE_COLS` (`:66-70`) last line becomes `"public_id, concierge_enabled, concierge_form_id, forward_calls, disclosure";`.

`startCallRow` (`:295-307`):

```ts
export async function startCallRow(
  db: SupabaseClient, accountId: string,
  input: { phoneNumberId: string; callerE164: string | null; handoffToken?: string; disclosed?: boolean },
): Promise<{ id: string }> {
  const { data, error } = await db.from("calls")
    .insert({
      account_id: accountId, phone_number_id: input.phoneNumberId, caller_e164: input.callerE164,
      ...(input.handoffToken === undefined ? {} : { handoff_token: input.handoffToken }),
      ...(input.disclosed === undefined ? {} : { disclosed: input.disclosed }),
    })
    .select("id").single();
  if (error || !data) throw new Error(`startCallRow failed: ${error?.message}`);
  return { id: (data as { id: string }).id };
}
```

and one paragraph at the end of its doc comment: "`disclosed` (0093, S-47a) is named only when the profile was Trial or On, the same deployment-ordering reason as the token: an Off account's insert is byte-identical to before, and 0093 goes to both projects before the build that sends it."

`apps/web/src/lib/voice/disclosure.ts`:

```ts
// S-47a (decision 20): does Sofía say she is an AI on THIS call? Decided once, at call start, by the
// incoming route, and stamped on the call row it already writes. Server only (node:crypto).
import { randomInt } from "node:crypto";
import type { DisclosureSetting } from "@bis/db";

/** The three settings, in the order the Voice page shows them. The twin of voice_profiles_disclosure_check. */
export const DISCLOSURE_VALUES = ["off", "trial", "on"] as const satisfies readonly DisclosureSetting[];

/** `disclose`: say the sentence and use the disclosed identity line. `stamp`: what `calls.disclosed`
 *  gets — null for Off, so an Off call is never counted in the results. */
export type DisclosureDecision = { disclose: boolean; stamp: boolean | null };

/**
 * Off (and any value a stale or missing read hands us): no. On: yes. Trial: a fair coin from
 * `crypto.randomInt`, never `Math.random` (spec §5.1), whose answer is both what is said and what is
 * stamped, so the two halves the results card compares are the calls that heard it and the calls that did not.
 */
export function decideDisclosure(setting: DisclosureSetting | null | undefined): DisclosureDecision {
  if (setting === "on") return { disclose: true, stamp: true };
  if (setting === "trial") {
    const heads = randomInt(2) === 1;
    return { disclose: heads, stamp: heads };
  }
  return { disclose: false, stamp: null };
}
```

`…/incoming/route.ts`:
- imports: add `import { decideDisclosure } from "@/lib/voice/disclosure";` and `import { loggableError } from "@/lib/loggable-error";`.
- Before step 10's comment (`:1077`), insert:

```ts
    // --- Step 9c: does Sofía say she is an AI on this call (S-47a) --------
    // After every gate, so a declined call never draws the coin and is never
    // stamped. The answer drives three things together: the stamp on the
    // row below, the sentence after the greeting, and the identity line.
    const disclosure = decideDisclosure(profile.disclosure);
```

- In step 10's `startCallRow` call (`:1090-1093`) add `...(disclosure.stamp === null ? {} : { disclosed: disclosure.stamp }),` after the `handoffToken` spread.
- Step 10's catch (`:1096`) becomes `log("startCallRow failed — proceeding without a row", { callId, accountId, error: loggableError(e) });` (ids and the error's class/code/redacted message; the caller number never reaches it). Add one comment line: "The call goes on as decided; with no row it is simply left out of the results (spec §5.1)."
- `:1118` (Task 3's line) becomes `const opening = openingGreeting(profile, businessName, { disclose: disclosure.disclose, personaName: profile.persona_name });`.
- `promptInput` (`:1120-1127`) gains `disclosed: disclosure.disclose,` after `handoffAvailable`.

Every `VoiceProfileRow` literal: run `pnpm --filter web typecheck` and add `disclosure: "off"` to each literal it names (and to the two e2e specs' literals, which typecheck under the web project too). `…/voice/voice-settings.tsx`'s `DEFAULT_PROFILE` (`:34-41`) gains `disclosure: "off",` after `forward_calls: false`.

- [ ] **Step 5: Run to verify passes.** The three web files and the db case → PASS. Then the neighbours, unchanged: `src/lib/voice/` files named one by one (`greeting`, `system-prompt`, `session-config`, `tools/registry`), `src/app/api/voice/texml/route.test.ts`, `…/texml/screen/route.test.ts`, `…/texml/wellformed.test.ts`, `…/voice/page.test.ts`, `…/voice/voice-settings.test.ts`, `…/c/data.test.ts`, `…/c/layout.test.ts`, `…/c/page.test.ts`. DB on `post`: `src/test/voice.test.ts` whole, `src/test/voice-forward-grants.test.ts`, `src/test/concierge.test.ts`.

- [ ] **Step 6: Run each mutation** named above (5 web, 1 db), paste each failing line, revert, `cmp`.

- [ ] **Step 7:** Both typechecks green; eslint on touched files. Commit `voice: each call decides at its start whether Sofía says she is an AI (a fair coin on Trial), says it after the greeting and stamps the call; a failed stamp never drops the call (S-47a)` with the trailers, naming every path. Stop your kit (Task 6 reuses the ports).

**Review (MEDIUM):** one sonnet bis-reviewer on 55705/55706/55707. It proves the fail-open claim (the Tiers note), reads the route from step 7 to step 13 for any new `await` or throw between the decision and `acceptCall`, re-runs the coin mutation, and checks no `PROFILE_COLS` reader outside `voice.ts`/`concierge.ts` builds its own select list.

---

## Task 5 (LOW): The website chat (bis-voice)

**Files:**
- Modify: `…/c/page.tsx:1-12` (imports), `:95-154`; `…/c/page.test.ts`
- Modify: `…/c/concierge-chat.tsx:292-315` (props), `:485-507` (render); `…/c/concierge-chat.test.ts`
- Modify: `…/c/concierge.css` (after `.bis-concierge-header .bis-brand`, `:109-113`)
- Modify: `…/turn/route.ts:430-450`; `…/turn/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `concierge.aiLabel`, `concierge.aiIntro`; Task 4's `profile.disclosure`; Task 3's `disclosed`.
- Produces: `ConciergeChat` prop `aiLabel?: string | null`.

**Behaviour (spec §5.2, D4):** Trial or On → the label line and the intro sentence; no coin on the web. Off → the page renders byte-for-byte as today (no label element; the greeting alone).

- [ ] **Step 1: Write the failing tests.**

In `…/c/page.test.ts` (it renders the page with a mocked profile; reuse its existing profile builder and render helper), add cases:
1. `disclosure: "on"`, `persona_name: "Sofía"`, locale en → the markup contains `Sofía · AI assistant` and the first assistant message text equals `<greeting_en> I'm Sofía, an AI assistant. This chat is saved so the team can follow up.` (typed out).
2. `disclosure: "trial"`, `?locale=es` → `Sofía · asistente de IA` and `<greeting_es> Soy Sofía, una asistente de inteligencia artificial. Este chat se guarda para que el equipo le dé seguimiento.`
3. `disclosure: "off"` → no `data-ai-label` attribute anywhere, and the greeting prop equals `greeting_en` exactly. **Mutation:** treat `"off"` as disclosing → FAILS.
4. A blank greeting with `"on"` → the first message is the intro sentence alone (no leading space).

In `…/c/concierge-chat.test.ts` (static render): with `aiLabel="Sofía · AI assistant"` and `bare` true and no `brand`, the label renders (`data-ai-label`), so a framed Ask-BIS panel still says it; with `aiLabel` absent, no `data-ai-label`. **Mutation:** render the label only inside the header row → the bare case FAILS.

In `…/turn/route.test.ts`: with the mocked profile's `disclosure: "on"` the system message sent to the model (the existing capture of the chat-completions body) contains `IDENTITY — You have already told the visitor that you are`; with `"off"` it contains `IDENTITY — Do not volunteer`. **Mutation:** pass `disclosed: false` always → FAILS.

- [ ] **Step 2:** Run the three test files → new cases FAIL.

- [ ] **Step 3: Implement.**

`…/c/page.tsx`: import `t` from `@/lib/i18n/t` and `m` from `@/lib/messages`. After `const greeting = …` (`:100`):

```ts
  // S-47a (spec §5.2, D4): on Trial or On the chat always says it is an AI — the label and the first
  // message — with no coin; the web has no halves to compare. Off renders exactly as before.
  const saysAi = profile.disclosure === "trial" || profile.disclosure === "on";
  const persona = profile.persona_name.trim() || "Sofía";
  const aiLabel = saysAi ? t(m, "concierge.aiLabel", locale, { persona }) : null;
  const firstMessage = saysAi
    ? [greeting.trim(), t(m, "concierge.aiIntro", locale, { persona })].filter(Boolean).join(" ")
    : greeting;
```

pass `greeting={firstMessage}` and `aiLabel={aiLabel}` to `<ConciergeChat>`.

`…/c/concierge-chat.tsx`: add `aiLabel = null` to the destructured props and to the prop type:

```ts
  /** S-47a: "{persona} · AI assistant" on Trial or On, null otherwise. Drawn as its own line at the top of
   *  the panel in EVERY mode — a bare framed panel drops the header row, and the label must not go with it. */
  aiLabel?: string | null;
```

and render it immediately after the header row's closing `)}` (`:507`), before `<ol className="bis-concierge-log"…>`:

```tsx
      {aiLabel ? <p className="bis-concierge-ai-label" data-ai-label="">{aiLabel}</p> : null}
```

`…/c/concierge.css` after `:113`:

```css
/* S-47a: the AI label. Muted text on the panel's own surface, tokens only (the fallbacks are the
   tokens' own light values, as every rule in this file carries). */
.bis-concierge-ai-label {
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--muted-foreground, #71717a);
}
```

`…/turn/route.ts`: in the `buildSystemPrompt({...})` input (`:430-450`) add, after `medium: "web",`:

```ts
      // S-47a: on Trial or On the visitor has already read the label and the first message.
      disclosed: profile.disclosure === "trial" || profile.disclosure === "on",
```

- [ ] **Step 4:** Re-run → PASS; run each mutation; run `…/c/layout.test.ts`, `…/c/data.test.ts`, `src/lib/concierge/strings.test.ts` unchanged → PASS.
- [ ] **Step 5:** Typecheck, eslint. Commit `chat: the website chat says it is an AI on Trial or On — a label and the first message — and its identity line matches (S-47a)` with the trailers, naming every path.

---

## Task 6 (LOW): The results read and its view (bis-voice)

**Files:**
- Modify: `packages/db/src/voice.ts` (append `getDisclosureResults` and its two types after `startCallRow`)
- Create: `packages/db/src/test/disclosure-results.test.ts`
- Create: `apps/web/src/lib/voice/disclosure-results.ts`, `apps/web/src/lib/voice/disclosure-results.test.ts`

**Interfaces:**
- Consumes: Task 1's columns; Task 4's `voice.ts`.
- Produces: `getDisclosureResults(db, accountId): Promise<DisclosureResults>`; `disclosureResultsView(r)`, `DISCLOSURE_MIN_PER_HALF`.

- [ ] **Step 1: Kit** on 55702/55703/55704 (Task 4 stopped it).

- [ ] **Step 2: Write the failing tests.**

`packages/db/src/test/disclosure-results.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { assignPhoneNumber, getDisclosureResults } from "../voice";

type Row = { disclosed: boolean | null; outcome: string; ended: boolean };

async function seedCalls(db: SupabaseClient, accountId: string, rows: Row[]): Promise<void> {
  const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
  const { error } = await db.from("calls").insert(rows.map((r) => ({
    account_id: accountId, phone_number_id: num.id, disclosed: r.disclosed, outcome: r.outcome,
    ended_at: r.ended ? "2026-10-20T15:00:00Z" : null,
  })));
  if (error) throw new Error(`seed calls failed: ${error.message}`);
}

const A: Row[] = [
  // said it: 4 counted (2 booked, 1 abandoned, 1 lead), 1 spam, 1 still in progress
  { disclosed: true, outcome: "booked", ended: true },
  { disclosed: true, outcome: "booked", ended: true },
  { disclosed: true, outcome: "abandoned", ended: true },
  { disclosed: true, outcome: "lead", ended: true },
  { disclosed: true, outcome: "spam", ended: true },
  { disclosed: true, outcome: "abandoned", ended: false },
  // didn't: 3 counted (3 abandoned), 1 spam
  { disclosed: false, outcome: "abandoned", ended: true },
  { disclosed: false, outcome: "abandoned", ended: true },
  { disclosed: false, outcome: "abandoned", ended: true },
  { disclosed: false, outcome: "spam", ended: true },
  // before the trial / an Off account: 2 finished, 1 in progress (A7: never counted anywhere)
  { disclosed: null, outcome: "booked", ended: true },
  { disclosed: null, outcome: "message", ended: true },
  { disclosed: null, outcome: "abandoned", ended: false },
];

describe("getDisclosureResults", () => {
  it("counts finished stamped non-spam calls per half; spam, null and unfinished are excluded; the footnote counts spam + null (mutations: drop .neq('outcome','spam') → FAILS; drop the ended_at filter → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId, A);
      expect(await getDisclosureResults(db, accountId)).toEqual({
        said: { counted: 4, booked: 2, abandoned: 1 },
        didnt: { counted: 3, booked: 0, abandoned: 3 },
        notCounted: 4, // 1 spam (said) + 1 spam (didn't) + 2 finished nulls
      });
    });
  });

  it("another account's stamped calls are never counted (mutation: drop .eq('account_id') → FAILS)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        await seedCalls(db, accountA, [{ disclosed: true, outcome: "booked", ended: true }]);
        await seedCalls(db, accountB, A);
        expect(await getDisclosureResults(db, accountA)).toEqual({
          said: { counted: 1, booked: 1, abandoned: 0 },
          didnt: { counted: 0, booked: 0, abandoned: 0 },
          notCounted: 0,
        });
      });
    });
  });

  it("an account with no calls reads all zeros", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getDisclosureResults(db, accountId)).toEqual({
        said: { counted: 0, booked: 0, abandoned: 0 }, didnt: { counted: 0, booked: 0, abandoned: 0 }, notCounted: 0,
      });
    });
  });
});
```

(If `calls` refuses `outcome: "lead"` or `"message"`, read `calls_outcome_check` — 0037 widened it — and use a value it allows; say so.)

`apps/web/src/lib/voice/disclosure-results.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { disclosureResultsView, DISCLOSURE_MIN_PER_HALF } from "./disclosure-results";

const half = (counted: number, booked = 0, abandoned = 0) => ({ counted, booked, abandoned });

describe("disclosureResultsView", () => {
  it("is empty when neither half has a counted call, whatever the footnote says", () => {
    expect(disclosureResultsView({ said: half(0), didnt: half(0), notCounted: 12 })).toEqual({ state: "empty" });
  });
  it("percentages are whole numbers of the half's own counted calls (37.5 rounds to 38; 1/3 to 33)", () => {
    expect(disclosureResultsView({ said: half(8, 3, 1), didnt: half(3, 1, 1), notCounted: 2 })).toEqual({
      state: "loaded",
      said: { counted: 8, bookedPct: 38, hungUpPct: 13 },
      didnt: { counted: 3, bookedPct: 33, hungUpPct: 33 },
      notEnough: true, notCounted: 2,
    });
  });
  it("a half with no counted calls shows no percentage, not 0%", () => {
    const v = disclosureResultsView({ said: half(2, 1, 0), didnt: half(0), notCounted: 0 });
    expect(v).toMatchObject({ state: "loaded", didnt: { counted: 0, bookedPct: null, hungUpPct: null } });
  });
  it("the threshold is 30 per half, and BOTH halves must reach it (mutations: >= → > FAILS at 30/30; && → || FAILS at 30/29)", () => {
    expect(DISCLOSURE_MIN_PER_HALF).toBe(30);
    const at = (a: number, b: number) => disclosureResultsView({ said: half(a), didnt: half(b), notCounted: 0 });
    expect(at(30, 30)).toMatchObject({ notEnough: false });
    expect(at(30, 29)).toMatchObject({ notEnough: true });
    expect(at(29, 30)).toMatchObject({ notEnough: true });
    expect(at(29, 29)).toMatchObject({ notEnough: true });
  });
});
```

- [ ] **Step 3:** Run both → FAIL.

- [ ] **Step 4: Implement.** Append to `packages/db/src/voice.ts`:

```ts
/** S-47a's results card: one half of the calls. `counted` = finished, stamped, not spam. */
export type DisclosureHalf = { counted: number; booked: number; abandoned: number };
export type DisclosureResults = { said: DisclosureHalf; didnt: DisclosureHalf; notCounted: number };

/**
 * The agency's results card on the Voice page (spec §5.3). Head counts, never a row fetch: PostgREST caps
 * a select at its max-rows, which would silently cut a long trial short. A finished call is one with
 * `ended_at` set (finishCallRow): `outcome` defaults to 'abandoned' at insert (0019), so an unfinished
 * call would otherwise read as hung up. A null count is a failure, never zero (memory "Head-count null").
 */
export async function getDisclosureResults(db: SupabaseClient, accountId: string): Promise<DisclosureResults> {
  const finished = () => db.from("calls").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).not("ended_at", "is", null);
  async function n(label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
    const { count, error } = await q;
    if (error) throw new Error(`getDisclosureResults ${label} failed: ${error.message}`);
    if (count === null) throw new Error(`getDisclosureResults ${label}: no count returned`);
    return count;
  }
  async function half(disclosed: boolean, label: string): Promise<DisclosureHalf> {
    const [counted, booked, abandoned] = await Promise.all([
      n(`${label}.counted`, finished().eq("disclosed", disclosed).neq("outcome", "spam")),
      n(`${label}.booked`, finished().eq("disclosed", disclosed).eq("outcome", "booked")),
      n(`${label}.abandoned`, finished().eq("disclosed", disclosed).eq("outcome", "abandoned")),
    ]);
    return { counted, booked, abandoned };
  }
  const [said, didnt, notCounted] = await Promise.all([
    half(true, "said"), half(false, "didnt"),
    n("notCounted", finished().or("disclosed.is.null,outcome.eq.spam")),
  ]);
  return { said, didnt, notCounted };
}
```

`apps/web/src/lib/voice/disclosure-results.ts`:

```ts
// S-47a §5.3: the results card's numbers, decided here and rendered by disclosure-results-view.tsx.
// Pure. Never a verdict: it says when there is too little to tell, and otherwise shows the numbers only.
import type { DisclosureResults, DisclosureHalf } from "@bis/db";

/** Below this many counted calls in EITHER half, the card says there is not enough to tell. */
export const DISCLOSURE_MIN_PER_HALF = 30;

export type DisclosureColumnView = { counted: number; bookedPct: number | null; hungUpPct: number | null };
export type DisclosureResultsView =
  | { state: "empty" }
  | { state: "loaded"; said: DisclosureColumnView; didnt: DisclosureColumnView; notEnough: boolean; notCounted: number };

const pct = (part: number, of: number): number | null => (of === 0 ? null : Math.round((100 * part) / of));

function column(h: DisclosureHalf): DisclosureColumnView {
  return { counted: h.counted, bookedPct: pct(h.booked, h.counted), hungUpPct: pct(h.abandoned, h.counted) };
}

export function disclosureResultsView(r: DisclosureResults): DisclosureResultsView {
  if (r.said.counted === 0 && r.didnt.counted === 0) return { state: "empty" };
  return {
    state: "loaded",
    said: column(r.said), didnt: column(r.didnt),
    notEnough: r.said.counted < DISCLOSURE_MIN_PER_HALF || r.didnt.counted < DISCLOSURE_MIN_PER_HALF,
    notCounted: r.notCounted,
  };
}
```

- [ ] **Step 5:** Re-run → PASS (db on `post` via `source <dir>/env-run.sh`). Run each named mutation (4), revert, `cmp`. `pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck`, eslint. Commit `voice: how calls went with and without saying it's an AI, counted per half from finished non-spam calls of this account only (S-47a)` with the trailers, naming the four paths. Stop your kit.

---

## Task 7 (LOW): The Voice page — the setting and the results card (bis-frontend)

**Files:**
- Modify: `…/voice/page.tsx` (imports; locale; copy; the card slot), `…/voice/page.test.ts`
- Modify: `…/voice/voice-settings.tsx` (`VoiceProfileForm` `:52-299`; `VoiceSettings` `:989-1036`), `…/voice/voice-settings.test.ts`
- Modify: `…/voice/actions.ts:63-140`, `…/voice/actions.test.ts`
- Create: `…/voice/disclosure-results-view.tsx` (server-safe, NO `"use client"`), `…/voice/disclosure-results-card.tsx` (async server component), `…/voice/disclosure-results-view.test.ts`
- Modify: `…/styleguide/page.tsx`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated)

**Interfaces:**
- Consumes: Task 2's keys; Task 4's `DISCLOSURE_VALUES`, `VoiceProfileRow.disclosure`; Task 6's `getDisclosureResults`, `disclosureResultsView`.
- Produces: the form field `disclosure` (radio, values `off|trial|on`); `VoiceSettings` props `disclosureCopy: DisclosureCopy` and `disclosureResults: ReactNode`.

**Shape:**
- **The setting** sits inside `VoiceProfileForm`, after the text-back block and before its one primary Save (`:296`), so the card keeps exactly one primary (rule 8). A `<fieldset role="radiogroup">` with a `<legend>` (`voice.disclosure.legend`) and, per option, a `<label>` holding ONLY `<input type="radio" name="disclosure" value=… aria-describedby={hintId}>` and the option word, then the hint as its own `<p id={hintId} className="text-xs text-muted-foreground">` (so the radio's accessible name is exactly "Off"/"Trial"/"On" and the e2e's exact role names hold; the hint is its description). `defaultChecked={p.disclosure === value}`; controls `min-h-11 md:min-h-8` (the `sending-address-card.tsx:124-140` markup). Under it one muted line, `voice.disclosure.nextCall`. `lang={disclosureCopy.locale}` on the fieldset.
- **The copy** is built on the server (`page.tsx`) with `makeTr(locale, pseudo)` and passed in as plain strings (the client component never imports `makeTr`'s locale logic):

```ts
export type DisclosureCopy = {
  locale: "en" | "es";
  legend: string; nextCall: string;
  options: Array<{ value: "off" | "trial" | "on"; label: string; hint: string }>;
};
```

- **The locale** (the call page precedent, `…/calls/[callId]/page.tsx:181-183`): `const accountLanguage = { language: account.language ?? null }; const locale = requestLocale({ account: accountLanguage, isOperator: true, userLanguage: prefs.language }, { locale: localeParam });` — a NAMED variable, because `apps/web/src/lib/i18n/request-locale-callers.test.ts` scans each call's braces. Read the account's `language` in the page's existing `Promise.all`; read `getPersonPrefs` as the call page does. Only the new setting and card use it; the rest of the page stays English (agency tooling, decision 2).
- **The action** (`actions.ts:63-140`): after the `afterHours` parse (`:70`):

```ts
  // S-47a: absent → leave the stored setting alone (a form that does not carry it, e.g. a Setup step,
  // must never reset it); present → one of the three, or the save is refused.
  const disclosureRaw = formData.get("disclosure");
  const disclosure = disclosureRaw === null ? undefined : pickOne(String(disclosureRaw), DISCLOSURE_VALUES);
  if (disclosure === null) return { ok: false, error: m["voice.profile.saveFailed"] };
```

and in `patch` add `...(disclosure === undefined ? {} : { disclosure }),`. Import `DISCLOSURE_VALUES` from `@/lib/voice/disclosure`. The `voice_profile.updated` event's `fields` then names `disclosure` with the actor (`upsertVoiceProfile`, `voice.ts:168-194`).
- **The card** (`disclosure-results-card.tsx`, async): reads `getDisclosureResults(serviceDb(), accountId)` (the page's one client, `page.tsx:26-32`) inside try/catch; on throw logs `console.error(\`voice: disclosure results read failed for account ${accountId}: ${loggableError(e)}\`)` and renders the view's error state; otherwise renders `<DisclosureResultsView view={disclosureResultsView(r)} tr={tr} accountId={accountId} />`. `page.tsx` wraps it in `<Suspense fallback={<DisclosureResultsSkeleton />}>` (rule 7: a skeleton shaped like the card — title bar, two columns of three rows) and passes that node as `disclosureResults`; `VoiceSettings` renders it directly after `<VoiceProfileForm …/>` (`:1023`).
- **The view** (`disclosure-results-view.tsx`, exports `DisclosureResultsView` and `DisclosureResultsSkeleton`; props `{ view: DisclosureResultsView | { state: "error" }; tr: Tr; accountId: string }`): a `Card` (the shadcn card already on the page; tokens only, `rounded-[var(--radius-card)]` as the page's other cards), `lang={tr.locale}`, `data-disclosure-results=""`. Title `voice.disclosure.results.title`, description `voice.disclosure.results.period` (rule 1's period label). States:
  - `empty`: one line `…results.empty`, then `…results.emptyAction`. No numbers.
  - `error`: `…results.error` and a ghost `common.retry` link to `/dashboard/accounts/${accountId}/voice`.
  - `loaded`: a two-column grid (`grid grid-cols-2 gap-4`), headings `…results.said` / `…results.didnt` (`data-half="said"` / `"didnt"`), each with three rows: `…results.counted` → the count; `…results.booked` → `…results.percent` with `{percent}` or `…results.noneYet` when null; `…results.hungUp` likewise. Numbers `tabular-nums`, text-coloured; **no `data-hero`, no gradient** (rule 11). Then `…results.notEnough` when `notEnough`, and the footnote `tr.count("voice.disclosure.results.notCounted", notCounted)` in muted small text when `notCounted > 0`. No sentence ever compares the halves.
  - No buttons at all except the error state's ghost Retry (rule 8: the card has no primary).

- [ ] **Step 1: Write the failing tests.**
  - `disclosure-results-view.test.ts` (`renderToStaticMarkup`, the `renderedText()` helper from `apps/web/src/lib/rendered-text.ts` for text):
    1. loaded `{ said: {counted: 8, bookedPct: 38, hungUpPct: 13}, didnt: {counted: 3, bookedPct: 33, hungUpPct: 33}, notEnough: true, notCounted: 2 }`, en → the said column's text contains `Calls counted`, `8`, `38%`, `13%`; the didnt column `3`, `33%`; the line `Not enough calls yet to tell.`; the footnote `2 calls not counted (spam, or before the trial)`.
    2. Same in `es` → `Dijo que era IA`, `38 %`, `Todavía no hay suficientes llamadas para saberlo.`, `2 llamadas no contadas (spam, o de antes de la prueba)`; `lang="es"` on the card.
    3. `notEnough: false`, `notCounted: 1` → no `Not enough` line; footnote `1 call not counted (spam, or before the trial)`. **Mutation:** render the not-enough line unconditionally → FAILS.
    4. A null percentage renders `No calls yet`, never `0%`.
    5. `empty` → `No calls since the trial started.` and `Choose Trial or On above and save.`; no digit `%`.
    6. `error` → `Couldn't load how calls went.` and one ghost link named `Retry`.
    7. In every state: no `data-hero`, no element with `variant="default"`/primary button class, and no text matching `/better|worse|winner|won|lost/i`. **Mutation:** add a primary button → FAILS.
  - `voice-settings.test.ts`: `VoiceProfileForm` with `p.disclosure = "trial"` and an English `DisclosureCopy` renders three radios named `disclosure` with values `off`,`trial`,`on`, exactly the `trial` one `checked`, the three hints, the next-call line, and still exactly ONE primary button in the card (the Save). **Mutation:** give the fieldset its own primary Save → FAILS.
  - `actions.test.ts` (its existing mocks of `requireAccountAccess` and `upsertVoiceProfile`): `disclosure=on` → the patch carries `disclosure: "on"`; field absent → the patch has NO `disclosure` key (**mutation:** default an absent field to `"off"` → FAILS); `disclosure=maybe` → `{ ok: false, error: m["voice.profile.saveFailed"] }` and no write; a client (isAgency false) → `voice.agencyOnly` and no write, with `disclosure=on` in the form.
  - `page.test.ts`: the page renders the setting with the profile's value checked and passes a `disclosureResults` node (add `getDisclosureResults` to its bare `@bis/db` factory per the Global constraints grep; the read's rejection renders the error state, not a page error).
- [ ] **Step 2:** Run the four files → FAIL.
- [ ] **Step 3:** Implement as the Shape above.
- [ ] **Step 4:** Re-run → PASS; run the named mutations; revert; `cmp`.
- [ ] **Step 5: Styleguide.** Add a "Saying it's an AI" section to `…/styleguide/page.tsx` with `DisclosureResultsView` specimens: loaded with not-enough, loaded past 30, empty, error, the skeleton — each in English, Spanish and pseudo (`makeTr(locale, true)`). Specimen data are typed literals in the styleguide page, not computed by a client module.
- [ ] **Step 6: Baselines.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`. Read the diff line by line: it may only REMOVE entries or leave the files unchanged (every new key is twinned; the new `.tsx` carries no JSX literal copy). Any added entry is a finding: fix the copy, never the baseline.
- [ ] **Step 7:** `pnpm --filter web typecheck`; eslint on every touched file; run `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `src/components/ui/material.test.ts`. Commit `ui: the Voice page's Off / Trial / On choice for saying Sofía is an AI, saved with the page's own Save, and how calls went in each half, English and Spanish (S-47a)` with the trailers, naming every path.

---

## Task 8 (LOW): The e2e spec (bis-e2e-qa)

**Files:** Create `apps/web/e2e/ai-disclosure.spec.ts`.

**Rules:** fixture account only (`e2e/.auth/client-fixture.json`, read as `forward-calls.spec.ts:40-48` does); skip with a reason when absent; `test.describe.configure({ mode: "serial", timeout: 60_000 })`; workers are 1 (`playwright.config.ts:171`). Check A5 first.

**Setup (`beforeAll`, service client; restored in `afterAll`, the `concierge.spec.ts:123-170` and `:172-215` shape):** capture the fixture's voice profile (`getVoiceProfile`, a null IS a captured state) and branding; create and publish a form; `upsertVoiceProfile` with `persona_name: "Sofía"`, `greeting_en: "Hello from the workshop."`, `greeting_es: "Hola desde el taller."`, `languages: "en"`, `enabled: false`, `disclosure: "on"`; `enableConcierge`. Assign one fake number (`+999…`, the `testPhoneNumber` shape the db fixtures use, made unique per run) and insert two FINISHED calls on it: `{ disclosed: true, outcome: "booked", ended_at: now }`, `{ disclosed: false, outcome: "abandoned", ended_at: now }`.

**`afterAll`:** delete the two calls, then the number, then the form; restore the profile exactly (delete the row if there was none); each `error` checked; re-read each and assert gone/restored.

**Tests:**
1. **Chat, English:** `/c/<publicId>` → `page.locator("[data-ai-label]")` has text `Sofía · AI assistant`; the first `.bis-msg-assistant` has text `Hello from the workshop. I'm Sofía, an AI assistant. This chat is saved so the team can follow up.`
2. **Chat, Spanish:** `/c/<publicId>?locale=es` → `Sofía · asistente de IA`; first message `Hola desde el taller. Soy Sofía, una asistente de inteligencia artificial. Este chat se guarda para que el equipo le dé seguimiento.`
3. **Chat, off:** set `disclosure: "off"` (service client), reload → `[data-ai-label]` count 0 and the first message is exactly `Hello from the workshop.`; set it back to `"on"`.
4. **Agency:** `/dashboard/accounts/<id>/voice` (default agency session) → inside `page.getByRole("main")`: the radio `{ name: "On", exact: true }` is checked; the card `[data-disclosure-results]` shows `[data-half="said"]` containing `1` and `100%`, `[data-half="didnt"]` containing `1` and `100%` (its one call hung up), and `Not enough calls yet to tell.`; choose `Trial`, press the profile card's Save, toast, then `expect.poll(() => getVoiceProfile(db, id).then((p) => p?.disclosure))` → `"trial"`.
5. **Client Owner** (`test.use({ storageState: "e2e/.auth/client-state.json" })` in its own `describe`): `page.goto(/dashboard/accounts/<id>/voice)` → the URL ends `/dashboard/accounts/<id>/dashboard` (A6), and `getByText("Tell callers", { exact: false })` has count 0. Then read the profile: `disclosure` is unchanged by the visit.

- [ ] `pnpm --filter web exec playwright test --list e2e/ai-disclosure.spec.ts` (5 tests listed), `pnpm --filter web typecheck`, eslint. Commit `e2e: the website chat says it is an AI in English and Spanish and not when off; the agency sets Trial and sees both halves; a client Owner never reaches the setting (S-47a)` with the trailers.

---

## Task 9: Final review, design review, one fix agent (checkpoint)

- [ ] **bis-reviewer, opus, fresh context,** on `git diff 09684fea...HEAD` (replica 55701/55708/55709). Read spec §§4-8 and this plan. Run every touched test file by path, both typechecks, `ai-disclosure-schema`, `voice`, `disclosure-results`, `voice-forward-grants`, `schema-grants-guard` and `server-only-writes-grants` on `post`. Re-check 0093's md5 against Task 1's. Three probes of its own: one coin probe (`Math.random`), one second-account probe in `getDisclosureResults`, one byte-identity probe (a stray space in the off greeting). **Hunt:**
  - an Off call whose prompt, greeting or insert differs from before by one byte;
  - a coin drawn before a gate, or drawn twice for one call;
  - a stamp that disagrees with what was said;
  - a log carrying a caller number, a greeting or a transcript word;
  - the browser demo's prompt changed;
  - a client path that can write `disclosure` (an action without the agency check, an `authenticated` grant);
  - the card counting spam, nulls, unfinished calls or another account's calls, or saying which half "won";
  - an e2e locator another element could satisfy; a vacuous test.
- [ ] **bis-design-reviewer, opus,** on Tasks 5 and 7's diffs, with a running build if the orchestrator provides one (source audit otherwise): tokens only; both themes via `.dark`; the blur fallback (the card adds no blur); rule 1 (the period label), rule 5 (loaded/empty/error, and the skeleton, rule 7), rule 8 (the profile card still has one primary; the results card none), rule 11 (no hero); the chat label in a tenant-themed chat in light and dark and in the bare framed panel; 360 px pseudo for the radio hints and the two columns; the 7 AM read of every line in both languages.
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items, then one sonnet fix-review. **0093 goes to production only with its reviewed md5 UNCHANGED.** Once 0093 is on bis-ci it is never edited: any SQL change found after that is a new migration (0094), reviewed HIGH.

---

## Task 10: Rollout (orchestrator)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **1. bis-ci 0093** (after Task 1's review approves): `gh workflow run ci-project-setup.yml --ref feat/s47a-disclosure -f step=push-dry-run`; its log lists exactly `0093_ai_disclosure.sql`. Then `-f step=push`. Read-only post-checks: the two columns' `data_type`/`is_nullable`/`column_default`; `select pg_get_constraintdef(oid) from pg_constraint where conname = 'voice_profiles_disclosure_check'`; `select count(*) from public.voice_profiles where disclosure <> 'off'` → `0`; the digest UNCHANGED. If a Preview read of a voice profile then fails naming `disclosure`, PostgREST's schema cache is stale: `notify pgrst, 'reload schema'` once on bis-ci, then re-read. Ledger: `0093 APPLIED to bis-ci … NEVER RE-APPLY`.
- [ ] **2. Push and CI.** Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`); `ai-disclosure.spec.ts` must have run. Then the local gates one at a time, after checking no `screenshots.yml` run is in progress.
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One): the Voice page's setting and card in both themes, English (agency default) and Spanish (`?locale=es`), at 360 px; the chat label on a themed and an unthemed chat, framed and direct.
- [ ] **4. Production 0093** (MCP `apply_migration`, `tlbkbmlrfafquucsmsmm`, name `ai_disclosure`, the exact reviewed text, ONCE), BEFORE the merge. Pre-flight: `max(version)` = Task 0's. Post: the same reads as step 1, and `count(*) where disclosure <> 'off'` = `0`. Ledger: `0093 APPLIED to production … NEVER RE-APPLY`.
- [ ] **5. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md`): `-f step=fingerprint` on bis-ci, `packages/db/supabase/parity/fingerprint.sql` on production; equal on both columns and the CHECK.
- [ ] **6. PR and merge.** The body names D1–D4 (owner-approved), the ambiguities resolved below, both apply lines, the tiers, and "No env var changes; nothing added to Preview". Merge with the head SHA's `verify` and `e2e` green: `gh pr merge <n> --squash --match-head-commit <sha>`.
- [ ] **7. After the deploy:** the deployment is READY on the merge SHA and aliased to `app.bis-rgv.com`; smokes `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
- [ ] **8. BIS's own line On** (spec §8 step 2): on production, as the agency, open BIS's Voice page, choose **On**, Save. Read-check (read-only MCP): `select disclosure from public.voice_profiles where account_id = '<BIS id from Task 0>'` → `on`, and the newest `voice_profile.updated` event for that account names `disclosure` in `payload.fields` with the owner's actor id. (A direct SQL update is the fallback only if the UI save fails; then it is one `update … set disclosure = 'on' where account_id = '<id>' returning disclosure`, read back, and the ledger says why.)
- [ ] **9. Owner smoke** (memory "Smoke identities"): the owner makes one real call to the BIS line and hears the greeting, then "I'm Sofía, an AI assistant. This call is transcribed so the team can follow up." (or the Spanish sentence on a Spanish greeting). Read-only: `select id, disclosed, outcome, ended_at is not null as finished from public.calls where account_id = '<BIS id>' order by started_at desc limit 1` → `disclosed = true`. Then the BIS Voice page's card shows that call under "Said it was AI" once it has ended.
- [ ] **10. Tracker and ledger** (memory "Roadmap tracker"): F-034 → `done` for part a (evidence: the PR, 0093, the smoke's call id); decision 20's row notes "BIS On 2026-10-2x; trial client pending; counsel review of the wording pending"; S-47 → part a done, b next; bump `meta/plan` asOf and mainSha. Ledger `s47a DONE`, and an ops line: "when the first client with call volume goes live, set it to Trial; read the card at ~4 weeks or 30+ per half; counsel reads the wording; owner decides account-wide On" (spec §8 step 3; not code).

---

## Spec ambiguities resolved here (not owner-level)

- **A. "Counted" and in-progress calls.** `calls.outcome` defaults to `'abandoned'` (`0019_voice_core.sql:53`), so an unfinished call reads as hung up. Counted = `ended_at is not null` AND `disclosed is not null` AND `outcome <> 'spam'`; the footnote counts finished calls that are spam or unstamped. A call whose row was never written (stamp failure) is in neither, as §5.1 says.
- **B. Where the stamp is written.** In the insert the route already makes (`startCallRow`), not a second write: no extra round trip before `acceptCall`, and the existing fail-open catch is the stamp's failure path. The column is named only for Trial/On (the `handoff_token` precedent, `voice.ts:263-294`), so an Off call's insert is byte-identical.
- **C. The browser voice demo** (`api/voice/web/session`) is not in the spec. `disclosed` is optional and defaults to false, so the demo's prompt is unchanged. Decision 20's "every assistant" may want it later; that is a follow-up, not this PR.
- **D. Where the chat's strings live.** Spec §6 says `messages.ts`; the chat's existing copy lives in `lib/concierge/strings.ts`. The two new chat strings go in `messages.ts` as `concierge.aiLabel`/`concierge.aiIntro` and the page resolves them with `t(m, …)` on the server, so the spec holds and the client component gets plain strings.
- **E. The chat label's place.** "The chat header" has no row in a bare framed panel (`concierge-chat.tsx:494`) or for an unbranded direct visit. The label is its own line at the top of the panel in every mode, so it is never dropped.
- **F. The Voice page's language.** The page is English-only agency tooling (`m[...]` throughout). The new setting and card read the person's language (`requestLocale`, operator default English), the call page's Suggestions precedent; the rest of the page is unchanged.
- **G. A save without the field** leaves the stored setting alone (a Setup step that posts the profile form without it must never reset it); an unknown value refuses the save.
- **H. The coin is drawn after every gate** (step 9c), so declined calls never draw it and are never stamped; a screened (press-1) call never reaches the route at all.
- **I. Percentages** are whole numbers (`Math.round`) of the half's own counted calls; a half with none shows "No calls yet", never 0%.
- **J. The card is shown on every account** (Off included); its empty state names the action that fills it (rule 5).
- **K. The stamp-failure log** keeps the existing line and replaces `String(e)` with `loggableError(e)` (class, code, redacted message); the caller number is not in it.

## Notes for the owner (no decision reopened)

- D3 puts the sentence after the operator's greeting. Most greetings end with a question ("How can I help you today?"), so on the smoke call listen for whether callers start answering before the sentence ends; turn detection lets them interrupt. If it reads awkwardly, the order is a one-line change in `greeting.ts`, but it is the owner's call, not this plan's.
- The chat's other Spanish copy uses tú (`strings.ts`); the new sentence uses "le", which reads as usted. It follows spec §6 and D3's own wording.

## Owner questions

None blocking. Nothing in the spec is impossible against the code as read.

## Spec coverage

| Spec | Where |
|---|---|
| §2 D2 Off/Trial/On, per-call stamp, BIS On at deploy | Tasks 1, 4, 7; Task 10 step 8 |
| §2 D3 wording, after the greeting, in the call's language | Task 3 (pinned literals), Task 4 (lifecycle test) |
| §2 D4 chat always labelled on Trial/On, no split | Task 5 |
| §4 `disclosure`, CHECK, who writes it, owners read-only | Task 1 (grants cases), Task 7 (agency-checked action) |
| §4 `calls.disclosed` nullable, server-written, null for Off | Tasks 1, 4 |
| §4 additive, apply order, digest unchanged | Task 1 steps 7; Task 10 steps 1, 4, 5 |
| §5.1 coin via `crypto.randomInt`, stamp, never-throw, ids-only logs | Task 4 |
| §5.1 greeting byte-identical when off (en/es/both), bilingual order | Task 3 |
| §5.1 IDENTITY swap; "never claim to be human" both ways | Task 3 |
| §5.1 spam/robocall paths unchanged; screened calls excluded | Task 4 (decline case), Task 6 (spam excluded); ambiguity H |
| §5.2 chat header, first message, chat prompt line | Task 5 |
| §5.3 card: counts, booked %, hung up %, excludes, 30-per-half, no verdict, states, EN/ES, tokens, no hero, second account | Tasks 6, 7, 8; ambiguity A |
| §5.4 three-way setting with the page's Save, one line each, next call | Task 7 |
| §6 copy in `messages.ts` with `.es`; spoken constants pinned | Tasks 2, 3; ambiguity D |
| §7 every listed test | Tasks 1, 3, 4, 5, 6, 7, 8 |
| §8 rollout steps 1-3 | Task 10 |
| §9 tiers | the Tiers table |

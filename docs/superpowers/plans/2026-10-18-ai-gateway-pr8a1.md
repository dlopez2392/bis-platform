# One door for AI calls, PR 8a-1 (S-15 + F-020 slice, first release item 8, migration 0086): the AI gateway, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model completion the product makes after a call (the call summary, the call proposals and the call card's reading) goes through ONE server-only function, `aiComplete`, which checks a global switch, the account's switch and the account's monthly budget before it spends anything, writes one ledger row per call (account, feature, model, tokens, estimated cost, outcome, latency, never the prompt and never the output), and never throws: every refusal or failure turns into the caller's existing non-AI form (the fact line; no proposals; no reading). The agency sees and controls it on a new **AI** card on the account's Settings: the account's switch, the monthly budget in dollars, this month's estimated spend in words, how often AI was skipped, and "AI for every account" behind a typed word.

**Architecture:** One migration, **0086** (`ai_gateway`): `ai_ledger` (no text column that could hold a prompt), `account_ai_settings` (switch, budget, the month and day counters), the singleton `ai_gateway_settings`; RLS on all three with SELECT for the agency only and no client write grant; two `security definer` functions, `ai_gate_check` and `ai_ledger_record`, executable by `service_role` only. A new `@bis/db` module `ai-gateway.ts` wraps them and the card's reads and writes. A new `apps/web/src/lib/ai/` holds `gateway.ts` (`aiComplete(db, input)`), `prices.ts`, `period.ts`, `log.ts`, `providers/{types,openai,fake,select}.ts`, `settings-view.ts` and a test helper `testing/open-gate.ts`. The three callers pass `finishCall`'s service client in; nothing under `lib/` names `serviceDb`. The Settings card reads on the agency's REQUEST client (RLS) and writes through two `"use server"` actions on the service client after `requireAgencyOnlyAccountAccess`.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc(...).abortSignal(...)`; postgrest-js 2.110.8 read in the main checkout's `node_modules`); Next.js 16 App Router (server component in `<Suspense>`, server actions); React 19; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`, `vi.stubEnv`); sonner toasts; `node:crypto` (the fake's hash); the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md` (owner-approved 2026-10-18, **all fourteen implementer choices I1–I14 accepted as recommended**): §1 (the 8a-1 row and "Not in 8a"), §2 G2–G6, §3 whole (3.1–3.6), §6, §8.1, the 8a-1 parts of §8.2–§8.4, §9, §10's 8a-1 lines. **NOT §4 (the record summary, PR 8a-2, migration 0087).** Base: `main` at `2cd68408` (#269) plus the spec commit `c4c1f7e6`. **0077–0085 are on bis-ci and production: never re-apply.** Every file:line below was read off this worktree at `c4c1f7e6`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s15-8a` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8a`), branch `feat/item8a-gateway-summary`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\efc99fd8-2a23-42ec-987c-f80cb2c56ca1\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad`); write it out literally in every command. `<KIT3B>` = `<SCRATCH>/s07g-kit` (read 2026-10-18: `replica.sh` with `WT=/c/Users/danlo/bis-platform/.claude/worktrees/s07-3b`, the `*0085_*` skip at `:31` and the `0085_document_shares.sql` post block at `:36-41`; `pgrst.sh` with `PATH` naming PG18's bin at `:2`, `SECRET="s07g-local-postgrest-jwt-secret-not-used-anywhere-real-0000"` at `:6`, copying `postgrest.exe`, `make-jwt.js`, `proxy.mjs` from `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`, all three present). `…/settings/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/`.

## Owner rulings this plan builds on (2026-10-18)

| # | Ruling | Where it lands |
|---|---|---|
| I1 | The call summary, the proposals AND the call card's reading move onto the gateway; the web chat's completion and the Realtime session stay out of 8a | Tasks 5, 6 |
| I7 | The budget period is the account's own calendar month (its zone) | Task 4 (`periodKeys`), Task 7 (the card's month) |
| I8 | The cap counts successful `record_summary` generations only (counter built in 0086, read by 8a-2) | Task 1 (`ai_ledger_record`) |
| I9 | Fail closed: an unreadable gate turns AI off for that call | Task 1 (`coalesce(…, false)` on the global switch), Task 4 (`gate_unreadable`) |
| I10 | Refusals are zero-cost ledger rows, except the env brake | Task 4; Task 7 shows the count |
| I11 | No ledger pruning in 8a | "Not in this PR" |
| I12 | The global switch is a singleton row toggled from every account's AI card behind a typed word, plus `AI_GATEWAY_OFF` | Tasks 1, 4, 7, 8 |
| I14 | $10 a month and 200 a day, re-read from 8a-1's real ledger before 8a-2 ships | Task 13 step 9 |
| Q1 (2026-10-18) | The typed word is OFF / APAGAR, either accepted by the server | Tasks 3, 7, 8 |
| Q2 (2026-10-18) | Keep "AI was skipped N times this month", counting only `global_off`, `account_off`, `over_budget` (review I7: `countAiSkipsSince`) | Tasks 2, 7, 8 |
| Q3 (2026-10-18) | Whole dollars in the budget field | Task 7 |
| Q4 (2026-10-18) | A successful call is a ledger row and no log line | Task 4 |
| M12 (2026-10-18) | The global switch's Undo restores an ALREADY-CONFIRMED state without retyping: after turning AI off (typed), Undo turns it on; after turning it on, Undo turns it off again by passing the reader's word itself (the server still checks it). Accepted | Task 8 (`aiCardHandlers.setGlobal`) |

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **The functions run with an EMPTY `search_path`, not `public`.** Spec §3.3: "`security definer`, `set search_path = public`". The house rule since 0085 is `set search_path = ''` with every name schema-qualified (`0085_document_shares.sql`, `claim_document_share_download`: `security definer set search_path = ''`), which removes the shadowing risk a `security definer` function carries. 0086 follows the house rule.
2. **`gate_unreadable` is an allowed ledger outcome.** Spec §3.3's outcome check lists `ok, account_off, global_off, over_budget, unknown_model, timeout, provider_error, no_key`, but §3.1 makes `gate_unreadable` a refusal of step 3 and says "Refusals in steps 2–4 write a ledger row too". The check carries all nine (the row will often fail to write when the database is the problem; the attempt is logged either way).
3. **`aiComplete` takes the database client as its first argument.** Spec §3.1's input has no client. The gateway needs one for its two RPCs, and `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts:34` scans every file under `lib` for a value-level `serviceDb`, listing each with a reason; its own doc (`:22-30`) says a helper that TAKES a client is not listed, "the caller who chose to pass a service client is the one this scan lists". So `aiComplete(db, input)`, and the callers pass `finishCall`'s `ctx.db` (`lib/voice/finish-call.ts:48`, `db: ReturnType<typeof serviceDb>`). `generateSummary`'s `opts` gains `db` and `accountId` (spec: `accountId` only); `readCallForCard`'s `opts` gains `db`, `accountId` and `timezone`; `generateProposals` already has all three (`lib/proposals/generate.ts:247`, `:286`).
4. **The input carries the account's zone.** Choice I7 makes the month the account's own; the RPCs take `p_month`/`p_day` (spec §3.3), so the gateway needs the zone. `AiInput.timezone` is required; `safeZone` (`lib/billing/billing-view.ts:58-60`, falls back to `America/Chicago`) cleans it. `finishCall` has `ctx.timezone` (`finish-call.ts:61`); `generateSummary`'s timezone stays optional and an absent one resolves through `safeZone("")`.
5. **The two RPCs are time-bounded (3 s each).** supabase-js puts no timeout on an `rpc`; the gate check runs BEFORE the call row is durable (the summary is "first in finishCall, before anything is written", `app/api/voice/incoming/route.ts:408-409`). Both calls get `.abortSignal(AbortSignal.timeout(3_000))`; a gate timeout is `gate_unreadable` (fail closed), a ledger timeout is a logged failure that keeps the text. Each completion can now take 3 + 10 + 3 s, so the post-cap tail grows from 73 s to 91 s, and the call cap's clamp, DERIVED from that tail (`route.ts:459`, `800 - 73 - 20 - 10 = 697`; `:491` `Math.min(Math.max(parsedOrDefault, 10), 697)`), is re-derived to `800 - 91 - 20 - 10 = 679` (review I1). A BEHAVIOUR change, not a comment: an operator who set `PHONE_MAX_CALL_SECONDS` above 679 now gets 679 (the default, 240, is untouched). The row is durable "~44s in" (was ~38s). `maxDuration = 800` (`route.ts:102`) is unchanged. Every place that names 697 or the 12 s text-back ceiling moves with it (Task 5 step 7 lists them).
6. **The callers' own catch blocks must not log the model's words either.** Not in the spec's scope (§3.1 speaks of the library), but G3 and the brief forbid it, and the code does it today: `JSON.parse` on unparseable content throws a `SyntaxError` whose message quotes the input's first characters (run here with node 24: `SyntaxError: Unexpected token 'S', "SENTINEL-O"... is not valid JSON`), and both `generate.ts:623` (`console.error(\`generateProposals: failed for call ${input.callId}: ${String(e)}\`)`) and `call-card.ts:212` (`console.error(\`${label}: reading failed: ${String(e)}\`)`) log `String(e)`. Both switch to `aiSafeError(e)` (`lib/ai/log.ts`), which names a `SyntaxError` without its message. Named probes in Tasks 5 and 6.
7. **`no_key` sits at the provider step, and the gateway owns its log line.** Spec §3.1 lists `no_key` without placing it. It is checked after the gate and the budget (so a switched-off account never logs a missing key) and writes a `no_key` ledger row. The callers' own missing-key lines (`generate.ts:331-335`, `call-card.ts:172-175`) are removed; the gateway logs one line per call, as today. `summary-service.ts` silently skipped a missing key (`:42-45`); it now gets the gateway's line too (production has the key).
8. **Only failures are logged.** Spec §3.1: "What the library logs: account id, feature, outcome, latency …". The ledger records every call; the gateway's log carries only non-`ok` outcomes: `provider_error`, `timeout`, `no_key`, `unknown_model` and `gate_unreadable` on `console.error`, the three expected states (`global_off`, `account_off`, `over_budget`) on `console.log`, so a switched-off account does not raise an error line per call (the reasoning at `generate.ts:301-311`). An `ok` call logs nothing, which keeps `generate.test.ts:771-785` ("logs NOTHING when it simply returns no proposals") true.
9. **A log line can name the call.** `AiInput.ref` (an id-only reference such as `call call1`) is appended to the gateway's line, because `generate.test.ts:771-780` pins that the failure line names the call, and `call-card.ts`'s `label` (`:167`, `finishCall ${meta.callRowId}`) already names it. `ref` never holds text from a transcript (the type says so; review checks every call site).
10. **A provider answer with no text is `provider_error`, charged from its usage.** Spec §3.5 covers a missing `usage`, not missing content. Today `generate.ts:376-380` logs "model response had no content" and returns 0; the gateway's line keeps the words "no content" (`provider_error (no content in the answer)`), so `generate.test.ts:1006-1019` keeps passing on the gateway's one line. The gateway returns `{ ok: false, reason: "provider_error" }` and records the tokens the answer reported (a paid answer is still paid); `generate.ts`'s now-unreachable content check is removed.
11. **The ledger's `model` column is capped at 64 characters, and every token and latency is checked non-negative.** Not in §3.3's column list; added so no column can hold a prompt (the spec's own aim, "There is no text column that could hold a prompt"). The gateway slices the model id to 64 before it writes.
12. **A late row from an older period never rewinds the counters.** Spec §3.3: "adds `p_cost` to the month's spend (resetting it when the month changed)". Two function instances around midnight can record out of order; a `YYYY-MM` / `YYYY-MM-DD` key sorts as text, so `ai_ledger_record` adds when the key is equal, resets when it is NEWER, and leaves the counters alone (still writing the ledger row) when it is OLDER.
13. **The global switch fails closed when its row is missing.** `ai_gate_check` reads `coalesce(enabled, false)` from the singleton (memory "plpgsql NULL guard"); an account with no settings row gets the defaults (on, $10), as §3.3 says.
14. **The card reads on the agency's REQUEST client.** Spec §3.3 grants SELECT to the agency through RLS; the Billing card reads on `serviceDb()` (`…/settings/billing-section.tsx:26`) because `billing_links` is service-only. The AI card reads through `dbForRequest()`, so the e2e proves 0086's agency policy end to end, and its section file needs no `ALLOWED` line; the one action file does (`agency-only`, beside `billing-actions.ts`'s, `in-account-service-reads.test.ts:137`).
15. **"Budget reached on {date}" reads the first `over_budget` ledger row of the month.** The spec gives the sentence, not its source. With the spend at or over the budget and no such row yet (no call since the budget was lowered), the card says "Budget reached. AI is paused for this account until {resume}." (`aiSettings.reachedNoDate`).
16. **The Settings page is English-only; the AI card is bilingual.** The page renders `m["…"]` directly (`…/settings/page.tsx:47`, `:139`, `:175`). Spec §3.6: "Every string is in the typed catalogue in English and Spanish (usted)." The card resolves the reader's locale itself, exactly as `branding/page.tsx:77`, `:115-116` does (`getPersonPrefs()`, `requestLocale({ account, isOperator, userLanguage })`, which `request-locale-callers.test.ts` requires), and renders every string through `t(m, key, locale)`.
17. **The budget is entered in whole dollars.** The column holds cents (§3.3); the field takes `0`–`1000` dollars, an optional leading `$`, no cents. Simpler to read at 7 AM; the database still holds any cents value an operator sets by SQL.
18. **Line drift, no meaning change.** Spec §3.2 cites `summary-service.ts:66-89` for the fetch (read: `:72-92`) and `call-card.ts:176` (read: the function at `:162`, its fetch at `:176`). `finish-call.ts:404` and `:928`, `generate.ts:239` and `:338` are as cited.
19. **No `/styleguide` demo.** The AI card is a Settings card, not a reusable component; DESIGN.md's definition of done asks for the styleguide only "if a new component/variant was added". The typed-word form reuses the purge dialog's shape (`…/contacts/document-purge-dialog.tsx`), not its component.

## Assumptions (not verified by reading; each has a named check)

- **A1** `PostgrestFilterBuilder.abortSignal(signal)` exists on the `rpc` builder in postgrest-js 2.110.8 and rejects the awaited call when the signal fires. Read: the method name appears in `node_modules/.pnpm/@supabase+postgrest-js@2.110.8/…/dist/index.d.cts` in the MAIN checkout (this worktree has no `node_modules` until Task 0). Check: Task 2's "an aborted signal rejects" case behind PostgREST; `pnpm --filter web typecheck` in Task 4.
- **A2** `pg_proc.proconfig` for `set search_path = ''` reads `{search_path=""}` on PG17 and PG18. Check: Task 1's definer case on the replica (if PG renders it differently, the implementer pastes the real value and the reviewer confirms it is the empty path, never `public`).
- **A3** A `jsonb` built by `jsonb_build_object` with a `bigint` arrives in supabase-js as a JS `number`. Check: Task 2's gate case.
- **A4** OpenAI's chat completions answer carries `usage.prompt_tokens` and `usage.completion_tokens` as integers (the spec's §3.5 says so; no test here can call OpenAI). Check: the owner's production smoke (Task 13 step 9) reads non-null tokens on the ledger.
- **A6** America/Santiago's 2026 clock changes fall at local midnight on Apr 4/5 and Sep 5/6 (the zone the M4 case uses because its DST changes at midnight). The case holds whatever the dates are (the resume day no longer depends on the zone's midnight); if the reviewer finds the zone's 2026 rules differ, the case still guards the year-end and the noon-UTC construction. Check: Task 7's run.
- **A5** Node's `Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" })` formats `YYYY-MM-DD` on Node 22 (CI) as it does on node 24 here (run here: `2026-11-01T04:30Z` in `America/Chicago` → `2026-10-31`). Check: Task 4's period case on CI `verify`.
- (Read, not assumed: `requireAgencyOnlyAccountAccess(accountId): Promise<{ userId: string }>` redirects a non-agency caller (`lib/auth.ts:98-104`); `requestLocale(input, searchParams?)` (`lib/i18n/request-locale.ts:35-47`); `getPersonPrefs` is `cache(async (): Promise<PersonPrefs>)` (`lib/preferences/person-prefs.ts:72`); `t(catalogue, key, locale, params?)` and `plural(…)` needing a `${key}One` twin (`lib/i18n/t.ts:36-53`); `safeZone`, `monthStartInZone(now, zone)` (`lib/billing/billing-view.ts:58-71`); `loggableError(e)` keeps 300 characters of the message with emails masked (`lib/loggable-error.ts:18-27`), so it is NOT safe for an error whose message may quote model output; `actAs(c, claims)` and `actAsMember(c, accountId, orgId, role)` (`packages/db/src/test/db.ts:22-41`); `withTestAccount(fn(db, accountId))` on `serviceDb()` (`packages/db/src/test/fixtures.ts:140-146`); `common.undo` / `common.undo.es` (`lib/messages.ts:298-299`); the e2e job's env holds `OPENAI_API_KEY` at `.github/workflows/ci.yml:320` and `BIS_I18N_QA: "1"` at `:350`; Playwright's webServer env at `apps/web/playwright.config.ts:249-260`. Intl outputs read with node 24: `Oct 14`, `14 oct`, `Nov 1`, `1 nov` (`month: "short", day: "numeric"`, en-US / es-US, America/Chicago); `$1.84`, `$10.00`, `$1,000.00` (`style: "currency", currency: "USD"`, en-US and es-US alike).)

## Global Constraints

- **NEVER `git stash`, `git reset`, `git restore`, `git checkout -- <file>`, `git commit --amend`, or any history rewrite** in the shared worktree (a reviewer broke this once). Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Reviewers revert their probes BY HAND and prove it with `cmp` against `git show HEAD:<path> > <SCRATCH>/<dir>/orig` (`cmp` prints nothing). Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. Stage new files with `git add -- <new paths>`, then `git commit -m "…" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Nobody merges or rebases but the orchestrator.
- **Commits** end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **No real model call anywhere in this PR's tests or in CI.** Unit tests stub `fetchImpl` (it passes through the gateway to the provider) or mock `aiComplete`; the e2e app runs with `AI_PROVIDER=fake`. `AI_PROVIDER` is IGNORED when `VERCEL_ENV=production` (a test proves it). Nobody runs a script or REPL that reaches OpenAI.
- **Prompts and outputs are never logged and never stored.** The ledger has no column that could hold one (pinned column list, 64-character `model`). The gateway logs ids, the feature, the outcome, an HTTP status and latency only; it never reads a non-ok provider body (a 400 can echo the prompt) and never logs an error MESSAGE from the provider path (a `SyntaxError` quotes its input), only its name. Callers log `aiSafeError(e)`, never `String(e)` or `loggableError(e)`, for anything that can carry model output. Each of these has a named sentinel probe (`SENTINEL-PROMPT-7f3`, `SENTINEL-OUTPUT-7f3`).
- **Every caller's non-AI fallback is pinned per refusal reason** (`AI_REFUSALS`, all eight): the summary is `composeSummary("", state)`, proposals `0`, the card `NO_READING`. The caller's existing skip still runs first and costs no gateway call: the spam skip (`summary-service.ts:40`), `callIsEligible` (`generate.ts:318-321`), `cardReadable` (`finish-call.ts:836`).
- **0086 is NOT on bis-ci until Task 13 step 2.** Until then: **no `@bis/db` vitest and no live web test may run against bis-ci.** Every `@bis/db` suite runs on YOUR local PG18 replica ("The replica kit") or is left to CI `verify`. `packages/db/.env` does NOT exist on this machine: never `pnpm --filter @bis/db exec vitest` with the default env, and never `pnpm --filter @bis/db ci:sql`. bis-ci reads are the orchestrator's, through the Supabase MCP `execute_sql`, read-only, on project `odnobiodsftffphuuosz`. **No production credential in Preview, ever** (CLAUDE.md); this PR adds no env var to any Vercel environment.
- **0086's byte and SQL rules.** ASCII only; no backslash anywhere; no `$` except the `$$` pairs that open and close a function body (character classes are written `'[^0-9-]'`, never with an anchor). Every control byte for the checker's positive control is written with `node`, never Git Bash `printf`. `set local lock_timeout = '5s'` is the first statement. RLS on all three tables, SELECT for `authenticated` through an agency-only policy (`coalesce(app.is_agency(), false)`), no INSERT/UPDATE/DELETE for `anon` or `authenticated`, `service_role` holds all four; both functions `security definer set search_path = ''`, every name schema-qualified, `revoke all … from public, anon, authenticated, service_role` then `grant execute … to service_role`; required arguments raise `22004` when null; the rollback note in the header.
- **Writes are server-only and agency-only.** Each action's FIRST line is `await requireAgencyOnlyAccountAccess(accountId)` (a server action is a public POST endpoint; hiding the card is not authorization); only then the service client. The new action file (`…/settings/ai-actions.ts`) joins `in-account-service-reads.test.ts`'s `ALLOWED` as `"agency-only"`. **No new file under `apps/web/src/lib` contains the token `serviceDb`, not even in a comment** (that test strips comments, but a reviewer should not have to rely on it).
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0086_ai_gateway.sql`, `packages/db/src/test/ai-gateway-schema.test.ts`, `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES` only), `<SCRATCH>/s15a-kit/*` (Task 1).
  - **bis-crm:** `packages/db/src/ai-gateway.ts`, `packages/db/src/index.ts` (one export block), `packages/db/src/test/ai-gateway.test.ts` (Task 2); `apps/web/src/lib/messages.ts` + one `describe` in `messages.test.ts` (Task 3); `apps/web/src/lib/proposals/generate.ts` (+ `generate.test.ts`, new `generate.fallback.test.ts`) (Task 6); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 10, regenerated).
  - **bis-platform:** `apps/web/src/lib/ai/{gateway,prices,period,log}.ts`, `apps/web/src/lib/ai/providers/{types,openai,fake,select}.ts`, `apps/web/src/lib/ai/testing/open-gate.ts` and their tests, `apps/web/src/lib/ai/client-boundary.test.ts` (Task 4); `apps/web/src/lib/ai/settings-view.ts` (+ test), `…/settings/ai-actions.ts` (+ test), one `ALLOWED` line in `…/[accountId]/in-account-service-reads.test.ts` (Task 7); `.github/workflows/ci.yml` (e2e env only), `apps/web/ci/ci-workflow.test.ts` (one case), `apps/web/playwright.config.ts` (webServer env only), `apps/web/src/lib/ai/env-contract.test.ts` (Task 9).
  - **bis-voice:** `apps/web/src/lib/voice/{summary-service,call-card,finish-call}.ts` and `summary-service.test.ts`, `call-card.test.ts`, `finish-call.test.ts`, new `summary-service.fallback.test.ts`, new `call-card.fallback.test.ts`, the tail and the call-cap clamp in `apps/web/src/app/api/voice/incoming/route.ts` (697 → 679, review I1) and their pin `lifecycle.test.ts:627-680`, the comment in `…/calls/textback-window.ts:14-17` (Task 5).
  - **bis-frontend:** `…/settings/{ai-section,ai-card,ai-card-handlers}.tsx|ts` (+ tests), `…/settings/page.tsx` (one mount) + `page.test.ts` (one case and one mock line), `apps/web/src/lib/palette/registry.ts` (one `SETTINGS_SECTIONS` line) + `registry.test.ts` (one case) (Task 8).
  - **bis-e2e-qa:** `apps/web/e2e/ai-settings.spec.ts` (Task 11).
  - **Orchestrator:** Task 0, `.env.example` (Task 9 step 5), the ledger, the bis-ci and production applies of 0086, the parity check, the gates, the PR, the merge, the tracker (Task 13).
- **Shared files, one task at a time.** `apps/web/src/lib/messages.ts`: **Task 3 only** (every key this plan uses is listed there; a later task that finds one missing STOPS and reports; the orchestrator re-opens Task 3). `packages/db/src/index.ts`: **Task 2 only**. `apps/web/src/lib/ai/gateway.ts`: **Task 4 only** (Tasks 5–7 consume it). `…/[accountId]/in-account-service-reads.test.ts`: **Task 7 only**. `apps/web/src/lib/i18n/*-baseline.json`: Task 10 only, after every copy-bearing task.
- **Every test must be able to fail; the plan writer named each one's mutation, and the implementer RUNS it.** Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back (and `cmp` it). A named mutation that does not fail its test is a finding: say so and substitute one that does. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; a count-only guard where the content can be asserted; a WANT constant compared with a value built from the same constant (cost literals here are written as numbers worked out in the plan, never `costMicroUsd(…)` called in the assertion); an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish against the literal string); a mock that satisfies itself (the caller fallback tests mock `aiComplete` to answer a refusal and assert the CALLER's output, never the mock's); an assertion another element on the page could satisfy (scope every e2e locator to `#ai` or a `data-ai-*` marker); a negative `not.toContain` on raw `renderToStaticMarkup` output for a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts`). A `-t` filter that matches nothing passes silently: read the run count in vitest's summary block.
- **DESIGN.md definition of done for the UI task (8):** tokens only (radii `rounded-[var(--radius-ctl)]`, pills `rounded-full`; no hex, no literal shadow); both themes via `.dark`; the blur fallback; rule 1 (the spend line names its period, "this month"); rule 3 (on/off is words, never colour alone); rule 5 (loaded, empty "No AI use yet this month.", error card, skeleton); rule 6 (turning AI off for the account and Save run at once with Undo in the toast; turning AI off for EVERY account is the one destructive-in-effect act and confirms by typing the word; turning it back on is immediate with Undo); rule 7 (no spinner: a busy Save is a disabled button with the same word); rule 8 (the card carries exactly ONE `data-variant="default"` button, Save; the global button is `outline`; the dialog's one primary is its destructive confirm); rule 11 (no `data-hero`); controls `min-h-11 md:min-h-8`; renders at 360 px in Spanish (the card takes no `?locale=` override, so the pseudo-locale does not reach it; review M8).
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin on the line under it, in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). Spanish is **usted**. New `.tsx` code carries no JSX literal copy with a letter in it. No vendor or internal words in copy ("OpenAI", "token", "ledger", "gateway", "RPC", "microdollar", "model"). Deltas and amounts are words and dollars; never an arrow.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, **`pnpm --filter web typecheck` in EVERY task that touches a `.ts`/`.tsx` file, including the e2e spec** (it covers `e2e/`), `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on your replica, run in `packages/db` as `node node_modules/vitest/vitest.mjs run <files>` after sourcing the kit's env, judged by vitest's summary block (capture the exit code to a file with nothing after the command in the same block; the pnpm `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), never Playwright except `--list`: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds a live test).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103`), never `Test Client One`; the e2e never confirms the global switch off (a local run shares bis-ci with Preview); every row it writes is deleted in `afterAll`, each error checked, then re-read.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit any `.env*` file (the tracked `.env.example` included: the orchestrator lands its two lines in Task 9 step 5), set a Vercel secret, place a call, or call a real provider. Those that are anyone's are the orchestrator's, in Task 13.

## The replica kit (every `@bis/db` task and its reviewer)

This lane's ports are **55650–55659**, never `5432`. Assignment (a port set is free again only after its owner stopped its own kit): Task 1 implementer `55650`; Task 1 reviewer `55651`; **set A** (Postgres `55652`, PostgREST `55653`, gateway `55654`) for the Task 2 implementer; **set B** (`55655`/`55656`/`55657`) for the Task 2 reviewer; Task 12 (final review) Postgres `55651` (Task 1's reviewer is long done), PostgREST `55658`, gateway `55659`. Each agent works in its own `<SCRATCH>/s15a-t<N>-<impl|review>/`.

`<KIT3B>`'s `replica.sh` and `pgrst.sh`, copied and re-pointed by Task 1 to `<SCRATCH>/s15a-kit/`: `WT` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8a`; `pre` is every migration through **0085** (with the storage stub 0077 needs); `post` is `pre` plus the branch's **0086** if it exists yet. The only lines that change in `replica.sh`: the `WT=` line (`:6`), the `case "$f" in *0085_*)` skip (`:31`, becomes `*0086_*`), and the `post` block's file name (`0086_ai_gateway.sql`, `:36-37`) and three messages (`post = pre + 0086`, `0086 FAILED`, `post = pre (no 0086 yet)`). `pgrst.sh` changes ONLY its `SECRET=` string (`:6`), to `s15a-local-postgrest-jwt-secret-not-used-anywhere-real-0000`. Task 1 writes both with `sed` and shows the `diff` output: exactly those lines differ.

Bring up PostgREST for a `withTestAccount` suite: `bash <SCRATCH>/s15a-kit/replica.sh <pg> <dir>` then `bash <SCRATCH>/s15a-kit/pgrst.sh <pg> <pgrst> <gateway> <dir>`, then `source <dir>/env-run.sh` in the same shell that runs vitest.

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"` afterwards when PostgREST is up.

**Faithfulness** (once per kit build): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0085 and not 0086 until Task 13 step 2). The agent runs it on `pre`; **the ORCHESTRATOR runs it on bis-ci through the Supabase MCP `execute_sql` (read-only, project `odnobiodsftffphuuosz`) in Task 0 step 2 and puts the value in Task 1's brief** (no agent reads bis-ci). The query:

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ. 0086 must leave this digest UNCHANGED on `post` (it grants no client write): Task 1 runs it on `post` too.

## Pinned tests this PR changes (stated outright)

- `apps/web/src/lib/voice/summary-service.test.ts` (`:25-129`): every `generateSummary(…)` call gains the gate fields: `{ ...GATE, fetchImpl … }` where `GATE` is built from `openGateDb()` (Task 5); every existing assertion is UNCHANGED. The "stray language option" case (`:110-120`) builds its cast `opts` with `...GATE` too.
- `apps/web/src/lib/voice/call-card.test.ts` (`:149-201`): every `readCallForCard(transcript, { … })` call gains `...GATE`; every assertion is UNCHANGED, including `AbortSignal.timeout` `toHaveBeenCalledWith(10_000)` (`:180-184`; the gateway's extra `timeout(3_000)` calls do not stop a `toHaveBeenCalledWith` match).
- `apps/web/src/lib/voice/finish-call.test.ts:416-420` and `:1813`: the `objectContaining` objects gain `db: ctx.db, accountId: ctx.accountId` (read: the file calls `finishCall(s, ctx, meta)` at `:419`, and `ctx.db` is `{}` with account `"a1"`, `:1806`); the two mocks (`:72-73`, `:86-89`) are unchanged.
- `apps/web/src/lib/proposals/generate.test.ts`: `fakeDb()` (`:67`) and `fakeDbAlwaysRefusing()` (`:116`) each gain `rpc: gateRpc().rpc`; every existing case and assertion is UNCHANGED (the missing-key case `:787-794` still sees exactly one `console.error`, now the gateway's; the HTTP 500 case `:736-752` still sees one line containing `HTTP 500`; the outright-failure case `:771-785` still sees one line containing `call1`).
- `apps/web/src/lib/proposals/generate.test.ts:1006-1019` (review I3): its assertions are UNCHANGED (one `console.error`, containing "no content"), now satisfied by the gateway's line; its title's mutation becomes "(mutation: drop openai.ts's `typeof content !== \"string\"` branch -> the gateway answers ok with no text -> JSON.parse throws -> the one line reads 'SyntaxError (an answer that did not parse)' -> FAILS)" (Task 6).
- `…/[accountId]/in-account-service-reads.test.ts`: `ALLOWED` gains `"app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.ts": "agency-only",` beside `:137` (Task 7). No `lib/` entry is added.
- `…/settings/page.test.ts`: one `vi.mock("./ai-section", …)` beside the billing mock (`:110`), one new case after the Billing describe (`:202-213`) (Task 8).
- `apps/web/src/lib/palette/registry.test.ts`: one new case beside `:119-127`, and `cardFiles` (`:235-245`, the "every settings anchor … is a REAL id" case) gains `"../../app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx"` (review I5) (Task 8).
- `apps/web/ci/ci-workflow.test.ts`: one new case (Task 9).
- `apps/web/vitest.config.ts:32`: `env` gains `AI_PROVIDER: "", AI_GATEWAY_OFF: ""` (Task 4, review M3).
- `apps/web/src/app/api/voice/incoming/lifecycle.test.ts:627-680`: the clamp 697 → 679 (titles, `"698"` → `"680"`, `696_000` → `678_000`, `696_999` → `678_999`, the derivation comment) (Task 5, review I1).
- `packages/db/src/test/demo-seed.test.ts:275-277`: the leftover count selects `account_id`, not `id`, and checks `error` (Task 1, review M7). `:209-217`'s secret list is UNCHANGED (`AI_PROVIDER` is a literal, not a secret).
- `apps/web/src/lib/messages.test.ts`: one new `describe` at the end (Task 3).
- `packages/db/src/account-teardown.ts:20-30`: `ACCOUNT_OWNED_TABLES` gains `"ai_ledger", "account_ai_settings"` as its first two entries (Task 1).
- **Unchanged, checked:** `packages/db/src/test/schema-grants-guard.test.ts` (`:115` `rlsOff` and `EXPECTED_WRITES`: 0086 has no view, RLS on every table, no client write); `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED`: nothing in 8a-1 reads on the drawer's path); `apps/web/src/lib/i18n/request-locale-callers.test.ts` (the new caller passes `userLanguage`).

## Not in this PR

- The record summary, its route, its cache table and migration 0087 (PR 8a-2, spec §4). 0086 already carries the `record_summary` feature value and the day counter it will read.
- The web chat's completion (`app/api/concierge/[publicId]/turn/route.ts:480`) and the Realtime session (spec §1, choice I1): listed for a later slice.
- Per-plan budget tiers (S-13), a second provider, provider routing, ledger pruning (choice I11; proposed 13 months once F-196 lands).
- A Vercel env change: `AI_PROVIDER` and `AI_GATEWAY_OFF` are optional and default to normal behaviour (spec §10).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0086_ai_gateway.sql` | bis-db-schema | the three tables, RLS and grants, `ai_gate_check`, `ai_ledger_record` |
| `packages/db/src/test/ai-gateway-schema.test.ts` | bis-db-schema | 0086 on the replica: columns, checks, cascade, who reads, grants, the two functions |
| `packages/db/src/ai-gateway.ts` (+ `test/ai-gateway.test.ts`) | bis-crm | every gateway and card read/write the app makes |
| `apps/web/src/lib/ai/prices.ts` (+ test) | bis-platform | the price table and the cost arithmetic |
| `apps/web/src/lib/ai/period.ts` (+ test) | bis-platform | the account's month and day keys |
| `apps/web/src/lib/ai/log.ts` (+ test) | bis-platform | `aiSafeError`, `errorName` |
| `apps/web/src/lib/ai/providers/{types,openai,fake,select}.ts` | bis-platform | the provider seam |
| `apps/web/src/lib/ai/gateway.ts` (+ `gateway.test.ts`) | bis-platform | `aiComplete`, `AI_REFUSALS` |
| `apps/web/src/lib/ai/testing/open-gate.ts` | bis-platform | test-only: a client whose two RPCs answer as told |
| `apps/web/src/lib/ai/client-boundary.test.ts` | bis-platform | no `"use client"` file imports `lib/ai/` |
| `apps/web/src/lib/voice/summary-service.fallback.test.ts`, `call-card.fallback.test.ts` | bis-voice | each refusal → the caller's fallback |
| `apps/web/src/lib/proposals/generate.fallback.test.ts` | bis-crm | each refusal → 0 |
| `apps/web/src/lib/ai/settings-view.ts` (+ test) | bis-platform | the card's view model, the budget parser, the typed word |
| `…/settings/ai-actions.ts` (+ test) | bis-platform | Save, its Undo, the global switch |
| `…/settings/ai-section.tsx` (+ test) | bis-frontend | the card's server read, its locale, its error card |
| `…/settings/ai-card.tsx`, `ai-card-handlers.ts` (+ tests) | bis-frontend | the card and its toasts |
| `apps/web/src/lib/ai/env-contract.test.ts` | bis-platform | `AI_PROVIDER` never set by `vercel.json` / `next.config.ts`; `.env.example` names both new vars |
| `apps/web/e2e/ai-settings.spec.ts` | bis-e2e-qa | the card on the fixture account |

**Modified:** `packages/db/src/{account-teardown,index}.ts`; `packages/db/src/test/demo-seed.test.ts`; `apps/web/vitest.config.ts`; `apps/web/src/app/api/voice/incoming/lifecycle.test.ts`; `…/calls/textback-window.ts`; `.claude/agents/bis-voice.md` (orchestrator); `apps/web/src/lib/voice/{summary-service,call-card,finish-call}.ts` (+ tests); `apps/web/src/app/api/voice/incoming/route.ts` (the clamp 697 → 679 and its comments); `apps/web/src/lib/proposals/generate.ts` (+ test); `apps/web/src/lib/messages.ts` (+ test); `…/settings/page.tsx` (+ test); `apps/web/src/lib/palette/registry.ts` (+ test); `…/[accountId]/in-account-service-reads.test.ts`; `.env.example`; `.github/workflows/ci.yml`; `apps/web/ci/ci-workflow.test.ts`; `apps/web/playwright.config.ts`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Suggested agent | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base; install; bis-ci's digest | orchestrator | n/a | — | none |
| 1 | Migration 0086 and its proof on the replica; the kit; teardown | bis-db-schema | **opus** | 0 | the migration, `ai-gateway-schema.test.ts`, `account-teardown.ts`, `<SCRATCH>/s15a-kit/*` |
| 2 | `@bis/db`: the gateway module and the barrel | bis-crm | **opus** | 1 | `ai-gateway.ts`, `index.ts`, its test |
| 3 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 4 | The gateway library, the providers, the fake | bis-platform | **opus** | 2 | `lib/ai/**` except `settings-view*` |
| 5 | The call summary and the call card on the gateway | bis-voice | **opus** | 4 | `lib/voice/{summary-service,call-card,finish-call}*`, two fallback tests, the incoming route comment |
| 6 | The proposals on the gateway | bis-crm | **opus** | 4 | `lib/proposals/generate*` |
| 7 | The card's view model and its actions | bis-platform | **opus** | 2, 3, 4 | `lib/ai/settings-view*`, `…/settings/ai-actions*`, one `ALLOWED` line |
| 8 | The AI card, its section, the page mount, ⌘K | bis-frontend | sonnet | 3, 7 | `…/settings/ai-{section,card,card-handlers}*`, `page.tsx`, `page.test.ts`, `registry.ts`, `registry.test.ts` |
| 9 | Env contract: `.env.example`, CI's e2e env, Playwright's env | bis-platform | sonnet | 4 | `.env.example`, `ci.yml`, `ci-workflow.test.ts`, `playwright.config.ts`, `lib/ai/env-contract.test.ts` |
| 10 | Regenerate the i18n baselines | bis-crm | sonnet | 3, 8 | `lib/i18n/*-baseline.json` |
| 11 | The e2e spec | bis-e2e-qa | sonnet | 8, 9, 10 | `e2e/ai-settings.spec.ts` |
| 12 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–11 | none |
| 13 | Rollout (orchestrator; LAST) | orchestrator | n/a | 12 | none in the repo |

```
Wave A (two lanes):    T1 (bis-db-schema)          T3 (bis-crm)
Wave B:                T2 (bis-crm, after T1)
Wave C:                T4 (bis-platform, after T2)
Wave D (four lanes):   T5 (bis-voice)   T6 (bis-crm)   T7 (bis-platform, after T3)   T9 (bis-platform 2nd)
Wave E:                T8 (bis-frontend, after T7)
Wave F:                T10, then T11
Checkpoint:            T12
Rollout:               T13 (orchestrator, LAST)
```

Disjointness: T5 (`lib/voice/*`, the incoming route's comment), T6 (`lib/proposals/*`), T7 (`lib/ai/settings-view*`, `…/settings/ai-actions*`, one `ALLOWED` line) and T9 (`.env.example`, `ci.yml`, `ci-workflow.test.ts`, `playwright.config.ts`, `lib/ai/env-contract.test.ts`) share no file; none runs a db suite. T5 and T6 both import `lib/ai/gateway.ts` and `lib/ai/testing/open-gate.ts` and edit neither. **0086 goes to bis-ci only AFTER Task 12 approves it unchanged** (a finding that changes 0086 must not need a second migration). Until then the e2e job's migration check is red on every push, expected and named in each CI reading. 0086 is additive (three new tables, two functions, one seeded row) and the code needs it (the gateway fails closed on a missing RPC, so code without the migration would turn every call summary into its fact line), so **the migration goes to production BEFORE the merge** (spec §10).

---

## Task 0: Confirm the base; install; bis-ci's digest (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -3` shows this plan's commit, then `c4c1f7e6 Spec: item 8a, …`, then `2cd68408 A file can be shared by a 24-hour link …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `2cd68408`, read what moved it; if it touched any file in "File Structure" or added a migration, `git merge origin/main` into `<WT>` ONCE now (never rebase), and if it added `0086_*`, STOP: this plan's number is taken.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` (read 2026-10-18: this worktree has no `node_modules`). `git status --short` shows no lockfile change.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0085_document_shares.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0086*'` → nothing.
  - `ls apps/web/src/lib/ai` → "No such file or directory".
  - `grep -n 'export async function generateSummary' -A3 apps/web/src/lib/voice/summary-service.ts` → `36:` and `opts?: { timezone?: string; fetchImpl?: typeof fetch },` at `:38`.
  - `grep -n 'generateSummary(state' apps/web/src/lib/voice/finish-call.ts` → `404:`; `grep -n 'readCallForCard(state.transcript' apps/web/src/lib/voice/finish-call.ts` → `837:`; `grep -n 'const r = await fetchImpl' apps/web/src/lib/proposals/generate.ts` → `338:`; `grep -n 'reading failed' apps/web/src/lib/voice/call-card.ts` → `212:`.
  - `grep -n '"site_traffic_breakdown", "site_traffic_daily", "sites",' packages/db/src/account-teardown.ts` → `21:`.
  - `grep -n 'settings/billing-actions.ts": "agency-only"' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → `137:`.
  - `grep -n '"sharePage.askNoName.es"' apps/web/src/lib/messages.ts` → `4965:` (the catalogue's last key); `wc -l < apps/web/src/lib/messages.test.ts` → `854`.
  - `grep -n 'anchor: "required-documents"' apps/web/src/lib/palette/registry.ts` → `50:`.
  - `ls "<KIT3B>/replica.sh" "<KIT3B>/pgrst.sh"` and the three files `pgrst.sh` copies → all exist.
  - Read-only, MCP `execute_sql`: on production (`tlbkbmlrfafquucsmsmm`) and bis-ci (`odnobiodsftffphuuosz`), `select max(version) from supabase_migrations.schema_migrations` names the 0085 apply on both. On bis-ci, the Faithfulness query above: record its value for Task 1's brief.
- [ ] **Step 3.** Record in the ledger: "8a-1 plan executing; I1–I14 accepted 2026-10-18; 0086 not yet on any project."

---

## Task 1: Migration 0086 and its proof on the replica; the kit; teardown (bis-db-schema)

**Review:** opus. **Runs beside:** Task 3. **Scratch:** `<SCRATCH>/s15a-t1-impl/`, replica port `55650` (reviewer `s15a-t1-review/`, `55651`).

**Files**
- Create: `<SCRATCH>/s15a-kit/replica.sh`, `<SCRATCH>/s15a-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0086_ai_gateway.sql`
- Create: `packages/db/src/test/ai-gateway-schema.test.ts`
- Modify: `packages/db/src/account-teardown.ts:20-21`; `packages/db/src/test/demo-seed.test.ts:274-278` (review M7)

**Interfaces**
- Consumes (SQL): `public.accounts(id)`, `public.agencies(id)`, `app.is_agency()` (0085's policies use it).
- Produces (SQL), every name read by a later task:
  - `public.ai_ledger (id, account_id, feature, model, input_tokens, output_tokens, cost_microusd, outcome, latency_ms, created_at)`; constraints `ai_ledger_feature_check`, `ai_ledger_model_check`, `ai_ledger_input_tokens_check`, `ai_ledger_output_tokens_check`, `ai_ledger_cost_check`, `ai_ledger_outcome_check`, `ai_ledger_latency_check`; index `ai_ledger_by_account (account_id, created_at desc)`; policy `ai_ledger_agency_read`.
  - `public.account_ai_settings (account_id, enabled, monthly_budget_cents, month_key, month_spend_microusd, day_key, record_summaries_today, updated_by, updated_at)`; constraints `account_ai_settings_budget_check`, `account_ai_settings_month_key_check`, `account_ai_settings_day_key_check`, `account_ai_settings_spend_check`, `account_ai_settings_today_check`; policy `account_ai_settings_agency_read`.
  - `public.ai_gateway_settings (id, enabled, updated_by, updated_at)`, constraint `ai_gateway_settings_singleton`, one row `(true, true)`; policy `ai_gateway_settings_agency_read`.
  - `public.ai_gate_check(p_account uuid, p_month text, p_day text) returns jsonb`: `{ global_enabled: boolean, account_enabled: boolean, budget_microusd: number, month_spend_microusd: number, record_summaries_today: number }`; service_role only.
  - `public.ai_ledger_record(p_account uuid, p_feature text, p_model text, p_in integer, p_out integer, p_cost bigint, p_outcome text, p_latency integer, p_month text, p_day text) returns void`; service_role only.
  - `ACCOUNT_OWNED_TABLES` begins `"ai_ledger", "account_ai_settings",`.

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad
K=$S/s07g-kit
mkdir -p "$S/s15a-kit" "$S/s15a-t1-impl"
sed -e 's#/worktrees/s07-3b$#/worktrees/s15-8a#' -e 's#\*0085_\*#*0086_*#' -e 's#0085_document_shares.sql#0086_ai_gateway.sql#g' \
    -e 's#post = pre + 0085#post = pre + 0086#' -e 's#0085 FAILED#0086 FAILED#' -e 's#(no 0085 yet)#(no 0086 yet)#' \
    "$K/replica.sh" > "$S/s15a-kit/replica.sh"
sed -e 's#s07g-local-postgrest#s15a-local-postgrest#' "$K/pgrst.sh" > "$S/s15a-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s15a-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s15a-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" differ. Run `bash "$S/s15a-kit/replica.sh" 55650 "$S/s15a-t1-impl"` → `post = pre (no 0086 yet)`. Run the Faithfulness query on `pre` (`"/c/Program Files/PostgreSQL/18/bin/psql" -h localhost -p 55650 -U postgres -d pre -Atc "<query>"`); compare with the bis-ci value in your brief; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 1,80p packages/db/supabase/migrations/0085_document_shares.sql` (header, rollback note, `lock_timeout`, grants, a `security definer set search_path = ''` function and its revoke/grant), `sed -n 650,712p` of the same file, `packages/db/src/test/db.ts` (`withRollback`, `actAs`, `actAsMember`), `sed -n 1,40p packages/db/src/account-teardown.ts`, `sed -n 1,60p packages/db/src/test/document-shares-schema.test.ts` (the `attempt` savepoint helper).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/ai-gateway-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0086 (item 8a-1, spec 3.3; plan deviations 1, 2, 11, 12, 13): the ledger has no column that could
 * hold a prompt or an output; the switches and the budget; the agency alone reads all three tables;
 * the client role writes nothing and executes neither function; the gate reads the defaults, the
 * month and the day; the record writes one row and moves the counters forward only.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_aig_${RUN}`;
const AGENCY = { app_role: "agency_admin", sub: `u_aig_agency_${RUN}` };

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}

async function seed(c: Client): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'AIG Co',true) returning id", [agency!.id, ORG]);
  return a!.id;
}

const gate = async (c: Client, acct: string, month = "2026-10", day = "2026-10-18") =>
  (await c.query<{ r: Record<string, unknown> }>("select public.ai_gate_check($1, $2, $3) as r", [acct, month, day])).rows[0]!.r;

type Rec = { feature: string; model: string; inTok: number | null; outTok: number | null; cost: number; outcome: string; latency: number; month: string; day: string };
const record = (c: Client, acct: string, o: Partial<Rec> = {}) => {
  const v: Rec = { feature: "call_summary", model: "gpt-4o-mini", inTok: 100, outTok: 20, cost: 27, outcome: "ok", latency: 5, month: "2026-10", day: "2026-10-18", ...o };
  return c.query("select public.ai_ledger_record($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [acct, v.feature, v.model, v.inTok, v.outTok, v.cost, v.outcome, v.latency, v.month, v.day]);
};
const counters = async (c: Client, acct: string) =>
  (await c.query<{ m: string | null; s: string; d: string | null; t: number }>(
    "select month_key as m, month_spend_microusd::text as s, day_key as d, record_summaries_today as t from account_ai_settings where account_id = $1", [acct])).rows[0];

describe("0086: the tables (spec 3.3)", () => {
  it("the ledger's columns are exactly these: nothing could hold a prompt or an output (mutation: add `prompt text` to ai_ledger -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select column_name as n from information_schema.columns where table_schema = 'public' and table_name = 'ai_ledger' order by ordinal_position");
      expect(rows.map((r) => r.n)).toEqual(["id", "account_id", "feature", "model", "input_tokens", "output_tokens", "cost_microusd", "outcome", "latency_ms", "created_at"]);
    }));

  it("the model id is at most 64 characters (plan deviation 11; mutation: drop ai_ledger_model_check -> the 65-character model is stored -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, 'call_summary', $2, 'ok')", [acct, "m".repeat(65)]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_model_check" });
    }));

  it("features and outcomes are closed sets, gate_unreadable included (plan deviation 2; mutations: drop either check -> the 'chat' / 'maybe' insert succeeds -> FAILS; leave gate_unreadable out of the outcome list -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      const ins = (feature: string, outcome: string) =>
        attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, $2, 'gpt-4o-mini', $3)", [acct, feature, outcome]);
      for (const f of ["call_summary", "call_proposals", "call_card", "record_summary"]) await ins(f, "ok");
      for (const o of ["global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"]) await ins("call_card", o);
      await expect(ins("chat", "ok")).rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_feature_check" });
      await expect(ins("call_card", "maybe")).rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_outcome_check" });
    }));

  it("tokens, cost and latency are never negative (mutation: drop ai_ledger_cost_check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome, cost_microusd) values ($1, 'call_card', 'gpt-4o-mini', 'ok', -1)", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_cost_check" });
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome, input_tokens) values ($1, 'call_card', 'gpt-4o-mini', 'ok', -1)", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_ledger_input_tokens_check" });
    }));

  it("a budget runs from 0 to 100000 cents (mutation: drop account_ai_settings_budget_check -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await attempt(c, "insert into account_ai_settings (account_id, monthly_budget_cents) values ($1, 0)", [acct]);
      await expect(attempt(c, "update account_ai_settings set monthly_budget_cents = 100001 where account_id = $1", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_budget_check" });
      await expect(attempt(c, "update account_ai_settings set monthly_budget_cents = -1 where account_id = $1", [acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "account_ai_settings_budget_check" });
    }));

  it("the global switch is one row, seeded on (mutations: drop ai_gateway_settings_singleton -> FAILS; seed it off -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ id: boolean; enabled: boolean }>("select id, enabled from ai_gateway_settings");
      expect(rows).toEqual([{ id: true, enabled: true }]);
      await expect(attempt(c, "insert into ai_gateway_settings (id, enabled) values (false, true)"))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_gateway_settings_singleton" });
    }));

  it("deleting the account deletes its ledger rows and its settings (mutation: drop on delete cascade on either FK -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await c.query("delete from accounts where id = $1", [acct]);
      const { rows: [n] } = await c.query<{ l: string; s: string }>(
        "select (select count(*) from ai_ledger where account_id = $1)::text as l, (select count(*) from account_ai_settings where account_id = $1)::text as s", [acct]);
      expect(n).toEqual({ l: "0", s: "0" });
    }));

  it("the teardown list carries both account tables first, and not the global row (spec 3.3; mutation: drop either name -> FAILS)", () => {
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
    expect((ACCOUNT_OWNED_TABLES as readonly string[]).includes("ai_gateway_settings")).toBe(false);
  });
});

describe("0086: who reads, who writes (spec 3.3, G6)", () => {
  const counts = async (c: Client, acct: string) => {
    const { rows: [n] } = await c.query<{ l: string; s: string; g: string }>(
      `select (select count(*) from ai_ledger where account_id = $1)::text as l,
              (select count(*) from account_ai_settings where account_id = $1)::text as s,
              (select count(*) from ai_gateway_settings)::text as g`, [acct]);
    await c.query("reset role");
    return n;
  };

  it("the agency reads all three (mutation: drop policy ai_ledger_agency_read -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await actAs(c, AGENCY);
      expect(await counts(c, acct)).toEqual({ l: "1", s: "1", g: "1" });
    }));

  it("the account's own Owner reads none of them: clients never see a meter (mutations: any of the three policies as `using (true)`; the two account policies as `using (account_id = app.current_account_id())` -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct);
      await actAsMember(c, acct, ORG, "owner");
      expect(await counts(c, acct)).toEqual({ l: "0", s: "0", g: "0" });
    }));

  it("anon and authenticated write nothing and anon reads nothing; service_role holds all four (mutation: grant insert on ai_ledger to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(`
        select r || ' ' || t || ' ' || p || ' ' || has_table_privilege(r, 'public.' || t, p)::text as x
          from (values ('anon'), ('authenticated'), ('service_role')) a(r)
         cross join (values ('ai_ledger'), ('account_ai_settings'), ('ai_gateway_settings')) b(t)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) d(p)`);
      const has = (r: string, t: string, p: string) => rows.some((x) => x.x === `${r} ${t} ${p} true`);
      const tables = ["ai_ledger", "account_ai_settings", "ai_gateway_settings"];
      for (const t of tables) {
        for (const p of ["INSERT", "UPDATE", "DELETE"]) expect([t, p, has("anon", t, p), has("authenticated", t, p)]).toEqual([t, p, false, false]);
        expect([t, has("anon", t, "SELECT"), has("authenticated", t, "SELECT")]).toEqual([t, false, true]);
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect([t, p, has("service_role", t, p)]).toEqual([t, p, true]);
      }
    }));

  it("an Owner's insert is refused (mutation: grant insert on ai_ledger to authenticated -> the insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await actAsMember(c, acct, ORG, "owner");
      await expect(attempt(c, "insert into ai_ledger (account_id, feature, model, outcome) values ($1, 'call_card', 'gpt-4o-mini', 'ok')", [acct]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("both functions are service_role only, security definer, with an empty search path (plan deviation 1; mutations: grant execute to authenticated; set search_path = public -> FAILS)", () =>
    withRollback(async (c) => {
      const sigs = ["public.ai_gate_check(uuid, text, text)", "public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text)"];
      for (const s of sigs) {
        const { rows: [p] } = await c.query<{ a: boolean; n: boolean; s: boolean }>(
          "select has_function_privilege('authenticated', $1, 'execute') as a, has_function_privilege('anon', $1, 'execute') as n, has_function_privilege('service_role', $1, 'execute') as s", [s]);
        expect([s, p]).toEqual([s, { a: false, n: false, s: true }]);
      }
      const { rows } = await c.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        "select proname, prosecdef, proconfig from pg_proc where proname in ('ai_gate_check', 'ai_ledger_record') order by proname");
      // Assumption A2: PG renders `set search_path = ''` as search_path="". If it differs, paste the real value.
      expect(rows).toEqual([
        { proname: "ai_gate_check", prosecdef: true, proconfig: ['search_path=""'] },
        { proname: "ai_ledger_record", prosecdef: true, proconfig: ['search_path=""'] },
      ]);
    }));
});

describe("0086: ai_gate_check (spec 3.1 step 3, 3.3; plan deviation 13)", () => {
  it("an account with no settings row gets the defaults: on, $10, nothing spent (mutation: coalesce(v_s.enabled, false) -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      expect(await gate(c, acct)).toEqual({ global_enabled: true, account_enabled: true, budget_microusd: 10000000, month_spend_microusd: 0, record_summaries_today: 0 });
    }));

  it("reads this month's spend and today's summaries, and zero for any other month or day (mutation: drop the month_key compare -> the November read sees 27 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { cost: 27 });
      await record(c, acct, { feature: "record_summary", cost: 30 });
      expect(await gate(c, acct)).toMatchObject({ month_spend_microusd: 57, record_summaries_today: 1 });
      expect(await gate(c, acct, "2026-11", "2026-11-01")).toMatchObject({ month_spend_microusd: 0, record_summaries_today: 0 });
      expect(await gate(c, acct, "2026-10", "2026-10-19")).toMatchObject({ month_spend_microusd: 57, record_summaries_today: 0 });
    }));

  it("the account's switch and budget, in micro-dollars (mutation: budget * 100 instead of * 10000 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await c.query("insert into account_ai_settings (account_id, enabled, monthly_budget_cents) values ($1, false, 500)", [acct]);
      expect(await gate(c, acct)).toMatchObject({ account_enabled: false, budget_microusd: 5000000 });
    }));

  it("the global switch, and OFF when its row is missing: fail closed (mutation: coalesce(v_global, true) -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await c.query("update ai_gateway_settings set enabled = false");
      expect((await gate(c, acct)).global_enabled).toBe(false);
      await c.query("delete from ai_gateway_settings");
      expect((await gate(c, acct)).global_enabled).toBe(false);
    }));

  it("refuses a null argument (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(attempt(c, "select public.ai_gate_check(null, '2026-10', '2026-10-18')")).rejects.toMatchObject({ code: "22004" });
    }));
});

describe("0086: ai_ledger_record (spec 3.1 step 6, 3.3; plan deviation 12)", () => {
  it("writes exactly one row with what it was given, null tokens allowed (mutation: insert 0 for a null token -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { feature: "call_card", inTok: null, outTok: null, cost: 0, outcome: "timeout", latency: 10001 });
      const { rows } = await c.query(
        "select feature, model, input_tokens, output_tokens, cost_microusd::text as cost, outcome, latency_ms from ai_ledger where account_id = $1", [acct]);
      expect(rows).toEqual([{ feature: "call_card", model: "gpt-4o-mini", input_tokens: null, output_tokens: null, cost: "0", outcome: "timeout", latency_ms: 10001 }]);
    }));

  it("adds within a month, resets on a newer month, and never rewinds on an older one (mutation: drop the older-key branch -> the late October row resets to 2026-10 -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { cost: 27 });
      await record(c, acct, { cost: 30 });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-10", s: "57" });
      await record(c, acct, { cost: 5, month: "2026-11", day: "2026-11-01" });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-11", s: "5" });
      await record(c, acct, { cost: 9, month: "2026-10", day: "2026-10-31" });
      expect(await counters(c, acct)).toMatchObject({ m: "2026-11", s: "5", d: "2026-11-01" });
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from ai_ledger where account_id = $1", [acct]);
      expect(n!.n).toBe("4");
    }));

  it("counts only a successful record_summary toward today, and resets on a new day (spec choice I8; mutations: count any outcome; count any feature -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await record(c, acct, { feature: "record_summary", outcome: "ok" });
      await record(c, acct, { feature: "record_summary", outcome: "provider_error", inTok: null, outTok: null, cost: 0 });
      await record(c, acct, { feature: "call_summary", outcome: "ok" });
      expect(await counters(c, acct)).toMatchObject({ d: "2026-10-18", t: 1 });
      await record(c, acct, { feature: "record_summary", outcome: "ok", day: "2026-10-19" });
      expect(await counters(c, acct)).toMatchObject({ d: "2026-10-19", t: 1 });
    }));

  it("refuses a null argument (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seed(c);
      await expect(attempt(c, "select public.ai_ledger_record($1, 'call_card', 'gpt-4o-mini', 1, 1, null, 'ok', 1, '2026-10', '2026-10-18')", [acct]))
        .rejects.toMatchObject({ code: "22004" });
    }));
});
```

- [ ] **Step 4: Run it on `post` to see it fail** (no 0086 yet). In `packages/db`, with `SUPABASE_DB_URL=postgresql://postgres@localhost:55650/post`: `node node_modules/vitest/vitest.mjs run src/test/ai-gateway-schema.test.ts > "$S/s15a-t1-impl/red.txt" 2>&1; echo $? > "$S/s15a-t1-impl/red.exit"`. Expected: every case FAILS (`relation "ai_ledger" does not exist`, the gate cases `function public.ai_gate_check(...) does not exist`, the teardown case `expected [ 'site_traffic_breakdown', … ] to deeply equal [ 'ai_ledger', 'account_ai_settings' ]`). Paste one failing assertion line.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0086_ai_gateway.sql`:

```sql
-- 0086_ai_gateway.sql - one door for AI calls (first release item 8, part 8a-1)
-- (docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md section 3;
--  docs/superpowers/plans/2026-10-18-ai-gateway-pr8a1.md)
--
-- Every completion the app makes goes through apps/web/src/lib/ai/gateway.ts, which asks
-- ai_gate_check before it spends and calls ai_ledger_record after. ai_ledger keeps one row per
-- call: account, feature, model, tokens, estimated cost in whole micro-dollars, outcome, latency.
-- It has NO column that could hold a prompt or an output (the model id is capped at 64 characters).
-- account_ai_settings holds the account's switch, its monthly budget (cents) and two counters the
-- record function moves forward: the month's spend and today's record summaries. No row means the
-- defaults (on, 1000 cents). ai_gateway_settings is one row: the switch for every account.
-- The agency alone reads all three (clients never see a meter); nobody but service_role writes or
-- executes. Both functions are security definer with an empty search_path.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads
-- none of it. The build after it needs it (the gateway fails closed on a missing function, which
-- would turn every call summary into its fact line): the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text);
--   drop function public.ai_gate_check(uuid, text, text);
--   drop table public.ai_gateway_settings;
--   drop table public.account_ai_settings;
--   drop table public.ai_ledger;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on accounts (the two foreign keys).
set local lock_timeout = '5s';

-- 1. The ledger.
create table public.ai_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  feature text not null constraint ai_ledger_feature_check
    check (feature in ('call_summary', 'call_proposals', 'call_card', 'record_summary')),
  model text not null constraint ai_ledger_model_check check (char_length(model) between 1 and 64),
  input_tokens integer constraint ai_ledger_input_tokens_check check (input_tokens >= 0),
  output_tokens integer constraint ai_ledger_output_tokens_check check (output_tokens >= 0),
  cost_microusd bigint not null default 0 constraint ai_ledger_cost_check check (cost_microusd >= 0),
  outcome text not null constraint ai_ledger_outcome_check
    check (outcome in ('ok', 'global_off', 'account_off', 'over_budget', 'unknown_model', 'gate_unreadable', 'no_key', 'timeout', 'provider_error')),
  latency_ms integer not null default 0 constraint ai_ledger_latency_check check (latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index ai_ledger_by_account on public.ai_ledger (account_id, created_at desc);
comment on table public.ai_ledger is
  'One row per AI completion or refusal (0086). Never the prompt, never the output. Written by ai_ledger_record only; the agency reads it.';

-- 2. The account's switch, budget and counters.
create table public.account_ai_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default true,
  monthly_budget_cents integer not null default 1000
    constraint account_ai_settings_budget_check check (monthly_budget_cents between 0 and 100000),
  month_key text constraint account_ai_settings_month_key_check
    check (month_key is null or (char_length(month_key) = 7 and month_key !~ '[^0-9-]')),
  month_spend_microusd bigint not null default 0 constraint account_ai_settings_spend_check check (month_spend_microusd >= 0),
  day_key text constraint account_ai_settings_day_key_check
    check (day_key is null or (char_length(day_key) = 10 and day_key !~ '[^0-9-]')),
  record_summaries_today integer not null default 0 constraint account_ai_settings_today_check check (record_summaries_today >= 0),
  updated_by text,
  updated_at timestamptz
);
comment on table public.account_ai_settings is
  'An account''s AI switch and monthly budget (0086), and the month''s spend and today''s record summaries, moved forward by ai_ledger_record. No row means on and 1000 cents.';

-- 3. The switch for every account: one row.
create table public.ai_gateway_settings (
  id boolean primary key default true constraint ai_gateway_settings_singleton check (id),
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz
);
insert into public.ai_gateway_settings (id, enabled) values (true, true);
comment on table public.ai_gateway_settings is
  'The one switch for AI in every account (0086). A missing row reads as OFF (fail closed).';

-- 4. Who reads: the agency, nobody else. Who writes: service_role only.
alter table public.ai_ledger enable row level security;
alter table public.account_ai_settings enable row level security;
alter table public.ai_gateway_settings enable row level security;
revoke all on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings from anon, authenticated;
grant select on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings to authenticated;
grant select, insert, update, delete on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings to service_role;
create policy ai_ledger_agency_read on public.ai_ledger for select to authenticated
  using (coalesce(app.is_agency(), false));
create policy account_ai_settings_agency_read on public.account_ai_settings for select to authenticated
  using (coalesce(app.is_agency(), false));
create policy ai_gateway_settings_agency_read on public.ai_gateway_settings for select to authenticated
  using (coalesce(app.is_agency(), false));

-- 5. The gate: both switches, the budget in micro-dollars, this month's spend and today's summaries
--    (zero when the stored key is another period). The global switch reads OFF when its row is gone.
create function public.ai_gate_check(p_account uuid, p_month text, p_day text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_global boolean; v_s public.account_ai_settings%rowtype;
begin
  if p_account is null or p_month is null or p_day is null then
    raise exception 'ai_gate_check: a required argument is null' using errcode = '22004';
  end if;
  select g.enabled into v_global from public.ai_gateway_settings g where g.id;
  select * into v_s from public.account_ai_settings s where s.account_id = p_account;
  return jsonb_build_object(
    'global_enabled', coalesce(v_global, false),
    'account_enabled', coalesce(v_s.enabled, true),
    'budget_microusd', coalesce(v_s.monthly_budget_cents, 1000)::bigint * 10000,
    'month_spend_microusd', case when v_s.month_key = p_month then v_s.month_spend_microusd else 0 end,
    'record_summaries_today', case when v_s.day_key = p_day then v_s.record_summaries_today else 0 end);
end $$;
revoke all on function public.ai_gate_check(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.ai_gate_check(uuid, text, text) to service_role;

-- 6. The record: one ledger row, then the counters, in one transaction. A key equal to the stored
--    one adds; a NEWER key resets; an OLDER key (a late row from another instance) leaves the
--    counters alone. YYYY-MM and YYYY-MM-DD sort as text.
create function public.ai_ledger_record(
  p_account uuid, p_feature text, p_model text, p_in integer, p_out integer, p_cost bigint,
  p_outcome text, p_latency integer, p_month text, p_day text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inc integer;
begin
  if p_account is null or p_feature is null or p_model is null or p_cost is null or p_outcome is null
     or p_latency is null or p_month is null or p_day is null then
    raise exception 'ai_ledger_record: a required argument is null' using errcode = '22004';
  end if;
  v_inc := case when p_feature = 'record_summary' and p_outcome = 'ok' then 1 else 0 end;
  insert into public.ai_ledger (account_id, feature, model, input_tokens, output_tokens, cost_microusd, outcome, latency_ms)
  values (p_account, p_feature, p_model, p_in, p_out, p_cost, p_outcome, p_latency);
  insert into public.account_ai_settings as s (account_id, month_key, month_spend_microusd, day_key, record_summaries_today)
  values (p_account, p_month, p_cost, p_day, v_inc)
  on conflict (account_id) do update set
    month_spend_microusd = case
      when s.month_key = p_month then s.month_spend_microusd + p_cost
      when s.month_key is null or s.month_key < p_month then p_cost
      else s.month_spend_microusd end,
    month_key = case when s.month_key is null or s.month_key < p_month then p_month else s.month_key end,
    record_summaries_today = case
      when s.day_key = p_day then s.record_summaries_today + v_inc
      when s.day_key is null or s.day_key < p_day then v_inc
      else s.record_summaries_today end,
    day_key = case when s.day_key is null or s.day_key < p_day then p_day else s.day_key end;
end $$;
revoke all on function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text) to service_role;
```

- [ ] **Step 5b: Teardown.** `packages/db/src/account-teardown.ts:20-21`: the array's first line becomes two lines:

```ts
  // Item 8a-1 (0086): the AI ledger and the account's AI settings (both cascade too; spec 3.3 lists them).
  "ai_ledger", "account_ai_settings",
  "site_traffic_breakdown", "site_traffic_daily", "sites",
```

- [ ] **Step 5c: The demo-seed leftover count (review M7).** `demo-seed.test.ts:274-278` counts every `ACCOUNT_OWNED_TABLES` table with `.select("id", …)`; `account_ai_settings` has no `id` (its key is `account_id`), so that select errors, `count` is null, and the table is silently skipped. Change the loop body to:

```ts
        const { count: n, error } = await db.from(table)
          .select("account_id", { count: "exact", head: true }).eq("account_id", accountId);
        if (error) leftovers.push(`${table}: ${error.message}`);
        else if (n) leftovers.push(`${table}: ${n}`);
```

Every table on the list has `account_id` (it is how the list deletes). This runs behind PostgREST only (it seeds a demo tenant), so Task 2's implementer runs it on set A after Task 1 commits: `demo-seed.test.ts` PASS; probe: put `.select("id", …)` back and add a row to `account_ai_settings` for the throwaway in the test by hand → the leftover is NOT reported (proving the old shape was blind), then with the fix it is.

- [ ] **Step 6: The bytes.** Write the checker with a quoted heredoc (no shell expansion):

```bash
cat > "$S/s15a-t1-impl/bytes.mjs" <<'EOF'
import { readFileSync } from "node:fs";
const b = readFileSync(process.argv[2]);
let nonAscii = 0, backslash = 0;
for (const x of b) { if (x > 127) nonAscii++; if (x === 92) backslash++; }
const loneDollar = (b.toString("latin1").split("$$").join("").match(/[$]/g) ?? []).length;
console.log(JSON.stringify({ nonAscii, backslash, loneDollar }));
EOF
node "$S/s15a-t1-impl/bytes.mjs" packages/db/supabase/migrations/0086_ai_gateway.sql
node -e "const f=require('fs');f.writeFileSync(process.argv[2],Buffer.concat([f.readFileSync(process.argv[1]),Buffer.from([0xc3,0xa9,0x5c,0x24])]))" packages/db/supabase/migrations/0086_ai_gateway.sql "$S/s15a-t1-impl/control.sql"
node "$S/s15a-t1-impl/bytes.mjs" "$S/s15a-t1-impl/control.sql"
md5sum packages/db/supabase/migrations/0086_ai_gateway.sql
```

Expected: `{"nonAscii":0,"backslash":0,"loneDollar":0}`, then the control `{"nonAscii":2,"backslash":1,"loneDollar":1}` (the checker can fail). Paste all three lines and the md5 (Task 13 compares it).

- [ ] **Step 7: Apply and run green.** `bash "$S/s15a-kit/replica.sh" 55650 "$S/s15a-t1-impl"` again → `post = pre + 0086`. Run `ai-gateway-schema.test.ts` and `schema-grants-guard.test.ts` on `post` (exit code to a file, nothing after it). Paste each summary line. Expected: all PASS. Run the Faithfulness query on `post` and paste it: equal to `pre`'s.

- [ ] **Step 8: Probes, by name** (each a temporary edit of the migration or of `account-teardown.ts`, re-applied with `replica.sh`, reverted by hand and `cmp`-checked): (a) add `prompt text,` after `model` in `ai_ledger` → "the ledger's columns are exactly these" FAILS; (b) `ai_ledger_agency_read` as `using (true)` → "the account's own Owner reads none of them" FAILS; (c) `account_ai_settings_agency_read` as `using (account_id = app.current_account_id())` → the same case FAILS on `s`; (d) `grant insert on public.ai_ledger to authenticated` after the revoke → both write cases FAIL; (e) `grant execute on function public.ai_gate_check(uuid, text, text) to authenticated` → the functions case FAILS; (f) `set search_path = public` on `ai_gate_check` → the functions case FAILS on `proconfig`; (g) `coalesce(v_global, true)` → "OFF when its row is missing" FAILS; (h) in `ai_ledger_record`, replace both `when s.month_key is null or s.month_key < p_month` arms by `else p_cost` / `else p_month` (no older branch) → "never rewinds on an older one" FAILS; (i) `v_inc` as `case when p_feature = 'record_summary' then 1 else 0 end` → "counts only a successful record_summary" FAILS; (j) remove `'gate_unreadable', ` from the outcome check → "features and outcomes are closed sets" FAILS; (k) drop `"account_ai_settings",` from the teardown list → the teardown case FAILS. Paste each failing line.

- [ ] **Step 9: Stop your kit.** **Commit** `git add -- packages/db/supabase/migrations/0086_ai_gateway.sql packages/db/src/test/ai-gateway-schema.test.ts` then `git commit -m "db: 0086 the AI gateway: a ledger with no room for a prompt, the account's switch and budget, the switch for every account, read by the agency alone (item 8a-1)" -- packages/db/supabase/migrations/0086_ai_gateway.sql packages/db/src/test/ai-gateway-schema.test.ts packages/db/src/account-teardown.ts packages/db/src/test/demo-seed.test.ts` (with the trailers).

---

## Task 2: `@bis/db`: the gateway module and the barrel (bis-crm)

**Review:** opus. **Scratch:** `<SCRATCH>/s15a-t2-impl/`, replica set A (Postgres `55652`, PostgREST `55653`, gateway `55654`); reviewer set B.

**Files**
- Create: `packages/db/src/ai-gateway.ts`, `packages/db/src/test/ai-gateway.test.ts`
- Modify: `packages/db/src/index.ts` (one export block appended after the S-07 3b block, `:342-348`)

**Interfaces**
- Consumes: 0086 (Task 1): `ai_gate_check`, `ai_ledger_record`, the three tables.
- Produces (exported from `@bis/db`):
  - `AI_FEATURES` = `["call_summary", "call_proposals", "call_card", "record_summary"] as const`; `type AiFeature`.
  - `AI_OUTCOMES` = `["ok", "global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"] as const`; `type AiOutcome`.
  - `type AiGate = { globalEnabled: boolean; accountEnabled: boolean; budgetMicroUsd: number; monthSpendMicroUsd: number; recordSummariesToday: number }`.
  - `aiGateCheck(db: SupabaseClient, a: { accountId: string; monthKey: string; dayKey: string; signal?: AbortSignal }): Promise<AiGate>` (throws on any failure or unexpected answer).
  - `type AiLedgerEntry = { accountId: string; feature: AiFeature; model: string; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number; outcome: AiOutcome; latencyMs: number; monthKey: string; dayKey: string }`; `recordAiLedger(db, r: AiLedgerEntry & { signal?: AbortSignal }): Promise<void>` (throws).
  - `DEFAULT_MONTHLY_BUDGET_CENTS = 1000`, `MAX_MONTHLY_BUDGET_CENTS = 100000`.
  - `type AiSettingsRead = { accountEnabled: boolean; monthlyBudgetCents: number; monthKey: string | null; monthSpendMicroUsd: number; globalEnabled: boolean }`; `getAiSettings(db, accountId): Promise<AiSettingsRead>` (no account row → the defaults; no global row → `globalEnabled: false`; throws on a read error).
  - `countAiSkipsSince(db, accountId, sinceIso: string): Promise<number>` (only `global_off`, `account_off` and `over_budget` rows at or after `sinceIso`: the times AI was off or over budget, which is what the card's sentence says; a `timeout` or `provider_error` is not a skip; throws on a null count, memory "Head-count null").
  - `firstOverBudgetSince(db, accountId, sinceIso: string): Promise<string | null>` (the earliest `over_budget` row's `created_at`).
  - `setAccountAiSettings(db, accountId, s: { enabled: boolean; monthlyBudgetCents: number; actorId: string }): Promise<void>` (an upsert of exactly `account_id, enabled, monthly_budget_cents, updated_by, updated_at`: never the counters).
  - `setGlobalAiEnabled(db, s: { enabled: boolean; actorId: string }): Promise<void>` (updates the one row; throws when no row was updated).

- [ ] **Step 1: Read** `sed -n 1,20p packages/db/src/document-shares.ts` and `:194-206` (`claimDocumentShareDownload`, the rpc-wrapper shape), `sed -n 130,160p packages/db/src/test/fixtures.ts` (`withTestAccount`), `sed -n 330,350p packages/db/src/index.ts`.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/ai-gateway.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  aiGateCheck, recordAiLedger, getAiSettings, setAccountAiSettings, setGlobalAiEnabled,
  countAiSkipsSince, firstOverBudgetSince, AI_FEATURES, AI_OUTCOMES, type AiLedgerEntry,
} from "../ai-gateway";

/** Item 8a-1 (spec 3.1, 3.3, 3.6): the wrappers over 0086, through PostgREST, on the service client. */
const KEYS = { monthKey: "2026-10", dayKey: "2026-10-18" };
const entry = (accountId: string, o: Partial<AiLedgerEntry> = {}): AiLedgerEntry => ({
  accountId, feature: "call_summary", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 20,
  costMicroUsd: 27, outcome: "ok", latencyMs: 5, ...KEYS, ...o,
});

describe("aiGateCheck / recordAiLedger", () => {
  it("a fresh account reads the defaults, in numbers (assumption A3; mutation: return budget_microusd as String(...) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await aiGateCheck(db, { accountId, ...KEYS })).toEqual({
        globalEnabled: true, accountEnabled: true, budgetMicroUsd: 10_000_000, monthSpendMicroUsd: 0, recordSummariesToday: 0,
      });
    }));

  it("a recorded call is in this month's spend (mutation: pass p_cost: 0 in recordAiLedger -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await recordAiLedger(db, entry(accountId, { costMicroUsd: 720 }));
      await recordAiLedger(db, entry(accountId, { feature: "record_summary", costMicroUsd: 600 }));
      expect(await aiGateCheck(db, { accountId, ...KEYS })).toMatchObject({ monthSpendMicroUsd: 1320, recordSummariesToday: 1 });
      const { data } = await db.from("ai_ledger").select("feature, input_tokens, output_tokens, cost_microusd, outcome").eq("account_id", accountId).order("cost_microusd");
      expect(data).toEqual([
        { feature: "record_summary", input_tokens: 100, output_tokens: 20, cost_microusd: 600, outcome: "ok" },
        { feature: "call_summary", input_tokens: 100, output_tokens: 20, cost_microusd: 720, outcome: "ok" },
      ]);
    }));

  it("an aborted signal rejects instead of waiting (assumption A1; mutation: drop the .abortSignal(signal) line -> resolves -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(aiGateCheck(db, { accountId, ...KEYS, signal: AbortSignal.abort() })).rejects.toThrow();
      await expect(recordAiLedger(db, { ...entry(accountId), signal: AbortSignal.abort() })).rejects.toThrow();
    }));

  it("an answer of the wrong shape throws, never reads as open (mutation: drop the shape check -> FAILS)", async () => {
    const builder = {
      abortSignal() { return builder; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: { global_enabled: "yes" }, error: null }).then(ok),
    };
    const odd = { rpc: () => builder } as unknown as SupabaseClient;
    await expect(aiGateCheck(odd, { accountId: "a", ...KEYS })).rejects.toThrow(/unexpected answer/);
  });

  it("every AI_FEATURES and AI_OUTCOMES value is one 0086 accepts, through recordAiLedger (review M5; mutation: add 'chat' to AI_FEATURES or 'maybe' to AI_OUTCOMES -> the check constraint refuses it -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      for (const feature of AI_FEATURES) await recordAiLedger(db, entry(accountId, { feature }));
      for (const outcome of AI_OUTCOMES) await recordAiLedger(db, entry(accountId, { feature: "call_card", outcome }));
      const { count, error } = await db.from("ai_ledger").select("id", { count: "exact", head: true }).eq("account_id", accountId);
      expect([error, count]).toEqual([null, AI_FEATURES.length + AI_OUTCOMES.length]);
    }));
});

describe("the card's reads and writes", () => {
  it("no row reads the defaults; a save is read back and never resets the counters (mutation: add month_spend_microusd: 0 to the upsert -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getAiSettings(db, accountId)).toEqual({ accountEnabled: true, monthlyBudgetCents: 1000, monthKey: null, monthSpendMicroUsd: 0, globalEnabled: true });
      await recordAiLedger(db, entry(accountId, { costMicroUsd: 720 }));
      await setAccountAiSettings(db, accountId, { enabled: false, monthlyBudgetCents: 2500, actorId: "user_test" });
      expect(await getAiSettings(db, accountId)).toEqual({ accountEnabled: false, monthlyBudgetCents: 2500, monthKey: "2026-10", monthSpendMicroUsd: 720, globalEnabled: true });
      const { data } = await db.from("account_ai_settings").select("updated_by").eq("account_id", accountId).single();
      expect(data).toEqual({ updated_by: "user_test" });
    }));

  // Review I9: the db suite NEVER writes ai_gateway_settings (one row shared by every account and every
  // concurrent suite on the project). setGlobalAiEnabled and getAiSettings's missing-row answer are proved on a
  // recording stub; the real row's behaviour (seeded on, a missing row reads off) is 0086's withRollback SQL tests.
  function stubDb(answer: { data: unknown; error: { message: string } | null }) {
    const seen: unknown[][] = [];
    const chain = {
      update: (v: unknown) => { seen.push(["update", v]); return chain; },
      eq: (c: string, v: unknown) => { seen.push(["eq", c, v]); return chain; },
      select: (c: string) => { seen.push(["select", c]); return chain; },
      maybeSingle: async () => answer,
      then: (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok),
    };
    return { seen, db: { from: (t: string) => { seen.push(["from", t]); return chain; } } as unknown as SupabaseClient };
  }

  it("setGlobalAiEnabled updates exactly the one row by id, as the actor, and refuses when no row was updated (mutations: drop .eq('id', true); drop the length check -> FAILS)", async () => {
    const ok = stubDb({ data: [{ id: true }], error: null });
    await setGlobalAiEnabled(ok.db, { enabled: false, actorId: "user_test" });
    expect(ok.seen.map((x) => x.slice(0, 2))).toEqual([["from", "ai_gateway_settings"], ["update", expect.objectContaining({ enabled: false, updated_by: "user_test" })], ["eq", "id"], ["select", "id"]]);
    expect(ok.seen[2]).toEqual(["eq", "id", true]);
    await expect(setGlobalAiEnabled(stubDb({ data: [], error: null }).db, { enabled: true, actorId: "user_test" })).rejects.toThrow("the switch row is missing");
  });

  it("getAiSettings reads a missing global row as OFF, as the gate does (plan deviation 13; mutation: g?.enabled ?? true -> FAILS)", async () => {
    const none = stubDb({ data: null, error: null });
    expect((await getAiSettings(none.db, "a1")).globalEnabled).toBe(false);
  });

  it("counts this month's skips (off or over budget, never a failed request) and finds the first over-budget row (mutations: .neq('outcome', 'ok') instead of .in(...) -> 4 -> FAILS; order descending -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const refused = { inputTokens: null, outputTokens: null, costMicroUsd: 0 };
      await recordAiLedger(db, entry(accountId));
      await recordAiLedger(db, entry(accountId, { outcome: "account_off", ...refused }));
      await recordAiLedger(db, entry(accountId, { outcome: "provider_error", ...refused }));   // a failure, not a skip: must not count
      await recordAiLedger(db, entry(accountId, { outcome: "over_budget", ...refused }));
      await recordAiLedger(db, entry(accountId, { outcome: "over_budget", ...refused }));
      const since = new Date(Date.now() - 60_000).toISOString();
      expect(await countAiSkipsSince(db, accountId, since)).toBe(3);
      expect(await countAiSkipsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
      const { data } = await db.from("ai_ledger").select("created_at").eq("account_id", accountId).eq("outcome", "over_budget").order("created_at");
      expect(data).toHaveLength(2);
      expect(await firstOverBudgetSince(db, accountId, since)).toBe(data![0]!.created_at);
    }));
});
```

(The descending-order probe only fails when the two over-budget rows carry different `created_at` values; `now()` is per transaction and each RPC is its own, so they differ. If the probe passes, the reviewer reports it and the implementer adds a 10 ms wait between the two inserts.)

- [ ] **Step 3: Run it to see it fail.** Bring up set A (`bash "$S/s15a-kit/replica.sh" 55652 "$S/s15a-t2-impl"`, then `bash "$S/s15a-kit/pgrst.sh" 55652 55653 55654 "$S/s15a-t2-impl"`, `source "$S/s15a-t2-impl/env-run.sh"`), then in `packages/db`: `node node_modules/vitest/vitest.mjs run src/test/ai-gateway.test.ts > "$S/s15a-t2-impl/red.txt" 2>&1; echo $? > "$S/s15a-t2-impl/red.exit"`. Expected: FAIL with `Failed to load url ../ai-gateway` (or `Cannot find module`). Paste it.

- [ ] **Step 4: Write** `packages/db/src/ai-gateway.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Item 8a-1 (spec 3.1, 3.3, 3.6): the reads and writes behind apps/web/src/lib/ai/gateway.ts and the
 * agency's AI card. The two RPCs are 0086's security definer functions (service_role only), so the
 * gateway's caller passes a service client; the card's reads run on the agency's REQUEST client
 * (0086 lets the agency alone SELECT all three tables). Nothing here takes or returns a prompt or a
 * model's output: the ledger has no column for either.
 */
export const AI_FEATURES = ["call_summary", "call_proposals", "call_card", "record_summary"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_OUTCOMES = ["ok", "global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export const DEFAULT_MONTHLY_BUDGET_CENTS = 1000;
export const MAX_MONTHLY_BUDGET_CENTS = 100000;

export type AiGate = { globalEnabled: boolean; accountEnabled: boolean; budgetMicroUsd: number; monthSpendMicroUsd: number; recordSummariesToday: number };
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export async function aiGateCheck(db: SupabaseClient, a: { accountId: string; monthKey: string; dayKey: string; signal?: AbortSignal }): Promise<AiGate> {
  let q = db.rpc("ai_gate_check", { p_account: a.accountId, p_month: a.monthKey, p_day: a.dayKey });
  if (a.signal) q = q.abortSignal(a.signal);
  const { data, error } = await q;
  if (error) throw new Error(`aiGateCheck failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r === null || typeof r !== "object" || typeof r.global_enabled !== "boolean" || typeof r.account_enabled !== "boolean"
      || !isCount(r.budget_microusd) || !isCount(r.month_spend_microusd) || !isCount(r.record_summaries_today)) {
    throw new Error("aiGateCheck: unexpected answer");
  }
  return {
    globalEnabled: r.global_enabled, accountEnabled: r.account_enabled, budgetMicroUsd: r.budget_microusd,
    monthSpendMicroUsd: r.month_spend_microusd, recordSummariesToday: r.record_summaries_today,
  };
}

export type AiLedgerEntry = {
  accountId: string; feature: AiFeature; model: string; inputTokens: number | null; outputTokens: number | null;
  costMicroUsd: number; outcome: AiOutcome; latencyMs: number; monthKey: string; dayKey: string;
};

export async function recordAiLedger(db: SupabaseClient, r: AiLedgerEntry & { signal?: AbortSignal }): Promise<void> {
  let q = db.rpc("ai_ledger_record", {
    p_account: r.accountId, p_feature: r.feature, p_model: r.model, p_in: r.inputTokens, p_out: r.outputTokens,
    p_cost: r.costMicroUsd, p_outcome: r.outcome, p_latency: r.latencyMs, p_month: r.monthKey, p_day: r.dayKey,
  });
  if (r.signal) q = q.abortSignal(r.signal);
  const { error } = await q;
  if (error) throw new Error(`recordAiLedger failed: ${error.message}`);
}

export type AiSettingsRead = { accountEnabled: boolean; monthlyBudgetCents: number; monthKey: string | null; monthSpendMicroUsd: number; globalEnabled: boolean };

/** The card's read. No account row means the defaults; no global row reads OFF, as the gate does. */
export async function getAiSettings(db: SupabaseClient, accountId: string): Promise<AiSettingsRead> {
  const [acct, global] = await Promise.all([
    db.from("account_ai_settings").select("enabled, monthly_budget_cents, month_key, month_spend_microusd").eq("account_id", accountId).maybeSingle(),
    db.from("ai_gateway_settings").select("enabled").eq("id", true).maybeSingle(),
  ]);
  if (acct.error) throw new Error(`getAiSettings: account read failed: ${acct.error.message}`);
  if (global.error) throw new Error(`getAiSettings: global read failed: ${global.error.message}`);
  const a = acct.data as { enabled: boolean; monthly_budget_cents: number; month_key: string | null; month_spend_microusd: number | string } | null;
  const g = global.data as { enabled: boolean } | null;
  return {
    accountEnabled: a?.enabled ?? true,
    monthlyBudgetCents: a?.monthly_budget_cents ?? DEFAULT_MONTHLY_BUDGET_CENTS,
    monthKey: a?.month_key ?? null,
    monthSpendMicroUsd: Number(a?.month_spend_microusd ?? 0),
    globalEnabled: g?.enabled ?? false,
  };
}

export async function countAiSkipsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db.from("ai_ledger").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).in("outcome", ["global_off", "account_off", "over_budget"]).gte("created_at", sinceIso);
  if (error) throw new Error(`countAiSkipsSince failed: ${error.message}`);
  // memory "Head-count null": a failed head count can come back { count: null, error: null }.
  if (count === null) throw new Error("countAiSkipsSince: no count");
  return count;
}

export async function firstOverBudgetSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<string | null> {
  const { data, error } = await db.from("ai_ledger").select("created_at")
    .eq("account_id", accountId).eq("outcome", "over_budget").gte("created_at", sinceIso)
    .order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`firstOverBudgetSince failed: ${error.message}`);
  return (data?.[0] as { created_at: string } | undefined)?.created_at ?? null;
}

/** The card's Save (and its Undo). Writes exactly these columns, so the counters ai_ledger_record keeps are never reset. */
export async function setAccountAiSettings(db: SupabaseClient, accountId: string, s: { enabled: boolean; monthlyBudgetCents: number; actorId: string }): Promise<void> {
  const { error } = await db.from("account_ai_settings").upsert({
    account_id: accountId, enabled: s.enabled, monthly_budget_cents: s.monthlyBudgetCents,
    updated_by: s.actorId, updated_at: new Date().toISOString(),
  }, { onConflict: "account_id" });
  if (error) throw new Error(`setAccountAiSettings failed: ${error.message}`);
}

export async function setGlobalAiEnabled(db: SupabaseClient, s: { enabled: boolean; actorId: string }): Promise<void> {
  const { data, error } = await db.from("ai_gateway_settings")
    .update({ enabled: s.enabled, updated_by: s.actorId, updated_at: new Date().toISOString() })
    .eq("id", true).select("id");
  if (error) throw new Error(`setGlobalAiEnabled failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error("setGlobalAiEnabled: the switch row is missing");
}
```

(`month_spend_microusd` is `bigint`; PostgREST may send a bigint as a number or a string, and `Number(…)` reads both. The test's `720` pins the result either way.)

- [ ] **Step 5: The barrel.** Append after the S-07 3b block in `packages/db/src/index.ts` (`:348`):

```ts
// Item 8a-1: the AI gateway's ledger, switches and budget. See ./ai-gateway.ts.
export {
  AI_FEATURES, AI_OUTCOMES, DEFAULT_MONTHLY_BUDGET_CENTS, MAX_MONTHLY_BUDGET_CENTS,
  aiGateCheck, recordAiLedger, getAiSettings, countAiSkipsSince, firstOverBudgetSince, setAccountAiSettings, setGlobalAiEnabled,
  type AiFeature, type AiOutcome, type AiGate, type AiLedgerEntry, type AiSettingsRead,
} from "./ai-gateway";
```

- [ ] **Step 6: Run green.** The same command → PASS (9 tests; read the count off the summary). `pnpm --filter @bis/db typecheck > "$S/s15a-t2-impl/tc.txt" 2>&1; echo $? > "$S/s15a-t2-impl/tc.exit"` → `0`. Paste both.

- [ ] **Step 7: Probes, by name:** (a) drop `if (a.signal) q = q.abortSignal(a.signal);` → "an aborted signal rejects" FAILS; (b) drop the shape check (return the fields cast) → "an answer of the wrong shape throws" FAILS; (c) the upsert payload gains `month_spend_microusd: 0` → "never resets the counters" FAILS; (d) `.neq("outcome", "ok")` instead of the `.in(...)` → the skip count is 4 (the `provider_error` row) → FAILS; (e) `ascending: false` → the first over-budget case FAILS; (f) `globalEnabled: g?.enabled ?? true` → "getAiSettings reads a missing global row as OFF" FAILS (the stub, never the real row: review I9); (g) drop `.eq("id", true)` from `setGlobalAiEnabled` → its stub case FAILS; (h) add `"chat"` to `AI_FEATURES` → the closed-sets case FAILS on the check constraint. Paste each failing line.

- [ ] **Step 8: Stop your kit.** **Commit** `git add -- packages/db/src/ai-gateway.ts packages/db/src/test/ai-gateway.test.ts` then `git commit -m "db: the AI gateway's gate, ledger and settings wrappers, through one module and the barrel (item 8a-1)" -- packages/db/src/ai-gateway.ts packages/db/src/test/ai-gateway.test.ts packages/db/src/index.ts`.

---

## Task 3: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (keys appended after `"sharePage.askNoName.es"`, `:4965`, the catalogue's last key), `apps/web/src/lib/messages.test.ts` (one `describe` appended at the end)

**Interfaces**
- Produces (every key Tasks 7 and 8 use; each with its `.es` twin): `aiSettings.title`, `aiSettings.description`, `aiSettings.account.label`, `aiSettings.account.help`, `aiSettings.budget.label`, `aiSettings.budget.help`, `aiSettings.spend`, `aiSettings.empty`, `aiSettings.reached`, `aiSettings.reachedNoDate`, `aiSettings.skipped`, `aiSettings.skippedOne`, `aiSettings.save`, `aiSettings.saved`, `aiSettings.undone`, `aiSettings.error.budget`, `aiSettings.error.failed`, `aiSettings.crashed`, `aiSettings.loadError`, `aiSettings.global.label`, `aiSettings.global.onHelp`, `aiSettings.global.offHelp`, `aiSettings.global.turnOff`, `aiSettings.global.turnOn`, `aiSettings.global.confirmTitle`, `aiSettings.global.confirmBody`, `aiSettings.global.confirmWord`, `aiSettings.global.confirmLabel`, `aiSettings.global.cancel`, `aiSettings.global.turnedOff`, `aiSettings.global.turnedOn`, `aiSettings.global.wrongWord`, `palette.settings.ai` (33 keys).

- [ ] **Step 1: Read** `apps/web/src/lib/i18n/t.ts:36-64` (read for this plan: `t(catalogue, key, locale, params?)`; `plural(catalogue, baseKey, count, locale, params?)`, which picks `${baseKey}One` and does NOT fill `{count}`) and `messages.test.ts:1-5` (it imports `t` only).

- [ ] **Step 2: Write the failing test** (append to `apps/web/src/lib/messages.test.ts`):

```ts
describe("item 8a-1: the AI card's copy (spec 3.6)", () => {
  const KEYS_8A1 = [
    "aiSettings.title", "aiSettings.description", "aiSettings.account.label", "aiSettings.account.help", "aiSettings.budget.label",
    "aiSettings.budget.help", "aiSettings.spend", "aiSettings.empty", "aiSettings.reached", "aiSettings.reachedNoDate",
    "aiSettings.skipped", "aiSettings.skippedOne", "aiSettings.save", "aiSettings.saved", "aiSettings.undone",
    "aiSettings.error.budget", "aiSettings.error.failed", "aiSettings.crashed", "aiSettings.loadError",
    "aiSettings.global.label", "aiSettings.global.onHelp", "aiSettings.global.offHelp", "aiSettings.global.turnOff",
    "aiSettings.global.turnOn", "aiSettings.global.confirmTitle", "aiSettings.global.confirmBody", "aiSettings.global.confirmWord",
    "aiSettings.global.confirmLabel", "aiSettings.global.cancel", "aiSettings.global.turnedOff", "aiSettings.global.turnedOn",
    "aiSettings.global.wrongWord", "palette.settings.ai",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    expect(KEYS_8A1.filter((k) => !(k in m) || !(`${k}.es` in m))).toEqual([]);
  });

  it("the spec's sentences, in both languages (spec 3.6; mutation: change either side of any pair -> FAILS)", () => {
    expect([t(m, "aiSettings.spend", "en", { spent: "$1.84", budget: "$10.00" }), t(m, "aiSettings.spend", "es", { spent: "$1.84", budget: "$10.00" })])
      .toEqual(["$1.84 of $10.00 this month, estimated", "$1.84 de $10.00 este mes, estimado"]);
    expect([t(m, "aiSettings.reached", "en", { date: "Oct 14", resume: "Nov 1" }), t(m, "aiSettings.reached", "es", { date: "14 oct", resume: "1 nov" })])
      .toEqual(["Budget reached on Oct 14. AI is paused for this account until Nov 1.", "Presupuesto alcanzado el 14 oct. La IA está en pausa en esta cuenta hasta el 1 nov."]);
    expect([m["aiSettings.empty"], m["aiSettings.empty.es"]]).toEqual(["No AI use yet this month.", "Todavía no hay uso de IA este mes."]);
    expect([m["aiSettings.global.label"], m["aiSettings.global.label.es"]]).toEqual(["AI for every account", "IA para todas las cuentas"]);
    expect([m["aiSettings.account.label"], m["aiSettings.account.label.es"]]).toEqual(["AI for this account", "IA para esta cuenta"]);
    expect([m["aiSettings.global.confirmWord"], m["aiSettings.global.confirmWord.es"]]).toEqual(["OFF", "APAGAR"]);
    expect([plural(m, "aiSettings.skipped", 1, "en"), plural(m, "aiSettings.skipped", 3, "es", { count: 3 })])
      .toEqual(["AI was skipped once this month because it was off or over budget.", "La IA se omitió 3 veces este mes porque estaba apagada o sin presupuesto."]);
  });

  it("no copy names the vendor or the plumbing (mutation: 'OpenAI' or 'tokens' in any value -> FAILS)", () => {
    const all = KEYS_8A1.flatMap((k) => [m[k], m[`${k}.es` as keyof typeof m] as string]);
    for (const s of all) expect(s).not.toMatch(/\b(openai|gpt|token|tokens|ledger|gateway|rpc|model|microd[oó]lar)/i);
  });

  it("Spanish is usted, never tu (mutation: 'Escribe' or 'tu' in any .es -> FAILS)", () => {
    const es = KEYS_8A1.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(escribe|intenta|recarga|tu|tus|contigo)\b/i);
  });
});
```

(`plural` does not fill `{count}` itself (`t.ts:54-64`: it only picks the `One` key by `Intl.PluralRules`), so the count is passed as `params`. `messages.test.ts:5` imports `t` only: change it to `import { t, plural } from "./i18n/t";`.)

- [ ] **Step 3: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → FAIL in "every key has a Spanish twin" listing all 33 keys. Paste the line.

- [ ] **Step 4: Append the keys** after `:4965`:

```ts
  // Item 8a-1: the agency's AI card on the account's Settings (spec 3.6). Agency-only; no vendor words.
  "aiSettings.title": "AI",
  "aiSettings.title.es": "IA",
  "aiSettings.description": "What AI costs this account, and the switches that stop it.",
  "aiSettings.description.es": "Lo que cuesta la IA en esta cuenta y los interruptores que la detienen.",
  "aiSettings.account.label": "AI for this account",
  "aiSettings.account.label.es": "IA para esta cuenta",
  "aiSettings.account.help": "Off: call summaries show only the recorded facts, and no suggestions are made.",
  "aiSettings.account.help.es": "Apagada: los resúmenes de llamadas muestran solo los datos registrados y no se hacen sugerencias.",
  "aiSettings.budget.label": "Monthly AI budget",
  "aiSettings.budget.label.es": "Presupuesto mensual de IA",
  "aiSettings.budget.help": "In whole dollars, from $0 to $1,000. AI pauses for this account when this month's estimated spend reaches it.",
  "aiSettings.budget.help.es": "En dólares enteros, de $0 a $1,000. La IA se pausa en esta cuenta cuando el gasto estimado del mes lo alcanza.",
  "aiSettings.spend": "{spent} of {budget} this month, estimated",
  "aiSettings.spend.es": "{spent} de {budget} este mes, estimado",
  "aiSettings.empty": "No AI use yet this month.",
  "aiSettings.empty.es": "Todavía no hay uso de IA este mes.",
  "aiSettings.reached": "Budget reached on {date}. AI is paused for this account until {resume}.",
  "aiSettings.reached.es": "Presupuesto alcanzado el {date}. La IA está en pausa en esta cuenta hasta el {resume}.",
  "aiSettings.reachedNoDate": "Budget reached. AI is paused for this account until {resume}.",
  "aiSettings.reachedNoDate.es": "Presupuesto alcanzado. La IA está en pausa en esta cuenta hasta el {resume}.",
  "aiSettings.skipped": "AI was skipped {count} times this month because it was off or over budget.",
  "aiSettings.skipped.es": "La IA se omitió {count} veces este mes porque estaba apagada o sin presupuesto.",
  "aiSettings.skippedOne": "AI was skipped once this month because it was off or over budget.",
  "aiSettings.skippedOne.es": "La IA se omitió una vez este mes porque estaba apagada o sin presupuesto.",
  "aiSettings.save": "Save",
  "aiSettings.save.es": "Guardar",
  "aiSettings.saved": "Saved. This account's AI settings are updated.",
  "aiSettings.saved.es": "Guardado. La configuración de IA de esta cuenta está actualizada.",
  "aiSettings.undone": "Put back the earlier AI settings.",
  "aiSettings.undone.es": "Se restauró la configuración de IA anterior.",
  "aiSettings.error.budget": "Enter a whole-dollar amount from $0 to $1,000.",
  "aiSettings.error.budget.es": "Escriba una cantidad en dólares enteros de $0 a $1,000.",
  "aiSettings.error.failed": "Couldn't save the AI settings. Try again.",
  "aiSettings.error.failed.es": "No se pudo guardar la configuración de IA. Inténtelo de nuevo.",
  "aiSettings.crashed": "Something went wrong. Reload the page and try again.",
  "aiSettings.crashed.es": "Algo salió mal. Vuelva a cargar la página e inténtelo de nuevo.",
  "aiSettings.loadError": "The AI settings couldn't load right now. The rest of Settings still works.",
  "aiSettings.loadError.es": "La configuración de IA no se pudo cargar ahora. El resto de la configuración sigue funcionando.",
  "aiSettings.global.label": "AI for every account",
  "aiSettings.global.label.es": "IA para todas las cuentas",
  "aiSettings.global.onHelp": "On. Turning it off stops AI in every account at once.",
  "aiSettings.global.onHelp.es": "Encendida. Al apagarla, la IA se detiene en todas las cuentas a la vez.",
  "aiSettings.global.offHelp": "Off in every account. Nothing goes to AI until you turn it back on.",
  "aiSettings.global.offHelp.es": "Apagada en todas las cuentas. Nada se envía a la IA hasta que la vuelva a encender.",
  "aiSettings.global.turnOff": "Turn off everywhere",
  "aiSettings.global.turnOff.es": "Apagar en todas",
  "aiSettings.global.turnOn": "Turn on everywhere",
  "aiSettings.global.turnOn.es": "Encender en todas",
  "aiSettings.global.confirmTitle": "Turn off AI for every account",
  "aiSettings.global.confirmTitle.es": "Apagar la IA en todas las cuentas",
  "aiSettings.global.confirmBody": "Every account loses call summaries and suggestions until AI is turned back on. Type {word} to confirm.",
  "aiSettings.global.confirmBody.es": "Todas las cuentas pierden los resúmenes de llamadas y las sugerencias hasta que la IA se vuelva a encender. Escriba {word} para confirmar.",
  "aiSettings.global.confirmWord": "OFF",
  "aiSettings.global.confirmWord.es": "APAGAR",
  "aiSettings.global.confirmLabel": "Type the word",
  "aiSettings.global.confirmLabel.es": "Escriba la palabra",
  "aiSettings.global.cancel": "Cancel",
  "aiSettings.global.cancel.es": "Cancelar",
  "aiSettings.global.turnedOff": "AI is off in every account.",
  "aiSettings.global.turnedOff.es": "La IA está apagada en todas las cuentas.",
  "aiSettings.global.turnedOn": "AI is on in every account.",
  "aiSettings.global.turnedOn.es": "La IA está encendida en todas las cuentas.",
  "aiSettings.global.wrongWord": "Type {word} to turn AI off everywhere.",
  "aiSettings.global.wrongWord.es": "Escriba {word} para apagar la IA en todas las cuentas.",
  "palette.settings.ai": "AI",
  "palette.settings.ai.es": "IA",
```

- [ ] **Step 5: Run green.** The same command → PASS. `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts` → PASS. `pnpm --filter web typecheck` → exit 0.
- [ ] **Step 6: Probes:** (a) delete `"aiSettings.empty.es"` → "every key has a Spanish twin" FAILS naming it; (b) `"aiSettings.spend"` → `"{spent} of {budget}"` → the sentences case FAILS; (c) put `tokens` into `aiSettings.budget.help` → the vendor case FAILS; (d) `.es` of `aiSettings.error.budget` → "Escribe una …" → the usted case FAILS. Paste each line.
- [ ] **Step 7: Commit** `git commit -m "copy: the agency's AI card, in English and Spanish (item 8a-1)" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`.

---

## Task 4: The gateway library, the providers, the fake (bis-platform)

**Review:** opus. **Runs after:** Task 2 (it imports `@bis/db`'s new names).

**Files**
- Create: `apps/web/src/lib/ai/prices.ts`, `period.ts`, `log.ts`, `gateway.ts`, `providers/types.ts`, `providers/openai.ts`, `providers/fake.ts`, `providers/select.ts`, `testing/open-gate.ts`
- Test: `apps/web/src/lib/ai/{prices,period,log,gateway}.test.ts`, `apps/web/src/lib/ai/client-boundary.test.ts`
- Modify: `apps/web/vitest.config.ts:32` (review M3): `env: { APP_ORIGIN: "", SCANNER_URL: "", SCANNER_SECRET: "", AI_PROVIDER: "", AI_GATEWAY_OFF: "" }`, with the comment above it gaining "AI_PROVIDER / AI_GATEWAY_OFF: a developer's shell or .env.local must not switch every caller test to the fake or to off (item 8a-1)." Probe: run `AI_PROVIDER=fake`-in-shell equivalent by setting it in the config temporarily to `"fake"` → `summary-service.test.ts`'s first case FAILS (its fetch is never called); revert.

**Interfaces**
- Consumes: `aiGateCheck`, `recordAiLedger`, `AI_OUTCOMES`, `type AiFeature`, `type AiOutcome`, `type AiGate`, `type SupabaseClient` from `@bis/db` (Task 2; `SupabaseClient` is already re-exported, `…/settings/billing-actions.ts:21` imports it); `safeZone` (`lib/billing/billing-view.ts:59`); `loggableError` (`lib/loggable-error.ts:18`).
- Produces:
  - `prices.ts`: `PRICES`, `type PricedModel`, `isPricedModel(model: string): model is PricedModel`, `costMicroUsd(model: PricedModel, inputTokens: number, outputTokens: number): number`, `estimatedTokens(chars: number): number`.
  - `period.ts`: `periodKeys(now: Date, zone: string): { monthKey: string; dayKey: string }`.
  - `log.ts`: `errorName(e: unknown): string`, `aiSafeError(e: unknown): string`.
  - `providers/types.ts`: `ProviderRequest`, `ProviderAnswer`, `Provider`. `providers/select.ts`: `providerFor(env: Record<string, string | undefined>): Provider`. `providers/fake.ts`: `fakeProvider`, `FAKE_USAGE`. `providers/openai.ts`: `openAiProvider`, `OPENAI_CHAT_URL`.
  - `gateway.ts`: `type AiMessage = { role: "system" | "user"; content: string }`; `type AiRefusal = Exclude<AiOutcome, "ok">`; `AI_REFUSALS: readonly AiRefusal[]` (the eight, in `AI_OUTCOMES` order); `type AiUsage = { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number }`; `type AiResult = { ok: true; text: string; usage: AiUsage } | { ok: false; reason: AiRefusal }`; `type AiInput = { accountId: string; feature: AiFeature; model: string; messages: AiMessage[]; responseFormat?: { type: "json_object" }; maxTokens?: number; timeoutMs: number; timezone: string; language?: "en" | "es"; ref?: string; fetchImpl?: typeof fetch; now?: Date }`; `GATE_TIMEOUT_MS = 3_000`; `LEDGER_TIMEOUT_MS = 3_000`; `aiComplete(db: SupabaseClient, input: AiInput): Promise<AiResult>` (never throws).
  - `testing/open-gate.ts` (TEST-ONLY): `OPEN_GATE`, `type GateRpcCall = { fn: string; args: Record<string, unknown>; signalled: boolean }`, `type GateOver = { gate?: Partial<typeof OPEN_GATE> | "error"; ledger?: "error" }`, `gateRpc(over?: GateOver): { rpc; calls: GateRpcCall[] }`, `openGateDb(over?: GateOver): { db: SupabaseClient; calls: GateRpcCall[] }`.

- [ ] **Step 1: Read** `apps/web/src/lib/voice/summary-service.ts` whole (the fetch Task 5 replaces), `apps/web/src/lib/proposals/generate.ts:325-385`, `apps/web/src/lib/voice/call-card.ts:150-215`, `apps/web/src/lib/loggable-error.ts`, `apps/web/src/lib/billing/billing-view.ts:56-71`, `apps/web/src/lib/automations/imports.test.ts:1-45` (a source-scan test's shape), and Task 2's `packages/db/src/ai-gateway.ts`.

- [ ] **Step 2: Write the failing tests.**

`apps/web/src/lib/ai/prices.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PRICES, isPricedModel, costMicroUsd, estimatedTokens } from "./prices";

describe("the price table (spec 3.5)", () => {
  it("gpt-4o-mini at $0.15 and $0.60 per million tokens, in micro-dollars (mutation: 150 instead of 150_000 -> FAILS)", () => {
    expect(PRICES["gpt-4o-mini"]).toEqual({ inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 });
  });
  it("a post-call completion of 4,000 in and 200 out costs 720 micro-dollars (spec 3.4's $0.0007)", () => {
    expect(costMicroUsd("gpt-4o-mini", 4000, 200)).toBe(720);
  });
  it("rounds UP, so a tiny call is never free (mutation: Math.round -> 0 -> FAILS)", () => {
    expect(costMicroUsd("gpt-4o-mini", 1, 0)).toBe(1);
  });
  it("only a model in the table is priced, and never a prototype name (mutation: `model in PRICES` -> 'toString' passes -> FAILS)", () => {
    expect([isPricedModel("gpt-4o-mini"), isPricedModel("gpt-9"), isPricedModel("toString"), isPricedModel("")]).toEqual([true, false, false, false]);
  });
  it("estimates a token per four characters, rounding up (mutation: Math.floor -> FAILS)", () => {
    expect([estimatedTokens(0), estimatedTokens(1), estimatedTokens(8), estimatedTokens(9)]).toEqual([0, 1, 2, 3]);
  });
});
```

`apps/web/src/lib/ai/period.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { periodKeys } from "./period";

describe("the account's own month and day (choice I7; assumption A5)", () => {
  it("late on Oct 31 in Chicago is still October there, though it is November in UTC (mutation: timeZone: 'UTC' -> FAILS)", () => {
    expect(periodKeys(new Date("2026-11-01T04:30:00Z"), "America/Chicago")).toEqual({ monthKey: "2026-10", dayKey: "2026-10-31" });
    expect(periodKeys(new Date("2026-11-01T05:30:00Z"), "America/Chicago")).toEqual({ monthKey: "2026-11", dayKey: "2026-11-01" });
  });
});
```

`apps/web/src/lib/ai/log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aiSafeError, errorName } from "./log";

describe("logging an error that may carry a model's words (plan deviation 6)", () => {
  it("a SyntaxError is named, never quoted: JSON.parse echoes its input (mutation: return loggableError(e) for every error -> FAILS)", () => {
    let caught: unknown;
    try { JSON.parse("SENTINEL-OUTPUT-7f3 not json"); } catch (e) { caught = e; }
    expect(aiSafeError(caught)).toBe("SyntaxError (an answer that did not parse)");
  });
  it("any other error keeps loggableError's form", () => {
    expect(aiSafeError(new Error("insert failed: duplicate key"))).toBe("Error: insert failed: duplicate key");
  });
  it("errorName names the class only (mutation: return String(e) -> FAILS)", () => {
    expect([errorName(new TypeError("SENTINEL-PROMPT-7f3")), errorName("x"), errorName(null)]).toEqual(["TypeError", "string", "object"]);
  });
});
```

`apps/web/src/lib/ai/client-boundary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Spec 3.1: the gateway is server-only. No "use client" file may import lib/ai (it reads OPENAI_API_KEY and
 *  holds the provider). A scan, because the repo has no `server-only` package in use (spec 3.1). */
const SRC = join(__dirname, "../..");   // apps/web/src
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
/** A VALUE import from lib/ai (an `import type` is erased at build and reaches no browser; the AI card imports its view TYPE). */
const AI_VALUE_IMPORT = /import\s+(?!type\b)[^;'"]*?\s*from\s+["'](?:@\/lib\/ai\/|(?:\.{1,2}\/)+(?:[^"']*\/)?ai\/)[^"']*["']/;
function importsAiValue(src: string): boolean {
  return /^\s*["']use client["']/.test(src) && AI_VALUE_IMPORT.test(src);
}
function clientImportersOfAi(root: string): string[] {
  return files(root).filter((p) => importsAiValue(readFileSync(p, "utf8"))).map((p) => relative(root, p).split("\\").join("/"));
}

describe("lib/ai stays on the server (spec 3.1)", () => {
  it("no \"use client\" file imports a value from lib/ai (mutation: add `import { aiComplete } from \"@/lib/ai/gateway\";` under \"use client\" in settings/weekly-report-card.tsx -> FAILS naming it)", () => {
    expect(clientImportersOfAi(SRC)).toEqual([]);
  });
  it("the scan's own shapes: a value import counts, a multi-line one counts, a type import and a server file do not (mutation: drop (?!type\\b) -> FAILS)", () => {
    expect([
      importsAiValue(`"use client";\nimport { aiComplete } from "@/lib/ai/gateway";\n`),
      importsAiValue(`"use client";\nimport {\n  aiComplete,\n} from "../../lib/ai/gateway";\n`),
      importsAiValue(`"use client";\nimport type { AiCardView } from "@/lib/ai/settings-view";\n`),
      importsAiValue(`import { aiComplete } from "@/lib/ai/gateway";\n`),
    ]).toEqual([true, true, false, false]);
  });
});
```

`apps/web/src/lib/ai/gateway.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aiComplete, AI_REFUSALS, type AiInput } from "./gateway";
import { openGateDb, OPEN_GATE, type GateOver } from "./testing/open-gate";

/** Spec 3.1, 3.5, 6, 8.1, 8.2 (gateway). The client is the open-gate fake; the provider is a stubbed fetch. */
const SYSTEM = "SENTINEL-PROMPT-7f3 system rules";
const base = (o: Partial<AiInput> = {}): AiInput => ({
  accountId: "acct1", feature: "call_summary", model: "gpt-4o-mini",
  messages: [{ role: "system", content: SYSTEM }, { role: "user", content: "what are your hours?" }],
  timeoutMs: 10_000, timezone: "America/Chicago", ref: "call c1", now: new Date("2026-10-18T15:00:00Z"), ...o,
});
const answer = (content: unknown, usage: unknown = { prompt_tokens: 4000, completion_tokens: 200 }, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status })) as unknown as typeof fetch;
const ledgerOf = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "ai_ledger_record").map((c) => c.args);

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("AI_GATEWAY_OFF", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("aiComplete: an answer", () => {
  it("returns the text and its usage, and records one ok row in the ACCOUNT's month and day (mutation: periodKeys in UTC -> p_month 2026-11 -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const r = await aiComplete(db, base({ fetchImpl: answer("Caller asked about hours."), now: new Date("2026-11-01T04:30:00Z") }));
    expect(r).toEqual({ ok: true, text: "Caller asked about hours.", usage: { inputTokens: 4000, outputTokens: 200, costMicroUsd: 720 } });
    expect(calls.map((c) => c.fn)).toEqual(["ai_gate_check", "ai_ledger_record"]);
    expect(calls[0]!.args).toEqual({ p_account: "acct1", p_month: "2026-10", p_day: "2026-10-31" });
    expect(ledgerOf(calls)[0]).toMatchObject({
      p_account: "acct1", p_feature: "call_summary", p_model: "gpt-4o-mini", p_in: 4000, p_out: 200, p_cost: 720,
      p_outcome: "ok", p_month: "2026-10", p_day: "2026-10-31",
    });
  });

  it("sends the caller's model, messages, JSON mode, token cap and time limit; 3 s, 10 s, 3 s in that order (mutations: drop response_format; timeoutMs 600_000 -> FAILS)", async () => {
    const { db } = openGateDb();
    const fetchImpl = answer("{}");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await aiComplete(db, base({ fetchImpl, responseFormat: { type: "json_object" }, maxTokens: 2000 }));
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-4o-mini", messages: base().messages, response_format: { type: "json_object" }, max_tokens: 2000,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Review I2: the exact sequence (gate, completion, ledger), not "was called with" (which one call satisfies).
    expect(timeout.mock.calls.map((c) => c[0])).toEqual([3_000, 10_000, 3_000]);
  });

  it("both RPCs are bounded: each was handed an abort signal (plan deviation 5; mutations: drop the gate's signal; drop the ledger's -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    await aiComplete(db, base({ fetchImpl: answer("x") }));
    expect(calls.map((c) => [c.fn, c.signalled])).toEqual([["ai_gate_check", true], ["ai_ledger_record", true]]);
  });

  it("with no usage in the answer, estimates the cost from the characters, never free (spec 3.5; mutation: cost 0 when usage is missing -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const msgs = [{ role: "system" as const, content: "a".repeat(400) }, { role: "user" as const, content: "b".repeat(400) }];
    const r = await aiComplete(db, base({ messages: msgs, fetchImpl: answer("c".repeat(40), null) }));
    // 800 prompt characters -> 200 tokens; 40 answer characters -> 10 tokens; ceil((200*150000 + 10*600000) / 1e6) = 36.
    expect(r).toEqual({ ok: true, text: "c".repeat(40), usage: { inputTokens: null, outputTokens: null, costMicroUsd: 36 } });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_in: null, p_out: null, p_cost: 36 });
  });

  it("a failed ledger write keeps the text and logs ids only (mutation: return a refusal when the ledger throws -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await aiComplete(openGateDb({ ledger: "error" }).db, base({ fetchImpl: answer("x") }));
    expect(r.ok).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toBe("ai: ledger write failed for account acct1 feature call_summary outcome ok: Error: recordAiLedger failed: ledger unavailable");
  });

  it("an ok call logs nothing at all (plan deviation 8; mutation: log every outcome -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await aiComplete(openGateDb().db, base({ fetchImpl: answer("x") }));
    expect([err.mock.calls.length, log.mock.calls.length]).toEqual([0, 0]);
  });
});

describe("aiComplete: every refusal is a reason, never a request (spec 3.1 steps 1-4)", () => {
  it("AI_REFUSALS is the eight non-ok outcomes", () => {
    expect(AI_REFUSALS).toEqual(["global_off", "account_off", "over_budget", "unknown_model", "gate_unreadable", "no_key", "timeout", "provider_error"]);
  });

  it("AI_GATEWAY_OFF=1: global_off with no database read and no ledger row (mutation: drop the env check -> FAILS)", async () => {
    vi.stubEnv("AI_GATEWAY_OFF", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "global_off" });
    expect(calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // [what closes it, the reason, the mutation that fails the row]
  const gated: [GateOver, string, string][] = [
    [{ gate: { global_enabled: false } }, "global_off", "drop the global check"],
    [{ gate: { account_enabled: false } }, "account_off", "drop the account check"],
    [{ gate: { month_spend_microusd: OPEN_GATE.budget_microusd } }, "over_budget", "`>` instead of `>=`"],
    [{ gate: "error" }, "gate_unreadable", "treat a failed gate as open"],
  ];
  it.each(gated)("%j -> %s, one zero-cost ledger row, no request (mutation: %s -> FAILS)", async (over, reason) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb(over);
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledgerOf(calls)).toEqual([expect.objectContaining({ p_outcome: reason, p_in: null, p_out: null, p_cost: 0 })]);
  });

  it("one micro-dollar under the budget still answers (pairs with the over_budget row above)", async () => {
    const { db } = openGateDb({ gate: { month_spend_microusd: OPEN_GATE.budget_microusd - 1 } });
    expect((await aiComplete(db, base({ fetchImpl: answer("x") }))).ok).toBe(true);
  });

  it("an unknown model is refused before the gate, so it cannot spend unmetered (mutation: skip the price check -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ model: "gpt-9", fetchImpl }))).toEqual({ ok: false, reason: "unknown_model" });
    expect(calls.map((c) => c.fn)).toEqual(["ai_ledger_record"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("no key: no request, a no_key row, one error line naming the call (mutation: drop the gateway's no_key log -> FAILS)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "no_key", p_cost: 0 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): no_key after \d+ ms$/);
  });

  it("a switched-off account never reports a missing key (plan deviation 7; mutation: check the key before the gate -> FAILS)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base({ fetchImpl: answer("x") }))).toEqual({ ok: false, reason: "account_off" });
    expect(err).not.toHaveBeenCalled();
  });

  it("the three expected states log on console.log, never console.error (plan deviation 8; mutation: log every refusal as an error -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base({ fetchImpl: answer("x") }));
    expect(err).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): account_off after \d+ ms$/);
  });
});

describe("aiComplete: a failing provider is a reason, never a throw (spec 3.1 step 5)", () => {
  it("a timeout is timeout, with null tokens and zero cost (mutation: map TimeoutError to provider_error -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    const fetchImpl = vi.fn(async () => { throw new DOMException("The operation timed out.", "TimeoutError"); }) as unknown as typeof fetch;
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "timeout" });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "timeout", p_in: null, p_out: null, p_cost: 0 });
  });

  it("a non-ok answer is provider_error, its body never read, its status logged (mutation: read the body for the log -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = new Response(JSON.stringify({ error: { message: SYSTEM } }), { status: 400 });
    const json = vi.spyOn(res, "json");
    const text = vi.spyOn(res, "text");
    const r = await aiComplete(openGateDb().db, base({ fetchImpl: vi.fn(async () => res) as unknown as typeof fetch }));
    expect(r).toEqual({ ok: false, reason: "provider_error" });
    expect([json.mock.calls.length, text.mock.calls.length]).toEqual([0, 0]);
    expect(String(err.mock.calls[0]![0])).toMatch(/^ai: call_summary for account acct1 \(call c1\): provider_error HTTP 400 after \d+ ms$/);
  });

  it("an answer with no text is provider_error, charged from the usage it reported (plan deviation 10; mutation: record cost 0 -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = openGateDb();
    expect(await aiComplete(db, base({ fetchImpl: answer(null) }))).toEqual({ ok: false, reason: "provider_error" });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_outcome: "provider_error", p_in: 4000, p_out: 200, p_cost: 720 });
  });

  it("a client whose rpc throws synchronously reads as gate_unreadable, never a throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { rpc: () => { throw new Error("boom"); } } as unknown as Parameters<typeof aiComplete>[0];
    await expect(aiComplete(db, base({ fetchImpl: answer("x") }))).resolves.toEqual({ ok: false, reason: "gate_unreadable" });
  });
});

describe("aiComplete never logs or stores a prompt or an output (spec 3.1, G3, 8.2)", () => {
  const OUTPUT = "SENTINEL-OUTPUT-7f3 the model's words";
  const spies = () => (["log", "error", "warn", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  const said = (s: ReturnType<typeof spies>) => s.flatMap((x) => x.mock.calls.flat().map(String)).join("\n");

  // [a fetch for the path, its name]
  const paths: [() => typeof fetch, string][] = [
    [() => answer(OUTPUT), "ok"],
    [() => vi.fn(async () => new Response(JSON.stringify({ error: { message: `${SYSTEM} ${OUTPUT}` } }), { status: 400 })) as unknown as typeof fetch, "a 400 that echoes the prompt"],
    [() => vi.fn(async () => new Response(`${OUTPUT} not json`, { status: 200 })) as unknown as typeof fetch, "an answer that does not parse"],
    [() => vi.fn(async () => { throw new TypeError(`${SYSTEM} ${OUTPUT}`); }) as unknown as typeof fetch, "a network error whose message carries both"],
  ];
  it.each(paths)("%#: %s -> no sentinel in any console method or any RPC argument (mutations: log String(e) on the provider path; log the body of a non-ok answer -> FAILS)", async (fetchFor) => {
    const s = spies();
    const { db, calls } = openGateDb();
    await aiComplete(db, base({ fetchImpl: fetchFor() }));
    expect(`${said(s)}\n${JSON.stringify(calls)}`).not.toContain("SENTINEL");
  });
});

describe("the fake provider (spec 6, 8.1)", () => {
  it("AI_PROVIDER=fake answers with no network call, a fixed usage and a hash (mutation: never select the fake -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    const { db, calls } = openGateDb();
    const fetchImpl = answer("x");
    const r = await aiComplete(db, base({ fetchImpl, language: "es" }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, usage: { inputTokens: 100, outputTokens: 20, costMicroUsd: 27 } });
    expect(r.ok ? r.text : "").toMatch(/^\[fake es\] [0-9a-f]{8}$/);
    expect(ledgerOf(calls)[0]).toMatchObject({ p_in: 100, p_out: 20, p_cost: 27, p_outcome: "ok" });
  });

  it("is IGNORED in production: VERCEL_ENV=production always calls OpenAI (spec 6; mutation: drop the VERCEL_ENV check -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("VERCEL_ENV", "production");
    const fetchImpl = answer("real");
    const r = await aiComplete(openGateDb().db, base({ fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, text: "real" });
  });

  it("in JSON mode it answers JSON every caller reads as 'nothing' (mutation: answer plain text in JSON mode -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    const r = await aiComplete(openGateDb().db, base({ responseFormat: { type: "json_object" } }));
    expect(JSON.parse(r.ok ? r.text : "null")).toMatchObject({ proposals: [], reason: null, quote: null });
  });

  it("still goes through the gate: a switched-off account gets no fake answer either (mutation: return the fake before the gate -> FAILS)", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await aiComplete(openGateDb({ gate: { account_enabled: false } }).db, base())).toEqual({ ok: false, reason: "account_off" });
  });
});
```

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/ai/` → every file but one FAILS to load (`Failed to resolve import "./prices"` …). `client-boundary.test.ts` PASSES (nothing imports `lib/ai` yet): for it, run its mutation now (add `import { aiComplete } from "@/lib/ai/gateway";` on the line under `"use client"` in `…/settings/weekly-report-card.tsx`, run, see it FAIL naming `app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.tsx`, edit it back, `cmp` against `git show HEAD:…`). Paste the lines.

- [ ] **Step 4: Write the library.**

`apps/web/src/lib/ai/prices.ts`:

```ts
/**
 * The one price table (spec 3.5). Read 2026-10-18 from OpenAI's published price for gpt-4o-mini, as last
 * read by this project: $0.15 per million input tokens and $0.60 per million output tokens. AN ESTIMATE the
 * spec labels as such (3.4); correct it here. Integers throughout: micro-dollars, never floats.
 * A model not in this table is refused by the gateway (unknown_model): a cost that cannot be estimated is a
 * cost that cannot be capped.
 */
export const PRICES = {
  "gpt-4o-mini": { inputMicroUsdPerMTok: 150_000, outputMicroUsdPerMTok: 600_000 },
} as const;
export type PricedModel = keyof typeof PRICES;

export function isPricedModel(model: string): model is PricedModel {
  return Object.prototype.hasOwnProperty.call(PRICES, model);
}

/** Whole micro-dollars, rounded UP: ceil(in x input / 1e6 + out x output / 1e6). */
export function costMicroUsd(model: PricedModel, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  return Math.ceil((inputTokens * p.inputMicroUsdPerMTok + outputTokens * p.outputMicroUsdPerMTok) / 1_000_000);
}

/** When an answer reports no usage: a token per four characters, rounded up (an estimate, so a missing field never reads as free). */
export function estimatedTokens(chars: number): number {
  return Math.ceil(chars / 4);
}
```

`apps/web/src/lib/ai/period.ts`:

```ts
/** The account's own calendar month and day (choice I7), as 0086 stores them: YYYY-MM and YYYY-MM-DD. */
export function periodKeys(now: Date, zone: string): { monthKey: string; dayKey: string } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { monthKey: day.slice(0, 7), dayKey: day };
}
```

`apps/web/src/lib/ai/log.ts`:

```ts
import { loggableError } from "@/lib/loggable-error";

/** An error's class, never its message (a provider error's message can carry the prompt or the answer). */
export function errorName(e: unknown): string {
  if (typeof e === "object" && e !== null && typeof (e as { name?: unknown }).name === "string") return (e as { name: string }).name;
  return typeof e;
}

/**
 * For a caller's catch around code that parses a model's answer (plan deviation 6): JSON.parse's SyntaxError
 * quotes the start of its input, so it is named and never quoted. Anything else keeps loggableError's form
 * (a database error from writing the result, which carries no model text).
 */
export function aiSafeError(e: unknown): string {
  return e instanceof SyntaxError ? "SyntaxError (an answer that did not parse)" : loggableError(e);
}
```

`apps/web/src/lib/ai/providers/types.ts`:

```ts
import type { AiMessage } from "../gateway";

export type ProviderRequest = {
  model: string; messages: AiMessage[]; responseFormat?: { type: "json_object" }; maxTokens?: number;
  timeoutMs: number; language?: "en" | "es"; fetchImpl?: typeof fetch;
};
/** Tokens are null when the answer reported none. `detail` is a status or a class name, never text. */
export type ProviderAnswer =
  | { kind: "ok"; text: string; promptTokens: number | null; completionTokens: number | null }
  | { kind: "no_key" }
  | { kind: "timeout" }
  | { kind: "provider_error"; detail: string; promptTokens: number | null; completionTokens: number | null };
export type Provider = { complete(req: ProviderRequest): Promise<ProviderAnswer> };
```

`apps/web/src/lib/ai/providers/openai.ts`:

```ts
import { errorName } from "../log";
import type { Provider, ProviderAnswer } from "./types";

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const isTimeout = (e: unknown) => errorName(e) === "TimeoutError" || errorName(e) === "AbortError";
const intOrNull = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * The one provider until study decision 2 (spec 1). OPENAI_API_KEY is read inside the call, never at module
 * scope (summary-service.ts's rule: a missing key at build time must never break the import). A non-ok answer's
 * BODY IS NEVER READ: a provider's 400 can echo the prompt. A thrown error is reduced to its class name.
 */
export const openAiProvider: Provider = {
  async complete(req): Promise<ProviderAnswer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { kind: "no_key" };
    const fetchImpl = req.fetchImpl ?? fetch;
    let r: Response;
    try {
      r = await fetchImpl(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (e) {
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: ` (${errorName(e)})`, promptTokens: null, completionTokens: null };
    }
    if (!r.ok) return { kind: "provider_error", detail: ` HTTP ${r.status}`, promptTokens: null, completionTokens: null };
    let data: unknown;
    try {
      data = await r.json();
    } catch (e) {
      return isTimeout(e) ? { kind: "timeout" } : { kind: "provider_error", detail: " (an answer that did not parse)", promptTokens: null, completionTokens: null };
    }
    const d = data as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
    const promptTokens = intOrNull(d?.usage?.prompt_tokens);
    const completionTokens = intOrNull(d?.usage?.completion_tokens);
    const content = d?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { kind: "provider_error", detail: " (no content in the answer)", promptTokens, completionTokens };
    return { kind: "ok", text: content, promptTokens, completionTokens };
  },
};
```

`apps/web/src/lib/ai/providers/fake.ts`:

```ts
import { createHash } from "node:crypto";
import type { Provider } from "./types";

export const FAKE_USAGE = { promptTokens: 100, completionTokens: 20 } as const;

/**
 * Spec 8.1: answers with no network call. Plain text names the language and a short hash of the request;
 * in JSON mode it answers JSON that every JSON caller reads as "nothing" (no proposals, no card reading).
 * Selected only by AI_PROVIDER=fake, and never in production (select.ts).
 */
export const fakeProvider: Provider = {
  async complete(req) {
    const hash = createHash("sha256").update(JSON.stringify(req.messages)).digest("hex").slice(0, 8);
    const text = req.responseFormat?.type === "json_object"
      ? JSON.stringify({ proposals: [], reason: null, quote: null, fake: hash })
      : `[fake ${req.language ?? "en"}] ${hash}`;
    return { kind: "ok", text, ...FAKE_USAGE };
  },
};
```

`apps/web/src/lib/ai/providers/select.ts`:

```ts
import { fakeProvider } from "./fake";
import { openAiProvider } from "./openai";
import type { Provider } from "./types";

/** Spec 6: AI_PROVIDER=fake selects the fake, EXCEPT on production, where a stray value can neither silence AI nor fake its output. */
export function providerFor(env: Record<string, string | undefined>): Provider {
  return env.AI_PROVIDER === "fake" && env.VERCEL_ENV !== "production" ? fakeProvider : openAiProvider;
}
```

`apps/web/src/lib/ai/gateway.ts`:

```ts
import { AI_OUTCOMES, aiGateCheck, recordAiLedger, type AiFeature, type AiGate, type AiOutcome, type SupabaseClient } from "@bis/db";
import { safeZone } from "@/lib/billing/billing-view";
import { loggableError } from "@/lib/loggable-error";
import { costMicroUsd, estimatedTokens, isPricedModel } from "./prices";
import { periodKeys } from "./period";
import { providerFor } from "./providers/select";

/**
 * ONE DOOR for every model completion (item 8a-1, spec 3.1). Never throws: it answers the text, or a reason.
 * Every caller already has a non-AI form and maps every reason to it.
 *
 * Order: (1) AI_GATEWAY_OFF=1, no database read, no ledger row; (2) the model must be priced; (3) one gate read,
 * bounded at 3 s, failing CLOSED (choice I9); (4) the global switch, the account's, the budget (spend >= budget);
 * (5) the provider (the key is checked here), under the caller's time limit; (6) one ledger row, bounded at 3 s,
 * whose failure is logged and keeps the text (the call is already paid for). Steps 2-5's refusals write a
 * zero-cost row (choice I10).
 *
 * The client is the CALLER's: finishCall passes its service client (the two RPCs are service_role only). This
 * file never names a service-client getter (in-account-service-reads.test.ts scans lib/).
 *
 * Logged: the feature, the account id, the caller's id-only `ref`, the outcome, an HTTP status or an error's
 * class, and the latency. NEVER a message, a prompt, an answer, or an error message from the provider path.
 * Only non-ok outcomes log; the three expected states (switched off, over budget) on console.log so they never
 * read as alerts. Budget overshoot is bounded, not zero: concurrent calls that all passed the gate before any
 * recorded can overshoot by their own cost (spec 3.1). A TIMED-OUT request is recorded at zero cost, but the
 * provider may still have run it and may bill it: the ledger's estimate can undercount by those calls (review M11).
 */
export type AiMessage = { role: "system" | "user"; content: string };
export type AiRefusal = Exclude<AiOutcome, "ok">;
export const AI_REFUSALS: readonly AiRefusal[] = AI_OUTCOMES.filter((o): o is AiRefusal => o !== "ok");
export type AiUsage = { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number };
export type AiResult = { ok: true; text: string; usage: AiUsage } | { ok: false; reason: AiRefusal };
export type AiInput = {
  accountId: string;
  feature: AiFeature;
  model: string;
  messages: AiMessage[];
  responseFormat?: { type: "json_object" };
  maxTokens?: number;
  timeoutMs: number;
  /** The account's IANA zone: the budget's month and the cap's day are the account's own (choice I7). */
  timezone: string;
  /** Only the fake reads it, for its label (spec 8.1). */
  language?: "en" | "es";
  /** An id-only reference for log lines, e.g. "call 1f2e...". NEVER text from a transcript or a record. */
  ref?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export const GATE_TIMEOUT_MS = 3_000;
export const LEDGER_TIMEOUT_MS = 3_000;
const NO_USAGE: AiUsage = { inputTokens: null, outputTokens: null, costMicroUsd: 0 };
const QUIET: ReadonlySet<AiOutcome> = new Set<AiOutcome>(["global_off", "account_off", "over_budget"]);

export async function aiComplete(db: SupabaseClient, input: AiInput): Promise<AiResult> {
  const started = Date.now();
  const say = (outcome: AiOutcome, detail = "") => {
    const line = `ai: ${input.feature} for account ${input.accountId}${input.ref ? ` (${input.ref})` : ""}: ${outcome}${detail} after ${Date.now() - started} ms`;
    if (QUIET.has(outcome)) console.log(line); else console.error(line);
  };
  try {
    if (process.env.AI_GATEWAY_OFF === "1") {
      say("global_off", " (AI_GATEWAY_OFF)");
      return { ok: false, reason: "global_off" };
    }
    const keys = periodKeys(input.now ?? new Date(), safeZone(input.timezone));
    const finish = async (outcome: AiOutcome, usage: AiUsage, detail = ""): Promise<void> => {
      if (outcome !== "ok") say(outcome, detail);
      try {
        await recordAiLedger(db, {
          accountId: input.accountId, feature: input.feature, model: input.model.slice(0, 64),
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicroUsd: usage.costMicroUsd,
          outcome, latencyMs: Date.now() - started, ...keys, signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
        });
      } catch (e) {
        console.error(`ai: ledger write failed for account ${input.accountId} feature ${input.feature} outcome ${outcome}: ${loggableError(e)}`);
      }
    };

    const model = input.model;
    if (!isPricedModel(model)) {
      await finish("unknown_model", NO_USAGE);
      return { ok: false, reason: "unknown_model" };
    }
    let gate: AiGate;
    try {
      gate = await aiGateCheck(db, { accountId: input.accountId, ...keys, signal: AbortSignal.timeout(GATE_TIMEOUT_MS) });
    } catch (e) {
      // A database error message carries no prompt; loggableError keeps it readable.
      await finish("gate_unreadable", NO_USAGE, `: ${loggableError(e)}`);
      return { ok: false, reason: "gate_unreadable" };
    }
    const closed: AiRefusal | null = !gate.globalEnabled ? "global_off"
      : !gate.accountEnabled ? "account_off"
      : gate.monthSpendMicroUsd >= gate.budgetMicroUsd ? "over_budget"
      : null;
    if (closed) {
      await finish(closed, NO_USAGE);
      return { ok: false, reason: closed };
    }

    const answer = await providerFor(process.env).complete({
      model, messages: input.messages, responseFormat: input.responseFormat, maxTokens: input.maxTokens,
      timeoutMs: input.timeoutMs, language: input.language, fetchImpl: input.fetchImpl,
    });
    if (answer.kind === "no_key" || answer.kind === "timeout") {
      await finish(answer.kind, NO_USAGE);
      return { ok: false, reason: answer.kind };
    }
    const priced = (p: number | null, c: number | null, text: string): AiUsage => {
      const promptChars = input.messages.reduce((n, msg) => n + msg.content.length, 0);
      return {
        inputTokens: p, outputTokens: c,
        costMicroUsd: costMicroUsd(model, p ?? estimatedTokens(promptChars), c ?? estimatedTokens(text.length)),
      };
    };
    if (answer.kind === "provider_error") {
      const reported = answer.promptTokens !== null || answer.completionTokens !== null;
      await finish("provider_error", reported ? priced(answer.promptTokens, answer.completionTokens, "") : NO_USAGE, answer.detail);
      return { ok: false, reason: "provider_error" };
    }
    const usage = priced(answer.promptTokens, answer.completionTokens, answer.text);
    await finish("ok", usage);
    return { ok: true, text: answer.text, usage };
  } catch (e) {
    console.error(`ai: ${input.feature} for account ${input.accountId}: unexpected ${e instanceof Error ? e.name : typeof e}`);
    return { ok: false, reason: "provider_error" };
  }
}
```

`apps/web/src/lib/ai/testing/open-gate.ts`:

```ts
import type { SupabaseClient } from "@bis/db";

/**
 * TEST-ONLY. A stand-in for the service client the gateway is handed: its `rpc` records every call and
 * answers ai_gate_check as "open" (or as told) and ai_ledger_record as written (or as failed). It supports
 * the `.abortSignal()` link the wrappers add. Imported by tests only; nothing in the app imports it.
 */
export const OPEN_GATE = {
  global_enabled: true, account_enabled: true, budget_microusd: 10_000_000, month_spend_microusd: 0, record_summaries_today: 0,
};
export type GateRpcCall = { fn: string; args: Record<string, unknown>; signalled: boolean };
export type GateOver = { gate?: Partial<typeof OPEN_GATE> | "error"; ledger?: "error" };

export function gateRpc(over: GateOver = {}): { rpc: (fn: string, args: Record<string, unknown>) => unknown; calls: GateRpcCall[] } {
  const calls: GateRpcCall[] = [];
  const result = (fn: string) => {
    if (fn === "ai_gate_check") {
      return over.gate === "error" ? { data: null, error: { message: "gate unavailable" } } : { data: { ...OPEN_GATE, ...(over.gate ?? {}) }, error: null };
    }
    if (fn === "ai_ledger_record") return over.ledger === "error" ? { data: null, error: { message: "ledger unavailable" } } : { data: null, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    // `signalled` records whether the caller bounded this RPC with .abortSignal() (review I2).
    const call: GateRpcCall = { fn, args, signalled: false };
    calls.push(call);
    const builder = {
      abortSignal: () => { call.signalled = true; return builder; },
      then: <A, B>(ok?: (v: unknown) => A, no?: (e: unknown) => B) => Promise.resolve(result(fn)).then(ok, no),
    };
    return builder;
  };
  return { rpc, calls };
}

export function openGateDb(over: GateOver = {}): { db: SupabaseClient; calls: GateRpcCall[] } {
  const { rpc, calls } = gateRpc(over);
  return { db: { rpc } as unknown as SupabaseClient, calls };
}
```

- [ ] **Step 5: Run green.** `pnpm --filter web exec vitest run src/lib/ai/` → all PASS; paste the summary line (5 files). `pnpm --filter web typecheck` → exit 0 (assumption A1's `.abortSignal` compiles; `providers/types.ts` and `gateway.ts` import each other's TYPES only, which TypeScript allows). `pnpm --filter web exec eslint src/lib/ai` → clean. `grep -rn serviceDb apps/web/src/lib/ai` → nothing.

- [ ] **Step 6: Probes, by name** (each a temporary edit, reverted by hand and `cmp`-checked): (a) drop the `AI_GATEWAY_OFF` block → "AI_GATEWAY_OFF=1 …" FAILS; (b) `>=` → `>` in the budget line → the `over_budget` row FAILS; (c) in the gate's catch, assign an open gate instead of returning → the `gate_unreadable` row FAILS; (d) in `openai.ts`, ``detail: ` HTTP ${r.status}: ${await r.text()}` `` → "a non-ok answer … body never read" FAILS on `text`, and the sentinel row "a 400 that echoes the prompt" FAILS; (e) in `openai.ts`'s first catch, ``detail: ` (${String(e)})` `` → the sentinel row "a network error whose message carries both" FAILS; (f) `providerFor` without `&& env.VERCEL_ENV !== "production"` → "is IGNORED in production" FAILS; (g) `isPricedModel` as `model in PRICES` → the prices case FAILS on `toString`; (h) `Math.round` in `costMicroUsd` → "rounds UP" FAILS; (i) `NO_USAGE` passed for an `ok` answer with no usage → the estimate case FAILS; (j) `periodKeys` with `timeZone: "UTC"` → both period cases and the first gateway case FAIL; (k) `console.error` for every refusal → "the three expected states log on console.log" FAILS; (l) an `if (!process.env.OPENAI_API_KEY)` `no_key` refusal placed before the gate read → "a switched-off account never reports a missing key" FAILS; (m) `QUIET.has(outcome) || outcome === "ok"` logging ok lines → "an ok call logs nothing" FAILS. Paste each failing line.

- [ ] **Step 7: Commit** `git add -- apps/web/src/lib/ai/prices.ts apps/web/src/lib/ai/prices.test.ts apps/web/src/lib/ai/period.ts apps/web/src/lib/ai/period.test.ts apps/web/src/lib/ai/log.ts apps/web/src/lib/ai/log.test.ts apps/web/src/lib/ai/gateway.ts apps/web/src/lib/ai/gateway.test.ts apps/web/src/lib/ai/client-boundary.test.ts apps/web/src/lib/ai/providers/types.ts apps/web/src/lib/ai/providers/openai.ts apps/web/src/lib/ai/providers/fake.ts apps/web/src/lib/ai/providers/select.ts apps/web/src/lib/ai/testing/open-gate.ts` then `git commit -m "ai: one door for every completion: the gate, the budget, the ledger, the fake, and nothing a prompt could leak through (item 8a-1)" -- apps/web/src/lib/ai/prices.ts apps/web/src/lib/ai/prices.test.ts apps/web/src/lib/ai/period.ts apps/web/src/lib/ai/period.test.ts apps/web/src/lib/ai/log.ts apps/web/src/lib/ai/log.test.ts apps/web/src/lib/ai/gateway.ts apps/web/src/lib/ai/gateway.test.ts apps/web/src/lib/ai/client-boundary.test.ts apps/web/src/lib/ai/providers/types.ts apps/web/src/lib/ai/providers/openai.ts apps/web/src/lib/ai/providers/fake.ts apps/web/src/lib/ai/providers/select.ts apps/web/src/lib/ai/testing/open-gate.ts apps/web/vitest.config.ts`.

---

## Task 5: The call summary and the call card on the gateway (bis-voice)

**Review:** opus. **Runs beside:** Tasks 6, 7, 9.

**Files**
- Modify: `apps/web/src/lib/voice/summary-service.ts:1-106`, `apps/web/src/lib/voice/call-card.ts:150-215`, `apps/web/src/lib/voice/finish-call.ts:380`, `:404`, `:575`, `:710`, `:837`, `apps/web/src/app/api/voice/incoming/route.ts:401-491`, `:533`, `:587` (the clamp 697 → 679 and every comment deriving it), `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/textback-window.ts:14-17` (comment)
- Modify (tests): `apps/web/src/lib/voice/summary-service.test.ts`, `apps/web/src/lib/voice/call-card.test.ts`, `apps/web/src/lib/voice/finish-call.test.ts:416-420`, `:723` (comment), `:1813`, `apps/web/src/app/api/voice/incoming/lifecycle.test.ts:627-680`, `:1101` (comment)
- Orchestrator (not the agent; `.env*` and `.claude/agents/*.md` are not bis-voice's): `.env.example:125-131` ("Clamped to 10-697 … The 697 ceiling … 73s of tail") and `.claude/agents/bis-voice.md:25` ("clamped 10–697") move to 679 / 91 s in the same PR, text given in Step 7.
- Create: `apps/web/src/lib/voice/summary-service.fallback.test.ts`, `apps/web/src/lib/voice/call-card.fallback.test.ts`

**Interfaces**
- Consumes: `aiComplete`, `AI_REFUSALS` (`@/lib/ai/gateway`); `aiSafeError` (`@/lib/ai/log`); `openGateDb` (`@/lib/ai/testing/open-gate`, tests only); `type SupabaseClient` (`@bis/db`).
- Produces:
  - `generateSummary(state: CallState, opts: { db: SupabaseClient; accountId: string; timezone?: string; ref?: string; fetchImpl?: typeof fetch }): Promise<string>` (`opts` is now REQUIRED).
  - `readCallForCard(transcript: TranscriptEvent[], opts: { db: SupabaseClient; accountId: string; timezone: string; fetchImpl?: typeof fetch; label?: string }): Promise<CardReading>`.

- [ ] **Step 1: Read** `summary-service.ts` whole, `call-card.ts:1-231`, `finish-call.ts:382-410` and `:826-845`, `summary-service.test.ts` whole, `call-card.test.ts:1-30` and `:140-210`, `finish-call.test.ts:1-100`, `:410-426`, `:1790-1832`, `incoming/route.ts:395-425`, and Task 4's `lib/ai/gateway.ts`.

- [ ] **Step 2: Write the failing tests.**

(a) `apps/web/src/lib/voice/summary-service.fallback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { generateSummary } from "./summary-service";
import { AI_REFUSALS } from "@/lib/ai/gateway";
import { emptyCallState, withTranscript } from "./call-state";
import { summaryFactLine } from "./summarize";
import { openGateDb } from "@/lib/ai/testing/open-gate";

/** G6: every refusal is the fact line, the same one a missing key produced before the gateway. */
const GATE = { db: openGateDb().db, accountId: "acct", timezone: "America/Chicago" };
const spoke = () => withTranscript(emptyCallState(), { role: "caller", text: "are you open saturday?", at: "t" });

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("generateSummary on the gateway (spec 3.2)", () => {
  it.each(AI_REFUSALS)("%s -> exactly the fact line (mutation: compose a fixed 'AI is off' sentence on a refusal -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    const s = spoke();
    expect(await generateSummary(s, GATE)).toBe(summaryFactLine(s));
  });

  it("the spam skip makes no gateway call (mutation: call aiComplete before the spam check -> FAILS)", async () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía.", at: "t" });
    await generateSummary(s, GATE);
    expect(gw.aiComplete).not.toHaveBeenCalled();
  });

  it("asks for call_summary on gpt-4o-mini for THIS account, under 10 s, in its zone (mutation: feature 'call_card' -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: "Caller asked about Saturday.", usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    const out = await generateSummary(spoke(), { ...GATE, ref: "call c1" });
    expect(gw.aiComplete).toHaveBeenCalledWith(GATE.db, expect.objectContaining({
      accountId: "acct", feature: "call_summary", model: "gpt-4o-mini", timeoutMs: 10_000, timezone: "America/Chicago", ref: "call c1",
    }));
    expect(out).toContain("Caller asked about Saturday.");
  });
});
```

(b) `apps/web/src/lib/voice/call-card.fallback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { readCallForCard, NO_READING } from "./call-card";
import { AI_REFUSALS } from "@/lib/ai/gateway";
import { openGateDb } from "@/lib/ai/testing/open-gate";

const GATE = { db: openGateDb().db, accountId: "acct", timezone: "America/Chicago" };
const transcript: TranscriptEvent[] = [{ role: "caller", text: "my roof started leaking last night", at: "t" }];

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("readCallForCard on the gateway (spec 3.2, choice I1)", () => {
  it.each(AI_REFUSALS)("%s -> no reading (mutation: parse the refusal as an empty JSON object and return { reason: '', ... } -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    expect(await readCallForCard(transcript, GATE)).toEqual(NO_READING);
  });

  it("asks for call_card in JSON mode, 300 tokens, 10 s, naming the call in its log ref (mutation: feature 'call_summary' -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: JSON.stringify({ reason: null, quote: null }), usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    await readCallForCard(transcript, { ...GATE, label: "finishCall call1" });
    expect(gw.aiComplete).toHaveBeenCalledWith(GATE.db, expect.objectContaining({
      accountId: "acct", feature: "call_card", model: "gpt-4o-mini", responseFormat: { type: "json_object" },
      maxTokens: 300, timeoutMs: 10_000, timezone: "America/Chicago", ref: "finishCall call1",
    }));
  });
});
```

(c) In `summary-service.test.ts`: add `import { openGateDb } from "@/lib/ai/testing/open-gate";` and, under the `beforeEach` at `:6`, `const GATE = { db: openGateDb().db, accountId: "acct", timezone: undefined as string | undefined };`. Every `generateSummary(x, { fetchImpl … })` becomes `generateSummary(x, { ...GATE, fetchImpl … })`; the timezone case (`:65`) becomes `{ ...GATE, timezone: "America/Chicago", fetchImpl … }`; the cast `opts` at `:114` becomes `{ ...GATE, language: "es", fetchImpl }`. No assertion changes. Append:

```ts
  it("a switched-off account gets the fact line and makes no request (spec 3.2; mutation: fall through to the fetch when the gateway refuses -> FAILS)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn();
    const s = callerSpoke();
    const out = await generateSummary(s, { ...GATE, db: openGateDb({ gate: { account_enabled: false } }).db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out).toBe(summaryFactLine(s));
  });
  it("records one call_summary ledger row for this account (mutation: feature 'call_card' -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })));
    await generateSummary(callerSpoke(), { ...GATE, db, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(calls.filter((c) => c.fn === "ai_ledger_record").map((c) => [c.args.p_account, c.args.p_feature, c.args.p_outcome])).toEqual([["acct", "call_summary", "ok"]]);
  });
```

(The existing stubs return `{ ok: true, json: async () => … }`, not a `Response`; the gateway's provider calls `r.ok` and `r.json()` only, so they keep working. If typecheck rejects the shape, cast as the file already does.)

(d) In `call-card.test.ts`: add the same import and `const GATE = { db: openGateDb().db, accountId: "acct", timezone: "America/Chicago" };` under `:12`; every `readCallForCard(transcript, { … })` becomes `readCallForCard(transcript, { ...GATE, … })`. No assertion changes. Append inside the reading's `describe`:

```ts
  it("a reading that does not parse logs no word of it (plan deviation 6; mutation: log String(e) in the catch -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCallForCard(transcript, { ...GATE, fetchImpl: modelReturning("SENTINEL-OUTPUT-7f3 not json") })).toEqual(NO_READING);
    expect(err.mock.calls.flat().map(String).join("\n")).not.toContain("SENTINEL");
    expect(err).toHaveBeenCalledTimes(1);
  });
```

(`modelReturning(content)` at `:22` JSON-encodes `content` into the message, so the content the parser sees is the string `SENTINEL-OUTPUT-7f3 not json`; read `:22-28` to confirm, and if it double-encodes, pass the raw string through a local stub instead.)

(e) In `finish-call.test.ts`: the objects at `:420` and `:1813` gain the client and the account:

```ts
    expect(summaryMocks.generateSummary).toHaveBeenCalledWith(s, expect.objectContaining({ timezone: "America/Chicago", db: ctx.db, accountId: ctx.accountId }));
```

```ts
    expect(cardMocks.readCallForCard).toHaveBeenCalledWith(s.transcript, expect.objectContaining({ label: "finishCall call1", db: ctx.db, accountId: ctx.accountId, timezone: ctx.timezone }));
```

and the `:416` title gains " and this call's client and account (mutation: drop db from the call -> FAILS)".

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/voice/summary-service.test.ts src/lib/voice/summary-service.fallback.test.ts src/lib/voice/call-card.test.ts src/lib/voice/call-card.fallback.test.ts src/lib/voice/finish-call.test.ts src/app/api/voice/incoming/lifecycle.test.ts`. (`lifecycle.test.ts` FAILS once its 679/680 edits are made and the route still clamps at 697: "expected false to be true" at 679 s.) Expected: the fallback files FAIL (`expected [Function] to be called with …`: today's code never calls `aiComplete`), the two new summary cases FAIL (the fetch IS called; no ledger row), the card's SENTINEL case FAILS (`expected '…SENTINEL-O…' not to contain 'SENTINEL'`), the two finish-call cases FAIL (no `db`). Paste one line of each.

- [ ] **Step 4: Rewrite `generateSummary`** (`summary-service.ts:1-106`; the comment block is kept and amended as shown):

```ts
import type { SupabaseClient } from "@bis/db";
import type { CallState } from "./call-state";
import { classifyOutcome } from "./call-state";
import { buildSummaryInput, composeSummary } from "./summarize";
import { aiComplete } from "@/lib/ai/gateway";

/**
 * Generates the staff-facing call summary. The caller holds `CallState` — this
 * function does not load or save anything. The completion goes through the one
 * AI door (`lib/ai/gateway.ts`, item 8a-1): the account's switch, the global
 * switch and the monthly budget are checked there, the ledger row is written
 * there, and ANY refusal or failure — no key, switched off, over budget, a
 * timeout, a refused request — comes back as `ok: false`, and the fact line
 * stands alone via `composeSummary("", state)`, exactly as a missing key did
 * before the gateway.
 *
 * `spam` — and ONLY `spam` — skips the model entirely, BEFORE the gateway, so a
 * robocall costs no gate read, no ledger row and no log line. `classifyOutcome`
 * returns it exactly when there is no booking, no lead, no message AND no
 * caller transcript event carrying text (call-state.ts), so the request would
 * hand the model `TRANSCRIPT:\n(no speech captured)` and ask for 3-4 sentences
 * about it. That is not a hypothetical: of the nine spam calls on file, the
 * five real ones (zero caller events each) all bought a completion, and one of
 * them came back asserting "the caller asked to review availability for
 * Wednesday, September 4" from an empty transcript — invented, and it tripped
 * `composeSummary`'s own ⚠ MISMATCH warning on the call detail page. So the
 * skip buys two things, not one: the token cost, and a fabricated alarm.
 *
 * `abandoned` deliberately still calls the model. The classifier only reaches
 * it when a caller DID speak (transcript, production average 5 events), it is
 * the outcome the missed-call text-back fires on, and its stored summary is
 * the only account anywhere of why a real human rang and left.
 *
 * The column is never left blank: `composeSummary("", state)` is the same
 * deterministic fact line every refusal produces, so the call detail page, the
 * ⌘K `summary.ilike` search and the work queue's conversation title all read
 * exactly what they read before, minus the prose.
 */
export async function generateSummary(
  state: CallState,
  opts: { db: SupabaseClient; accountId: string; timezone?: string; ref?: string; fetchImpl?: typeof fetch },
): Promise<string> {
  if (classifyOutcome(state) === "spam") return composeSummary("", state);

  const systemRules = [
    "Summarize this front-desk call for staff in 3-4 sentences.",
    "The BOOKED and INTAKE sections are the system's own records and are authoritative.",
    "Only state that an appointment was booked if BOOKED lists one; if BOOKED is (none), say plainly that no appointment was recorded.",
    "Only state that contact details were captured if INTAKE lists them; if INTAKE is (none), say plainly that none were captured.",
    "If the caller asked for something the records do not show, say what they asked for and that it was not completed — do not describe it as done.",
    "Never invent names, phone numbers, email addresses or times that do not appear in the input.",
    // English for every account, Spanish ones included (owner decision
    // A, 2026-10-10): summarize.ts's BOOKING_CLAIM/INTAKE_CLAIM mismatch
    // guards are English regexes and only hold over English prose. The
    // quote clause keeps a caller's own words untranslated.
    "Always write the summary in English (it is staff-facing), regardless of the language spoken on the call. If you quote the caller, keep the quote in the language the caller spoke.",
  ];
  // BOOKED times in the input are raw UTC (see summarize.ts's fact line,
  // which stays that way deliberately). Left alone, the prose model
  // renders that UTC instant as if it were already local — a booking at
  // 14:00 UTC became "2:00 PM" in a production summary when the account's
  // actual local time was 9:00 AM Central. Only added when a timezone is
  // known; with none, there is nothing correct to convert to.
  if (opts.timezone) {
    systemRules.push(
      `State all dates and times in the ${opts.timezone} timezone in natural local form (e.g. 9:00 AM Central). Never present a UTC time as if it were local.`,
    );
  }
  const answer = await aiComplete(opts.db, {
    accountId: opts.accountId,
    feature: "call_summary",
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemRules.join(" ") },
      { role: "user", content: buildSummaryInput(state) },
    ],
    // A hung connection would otherwise stall `finishCall` until Vercel kills
    // the invocation; 10s is generous for a 3-4 sentence completion. The
    // gateway turns the timeout into `ok: false`, and the fact line stands.
    timeoutMs: 10_000,
    // No zone → safeZone's fallback inside the gateway; the budget's month only.
    timezone: opts.timezone ?? "",
    ref: opts.ref,
    fetchImpl: opts.fetchImpl,
  });

  // The returned summary leads with what the system actually recorded, and
  // flags the prose when it disagrees. A model that claims a booking nobody
  // made is the failure this guards, and it reached production three times.
  return composeSummary(answer.ok ? answer.text : "", state);
}
```

- [ ] **Step 5: `readCallForCard`** (`call-card.ts:153-215`): its doc's first paragraph gains "It goes through the one AI door (`lib/ai/gateway.ts`); every refusal is no reading." The signature and body down to the parse become:

```ts
export async function readCallForCard(
  transcript: TranscriptEvent[],
  opts: { db: SupabaseClient; accountId: string; timezone: string; fetchImpl?: typeof fetch; label?: string },
): Promise<CardReading> {
  const label = opts.label ?? "readCallForCard";
  try {
    const answer = await aiComplete(opts.db, {
      accountId: opts.accountId,
      feature: "call_card",
      model: "gpt-4o-mini",
      // JSON mode: generate.ts's reason — without it the model routinely
      // wraps JSON in a code fence, and this parse has no fallback of its
      // own beyond "nothing".
      responseFormat: { type: "json_object" },
      maxTokens: 300,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: transcript.map((e) => `${e.role}: ${e.text}`).join("\n") },
      ],
      timeoutMs: 10_000,
      timezone: opts.timezone,
      ref: label,
      fetchImpl: opts.fetchImpl,
    });
    // Every refusal and failure was logged by the gateway, ids only.
    if (!answer.ok) return NO_READING;
    const parsed = JSON.parse(answer.text) as { reason?: unknown; quote?: unknown } | null;
```

(the lines from `let reason = trimmed(parsed?.reason);` to the `return { reason: …, callerWords: … };` are unchanged), and the catch becomes:

```ts
  } catch (e) {
    // aiSafeError, never String(e): JSON.parse's SyntaxError quotes the model's words (plan deviation 6).
    console.error(`${label}: reading failed: ${aiSafeError(e)}`);
    return NO_READING;
  }
```

Imports added at `:32-37`: `import type { CallCard, SupabaseClient, TranscriptEvent } from "@bis/db";` (replacing the existing type import), `import { aiComplete } from "@/lib/ai/gateway";`, `import { aiSafeError } from "@/lib/ai/log";`. The old `apiKey` read, its `console.error` and the `fetchImpl` / `r.ok` / `r.json()` / `content` lines are gone (the gateway owns them; plan deviation 7).

- [ ] **Step 6: `finishCall`.** `finish-call.ts:404`:

```ts
    summary = await generateSummary(state, {
      db: ctx.db, accountId: ctx.accountId, timezone: ctx.timezone, ref: `call ${meta.callRowId ?? "(no row)"}`,
    });
```

`:837`:

```ts
        ? await readCallForCard(state.transcript, { db: ctx.db, accountId: ctx.accountId, timezone: ctx.timezone, label: `finishCall ${meta.callRowId}` })
```

- [ ] **Step 7: The tail and the clamp, re-derived (review I1; a behaviour change).**
  - `incoming/route.ts:408-422`, the tail table: the summary line becomes `//    16s  the summary reading (`generateSummary`): the gateway's gate read (3s), the completion (AbortSignal 10s), its ledger row (3s) — first in finishCall, before anything is written`; the card line `//    16s  the call card's reading (`readCallForCard`: gate 3s, 10s, ledger 3s), then its own update; the callback To do is a few ms before it`; the proposals line `//    16s  the proposals' reading (`generateProposals`: gate 3s, 10s, ledger 3s)`; "THE CALL ROW IS DURABLE HERE, ~38s in." → "~44s in."; the total `73s  tail (61s bounded …` → `91s  tail (79s bounded by timeouts; …` (each completion gained up to 6 s of bounded database time, item 8a-1).
  - `:459`: `//   800 - 91 - 20 - 10 = 679, THE CLAMP BELOW.`; `:461`: "Pinned by lifecycle.test.ts ("cap-seconds clamp", at 900 and at 680)."; append to the tightening history (`:462-464`): "…, from 715 (no hangup …), and from 697 (item 8a-1: each AI completion gained a 3s gate read and a 3s ledger write)."; `:466`: "in the first ~44s of the tail".
  - `:475`: "this 679 must be re-derived". `:491`: `const maxSeconds = Math.min(Math.max(parsedOrDefault, 10), 679);`. `:533`: "PHONE_MAX_CALL_SECONDS to <=679". `:587`: "the 679 clamp".
  - `finish-call.ts:380`, `:575`, `:710` and `finish-call.test.ts:723`: "697s clamp" → "679s clamp". `lifecycle.test.ts:1101`: "cap ≤ 679".
  - `lifecycle.test.ts:627-680`: titles "above 697 is clamped to 697" → "above 679 is clamped to 679"; "PHONE_MAX_CALL_SECONDS=698, one second past the clamp, is clamped to 697 (mutation: clamp at 698 or above → no goodbye at 697s, FAILS)" → "PHONE_MAX_CALL_SECONDS=680, one second past the clamp, is clamped to 679 (mutation: clamp at 680 or above → no goodbye at 679s, FAILS)"; `process.env.PHONE_MAX_CALL_SECONDS = "698"` → `"680"`; `advanceTimersByTimeAsync(696_000)` → `(678_000)`; `(696_999)` → `(678_999)`; the comment "Crossing 697s … 697 is 800 - 73 - 20 - 10 … a 73s timed post-cap tail (…, the summary reading, …)" → "Crossing 679s … 679 is 800 - 91 - 20 - 10 … a 91s timed post-cap tail (…, the summary reading with its gate and ledger, …, the call card's and the proposals' readings with theirs)", and the history line gains "697 predates the AI gateway's two bounded database calls per completion".
  - `textback-window.ts:14-17`: "`generateSummary` first, which aborts hard at 10s (summary-service.ts)" → "`generateSummary` first, which can take 16s through the AI gateway (a 3s gate read, the 10s completion, a 3s ledger write; lib/ai/gateway.ts)"; "Twelve seconds is the realistic ceiling." → "About eighteen seconds is the realistic ceiling."; "Five minutes is ~25× that." → "Five minutes is ~16× that." (comment only; the window constant does not change).
  - Orchestrator, same PR: `.env.example`'s PHONE_MAX_CALL_SECONDS comment: "Clamped to 10-679 … The 679 ceiling is DERIVED … 91s of tail after it fires, 79s of it bounded by timeouts and 12s estimated (…, the call summary with its gate and ledger, …)"; `.claude/agents/bis-voice.md:25`: "clamped 10–679".
  - Before editing, `git grep -n '\b697\b' -- apps .claude .env.example` and list every hit in the report; after, the same grep returns nothing in those paths.

- [ ] **Step 8: Run green.** The Step 3 command → all PASS; paste the summary line. `pnpm --filter web typecheck` → exit 0. `pnpm --filter web exec eslint src/lib/voice/summary-service.ts src/lib/voice/call-card.ts src/lib/voice/finish-call.ts "src/app/api/voice/incoming/route.ts"` → clean. `grep -n "OPENAI_API_KEY\|api.openai.com" apps/web/src/lib/voice/summary-service.ts apps/web/src/lib/voice/call-card.ts` → nothing.

- [ ] **Step 9: Probes, by name:** (a) in `generateSummary`, `composeSummary(answer.ok ? answer.text : "AI unavailable.", state)` → every `it.each` row of the summary fallback FAILS; (b) move the spam check below `aiComplete` → "the spam skip makes no gateway call" FAILS; (c) `feature: "call_card"` in `generateSummary` → the two feature cases FAIL; (d) in `readCallForCard`'s catch, `String(e)` → the SENTINEL case FAILS; (e) drop `if (!answer.ok) return NO_READING;` (parse `""` instead) → the card fallback rows still pass via the catch: if they do, that proves the catch is the fallback, so instead mutate to `if (!answer.ok) return { reason: "", callerWords: null };` → the card fallback rows FAIL; (f) drop `db: ctx.db` at `:404` → the finish-call case FAILS; (g) the clamp at `680` in `route.ts:491` → "PHONE_MAX_CALL_SECONDS=680 … clamped to 679" FAILS (no goodbye at 679 s). Paste each line.

- [ ] **Step 10: Commit** `git add -- apps/web/src/lib/voice/summary-service.fallback.test.ts apps/web/src/lib/voice/call-card.fallback.test.ts` then `git commit -m "voice: the call summary and the call card's reading go through the AI door; every refusal is the fact line or no reading, and no model word reaches a log (item 8a-1)" -- apps/web/src/lib/voice/summary-service.ts apps/web/src/lib/voice/summary-service.test.ts apps/web/src/lib/voice/summary-service.fallback.test.ts apps/web/src/lib/voice/call-card.ts apps/web/src/lib/voice/call-card.test.ts apps/web/src/lib/voice/call-card.fallback.test.ts apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts apps/web/src/app/api/voice/incoming/route.ts apps/web/src/app/api/voice/incoming/lifecycle.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/textback-window.ts"`. The orchestrator commits the `.env.example` and `.claude/agents/bis-voice.md` lines (Step 7) separately: `git commit -m "docs: the call cap's ceiling is 679 after the AI gateway (item 8a-1)" -- .env.example .claude/agents/bis-voice.md`.

---

## Task 6: The proposals on the gateway (bis-crm)

**Review:** opus. **Runs beside:** Tasks 5, 7, 9.

**Files**
- Modify: `apps/web/src/lib/proposals/generate.ts:318-385`, `:618-624`; `apps/web/src/lib/proposals/generate.test.ts:67-135` (the two fakes) and one appended case
- Create: `apps/web/src/lib/proposals/generate.fallback.test.ts`

**Interfaces**
- Consumes: `aiComplete`, `AI_REFUSALS` (`@/lib/ai/gateway`); `aiSafeError` (`@/lib/ai/log`); `gateRpc`, `openGateDb` (`@/lib/ai/testing/open-gate`, tests only).
- Produces: `generateProposals(input)`, signature UNCHANGED (`generate.ts:239-294`).

- [ ] **Step 1: Read** `generate.ts:215-420` and `:600-627`, `generate.test.ts:1-160` and `:280-310`, `:736-830`.

- [ ] **Step 2: Write the failing tests.**

(a) `apps/web/src/lib/proposals/generate.fallback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { generateProposals } from "./generate";
import { AI_REFUSALS } from "@/lib/ai/gateway";

/** G6: proposals fall back to none. A stand-in client that records every table it is asked for. */
function recordingDb() {
  const tables: string[] = [];
  return { tables, db: { from: (t: string) => { tables.push(t); throw new Error(`no write expected to ${t}`); } } as never };
}
const t = (role: "caller" | "assistant", text: string): TranscriptEvent => ({ role, text, at: "2026-09-18T12:00:00.000Z" });
const base = {
  accountId: "acct", callId: "call1", contactId: null, outcome: "lead" as const,
  transcript: [t("assistant", "How can I help?"), t("caller", "Can someone call me back about a quote?")],
  handoffRequested: false, blankFields: [], openOpportunity: null, callbackTodo: false,
  now: new Date("2026-09-18T13:00:00.000Z"), timezone: "America/Chicago",
};

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("generateProposals on the gateway (spec 3.2)", () => {
  it.each(AI_REFUSALS)("%s -> 0 proposals and no write (mutation: on a refusal, parse '{\"proposals\":[...]}' anyway -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    const { db, tables } = recordingDb();
    expect(await generateProposals({ ...base, db })).toBe(0);
    expect(tables).toEqual([]);
  });

  it("an ineligible call makes no gateway call at all (mutation: call aiComplete before callIsEligible -> FAILS)", async () => {
    const { db } = recordingDb();
    expect(await generateProposals({ ...base, db, outcome: "spam" })).toBe(0);
    expect(gw.aiComplete).not.toHaveBeenCalled();
  });

  it("asks for call_proposals on gpt-4o-mini in JSON mode, 2000 tokens, 10 s, the account's zone, naming the call (mutation: maxTokens 4000 -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: JSON.stringify({ proposals: [] }), usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    const { db } = recordingDb();
    await generateProposals({ ...base, db });
    expect(gw.aiComplete).toHaveBeenCalledWith(db, expect.objectContaining({
      accountId: "acct", feature: "call_proposals", model: "gpt-4o-mini", responseFormat: { type: "json_object" },
      maxTokens: 2000, timeoutMs: 10_000, timezone: "America/Chicago", ref: "call call1",
    }));
  });
});
```

(Read `callIsEligible` (`lib/proposals/eligibility.ts`) to confirm `outcome: "lead"` with a caller turn is eligible and `"spam"` is not; if the base transcript is not eligible, use `generate.test.ts`'s own `transcript` fixture (`:28-45`) instead and say so.)

(b) In `generate.test.ts`: `import { gateRpc } from "@/lib/ai/testing/open-gate";` and, in BOTH `fakeDb()` (`:80`, the `const db: any = {` object) and `fakeDbAlwaysRefusing()` (`:118`), the property `rpc: gateRpc().rpc,` after `rows, attempts, …`. Append:

```ts
  it("a model answer that does not parse logs no word of it (plan deviation 6; mutation: log String(e) in the catch -> FAILS)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "SENTINEL-OUTPUT-7f3 not json" } }],
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]![0])).toBe("generateProposals: failed for call call1: SyntaxError (an answer that did not parse)");
    errorSpy.mockRestore();
  });
```

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/proposals/generate.test.ts src/lib/proposals/generate.fallback.test.ts`. Expected: the fallback file's rows FAIL (`aiComplete` never called; the refusal rows reach `fetch` with no key in the env → today's missing-key branch returns 0, so look for the FAILING rows: the call-args case fails; if every refusal row passes on today's code, that is because 0 is today's answer for a missing key too: say so, and confirm those rows by the mutation in Step 6 instead), and the SENTINEL case FAILS (`expected 'generateProposals: failed for call call1: SyntaxError: Unexpected token \'S\', "SENTINEL-O"… is not valid JSON' to be …`). Paste the lines.

- [ ] **Step 4: Rewrite the request** (`generate.ts:323-385`). From the comment above `const apiKey` (`:323`) through the `const raw: unknown[] = parsed.proposals;` line (`:385`) becomes:

```ts
    // The one AI door (lib/ai/gateway.ts, item 8a-1): the switches, the budget, the key, the time limit and the
    // ledger live there, and every refusal or failure comes back as `ok: false`, already logged by the gateway with
    // this call's id (`ref`) — a rotated or missing key still logs once per ELIGIBLE call (the reason above), never
    // per robocall. An empty proposal list IS the fallback.
    const answer = await aiComplete(input.db, {
      accountId: input.accountId,
      feature: "call_proposals",
      model: "gpt-4o-mini",
      // Deliberate divergence from summary-service.ts's own completion:
      // that function consumes PROSE and has a deterministic fact-line
      // fallback (`composeSummary`) when the completion is unusable, so a
      // stray code fence in the response costs it nothing. This function
      // parses JSON with no fallback of its own — an empty proposal list
      // IS the fallback — and `gpt-4o-mini` routinely wraps JSON in a
      // ```json fence when asked for JSON without `response_format`,
      // which would silently zero this feature forever. Forcing JSON mode
      // removes that failure instead of tolerating it.
      responseFormat: { type: "json_object" },
      // Minor 6 of the fix-wave: with no bound here, nothing states a
      // ceiling on how many elements the model's own `proposals` array
      // can contain before the loop below even starts counting attempts
      // — a flood of UNGROUNDED proposals still costs a full
      // `groundedEvidence` scan per element (measured: 5,000 elements
      // against a 120-turn transcript, 565ms). Three short task
      // proposals fit comfortably inside this; a runaway array does not.
      maxTokens: 2000,
      messages: [
        { role: "system", content: systemFor(input.blankFields, input.openOpportunity, input.now, input.timezone, input.callbackTodo) },
        { role: "user", content: transcriptForModel(input.transcript) },
      ],
      // Same 10s bound as the summary call. This runs after the row is
      // written so a hang cannot lose the call, but it still shares the
      // invocation's maxDuration budget.
      timeoutMs: 10_000,
      timezone: input.timezone,
      ref: `call ${input.callId}`,
      fetchImpl: input.fetchImpl,
    });
    if (!answer.ok) return 0;
    const parsed = JSON.parse(answer.text);
    if (!Array.isArray(parsed?.proposals)) {
      console.error(`generateProposals: model response had no proposals array for call ${input.callId}`);
      return 0;
    }
    const raw: unknown[] = parsed.proposals;
```

and the catch at `:618-624`:

```ts
  } catch (e) {
    // aiSafeError, never String(e): JSON.parse's SyntaxError quotes the model's words (plan deviation 6).
    console.error(`generateProposals: failed for call ${input.callId}: ${aiSafeError(e)}`);
    return written;
  }
```

(keep the comment lines that sat above the old `console.error` at `:619-622`). Imports: `import { aiComplete } from "@/lib/ai/gateway";` and `import { aiSafeError } from "@/lib/ai/log";`. The doc comment at `:215-238` (if it names `OPENAI_API_KEY` or the fetch) gains "through the AI door (lib/ai/gateway.ts)". `grep -n "OPENAI_API_KEY\|api.openai.com\|r.ok" apps/web/src/lib/proposals/generate.ts` → nothing after the edit (comments in `generate.test.ts` may still name the key: leave them).

- [ ] **Step 5: Run green.** The Step 3 command → all PASS, including every pre-existing case UNCHANGED (paste the summary line: the count is the old count plus 1 in `generate.test.ts`, and the fallback file's 10). `pnpm --filter web typecheck` → exit 0. `pnpm --filter web exec eslint src/lib/proposals/generate.ts` → clean.

- [ ] **Step 6: Probes, by name:** (a) `if (!answer.ok) return 0;` → `const text = answer.ok ? answer.text : JSON.stringify({ proposals: [{ kind: "task", title: "x", evidence: "Can someone call me back about a quote?" }] });` and parse `text` → every fallback row FAILS (`tables` is `["call_proposals"]`); (b) move the `aiComplete` call above `callIsEligible` → "an ineligible call makes no gateway call" FAILS; (c) `maxTokens: 4000` → the args case FAILS; (d) `String(e)` in the catch → the SENTINEL case FAILS; (e) drop `rpc: gateRpc().rpc` from `fakeDb()` → the existing "writes a grounded task proposal" case FAILS (the gate is unreadable, so no proposal; this proves the fakes run the REAL gateway). Paste each line.

- [ ] **Step 7: Commit** `git add -- apps/web/src/lib/proposals/generate.fallback.test.ts` then `git commit -m "proposals: the call's suggestions go through the AI door; every refusal is none, and no model word reaches a log (item 8a-1)" -- apps/web/src/lib/proposals/generate.ts apps/web/src/lib/proposals/generate.test.ts apps/web/src/lib/proposals/generate.fallback.test.ts`.

---

## Task 7: The card's view model and its actions (bis-platform)

**Review:** opus (the actions are the only writes a person makes to AI's switches). **Runs beside:** Tasks 5, 6, 9; after Task 3 (keys).

**Files**
- Create: `apps/web/src/lib/ai/settings-view.ts`, `apps/web/src/lib/ai/settings-view.test.ts`
- Create: `…/settings/ai-actions.ts`, `…/settings/ai-actions.test.ts`
- Modify: `…/[accountId]/in-account-service-reads.test.ts` (one `ALLOWED` line beside `:137`)

**Interfaces**
- Consumes: `getAiSettings`, `setAccountAiSettings`, `setGlobalAiEnabled`, `MAX_MONTHLY_BUDGET_CENTS`, `type AiSettingsRead`, `serviceDb` (`@bis/db`, Task 2); `periodKeys` (Task 4); `t`, `plural` (`lib/i18n/t.ts`); the Task 3 keys; `requireAgencyOnlyAccountAccess` (`lib/auth.ts:98`); `loggableError`.
- Produces:
  - `settings-view.ts`: `parseBudgetDollars(raw: unknown): number | null` (cents, or null); `isConfirmWord(raw: unknown): boolean` (`OFF` or `APAGAR`, trimmed, any case); `type AiCardView = { accountEnabled: boolean; budgetDollars: string; globalEnabled: boolean; spendLine: string | null; reachedLine: string | null; skippedLine: string | null }`; `aiCardView(i: { settings: AiSettingsRead; refusals: number; overBudgetAt: string | null; now: Date; zone: string; locale: Locale }): AiCardView`.
  - `ai-actions.ts` (`"use server"`): `type AiPrior = { enabled: boolean; monthlyBudgetCents: number }`; `type AiSaveResult = { ok: true; prior: AiPrior } | { ok: false; error: "aiSettings.error.budget" | "aiSettings.error.failed" }`; `type AiGlobalResult = { ok: true; prior: boolean } | { ok: false; error: "aiSettings.global.wrongWord" | "aiSettings.error.failed" }`; `saveAccountAiAction(accountId: string, input: { enabled: boolean; budget: string }): Promise<AiSaveResult>`; `undoAccountAiAction(accountId: string, prior: AiPrior): Promise<AiSaveResult>`; `setGlobalAiAction(accountId: string, input: { enabled: boolean; confirm?: string }): Promise<AiGlobalResult>`.

- [ ] **Step 1: Read** `…/settings/billing-actions.ts:1-60` and `billing-actions.test.ts:1-60` (the guard-first shape and its test's mocks), `lib/auth.ts:80-104`, `lib/billing/billing-view.ts:56-71`, `…/[accountId]/in-account-service-reads.test.ts:130-145`, Task 2's `ai-gateway.ts` and Task 3's keys.

- [ ] **Step 2: Write the failing tests.**

`apps/web/src/lib/ai/settings-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aiCardView, isConfirmWord, parseBudgetDollars } from "./settings-view";

/** Spec 3.6; plan deviations 15, 17. Intl outputs read with node (plan, "Read, not assumed"). */
const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Chicago";
const settings = (o: Partial<Parameters<typeof aiCardView>[0]["settings"]> = {}) =>
  ({ accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 0, globalEnabled: true, ...o });

describe("parseBudgetDollars (plan deviation 17)", () => {
  it.each([["10", 1000], ["$25", 2500], [" 1000 ", 100000], ["0", 0], ["$ 7", 700]])("%j -> %i cents", (raw, cents) => {
    expect(parseBudgetDollars(raw)).toBe(cents);
  });
  it.each(["", "abc", "1001", "-5", "10.50", "1e3", "12345", null, 25])("%j -> refused (mutation: allow cents or drop the 1000 cap -> FAILS)", (raw) => {
    expect(parseBudgetDollars(raw)).toBeNull();
  });
});

describe("isConfirmWord (choice I12)", () => {
  it("OFF or APAGAR, trimmed, any case; nothing else (mutation: accept any non-empty text -> FAILS)", () => {
    expect([isConfirmWord("OFF"), isConfirmWord(" off "), isConfirmWord("apagar"), isConfirmWord("of"), isConfirmWord(""), isConfirmWord(undefined)])
      .toEqual([true, true, true, false, false, false]);
  });
});

describe("aiCardView (spec 3.6)", () => {
  it("this month's spend in words, rounded up to the cent, in both languages (mutation: Math.floor -> $1.83 -> FAILS)", () => {
    const v = (locale: "en" | "es") => aiCardView({ settings: settings({ monthSpendMicroUsd: 1_830_001 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale });
    expect([v("en").spendLine, v("es").spendLine]).toEqual(["$1.84 of $10.00 this month, estimated", "$1.84 de $10.00 este mes, estimado"]);
  });

  it("no use this month is the empty state, even with spend stored for LAST month (mutation: ignore monthKey -> FAILS)", () => {
    const v = aiCardView({ settings: settings({ monthKey: "2026-09", monthSpendMicroUsd: 5_000_000 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" });
    expect([v.spendLine, v.reachedLine, v.skippedLine]).toEqual([null, null, null]);
  });

  it("budget reached names the day it happened and the 1st it resumes, in the account's zone (plan deviation 15; mutation: resume on the 1st in UTC -> FAILS)", () => {
    const v = (locale: "en" | "es", at: string | null) => aiCardView({ settings: settings({ monthSpendMicroUsd: 10_000_000 }), refusals: 2, overBudgetAt: at, now: NOW, zone: ZONE, locale });
    expect([v("en", "2026-10-14T15:00:00Z").reachedLine, v("es", "2026-10-14T15:00:00Z").reachedLine]).toEqual([
      "Budget reached on Oct 14. AI is paused for this account until Nov 1.",
      "Presupuesto alcanzado el 14 oct. La IA está en pausa en esta cuenta hasta el 1 nov.",
    ]);
    expect(v("en", null).reachedLine).toBe("Budget reached. AI is paused for this account until Nov 1.");
  });

  it("the resume day is the 1st of next month in a zone whose DST changes at midnight, and across a year end (review M4; assumption A6; mutation: the old monthStartInZone(+32 days) arithmetic -> FAILS if the zone's 1st has no local midnight)", () => {
    const resume = (now: string, zone: string) =>
      aiCardView({ settings: settings({ monthKey: null, monthSpendMicroUsd: 0, monthlyBudgetCents: 0 }), refusals: 0, overBudgetAt: null, now: new Date(now), zone, locale: "en" }).reachedLine;
    expect(resume("2026-09-05T12:00:00Z", "America/Santiago")).toBe("Budget reached. AI is paused for this account until Oct 1.");
    expect(resume("2026-04-04T12:00:00Z", "America/Santiago")).toBe("Budget reached. AI is paused for this account until May 1.");
    expect(resume("2026-12-31T23:30:00Z", ZONE)).toBe("Budget reached. AI is paused for this account until Jan 1.");
  });

  it("one micro-dollar under the budget is not reached (mutation: `>` -> `>=` on budget - 1 -> FAILS)", () => {
    expect(aiCardView({ settings: settings({ monthSpendMicroUsd: 9_999_999 }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" }).reachedLine).toBeNull();
  });

  it("how often AI was skipped, once and many (choice I10; mutation: drop the One form -> FAILS)", () => {
    const v = (n: number, locale: "en" | "es") => aiCardView({ settings: settings(), refusals: n, overBudgetAt: null, now: NOW, zone: ZONE, locale }).skippedLine;
    expect([v(1, "en"), v(3, "es"), v(0, "en")]).toEqual([
      "AI was skipped once this month because it was off or over budget.",
      "La IA se omitió 3 veces este mes porque estaba apagada o sin presupuesto.",
      null,
    ]);
  });

  it("the switches and the budget as the field shows it (mutation: budgetDollars in cents -> FAILS)", () => {
    const v = aiCardView({ settings: settings({ accountEnabled: false, monthlyBudgetCents: 2500, globalEnabled: false }), refusals: 0, overBudgetAt: null, now: NOW, zone: ZONE, locale: "en" });
    expect([v.accountEnabled, v.budgetDollars, v.globalEnabled]).toEqual([false, "25", false]);
  });
});
```

`…/settings/ai-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

/** clients: every serviceDb() made. None may be made before requireAgencyOnlyAccountAccess let the caller through. */
const guard = vi.hoisted(() => ({ agency: true, clients: 0, calls: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async (accountId: string) => {
    guard.calls.push(`guard ${accountId}`);
    if (!guard.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "u_agency" };
  },
}));
const dbm = vi.hoisted(() => ({ getAiSettings: vi.fn(), setAccountAiSettings: vi.fn(), setGlobalAiEnabled: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAiSettings: dbm.getAiSettings, setAccountAiSettings: dbm.setAccountAiSettings, setGlobalAiEnabled: dbm.setGlobalAiEnabled,
  serviceDb: () => { guard.clients += 1; guard.calls.push("serviceDb"); return { tag: "service" }; },
}));

const { saveAccountAiAction, undoAccountAiAction, setGlobalAiAction } = await import("./ai-actions");
const SVC = { tag: "service" };
const STORED = { accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 0, globalEnabled: true };

beforeEach(() => {
  guard.agency = true; guard.clients = 0; guard.calls = [];
  dbm.getAiSettings.mockReset().mockResolvedValue(STORED);
  dbm.setAccountAiSettings.mockReset().mockResolvedValue(undefined);
  dbm.setGlobalAiEnabled.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the AI card's actions are agency-only, guard first (spec 3.3, 3.6)", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["save", () => saveAccountAiAction("a1", { enabled: false, budget: "25" })],
    ["undo", () => undoAccountAiAction("a1", { enabled: true, monthlyBudgetCents: 1000 })],
    ["global", () => setGlobalAiAction("a1", { enabled: false, confirm: "OFF" })],
  ];
  it.each(all)("%s: a non-agency caller is redirected before any client exists or anything is written (mutation: move the guard below serviceDb() -> FAILS)", async (_name, run) => {
    guard.agency = false;
    await expect(run()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.clients).toBe(0);
    expect([dbm.setAccountAiSettings.mock.calls.length, dbm.setGlobalAiEnabled.mock.calls.length]).toEqual([0, 0]);
  });
  it.each(all)("%s: the guard names THIS account and runs first (mutation: guard a constant account -> FAILS)", async (_name, run) => {
    await run();
    expect(guard.calls[0]).toBe("guard a1");
  });
});

describe("saveAccountAiAction", () => {
  it("writes the switch and the budget in cents on the service client, as the agency user, and answers the prior values (mutation: write budget dollars as cents -> FAILS)", async () => {
    expect(await saveAccountAiAction("a1", { enabled: false, budget: "$25" })).toEqual({ ok: true, prior: { enabled: true, monthlyBudgetCents: 1000 } });
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 2500, actorId: "u_agency" });
  });
  it.each(["", "abc", "1001", "10.50"])("refuses the budget %j with the budget sentence and writes nothing (mutation: skip parseBudgetDollars -> FAILS)", async (budget) => {
    expect(await saveAccountAiAction("a1", { enabled: true, budget })).toEqual({ ok: false, error: "aiSettings.error.budget" });
    expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
  });
  it("a failed write answers the failed sentence and logs the account, never the input (mutation: rethrow -> FAILS)", async () => {
    dbm.setAccountAiSettings.mockRejectedValue(new Error("setAccountAiSettings failed: boom"));
    expect(await saveAccountAiAction("a1", { enabled: true, budget: "777" })).toEqual({ ok: false, error: "aiSettings.error.failed" });
    const line = String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(line).toBe("ai settings: save failed for account a1: Error: setAccountAiSettings failed: boom");
  });
});

describe("undoAccountAiAction", () => {
  it("writes back exactly the prior values (mutation: write the defaults -> FAILS)", async () => {
    await undoAccountAiAction("a1", { enabled: false, monthlyBudgetCents: 4200 });
    expect(dbm.setAccountAiSettings).toHaveBeenCalledWith(SVC, "a1", { enabled: false, monthlyBudgetCents: 4200, actorId: "u_agency" });
  });
  it.each([{ enabled: "yes", monthlyBudgetCents: 1000 }, { enabled: true, monthlyBudgetCents: 100001 }, { enabled: true, monthlyBudgetCents: 10.5 }])(
    "refuses a prior that is not one this card could have read: %j (mutation: write any prior -> FAILS)", async (prior) => {
      expect(await undoAccountAiAction("a1", prior as never)).toEqual({ ok: false, error: "aiSettings.error.failed" });
      expect(dbm.setAccountAiSettings).not.toHaveBeenCalled();
    });
});

describe("setGlobalAiAction (choice I12, rule 6)", () => {
  it("turning AI off everywhere needs the typed word; without it nothing is written (mutation: skip isConfirmWord -> FAILS)", async () => {
    for (const confirm of [undefined, "", "of", "yes"]) {
      expect(await setGlobalAiAction("a1", { enabled: false, confirm })).toEqual({ ok: false, error: "aiSettings.global.wrongWord" });
    }
    expect(dbm.setGlobalAiEnabled).not.toHaveBeenCalled();
  });
  it("with the word, in either language, it turns off and answers the prior state", async () => {
    expect(await setGlobalAiAction("a1", { enabled: false, confirm: "apagar" })).toEqual({ ok: true, prior: true });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: false, actorId: "u_agency" });
  });
  it("turning it back on needs no word (rule 6: reversible, immediate)", async () => {
    dbm.getAiSettings.mockResolvedValue({ ...STORED, globalEnabled: false });
    expect(await setGlobalAiAction("a1", { enabled: true })).toEqual({ ok: true, prior: false });
    expect(dbm.setGlobalAiEnabled).toHaveBeenCalledWith(SVC, { enabled: true, actorId: "u_agency" });
  });
});
```

In `in-account-service-reads.test.ts`, add beside `:137`:

```ts
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.ts": "agency-only",
```

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/ai/settings-view.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`. Expected: the two new files FAIL to load; the service-reads test FAILS on the listed-but-missing file (read its failure: if the test only checks unlisted importers, it passes now and fails after Step 4 WITHOUT the line: run that order instead and say so). Paste the lines.

- [ ] **Step 4: Write** `apps/web/src/lib/ai/settings-view.ts`:

```ts
import { MAX_MONTHLY_BUDGET_CENTS, type AiSettingsRead } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { plural, t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { periodKeys } from "./period";

/** Whole dollars, 0-1000, an optional leading "$" (plan deviation 17). Cents, or null. */
export function parseBudgetDollars(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^\$\s*/, "");
  if (!/^\d{1,4}$/.test(s)) return null;
  const cents = Number(s) * 100;
  return cents <= MAX_MONTHLY_BUDGET_CENTS ? cents : null;
}

/** The typed word that turns AI off for every account (choice I12): the catalogue's, in either language. */
export function isConfirmWord(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const w = raw.trim().toUpperCase();
  return w === m["aiSettings.global.confirmWord"] || w === m["aiSettings.global.confirmWord.es"];
}

export type AiCardView = {
  accountEnabled: boolean; budgetDollars: string; globalEnabled: boolean;
  spendLine: string | null; reachedLine: string | null; skippedLine: string | null;
};

const plain = (s: string) => s.replace(/[  ]/g, " ");

/**
 * The agency's AI card (spec 3.6), in the reader's language. The month is the account's own (choice I7): spend
 * stored under another month reads as none, as the gate reads it. Spend is rounded UP to the cent, so a little use
 * never reads as $0.00. "Reached" is spend >= budget, the gate's own test; its day is the month's first over-budget
 * ledger row (plan deviation 15).
 */
export function aiCardView(i: {
  settings: AiSettingsRead; refusals: number; overBudgetAt: string | null; now: Date; zone: string; locale: Locale;
}): AiCardView {
  const tag = i.locale === "es" ? "es-US" : "en-US";
  const money = (cents: number) => plain(new Intl.NumberFormat(tag, { style: "currency", currency: "USD" }).format(cents / 100));
  const day = (d: Date) => plain(new Intl.DateTimeFormat(tag, { timeZone: i.zone, month: "short", day: "numeric" }).format(d));
  const s = i.settings;
  const spent = s.monthKey === periodKeys(i.now, i.zone).monthKey ? s.monthSpendMicroUsd : 0;
  // The 1st of next month, built from the account's own month key at NOON UTC and printed in UTC (review M4): a
  // calendar date, so no zone's midnight (or a DST change at midnight) can move it to the 31st or the 2nd.
  const [y, mo] = periodKeys(i.now, i.zone).monthKey.split("-").map(Number) as [number, number];
  const resumeAt = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1, 12));
  const resume = plain(new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: "short", day: "numeric" }).format(resumeAt));
  const reached = spent >= s.monthlyBudgetCents * 10_000;
  return {
    accountEnabled: s.accountEnabled,
    budgetDollars: String(s.monthlyBudgetCents / 100),
    globalEnabled: s.globalEnabled,
    spendLine: spent > 0 || i.refusals > 0
      ? t(m, "aiSettings.spend", i.locale, { spent: money(Math.ceil(spent / 10_000)), budget: money(s.monthlyBudgetCents) })
      : null,
    reachedLine: !reached ? null
      : i.overBudgetAt ? t(m, "aiSettings.reached", i.locale, { date: day(new Date(i.overBudgetAt)), resume })
      : t(m, "aiSettings.reachedNoDate", i.locale, { resume }),
    skippedLine: i.refusals > 0 ? plural(m, "aiSettings.skipped", i.refusals, i.locale, { count: i.refusals }) : null,
  };
}
```

(The "no use this month" case with the default $10 has `reached` false; a $0 budget with no use reads as the empty line AND "Budget reached. AI is paused …", which is true.)

`…/settings/ai-actions.ts`:

```ts
"use server";

/**
 * The agency's AI card (item 8a-1, spec 3.3, 3.6). requireAgencyOnlyAccountAccess is the FIRST line of every
 * action: Settings is agency-only, but a server action is a public POST endpoint, so each guards itself (hiding
 * the card is not authorization). The account id is bound server-side by ai-section.tsx and never travels as a
 * form field. Writes go through serviceDb() (0086 grants authenticated SELECT only), and only after the guard.
 * Each answers the PRIOR value it replaced, which is what the toast's Undo writes back.
 */
import { MAX_MONTHLY_BUDGET_CENTS, getAiSettings, serviceDb, setAccountAiSettings, setGlobalAiEnabled } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";
import { isConfirmWord, parseBudgetDollars } from "@/lib/ai/settings-view";

export type AiPrior = { enabled: boolean; monthlyBudgetCents: number };
export type AiSaveResult = { ok: true; prior: AiPrior } | { ok: false; error: "aiSettings.error.budget" | "aiSettings.error.failed" };
export type AiGlobalResult = { ok: true; prior: boolean } | { ok: false; error: "aiSettings.global.wrongWord" | "aiSettings.error.failed" };

const FAILED = { ok: false as const, error: "aiSettings.error.failed" as const };

async function writeAccount(accountId: string, userId: string, next: AiPrior): Promise<AiSaveResult> {
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    await setAccountAiSettings(db, accountId, { ...next, actorId: userId });
    return { ok: true, prior: { enabled: before.accountEnabled, monthlyBudgetCents: before.monthlyBudgetCents } };
  } catch (e) {
    console.error(`ai settings: save failed for account ${accountId}: ${loggableError(e)}`);
    return FAILED;
  }
}

export async function saveAccountAiAction(accountId: string, input: { enabled: boolean; budget: string }): Promise<AiSaveResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const cents = parseBudgetDollars(input?.budget);
  if (cents === null) return { ok: false, error: "aiSettings.error.budget" };
  if (typeof input.enabled !== "boolean") return FAILED;
  return writeAccount(accountId, userId, { enabled: input.enabled, monthlyBudgetCents: cents });
}

export async function undoAccountAiAction(accountId: string, prior: AiPrior): Promise<AiSaveResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const c = prior?.monthlyBudgetCents;
  if (typeof prior?.enabled !== "boolean" || !Number.isInteger(c) || c < 0 || c > MAX_MONTHLY_BUDGET_CENTS) return FAILED;
  return writeAccount(accountId, userId, { enabled: prior.enabled, monthlyBudgetCents: c });
}

export async function setGlobalAiAction(accountId: string, input: { enabled: boolean; confirm?: string }): Promise<AiGlobalResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  if (typeof input?.enabled !== "boolean") return FAILED;
  // Rule 6: turning AI off for EVERY account is the one destructive-in-effect act here; turning it on is not.
  if (!input.enabled && !isConfirmWord(input.confirm)) return { ok: false, error: "aiSettings.global.wrongWord" };
  const db = serviceDb();
  try {
    const before = await getAiSettings(db, accountId);
    await setGlobalAiEnabled(db, { enabled: input.enabled, actorId: userId });
    return { ok: true, prior: before.globalEnabled };
  } catch (e) {
    console.error(`ai settings: global switch failed (from account ${accountId}): ${loggableError(e)}`);
    return FAILED;
  }
}
```

- [ ] **Step 5: Run green.** The Step 3 command → all PASS (paste the summary). `pnpm --filter web typecheck` → exit 0. `pnpm --filter web exec eslint src/lib/ai/settings-view.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.ts"` → clean.

- [ ] **Step 6: Probes, by name:** (a) move `await requireAgencyOnlyAccountAccess(accountId)` below `serviceDb()` in `setGlobalAiAction` (read the guard's answer later) → the global row of "a non-agency caller is redirected" FAILS; (b) drop the `isConfirmWord` check → "needs the typed word" FAILS; (c) `parseBudgetDollars` accepting `^\d{1,4}(\.\d{2})?$` → "10.50" refused row FAILS; (d) `Math.floor` in the spend line → "rounded up to the cent" FAILS; (e) `spent = s.monthSpendMicroUsd` (ignore the month) → "even with spend stored for LAST month" FAILS; (f) the resume day built as `monthStartInZone(new Date(monthStartInZone(i.now, i.zone).getTime() + 32 * 86_400_000), i.zone)` printed in the zone (the old arithmetic) → run the M4 case and paste whether it fails; if it passes, say so (the noon-UTC form is then defence, not a fix); (f2) `mo === 12 ? y + 1 : y` → `y` → the year-end row FAILS; (g) remove the new `ALLOWED` line → `in-account-service-reads.test.ts` FAILS naming `ai-actions.ts`. Paste each line.

- [ ] **Step 7: Commit** `git add -- apps/web/src/lib/ai/settings-view.ts apps/web/src/lib/ai/settings-view.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.test.ts"` then `git commit -m "settings: the AI card's words and its three agency-only actions, guard first, each answering what Undo puts back (item 8a-1)" -- apps/web/src/lib/ai/settings-view.ts apps/web/src/lib/ai/settings-view.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`.

---

## Task 8: The AI card, its section, the page mount, ⌘K (bis-frontend)

**Review:** sonnet. **Runs after:** Tasks 3 and 7.

**Files**
- Create: `…/settings/ai-section.tsx`, `ai-section.test.ts`, `ai-card.tsx`, `ai-card.test.ts`, `ai-card-handlers.ts`, `ai-card-handlers.test.ts`
- Modify: `…/settings/page.tsx` (import beside `:25`; the mount after the Billing boundary, `:207-209`), `…/settings/page.test.ts` (one `vi.mock` beside `:110`, one import, one case after `:202-213`), `apps/web/src/lib/palette/registry.ts:50` (one line after), `apps/web/src/lib/palette/registry.test.ts` (one case after `:127`)

**Interfaces**
- Consumes: `aiCardView`, `type AiCardView` (Task 7, TYPE-only in the client card); `saveAccountAiAction`, `undoAccountAiAction`, `setGlobalAiAction`, `type AiPrior`, `type AiSaveResult`, `type AiGlobalResult` (Task 7); `getAiSettings`, `countAiSkipsSince`, `firstOverBudgetSince` (Task 2); `dbForRequest` (`lib/db`); `getPersonPrefs`; `requestLocale`; `safeZone`, `monthStartInZone`; Task 3's keys; `common.undo`.
- Produces: `AiSection({ accountId })` (server), `AiCardSkeleton()`, `AiCardError({ locale })`, `AiCard(props)`, `AiGlobalConfirmForm(props)`, `confirmMatches(typed, word)`, `aiCardHandlers(deps)`; DOM markers `#ai` (the card, the palette's anchor), `data-ai-card`, `data-ai-spend`, `data-ai-empty`, `data-ai-reached`, `data-ai-skipped`, `data-ai-account`, `data-ai-budget`, `data-ai-save`, `data-ai-global`, `data-ai-global-off`, `data-ai-global-on`, `data-ai-confirm`, `data-ai-confirm-input`, `data-ai-confirm-off`, `data-ai-error`.

- [ ] **Step 1: Read** `…/settings/billing-section.tsx`, `billing-card.tsx:340-390` (skeleton and error card), `weekly-report-card.tsx`, `…/contacts/document-purge-dialog.tsx` (the typed-word form, presentational for tests), `…/contacts/document-checklist-handlers.ts` (the Undo toast shape), `…/settings/page.tsx:190-215`, `page.test.ts:95-215`, `sections.test.ts:1-80` (calling a server component and walking its element), `branding/page.tsx:70-120` (the locale), `components/ui/{checkbox,notice,dialog,button}.tsx`, `lib/rendered-text.ts`, `lib/palette/registry.ts:36-51`, `registry.test.ts:86-128`.

- [ ] **Step 2: Write the failing tests.**

`…/settings/ai-card-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { aiCardHandlers } from "./ai-card-handlers";

/** Rule 6: Save and the global switch run at once; the toast carries Undo. Words read in both languages. */
function deps(locale: "en" | "es", o: Partial<Parameters<typeof aiCardHandlers>[0]> = {}) {
  const said: { kind: string; text: string; undo?: string; onUndo?: () => void }[] = [];
  const toast = {
    success: (text: string, opts?: { action: { label: string; onClick: () => void } }) => { said.push({ kind: "ok", text, undo: opts?.action.label, onUndo: opts?.action.onClick }); },
    error: (text: string) => { said.push({ kind: "error", text }); },
  };
  const refresh = vi.fn();
  const save = vi.fn(async () => ({ ok: true as const, prior: { enabled: true, monthlyBudgetCents: 1000 } }));
  const undo = vi.fn(async () => ({ ok: true as const, prior: { enabled: false, monthlyBudgetCents: 2500 } }));
  const setGlobal = vi.fn(async () => ({ ok: true as const, prior: true }));
  return { said, refresh, save, undo, setGlobal, h: aiCardHandlers({ locale, toast, refresh, save, undo, setGlobal, ...o }) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("aiCardHandlers.save", () => {
  it("saves, refreshes, and offers an Undo that writes back the prior values (mutation: undo with the new values -> FAILS)", async () => {
    const d = deps("en");
    expect(await d.h.save({ enabled: false, budget: "25" })).toBe(true);
    expect(d.save).toHaveBeenCalledWith({ enabled: false, budget: "25" });
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "Saved. This account's AI settings are updated.", undo: "Undo" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.undo).toHaveBeenCalledWith({ enabled: true, monthlyBudgetCents: 1000 });
    expect(d.said[1]).toEqual({ kind: "ok", text: "Put back the earlier AI settings.", undo: undefined, onUndo: undefined });
    expect(d.refresh).toHaveBeenCalledTimes(2);
  });

  it("a refusal says its sentence in the reader's language and refreshes nothing (mutation: toast the key itself -> FAILS)", async () => {
    const d = deps("es", { save: vi.fn(async () => ({ ok: false as const, error: "aiSettings.error.budget" as const })) });
    expect(await d.h.save({ enabled: true, budget: "abc" })).toBe(false);
    expect(d.said).toEqual([{ kind: "error", text: "Escriba una cantidad en dólares enteros de $0 a $1,000." }]);
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("a thrown action (a stale tab) says the card's own crash sentence, in usted (mutation: common.actionCrashed -> FAILS)", async () => {
    const d = deps("es", { save: vi.fn(async () => { throw new Error("stale"); }) });
    await d.h.save({ enabled: true, budget: "10" });
    expect(d.said).toEqual([{ kind: "error", text: "Algo salió mal. Vuelva a cargar la página e inténtelo de nuevo." }]);
  });
});

describe("aiCardHandlers.setGlobal", () => {
  it("turning off sends the typed word; its Undo turns AI back on (mutation: drop confirm -> FAILS)", async () => {
    const d = deps("en");
    await d.h.setGlobal(false, "off");
    expect(d.setGlobal).toHaveBeenCalledWith({ enabled: false, confirm: "off" });
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "AI is off in every account.", undo: "Undo" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.setGlobal).toHaveBeenLastCalledWith({ enabled: true, confirm: undefined });
  });

  it("turning on is immediate, and its Undo turns AI off again with the reader's word (mutation: undo without the word -> FAILS)", async () => {
    const d = deps("es", { setGlobal: vi.fn(async () => ({ ok: true as const, prior: false })) });
    await d.h.setGlobal(true);
    expect(d.said[0]).toMatchObject({ kind: "ok", text: "La IA está encendida en todas las cuentas.", undo: "Deshacer" });
    d.said[0]!.onUndo!();
    await settle();
    expect(d.setGlobal).toHaveBeenLastCalledWith({ enabled: false, confirm: "APAGAR" });
  });

  it("a wrong word says which word, in the reader's language", async () => {
    const d = deps("en", { setGlobal: vi.fn(async () => ({ ok: false as const, error: "aiSettings.global.wrongWord" as const })) });
    expect(await d.h.setGlobal(false, "of")).toBe(false);
    expect(d.said).toEqual([{ kind: "error", text: "Type OFF to turn AI off everywhere." }]);
  });
});
```

`…/settings/ai-card.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./ai-actions", () => ({}));

const { AiCard, AiCardSkeleton, AiCardError, AiGlobalConfirmForm, confirmMatches } = await import("./ai-card");

const VIEW = { accountEnabled: true, budgetDollars: "10", globalEnabled: true, spendLine: null, reachedLine: null, skippedLine: null };
const noop = async () => ({ ok: false as const, error: "aiSettings.error.failed" as const });
const card = (view: Partial<typeof VIEW>, locale: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(AiCard, { view: { ...VIEW, ...view }, locale, save: noop, undo: noop, setGlobal: noop }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the AI card (spec 3.6; DESIGN.md rules 1, 5, 6, 7, 8)", () => {
  it("empty: one sentence, no spend line, in both languages, with lang set (mutation: render spendLine ?? '' -> FAILS)", () => {
    const en = card({});
    expect(count(en, "data-ai-empty"), "one empty line").toBe(1);
    expect(count(en, "data-ai-spend")).toBe(0);
    expect(renderedText(en)).toContain("No AI use yet this month.");
    const es = card({}, "es");
    expect(renderedText(es)).toContain("Todavía no hay uso de IA este mes.");
    expect(es).toContain('lang="es"');
  });

  it("loaded: the spend, reached and skipped lines it is given, each in its own marker (mutation: drop the reached Notice -> FAILS)", () => {
    const html = card({ spendLine: "$1.84 of $10.00 this month, estimated", reachedLine: "Budget reached. AI is paused for this account until Nov 1.", skippedLine: "AI was skipped once this month because it was off or over budget." });
    expect([count(html, "data-ai-spend"), count(html, "data-ai-reached"), count(html, "data-ai-skipped"), count(html, "data-ai-empty")]).toEqual([1, 1, 1, 0]);
    expect(renderedText(html)).toContain("$1.84 of $10.00 this month, estimated");
  });

  it("exactly one primary button, Save; the global switch is outline (rule 8; mutation: global button variant default -> FAILS)", () => {
    const html = card({});
    expect(count(html, 'data-variant="default"')).toBe(1);
    expect(html).toMatch(/data-ai-save[^>]*>|<button[^>]*data-variant="default"[^>]*data-ai-save/);
  });

  it("the global switch says what clicking does, both ways (mutation: one label for both states -> FAILS)", () => {
    expect(renderedText(card({ globalEnabled: true }))).toContain("Turn off everywhere");
    const off = card({ globalEnabled: false });
    expect(renderedText(off)).toContain("Turn on everywhere");
    expect(renderedText(off)).toContain("Off in every account. Nothing goes to AI until you turn it back on.");
    expect([count(off, "data-ai-global-on"), count(off, "data-ai-global-off")]).toEqual([1, 0]);
  });

  it("the stored switch and budget fill the form", () => {
    const html = card({ accountEnabled: false, budgetDollars: "25" });
    expect(html).toMatch(/data-ai-budget[^>]*value="25"|value="25"[^>]*data-ai-budget/);
    expect(html).toMatch(/data-ai-account[^>]*data-state="unchecked"|data-state="unchecked"[^>]*data-ai-account/);
  });
});

describe("the typed word (rule 6, choice I12)", () => {
  it("confirmMatches: the reader's word, trimmed, any case (mutation: case-sensitive -> FAILS)", () => {
    expect([confirmMatches(" off ", "OFF"), confirmMatches("OF", "OFF"), confirmMatches("apagar", "APAGAR")]).toEqual([true, false, true]);
  });
  const form = (typed: string, locale: "en" | "es" = "en") => renderToStaticMarkup(createElement(AiGlobalConfirmForm, {
    word: locale === "es" ? "APAGAR" : "OFF", typed, busy: false, locale, onTyped: () => {}, onCancel: () => {}, onConfirm: () => {},
  }));
  it("the destructive confirm stays disabled until the word matches (mutation: never disabled -> FAILS)", () => {
    expect(form("")).toMatch(/<button[^>]*data-ai-confirm-off[^>]*disabled|<button[^>]*disabled[^>]*data-ai-confirm-off/);
    expect(form("off")).not.toMatch(/<button[^>]*data-ai-confirm-off[^>]*disabled|<button[^>]*disabled[^>]*data-ai-confirm-off/);
  });
  it("says what it does and which word, in both languages", () => {
    expect(renderedText(form(""))).toContain("Every account loses call summaries and suggestions until AI is turned back on. Type OFF to confirm.");
    expect(renderedText(form("", "es"))).toContain("Todas las cuentas pierden los resúmenes de llamadas y las sugerencias hasta que la IA se vuelva a encender. Escriba APAGAR para confirmar.");
  });
});

describe("loading and failing on its own (rules 5, 7)", () => {
  it("the skeleton is shaped like the card, busy, never a spinner (mutation: add animate-spin -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AiCardSkeleton));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('id="ai"');
    expect(html).not.toContain("animate-spin");
  });
  it("the error card says so in the reader's language and keeps the anchor", () => {
    const es = renderToStaticMarkup(createElement(AiCardError, { locale: "es" }));
    expect(renderedText(es)).toContain("La configuración de IA no se pudo cargar ahora. El resto de la configuración sigue funcionando.");
    expect([count(es, 'id="ai"'), count(es, "data-ai-error")]).toEqual([1, 1]);
  });
});
```

(The two `toMatch` alternations cover either attribute order, since React keeps the order props are written in; once the component is written, the implementer may tighten each to the one real order and say so. Radix `Checkbox` renders `data-state="checked" | "unchecked"` on its button: confirm by reading `components/ui/checkbox.tsx`; if it does not, assert `aria-checked="false"` instead.)

`…/settings/ai-section.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

const fx = vi.hoisted(() => ({
  agency: true, reads: [] as string[], fail: false, prefsLanguage: null as "en" | "es" | null,
  settings: { accountEnabled: true, monthlyBudgetCents: 1000, monthKey: "2026-10", monthSpendMicroUsd: 1_840_000, globalEnabled: true },
}));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => { fx.reads.push("guard"); if (!fx.agency) throw new Error("NEXT_REDIRECT"); return { userId: "u" }; },
}));
const REQ = { tag: "request" };
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    ...REQ,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => { fx.reads.push("accounts"); return { data: { timezone: "America/Chicago", language: null }, error: null }; } };
      return chain;
    },
  }),
}));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: fx.prefsLanguage }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAiSettings: async (db: { tag: string }) => { fx.reads.push(`settings:${db.tag}`); if (fx.fail) throw new Error("read failed"); return fx.settings; },
  countAiSkipsSince: async (db: { tag: string }) => { fx.reads.push(`refusals:${db.tag}`); return 0; },
  firstOverBudgetSince: async (db: { tag: string }) => { fx.reads.push(`overBudget:${db.tag}`); return null; },
}));
vi.mock("./ai-actions", () => ({ saveAccountAiAction: async () => ({}), undoAccountAiAction: async () => ({}), setGlobalAiAction: async () => ({}) }));

const { AiSection } = await import("./ai-section");
const { AiCard, AiCardError } = await import("./ai-card");

beforeEach(() => {
  fx.agency = true; fx.reads = []; fx.fail = false; fx.prefsLanguage = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The fixture's monthKey is "2026-10": pin "now" inside that month so the spend line is this month's.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("AiSection (spec 3.6; plan deviations 14, 16)", () => {
  it("guards first: a non-agency caller is redirected before any read, never shown the error card (mutation: guard inside the try -> FAILS)", async () => {
    fx.agency = false;
    await expect(AiSection({ accountId: "a1" })).rejects.toThrow("NEXT_REDIRECT");
    expect(fx.reads).toEqual(["guard"]);
  });

  it("reads on the REQUEST client and hands the card its view and bound actions (mutation: read on serviceDb() -> FAILS)", async () => {
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(el) && el.type).toBe(AiCard);
    expect(fx.reads.filter((r) => r.includes(":"))).toEqual(["settings:request", "refusals:request", "overBudget:request"]);
    expect((el.props.view as { spendLine: string | null }).spendLine).toBe("$1.84 of $10.00 this month, estimated");
    expect(el.props.locale).toBe("en");
    expect([typeof el.props.save, typeof el.props.undo, typeof el.props.setGlobal]).toEqual(["function", "function", "function"]);
  });

  it("keys the card on the stored switch and budget, so a Save's or an Undo's refresh resets the form (review I8; mutation: drop the key -> FAILS)", async () => {
    const first = (await AiSection({ accountId: "a1" })) as ReactElement;
    expect(first.key).toBe("true:10");
    fx.settings = { ...fx.settings, accountEnabled: false, monthlyBudgetCents: 2500 };
    const after = (await AiSection({ accountId: "a1" })) as ReactElement;
    expect(after.key).toBe("false:25");
    fx.settings = { ...fx.settings, accountEnabled: true, monthlyBudgetCents: 1000 };
  });

  it("speaks the reader's own language (mutation: drop userLanguage from requestLocale -> FAILS)", async () => {
    fx.prefsLanguage = "es";
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(el.props.locale).toBe("es");
    expect((el.props.view as { spendLine: string | null }).spendLine).toBe("$1.84 de $10.00 este mes, estimado");
  });

  it("a failed read is the card's own error, logged with the account (mutation: rethrow -> FAILS)", async () => {
    fx.fail = true;
    const el = (await AiSection({ accountId: "a1" })) as ReactElement<Record<string, unknown>>;
    expect(isValidElement(el) && el.type).toBe(AiCardError);
    expect(String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe("settings: AI card unavailable for account a1: Error: read failed");
  });
});
```

(`now` is pinned to 2026-10-18 with fake `Date` only, so the fixture's October spend is "this month" on any day the suite runs; timers and promises stay real.)

`page.test.ts`: beside `:110` add

```ts
const aiSection = vi.hoisted(() => ({ AiSection: () => null, AiCardSkeleton: () => null }));
vi.mock("./ai-section", () => aiSection);
```

and after the Billing describe (`:213`):

```ts
describe("settings page — the AI card", () => {
  it("mounts AiSection for THIS account in its own Suspense (skeleton fallback), directly after the Billing card's boundary (mutation: drop the mount, or render it outside Suspense -> FAILS)", async () => {
    const all = await pageElements();
    const boundary = boundaryAround(all, aiSection.AiSection);
    expect(boundary, "AiSection inside <Suspense>").toBeTruthy();
    expect(((boundary!.props.children as ReactElement).props as { accountId: string }).accountId).toBe("a1");
    const fallback = boundary!.props.fallback;
    expect(isValidElement(fallback) && fallback.type).toBe(aiSection.AiCardSkeleton);
    const column = all.find((e) => Array.isArray(e.props.children) && (e.props.children as unknown[]).includes(boundary));
    const siblings = (column!.props.children as unknown[]).filter((c) => isValidElement(c));
    expect(siblings[siblings.indexOf(boundary!) - 1]).toBe(boundaryAround(all, BillingSection));
  });
});
```

`registry.test.ts`: in the anchor-parity case's `cardFiles` (`:235-245`), add `"../../app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx",` after `billing-card.tsx` (without it, that case FAILS on `id="ai"` once the palette entry exists: run it that way first and paste the line). Then, after `:127`:

```ts
  it("registers the AI settings section, agency only, found by 'budget' and 'ia' (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)", () => {
    const entries = buildPaletteEntries(BASE, true, false);
    const entry = entries.find((e) => e.id === "settings:ai");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#ai`);
    expect(entry?.agencyOnly).toBe(true);
    expect(filterEntries(entries, "budget").some((e) => e.id === "settings:ai")).toBe(true);
    expect(filterEntries(entries, "presupuesto").some((e) => e.id === "settings:ai")).toBe(true);
    expect(buildPaletteEntries(BASE, false, true).some((e) => e.id === "settings:ai")).toBe(false);
  });
```

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card-handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.test.ts" src/lib/palette/registry.test.ts`. Expected: the three new files fail to load; the page case FAILS ("AiSection inside <Suspense>: expected undefined to be truthy"); the palette case FAILS (`expected undefined to be 'https://…/settings#ai'`). Paste each.

- [ ] **Step 4: Write** `…/settings/ai-card-handlers.ts`:

```ts
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { AiGlobalResult, AiPrior, AiSaveResult } from "./ai-actions";

/**
 * What Save and the global switch do on the AI card (spec 3.6; rule 6: at once, the toast carrying an Undo).
 * A refusal says its key's words; a thrown action (a stale tab after a redeploy) says the card's own crash
 * sentence (never common.actionCrashed, whose Spanish is in tu). The global Undo after turning AI ON turns it
 * off again with the reader's own word, which the server re-checks.
 */
type Toast = {
  success(text: string, opts?: { action: { label: string; onClick: () => void } }): unknown;
  error(text: string): unknown;
};
export function aiCardHandlers(d: {
  locale: Locale; toast: Toast; refresh: () => void;
  save: (input: { enabled: boolean; budget: string }) => Promise<AiSaveResult>;
  undo: (prior: AiPrior) => Promise<AiSaveResult>;
  setGlobal: (input: { enabled: boolean; confirm?: string }) => Promise<AiGlobalResult>;
}): { save(input: { enabled: boolean; budget: string }): Promise<boolean>; setGlobal(enabled: boolean, confirm?: string): Promise<boolean> } {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, d.locale, params);
  const word = tt("aiSettings.global.confirmWord");
  const crashed = { ok: false as const, error: "aiSettings.crashed" as const };
  const say = (error: MessageKey) => d.toast.error(tt(error, error === "aiSettings.global.wrongWord" ? { word } : undefined));

  return {
    async save(input) {
      const r = await d.save(input).catch(() => crashed);
      if (!r.ok) { say(r.error); return false; }
      d.refresh();
      d.toast.success(tt("aiSettings.saved"), { action: { label: tt("common.undo"), onClick: () => {
        void d.undo(r.prior).catch(() => crashed).then((u) => {
          if (!u.ok) { say(u.error); return; }
          d.refresh();
          d.toast.success(tt("aiSettings.undone"));
        });
      } } });
      return true;
    },
    async setGlobal(enabled, confirm) {
      const r = await d.setGlobal({ enabled, confirm }).catch(() => crashed);
      if (!r.ok) { say(r.error); return false; }
      d.refresh();
      d.toast.success(tt(enabled ? "aiSettings.global.turnedOn" : "aiSettings.global.turnedOff"), { action: { label: tt("common.undo"), onClick: () => {
        void d.setGlobal({ enabled: r.prior, confirm: r.prior ? undefined : word }).catch(() => crashed).then((u) => {
          if (!u.ok) { say(u.error); return; }
          d.refresh();
        });
      } } });
      return true;
    },
  };
}
```

`…/settings/ai-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiCardView } from "@/lib/ai/settings-view";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { AiGlobalResult, AiPrior, AiSaveResult } from "./ai-actions";
import { aiCardHandlers } from "./ai-card-handlers";

/**
 * The agency's AI card (item 8a-1, spec 3.6). Its own view (rule 8): one primary Save for this account's switch
 * and budget; the global switch is an outline button whose OFF direction confirms by typing the word (rule 6),
 * and whose ON direction is immediate with Undo. Rendered only on Settings, which is agency-only; every action
 * re-checks that itself. In the reader's own language, with `lang` on the card (the page around it is English).
 */
const control = "min-h-11 md:min-h-8";

export function confirmMatches(typed: string, word: string): boolean {
  return typed.trim().toUpperCase() === word;
}

export function AiCard({ view, locale, save, undo, setGlobal }: {
  view: AiCardView; locale: Locale;
  save: (input: { enabled: boolean; budget: string }) => Promise<AiSaveResult>;
  undo: (prior: AiPrior) => Promise<AiSaveResult>;
  setGlobal: (input: { enabled: boolean; confirm?: string }) => Promise<AiGlobalResult>;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const router = useRouter();
  const [enabled, setEnabled] = useState(view.accountEnabled);
  const [budget, setBudget] = useState(view.budgetDollars);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const h = aiCardHandlers({ locale, toast, refresh: () => router.refresh(), save, undo, setGlobal });
  const word = tt("aiSettings.global.confirmWord");
  const close = () => { setConfirming(false); setTyped(""); };

  return (
    <Card id="ai" data-ai-card lang={locale} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{tt("aiSettings.title")}</CardTitle>
        <CardDescription>{tt("aiSettings.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.spendLine
          ? <p data-ai-spend className="text-sm tabular-nums">{view.spendLine}</p>
          : <p data-ai-empty className="text-sm text-muted-foreground">{tt("aiSettings.empty")}</p>}
        {view.reachedLine ? <Notice tone="warn" data-ai-reached className="text-foreground">{view.reachedLine}</Notice> : null}
        {view.skippedLine ? <p data-ai-skipped className="text-xs text-muted-foreground tabular-nums">{view.skippedLine}</p> : null}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); setBusy(true); void h.save({ enabled, budget }).finally(() => setBusy(false)); }}
        >
          <label className={`flex items-center gap-2 text-sm ${control}`}>
            <Checkbox data-ai-account checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <span>{tt("aiSettings.account.label")}</span>
          </label>
          <p className="text-xs text-muted-foreground">{tt("aiSettings.account.help")}</p>
          <Label htmlFor="ai-budget">{tt("aiSettings.budget.label")}</Label>
          <Input id="ai-budget" data-ai-budget inputMode="numeric" autoComplete="off" value={budget}
            onChange={(e) => setBudget(e.target.value)} className={`max-w-40 tabular-nums ${control}`} />
          <p className="text-xs text-muted-foreground">{tt("aiSettings.budget.help")}</p>
          <div>
            <Button type="submit" data-ai-save disabled={busy} className={control}>{tt("aiSettings.save")}</Button>
          </div>
        </form>
        <div data-ai-global className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
          <p className="text-sm font-medium">{tt("aiSettings.global.label")}</p>
          <p className="text-xs text-muted-foreground">{tt(view.globalEnabled ? "aiSettings.global.onHelp" : "aiSettings.global.offHelp")}</p>
          <div>
            {view.globalEnabled
              ? <Button type="button" variant="outline" data-ai-global-off className={control} onClick={() => setConfirming(true)}>{tt("aiSettings.global.turnOff")}</Button>
              : <Button type="button" variant="outline" data-ai-global-on className={control} onClick={() => { void h.setGlobal(true); }}>{tt("aiSettings.global.turnOn")}</Button>}
          </div>
        </div>
        <Dialog open={confirming} onOpenChange={(open) => { if (!open) close(); }}>
          <DialogContent data-ai-confirm lang={locale}>
            <DialogHeader><DialogTitle>{tt("aiSettings.global.confirmTitle")}</DialogTitle></DialogHeader>
            <AiGlobalConfirmForm word={word} typed={typed} busy={busy} locale={locale} onTyped={setTyped} onCancel={close}
              onConfirm={() => { setBusy(true); void h.setGlobal(false, typed).then((done) => { if (done) close(); }).finally(() => setBusy(false)); }} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Presentational, so the test reads it without a portal (document-purge-dialog.tsx's shape). The dialog's one primary is its destructive confirm. */
export function AiGlobalConfirmForm({ word, typed, busy, locale, onTyped, onCancel, onConfirm }: {
  word: string; typed: string; busy: boolean; locale: Locale; onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tt("aiSettings.global.confirmBody", { word })}</p>
      <label className="block space-y-1 text-sm">
        <span>{tt("aiSettings.global.confirmLabel")}</span>
        <Input data-ai-confirm-input value={typed} autoComplete="off" spellCheck={false} onChange={(e) => onTyped(e.target.value)} className={control} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className={control} onClick={onCancel}>{tt("aiSettings.global.cancel")}</Button>
        <Button type="button" variant="destructive" data-ai-confirm-off className={control} disabled={!confirmMatches(typed, word) || busy} onClick={onConfirm}>
          {tt("aiSettings.global.turnOff")}
        </Button>
      </div>
    </div>
  );
}

/** Rule 7: shaped like the card, never a spinner. Keeps the palette's anchor. */
export function AiCardSkeleton() {
  return (
    <Card id="ai" className="scroll-mt-24" aria-busy="true">
      <CardHeader><Skeleton className="h-5 w-16" /><Skeleton className="h-4 w-64 max-w-full" /></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-24" />
      </CardContent>
    </Card>
  );
}

export function AiCardError({ locale }: { locale: Locale }) {
  return (
    <Card id="ai" data-ai-error lang={locale} className="scroll-mt-24">
      <CardHeader><CardTitle>{t(m, "aiSettings.title", locale)}</CardTitle></CardHeader>
      <CardContent><Notice tone="warn" className="text-foreground">{t(m, "aiSettings.loadError", locale)}</Notice></CardContent>
    </Card>
  );
}
```

(`AiCardSkeleton` has no `aria-label` with copy: a label would need the reader's locale, which the page's `<Suspense>` fallback does not have; `aria-busy` is the state. If the a11y review asks for a name, the orchestrator decides.)

`…/settings/ai-section.tsx`:

```tsx
import { countAiSkipsSince, firstOverBudgetSince, getAiSettings } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { aiCardView, type AiCardView } from "@/lib/ai/settings-view";
import { monthStartInZone, safeZone } from "@/lib/billing/billing-view";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale } from "@/lib/i18n/request-locale";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { saveAccountAiAction, setGlobalAiAction, undoAccountAiAction } from "./ai-actions";
import { AiCard, AiCardError } from "./ai-card";

export { AiCardSkeleton } from "./ai-card";

/**
 * Loads the AI card (spec 3.6). Runs INSIDE Settings, after its requireAgencyOnlyAccountAccess, and guards
 * again itself, OUTSIDE the try, so a redirect is never caught into the error card (billing-section.tsx's
 * reason). Reads on the agency's REQUEST client: 0086 lets the agency alone read the three tables (plan
 * deviation 14). Fails soft: an AI read failure never takes Settings offline.
 */
export async function AiSection({ accountId }: { accountId: string }) {
  await requireAgencyOnlyAccountAccess(accountId);
  let locale: Locale = "en";
  let view: AiCardView;
  try {
    const db = await dbForRequest();
    const [prefs, account] = await Promise.all([
      getPersonPrefs(),
      db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle().then(({ data, error }) => {
        if (error) throw new Error(`ai card: account read failed: ${error.message}`);
        if (!data) throw new Error("ai card: account not found");
        return data as { timezone: string | null; language: string | null };
      }),
    ]);
    const language = account.language === "en" || account.language === "es" ? account.language : null;
    // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces (branding/page.tsx:114-115).
    const accountLanguage = { language };
    locale = requestLocale({ account: accountLanguage, isOperator: true, userLanguage: prefs.language });
    const zone = safeZone(account.timezone);
    const now = new Date();
    const since = monthStartInZone(now, zone).toISOString();
    const [settings, refusals, overBudgetAt] = await Promise.all([
      getAiSettings(db, accountId), countAiSkipsSince(db, accountId, since), firstOverBudgetSince(db, accountId, since),
    ]);
    view = aiCardView({ settings, refusals, overBudgetAt, now, zone, locale });
  } catch (e) {
    console.error(`settings: AI card unavailable for account ${accountId}: ${loggableError(e)}`);
    return <AiCardError locale={locale} />;
  }
  // accountId is bound here, server-side. It never travels as a form field.
  // Keyed on the STORED switch and budget (review I8): after a Save or its Undo, router.refresh() re-renders this
  // section with the new stored values, the key changes, and the form's local state starts again from them, so an
  // Undo visibly puts the checkbox and the field back.
  return (
    <AiCard
      key={`${view.accountEnabled}:${view.budgetDollars}`}
      view={view}
      locale={locale}
      save={saveAccountAiAction.bind(null, accountId)}
      undo={undoAccountAiAction.bind(null, accountId)}
      setGlobal={setGlobalAiAction.bind(null, accountId)}
    />
  );
}
```

(If `getPersonPrefs`'s `language` is typed wider than `Locale | null`, narrow it the way `branding/page.tsx:115-116` does.)

`…/settings/page.tsx`: import `import { AiSection, AiCardSkeleton } from "./ai-section";` beside `:25`, and after the Billing boundary's `</Suspense>` (`:209`):

```tsx
        {/* Item 8a-1: the agency's AI card, its own boundary, after Billing (both are about what this account costs). */}
        <Suspense fallback={<AiCardSkeleton />}>
          <AiSection accountId={accountId} />
        </Suspense>
```

`apps/web/src/lib/palette/registry.ts`, after `:50`:

```ts
  // Item 8a-1: the agency's AI card (settings/ai-card.tsx, #ai).
  { anchor: "ai", label: m["palette.settings.ai"], keywords: ["ai", "budget", "spend", "switch", "summaries", "suggestions", "ia", "presupuesto"] },
```

- [ ] **Step 5: Run green.** The Step 3 command → all PASS (paste the summary). Also `src/lib/ai/client-boundary.test.ts` (the card's `import type` from `lib/ai` is allowed; a value import would fail it), `src/lib/i18n/request-locale-callers.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` (no new line needed for `ai-section.tsx`: it never names `serviceDb`), `src/lib/i18n/ratchet.test.ts` (no JSX literal copy) → PASS. `pnpm --filter web typecheck` → exit 0. `pnpm --filter web exec eslint` on the six new files, `page.tsx` and `registry.ts` → clean.

- [ ] **Step 6: Probes, by name:** (a) the global button `variant="default"` → "exactly one primary button" FAILS; (b) `disabled={busy}` only on the confirm → "stays disabled until the word matches" FAILS; (c) `confirmMatches` without `.toUpperCase()` → the confirmMatches case FAILS; (d) move `await requireAgencyOnlyAccountAccess` inside the try → "guards first" FAILS (the redirect becomes the error card); (e) `requestLocale({ … })` without `userLanguage` → "speaks the reader's own language" FAILS (and `request-locale-callers.test.ts` too); (f) `common.actionCrashed` for `crashed` → the crash-sentence case FAILS; (g) the Undo calling `d.undo(input as never)` → "offers an Undo that writes back the prior values" FAILS; (h) mount `<AiSection>` without `<Suspense>` → the page case FAILS; (i) remove the palette entry → the registry case FAILS. Paste each line.

- [ ] **Step 7: Design check (DESIGN.md definition of done).** Tokens only (`grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(|shadow-\[" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.tsx"` → nothing); dark and light (`.dark` class) by eye on `pnpm --filter web dev` is the orchestrator's, in Task 13 step 7; renders at 360 px with a Spanish reader (the card passes no `searchParams` to `requestLocale`, so the `?locale=pseudo` QA override does not reach it; review M8: the +35% check is made with the Spanish copy, the longest real one) — note in the report that it was not run by you.

- [ ] **Step 8: Commit** `git add -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card-handlers.test.ts"` then `git commit -m "settings: the agency's AI card: this month's spend in words, the account's switch and budget with Undo, AI for every account behind a typed word; ⌘K finds it (item 8a-1)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-section.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/ai-card-handlers.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.test.ts" apps/web/src/lib/palette/registry.ts apps/web/src/lib/palette/registry.test.ts`.

---

## Task 9: Env contract: `.env.example`, CI's e2e env, Playwright's env (bis-platform; `.env.example` landed by the orchestrator)

**Review:** sonnet. **Runs beside:** Tasks 5, 6, 7.

**Files**
- Create: `apps/web/src/lib/ai/env-contract.test.ts`
- Modify: `.github/workflows/ci.yml` (the e2e job's `env:`, after `BIS_I18N_QA: "1"` at `:350`), `apps/web/ci/ci-workflow.test.ts` (one case after `:259-263`), `apps/web/playwright.config.ts` (the app webServer's `env`, after `BIS_I18N_QA: "1",` at `:256`)
- Modify (ORCHESTRATOR, not the agent: working rule 7 keeps every `.env*` edit off agents; the hot-files list names bis-platform or the orchestrator as the one who lands `.env.example`): `.env.example` after `VOICE_OPENAI_PROJECT_ID=` (`:91`)

- [ ] **Step 1: Read** `.env.example:70-100`, `.github/workflows/ci.yml:300-352`, `apps/web/ci/ci-workflow.test.ts:140-200`, `:259-280`, `apps/web/playwright.config.ts:240-262`, `apps/web/src/lib/i18n/request-locale.test.ts` (its "BIS_I18N_QA never reaches a Vercel deployment" block, the precedent this test copies).

- [ ] **Step 2: Write the failing tests.** `apps/web/src/lib/ai/env-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Spec 6: two optional names, documented; the fake never configured for a Vercel deployment; Playwright's app uses it. */
const ROOT = join(__dirname, "../../../../..");   // apps/web/src/lib/ai -> the repo root
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the AI gateway's env contract (spec 6)", () => {
  it(".env.example names AI_PROVIDER and AI_GATEWAY_OFF, each under its own comment (mutation: drop either line -> FAILS)", () => {
    const lines = read(".env.example").split(/\r?\n/);
    for (const name of ["AI_PROVIDER", "AI_GATEWAY_OFF"]) {
      const at = lines.findIndex((l) => l === `${name}=`);
      expect([name, at > 0]).toEqual([name, true]);
      expect([name, lines[at - 1]!.startsWith("#")]).toEqual([name, true]);
    }
  });

  it("apps/web's Vercel config and Next config never set AI_PROVIDER (spec 6; the Root Directory is apps/web, so these two are the deployment's; mutation: add it to apps/web/vercel.json -> FAILS)", () => {
    for (const p of ["apps/web/vercel.json", "apps/web/next.config.ts"]) expect([p, read(p).includes("AI_PROVIDER")]).toEqual([p, false]);
  });

  it("Playwright's app runs on the fake, so no e2e run makes a real model call (spec 8.1; mutation: drop the line -> FAILS)", () => {
    expect(read("apps/web/playwright.config.ts")).toMatch(/^\s+AI_PROVIDER: "fake",$/m);
  });
});
```

In `apps/web/ci/ci-workflow.test.ts`, after the Stripe case at `:263`:

```ts
  it("gives the e2e job — and only it — the AI gateway's fake provider as a literal (item 8a-1, spec 6; mutation: drop it, or move it to the top-level env -> FAILS)", () => {
    expect(jobEnv(job("e2e")).AI_PROVIDER).toBe("fake");
    expect(jobEnv(job("verify")).AI_PROVIDER).toBeUndefined();
    expect(ciEnv.AI_PROVIDER).toBeUndefined();
  });
```

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/ai/env-contract.test.ts ci/ci-workflow.test.ts` → the `.env.example` case, the Playwright case and the ci case FAIL; the Vercel case PASSES now (nothing sets it): run its mutation (add `"AI_PROVIDER": "fake"` to `apps/web/vercel.json`'s top level by hand, see it FAIL, edit it back, `cmp`). Paste the lines.

- [ ] **Step 4: Write the config.** `ci.yml`, after `:350`:

```yaml
      # NOT a secret: the AI gateway's fake provider (apps/web/src/lib/ai/providers/fake.ts) for the app this
      # job builds, so no e2e run makes a real model call (item 8a-1, spec 6). The gateway IGNORES it when
      # VERCEL_ENV=production. OPENAI_API_KEY above stays for the web chat's own test, which the gateway does
      # not touch (spec 1).
      AI_PROVIDER: fake
```

`playwright.config.ts`, after `:256`:

```ts
        // Item 8a-1 (spec 6, 8.1): the AI gateway answers from its fake provider, so a local or CI e2e run
        // never makes a real model call. Ignored when VERCEL_ENV=production.
        AI_PROVIDER: "fake",
```

- [ ] **Step 5 (ORCHESTRATOR): `.env.example`**, after `VOICE_OPENAI_PROJECT_ID=` (`:91`):

```
# Optional, not sensitive — which AI provider the gateway uses (apps/web/src/lib/ai): "openai"
# (the default when unset) or "fake", which answers every completion locally with no network call
# (CI's e2e job and Playwright set it). IGNORED on Vercel Production, which always uses OpenAI.
# Set it on no Vercel environment.
AI_PROVIDER=
# Optional, not sensitive — "1" turns every AI completion off with no database read: the
# deploy-time brake for when the database itself is the problem. The everyday switches are on each
# account's Settings > AI card. Like every env change, it needs a redeploy to take effect.
AI_GATEWAY_OFF=
```

- [ ] **Step 6: Run green** (after Step 5). The Step 3 command → all PASS. `pnpm --filter web typecheck` → exit 0. Probes: (a) drop `AI_PROVIDER: fake` from ci.yml → the ci case FAILS; (b) drop the Playwright line → the Playwright case FAILS. Paste.
- [ ] **Step 7: Commit** (agent) `git add -- apps/web/src/lib/ai/env-contract.test.ts` then `git commit -m "ci: the e2e app and Playwright run the AI gateway's fake provider; the env contract is pinned (item 8a-1)" -- apps/web/src/lib/ai/env-contract.test.ts .github/workflows/ci.yml apps/web/ci/ci-workflow.test.ts apps/web/playwright.config.ts`; then (orchestrator) `git commit -m "env: AI_PROVIDER and AI_GATEWAY_OFF, both optional (item 8a-1)" -- .env.example`.

---

## Task 10: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet (or orchestrator-checked if byte-identical).

- [ ] **Step 1.** After Tasks 3 and 8 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the script `ratchet.test.ts:6` names). Expected: byte-identical, or ONLY reductions. If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed: `git commit -m "i18n: baselines after item 8a-1" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`.

---

## Task 11: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** never by the agent beyond `--list` (the orchestrator runs Playwright, after 0086 is on bis-ci for a local run; CI's own stack has it from the branch).

**Files**
- Create: `apps/web/e2e/ai-settings.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/weekly-report.spec.ts` whole (a Settings card on the fixture account, `loadEnv` lines, cleanup in `finally`), `apps/web/e2e/support.ts:100-135` (`readClientFixture`), `apps/web/e2e/booking.spec.ts:380-395` (the toast's Undo), `apps/web/e2e/billing.spec.ts:210-222` (an error toast), Task 8's `ai-card.tsx` (its markers) and Task 3's keys.

- [ ] **Step 2: Write the spec** `apps/web/e2e/ai-settings.spec.ts`:

```ts
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { readClientFixture } from "./support";
import { periodKeys } from "../src/lib/ai/period";
import { m, type MessageKey } from "../src/lib/messages";

// Same two paths, same reason, as weekly-report.spec.ts: the runner talks to Supabase directly for setup and cleanup.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ mode: "serial", timeout: 90_000 });

/**
 * Item 8a-1 (spec 3.6, 8.4): the agency's AI card on the PER-RUN fixture account only (never Test Client One).
 * The global switch is opened and CANCELLED, never confirmed: a local run shares bis-ci with Preview.
 * Words come from the catalogue in the card's own `lang`, never hard-coded.
 */
let accountId = "";
async function words(page: Page) {
  const lang = await page.locator("#ai").getAttribute("lang");
  return (key: MessageKey, params: Record<string, string | number> = {}) => {
    const raw = (lang === "es" ? (m as Record<string, string>)[`${key}.es`] : undefined) ?? m[key];
    return Object.entries(params).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), raw);
  };
}
async function settingsRow() {
  const { data, error } = await serviceDb().from("account_ai_settings").select("enabled, monthly_budget_cents").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`ai e2e: settings read failed: ${error.message}`);
  return data as { enabled: boolean; monthly_budget_cents: number } | null;
}
async function clean() {
  const db = serviceDb();
  for (const table of ["ai_ledger", "account_ai_settings"]) {
    const { error } = await db.from(table).delete().eq("account_id", accountId);
    if (error) throw new Error(`ai e2e cleanup: ${table} failed: ${error.message}`);
  }
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("No client fixture: the setup project creates it; run the full suite.");
  accountId = fixture.accountId;
  await clean();
  const db = serviceDb();
  const { data: acct, error } = await db.from("accounts").select("timezone").eq("id", accountId).single();
  if (error) throw new Error(`ai e2e: account read failed: ${error.message}`);
  const { monthKey, dayKey } = periodKeys(new Date(), (acct as { timezone: string | null }).timezone ?? "America/Chicago");
  const s = await db.from("account_ai_settings").insert({ account_id: accountId, month_key: monthKey, month_spend_microusd: 1_840_000, day_key: dayKey });
  if (s.error) throw new Error(`ai e2e: settings seed failed: ${s.error.message}`);
  const l = await db.from("ai_ledger").insert({ account_id: accountId, feature: "call_summary", model: "gpt-4o-mini", outcome: "account_off" });
  if (l.error) throw new Error(`ai e2e: ledger seed failed: ${l.error.message}`);
});

test.afterAll(async () => {
  if (!accountId) return;
  await clean();
  const db = serviceDb();
  for (const table of ["ai_ledger", "account_ai_settings"]) {
    const { count, error } = await db.from(table).select("account_id", { count: "exact", head: true }).eq("account_id", accountId);
    if (error || count !== 0) throw new Error(`ai e2e cleanup: ${table} still holds ${count} rows (${error?.message ?? "no error"})`);
  }
});

test("the AI card shows this month's spend and how often AI was skipped, read through the agency's own session", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  await expect(card).toBeVisible();
  const w = await words(page);
  await expect(card.locator("[data-ai-spend]")).toHaveText(w("aiSettings.spend", { spent: "$1.84", budget: "$10.00" }));
  await expect(card.locator("[data-ai-skipped]")).toHaveText(w("aiSettings.skippedOne"));
  await expect(card.locator("[data-ai-empty]")).toHaveCount(0);
});

test("switching AI off for this account saves at once, and Undo puts it back", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-account]").click();
  await card.locator("[data-ai-save]").click();
  const saved = page.locator("[data-sonner-toast]").filter({ hasText: w("aiSettings.saved") });
  await expect(saved).toBeVisible();
  await expect.poll(settingsRow).toEqual({ enabled: false, monthly_budget_cents: 1000 });
  await saved.getByRole("button", { name: w("common.undo") }).click();
  await expect.poll(settingsRow).toEqual({ enabled: true, monthly_budget_cents: 1000 });
});

test("a budget with cents is refused and nothing is written", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-budget]").fill("10.50");
  await card.locator("[data-ai-save]").click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: w("aiSettings.error.budget") })).toBeVisible();
  expect(await settingsRow()).toEqual({ enabled: true, monthly_budget_cents: 1000 });
});

test("turning AI off everywhere waits for the typed word; Cancel leaves it on", async ({ page }) => {
  await page.goto(`/dashboard/accounts/${accountId}/settings#ai`);
  const card = page.locator("#ai[data-ai-card]");
  const w = await words(page);
  await card.locator("[data-ai-global-off]").click();
  const dialog = page.locator("[data-ai-confirm]");
  await expect(dialog).toBeVisible();
  const confirm = dialog.locator("[data-ai-confirm-off]");
  await expect(confirm).toBeDisabled();
  const word = w("aiSettings.global.confirmWord");
  await dialog.locator("[data-ai-confirm-input]").fill(word.slice(0, -1));
  await expect(confirm).toBeDisabled();
  await dialog.locator("[data-ai-confirm-input]").fill(word.toLowerCase());
  await expect(confirm).toBeEnabled();
  await dialog.getByRole("button", { name: w("aiSettings.global.cancel") }).click();
  await expect(dialog).toHaveCount(0);
  const { data, error } = await serviceDb().from("ai_gateway_settings").select("enabled").eq("id", true).single();
  if (error) throw new Error(`ai e2e: global read failed: ${error.message}`);
  expect(data).toEqual({ enabled: true });
});
```

(The first test's `skippedOne` and the second's prior budget rely on `beforeAll`'s seed and on the tests running in order (`mode: "serial"`). If the card's Undo answers before the poll sees `false`, the poll still sees the final `true`; the `false` poll is what proves Save wrote.)

- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/ai-settings.spec.ts` lists the four tests (listing loads every import; if it fails, STOP and report). `pnpm --filter web typecheck` (covers `e2e/`). `pnpm --filter web exec eslint e2e/ai-settings.spec.ts`. Commit `git add -- apps/web/e2e/ai-settings.spec.ts` then `git commit -m "e2e: the agency's AI card on the fixture account: the spend line, the account's switch with Undo, a refused budget, the typed word for every account (item 8a-1)" -- apps/web/e2e/ai-settings.spec.ts`.

---

## Task 12: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–11.

- [ ] **Step 1.** Read spec §1, §2 (G2–G6), §3, §6, §8.1–§8.4 (8a-1 parts), §9, §10; this plan's deviations and assumptions; then `git diff 2cd68408...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 3–9 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `src/components/ui/material.test.ts`, `"src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` (UNCHANGED, must pass); `pnpm --filter web typecheck`. The db suites on your own replica (Postgres `55651`, PostgREST `55658`, gateway `55659`): `ai-gateway-schema.test.ts`, `schema-grants-guard.test.ts` on `post`; `ai-gateway.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. Re-run Task 1's byte check and md5 (must equal Task 1's).
- [ ] **Step 3.** Hunt specifically: (a) any path where a prompt, a transcript, an answer or a provider error MESSAGE reaches a log line, a ledger argument or an error the caller logs (grep every `console.` in `lib/ai`, `summary-service.ts`, `call-card.ts`, `generate.ts`); a `ref` built from text; (b) the gateway throwing, or answering `ok: true` on any refusal; a refusal that spends (a fetch after a closed gate); the fake reachable in production; (c) a caller whose refusal output differs from its old missing-key output (the fact line, `0`, `NO_READING`), or whose skip (spam, eligibility, `cardReadable`) now runs after the gateway; (d) 0086: ASCII, no backslash, no lone `$`, `lock_timeout` first, RLS on all three, the agency-only policies with `coalesce`, no client write grant, `service_role` the only executor of both functions, `search_path = ''` and schema-qualified names, the null guards, the older-period branch, the counters touched only by `ai_ledger_record` and never by the card's upsert, the rollback order; (e) an action whose first line is not `requireAgencyOnlyAccountAccess`, a write on the request client, an `accountId` from the browser, the global OFF without the typed word on the SERVER; (f) the card: one primary, `lang`, tokens only, the error card and skeleton, Undo in the toast, copy in tú, vendor words, an amount without its period; (g) `lib/` naming `serviceDb`; a `"use client"` file importing a value from `lib/ai`; (h) a test that cannot fail (memory "Vacuous test shapes"), especially a fallback test whose mock answers the expected output itself; (i) the e2e touching anything but the per-run fixture account, or confirming the global switch.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent. **0086 goes to bis-ci only when this review approves it UNCHANGED.**

---

## Task 13: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. Ledger.** Task 12's findings are closed and every change they named has landed and been reviewed.
- [ ] **Step 2. bis-ci** (only AFTER Task 12 approves 0086 unchanged): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/item8a-gateway-summary` → its log lists exactly `0086_ai_gateway.sql`; then `-f step=push`. Post-apply, read-only through MCP `execute_sql` on `odnobiodsftffphuuosz`: `select relname from pg_class where relname in ('ai_ledger','account_ai_settings','ai_gateway_settings') order by 1` → all three; `select id, enabled from ai_gateway_settings` → `(true, true)`; `select has_function_privilege('authenticated','public.ai_gate_check(uuid,text,text)','execute'), has_function_privilege('authenticated','public.ai_ledger_record(uuid,text,text,integer,integer,bigint,text,integer,text,text)','execute')` → `f, f`; the Faithfulness digest on bis-ci is UNCHANGED from Task 0 (0086 adds no client write). From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design (0086 not on bis-ci); after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). The e2e AI spec must have run (four tests). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → the 0085 apply; then `apply_migration` with 0086's exact text, ONCE (Task 1 step 6 proved no backslash and no lone `$`; the text's md5 equals Task 1's). Post-checks, read-only: the three relations; **`select id, enabled from ai_gateway_settings` → `(true, true)` (if it reads false or empty, every call summary in production becomes its fact line: STOP and fix before the merge)**; the two `has_function_privilege` reads → `f, f`. It goes BEFORE the merge (spec §10: migration before code; the gateway fails closed without it). Ledger line: `0086 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 4b. Runbook (review M10).** `docs/runbooks/ci-supabase-project.md` gains, in its migration-apply section, one line: "0086 seeds ONE row, `ai_gateway_settings (id true, enabled true)`. If it is ever missing on a project, every AI call there is off (the gate fails closed): recreate it with `insert into public.ai_gateway_settings (id, enabled) values (true, true);` through MCP `execute_sql`, then read it back." Commit `docs(runbooks): recreate the AI switch row (item 8a-1)` -- that file.
- [ ] **Step 5. Parity.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both projects; the three relations, their constraints and policies, both functions' ACL, `prosecdef`, `proconfig` and body, the grants, and the seeded row are equal; the client-write digest is equal on both.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Preview, by hand (owner and orchestrator together)**, on the branch's Preview (bis-ci), on a test account (never Test Client One): the AI card in both themes, at 360 px, with a Spanish reader (no pseudo-locale: the card does not take `?locale=`, review M8); "No AI use yet this month."; turn the account off, Save, Undo; a refused budget. The global switch is flipped ONLY with the owner watching, turned back on at once, and `select enabled from ai_gateway_settings` on bis-ci reads `true` afterwards.
- [ ] **Step 8. Merge** through the PR, after the head SHA's `verify` and `e2e` are green and Task 12's findings are closed: `gh pr merge <n> --squash --match-head-commit <sha>` (pinned to the reviewed head; read the PR state before any retry). The PR body names: the owner's I1–I14 acceptance; deviations 1–19; the pinned tests changed; "Not in this PR"; the Preview results; the 0086 apply lines; that `AI_PROVIDER`/`AI_GATEWAY_OFF` need no Vercel change.
- [ ] **Step 9. After the deploy** (spec §10, owed): the deployment reads READY on the merge SHA and is aliased to `app.bis-rgv.com`; smokes `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404; the merged work's marker: the owner, signed in, opens an account's Settings and the served HTML has an element matching `#ai[data-ai-card]` (review M9) (nothing public changed in 8a-1). **Owner smoke on the test account (memory "Smoke identities"; the agent never places a call):** one real call; then, read-only MCP on production, `select feature, model, input_tokens, output_tokens, cost_microusd, outcome, latency_ms from ai_ledger where account_id = '<test account id>' order by created_at desc limit 5` → one row per completion the call made (`call_summary`; `call_card` and `call_proposals` when the call qualified), outcome `ok`, NON-null tokens (assumption A4), and by construction no text; turn the account's AI off on Settings, call again → the call's summary is the fact line only and the new rows read `account_off`; turn it back on. **Then re-check the defaults before 8a-2 (choice I14):** from the real rows, the mean cost per completion against spec §3.4's 720 micro-dollars; report to the owner whether $10 a month and 200 a day stand, before 8a-2's plan is written. Tracker: item 8 row → "8a-1 (the AI gateway) shipped #<n>"; S-15 and F-020 stay open until 8a-2.

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 8a-1 row: one server-only library; the ledger; a default monthly budget; a global and a per-account switch; the agency-only AI card; summary, proposals and the call card's reading moved onto it; 0086 | Tasks 1, 2, 4, 5, 6, 7, 8 |
| §1 "Not in 8a": no tiers, no second provider, no chat/Realtime on the gateway, no record summary | "Not in this PR" |
| G2 one door, one provider | Task 4 (`aiComplete`, `openAiProvider`), Tasks 5, 6 |
| G3 the ledger, never the prompt or the output | Task 1 (pinned columns, 64-character `model`), Task 4 (sentinel probes), Tasks 5, 6 (caller probes); deviation 6, 11 |
| G4 / §3.4 $10 a month default | Task 1 (`default 1000`), Task 2 (`DEFAULT_MONTHLY_BUDGET_CENTS`), Task 13 step 9 (re-read) |
| G5 global and per-account switches, agency only, on Settings | Task 1 (tables, RLS), Task 7 (actions), Task 8 (card) |
| G6 fallback, never an error; clients never see a meter | Tasks 5, 6 (`AI_REFUSALS` rows), Task 1 (agency-only reads) |
| §3.1 location, `aiComplete(input)`, the feature union, never throws, the reasons, the callers' order kept | Task 4; deviation 3 (the client argument), 7 (`no_key`); Tasks 5, 6 (skips first) |
| §3.1 order: env brake, priced model, gate RPC failing closed, switches then budget, provider with timeout, ledger RPC whose failure keeps the text | Task 4 (code and the `aiComplete` cases); deviation 5 (3 s bounds) |
| §3.1 refusals write a row; the env brake does not | Task 4 ("AI_GATEWAY_OFF=1 …", the `it.each` rows) |
| §3.1 what the library logs | Task 4 (deviations 8, 9; the log-line cases) |
| §3.1 overshoot bounded and stated | `gateway.ts` doc comment |
| §3.2 the three callers; `ok: false` → fact line / 0 / no reading; `fetchImpl` passes through | Tasks 5, 6 |
| §3.3 `ai_ledger`, `account_ai_settings`, `ai_gateway_settings`, the two RPCs, RLS and grants, teardown, the rollback note | Task 1; deviations 1, 2, 12, 13 |
| §3.5 the price table, rounding up, the character estimate, unknown models refused | Task 4 (`prices.ts` and its cases) |
| §3.6 the card: switch, budget, spend in words with a period, the global switch behind a typed word, budget-reached sentence, loads/empties/fails, ⌘K, bilingual | Tasks 3, 7, 8; deviations 15, 16, 17 |
| §6 `AI_PROVIDER` (ignored in production), `AI_GATEWAY_OFF`, `.env.example`, e2e sets the fake | Task 4 (production case), Task 9 |
| §7 the drawer's read fence unchanged | Task 12 step 2 (`route.reads.test.ts` must pass unchanged) |
| §8.1 the fake provider | Task 4 (`fake.ts` and its cases) |
| §8.2 gateway tests: every refusal, timeout and non-ok, cost arithmetic, failed ledger write, the never-logs probe, no `"use client"` importer | Task 4 |
| §8.2 callers: every refusal's fallback; the skips make no gateway call | Tasks 5, 6 (fallback files) |
| §8.3 0086 on the replica: no client writes, client reads none, the agency reads, counters reset per key and count only `record_summary` ok, RPCs not executable by `authenticated`, column list pinned | Task 1 |
| §8.4 e2e (8a-1 part): the agency card's spend line and the account switch with Undo, on the fixture account, against the fake | Task 11 |
| §9 I1–I14 | "Owner rulings" table; I2–I6, I13 are 8a-2's |
| §10 0086 bis-ci → production → parity; migration before code; no Vercel change; the owner's production smoke | Task 13 |

## Owner questions

Answered 2026-10-18 (Q1–Q4 and M12, in the rulings table above). None open.

## Self-review notes (the writer's own pass, 2026-10-18)

- **Spec coverage:** every §3 bullet maps to a row above. Where the code made the spec's words impossible or ambiguous: deviations 1–19, each with the file:line or the run that decided it.
- **Placeholder scan:** no TBD/TODO. Every value a test pins was worked out in the plan (`720`, `36`, `27`, `10_000_000`) or read with node 24 here (Intl dates and money, `periodKeys`, the `SyntaxError` message). Three steps carry a read-then-confirm rule, each keeping the assertion's meaning fixed: A2 (`proconfig`'s rendering), Task 5 (d) (`modelReturning`'s encoding), Task 8's Radix `data-state`.
- **Type consistency:** `AiFeature`, `AiOutcome`, `AiGate`, `AiLedgerEntry`, `AiSettingsRead`, `aiGateCheck(db, { accountId, monthKey, dayKey, signal? })`, `recordAiLedger(db, entry & { signal? })`, `getAiSettings`, `countAiSkipsSince`, `firstOverBudgetSince`, `setAccountAiSettings(db, accountId, { enabled, monthlyBudgetCents, actorId })`, `setGlobalAiEnabled(db, { enabled, actorId })` (Task 2) → Tasks 4, 7, 8; `aiComplete(db, AiInput)`, `AiResult`, `AI_REFUSALS`, `openGateDb`, `gateRpc`, `periodKeys`, `aiSafeError` (Task 4) → Tasks 5, 6, 7, 11; `generateSummary(state, { db, accountId, timezone?, ref?, fetchImpl? })`, `readCallForCard(transcript, { db, accountId, timezone, fetchImpl?, label? })` (Task 5) → `finish-call.ts`; `aiCardView`, `AiCardView`, `parseBudgetDollars`, `isConfirmWord`, `saveAccountAiAction(accountId, { enabled, budget })`, `undoAccountAiAction(accountId, AiPrior)`, `setGlobalAiAction(accountId, { enabled, confirm? })` (Task 7) → Task 8; markers `#ai`, `data-ai-*` (Task 8) → Task 11; keys (Task 3) → Tasks 7, 8, 11.
- **Vacuity pass:** every prescribed test names its mutation; copy is asserted in both languages against literals; the fallback tests assert the CALLER's output (the fact line, `0` with no table touched, `NO_READING`) for a mocked refusal, never the mock's; the sentinel probes cover four provider paths and the callers' parse paths; the byte check has a positive control; the e2e scopes every locator to `#ai` or a `data-ai-*` marker and reads the database to prove each write.
- **Not executed:** nothing in this plan was run except the reads and the node one-liners named; every name was read off `c4c1f7e6` except where an Assumption says otherwise (A1–A5), each with its check.

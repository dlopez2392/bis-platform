# Inbound email, part 1 (S-06 part 1, migration 0082): customers' replies come back, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an account's **Replies** switch is on, every customer email carries `Reply-To: r-<token>@<reply domain>`; a customer's reply arrives through Resend's `email.received` event, is checked (the sender is the thread's customer or a member of one of their households or businesses, AND Resend's receiving MTA says it authenticated), and is either filed on the thread (unread raised, an emailed stop applied at once with Undo, a copy forwarded to the owner) or held in the inbox's **Needs a look** filter, where staff file it, choose another record, or mark it not a customer, each with Undo; the account's To do shows one row while anything waits.

**Architecture:** One migration, **0082**: `conversations.reply_token` / `reply_token_revoked_at`, `accounts.inbound_mode` / `inbound_domain` (agency-written, no grant), a server-written `inbound_emails` table (members read; 0068's Technician restriction through the conversation), `consent_events.method` gains `inbound_email`, `append_consent_event` lets a staff Undo lift an `inbound_email` stop (one line), and one service-only function `unfile_inbound_email`. The app adds a `@bis/db` module (`inbound-email.ts`), four pure modules (the reply address, the `Authentication-Results` reader, the new-text extractor, the email stop classifier), the received-email fetcher inside `lib/email` (the only place the `resend` package may be imported), one change point in the email gate for the Reply-To, an inbound pipeline the Resend webhook's new `email.received` branch calls, a forward to the owner as a new operator kind, a Replies row on Settings' Sending address card, a read-only line on Branding, inbound-email details on the thread's bubbles, the inbox's Needs a look view, and one To do row.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js (`from`, `rpc`); `resend` 6.18.1 (`emails.receiving.get`, verified in the installed type definitions, see "External facts"); `svix` (the existing webhook verify); Next.js 16 App Router (route handler, server actions, server components); React 19; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); sonner toasts; node `dns.promises.resolveMx`; the `@bis/db` suites on a local PG18 replica (plus a local PostgREST for `withTestAccount`) and CI `verify`; Playwright on the per-run fixture account.

**Spec:** `docs/superpowers/specs/2026-10-16-inbound-email-design.md` (approved 2026-10-16, with the spike result committed as `2ac6bced`). Runbook: `docs/runbooks/inbound-email.md` (`addd7096`). Base: branch `feat/s06-inbound-email` at `2ac6bced` (on `main` at `de3f3551`, #259; migrations through **0081** are on `main`; **0081 is applied on bis-ci and production: never re-apply**). Every file:line below was read off this worktree at `2ac6bced`; anything not read is labelled **ASSUMPTION**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s06-1` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s06-1`), branch `feat/s06-inbound-email`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\16ea02fa-4bbf-472b-babe-a260f83c4097\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad`); write it out literally in every command. `<KIT2C>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/24e55561-31fd-4769-a14a-4ebbd9d987a9/scratchpad/s07e-kit` (2c's kit; read 2026-10-16: `replica.sh`, `pgrst.sh` present). `…/acct/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/conv/` = `…/acct/conversations/`. `…/settings/` = `…/acct/settings/`.

## External facts and assumptions (read before any task)

**Verified in the installed package** (`resend@6.18.1`, the version `pnpm-lock.yaml:3239` pins; read from `node_modules/.pnpm/resend@6.18.1/node_modules/resend/dist/index.d.mts` in the sibling worktree `.claude/worktrees/agent-a5fbb7a908a932381`, because `<WT>` has no `node_modules` yet; Task 7 step 1 re-reads it in `<WT>` after `pnpm install`):
- `new Resend(key).emails.receiving.get(id: string, options?: { html_format?: 'data_uri' | 'cid' })` answers `{ data, error }` where `data` is `GetReceivingEmailResponseSuccess`: `{ object: 'email', id, to: string[], from: string, created_at, subject, bcc, cc, reply_to, received_for: string[], html: string | null, text: string | null, headers: Record<string, string> | null, message_id, raw?: { download_url: string; expires_at: string } | null, attachments: InboundAttachment[] }` (`index.d.mts:1453-1473`).
- The webhook event `email.received`'s `data` is `ReceivedEmailEventData`: `{ email_id, created_at, from, to: string[], bcc, cc, received_for: string[], message_id, subject, attachments }` (`index.d.mts:2180-2191`, `2271-2275`).
- **Consequence the spec does not state (gap G5):** `headers` is a `Record<string, string>`, so it cannot carry two `Authentication-Results` headers or their order. The spec's rule ("ONLY the topmost `Authentication-Results` whose authserv-id is `amazonses.com`") needs the raw header block. This plan reads it from `raw.download_url` and parses the header block itself; **no raw message → the auth reads as missing → held `unverified`** (fail closed).

**From the spec's recorded spike (2026-10-16), not re-verified:** the MX for `reply.bis-rgv.com` is `inbound-smtp.us-east-1.amazonaws.com` priority 10; a Gmail message carried, stamped by Resend's receiving MTA, `Authentication-Results: amazonses.com; spf=pass …; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;`, `X-SES-Spam-Verdict: PASS`, `X-SES-Virus-Verdict: PASS`.

**ASSUMPTIONS (each has a named check):**
- **A1** `raw.download_url` is a pre-signed URL a plain `fetch` (no `Authorization` header) can GET, answering the RFC 5322 message. Check: Task 16 step 8 (the first real reply on production; the ledger records whether it filed or held `unverified`). Until then route tests prove only the parser.
- **A2** Resend's receiving MTA PREPENDS its `Authentication-Results` and `X-SES-*` headers above any the sender wrote (the spike saw them; the order was not recorded). Check: Task 16 step 8 reads the raw headers of the first real reply in the Resend dashboard and records the order in the ledger.
- **A3** Every Resend inbound MX host is `inbound-smtp.<region>.amazonaws.com` (only `us-east-1` was seen). Check: Task 10's Check DNS matches `/^inbound-smtp\.[a-z0-9-]+\.amazonaws\.com\.?$/i`; a client in another region would read "No MX record pointing at Resend" and the orchestrator widens the pattern with evidence.
- **A4** Resend's `received_for` holds the envelope recipient(s) (the `r-<token>` address even when the customer's client rewrote `To`). Check: route tests use both fields; the pipeline tries `received_for` first, then `to`.
- **A5** The `email.received` event arrives on the EXISTING webhook with the same svix secret (spec "Settled"; runbook step 5). Check: Task 16 step 5.

## Spec gaps and contradictions (the plan's handling; listed, not silently resolved; the orchestrator confirms each with the owner in Task 0)

| # | What the spec says / omits | What the code says | This plan does |
|---|---|---|---|
| G1 | "Bad svix signature → 401" (Inbound step 1; Failure table) | The route answers **400** (`apps/web/src/app/api/webhooks/resend/route.ts`, "invalid signature", status 400) and `route.test.ts:37-44` pins 400 for every event | Keeps **400** (one route, one answer; Resend retries neither). If the owner wants 401, Task 8 changes the line and the existing test together. |
| G2 | "Undo appends a reversing staff event" | 0055's `append_consent_event` allows `resubscribed / staff_undo` ONLY over `revoked / staff` (`0055_consent_writes.sql:196-197`), so an Undo of an `inbound_email` stop would be **refused** | 0082 replaces the function with that one line widened to `in ('staff', 'inbound_email')`; Task 1 proves only that line changed. |
| G3 | (silent) | An Undo that writes `resubscribed` would ALSO lift an older customer stop (an unsubscribe link from last week) under it | The emailed stop is written with guard `if_allowed`: an address that is already stopped gets no new row and no notice, so its Undo can only ever return the address to where it was. |
| G4 | "Clear stop" vs "Unclear" over the texts' matcher, split undefined | `classifyInbound` (`lib/consent/inbound.ts:57-69`): a keyword is a stop, a phrase is a HOLD that asks staff | Clear = a stop KEYWORD (`matchKeyword`, `keywords.ts:46`) other than CANCEL/CANCELAR (`CANCEL_WORDS`, `:31`: a reply "Cancel" to a reminder means the appointment); Unclear = a phrase (`matchPhrase`) or CANCEL/CANCELAR. Tried on the whole new text, then on its first non-blank line (a phone's "Sent from my iPhone" signature would otherwise hide "STOP"). |
| G5 | "read ONLY the topmost `Authentication-Results`" | The received-email API's `headers` is a `Record` (above) | The raw message's header block (A1); none → `unverified`. |
| G6 | "An Owner sees the address their customers reply to, read-only" | Settings is agency-only (`…/settings/page.tsx:65`, `requireAgencyOnlyAccountAccess`) | The read-only line goes on the Owner's own **Branding** page under the reply-to field (`components/branding-panel.tsx:262-273`), in both audiences' panel copy. |
| G7 | "The Settings 'Sending address' card gains a Replies row" | That card already has ONE primary Save (`sending-address-card.tsx`, `SubmitButton`); a second Save would break DESIGN.md rule 8 | The mode change runs at once with an Undo toast (rule 6); Check DNS is ghost; the card keeps one primary. |
| G8 | "The work queue shows one row" | Two queues exist: the account's To do (`…/acct/tasks/page.tsx`) and the agency's cross-account `/dashboard/work` | The account's To do only. The agency queue is listed in "Not in this PR". |
| G9 | (silent) on Resume | `resubscribed / staff` is allowed only over `staff`, `free_text`, `backfill_0049` (`0055:194-195`); `EMAIL_RESUMABLE_METHODS` (`email-view.ts:29`) | An `inbound_email` stop is lifted by its Undo or by the customer's own resubscribe; the Email row says "they asked in a reply" with no Resume. |
| G10 | (silent) the Reply-To when the token cannot be made | — | The gate logs and sends with the caller's own `replyTo` (the account's `reply_to_email`); it never blocks a customer email over a Reply-To. |
| G11 | (silent) an HTML-only email | `text` may be `null` | The new text is derived from `html` (tags dropped, five entities decoded) before quote stripping. |
| G12 | "12 random bytes, url-safe, lowercase" | — | 24 lowercase hex characters (`randomBytes(12).toString("hex")`); a CHECK pins `^[0-9a-f]{24}$`. |
| G13 | `inbound_emails` columns | `conversations` has no `(account_id, id)` key to reference | 0082 adds `conversations_account_id_id_key unique (account_id, id)` so the conversation FK carries the account (tenant-safe), and `unfile_inbound_email` (the Undo of a manual file, one transaction). |
| G14 | "All copy in English and Spanish" | The inbox (`…/conv/page.tsx`), To do (`…/acct/tasks/page.tsx`) and Settings render English `m[...]` today | Every new key has its `.es` twin (Task 2). The inbox and To do pages resolve the reader's locale (`requestLocale`, as the record page does, `[contactId]/page.tsx:122-124`) for the NEW strings; Settings stays English like its neighbours. |
| G15 | "dkim=pass with header.i/header.d on the From domain" | — | Exact match of the domain (lowercase), not "a subdomain of": the strict reading. |

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. To undo your own edit, edit it back; to see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. Commit with `git commit -m "…" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push, never touch `main` (the orchestrator pushes).
- **The migration is written and proven by Task 1 and APPLIED only by the orchestrator, once: bis-ci first (`ci-project-setup.yml`), then production (MCP `apply_migration`), then the parity check (Task 16).** No other task applies anything anywhere.
- **No `@bis/db` vitest runs against bis-ci until Task 16 step 2 has applied 0082 there** (0082 adds a table, and the suites' globalSetup sweep reads every table). `@bis/db` suites run only on the replica kit below, or in CI `verify` (its own Supabase stack). In `packages/db`, run vitest as `node node_modules/vitest/vitest.mjs run <files>`; capture the exit code to a file with nothing after the command and judge by vitest's summary block (the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies).
- **Agents run only the affected tests, by path:** `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright runs: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/acct/` to vitest (it holds a live test).
- **Never production Supabase (`tlbkbmlrfafquucsmsmm`), never a production credential anywhere, never create or edit `.env*`, never set a Vercel secret.** `RESEND_API_KEY` already exists in the env contract (`.env.example`; the email factory reads it, `lib/email/index.ts`); no new variable. **No test calls Resend or DNS: the fetcher and the MX lookup are injected.**
- **0053, server-only writes.** `authenticated` gets SELECT on `inbound_emails` and nothing else; no grant on `accounts.inbound_mode` / `inbound_domain` or on the two `conversations` columns (0015's rule: agency-only columns take no grant). Every new action file that touches `serviceDb` is added to `…/acct/in-account-service-reads.test.ts`'s `ALLOWED` with its reason. **No new file under `apps/web/src/lib` contains the token `serviceDb`, not even in a comment** (that test's ROOTS include `lib`): lib functions take the caller's client as a parameter; the route and the actions pass `serviceDb()`.
- **The resend package and Resend's host.** `scans.test.ts` ("scan 1 (email)", `:723-756`): only `lib/email/resend.ts` imports `resend`, nothing names `api.resend.com`, and only `PROVIDER_MODULES` may import `lib/email`'s provider modules. The received-email fetch lives in `resend.ts`, is re-exported by ONE new module `lib/email/receiving.ts`, and that module joins `PROVIDER_MODULES` (Task 7, the only scan edit).
- **The ledger.** Only `packages/db/src/consent.ts` names `consent_events` (scan 3); web code writes through `appendConsentEventGuarded` only. The emailed stop uses guard `"if_allowed"` and `sourceRef = "inbound_email:<provider email id>"` (idempotent on Resend's retry: 0055 answers `duplicate`). A ledger write failure answers **503** (Resend retries), the SMS rule.
- **Tokens never in a log line.** A drop is logged with its reason and, when known, the account id; never the token, never an address, never a subject or body.
- **SQL rules.** 0082 is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; Task 1 step 6 checks with a positive control): regexes use `[.]`, never `\.`. `set local lock_timeout = '5s';` before the first statement. Every boolean from a nullable is `coalesce(…, false)` (memory "plpgsql NULL guard"). A Supabase `head: true` count throws on `count === null` (memory "head-count null").
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches it: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A `"use server"` module is never imported into vitest without a `vi.mock` for it.
- **DESIGN.md definition of done for every UI task (10, 11, 12):** tokens only (radii `rounded-[var(--radius-ctl)]` / `rounded-[var(--radius-card)]`, pills `rounded-full`; no hex, no literal shadow); both themes through the `.dark` class; the blur fallback; **rule 3: every status is a dot AND a word** (a held reason: a `--warn` dot plus "Not on this customer's record" / "Couldn't confirm who sent it"; the Replies state: a `--good` dot plus "BIS address" / "Own domain", a `--text-3` dot plus "Off"); rule 5 (Needs a look has loaded, empty and error states; the count failing never blanks the inbox); rule 6 (File, Not a customer, the Replies change and the stop's Undo run at once with Undo in the toast; nothing asks "Are you sure?"); rule 7 (skeleton rows shaped like held items, no spinner); rule 8 (each held item is one view with ONE primary, "File on <customer>"; the Sending address card keeps its one primary Save; the thread notice's buttons are ghost); controls `min-h-11 md:min-h-8`; nothing animates on scroll; the module contract (the new UI arrives through existing surfaces: one filter on the inbox list, one row in To do, one row in an existing Settings card).
- **Copy.** Plain words a business owner reads at 7 AM; no "token", "MX" outside the agency's Settings card, "DKIM", "DMARC", "SES", "webhook", "Resend" in any client-facing string. Every key is added by **Task 2 only**, an English line followed directly by its `.es` line, Spanish in **usted**. New `.tsx` code carries no JSX literal copy with a letter in it (`lib/i18n/ratchet.test.ts`). Every copy assertion goes through `renderedText()` (`apps/web/src/lib/rendered-text.ts`) and asserts BOTH languages against literal strings, never against `t()`'s output (it falls back to English silently).
- **Every test must be able to fail.** Each test names the mutation that breaks it; the implementer runs the probe, sees the test fail BY NAME, pastes the failing assertion line, and edits back (memory "Vacuous test shapes": no `toBeTruthy` on content, no mock that satisfies itself, no assertion on a value the fixture already held, no `-t` filter that matches nothing; check the run count in vitest's summary).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103`), never `Test Client One`; every seeded row is deleted in `afterAll`, each error checked, then re-read to confirm none is left.

## Ownership (no task edits a file its owner does not own)

- **bis-db-schema:** `packages/db/supabase/migrations/0082_inbound_email.sql` (new), `packages/db/src/test/inbound-email-schema.test.ts` (new), `<SCRATCH>/s06-kit/*` (Task 1).
- **bis-comms:** `apps/web/src/lib/messages.ts` + one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/{inbound-email,messaging,consent,index}.ts` and `packages/db/src/test/inbound-email.test.ts` (Task 3); `apps/web/src/lib/email/inbound/{address,auth-results,new-text}.ts` + tests (Task 4); `apps/web/src/lib/consent/{email-stop,email-staff-actions,email-view,email-row}.ts` + tests (Task 5); `apps/web/src/lib/consent/email-gate.ts` + `email-gate.test.ts` (Task 6); `apps/web/src/lib/email/{resend,receiving}.ts` + tests and `apps/web/src/lib/consent/scans.test.ts`'s `PROVIDER_MODULES` (Task 7); `apps/web/src/lib/email/inbound/{file,pipeline}.ts` + tests, `apps/web/src/app/api/webhooks/resend/route.ts` + `route.test.ts`, `apps/web/src/lib/ops/{stamp,watch}.ts` + `watch.test.ts` (Task 8); `apps/web/src/lib/email/inbound/forward.ts` + test, `apps/web/src/lib/consent/classes.ts`, `classes.test.ts`, `scans.test.ts`'s kind count and `SITES` (Task 9); `…/settings/actions.ts` + `actions.test.ts` (Task 10's two actions); `…/conv/inbound-actions.ts` + test and two `ALLOWED` lines (Tasks 11 and 12); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 13, regenerated, never hand-edited).
- **bis-frontend:** `…/settings/sending-address-card.tsx` + new `sending-address-card.test.ts`, `…/settings/page.tsx` (one read, two props) + `page.test.ts`, `components/branding-panel.tsx` (one optional prop, one line), `lib/branding/panel-copy.ts` + its test, `…/acct/branding/page.tsx` (one read, one prop) (Task 10); `…/conv/{message-thread.tsx,inbound-notice.tsx}` + tests (Task 11); `…/conv/{page.tsx,conversation-list.tsx,held-email-list.tsx,held-email-skeleton.tsx}` + tests, `…/acct/tasks/{page.tsx,work-list.tsx}` + a new `work-list.held.test.ts`, the styleguide demo (Task 12).
- **bis-e2e-qa:** `apps/web/e2e/inbound-email.spec.ts` (new) (Task 14).
- **Orchestrator:** Task 0's confirmations of G1–G15, the ledger, the bis-ci and production applies, the parity check, the gates, the PR, the merge, the roadmap tracker row, the owner's runbook steps 2 and 5 (Task 16).

**Shared files, one task at a time:** `apps/web/src/lib/messages.ts` (**Task 2 only**: a later task that finds a key missing STOPS and reports; the orchestrator re-opens Task 2). `packages/db/src/messaging.ts`, `consent.ts`, `index.ts` (**Task 3 only**). `scans.test.ts` (Task 7: `PROVIDER_MODULES`; then Task 9: the count and `SITES`; never both at once). `…/acct/in-account-service-reads.test.ts` (Task 11 adds the `inbound-actions.ts` line; Task 12 edits nothing in it, because Task 12 adds its actions to the same file). `apps/web/src/lib/i18n/*-baseline.json` (**Task 13 only**).

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`, clear of 2b/2c's `55580`–`55613`: Task 1 implementer `55620`, Task 1 reviewer `55621`; Task 3 implementer Postgres `55622`, PostgREST `55623`, gateway `55624`; Task 3 reviewer `55625`/`55626`/`55627`; Task 15 (final review) `55628`/`55629`/`55630`. Each agent works in `<SCRATCH>/s06-t<N>-<impl|review>/`.

Task 1 copies 2c's kit (`<KIT2C>/replica.sh`, `pgrst.sh`) to `<SCRATCH>/s06-kit/` with `sed`; exactly these lines change in `replica.sh`: the `WT=` line (`…/worktrees/s07-2c` → `…/worktrees/s06-1`), the skip `*0081_*` → `*0082_*`, the post block's file name (`0081_document_requirements.sql` → `0082_inbound_email.sql`) and its three messages (`post = pre + 0082`, `0082 FAILED`, `post = pre (no 0082 yet)`). In `pgrst.sh` only the JWT secret string changes, to `s06-local-postgrest-jwt-secret-not-used-anywhere-real-00000`. `pre` is every migration through **0081**; `post` is `pre` + 0082. Stop your own kit only: `touch "<dir>/stop"`; PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false`; `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0081 and not 0082 until Task 16 step 2):

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ.

## Pinned tests this PR changes (stated outright)

- `packages/db/src/test/consent-ledger-schema.test.ts` (or wherever `CONSENT_METHODS` is compared with the CHECK; Task 3 step 1 finds it with `grep -rln "CONSENT_METHODS" packages/db/src/test`): the method list gains `inbound_email` (Task 3).
- `apps/web/src/lib/consent/classes.test.ts:98-101`: "twenty-seven" → **twenty-eight** email kinds, `toHaveLength(27)` → `28`, `EMAIL_TABLE` gains `"operator.reply_forward": ["operator", "any", "none"]` (Task 9).
- `apps/web/src/lib/consent/scans.test.ts:266-271`: "twenty-seven email kinds, 38 distinct" → **twenty-eight, 39**, `toHaveLength(38)` → `39`; `SITES` gains `"operator.reply_forward": ["apps/web/src/lib/email/inbound/forward.ts"]` (Task 9). `:724-727`: `PROVIDER_MODULES` gains `"apps/web/src/lib/email/receiving.ts"` (Task 7).
- `apps/web/src/lib/ops/watch.test.ts:94-96`: the `KEYS` record gains `"email.inbound": true`; `describeKey` gains a label (Task 8).
- `apps/web/src/app/api/webhooks/resend/route.test.ts`: the `@bis/db` mock factory is unchanged; a NEW `vi.mock("@/lib/email/inbound/pipeline", …)` and new cases; the existing cases stay as they are (Task 8).
- `apps/web/src/lib/consent/email-gate.test.ts:7-10`: the hoisted `db` mock gains `getInboundSettings` and `ensureReplyToken` (they are real `@bis/db` functions the gate now calls; without mocks they would call `from()` on `{}`) (Task 6).
- `…/acct/in-account-service-reads.test.ts:62-130`: `ALLOWED` gains `"app/(dashboard)/dashboard/accounts/[accountId]/conversations/inbound-actions.ts": "proven-target"` (Task 11).
- `packages/db/src/messaging.ts:75-76` `MESSAGE_COLS` gains `meta`; any test that pins the column string (Task 3 step 1: `grep -rn "provider_message_id, subject, body, error, created_at" packages apps/web/src`) changes with it.
- **Unchanged, checked (each task that could disturb one runs it):** `packages/db/src/test/schema-grants-guard.test.ts` (0082 adds a TABLE with RLS on and no client write); `weekly-report-grants.test.ts`, `alert-phone-grants.test.ts`, `client-branding-grants.test.ts` (0082 grants nothing on `accounts`); `packages/db/src/account-teardown.ts`' `ACCOUNT_OWNED_TABLES` (unchanged: `inbound_emails` cascades on its account and on its conversation, and `message_id` is `on delete set null`; Task 1 proves the teardown order `messages` → `conversations` leaves nothing); `lib/i18n/request-locale-callers.test.ts` (every new `requestLocale` call names `userLanguage`).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0082_inbound_email.sql` | bis-db-schema | the token and mode columns, `inbound_emails` and its RLS, the method, the Undo line, `unfile_inbound_email` |
| `packages/db/src/test/inbound-email-schema.test.ts` | bis-db-schema | 0082 on the replica: CHECKs, uniqueness, RLS and grants, the method, the Undo rule, the unfile function, the teardown order |
| `packages/db/src/inbound-email.ts` (+ `test/inbound-email.test.ts`) | bis-comms | every read and write the app makes for reply tokens, the mode, inbound rows and the sender match |
| `apps/web/src/lib/email/inbound/address.ts` (+ test) | bis-comms | parse `r-<token>@domain`, build the Reply-To, a bare address out of `Name <a@b>` |
| `apps/web/src/lib/email/inbound/auth-results.ts` (+ test) | bis-comms | the raw header block, the topmost `amazonses.com` result, the SES verdicts, the sender-auth decision |
| `apps/web/src/lib/email/inbound/new-text.ts` (+ test) | bis-comms | quoted history stripped (EN/ES), HTML to text |
| `apps/web/src/lib/consent/email-stop.ts` (+ test) | bis-comms | clear stop / unclear / none on a reply's new text |
| `apps/web/src/lib/email/receiving.ts` (+ test) | bis-comms | the received-email fetcher seam (the only importer of `resend.ts`'s fetch) |
| `apps/web/src/lib/email/inbound/file.ts` (+ test) | bis-comms | filing one inbound email: the stop rule, the message, unread, the forward hook |
| `apps/web/src/lib/email/inbound/pipeline.ts` (+ test) | bis-comms | the `email.received` steps 2–9 |
| `apps/web/src/lib/email/inbound/forward.ts` (+ test) | bis-comms | the owner's copy |
| `…/conv/inbound-actions.ts` (+ test) | bis-comms | file / choose a record / not a customer, each Undo; the stop's Undo; Stop emails from a reply |
| `…/conv/inbound-notice.tsx` (+ test) | bis-frontend | the bubble's member name, attachments line, stop notice and chip |
| `…/conv/held-email-list.tsx` (+ test), `held-email-skeleton.tsx` | bis-frontend | Needs a look: items, actions, empty, error, loading |
| `…/settings/sending-address-card.test.ts` | bis-frontend | the Replies row |
| `…/acct/tasks/work-list.held.test.ts` | bis-frontend | the To do row |
| `apps/web/e2e/inbound-email.spec.ts` | bis-e2e-qa | a held email filed from Needs a look, then undone |

**Modified:** `packages/db/src/{messaging,consent,index}.ts`; `apps/web/src/lib/messages.ts`, `messages.test.ts`; `apps/web/src/lib/consent/{email-gate,email-staff-actions,email-view,email-row,classes}.ts` and tests; `scans.test.ts`; `apps/web/src/lib/email/resend.ts` (+ `resend.test.ts`); `apps/web/src/app/api/webhooks/resend/{route,route.test}.ts`; `apps/web/src/lib/ops/{stamp,watch,watch.test}.ts`; `…/settings/{actions,actions.test,page,page.test,sending-address-card}.ts(x)`; `components/branding-panel.tsx`; `lib/branding/panel-copy.ts` (+ test); `…/acct/branding/page.tsx`; `…/conv/{page,conversation-list,message-thread}.tsx` and tests; `…/acct/tasks/{page,work-list}.tsx`; `…/acct/in-account-service-reads.test.ts`; the styleguide (`apps/web/src/app/(dashboard)/dashboard/styleguide/`); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on |
|---|---|---|---|---|
| 0 | Confirm the base; the owner confirms G1–G15 | orchestrator | n/a | — |
| 1 | Migration 0082 and its proof on the replica; the kit | bis-db-schema | **opus** | 0 |
| 2 | Every key (**messages.ts, the only writer**) | bis-comms | sonnet | 0 |
| 3 | `@bis/db`: `inbound-email.ts`, `meta` on messages, the method | bis-comms | **opus** | 1 |
| 4 | Pure parsers: the address, `Authentication-Results`, the new text | bis-comms | **opus** | 0 |
| 5 | The email stop classifier; the stop's Undo; the Email row's "how" | bis-comms | **opus** | 2, 3 |
| 6 | The Reply-To through the email gate | bis-comms | **opus** | 3, 4 |
| 7 | The received-email fetcher inside `lib/email` | bis-comms | sonnet | 0 |
| 8 | The inbound pipeline, the webhook branch, the heartbeat | bis-comms | **opus** | 3, 4, 5, 7 |
| 9 | The owner's forwarded copy; the new operator kind | bis-comms | sonnet | 2, 8 |
| 10 | Settings' Replies row, Check DNS; Branding's read-only line | bis-comms (actions) then bis-frontend | sonnet | 2, 3 |
| 11 | The thread: member name, attachments, the stop notice with Undo, the chip | bis-comms (actions) then bis-frontend | **opus** | 2, 3, 5 |
| 12 | Needs a look in the inbox; file / choose / not a customer with Undo; the To do row | bis-comms (actions) then bis-frontend | **opus** | 2, 3, 8, 11 |
| 13 | Regenerate the i18n baselines | bis-comms | sonnet | 2, 5, 10, 11, 12 |
| 14 | The e2e spec | bis-e2e-qa | sonnet | 12, 13 |
| 15 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–14 |
| 16 | Rollout (orchestrator; LAST) | orchestrator | n/a | 15 |

```
Wave A (three lanes):  T1 (bis-db-schema)   T2 (bis-comms)   T4 + T7 (bis-comms, 2nd instance)
Wave B:                T3 (after T1)
Wave C (two lanes):    T5, then T8 (after T3, T4, T7)        T6 (after T3, T4)
Wave D (two lanes):    T9 (after T8)                         T10 (after T3)
Wave E:                T11, then T12
Wave F:                T13, then T14
Checkpoint:            T15
Rollout:               T16 (orchestrator, LAST)
```

Disjointness: T4/T7 share no file with T1–T3. T6 edits only the gate and its test. T8 and T9 both touch `lib/email/inbound/` but different files (`file.ts`'s forward hook is a parameter T8 defines and T9 fills from the route). T10, T11, T12 are sequential where they share `…/conv/inbound-actions.ts` (T11 creates it, T12 appends). **0082 goes to bis-ci only AFTER Task 15 approves**; until then CI `e2e`'s migration check is red on every push, expected and named in each CI reading. 0082 is additive except two changes to existing objects (the method CHECK, re-added with one more value; the function, one line widened), both safe for the build before it, so it may apply to production BEFORE the merge.

---

## Task 0: Confirm the base; the owner confirms G1–G15 (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -4` shows this plan's commit, then `2ac6bced Spec: Resend auth-header spike result …`, `addd7096 Runbook: …`, `a9071970 Spec: …`. `git fetch origin && git log --oneline origin/main -1`. If `main` moved past `de3f3551`, read what moved it; if it touched any file in "File Structure", merge `origin/main` ONCE here (never rebase) before any lane starts.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0081_document_requirements.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0082*'` → nothing.
  - `grep -n 'status: 400' apps/web/src/app/api/webhooks/resend/route.ts` → one hit (G1).
  - `grep -n "v_prior_method = 'staff';" packages/db/supabase/migrations/0055_consent_writes.sql` → `197:` (G2).
  - `grep -n "requireAgencyOnlyAccountAccess(accountId)" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx"` → `65:` (G6).
  - `grep -n 'toHaveLength(27)' apps/web/src/lib/consent/classes.test.ts` → one hit; `grep -n 'toHaveLength(38)' apps/web/src/lib/consent/scans.test.ts` → one hit.
  - `grep -n '"common.undo.es"' apps/web/src/lib/messages.ts` → `297:`; `grep -n '^} as const;' apps/web/src/lib/messages.ts` → `4628:`; `wc -l < apps/web/src/lib/messages.test.ts` → `463`.
  - `ls "<KIT2C>/replica.sh" "<KIT2C>/pgrst.sh"` → both exist.
  - Read-only: MCP `execute_sql` on production and `pnpm --filter @bis/db ci:sql` on bis-ci: `select max(version) from supabase_migrations.schema_migrations` names the 0081 apply on both.
- [ ] **Step 3.** Put G1–G15 to the owner as tiles (memory "Choice tiles"), the plan's handling recommended first. If any is ruled differently, the orchestrator edits the affected task in this file BEFORE dispatching it, and records the ruling in the ledger.

---

## Task 1: Migration 0082 and its proof on the replica; the kit (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2, 4, 7. **Scratch:** `<SCRATCH>/s06-t1-impl/`, replica port `55620` (reviewer `s06-t1-review/`, `55621`).

**Files**
- Create: `<SCRATCH>/s06-kit/replica.sh`, `<SCRATCH>/s06-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0082_inbound_email.sql`
- Create: `packages/db/src/test/inbound-email-schema.test.ts`

**Interfaces**
- Consumes (SQL): `public.accounts`, `public.conversations` (0005:11-28), `public.messages` (0005:30-45), `public.consent_events` and its `consent_events_method_check` (0062:47-53), `public.append_consent_event` (0055:102-239), `public.client_group_members` (0069:59-75); `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers(uuid)`, `app.my_contact_ids()` (0068:75-97).
- Produces (SQL); every name below is read by a later task:
  - `conversations.reply_token text` (CHECK `conversations_reply_token_check`: null or `^[0-9a-f]{24}$`), `conversations.reply_token_revoked_at timestamptz` (CHECK `conversations_reply_token_revoked_check`: null, or the token is set), unique partial index `conversations_reply_token_key (reply_token) where reply_token is not null`, constraint `conversations_account_id_id_key unique (account_id, id)`.
  - `accounts.inbound_mode text not null default 'off'` (CHECK `accounts_inbound_mode_check` in `off`, `bis`, `own_domain`), `accounts.inbound_domain text` (CHECK `accounts_inbound_domain_check`: null, or lowercase, a dotted hostname, and never `reply.bis-rgv.com`; CHECK `accounts_inbound_domain_required`: `own_domain` needs a domain), unique partial index `accounts_inbound_domain_key (inbound_domain) where inbound_domain is not null`. No grant.
  - `public.inbound_emails` (columns below), RLS on; `inbound_emails_member_read` (SELECT) + restrictive `inbound_emails_technician_scope`; `authenticated` SELECT only, `service_role` all.
  - `consent_events_method_check` gains `inbound_email`; new `consent_events_inbound_email_shape_check` (`inbound_email` is only `channel = 'email'` and `action = 'revoked'`).
  - `public.append_consent_event` — the same body, with `resubscribed / staff_undo` allowed over `revoked / staff` OR `revoked / inbound_email`.
  - `public.unfile_inbound_email(p_account_id uuid, p_id uuid, p_message_id uuid) returns boolean`, SECURITY INVOKER, EXECUTE for `service_role` only: when the row is `filed`, was held before (`hold_reason is not null`), and points at `p_message_id`, it returns the row to `held`, clears `message_id`, `decided_by`, `decided_at`, deletes that message, and answers `true`; otherwise `false`. `22004` on a null argument.

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad
K=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/24e55561-31fd-4769-a14a-4ebbd9d987a9/scratchpad/s07e-kit
mkdir -p "$S/s06-kit"
sed -e 's#/worktrees/s07-2c#/worktrees/s06-1#' -e 's#\*0081_\*#*0082_*#' -e 's#0081_document_requirements.sql#0082_inbound_email.sql#g' \
    -e 's#post = pre + 0081#post = pre + 0082#' -e 's#0081 FAILED#0082 FAILED#' -e 's#(no 0081 yet)#(no 0082 yet)#' \
    "$K/replica.sh" > "$S/s06-kit/replica.sh"
sed -e 's#s07e-local-postgrest-jwt-secret-not-used-anywhere-real-0000#s06-local-postgrest-jwt-secret-not-used-anywhere-real-00000#' "$K/pgrst.sh" > "$S/s06-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s06-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s06-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" differ. `bash "$S/s06-kit/replica.sh" 55620 "$S/s06-t1-impl"` → `post = pre (no 0082 yet)`. Run the faithfulness query on `pre` and on bis-ci; paste both; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 100,240p packages/db/supabase/migrations/0055_consent_writes.sql` (the function this task re-creates), `sed -n 40,60p packages/db/supabase/migrations/0062_email_suppression.sql` (the method list), `sed -n 100,130p packages/db/supabase/migrations/0053_server_only_writes.sql`, `sed -n 110,130p packages/db/supabase/migrations/0068_mine_unassigned_technician.sql` (the `messages_technician_scope` shape this table copies), `sed -n 80,95p packages/db/supabase/migrations/0081_document_requirements.sql` (the grant block shape), `sed -n 1,60p packages/db/src/test/document-vault-rls.test.ts` (the seed shape).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/inbound-email-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0082 (S-06 part 1, spec "Data model"; plan G2, G3, G12, G13): the reply token and the account's mode,
 * the server-written inbound_emails table and who reads it, the inbound_email method, the staff Undo
 * over it, and unfile_inbound_email. Its own seed, in the vault RLS suite's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_ie_${RUN}`;
const ORG_B = `org_ieb_${RUN}`;
const SUB = { owner: `u_ie_owner_${RUN}`, staff: `u_ie_staff_${RUN}`, tech: `u_ie_tech_${RUN}`, ownerB: `u_ie_ownerb_${RUN}` } as const;
const TOKEN_A = "0123456789abcdef01234567";
const TOKEN_B = "89abcdef0123456789abcdef";

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
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'IE Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'IE B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')`,
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB]);
  const mine = await one(c, "insert into contacts (account_id, first_name, email, assigned_to) values ($1,'Ana','ana@example.com',$2) returning id", [acct, u.tech]);
  const other = await one(c, "insert into contacts (account_id, first_name, email) values ($1,'Luis','luis@example.com') returning id", [acct]);
  const convMine = await one(c, "insert into conversations (account_id, contact_id, reply_token) values ($1,$2,$3) returning id", [acct, mine, TOKEN_A]);
  const convOther = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, other]);
  const row = (conv: string, status: string, reason: string | null, pid: string) => one(c,
    `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, text, status, hold_reason, received_at)
     values ($1,$2,$3,'x@example.com','r-${TOKEN_A}@reply.bis-rgv.com','hi',$4,$5, now()) returning id`, [acct, conv, pid, status, reason]);
  const heldMine = await row(convMine, "held", "not_on_record", `re_${RUN}_1`);
  const heldOther = await row(convOther, "held", "unverified", `re_${RUN}_2`);
  return { acct, acctB, mine, other, convMine, convOther, heldMine, heldOther };
}

describe("0082: the reply token on conversations", () => {
  it("takes 24 lowercase hex characters or null, once across every account; a revoked stamp needs a token (mutation: drop conversations_reply_token_check → 'ABC' is accepted, FAILS; drop the unique index → the second TOKEN_A insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(attempt(c, "update conversations set reply_token = 'ABCDEF0123456789ABCDEF01' where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = 'abc' where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = $2 where id = $1", [s.convOther, TOKEN_A]))).toBe("23505");
      expect(await code(attempt(c, "update conversations set reply_token_revoked_at = now() where id = $1", [s.convOther]))).toBe("23514");
      expect(await code(attempt(c, "update conversations set reply_token = $2, reply_token_revoked_at = now() where id = $1", [s.convOther, TOKEN_B]))).toBe("ok");
    });
  });
});

describe("0082: the account's reply mode", () => {
  it("defaults to off; own_domain needs a lowercase dotted domain that is not BIS's own, unique across accounts (mutation: drop accounts_inbound_domain_required → own_domain with no domain is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect((await c.query("select inbound_mode, inbound_domain from accounts where id = $1", [s.acct])).rows[0]).toEqual({ inbound_mode: "off", inbound_domain: null });
      expect(await code(attempt(c, "update accounts set inbound_mode = 'on' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain', inbound_domain = 'Reply.Example.com' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.bis-rgv.com' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'no-dot' where id = $1", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'own_domain', inbound_domain = 'reply.example.com' where id = $1", [s.acct]))).toBe("ok");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.example.com' where id = $1", [s.acctB]))).toBe("23505");
      expect(await code(attempt(c, "update accounts set inbound_mode = 'bis' where id = $1", [s.acctB]))).toBe("ok");
    });
  });

  it("no client role can write either column (0015's rule; mutation: grant update (inbound_mode) to authenticated → the owner's update succeeds, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "update accounts set inbound_mode = 'bis' where id = $1", [s.acct]))).toBe("42501");
      expect(await code(attempt(c, "update accounts set inbound_domain = 'reply.x.com' where id = $1", [s.acct]))).toBe("42501");
    });
  });
});

describe("0082: inbound_emails", () => {
  it("one row per Resend id; status, reason and decision are coherent; text is capped (mutation: drop inbound_emails_held_has_reason → a reasonless held row is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const ins = (pid: string, status: string, reason: string | null, extra = "") => attempt(c,
        `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, text, status, hold_reason, received_at${extra ? ", decided_by" : ""})
         values ($1,$2,$3,'x@example.com','r@x.com','hi',$4,$5, now()${extra ? `, '${extra}'` : ""})`, [s.acct, s.convMine, pid, status, reason]);
      expect(await code(ins(`re_${RUN}_1`, "filed", null))).toBe("23505");
      expect(await code(ins(`re_${RUN}_3`, "held", null))).toBe("23514");
      expect(await code(ins(`re_${RUN}_4`, "lost", null))).toBe("23514");
      expect(await code(ins(`re_${RUN}_5`, "held", "spam"))).toBe("23514");
      expect(await code(ins(`re_${RUN}_6`, "filed", null, "user_x"))).toBe("23514");   // decided_by without decided_at
      expect(await code(attempt(c, "update inbound_emails set text = repeat('a', 100001) where id = $1", [s.heldMine]))).toBe("23514");
    });
  });

  it("its conversation must be the same account's (mutation: a plain conversation_id FK → the cross-account insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(attempt(c,
        `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, received_at)
         values ($1,$2,'re_x_${RUN}','x@example.com','r@x.com','filed', now())`, [s.acctB, s.convMine]))).toBe("23503");
    });
  });

  it("members read their own account's rows, a Technician only their customers', another account nothing; no client writes (mutation: drop inbound_emails_technician_scope → the tech sees heldOther, FAILS; member_read using (true) → ownerB sees two, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const seen = async (who: keyof typeof SUB) => {
        await actAs(c, { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
        const ids = (await c.query<{ id: string }>("select id from inbound_emails where account_id = any($1::uuid[]) order by id", [[s.acct, s.acctB]])).rows.map((r) => r.id);
        await c.query("reset role");
        return ids;
      };
      expect(await seen("owner")).toEqual([s.heldMine, s.heldOther].sort());
      expect(await seen("staff")).toEqual([s.heldMine, s.heldOther].sort());
      expect(await seen("tech")).toEqual([s.heldMine]);
      expect(await seen("ownerB")).toEqual([]);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "update inbound_emails set status = 'dismissed' where id = $1", [s.heldMine]))).toBe("42501");
      expect(await code(attempt(c, "delete from inbound_emails where id = $1", [s.heldMine]))).toBe("42501");
    });
  });

  it("the account teardown order (messages, then conversations) leaves no row (mutation: message_id without on delete set null → deleting messages fails 23503, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const msg = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      await c.query("update inbound_emails set status = 'filed', message_id = $2 where id = $1", [s.heldMine, msg]);
      await c.query("delete from messages where account_id = $1", [s.acct]);
      expect((await c.query("select message_id from inbound_emails where id = $1", [s.heldMine])).rows[0]).toEqual({ message_id: null });
      await c.query("delete from conversations where account_id = $1", [s.acct]);
      expect((await c.query("select count(*)::int as n from inbound_emails where account_id = $1", [s.acct])).rows[0]).toEqual({ n: 0 });
    });
  });
});

describe("0082: the inbound_email method and its Undo", () => {
  const append = (c: Client, acct: string, action: string, method: string, guard: string, expect: string | null) => c.query<{ outcome: string; event_id: string | null }>(
    `select outcome, event_id from public.append_consent_event($1,'email','ana@example.com',$2,$3,$4,$5,null,'user_x',null,null,'{}'::jsonb,null)`,
    [acct, action, method, guard, expect]);

  it("inbound_email is an email revoke only (mutation: leave inbound_email out of the method CHECK → the append raises 23514, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect((await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!.outcome).toBe("appended");
      expect(await code(attempt(c, "select public.append_consent_event($1,'sms','+15555550100','revoked','inbound_email','none',null,null,null,null,null,'{}'::jsonb,null)", [s.acct]))).toBe("23514");
      expect(await code(attempt(c, "select public.append_consent_event($1,'email','ana@example.com','held','inbound_email','none',null,null,null,null,null,'{}'::jsonb,null)", [s.acct]))).toBe("23514");
    });
  });

  it("a staff Undo lifts an inbound_email stop while it is newest, and still refuses over the customer's own unsubscribe (mutation: 0082 without the widened line → the Undo answers refused, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const stop = (await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!;
      expect((await append(c, s.acct, "resubscribed", "staff_undo", "if_newest", stop.event_id)).rows[0]!.outcome).toBe("appended");
      const link = (await append(c, s.acct, "revoked", "unsubscribe_link", "none", null)).rows[0]!;
      expect((await append(c, s.acct, "resubscribed", "staff_undo", "if_newest", link.event_id)).rows[0]!.outcome).toBe("refused");
      // G3: over an existing stop, the emailed stop is refused, so its Undo can never lift the older one.
      expect((await append(c, s.acct, "revoked", "inbound_email", "if_allowed", null)).rows[0]!.outcome).toBe("refused");
    });
  });

  it("the function's body changed in exactly one line (G2; mutation: any other edit to the body → FAILS)", async () => {
    await withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ src: string }>("select prosrc as src from pg_proc where proname = 'append_consent_event'");
      expect(r!.src).toContain("v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'inbound_email');");
      expect(r!.src).not.toContain("v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method = 'staff';");
      const { rows: [g] } = await c.query<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as a,
                has_function_privilege('service_role', 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as s`);
      expect(g).toEqual({ a: false, s: true });
    });
  });
});

describe("0082: unfile_inbound_email", () => {
  it("returns a manually filed row to held and deletes its message, once; never a webhook-filed row (mutation: drop 'and hold_reason is not null' → the webhook row unfiles, FAILS; drop the message delete → the message survives, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const msg = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      await c.query("update inbound_emails set status = 'filed', message_id = $2, decided_by = 'user_x', decided_at = now() where id = $1", [s.heldMine, msg]);
      const unfile = (id: string, m: string) => c.query<{ r: boolean }>("select public.unfile_inbound_email($1, $2, $3) as r", [s.acct, id, m]);
      expect((await unfile(s.heldMine, msg)).rows[0]!.r).toBe(true);
      expect((await c.query("select status, message_id, decided_by from inbound_emails where id = $1", [s.heldMine])).rows[0]).toEqual({ status: "held", message_id: null, decided_by: null });
      expect((await c.query("select count(*)::int as n from messages where id = $1", [msg])).rows[0]).toEqual({ n: 0 });
      expect((await unfile(s.heldMine, msg)).rows[0]!.r).toBe(false);
      const msg2 = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','inbound','hi','customer') returning id", [s.acct, s.convMine]);
      const filed = await one(c, `insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, message_id, received_at)
        values ($1,$2,'re_w_${RUN}','x@example.com','r@x.com','filed',$3, now()) returning id`, [s.acct, s.convMine, msg2]);
      expect((await unfile(filed, msg2)).rows[0]!.r).toBe(false);
      expect(await code(attempt(c, "select public.unfile_inbound_email(null, $1, $2)", [filed, msg2]))).toBe("22004");
    });
  });

  it("only the service role may call it (mutation: grant execute to authenticated → FAILS)", async () => {
    await withRollback(async (c) => {
      const { rows: [g] } = await c.query<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.unfile_inbound_email(uuid, uuid, uuid)', 'EXECUTE') as a,
                has_function_privilege('service_role', 'public.unfile_inbound_email(uuid, uuid, uuid)', 'EXECUTE') as s`);
      expect(g).toEqual({ a: false, s: true });
    });
  });
});
```

If `actAs`'s signature in `packages/db/src/test/db.ts:22` differs from `(c, { org_id?, sub? })` (read it), follow the file and say so in the report. If the seed's `messages` insert needs `author_id` (0074 made provenance NOT NULL), read `0074_record_provenance_not_null.sql` and add the column it requires.

- [ ] **Step 4: Run it to see it fail.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55620/post node node_modules/vitest/vitest.mjs run src/test/inbound-email-schema.test.ts > "$S/s06-t1-impl/red.log" 2>&1; echo $? > "$S/s06-t1-impl/red.exit"` (use the env name the 2c Task 1 runs used; read `packages/db/src/test/db.ts:1-20` for it). Expected: every case FAILS (no column, no table, no function). Paste the summary block.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0082_inbound_email.sql`:

```sql
-- 0082_inbound_email.sql - inbound email, part 1: customers' replies come back
-- (docs/superpowers/specs/2026-10-16-inbound-email-design.md "Data model";
--  docs/superpowers/plans/2026-10-16-inbound-email.md)
--
-- A customer thread gets one opaque reply token (24 lowercase hex characters, made by the app), the
-- local part of the Reply-To the email gate writes once the account's Replies mode is not off. Mail
-- to r-<token>@<reply domain> arrives through Resend's email.received event and is kept in
-- inbound_emails: filed (on the thread, as a messages row), held (waiting in the inbox's Needs a look)
-- or dismissed (not a customer). Server-written only (0053); members read their account's rows, and a
-- Technician only their own customers' (0068), through the conversation.
-- consent_events.method gains inbound_email (a clear stop in a reply, applied at once). A staff Undo of
-- it is a resubscribed / staff_undo row, which 0055 allowed only over a staff stop: the function is
-- re-created with exactly that one line widened (plan G2).
-- unfile_inbound_email is the Undo of a manual "File": the row back to held and its message deleted,
-- in one transaction.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Safe for the build before it: it reads
-- none of the new columns, and the widened CHECK and function accept everything they accepted.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.unfile_inbound_email(uuid, uuid, uuid);
--   re-run 0055's create function body for public.append_consent_event as create or replace (the
--     one line back to v_prior_method = 'staff');
--   delete nothing from consent_events: an inbound_email row is legal evidence. If any exist, keep the
--     widened CHECK; with none: drop consent_events_inbound_email_shape_check, then re-add 0062's
--     consent_events_method_check exactly.
--   drop table public.inbound_emails;
--   alter table public.accounts drop constraint accounts_inbound_domain_required,
--     drop constraint accounts_inbound_domain_check, drop constraint accounts_inbound_mode_check,
--     drop column inbound_domain, drop column inbound_mode;
--   drop index public.conversations_reply_token_key;
--   alter table public.conversations drop constraint conversations_account_id_id_key,
--     drop constraint conversations_reply_token_revoked_check, drop constraint conversations_reply_token_check,
--     drop column reply_token_revoked_at, drop column reply_token;
--   Lost: every reply token (mail to an old r- address is then dropped) and every inbound row.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (each ALTER takes ACCESS EXCLUSIVE briefly).
set local lock_timeout = '5s';

-- 1. The reply token. One per conversation, unique across every account (the webhook arrives with
--    only the token). (account_id, id) is unique so inbound_emails can carry the account in its FK.
alter table public.conversations
  add column reply_token text,
  add column reply_token_revoked_at timestamptz,
  add constraint conversations_reply_token_check check (reply_token is null or reply_token ~ '^[0-9a-f]{24}$'),
  add constraint conversations_reply_token_revoked_check check (reply_token_revoked_at is null or reply_token is not null),
  add constraint conversations_account_id_id_key unique (account_id, id);
create unique index conversations_reply_token_key on public.conversations (reply_token) where reply_token is not null;
-- No grant: conversations is server-written (0053).

-- 2. The account's Replies mode. Agency-only (0015's rule): no grant to authenticated.
alter table public.accounts
  add column inbound_mode text not null default 'off',
  add column inbound_domain text,
  add constraint accounts_inbound_mode_check check (inbound_mode in ('off', 'bis', 'own_domain')),
  add constraint accounts_inbound_domain_check check (
    inbound_domain is null
    or (inbound_domain = lower(inbound_domain)
        and char_length(inbound_domain) <= 253
        and inbound_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
        and inbound_domain <> 'reply.bis-rgv.com')),
  add constraint accounts_inbound_domain_required check (inbound_mode <> 'own_domain' or inbound_domain is not null);
create unique index accounts_inbound_domain_key on public.accounts (inbound_domain) where inbound_domain is not null;

-- 3. inbound_emails.
create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null,
  provider_email_id text not null,
  from_email text not null,
  from_name text,
  to_email text not null,
  subject text,
  text text not null default '',
  auth jsonb not null default '{}'::jsonb,
  status text not null,
  hold_reason text,
  message_id uuid references public.messages(id) on delete set null,
  decided_by text,
  decided_at timestamptz,
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint inbound_emails_conversation_fkey foreign key (account_id, conversation_id)
    references public.conversations (account_id, id) on delete cascade,
  constraint inbound_emails_provider_email_id_key unique (provider_email_id),
  constraint inbound_emails_status_check check (status in ('filed', 'held', 'dismissed')),
  constraint inbound_emails_hold_reason_check check (hold_reason is null or hold_reason in ('not_on_record', 'unverified')),
  constraint inbound_emails_held_has_reason check (status <> 'held' or hold_reason is not null),
  constraint inbound_emails_text_length check (char_length(text) <= 100000),
  constraint inbound_emails_decided_coherent check ((decided_by is null) = (decided_at is null))
);
create index inbound_emails_held on public.inbound_emails (account_id, received_at desc) where status = 'held';
create index inbound_emails_by_conversation on public.inbound_emails (account_id, conversation_id);

alter table public.inbound_emails enable row level security;
create policy inbound_emails_member_read on public.inbound_emails for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy inbound_emails_technician_scope on public.inbound_emails as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or conversation_id in (select v.id from public.conversations v where v.contact_id in (select app.my_contact_ids())));
revoke all on public.inbound_emails from anon, authenticated;
grant select on public.inbound_emails to authenticated;
grant select, insert, update, delete on public.inbound_emails to service_role;

-- 4. The method.
alter table public.consent_events drop constraint consent_events_method_check;
alter table public.consent_events add constraint consent_events_method_check
  check (method in (
    'keyword', 'start_keyword', 'free_text', 'staff', 'staff_undo', 'carrier_block',
    'unsubscribe_link', 'one_click', 'unsubscribe_page', 'form', 'booking', 'inbound_text',
    'backfill_0049', 'backfill_telnyx',
    'email_bounce', 'email_complaint',
    'inbound_email'));
alter table public.consent_events add constraint consent_events_inbound_email_shape_check
  check (method <> 'inbound_email' or (channel = 'email' and action = 'revoked'));

-- 5. append_consent_event: 0055's body, one line widened (see the file header).
-- <<< Step 5a pastes 0055_consent_writes.sql lines 102-229 here, verbatim, with the two edits it names. >>>

-- 6. unfile_inbound_email.
create function public.unfile_inbound_email(p_account_id uuid, p_id uuid, p_message_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_account_id is null or p_id is null or p_message_id is null then
    raise exception 'unfile_inbound_email: null argument' using errcode = '22004';
  end if;
  update public.inbound_emails
     set status = 'held', message_id = null, decided_by = null, decided_at = null
   where account_id = p_account_id and id = p_id and status = 'filed'
     and message_id = p_message_id and hold_reason is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return false;
  end if;
  delete from public.messages where account_id = p_account_id and id = p_message_id;
  return true;
end;
$$;
revoke all on function public.unfile_inbound_email(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.unfile_inbound_email(uuid, uuid, uuid) to service_role;
```

- [ ] **Step 5a: The function, exactly.** Replace the marker line in section 5 with 0055's lines 102–229 (from `create function public.append_consent_event(` through the `$$;` that closes it), with exactly two edits: `create function` → `create or replace function`, and line 197's `v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method = 'staff';` → `v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'inbound_email');`. After it, re-state 0055's `comment on function` (lines 231–232) with `staff undo only over a staff stop` → `staff undo only over a staff or inbound_email stop (0082)` and its revoke/grant block (lines 236–239) unchanged. Prove it: `diff <(sed -n 102,229p packages/db/supabase/migrations/0055_consent_writes.sql) <(awk '/^create or replace function public.append_consent_event\(/,/^\$\$;$/' packages/db/supabase/migrations/0082_inbound_email.sql)` shows exactly those two changed lines. Paste the diff.

- [ ] **Step 6: ASCII and backslash check, with a positive control.**

```bash
node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(`non-ascii=${n} backslash=${s}`)' packages/db/supabase/migrations/0082_inbound_email.sql
printf 'a\\b\xc3\xa9' > "$S/s06-t1-impl/control.sql"
node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(`non-ascii=${n} backslash=${s}`)' "$S/s06-t1-impl/control.sql"
```

Expected: `non-ascii=0 backslash=0`, then the control's `non-ascii=2 backslash=1`. Also `md5sum packages/db/supabase/migrations/0082_inbound_email.sql`; paste it (Task 16 compares).

- [ ] **Step 7: Run on the replica, post = pre + 0082.** `bash "$S/s06-kit/replica.sh" 55620 "$S/s06-t1-impl"` → `post = pre + 0082`. On `post`: `inbound-email-schema.test.ts`, `schema-grants-guard.test.ts`, `weekly-report-grants.test.ts`, `alert-phone-grants.test.ts`, `client-branding-grants.test.ts`, and the consent ledger suites (`grep -rln "append_consent_event" packages/db/src/test`). Expected: all PASS, the guards unchanged. Paste the summary blocks.

- [ ] **Step 8: Mutation probes, each by name** (on the replica's `post` with `alter`/`drop`/`create or replace`, run the named case, then rebuild with `replica.sh`; never edit the committed file for a probe): (a) `alter table conversations drop constraint conversations_reply_token_check` → the token case FAILS on `'ABC…'`; (b) `drop index conversations_reply_token_key` → FAILS on the duplicate; (c) `drop constraint accounts_inbound_domain_required` → the mode case FAILS; (d) `grant update (inbound_mode) on accounts to authenticated` → the grant case FAILS; (e) `drop constraint inbound_emails_held_has_reason` → FAILS; (f) the composite FK replaced by a plain `conversation_id` FK → the cross-account case FAILS; (g) `drop policy inbound_emails_technician_scope` → the read case FAILS on `tech`; (h) `inbound_emails_member_read` re-created `using (true)` → FAILS on `ownerB`; (i) the function re-created with 0055's original line → the Undo case FAILS; (j) `unfile_inbound_email` without `and hold_reason is not null` → FAILS on the webhook row; (k) `grant execute on function public.unfile_inbound_email(uuid, uuid, uuid) to authenticated` → FAILS. Paste each failing assertion line.

- [ ] **Step 9: Commit** `-- packages/db/supabase/migrations/0082_inbound_email.sql packages/db/src/test/inbound-email-schema.test.ts`, message "db: 0082 inbound email: reply tokens, the Replies mode, inbound_emails, the inbound_email stop and its Undo (S-06 part 1)".

---

## Task 2: Every key (bis-comms; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 1, 4, 7.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (insert before `} as const;` at `:4628`)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` at the end)

**Interfaces**
- Produces: every key below (each `.es` twin directly under its English key). Later tasks use exactly these names.

- [ ] **Step 1: Write the failing test** at the end of `messages.test.ts`:

```ts
describe("S-06 part 1: inbound email keys, English and Spanish (plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "conversations.held.filter": "Needs a look",
    "conversations.held.filter.es": "Por revisar",
    "conversations.held.filterCount": "Needs a look · {count}",
    "conversations.held.filterCount.es": "Por revisar · {count}",
    "conversations.held.title": "Emails that need a look",
    "conversations.held.title.es": "Correos por revisar",
    "conversations.held.empty": "Emails we couldn't match to a customer wait here for you to file.",
    "conversations.held.empty.es": "Aquí esperan los correos que no pudimos vincular con un cliente, para que usted los archive.",
    "conversations.held.loadFailed": "We couldn't load these emails. Reload the page to try again.",
    "conversations.held.loadFailed.es": "No pudimos cargar estos correos. Vuelva a cargar la página para intentarlo de nuevo.",
    "conversations.held.reason.notOnRecord": "Not on this customer's record",
    "conversations.held.reason.notOnRecord.es": "No está en el registro de este cliente",
    "conversations.held.reason.unverified": "Couldn't confirm who sent it",
    "conversations.held.reason.unverified.es": "No pudimos confirmar quién lo envió",
    "conversations.held.suggestion": "A reply to an email sent to {name}",
    "conversations.held.suggestion.es": "Respuesta a un correo enviado a {name}",
    "conversations.held.noSubject": "(no subject)",
    "conversations.held.noSubject.es": "(sin asunto)",
    "conversations.held.fileOn": "File on {name}",
    "conversations.held.fileOn.es": "Archivar con {name}",
    "conversations.held.choose": "Choose a record",
    "conversations.held.choose.es": "Elegir un registro",
    "conversations.held.searchLabel": "Find a customer",
    "conversations.held.searchLabel.es": "Buscar un cliente",
    "conversations.held.searchEmpty": "No customer matches that.",
    "conversations.held.searchEmpty.es": "Ningún cliente coincide con eso.",
    "conversations.held.notCustomer": "Not a customer",
    "conversations.held.notCustomer.es": "No es un cliente",
    "conversations.held.filed": "Filed on {name}.",
    "conversations.held.filed.es": "Archivado con {name}.",
    "conversations.held.dismissed": "Marked as not a customer.",
    "conversations.held.dismissed.es": "Marcado como que no es un cliente.",
    "conversations.held.undone": "Back in Needs a look.",
    "conversations.held.undone.es": "De vuelta en Por revisar.",
    "conversations.held.changed": "Someone already handled this email. Reload to see where it is.",
    "conversations.held.changed.es": "Alguien ya atendió este correo. Vuelva a cargar para ver dónde está.",
    "conversations.held.failed": "That didn't save. Try again.",
    "conversations.held.failed.es": "No se guardó. Inténtelo de nuevo.",
    "conversations.reply.fromMember": "from {name}",
    "conversations.reply.fromMember.es": "de {name}",
    "conversations.reply.attachments": "{count} attachments — not saved yet",
    "conversations.reply.attachments.es": "{count} archivos adjuntos — aún no se guardan",
    "conversations.reply.attachmentsOne": "1 attachment — not saved yet",
    "conversations.reply.attachmentsOne.es": "1 archivo adjunto — aún no se guarda",
    "conversations.reply.stopped": "Stopped marketing emails · from their reply",
    "conversations.reply.stopped.es": "Se detuvieron los correos de promoción · por su respuesta",
    "conversations.reply.stopUndone": "Marketing emails are on again.",
    "conversations.reply.stopUndone.es": "Los correos de promoción están activos otra vez.",
    "conversations.reply.maybeStop": "May want to stop",
    "conversations.reply.maybeStop.es": "Quizás quiere dejar de recibirlos",
    "conversations.reply.stopDone": "Emails stopped.",
    "conversations.reply.stopDone.es": "Correos detenidos.",
    "work.heldEmails": "{count} emails need a look",
    "work.heldEmails.es": "{count} correos por revisar",
    "work.heldEmailsOne": "1 email needs a look",
    "work.heldEmailsOne.es": "1 correo por revisar",
    "contact.email.how.reply": "they asked in a reply",
    "contact.email.how.reply.es": "lo pidió en una respuesta",
    "settings.replies.label": "Replies",
    "settings.replies.label.es": "Respuestas",
    "settings.replies.off": "Off",
    "settings.replies.off.es": "Apagado",
    "settings.replies.bis": "BIS address",
    "settings.replies.bis.es": "Dirección de BIS",
    "settings.replies.own": "Own domain",
    "settings.replies.own.es": "Dominio propio",
    "settings.replies.offBody": "Customers' replies go to the reply-to address on Branding.",
    "settings.replies.offBody.es": "Las respuestas de los clientes van a la dirección de respuesta de Marca.",
    "settings.replies.bisBody": "Customers reply to an address at reply.bis-rgv.com, and the reply lands on their thread here.",
    "settings.replies.bisBody.es": "Los clientes responden a una dirección en reply.bis-rgv.com, y la respuesta llega a su conversación aquí.",
    "settings.replies.ownBody": "Customers reply to an address at {domain}, and the reply lands on their thread here.",
    "settings.replies.ownBody.es": "Los clientes responden a una dirección en {domain}, y la respuesta llega a su conversación aquí.",
    "settings.replies.domainLabel": "Reply domain",
    "settings.replies.domainLabel.es": "Dominio de respuesta",
    "settings.replies.checkDns": "Check DNS",
    "settings.replies.checkDns.es": "Revisar DNS",
    "settings.replies.dnsOk": "The MX record points at Resend. You can use this domain.",
    "settings.replies.dnsOk.es": "El registro MX apunta a Resend. Puede usar este dominio.",
    "settings.replies.dnsMissing": "No MX record on {domain} points at Resend yet. Add it, then check again.",
    "settings.replies.dnsMissing.es": "Aún no hay un registro MX en {domain} que apunte a Resend. Agréguelo y vuelva a revisar.",
    "settings.replies.dnsFailed": "We couldn't look up {domain}. Check the spelling and try again.",
    "settings.replies.dnsFailed.es": "No pudimos consultar {domain}. Revise cómo está escrito e inténtelo de nuevo.",
    "settings.replies.invalidDomain": "Enter a domain like reply.example.com.",
    "settings.replies.invalidDomain.es": "Escriba un dominio como reply.example.com.",
    "settings.replies.domainTaken": "Another account already uses that domain.",
    "settings.replies.domainTaken.es": "Otra cuenta ya usa ese dominio.",
    "settings.replies.saved": "Replies: {mode}.",
    "settings.replies.saved.es": "Respuestas: {mode}.",
    "settings.replies.undone": "Replies are back to {mode}.",
    "settings.replies.undone.es": "Las respuestas volvieron a {mode}.",
    "branding.replies.agency": "Customer replies come back into BIS at {domain}; the reply-to address above gets a copy.",
    "branding.replies.agency.es": "Las respuestas de los clientes regresan a BIS en {domain}; la dirección de respuesta de arriba recibe una copia.",
    "branding.replies.client": "Your customers' replies come back into BIS at {domain}, and a copy goes to the reply-to address above.",
    "branding.replies.client.es": "Las respuestas de sus clientes regresan a BIS en {domain}, y una copia llega a la dirección de respuesta de arriba.",
    "email.replyForward.fromName": "{customer} via {business}",
    "email.replyForward.fromName.es": "{customer} vía {business}",
    "email.replyForward.answer": "Answer in BIS",
    "email.replyForward.answer.es": "Responder en BIS",
    "email.replyForward.attachments": "This email had {count} attachments. They are not saved in BIS yet.",
    "email.replyForward.attachments.es": "Este correo traía {count} archivos adjuntos. Aún no se guardan en BIS.",
    "email.replyForward.attachmentsOne": "This email had 1 attachment. It is not saved in BIS yet.",
    "email.replyForward.attachmentsOne.es": "Este correo traía 1 archivo adjunto. Aún no se guarda en BIS.",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("every English key has its .es twin on the very next line (mutation: move a twin → FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve a cargar' in .changed.es → FAILS; drop {domain} from dnsMissing.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  it("no client-facing key uses provider or internal words (mutation: 'token' in a conversations.* key → FAILS)", () => {
    const BANNED = /\b(token|dkim|dmarc|spf|ses|webhook|resend|mx)\b/i;
    for (const [k, v] of Object.entries(WANT)) {
      if (k.startsWith("settings.replies.")) continue;   // the agency's own Settings card names DNS and MX on purpose
      expect(BANNED.test(v), k).toBe(false);
    }
  });
});
```

(If `messages.test.ts` does not already import `readFileSync` and `join`, add `import { readFileSync } from "node:fs";` and `import { join } from "node:path";` at its top.)

- [ ] **Step 2: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys missing).
- [ ] **Step 3: Add the keys** to `messages.ts` before `} as const;`, each English line followed directly by its `.es` line, copying every string from `WANT` (the middle dot is `·`, U+00B7; the dash in the attachments keys is `—`, U+2014).
- [ ] **Step 4: Run to pass**, plus `src/lib/i18n/ratchet.test.ts` and `src/lib/i18n/accents-guard.test.ts` → PASS. `pnpm --filter web typecheck` → 0.
- [ ] **Step 5: Probes.** Change `"conversations.held.changed.es"` to `"Alguien ya atendió este correo. Vuelve a cargar para ver dónde está."` → cases 1 and 3 FAIL by name; edit back. Delete `{domain}` from `"settings.replies.dnsMissing.es"` → cases 1 and 3 FAIL; edit back. Paste both failing lines.
- [ ] **Step 6: Commit** `-- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`, message "copy: the inbound email keys, English and Spanish (S-06 part 1)".

---

## Task 3: `@bis/db`: `inbound-email.ts`, `meta` on messages, the method (bis-comms)

**Review:** opus. **After:** Task 1. **Scratch:** `<SCRATCH>/s06-t3-impl/`, ports `55622`/`55623`/`55624`.

**Files**
- Create: `packages/db/src/inbound-email.ts`
- Create: `packages/db/src/test/inbound-email.test.ts`
- Modify: `packages/db/src/messaging.ts:12-36` (`NewMessage` gains `meta`), `:75-76` (`MESSAGE_COLS` gains `meta`), `:133-153` (`createMessage` writes it)
- Modify: `packages/db/src/consent.ts:18-24` (`CONSENT_METHODS` gains `"inbound_email"`)
- Modify: `packages/db/src/index.ts` (the barrel)

**Interfaces**
- Consumes: 0082 (Task 1); `ensureConversation` (`messaging.ts:94`), `emit` (`events.ts:16`), `emailKey` (`contacts.ts:198`).
- Produces (exact names; later tasks import them from `@bis/db`):

```ts
export type InboundMode = "off" | "bis" | "own_domain";
export const INBOUND_MODES: readonly InboundMode[];
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
export const REPLY_TOKEN_PATTERN: RegExp;                 // /^[0-9a-f]{24}$/
export type InboundSettings = { mode: InboundMode; domain: string | null };
export function newReplyToken(): string;
export async function getInboundSettings(db: SupabaseClient, accountId: string): Promise<InboundSettings>;
export async function setInboundSettings(db: SupabaseClient, accountId: string, s: InboundSettings, actorId: string): Promise<void>;
export async function ensureReplyToken(db: SupabaseClient, accountId: string, contactId: string, actorId: string, make?: () => string): Promise<{ conversationId: string; token: string }>;
export type ReplyThread = { conversationId: string; accountId: string; contactId: string; revoked: boolean; inboundDomain: string | null };
export async function findReplyThread(db: SupabaseClient, token: string): Promise<ReplyThread | null>;
export type InboundStatus = "filed" | "held" | "dismissed";
export type HoldReason = "not_on_record" | "unverified";
export type InboundAuthRecord = { spf: string | null; dkim: string | null; dmarc: string | null; spam: string | null; virus: string | null };
export type InboundEmailRow = {
  id: string; accountId: string; conversationId: string; providerEmailId: string;
  fromEmail: string; fromName: string | null; toEmail: string; subject: string | null; text: string;
  auth: InboundAuthRecord; status: InboundStatus; holdReason: HoldReason | null; messageId: string | null;
  decidedBy: string | null; decidedAt: string | null; receivedAt: string;
};
export type NewInboundEmail = Omit<InboundEmailRow, "id" | "messageId" | "decidedBy" | "decidedAt"> & { decidedBy: string | null };
export async function recordInboundEmail(db: SupabaseClient, row: NewInboundEmail): Promise<{ row: InboundEmailRow; created: boolean }>;
export async function getInboundEmail(db: SupabaseClient, accountId: string, id: string): Promise<InboundEmailRow | null>;
export async function setInboundMessage(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean>;
export async function decideInboundEmail(db: SupabaseClient, accountId: string, id: string, from: InboundStatus, to: { status: InboundStatus; messageId?: string | null; decidedBy: string | null }): Promise<boolean>;
export async function unfileInboundEmail(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean>;
export type HeldInboundEmail = InboundEmailRow & { contactId: string; contactFirstName: string | null; contactLastName: string | null };
export async function listHeldInboundEmails(db: SupabaseClient, accountId: string, opts?: { limit?: number }): Promise<HeldInboundEmail[]>;
export async function countHeldInboundEmails(db: SupabaseClient, accountId: string): Promise<number>;
export type SenderMatch = { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean };
export async function matchSender(db: SupabaseClient, accountId: string, contactId: string, fromEmail: string): Promise<SenderMatch | null>;
```

`messaging.ts`: `NewMessage` gains `meta?: Record<string, unknown>`; `createMessage` inserts `meta` only when set (spread, so other writers are byte-for-byte unchanged); `MESSAGE_COLS` becomes `"id, conversation_id, channel, direction, status, provider_message_id, subject, body, error, meta, created_at"`.

- [ ] **Step 1: Read before writing.** `sed -n 1,140p packages/db/src/messaging.ts`, `sed -n 1,60p packages/db/src/sending-identity.ts` (the update-with-`.select("id")` shape), `sed -n 90,130p packages/db/src/client-groups.ts` (how a contact's groups are read), `sed -n 190,200p packages/db/src/contacts.ts`, `sed -n 130,150p packages/db/src/test/fixtures.ts` (`withTestAccount`), `sed -n 280,300p packages/db/src/index.ts`. `grep -rln "CONSENT_METHODS" packages/db/src/test` and `grep -rn "provider_message_id, subject, body, error, created_at" packages apps/web/src` (pins to update). Start the kit: `bash <SCRATCH>/s06-kit/replica.sh 55622 <SCRATCH>/s06-t3-impl && bash <SCRATCH>/s06-kit/pgrst.sh 55622 55623 55624 <SCRATCH>/s06-t3-impl` → `post = pre + 0082`.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/inbound-email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createMessage, listMessages } from "../messaging";
import {
  BIS_REPLY_DOMAIN, REPLY_TOKEN_PATTERN, newReplyToken, getInboundSettings, setInboundSettings,
  ensureReplyToken, findReplyThread, recordInboundEmail, getInboundEmail, setInboundMessage,
  decideInboundEmail, unfileInboundEmail, listHeldInboundEmails, countHeldInboundEmails, matchSender,
  type NewInboundEmail,
} from "../inbound-email";

const ACTOR = "user_test";
const RUN = Math.random().toString(36).slice(2, 10);
const AUTH = { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" };
const row = (accountId: string, conversationId: string, over: Partial<NewInboundEmail> = {}): NewInboundEmail => ({
  accountId, conversationId, providerEmailId: `re_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
  fromEmail: "ana@example.com", fromName: "Ana", toEmail: `r-x@${BIS_REPLY_DOMAIN}`, subject: "Re: Hi",
  text: "Sounds good", auth: AUTH, status: "held", holdReason: "not_on_record", decidedBy: null,
  receivedAt: new Date().toISOString(), ...over,
});

describe("reply tokens", () => {
  it("newReplyToken is 24 lowercase hex characters, a different one each call (mutation: return a constant → FAILS)", () => {
    const a = newReplyToken(); const b = newReplyToken();
    expect(a).toMatch(REPLY_TOKEN_PATTERN); expect(b).toMatch(REPLY_TOKEN_PATTERN); expect(a).not.toBe(b);
  });

  it("ensureReplyToken makes the conversation and its token once, then answers the same token (mutation: overwrite the token on every call → the second answer differs, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana@example.com" }, ACTOR);
      let n = 0;
      const make = () => `${String(++n).padStart(2, "0")}${"a".repeat(22)}`;
      const first = await ensureReplyToken(db, accountId, contactId, ACTOR, make);
      const second = await ensureReplyToken(db, accountId, contactId, ACTOR, make);
      expect(first).toEqual(second);
      expect(first.token).toBe(`01${"a".repeat(22)}`);
      expect(await findReplyThread(db, first.token)).toEqual({ conversationId: first.conversationId, accountId, contactId, revoked: false, inboundDomain: null });
      expect(await findReplyThread(db, "f".repeat(24))).toBeNull();
      expect(await findReplyThread(db, "not-a-token")).toBeNull();
    });
  });

  it("a revoked token reads as revoked (mutation: drop the revoked mapping → revoked false, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana2@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", t.conversationId);
      expect((await findReplyThread(db, t.token))?.revoked).toBe(true);
    });
  });
});

describe("the account's Replies mode", () => {
  it("reads off by default; writes bis and own_domain, emits the event (mutation: drop the emit → no event row, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getInboundSettings(db, accountId)).toEqual({ mode: "off", domain: null });
      await setInboundSettings(db, accountId, { mode: "own_domain", domain: `reply.${RUN}.example.com` }, ACTOR);
      expect(await getInboundSettings(db, accountId)).toEqual({ mode: "own_domain", domain: `reply.${RUN}.example.com` });
      const { data } = await db.from("events").select("type, payload").eq("account_id", accountId).eq("type", "account.inbound_replies_updated");
      expect(data).toEqual([{ type: "account.inbound_replies_updated", payload: { mode: "own_domain", domain: `reply.${RUN}.example.com` } }]);
      await setInboundSettings(db, accountId, { mode: "off", domain: `reply.${RUN}.example.com` }, ACTOR);
      expect((await getInboundSettings(db, accountId)).mode).toBe("off");
    });
  });

  it("throws on an account that does not exist (mutation: drop the no-row check → resolves, FAILS)", async () => {
    await withTestAccount(async (db) => {
      await expect(setInboundSettings(db, "00000000-0000-4000-8000-000000000000", { mode: "bis", domain: null }, ACTOR)).rejects.toThrow(/no account/);
    });
  });
});

describe("inbound rows", () => {
  it("records once per Resend id: a second record answers the first row, created false (mutation: rethrow 23505 → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana3@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const r = row(accountId, t.conversationId);
      const a = await recordInboundEmail(db, r);
      const b = await recordInboundEmail(db, { ...r, text: "a different body" });
      expect(a.created).toBe(true); expect(b.created).toBe(false);
      expect(b.row.id).toBe(a.row.id); expect(b.row.text).toBe("Sounds good");
      expect(await getInboundEmail(db, accountId, a.row.id)).toEqual(a.row);
    });
  });

  it("decides with a compare-and-set on the status; sets the message only once (mutation: drop .eq('status', from) → the second decide answers true, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana4@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: held } = await recordInboundEmail(db, row(accountId, t.conversationId));
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: ACTOR })).toBe(true);
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: ACTOR })).toBe(false);
      expect((await getInboundEmail(db, accountId, held.id))?.status).toBe("dismissed");
      expect(await decideInboundEmail(db, accountId, held.id, "dismissed", { status: "held", decidedBy: null })).toBe(true);
      const { id: msg } = await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "x" }, ACTOR);
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "filed", messageId: msg, decidedBy: ACTOR })).toBe(true);
      expect(await unfileInboundEmail(db, accountId, held.id, msg)).toBe(true);
      expect((await getInboundEmail(db, accountId, held.id))?.status).toBe("held");
      expect(await listMessages(db, accountId, t.conversationId)).toEqual([]);
      const { row: filed } = await recordInboundEmail(db, row(accountId, t.conversationId, { status: "filed", holdReason: null, decidedBy: "email-inbound" }));
      const { id: msg2 } = await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "y" }, ACTOR);
      expect(await setInboundMessage(db, accountId, filed.id, msg2)).toBe(true);
      expect(await setInboundMessage(db, accountId, filed.id, msg2)).toBe(false);
    });
  });

  it("lists and counts only held rows, newest first, with the thread's customer (mutation: drop .eq('status','held') → the dismissed row is listed and counted, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", lastName: "Ruiz", email: "ana5@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const older = await recordInboundEmail(db, row(accountId, t.conversationId, { receivedAt: "2026-10-15T10:00:00.000Z" }));
      const newer = await recordInboundEmail(db, row(accountId, t.conversationId, { receivedAt: "2026-10-16T10:00:00.000Z" }));
      const gone = await recordInboundEmail(db, row(accountId, t.conversationId));
      await decideInboundEmail(db, accountId, gone.row.id, "held", { status: "dismissed", decidedBy: ACTOR });
      const list = await listHeldInboundEmails(db, accountId);
      expect(list.map((r) => r.id)).toEqual([newer.row.id, older.row.id]);
      expect(list[0]).toMatchObject({ contactId, contactFirstName: "Ana", contactLastName: "Ruiz" });
      expect(await countHeldInboundEmails(db, accountId)).toBe(2);
    });
  });
});

describe("matchSender", () => {
  it("matches the thread's contact, then a member of their household or business, by email_key; never a stranger or a non-member (mutation: drop the group branch → Luis is null, FAILS; match every contact in the account → Pat matches, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "Ana.Ruiz+shop@Example.com" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis", lastName: "Ruiz", email: "luis@example.com" }, ACTOR)).id;
      await createContact(db, accountId, { firstName: "Pat", email: "pat@example.com" }, ACTOR);
      const { data: g } = await db.from("client_groups").insert({ account_id: accountId, kind: "household", name: "Casa Ruiz" }).select("id").single();
      await db.from("client_group_members").insert([
        { account_id: accountId, client_group_id: g!.id, contact_id: ana, is_primary: true },
        { account_id: accountId, client_group_id: g!.id, contact_id: luis },
      ]);
      expect(await matchSender(db, accountId, ana, "ana.ruiz@example.com")).toEqual({ contactId: ana, firstName: "Ana", lastName: null, viaGroup: false });
      expect(await matchSender(db, accountId, ana, "LUIS@example.com")).toEqual({ contactId: luis, firstName: "Luis", lastName: "Ruiz", viaGroup: true });
      expect(await matchSender(db, accountId, ana, "pat@example.com")).toBeNull();
      expect(await matchSender(db, accountId, ana, "stranger@example.com")).toBeNull();
    });
  });
});

describe("messages carry meta", () => {
  it("createMessage writes meta when given and listMessages reads it; an omitted meta is {} (mutation: drop meta from MESSAGE_COLS → undefined, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana6@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "a", meta: { attachment_count: 2 } }, ACTOR);
      await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "outbound", body: "b" }, ACTOR);
      expect((await listMessages(db, accountId, t.conversationId)).map((x) => x.meta)).toEqual([{ attachment_count: 2 }, {}]);
    });
  });
});
```

(If `createContact`'s input type does not take `lastName`/`email` in this shape, read `contacts.ts` and follow it. If `client_groups` needs more columns, read 0069:40-57 and add them.)

- [ ] **Step 3: Run it to see it fail** behind the kit's PostgREST (env names exactly as `pgrst.sh` prints them): `cd packages/db && SUPABASE_URL=http://localhost:55624 SUPABASE_SERVICE_ROLE_KEY=$(cat <SCRATCH>/s06-t3-impl/service.key) node node_modules/vitest/vitest.mjs run src/test/inbound-email.test.ts > <SCRATCH>/s06-t3-impl/red.log 2>&1; echo $? > <SCRATCH>/s06-t3-impl/red.exit`. Expected: module not found. Paste the summary.

- [ ] **Step 4: Write `packages/db/src/inbound-email.ts`:**

```ts
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { ensureConversation } from "./messaging";
import { emailKey } from "./contacts";

/**
 * Inbound email, part 1 (S-06; 0082). Reply tokens, the account's Replies mode, the inbound rows and
 * the sender match. Every write here is server-only (0053): callers pass the service client, after
 * their own proof on the request client where a person acted.
 */
export type InboundMode = "off" | "bis" | "own_domain";
export const INBOUND_MODES: readonly InboundMode[] = ["off", "bis", "own_domain"];
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
/** Twin of 0082's conversations_reply_token_check. */
export const REPLY_TOKEN_PATTERN = /^[0-9a-f]{24}$/;

export type InboundSettings = { mode: InboundMode; domain: string | null };

export function newReplyToken(): string {
  return randomBytes(12).toString("hex");
}

function isMode(v: unknown): v is InboundMode {
  return v === "off" || v === "bis" || v === "own_domain";
}

export async function getInboundSettings(db: SupabaseClient, accountId: string): Promise<InboundSettings> {
  const { data, error } = await db.from("accounts").select("inbound_mode, inbound_domain").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getInboundSettings failed: ${error.message}`);
  const row = data as { inbound_mode: unknown; inbound_domain: string | null } | null;
  return { mode: isMode(row?.inbound_mode) ? row!.inbound_mode as InboundMode : "off", domain: row?.inbound_domain ?? null };
}

/** SERVER ONLY, agency-gated at the call site (no column grant reaches it). */
export async function setInboundSettings(db: SupabaseClient, accountId: string, s: InboundSettings, actorId: string): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ inbound_mode: s.mode, inbound_domain: s.domain }).eq("id", accountId).select("id");
  if (error) throw new Error(`setInboundSettings failed: ${error.message}`);
  if (!data?.length) throw new Error(`setInboundSettings: no account ${accountId}`);
  await emit(db, accountId, "account.inbound_replies_updated", actorId, { mode: s.mode, domain: s.domain });
}

/**
 * The thread's token, made on first need (the conversation too). A compare-and-set on
 * `reply_token is null`, so two senders racing both end with the one stored token.
 */
export async function ensureReplyToken(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string, make: () => string = newReplyToken,
): Promise<{ conversationId: string; token: string }> {
  const { id: conversationId } = await ensureConversation(db, accountId, contactId, actorId, "system");
  const read = async () => {
    const { data, error } = await db.from("conversations").select("reply_token")
      .eq("account_id", accountId).eq("id", conversationId).single();
    if (error) throw new Error(`ensureReplyToken read failed: ${error.message}`);
    return (data as { reply_token: string | null }).reply_token;
  };
  const existing = await read();
  if (existing) return { conversationId, token: existing };
  const { error } = await db.from("conversations").update({ reply_token: make() })
    .eq("account_id", accountId).eq("id", conversationId).is("reply_token", null);
  if (error) throw new Error(`ensureReplyToken write failed: ${error.message}`);
  const stored = await read();
  if (!stored) throw new Error("ensureReplyToken: no token after the write");
  return { conversationId, token: stored };
}

export type ReplyThread = { conversationId: string; accountId: string; contactId: string; revoked: boolean; inboundDomain: string | null };

export async function findReplyThread(db: SupabaseClient, token: string): Promise<ReplyThread | null> {
  if (!REPLY_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await db.from("conversations")
    .select("id, account_id, contact_id, reply_token_revoked_at, accounts(inbound_domain)")
    .eq("reply_token", token).maybeSingle();
  if (error) throw new Error(`findReplyThread failed: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as { id: string; account_id: string; contact_id: string; reply_token_revoked_at: string | null; accounts: { inbound_domain: string | null } | null };
  return { conversationId: r.id, accountId: r.account_id, contactId: r.contact_id, revoked: r.reply_token_revoked_at !== null, inboundDomain: r.accounts?.inbound_domain ?? null };
}

export type InboundStatus = "filed" | "held" | "dismissed";
export type HoldReason = "not_on_record" | "unverified";
export type InboundAuthRecord = { spf: string | null; dkim: string | null; dmarc: string | null; spam: string | null; virus: string | null };
export type InboundEmailRow = {
  id: string; accountId: string; conversationId: string; providerEmailId: string;
  fromEmail: string; fromName: string | null; toEmail: string; subject: string | null; text: string;
  auth: InboundAuthRecord; status: InboundStatus; holdReason: HoldReason | null; messageId: string | null;
  decidedBy: string | null; decidedAt: string | null; receivedAt: string;
};
export type NewInboundEmail = Omit<InboundEmailRow, "id" | "messageId" | "decidedBy" | "decidedAt"> & { decidedBy: string | null };

const COLS = "id, account_id, conversation_id, provider_email_id, from_email, from_name, to_email, subject, text, auth, status, hold_reason, message_id, decided_by, decided_at, received_at";
type Raw = {
  id: string; account_id: string; conversation_id: string; provider_email_id: string; from_email: string; from_name: string | null;
  to_email: string; subject: string | null; text: string; auth: InboundAuthRecord; status: InboundStatus; hold_reason: HoldReason | null;
  message_id: string | null; decided_by: string | null; decided_at: string | null; received_at: string;
};
const toRow = (r: Raw): InboundEmailRow => ({
  id: r.id, accountId: r.account_id, conversationId: r.conversation_id, providerEmailId: r.provider_email_id,
  fromEmail: r.from_email, fromName: r.from_name, toEmail: r.to_email, subject: r.subject, text: r.text, auth: r.auth,
  status: r.status, holdReason: r.hold_reason, messageId: r.message_id, decidedBy: r.decided_by, decidedAt: r.decided_at,
  // Normalised so a row read back equals the row first answered (PostgREST spells timestamptz its own way).
  receivedAt: new Date(r.received_at).toISOString(),
});

/** Inserts; a second delivery of the same Resend id answers the stored row with created false. */
export async function recordInboundEmail(db: SupabaseClient, row: NewInboundEmail): Promise<{ row: InboundEmailRow; created: boolean }> {
  const { data, error } = await db.from("inbound_emails").insert({
    account_id: row.accountId, conversation_id: row.conversationId, provider_email_id: row.providerEmailId,
    from_email: row.fromEmail, from_name: row.fromName, to_email: row.toEmail, subject: row.subject,
    text: row.text.slice(0, 100000), auth: row.auth, status: row.status, hold_reason: row.holdReason,
    decided_by: row.decidedBy, decided_at: row.decidedBy ? new Date().toISOString() : null, received_at: row.receivedAt,
  }).select(COLS).single();
  if (!error && data) return { row: toRow(data as Raw), created: true };
  if (error?.code !== "23505") throw new Error(`recordInboundEmail failed: ${error?.message}`);
  const { data: again, error: e2 } = await db.from("inbound_emails").select(COLS).eq("provider_email_id", row.providerEmailId).single();
  if (e2 || !again) throw new Error(`recordInboundEmail re-read failed: ${e2?.message}`);
  return { row: toRow(again as Raw), created: false };
}

export async function getInboundEmail(db: SupabaseClient, accountId: string, id: string): Promise<InboundEmailRow | null> {
  const { data, error } = await db.from("inbound_emails").select(COLS).eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getInboundEmail failed: ${error.message}`);
  return data ? toRow(data as Raw) : null;
}

/** Points a filed row at its message, once (message_id is null). */
export async function setInboundMessage(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({ message_id: messageId })
    .eq("account_id", accountId).eq("id", id).is("message_id", null).select("id");
  if (error) throw new Error(`setInboundMessage failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** A compare-and-set on the status the caller saw; false when someone moved it first. */
export async function decideInboundEmail(
  db: SupabaseClient, accountId: string, id: string, from: InboundStatus,
  to: { status: InboundStatus; messageId?: string | null; decidedBy: string | null },
): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({
    status: to.status,
    ...(to.messageId !== undefined ? { message_id: to.messageId } : {}),
    decided_by: to.decidedBy, decided_at: to.decidedBy ? new Date().toISOString() : null,
  }).eq("account_id", accountId).eq("id", id).eq("status", from).select("id");
  if (error) throw new Error(`decideInboundEmail failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** The Undo of a manual File (0082's unfile_inbound_email: the row back to held, the message deleted). */
export async function unfileInboundEmail(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.rpc("unfile_inbound_email", { p_account_id: accountId, p_id: id, p_message_id: messageId });
  if (error) throw new Error(`unfileInboundEmail failed: ${error.message}`);
  return data === true;
}

export type HeldInboundEmail = InboundEmailRow & { contactId: string; contactFirstName: string | null; contactLastName: string | null };

export async function listHeldInboundEmails(db: SupabaseClient, accountId: string, opts: { limit?: number } = {}): Promise<HeldInboundEmail[]> {
  const { data, error } = await db.from("inbound_emails")
    .select(`${COLS}, conversations!inbound_emails_conversation_fkey(contact_id, contacts(first_name, last_name))`)
    .eq("account_id", accountId).eq("status", "held")
    .order("received_at", { ascending: false }).order("id", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`listHeldInboundEmails failed: ${error.message}`);
  return ((data ?? []) as unknown as (Raw & { conversations: { contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null } })[]).map((r) => ({
    ...toRow(r), contactId: r.conversations.contact_id,
    contactFirstName: r.conversations.contacts?.first_name ?? null, contactLastName: r.conversations.contacts?.last_name ?? null,
  }));
}

/** THROWS on a null count (memory "head-count null": a failed head read can answer count null, error null). */
export async function countHeldInboundEmails(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from("inbound_emails").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("status", "held");
  if (error) throw new Error(`countHeldInboundEmails failed: ${error.message}`);
  if (count === null) throw new Error("countHeldInboundEmails: no count");
  return count;
}

export type SenderMatch = { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean };

/** The thread's contact first; else a member of any household or business that contact belongs to. */
export async function matchSender(db: SupabaseClient, accountId: string, contactId: string, fromEmail: string): Promise<SenderMatch | null> {
  const key = emailKey(fromEmail);
  if (!key) return null;
  const { data: me, error } = await db.from("contacts").select("id, first_name, last_name, email_key")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`matchSender contact read failed: ${error.message}`);
  const self = me as { id: string; first_name: string | null; last_name: string | null; email_key: string | null } | null;
  if (self?.email_key === key) return { contactId: self.id, firstName: self.first_name, lastName: self.last_name, viaGroup: false };
  const { data: groups, error: gErr } = await db.from("client_group_members").select("client_group_id")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (gErr) throw new Error(`matchSender groups read failed: ${gErr.message}`);
  const groupIds = ((groups ?? []) as { client_group_id: string }[]).map((g) => g.client_group_id);
  if (groupIds.length === 0) return null;
  const { data: members, error: mErr } = await db.from("client_group_members")
    .select("contact_id, contacts!inner(first_name, last_name, email_key)")
    .eq("account_id", accountId).in("client_group_id", groupIds).eq("contacts.email_key", key)
    .order("contact_id").limit(1);
  if (mErr) throw new Error(`matchSender members read failed: ${mErr.message}`);
  const hit = ((members ?? []) as unknown as { contact_id: string; contacts: { first_name: string | null; last_name: string | null } }[])[0];
  return hit ? { contactId: hit.contact_id, firstName: hit.contacts.first_name, lastName: hit.contacts.last_name, viaGroup: true } : null;
}
```

(**ASSUMPTION** checked by this task's tests: PostgREST resolves the embed hint `conversations!inbound_emails_conversation_fkey` and the `accounts(inbound_domain)` embed from `conversations`. If either fails, use two reads and say so. `email_key` is a stored column on `contacts`, read via `contacts.ts:258` — `.eq("email_key", eKey)`.)

- [ ] **Step 5: `messaging.ts`, `consent.ts`, the barrel.** In `NewMessage` add, after `status?`:

```ts
  /** S-06 part 1: an inbound email's own facts (meta.inbound_email_id, meta.attachment_count,
   *  meta.sender, meta.consent). Unset for every other writer, which keeps the column default {}. */
  meta?: Record<string, unknown>;
```

In `createMessage`'s insert, after the `status` spread: `...(input.meta !== undefined ? { meta: input.meta } : {}),`. `MESSAGE_COLS` gains `meta` before `created_at`. In `CONSENT_METHODS`, after the 0062 pair: `// 0082 (S-06 part 1): a clear stop in a customer's emailed reply.` then `"inbound_email",`. In `index.ts`, after the `./sending-identity` line:

```ts
// S-06 part 1: inbound email (0082).
export {
  INBOUND_MODES, BIS_REPLY_DOMAIN, REPLY_TOKEN_PATTERN, newReplyToken, getInboundSettings, setInboundSettings,
  ensureReplyToken, findReplyThread, recordInboundEmail, getInboundEmail, setInboundMessage, decideInboundEmail,
  unfileInboundEmail, listHeldInboundEmails, countHeldInboundEmails, matchSender,
  type InboundMode, type InboundSettings, type ReplyThread, type InboundStatus, type HoldReason, type InboundAuthRecord,
  type InboundEmailRow, type NewInboundEmail, type HeldInboundEmail, type SenderMatch,
} from "./inbound-email";
```

Update every pin Step 1's two greps found (the `CONSENT_METHODS` list in its test gains `"inbound_email"`; any `MESSAGE_COLS` string gains `meta`).

- [ ] **Step 6: Run to pass.** The new test behind the kit; the consent suites from Step 1's grep, `inbound-email-schema.test.ts` and `schema-grants-guard.test.ts` on `post`; `pnpm --filter @bis/db exec tsc --noEmit -p .` (or the package's typecheck script; read `packages/db/package.json`); `pnpm --filter web typecheck` (web imports db as source). All PASS; paste the summary blocks.
- [ ] **Step 7: Probes, each by name:** (a) `ensureReplyToken` without `.is("reply_token", null)` and with `make` called every time → the once case FAILS; (b) `countHeldInboundEmails` without `.eq("status", "held")` → FAILS on 3; (c) `matchSender` without the group branch → FAILS on Luis; (d) `matchSender` reading every contact of the account (`.in("client_group_id", …)` removed) → FAILS on Pat; (e) `recordInboundEmail` rethrowing 23505 → the record case FAILS; (f) `MESSAGE_COLS` without `meta` → the meta case FAILS. Paste each.
- [ ] **Step 8: Commit** `-- packages/db/src/inbound-email.ts packages/db/src/test/inbound-email.test.ts packages/db/src/messaging.ts packages/db/src/consent.ts packages/db/src/index.ts <each pin file Step 5 changed>`, message "db: reply tokens, the Replies mode, inbound rows and the sender match; messages carry meta (S-06 part 1)".

---

## Task 4: Pure parsers: the address, `Authentication-Results`, the new text (bis-comms)

**Review:** opus. **Runs beside:** Tasks 1, 2, 7. No `@bis/db` import (pure; browser-safe not required, but no I/O).

**Files**
- Create: `apps/web/src/lib/email/inbound/address.ts`, `address.test.ts`
- Create: `apps/web/src/lib/email/inbound/auth-results.ts`, `auth-results.test.ts`
- Create: `apps/web/src/lib/email/inbound/new-text.ts`, `new-text.test.ts`

**Interfaces**
- Produces:

```ts
// address.ts
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";   // the same literal as @bis/db's; a test pins they agree
export type ReplyAddress = { token: string; domain: string };
export function bareAddress(raw: string | null | undefined): string | null;      // "Ana <A@X.com>" → "a@x.com"
export function displayName(raw: string | null | undefined): string | null;      // "Ana Ruiz <a@x.com>" → "Ana Ruiz"
export function parseReplyAddress(raw: string): ReplyAddress | null;              // "r-<24 hex>@domain"
export function replyAddressFor(token: string, s: { mode: "off" | "bis" | "own_domain"; domain: string | null }): string | null;
export function domainOf(address: string): string | null;
// auth-results.ts
export type HeaderList = readonly (readonly [name: string, value: string])[];
export function parseHeaderBlock(raw: string): HeaderList;     // names lowercased, folded lines unfolded, top to bottom
export type SesVerdict = { found: boolean; spf: string | null; dmarc: string | null; dkim: { result: string; domain: string | null }[]; spam: string | null; virus: string | null };
export function readSesVerdict(headers: HeaderList): SesVerdict;
export function senderAuthenticated(v: SesVerdict, fromDomain: string | null): boolean;
export function authRecord(v: SesVerdict): { spf: string | null; dkim: string | null; dmarc: string | null; spam: string | null; virus: string | null };
// new-text.ts
export function htmlToText(html: string): string;
export function newText(text: string): string;
```

- [ ] **Step 1: Write the failing tests.** `address.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BIS_REPLY_DOMAIN as DB_DOMAIN } from "@bis/db";
import { BIS_REPLY_DOMAIN, bareAddress, displayName, parseReplyAddress, replyAddressFor, domainOf } from "./address";

const T = "0123456789abcdef01234567";

describe("the reply address", () => {
  it("agrees with @bis/db's domain (mutation: change either literal → FAILS)", () => {
    expect(BIS_REPLY_DOMAIN).toBe(DB_DOMAIN);
  });

  it("parses r-<token>@domain, case-insensitively, with or without a display name (mutation: drop the lowercase → the uppercase form is null, FAILS)", () => {
    expect(parseReplyAddress(`r-${T}@reply.bis-rgv.com`)).toEqual({ token: T, domain: "reply.bis-rgv.com" });
    expect(parseReplyAddress(`"Rio" <R-${T.toUpperCase()}@Reply.Example.com>`)).toEqual({ token: T, domain: "reply.example.com" });
  });

  it("refuses anything that is not exactly one r- token (mutation: accept any length → the 23-char token parses, FAILS)", () => {
    for (const bad of [`r-${T.slice(1)}@reply.bis-rgv.com`, `${T}@reply.bis-rgv.com`, `r-${T}x@reply.bis-rgv.com`, `r-${T}`, "", `s-${T}@reply.bis-rgv.com`, `r-${T}@`]) {
      expect(parseReplyAddress(bad), bad).toBeNull();
    }
  });

  it("builds the Reply-To for bis and own_domain, nothing for off or own_domain without a domain (mutation: answer the BIS domain for own_domain → FAILS)", () => {
    expect(replyAddressFor(T, { mode: "bis", domain: "reply.example.com" })).toBe(`r-${T}@reply.bis-rgv.com`);
    expect(replyAddressFor(T, { mode: "own_domain", domain: "reply.example.com" })).toBe(`r-${T}@reply.example.com`);
    expect(replyAddressFor(T, { mode: "own_domain", domain: null })).toBeNull();
    expect(replyAddressFor(T, { mode: "off", domain: null })).toBeNull();
  });

  it("reads a bare address and a display name out of a From value (mutation: keep the brackets → FAILS)", () => {
    expect(bareAddress("Ana Ruiz <Ana@Example.COM>")).toBe("ana@example.com");
    expect(bareAddress("ana@example.com")).toBe("ana@example.com");
    expect(bareAddress("not an address")).toBeNull();
    expect(displayName(`"Ana Ruiz" <ana@example.com>`)).toBe("Ana Ruiz");
    expect(displayName("ana@example.com")).toBeNull();
    expect(domainOf("ana@Mail.Example.com")).toBe("mail.example.com");
  });
});
```

`auth-results.test.ts` (the headers are the spike's shape, with a forged one written by the sender below SES's):

```ts
import { describe, it, expect } from "vitest";
import { parseHeaderBlock, readSesVerdict, senderAuthenticated, authRecord } from "./auth-results";

const SES = [
  "Authentication-Results: amazonses.com;",
  " spf=pass (spfCheck: domain of gmail.com designates 209.85.0.1 as permitted sender) client-ip=209.85.0.1; envelope-from=ana@gmail.com; helo=mail.gmail.com;",
  " dkim=pass header.i=@gmail.com;",
  " dmarc=pass header.from=gmail.com;",
  "X-SES-Spam-Verdict: PASS",
  "X-SES-Virus-Verdict: PASS",
].join("\r\n");
const FORGED = "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@bank.com; dmarc=pass header.from=bank.com;";
const raw = (top: string, rest = "") => `${top}\r\nFrom: Ana <ana@gmail.com>\r\nSubject: Re: Hi\r\n${rest}\r\nbody line\r\n`;

describe("parseHeaderBlock", () => {
  it("stops at the first blank line, lowercases names, unfolds continuation lines, keeps order (mutation: read past the blank line → 'body line' is a header, FAILS)", () => {
    const h = parseHeaderBlock(raw(SES));
    expect(h[0]![0]).toBe("authentication-results");
    expect(h[0]![1]).toContain("dkim=pass header.i=@gmail.com;");
    expect(h.map(([n]) => n)).toEqual(["authentication-results", "x-ses-spam-verdict", "x-ses-virus-verdict", "from", "subject"]);
  });
});

describe("readSesVerdict: ONLY the topmost amazonses.com header (spec 'Rule from the spike')", () => {
  it("reads spf, dkim with its domain, dmarc and both verdicts (mutation: read the LAST matching header → the forged bank.com dkim, FAILS)", () => {
    const v = readSesVerdict(parseHeaderBlock(raw(SES, `${FORGED}\r\n`)));
    expect(v).toEqual({ found: true, spf: "pass", dmarc: "pass", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS" });
  });

  it("ignores an Authentication-Results from any other authserv-id, even above (mutation: take the first header of any id → mx.google.com's fail is read, FAILS)", () => {
    const other = "Authentication-Results: mx.google.com; spf=fail; dkim=fail; dmarc=fail";
    const v = readSesVerdict(parseHeaderBlock(raw(`${other}\r\n${SES}`)));
    expect(v.spf).toBe("pass");
  });

  it("no amazonses.com header reads as not found, every field null (mutation: default spf to 'pass' → FAILS)", () => {
    expect(readSesVerdict(parseHeaderBlock(raw("X-Other: 1")))).toEqual({ found: false, spf: null, dmarc: null, dkim: [], spam: null, virus: null });
  });

  it("reads header.d when there is no header.i", () => {
    const v = readSesVerdict(parseHeaderBlock(raw("Authentication-Results: amazonses.com; spf=pass; dkim=pass header.d=shop.example; dmarc=none")));
    expect(v.dkim).toEqual([{ result: "pass", domain: "shop.example" }]);
  });
});

describe("senderAuthenticated (spec Inbound step 4)", () => {
  const v = (over: Partial<ReturnType<typeof readSesVerdict>>) => ({ found: true, spf: "pass", dmarc: "pass", dkim: [{ result: "pass", domain: "gmail.com" }], spam: "PASS", virus: "PASS", ...over });

  it("dmarc=pass with both verdicts PASS → true", () => {
    expect(senderAuthenticated(v({}), "gmail.com")).toBe(true);
  });

  it("dmarc=none: true only with spf=pass AND a passing dkim ON the From domain (mutation: accept spf alone → FAILS; accept any dkim domain → FAILS)", () => {
    expect(senderAuthenticated(v({ dmarc: "none" }), "gmail.com")).toBe(true);
    expect(senderAuthenticated(v({ dmarc: "none", spf: "softfail" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "pass", domain: "other.com" }] }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "fail", domain: "gmail.com" }] }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: "none", dkim: [{ result: "pass", domain: "mail.gmail.com" }] }), "gmail.com")).toBe(false);   // G15: exact
  });

  it("dmarc fail, missing headers, or a verdict other than PASS → false (mutation: skip the verdict check → the FAIL spam case is true, FAILS)", () => {
    expect(senderAuthenticated(v({ dmarc: "fail" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ dmarc: null }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ spam: "FAIL" }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ virus: null }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({ found: false }), "gmail.com")).toBe(false);
    expect(senderAuthenticated(v({}), null)).toBe(false);
  });

  it("authRecord keeps what the row stores (mutation: drop dkim → FAILS)", () => {
    expect(authRecord(v({ dkim: [{ result: "fail", domain: "x.com" }, { result: "pass", domain: "gmail.com" }] }))).toEqual({ spf: "pass", dkim: "fail,pass", dmarc: "pass", spam: "PASS", virus: "PASS" });
  });
});
```

`new-text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newText, htmlToText } from "./new-text";

describe("newText: the reply without its quoted history (spec Inbound step 5)", () => {
  it("cuts at Gmail's English marker, on one or two lines (mutation: drop the 'On … wrote:' rule → the quote stays, FAILS)", () => {
    expect(newText("Sounds good, see you then.\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio Roofing <crm@bis-rgv.com> wrote:\n> Your appointment is at 3.")).toBe("Sounds good, see you then.");
    expect(newText("Yes\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio Roofing <\ncrm@bis-rgv.com> wrote:\n> x")).toBe("Yes");
  });

  it("cuts at the Spanish marker (mutation: drop 'El … escribió:' → FAILS)", () => {
    expect(newText("Sí, ahí estaré.\n\nEl mar, 14 oct 2026 a las 15:00, Rio Roofing (<crm@bis-rgv.com>) escribió:\n> Su cita es a las 3.")).toBe("Sí, ahí estaré.");
  });

  it("drops '>' lines and cuts at Outlook's From: block, English and Spanish (mutation: drop the Outlook rule → FAILS)", () => {
    expect(newText("Thanks!\n> old line\n> older")).toBe("Thanks!");
    expect(newText("Ok\r\n\r\n________________________________\r\nFrom: Rio Roofing <crm@bis-rgv.com>\r\nSent: Tuesday\r\nSubject: Hi")).toBe("Ok");
    expect(newText("Vale\n\nDe: Rio Roofing <crm@bis-rgv.com>\nEnviado: martes\nAsunto: Hola")).toBe("Vale");
    expect(newText("Vale\n\n-----Original Message-----\nFrom: x")).toBe("Vale");
  });

  it("keeps a body that only mentions 'from' mid-sentence, and an empty reply stays empty (mutation: cut at any 'From' → FAILS)", () => {
    expect(newText("I got a quote from: Bob's.\nCan you beat it?")).toBe("I got a quote from: Bob's.\nCan you beat it?");
    expect(newText("> only a quote")).toBe("");
  });
});

describe("htmlToText (G11)", () => {
  it("drops tags, turns br and block ends into line breaks, decodes the five entities (mutation: skip &amp; → FAILS)", () => {
    expect(htmlToText("<div>Hi &amp; thanks<br>See you</div><p>Ana &lt;3 &quot;x&quot; &#39;y&#39;</p><style>p{}</style>")).toBe("Hi & thanks\nSee you\nAna <3 \"x\" 'y'");
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/email/inbound/address.test.ts src/lib/email/inbound/auth-results.test.ts src/lib/email/inbound/new-text.test.ts` → modules not found.

- [ ] **Step 3: Implement.** `address.ts`:

```ts
/** S-06 part 1: the r-<token>@<reply domain> address (spec decision 5). Pure. */
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
export type ReplyAddress = { token: string; domain: string };

const ANGLE = /<([^<>\s]+@[^<>\s]+)>/;
const BARE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function bareAddress(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const inner = ANGLE.exec(v)?.[1] ?? v;
  const a = inner.trim().toLowerCase();
  return BARE.test(a) ? a : null;
}

export function displayName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const i = v.indexOf("<");
  if (i <= 0) return null;
  const name = v.slice(0, i).trim().replace(/^"(.*)"$/, "$1").trim();
  return name || null;
}

export function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  const d = at > 0 ? address.slice(at + 1).trim().toLowerCase() : "";
  return d || null;
}

const LOCAL = /^r-([0-9a-f]{24})$/;

export function parseReplyAddress(raw: string): ReplyAddress | null {
  const a = bareAddress(raw);
  if (!a) return null;
  const at = a.lastIndexOf("@");
  const m = LOCAL.exec(a.slice(0, at));
  const domain = a.slice(at + 1);
  return m && domain ? { token: m[1]!, domain } : null;
}

export function replyAddressFor(token: string, s: { mode: "off" | "bis" | "own_domain"; domain: string | null }): string | null {
  if (s.mode === "bis") return `r-${token}@${BIS_REPLY_DOMAIN}`;
  if (s.mode === "own_domain" && s.domain) return `r-${token}@${s.domain}`;
  return null;
}
```

`auth-results.ts`:

```ts
/**
 * S-06 part 1, "Rule from the spike": read ONLY the topmost Authentication-Results header whose
 * authserv-id is amazonses.com (Resend's receiving MTA stamps it; a sender can write its own lower in
 * the message, and that one is ignored). X-SES-Spam-Verdict / X-SES-Virus-Verdict: the topmost of
 * each. Pure; the raw header block comes from the received message (plan G5, A1, A2).
 */
export type HeaderList = readonly (readonly [name: string, value: string])[];

export function parseHeaderBlock(raw: string): HeaderList {
  const lines = raw.split(/\r\n|\n/);
  const out: [string, string][] = [];
  for (const line of lines) {
    if (line === "") break;
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1]![1] += ` ${line.trim()}`;
      continue;
    }
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
  }
  return out;
}

export type SesVerdict = {
  found: boolean; spf: string | null; dmarc: string | null;
  dkim: { result: string; domain: string | null }[]; spam: string | null; virus: string | null;
};

const first = (h: HeaderList, name: string) => h.find(([n]) => n === name)?.[1] ?? null;

export function readSesVerdict(headers: HeaderList): SesVerdict {
  const spam = first(headers, "x-ses-spam-verdict")?.trim() ?? null;
  const virus = first(headers, "x-ses-virus-verdict")?.trim() ?? null;
  const ar = headers.find(([n, v]) => n === "authentication-results" && v.split(";")[0]!.trim().toLowerCase() === "amazonses.com")?.[1];
  if (!ar) return { found: false, spf: null, dmarc: null, dkim: [], spam, virus };
  let spf: string | null = null;
  let dmarc: string | null = null;
  const dkim: { result: string; domain: string | null }[] = [];
  for (const part of ar.split(";").slice(1)) {
    const m = /^\s*(spf|dkim|dmarc)=([a-z]+)/i.exec(part);
    if (!m) continue;
    const method = m[1]!.toLowerCase();
    const result = m[2]!.toLowerCase();
    if (method === "spf" && spf === null) spf = result;
    else if (method === "dmarc" && dmarc === null) dmarc = result;
    else if (method === "dkim") {
      const i = /header\.i=@?([^\s;]+)/i.exec(part)?.[1];
      const d = /header\.d=([^\s;]+)/i.exec(part)?.[1];
      const raw = (i ?? d ?? "").toLowerCase();
      dkim.push({ result, domain: raw ? (raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : raw) : null });
    }
  }
  return { found: true, spf, dmarc, dkim, spam, virus };
}

export function senderAuthenticated(v: SesVerdict, fromDomain: string | null): boolean {
  if (!v.found || !fromDomain) return false;
  if (v.spam !== "PASS" || v.virus !== "PASS") return false;
  if (v.dmarc === "pass") return true;
  if (v.dmarc !== "none") return false;
  return v.spf === "pass" && v.dkim.some((k) => k.result === "pass" && k.domain === fromDomain.toLowerCase());
}

export function authRecord(v: SesVerdict) {
  return { spf: v.spf, dkim: v.dkim.length ? v.dkim.map((k) => k.result).join(",") : null, dmarc: v.dmarc, spam: v.spam, virus: v.virus };
}
```

`new-text.ts`:

```ts
/** S-06 part 1, Inbound step 5: the reply's new text, English and Spanish quote markers stripped. Pure. */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .split("\n").map((l) => l.trim()).filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n")
    .trim();
}

/** A line where the quoted history starts; everything from it on is dropped. */
const CUT: readonly RegExp[] = [
  /^On .+ wrote:\s*$/i,                         // Gmail, Apple Mail (EN)
  /^El .+ escribió:\s*$/i,                      // Gmail (ES)
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,     // Outlook (EN)
  /^-{2,}\s*Mensaje original\s*-{2,}\s*$/i,     // Outlook (ES)
  /^_{10,}\s*$/,                                // Outlook's rule above its From: block
];
// Outlook's "From:/De:" block cuts only when the next line is Sent/Enviado, Date/Fecha, To/Para or
// Subject/Asunto (the `outlookFrom` test below), so "a quote from: Bob's" mid-body is kept.

export function newText(text: string): string {
  // Two-line Gmail markers ("On … <\n…> wrote:") are joined first.
  const lines = text.replace(/\r\n/g, "\n").replace(/(^On [^\n]+)\n([^\n]*wrote:\s*$)/gim, "$1 $2").replace(/(^El [^\n]+)\n([^\n]*escribió:\s*$)/gim, "$1 $2").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const outlookFrom = /^(From|De):\s.+$/.test(line) && /^(Sent|Enviado|Date|Fecha|To|Para|Subject|Asunto):/i.test(lines[i + 1] ?? "");
    if (CUT.some((r) => r.test(line)) || outlookFrom) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}
```

- [ ] **Step 4: Run to pass** (the three files) plus `pnpm --filter web typecheck` and eslint on the six files. PASS.
- [ ] **Step 5: Probes, each by name:** (a) `readSesVerdict` with `findLast` instead of `find` → the forged case FAILS; (b) the authserv-id check removed → the mx.google.com case FAILS; (c) `senderAuthenticated` without the verdict line → FAILS; (d) the `dmarc === "none"` branch accepting `spf` alone → FAILS; (e) `newText` without the Spanish CUT → FAILS; (f) `parseReplyAddress` with `{20,}` → the short-token case FAILS. Paste each.
- [ ] **Step 6: Commit** the six files, message "email: the reply address, the topmost Resend auth header and the reply's new text, as pure functions (S-06 part 1)".

---

## Task 5: The email stop classifier; the stop's Undo; the Email row's "how" (bis-comms)

**Review:** opus. **After:** Tasks 2, 3.

**Files**
- Create: `apps/web/src/lib/consent/email-stop.ts`, `email-stop.test.ts`
- Modify: `apps/web/src/lib/consent/email-staff-actions.ts` (+ `email-staff-actions.test.ts`): `recordInboundStop`, `undoInboundStop`
- Modify: `apps/web/src/lib/consent/email-view.ts:14-41` (+ test): `EmailHow` gains `{ kind: "reply" }`; `emailHowOf("inbound_email")` → it
- Modify: `apps/web/src/lib/consent/email-row.ts:34-55` (+ test): the `reply` how line and its no-resume line

**Interfaces**
- Consumes: `matchKeyword`, `CANCEL_WORDS` (`keywords.ts:31,46`), `matchPhrase` (`phrases.ts:225`), `appendConsentEventGuarded`, `readConsentEvent`, `readConsentHistory`, `newestDecidingRow` (`@bis/db`), the key `contact.email.how.reply` (Task 2).
- Produces:

```ts
// email-stop.ts
export type EmailStopClass = { kind: "clear"; phrase: string } | { kind: "unclear"; phrase: string } | { kind: "none" };
export function classifyEmailStop(newText: string): EmailStopClass;
// email-staff-actions.ts
export type InboundStopResult = { outcome: "stopped"; eventId: string } | { outcome: "already_stopped" };
export async function recordInboundStop(writer: SupabaseClient, i: { accountId: string; contactId: string; address: string; providerEmailId: string; phrase: string }): Promise<InboundStopResult>;   // THROWS on a ledger error
export function undoInboundStop(ctx: EmailContext, eventId: string): Promise<EmailActionResult>;
```

- [ ] **Step 1: Read** `email-staff-actions.ts` whole (`write`, `guarded`, `changed`, `undoStopEmails`), `email-staff-actions.test.ts:1-60` (its mocks), `email-view.ts`, `email-row.ts:25-60`, `keywords.ts:13-50`, `phrases.ts:225-250`.
- [ ] **Step 2: Failing tests.** `email-stop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyEmailStop } from "./email-stop";

describe("classifyEmailStop (spec 'The stop rule'; plan G4)", () => {
  it("a stop keyword is a clear stop, English and Spanish (mutation: answer unclear for keywords → FAILS)", () => {
    expect(classifyEmailStop("STOP")).toEqual({ kind: "clear", phrase: "STOP" });
    expect(classifyEmailStop("unsubscribe")).toEqual({ kind: "clear", phrase: "UNSUBSCRIBE" });
    expect(classifyEmailStop("Baja")).toEqual({ kind: "clear", phrase: "BAJA" });
  });

  it("a keyword on the first line above a phone signature is still clear (mutation: classify the whole text only → none, FAILS)", () => {
    expect(classifyEmailStop("Stop\n\nSent from my iPhone")).toEqual({ kind: "clear", phrase: "STOP" });
    expect(classifyEmailStop("Baja\n\nEnviado desde mi iPhone")).toEqual({ kind: "clear", phrase: "BAJA" });
  });

  it("CANCEL / CANCELAR are unclear: on a reply to a reminder they mean the appointment (mutation: treat them as clear → FAILS)", () => {
    expect(classifyEmailStop("Cancel")).toEqual({ kind: "unclear", phrase: "CANCEL" });
    expect(classifyEmailStop("cancelar")).toEqual({ kind: "unclear", phrase: "CANCELAR" });
  });

  it("a stop sentence is unclear (mutation: answer clear for phrases → FAILS)", () => {
    expect(classifyEmailStop("Please remove me from your list")).toEqual({ kind: "unclear", phrase: "remove me" });
    expect(classifyEmailStop("No quiero más mensajes, gracias")).toEqual({ kind: "unclear", phrase: "no quiero mas mensajes" });
  });

  it("ordinary replies, an empty one, and 'stop by Thursday' are none (mutation: match 'stop' anywhere → FAILS)", () => {
    for (const t of ["Sounds good, see you Tuesday", "", "Can you stop by Thursday?", "Gracias, ahí estaré"]) expect(classifyEmailStop(t), t).toEqual({ kind: "none" });
  });
});
```

In `email-staff-actions.test.ts`, append (reusing that file's existing `vi.mock("@bis/db", …)` and context helper; read them first and use their names):

```ts
describe("recordInboundStop (spec 'The stop rule'; plan G3)", () => {
  it("appends revoked / inbound_email under if_allowed, sourced on the Resend id, with the phrase as evidence (mutation: guard 'none' → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "ev_1", prior: null });
    expect(await recordInboundStop(WRITER, { accountId: ACCOUNT, contactId: CONTACT, address: "ana@example.com", providerEmailId: "re_1", phrase: "STOP" }))
      .toEqual({ outcome: "stopped", eventId: "ev_1" });
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(WRITER, {
      accountId: ACCOUNT, channel: "email", address: "ana@example.com", action: "revoked", method: "inbound_email",
      contactId: CONTACT, actorId: null, sourceRef: "inbound_email:re_1", evidence: { inbound_email_id: "re_1", phrase: "STOP" },
    }, "if_allowed");
  });

  it("a retried delivery answers the same event; an already-stopped address answers already_stopped (mutation: map duplicate to already_stopped → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "duplicate", id: "ev_1" });
    expect((await recordInboundStop(WRITER, { accountId: ACCOUNT, contactId: CONTACT, address: "a@x.com", providerEmailId: "re_1", phrase: "STOP" })).outcome).toBe("stopped");
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: { id: "ev_0", action: "revoked", method: "unsubscribe_link", evidence: {} } });
    expect(await recordInboundStop(WRITER, { accountId: ACCOUNT, contactId: CONTACT, address: "a@x.com", providerEmailId: "re_2", phrase: "STOP" })).toEqual({ outcome: "already_stopped" });
  });

  it("a ledger error THROWS, so the route answers 503 (mutation: catch it → resolves, FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValueOnce(new Error("append_consent_event failed: down"));
    await expect(recordInboundStop(WRITER, { accountId: ACCOUNT, contactId: CONTACT, address: "a@x.com", providerEmailId: "re_3", phrase: "STOP" })).rejects.toThrow(/down/);
  });
});

describe("undoInboundStop", () => {
  it("writes resubscribed / staff_undo over that inbound stop, if it is still newest; any member may (mutation: require actor_id === userId → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: CTX.address, action: "revoked", method: "inbound_email", actor_id: null, occurred_at: new Date().toISOString() });
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "ev_2", prior: null });
    const r = await undoInboundStop(CTX, "ev_1");
    expect(r.ok).toBe(true);
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(CTX.writer, expect.objectContaining({ action: "resubscribed", method: "staff_undo", evidence: expect.objectContaining({ undoes: "ev_1" }) }), { ifNewest: "ev_1" });
  });

  it("refuses a row that is not an inbound_email stop at this address (mutation: drop the method check → a staff stop is undone here, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ id: "ev_1", channel: "email", address: CTX.address, action: "revoked", method: "staff", actor_id: "u", occurred_at: new Date().toISOString() });
    expect((await undoInboundStop(CTX, "ev_1")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});
```

(`WRITER`, `CTX`, `ACCOUNT`, `CONTACT`, `db` are the names that test file already uses or must add at its top; read it first and match. If its `db` mock lacks `appendConsentEventGuarded` or `readConsentEvent`, add them: the vi.mock factory check.)

In `email-view.test.ts`: `expect(emailHowOf("inbound_email")).toEqual({ kind: "reply" })` (mutation: fall through to `staff` → FAILS). In `email-row.test.ts`: the how line for `{ kind: "reply" }` renders "they asked in a reply" in English and "lo pidió en una respuesta" in Spanish, through `renderedText`, against literals.

- [ ] **Step 3: Run them to see them fail** (the four test files by path).
- [ ] **Step 4: Implement.** `email-stop.ts`:

```ts
import { matchKeyword, CANCEL_WORDS } from "./keywords";
import { matchPhrase } from "./phrases";

/**
 * The emailed stop (spec "The stop rule"; plan G4): the texts' own matchers, on a reply's NEW text
 * only (never the quoted history). A stop keyword is clear and is applied at once; CANCEL/CANCELAR
 * (a reply to a reminder means the appointment) and any stop sentence are unclear and only offer
 * staff the Stop emails action. Tried on the whole text, then on its first non-blank line, so a
 * phone's signature under "STOP" does not hide it.
 */
export type EmailStopClass = { kind: "clear"; phrase: string } | { kind: "unclear"; phrase: string } | { kind: "none" };

function classifyOne(text: string): EmailStopClass {
  const k = matchKeyword(text);
  if (k?.kind === "stop") return CANCEL_WORDS.has(k.word) ? { kind: "unclear", phrase: k.word } : { kind: "clear", phrase: k.word };
  const p = matchPhrase(text);
  return p ? { kind: "unclear", phrase: p.phrase } : { kind: "none" };
}

export function classifyEmailStop(newText: string): EmailStopClass {
  const whole = classifyOne(newText);
  if (whole.kind !== "none") return whole;
  const firstLine = newText.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return firstLine && firstLine !== newText.trim() ? classifyOne(firstLine) : { kind: "none" };
}
```

In `email-staff-actions.ts` append:

```ts
/** The emailed clear stop (S-06 part 1): revoked / inbound_email over an ALLOWED address only (plan G3),
 *  idempotent on Resend's id. THROWS on a ledger error: the webhook answers 503 and Resend retries. */
export type InboundStopResult = { outcome: "stopped"; eventId: string } | { outcome: "already_stopped" };

export async function recordInboundStop(
  writer: SupabaseClient, i: { accountId: string; contactId: string; address: string; providerEmailId: string; phrase: string },
): Promise<InboundStopResult> {
  const r = await appendConsentEventGuarded(writer, {
    accountId: i.accountId, channel: "email", address: i.address, action: "revoked", method: "inbound_email",
    contactId: i.contactId, actorId: null, sourceRef: `inbound_email:${i.providerEmailId}`,
    evidence: { inbound_email_id: i.providerEmailId, phrase: i.phrase },
  }, "if_allowed");
  return r.outcome === "refused" ? { outcome: "already_stopped" } : { outcome: "stopped", eventId: r.id };
}

/** The Undo on the thread's notice: only that inbound stop, while it is still the newest row (0082). */
export function undoInboundStop(ctx: EmailContext, eventId: string): Promise<EmailActionResult> {
  return guarded("undoInboundStop", ctx, async () => {
    const row = await readConsentEvent(ctx.writer, ctx.accountId, eventId);
    if (!row || row.channel !== "email" || row.address !== ctx.address || row.action !== "revoked" || row.method !== "inbound_email") return changed(ctx);
    const id = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}
```

(Read on `ctx.writer`, not `ctx.db`: the stop's `actor_id` is null and its contact may be a household member the caller's Technician RLS cannot see; the caller proved the THREAD's contact first. Say so in a comment.) In `email-view.ts`: `| { kind: "reply" }` in `EmailHow`; `case "inbound_email": return { kind: "reply" };`. In `email-row.ts`: `case "reply": return t(m, "contact.email.how.reply", locale);` in the how switch, and in the no-resume switch (`:53`) `case "reply":` falls with the customer's own stops (read which line the `unsubscribe_link` case returns there and use the same).
- [ ] **Step 5: Run** the four files, `src/lib/consent/scans.test.ts` (scan "the customer's own email stop has one writer" stays green: `inbound_email` is not one of its three methods), `src/lib/consent/phrases.test.ts`, `src/lib/i18n/ratchet.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `classifyEmailStop` without the first-line retry → the signature case FAILS; (b) `recordInboundStop` with guard `"none"` → FAILS; (c) `undoInboundStop` without the method check → FAILS; (d) `emailHowOf` without the new case → FAILS. Paste each.
- [ ] **Step 7: Commit** the eight files, message "consent: an emailed STOP is applied at once with an Undo, a stop sentence only offers Stop emails (S-06 part 1)".

---

## Task 6: The Reply-To through the email gate (bis-comms)

**Review:** opus. **After:** Tasks 3, 4.

**Files**
- Modify: `apps/web/src/lib/consent/email-gate.ts` (the one change point, spec "Outbound")
- Modify: `apps/web/src/lib/consent/email-gate.test.ts` (the hoisted mock gains two functions; one new `describe`)

**Interfaces**
- Consumes: `getInboundSettings`, `ensureReplyToken` (`@bis/db`, Task 3); `replyAddressFor` (`lib/email/inbound/address.ts`, Task 4).
- Produces: `sendEmail` sets `replyTo` to `r-<token>@<domain>` for every NON-operator kind with a uuid `contactId`, when the account's mode is not `off`. Operator mail and a request with no contact are unchanged. A failure to read the mode or make the token logs and keeps the caller's `replyTo` (G10).

- [ ] **Step 1: Read** `email-gate.ts` whole and `email-gate.test.ts:1-120`.
- [ ] **Step 2: Failing tests.** In the hoisted `db` mock add `getInboundSettings: vi.fn(), ensureReplyToken: vi.fn()`; in `beforeEach` add `db.getInboundSettings.mockResolvedValue({ mode: "off", domain: null }); db.ensureReplyToken.mockResolvedValue({ conversationId: "conv_1", token: "0123456789abcdef01234567" });`. Append:

```ts
describe("sendEmail: the Reply-To when Replies is on (S-06 part 1, spec 'Outbound')", () => {
  const TOKEN = "0123456789abcdef01234567";

  it("mode off: the caller's replyTo goes as it was, and no token is made (mutation: make the token always → ensureReplyToken called, FAILS)", async () => {
    await sendEmail(base({ replyTo: "owner@rio.com" }), { db: CLIENT, env: ENV });
    expect(sent().replyTo).toBe("owner@rio.com");
    expect(db.ensureReplyToken).not.toHaveBeenCalled();
  });

  it("mode bis: a customer kind carries r-<token>@reply.bis-rgv.com, made on the SERVICE client for THIS contact (mutation: pass req's db → CLIENT, FAILS)", async () => {
    db.getInboundSettings.mockResolvedValue({ mode: "bis", domain: null });
    await sendEmail(base({ replyTo: "owner@rio.com" }), { db: CLIENT, env: ENV });
    expect(sent().replyTo).toBe(`r-${TOKEN}@reply.bis-rgv.com`);
    expect(db.ensureReplyToken).toHaveBeenCalledWith(SERVICE_CLIENT, ACCOUNT, CONTACT, "email-gate");
  });

  it("mode own_domain: the account's domain (mutation: always the BIS domain → FAILS)", async () => {
    db.getInboundSettings.mockResolvedValue({ mode: "own_domain", domain: "reply.rio.com" });
    await sendEmail(base({ kind: "staff.composer_email" }), { db: CLIENT, env: ENV });
    expect(sent().replyTo).toBe(`r-${TOKEN}@reply.rio.com`);
  });

  it("operator mail and a send with no contact are untouched (mutation: drop the class check → the lead alert gets a token, FAILS)", async () => {
    db.getInboundSettings.mockResolvedValue({ mode: "bis", domain: null });
    await sendEmail(base({ kind: "operator.lead_alert", replyTo: "lead@x.com" }), { env: ENV });
    expect(sent().replyTo).toBe("lead@x.com");
    send.mockClear();
    await sendEmail(base({ contactId: null, replyTo: "owner@rio.com" }), { db: CLIENT, env: ENV });
    expect(sent().replyTo).toBe("owner@rio.com");
    expect(db.ensureReplyToken).not.toHaveBeenCalled();
  });

  it("a failed mode read or token write sends with the caller's replyTo and logs, never blocks (G10; mutation: return blocked → FAILS)", async () => {
    db.getInboundSettings.mockResolvedValue({ mode: "bis", domain: null });
    db.ensureReplyToken.mockRejectedValue(new Error("down"));
    expect(await sendEmail(base({ replyTo: "owner@rio.com" }), { db: CLIENT, env: ENV })).toEqual({ kind: "sent", providerMessageId: "re_1" });
    expect(sent().replyTo).toBe("owner@rio.com");
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/reply address/);
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).not.toContain(TOKEN);
  });

  it("a blocked send never makes a token (mutation: resolve the Reply-To first → ensureReplyToken called for a stopped address, FAILS)", async () => {
    db.getInboundSettings.mockResolvedValue({ mode: "bis", domain: null });
    db.readConsentState.mockResolvedValue({ state: "stopped", since: "x", method: "staff", eventId: "e" });
    expect((await sendEmail(base(), { db: CLIENT, env: ENV })).kind).toBe("blocked");
    expect(db.ensureReplyToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/consent/email-gate.test.ts`.
- [ ] **Step 4: Implement.** Add `getInboundSettings, ensureReplyToken` to the `@bis/db` import and `import { replyAddressFor } from "@/lib/email/inbound/address";`. Add the step to the module's doc comment ("5b. a customer kind with a contact gets the account's reply address as its Reply-To when Replies is on (S-06 part 1); never operator mail; a failure keeps the caller's own"). Add, above `sendEmail`:

```ts
/** S-06 part 1 (spec "Outbound"): the thread's reply address, or the caller's own replyTo (G10). */
async function customerReplyTo(req: EmailRequest, deps: EmailGateDeps): Promise<string | undefined> {
  if (EMAIL_KINDS[req.kind].class === "operator" || !req.accountId || !isUuid(req.contactId)) return req.replyTo;
  try {
    const settings = await getInboundSettings(deps.db ?? serviceDb(), req.accountId);
    if (settings.mode === "off") return req.replyTo;
    // The service client always: conversations is server-written (0053), and the gate's callers pass
    // either client.
    const { token } = await ensureReplyToken(serviceDb(), req.accountId, req.contactId, "email-gate");
    return replyAddressFor(token, settings) ?? req.replyTo;
  } catch (e) {
    console.error(`email gate: ${req.kind} for account ${req.accountId} keeps its own reply address, the thread's could not be made: ${loggableError(e)}`);
    return req.replyTo;
  }
}
```

In `sendEmail`, directly before `let provider: EmailProvider;` (after every block that can return `blocked` or `deferred`): `const replyTo = await customerReplyTo(req, deps); const out: EmailRequest = replyTo === req.replyTo ? req : { ...req, replyTo };` and use `out` in place of `req` in the two calls `withFooter(out, …)` / `withoutFooter(out)` below it. (`unsubscribeLinks` keeps `req`.)
- [ ] **Step 5: Run** `email-gate.test.ts`, `scans.test.ts`, `src/lib/email/reply-to.test.ts`; typecheck; eslint. Then the vi.mock factory check: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "email-gate"`; every factory that reaches the real gate without spreading the original must mock both names; run each file found. All PASS.
- [ ] **Step 6: Probes:** (a) `customerReplyTo` called before the ledger block → the blocked case FAILS; (b) `deps.db ?? serviceDb()` passed to `ensureReplyToken` → the bis case FAILS; (c) the operator check removed → FAILS. Paste each.
- [ ] **Step 7: Commit** `-- apps/web/src/lib/consent/email-gate.ts apps/web/src/lib/consent/email-gate.test.ts <any mock file Step 5 changed>`, message "email gate: customer email carries the thread's reply address when Replies is on (S-06 part 1)".

---

## Task 7: The received-email fetcher inside `lib/email` (bis-comms)

**Review:** sonnet. **Runs beside:** Tasks 1, 2, 4.

**Files**
- Modify: `apps/web/src/lib/email/resend.ts` (+ `resend.test.ts`): `fetchReceivedEmailFromResend`
- Create: `apps/web/src/lib/email/receiving.ts`, `receiving.test.ts`
- Modify: `apps/web/src/lib/consent/scans.test.ts:724-727` (`PROVIDER_MODULES` gains `receiving.ts`)

**Interfaces**
- Produces:

```ts
// receiving.ts
export type ReceivedEmail = {
  id: string; from: string; to: string[]; receivedFor: string[]; subject: string | null;
  text: string | null; html: string | null; rawHeaders: string | null; attachmentCount: number; receivedAt: string;
};
export type ReceivedEmailFetcher = (emailId: string) => Promise<ReceivedEmail>;   // THROWS on any failure
export function receivedEmailFetcher(env?: NodeJS.ProcessEnv): ReceivedEmailFetcher; // THROWS when RESEND_API_KEY is unset
```

- [ ] **Step 1: Read** `resend.ts`, `resend.test.ts` (how it mocks the package), `scans.test.ts:718-756`. Run `pnpm install` in `<WT>` if `node_modules` is missing, then re-read `node_modules/.pnpm/resend@6.18.1/node_modules/resend/dist/index.d.mts` lines `1436-1475` and confirm `emails.receiving.get` and the response fields named in "External facts"; paste the lines. If they differ, STOP and report.
- [ ] **Step 2: Failing tests.** `receiving.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchFromResend = vi.hoisted(() => vi.fn());
vi.mock("./resend", () => ({ fetchReceivedEmailFromResend: fetchFromResend }));
import { receivedEmailFetcher } from "./receiving";

beforeEach(() => fetchFromResend.mockReset());

describe("receivedEmailFetcher", () => {
  it("binds the API key and passes the id through (mutation: read another env name → throws, FAILS)", async () => {
    fetchFromResend.mockResolvedValue({ id: "re_1" });
    const f = receivedEmailFetcher({ RESEND_API_KEY: "re_key" } as unknown as NodeJS.ProcessEnv);
    expect(await f("re_1")).toEqual({ id: "re_1" });
    expect(fetchFromResend).toHaveBeenCalledWith("re_key", "re_1");
  });

  it("throws with no key, so the route answers 503 (mutation: return a fake → FAILS)", () => {
    expect(() => receivedEmailFetcher({} as NodeJS.ProcessEnv)).toThrow(/RESEND_API_KEY/);
  });
});
```

In `resend.test.ts`, append (using its existing package mock; read it; if it mocks `Resend` as a class, add `emails.receiving.get` to that mock):

```ts
describe("fetchReceivedEmailFromResend", () => {
  it("maps Resend's received email and reads the raw message's header block (mutation: drop received_for → [], FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: {
      id: "re_1", from: "Ana <ana@gmail.com>", to: ["r-x@reply.bis-rgv.com"], received_for: ["r-y@reply.bis-rgv.com"],
      subject: "Re: Hi", text: "Yes", html: null, headers: {}, created_at: "2026-10-16T10:00:00.000Z",
      raw: { download_url: "https://raw.example/1", expires_at: "x" }, attachments: [{ id: "a" }, { id: "b" }],
    }, error: null });
    const fetchRaw = vi.fn().mockResolvedValue(new Response("Authentication-Results: amazonses.com; dmarc=pass\r\nFrom: a\r\n\r\nbody"));
    expect(await fetchReceivedEmailFromResend("key", "re_1", fetchRaw)).toEqual({
      id: "re_1", from: "Ana <ana@gmail.com>", to: ["r-x@reply.bis-rgv.com"], receivedFor: ["r-y@reply.bis-rgv.com"],
      subject: "Re: Hi", text: "Yes", html: null, rawHeaders: "Authentication-Results: amazonses.com; dmarc=pass\r\nFrom: a", attachmentCount: 2,
      receivedAt: "2026-10-16T10:00:00.000Z",
    });
    expect(fetchRaw).toHaveBeenCalledWith("https://raw.example/1");
  });

  it("no raw message, or a raw fetch that fails, reads as no headers, never a throw (plan G5: the sender is then unverified; mutation: throw → FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: { id: "re_2", from: "a@b.com", to: [], received_for: [], subject: "", text: null, html: null, headers: null, created_at: "x", raw: null, attachments: [] }, error: null });
    expect((await fetchReceivedEmailFromResend("key", "re_2", vi.fn())).rawHeaders).toBeNull();
    receivingGet.mockResolvedValue({ data: { id: "re_3", from: "a@b.com", to: [], received_for: [], subject: "", text: null, html: null, headers: null, created_at: "x", raw: { download_url: "https://raw.example/3", expires_at: "x" }, attachments: [] }, error: null });
    expect((await fetchReceivedEmailFromResend("key", "re_3", vi.fn().mockResolvedValue(new Response("", { status: 403 })))).rawHeaders).toBeNull();
  });

  it("an API error throws (the route answers 503; mutation: return null → FAILS)", async () => {
    receivingGet.mockResolvedValue({ data: null, error: { message: "not found", name: "not_found" } });
    await expect(fetchReceivedEmailFromResend("key", "re_4", vi.fn())).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.** In `resend.ts` append:

```ts
import type { ReceivedEmail } from "./receiving";

/** The header block of a raw RFC 5322 message: everything before the first blank line. */
function headerBlock(raw: string): string {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? raw.slice(0, m.index) : raw;
}

/**
 * S-06 part 1: one received email by id (resend@6.18.1 `emails.receiving.get`, read in its type
 * definitions), plus the raw message's header block from `raw.download_url` (plan G5, ASSUMPTION A1).
 * THROWS on an API error (the webhook answers 503). A missing or unreadable raw message is `rawHeaders:
 * null`, never a throw: the sender then reads as unverified and the email is held.
 */
export async function fetchReceivedEmailFromResend(
  apiKey: string, emailId: string, fetchRaw: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<ReceivedEmail> {
  const { data, error } = await new Resend(apiKey).emails.receiving.get(emailId);
  if (error || !data) throw new Error(`resend receiving.get failed: ${error?.message ?? "no data"}`);
  let rawHeaders: string | null = null;
  if (data.raw?.download_url) {
    try {
      const res = await fetchRaw(data.raw.download_url);
      if (res.ok) rawHeaders = headerBlock(await res.text()) || null;
    } catch {
      rawHeaders = null;
    }
  }
  return {
    id: data.id, from: data.from, to: data.to ?? [], receivedFor: data.received_for ?? [],
    subject: data.subject || null, text: data.text, html: data.html, rawHeaders,
    attachmentCount: data.attachments?.length ?? 0, receivedAt: data.created_at,
  };
}
```

`receiving.ts`:

```ts
import { fetchReceivedEmailFromResend } from "./resend";

/**
 * The received-email seam (S-06 part 1). The one module besides the gate that reaches resend.ts
 * (scans.test.ts lists it in PROVIDER_MODULES); the webhook takes the fetcher it builds, and every
 * test injects its own.
 */
export type ReceivedEmail = {
  id: string; from: string; to: string[]; receivedFor: string[]; subject: string | null;
  text: string | null; html: string | null; rawHeaders: string | null; attachmentCount: number; receivedAt: string;
};
export type ReceivedEmailFetcher = (emailId: string) => Promise<ReceivedEmail>;

export function receivedEmailFetcher(env: NodeJS.ProcessEnv = process.env): ReceivedEmailFetcher {
  const key = env.RESEND_API_KEY ?? "";
  if (!key) throw new Error("RESEND_API_KEY is not set: received email cannot be fetched");
  return (id) => fetchReceivedEmailFromResend(key, id);
}
```

In `scans.test.ts`'s `PROVIDER_MODULES` add `"apps/web/src/lib/email/receiving.ts",` with a comment: `// S-06 part 1: the received-email seam; it re-exports no provider and names none.`
- [ ] **Step 5: Run** the two test files and `scans.test.ts` (all of scan 1 (email) PASS, including "only lib/email/resend.ts imports the resend package" and "nothing names api.resend.com"); typecheck; eslint. PASS.
- [ ] **Step 6: Probes:** (a) `receiving.ts` importing `resend` directly → scan 1 FAILS naming it; (b) `received_for` not mapped → FAILS; (c) the raw fetch's `res.ok` check dropped → the 403 case FAILS. Paste each.
- [ ] **Step 7: Commit** `-- apps/web/src/lib/email/resend.ts apps/web/src/lib/email/resend.test.ts apps/web/src/lib/email/receiving.ts apps/web/src/lib/email/receiving.test.ts apps/web/src/lib/consent/scans.test.ts`, message "email: fetch a received email and its raw headers from Resend, behind one seam (S-06 part 1)".

---

## Task 8: The inbound pipeline, the webhook branch, the heartbeat (bis-comms)

**Review:** opus. **After:** Tasks 3, 4, 5, 7.

**Files**
- Create: `apps/web/src/lib/email/inbound/file.ts`, `file.test.ts`
- Create: `apps/web/src/lib/email/inbound/pipeline.ts`, `pipeline.test.ts`
- Modify: `apps/web/src/app/api/webhooks/resend/route.ts` (+ `route.test.ts`)
- Modify: `apps/web/src/lib/ops/stamp.ts:17-22` (`"email.inbound"`), `apps/web/src/lib/ops/watch.ts:84-95` (its label), `watch.test.ts:94-96`

**Interfaces**
- Consumes: Task 3's `findReplyThread`, `matchSender`, `recordInboundEmail`, `setInboundMessage`, `decideInboundEmail`, `createMessage`, `findMessageByProviderId`, `incrementUnreadCount`; Task 4's parsers; Task 5's `classifyEmailStop`, `recordInboundStop`; Task 7's `ReceivedEmail`, `ReceivedEmailFetcher`.
- Produces:

```ts
// file.ts
export type FileDeps = { db: SupabaseClient; now: () => Date };
export type FileInput = {
  row: InboundEmailRow;                 // status filed (webhook) or about to be filed (manual)
  contactId: string;                    // whose thread the message goes on
  sender: { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean } | null;
  attachmentCount: number;
  raiseUnread: boolean;                 // true from the webhook, false from Needs a look
  actor: { id: string; type: "system" | "user" };
};
export type FileResult = { messageId: string; created: boolean; consent: MessageConsent };
export type MessageConsent = { kind: "stopped"; eventId: string } | { kind: "maybe"; phrase: string } | { kind: "none" };
export async function fileInboundEmail(deps: FileDeps, i: FileInput): Promise<FileResult>;   // THROWS on a ledger or write failure
// pipeline.ts
export type PipelineDeps = {
  db: SupabaseClient; fetchEmail: ReceivedEmailFetcher; now: () => Date;
  forward: (f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number }) => Promise<void>;
  log: (line: string) => void;
};
export type PipelineOutcome =
  | { status: 200; result: "filed" | "held" | "duplicate" | "dropped" }
  | { status: 503; result: "fetch_failed" | "write_failed" };
export async function handleReceivedEmail(deps: PipelineDeps, data: { email_id?: unknown }): Promise<PipelineOutcome>;
```

The message's `meta` (read by Task 11): `{ inbound_email_id: <Resend id>, attachment_count: number, sender?: { contact_id, first_name, last_name } (only when viaGroup), consent: MessageConsent }`.

- [ ] **Step 1: Read** `apps/web/src/app/api/sms/inbound/route.ts` (the template: dedupe before write, 503 on a consent failure), the Resend route and its test whole, `lib/ops/stamp.ts`, `watch.ts:80-96`, `watch.test.ts:88-100`.
- [ ] **Step 2: Failing tests.** `file.test.ts` (with `vi.mock("@bis/db")` and `vi.mock("@/lib/consent/email-staff-actions")`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ createMessage: vi.fn(), findMessageByProviderId: vi.fn(), incrementUnreadCount: vi.fn(), setInboundMessage: vi.fn() }));
vi.mock("@bis/db", () => db);
const stop = vi.hoisted(() => ({ recordInboundStop: vi.fn() }));
vi.mock("@/lib/consent/email-staff-actions", () => stop);
import { fileInboundEmail, type FileInput } from "./file";

const DB = { service: true } as never;
const ROW = {
  id: "ie_1", accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "luis@example.com", fromName: "Luis",
  toEmail: "r-x@reply.bis-rgv.com", subject: "Re: Hi", text: "STOP", auth: { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" },
  status: "filed" as const, holdReason: null, messageId: null, decidedBy: "email-inbound", decidedAt: "x", receivedAt: "2026-10-16T10:00:00.000Z",
};
const input = (over: Partial<FileInput> = {}): FileInput => ({
  row: ROW, contactId: "ana", sender: { contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true },
  attachmentCount: 2, raiseUnread: true, actor: { id: "email-inbound", type: "system" }, ...over,
});

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(stop)]) f.mockReset();
  db.findMessageByProviderId.mockResolvedValue(null);
  db.createMessage.mockResolvedValue({ id: "msg_1" });
  db.setInboundMessage.mockResolvedValue(true);
  stop.recordInboundStop.mockResolvedValue({ outcome: "stopped", eventId: "ev_1" });
});

describe("fileInboundEmail (spec Inbound step 5, 7)", () => {
  it("writes the stop FIRST, then the message with its facts, then raises unread (mutation: create the message before the ledger → a ledger failure leaves a message, FAILS the next case)", async () => {
    expect(await fileInboundEmail({ db: DB, now: () => new Date() }, input())).toEqual({ messageId: "msg_1", created: true, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(stop.recordInboundStop).toHaveBeenCalledWith(DB, { accountId: "acc", contactId: "luis", address: "luis@example.com", providerEmailId: "re_1", phrase: "STOP" });
    expect(db.createMessage).toHaveBeenCalledWith(DB, "acc", {
      conversationId: "conv", channel: "email", direction: "inbound", status: "delivered", subject: "Re: Hi", body: "STOP",
      providerMessageId: "re_1",
      meta: { inbound_email_id: "re_1", attachment_count: 2, sender: { contact_id: "luis", first_name: "Luis", last_name: "Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } },
    }, "email-inbound", "system");
    expect(db.setInboundMessage).toHaveBeenCalledWith(DB, "acc", "ie_1", "msg_1");
    expect(db.incrementUnreadCount).toHaveBeenCalledWith(DB, "acc", "conv");
  });

  it("a ledger failure throws before any message (mutation: catch it → createMessage called, FAILS)", async () => {
    stop.recordInboundStop.mockRejectedValue(new Error("down"));
    await expect(fileInboundEmail({ db: DB, now: () => new Date() }, input())).rejects.toThrow(/down/);
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it("a retried delivery finds its message by Resend's id: no second message, no unread (mutation: skip the find → createMessage twice, FAILS)", async () => {
    db.findMessageByProviderId.mockResolvedValue({ id: "msg_0" });
    expect((await fileInboundEmail({ db: DB, now: () => new Date() }, input())).created).toBe(false);
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
  });

  it("an unclear stop writes nothing to the ledger and marks the message 'maybe'; a plain reply 'none'; the thread's own contact carries no sender (mutation: record unclear stops → FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "Please remove me" }, sender: { contactId: "ana", firstName: "Ana", lastName: null, viaGroup: false } }));
    expect(stop.recordInboundStop).not.toHaveBeenCalled();
    expect(db.createMessage.mock.calls[0]![2].meta).toEqual({ inbound_email_id: "re_1", attachment_count: 2, consent: { kind: "maybe", phrase: "remove me" } });
    db.createMessage.mockClear();
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: { ...ROW, text: "See you then" } }));
    expect(db.createMessage.mock.calls[0]![2].meta.consent).toEqual({ kind: "none" });
  });

  it("from Needs a look: unread not raised, the person is the actor, an unverified sender's stop is still heard (staff vouched; mutation: raise unread always → FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ raiseUnread: false, sender: null, actor: { id: "user_1", type: "user" } }));
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(stop.recordInboundStop).toHaveBeenCalledWith(DB, expect.objectContaining({ contactId: "ana" }));
    expect(db.createMessage.mock.calls[0]![3]).toBe("user_1");
  });

  it("an already-stopped address leaves the consent 'none' (G3; mutation: map already_stopped to stopped → FAILS)", async () => {
    stop.recordInboundStop.mockResolvedValue({ outcome: "already_stopped" });
    expect((await fileInboundEmail({ db: DB, now: () => new Date() }, input())).consent).toEqual({ kind: "none" });
  });
});
```

`pipeline.test.ts` (with `vi.mock("@bis/db")`, `vi.mock("./file")`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ findReplyThread: vi.fn(), matchSender: vi.fn(), recordInboundEmail: vi.fn() }));
vi.mock("@bis/db", () => db);
const file = vi.hoisted(() => ({ fileInboundEmail: vi.fn() }));
vi.mock("./file", () => file);
import { handleReceivedEmail, type PipelineDeps } from "./pipeline";

const T = "0123456789abcdef01234567";
const SES_OK = "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;\r\nX-SES-Spam-Verdict: PASS\r\nX-SES-Virus-Verdict: PASS";
const EMAIL = (over: Record<string, unknown> = {}) => ({
  id: "re_1", from: "Ana Ruiz <ana@gmail.com>", to: [`r-${T}@reply.bis-rgv.com`], receivedFor: [`r-${T}@reply.bis-rgv.com`],
  subject: "Re: Hi", text: "Sounds good\n\nOn Tue, Oct 14, 2026 at 3:00 PM Rio <crm@bis-rgv.com> wrote:\n> Hi", html: null,
  rawHeaders: SES_OK, attachmentCount: 0, receivedAt: "2026-10-16T10:00:00.000Z", ...over,
});
const THREAD = { conversationId: "conv", accountId: "acc", contactId: "ana", revoked: false, inboundDomain: "reply.rio.com" };
let deps: PipelineDeps;
const fetchEmail = vi.fn();
const forward = vi.fn();
const log = vi.fn();

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(file), fetchEmail, forward, log]) f.mockReset();
  deps = { db: {} as never, fetchEmail, now: () => new Date("2026-10-16T10:00:05Z"), forward, log };
  fetchEmail.mockResolvedValue(EMAIL());
  db.findReplyThread.mockResolvedValue(THREAD);
  db.matchSender.mockResolvedValue({ contactId: "ana", firstName: "Ana", lastName: "Ruiz", viaGroup: false });
  db.recordInboundEmail.mockImplementation(async (_db: unknown, r: Record<string, unknown>) => ({ row: { id: "ie_1", messageId: null, decidedAt: "x", ...r }, created: true }));
  file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
  forward.mockResolvedValue(undefined);
});

describe("handleReceivedEmail (spec 'Inbound', 'Failure behaviour')", () => {
  it("files an authenticated reply from the thread's customer: the row, the new text, the message, the forward (mutation: store the full text → the quote is kept, FAILS)", async () => {
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({
      accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "ana@gmail.com", fromName: "Ana Ruiz",
      toEmail: `r-${T}@reply.bis-rgv.com`, subject: "Re: Hi", text: "Sounds good", status: "filed", holdReason: null, decidedBy: "email-inbound",
      auth: { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" },
    });
    expect(file.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contactId: "ana", raiseUnread: true, attachmentCount: 0, actor: { id: "email-inbound", type: "system" } }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ contactId: "ana", senderName: "Ana Ruiz", attachmentCount: 0 }));
  });

  it("a household member's reply files on the thread, named (mutation: drop the sender → FAILS)", async () => {
    db.matchSender.mockResolvedValue({ contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true });
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(file.fileInboundEmail.mock.calls[0]![1].sender).toEqual({ contactId: "luis", firstName: "Luis", lastName: "Ruiz", viaGroup: true });
  });

  it("holds an authenticated stranger as not_on_record and an unauthenticated customer as unverified; no message, no forward (mutation: file a stranger → FAILS)", async () => {
    db.matchSender.mockResolvedValue(null);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "held" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ status: "held", holdReason: "not_on_record", decidedBy: null });
    db.matchSender.mockResolvedValue({ contactId: "ana", firstName: "Ana", lastName: null, viaGroup: false });
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: SES_OK.replace("dmarc=pass", "dmarc=fail") }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[1]![1]).toMatchObject({ status: "held", holdReason: "unverified" });
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: null }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[2]![1]).toMatchObject({ status: "held", holdReason: "unverified" });
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("a duplicate delivery of a held row is 200 with no second row; of a filed row it re-runs the idempotent file step, no forward (mutation: return before filing a filed duplicate → a 503'd stop is lost, FAILS)", async () => {
    db.recordInboundEmail.mockResolvedValue({ row: { id: "ie_1", status: "held", holdReason: "not_on_record" }, created: false });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
    db.recordInboundEmail.mockResolvedValue({ row: { id: "ie_1", status: "filed", holdReason: null, conversationId: "conv", text: "STOP", fromEmail: "ana@gmail.com" }, created: false });
    file.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: false, consent: { kind: "none" } });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
    expect(file.fileInboundEmail).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
  });

  it("drops an unknown token, a revoked token, a foreign domain and a mail with no r- recipient: 200, nothing stored, one log line with no token (mutation: store a held row for a revoked token → FAILS)", async () => {
    const cases: [string, () => void][] = [
      ["unknown", () => db.findReplyThread.mockResolvedValue(null)],
      ["revoked", () => db.findReplyThread.mockResolvedValue({ ...THREAD, revoked: true })],
      ["foreign", () => fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.other.com`], to: [] }))],
      ["none", () => fetchEmail.mockResolvedValue(EMAIL({ receivedFor: ["info@reply.bis-rgv.com"], to: [] }))],
    ];
    for (const [name, arrange] of cases) {
      log.mockClear(); db.recordInboundEmail.mockClear();
      arrange();
      expect(await handleReceivedEmail(deps, { email_id: "re_1" }), name).toEqual({ status: 200, result: "dropped" });
      expect(db.recordInboundEmail, name).not.toHaveBeenCalled();
      expect(log, name).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0]), name).not.toContain(T);
      db.findReplyThread.mockResolvedValue(THREAD); fetchEmail.mockResolvedValue(EMAIL());
    }
  });

  it("the account's own domain is accepted for its own token (mutation: accept only the BIS domain → FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ receivedFor: [`r-${T}@reply.rio.com`] }));
    expect((await handleReceivedEmail(deps, { email_id: "re_1" })).result).toBe("filed");
  });

  it("a fetch failure is 503 (Resend retries); a missing id is 200 dropped (mutation: 200 on a fetch failure → FAILS)", async () => {
    fetchEmail.mockRejectedValue(new Error("timeout"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "fetch_failed" });
    expect(await handleReceivedEmail(deps, {})).toEqual({ status: 200, result: "dropped" });
  });

  it("a ledger or write failure while filing is 503; a forward failure is logged and the filed message stands (mutation: await forward unguarded → 503, FAILS)", async () => {
    file.fileInboundEmail.mockRejectedValueOnce(new Error("append_consent_event failed"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "write_failed" });
    forward.mockRejectedValueOnce(new Error("provider down"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(String(log.mock.calls.at(-1)![0])).toMatch(/forward/);
  });

  it("an HTML-only email files its text (G11; mutation: store '' → FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ text: null, html: "<p>Yes &amp; thanks</p>" }));
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(db.recordInboundEmail.mock.calls[0]![1].text).toBe("Yes & thanks");
  });
});
```

In `route.test.ts` add `const pipelineMock = vi.fn(); vi.mock("@/lib/email/inbound/pipeline", () => ({ handleReceivedEmail: (...a: unknown[]) => pipelineMock(...a) }));` and `vi.mock("@/lib/email/receiving", () => ({ receivedEmailFetcher: () => async () => { throw new Error("not in tests"); } }));` and `vi.mock("@/lib/email/inbound/forward", () => ({ forwardToOwner: vi.fn() }));` (Task 9 creates `forward.ts`; until then Step 4 below defines the route's forward as a no-op and this mock is added by Task 9), then:

```ts
describe("resend webhook: email.received (S-06 part 1)", () => {
  it("hands a verified email.received to the pipeline and answers its status, stamping email.inbound (mutation: route it through STATUS_BY_EVENT → 'ignored', FAILS)", async () => {
    verifyMock.mockReturnValue({ type: "email.received", data: { email_id: "re_1" } });
    pipelineMock.mockResolvedValue({ status: 200, result: "filed" });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(pipelineMock).toHaveBeenCalledWith(expect.objectContaining({ db: expect.anything() }), { email_id: "re_1" });
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.inbound", { ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("a 503 from the pipeline is a 503 and an error stamp (mutation: always 200 → FAILS)", async () => {
    verifyMock.mockReturnValue({ type: "email.received", data: { email_id: "re_1" } });
    pipelineMock.mockResolvedValue({ status: 503, result: "fetch_failed" });
    expect((await POST(req({}))).status).toBe(503);
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.inbound", { ok: false, error: "fetch_failed" });
  });

  it("no RESEND_API_KEY is a 503 and an error stamp, before the pipeline (mutation: 200 → FAILS)", async () => {
    verifyMock.mockReturnValue({ type: "email.received", data: { email_id: "re_1" } });
    delete process.env.RESEND_API_KEY;
    expect((await POST(req({}))).status).toBe(503);
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("a bad signature on an email.received is refused 400 like any other, nothing read (G1; mutation: verify after the branch → pipeline called, FAILS)", async () => {
    verifyMock.mockImplementation(() => { throw new Error("bad"); });
    expect((await POST(req({ type: "email.received", data: { email_id: "re_1" } }))).status).toBe(400);
    expect(pipelineMock).not.toHaveBeenCalled();
  });
});
```

For the "no key" case, make the route's fetcher factory injectable through the mock: the mocked `receivedEmailFetcher` above must throw when `process.env.RESEND_API_KEY` is unset (write the mock as `receivedEmailFetcher: () => { if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set"); return async () => { throw new Error("not in tests"); }; }` and set `process.env.RESEND_API_KEY = "re_test"` in `beforeEach`). In `watch.test.ts`'s `KEYS`, add `"email.inbound": true`.

- [ ] **Step 3: Run them to see them fail.** `pnpm --filter web exec vitest run src/lib/email/inbound/file.test.ts src/lib/email/inbound/pipeline.test.ts src/app/api/webhooks/resend/route.test.ts src/lib/ops/watch.test.ts`.
- [ ] **Step 4: Implement.** `file.ts`:

```ts
import { createMessage, findMessageByProviderId, incrementUnreadCount, setInboundMessage, type InboundEmailRow, type SupabaseClient } from "@bis/db";
import { classifyEmailStop } from "@/lib/consent/email-stop";
import { recordInboundStop } from "@/lib/consent/email-staff-actions";

/**
 * Filing one inbound email on a thread (spec Inbound steps 5 and 7; Needs a look's File). Order, each
 * step idempotent so Resend's retry after a 503 completes what is missing: the stop (ledger,
 * source_ref on Resend's id), then the message (found by Resend's id before any insert), then unread.
 * THROWS on a ledger or write failure: the webhook answers 503.
 */
export type MessageConsent = { kind: "stopped"; eventId: string } | { kind: "maybe"; phrase: string } | { kind: "none" };
export type FileDeps = { db: SupabaseClient; now: () => Date };
export type FileInput = {
  row: InboundEmailRow; contactId: string;
  sender: { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean } | null;
  attachmentCount: number; raiseUnread: boolean; actor: { id: string; type: "system" | "user" };
};
export type FileResult = { messageId: string; created: boolean; consent: MessageConsent };

export async function fileInboundEmail(deps: FileDeps, i: FileInput): Promise<FileResult> {
  const { db } = deps;
  const { row } = i;
  const stopFor = i.sender?.contactId ?? i.contactId;
  const cls = classifyEmailStop(row.text);
  let consent: MessageConsent = { kind: "none" };
  if (cls.kind === "clear") {
    const r = await recordInboundStop(db, { accountId: row.accountId, contactId: stopFor, address: row.fromEmail, providerEmailId: row.providerEmailId, phrase: cls.phrase });
    if (r.outcome === "stopped") consent = { kind: "stopped", eventId: r.eventId };
  } else if (cls.kind === "unclear") {
    consent = { kind: "maybe", phrase: cls.phrase };
  }
  const existing = await findMessageByProviderId(db, row.accountId, row.providerEmailId);
  let messageId: string;
  let created = false;
  if (existing) {
    messageId = existing.id;
  } else {
    const meta: Record<string, unknown> = { inbound_email_id: row.providerEmailId, attachment_count: i.attachmentCount };
    if (i.sender?.viaGroup) meta.sender = { contact_id: i.sender.contactId, first_name: i.sender.firstName, last_name: i.sender.lastName };
    meta.consent = consent;
    ({ id: messageId } = await createMessage(db, row.accountId, {
      conversationId: row.conversationId, channel: "email", direction: "inbound", status: "delivered",
      subject: row.subject ?? undefined, body: row.text, providerMessageId: row.providerEmailId, meta,
    }, i.actor.id, i.actor.type));
    created = true;
  }
  await setInboundMessage(db, row.accountId, row.id, messageId);
  if (created && i.raiseUnread) await incrementUnreadCount(db, row.accountId, row.conversationId);
  return { messageId, created, consent };
}
```

(When a manual "Choose a record" files onto ANOTHER contact's thread, the caller passes a `row` whose `conversationId` is that contact's conversation: Task 12's action does that.)

`pipeline.ts`:

```ts
import { findReplyThread, matchSender, recordInboundEmail, type InboundEmailRow, type SupabaseClient } from "@bis/db";
import type { ReceivedEmailFetcher } from "@/lib/email/receiving";
import { BIS_REPLY_DOMAIN, bareAddress, displayName, domainOf, parseReplyAddress } from "./address";
import { parseHeaderBlock, readSesVerdict, senderAuthenticated, authRecord } from "./auth-results";
import { newText, htmlToText } from "./new-text";
import { fileInboundEmail } from "./file";

/**
 * The email.received steps 2-9 (spec "Inbound", "Failure behaviour"). The route verifies svix and
 * stamps the heartbeat; this decides. Never logs a token, an address, a subject or a body.
 */
export type PipelineDeps = {
  db: SupabaseClient; fetchEmail: ReceivedEmailFetcher; now: () => Date;
  forward: (f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number }) => Promise<void>;
  log: (line: string) => void;
};
export type PipelineOutcome =
  | { status: 200; result: "filed" | "held" | "duplicate" | "dropped" }
  | { status: 503; result: "fetch_failed" | "write_failed" };

const ACTOR = { id: "email-inbound", type: "system" as const };

export async function handleReceivedEmail(deps: PipelineDeps, data: { email_id?: unknown }): Promise<PipelineOutcome> {
  const emailId = typeof data.email_id === "string" && data.email_id ? data.email_id : null;
  if (!emailId) { deps.log("inbound email: event with no email id, dropped"); return { status: 200, result: "dropped" }; }

  let email;
  try {
    email = await deps.fetchEmail(emailId);
  } catch {
    deps.log("inbound email: the received email could not be fetched; 503 so Resend retries");
    return { status: 503, result: "fetch_failed" };
  }

  try {
    // Step 3: the recipient. The envelope first (A4), then To. The first r- address that resolves wins.
    let thread = null;
    let toEmail: string | null = null;
    let reason = "no reply address";
    for (const raw of [...email.receivedFor, ...email.to]) {
      const addr = parseReplyAddress(raw);
      if (!addr) continue;
      const t = await findReplyThread(deps.db, addr.token);
      if (!t) { reason = "unknown reply address"; continue; }
      if (t.revoked) { reason = "revoked reply address"; continue; }
      if (addr.domain !== BIS_REPLY_DOMAIN && addr.domain !== t.inboundDomain) { reason = "reply domain not the account's"; continue; }
      thread = t; toEmail = bareAddress(raw); break;
    }
    if (!thread || !toEmail) {
      deps.log(`inbound email: dropped (${reason})`);
      return { status: 200, result: "dropped" };
    }

    // Step 4: the sender check, both halves.
    const fromEmail = bareAddress(email.from);
    const verdict = readSesVerdict(parseHeaderBlock(email.rawHeaders ?? ""));
    const authenticated = senderAuthenticated(verdict, fromEmail ? domainOf(fromEmail) : null);
    const match = fromEmail ? await matchSender(deps.db, thread.accountId, thread.contactId, fromEmail) : null;
    const filed = authenticated && match !== null;
    const text = newText(email.text ?? (email.html ? htmlToText(email.html) : ""));

    const { row, created } = await recordInboundEmail(deps.db, {
      accountId: thread.accountId, conversationId: thread.conversationId, providerEmailId: email.id,
      fromEmail: fromEmail ?? email.from.slice(0, 320), fromName: displayName(email.from), toEmail,
      subject: email.subject, text, auth: authRecord(verdict),
      status: filed ? "filed" : "held", holdReason: filed ? null : (authenticated ? "not_on_record" : "unverified"),
      decidedBy: filed ? ACTOR.id : null, receivedAt: new Date(email.receivedAt || deps.now()).toISOString(),
    });

    if (row.status !== "filed") {
      return { status: 200, result: created ? "held" : "duplicate" };
    }
    // Step 5 and 7 (and the retry of a 503'd one): idempotent.
    const sender = created ? match : await matchSender(deps.db, row.accountId, thread.contactId, row.fromEmail);
    const result = await fileInboundEmail({ db: deps.db, now: deps.now }, {
      row, contactId: thread.contactId, sender, attachmentCount: email.attachmentCount, raiseUnread: true, actor: ACTOR,
    });
    // Step 8: only a message this delivery created is forwarded.
    if (result.created) {
      try {
        await deps.forward({ row, contactId: thread.contactId, senderName: row.fromName, attachmentCount: email.attachmentCount });
      } catch {
        deps.log(`inbound email: the forward to the owner of account ${row.accountId} failed; the filed message stands`);
      }
    }
    return { status: 200, result: created ? "filed" : "duplicate" };
  } catch {
    deps.log("inbound email: a write failed; 503 so Resend retries");
    return { status: 503, result: "write_failed" };
  }
}
```

(The forward hook's caught failure logs the account id only. The `catch {}` blocks that swallow the error's text are deliberate: an error message from the database can quote the body. The route stamps the outcome's `result` word.)

In `route.ts`, after the svix verify and before `const status = …`:

```ts
  // S-06 part 1: a customer's reply (spec "Inbound"). Its own heartbeat key, its own answer.
  if (event.type === "email.received") {
    let fetchEmail;
    try {
      fetchEmail = receivedEmailFetcher();
    } catch {
      stampHeartbeat("email.inbound", { ok: false, error: "RESEND_API_KEY is not set" });
      return new Response("not configured", { status: 503 });
    }
    const outcome = await handleReceivedEmail({
      db: serviceDb(), fetchEmail, now: () => new Date(),
      forward: async () => {},   // Task 9 replaces this with forwardToOwner
      log: (line) => console.error(`resend webhook: ${line}`),
    }, (event.data ?? {}) as { email_id?: unknown });
    stampHeartbeat("email.inbound", outcome.status === 200 ? { ok: true } : { ok: false, error: outcome.result });
    return new Response(outcome.result, { status: outcome.status });
  }
```

with imports `import { handleReceivedEmail } from "@/lib/email/inbound/pipeline";` and `import { receivedEmailFetcher } from "@/lib/email/receiving";`. In `stamp.ts` add `| "email.inbound"` to `WebhookHeartbeatKey`; in `watch.ts`'s `describeKey` add `case "email.inbound": return "customers' email replies (Resend)";`.
- [ ] **Step 5: Run** the four test files plus `scans.test.ts`, `src/lib/consent/email-gate.test.ts`, `…/acct/in-account-service-reads.test.ts` (by its full path: no new `serviceDb` under `lib`); typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the pipeline filing with `authenticated` alone (no `match`) → the stranger case FAILS; (b) the foreign-domain check removed → FAILS; (c) `fileInboundEmail` with the message before the stop → the ledger-failure case FAILS; (d) a duplicate filed row returned before `fileInboundEmail` → FAILS; (e) the forward awaited outside its `try` → FAILS; (f) the drop log naming `addr.token` → FAILS. Paste each.
- [ ] **Step 7: Commit** the nine files, message "inbound email: a reply is fetched, checked, filed on its thread or held, and an emailed stop is heard; 503 so Resend retries (S-06 part 1)".

---

## Task 9: The owner's forwarded copy; the new operator kind (bis-comms)

**Review:** sonnet. **After:** Task 8.

**Files**
- Create: `apps/web/src/lib/email/inbound/forward.ts`, `forward.test.ts`
- Modify: `apps/web/src/lib/consent/classes.ts` (one kind), `classes.test.ts:54-101`, `scans.test.ts:266-271` and `SITES` (`:760-790`)
- Modify: `apps/web/src/app/api/webhooks/resend/route.ts` (the forward hook) and `route.test.ts` (the `forward.ts` mock)

**Interfaces**
- Produces: `"operator.reply_forward": { class: "operator", hours: "any", footer: "none" }` and

```ts
export type ForwardDeps = { db: SupabaseClient; send: (r: EmailRequest) => Promise<EmailSendResult>; origin: string | null };
export async function forwardToOwner(deps: ForwardDeps, f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number }): Promise<void>;   // THROWS on a failed send (the pipeline logs it)
```

Spec step 8: to `accounts.reply_to_email` when set; FROM the lead-alert sender (no `fromAddress`, so the platform's `EMAIL_FROM`, `enrich.ts:433-440`), display name "<customer name> via <business name>", `Reply-To` the customer's address, subject unchanged, body the new text plus "Answer in BIS: <thread link>", the attachments line when there were any; in the account's language (`accounts.language`, `en` default); operator class (a customer's suppression never blocks it; D-061's suppressed account still does, by the gate's rule).

- [ ] **Step 1: Read** `lib/forms/enrich.ts:395-470` (the lead alert's shape), `email-gate.ts`'s `EmailRequest`, `lib/email/origin.ts`, `classes.ts:60-128`, `classes.test.ts:50-120`, `scans.test.ts:758-800`.
- [ ] **Step 2: Failing tests.** `forward.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { forwardToOwner } from "./forward";

const ROW = {
  id: "ie_1", accountId: "acc", conversationId: "conv", providerEmailId: "re_1", fromEmail: "ana@gmail.com", fromName: "Ana Ruiz",
  toEmail: "r-x@reply.bis-rgv.com", subject: "Re: Your appointment", text: "Sounds good", auth: { spf: null, dkim: null, dmarc: null, spam: null, virus: null },
  status: "filed" as const, holdReason: null, messageId: "msg_1", decidedBy: "email-inbound", decidedAt: "x", receivedAt: "x",
};
const fakeDb = (account: Record<string, unknown> | null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: account, error: null }) }) }) }),
}) as never;

describe("forwardToOwner (spec Inbound step 8)", () => {
  it("sends the owner's copy: operator kind, the platform sender, the customer as Reply-To, subject unchanged, the link (mutation: pass fromAddress → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "sent", providerMessageId: "p" });
    await forwardToOwner({ db: fakeDb({ reply_to_email: "owner@rio.com", brand_name: "Rio Roofing", name: "Rio — trial", language: "en" }), send, origin: "https://app.example.com" },
      { row: ROW, contactId: "ana", senderName: "Ana Ruiz", attachmentCount: 2 });
    const r = send.mock.calls[0]![0];
    expect(r).toMatchObject({ accountId: "acc", kind: "operator.reply_forward", to: "owner@rio.com", fromName: "Ana Ruiz via Rio Roofing", replyTo: "ana@gmail.com", subject: "Re: Your appointment" });
    expect(r.fromAddress).toBeUndefined();
    expect(r.contactId).toBeUndefined();
    expect(r.body).toBe("Sounds good\n\nThis email had 2 attachments. They are not saved in BIS yet.\n\nAnswer in BIS: https://app.example.com/dashboard/accounts/acc/conversations?c=conv");
  });

  it("Spanish account: the Spanish lines (mutation: always English → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "sent", providerMessageId: "p" });
    await forwardToOwner({ db: fakeDb({ reply_to_email: "owner@rio.com", brand_name: "Rio", name: "x", language: "es" }), send, origin: "https://app.example.com" },
      { row: ROW, contactId: "ana", senderName: null, attachmentCount: 1 });
    const r = send.mock.calls[0]![0];
    expect(r.fromName).toBe("ana@gmail.com vía Rio");
    expect(r.body).toBe("Sounds good\n\nEste correo traía 1 archivo adjunto. Aún no se guarda en BIS.\n\nResponder en BIS: https://app.example.com/dashboard/accounts/acc/conversations?c=conv");
  });

  it("no reply_to_email: nothing is sent; no origin: no link line (mutation: send to '' → FAILS)", async () => {
    const send = vi.fn();
    await forwardToOwner({ db: fakeDb({ reply_to_email: null, brand_name: "Rio", name: "x", language: "en" }), send, origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 });
    expect(send).not.toHaveBeenCalled();
    await forwardToOwner({ db: fakeDb({ reply_to_email: "o@rio.com", brand_name: "Rio", name: "x", language: "en" }), send.mockResolvedValue({ kind: "sent", providerMessageId: "p" }), origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 });
    expect(send.mock.calls[0]![0].body).toBe("Sounds good");
  });

  it("a send that is not 'sent' throws, so the pipeline logs it (mutation: ignore the result → FAILS)", async () => {
    const send = vi.fn().mockResolvedValue({ kind: "blocked", reason: "suppressed_account" });
    await expect(forwardToOwner({ db: fakeDb({ reply_to_email: "o@rio.com", brand_name: "Rio", name: "x", language: "en" }), send, origin: null }, { row: ROW, contactId: "ana", senderName: "Ana", attachmentCount: 0 })).rejects.toThrow(/suppressed_account/);
  });
});
```

`classes.test.ts`: `EMAIL_TABLE` gains `"operator.reply_forward": ["operator", "any", "none"],` (comment: `// S-06 part 1: the owner's copy of a customer's reply; operator mail, as the lead alert is.`), the "twenty-seven" title becomes "twenty-eight (…, and S-06's reply forward)", `toHaveLength(27)` → `toHaveLength(28)`. `scans.test.ts`: the title's "twenty-seven email kinds, 38 distinct" → "twenty-eight email kinds, 39 distinct", `toHaveLength(38)` → `toHaveLength(39)`; `SITES` gains `"operator.reply_forward": ["apps/web/src/lib/email/inbound/forward.ts"],`.
- [ ] **Step 3: Run them to see them fail** (`forward.test.ts`, `classes.test.ts`, `scans.test.ts`).
- [ ] **Step 4: Implement.** `classes.ts`: after `"operator.ops_alert"` add `"operator.reply_forward": { class: "operator", hours: "any", footer: "none" },` with the S-06 comment, and update the registry's doc comment count (twenty-six → twenty-seven… read the current wording at `:60-64` and add "S-06's reply forward"). `forward.ts`:

```ts
import type { InboundEmailRow, SupabaseClient } from "@bis/db";
import type { EmailRequest, EmailSendResult } from "@/lib/consent/email-gate";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * The owner's copy of a filed reply (spec Inbound step 8; decision 6): from the same sender as lead
 * alerts (no fromAddress: the platform's EMAIL_FROM), operator class, so a customer's suppression
 * never blocks it. THROWS when the gate did not send it; the pipeline logs that and the filed message
 * stands.
 */
export type ForwardDeps = { db: SupabaseClient; send: (r: EmailRequest) => Promise<EmailSendResult>; origin: string | null };

export async function forwardToOwner(
  deps: ForwardDeps, f: { row: InboundEmailRow; contactId: string; senderName: string | null; attachmentCount: number },
): Promise<void> {
  const { data, error } = await deps.db.from("accounts").select("reply_to_email, brand_name, name, language").eq("id", f.row.accountId).maybeSingle();
  if (error) throw new Error(`forward: account read failed: ${error.message}`);
  const a = data as { reply_to_email: string | null; brand_name: string | null; name: string; language: string | null } | null;
  const to = a?.reply_to_email?.trim();
  if (!to) return;
  const lang = a?.language === "es" ? "es" : "en";
  const business = a?.brand_name?.trim() || a?.name || "";
  const customer = f.senderName?.trim() || f.row.fromEmail;
  const lines = [f.row.text];
  if (f.attachmentCount === 1) lines.push(t(m, "email.replyForward.attachmentsOne", lang));
  else if (f.attachmentCount > 1) lines.push(t(m, "email.replyForward.attachments", lang, { count: f.attachmentCount }));
  if (deps.origin) lines.push(`${t(m, "email.replyForward.answer", lang)}: ${deps.origin}/dashboard/accounts/${f.row.accountId}/conversations?c=${f.row.conversationId}`);
  const r = await deps.send({
    accountId: f.row.accountId, kind: "operator.reply_forward", to,
    fromName: t(m, "email.replyForward.fromName", lang, { customer, business }),
    replyTo: f.row.fromEmail, subject: f.row.subject ?? "", body: lines.filter(Boolean).join("\n\n"),
  });
  if (r.kind !== "sent") throw new Error(`forward not sent: ${r.kind === "blocked" ? r.reason : r.kind}`);
}
```

(`accounts.name` is used only when `brand_name` is blank; if a reviewer objects that `name` is the agency's internal label (`enrich.ts:433-436`'s comment), fall back to the customer address alone — say which in the report. Check `accounts.language` exists: `grep -n "language" packages/db/supabase/migrations/0076_customer_language.sql packages/db/supabase/migrations/*account*language*`; the Settings page reads it, `…/settings/page.tsx:83`.) In `route.ts` replace the forward no-op with:

```ts
      forward: (f) => forwardToOwner({ db: serviceDb(), send: (r) => sendEmail(r, { db: serviceDb() }), origin: configuredOrigin(process.env) }, f),
```

with `import { forwardToOwner } from "@/lib/email/inbound/forward"; import { sendEmail } from "@/lib/consent/email-gate"; import { configuredOrigin } from "@/lib/email/origin";`. In `route.test.ts` add `vi.mock("@/lib/email/inbound/forward", () => ({ forwardToOwner: vi.fn() }));` and `vi.mock("@/lib/consent/email-gate", () => ({ sendEmail: vi.fn() }));`.
- [ ] **Step 5: Run** `forward.test.ts`, `classes.test.ts`, `scans.test.ts` (whole: the SITES case for `operator.reply_forward` names exactly `forward.ts`), `route.test.ts`, `email-gate.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `forward.ts` passing `fromAddress: from_email` → case 1 FAILS; (b) the kind left out of `classes.ts` → the gate throws, case 1 FAILS; (c) `SITES` without the new line → "the table covers every email kind" FAILS. Paste each.
- [ ] **Step 7: Commit** the seven files, message "inbound email: the owner gets a copy of each filed reply from the lead-alert sender (S-06 part 1)".

---

## Task 10: Settings' Replies row, Check DNS; Branding's read-only line (bis-comms actions, then bis-frontend)

**Review:** sonnet. **After:** Tasks 2, 3.

**Files**
- Modify (bis-comms): `…/settings/actions.ts` (+ `actions.test.ts`): `setInboundModeAction`, `checkInboundDnsAction`
- Modify (bis-frontend): `…/settings/sending-address-card.tsx`, create `…/settings/sending-address-card.test.ts`; `…/settings/page.tsx` (read `getInboundSettings`, pass two props) + `page.test.ts`; `components/branding-panel.tsx` (optional `replyRoute` prop, one line under the reply-to hint); `lib/branding/panel-copy.ts` (+ its test: `repliesLine`); `…/acct/branding/page.tsx` (read, pass)

**Interfaces**
- Consumes: `getInboundSettings`, `setInboundSettings`, `BIS_REPLY_DOMAIN` (`@bis/db`); keys `settings.replies.*`, `branding.replies.*`.
- Produces:

```ts
// settings/actions.ts ("use server")
export type InboundModeResult = { ok: true; previous: InboundSettings } | { ok: false; error: string };
export async function setInboundModeAction(accountId: string, next: InboundSettings): Promise<InboundModeResult>;
export type DnsCheckResult = { ok: true } | { ok: false; error: string };
export async function checkInboundDnsAction(accountId: string, domain: string): Promise<DnsCheckResult>;
// apps/web/src/lib/email/inbound/mx-check.ts (a plain module, so its tests import it directly)
export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;
export const RESEND_INBOUND_MX: RegExp;   // /^inbound-smtp\.[a-z0-9-]+\.amazonaws\.com\.?$/i (ASSUMPTION A3)
export async function inboundMxReady(domain: string, resolve?: MxResolver): Promise<"ready" | "missing" | "lookup_failed">;
export function cleanInboundDomain(raw: string): string | null;   // lowercase, trimmed, a dotted hostname, never BIS's own
```

(`mx-check.ts` + `mx-check.test.ts` are bis-comms files in this task; add them to the commit.)

- [ ] **Step 1: Read** `…/settings/actions.ts:100-160` (`setFromEmailAction`: agency-only, service write, result shape), `actions.test.ts:1-60`, `sending-address-card.tsx`, `…/settings/page.tsx:60-110, 210-225`, `page.test.ts:16-110`, `components/branding-panel.tsx:60-100, 255-280`, `lib/branding/panel-copy.ts`, `…/acct/branding/page.tsx:50-100`, `lib/forms/action-feedback.ts`, `apps/web/src/lib/rendered-text.ts`.
- [ ] **Step 2: Failing tests.** `mx-check.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { inboundMxReady, cleanInboundDomain } from "./mx-check";

describe("inboundMxReady (spec 'Turning it on'; ASSUMPTION A3)", () => {
  it("ready when any MX points at Resend's inbound host (mutation: require priority 10 → the priority-20 case is missing, FAILS)", async () => {
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 }]))).toBe("ready");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "mx.google.com", priority: 1 }, { exchange: "inbound-smtp.eu-west-1.amazonaws.com.", priority: 20 }]))).toBe("ready");
  });

  it("missing when no MX is Resend's, or none exists; lookup_failed on any other DNS error (mutation: treat ENOTFOUND as lookup_failed → FAILS)", async () => {
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockResolvedValue([{ exchange: "mx.google.com", priority: 1 }]))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ENODATA" })))).toBe("missing");
    expect(await inboundMxReady("reply.rio.com", vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "ETIMEOUT" })))).toBe("lookup_failed");
  });
});

describe("cleanInboundDomain", () => {
  it("lowercases and trims a dotted hostname; refuses BIS's own and anything else (mutation: accept reply.bis-rgv.com → FAILS)", () => {
    expect(cleanInboundDomain("  Reply.Rio.COM ")).toBe("reply.rio.com");
    for (const bad of ["reply.bis-rgv.com", "rio", "reply rio.com", "http://reply.rio.com", "", "-a.com"]) expect(cleanInboundDomain(bad), bad).toBeNull();
  });
});
```

In `actions.test.ts` (read its existing mocks for `requireAgencyOnlyAccountAccess`, `serviceDb`, `@bis/db`; add `getInboundSettings`, `setInboundSettings` to its `@bis/db` mock and a `vi.mock("@/lib/email/inbound/mx-check", …)`):

```ts
describe("setInboundModeAction (agency only; spec 'Turning it on')", () => {
  it("is agency-only: a refused access never writes (mutation: requireAccountAccess → FAILS)", async () => {
    requireAgencyOnlyMock.mockRejectedValueOnce(new Error("forbidden"));
    await expect(setInboundModeAction(ACCOUNT, { mode: "bis", domain: null })).rejects.toThrow(/forbidden/);
    expect(dbMock.setInboundSettings).not.toHaveBeenCalled();
  });

  it("bis: writes and answers the previous settings for the Undo (mutation: answer the new settings → FAILS)", async () => {
    dbMock.getInboundSettings.mockResolvedValue({ mode: "off", domain: null });
    expect(await setInboundModeAction(ACCOUNT, { mode: "bis", domain: null })).toEqual({ ok: true, previous: { mode: "off", domain: null } });
    expect(dbMock.setInboundSettings).toHaveBeenCalledWith(SERVICE, ACCOUNT, { mode: "bis", domain: null }, USER);
  });

  it("own_domain re-checks the MX on the server and refuses when it is not ready (mutation: trust the browser → FAILS)", async () => {
    dbMock.getInboundSettings.mockResolvedValue({ mode: "off", domain: null });
    mxMock.inboundMxReady.mockResolvedValue("missing");
    expect(await setInboundModeAction(ACCOUNT, { mode: "own_domain", domain: "reply.rio.com" })).toEqual({ ok: false, error: "No MX record on reply.rio.com points at Resend yet. Add it, then check again." });
    expect(dbMock.setInboundSettings).not.toHaveBeenCalled();
  });

  it("a bad domain is refused; a taken one answers domainTaken (mutation: map 23505 to the generic error → FAILS)", async () => {
    dbMock.getInboundSettings.mockResolvedValue({ mode: "off", domain: null });
    expect(await setInboundModeAction(ACCOUNT, { mode: "own_domain", domain: "reply.bis-rgv.com" })).toEqual({ ok: false, error: "Enter a domain like reply.example.com." });
    mxMock.inboundMxReady.mockResolvedValue("ready");
    dbMock.setInboundSettings.mockRejectedValueOnce(new Error("setInboundSettings failed: duplicate key value violates unique constraint \"accounts_inbound_domain_key\""));
    expect(await setInboundModeAction(ACCOUNT, { mode: "own_domain", domain: "reply.rio.com" })).toEqual({ ok: false, error: "Another account already uses that domain." });
  });

  it("off keeps the stored domain, so turning own_domain back on needs no retyping (mutation: clear the domain → FAILS)", async () => {
    dbMock.getInboundSettings.mockResolvedValue({ mode: "own_domain", domain: "reply.rio.com" });
    await setInboundModeAction(ACCOUNT, { mode: "off", domain: null });
    expect(dbMock.setInboundSettings).toHaveBeenCalledWith(SERVICE, ACCOUNT, { mode: "off", domain: "reply.rio.com" }, USER);
  });
});

describe("checkInboundDnsAction", () => {
  it("answers the three outcomes in words, agency-only (mutation: answer ok for missing → FAILS)", async () => {
    mxMock.inboundMxReady.mockResolvedValueOnce("ready").mockResolvedValueOnce("missing").mockResolvedValueOnce("lookup_failed");
    expect(await checkInboundDnsAction(ACCOUNT, "reply.rio.com")).toEqual({ ok: true });
    expect(await checkInboundDnsAction(ACCOUNT, "reply.rio.com")).toEqual({ ok: false, error: "No MX record on reply.rio.com points at Resend yet. Add it, then check again." });
    expect(await checkInboundDnsAction(ACCOUNT, "reply.rio.com")).toEqual({ ok: false, error: "We couldn't look up reply.rio.com. Check the spelling and try again." });
  });
});
```

(`ACCOUNT`, `USER`, `SERVICE`, `requireAgencyOnlyMock`, `dbMock`, `mxMock` are this file's names or ones you add; follow the file. Settings is English, so the action's errors are `m[...]` English, like its neighbours.)

`sending-address-card.test.ts` (`renderToStaticMarkup`; `vi.mock("sonner")`; the actions passed as props):

```ts
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { SendingAddressCard } from "./sending-address-card";
import { renderedText } from "@/lib/rendered-text";

const html = (replies: { mode: "off" | "bis" | "own_domain"; domain: string | null }) => renderToStaticMarkup(createElement(SendingAddressCard, {
  fromEmail: null, action: vi.fn(), replies, setReplies: vi.fn(), checkDns: vi.fn(),
}));

describe("the Replies row (spec 'Turning it on'; plan G7)", () => {
  it("shows the state as a dot and a word, and the three choices (mutation: drop the dot → FAILS)", () => {
    const h = html({ mode: "bis", domain: null });
    expect(h).toContain('data-replies-state="bis"');
    expect(h).toMatch(/data-replies-state="bis"[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(h)).toContain("Replies");
    expect(renderedText(h)).toContain("BIS address");
    expect(renderedText(h)).toContain("Customers reply to an address at reply.bis-rgv.com, and the reply lands on their thread here.");
    for (const v of ["off", "bis", "own_domain"]) expect(h).toContain(`value="${v}"`);
  });

  it("the card keeps ONE primary: Save; Check DNS is ghost (rule 8; mutation: Check DNS as default → two, FAILS)", () => {
    const h = html({ mode: "own_domain", domain: "reply.rio.com" });
    expect(h.match(/data-variant="default"/g)).toHaveLength(1);
    expect(renderedText(h)).toContain("Check DNS");
    expect(renderedText(h)).toContain("Customers reply to an address at reply.rio.com, and the reply lands on their thread here.");
  });

  it("off reads Off with the old behaviour's sentence (mutation: show the BIS sentence for off → FAILS)", () => {
    expect(renderedText(html({ mode: "off", domain: null }))).toContain("Customers' replies go to the reply-to address on Branding.");
  });
});
```

(`data-dot` is the attribute the existing dot component sets, if one exists: `grep -rn "data-dot\|StatusDot" apps/web/src/components | head`; use its real attribute or component and adjust this assertion to match it; if none exists, render `<span data-dot aria-hidden className="size-2 rounded-full bg-[var(--good)]" />`.)

`panel-copy.test.ts` (append): `repliesLine("client", { mode: "bis", domain: null })` → `"Your customers' replies come back into BIS at reply.bis-rgv.com, and a copy goes to the reply-to address above."`; `repliesLine("agency", { mode: "own_domain", domain: "reply.rio.com" })` → `"Customer replies come back into BIS at reply.rio.com; the reply-to address above gets a copy."`; `repliesLine("client", { mode: "off", domain: null })` → `null` (mutation: answer a line for off → FAILS). In `page.test.ts`: the `@bis/db` mock gains `getInboundSettings: vi.fn().mockResolvedValue({ mode: "bis", domain: null })`; the settings action mock gains the two actions; one new case asserts the card receives `replies: { mode: "bis", domain: null }` (follow how the file asserts `SendingAddressCard`'s props today).
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.** `mx-check.ts`:

```ts
import { promises as dns } from "node:dns";
import { BIS_REPLY_DOMAIN } from "./address";

/** S-06 part 1, "Check DNS": an MX on the client's reply domain that points at Resend's inbound host (ASSUMPTION A3). */
export type MxResolver = (domain: string) => Promise<{ exchange: string; priority: number }[]>;
export const RESEND_INBOUND_MX = /^inbound-smtp\.[a-z0-9-]+\.amazonaws\.com\.?$/i;
const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function cleanInboundDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase();
  return d.length <= 253 && HOST.test(d) && d !== BIS_REPLY_DOMAIN ? d : null;
}

export async function inboundMxReady(domain: string, resolve: MxResolver = (d) => dns.resolveMx(d)): Promise<"ready" | "missing" | "lookup_failed"> {
  try {
    const records = await resolve(domain);
    return records.some((r) => RESEND_INBOUND_MX.test(r.exchange)) ? "ready" : "missing";
  } catch (e) {
    const code = (e as { code?: string }).code;
    return code === "ENOTFOUND" || code === "ENODATA" ? "missing" : "lookup_failed";
  }
}
```

(`HOST` here is JS, so its `\.` is fine; the no-backslash rule binds only the SQL file. It is the twin of 0082's `accounts_inbound_domain_check`; Task 15 checks they agree.) In `settings/actions.ts`:

```ts
export type InboundModeResult = { ok: true; previous: InboundSettings } | { ok: false; error: string };

/**
 * The Replies row (S-06 part 1). Agency-only by `requireAgencyOnlyAccountAccess` on the first line: no
 * column grant stands behind accounts.inbound_mode / inbound_domain (0082), so this guard is the ONLY gate.
 * Own domain is re-checked here (the browser's Check DNS is a convenience, never trusted). Off keeps the
 * stored domain. Answers the previous settings, so the toast's Undo restores exactly them.
 */
export async function setInboundModeAction(accountId: string, next: InboundSettings): Promise<InboundModeResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const db = serviceDb();
  const previous = await getInboundSettings(db, accountId);
  let domain = previous.domain;
  if (next.mode === "own_domain") {
    const clean = cleanInboundDomain(next.domain ?? "");
    if (!clean) return { ok: false, error: m["settings.replies.invalidDomain"] };
    const mx = await inboundMxReady(clean);
    if (mx !== "ready") return { ok: false, error: (mx === "missing" ? m["settings.replies.dnsMissing"] : m["settings.replies.dnsFailed"]).replace("{domain}", clean) };
    domain = clean;
  }
  try {
    await setInboundSettings(db, accountId, { mode: next.mode, domain }, userId);
  } catch (e) {
    if (String(e).includes("accounts_inbound_domain_key")) return { ok: false, error: m["settings.replies.domainTaken"] };
    console.error(`setInboundModeAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["common.actionCrashed"] };
  }
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true, previous };
}

export type DnsCheckResult = { ok: true } | { ok: false; error: string };

export async function checkInboundDnsAction(accountId: string, raw: string): Promise<DnsCheckResult> {
  await requireAgencyOnlyAccountAccess(accountId);
  const domain = cleanInboundDomain(raw);
  if (!domain) return { ok: false, error: m["settings.replies.invalidDomain"] };
  const mx = await inboundMxReady(domain);
  if (mx === "ready") return { ok: true };
  return { ok: false, error: (mx === "missing" ? m["settings.replies.dnsMissing"] : m["settings.replies.dnsFailed"]).replace("{domain}", domain) };
}
```

(Read `actions.ts`'s imports for `revalidatePath`, `serviceDb`, `m`; add `getInboundSettings, setInboundSettings, type InboundSettings` to its `@bis/db` import and `import { inboundMxReady, cleanInboundDomain } from "@/lib/email/inbound/mx-check";`. If `common.actionCrashed` is not in `m`, use the neighbour's crash key.)

`sending-address-card.tsx`: new props `replies: { mode: InboundMode; domain: string | null }`, `setReplies: (next) => Promise<InboundModeResult>`, `checkDns: (domain: string) => Promise<DnsCheckResult>`. Below the existing form, a section separated by a row rule (`border-t border-[var(--line)] pt-4 mt-4`), headed by a Label "Replies" and the state (`<p data-replies-state={mode} className="flex items-center gap-2 text-sm">` + a dot: `--good` for bis/own_domain, `--text-3` for off + the word); then a radio group (`components/ui/radio-group` if present; read `components/ui/`) with the three values; choosing a value calls `setReplies` AT ONCE (no Save) and toasts `settings.replies.saved` with the mode's word and an **Undo** action that calls `setReplies(previous)` and toasts `settings.replies.undone` (rule 6). Choosing "Own domain" reveals an `Input` (Label "Reply domain", default the stored domain) and a ghost `Button variant="ghost" size="sm"` "Check DNS" that calls `checkDns` and shows its answer in a line under the input (`--good` dot + `settings.replies.dnsOk`, or the error in `--crit`); the radio's own_domain value is applied only after the check answered ok in this session (the server re-checks anyway). The body sentence under the state is the mode's sentence (`offBody`, `bisBody`, `ownBody` with `{domain}`). All copy `m[...]` (Settings is English, G14). Controls `min-h-11 md:min-h-8`. In `settings/page.tsx`: add `getInboundSettings(db, accountId)` to the `Promise.all` and pass `replies`, `setReplies={setInboundModeAction.bind(null, accountId)}`, `checkDns={checkInboundDnsAction.bind(null, accountId)}`.

`panel-copy.ts`: `export function repliesLine(audience: BrandingAudience, s: { mode: InboundMode; domain: string | null }): string | null` → null for off; else the audience's key with `{domain}` = `BIS_REPLY_DOMAIN` (from `lib/email/inbound/address.ts`) or `s.domain`. `branding-panel.tsx`: optional prop `replyRoute?: { mode: InboundMode; domain: string | null }`; directly under the reply-to hint (`:273`) render `{line ? <p data-replies-line className="text-xs text-muted-foreground">{line}</p> : null}`. `…/acct/branding/page.tsx` reads `getInboundSettings(serviceDb(), accountId)` beside its other reads (the page already uses `serviceDb` for this account, "configuration", `in-account-service-reads.test.ts:68`) and passes `replyRoute`; `settings/page.tsx` passes the same to its `BrandingPanel`.
- [ ] **Step 5: Run** the five test files, `src/lib/palette/registry.test.ts` (no new Settings section: the row is inside an existing card, so no palette entry), `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, `…/acct/in-account-service-reads.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `setInboundModeAction` skipping the server MX re-check → FAILS; (b) the card's Check DNS as `variant="default"` → the one-primary case FAILS; (c) `repliesLine` answering for off → FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "settings: turn customer replies on per account (BIS address or the client's own domain after Check DNS); Branding says where replies go (S-06 part 1)".

---

## Task 11: The thread: member name, attachments, the stop notice with Undo, the chip (bis-comms actions, then bis-frontend)

**Review:** opus. **After:** Tasks 2, 3, 5.

**Files**
- Create (bis-comms): `…/conv/inbound-actions.ts` (`"use server"`), `inbound-actions.test.ts`
- Modify (bis-comms): `…/acct/in-account-service-reads.test.ts` (one `ALLOWED` line)
- Create (bis-frontend): `…/conv/inbound-notice.tsx` (client), `inbound-notice.test.ts`
- Modify (bis-frontend): `…/conv/message-thread.tsx` (+ `message-thread.test.ts`), `…/conv/page.tsx` (the locale; pass `accountId`, `locale`)

**Interfaces**
- Consumes: `undoInboundStop`, `stopEmails` (`email-staff-actions.ts`), `emailContextFor` (`email-context.ts:15`), `readConsentHistory`, `newestDecidingRow`, `readConsentEvent` (`@bis/db`); keys `conversations.reply.*`.
- Produces:

```ts
// inbound-actions.ts
export type ReplyActionResult = { ok: true } | { ok: false; error: string };
export async function undoReplyStopAction(accountId: string, conversationId: string, eventId: string): Promise<ReplyActionResult>;
export async function stopEmailsFromReplyAction(accountId: string, conversationId: string, contactId: string): Promise<ReplyActionResult>;
// inbound-notice.tsx
export type InboundMeta = { attachmentCount: number; sender: { name: string } | null; consent: { kind: "stopped"; eventId: string } | { kind: "maybe" } | { kind: "none" } };
export function readInboundMeta(meta: unknown): InboundMeta | null;     // null for any message that is not an inbound email
export function InboundNotice(props: { meta: InboundMeta; accountId: string; conversationId: string; contactId: string; locale: Locale }): JSX.Element | null;
```

- [ ] **Step 1: Read** `…/contacts/email-actions.ts` (the `run` shape), `lib/consent/email-context.ts`, `message-thread.tsx`, `message-thread.test.ts`, `…/conv/page.tsx`, `…/contacts/email-row.tsx:90-130` (how a row toasts an Undo), `lib/consent/email-staff-actions.ts`'s `stopEmails`.
- [ ] **Step 2: Failing tests.** `inbound-actions.test.ts` (mock `@/lib/auth`, `@/lib/db`, `@bis/db`, `@/lib/consent/email-context`, `@/lib/consent/email-staff-actions`, `next/cache`):

```ts
describe("undoReplyStopAction", () => {
  it("proves the conversation on the request client, then builds the context for the STOP's own contact (a household member's) and undoes (mutation: use the thread's contact → wrong address, FAILS)", async () => {
    convRead.mockResolvedValue({ id: "conv", contact_id: "ana" });                    // request client: the thread is visible
    dbMock.readConsentEvent.mockResolvedValue({ id: "ev_1", contact_id: "luis", channel: "email", action: "revoked", method: "inbound_email" });
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    staffMock.undoInboundStop.mockResolvedValue({ ok: true, view: {} });
    expect(await undoReplyStopAction(ACCOUNT, "conv", "ev_1")).toEqual({ ok: true });
    expect(ctxMock.emailContextFor).toHaveBeenCalledWith(ACCOUNT, "luis", USER);
    expect(staffMock.undoInboundStop).toHaveBeenCalledWith(CTX, "ev_1");
  });

  it("a conversation the caller cannot see is refused before any service read (mutation: skip the proof → FAILS)", async () => {
    convRead.mockResolvedValue(null);
    expect((await undoReplyStopAction(ACCOUNT, "conv", "ev_1")).ok).toBe(false);
    expect(dbMock.readConsentEvent).not.toHaveBeenCalled();
  });
});

describe("stopEmailsFromReplyAction", () => {
  it("stops the sender's emails over the newest row it reads now (a fresh click; mutation: pass null as expectNewest always → refused over an allowed history, FAILS)", async () => {
    convRead.mockResolvedValue({ id: "conv", contact_id: "ana" });
    ctxMock.emailContextFor.mockResolvedValue(CTX);
    dbMock.readConsentHistory.mockResolvedValue([{ id: "ev_0", action: "resubscribed", method: "staff", occurred_at: "x" }]);
    dbMock.newestDecidingRow.mockReturnValue({ id: "ev_0", action: "resubscribed" });
    staffMock.stopEmails.mockResolvedValue({ ok: true, view: {} });
    expect(await stopEmailsFromReplyAction(ACCOUNT, "conv", "ana")).toEqual({ ok: true });
    expect(staffMock.stopEmails).toHaveBeenCalledWith(CTX, "ev_0");
  });
});
```

(`convRead` is the request client's `from("conversations").select("id, contact_id").eq(…).eq(…).maybeSingle()` answer; build the fake the way `conversations/actions.test.ts` builds its `dbForRequest` fake; read it.)

`inbound-notice.test.ts`:

```ts
describe("readInboundMeta", () => {
  it("reads an inbound email's meta, and null for anything else (mutation: answer {} for a plain message → a notice renders on SMS, FAILS)", () => {
    expect(readInboundMeta({ inbound_email_id: "re_1", attachment_count: 2, sender: { contact_id: "l", first_name: "Luis", last_name: "Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } }))
      .toEqual({ attachmentCount: 2, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } });
    expect(readInboundMeta({})).toBeNull();
    expect(readInboundMeta(null)).toBeNull();
    expect(readInboundMeta({ inbound_email_id: "re_1", attachment_count: 0, consent: { kind: "maybe", phrase: "remove me" } })).toEqual({ attachmentCount: 0, sender: null, consent: { kind: "maybe" } });
  });
});

describe("InboundNotice, English and Spanish", () => {
  const html = (meta: InboundMeta, locale: "en" | "es") => renderToStaticMarkup(createElement(InboundNotice, { meta, accountId: "a", conversationId: "c", contactId: "k", locale }));

  it("names a household member, counts attachments, and shows the stop as a dot and words with a ghost Undo (mutation: drop the dot → FAILS; Undo as default → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 2, sender: { name: "Luis Ruiz" }, consent: { kind: "stopped", eventId: "ev_1" } };
    const en = html(meta, "en"); const es = html(meta, "es");
    expect(renderedText(en)).toContain("from Luis Ruiz");
    expect(renderedText(es)).toContain("de Luis Ruiz");
    expect(renderedText(en)).toContain("2 attachments — not saved yet");
    expect(renderedText(es)).toContain("2 archivos adjuntos — aún no se guardan");
    expect(renderedText(en)).toContain("Stopped marketing emails · from their reply");
    expect(renderedText(es)).toContain("Se detuvieron los correos de promoción · por su respuesta");
    expect(en).toMatch(/data-reply-stopped[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(en)).toContain("Undo");
    expect(renderedText(es)).toContain("Deshacer");
    expect(en).not.toContain('data-variant="default"');
  });

  it("an unclear stop is a chip 'May want to stop' with Stop emails; one attachment reads singular (mutation: use the plural key for 1 → FAILS)", () => {
    const meta: InboundMeta = { attachmentCount: 1, sender: null, consent: { kind: "maybe" } };
    expect(renderedText(html(meta, "en"))).toContain("1 attachment — not saved yet");
    expect(renderedText(html(meta, "en"))).toContain("May want to stop");
    expect(renderedText(html(meta, "en"))).toContain("Stop emails");
    expect(renderedText(html(meta, "es"))).toContain("Quizás quiere dejar de recibirlos");
    expect(renderedText(html(meta, "es"))).toContain("Detener correos");
  });

  it("nothing to say renders nothing (mutation: always render a wrapper → FAILS)", () => {
    expect(html({ attachmentCount: 0, sender: null, consent: { kind: "none" } }, "en")).toBe("");
  });
});
```

`message-thread.test.ts` (append): an inbound email message with `meta.consent.kind = "stopped"` renders `data-reply-stopped`; an SMS message with `meta: {}` renders none (mutation: render `InboundNotice` for every inbound → FAILS).
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.** `inbound-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { readConsentEvent, readConsentHistory, newestDecidingRow, serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { emailContextFor } from "@/lib/consent/email-context";
import { undoInboundStop, stopEmails } from "@/lib/consent/email-staff-actions";
import { m } from "@/lib/messages";

/**
 * The thread's inbound-email actions (S-06 part 1). Every one proves the CONVERSATION on the request
 * client first (0053/0068: a Technician sees only their own customers' threads); only then the service
 * client reads the stop row (its contact may be a household member) and the ledger writes.
 */
export type ReplyActionResult = { ok: true } | { ok: false; error: string };

async function provedThread(accountId: string, conversationId: string): Promise<{ contactId: string } | null> {
  const db = await dbForRequest();
  const { data, error } = await db.from("conversations").select("id, contact_id").eq("account_id", accountId).eq("id", conversationId).maybeSingle();
  if (error || !data) return null;
  return { contactId: (data as { contact_id: string }).contact_id };
}

export async function undoReplyStopAction(accountId: string, conversationId: string, eventId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!(await provedThread(accountId, conversationId))) return { ok: false, error: m["conversations.held.changed"] };
  const row = await readConsentEvent(serviceDb(), accountId, eventId);
  if (!row?.contact_id) return { ok: false, error: m["contact.email.changed"] };
  const ctx = await emailContextFor(accountId, row.contact_id, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const r = await undoInboundStop(ctx, eventId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function stopEmailsFromReplyAction(accountId: string, conversationId: string, contactId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!(await provedThread(accountId, conversationId))) return { ok: false, error: m["conversations.held.changed"] };
  const ctx = await emailContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const newest = newestDecidingRow(await readConsentHistory(ctx.writer, accountId, "email", ctx.address));
  const r = await stopEmails(ctx, newest?.id ?? null);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
```

(`emailContextFor` proves `contactId` on the request client itself (`email-context.ts:18-21`), so a household member the caller cannot see answers its own `no_email`/`failed`. If `readConsentEvent`'s row type names the contact differently, read `consent.ts:176-192` and follow it. The errors here are English `m[...]` because the toast is drawn by the client component, which re-localises: the component maps `ok:false` to its own `t(m, "conversations.held.failed", locale)` unless the error is `contact.email.changed`'s English text, which it maps to `contact.email.changed` in the reader's locale; keep both mappings in the component.) Add to `in-account-service-reads.test.ts`'s `ALLOWED`, beside the conversations line:

```ts
  // S-06 part 1: the thread's inbound-email actions and Needs a look's (Task 12). The conversation, or the held row,
  // is read on the request client first (0082's RLS, 0068's Technician scope); only then the service client.
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/inbound-actions.ts": "proven-target",
```

`inbound-notice.tsx` (`"use client"`): `readInboundMeta` as tested; `InboundNotice` renders, inside the bubble under the body, a flat stack (`mt-1 space-y-1 text-xs`): the member line (`text-muted-foreground`, `t(m, "conversations.reply.fromMember", locale, { name })`), the attachments line (`attachmentsOne` for 1), and either the stopped notice (`<p data-reply-stopped className="flex items-center gap-2"><span data-dot aria-hidden className="size-2 rounded-full bg-[var(--warn)]" />{text}</p>` + `Button variant="ghost" size="sm"` "Undo" calling `undoReplyStopAction`, then `toast(t(m, "conversations.reply.stopUndone", locale))` and `router.refresh()`), or the chip (`<span data-reply-maybe className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5">` dot + "May want to stop") with a ghost "Stop emails" (`t(m, "contact.email.stopEmails", locale)`) calling `stopEmailsFromReplyAction`, toasting `conversations.reply.stopDone`. Nothing when there is nothing to say. Buttons `min-h-11 md:min-h-8`; no spinner (a pending button is `disabled` with `aria-busy`).

`message-thread.tsx`: new props `accountId: string`, `conversationId: string`, `contactId: string`, `locale: Locale`; inside each bubble, after the body: `{(() => { const meta = message.direction === "inbound" && message.channel === "email" ? readInboundMeta(message.meta) : null; return meta ? <InboundNotice meta={meta} accountId={accountId} conversationId={conversationId} contactId={(message.meta as { sender?: { contact_id?: string } } | null)?.sender?.contact_id ?? contactId} locale={locale} /> : null; })()}`. `…/conv/page.tsx`: resolve the locale exactly as the record page does (`getPersonPrefs`, the account's `language` added to the existing `accounts` read's select, `requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, …)` with a named `accountLanguage` variable, `request-locale-callers.test.ts`'s rule) and pass `accountId`, `conversationId={active.id}`, `contactId={active.contactId}`, `locale` to `MessageThread`.
- [ ] **Step 5: Run** the four test files, `…/conv/page.test.ts`, `page.zone.test.ts`, `page.pagination.test.ts` (their `@bis/db`/locale mocks may need `getPersonPrefs` or the `language` column: the vi.mock factory check), `src/lib/i18n/request-locale-callers.test.ts`, `src/lib/i18n/ratchet.test.ts`, `…/acct/in-account-service-reads.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `undoReplyStopAction` without `provedThread` → FAILS; (b) the notice's Undo as `variant="default"` → FAILS; (c) `readInboundMeta` answering for `{}` → FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "inbox: a reply's bubble names the household member, counts attachments, and shows an emailed stop with Undo or a May-want-to-stop chip (S-06 part 1)".

---

## Task 12: Needs a look in the inbox; file / choose / not a customer with Undo; the To do row (bis-comms actions, then bis-frontend)

**Review:** opus. **After:** Tasks 2, 3, 8, 11.

**Files**
- Modify (bis-comms): `…/conv/inbound-actions.ts` (+ test): five more actions
- Create (bis-frontend): `…/conv/held-email-list.tsx` (client), `held-email-list.test.ts`, `…/conv/held-email-skeleton.tsx`
- Modify (bis-frontend): `…/conv/page.tsx` (`?view=held`, the filter link, the count), `…/conv/conversation-list.tsx` (nothing but its `who`/`view` link carry, if needed), `…/conv/page.test.ts`; `…/acct/tasks/page.tsx` (the count, the locale), `…/acct/tasks/work-list.tsx` (one optional prop, one row), new `work-list.held.test.ts`; the styleguide (a held item demo in each state)

**Interfaces**
- Consumes: Task 3's `getInboundEmail`, `decideInboundEmail`, `unfileInboundEmail`, `listHeldInboundEmails`, `countHeldInboundEmails`, `matchSender`, `ensureConversation`, `getContact`; Task 8's `fileInboundEmail`; keys `conversations.held.*`, `work.heldEmails*`.
- Produces:

```ts
// inbound-actions.ts (appended)
export type HeldActionResult = { ok: true; undo: { kind: "unfile"; id: string; messageId: string } | { kind: "undismiss"; id: string } } | { ok: false; error: "changed" | "failed" };
export async function fileHeldEmailAction(accountId: string, id: string, contactId: string | null): Promise<HeldActionResult>;   // null = the suggestion (the token's customer)
export async function dismissHeldEmailAction(accountId: string, id: string): Promise<HeldActionResult>;
export async function undoHeldEmailAction(accountId: string, undo: { kind: "unfile"; id: string; messageId: string } | { kind: "undismiss"; id: string }): Promise<{ ok: boolean }>;
// held-email-list.tsx
export function HeldEmailList(props: { accountId: string; items: HeldItemView[]; locale: Locale; timezone: string }): JSX.Element;
export type HeldItemView = { id: string; fromName: string | null; fromEmail: string; subject: string | null; excerpt: string; receivedAt: string; reason: "not_on_record" | "unverified"; suggestion: { contactId: string; name: string } };
// work-list.tsx
//   WorkList gains `heldEmails?: { count: number; href: string; locale: Locale }`
```

- [ ] **Step 1: Read** `…/conv/page.tsx` (whole), `conversation-list.tsx`, `components/assign/who-filter.tsx` (the filter-pill look this link copies), `components/empty-state.tsx`, `…/acct/tasks/page.tsx`, `work-list.tsx:420-543` (where a row renders and the empty state), `components/command-palette.tsx` (how it calls `/api/accounts/<id>/search?q=`), `apps/web/src/app/api/accounts/[accountId]/search/route.ts` (the `contacts` hits), `apps/web/src/app/(dashboard)/dashboard/styleguide/` (the demo pattern; read `documents-demo.tsx` and its test).
- [ ] **Step 2: Failing tests.** `inbound-actions.test.ts` (append):

```ts
describe("fileHeldEmailAction (spec 'Needs a look')", () => {
  it("proves the held row on the request client, files it on the suggestion with no unread and no forward, as the person (mutation: raiseUnread true → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });             // getInboundEmail on the request client
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_1", created: true, consent: { kind: "none" } });
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: true, undo: { kind: "unfile", id: "ie_1", messageId: "msg_1" } });
    expect(dbMock.decideInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "held", { status: "filed", decidedBy: USER });
    expect(fileMock.fileInboundEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ raiseUnread: false, actor: { id: USER, type: "user" }, contactId: HELD_CONTACT }));
  });

  it("Choose a record: proves the chosen contact on the request client and files on THAT contact's thread (mutation: file on the suggestion → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.getContact.mockResolvedValue({ id: "pat", first_name: "Pat" });
    dbMock.ensureConversation.mockResolvedValue({ id: "conv_pat", created: false });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockResolvedValue({ messageId: "msg_2", created: true, consent: { kind: "none" } });
    await fileHeldEmailAction(ACCOUNT, "ie_1", "pat");
    expect(fileMock.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ contactId: "pat", row: expect.objectContaining({ conversationId: "conv_pat" }) });
    dbMock.getContact.mockResolvedValue(null);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", "ghost")).toEqual({ ok: false, error: "changed" });
  });

  it("a row someone already moved answers 'changed' and files nothing (mutation: skip the compare-and-set → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(false);
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "changed" });
    expect(fileMock.fileInboundEmail).not.toHaveBeenCalled();
  });

  it("a filing failure puts the row back to held and answers 'failed' (mutation: leave it filed → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    fileMock.fileInboundEmail.mockRejectedValue(new Error("down"));
    expect(await fileHeldEmailAction(ACCOUNT, "ie_1", null)).toEqual({ ok: false, error: "failed" });
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "filed", { status: "held", messageId: null, decidedBy: null });
  });
});

describe("dismiss and the Undos", () => {
  it("Not a customer → dismissed; its Undo → held; File's Undo → unfile (mutation: Undo of dismiss calls unfile → FAILS)", async () => {
    requestRow.mockResolvedValue({ ...HELD, status: "held" });
    dbMock.decideInboundEmail.mockResolvedValue(true);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: true, undo: { kind: "undismiss", id: "ie_1" } });
    requestRow.mockResolvedValue({ ...HELD, status: "dismissed" });
    expect(await undoHeldEmailAction(ACCOUNT, { kind: "undismiss", id: "ie_1" })).toEqual({ ok: true });
    expect(dbMock.decideInboundEmail).toHaveBeenLastCalledWith(SERVICE, ACCOUNT, "ie_1", "dismissed", { status: "held", decidedBy: null });
    requestRow.mockResolvedValue({ ...HELD, status: "filed", messageId: "msg_1" });
    dbMock.unfileInboundEmail.mockResolvedValue(true);
    expect(await undoHeldEmailAction(ACCOUNT, { kind: "unfile", id: "ie_1", messageId: "msg_1" })).toEqual({ ok: true });
    expect(dbMock.unfileInboundEmail).toHaveBeenCalledWith(SERVICE, ACCOUNT, "ie_1", "msg_1");
  });

  it("a row the caller cannot see (a Technician's other customer) is refused before any service write (mutation: read the row on the service client → FAILS)", async () => {
    requestRow.mockResolvedValue(null);
    expect(await dismissHeldEmailAction(ACCOUNT, "ie_1")).toEqual({ ok: false, error: "changed" });
    expect(dbMock.decideInboundEmail).not.toHaveBeenCalled();
  });
});
```

(`requestRow` is `getInboundEmail` called with the REQUEST client: mock `getInboundEmail` to answer `requestRow()` when its first argument is the request fake and fail the test otherwise, so a service-client read is caught: `dbMock.getInboundEmail.mockImplementation((c) => c === REQUEST ? requestRow() : Promise.reject(new Error("service read")))`. `HELD` is a held `InboundEmailRow` whose `conversationId` is `"conv"`; `HELD_CONTACT` is that conversation's contact, which the action reads on the request client: `from("conversations").select("contact_id")…`.)

`held-email-list.test.ts`:

```ts
const ITEM: HeldItemView = { id: "ie_1", fromName: "Luis", fromEmail: "luis@example.com", subject: "Re: Your appointment", excerpt: "Is Thursday ok?", receivedAt: "2026-10-16T15:00:00.000Z", reason: "not_on_record", suggestion: { contactId: "ana", name: "Ana Ruiz" } };
const html = (items: HeldItemView[], locale: "en" | "es") => renderToStaticMarkup(createElement(HeldEmailList, { accountId: "a", items, locale, timezone: "America/Chicago" }));

describe("HeldEmailList (spec 'Needs a look')", () => {
  it("each item: sender, subject, time, the reason as a dot and words, the suggestion, ONE primary (mutation: Not a customer as default → two primaries, FAILS)", () => {
    const en = html([ITEM, { ...ITEM, id: "ie_2", reason: "unverified", subject: null }], "en");
    expect(en.match(/data-held-item=/g)).toHaveLength(2);
    expect(en.match(/data-variant="default"/g)).toHaveLength(2);        // one per item
    expect(renderedText(en)).toContain("Luis");
    expect(renderedText(en)).toContain("luis@example.com");
    expect(renderedText(en)).toContain("Re: Your appointment");
    expect(renderedText(en)).toContain("(no subject)");
    expect(en).toMatch(/data-held-reason="not_on_record"[^>]*>\s*<span[^>]*data-dot/);
    expect(renderedText(en)).toContain("Not on this customer's record");
    expect(renderedText(en)).toContain("Couldn't confirm who sent it");
    expect(renderedText(en)).toContain("A reply to an email sent to Ana Ruiz");
    expect(renderedText(en)).toContain("File on Ana Ruiz");
    expect(renderedText(en)).toContain("Choose a record");
    expect(renderedText(en)).toContain("Not a customer");
  });

  it("Spanish (mutation: an English string in the es render → FAILS)", () => {
    const es = renderedText(html([ITEM], "es"));
    for (const s of ["No está en el registro de este cliente", "Respuesta a un correo enviado a Ana Ruiz", "Archivar con Ana Ruiz", "Elegir un registro", "No es un cliente"]) expect(es).toContain(s);
  });

  it("empty: the one sentence that sells it (rule 5; mutation: render nothing → FAILS)", () => {
    expect(renderedText(html([], "en"))).toContain("Emails we couldn't match to a customer wait here for you to file.");
    expect(renderedText(html([], "es"))).toContain("Aquí esperan los correos que no pudimos vincular con un cliente, para que usted los archive.");
  });
});
```

`work-list.held.test.ts`:

```ts
describe("the To do row (spec 'Needs a look')", () => {
  it("N > 0: one row 'N emails need a look' linking to the filter; 1 reads singular; Spanish (mutation: use the plural key for 1 → FAILS)", () => {
    const render = (count: number, locale: "en" | "es") => renderToStaticMarkup(createElement(WorkList, { ...EMPTY_PROPS, heldEmails: { count, href: "/dashboard/accounts/a/conversations?view=held", locale } }));
    const three = render(3, "en");
    expect(three.match(/data-held-emails-row/g)).toHaveLength(1);
    expect(three).toContain('href="/dashboard/accounts/a/conversations?view=held"');
    expect(renderedText(three)).toContain("3 emails need a look");
    expect(renderedText(render(1, "en"))).toContain("1 email needs a look");
    expect(renderedText(render(3, "es"))).toContain("3 correos por revisar");
  });

  it("N = 0 or unknown: no row (mutation: render at 0 → FAILS)", () => {
    expect(renderToStaticMarkup(createElement(WorkList, { ...EMPTY_PROPS, heldEmails: { count: 0, href: "x", locale: "en" } }))).not.toContain("data-held-emails-row");
    expect(renderToStaticMarkup(createElement(WorkList, EMPTY_PROPS))).not.toContain("data-held-emails-row");
  });
});
```

(`EMPTY_PROPS`: copy the minimal props `work-list.consent.test.ts` renders `WorkList` with; read it. If `WorkList`'s empty state replaces every row when the buckets are empty, the held row must render ABOVE that empty state: the test with `count: 3` and empty buckets proves it.)

`page.test.ts` (append): with `?view=held`, the page renders `HeldEmailList` with the mapped items and the header's filter link reads "Needs a look · 2" (`renderedText`, English); when `countHeldInboundEmails` throws, the inbox still renders and the link reads "Needs a look" with no number (mutation: let the throw escape → the page throws, FAILS); when `listHeldInboundEmails` throws under `?view=held`, the error line `conversations.held.loadFailed` renders (rule 5).
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.** In `inbound-actions.ts` append:

```ts
import {
  getInboundEmail, decideInboundEmail, unfileInboundEmail, matchSender, ensureConversation, getContact,
} from "@bis/db";
import { fileInboundEmail } from "@/lib/email/inbound/file";

export type HeldUndo = { kind: "unfile"; id: string; messageId: string } | { kind: "undismiss"; id: string };
export type HeldActionResult = { ok: true; undo: HeldUndo } | { ok: false; error: "changed" | "failed" };

/** The held row, proven on the request client (0082's RLS and its Technician scope). */
async function provedRow(accountId: string, id: string) {
  const db = await dbForRequest();
  const row = await getInboundEmail(db, accountId, id);
  if (!row) return null;
  const { data } = await db.from("conversations").select("contact_id").eq("account_id", accountId).eq("id", row.conversationId).maybeSingle();
  return data ? { db, row, suggestion: (data as { contact_id: string }).contact_id } : null;
}

export async function fileHeldEmailAction(accountId: string, id: string, contactId: string | null): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const p = await provedRow(accountId, id);
  if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
  const target = contactId ?? p.suggestion;
  let conversationId = p.row.conversationId;
  if (target !== p.suggestion) {
    if (!(await getContact(p.db, accountId, target))) return { ok: false, error: "changed" };
    conversationId = (await ensureConversation(serviceDb(), accountId, target, userId)).id;
  }
  const svc = serviceDb();
  if (!(await decideInboundEmail(svc, accountId, id, "held", { status: "filed", decidedBy: userId }))) return { ok: false, error: "changed" };
  try {
    const sender = await matchSender(svc, accountId, target, p.row.fromEmail);
    const r = await fileInboundEmail({ db: svc, now: () => new Date() }, {
      row: { ...p.row, status: "filed", conversationId }, contactId: target, sender, attachmentCount: 0,
      raiseUnread: false, actor: { id: userId, type: "user" },
    });
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return { ok: true, undo: { kind: "unfile", id, messageId: r.messageId } };
  } catch (e) {
    console.error(`fileHeldEmailAction: account ${accountId} row ${id}: ${e instanceof Error ? e.name : typeof e}`);
    await decideInboundEmail(svc, accountId, id, "filed", { status: "held", messageId: null, decidedBy: null }).catch(() => false);
    return { ok: false, error: "failed" };
  }
}

export async function dismissHeldEmailAction(accountId: string, id: string): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const p = await provedRow(accountId, id);
  if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
  if (!(await decideInboundEmail(serviceDb(), accountId, id, "held", { status: "dismissed", decidedBy: userId }))) return { ok: false, error: "changed" };
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return { ok: true, undo: { kind: "undismiss", id } };
}

export async function undoHeldEmailAction(accountId: string, undo: HeldUndo): Promise<{ ok: boolean }> {
  await requireAccountAccess(accountId);
  const p = await provedRow(accountId, undo.id);
  if (!p) return { ok: false };
  const ok = undo.kind === "unfile"
    ? p.row.status === "filed" && await unfileInboundEmail(serviceDb(), accountId, undo.id, undo.messageId)
    : p.row.status === "dismissed" && await decideInboundEmail(serviceDb(), accountId, undo.id, "dismissed", { status: "held", decidedBy: null });
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return { ok };
}
```

(The attachment count of a held email is not stored on the row; a manually filed bubble says nothing about attachments. If the reviewer wants it, the orchestrator adds an `attachment_count` column to 0082 before Task 1 commits — note it in the report as a question, do not change the schema here. A file Undo after the stop rule applied a stop leaves the stop: the notice's own Undo on the thread lifts it; say so in the PR body.)

`held-email-list.tsx` (`"use client"`): a `ListPanel` of items, each `<article data-held-item={id} className={cn("flex flex-col gap-2 px-3 py-3", LIST_ROW)}>`: line 1 sender name (`font-medium`) and address (`text-muted-foreground`) with the time (`formatDateTimeInZone`, `text-xs`, tabular-nums); line 2 the subject (or `noSubject`); line 3 `<p data-held-reason={reason} className="flex items-center gap-2 text-xs">` with a `--warn` dot and the reason's words; line 4 the excerpt (`line-clamp-2`); line 5 the suggestion sentence; then the actions row: `Button` (default) "File on <name>", ghost "Choose a record" (opens an inline search box: an `Input` labelled `searchLabel` that fetches `/api/accounts/${accountId}/search?q=` after 2 characters, lists its `contacts` hits as ghost buttons, `searchEmpty` when none; picking one calls `fileHeldEmailAction(accountId, id, hit.id)`), ghost "Not a customer". Each action removes the item at once (optimistic, from local state) and toasts `filed` (with the chosen name) or `dismissed` with an **Undo** action (`t(m, "common.undo", locale)`) that calls `undoHeldEmailAction` and, on ok, toasts `undone` and `router.refresh()`; a `changed` answer toasts `changed`, a `failed` answer toasts `failed` and puts the item back. Empty: `EmptyState` with `conversations.held.empty`. All copy `t(m, key, locale, params)`. `held-email-skeleton.tsx`: three skeleton items shaped like the article (four `Skeleton` bars and a button-sized bar), no spinner.

`…/conv/page.tsx`: read `view` from `searchParams` (`"held"` or nothing); resolve the locale (Task 11 already added it); read the count `countHeldInboundEmails(db, accountId)` in a `try/catch` (failure → `null`, logged with the account id); read `getInboundSettings(db, accountId)` the same way (failure → `off`). The header's `filters` gains, beside `WhoFilter`, a link `<Link data-held-filter href={view === "held" ? base : `${base}?view=held`} aria-current={view === "held" ? "page" : undefined} className=…the WhoFilter pill classes…>` reading `filterCount` with `{count}` when the count is known and above 0, else `filter`; it renders when the count is above 0 OR the mode is not `off` OR `view === "held"`. With `view === "held"`, the left column renders `<Suspense fallback={<HeldEmailSkeleton />}>` around an async server child that calls `listHeldInboundEmails(db, accountId, { limit: 50 })` and maps to `HeldItemView` (`excerpt` = the first 280 characters of `text`, `suggestion.name` = `contactDisplayName`), or the `loadFailed` line on a throw; the right pane shows the `pickThread` empty state as today. (The `?view=held` list is not paged: 50 newest held items; say in the PR body that a pager is a follow-up if an account ever holds more.) `…/acct/tasks/page.tsx`: the same count read (`try/catch` → no row) and the locale (named `accountLanguage`, `userLanguage: prefs.language`), passing `heldEmails={count ? { count, href: `/dashboard/accounts/${accountId}/conversations?view=held`, locale } : undefined}`. `work-list.tsx`: the optional prop; when `count > 0`, one row ABOVE the buckets (and above the empty state): `<Link data-held-emails-row href={href} className={cn("flex items-center gap-2 px-3 py-2.5 text-sm", LIST_ROW, "hover:bg-[var(--surface-3)]")}>` with an `Inbox` lucide icon and `t(m, count === 1 ? "work.heldEmailsOne" : "work.heldEmails", locale, { count })`. Styleguide: add a held item (both reasons), the empty state and the skeleton to the conversations or a new "Inbox" section following `documents-demo.tsx`'s pattern, with a test that counts `data-held-item` 2.
- [ ] **Step 5: Run** the five test files and every `…/conv/*.test.ts`, `…/acct/tasks/*.test.ts`, the styleguide test, `src/lib/i18n/request-locale-callers.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/components/ui/material.test.ts`, `…/acct/in-account-service-reads.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `provedRow` on the service client → the Technician case FAILS; (b) `fileHeldEmailAction` with `raiseUnread: true` → FAILS; (c) a held item with two primaries → FAILS; (d) the To do row at count 0 → FAILS; (e) the count's throw escaping the page → FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "inbox: Needs a look holds the emails we could not match; file, choose a record or mark not a customer, each with Undo; To do shows how many wait (S-06 part 1)".

---

## Task 13: Regenerate the i18n baselines (bis-comms)

- [ ] **Step 1.** After Tasks 2, 5, 10, 11, 12 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (`ratchet.test.ts:6` names it). Expected: byte-identical, or ONLY reductions. If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string. (`sending-address-card.tsx` reads `m[...]` English like its Settings neighbours; if the generator freezes new English-only keys for it, report that: the `settings.replies.*` keys all have `.es` twins, so none should freeze.)
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed, message "i18n: baselines after S-06 part 1".

---

## Task 14: The e2e spec (bis-e2e-qa)

**Files**
- Create: `apps/web/e2e/inbound-email.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/document-requirements.spec.ts` whole (env loading, the fixture account, the stamped contact, afterAll's checked deletes and re-read), `apps/web/e2e/messaging.spec.ts` (the inbox locators), `apps/web/e2e/support.ts:100-140`, `apps/web/playwright.config.ts:160-175` (one worker).
- [ ] **Step 2: Write the spec.**

```ts
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, ensureReplyToken } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Inbound email, part 1 (spec "Tests": "a held email is filed from Needs a look, then undone"; plan Task 14).
 * The webhook itself is proven by route tests (inbound mail reaches production only, spec "Owner actions");
 * here a HELD row is seeded with the service client and a person files it from the inbox, sees it on the
 * thread, undoes, and sees it back in Needs a look. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one stamped
 * contact made here; never Test Client One. afterAll deletes the inbound row, the thread's messages, the
 * conversation and the contact, checking every error, then re-reads that none is left.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = `Inbound${Date.now()}`;
const ACTOR = "e2e-inbound-email";
let accountId = "";
let contactId = "";
let conversationId = "";
let inboundId = "";
const db = () => serviceDb();
const inbox = (q = "") => `/dashboard/accounts/${accountId}/conversations${q}`;
const item = (page: Page) => page.locator(`[data-held-item="${inboundId}"]`);

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("inbound-email.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Respuesta", lastName: STAMP, email: `${STAMP.toLowerCase()}@example.com` }, ACTOR);
  if (c.existing) throw new Error("inbound-email.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
  ({ conversationId } = await ensureReplyToken(db(), accountId, contactId, ACTOR));
  const { data, error } = await db().from("inbound_emails").insert({
    account_id: accountId, conversation_id: conversationId, provider_email_id: `e2e_${STAMP}`,
    from_email: "neighbour@example.com", from_name: "Vecino", to_email: "r-x@reply.bis-rgv.com",
    subject: `Re: ${STAMP}`, text: `Is Thursday ok? ${STAMP}`, status: "held", hold_reason: "not_on_record",
    received_at: new Date().toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error(`inbound-email.spec: seed failed: ${error?.message}`);
  inboundId = data.id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const svc = db();
  if (inboundId) { const { error } = await svc.from("inbound_emails").delete().eq("id", inboundId); expect(error).toBeNull(); }
  if (conversationId) {
    const { error: e1 } = await svc.from("messages").delete().eq("account_id", accountId).eq("conversation_id", conversationId); expect(e1).toBeNull();
    const { error: e2 } = await svc.from("conversations").delete().eq("id", conversationId); expect(e2).toBeNull();
  }
  if (contactId) { const { error } = await svc.from("contacts").delete().eq("id", contactId); expect(error).toBeNull(); }
  const { count, error } = await svc.from("inbound_emails").select("id", { count: "exact", head: true }).eq("provider_email_id", `e2e_${STAMP}`);
  expect(error).toBeNull(); expect(count).toBe(0);
});

test("a held email waits in Needs a look, with its reason and the suggestion", async ({ page }) => {
  await page.goto(inbox());
  await page.locator("[data-held-filter]").click();
  await expect(page).toHaveURL(/view=held/);
  await expect(item(page)).toContainText(m["conversations.held.reason.notOnRecord"]);
  await expect(item(page)).toContainText(`Re: ${STAMP}`);
  await expect(item(page)).toContainText(m["conversations.held.suggestion"].replace("{name}", `Respuesta ${STAMP}`));
});

test("File on the customer puts it on their thread; Undo brings it back to Needs a look", async ({ page }) => {
  await page.goto(inbox("?view=held"));
  await item(page).getByRole("button", { name: m["conversations.held.fileOn"].replace("{name}", `Respuesta ${STAMP}`) }).click();
  await expect(item(page)).toHaveCount(0);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: m["conversations.held.filed"].replace("{name}", `Respuesta ${STAMP}`) });
  await expect(toast).toBeVisible();
  const { data: filed } = await db().from("inbound_emails").select("status, message_id").eq("id", inboundId).single();
  expect(filed?.status).toBe("filed");
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: m["conversations.held.undone"] })).toBeVisible();
  const { data: back } = await db().from("inbound_emails").select("status, message_id").eq("id", inboundId).single();
  expect(back).toEqual({ status: "held", message_id: null });
  const { count } = await db().from("messages").select("id", { count: "exact", head: true }).eq("id", filed!.message_id!);
  expect(count).toBe(0);
  await page.goto(inbox("?view=held"));
  await expect(item(page)).toHaveCount(1);
});

test("filed for real, it reads on the thread as the customer's email", async ({ page }) => {
  await page.goto(inbox("?view=held"));
  await item(page).getByRole("button", { name: m["conversations.held.fileOn"].replace("{name}", `Respuesta ${STAMP}`) }).click();
  await expect(item(page)).toHaveCount(0);
  await page.goto(inbox(`?c=${conversationId}`));
  await expect(page.getByText(`Is Thursday ok? ${STAMP}`)).toBeVisible();
});
```

(Every test `goto`s its own page; nothing `reload`s another test's state. If `createContact`'s input type differs, follow it. If the fixture account's agency user cannot see the inbox's filter because the account's mode is `off` and the count is read as 0 for a moment, the filter still renders on `count > 0`: the seeded row guarantees it.)
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/inbound-email.spec.ts` lists three tests (listing does not run them). `pnpm --filter web exec eslint e2e/inbound-email.spec.ts`. Commit, message "e2e: a held reply is filed from Needs a look, undone, and filed onto the thread (S-06 part 1)".

---

## Task 15: Whole-branch final review (checkpoint, not an implementer task)

**Review:** opus. Ports `55628`/`55629`/`55630`.

- [ ] **Step 1.** Read the spec whole, this plan's G1–G15 (as ruled in Task 0), then `git diff de3f3551...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2 and 4–12 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/consent/scans.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`. The db suites on a replica of your own: `inbound-email-schema.test.ts`, `schema-grants-guard.test.ts`, the grants suites, the consent suites on `post`; `inbound-email.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. A bis-design-reviewer pass on a running build (Needs a look in both themes at desktop and phone width, loaded, empty, failed; the Replies row; a bubble with the stop notice) if the orchestrator provides one.
- [ ] **Step 3.** Hunt specifically: (a) any path that FILES mail without BOTH the sender match and `senderAuthenticated`; any `Authentication-Results` read that is not the topmost `amazonses.com` one; `headers` (the Record) used for auth anywhere; (b) a token, an address, a subject or a body in any log line; (c) a drop that stores anything; a revoked token or a foreign domain that files or holds; (d) the stop written without `if_allowed`, without `sourceRef`, or after the message; a ledger failure that answers 200; (e) the forward on held mail, on a retried delivery, with `fromAddress`, or blocking the filed message when it fails; (f) the Reply-To on operator mail, on a send with no contact, made on a request client, or made before a blocked send; (g) a service-client read or write in `inbound-actions.ts` before the request-client proof of the conversation or the row; (h) `serviceDb` in any new file under `lib/`; (i) 0082's ASCII rule, `lock_timeout` first, no grant on the new `accounts` or `conversations` columns, RLS on `inbound_emails`, the function body changed in exactly one line, `unfile_inbound_email` service-only; `HOST` in `mx-check.ts` vs 0082's domain CHECK agreeing on every case in `mx-check.test.ts`; (j) rule 8 (one primary per held item; the Sending address card's one primary), rule 3 (every reason and state a dot and words), rule 6 (Undo on File, Not a customer, the Replies change and the stop), rule 7 (skeletons, no spinner), rule 5 (Needs a look's empty and error states; the count's failure never blanks the inbox); (k) a Spanish assertion against `t()`'s output, a raw-markup negative on an apostrophe string, a test that cannot fail; (l) the e2e spec touching anything but the fixture account, or leaving a row.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 16: Rollout (orchestrator; LAST; not a coding task)

- [ ] **Step 1.** The rulings on G1–G15 are in the ledger (Task 0 step 3).
- [ ] **Step 2. bis-ci** (only AFTER Task 15 approves): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s06-inbound-email` → its log lists exactly `0082_inbound_email.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select column_default from information_schema.columns where table_name='accounts' and column_name='inbound_mode'` → `'off'::text`; `select relrowsecurity from pg_class where oid='public.inbound_emails'::regclass` → `t`; `select count(*) from information_schema.column_privileges where grantee='authenticated' and table_name in ('accounts','conversations') and column_name in ('inbound_mode','inbound_domain','reply_token','reply_token_revoked_at') and privilege_type='UPDATE'` → 0; `select has_function_privilege('authenticated','public.unfile_inbound_email(uuid,uuid,uuid)','EXECUTE')` → `f`; `select position('inbound_email' in prosrc) > 0 from pg_proc where proname='append_consent_event'` → `t`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design; after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → the 0081 apply; `select count(*) from consent_events where method not in ('keyword','start_keyword','free_text','staff','staff_undo','carrier_block','unsubscribe_link','one_click','unsubscribe_page','form','booking','inbound_text','backfill_0049','backfill_telnyx','email_bounce','email_complaint')` → 0 (the re-added CHECK will hold); then `apply_migration` with 0082's exact text, ONCE (md5 equals Task 1 step 6's). Ledger line: `0082 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity, the advisor, the webhook.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both; the columns, CHECKs, indexes, the table and its policies, both functions' bodies and ACLs equal. MCP `get_advisors` (security): no new finding naming 0082's objects (both functions are SECURITY INVOKER). Owner action (runbook step 5, ASSUMPTION A5): edit the EXISTING production webhook in Resend to add `email.received`; the orchestrator confirms the event list in the dashboard, never a new webhook.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 15's findings are closed). The PR body names: G1–G15 and their rulings; ASSUMPTIONS A1–A5 and how each is checked; the pinned tests this PR changes; "Not in this PR"; that a File's Undo does not lift a stop the File applied (the thread notice's Undo does); that Needs a look shows the 50 newest held emails with no pager; the 0082 apply lines.
- [ ] **Step 8. After the deploy** (runbook step 6): on BIS's own production account only, Settings → Replies → BIS address; send a composer email to a personal mailbox; reply; confirm the reply files on the thread (or holds, with its reason), the heartbeat `email.inbound` reads ok, and the owner's copy arrives. Read the first real reply's raw headers in Resend's dashboard: record A1 (the raw URL fetched) and A2 (the SES headers sit above any sender-written ones) in the ledger. If it held `unverified` for a Gmail sender, A1 failed: stop and report before turning Replies on for any client. Tracker: item 7 / S-06 `in_progress` with "part 1 (replies come back) shipped #<n>".

---

## Not in this PR

- Forward-to-record addresses and the never-log list (spec part 2); web chat in the inbox and the channel-following composer (part 3).
- Attachments stored in the vault (the bubble and the owner's copy say they are not saved yet).
- The agency's cross-account work queue row (G8).
- A button to revoke one leaked reply address (the runbook's manual `reply_token_revoked_at`).
- Threading headers (`In-Reply-To`) on outbound mail; an owner's own Gmail or Outlook sync.
- A pager on Needs a look (50 newest).
- Resume emails over an emailed stop (G9).

## Spec coverage

| Spec section / requirement | Task |
|---|---|
| Turning it on: Off / BIS address / Own domain, dot and word, agency only, Check DNS before Own domain | 10 (actions, card), 3 (`setInboundSettings`), 1 (columns) |
| An Owner sees where replies go, read-only | 10 (Branding line; G6) |
| Outbound: Reply-To `r-<token>@<domain>` on every customer kind, token lazy, conversation ensured, gate is the one change point, operator mail untouched, `reply_to_email` becomes the forward destination | 6, 3 (`ensureReplyToken`), 9 |
| Inbound 1: svix verify | 8 (route; G1 keeps 400) |
| Inbound 2: fetch, 503 on failure, dedupe on Resend's id | 7, 8, 3 (`recordInboundEmail`) |
| Inbound 3: recipient parse, domain belongs to the token's account, drop unknown/revoked/foreign with one log line | 4 (`parseReplyAddress`), 8, 3 (`findReplyThread`) |
| Inbound 4: sender check, contact or group member AND topmost `amazonses.com` auth with both verdicts | 3 (`matchSender`), 4 (auth), 8 |
| Inbound 5: filed message fields, new text EN/ES, meta, unread, member named | 4 (`newText`), 8 (`file.ts`), 11 (bubble) |
| Inbound 6: held is only the row | 8 |
| Inbound 7 + The stop rule: clear stop → ledger `inbound_email`, notice with Undo (reversing staff event), 503 on ledger failure; unclear → chip with Stop emails; covers referral asks | 5, 8, 11, 1 (method, function line) |
| Inbound 8: the owner's forwarded copy | 9 |
| Inbound 9: `stampHeartbeat("email.inbound")` | 8 |
| Attachments: "2 attachments — not saved yet" | 8 (meta), 11 (bubble), 9 (owner's copy) |
| Needs a look: filter with count, items with reason in words and the suggestion, File (no unread, stop runs, no forward) with Undo, Choose a record, Not a customer with Undo, empty/error/loading, To do row when N > 0, EN and ES | 12, 2 |
| Data model 0082 | 1 |
| Failure behaviour table | 8 (route and pipeline tests), 9 |
| Tests: unit (token parse, sender check cases, quote stripping EN/ES, stop classifier on new text), route (filed, held both reasons, duplicate, revoked, foreign, fetch 503, ledger 503, forward failure), db/RLS, e2e | 4, 5, 8, 1, 3, 14 |
| Owner actions (runbook steps 2, 3) | 16 |

## Self-review notes (the writer's own pass, 2026-10-16)

- Counts read off this file: G1–G15 is fifteen rows; A1–A5 is five; Task 16 has eight steps; the e2e spec lists three tests; `classes.test.ts` 27 → 28 and `scans.test.ts` 38 → 39 each add exactly one kind (`operator.reply_forward`).
- Names checked across tasks: `ensureReplyToken(db, accountId, contactId, actorId, make?)` (Tasks 3, 6, 14); `fileInboundEmail(deps, { row, contactId, sender, attachmentCount, raiseUnread, actor })` (Tasks 8, 12); `recordInboundStop(writer, { accountId, contactId, address, providerEmailId, phrase })` (Tasks 5, 8); `MessageConsent` kinds `stopped | maybe | none` in `meta.consent` (Tasks 8, 11); `HeldUndo` kinds `unfile | undismiss` (Task 12, both sides); `InboundSettings { mode, domain }` (Tasks 3, 6, 10).
- Open question for the orchestrator (not a spec contradiction): a held row does not store its attachment count, so a bubble filed from Needs a look says nothing about attachments. Adding `inbound_emails.attachment_count` to 0082 before Task 1 commits would close it; Task 12 asks rather than changes the schema.

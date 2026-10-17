# Web chat in the inbox, and a composer that follows the last reply (S-06 part 3), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a website chat becomes a lead, the whole chat files on that customer's inbox thread as **Web chat**, one `messages` row per turn (the visitor's turns inbound with the customer mark, Sofía's outbound with "Sofía · AI"), and every later turn joins it as it happens; a visitor turn after the lead raises unread and moves the thread up like a text, Sofía's never do. A chat matched to an existing customer by what the visitor typed carries ONE "Matched by the phone or email they typed; not confirmed." line. The record gets ONE timeline row per chat ("Customer chatted with Sofía on your website · 12 messages") and the chat counts for "Last talked". The inbox composer becomes **Text | Email** (the record's own composer, two tabs) and opens on the channel of the customer's most recent text or email reply, decided on the server; it never opens on a channel the customer stopped, one tap switches for one message, and nothing ever sends a web chat row.

**Architecture:** No migration. `@bis/db` gains a pure, import-free planner on a subpath (`@bis/db/webchat-plan`: which transcript turns are missing, each row's key, time, meta and unread flag), a writer `fileWebchatTurns` in `messaging.ts` (one insert per row in index order, `23505` = already there, then one touch, one `webchat.filed` event and the unread raise per batch), and `webchat.ts` (the thread resolver through the lead, the keys read, and `syncWebchatTurns`, which never throws and answers an outcome). The turn route stamps the visitor line with the request's arrival and schedules ONE `after()` job when a lead is on file; the job's outcome is logged with the account id only, and nothing it does can reach the visitor's response. `listMessages` gains the author pair; the channel union and its labels gain `webchat` and Spanish. The record's timeline gains a ninth source, `chats` (one anchor row per chat, index 0, plus a count read), a `chat` entry kind with the customer mark, and "Last talked" counts `webchat`. The inbox thread draws the web chat bubble (both marks, the chat's own `lang`, a footer in the staff member's language, no status word) and the unconfirmed line; its composer is the record's `MessageComposer` with `modes` and `initialMode`, whose start channel two pure functions decide on the server.

**Tech Stack:** Next.js 16 App Router (route handler with `after()`, server components); React 19; supabase-js against PostgREST; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); the `@bis/db` suites on a local PG18 replica (plus a local PostgREST for service-client functions) and CI `verify`; Playwright on the per-run fixture account.

**Spec:** `docs/superpowers/specs/2026-10-17-webchat-inbox-design.md` (approved 2026-10-17, amended by the owner's rulings at `9e24720d`; G1-G17 ruled, and **G18-G22 accepted as proposed on 2026-10-17 (tile), marked in the spec by this plan's commit**). The source of truth: this plan does not re-decide it, and every place the code forces a choice the spec does not make is a row in "Spec gaps" below (G23-G31), for the owner. Part 1's plan (#264): `docs/superpowers/plans/2026-10-16-inbound-email.md`; part 2's (#266): `docs/superpowers/plans/2026-10-17-forward-to-record.md`, whose structure this follows. Base: branch `feat/s06-webchat-inbox` at `9e24720d` (two spec commits on `main` at `d6be0a06`, #266; migrations through **0083** are on `main` and applied on bis-ci and production: **never re-apply**). Every file:line below was read off this worktree at `9e24720d`; anything not read is labelled **ASSUMPTION**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s06-3` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s06-3`), branch `feat/s06-webchat-inbox`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\961ab109-86a5-4cbc-b28d-a1d79e9e5ca4\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/961ab109-86a5-4cbc-b28d-a1d79e9e5ca4/scratchpad`); write it out literally in every command. `<KIT2>` = part 2's kit, `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad/s06b-kit` (read 2026-10-17: `replica.sh` pins `WT=/c/Users/danlo/bis-platform/.claude/worktrees/s06-1`, skips `*0083_*` and applies 0083 as `post`; `pgrst.sh` carries `SECRET="s06b-local-postgrest-jwt-secret-not-used-anywhere-real-0000"` and copies `postgrest.exe`, `make-jwt.js`, `proxy.mjs` from `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`, which exists). `…/acct/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/conv/` = `…/acct/conversations/`. `…/record/` = `…/acct/contacts/[contactId]/`. `…/group/` = `…/acct/groups/[groupId]/`. `…/sg/` = `apps/web/src/app/(dashboard)/dashboard/styleguide/`. `<ROUTE>` = `apps/web/src/app/api/concierge/[publicId]/turn/`.

## External facts and assumptions (read before any task)

**Read in the code at `9e24720d`:**
- The turn route takes `startedAt = Date.now()` first (`<ROUTE>route.ts:155`), lazily destructures every `@bis/db` function it uses from ONE `await import("@bis/db")` (`:178-183`), captures `conversation` at the turn's start (turn 1 builds it with `submission_id: null`, `:379-384`; turn 2+ reads it, `:388`), sets `let filed = !!conversation.submission_id` (`:522`), may set it true from `fileLead` (`:538-559`) or from the another-tab re-read (`:567-568`), appends both lines with one `now` (`:642`, `:653-656`), schedules the usage leg in `after()` (`:688-700`) and returns `quiet(conversationId, spoken, false)` (`:702`). Every refusal returns before the append (`:207`, `:292-315`, `:335-343`, `:349`, `:395`, `:402`, `:417`, `:509`). Its `log()` writes `JSON.stringify({ at: "concierge/turn", msg, ...extra })` to `console.log` (`:129-131`).
- `route.test.ts` records `after()` callbacks with `afterMock` and runs them with `flushAfter()` (`:24-38`); its `@bis/db` mock spreads the real module and overrides every name in the hoisted `dbFns` (`:8-21`, `:64-104`); ONE test pins the after count: "records in after(), once the visitor has the reply" expects `afterMock` called once on a first turn with no lead (`:1132-1139`).
- `getConciergeConversation(db, id)` is not account-scoped (`packages/db/src/concierge.ts:238-245`); `ConciergeConversationRow` carries `account_id`, `transcript`, `submission_id`, `locale` (`:211-215`).
- `messages`: `channel` CHECK allows `webchat` (0006:92); `provider_message_id` has ONE project-wide partial unique index, `messages_provider_message_id_unique` (0005:51-52), and no other unique index; `created_at` is a plain default (0005:43); `author_id` only with `author_kind = 'person'` (0073:54-57). RLS: `messages_member_read` (0053:116) and `messages_technician_scope` through the conversation (0068:124-126).
- `createMessage` (`packages/db/src/messaging.ts:139-189`) emits `message.created` per row (`:168-170`) and touches `last_message_at` per row (`:181-186`); `NewMessage["channel"]` is `"email" | "form" | "voice" | "sms"` (`:20`); `MESSAGE_COLS` (`:81-82`) has no author pair and `listMessages` orders by `created_at` only (`:833-842`); `ContactMessageRow` is `listMessages`' row type plus an optional author pair (`:827-831`). `incrementUnreadCount` is one RPC per call (`:581-587`).
- `updateMessageStatusByProviderId(db, providerMessageId, status, patch?)` matches `provider_message_id` + `direction = 'outbound'` with NO channel filter (`messaging.ts:225-246`): asked with a `webchat:` key it would update Sofía's row (gap **G29**).
- `messageAuthor(actorType, actorId, direction)`: `ai` → `ai`; inbound → `customer` (`packages/db/src/provenance.ts:19-24`).
- `emit(db, accountId, type, actorId, payload, actorType)` inserts into `events` on a service client (`packages/db/src/events.ts:16-40`); `events.type` has an index and no CHECK (0001:68).
- `MESSAGE_CHANNEL_LABEL: Record<NewMessage["channel"], string>` (`apps/web/src/lib/labels.ts:46-51`), so `webchat` in the union is a compile error until the label exists; `messageChannelLabel(channel)` takes no locale (`:63-64`); the thread is its only caller (`…/conv/message-thread.tsx:131`). `conversations.status.*` already have `.es` twins (`apps/web/src/lib/messages.ts:1322-1333`); the four channel keys do not (`:1474-1477`).
- The thread bubble's footer has no `lang` and is English (`message-thread.tsx:120-136`); the body's `lang` is the contact's for inbound non-voice rows (`:111-118`).
- The inbox renders `EmailComposer` (`…/conv/page.tsx:357-362`); `EmailComposer`'s only other importer is its own test (grep). `MessageComposer` (`…/record/message-composer.tsx:39-251`) is `"use client"`, starts on `"note"` (`:78`), requires `noteAction` (`:69`), renders three tabs from a literal list (`:162`), keeps the mode after a send (`:120-131`). Its test has no DOM (`renderToStaticMarkup`, `message-composer.test.ts:1-3`).
- `canTextFrom({ phone, smsGate, smsBlockedLine })` (`apps/web/src/lib/record/header-actions.ts:25-27`); `smsRecipientState` / `emailRecipientState` never throw and answer `unknown` on a failed read (`apps/web/src/lib/consent/recipient-state.ts:21-90`); `softSmsGate` answers null on a failed read (`apps/web/src/lib/record/loaders.ts:166-173`); `composerStateLine` / `composerEmailNotice` (`apps/web/src/lib/consent/composer-state.ts:47-97`). The email form STILL shows when the address is stopped (`composer-state.ts:76-84`).
- The account layout wraps every in-account page in `LocaleProvider` with the same `requestLocale` resolution the inbox uses (`…/acct/layout.tsx:65-79`).
- `…/conv/page.tsx` is already in `in-account-service-reads.test.ts`'s `ALLOWED` as `proven-target` (`:126`).
- `page.sender-visibility.test.ts:113-116` pins `getContactCalls` to EXACTLY `[{ accountId: "acct1", id: "luis" }]`; its request client throws on any table but `accounts` (`:38-44`); its `@bis/db` factory lists five names only (`:88-95`).
- The record timeline: `TimelineSource`/`TIMELINE_SOURCES` (`packages/db/src/record.ts:265-266`), `TimelineEntry` (`:291-310`), `listTimelinePage`'s `settle` per source (`:347-404`); `withTimelinePage` / `forContacts` (`packages/db/src/timeline-cursor.ts:68-83`). `TimelineEntry` kinds are switched exhaustively in `lib/record/author-mark.ts:25-70`, `lib/record/timeline-rows.ts:58-125`, `lib/record/recent-rows.ts:24-54`, `…/record/activity-timeline.tsx:146-260`, `…/group/group-timeline.tsx:104-195`, and keyed in `…/acct/contacts/contact-drawer.tsx:64-68` (`ROW_ICON`); `SOURCE_KEY: Record<TimelineSource, MessageKey>` (`timeline-rows.ts:37-41`).
- The kit's grammar is "mark · verb · status · detail · time" with the mark chip directly before a lowercase verb (`components/record/timeline-item.tsx:36-73`; `timeline.texted` = "texted", `messages.ts:4517`); the call row opens its page through an "Open call" ghost link in `action`, not a whole-row link (`activity-timeline.tsx:253-256`, `timeline.openCall` "Open call" / "Ver llamada", `messages.ts:4527-4528`); the drawer's rows carry no link (`lib/record/recent-rows.ts:7-9`). Plurals are `key` + `${key}One` (`apps/web/src/lib/i18n/t.ts:16-18`, `plural` `:56-68`; `tr.count`, `lib/record/copy.ts:9-22`).
- "Last talked": `newestConversationMessage` and `newestSetMessage` filter `.in("channel", ["email", "sms"])` and map sms → text, else email (`record.ts:53-65`, `112-127`); the fact reads `record.facts.channel.${channel}` (`lib/record/record-facts.ts:65`, `group-facts.ts:36`).
- Pinned timeline tests: `TIMELINE_SOURCES` is asserted as an exact list (`packages/db/src/test/record.test.ts:298`); `timeline-merge.test.ts` counts paged reads as `TIMELINE_SOURCES.length + 5` (`:147`) and pins `failed` to `["messages", "calls"]` when `messages` errors (`:157-164`).
- Every `from("messages")` outside tests, by file: `lib/auth/visible.ts` 1, `automations.ts` 3, `booking.ts` 3, `inbound-email.ts` 2, `messaging.ts` 12, `record.ts` 2, `voice.ts` 1 (grep). The spec's readers table omits `booking.ts:589` and `inbound-email.ts:281` (gap **G30**).
- `CONCIERGE_MAX_TURNS = 24` (`apps/web/src/lib/concierge/guards.ts:14`).
- The i18n baselines regenerate with `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (`apps/web/src/lib/i18n/ratchet.test.ts:1-11`).

**ASSUMPTIONS (each has a named check):**
- **A1** PostgREST through supabase-js filters a JSON path with `.eq("meta->webchat->>index", "0")` and `.in("meta->webchat->>chat_id", ids)`, and selects an aliased path with `"chat_id:meta->webchat->>chat_id"`. Check: Task 7 step 4's replica run behind the local PostgREST (the chats source returns one entry per chat with its count), and CI `verify`.
- **A2** On Vercel an `after()` callback runs once the response has been sent and is bounded by the function's `maxDuration` (30 s, `route.ts:61`); a callback cut off by the platform never changes the sent response. Check: Task 13 step 8 (a real post-lead turn shows its pair on the thread within seconds, and the visitor's reply time is unchanged in the browser's network panel).
- **A3** `.like("provider_message_id", "webchat:<uuid>:%")` is SQL LIKE through PostgREST, and a plain insert that collides on the partial unique index answers `error.code === "23505"` (the `ensureConversation` pattern, `messaging.ts:120-127`). Check: Task 3 step 6 (the keys read finds the rows; the second identical batch inserts nothing).

## Spec gaps and contradictions

G1-G17 were ruled by the owner on 2026-10-17 (spec rows); **G18-G22 were accepted as proposed on 2026-10-17 (tile)** and this plan's commit marks them in the spec. The rows below are NEW: each is a choice the code forces that the spec does not make. **Task 0 asks the owner to rule on G23-G31; the plan is written to the proposal, and an implementer never re-asks.**

| # | What the spec says / omits | What the code says | Proposal |
|---|---|---|---|
| G23 | The record row's copy: `timeline.webchat` = "Chatted with {name} on your website · {count} messages", `timeline.webchat.one` for 1 (spec "Copy") | The kit draws the mark chip directly before a LOWERCASE verb and puts the detail after its own separator (`timeline-item.tsx:56-71`; "Customer texted"); a key holding " · " would print a literal dot inside the verb; plurals are `key` + `${key}One` (`t.ts:16-18`), so `.one` is not a plural `tr.count` can read | Verb `timeline.webchat` = "chatted with {name} on your website" / "conversó con {name} en su sitio web"; detail `timeline.webchatCount` = "{count} messages" / "{count} mensajes" and `timeline.webchatCountOne` = "1 message" / "1 mensaje". The row reads exactly as the spec's example: "Customer chatted with Sofía on your website · 12 messages · 2:14 PM". |
| G24 | (silent) a failed `chats` source | `SOURCE_KEY: Record<TimelineSource, MessageKey>` (`timeline-rows.ts:37`) names every source in "Couldn't load …" | New key `timeline.what.chats` = "website chats" / "chats del sitio web". |
| G25 | "the whole row opens `/conversations?c=<id>`" (§7) | `TimelineItem` has no whole-row link; the one row that opens another page does it with an "Open call" ghost link in `action` (`activity-timeline.tsx:253-256`); the drawer's rows carry no link (`recent-rows.ts:7-9`) | An "Open chat" ghost link in the row's `action` slot on the record and group pages (`timeline.openChat` = "Open chat" / "Ver chat", the "Ver llamada" pattern), `data-timeline-open-chat`; the drawer's chat row has no link, like every drawer row. |
| G26 | The web chat footer is "in the STAFF member's language" (§5); G8 gives every channel label `.es` | The footer `<p>` has no `lang` and its status word is English (`message-thread.tsx:120-136`) | EVERY bubble's footer is in the staff member's language with `lang={locale}`: the time (`formatDateTimeInZone(…, locale)`), the channel label (`messageChannelLabel(channel, locale)`) and the status word (`conversations.status.*`, which have `.es`, `messages.ts:1322-1333`). English output is byte-identical to today's. |
| G27 | Unread: "+1 per inserted visitor row" when "the lead was on file when this turn STARTED" (§4, G7) | The sync copies whatever is missing (§3 step 3): when the filing turn's sync failed, the NEXT turn's sync copies the pre-lead turns too, and the turn-start rule alone would raise unread for every one of them | A visitor row raises unread only when BOTH hold: the turn-start rule (route), AND the turn's own `at` is later than the submission's `created_at` (planner, `countsUnread`). On every path the spec describes the two agree (the filing turn's visitor line is stamped at the request's arrival, before the submission exists, G4); on the healing path only the post-lead turns count. |
| G28 | "once per batch: the conversation touch …, one event, and the unread raise" (§3 step 5) | (silent) a batch that inserts nothing (a second tab's sync, a retry) | A batch that inserted nothing writes nothing: no touch, no event, no unread. `syncWebchatTurns` answers `nothing_new` before writing when the keys read already holds every index. |
| G29 | "A `webchat:` key never matches a Resend or Telnyx id" (readers table) | True of the providers, but `updateMessageStatusByProviderId` would update Sofía's row if ever asked with one (`messaging.ts:242-246`: provider id + outbound, no channel) | Defence in depth: that read gains `.neq("channel", "webchat")`, so no delivery event can ever relabel a chat row; pinned on the replica (Task 3). |
| G30 | The readers table (spec "Every reader of `messages`") | It omits `booking.ts:589` (a discarded booking notice re-sorts the thread to its newest message of ANY kind) and `inbound-email.ts:281` (an unfiled email does the same) | Accepted as they are: after one of those two rare repairs the thread may sort by Sofía's last line, which §4 otherwise never lets happen. Named in the PR body; no code change. |
| G31 | The inbox composer "returns to the server's `initialMode`" after a send; "the tab group's label" `conversations.compose.via`; "the record page's composer is unchanged" (§6) | One component serves both | `modeAfterSend` returns to `initialMode` only when the caller passed one (the inbox); the record passes none and keeps today's behaviour (it stays on the channel it sent on). The tab group carries `role="group"` and "Reply by" only when its modes hold no Note (the inbox). |

**Contradictions between the spec and the code** (beyond the gaps): none that blocks a ruling. The spec's readers table is incomplete (G30) and its row copy cannot be drawn as worded (G23, G25).

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. To undo your own edit, edit it back; to see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. A file this plan retires is removed with `git rm <path>` and nothing else. Commit with `git add <every path> && git commit -m "…" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push, never touch `main` (the orchestrator pushes).
- **No migration.** Nothing in this PR applies anything to bis-ci or production. If a task finds it needs one, it STOPS and reports; the orchestrator re-opens the spec.
- **`@bis/db` suites run only on the replica kit below, or in CI `verify`** (its own Supabase stack), never against bis-ci from an agent. In `packages/db`, run vitest as `node node_modules/vitest/vitest.mjs run <files>`; capture the exit code to a file with nothing after the command and judge by vitest's summary block (the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). The kit exports `PGCLIENTENCODING=UTF8`.
- **Agents run only the affected tests, by path:** `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter @bis/db typecheck`, `pnpm --filter web exec eslint "<touched files>"`. Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never a Playwright run: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/acct/` to vitest (it holds a live test).
- **Never production Supabase (`tlbkbmlrfafquucsmsmm`), never a production credential anywhere, never create or edit `.env*`, never set a Vercel secret.** No new environment variable. **No unit test calls OpenAI, Telnyx, Resend or Clerk**: the route tests stub `fetch`. The one e2e that posts a real turn uses whatever `OPENAI_API_KEY` the run has (CI's `e2e` job carries the separate `bis-ci` key, `.github/workflows/ci.yml:308-318`, the precedent `concierge.spec.ts`'s reply test already uses) and skips itself without one (`concierge.spec.ts:318-324`'s rule); it runs only where the orchestrator or CI runs Playwright.
- **0053, server-only writes.** Every `messages` write in this PR goes through the turn route's service client (`<ROUTE>route.ts:203`) into `@bis/db`; no client write. `in-account-service-reads.test.ts` `ALLOWED` is unchanged: `…/conv/page.tsx` is already `proven-target` and its new reads come after `getContact` on the request client. **No new file under `apps/web/src/lib` contains the token `serviceDb` or `ledgerDb`, not even in a comment** (that test's `ROOTS` include `lib`): lib functions take the caller's client or a thunk as a parameter.
- **Never a transcript word, a name, a phone number, an email address, a contact id or a conversation id in any NEW log line** (spec decision 5: "account id only"). The route's new lines are exactly `{ msg: "webchat sync failed", accountId, stage }`, `{ msg: "webchat sync dropped", accountId, reason: "no customer" }`, `{ msg: "webchat sync partial", accountId, inserted, stopped, failedSteps }`. `@bis/db`'s new functions never log; they answer outcomes.
- **The client/server module boundary (part 1, Task 11b CRITICAL).** A server component never CALLS a value exported from a `"use client"` module. `start-channel.ts`, `composer-facts.ts` and `webchat-meta.ts` carry NO directive; `message-composer.tsx` (`"use client"`) exports components and pure helpers that only CLIENT code calls. Each UI task's test pins the import SITE: the server file imports its functions from the plain modules, and imports nothing from `message-composer.tsx` but the component.
- **Server-compute render-deciding state.** The start channel, the readiness of each channel, the persona name, which row carries the unconfirmed line and the chat row's count are decided on the server and passed as data.
- **A thrown server action toasts its catch-all line**: `MessageComposer`'s existing `useFormSubmit` catch (`message-composer.tsx:132-156`) already does it for both actions the inbox passes; Task 6 keeps it and its test pins that the inbox's two actions go through it.
- **`lang={locale}` on every block rendered in the staff member's locale** (the footer, the unconfirmed line, the tab group's label), while a chat bubble's body carries `lang={meta.webchat.locale}` (the language the visitor chatted in; one message, one language).
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches it: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. Where a factory deliberately leaves a name out (the page tests below), the test states which real state the missing name stands for. A `"use server"` module is never imported into vitest without a `vi.mock` for it. The planner is imported from the SUBPATH `@bis/db/webchat-plan` precisely so a test that mocks `@bis/db` still runs the real planner.
- **Every test must be able to fail.** Each test names the mutation that breaks it; the implementer runs the probe, sees the test fail BY NAME, pastes the failing assertion line, and edits back (memory "Vacuous test shapes": no `toBeTruthy` on content, no mock that satisfies itself, no assertion on a value the fixture already held, no `-t` filter that matches nothing; check the run count in vitest's summary). **A mock never answers a state production cannot reach**: a `getContact` mock that ignores RLS, a `syncWebchatTurns` mock that both throws and returns, a transcript whose `at` is not an ISO instant the route writes.
- **DESIGN.md definition of done for every UI task (7, 8):** tokens only (bubbles keep `rounded-[var(--radius-ctl)]`, `--accent-dim` and `--surface-2`; no hex, no literal shadow); both themes through the `.dark` class (the bubbles reuse today's two surfaces); the blur fallback (no new glass); rule 3 (the chat row has no status, so no dot; the unconfirmed line is a fact, not a status, so no dot); rule 5 (the thread: loading is the page's existing skeleton, an empty thread is never listed, a failed persona read costs only the name; the chat row: the `chats` source fails alone into `failed`); rule 7 (no spinner); rule 8 (the inbox composer's ONE primary is Send, as on the record; "Open chat" is ghost); the provenance rule (every chat row and every chat bubble carries a mark from the closed five); controls `min-h-11 md:min-h-8`; nothing animates on scroll; the module contract (one entry in an existing list, one kind of row on the existing timeline, the existing composer); `/styleguide` gains the web chat bubble and the chat row; English and Spanish, `lang` set, the pseudo-locale's +35 % on the record row.
- **Copy.** Plain words a business owner reads at 7 AM; no "webchat", "concierge", "transcript", "provider", "index" or vendor word in any string. Every key is added by **Task 1 only**, each English line followed directly by its `.es` line, Spanish in **usted**. New `.tsx` code carries no JSX literal copy with a letter in it (`lib/i18n/ratchet.test.ts`). Every copy assertion goes through `renderedText()` (`apps/web/src/lib/rendered-text.ts`) and asserts BOTH languages against literal strings, never against `t()`'s output (it falls back to English silently).
- **Mutating e2e only on the per-run fixture account**, never `Test Client One`; every seeded row is deleted in a `finally`, each error checked, then EVERY table it deleted from is re-read to confirm none is left. Locators address rows by `data-webchat-row` / `data-webchat-unconfirmed`, never by text that a list preview could also hold (part 1's strict-mode failure).

## Ownership (no task edits a file its owner does not own)

- **bis-comms:** `apps/web/src/lib/messages.ts` + one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 1 only**); `packages/db/src/{webchat-plan,webchat,messaging,index}.ts`, `packages/db/package.json` (one `exports` line), `packages/db/src/test/webchat.test.ts` (new), `apps/web/src/lib/concierge/webchat-plan.test.ts` (new), `apps/web/src/lib/labels.ts` + `labels.test.ts` (new) (Tasks 2, 3); `<ROUTE>route.ts` + `route.test.ts` (Task 4); `…/conv/{start-channel,composer-facts}.ts` + tests (Task 5); `…/record/message-composer.tsx` + test (Task 6); `apps/web/src/lib/messages-readers.test.ts` (new) (Task 9); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 10, regenerated, never hand-edited).
- **bis-crm** (the record timeline and its facts; the orchestrator confirms this agent owns `lib/record/**` and the three timeline renderers for this PR, or names the owner before Task 7 starts): `packages/db/src/record.ts`, its export line in `packages/db/src/index.ts` (additive, after Task 3's commit), `packages/db/src/test/{record,timeline-merge}.test.ts`, `packages/db/src/test/webchat-rls.test.ts` (new); `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` + tests; the ONE `chat` case in `…/record/activity-timeline.tsx` + `activity-timeline.rows.test.ts`, in `…/group/group-timeline.tsx` + `group-timeline.test.ts`, and the ONE `ROW_ICON` entry in `…/acct/contacts/contact-drawer.tsx` (Task 7: the kind and every exhaustive switch over it must land in one commit, or `pnpm --filter web typecheck` is red between commits).
- **bis-frontend:** `…/conv/{webchat-meta.ts,message-thread.tsx,page.tsx}` + `webchat-meta.test.ts`, `message-thread.test.ts`, `page.webchat.test.ts` (new), and the ONE line in `page.sender-visibility.test.ts`; `git rm` of `…/conv/email-composer.tsx` and `email-composer.test.ts`; `…/sg/webchat-demo.tsx` + test and one line in `…/sg/page.tsx` (Task 8).
- **bis-e2e-qa:** one test in `apps/web/e2e/concierge.spec.ts` (Task 11).
- **Orchestrator:** Task 0's confirmations and the owner's rulings on G23-G31, the ledger, the gates, the PR, the merge, the post-deploy smoke, the roadmap tracker row (Task 13).

**Shared files, one task at a time:** `apps/web/src/lib/messages.ts` (**Task 1 only**: a later task that finds a key missing STOPS and reports; the orchestrator re-opens Task 1). `packages/db/src/index.ts` (Task 3, then Task 7). `packages/db/src/messaging.ts` and `package.json` (Task 3 only; Task 2 adds the subpath line, Task 3 does not touch it). `…/sg/page.tsx` (Task 8 only). `apps/web/src/lib/i18n/*-baseline.json` (**Task 10 only**).

## The replica kit (every `@bis/db` task and its reviewer)

No migration, so `post` is simply every migration through 0083. Ports, one set per agent, never `5432`, clear of parts 1-2 (`55620`-`55650`): Task 3 implementer Postgres `55660`, PostgREST `55661`, gateway `55662`; Task 3 reviewer `55663`/`55664`/`55665`; Task 7 implementer `55666`/`55667`/`55668`; Task 7 reviewer `55669`/`55670`/`55671`; Task 12 (final review) `55672`/`55673`/`55674`. Each agent works in `<SCRATCH>/s06c-t<N>-<impl|review>/`.

Task 3 builds the kit ONCE (Task 7 and the reviewers reuse it):

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/961ab109-86a5-4cbc-b28d-a1d79e9e5ca4/scratchpad
K2=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad/s06b-kit
mkdir -p "$S/s06c-kit"
sed -e 's#worktrees/s06-1$#worktrees/s06-3#' -e 's#\*0083_\*#*0084_*#' -e 's#0083_inbound_never_log.sql#0084_none.sql#g' \
    -e 's#post = pre + 0083#post = pre + 0084#' -e 's#0083 FAILED#0084 FAILED#' -e 's#(no 0083 yet)#(no 0084: every migration through 0083)#' \
    "$K2/replica.sh" > "$S/s06c-kit/replica.sh"
sed -e 's#s06b-local-postgrest-jwt-secret-not-used-anywhere-real-0000#s06c-local-postgrest-jwt-secret-not-used-anywhere-real-0000#' "$K2/pgrst.sh" > "$S/s06c-kit/pgrst.sh"
diff "$K2/replica.sh" "$S/s06c-kit/replica.sh"; diff "$K2/pgrst.sh" "$S/s06c-kit/pgrst.sh"
```

Paste both diffs: only the worktree path, the skip pattern, the post block's file name and its three messages, and the JWT secret differ. `bash "$S/s06c-kit/replica.sh" <pgPort> "$S/s06c-t<N>-impl"` → `post = pre (no 0084: every migration through 0083)`. `bash "$S/s06c-kit/pgrst.sh" <pg> <pr> <gw> "$S/s06c-t<N>-impl"`, then `source "$S/s06c-t<N>-impl/env-run.sh"` before a PostgREST-backed run. Stop your own kit only: `touch "<dir>/stop"`; PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false`; `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`.

**Faithfulness** (once, by Task 3, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest of `post` equals bis-ci's (both have every migration through 0083; part 2's ledger recorded it unchanged by 0083 from part 1's `51|0dd3e2d7e19f3f3649a893cfd9967d94`; read both, do not assume):

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

- `<ROUTE>route.test.ts:8-21`: the hoisted `dbFns` gains `syncWebchatTurns: vi.fn()`, given `{ outcome: "nothing_new" }` in `beforeEach` (what a sync with nothing to copy answers). Every existing case keeps its assertions; `:1132-1139`'s `afterMock` count of 1 still holds (a first turn with no lead schedules no sync). Task 4.
- `…/conv/page.sender-visibility.test.ts:115`: `getContactCalls` becomes `[{ accountId: "acct1", id: "luis" }, { accountId: "acct1", id: "ana" }]`: "ana" is the composer's readiness read of the thread's own contact on the request client (S-06 part 3, spec §6), made AFTER the consent block. Its `@bis/db` factory is NOT edited: the composer's other reads fail soft there (`softSmsGate` answers null through its catch; `emailRecipientState` answers `unknown` through its catch), which is what a failed read answers in production. Task 8.
- `…/conv/email-composer.test.ts`: retired with `email-composer.tsx` (spec G9); its one assertion (the body is a textarea, D-015) is already `message-composer.test.ts:58-64`'s. Task 8.
- `packages/db/src/test/record.test.ts:298`: `TIMELINE_SOURCES` gains `"chats"` LAST. `packages/db/src/test/timeline-merge.test.ts:157-164`: with `messages` erroring, `failed` becomes `["messages", "calls", "chats"]` and the sorted errors `["calls", "chats", "messages"]` (the chats source reads `messages` too). `:147`'s `TIMELINE_SOURCES.length + 5` holds unchanged (the chats source makes one paged read when it finds no chat). Task 7.
- `apps/web/src/lib/labels.ts:46-51`: `MESSAGE_CHANNEL_LABEL` gains `webchat` and becomes per-locale; `messageChannelLabel(channel, locale = "en")` keeps every English answer. Task 3.
- `packages/db/src/messaging.ts:81-82` `MESSAGE_COLS` is **unchanged**; `listMessages` selects its own `THREAD_COLS` (`MESSAGE_COLS` plus the author pair). `inbound-email.test.ts:351-357` (meta read through `listMessages`) still passes. Task 3.
- **Added after the fact (this list missed them; CI found the first):**
  - `packages/db/src/test/messaging-author-shape.test.ts:65` ("with no page, today's read: no author columns…"), **unchanged**. `listContactMessages`' no-page read stopped delegating to `listMessages` and reads MESSAGE_COLS through its own `listMessagesWithoutAuthor`, so the pin holds (Task 3 CI fix, e178d20a).
  - `apps/web/src/lib/messages-readers.test.ts`: `packages/db/src/messaging.ts` pinned at **14** `from("messages")` sites (was 13; the extra one is that no-page reader). Final-review fix round.
  - `…/conv/page.test.ts`, `page.zone.test.ts`, `page.pagination.test.ts`: each `@bis/db` factory gained `getContact: async () => null` and `getVoiceProfile: async () => null`, with the comment naming the real state each stands for (the customer could not be read; no thread there holds a chat). Edited under the orchestrator's constraint-34 ruling in Task 8's fix round (61bc8fcb), which supersedes "their factories are not edited" in the line below.
- **Unchanged, checked (each task that could disturb one runs it):** `packages/db/src/test/provenance-parity.test.ts` (`messageAuthor` untouched); `packages/db/src/test/schema-grants-guard.test.ts` (no schema change); `packages/db/src/test/messaging.test.ts` and `contact-messages.test.ts` (Task 3); `…/acct/in-account-service-reads.test.ts` (no new `serviceDb`/`ledgerDb` site); `lib/i18n/request-locale-callers.test.ts` (no new `requestLocale` call); `…/conv/page.test.ts`, `page.zone.test.ts`, `page.pagination.test.ts`, `page.forwarders.test.ts` (their factories are not edited; Task 8 runs them).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/src/webchat-plan.ts` | bis-comms | pure, import-free (subpath `@bis/db/webchat-plan`): the key, the planner, the matched-existing rule, the per-chat row cap |
| `apps/web/src/lib/concierge/webchat-plan.test.ts` | bis-comms | the planner without a database, through the subpath |
| `packages/db/src/webchat.ts` | bis-comms | the thread resolver, the keys read, `syncWebchatTurns` |
| `packages/db/src/test/webchat.test.ts` | bis-comms | the writer, the resolver, the sync and the risky readers on the replica behind PostgREST |
| `apps/web/src/lib/labels.test.ts` | bis-comms | five channel labels in two languages |
| `…/conv/start-channel.ts` (+ test) | bis-comms | `lastCustomerReply`, `textReadiness`, `emailReadiness`, `startChannel` |
| `…/conv/composer-facts.ts` (+ test) | bis-comms | the inbox composer's facts, decided on the server from injected reads |
| `packages/db/src/test/webchat-rls.test.ts` | bis-crm | a Technician reads a chat's rows only on their own customer (SQL, `withRollback`) |
| `apps/web/src/lib/messages-readers.test.ts` | bis-comms | every file that reads `messages` is listed with what a chat row does to it |
| `…/conv/webchat-meta.ts` (+ test) | bis-frontend | read `meta.webchat`; which row opens each chat |
| `…/conv/page.webchat.test.ts` | bis-frontend | the page: persona read, composer facts, import sites |
| `…/sg/webchat-demo.tsx` (+ test) | bis-frontend | the web chat bubble (both languages) and the chat row |

**Modified:** `packages/db/src/{messaging,record,index}.ts`, `packages/db/package.json`; `<ROUTE>route.ts` + test; `apps/web/src/lib/{messages,labels}.ts`, `messages.test.ts`; `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` + tests; `…/record/{activity-timeline,message-composer}.tsx` + tests; `…/group/group-timeline.tsx` + test; `…/acct/contacts/contact-drawer.tsx`; `…/conv/{message-thread,page}.tsx` + tests; `…/sg/page.tsx`; `packages/db/src/test/{record,timeline-merge}.test.ts`; `apps/web/e2e/concierge.spec.ts`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`. **Removed (`git rm`):** `…/conv/email-composer.tsx`, `…/conv/email-composer.test.ts`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on |
|---|---|---|---|---|
| 0 | Confirm the base; the owner rules on G23-G31 | orchestrator | n/a | — |
| 1 | Every key (**messages.ts, the only writer**) | bis-comms | sonnet | 0 |
| 2 | The planner (pure, subpath) | bis-comms | **opus** (idempotency, order, unread) | 0 |
| 3 | `@bis/db`: the writer, the resolver, the sync; the channel; the thread's author pair; the labels; the delivery guard | bis-comms | **opus** (writes, races) | 1, 2 |
| 4 | The turn route: the visitor's arrival time; the sync in `after()` | bis-comms | **opus** (the turn route) | 3 |
| 5 | The start channel and the inbox composer's facts (pure, server) | bis-comms | sonnet | 0 |
| 6 | `MessageComposer`'s `modes` and `initialMode` | bis-comms | sonnet | 1 |
| 7 | The record: the `chats` source, the chat row, "Last talked" | bis-crm | **opus** (RLS reads, paging) | 1, 3 |
| 8 | The inbox: the web chat bubble, the unconfirmed line, the composer; the demo | bis-frontend | **opus** (request-client proofs, ledger reads) | 1, 3, 5, 6 |
| 9 | The messages readers guard | bis-comms | sonnet | 3, 7 |
| 10 | Regenerate the i18n baselines | bis-comms | sonnet | 1, 7, 8 |
| 11 | The e2e test | bis-e2e-qa | sonnet | 4, 8, 10 |
| 12 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1-11 |
| 13 | Rollout (orchestrator; LAST) | orchestrator | n/a | 12 |

```
Wave A (three lanes):  T1 (bis-comms)          T2 (bis-comms, 2nd instance)      T5 (bis-comms, 3rd instance)
Wave B (two lanes):    T3 (after T1, T2)                                          T6 (after T1)
Wave C (two lanes):    T4 (after T3)           T7 (bis-crm, after T1, T3)
Wave D (two lanes):    T8 (bis-frontend, after T3, T5, T6)                        T9 (after T3, T7)
Wave E:                T10 (after T7, T8), then T11
Checkpoint:            T12
Rollout:               T13 (orchestrator, LAST)
```

Disjointness: Wave A: T1 `messages.ts`/`messages.test.ts`; T2 `webchat-plan.ts`, its web test, `package.json`; T5 `…/conv/start-channel.ts`, `composer-facts.ts` and their tests. Wave B: T3 `packages/db/src/{webchat,messaging,index}.ts`, `webchat.test.ts`, `labels.ts`, `labels.test.ts`; T6 `message-composer.tsx` + test. Wave C: T4 `<ROUTE>` only; T7 `record.ts`, `index.ts` (after T3's commit), the record kit files. Wave D: T8 `…/conv/` (except `start-channel.ts`, `composer-facts.ts`) and `…/sg/`; T9 one new test file. No two tasks in one wave share a file.

---

## Task 0: Confirm the base; the owner rules on G23-G31 (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -4` shows this plan's commit, then `9e24720d Spec: the owner's rulings on web chat in the inbox…`, `4ad19824 Spec: web chat in the inbox…`, `d6be0a06 … (#266)`. `git fetch origin && git log --oneline origin/main -1`: if `main` moved past `d6be0a06`, read what moved it; if it touched any file in "File Structure", merge `origin/main` ONCE here (never rebase) before any lane starts.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0083_inbound_never_log.sql`.
  - `grep -n 'channel: "email" | "form" | "voice" | "sms";' packages/db/src/messaging.ts` → `20:`; `grep -n 'const MESSAGE_COLS' packages/db/src/messaging.ts` → `81:`.
  - `grep -n '.eq("direction", "outbound")' packages/db/src/messaging.ts | head -1` → `245:` (G29).
  - `grep -n 'const startedAt = Date.now();' "apps/web/src/app/api/concierge/[publicId]/turn/route.ts"` → `155:`; `grep -n '{ role: "visitor", text, at: now },' "apps/web/src/app/api/concierge/[publicId]/turn/route.ts"` → `654:` (G4).
  - `grep -n 'export const TIMELINE_SOURCES' packages/db/src/record.ts` → `266:`.
  - `grep -n 'expect(getContactCalls).toEqual' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.sender-visibility.test.ts"` → `115:`.
  - `grep -n '^} as const;' apps/web/src/lib/messages.ts` → `4809:`; `wc -l < apps/web/src/lib/messages.test.ts` → `707`.
  - `ls "<KIT2>/replica.sh" "<KIT2>/pgrst.sh" "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl/postgrest.exe"` → all three exist.
- [ ] **Step 3.** Put G23-G31 to the owner as tiles (memory "Choice tiles"), recommended = the proposal. Record each ruling in the ledger and, if any CHANGES, amend this plan's affected task before it starts (G23/G24/G25 change Task 1's keys and Task 7; G26 Task 8; G27/G28 Tasks 2-3; G29 Task 3; G31 Tasks 6, 8). Confirm the record kit's owner for Task 7 (Ownership).

---

## Task 1: Every key (bis-comms; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 2, 5.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (the channel block at `:1474-1477`; the rest before `} as const;` at `:4809`)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` at the end; `readFileSync`, `join` and `m` are already imported)

**Interfaces**
- Produces: the keys below. Later tasks use exactly these names. Nine NEW English keys with their `.es` twins, plus four `.es` twins for existing English keys (G8): 22 new lines.

- [ ] **Step 1: Write the failing test** at the end of `messages.test.ts`:

```ts
describe("S-06 part 3: web chat in the inbox and the record, English and Spanish (plan Task 1)", () => {
  const WANT: Record<string, string> = {
    // G8: the four existing channel words gain Spanish; their English is unchanged.
    "conversations.channel.form": "Form submission",
    "conversations.channel.form.es": "Formulario",
    "conversations.channel.email": "Email",
    "conversations.channel.email.es": "Correo",
    "conversations.channel.voice": "Call",
    "conversations.channel.voice.es": "Llamada",
    "conversations.channel.sms": "Text",
    "conversations.channel.sms.es": "Texto",
    "conversations.channel.webchat": "Web chat",
    "conversations.channel.webchat.es": "Chat web",
    "conversations.compose.via": "Reply by",
    "conversations.compose.via.es": "Responder por",
    "conversations.webchat.unconfirmed": "Matched by the phone or email they typed; not confirmed.",
    "conversations.webchat.unconfirmed.es": "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado.",
    // G23: the chat row's verb and its count, the kit's grammar ("Customer chatted with Sofía … · 12 messages").
    "timeline.webchat": "chatted with {name} on your website",
    "timeline.webchat.es": "conversó con {name} en su sitio web",
    "timeline.webchatCount": "{count} messages",
    "timeline.webchatCount.es": "{count} mensajes",
    "timeline.webchatCountOne": "1 message",
    "timeline.webchatCountOne.es": "1 mensaje",
    // G24, G25.
    "timeline.what.chats": "website chats",
    "timeline.what.chats.es": "chats del sitio web",
    "timeline.openChat": "Open chat",
    "timeline.openChat.es": "Ver chat",
    "record.facts.channel.chat": "website chat",
    "record.facts.channel.chat.es": "chat del sitio web",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("is 13 English keys, each with its .es twin on the very next line (mutation: append conversations.channel.email.es at the end of the file → FAILS)", () => {
    const en = Object.keys(WANT).filter((x) => !x.endsWith(".es"));
    expect(en).toHaveLength(13);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of en) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'escribiste' in unconfirmed.es → FAILS; drop {count} from webchatCount.es → FAILS)", () => {
    const TU = /\b(escribiste|tu|tus|tienes|puedes|abre|responde|confirmaste)\b/i;
    const mm = m as Record<string, string>;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(mm[k]!), k).toBe(false);
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(mm[k]!), k).toEqual(ph(mm[k.slice(0, -3)]!));
    }
  });

  it("no key uses an internal or vendor word (mutation: 'webchat transcript' in timeline.webchat → FAILS)", () => {
    const BANNED = /\b(webchat|concierge|transcript|provider|index|openai|telnyx|resend)\b/i;
    for (const [k, v] of Object.entries(WANT)) expect(BANNED.test(v), k).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys missing). Paste the first failing assertion line.
- [ ] **Step 3: Add the keys.** Replace the four lines at `:1474-1477` with:

```ts
  "conversations.channel.form": "Form submission",
  "conversations.channel.form.es": "Formulario",
  "conversations.channel.email": "Email",
  "conversations.channel.email.es": "Correo",
  "conversations.channel.voice": "Call",
  "conversations.channel.voice.es": "Llamada",
  "conversations.channel.sms": "Text",
  "conversations.channel.sms.es": "Texto",
  "conversations.channel.webchat": "Web chat",
  "conversations.channel.webchat.es": "Chat web",
```

and insert before `} as const;` (under a one-line comment `// S-06 part 3: web chat in the inbox and on the record (plan Task 1).`) the other eight English keys of `WANT`, each followed directly by its `.es` line, copying every string from `WANT` byte for byte.
- [ ] **Step 4: Run to pass**, plus `src/lib/i18n/ratchet.test.ts` and `src/lib/i18n/accents-guard.test.ts` → PASS. `pnpm --filter web typecheck` → 0. Paste the summary lines.
- [ ] **Step 5: Probes.** Change `"conversations.webchat.unconfirmed.es"` to `"Lo relacionamos por el teléfono o el correo que escribiste; no está confirmado."` → cases 1 and 3 FAIL by name; edit back. Delete `{count}` from `"timeline.webchatCount.es"` → cases 1 and 3 FAIL; edit back. Move the `"conversations.channel.email.es"` line to just before `} as const;` → case 2 FAILS naming `conversations.channel.email`; edit back. Paste the three failing lines.
- [ ] **Step 6: Commit** `-- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`, message "copy: web chat in the inbox and on the record, and Spanish channel words (S-06 part 3)".

---

## Task 2: The planner (bis-comms; pure, subpath `@bis/db/webchat-plan`)

**Review:** opus (the idempotency key, the order and the unread flag are decided here). **Runs beside:** Tasks 1, 5.

**Files**
- Create: `packages/db/src/webchat-plan.ts`
- Create: `apps/web/src/lib/concierge/webchat-plan.test.ts`
- Modify: `packages/db/package.json` (`exports` gains `"./webchat-plan": "./src/webchat-plan.ts"` after `"./never-log-rules"`)

**Interfaces**
- Produces (pure; its one import, `./timeline-cursor`, is itself import-free): `WEBCHAT_ACTOR_ID = "concierge"`; `WEBCHAT_KEY_PREFIX = "webchat:"`; `webchatKey(chatId, index): string`; `parseWebchatKey(chatId, key): number | null`; `WEBCHAT_MAX_ROWS_PER_CHAT = 48`; `type WebchatTurn`, `type WebchatKey = { index: number; createdAt: string }`, `type WebchatRowMeta`, `type PlannedWebchatRow`; `planWebchatRows(input): PlannedWebchatRow[]`; `matchedExistingCustomer(contactCreatedAt, submissionCreatedAt): boolean`. Consumed by Task 3 (`messaging.ts`, `webchat.ts`) and Task 7 (`WEBCHAT_MAX_ROWS_PER_CHAT`).

- [ ] **Step 1: Read before writing.** `sed -n 1,20p packages/db/src/concierge.ts` (`ConciergeTurn`), `sed -n 30,52p packages/db/src/timeline-cursor.ts` (`instantKey`), `sed -n 1,16p packages/db/package.json`, `sed -n 10,20p apps/web/src/lib/concierge/guards.ts`, `sed -n 640,661p "apps/web/src/app/api/concierge/[publicId]/turn/route.ts"` (the `at` the route writes).

- [ ] **Step 2: Write the failing test** `apps/web/src/lib/concierge/webchat-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  planWebchatRows, matchedExistingCustomer, parseWebchatKey, webchatKey, WEBCHAT_MAX_ROWS_PER_CHAT, type WebchatTurn,
} from "@bis/db/webchat-plan";
import { CONCIERGE_MAX_TURNS } from "./guards";

/** S-06 part 3 (spec §2, §3 step 4, G1, G2, G5; plan G27). The REAL planner, through the subpath, never a mock. */
const CHAT = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const T = (ms: number) => new Date(Date.parse("2026-10-17T15:00:00.000Z") + ms).toISOString();
const turn = (role: WebchatTurn["role"], text: string, at: string): WebchatTurn => ({ role, text, at });
const plan = (transcript: WebchatTurn[], over: Partial<Parameters<typeof planWebchatRows>[0]> = {}) =>
  planWebchatRows({ chatId: CHAT, transcript, existing: [], locale: "es", submissionId: SUB, matchedExisting: false,
    leadAt: "2026-10-17T16:00:00+00:00", now: T(999_999), ...over });

describe("planWebchatRows: what a sync still has to write", () => {
  it("only the indices the thread does not hold, in index order, each keyed webchat:<chat>:<index> (mutation: plan every index → FAILS; key by text → FAILS)", () => {
    const tr = [turn("visitor", "hola", T(0)), turn("assistant", "¿En qué le ayudo?", T(0)), turn("visitor", "una mesa", T(9_000)), turn("assistant", "Claro", T(9_000))];
    const rows = plan(tr, { existing: [{ index: 1, createdAt: T(1) }, { index: 2, createdAt: T(9_000) }] });
    expect(rows.map((r) => [r.index, r.providerMessageId, r.body])).toEqual([
      [0, `webchat:${CHAT}:0`, "hola"], [3, `webchat:${CHAT}:3`, "Claro"],
    ]);
  });

  it("a retried POST's duplicated pair is two more indices, planned like any other (G2; mutation: skip a turn whose text equals an earlier one → FAILS)", () => {
    const tr = [turn("visitor", "hi", T(0)), turn("assistant", "Hello", T(0)), turn("visitor", "hi", T(0)), turn("assistant", "Hello", T(0))];
    expect(plan(tr).map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it("times strictly increase in index order: +1 ms on a tie, and never at or before an earlier row already written (G5; mutation: createdAt = at → the tie stays, FAILS; ignore `existing` → row 2 sorts before row 1, FAILS)", () => {
    const tied = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(0))]);
    expect(tied.map((r) => r.createdAt)).toEqual([T(0), T(1)]);
    // Two tabs: index 2's own `at` is EARLIER than the row already written at index 1.
    const healed = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(5)), turn("visitor", "c", T(2)), turn("assistant", "d", T(2))],
      { existing: [{ index: 0, createdAt: T(0) }, { index: 1, createdAt: "2026-10-17T15:00:00.005123+00:00" }] });
    expect(healed.map((r) => [r.index, r.createdAt])).toEqual([[2, T(6)], [3, T(7)]]);
  });

  it("nothing to plan for an empty transcript, or for one the thread already holds in full", () => {
    expect(plan([])).toEqual([]);
    expect(plan([turn("visitor", "a", T(0))], { existing: [{ index: 0, createdAt: T(0) }] })).toEqual([]);
  });

  it("the visitor's turn is inbound, Sofía's outbound; every row's meta names the chat, its index, the chat's own language, the lead and the match (spec §2, §5a; mutation: swap the directions → FAILS; drop matched_existing → FAILS)", () => {
    const rows = plan([turn("visitor", "a", T(0)), turn("assistant", "b", T(10))], { matchedExisting: true });
    expect(rows.map((r) => r.direction)).toEqual(["inbound", "outbound"]);
    expect(rows[1]!.meta).toEqual({ webchat: { chat_id: CHAT, index: 1, locale: "es", submission_id: SUB, matched_existing: true } });
    expect(plan([turn("visitor", "a", T(0))], { locale: "fr" })[0]!.meta.webchat.locale).toBe("en");
  });

  it("a visitor turn raises unread only when it arrived after the lead was on file; Sofía's never (G27; mutation: countsUnread = visitor → the pre-lead turn counts, FAILS; count Sofía → FAILS)", () => {
    const rows = plan([
      turn("visitor", "before the lead", "2026-10-17T15:59:59.000Z"), turn("assistant", "after", "2026-10-17T16:00:05.000Z"),
      turn("visitor", "after the lead", "2026-10-17T16:00:30.000Z"), turn("assistant", "after", "2026-10-17T16:00:31.000Z"),
    ]);
    expect(rows.map((r) => r.countsUnread)).toEqual([false, false, true, false]);
  });

  it("an `at` that does not parse takes the previous row's time + 1 ms, or `now` when it is the first (mutation: new Date(NaN).toISOString() → throws, FAILS)", () => {
    expect(plan([turn("visitor", "a", T(0)), turn("assistant", "b", "garbage")]).map((r) => r.createdAt)).toEqual([T(0), T(1)]);
    expect(plan([turn("visitor", "a", "garbage")])[0]!.createdAt).toBe(T(999_999));
    expect(plan([turn("visitor", "a", "garbage")])[0]!.countsUnread).toBe(false);
  });
});

describe("matchedExistingCustomer (spec §5a, G19)", () => {
  it("a customer older than the lead's submission is a match; one created by it is not; equal reads as new; to the microsecond (mutation: `<=` → equal reads matched, FAILS; compare Date.parse → the 1 µs pair ties, FAILS)", () => {
    expect(matchedExistingCustomer("2026-09-01T10:00:00+00:00", "2026-10-17T16:00:00+00:00")).toBe(true);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.250+00:00", "2026-10-17T16:00:00.100+00:00")).toBe(false);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.100+00:00", "2026-10-17T16:00:00.100+00:00")).toBe(false);
    expect(matchedExistingCustomer("2026-10-17T16:00:00.100001+00:00", "2026-10-17T16:00:00.100002+00:00")).toBe(true);
    expect(matchedExistingCustomer("not a time", "2026-10-17T16:00:00+00:00")).toBe(false);
  });
});

describe("the key", () => {
  it("parses this chat's own key back to its index and refuses anything else (mutation: accept any prefix → another chat's key parses, FAILS)", () => {
    expect(parseWebchatKey(CHAT, webchatKey(CHAT, 7))).toBe(7);
    expect(parseWebchatKey(CHAT, `webchat:${SUB}:7`)).toBeNull();
    expect(parseWebchatKey(CHAT, `webchat:${CHAT}:07`)).toBeNull();
    expect(parseWebchatKey(CHAT, `webchat:${CHAT}:x`)).toBeNull();
    expect(parseWebchatKey(CHAT, null)).toBeNull();
  });

  it("a chat holds at most 48 rows: 24 claimed turns, one pair each (mutation: 40 → FAILS)", () => {
    expect(WEBCHAT_MAX_ROWS_PER_CHAT).toBe(CONCIERGE_MAX_TURNS * 2);
  });
});
```

- [ ] **Step 3: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/concierge/webchat-plan.test.ts` → FAILS (no module `@bis/db/webchat-plan`). Paste the line.

- [ ] **Step 4: Write `packages/db/src/webchat-plan.ts`:**

```ts
import { instantKey } from "./timeline-cursor";

/**
 * S-06 part 3 (spec §2, §3 step 4; G1, G2, G5, G19; plan G27): which turns of a lead's website chat a
 * sync still has to write to the customer's thread, and what each row looks like. PURE: the web
 * reaches it through the SUBPATH `@bis/db/webchat-plan`, so a test that mocks `@bis/db` still runs the
 * real planner. The writer is messaging.ts's fileWebchatTurns; the sync is webchat.ts.
 */
export type WebchatTurn = { role: "visitor" | "assistant"; text: string; at: string };
export type WebchatKey = { index: number; createdAt: string };
export type WebchatRowMeta = {
  chat_id: string; index: number; locale: "en" | "es"; submission_id: string; matched_existing: boolean;
};
export type PlannedWebchatRow = {
  index: number;
  direction: "inbound" | "outbound";
  body: string;
  createdAt: string;
  providerMessageId: string;
  meta: { webchat: WebchatRowMeta };
  /** Plan G27: a VISITOR turn that arrived after the lead was on file (its `at` is later than the
   *  submission's created_at). The writer raises unread for it only when the route also says the lead
   *  was on file when the turn started (spec §4, G7). Sofía's turns never count. */
  countsUnread: boolean;
};

/** The actor id on every chat row's author mapping and on its one event (spec §2). */
export const WEBCHAT_ACTOR_ID = "concierge";
export const WEBCHAT_KEY_PREFIX = "webchat:";
/** G1: the idempotency key, on 0005's project-wide partial unique index. A chat id is a uuid. */
export const webchatKey = (chatId: string, index: number): string => `${WEBCHAT_KEY_PREFIX}${chatId}:${index}`;

/** The index in this chat's own key; null for any other key (another chat's, a provider's, a malformed one). */
export function parseWebchatKey(chatId: string, key: string | null | undefined): number | null {
  const prefix = `${WEBCHAT_KEY_PREFIX}${chatId}:`;
  if (!key || !key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return /^(0|[1-9][0-9]{0,3})$/.test(rest) ? Number(rest) : null;
}

/** 24 claimed turns at most (CONCIERGE_MAX_TURNS, apps/web lib/concierge/guards.ts:14), each appending
 *  at most one pair (route.ts:653-656). Pinned against the web constant by webchat-plan.test.ts. */
export const WEBCHAT_MAX_ROWS_PER_CHAT = 48;

/**
 * Every transcript index the thread does not hold yet (G2: the array position), in index order, with
 * a created_at that strictly increases in index order (G5: +1 ms on a tie, and never at or before the
 * nearest earlier row, written or planned). An `at` that does not parse takes the previous time + 1 ms,
 * or `now` for the first row.
 */
export function planWebchatRows(input: {
  chatId: string; transcript: readonly WebchatTurn[]; existing: readonly WebchatKey[];
  locale: string; submissionId: string; matchedExisting: boolean; leadAt: string; now: string;
}): PlannedWebchatRow[] {
  const locale: "en" | "es" = input.locale === "es" ? "es" : "en";
  const written = new Map(input.existing.map((k) => [k.index, Date.parse(k.createdAt)]));
  const leadAt = Date.parse(input.leadAt);
  let prev = Number.NEGATIVE_INFINITY;
  const out: PlannedWebchatRow[] = [];
  input.transcript.forEach((turn, index) => {
    const have = written.get(index);
    if (have !== undefined) {
      if (Number.isFinite(have)) prev = Math.max(prev, have);
      return;
    }
    const at = Date.parse(turn.at);
    const base = Number.isFinite(at) ? at : Number.isFinite(prev) ? prev + 1 : Date.parse(input.now);
    const t = Number.isFinite(prev) && base <= prev ? prev + 1 : base;
    prev = t;
    const visitor = turn.role === "visitor";
    out.push({
      index,
      direction: visitor ? "inbound" : "outbound",
      body: turn.text,
      createdAt: new Date(t).toISOString(),
      providerMessageId: webchatKey(input.chatId, index),
      meta: { webchat: { chat_id: input.chatId, index, locale, submission_id: input.submissionId, matched_existing: input.matchedExisting } },
      countsUnread: visitor && Number.isFinite(at) && Number.isFinite(leadAt) && at > leadAt,
    });
  });
  return out;
}

/** Spec §5a (G19): the customer existed before this chat's lead when their row is OLDER than the lead's
 *  submission (written before enrich looks for a contact, lib/concierge/lead.ts:151 then :170). Equal
 *  reads as new. To the microsecond (instantKey); a time that does not parse is not a match. */
export function matchedExistingCustomer(contactCreatedAt: string, submissionCreatedAt: string): boolean {
  try {
    return instantKey(contactCreatedAt) < instantKey(submissionCreatedAt);
  } catch {
    return false;
  }
}
```

Add `"./webchat-plan": "./src/webchat-plan.ts"` to `packages/db/package.json`'s `exports`, after `"./never-log-rules"` (a comma on the line before).

(Why `existing` times are read with `Date.parse`: the healed case's `.005123` parses to `.005`, and `+1` makes `.006`, still after `.005123`, because a millisecond is wider than any microsecond remainder.)

- [ ] **Step 5: Run to pass.** The web test → PASS (paste the summary; 10 tests). `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` → 0.
- [ ] **Step 6: Probes, each by name, edited back:** (a) the `if (have !== undefined)` block removed → case 1 FAILS; (b) `const t = base;` → case 3 FAILS on the tie; (c) `countsUnread: visitor` → case 6 FAILS; (d) `<` → `<=` in `matchedExistingCustomer` → the equal case FAILS; (e) `parseWebchatKey` returning `Number(key.split(":").pop())` → the other-chat case FAILS; (f) `WEBCHAT_MAX_ROWS_PER_CHAT = 40` → FAILS. Paste each failing assertion line.
- [ ] **Step 7: Commit** `-- packages/db/src/webchat-plan.ts packages/db/package.json apps/web/src/lib/concierge/webchat-plan.test.ts`, message "db: the web chat planner: missing turns, their keys, strictly increasing times, the unread flag (S-06 part 3)".

---

## Task 3: `@bis/db`: the writer, the resolver, the sync; the channel; the thread's author pair; the labels; the delivery guard (bis-comms)

**Review:** opus. **After:** Tasks 1, 2. **Scratch:** `<SCRATCH>/s06c-t3-impl/`, ports `55660`/`55661`/`55662` (reviewer `s06c-t3-review/`, `55663`/`55664`/`55665`).

**Files**
- Create: `packages/db/src/webchat.ts`, `packages/db/src/test/webchat.test.ts`, `apps/web/src/lib/labels.test.ts`; the kit `<SCRATCH>/s06c-kit/{replica,pgrst}.sh` (outside the repo)
- Modify: `packages/db/src/messaging.ts` (`:20` the union; after `:81-82` a `THREAD_COLS`; `:242-246` G29; `:833-842` `listMessages`; append `fileWebchatTurns`)
- Modify: `packages/db/src/index.ts` (the messaging export at `:48-55`; two new lines after `:170`)
- Modify: `apps/web/src/lib/labels.ts` (`:1-2`, `:46-64`)

**Interfaces**
- Consumes: Task 2's planner; `getConciergeConversation` (`concierge.ts:238`), `ensureConversation` (`messaging.ts:100`), `incrementUnreadCount` (`:581`), `emit` (`events.ts:16`), `messageAuthor` (`provenance.ts:19`); Task 1's `conversations.channel.*` keys.
- Produces (`@bis/db`): `NewMessage["channel"]` gains `"webchat"`; `listMessages` rows carry `author_kind`, `author_id`; `type WebchatFileResult = { inserted: number; visitorInserted: number; unreadRaised: number; stoppedAt: number | null; failedSteps: ("touch" | "event" | "unread")[] }`; `fileWebchatTurns(db, accountId, conversationId, rows, { raiseUnread }): Promise<WebchatFileResult>`; `type WebchatThread = { conversationId: string; matchedExisting: boolean; leadAt: string }`; `resolveWebchatThread(db, accountId, submissionId): Promise<WebchatThread | null>`; `listWebchatKeys(db, accountId, conversationId, chatId): Promise<WebchatKey[]>`; `type WebchatSyncResult = { outcome: "filed"; result: WebchatFileResult } | { outcome: "no_lead" } | { outcome: "no_customer" } | { outcome: "nothing_new" } | { outcome: "failed"; stage: "chat" | "thread" | "keys" | "write" }`; `syncWebchatTurns(db, accountId, chatId, { raiseUnread, now? }): Promise<WebchatSyncResult>` (never throws on a failed read or write: it answers `failed` with its stage). Web: `messageChannelLabel(channel, locale = "en")`.

- [ ] **Step 1: Build the kit** exactly as "The replica kit" says (paste both diffs), `bash "$S/s06c-kit/replica.sh" 55660 "$S/s06c-t3-impl"`, the faithfulness digest on `post` and on bis-ci (paste both; stop if they differ), then `bash "$S/s06c-kit/pgrst.sh" 55660 55661 55662 "$S/s06c-t3-impl"`.

- [ ] **Step 2: Read before writing.** `sed -n 1,60p packages/db/src/messaging.ts`, `sed -n 95,190p packages/db/src/messaging.ts`, `sed -n 214,280p packages/db/src/messaging.ts`, `sed -n 575,590p packages/db/src/messaging.ts`, `sed -n 820,845p packages/db/src/messaging.ts`, `sed -n 205,250p packages/db/src/concierge.ts`, `sed -n 286,335p packages/db/src/concierge.ts`, `sed -n 1,40p packages/db/src/events.ts`, `sed -n 40,60p packages/db/src/index.ts`, `sed -n 160,175p packages/db/src/index.ts`, `cat apps/web/src/lib/labels.ts`, `sed -n 1,35p packages/db/src/test/messaging.test.ts` (the provider-id rule), `sed -n 120,150p packages/db/src/test/fixtures.ts`, `sed -n 1015,1036p packages/db/src/voice.ts`, `sed -n 1939,1973p packages/db/src/automations.ts`, and the signatures of `createForm`, `createSubmission`, `linkSubmissionContact` (`forms.ts:68`, `:247`, `:370`) and `createContact` (`contacts.ts:414`).

- [ ] **Step 3: Write the failing labels test** `apps/web/src/lib/labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { messageChannelLabel, MESSAGE_CHANNEL_LABEL } from "./labels";

describe("messageChannelLabel (spec G8; S-06 part 3)", () => {
  it("names all five channels in English, the default, exactly as before plus Web chat (mutation: drop webchat from the map → the raw 'webchat' prints, FAILS)", () => {
    expect(["email", "sms", "form", "voice", "webchat"].map((c) => messageChannelLabel(c))).toEqual(["Email", "Text", "Form submission", "Call", "Web chat"]);
    expect(MESSAGE_CHANNEL_LABEL.webchat).toBe("Web chat");
  });
  it("and in Spanish (mutation: ignore the locale → English, FAILS)", () => {
    expect(["email", "sms", "form", "voice", "webchat"].map((c) => messageChannelLabel(c, "es"))).toEqual(["Correo", "Texto", "Formulario", "Llamada", "Chat web"]);
  });
  it("a value outside the union prints as itself, never blank (mutation: return '' → FAILS)", () => {
    expect(messageChannelLabel("note", "es")).toBe("note");
  });
});
```

- [ ] **Step 4: Write the failing db test** `packages/db/src/test/webchat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createForm, createSubmission, linkSubmissionContact } from "../forms";
import {
  createConciergeConversation, appendConciergeTurns, setConciergeSubmission, getConciergeConversation, type ConciergeTurn,
} from "../concierge";
import { ensureConversation, listMessages, fileWebchatTurns, hasRecentOutboundSms, updateMessageStatusByProviderId } from "../messaging";
import { callerInTouchSince } from "../voice";
import { latestInboundByContact } from "../automations";
import { resolveWebchatThread, listWebchatKeys, syncWebchatTurns } from "../webchat";
import { planWebchatRows, webchatKey } from "../webchat-plan";

/**
 * S-06 part 3 (spec §1-§4, "Every reader of messages", "Failure behaviour"; plan G27-G29), on the
 * replica behind PostgREST. Chat ids are real uuids from concierge_conversations, so every
 * `webchat:<chat>:<i>` key is unique project-wide (0005's index is not account-scoped).
 */
const ACTOR = "user_test";
const PAST = (s: number) => new Date(Date.parse("2026-10-01T15:00:00Z") + s * 1000).toISOString();
const SOON = (s: number) => new Date(Date.now() + 3_600_000 + s * 1000).toISOString();
const turns = (n: number, at: (i: number) => string): ConciergeTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "visitor" : "assistant", text: `turn ${i}`, at: at(i) }));
const ms = (iso: string) => Date.parse(iso);
type ChatMeta = { webchat: { index: number; matched_existing: boolean } };

/** A lead chat as fileLead and enrich leave it: the submission linked to the customer, the chat's one
 *  slot claimed, the customer's thread open. `existing`: the customer was on file BEFORE the lead. */
async function seedLead(db: SupabaseClient, accountId: string, opts: { existing: boolean; turns: ConciergeTurn[] }) {
  const form = await createForm(db, accountId, { name: "Website chat" }, ACTOR);
  const earlier = opts.existing ? (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id : null;
  const chat = await createConciergeConversation(db, { accountId, formId: form.id, ipHash: "h", locale: "es", attribution: {}, origin: null });
  if (opts.turns.length > 0) await appendConciergeTurns(db, chat.id, opts.turns);
  const sub = await createSubmission(db, accountId, form.id, { answers: [], authorKind: "ai" });
  const contactId = earlier ?? (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
  await linkSubmissionContact(db, accountId, sub.id, contactId);
  expect(await setConciergeSubmission(db, chat.id, sub.id)).toBe(true);
  const { id: conversationId } = await ensureConversation(db, accountId, contactId, ACTOR, "system");
  return { chatId: chat.id, formId: form.id, submissionId: sub.id, contactId, conversationId };
}
const chatRows = async (db: SupabaseClient, accountId: string, conversationId: string) =>
  (await listMessages(db, accountId, conversationId)).filter((x) => x.channel === "webchat");
const convo = async (db: SupabaseClient, id: string) => {
  const { data, error } = await db.from("conversations").select("unread_count, last_message_at").eq("id", id).single();
  expect(error).toBeNull();
  return data as { unread_count: number; last_message_at: string | null };
};
const filedEvents = async (db: SupabaseClient, accountId: string) => {
  const { data, error } = await db.from("events").select("payload, actor_type, actor_id").eq("account_id", accountId).eq("type", "webchat.filed");
  expect(error).toBeNull();
  return data ?? [];
};
const parkThread = async (db: SupabaseClient, id: string) => {
  const { error } = await db.from("conversations").update({ last_message_at: PAST(0), unread_count: 0 }).eq("id", id);
  expect(error).toBeNull();
};
const planFor = async (db: SupabaseClient, accountId: string, s: { chatId: string; conversationId: string; submissionId: string }) => {
  const chat = await getConciergeConversation(db, s.chatId);
  return planWebchatRows({ chatId: s.chatId, transcript: chat!.transcript, existing: await listWebchatKeys(db, accountId, s.conversationId, s.chatId),
    locale: "es", submissionId: s.submissionId, matchedExisting: false, leadAt: PAST(0), now: PAST(0) });
};

describe("syncWebchatTurns: the lead's chat, once (spec §2, §3)", () => {
  it("files every turn as web chat: the visitor's inbound with the customer mark, Sofía's outbound with the AI mark, delivered, keyed, in the chat's language, times kept and strictly increasing; one event; a second sync writes nothing (mutations: Sofía's actor 'system' → author 'automation', FAILS; drop the 23505 skip → the direct re-file stops at 0, FAILS; emit per row → 4 events, FAILS; emit with nothing new → 2 events, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(4, (i) => PAST(i < 2 ? 0 : 10)) });
      const r = await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: false });
      expect(r).toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 0, stoppedAt: null, failedSteps: [] } });
      const rows = await chatRows(db, accountId, s.conversationId);
      expect(rows.map((x) => [x.direction, x.author_kind, x.author_id, x.status, x.provider_message_id, x.body, x.subject])).toEqual([
        ["inbound", "customer", null, "delivered", webchatKey(s.chatId, 0), "turn 0", null],
        ["outbound", "ai", null, "delivered", webchatKey(s.chatId, 1), "turn 1", null],
        ["inbound", "customer", null, "delivered", webchatKey(s.chatId, 2), "turn 2", null],
        ["outbound", "ai", null, "delivered", webchatKey(s.chatId, 3), "turn 3", null],
      ]);
      expect(rows.map((x) => (x.meta as { webchat: unknown }).webchat)).toEqual([0, 1, 2, 3].map((index) => ({
        chat_id: s.chatId, index, locale: "es", submission_id: s.submissionId, matched_existing: false })));
      expect(rows.map((x) => ms(x.created_at))).toEqual([ms(PAST(0)), ms(PAST(0)) + 1, ms(PAST(10)), ms(PAST(10)) + 1]);
      expect((await listWebchatKeys(db, accountId, s.conversationId, s.chatId)).map((k) => k.index).sort()).toEqual([0, 1, 2, 3]);
      expect(await filedEvents(db, accountId)).toEqual([
        { payload: { conversationId: s.conversationId, chatId: s.chatId, count: 4 }, actor_type: "system", actor_id: "concierge" },
      ]);
      expect(await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: true })).toEqual({ outcome: "nothing_new" });
      // The race a second tab's sync loses: the same rows go straight to the writer again.
      const again = planWebchatRows({ chatId: s.chatId, transcript: turns(4, (i) => PAST(i < 2 ? 0 : 10)), existing: [], locale: "es",
        submissionId: s.submissionId, matchedExisting: false, leadAt: PAST(0), now: PAST(0) });
      expect(await fileWebchatTurns(db, accountId, s.conversationId, again, { raiseUnread: true }))
        .toEqual({ inserted: 0, visitorInserted: 0, unreadRaised: 0, stoppedAt: null, failedSteps: [] });
      expect(await chatRows(db, accountId, s.conversationId)).toHaveLength(4);
      expect(await filedEvents(db, accountId)).toHaveLength(1);
    });
  });

  it("a later turn copies only its pair: the visitor's row raises unread by one and moves the thread up; a batch holding only Sofía's row does neither (spec §4; mutations: raise unread without raiseUnread → FAILS; touch for any row → last_message_at moves, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      expect((await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: false })).outcome).toBe("filed");
      expect((await convo(db, s.conversationId)).unread_count).toBe(0);
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "¿Y los sábados?", at: SOON(0) }, { role: "assistant", text: "Sí", at: SOON(0) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: true }))
        .toEqual({ outcome: "filed", result: { inserted: 2, visitorInserted: 1, unreadRaised: 1, stoppedAt: null, failedSteps: [] } });
      const moved = await convo(db, s.conversationId);
      expect(moved.unread_count).toBe(1);
      expect(ms(moved.last_message_at!)).toBeGreaterThan(ms(PAST(0)));
      // The healing batch after one that stopped between the visitor's row and Sofía's: Sofía's row alone.
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "x", at: SOON(5) }, { role: "assistant", text: "y", at: SOON(5) }]);
      const sofiaOnly = (await planFor(db, accountId, s)).filter((x) => x.direction === "outbound");
      expect(sofiaOnly.map((x) => x.index)).toEqual([5]);
      expect((await fileWebchatTurns(db, accountId, s.conversationId, sofiaOnly, { raiseUnread: true })).inserted).toBe(1);
      const still = await convo(db, s.conversationId);
      expect(still.unread_count).toBe(0);
      expect(ms(still.last_message_at!)).toBe(ms(PAST(0)));
    });
  });

  it("a later turn that heals a failed filing-turn copy raises unread only for the turns after the lead (plan G27; mutation: countsUnread = visitor → unread 2, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "later", at: SOON(0) }, { role: "assistant", text: "ok", at: SOON(0) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: true }))
        .toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 1, stoppedAt: null, failedSteps: [] } });
      expect((await convo(db, s.conversationId)).unread_count).toBe(1);
    });
  });

  it("an insert error other than 'already there' stops the batch at that row; order is kept and the next sync files the rest (spec failure table; mutation: continue past the error → row 2 lands before row 1, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(3, (i) => PAST(i)) });
      const broken = (await planFor(db, accountId, s)).map((x) => (x.index === 1 ? { ...x, createdAt: "not a time" } : x));
      const r = await fileWebchatTurns(db, accountId, s.conversationId, broken, { raiseUnread: false });
      expect([r.inserted, r.stoppedAt]).toEqual([1, 1]);
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.provider_message_id)).toEqual([webchatKey(s.chatId, 0)]);
      expect((await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: false })).outcome).toBe("filed");
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => (x.meta as ChatMeta).webchat.index)).toEqual([0, 1, 2]);
    });
  });
});

describe("which thread, through the lead only (spec §1, §5a)", () => {
  it("a customer on file before the lead is marked matched; one the lead created is not (G19; mutation: matched_existing always false → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const old = await seedLead(db, accountId, { existing: true, turns: turns(2, () => PAST(0)) });
      const fresh = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      expect((await resolveWebchatThread(db, accountId, old.submissionId))?.matchedExisting).toBe(true);
      expect((await resolveWebchatThread(db, accountId, fresh.submissionId))?.matchedExisting).toBe(false);
      await syncWebchatTurns(db, accountId, old.chatId, { raiseUnread: false });
      await syncWebchatTurns(db, accountId, fresh.chatId, { raiseUnread: false });
      expect((await chatRows(db, accountId, old.conversationId)).map((x) => (x.meta as ChatMeta).webchat.matched_existing)).toEqual([true, true]);
      expect((await chatRows(db, accountId, fresh.conversationId)).map((x) => (x.meta as ChatMeta).webchat.matched_existing)).toEqual([false, false]);
    });
  });

  it("the lead's customer gone, no lead, or another account's chat: nothing is written anywhere and nobody else is looked up (mutations: drop the account check → B's sync files A's chat, FAILS; create a contact when contact_id is null → rows land, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db, other) => {
        const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
        expect(await syncWebchatTurns(db, other, s.chatId, { raiseUnread: false })).toEqual({ outcome: "no_lead" });
        const { error } = await db.from("form_submissions").update({ contact_id: null }).eq("id", s.submissionId);
        expect(error).toBeNull();
        expect(await resolveWebchatThread(db, accountId, s.submissionId)).toBeNull();
        expect(await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: false })).toEqual({ outcome: "no_customer" });
        const bare = await createConciergeConversation(db, { accountId, formId: s.formId, ipHash: "h", locale: "en", attribution: {}, origin: null });
        expect(await syncWebchatTurns(db, accountId, bare.id, { raiseUnread: false })).toEqual({ outcome: "no_lead" });
        const { count, error: cErr } = await db.from("messages").select("id", { count: "exact", head: true })
          .in("account_id", [accountId, other]).eq("channel", "webchat");
        expect(cErr).toBeNull();
        if (count === null) throw new Error("no count returned");
        expect(count).toBe(0);
      });
    });
  });
});

describe("nothing reads a chat row as a text or a send (spec readers table; G17, G29)", () => {
  it("the text-back cooldown and its release ignore chat rows, a delivery event can never relabel one, and a visitor turn is hearing back (mutations: drop .eq('channel','sms') from hasRecentOutboundSms → true, FAILS; from callerInTouchSince's texts read → true, FAILS; drop the G29 guard → updated, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => SOON(0)) });
      await syncWebchatTurns(db, accountId, s.chatId, { raiseUnread: false });
      const since = new Date(Date.now() - 3_600_000);
      expect(await hasRecentOutboundSms(db, accountId, s.conversationId, since)).toBe(false);
      expect(await callerInTouchSince(db, accountId, "+19565550100", s.conversationId, since.toISOString())).toBe(false);
      expect(await updateMessageStatusByProviderId(db, webchatKey(s.chatId, 1), "failed")).toEqual({ updated: false, accountId: null, contactId: null });
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.status)).toEqual(["delivered", "delivered"]);
      expect((await latestInboundByContact(db, [accountId], [s.contactId], since.toISOString())).has(s.contactId)).toBe(true);
    });
  });
});
```

If a fixture's signature differs from what is written here (Step 2's reads), follow the file and say so in the report.

- [ ] **Step 5: Run both to see them fail.** `pnpm --filter web exec vitest run src/lib/labels.test.ts` → FAILS on `webchat` and Spanish. Behind the kit: `source "$S/s06c-t3-impl/env-run.sh" && cd packages/db && node node_modules/vitest/vitest.mjs run src/test/webchat.test.ts > "$S/s06c-t3-impl/red.log" 2>&1; echo $? > "$S/s06c-t3-impl/red.exit"` → FAILS (no module `../webchat`). Paste both summary blocks.

- [ ] **Step 6: Write the code.**

(a) `packages/db/src/messaging.ts`, line 20: `channel: "email" | "form" | "voice" | "sms" | "webchat";`, and add above it: `// "webchat" (S-06 part 3): written ONLY by fileWebchatTurns below; nothing ever sends one.`

(b) After `MESSAGE_COLS` (`:81-82`):

```ts
/** The inbox thread's columns (S-06 part 3, spec §5): MESSAGE_COLS plus who wrote each row (0073), so a
 *  web chat bubble carries its mark and the composer can tell the customer's last reply (spec §6). A
 *  literal, not a template: postgrest-js types a template-built column list as a ParserError. */
const THREAD_COLS =
  "id, conversation_id, channel, direction, status, provider_message_id, subject, body, error, meta, created_at, author_kind, author_id";
```

and in `listMessages` (`:836-837`) `.select(MESSAGE_COLS)` → `.select(THREAD_COLS)`.

(c) G29, in `updateMessageStatusByProviderId` (`:242-246`), after `.eq("direction", "outbound")`: `.neq("channel", "webchat")`, with the comment `// S-06 part 3 (plan G29): a chat row is never a provider's send, so no delivery event may relabel one.`

(d) Import at the top of `messaging.ts`: `import { WEBCHAT_ACTOR_ID, type PlannedWebchatRow } from "./webchat-plan";`. Append:

```ts
/** What one fileWebchatTurns batch did (S-06 part 3, spec §3 step 5; plan G27, G28). Never logged here:
 *  the route logs the account id only (spec decision 5). */
export type WebchatFileResult = {
  inserted: number;
  visitorInserted: number;
  unreadRaised: number;
  /** The index whose insert failed with anything but 23505; the batch stopped there (order is kept). */
  stoppedAt: number | null;
  /** Steps after the inserts that failed; the rows stand (createMessage's touch posture, above). */
  failedSteps: ("touch" | "event" | "unread")[];
};

/**
 * S-06 part 3 (spec §2, §3 step 5; G1, G6, G7; plan G27, G28): writes a lead's website-chat turns to the
 * customer's thread, one row each, IN INDEX ORDER, on the caller's SERVICE client (0053). Not
 * createMessage: that emits one event and one touch per row (G6). Each row's author comes from the one
 * mapping (messageAuthor): the visitor's ("concierge", "system") inbound → customer; Sofía's
 * ("concierge", "ai") → ai. 23505 on the provider id = that row is already there (another tab's sync,
 * a retry): skipped, not counted. Any other error stops the batch. Then ONCE, only if something was
 * inserted: the touch (only for a VISITOR row: Sofía's never move the thread), one `webchat.filed`
 * event, and the unread raise for inserted visitor rows that count (`countsUnread`) when the caller
 * says the lead was on file when the turn started.
 */
export async function fileWebchatTurns(
  db: SupabaseClient, accountId: string, conversationId: string,
  rows: readonly PlannedWebchatRow[], opts: { raiseUnread: boolean },
): Promise<WebchatFileResult> {
  const result: WebchatFileResult = { inserted: 0, visitorInserted: 0, unreadRaised: 0, stoppedAt: null, failedSteps: [] };
  let toRaise = 0;
  for (const row of rows) {
    const author = messageAuthor(row.direction === "inbound" ? "system" : "ai", WEBCHAT_ACTOR_ID, row.direction);
    const { error } = await db.from("messages").insert({
      account_id: accountId, conversation_id: conversationId, channel: "webchat", direction: row.direction,
      status: "delivered", subject: null, body: row.body, provider_message_id: row.providerMessageId,
      author_kind: author.authorKind, author_id: author.authorId, meta: row.meta, created_at: row.createdAt,
    });
    if (error?.code === "23505") continue;
    if (error) {
      result.stoppedAt = row.index;
      break;
    }
    result.inserted += 1;
    if (row.direction === "inbound") {
      result.visitorInserted += 1;
      if (row.countsUnread) toRaise += 1;
    }
  }
  if (result.inserted === 0) return result;
  if (result.visitorInserted > 0) {
    const now = new Date().toISOString();
    const { error } = await db.from("conversations").update({ last_message_at: now, updated_at: now })
      .eq("account_id", accountId).eq("id", conversationId);
    if (error) result.failedSteps.push("touch");
  }
  const chatId = rows[0]?.meta.webchat.chat_id ?? "";
  try {
    await emit(db, accountId, "webchat.filed", WEBCHAT_ACTOR_ID, { conversationId, chatId, count: result.inserted }, "system");
  } catch {
    result.failedSteps.push("event");
  }
  if (opts.raiseUnread) {
    for (let i = 0; i < toRaise; i++) {
      try {
        await incrementUnreadCount(db, accountId, conversationId);
        result.unreadRaised += 1;
      } catch {
        result.failedSteps.push("unread");
        break;
      }
    }
  }
  return result;
}
```

(e) Create `packages/db/src/webchat.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConciergeConversation } from "./concierge";
import { ensureConversation, fileWebchatTurns, type WebchatFileResult } from "./messaging";
import {
  planWebchatRows, parseWebchatKey, matchedExistingCustomer, WEBCHAT_ACTOR_ID, WEBCHAT_KEY_PREFIX, WEBCHAT_MAX_ROWS_PER_CHAT,
  type WebchatKey,
} from "./webchat-plan";

/**
 * S-06 part 3 (spec §1, §3): a lead's website chat on the customer's thread. ONE code path for the
 * pre-lead copy and for every later turn: read the chat as stored, resolve the thread through the lead
 * only, read what IS on the thread, plan what is missing, write it. Called by the turn route in after(),
 * on its service client. Never throws on a failed read or write: it answers an outcome, and the route
 * logs the account id with it (spec decision 5). The next turn's sync heals whatever this one missed.
 */
export type WebchatThread = { conversationId: string; matchedExisting: boolean; leadAt: string };
export type WebchatSyncResult =
  | { outcome: "filed"; result: WebchatFileResult }
  | { outcome: "no_lead" }
  | { outcome: "no_customer" }
  | { outcome: "nothing_new" }
  | { outcome: "failed"; stage: "chat" | "thread" | "keys" | "write" };

/** Spec §1: submission → its contact → that customer's one conversation. null when the submission's
 *  contact is gone (0006:42's `on delete set null`): dropped, never another thread, never a new contact.
 *  The same read answers §5a's match (G19) and the lead's time (plan G27). THROWS on a read error. */
export async function resolveWebchatThread(db: SupabaseClient, accountId: string, submissionId: string): Promise<WebchatThread | null> {
  const { data, error } = await db.from("form_submissions").select("contact_id, created_at, contacts(created_at)")
    .eq("account_id", accountId).eq("id", submissionId).maybeSingle();
  if (error) throw new Error(`resolveWebchatThread failed: ${error.message}`);
  const row = data as { contact_id: string | null; created_at: string;
    contacts: { created_at: string } | { created_at: string }[] | null } | null;
  const contact = Array.isArray(row?.contacts) ? row?.contacts[0] : row?.contacts;
  if (!row || !row.contact_id || !contact) return null;
  const { id } = await ensureConversation(db, accountId, row.contact_id, WEBCHAT_ACTOR_ID, "system");
  return { conversationId: id, matchedExisting: matchedExistingCustomer(contact.created_at, row.created_at), leadAt: row.created_at };
}

/** This chat's rows already on the thread, by key (spec §3 step 3; served by 0005's messages_thread).
 *  THROWS on a read error. */
export async function listWebchatKeys(db: SupabaseClient, accountId: string, conversationId: string, chatId: string): Promise<WebchatKey[]> {
  const { data, error } = await db.from("messages").select("provider_message_id, created_at")
    .eq("account_id", accountId).eq("conversation_id", conversationId)
    .like("provider_message_id", `${WEBCHAT_KEY_PREFIX}${chatId}:%`).limit(WEBCHAT_MAX_ROWS_PER_CHAT * 4);
  if (error) throw new Error(`listWebchatKeys failed: ${error.message}`);
  return ((data ?? []) as { provider_message_id: string | null; created_at: string }[]).flatMap((r) => {
    const index = parseWebchatKey(chatId, r.provider_message_id);
    return index === null ? [] : [{ index, createdAt: r.created_at }];
  });
}

export async function syncWebchatTurns(
  db: SupabaseClient, accountId: string, chatId: string, opts: { raiseUnread: boolean; now?: Date },
): Promise<WebchatSyncResult> {
  let chat: Awaited<ReturnType<typeof getConciergeConversation>>;
  try {
    chat = await getConciergeConversation(db, chatId);
  } catch {
    return { outcome: "failed", stage: "chat" };
  }
  // getConciergeConversation is not account-scoped (concierge.ts:238): the account is checked here.
  if (!chat || chat.account_id !== accountId || !chat.submission_id) return { outcome: "no_lead" };
  let thread: WebchatThread | null;
  try {
    thread = await resolveWebchatThread(db, accountId, chat.submission_id);
  } catch {
    return { outcome: "failed", stage: "thread" };
  }
  if (!thread) return { outcome: "no_customer" };
  let existing: WebchatKey[];
  try {
    existing = await listWebchatKeys(db, accountId, thread.conversationId, chatId);
  } catch {
    return { outcome: "failed", stage: "keys" };
  }
  const rows = planWebchatRows({
    chatId, transcript: chat.transcript, existing, locale: chat.locale, submissionId: chat.submission_id,
    matchedExisting: thread.matchedExisting, leadAt: thread.leadAt, now: (opts.now ?? new Date()).toISOString(),
  });
  if (rows.length === 0) return { outcome: "nothing_new" };
  try {
    return { outcome: "filed", result: await fileWebchatTurns(db, accountId, thread.conversationId, rows, { raiseUnread: opts.raiseUnread }) };
  } catch {
    return { outcome: "failed", stage: "write" };
  }
}
```

(f) `packages/db/src/index.ts`: add `fileWebchatTurns, type WebchatFileResult,` to the `./messaging` export list (`:48-55`), and after `export * from "./concierge";` (`:170`):

```ts
// S-06 part 3: a lead's website chat on the customer's thread. See ./webchat.ts and ./webchat-plan.ts.
export { resolveWebchatThread, listWebchatKeys, syncWebchatTurns, type WebchatThread, type WebchatSyncResult } from "./webchat";
export {
  planWebchatRows, matchedExistingCustomer, webchatKey, parseWebchatKey, WEBCHAT_ACTOR_ID, WEBCHAT_KEY_PREFIX,
  WEBCHAT_MAX_ROWS_PER_CHAT, type WebchatTurn, type WebchatKey, type WebchatRowMeta, type PlannedWebchatRow,
} from "./webchat-plan";
```

(g) `apps/web/src/lib/labels.ts`: the import line `import { m } from "./messages";` becomes three lines:

```ts
import type { Locale } from "./i18n/locale";
import { t } from "./i18n/t";
import { m, type MessageKey } from "./messages";
```

and `MESSAGE_CHANNEL_LABEL` + `messageChannelLabel` (`:46-64`) become (both existing doc comments kept, each extended by one sentence):

```ts
const CHANNEL_KEY: Record<NewMessage["channel"], MessageKey> = {
  email: "conversations.channel.email",
  form: "conversations.channel.form",
  voice: "conversations.channel.voice",
  sms: "conversations.channel.sms",
  // S-06 part 3: a lead's website chat on the thread.
  webchat: "conversations.channel.webchat",
};

export const MESSAGE_CHANNEL_LABEL: Record<NewMessage["channel"], string> = {
  email: m["conversations.channel.email"],
  form: m["conversations.channel.form"],
  voice: m["conversations.channel.voice"],
  sms: m["conversations.channel.sms"],
  webchat: m["conversations.channel.webchat"],
};

export function messageChannelLabel(channel: string, locale: Locale = "en"): string {
  return Object.hasOwn(CHANNEL_KEY, channel) ? t(m, CHANNEL_KEY[channel as NewMessage["channel"]], locale) : channel;
}
```

- [ ] **Step 7: Run to pass.** Web: `pnpm --filter web exec vitest run src/lib/labels.test.ts src/lib/concierge/webchat-plan.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/message-thread.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/inbound-actions.test.ts"` → PASS. Behind the kit: `webchat.test.ts`, `messaging.test.ts`, `contact-messages.test.ts`, `inbound-email.test.ts`, `provenance-parity.test.ts` → PASS (each exit code captured to a file with nothing after the command; paste the summary blocks). `pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck` → 0.
- [ ] **Step 8: Probes, each by name, edited back:** (a) Sofía's author from `messageAuthor("system", …)` → case 1 FAILS on `"ai"`; (b) delete `if (error?.code === "23505") continue;` → case 1's direct re-file FAILS (`stoppedAt` 0); (c) the emit moved inside the loop → case 1 FAILS on the event count; (d) remove `if (result.inserted === 0) return result;` → case 1 FAILS (a second event); (e) the touch outside `if (result.visitorInserted > 0)` → case 2 FAILS on `last_message_at`; (f) `toRaise += 1` for every inbound row → case 3 FAILS (unread 2); (g) drop `chat.account_id !== accountId` → the other-account case FAILS; (h) drop the G29 `.neq` → the readers case FAILS; (i) `.eq("channel", "sms")` deleted from `hasRecentOutboundSms` → the readers case FAILS; (j) `messageChannelLabel` ignoring `locale` → the labels Spanish case FAILS. Paste each failing assertion line.
- [ ] **Step 9: Commit** `-- packages/db/src/webchat.ts packages/db/src/messaging.ts packages/db/src/index.ts packages/db/src/test/webchat.test.ts apps/web/src/lib/labels.ts apps/web/src/lib/labels.test.ts`, message "db: a lead's website chat files on the customer's thread, once per turn, with one event and unread for the visitor only (S-06 part 3)".

---

## Task 4: The turn route: the visitor's arrival time; the sync in `after()` (bis-comms)

**Review:** opus. **After:** Task 3.

**Files**
- Modify: `<ROUTE>route.ts` (`:15-34` the header; `:178-183` the lazy destructure; above `:522` the turn-start fact; `:653-656` the visitor's `at`; after `:700` the sync)
- Modify: `<ROUTE>route.test.ts` (`dbFns` gains `syncWebchatTurns`; one new case in "answering"; one new `describe`)

**Interfaces**
- Consumes: `syncWebchatTurns` and `WebchatSyncResult` (Task 3).
- Produces: the three log lines in "Global Constraints"; nothing for other tasks.

- [ ] **Step 1: Read before writing.** `<ROUTE>route.ts` whole (709 lines); `<ROUTE>route.test.ts:1-265` (the harness, `flushAfter`, `firstTurn`/`laterTurn`, `beforeEach`), `:845-916` (the filing cases), `:1059-1073` (the lost race), `:1119-1235` (the usage block).

- [ ] **Step 2: Write the failing tests.** In `dbFns` (`:8-21`) add `syncWebchatTurns: vi.fn(),`; in `beforeEach` add `dbFns.syncWebchatTurns.mockResolvedValue({ outcome: "nothing_new" });`. Add to the "answering" describe:

```ts
  it("stamps the visitor's line with the request's ARRIVAL and Sofía's with the moment after the model (spec G4; mutation: stamp both with `now` → equal times, FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T15:00:00.000Z"));
      fetchMock.mockImplementation(async () => {
        vi.setSystemTime(new Date("2026-10-17T15:00:02.500Z"));
        return modelReplies("Yes, we do.");
      });
      await laterTurn();
      const [, , turns] = dbFns.appendConciergeTurns.mock.calls[0]!;
      expect((turns as { role: string; at: string }[]).map((x) => [x.role, x.at])).toEqual([
        ["visitor", "2026-10-17T15:00:00.000Z"], ["assistant", "2026-10-17T15:00:02.500Z"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
```

and a new describe at the end of the file:

```ts
describe("POST /api/concierge/[publicId]/turn — a lead's chat files on the customer's thread (S-06 part 3, spec §3)", () => {
  const LEAD = { fullName: "Ana", phone: "9565550100", need: "a table" };
  const filedEarlier = () => dbFns.getConciergeConversation.mockResolvedValue({ ...CONVERSATION, submission_id: "s0" });

  it("a turn that files the lead schedules ONE sync in after(), for this account and chat, without unread (the lead was not on file when the turn started) (mutation: drop the sync → not called, FAILS; raiseUnread: filed → true, FAILS)", async () => {
    fetchMock.mockResolvedValue(modelCallsCaptureLead(LEAD));
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledTimes(1);
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1", { raiseUnread: false });
  });

  it("a lead filed on an earlier turn: every later turn syncs, with unread allowed (spec §4; mutation: sync only when filed THIS turn → not called, FAILS)", async () => {
    filedEarlier();
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1", { raiseUnread: true });
  });

  it("another tab filed it first: this turn syncs too, without unread (route.ts:567-568; mutation: sync on outcome 'filed' only → not called, FAILS)", async () => {
    dbFns.setConciergeSubmission.mockResolvedValue(false);
    dbFns.getConciergeConversation
      .mockResolvedValueOnce({ ...CONVERSATION })
      .mockResolvedValueOnce({ ...CONVERSATION, submission_id: "s-other-tab" });
    fetchMock.mockResolvedValue(modelCallsCaptureLead(LEAD));
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).toHaveBeenCalledWith(expect.anything(), "a1", "c1", { raiseUnread: false });
  });

  it("no lead on file, or a held capture: no sync (decision 1; mutation: sync on every answered turn → FAILS)", async () => {
    await firstTurn();
    fetchMock.mockResolvedValue(modelCallsCaptureLead({ fullName: "Ana" }));
    await laterTurn();
    await flushAfter();
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
  });

  it("no refusal schedules one, even on a chat with a lead: unknown widget, the turn cap, a failed model call (spec §3 'Where it does NOT run'; mutation: schedule before the claim → the cap case calls it, FAILS)", async () => {
    filedEarlier();
    dbFns.getVoiceProfileByPublicId.mockResolvedValueOnce(null);
    expect((await laterTurn()).status).toBe(404);
    dbFns.claimConciergeTurn.mockResolvedValueOnce(null);
    expect(((await (await laterTurn()).json()) as { ended: boolean }).ended).toBe(true);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    expect((await laterTurn()).status).toBe(503);
    await flushAfter();
    expect(dbFns.syncWebchatTurns).not.toHaveBeenCalled();
  });

  it("a sync that throws or fails leaves the visitor's response byte-identical, the background work resolves, and each log line names the account only (decision 5; mutation: run the sync inline → the body changes or the turn 503s, FAILS; log the chat id → FAILS)", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    filedEarlier();
    const baseline = await (await laterTurn()).text();
    await flushAfter();
    const lines = (msg: string) => logs.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(`"msg":"${msg}"`)).map((l) => JSON.parse(l));
    dbFns.syncWebchatTurns.mockRejectedValueOnce(new Error("db down for c1 Ana 9565550100"));
    expect(await (await laterTurn()).text()).toBe(baseline);
    await expect(flushAfter()).resolves.toBeUndefined();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "failed", stage: "keys" });
    expect(await (await laterTurn()).text()).toBe(baseline);
    await flushAfter();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "no_customer" });
    await laterTurn();
    await flushAfter();
    dbFns.syncWebchatTurns.mockResolvedValueOnce({ outcome: "filed", result: { inserted: 1, visitorInserted: 1, unreadRaised: 0, stoppedAt: 1, failedSteps: ["unread"] } });
    await laterTurn();
    await flushAfter();
    expect(lines("webchat sync failed")).toEqual([
      { at: "concierge/turn", msg: "webchat sync failed", accountId: "a1", stage: "threw" },
      { at: "concierge/turn", msg: "webchat sync failed", accountId: "a1", stage: "keys" },
    ]);
    expect(lines("webchat sync dropped")).toEqual([{ at: "concierge/turn", msg: "webchat sync dropped", accountId: "a1", reason: "no customer" }]);
    expect(lines("webchat sync partial")).toEqual([{ at: "concierge/turn", msg: "webchat sync partial", accountId: "a1", inserted: 1, stopped: true, failedSteps: ["unread"] }]);
    const all = logs.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("webchat sync")).join("\n");
    expect(all).not.toMatch(/"c1"|Ana|9565550100/);
  });

  it("the visitor waits for nothing the sync does: a sync that never settles does not hold the reply (mutation: await the sync before returning → the race answers 'held', FAILS)", async () => {
    filedEarlier();
    dbFns.syncWebchatTurns.mockReturnValue(new Promise(() => {}));
    const res = await Promise.race([laterTurn(), new Promise<"held">((r) => setTimeout(() => r("held"), 2_000))]);
    expect(res).not.toBe("held");
    expect((res as Response).status).toBe(200);
  });
});
```

(The never-settles case does not flush: its recorded callback would never resolve; `beforeEach`'s `afterMock.mockReset()` drops it.)

- [ ] **Step 3: Run to see them fail.** `pnpm --filter web exec vitest run "src/app/api/concierge/[publicId]/turn/route.test.ts"` → the G4 case and the new describe FAIL (`syncWebchatTurns` never called; equal times). Paste the summary and the first failing line.

- [ ] **Step 4: Write the code** in `<ROUTE>route.ts`:
  - Add `syncWebchatTurns,` to the lazy destructure (`:178-183`) after `brandDisplayName, recordAutomationLog,`.
  - Immediately ABOVE `let filed = !!conversation.submission_id;` (`:522`):

```ts
    // S-06 part 3 (spec §4, G7): whether the lead was on file when this turn STARTED, the unread rule for
    // this turn's visitor line. Turn 1's row is built with none (above); a lead filed by this turn, or by
    // another tab during it, was not on file at the start.
    const leadAtStart = !!conversation.submission_id;
```

  - In the append (`:653-656`) the visitor's line becomes `{ role: "visitor", text, at: new Date(startedAt).toISOString() },`, above it the comment `// S-06 part 3 (spec G4): the visitor's line at the request's ARRIVAL, Sofía's after the model, so a filing turn reads: their details, the lead, her thank-you.`
  - After the usage `if` block (after `:700`), before `return quiet(conversationId, spoken, false);`:

```ts
    // S-06 part 3 (spec §3, G3): a chat with a lead on file files on that customer's thread. ONE job, in
    // after(), like the usage leg: the visitor already has this reply, so nothing the sync does can
    // change, delay or break it, and syncWebchatTurns answers outcomes instead of throwing. It reads what
    // IS on the thread, so the next turn heals whatever this one missed (the chat's last turn has no next
    // turn: that pair stays only in the transcript, spec failure table). Logged with the account id only
    // (decision 5): never the chat id, never a word of the chat.
    if (filed) {
      const accountId = profile.account_id;
      after(async () => {
        try {
          const r = await syncWebchatTurns(db, accountId, conversationId, { raiseUnread: leadAtStart });
          if (r.outcome === "failed") log("webchat sync failed", { accountId, stage: r.stage });
          else if (r.outcome === "no_customer") log("webchat sync dropped", { accountId, reason: "no customer" });
          else if (r.outcome === "filed" && (r.result.stoppedAt !== null || r.result.failedSteps.length > 0)) {
            log("webchat sync partial", {
              accountId, inserted: r.result.inserted, stopped: r.result.stoppedAt !== null, failedSteps: r.result.failedSteps,
            });
          }
        } catch {
          log("webchat sync failed", { accountId, stage: "threw" });
        }
      });
    }
```

  (`accountId` is taken OUTSIDE the callback for the reason `:219-222` states: the narrowing of `profile` does not reach a nested function body.)
  - Add to the header comment's numbered list (`:15-34`): `4. (S-06 part 3) A lead's chat is copied to the customer's inbox thread AFTER the response, in after() (syncWebchatTurns): idempotent per transcript index, so a retried sync never duplicates; a retried POST still files its pair twice (property 3), and both copies appear on the thread, mirroring the transcript.`

- [ ] **Step 5: Run to pass**, the whole route test → PASS (paste the summary; the run count grows by 8). `pnpm --filter web typecheck` → 0; `pnpm --filter web exec eslint "src/app/api/concierge/[publicId]/turn/route.ts" "src/app/api/concierge/[publicId]/turn/route.test.ts"` → clean.
- [ ] **Step 6: Probes, each by name, edited back:** (a) delete the `if (filed) { … }` block → the filing case FAILS; (b) `raiseUnread: filed` → the first case FAILS; (c) the block moved above `const claimed = …` with `filed` read off the row → the refusals case FAILS; (d) `after(async () => {` replaced by an inline `await (async () => {` without the `try` → the throws case FAILS; (e) `chatId: conversationId` added to the failed log → the throws case FAILS; (f) the visitor's `at` back to `now` → the G4 case FAILS; (g) the sync awaited inline before `return` → the never-settles case FAILS ("held"). Paste each failing assertion line.
- [ ] **Step 7: Commit** `-- "apps/web/src/app/api/concierge/[publicId]/turn/route.ts" "apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts"`, message "concierge: a lead's chat files on the customer's thread after each turn, never in the visitor's way (S-06 part 3)".

---

## Task 5: The start channel and the inbox composer's facts (bis-comms; pure, server)

**Review:** sonnet. **Runs beside:** Tasks 1, 2.

**Files**
- Create: `…/conv/start-channel.ts` (+ `start-channel.test.ts`)
- Create: `…/conv/composer-facts.ts` (+ `composer-facts.test.ts`)

**Interfaces**
- Consumes: `canTextFrom` (`lib/record/header-actions.ts:25`), `composerStateLine`, `composerEmailNotice`, `SmsRecipientState`, `EmailRecipientState` (`lib/consent/composer-state.ts`), `SmsGate` (`lib/sms/sender.ts:3`), `e164Of` (`lib/voice/phone-number.ts:17`).
- Produces (no directive in either file; a server component calls them): `type LastReply = "sms" | "email" | "other" | null`; `type Readiness = "ready" | "stopped" | "unavailable"`; `type ThreadRow = { direction: string; channel: string; author_kind?: string | null }`; `lastCustomerReply(messages): LastReply`; `textReadiness(i): Readiness`; `emailReadiness(i): Readiness`; `startChannel(i): "sms" | "email"`; `type ComposerContact`, `type InboxComposerFacts = { contactHasEmail: boolean; contactHasPhone: boolean; smsGate: SmsGate | null; smsBlockedLine: string | null; emailNoticeLine: string | null; initialMode: "sms" | "email" }`; `loadInboxComposer(deps, ctx): Promise<InboxComposerFacts>`. Consumed by Task 8.

- [ ] **Step 1: Read before writing.** `sed -n 1,30p apps/web/src/lib/record/header-actions.ts`, `sed -n 1,100p apps/web/src/lib/consent/composer-state.ts`, `sed -n 1,90p apps/web/src/lib/consent/recipient-state.ts`, `sed -n 1,10p apps/web/src/lib/sms/sender.ts`, `sed -n 1,30p apps/web/src/lib/voice/phone-number.ts`, `sed -n 1,40p "…/record/message-composer.tsx"` (`smsFormBlock`'s order), and spec §6 whole.

- [ ] **Step 2: Write the failing tests.** `…/conv/start-channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lastCustomerReply, startChannel, textReadiness, emailReadiness, type LastReply, type Readiness } from "./start-channel";

const row = (direction: string, channel: string, author_kind: string) => ({ direction, channel, author_kind });

describe("lastCustomerReply: the newest row that is the customer reaching the business (spec §6, G11)", () => {
  it("their text or their email, newest first (mutation: scan oldest first → 'sms', FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "email", "customer")])).toBe("email");
    expect(lastCustomerReply([row("inbound", "email", "customer"), row("inbound", "sms", "customer")])).toBe("sms");
  });
  it("a teammate's forward is skipped, and so is everything the business sent (mutation: count any inbound email → 'email', FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "email", "person"), row("outbound", "email", "person")])).toBe("sms");
  });
  it("a web chat, a form or a call is 'other', the call's copy too although the receptionist wrote it (mutation: require author customer for voice → null, FAILS)", () => {
    expect(lastCustomerReply([row("inbound", "sms", "customer"), row("inbound", "webchat", "customer")])).toBe("other");
    expect(lastCustomerReply([row("inbound", "form", "customer")])).toBe("other");
    expect(lastCustomerReply([row("inbound", "voice", "ai")])).toBe("other");
    expect(lastCustomerReply([row("outbound", "webchat", "ai")])).toBeNull();
  });
  it("nothing from them at all is null", () => {
    expect(lastCustomerReply([])).toBeNull();
    expect(lastCustomerReply([row("outbound", "sms", "person")])).toBeNull();
  });
});

describe("readiness, from the reads the record page already makes (spec §6)", () => {
  const OPEN = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
  it("Text: ready exactly when the composer's text form would open; stopped when they stopped texts; otherwise unavailable (mutation: ready without a usable number → FAILS)", () => {
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("ready");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: "They stopped texts.", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z" } })).toBe("stopped");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: OPEN, smsBlockedLine: "On hold.", recipient: { kind: "held", since: "2026-10-01T00:00:00Z" } })).toBe("unavailable");
    expect(textReadiness({ phone: null, smsGate: OPEN, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: null, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(textReadiness({ phone: "(956) 555-0100", smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null, recipient: { kind: "ok" } })).toBe("unavailable");
  });
  it("Email: ready with an address and nothing stopped; stopped for any stop; otherwise unavailable (mutation: ready while stopped → FAILS)", () => {
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "ok" } })).toBe("ready");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z", byCustomer: true } })).toBe("stopped");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "stopped", since: "2026-10-01T00:00:00Z", byCustomer: false, suppressed: "bounced" } })).toBe("stopped");
    expect(emailReadiness({ email: "ana@example.com", recipient: { kind: "unknown" } })).toBe("unavailable");
    expect(emailReadiness({ email: null, recipient: { kind: "ok" } })).toBe("unavailable");
    expect(emailReadiness({ email: "  ", recipient: { kind: "ok" } })).toBe("unavailable");
  });
});

describe("startChannel: the whole matrix, 4 × 3 × 3 = 36 cases (spec §6 steps 1-3, G10)", () => {
  const S: Readiness[] = ["ready", "stopped", "unavailable"];
  // [lastReply, text, email] → the channel. Worked by hand from §6: preferred, then the other if ready,
  // then the one NOT stopped, then preferred.
  const CASES: [LastReply, Readiness, Readiness, "sms" | "email"][] = [
    ["sms", "ready", "ready", "sms"], ["sms", "ready", "stopped", "sms"], ["sms", "ready", "unavailable", "sms"],
    ["sms", "stopped", "ready", "email"], ["sms", "stopped", "stopped", "sms"], ["sms", "stopped", "unavailable", "email"],
    ["sms", "unavailable", "ready", "email"], ["sms", "unavailable", "stopped", "sms"], ["sms", "unavailable", "unavailable", "sms"],
    ["email", "ready", "ready", "email"], ["email", "ready", "stopped", "sms"], ["email", "ready", "unavailable", "sms"],
    ["email", "stopped", "ready", "email"], ["email", "stopped", "stopped", "email"], ["email", "stopped", "unavailable", "email"],
    ["email", "unavailable", "ready", "email"], ["email", "unavailable", "stopped", "sms"], ["email", "unavailable", "unavailable", "email"],
    ...(["other", null] as const).flatMap((last): [LastReply, Readiness, Readiness, "sms" | "email"][] => [
      [last, "ready", "ready", "sms"], [last, "ready", "stopped", "sms"], [last, "ready", "unavailable", "sms"],
      [last, "stopped", "ready", "email"], [last, "stopped", "stopped", "email"], [last, "stopped", "unavailable", "email"],
      [last, "unavailable", "ready", "email"], [last, "unavailable", "stopped", "sms"], [last, "unavailable", "unavailable", "email"],
    ]),
  ];
  it("covers every combination exactly once", () => {
    expect(CASES).toHaveLength(36);
    expect(new Set(CASES.map(([l, t, e]) => `${l}|${t}|${e}`)).size).toBe(36);
    for (const t of S) for (const e of S) expect(CASES.filter(([, ct, ce]) => ct === t && ce === e)).toHaveLength(4);
  });
  for (const [lastReply, text, email, want] of CASES) {
    it(`last reply ${lastReply ?? "none"}, Text ${text}, Email ${email} → ${want}`, () => {
      expect(startChannel({ lastReply, text, email })).toBe(want);
    });
  }
  it("never answers anything but Text or Email (decision 5: nothing sends a web chat row)", () => {
    for (const [lastReply, text, email] of CASES) expect(["sms", "email"]).toContain(startChannel({ lastReply, text, email }));
  });
});
```

`…/conv/composer-facts.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadInboxComposer, type InboxComposerDeps } from "./composer-facts";

const OPEN = { ok: true as const, from: "+19565550000", ownedNumbers: ["+19565550000"] };
const ANA = { phone: "(956) 555-0100", email: "ana@example.com", phone_country_unconfirmed: false };
const deps = (over: Partial<InboxComposerDeps> = {}): InboxComposerDeps => ({
  contact: vi.fn(async () => ANA), gate: vi.fn(async () => OPEN),
  smsState: vi.fn(async () => ({ kind: "ok" as const })), emailState: vi.fn(async () => ({ kind: "ok" as const })),
  log: vi.fn(), ...over,
});
const ctx = (messages: { direction: string; channel: string; author_kind?: string | null }[], locale: "en" | "es" = "en") => ({ messages, zone: "UTC", locale });

describe("loadInboxComposer: the inbox composer's facts, decided on the server (spec §6)", () => {
  it("opens on the channel of their last text or email when it is ready (mutation: ignore lastReply → 'sms', FAILS)", async () => {
    const f = await loadInboxComposer(deps(), ctx([{ direction: "inbound", channel: "sms", author_kind: "customer" }, { direction: "inbound", channel: "email", author_kind: "customer" }]));
    expect(f).toEqual({ contactHasEmail: true, contactHasPhone: true, smsGate: OPEN, smsBlockedLine: null, emailNoticeLine: null, initialMode: "email" });
  });

  it("after a web chat it opens on Text when their number is cleared, otherwise Email (decision 2; mutation: preferred 'email' for 'other' → FAILS)", async () => {
    const chat = [{ direction: "inbound", channel: "webchat", author_kind: "customer" }];
    expect((await loadInboxComposer(deps(), ctx(chat))).initialMode).toBe("sms");
    expect((await loadInboxComposer(deps({ gate: vi.fn(async () => null) }), ctx(chat))).initialMode).toBe("email");
  });

  it("their texts stopped: never opens on Text, and the line is today's, in the staff member's language (mutation: pass the English locale → FAILS)", async () => {
    const d = deps({ smsState: vi.fn(async () => ({ kind: "stopped" as const, since: "not a time" })) });
    const f = await loadInboxComposer(d, ctx([{ direction: "inbound", channel: "sms", author_kind: "customer" }], "es"));
    expect(f.initialMode).toBe("email");
    expect(f.smsBlockedLine).toBe("Dejó de recibir sus textos. No puede mandarle textos a este número hasta que mande START.");
  });

  it("an unreadable contact: nothing is ready, no state is read, one fixed log line with no customer data (mutation: rethrow → the page fails, FAILS; read the ledger anyway → FAILS)", async () => {
    const d = deps({ contact: vi.fn(async () => { throw new Error("rls ana@example.com"); }) });
    const f = await loadInboxComposer(d, ctx([]));
    expect(f).toEqual({ contactHasEmail: false, contactHasPhone: false, smsGate: OPEN, smsBlockedLine: null, emailNoticeLine: null, initialMode: "email" });
    expect(d.smsState).not.toHaveBeenCalled();
    expect(d.emailState).not.toHaveBeenCalled();
    expect((d.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ")).not.toContain("ana@");
  });

  it("an unusable number is no phone, the way sendSmsAction reads it (mutation: Boolean(phone) → true, FAILS)", async () => {
    const f = await loadInboxComposer(deps({ contact: vi.fn(async () => ({ ...ANA, phone: "12" })) }), ctx([]));
    expect(f.contactHasPhone).toBe(false);
    expect(f.initialMode).toBe("email");
  });
});
```

- [ ] **Step 3: Run to see them fail.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/start-channel.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/composer-facts.test.ts"` → FAIL (no modules). Paste the line.

- [ ] **Step 4: Write `…/conv/start-channel.ts`** (NO directive):

```ts
import type { SmsGate } from "@/lib/sms/sender";
import type { SmsRecipientState, EmailRecipientState } from "@/lib/consent/composer-state";
import { canTextFrom } from "@/lib/record/header-actions";

/**
 * S-06 part 3, spec §6: the channel the inbox composer opens on. PURE, called only on the server
 * (page.tsx, through composer-facts.ts) and handed to the client as data. Never "webchat": nothing
 * sends a web chat row (decision 5).
 */
export type LastReply = "sms" | "email" | "other" | null;
export type Readiness = "ready" | "stopped" | "unavailable";
/** The thread's own rows (listMessages, oldest first), only the fields this reads. */
export type ThreadRow = { direction: string; channel: string; author_kind?: string | null };

/** The newest row that is the customer reaching the business (G11). */
export function lastCustomerReply(messages: readonly ThreadRow[]): LastReply {
  for (let i = messages.length - 1; i >= 0; i--) {
    const x = messages[i]!;
    if (x.direction !== "inbound") continue;
    if (x.channel === "sms" || x.channel === "email") {
      // A teammate's forward (author 'person', S-06 part 2) is not the customer.
      if (x.author_kind === "customer") return x.channel;
      continue;
    }
    // A call's inbox copy is the receptionist's (author 'ai') and still counts: decision 2 names a call.
    if (x.channel === "webchat" || x.channel === "form" || x.channel === "voice") return "other";
  }
  return null;
}

/** Text: ready exactly when the composer's text form would open (canTextFrom, the record header's
 *  predicate); stopped when they stopped texts; otherwise unavailable. */
export function textReadiness(i: { phone: string | null; smsGate: SmsGate | null; smsBlockedLine: string | null; recipient: SmsRecipientState }): Readiness {
  if (canTextFrom({ phone: i.phone, smsGate: i.smsGate, smsBlockedLine: i.smsBlockedLine })) return "ready";
  return i.recipient.kind === "stopped" ? "stopped" : "unavailable";
}

/** Email: stopped for any stop (an unsubscribe, a staff stop, a bounce, a complaint); ready with an
 *  address and nothing stopped; otherwise unavailable (no address, or a read that failed). */
export function emailReadiness(i: { email: string | null; recipient: EmailRecipientState }): Readiness {
  if (i.recipient.kind === "stopped") return "stopped";
  return i.email && i.email.trim() && i.recipient.kind === "ok" ? "ready" : "unavailable";
}

/** §6 steps 1-3 (G10). */
export function startChannel(i: { lastReply: LastReply; text: Readiness; email: Readiness }): "sms" | "email" {
  const preferred: "sms" | "email" = i.lastReply === "sms" ? "sms" : i.lastReply === "email" ? "email" : i.text === "ready" ? "sms" : "email";
  const other: "sms" | "email" = preferred === "sms" ? "email" : "sms";
  const r = (c: "sms" | "email") => (c === "sms" ? i.text : i.email);
  if (r(preferred) === "ready") return preferred;
  if (r(other) === "ready") return other;
  // Neither ready: never the channel they stopped, when the other is not stopped too.
  if (r(preferred) === "stopped" && r(other) !== "stopped") return other;
  return preferred;
}
```

- [ ] **Step 5: Write `…/conv/composer-facts.ts`** (NO directive):

```ts
import type { SmsGate } from "@/lib/sms/sender";
import { composerStateLine, composerEmailNotice, type SmsRecipientState, type EmailRecipientState } from "@/lib/consent/composer-state";
import { e164Of } from "@/lib/voice/phone-number";
import type { Locale } from "@/lib/i18n/locale";
import { lastCustomerReply, startChannel, textReadiness, emailReadiness, type ThreadRow } from "./start-channel";

/**
 * S-06 part 3, spec §6: what the inbox's Text | Email composer is handed, decided on the SERVER from
 * the same reads the record page makes (record/page.tsx:91-121). The page passes thunks, so this module
 * never names a client: `contact` is getContact on the REQUEST client (RLS proves the customer), and
 * only then are the two recipient states read on the ledger client. Never throws.
 */
export type ComposerContact = { phone: string | null; email: string | null; phone_country_unconfirmed?: boolean | null };
export type InboxComposerFacts = {
  contactHasEmail: boolean; contactHasPhone: boolean; smsGate: SmsGate | null;
  smsBlockedLine: string | null; emailNoticeLine: string | null; initialMode: "sms" | "email";
};
export type InboxComposerDeps = {
  contact: () => Promise<ComposerContact | null>;
  /** softSmsGate: null on a failed read, never a throw. */
  gate: () => Promise<SmsGate | null>;
  /** smsRecipientState / emailRecipientState: never throw ("unknown" on a failed read). */
  smsState: (c: ComposerContact) => Promise<SmsRecipientState>;
  emailState: (c: ComposerContact) => Promise<EmailRecipientState>;
  log: (line: string) => void;
};

export async function loadInboxComposer(
  d: InboxComposerDeps, ctx: { messages: readonly ThreadRow[]; zone: string; locale: Locale },
): Promise<InboxComposerFacts> {
  let contact: ComposerContact | null = null;
  try {
    contact = await d.contact();
  } catch {
    d.log("the customer could not be read; the composer opens with nothing ready");
  }
  const smsGate = await d.gate();
  const [sms, email]: [SmsRecipientState, EmailRecipientState] = contact
    ? await Promise.all([d.smsState(contact), d.emailState(contact)])
    : [{ kind: "unknown" }, { kind: "unknown" }];
  const smsBlockedLine = contact ? composerStateLine(sms, ctx.zone, ctx.locale) : null;
  const emailNoticeLine = contact ? composerEmailNotice(email, ctx.zone, ctx.locale) : null;
  const phone = contact?.phone ?? null;
  return {
    contactHasEmail: Boolean(contact?.email),
    contactHasPhone: Boolean(e164Of(phone)),
    smsGate, smsBlockedLine, emailNoticeLine,
    initialMode: startChannel({
      lastReply: lastCustomerReply(ctx.messages),
      text: textReadiness({ phone, smsGate, smsBlockedLine, recipient: sms }),
      email: emailReadiness({ email: contact?.email ?? null, recipient: email }),
    }),
  };
}
```

- [ ] **Step 6: Run to pass** both files → PASS (paste the summary; start-channel holds 4 + 2 + 1 + 36 + 1 = 44 tests, composer-facts 5). `pnpm --filter web typecheck` → 0. Then `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → PASS (neither new file names a service client).
- [ ] **Step 7: Probes, each by name, edited back:** (a) `lastCustomerReply` scanning from index 0 → the newest-first case FAILS; (b) drop the `author_kind === "customer"` check → the forward case FAILS; (c) `preferred = … : "email"` for other/null → 9 named matrix cases FAIL (paste two names); (d) delete the "not stopped" line → `last reply sms, Text stopped, Email unavailable → email` FAILS by name; (e) `contactHasPhone: Boolean(phone)` → the unusable-number case FAILS; (f) rethrow in the contact catch → the unreadable case FAILS. Paste each failing line.
- [ ] **Step 8: Commit** `-- "<…/conv/>start-channel.ts" "<…/conv/>start-channel.test.ts" "<…/conv/>composer-facts.ts" "<…/conv/>composer-facts.test.ts"` (each written out in full), message "inbox: the composer opens on the channel of the customer's last reply, never one they stopped, decided on the server (S-06 part 3)".

---

## Task 6: `MessageComposer`'s `modes` and `initialMode` (bis-comms)

**Review:** sonnet. **After:** Task 1 (the "Reply by" key).

**Files**
- Modify: `…/record/message-composer.tsx`
- Modify: `…/record/message-composer.test.ts`

**Interfaces**
- Produces: `MessageComposer` gains `modes?: readonly ComposeMode[]` (default `["note", "email", "sms"]`), `initialMode?: ComposeMode`, and `noteAction` becomes optional (required only when `modes` holds `"note"`); exported pure helpers `DEFAULT_MODES`, `tabSwitch(current, tapped)`, `modeAfterSend(current, initialMode)`. Consumed by Task 8. The record page passes none of the new props: its composer is byte-for-byte today's.

- [ ] **Step 1: Read before writing.** `…/record/message-composer.tsx` whole (251 lines) and its test whole; `sed -n 1,40p apps/web/src/lib/forms/use-form-submit.ts`.

- [ ] **Step 2: Write the failing tests** (append to `message-composer.test.ts`; extend the import line with `tabSwitch, modeAfterSend`):

```ts
function inbox(initialMode: "sms" | "email", over: Record<string, unknown> = {}, locale: "en" | "es" = "en"): string {
  return renderToStaticMarkup(createElement(LocaleProvider, { locale }, createElement(MessageComposer, {
    contactId: "c1", contactHasEmail: true, contactHasPhone: true,
    smsGate: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] }, smsBlockedLine: null, emailNoticeLine: null,
    emailAction: async () => {}, smsAction: async () => {},
    modes: ["sms", "email"], initialMode, ...over,
  } as never)));
}
const tabs = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map((x) => [x[2], x[1]]);

describe("the inbox's Text | Email composer (S-06 part 3, spec §6, G9, G31)", () => {
  it("two tabs, Text then Email, no Note, opening on the server's channel (mutation: ignore initialMode → Note-less first tab pressed, FAILS)", () => {
    expect(tabs(inbox("email"))).toEqual([["Text", "false"], ["Email", "true"]]);
    expect(tabs(inbox("sms"))).toEqual([["Text", "true"], ["Email", "false"]]);
    expect(inbox("email")).toContain('placeholder="Subject"');
  });
  it("the tab group says what it is, in the staff member's language (mutation: drop role=group → FAILS)", () => {
    expect(inbox("sms")).toMatch(/<div[^>]*role="group"[^>]*aria-label="Reply by"/);
    expect(inbox("sms", {}, "es")).toMatch(/<div[^>]*role="group"[^>]*aria-label="Responder por"/);
    expect(tabs(inbox("sms", {}, "es")).map(([label]) => label)).toEqual(["Texto", "Correo"]);
  });
  it("opening on Text shows today's blocked line in place of the form (mutation: render the form anyway → FAILS)", () => {
    expect(renderedText(inbox("sms", { smsBlockedLine: "They stopped texts from you." }))).toContain("They stopped texts from you.");
    expect(inbox("sms", { smsBlockedLine: "They stopped texts from you." })).not.toContain("<textarea");
  });
  it("the record page's composer is unchanged: three tabs, Note first and pressed, no group label (mutation: default modes without note → FAILS)", () => {
    expect(tabs(render()).map(([label, pressed]) => [label, pressed])).toEqual([["Note", "true"], ["Email", "false"], ["Text", "false"]]);
    expect(render()).not.toContain('role="group"');
  });
});

describe("one tap switches, for this message only (spec §6 'Not sticky')", () => {
  it("tabSwitch: a different tab switches, the same tab does nothing, only the Note boundary clears the draft (mutation: clear on every switch → FAILS)", () => {
    expect(tabSwitch("sms", "email")).toEqual({ mode: "email", clearBody: false });
    expect(tabSwitch("sms", "sms")).toBeNull();
    expect(tabSwitch("note", "email")).toEqual({ mode: "email", clearBody: true });
  });
  it("modeAfterSend: back to the server's channel when one was given (the inbox), unchanged otherwise (the record) (G31; mutation: always initialMode ?? 'note' → the record jumps to Note, FAILS)", () => {
    expect(modeAfterSend("email", "sms")).toBe("sms");
    expect(modeAfterSend("email", undefined)).toBe("email");
  });
});
```

(`renderedText` is imported from `@/lib/rendered-text` if the file does not already import it; the record `render()` helper is the file's own, `:22-34`, which renders without a `LocaleProvider`, so its labels are English. If the existing tab test's regex shape differs from `tabs()` here, keep both.)

- [ ] **Step 3: Run to see them fail.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"` → the new cases FAIL. Paste the first failing line.

- [ ] **Step 4: Write the code.** In `message-composer.tsx`:
  - After `type Mode = ComposeMode;`:

```ts
/** The record page's three tabs, in today's order. The inbox passes ["sms", "email"] (S-06 part 3, G9). */
export const DEFAULT_MODES: readonly ComposeMode[] = ["note", "email", "sms"];

/** One tap on a tab (spec §6: one tap switches, for this message only). Only the Note boundary clears the
 *  draft (a note typed then sent as a text was the hazard the old inline handler guarded). */
export function tabSwitch(current: ComposeMode, tapped: ComposeMode): { mode: ComposeMode; clearBody: boolean } | null {
  if (tapped === current) return null;
  return { mode: tapped, clearBody: current === "note" || tapped === "note" };
}

/** After a successful send (spec §6, not sticky; plan G31): back to the server's channel when the caller
 *  gave one (the inbox); the record page gives none and stays where it is, as today. */
export function modeAfterSend(current: ComposeMode, initialMode: ComposeMode | undefined): ComposeMode {
  return initialMode ?? current;
}
```

  - Props: add `modes = DEFAULT_MODES, initialMode,` to the destructure and to the type: `/** S-06 part 3 (G9): which tabs, in this order; default the record's three. */ modes?: readonly ComposeMode[]; /** S-06 part 3 (spec §6): the channel the server decided; absent = Note (or the first of modes). */ initialMode?: ComposeMode;`; `noteAction` becomes `noteAction?: (formData: FormData) => Promise<void>;` with the comment `/** Required whenever modes holds "note" (the record page). */`.
  - `const [mode, setMode] = useState<Mode>("note");` → `const [mode, setMode] = useState<Mode>(initialMode ?? (modes.includes("note") ? "note" : modes[0]!));`
  - The submit's action pick: `(isEmail ? emailAction : isSms ? smsAction : noteAction)` → `(isEmail ? emailAction : isSms ? smsAction : (noteAction ?? (async () => { throw new Error("no note action"); })))`.
  - In the success branch, after the reset: `const next = modeAfterSend(mode, initialMode); if (next !== mode) setMode(next);`
  - The tab row: `<div className="flex gap-1">` → `<div className="flex gap-1" {...(modes.includes("note") ? {} : { role: "group", "aria-label": tx("conversations.compose.via") })}>`, and `{(["note", "email", "sms"] as const).map((value) => (` → `{modes.map((value) => (`.
  - The tab's `onClick` body becomes `const step = tabSwitch(mode, value); if (!step) return; setMode(step.mode); if (step.clearBody) setBody("");` (the existing comment stays above it).

- [ ] **Step 5: Run to pass** the composer test, plus `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.rows.test.ts"` and the record `page.test.ts` (the record's composer unchanged) → PASS. `pnpm --filter web typecheck` → 0; eslint on the two files → clean.
- [ ] **Step 6: Probes, each by name, edited back:** (a) `useState<Mode>("note")` restored → the inbox's first case FAILS; (b) the `role: "group"` spread removed → the group case FAILS; (c) `modeAfterSend` returning `initialMode ?? "note"` → its case FAILS; (d) `tabSwitch` with `clearBody: true` always → its case FAILS; (e) `DEFAULT_MODES = ["email", "sms"]` → the record case FAILS. Paste each failing line.
- [ ] **Step 7: Commit** `-- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"`, message "composer: the record's composer takes its tabs and its first channel from the caller; the record page is unchanged (S-06 part 3)".

---

## Task 7: The record: the `chats` source, the chat row, "Last talked" (bis-crm)

**Review:** opus (RLS-scoped reads, the timeline cursor). **After:** Tasks 1, 3. **Scratch:** `<SCRATCH>/s06c-t7-impl/`, ports `55666`/`55667`/`55668` (reviewer `55669`/`55670`/`55671`).

**Files**
- Modify: `packages/db/src/record.ts` (`:12` the timeline-cursor import; `:33` `LastTalkedChannel`; `:51-65`, `:110-127` the two newest-message reads; `:265-266` the sources; `:291-310` the entry union; `:324-404` the merge)
- Modify: `packages/db/src/index.ts` (`type TimelineChat` in the record export, `:325-336`)
- Modify: `packages/db/src/test/record.test.ts` (`:298` pinned; one new describe), `packages/db/src/test/timeline-merge.test.ts` (`:157-164` pinned)
- Create: `packages/db/src/test/webchat-rls.test.ts`
- Modify: `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` + their tests
- Modify: `…/record/activity-timeline.tsx` + `activity-timeline.rows.test.ts`, `…/group/group-timeline.tsx` + `group-timeline.test.ts`, `…/acct/contacts/contact-drawer.tsx` (`ROW_ICON`, `:64-68`)

**Interfaces**
- Consumes: `withTimelinePage`, `forContacts` (`timeline-cursor.ts`), `WEBCHAT_MAX_ROWS_PER_CHAT` (Task 2); the rows Task 3 writes (`channel = 'webchat'`, `meta.webchat.{chat_id, index, matched_existing}`); Task 1's keys.
- Produces: `TimelineSource` gains `"chats"` (LAST in `TIMELINE_SOURCES`); `type TimelineChat = { conversationId: string; count: number; matchedExisting: boolean }`; `TimelineEntry` gains `{ kind: "chat"; id; at; contactId; chat: TimelineChat }` (`id`/`at` = the chat's index-0 row); `LastTalkedChannel` gains `"chat"`; web `TimelineRow` gains optional `note?: { text: string; lang: Locale }` (set only on a matched chat row).

- [ ] **Step 1: Read before writing.** `packages/db/src/record.ts` whole; `packages/db/src/timeline-cursor.ts:60-83`; `packages/db/src/test/record.test.ts:1-60` and `:218-300`; `packages/db/src/test/timeline-merge.test.ts:28-175`; `packages/db/src/test/db.ts` whole; `sed -n 1,80p packages/db/src/test/inbound-never-log-schema.test.ts` (the SQL seed shape); `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` whole and the first 80 lines of each test; `…/record/activity-timeline.tsx:140-260` and `activity-timeline.rows.test.ts:1-80`; `…/group/group-timeline.tsx:90-200` and `group-timeline.test.ts:1-80`; `…/acct/contacts/contact-drawer.tsx:1-70`, `:270-295`. Build your own kit `post` on `55666` and its PostgREST (`pgrst.sh 55666 55667 55668`).

- [ ] **Step 2: Write the failing db tests.**

(a) `packages/db/src/test/webchat-rls.test.ts` (SQL, `withRollback`; the Technician fence on the exact predicate the source reads):

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/** S-06 part 3 (spec §7, "Tests": a Technician sees only their own customers' chats). The chats source
 *  reads messages on the caller's client; 0068's messages_technician_scope decides, through the conversation. */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_wc_${RUN}`;
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'WC Co',true) returning id", [agency!.id, ORG]);
  const tech = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`u_wc_tech_${RUN}`]);
  const owner = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`u_wc_owner_${RUN}`]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'technician'), ($2,'account',$3,'owner')", [tech, owner, acct]);
  const mine = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Mine',$2) returning id", [acct, tech]);
  const theirs = await one(c, "insert into contacts (account_id, first_name) values ($1,'Theirs') returning id", [acct]);
  const anchor = async (contact: string, chat: string) => {
    const conv = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, contact]);
    await c.query(
      `insert into messages (account_id, conversation_id, channel, direction, status, body, author_kind, provider_message_id, meta)
       values ($1,$2,'webchat','inbound','delivered','hola','customer',$3, jsonb_build_object('webchat', jsonb_build_object('chat_id', $4::text, 'index', 0)))`,
      [acct, conv, `webchat:${chat}:0`, chat]);
    return conv;
  };
  const mineConv = await anchor(mine, `00000000-0000-4000-8000-${RUN.padStart(12, "0").slice(-12)}`);
  const theirsConv = await anchor(theirs, `00000000-0000-4000-9000-${RUN.padStart(12, "0").slice(-12)}`);
  return { mineConv, theirsConv };
}

describe("a chat's rows under 0068 (S-06 part 3)", () => {
  it("a Technician reads the chat anchors of their own customer only; an Owner reads both (mutation: drop messages_technician_scope → the tech reads two, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const read = async (sub: string) => {
        await actAs(c, { org_id: ORG, sub });
        const ids = (await c.query<{ conversation_id: string }>(
          "select conversation_id from messages where channel = 'webchat' and meta->'webchat'->>'index' = '0' order by conversation_id")).rows.map((r) => r.conversation_id);
        await c.query("reset role");
        return ids;
      };
      expect(await read(`u_wc_tech_${RUN}`)).toEqual([s.mineConv]);
      expect(await read(`u_wc_owner_${RUN}`)).toEqual([s.mineConv, s.theirsConv].sort());
    });
  });
});
```

(If `contacts` needs another column without a default, read `0002_crm.sql`'s `contacts` and add it; say so.)

(b) In `record.test.ts`, import `createConciergeConversation, appendConciergeTurns, setConciergeSubmission, type ConciergeTurn` from `../concierge`, `syncWebchatTurns` from `../webchat`, and add `type TimelineEntry` to the existing `../record` import; change `:298`'s expected list to end `"documents", "chats"]`; add:

```ts
describe("the chats source and Last talked (S-06 part 3, spec §7, G20-G22)", () => {
  // ONE base time, so the turns written and the times asserted agree to the millisecond.
  const BASE = Date.now() + 3_600_000;
  const SOON = (s: number) => new Date(BASE + s * 1000).toISOString();
  const chatTurns = (n: number, from: number): ConciergeTurn[] =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "visitor" : "assistant", text: `t${i}`, at: SOON(from + i) }));
  /** One lead chat for an existing customer, synced as the route would. */
  async function chatFor(db: SupabaseClient, accountId: string, contactId: string, n: number, from: number) {
    const form = await createForm(db, accountId, { name: "Website chat" }, ACTOR);
    const chat = await createConciergeConversation(db, { accountId, formId: form.id, ipHash: "h", locale: "en", attribution: {}, origin: null });
    await appendConciergeTurns(db, chat.id, chatTurns(n, from));
    const sub = await createSubmission(db, accountId, form.id, { answers: [], authorKind: "ai" });
    await linkSubmissionContact(db, accountId, sub.id, contactId);
    expect(await setConciergeSubmission(db, chat.id, sub.id)).toBe(true);
    expect((await syncWebchatTurns(db, accountId, chat.id, { raiseUnread: false })).outcome).toBe("filed");
    return chat.id;
  }
  const chatsOf = (items: TimelineEntry[]) => items.flatMap((i) => (i.kind === "chat" ? [i] : []));

  it("one row per chat, at its START, counting both sides; a later turn moves neither the row nor its time (mutations: drop the index-0 filter → six rows, FAILS; count visitor rows only → 3, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const chatId = await chatFor(db, accountId, ana, 6, 0);
      const first = chatsOf((await listContactTimelinePage(db, accountId, ana)).items);
      expect(first).toHaveLength(1);
      expect(first[0]!.chat.count).toBe(6);
      expect(first[0]!.chat.matchedExisting).toBe(true);
      expect(Date.parse(first[0]!.at)).toBe(Date.parse(SOON(0)));
      await appendConciergeTurns(db, chatId, chatTurns(2, 50));
      await syncWebchatTurns(db, accountId, chatId, { raiseUnread: true });
      const later = chatsOf((await listContactTimelinePage(db, accountId, ana)).items);
      expect(later.map((e) => [e.id, e.at, e.chat.count])).toEqual([[first[0]!.id, first[0]!.at, 8]]);
    }));

  it("two chats are two rows, paged with neither a repeat nor a skip (mutation: drop withTimelinePage on the anchor read → page two repeats the newer chat, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await chatFor(db, accountId, ana, 2, 0);
      await chatFor(db, accountId, ana, 2, 100);
      const p1 = await listContactTimelinePage(db, accountId, ana, undefined, { limit: 1 });
      const p2 = await listContactTimelinePage(db, accountId, ana, p1.older!, { limit: 1 });
      expect([p1.items[0]!.kind, p2.items[0]!.kind]).toEqual(["chat", "chat"]);
      expect(Date.parse(p1.items[0]!.at)).toBe(Date.parse(SOON(100)));
      expect(Date.parse(p2.items[0]!.at)).toBe(Date.parse(SOON(0)));
    }));

  it("a household's page merges its members' chats, each naming its member (C6)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: luis } = await createContact(db, accountId, { firstName: "Luis" }, ACTOR);
      await chatFor(db, accountId, ana, 2, 0);
      await chatFor(db, accountId, luis, 2, 10);
      expect(chatsOf((await listTimelinePage(db, accountId, [ana, luis])).items).map((e) => e.contactId)).toEqual([luis, ana]);
    }));

  it("Last talked counts the chat, its newest turn, as 'chat'; a newer email wins (mutation: leave webchat out of the channel filter → null, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await chatFor(db, accountId, ana, 2, 0);
      const talked = (await contactFacts(db, accountId, ana)).lastTalked;
      expect(talked.ok && talked.value?.channel).toBe("chat");
      expect(talked.ok && Date.parse(talked.value!.at)).toBe(Date.parse(SOON(1)));
      expect((await groupFacts(db, accountId, [ana])).lastTalked).toMatchObject({ ok: true, value: { channel: "chat", contactId: ana } });
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      await seedMessage(db, accountId, conv, "email", SOON(30), "sent");
      const after = (await contactFacts(db, accountId, ana)).lastTalked;
      expect(after.ok && after.value?.channel).toBe("email");
    }));
});
```

(c) In `timeline-merge.test.ts:157-164`: `expect(page.failed).toEqual(["messages", "calls", "chats"]);` and `expect([...errors].sort()).toEqual(["calls", "chats", "messages"]);`, with a comment `// S-06 part 3: the chats source reads messages too, so it fails with it.`

- [ ] **Step 3: Write the failing web tests** (each in its file's own harness; read it first, Step 1):

  - `author-mark.test.ts`: a `chat` entry `{ kind: "chat", id: "m0", at: "2026-10-17T15:00:00Z", contactId: "k1", chat: { conversationId: "cv1", count: 12, matchedExisting: false } }` → `authorOf` is `{ kind: "customer", personId: null }`, its label `"Customer"` under `makeTr("en")` and `"Cliente"` under `makeTr("es")`, and `personIdsOf([chat])` is `[]` (mutation: `kind: "ai"` → FAILS; G20).
  - `timeline-rows.test.ts`: with `author.personaName: "Rosa"`: EN `verb` `"chatted with Rosa on your website"`, `detail` `"12 messages"`, `status` `null`, no `note`; count 1 → `"1 message"`; ES `"conversó con Rosa en su sitio web"`, `"12 mensajes"`, `"1 mensaje"`; `personaName: null` → `"chatted with Sofía on your website"`; `matchedExisting: true` → `note` `{ text: "Matched by the phone or email they typed; not confirmed.", lang: "en" }` and in ES `{ text: "Lo relacionamos por el teléfono o el correo que escribió; no está confirmado.", lang: "es" }`; a non-chat row has no `note` key at all (`expect("note" in row).toBe(false)`); `timelineFailedText(["chats"], makeTr("en"))` → `"Couldn't load website chats."` and ES `"No se pudo cargar: chats del sitio web."`; under `makeTr("en", true)` the verb is NOT the plain English string (the pseudo wrap reaches the row) (mutations: hard-code "Sofía" → the Rosa case FAILS; `note` on every chat → the new-customer case FAILS; drop `chats` from SOURCE_KEY → typecheck FAILS).
  - `recent-rows.test.ts`: the matched chat row's `excerpt` is `{ text: <the unconfirmed line>, lang: "en", done: false }`; an unmatched one's is `null`; `kind` is `"chat"` (mutation: excerpt null always → FAILS).
  - `activity-timeline.rows.test.ts` and `group-timeline.test.ts`: the chat row renders `data-timeline-item="chat"`, the verb and `12 messages` through `renderedText`, an `<a … data-timeline-open-chat …>` whose `href` is `/dashboard/accounts/<accountId>/conversations?c=cv1` and text "Open chat" ("Ver chat" in ES) with `buttonVariants` ghost classes and `min-h-11`, and, when matched, `<p lang="en" data-webchat-unconfirmed="">` with the line; none when not matched (mutations: link to the record → FAILS; drop `lang` → FAILS).

- [ ] **Step 4: Run to see them fail.** On the kit: `webchat-rls.test.ts` (`SUPABASE_DB_URL=postgresql://postgres@localhost:55666/post`) PASSES already (0068 is in; this test pins the predicate, and its probe is Step 7 (g)); `record.test.ts` and `timeline-merge.test.ts` behind PostgREST FAIL (no `chats`). Web: the five files FAIL (typecheck errors or missing rows). Paste each summary.

- [ ] **Step 5: Write the db code** in `record.ts`:
  - `:12`: `import { forContacts, instantKey, withTimelinePage, TIMELINE_PAGE_SIZE, type TimelineCursor, type TimelinePageOpts } from "./timeline-cursor";` and `import { WEBCHAT_MAX_ROWS_PER_CHAT } from "./webchat-plan";`.
  - `:33`: `export type LastTalkedChannel = "text" | "email" | "call" | "chat";` and below it:

```ts
/** The conversation rows that count as talking (spec §7, S-06 part 3: a website chat counts, Sofía's turns
 *  included). `form` and `voice` stay out: they are the inbox's copies of a submission and a call (C4). */
const TALKED_CHANNELS = ["email", "sms", "webchat"] as const;
type TalkedChannel = (typeof TALKED_CHANNELS)[number];
const talkedChannel = (c: TalkedChannel): LastTalkedChannel => (c === "sms" ? "text" : c === "webchat" ? "chat" : "email");
```

  - In `newestConversationMessage` and `newestSetMessage`: `.in("channel", ["email", "sms"])` → `.in("channel", [...TALKED_CHANNELS])`; the row types' `channel: "email" | "sms"` → `channel: TalkedChannel`; `row.channel === "sms" ? "text" : "email"` → `talkedChannel(row.channel)`; their doc comments say "email, text or website chat".
  - `:265-266`: add `"chats"` to `TimelineSource` and LAST to `TIMELINE_SOURCES`.
  - After `TimelineMessage` (`:282-288`): `/** S-06 part 3 (spec §7): one website chat on the customer's thread. */ export type TimelineChat = { conversationId: string; count: number; matchedExisting: boolean };` and in the union, after the `message` variant: `/** S-06 part 3 (spec §7, G22): one row per website chat, at its index-0 row (its START), so later turns never move it. */ | { kind: "chat"; id: string; at: string; contactId: string; chat: TimelineChat }`.
  - Above `listTimelinePage`:

```ts
/** How many chats one count read covers: 20 × 48 rows stays under PostgREST's 1000-row cap. */
const CHAT_COUNT_CHUNK = 20;

/**
 * S-06 part 3 (spec §7, G22): the `chats` source. The anchor read is each chat's index-0 row (the first
 * row a sync writes, webchat.ts), paged on created_at like every source; then, for the chats on this
 * page only, a count read of every row of each chat on these conversations, both sides. On the caller's
 * client: RLS and 0068's Technician fence decide. THROWS on a read error (listTimelinePage's settle).
 */
async function listContactChats(
  db: SupabaseClient, accountId: string, who: string | readonly string[], page: TimelinePageOpts,
): Promise<TimelineEntry[]> {
  const { data: convos, error } = await forContacts(
    db.from("conversations").select("id, contact_id").eq("account_id", accountId), "contact_id", who);
  if (error) throw new Error(`listContactChats failed: ${error.message}`);
  const list = (convos ?? []) as { id: string; contact_id: string }[];
  if (list.length === 0) return [];
  const owner = new Map(list.map((c) => [c.id, c.contact_id]));
  const ids = list.map((c) => c.id);
  const { data, error: aErr } = await withTimelinePage(
    db.from("messages").select("id, conversation_id, created_at, meta").eq("account_id", accountId)
      .in("conversation_id", ids).eq("channel", "webchat").eq("meta->webchat->>index", "0"),
    "created_at", page);
  if (aErr) throw new Error(`listContactChats anchors failed: ${aErr.message}`);
  type Anchor = { id: string; conversation_id: string; created_at: string; meta: { webchat?: { chat_id?: unknown; matched_existing?: unknown } } | null };
  const anchors = (data ?? []) as Anchor[];
  const chatOf = (a: Anchor) => (typeof a.meta?.webchat?.chat_id === "string" ? a.meta.webchat.chat_id : null);
  const chatIds = [...new Set(anchors.flatMap((a) => { const c = chatOf(a); return c ? [c] : []; }))];
  const counts = new Map<string, number>();
  for (let i = 0; i < chatIds.length; i += CHAT_COUNT_CHUNK) {
    const chunk = chatIds.slice(i, i + CHAT_COUNT_CHUNK);
    const { data: rows, error: cErr } = await db.from("messages").select("chat_id:meta->webchat->>chat_id")
      .eq("account_id", accountId).in("conversation_id", ids).eq("channel", "webchat")
      .in("meta->webchat->>chat_id", chunk).limit(chunk.length * WEBCHAT_MAX_ROWS_PER_CHAT);
    if (cErr) throw new Error(`listContactChats counts failed: ${cErr.message}`);
    for (const r of (rows ?? []) as { chat_id: string | null }[]) if (r.chat_id) counts.set(r.chat_id, (counts.get(r.chat_id) ?? 0) + 1);
  }
  return anchors.map((a): TimelineEntry => {
    const chatId = chatOf(a);
    return {
      kind: "chat", id: a.id, at: a.created_at, contactId: owner.get(a.conversation_id) ?? "",
      chat: { conversationId: a.conversation_id, count: chatId ? counts.get(chatId) ?? 1 : 1, matchedExisting: a.meta?.webchat?.matched_existing === true },
    };
  });
}
```

  - In `listTimelinePage`'s `Promise.all`, after the `documents` settle: `// S-06 part 3 (spec §7): one row per website chat.` `settle("chats", () => listContactChats(db, accountId, who, page)),`; its doc comment's "Eight sources" → "Nine sources (S-06 part 3 added chats)".
  - `index.ts`: add `type TimelineChat,` to the record export list.

- [ ] **Step 6: Write the web code.**
  - `author-mark.ts`, in `authorOf` after the `call` case: `// S-06 part 3 (G20): the chat is the customer reaching the business; the words already name Sofía.` `case "chat": return { kind: "customer", personId: null };`
  - `timeline-rows.ts`: `import type { Locale } from "@/lib/i18n/locale";`; `SOURCE_KEY` gains `chats: "timeline.what.chats",`; `TimelineRow` gains `/** S-06 part 3 (§5a, G18): a staff-language line under the row, on a chat matched to an existing customer only. */ note?: { text: string; lang: Locale };`; `phrase` gains a fifth parameter `persona: string` and the case `case "chat": return { verb: tr.text("timeline.webchat", { name: persona }), status: null, detail: tr.count("timeline.webchatCount", entry.chat.count) };`; in `timelineRows`, compute `const persona = ctx.author.personaName?.trim() || "Sofía";` once, pass it to `phrase`, and build the row as today plus `...(entry.kind === "chat" && entry.chat.matchedExisting ? { note: { text: ctx.tr.text("conversations.webchat.unconfirmed"), lang: ctx.tr.locale } } : {})`.
  - `recent-rows.ts`: in `excerptOf`, `case "chat": return null;`; in `recentRowsView`, `excerpt: r.entry.kind === "chat" ? (r.note ? { text: r.note.text, lang: r.note.lang, done: false } : null) : excerptOf(r.entry, customerLang),`.
  - `activity-timeline.tsx`: add `MessagesSquare` to the lucide import; in `Row`'s switch, after `case "call"`:

```tsx
    // S-06 part 3 (spec §7; G20, G25): one row per website chat, the customer's mark; "Open chat" opens its
    // thread in the inbox, the "Open call" pattern. A chat matched to an existing customer carries §5a's line.
    case "chat":
      return (
        <TimelineItem {...head} icon={MessagesSquare} action={
          <Link href={`/dashboard/accounts/${accountId}/conversations?c=${e.chat.conversationId}`} data-timeline-open-chat
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tr.text("timeline.openChat")}</Link>
        }>
          {row.note ? <p lang={row.note.lang} data-webchat-unconfirmed="" className="text-xs text-muted-foreground">{row.note.text}</p> : null}
        </TimelineItem>
      );
```

  - `group-timeline.tsx`: the same case, in its own `Row` (it already has `accountId`, `tr`, `Link`, `buttonVariants`, `cn` in scope for the call row; add `MessagesSquare`).
  - `contact-drawer.tsx`: `ROW_ICON` gains `chat: MessagesSquare,` (and the import).

- [ ] **Step 7: Run to pass.** Kit: `webchat-rls.test.ts` on `post`; behind PostgREST `record.test.ts`, `timeline-merge.test.ts`, `timeline-sources.test.ts` (if present), `webchat.test.ts` → PASS (exit codes captured; summaries pasted). Web: the five test files, `src/lib/record` (the folder), `src/lib/contacts/drawer-summary.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/page.test.ts"`, `"src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts"` → PASS. `pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck` → 0; eslint on every touched file.
- [ ] **Step 8: Probes, each by name, edited back:** (a) drop `.eq("meta->webchat->>index", "0")` → the one-row case FAILS (six rows); (b) count with `.eq("direction", "inbound")` added → the count FAILS (3); (c) `withTimelinePage` replaced by `.order("created_at", { ascending: false }).limit(page.limit)` → the paging case FAILS; (d) `TALKED_CHANNELS` without `"webchat"` → the Last talked case FAILS; (e) `authorOf` chat → `ai` → the author-mark case FAILS; (f) the note on every chat row → the timeline-rows new-customer case FAILS; (g) on the kit, `drop policy messages_technician_scope on messages` → the RLS case FAILS (the tech reads two; rebuild the kit after); (h) the Open chat `href` pointing at the record → the activity-timeline case FAILS. Paste each failing assertion line.
- [ ] **Step 9: Commit** every path in "Files" (each written out), message "record: one timeline row per website chat with the customer's mark, and the chat counts for Last talked (S-06 part 3)".

---

## Task 8: The inbox: the web chat bubble, the unconfirmed line, the composer; the demo (bis-frontend)

**Review:** opus (the request-client proof before the ledger reads; the client/server boundary). Plus a bis-design-reviewer pass if a running build is provided. **After:** Tasks 1, 3, 5, 6.

**Files**
- Create: `…/conv/webchat-meta.ts` (+ `webchat-meta.test.ts`)
- Modify: `…/conv/message-thread.tsx` (+ `message-thread.test.ts`)
- Modify: `…/conv/page.tsx`; Create `…/conv/page.webchat.test.ts`; Modify ONE line of `…/conv/page.sender-visibility.test.ts` (`:115`)
- Remove: `git rm` `…/conv/email-composer.tsx` and `…/conv/email-composer.test.ts`
- Create: `…/sg/webchat-demo.tsx` (+ `webchat-demo.test.ts`); Modify: `…/sg/page.tsx` (one Section)

**Interfaces**
- Consumes: `listMessages`' author pair (Task 3); `messageChannelLabel(channel, locale)` (Task 3); `loadInboxComposer` (Task 5); `MessageComposer`'s `modes`/`initialMode` (Task 6); `authorLabel` (`lib/record/author-mark.ts:72`), `makeTr` (`lib/record/copy.ts:15`); `getVoiceProfile` (`@bis/db`, `voice.ts:159`); `softSmsGate` (`lib/record/loaders.ts:166`); `smsRecipientState`, `emailRecipientState` (`lib/consent/recipient-state.ts`); Task 1's keys.
- Produces: `type WebchatMeta = { chatId: string; index: number; locale: "en" | "es"; matchedExisting: boolean }`, `readWebchatMeta(meta): WebchatMeta | null`, `firstWebchatRows(messages): Set<string>`; `MessageThread`'s new optional prop `personaName?: string | null`; DOM hooks `data-webchat-row="<index>"` on a chat bubble and `data-webchat-unconfirmed` on the line (Task 11 locates by them).

- [ ] **Step 1: Read before writing.** `…/conv/page.tsx` whole; `…/conv/message-thread.tsx` whole; `…/conv/inbound-meta.ts` and `inbound-meta.test.ts:1-40` (the import-site guard pattern); `message-thread.test.ts:1-60` and `:248-293`; `page.forwarders.test.ts` whole (the page harness this task's new page test copies); `page.sender-visibility.test.ts:36-116`; `…/record/page.tsx:84-121` (the record's composer reads, in order); `…/sg/forwarding-demo.tsx` + test and `…/sg/page.tsx:268-290`.

- [ ] **Step 2: Write the failing tests.**

(a) `…/conv/webchat-meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readWebchatMeta, firstWebchatRows } from "./webchat-meta";

const CHAT = "11111111-1111-4111-8111-111111111111";
const meta = (index: number, extra: Record<string, unknown> = {}) => ({ webchat: { chat_id: CHAT, index, locale: "es", submission_id: "s1", matched_existing: true, ...extra } });

describe("readWebchatMeta (S-06 part 3, spec §2, §5a)", () => {
  it("reads what the sync wrote; any other language reads as English (mutation: pass the locale through → 'fr', FAILS)", () => {
    expect(readWebchatMeta(meta(3))).toEqual({ chatId: CHAT, index: 3, locale: "es", matchedExisting: true });
    expect(readWebchatMeta(meta(0, { locale: "fr", matched_existing: "yes" }))).toEqual({ chatId: CHAT, index: 0, locale: "en", matchedExisting: false });
  });
  it("anything else is not a chat row's meta (mutation: accept a string index → FAILS)", () => {
    for (const bad of [null, {}, { webchat: null }, { webchat: { chat_id: CHAT, index: "0" } }, { webchat: { chat_id: "", index: 0 } }, { webchat: { chat_id: CHAT, index: -1 } }, { webchat: { chat_id: CHAT, index: 1.5 } }]) {
      expect(readWebchatMeta(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("firstWebchatRows: where each chat's one line sits (spec §5a)", () => {
  it("the row with each chat's LOWEST index on this thread, whatever the order it arrives in (mutation: first in array order → m3, FAILS)", () => {
    const rows = [
      { id: "m3", channel: "webchat", meta: meta(3) }, { id: "m1", channel: "webchat", meta: meta(1) },
      { id: "x0", channel: "webchat", meta: { webchat: { chat_id: "22222222-2222-4222-8222-222222222222", index: 0 } } },
      { id: "e1", channel: "email", meta: meta(0) },
    ];
    expect([...firstWebchatRows(rows)].sort()).toEqual(["m1", "x0"]);
  });
});

describe("import sites (the client/server boundary, part 1 Task 11b)", () => {
  it("the thread, a server component, imports the reader from this plain module, and this module has no directive (mutation: move readWebchatMeta into a 'use client' file → FAILS)", () => {
    const thread = readFileSync(path.join(__dirname, "message-thread.tsx"), "utf8");
    expect(thread).toMatch(/import \{ readWebchatMeta, firstWebchatRows \} from "\.\/webchat-meta";/);
    expect(readFileSync(path.join(__dirname, "webchat-meta.ts"), "utf8")).not.toMatch(/^["']use (client|server)["']/m);
  });
});
```

(b) In `message-thread.test.ts`, a new describe:

```ts
describe("web chat bubbles (S-06 part 3, spec §5, §5a; G26)", () => {
  const at = "2026-10-17T15:00:00Z";
  const CHAT_A = "11111111-1111-4111-8111-111111111111";
  const CHAT_B = "22222222-2222-4222-8222-222222222222";
  const chat = (id: string, chatId: string, index: number, direction: "inbound" | "outbound", body: string, matched: boolean) => ({
    id, conversation_id: "c1", channel: "webchat", direction, status: "delivered", provider_message_id: `webchat:${chatId}:${index}`,
    subject: null, body, error: null, created_at: at, author_kind: direction === "inbound" ? "customer" : "ai", author_id: null,
    meta: { webchat: { chat_id: chatId, index, locale: "es", submission_id: "s1", matched_existing: matched } },
  });
  const text = { id: "t1", conversation_id: "c1", channel: "sms", direction: "outbound", status: "delivered", provider_message_id: null,
    subject: null, body: "Le escribimos", error: null, created_at: at, author_kind: "person", author_id: "u1", meta: {} };
  const THREAD = [chat("a0", CHAT_A, 0, "inbound", "¿Hacen bancas?", true), chat("a1", CHAT_A, 1, "outbound", "Sí, con gusto.", true),
    chat("b0", CHAT_B, 0, "inbound", "Hola otra vez", false), text];
  const render = (locale: "en" | "es", personaName: string | null = "Rosa") => renderToStaticMarkup(createElement(MessageThread, {
    messages: THREAD as never, contactName: "Ana", composer: null, timezone: "UTC", contactLanguage: "en", ...THREAD_PROPS, locale, personaName,
  }));
  const footers = (html: string) => [...html.matchAll(/<p lang="(en|es)" class="mt-1[^"]*">([\s\S]*?)<\/p>/g)].map((x) => [x[1], renderedText(x[2]!).replace(/^.*? · /, "")]);

  it("each footer names Web chat and the mark, never a status word; a text keeps its status (mutation: show MESSAGE_STATUS for chat rows → 'Delivered', FAILS; drop the mark → FAILS)", () => {
    expect(footers(render("en"))).toEqual([["en", "Web chat · Customer"], ["en", "Web chat · Rosa · AI"], ["en", "Web chat · Customer"], ["en", "Text · Delivered"]]);
  });

  it("in Spanish for a Spanish-speaking teammate, every footer, the text's too (G26; mutation: messageChannelLabel without the locale → 'Web chat', FAILS)", () => {
    expect(footers(render("es"))).toEqual([["es", "Chat web · Cliente"], ["es", "Chat web · Rosa · IA"], ["es", "Chat web · Cliente"], ["es", "Texto · Entregado"]]);
  });

  it("a chat bubble's words carry the language they chatted in, both sides, whatever the contact's (mutation: use contactLanguage → lang=\"en\" on the visitor's line, FAILS)", () => {
    const html = render("en");
    expect(html).toMatch(/<p lang="es"[^>]*>¿Hacen bancas\?<\/p>/);
    expect(html).toMatch(/<p lang="es"[^>]*>Sí, con gusto\.<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Le escribimos<\/p>/);
  });

  it("no persona name: Sofía (author-mark.ts's own fallback; mutation: print an empty name → ' · AI', FAILS)", () => {
    expect(footers(render("en", null))[1]).toEqual(["en", "Web chat · Sofía · AI"]);
  });

  it("ONE unconfirmed line per matched chat, directly above its first row, in the teammate's language; none for a chat that made the customer (spec §5a; mutation: render it on every row → three, FAILS; drop lang → FAILS)", () => {
    const en = render("en");
    expect(en.match(/data-webchat-unconfirmed/g)).toHaveLength(1);
    expect(en).toMatch(/<p lang="en" data-webchat-unconfirmed=""[^>]*>Matched by the phone or email they typed; not confirmed\.<\/p><div[^>]*data-webchat-row="0"/);
    expect(render("es")).toMatch(/<p lang="es" data-webchat-unconfirmed=""[^>]*>Lo relacionamos por el teléfono o el correo que escribió; no está confirmado\.<\/p>/);
  });

  it("the footer wraps rather than overflows a narrow bubble (DoD: long Spanish and pseudo copy; mutation: whitespace-nowrap → FAILS)", () => {
    for (const [, cls] of render("es").matchAll(/<p lang="es" class="(mt-1[^"]*)">/g)) {
      expect(cls).toContain("break-words");
      expect(cls).not.toMatch(/nowrap|truncate/);
    }
  });
});
```

(The existing `footers()`-free cases stay as they are: their English output is unchanged by G26.)

(c) `…/conv/page.webchat.test.ts` (copy `page.forwarders.test.ts`'s harness, `:1-60`, then):

```ts
// … harness as page.forwarders.test.ts, with these differences:
const gate = vi.hoisted(() => ({ value: { ok: true, from: "+19565550000", ownedNumbers: ["+19565550000"] } as unknown }));
const sms = vi.hoisted(() => ({ value: { kind: "ok" } as unknown }));
vi.mock("@/lib/record/loaders", () => ({ softSmsGate: async () => gate.value }));
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: async () => sms.value, emailRecipientState: async () => ({ kind: "ok" }) }));
vi.mock("./actions", () => ({ sendEmailAction: vi.fn(), sendSmsAction: vi.fn(), markConversationReadAction: vi.fn() }));
const getVoiceProfile = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ persona_name: "Rosa" }));
// in the @bis/db factory: getVoiceProfile: (...a: unknown[]) => getVoiceProfile(...a),
//   getContact: async () => ({ id: "ana", phone: "(956) 555-0100", email: "ana@example.com", phone_country_unconfirmed: false }),
const row = (id: string, channel: string, direction: string, author_kind: string, meta: Record<string, unknown> = {}) => ({
  id, conversation_id: "convo1", channel, direction, status: "delivered", provider_message_id: null, subject: null,
  body: `body ${id}`, error: null, created_at: "2026-10-17T15:00:00Z", author_kind, author_id: null, meta,
});
const chatRow = (id: string, index: number, direction: string) => row(id, "webchat", direction, direction === "inbound" ? "customer" : "ai",
  { webchat: { chat_id: "11111111-1111-4111-8111-111111111111", index, locale: "en", submission_id: "s1", matched_existing: false } });
const pressed = (h: string) => [...h.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map((x) => x[1]);

describe("ConversationsPage with a web chat thread (S-06 part 3, spec §5, §6)", () => {
  afterEach(() => { listMessages.mockReset().mockResolvedValue([]); getVoiceProfile.mockClear(); sms.value = { kind: "ok" }; });

  it("a thread holding a chat reads the persona ONCE, on the request client, and Sofía's bubble names her; a thread with none never reads it (mutation: read always → called for the text thread, FAILS)", async () => {
    listMessages.mockResolvedValue([chatRow("a0", 0, "inbound"), chatRow("a1", 1, "outbound")]);
    expect(renderedText(await html())).toContain("Web chat · Rosa · AI");
    expect(getVoiceProfile).toHaveBeenCalledTimes(1);
    expect(getVoiceProfile.mock.calls[0]![0]).toBe(REQUEST);
    getVoiceProfile.mockClear();
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    await html();
    expect(getVoiceProfile).not.toHaveBeenCalled();
  });

  it("a failed persona read costs only the name (mutation: let it throw → the page rejects, FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getVoiceProfile.mockRejectedValueOnce(new Error("down"));
    listMessages.mockResolvedValue([chatRow("a1", 1, "outbound")]);
    expect(renderedText(await html())).toContain("Web chat · Sofía · AI");
  });

  it("the composer is Text | Email and opens on the server's channel: after their text, Text; after their email, Email; after a chat, Text while cleared (mutation: no initialMode → Text always, FAILS on the email case)", async () => {
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Text"]);
    listMessages.mockResolvedValue([row("e1", "email", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Email"]);
    listMessages.mockResolvedValue([row("e1", "email", "inbound", "customer"), chatRow("a0", 0, "inbound")]);
    expect(pressed(await html())).toEqual(["Text"]);
  });

  it("their texts stopped: it never opens on Text, even after their last text (G10; mutation: ignore readiness → Text, FAILS)", async () => {
    sms.value = { kind: "stopped", since: "2026-10-01T00:00:00Z" };
    listMessages.mockResolvedValue([row("t1", "sms", "inbound", "customer")]);
    expect(pressed(await html())).toEqual(["Email"]);
  });

  it("import sites: the page imports only the COMPONENT from the 'use client' composer, the facts from the plain module, and keys the composer by the thread (mutation: import smsFormBlock into page.tsx → FAILS; drop key={active.id} → the next thread inherits this one's tab, FAILS)", () => {
    const src = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(src).toContain('import { MessageComposer } from "../contacts/[contactId]/message-composer";');
    expect(src).toContain('import { loadInboxComposer } from "./composer-facts";');
    expect(src).toMatch(/<MessageComposer\s+key=\{active\.id\}/);
    expect(src).not.toMatch(/EmailComposer|email-composer/);
  });
});
```

(Add `import { readFileSync } from "node:fs"; import path from "node:path";` to the file. The harness's `REQUEST.from` keeps throwing on any table but `accounts`; `softSmsGate` is mocked, so nothing here reads `phone_numbers`. The mocked `getContact` answers the thread's own customer, what RLS answers an Owner.)

(d) `page.sender-visibility.test.ts:115` → `expect(getContactCalls).toEqual([{ accountId: "acct1", id: "luis" }, { accountId: "acct1", id: "ana" }]);` with the comment `// "ana": the composer's readiness read of the thread's own customer (S-06 part 3, spec §6), after the consent block.`

(e) `…/sg/webchat-demo.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("../accounts/[accountId]/conversations/inbound-actions", () => ({ undoReplyStopAction: vi.fn(), stopEmailsFromReplyAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const { WebchatDemo } = await import("./webchat-demo");

describe("styleguide: the web chat bubble and the chat row (DoD: /styleguide gains the new variant)", () => {
  const html = renderToStaticMarkup(createElement(WebchatDemo));
  it("the thread in English and in Spanish, with the unconfirmed line once each (mutation: drop the Spanish cell → FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-webchat"');
    expect(html.match(/data-webchat-unconfirmed/g)).toHaveLength(2);
    expect(renderedText(html)).toContain("Web chat · Sofía · AI");
    expect(renderedText(html)).toContain("Chat web · Sofía · IA");
  });
  it("the record's chat row: the customer's mark, the words, the count and Open chat (mutation: drop the row → FAILS)", () => {
    expect(html).toContain('data-timeline-item="chat"');
    expect(renderedText(html)).toContain("chatted with Sofía on your website");
    expect(renderedText(html)).toContain("12 messages");
    expect(renderedText(html)).toContain("Open chat");
  });
});
```

- [ ] **Step 3: Run to see them fail.** `pnpm --filter web exec vitest run` on the four new or changed test files (each path quoted) → FAIL. Paste the summary.

- [ ] **Step 4: Write `…/conv/webchat-meta.ts`** (NO directive):

```ts
/**
 * S-06 part 3 (spec §2, §5, §5a): the thread bubble's web chat meta reader. No directive: the thread, a
 * SERVER component, calls it (the inbound-meta.ts lesson, part 1 Task 11b). What the sync wrote
 * (webchat-plan.ts's WebchatRowMeta), read defensively: anything else is not a chat row's meta.
 */
export type WebchatMeta = { chatId: string; index: number; locale: "en" | "es"; matchedExisting: boolean };

export function readWebchatMeta(meta: unknown): WebchatMeta | null {
  const w = (meta as { webchat?: unknown } | null | undefined)?.webchat;
  if (!w || typeof w !== "object") return null;
  const { chat_id, index, locale, matched_existing } = w as Record<string, unknown>;
  if (typeof chat_id !== "string" || !chat_id || typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  return { chatId: chat_id, index, locale: locale === "es" ? "es" : "en", matchedExisting: matched_existing === true };
}

/** §5a: the id of each chat's FIRST row on this thread (its lowest index), where its one line sits. */
export function firstWebchatRows(messages: readonly { id: string; channel: string; meta?: unknown }[]): Set<string> {
  const first = new Map<string, { id: string; index: number }>();
  for (const msg of messages) {
    if (msg.channel !== "webchat") continue;
    const w = readWebchatMeta(msg.meta);
    if (!w) continue;
    const seen = first.get(w.chatId);
    if (!seen || w.index < seen.index) first.set(w.chatId, { id: msg.id, index: w.index });
  }
  return new Set([...first.values()].map((x) => x.id));
}
```

- [ ] **Step 5: Change `message-thread.tsx`.**
  - Imports: `import { Fragment } from "react";`; `MESSAGE_STATUS_LABEL` leaves the `@/lib/labels` import (only `messageChannelLabel` stays); `import { m, type MessageKey } from "@/lib/messages";`; `import { authorLabel } from "@/lib/record/author-mark";`; `import { makeTr } from "@/lib/record/copy";`; `import { readWebchatMeta, firstWebchatRows } from "./webchat-meta";` (exactly this line; the import-site test reads it).
  - Above the component:

```ts
/** G26: the status word in the staff member's language (conversations.status.* carry .es); a value outside
 *  the six prints as itself, as MESSAGE_STATUS_LABEL's `?? message.status` did. */
const STATUS_KEY: Readonly<Record<string, MessageKey>> = {
  queued: "conversations.status.queued", sent: "conversations.status.sent", delivered: "conversations.status.delivered",
  opened: "conversations.status.opened", bounced: "conversations.status.bounced", failed: "conversations.status.failed",
};
```

  - Props: `personaName,` in the destructure; in the type `/** S-06 part 3 (spec §5): the receptionist's name on her web chat bubbles, read by page.tsx only when the thread holds one; null or absent reads "Sofía" (authorLabel's own fallback). */ personaName?: string | null;`
  - At the top of the body: `const tr = makeTr(locale); const firstChatRows = firstWebchatRows(messages); const statusWord = (s: string) => (Object.hasOwn(STATUS_KEY, s) ? t(m, STATUS_KEY[s]!, locale) : s);`
  - The map becomes:

```tsx
        {messages.map((message) => {
          // S-06 part 3 (spec §5): a lead's website chat turn. Its words carry the language they CHATTED in
          // (one message, one language); its footer names the channel and the mark (one mark set with the
          // record, DESIGN.md Provenance) and never a status word: no one on the team sent it.
          const chat = message.channel === "webchat" ? readWebchatMeta(message.meta) : null;
          const typedLang = chat ? chat.locale
            : message.direction === "inbound" && message.channel !== "voice" ? (contactLanguage ?? "") : undefined;
          const mark = chat
            ? authorLabel(message.author_kind === "ai" ? "ai" : "customer", null, { viewerId: null, names: {}, personaName: personaName ?? null, tr })
            : null;
          return (
            <Fragment key={message.id}>
              {/* §5a: ONE line per chat matched to an existing customer, above its first row, in the staff
                  member's language. A fact about the match, not a status: no dot. */}
              {chat?.matchedExisting && firstChatRows.has(message.id) ? (
                <p lang={locale} data-webchat-unconfirmed="" className="text-xs text-muted-foreground">
                  {t(m, "conversations.webchat.unconfirmed", locale)}
                </p>
              ) : null}
              <div
                data-webchat-row={chat ? String(chat.index) : undefined}
                className={cn(
                  "max-w-[75%] rounded-[var(--radius-ctl)] px-3 py-2",
                  message.direction === "outbound" ? "ml-auto bg-[var(--accent-dim)]" : "bg-[var(--surface-2)]",
                )}
              >
                {message.subject ? <p lang={typedLang} className="text-sm font-medium text-card-foreground">{message.subject}</p> : null}
                <p lang={typedLang} className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
                {/* G26: the footer in the STAFF member's language, every bubble's. */}
                <p lang={locale} className="mt-1 break-words text-xs text-muted-foreground">
                  {formatDateTimeInZone(message.created_at, timezone, locale)}
                  {message.channel !== "email" ? <> · {messageChannelLabel(message.channel, locale)}</> : null}
                  {mark ? <> · {mark}</> : message.direction === "outbound" ? <> · {statusWord(message.status)}</> : null}
                </p>
                {/* … the D-017 failure reason, now only when !chat, and the inbound-email IIFE, both unchanged … */}
              </div>
            </Fragment>
          );
        })}
```

  (Keep every existing comment that still applies — the ladder-step comment moves onto the `<div>`; the D-017 and Task 11 blocks keep theirs.)

- [ ] **Step 6: Change `page.tsx`.**
  - Imports: `getVoiceProfile` joins the `@bis/db` import; delete `import { EmailComposer } from "./email-composer";`; `import { sendEmailAction, sendSmsAction, markConversationReadAction } from "./actions";`; `import { MessageComposer } from "../contacts/[contactId]/message-composer";`; `import { loadInboxComposer } from "./composer-facts";`; `import { softSmsGate } from "@/lib/record/loaders";`; `import { smsRecipientState, emailRecipientState } from "@/lib/consent/recipient-state";`.
  - Module level, after `PAGE_SIZE`: `/** S-06 part 3 (spec §6, G9): the inbox replies by text or email; no Note here. */ const INBOX_MODES = ["sms", "email"] as const;`
  - After the consent block (after `:310`), before `return`:

```ts
  // S-06 part 3 (spec §5): the receptionist's name on Sofía's bubbles, read only when the thread holds a
  // chat, on the request client; a failed read costs only the name ("Sofía").
  const personaName = messages.some((x) => x.channel === "webchat")
    ? await getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      console.error(`conversations: account ${accountId} persona read failed: ${loggableError(e)}`);
      return null;
    })
    : null;
  // S-06 part 3 (spec §6): the composer's facts and its first channel, decided HERE. getContact on the
  // REQUEST client proves the customer is the viewer's (0068); only then are the two recipient states read
  // on the ledger client — the record page's order (contacts/[contactId]/page.tsx:84-121).
  const composerFacts = active
    ? await loadInboxComposer({
      contact: () => getContact(db, accountId, active.contactId),
      gate: () => softSmsGate(db, accountId),
      smsState: (c) => smsRecipientState(ledgerDb(), accountId, c),
      emailState: (c) => emailRecipientState(ledgerDb(), accountId, c),
      log: (line) => console.error(`conversations: account ${accountId} composer: ${line}`),
    }, { messages, zone: zone.zone, locale })
    : null;
```

  - `MessageThread` gains `personaName={personaName}`; its `composer` prop becomes:

```tsx
              composer={composerFacts ? (
                <MessageComposer
                  key={active.id}
                  contactId={active.contactId}
                  modes={INBOX_MODES}
                  initialMode={composerFacts.initialMode}
                  contactHasEmail={composerFacts.contactHasEmail}
                  contactHasPhone={composerFacts.contactHasPhone}
                  smsGate={composerFacts.smsGate}
                  smsBlockedLine={composerFacts.smsBlockedLine}
                  emailNoticeLine={composerFacts.emailNoticeLine}
                  emailAction={sendEmailAction.bind(null, accountId)}
                  smsAction={sendSmsAction.bind(null, accountId)}
                />
              ) : null}
```

  (`key={active.id}`: a different thread is a different composer; its tab is that thread's server answer, never the last thread's.)
  - `git rm "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/email-composer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/email-composer.test.ts"` (spec G9: `EmailComposer` retires; `grep -rn "email-composer\|EmailComposer" apps/web` → only the record composer test's comment, which names it as history).

- [ ] **Step 7: The demo.** `…/sg/webchat-demo.tsx` (`"use client"`): renders `MessageThread` (composer `null`, `personaName: null`, `locale` `"en"` then `"es"` inside a `<div lang>`), on a four-row matched chat (index 0-3, both sides) plus one outbound text, and below it ONE `TimelineItem` chat row built from `t(m, …)` strings (`kind="chat"`, `icon={MessagesSquare}`, `mark={{ kind: "customer", label: t(m, "provenance.customer", "en") }}`, `verb={t(m, "timeline.webchat", "en", { name: "Sofía" })}`, `detail={t(m, "timeline.webchatCount", "en", { count: 12 })}`, an "Open chat" ghost `Link` to `#` in `action`); root `data-testid="styleguide-webchat"`; no literal copy with a letter in JSX (the ratchet); every fixture id made up. In `…/sg/page.tsx`, after the Forwarding Section: `{/* S-06 part 3: a lead's website chat on the thread (both marks, both languages, the unconfirmed line) and its one record row. */}` `<Section title={t(m, "conversations.channel.webchat", "en")} file="accounts/[accountId]/conversations/message-thread.tsx"><WebchatDemo /></Section>` and its import.

- [ ] **Step 8: Run to pass** every test this task touched, plus `…/conv/page.test.ts`, `page.zone.test.ts`, `page.pagination.test.ts`, `page.forwarders.test.ts`, `page.sender-visibility.test.ts`, `inbound-meta.test.ts`, `inbound-notice.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `src/components/ui/material.test.ts`, `…/sg/` tests by path → PASS. `pnpm --filter web typecheck` → 0; eslint on every touched file. Paste the summary lines.
- [ ] **Step 9: Probes, each by name, edited back:** (a) the footer's `statusWord` shown for chat rows → the footer case FAILS; (b) `messageChannelLabel(message.channel)` without `locale` → the Spanish case FAILS; (c) `typedLang` for chat rows from `contactLanguage` → the language case FAILS; (d) the unconfirmed line rendered without `firstChatRows.has(...)` → the once-per-chat case FAILS; (e) `personaName` read for every thread → the page's persona case FAILS; (f) `initialMode` not passed → the page's email case FAILS; (g) `key={active.id}` removed → the import-site case FAILS; (h) `import { MessageComposer, smsFormBlock }` in `page.tsx` → the import-site case FAILS. Paste each failing line.
- [ ] **Step 10: Commit** every path in "Files" (each written out, the two removed ones included), message "inbox: a lead's website chat on the thread with both marks and the unconfirmed line; Text | Email opens on the customer's last reply (S-06 part 3)".

---

## Task 9: The messages readers guard (bis-comms)

**Review:** sonnet. **After:** Tasks 3, 7 (their new readers are in the table).

**Files**
- Create: `apps/web/src/lib/messages-readers.test.ts`

- [ ] **Step 1: Read.** `grep -rn 'from("messages")' apps/web/src packages/db/src --include=*.ts --include=*.tsx | grep -v "\.test\.\|/test/"` and read each hit's filter (5 lines after). If the counts below differ from what the grep shows after Tasks 3 and 7, STOP and report: the table is the spec's readers table made executable, and a difference is a reader nobody has reasoned about.

- [ ] **Step 2: Write the test** (it passes on the branch as soon as it is written: it is a guard, and its red is the probe, Step 3):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * S-06 part 3 (spec "Every reader of messages"; decision 5: nothing ever SENDS a web chat row). Every
 * source file that reads or writes `messages`, how many times, and what a web chat row does to it. A new
 * reader fails BY NAME until someone writes down what a chat row (channel 'webchat', Sofía's outbound with
 * status 'delivered') does to it — the question no sender may skip.
 */
const REPO = join(__dirname, "../../../..");
const ROOTS = ["apps/web/src", "packages/db/src"];
const READERS: Readonly<Record<string, { count: number; why: string }>> = {
  "apps/web/src/lib/auth/visible.ts": { count: 1, why: "one message by id, for a visibility proof: unchanged" },
  "packages/db/src/automations.ts": { count: 3, why: "reactivation (any row keeps a customer out of 'it's been a while') and quote follow-up heard-back (inbound, any channel: a visitor turn is hearing back)" },
  "packages/db/src/booking.ts": { count: 3, why: "discards a QUEUED outbound EMAIL only; a notice's status by id; re-sorts after a discard (G30)" },
  "packages/db/src/inbound-email.ts": { count: 2, why: "deletes an inbound EMAIL by its Resend id; re-sorts after an unfile (G30)" },
  "packages/db/src/messaging.ts": { count: 13, why: "createMessage/fileWebchatTurns write; status by id; delivery webhook (outbound, never webchat: G29); inbound dedupe by provider id; text-back cooldown and failed texts (sms only); preview; thread; the record's email/sms page; search" },
  "packages/db/src/record.ts": { count: 4, why: "Last talked (email, sms, webchat) for one and for a set; the chats source's anchor and count reads" },
  "packages/db/src/voice.ts": { count: 1, why: "callerInTouchSince: inbound SMS only (G17: a chat does not release a held text-back)" },
  "packages/db/src/webchat.ts": { count: 1, why: "listWebchatKeys: one chat's own keys" },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("every reader of messages is listed with what a web chat row does to it (S-06 part 3)", () => {
  const found: Record<string, number> = {};
  for (const root of ROOTS) {
    for (const file of walk(join(REPO, root))) {
      const n = (readFileSync(file, "utf8").match(/\.from\(["']messages["']\)/g) ?? []).length;
      if (n > 0) found[relative(REPO, file).split(sep).join("/")] = n;
    }
  }

  it("the walk reaches the writer itself (a guard that finds nothing proves nothing)", () => {
    expect(found["packages/db/src/messaging.ts"]).toBeGreaterThan(0);
  });

  it("exactly these files, these many times (mutation: add a db.from(\"messages\") read anywhere → FAILS naming the file)", () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(READERS).map(([k, v]) => [k, v.count])));
  });

  it("every entry says why (mutation: an empty why → FAILS)", () => {
    for (const [k, v] of Object.entries(READERS)) expect(v.why.length, k).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 3: Probe.** Add a line `void db.from("messages");` inside any function of `packages/db/src/voice.ts` → case 2 FAILS naming `packages/db/src/voice.ts` (2 ≠ 1); edit back. Run → PASS. Paste the failing line and the summary.
- [ ] **Step 4: Commit** `-- apps/web/src/lib/messages-readers.test.ts`, message "test: every reader of messages is listed with what a web chat row does to it (S-06 part 3)".

---

## Task 10: Regenerate the i18n baselines (bis-comms)

- [ ] **Step 1.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (`ratchet.test.ts:1-11`); `git diff --stat apps/web/src/lib/i18n/` shows only the two baseline files.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → PASS. Read the catalogue's English key count off the regenerated file and the previous one (`git show HEAD:apps/web/src/lib/i18n/catalogue-baseline.json`); it grows by exactly 9 (Task 1's new English keys; the four `.es` twins add none). Paste both counts.
- [ ] **Step 3.** Commit `-- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json` (only the files that changed), message "i18n: baselines for the web chat copy (S-06 part 3)".

---

## Task 11: The e2e test (bis-e2e-qa)

**Files**
- Modify: `apps/web/e2e/concierge.spec.ts` (one import line, one test)

- [ ] **Step 1: Read** `apps/web/e2e/concierge.spec.ts` whole (the per-run fixture, `widget`, the OPENAI skip at `:318-324`, its restore discipline), `apps/web/e2e/inbound-email.spec.ts` (the checked deletes and the re-read), `apps/web/playwright.config.ts` (the agency storage state; one worker).
- [ ] **Step 2: Write the test.** Add to the `@bis/db` import: `createContact, createConciergeConversation, appendConciergeTurns, setConciergeSubmission, createSubmission, linkSubmissionContact, ensureConversation`. Then:

```ts
// S-06 part 3 (spec "Tests", G15): a lead's chat on the customer's inbox thread, through the REAL turn
// route. The lead itself is seeded (no test can make the model call capture_lead); ONE real turn is posted
// and its after() sync copies the whole chat. ON THE PER-RUN FIXTURE ACCOUNT ONLY. Every row it makes is
// deleted in `finally`, each error checked, then every table re-read.
test("a lead's chat files on the customer's inbox thread as Web chat, every turn marked", async ({ page }) => {
  test.skip(!widget, skipReason);
  test.skip(!process.env.OPENAI_API_KEY,
    "OPENAI_API_KEY is not set here, so the turn route refuses by design and nothing files. Set it in apps/web/.env.local to run this.");
  const db = serviceDb();
  const accountId = widget!.accountId;
  const stamp = `wc${Date.now()}`;
  const made: { contactId?: string; chatId?: string; submissionId?: string; conversationId?: string } = {};
  try {
    // The customer exists BEFORE the lead, so the chat reads as matched (spec §5a): one line.
    made.contactId = (await createContact(db, accountId, { firstName: `Chat ${stamp}` }, "e2e")).id;
    const chat = await createConciergeConversation(db, { accountId, formId: widget!.formId, ipHash: `e2e-${stamp}`, locale: "en", attribution: {}, origin: null });
    made.chatId = chat.id;
    const at = (s: number) => new Date(Date.now() - 600_000 + s * 1000).toISOString();
    await appendConciergeTurns(db, chat.id, [
      { role: "visitor", text: `Do you build benches? ${stamp}`, at: at(0) },
      { role: "assistant", text: "We do. What size do you need?", at: at(1) },
      { role: "visitor", text: "About six feet. I'm Ana.", at: at(2) },
      { role: "assistant", text: "Thanks, Ana. The team will follow up.", at: at(3) },
    ]);
    made.submissionId = (await createSubmission(db, accountId, widget!.formId, { answers: [], authorKind: "ai" })).id;
    await linkSubmissionContact(db, accountId, made.submissionId, made.contactId);
    expect(await setConciergeSubmission(db, chat.id, made.submissionId)).toBe(true);
    made.conversationId = (await ensureConversation(db, accountId, made.contactId, "e2e", "system")).id;

    const res = await page.request.post(`/api/concierge/${widget!.publicId}/turn`, {
      data: { conversationId: chat.id, text: "Do you work on Saturdays?", locale: "en" },
    });
    expect(res.status()).toBe(200);
    // The copy runs in after(), once the reply is sent.
    await expect.poll(async () => {
      const { count, error } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("conversation_id", made.conversationId!).eq("channel", "webchat");
      expect(error).toBeNull();
      return count;
    }, { timeout: 30_000 }).toBe(6);

    await page.goto(`/dashboard/accounts/${accountId}/conversations?c=${made.conversationId}`);
    const rows = page.locator("[data-webchat-row]");
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText(m["conversations.channel.webchat"]);
    await expect(rows.first()).toContainText(m["provenance.customer"]);
    await expect(rows.nth(1)).toContainText("· AI");
    await expect(page.locator("[data-webchat-unconfirmed]")).toHaveCount(1);
  } finally {
    const del = async (table: string, column: string, value: string | undefined) => {
      if (!value) return;
      const { error } = await db.from(table).delete().eq(column, value);
      expect(error, table).toBeNull();
      const { count, error: e2 } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
      expect(e2, table).toBeNull();
      expect(count, table).toBe(0);
    };
    await del("messages", "conversation_id", made.conversationId);
    await del("conversations", "id", made.conversationId);
    await del("concierge_conversations", "id", made.chatId);
    await del("form_submissions", "id", made.submissionId);
    await del("contacts", "id", made.contactId);
  }
});
```

(The posted turn's transcript already holds answered lines, so it bills nothing (`route.ts:688`); turn 2+ writes no automation log. Events the sync emits stay on the per-run fixture account, which `auth.teardown.ts` deletes whole with `deleteAccountCascade` (`auth.teardown.ts:6`, `:52`); read it once to confirm the client fixture is the account it removes.)

- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/concierge.spec.ts` lists the new test (listing does not run it). `pnpm --filter web exec eslint e2e/concierge.spec.ts`. Commit `-- apps/web/e2e/concierge.spec.ts`, message "e2e: a lead's chat files on the customer's inbox thread through the real turn route (S-06 part 3)".

---

## Task 12: Whole-branch final review (checkpoint, not an implementer task)

**Review:** opus. Ports `55672`/`55673`/`55674`.

- [ ] **Step 1.** Read the spec whole (G1-G22 as ruled), this plan's G23-G31 AS RULED in Task 0, then `git diff d6be0a06...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 1-9 touched, plus `src/lib/i18n` (the folder), `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/record` (the folder), `src/lib/concierge` (the folder), `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, every `…/conv/*.test.ts` by path; `pnpm --filter web typecheck`. The db suites on a kit of your own: `webchat-rls.test.ts` on `post`; behind PostgREST `webchat.test.ts`, `record.test.ts`, `timeline-merge.test.ts`, `messaging.test.ts`, `contact-messages.test.ts`, `inbound-email.test.ts`, `provenance-parity.test.ts`. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) any path where the sync can change, delay or break the visitor's response (an `await` on it outside `after()`, a throw that escapes the callback, a log or a read before `return quiet(…)`); (b) a sync scheduled on a refusal, or not scheduled for a lead filed earlier or by another tab; (c) a duplicate row on a retried sync, or a lost row when a batch stops (order kept, next turn heals); `created_at` not strictly increasing in index order; (d) unread raised for a Sofía row, for a pre-lead turn, on the filing turn, or more than once for one visitor row; a touch from a Sofía-only batch; more than one `webchat.filed` per batch, or one for a batch that wrote nothing; (e) ANY path that can select an outbound webchat row to send, deliver, retry or relabel it (the readers guard, G29, `hasRecentOutboundSms`, `listFailedOutboundSms`, every pass under `apps/web/src/lib/automations`); (f) a chat filed on any thread but the one the lead's contact owns, or a contact looked up by anything but the submission; another account's chat filed; (g) a chat id, a contact id, a name, a number or a word of a chat in any new log line (grep every new `log(` and `console.error`); (h) the composer opening on a channel the customer stopped while the other is not stopped; the start channel computed on the client; `getContact` not on the request client, or a ledger read before it; the composer not keyed by the thread; (i) a server component calling a value from a `"use client"` module (`grep -n "from \"../contacts/\[contactId\]/message-composer\"" "…/conv/page.tsx"`, then read the import); `serviceDb`/`ledgerDb` in any new file under `lib/`; (j) the record: more than one row per chat, a row that moves with a later turn, a cursor that repeats or skips, the Technician fence bypassed, "Last talked" missing the chat, the chat row's mark not the customer's; (k) rule 3 (no dot on the unconfirmed line or the chat row), rule 8 (one primary in the inbox composer: Send; "Open chat" ghost), the provenance rule, `lang` on the footer, the line and the chat body; (l) a Spanish assertion against `t()`'s output, a test that cannot fail, a mock answering a state production cannot reach; (m) the e2e touching anything but the fixture account, or a table it deletes from that it does not re-read.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent; a re-review follows every fix round.

---

## Task 13: Rollout (orchestrator; LAST; not a coding task)

- [ ] **Step 1.** The rulings on G23-G31 are in the ledger (Task 0 step 3), and any that CHANGED were carried into the tasks before they ran.
- [ ] **Step 2. No migration.** `git diff --name-only d6be0a06...HEAD -- packages/db/supabase/migrations` → nothing. Nothing is applied to bis-ci or production; CI `e2e`'s migration check passes on its own.
- [ ] **Step 3. Push and CI.** Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`), never an earlier run. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence"). CI's `e2e` job carries `OPENAI_API_KEY` (the `bis-ci` key, `ci.yml:318`), so Task 11's test RUNS there: read its result by name in the e2e job's report, and if it skipped, the secret is absent, which is a finding to report, not a pass.
- [ ] **Step 4. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 5. The PR** (auto-merge on green, memory "Speed process"). Its body names: G18-G22 accepted 2026-10-17 and G23-G31 with their rulings; ASSUMPTIONS A1-A3 and how each was checked; the pinned tests this PR changes; "Not in this PR"; that a lead's chat is copied after the reply, so a turn cut off by the platform heals on the next turn and the chat's LAST turn can stay only in the transcript (spec failure table); that leads filed before this ships are copied in full on their next turn (G13), with unread only for post-lead turns (G27); G30's two re-sort corners; that nothing ever sends a web chat row (the readers guard, G29); that the e2e posts one more real model call per CI run (the `bis-ci` key).
- [ ] **Step 6. Merge** (squash, through the PR) after the head SHA's `verify` and `e2e` are green and Task 12's findings are closed.
- [ ] **Step 7. After the deploy, on BIS's own production account only** (its concierge is the one on bis-rgv.com; never a client's): from a browser, chat with Sofía and give a name and a phone number that is ALREADY a test customer of BIS's own account; open Conversations → that customer's thread shows the chat's turns as Web chat, "Customer" and "Sofía · AI", the lead entry between your details and her thank-you (G4), and ONE "Matched by the phone or email they typed; not confirmed." line; send one more chat message → its pair joins within seconds and the thread's unread rises by one; the reply in the browser came back as fast as before (A2: compare the network panel's timing with a turn before the lead); the record page shows ONE "Customer chatted with Sofía on your website · N messages" row with Open chat, and "Last talked … (website chat)"; the inbox composer opens on Text if that number is cleared for texts, otherwise Email — observe only, SEND NOTHING. Record each outcome in the ledger. If any turn fails to land, read the function log for `webchat sync` lines (account id only) and stop before telling clients.
- [ ] **Step 8.** Tracker: item 7 / S-06 row updated to "part 3 (web chat in the inbox, composer follows the last reply) shipped #<n>; S-06 complete" (memory "Roadmap tracker").

---

## Not in this PR

- Live staff takeover of a chat, and sending anything over web chat (F-036 future; spec "Out of scope").
- Chats that never become a lead; a retention rule for them (G14).
- A backfill of chats whose lead filed before this ships: each copies in full on its next turn (G13); one that never gets another turn stays transcript-only.
- The "transcript view" and "offline panel" `docs/crm-features.md:1284` lists for F-036 part 1.
- Booking from the chat; any change to the widget or its strings (`lib/concierge/strings.ts`).
- Individual turns as record timeline rows (the chat is ONE row, §7); the unconfirmed line's "confirm" or "not them" action (the spec names the line only).
- A pseudo-locale mode for the inbox page (it has none today; the footer wraps, Task 8 pins it).
- The two re-sort corners of G30.

## Spec coverage

| Spec section / requirement | Task |
|---|---|
| Decision 1 + §1: only a chat with a lead files; the thread through the lead only; customer gone → dropped, logged, never elsewhere | 3 (`resolveWebchatThread`, `syncWebchatTurns`), 4 (scheduled only when `filed`) |
| Decision 4 + §2: one row per turn, webchat, inbound customer / outbound ai, delivered, `webchat:<chat>:<index>`, the turn's time, `meta.webchat` | 2 (planner, G1, G2, G5), 3 (writer) |
| §3: one sync in `after()`, reads the chat fresh, keys read, plan, write; 23505 = there; other errors stop; never reaches the response; not on refusals | 3, 4 (G3, G4, G28) |
| §4: unread for post-lead visitor rows only, Sofía never, touch only for visitor rows; badge and To do follow | 2 (`countsUnread`, G27), 3, 4 (`leadAtStart`, G7) |
| §5: the bubble: side and surface unchanged, `lang` of the chat, footer time · Web chat · mark in the staff language, no status word, persona with fallback | 3 (`listMessages` author pair, labels, G8), 8 (G26) |
| §5a: matched-existing from the two timestamps, in every row's meta, one line above the chat's first row, both languages | 2 (`matchedExistingCustomer`, G19), 3, 8 |
| §6: Text \| Email composer, `modes` + `initialMode`, not sticky, two pure functions on the server, readiness from the record's reads, never webchat | 5, 6 (G9, G10, G11, G31), 8 |
| §7: the `chats` source (anchor + count), one row per chat at its start, N both sides, customer mark, Open chat, the unconfirmed line beneath it, "took a request" row stays, drawer and group follow, Last talked "chat" | 7 (G18, G20-G25) |
| Readers table, "nothing ever sends a webchat row" | 3 (replica pins, G29), 9 (the guard), G30 |
| Data model: no migration; channel union; `fileWebchatTurns`; `listMessages` author pair; resolver; `meta.webchat` | 2, 3 |
| Copy (English and usted Spanish) | 1 (G23-G25), 10 |
| Failure behaviour (every row) | 3 (outcomes, stop, failedSteps), 4 (logs, isolation) |
| Tests: pure, route, replica, UI, unconfirmed, record, e2e | 2, 4, 3, 7, 5, 6, 8, 9, 11 |

## Self-review notes (the writer's own pass, 2026-10-17)

- Counts read off this file: G23-G31 is nine new rows; A1-A3 is three; Task 1's `WANT` holds 13 English keys (9 new, 4 existing that gain `.es`) and 13 `.es` lines (26 entries), and its second case asserts 13; Task 2's test holds 10 cases; Task 4 adds 8 route cases (1 in "answering", 7 in the new describe); Task 5's start-channel test holds 44 cases (4 lastCustomerReply + 2 readiness + 1 coverage + 36 matrix + 1 never-webchat), composer-facts 5; the task table has fourteen rows (0-13); Task 13 has eight steps; the readers table in Task 9 lists eight files.
- Names checked across tasks: `planWebchatRows`, `matchedExistingCustomer`, `webchatKey`, `parseWebchatKey`, `WEBCHAT_ACTOR_ID`, `WEBCHAT_KEY_PREFIX`, `WEBCHAT_MAX_ROWS_PER_CHAT`, `PlannedWebchatRow.countsUnread` (Tasks 2, 3, 7); `fileWebchatTurns` → `WebchatFileResult` (Tasks 3, 4); `resolveWebchatThread`, `listWebchatKeys`, `syncWebchatTurns` → `WebchatSyncResult` with stages `chat | thread | keys | write` and the route's own `threw` (Tasks 3, 4); `THREAD_COLS` (Task 3); `messageChannelLabel(channel, locale)` (Tasks 3, 8); `lastCustomerReply`, `textReadiness`, `emailReadiness`, `startChannel`, `loadInboxComposer`, `InboxComposerFacts` (Tasks 5, 8); `DEFAULT_MODES`, `tabSwitch`, `modeAfterSend`, props `modes`/`initialMode` (Tasks 6, 8); `TimelineChat`, kind `chat`, source `chats`, `LastTalkedChannel` `chat`, `TimelineRow.note` (Task 7); `readWebchatMeta`, `firstWebchatRows`, `personaName` (Task 8); DOM hooks `data-webchat-row`, `data-webchat-unconfirmed`, `data-timeline-open-chat`, `data-timeline-item="chat"` (Tasks 7, 8, 11).
- Every function this plan calls was read at `9e24720d` or is created by a named task: none is invented.
- Corrected in drafting: a Task 3 assertion that compared a value with itself was removed; the record test's `SOON` takes one base time so two calls agree.

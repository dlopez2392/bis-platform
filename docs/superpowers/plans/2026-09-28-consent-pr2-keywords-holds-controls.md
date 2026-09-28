# Consent Chain PR-2: Stop Words, Holds, Grants and the Texts Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship consent chain PR-2 (spec §7, the PR-2 row): inbound STOP, START and HELP in English and Spanish, Telnyx's own keyword handling reconciled so no customer gets two confirmations and none gets zero, the free-text phrase list and its holds, grants from forms, bookings and first texts, staff Stop / Resume / Confirm stop / Not a stop with undo, the rest of the contact's Texts row, the consent To-do rows, the guarded `hold_released` write, `tasks.consent_event_id`, the Telnyx opt-out backfill, and PR-1's inherited items (R2-I5, R3-M7, R3-M8, R3-M9).

**Architecture:** Four layers. **Data** (`packages/db`): migration 0055 adds `public.append_consent_event`, the ledger's one write path from here on (a per-address lock, the newest deciding row read under it, the caller's guard and spec §3's two rules, then the insert), one row per source (`consent_events_source_once`), and `tasks.consent_event_id`; `consent.ts` stays the only module that names the table or the function. **Pure rules** (`apps/web/src/lib/consent/`): `keywords.ts`, `phrases.ts`, the reply copy (`replies.ts`), the Texts view model (`texts-view.ts`). **The inbound route** classifies each text, files it, runs YES/NO only for a text that is nothing else, writes the ledger (a 503 on a consent-changing text whose handling failed, so Telnyx retries; every write is idempotent on the message id), and hands any BIS reply to `after()` so the webhook answers inside Telnyx's 2 s. **Screens**: the Texts row in the drawer and on the contact page, the To-do rows' Confirm stop / Not a stop, and the call page's "Send it now" closed on render.

**Tech Stack:** Next.js 16 (App Router, server actions, `after`), Supabase Postgres 17 (plpgsql, RLS; the local replica is PG18), `@supabase/supabase-js` (`.rpc`), vitest 4, Playwright, Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-26-consent-chain-design.md` at `76c6acfb`, corrected by this branch's four spec commits (Spec gaps resolved: S1–S6; S7–S12 after the plan review; S8's wording and S9's phrase list after the re-review; the Spanish rule after the delta review — all on 2026-09-28, with danlo's decisions). §1.1 decisions 1–9 are binding; §1.2 defaults 10–17 stand, decision 10 as amended by S7; §1.3 choices 18–31 are approved. This plan covers §3's PR-2 schema (`tasks.consent_event_id`, the guarded `hold_released`), §4.2 in full, the PR-2 parts of §5, §6 (the Texts row's Allowed, Stopped and On hold states, its skeleton and error, the To-do rows, the composer's closed state already shipped by PR-1), §8's PR-2 tests, and the PR-2 row of §7. It does NOT cover email (PR-3): the Email row, the token, `/u/[token]`, the one-click endpoint, the 0049 fold, scan 4.

**Telnyx facts:** `.superpowers/sdd/consent-pr2/telnyx-facts.md` (researched 2026-09-28, with the orchestrator's correction at its top), carried forward verdict for verdict in "External facts" below, plus four facts this plan's writer read on Telnyx's own pages on 2026-09-28 (F8–F11).

**Replay status: NOT REPLAYED.** This machine had between 0.05 and 0.9 GB of free memory for the whole of this plan's writing, and 0.17 GB when its review fixes were made (the brief's floor for running any targeted test is 1.5 GB), so no step below was run. Every "Expected" output is the plan writer's prediction, labelled as such; every probe row is a prescription, not a measurement. The implementer runs each RED, each GREEN and each probe, and reports any that behave otherwise (the brief-discipline rule: verify before you apply, reject with evidence if wrong).

## Global Constraints

- Tier: **HIGH (legal)** (spec §8). Every new assertion names, in its title, the mutation that turns it red. Every task ends with a probe table; the implementer applies each probe to the finished task, one at a time, and records which tests turned red (memory `bis-vacuous-test-shapes`: a mutation must compile and must produce the WRONG OUTPUT, never a crash a catch launders; judge by the whole file, never one `-t` filter; a harness must tell "stayed green" from "nothing ran"). A guard kept "as defence in depth" gets a pure unit test of its own. Source scans read code with comments stripped (TypeScript's printer, `scans.test.ts:56-67`) and each carries a positive control.
- **Decision 2, verbatim:** "After a stop, that business sends NOTHING to that number except ONE plain confirmation, with no promotion and no rebooking offer. START re-subscribes. There is no category question."
- **Decision 10** (a §1.2 orchestrator default, amended by S7; the part this plan uses, verbatim): "A keyword matches only the **whole message**, ignoring case and accents. **Stop, English:** STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT, OPTOUT. **Stop, Spanish:** PARAR, DETENER, ALTO, CANCELAR, BAJA, NO MAS / NO MÁS". Decision 11: "START and UNSTOP re-grant. HELP and AYUDA reply with the business name and how to stop". Choice 26: "Keyword matching ignores spaces too". This plan extends choice 26 to leading punctuation and inner hyphens (G9). Decision 10's first sentence said BIS "sends the single confirmation itself"; that cannot hold for a keyword Telnyx also knows (F4: Telnyx's block refuses BIS's own send, with no exemption), and spec §4.2's own steps already said "unless Telnyx auto-replied". S7 amends it: BIS handles every keyword in the webhook and sends the one confirmation itself only when `autoresponse_type` is absent; when Telnyx answered, Telnyx's reply, set to the spec's own line (Task 16 step 10), is the one confirmation (review R1-I4). Decision 10 is one of §1.2's orchestrator defaults, not one of danlo's binding decisions.
- **Choice 18:** the stop confirmation, the start confirmation and the help reply go at any hour. **Choice 19:** "A stop the customer made **themselves** (a keyword, the unsubscribe link, one-click), or one the carrier reports, is lifted **only by the customer's own act** … Staff Resume is offered only for stops that staff recorded, staff confirmed, or that came from staff's 0049 switch". **Choice 20:** "A **free-text stop gets no confirmation text**". **Choice 28:** "A **grant never lifts a stop**."
- **The only send allowed to a stopped address** (spec §4.2, verbatim): "The gate lets `consent.stop_confirmation` through a stopped address only when the caller passes the id of the `revoked` row it answers, and that row is the newest and under five minutes old."
- **Customer-facing texts** (spec §4.2, verbatim): "They have no á, í, ó or ú, which would drop the message to UCS-2". The six lines of §4.2's table are used verbatim; `{Business}` is `brandDisplayName` (the text-back's name, `textback-body.ts`), and a blank name drops the `{Business}: ` prefix, the text-back's own rule.
- **The Telnyx split (F4, G4):** a keyword Telnyx answered (`autoresponse_type` present) is confirmed by Telnyx's own configured reply, never by BIS, because Telnyx's profile-level block refuses BIS's own send too. BIS sends its own confirmation only when `autoresponse_type` is absent. Every Telnyx write (keyword configs, reply text, profile features) is an **orchestrator step under danlo's explicit go, with a read-back** (Task 16); no implementer calls the Telnyx API, and no code path does.
- **The ledger stays append-only** (spec §3): from this PR every write goes through `public.append_consent_event` (0055), called only from `packages/db/src/consent.ts` (scan 3); nothing updates, upserts or deletes `consent_events`. State = the newest row whose action is `revoked`, `held`, `hold_released` or `resubscribed`, by `occurred_at` (to the millisecond), then the more restrictive action, then the larger `id` (`consentStateOf`, PR-1); `granted` never decides.
- **Fails closed** (spec §5): the gate is unchanged in that respect (PR-1). The inbound route answers **503** when a text that changes consent (a stop, a start, a phrase) could not be handled, so Telnyx retries (F7); every other failure keeps today's 200. Grants are evidence (decision 8, choice 29) and are contained, never retried.
- **Copy** lives in `apps/web/src/lib/messages.ts`, in plain language (DESIGN.md "Voice"; `messages.test.ts` scans every key). Where the spec gives words they are used verbatim and pinned in `copy.test.ts`; every other line is this plan's (G-list). Task 5 adds every consent line this PR needs, so no later task edits `messages.ts` except Task 7 (the A2P card's own lines).
- **UI** follows DESIGN.md: tokens only; both themes through `.dark`; status is a dot and a word (`DotPill`); loaded / empty / error states; one primary per view (rule 8: the Resume form's "Resume texts" is the one primary of its inline view; every other Texts button is ghost); reversible actions run at once with an undo toast (rule 6); new variants get a `/dashboard/styleguide` specimen.
- **Supabase: never write to either project, never read production.** The orchestrator applies 0055 and 0056 exactly once per project (Task 16); a production READ needs danlo's explicit go. Local env files point at PRODUCTION, so the db suite, Playwright and `pnpm check` REFUSE to run locally (#135, by design). Never work around that.
- **DB tests** (`packages/db`): `withRollback` tests run on the local PG18 replica AND in CI; `withTestAccount` / `serviceDb` / PostgREST tests are CI only and fail to connect locally, which is expected. The replica (memory `bis-local-db-replica`; PR-1's `replica.sh`, Prerequisites): `pre` = every migration except this PR's; `post` = `pre` plus them. A lane runs a db test file with `SUPABASE_DB_URL=postgresql://postgres@localhost:55433/<pre|post>`.
- **Full web suite, every lane, every task that says so:** `pnpm --filter web exec vitest run` (memory `bis-gate-memory-hygiene`: `pnpm --filter web test -- …` hands vitest a stray `--`). In a lane worktree (no `apps/web/.env.local`) it ends with exactly **two failing suites**, the same two as on `main`, each throwing before its tests run: `src/app/f/[publicId]/actions.returning-lead.test.ts` and `src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`. Any other failure is the lane's. Judge by vitest's own summary block (a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after a real summary is pnpm's, not vitest's).
- **Memory on this machine is tight.** Before any suite: `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`; run a full suite only above 2.5 GB, a single test file only above 1.5 GB; otherwise wait, and never run two suites at once.
- **`vi.mock("@bis/db")` factories.** When a task adds a new top-level `@bis/db` import to a module, every test that mocks `@bis/db` and imports that module (directly or through another) must define the new export, or the new path reads an undefined mock and passes vacuously (a missing `readConsentState` turns every send into `ledger_unavailable`). Each task names the factories it changes.
- **E2E** runs only on the per-run fixture account ("E2E Client Co …", `auth.setup.ts`), never `Test Client One`.
- **Lanes** (2–3 at a time, disjoint files, `.claude/worktrees/consent-pr2-<lane>` on `feat/consent-pr2`): each lane commits locally, one commit per task; the orchestrator cherry-picks onto `feat/consent-pr2` at each checkpoint. Nobody pushes until Task 16.
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`, all in CI (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.
- **danlo decided every open question on 2026-09-28** (recorded under QUESTIONS FOR DANLO, which now holds only FYIs). The plan is written to those decisions; no task waits on an answer.

## Prerequisites

1. **`main` at `76c6acfb` (#152) or later**, with 0054 applied to both Supabase projects (the ledger line "0054 APPLIED TO PROD 2026-09-28T17:11:04Z via MCP apply_migration … NEVER RE-APPLY"; the stored migration version is `20260928171058`). The branch `feat/consent-pr2` is cut from it. If `main` has moved, re-read every file a task edits before applying its diff (tasks name functions, not lines).
2. **danlo's decisions of 2026-09-28**, already written into the tasks: Telnyx's START and HELP replies are the spec's bilingual lines for US, MX and CA (Task 16 step 10); the help reply carries a contact sentence (Task 5); each business's messaging profile is recorded (Task 7 runs); Telnyx's existing opt-outs are imported before any number moves (Task 3, Task 16 steps 7–8); a customer's STOP over a staff stop is recorded without a reply (Task 1, Task 8); the phrase list is extended (Task 4).
3. **The local replica** (orchestrator, once, before Task 1): PR-1's `replica.sh` (`docs/superpowers/plans/2026-09-26-consent-pr1-ledger-and-gate.md`, Prerequisites item 3), run as `replica.sh <repo-root> 0055_consent_writes.sql`. It builds `pre` (every migration but 0055) and `post`. Once Task 7 lands, rebuild with 0056 as the new file (`post` then carries both; build `pre` from the branch with 0055 applied and 0056 excluded by running the script from a checkout without 0056 and then applying 0056 to a `template` copy by hand, exactly as the script's last two lines do).
4. **No new env var and no new secret.** Task 15 adds one NON-secret literal to `.github/workflows/ci.yml`'s `e2e` job: a Telnyx-style Ed25519 PUBLIC key whose private half lives in the e2e spec, so the e2e server accepts the spec's signed webhooks (the `STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only` precedent). Production's `TELNYX_PUBLIC_KEY` is Vercel's and is untouched.
5. **0055 changes no grant; its two new indexes turn ONE of `main`'s tests red on the CI project** — `consent-ledger-schema.test.ts`'s index list (see Task 1) — from the moment Task 16 pushes 0055 there until the merge. Keep that window short, as PR-1 did.

## External facts: verified vs assumed

Carried forward from `.superpowers/sdd/consent-pr2/telnyx-facts.md` (2026-09-28), each with that file's verdict unchanged:

- **F1. `autoresponse_type` — VERIFIED.** `data.payload.autoresponse_type`, a plain string on `message.received` (OpenAPI `MessagingInboundMessagePayload`), not required (absent when no keyword matched); documented values START, STOP, HELP. The text is still delivered: the same event carries `text` and `autoresponse_type`. The facts file's own caveat stays an **assumption**: a custom keyword registered under `op: "stop"` probably reports `STOP`, not the word. The plan does not depend on the value's SPELLING (review R2-I2): ANY non-blank `autoresponse_type` means Telnyx replied, so BIS sends nothing; `INFO` reads as HELP (F11); only the value `STOP` is read as Telnyx's block when BIS's own list does not match; an unknown value is logged (Task 8, Task 9).
- **F2. Custom keywords per profile — VERIFIED.** `POST /v2/messaging_profiles/{profile_id}/autoresp_configs`, body `{op, keywords, resp_text, country_code}`. Defaults: STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT (opt-out); START, UNSTOP (opt-in); HELP. "START, STOP, and HELP are reserved … You can add additional keywords to each operation, but the defaults always remain active." At most 20 keywords per config; a default operation's reply needs at least 20 characters. REVOKE, OPT OUT and OPTOUT are not defaults.
- **F3. Reply text per profile and per country — VERIFIED.** Each config carries its own `resp_text`, chosen by `country_code`, "based on the sender's number origin". The facts file's further sentence, that one profile can hold two `stop` configs under the SAME `country_code` (English words with an English reply, Spanish words with a Spanish reply), is **NOT FOUND** in Telnyx's docs: it is the researcher's inference, and every documented example has one config per operation per country. The plan uses one bilingual config per operation per country (danlo's decision 1), so it does not depend on it.
- **F4. A profile-level STOP block also refuses BIS's own confirmation — VERIFIED; there is no exemption.** "Block rules apply at the messaging profile level"; `CreateMessageRequest` has no bypass field.
- **F5. `40300` is synchronous — VERIFIED; its HTTP status — NOT FOUND.** PR-1 already keys on the code, not the status (`telnyx.ts:32,48-56`, `types.ts:26-31`, `gate.ts:200`; pinned by `telnyx.test.ts:141-186` and `gate.test.ts:245-270`). Assumption A1 of PR-1 stands.
- **F6. `GET /v2/messaging_optouts` lists a profile's opt-outs — VERIFIED.** Filters `filter[messaging_profile_id]`, `filter[from]`, `created_at[gte|lte]`, `page[number|size]`, `redaction_enabled`; each row `{from, to, messaging_profile_id, keyword, created_at}`.
- **F7. Webhook retries — VERIFIED.** Respond within 2 s; up to 3 attempts per URL with exponential backoff, then the failover URL; up to 6 in all; any non-2xx (3xx included) is a failure.

Read by this plan's writer on 2026-09-28 (documentation only; no Telnyx API was called):

- **F8. Telnyx has per-profile AI opt-out detection — VERIFIED** (`developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out.md`, "AI opt-out detection"; OpenAPI `MessagingProfileFeatures.ai_opt_out_detection_enabled`). When on, a message matching no keyword is classified, and a high-confidence opt-out "gets the same handling a literal STOP would get: the sender is blocked and your configured opt-out auto-response is sent", at $0.002 per classified message. It would turn a free-text sentence into a carrier block that only the customer's START lifts, contradicting choice 20's hold-and-confirm and decision 5 ("AI detection waits for study decision 6"). **It must stay off** (Task 16 reads it back). If it is ever on, the route records such a STOP as `revoked` / `carrier_block` (G4), which is the safe direction.
- **F9. The inbound payload carries `messaging_profile_id` — VERIFIED** (OpenAPI `MessagingInboundMessagePayload.messaging_profile_id`). The send request's `messaging_profile_id` is "Required if sending via number pool or with an alphanumeric sender ID" (OpenAPI `CreateMessageRequest`) — **VERIFIED**; BIS sends from a number, whose own profile applies, so the send path needs no profile id.
- **F10. The opt-out list's orientation — VERIFIED from the OpenAPI descriptions:** `OptOutItem.from` is "Sending address (+E.164 formatted phone number, alphanumeric sender ID, or short code)", i.e. the business's number; `to` is the recipient, the customer. Task 3's count prints both columns' match rates against `phone_numbers`, so a reversed reading would show as zero matches before anything is written.
- **F11. The autoresp operation's name — NOT FOUND.** Telnyx's prose and curl examples say `op: "help"`; the OpenAPI enum for `AutoRespConfigCreateSchema.op` is `["start", "stop", "info"]`. Task 16 posts `help`, reads it back, and uses `info` only if `help` is refused. A `GET …/autoresp_configs` list exists (OpenAPI `GetAutorespConfigs`, filterable by `country_code`) — VERIFIED — which is the read-back.
- **Also on Telnyx's webhook page (VERIFIED):** duplicates are expected ("Telnyx may deliver the same webhook more than once"), order is not guaranteed, and for slow processing "Return 200 immediately; process the event asynchronously." The route does exactly that with `after()` (G3).

Repo facts (read on `66b38d57`):

- **R1.** No code in `apps/` or `packages/` names a messaging profile (`grep -ri "messaging_profile\|MESSAGING_PROFILE\|autoresp"` finds only docs: `a2p-registration.md:212`, `crm-features.md:1176`, the spec).
- **R2.** The inbound route's retry dedupe (`route.ts:143-150`) RETURNS before anything else runs, and `messages` has a unique index on `provider_message_id` (`0005_messaging.sql:51-52`). See S1 and G1.
- **R3.** `next/server`'s `after` is used by four routes today (`concierge/[publicId]/turn`, `voice/incoming`, `voice/texml`, `voice/texml/handoff-result`), and `handoff-result/route.test.ts:64-67` mocks it; Task 9 follows that.
- **R4.** `tasks` carries table-level INSERT, UPDATE and DELETE for `authenticated` (`schema-grants-guard.test.ts:92`), so a new `tasks` column is client-writable without any grant (G7).
- **R5.** `public.users` has no writer anywhere (`grep '"users"'` finds none), so a staff member's name is not in the database; Clerk has it (G14).

Assumptions (not verified; each names what settles it):

- **A1.** Telnyx matches a keyword case-insensitively and as the whole message; whether it ignores trailing punctuation, accents or inner spaces is NOT FOUND. BIS's own matcher is broader (G9). For a **STOP** Telnyx does not match, no block exists and `autoresponse_type` is absent, so BIS replies itself: one reply either way. **Not so for a START after a Telnyx-blocked STOP** (review R2-I1c): the customer texts `STOP` (Telnyx blocks and answers), then `Start!`, which Telnyx may not recognise; BIS matches it, appends `resubscribed` and sends its start confirmation; Telnyx still blocks the number and refuses that send with 40300; the gate records `carrier_block` again (`gate.ts:200-206`), so the ledger is right (the number IS blocked) but the customer gets no reply and stays blocked until they text a START Telnyx itself recognises. Documented, logged by name (Task 8's `sendConsentReply`), and checked live (Task 16 step 11 texts `Start!` and `Cancel.`).
- **A2.** `lock_timeout` bounds a wait on an advisory lock as it does any lock wait. Task 1's lock test proves it on the replica (PG18) and in CI (PG17).
- **A3.** A Telnyx-handled keyword always arrives WITH `autoresponse_type`. If a delivery ever omits it, BIS would reply too: for a STOP, the carrier refuses BIS's send (F4), so still one reply; for START or HELP, two. Settled by Task 16's go-live check; the log line "consent reply … sent" makes it visible.
- **A4.** Next's `after()` runs the deferred reply after the response on Vercel's runtime, as it does for the four routes in R3 — including after a 503 the route RETURNS (review R2-I1a relies on it: a CANCEL whose To-do failed still sends the confirmation its first attempt owed). The e2e cannot observe a sent reply on the fixture account (G15); Task 16's go-live check does.
- **A5.** Whether a number's opt-outs follow it when it moves to another messaging profile is **NOT FOUND** in Telnyx's docs. Inferred from F4 (block rules apply per profile) that they do NOT: after the move, the new profile would deliver to a number that opted out on the shared one. So Task 16 imports the shared profile's list BEFORE any number moves (steps 7–8; review R1-C1, danlo's decision 4). Settled only by Telnyx support or a live test on a spare number; the plan does not need it settled.

FYIs for danlo (not questions; recorded so they are seen):

- **Consent replies are not billed** (G11; review R1-M9). danlo's M7a rule bills automations, composer replies and missed-call text-backs; a stop, start or help reply is none of those, and the usage scan (Task 14) pins that no consent reply records usage. If that should change, it is an M7a decision.
- **An accented business name makes every reply UCS-2** (review R2-m10): "Jardinería López" puts BIS's replies at 2 segments for most lines and Telnyx's bilingual ones at 3 (measured, Task 5). The spec keeps its OWN words free of á, í, ó and ú; a name is the business's to choose. BIS does not bill these replies (above); the carrier segments are Telnyx's.

## Spec gaps resolved here (the reviewer should confirm or overrule)

S1–S12 are corrections applied to the spec itself, in this branch's four spec commits (S1–S6 with the plan; S7–S12 after the plan review; S8 and S9 refined after the re-review and again after the delta review, with danlo's decisions of 2026-09-28), so the spec and the plan agree; the G-list is this plan's choices where the spec is silent.

- **S1. The retry dedupe.** Spec §4.2: "The existing provider-id dedupe (`route.ts:143–150`) stops a retry from filing the message twice." True, but that dedupe RETURNS, so a retry after a 5xx would never write the ledger (R2). Corrected: a retry skips only the filing and YES/NO; the consent step runs again and is idempotent (G1). The second spec commit adds (review R2-I1a): the attempt that writes the row owes the reply and schedules it the moment the row is written, even if a later step (the CANCEL To-do) fails and answers 503.
- **S2. Go-live step 0.** Spec §5 item 1: "START and UNSTOP are registered as opt-in keywords." They are Telnyx's defaults, reserved and always active (F2); nothing to register. Corrected to: every stop word BIS knows is listed in ONE stop config per country (US and MX; S11 adds CA) so each gets the business-named reply; START / UNSTOP and HELP / AYUDA get their own configs (danlo's decision 1); Telnyx's AI opt-out detection stays off (F8).
- **S3. §11's Telnyx bullets** carry the verdicts of F1–F11 (the list API exists; retries are 3 + 3 over 2 s; the per-language reply inside one country is NOT FOUND; the 40300 status is NOT FOUND).
- **S4. The Telnyx backfill** (spec §4.2 "Telnyx backfill", and decision 16's "(unverified)"): no longer "unverified"; each opt-out row names the business's number (`from`), which maps to the account (F6, F10).
- **S5. "Every phrase has two or more words"** (spec §4.2, step 5) is false for `borrenme`. What the "never both fire" claim needs is that no phrase matches a YES/NO word, which Task 4 tests.
- **S6. Decision 12's "unverified"** becomes "verified 2026-09-28 (plan F1–F4)". The first spec commit's message called this "status only"; it was not — it also added a behavioural sentence to decision 12 ("…so BIS confirms only when `autoresponse_type` is absent"), the split G4 describes (review R1-I4). S7 makes decision 10 say the same.
- **S7. Decision 10 amended** (a §1.2 orchestrator default, so the orchestrator may amend it; FYI to danlo, review R1-I4): BIS handles the keywords in the webhook and sends the one confirmation itself only when `autoresponse_type` is absent; when Telnyx answered, its configured reply, set to the spec's own line, is the one confirmation.
- **S8. §4.2 step 2: a customer's STOP over a staff stop** (danlo, 2026-09-28; review R2-I3): the keyword stop is refused only when the newest deciding row is a `revoked` whose method is the customer's own (keyword, carrier_block, backfill_telnyx, unsubscribe_link, one_click) (wording, review R1-N5); over a staff stop or a confirmed free-text stop it is RECORDED, with no confirmation (the texts were already off), and from then on only the customer can lift it. The same for the Telnyx backfill (0055's `unless_customer_stopped`). §4.3's email rule ("an address already stopped gets no second row") is not the same principle; PR-3 decides whether email follows S8, and the spec now says so.
- **S9. §4.2's phrase list extended** (danlo, 2026-09-28; reviews R2-I5, R2-N1, delta I2), in four kinds, each a hold that staff confirm:
  - **sentence phrases, anywhere in the message:** English adds "no more texting", "do not contact me", "dont contact me" (17 in all); Spanish keeps the phrases that are about messages on their own — "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado" — and the list requests "quitenme / quiteme / quitame / saquenme / saqueme / sacame de su / la lista" (17 in all);
  - **Spanish verb forms ONLY ABOUT MESSAGES** (danlo, delta review I2): "no me manden / mande / mandes / envien / envie / envies / escriban / escriba / escribas", "dejen / deje / deja de mandar(me) / enviar(me) / escribir(me)" and "no quiero recibir" count only when followed by a message object — "mensajes", "textos", "nada" or "mas" (28 forms × 4 objects = 112 phrases). A bare form does not hold ("No me mande la factura", "Deje de mandar a Juan", "Dejen de mandarme") — except that the six ESCRIBIR forms hold as the WHOLE message (next bullet), because writing to the customer IS messaging and a missed stop is worse than a false hold (orchestrator, under danlo's rule; decision 27); "No me escriba el martes, mejor llámeme" still does not. "mensajes de voz" (voicemail) and "lista de espera" (a waiting list) do not count as messages or the texting list: "No me mande mensajes de voz, mejor texto" asks for TEXTS, so holding them would do the opposite of what the customer asked;
  - **whole-message phrases:** "please stop", "stop please", "borrenme", "borreme", "borrame", and the escribir forms "dejen de escribirme", "deje de escribirme", "deja de escribirme", "no me escriban", "no me escriba", "no me escribas" count ONLY when they are the whole message, punctuation aside (no "por favor" or "ya" wrapper, as "please stop" has none): "Please stop!!", "¡Bórreme!" and "No me escriba" hold; "Please stop by Thursday", "Bórreme la cita del lunes" and "No me escriba el martes, mejor llámeme" do not;
  - **a stop word repeated as the whole message:** "stop stop", "parar parar", "alto alto", "baja baja" (any number of repeats; English also with one "please" at either end, "Stop stop please"); one word on its own is a keyword, not a phrase.
  No sentence phrase contains another, so their order never changes whether a text holds. Pinned in Task 4 by test-local literals.
- **S10. §3: a `source_ref` names one delivery or event, never a reusable channel** (review R1-I3): a message id, a form submission, a booking, one Telnyx opt-out at its own time. A reusable source (a token, an address) would read as a retry forever and drop a second real stop as a duplicate. The backfill's source includes the opt-out's time.
- **S11. §5 go-live step 0**, beyond S2: one bilingual config per operation for sender countries US, MX **and CA** (danlo's decision 1); the help reply carries the contact sentence (decision 2, S12); Telnyx's AI opt-out detection is read, a `true` stops the rollout, turning it off is a Telnyx write under danlo's go with a read-back, and an absent field is unknown, not off (review R1-I6); and Telnyx's existing opt-outs are imported before any number moves (decision 4, A5).
- **S12. §4.2's help lines gain the contact sentence** the A2P campaign promises (`a2p-registration.md:197-199`; danlo's decision 2): "Call or text this number for help." / "Llame o escriba a este numero para recibir ayuda." — unaccented, because "número" would push BIS's Spanish help from one GSM-7 segment to two UCS-2 segments (measured, Task 5).
- **G1. Retries (brief item d).** The dedupe skips the FILING only (`createMessage`, the unread bump) and YES/NO (which is not idempotent: it answers "the most recent unanswered ask", so a second run could answer the next booking). The consent step runs on every attempt and every write is idempotent: `append_consent_event` returns `duplicate` for a row already written from the same message (`consent_events_source_once`), a To-do is one per ledger row (`tasks_consent_event_once`), and a BIS reply is sent only by the attempt that APPENDED the row it answers (stop, start) or FILED the message (help) — and that attempt schedules it the MOMENT the append answers, before any To-do, so a To-do failure's 503 can never leave the customer with no reply (review R2-I1a; `recordInboundConsent`'s `owe` callback, Task 8).
- **G2. What answers 503.** Any failure while handling a text that changes consent (a stop keyword or Telnyx STOP, a START, a phrase) answers 503 — the ledger write, the To-do that tells staff, and anything before them that the retry needs (the contact, the filing). Everything else keeps today's 200-and-log: a plain message, a HELP, a grant (evidence only, contained like YES/NO). Spec §5: "A ledger write error on an inbound stop returns a 5xx so Telnyx retries."
- **G3. The 2 s budget.** The provider call is the one slow step; replies run in `after()`, after the 200 (Telnyx's own advice on its webhook page; External facts, the note after F11). The synchronous path is database reads and writes only. The design does not RELY on answering in 2 s: a slow first attempt that Telnyx retries is handled by G1's idempotency.
- **G4. The Telnyx split (brief items a and b).** ANY non-blank `autoresponse_type` ⇒ Telnyx answered, BIS sends nothing (review R2-I2: the value's spelling is not trusted; `INFO` reads as HELP, an unknown value as `OTHER` and is logged). Only a value of STOP that BIS's list does not match (a keyword Telnyx knows and BIS does not, or F8's AI detection) is recorded `revoked`, method `carrier_block`: the carrier has blocked that number, and choice 19 then leaves it to the customer's START. A START, HELP or unknown value that BIS does not match is logged and NOT recorded: disagreement resolves toward sending less. The registered set (Task 16 step 10, danlo's decision 1): every stop word of decision 10 in one bilingual `stop` config, START / UNSTOP, HELP / AYUDA, for each of US, MX and CA.
- **G5. The stop confirmation's gate exception** (spec §4.2) is `SmsRequest.answersEventId`, checked against the newest deciding row and `STOP_CONFIRMATION_WINDOW_MS` (five minutes), at decide AND at the deliver re-check. A stop confirmation to an address that is no longer stopped is refused `stop_confirmation_stale` (a START that landed within seconds must not be answered "you won't get any more texts").
- **G6. The guarded write lives in SQL**, one function, under a per-address advisory lock with `occurred_at = clock_timestamp()` taken after the lock. The newest row is judged to the MILLISECOND, then by the more restrictive action, then by id, exactly as `consentStateOf` does in JavaScript, so the two can never disagree; two writes to one address inside the same millisecond tie on time and the more restrictive reads as newest (review R1-I1: that errs toward sending less, and the schema tests space their writes 2 ms apart so they test what they name). Every staff action is a compare-and-set on the newest deciding row (`{ ifNewest: id }`), which closes STALE clicks. It does not close a DELIBERATE one — a caller who names the id of a customer's own STOP (review R3-C1) — so 0055 also enforces choice 19 as STATE rules, whatever the guard: a staff stop only over an allowed address; a confirmed free-text stop only over a hold; a staff Resume only over a stop staff made (staff, free_text, backfill_0049); a staff undo of a stop only over a staff stop. `stopTexts` mirrors the first rule so the operator is answered with where things stand.
- **G7. `tasks.consent_event_id`'s grant.** `tasks` keeps its table-level grants (R4), so the column is client-writable like every other `tasks` column. The composite key (0050's pattern) makes a cross-account link impossible, a unique index allows one To-do per ledger row, and nothing trusts the link: the To-do's buttons re-read the ledger and act through the guarded write.
- **G8. The To-do's text** is the English line from `messages.ts`, written into `tasks.title` at creation (the spec: "`tasks.title` stores the English line for exports"). The Spanish lines are in `messages.ts` and pinned; there is no operator locale today (`m` is English only), so they wait for one.
- **G9. Keyword normalisation** strips leading as well as trailing punctuation and symbols (`¡Alto!`) and inner hyphens (`Opt-out`), on choice 26's own reasoning (customers type both). A false match only stops texts, and START undoes it; a missed stop is the legal risk.
- **G10. The alert phone** (R2-I5): STOP and START are recorded before the route drops the alert phone's texts; no grant, no To-do, no HELP, no filing. A reply follows the same rules as for a customer.
- **G11. Consent replies do not bill.** danlo's M7a rule bills automations, composer replies and missed-call text-backs; a consent reply is none of those. An FYI for danlo (review R1-M9), listed under External facts.
- **G12. "Stop texts" takes no note:** it runs at once (rule 6), so its line reads "you recorded it". The spec's example "you recorded it: asked on the phone" has no input that could produce it.
- **G13. Resume has no undo toast:** it is a deliberate form with a required note, and "Stop texts" reverses it. Its success toast says so.
- **G14. "confirmed by Ana":** the staff member's first name from Clerk (`clerkClient().users.getUser`), stored as `evidence.actorName` when the row is written (R5). Clerk unreachable → no name, and the line says "confirmed by your team".
- **G15. The e2e (spec §8).** "The fake provider records one confirmation" cannot be observed on the fixture account: its A2P is not approved, so the gate refuses every send, and the fake provider records nothing. The e2e posts a signed STOP WITH `autoresponse_type` (Telnyx replied; BIS sends nothing) and proves the ledger, the Texts row and the To-do; the one-confirmation rule is proven at the route level with genuinely signed fixtures (Task 9) and at the gate (Task 6).
- **G16. The inbound route stops being a pure recorder.** `route.test.ts:337-390` (the case "NEVER sends anything back — the route is a recorder", on `76c6acfb`) pins the automation engine's decision 6 ("no send of ANY kind" from this webhook). The consent replies are spec-mandated (§4.2) and go through the gate, after the response. The YES/NO leg still sends nothing. The test is rewritten to pin exactly that (Task 9).
- **G17. Grants.** Forms: in the form action, not `enrich` (only the public form has consent fields; `enrich` also serves the intake API and the concierge), one row per ticked consent field per address, `contact_id` null (the evidence names the submission, which links the contact). Bookings: in the booking action, after the booking exists. Texting first: the inbound route (spec step 6). All three `granted` and contained.
- **G18. The Texts row's precedence** is the gate's order: Stopped, then On hold, then Check number, then Allowed. A contact with no textable number renders no row (as in PR-1).
- **G19. The "since" line** is "Since {date} · {how}", the date in the account's zone (`renderZone`), the drawer's other date rule.
- **G20. An Undo is an Undo, not a note-free Resume** (review R3-I6): both Undos (of "Stop texts", of Confirm stop / Not a stop) are accepted only for the SAME staff member's row, under `UNDO_WINDOW_MS` (two minutes) old; past that, or for someone else's row, staff use Stop texts or Resume texts (with its note). Enforced on the server (Task 11).
- **G21. A hold's To-do is never closed without deciding the hold, and never left open once it is decided** (reviews R3-I1, R3-N1, R3-N3): `completeTask` refuses it while its NUMBER is still on hold — the newest deciding row a hold, the To-do's own or a later one (Task 2) — and no screen offers a Done that would be refused (the To-do page shows the two buttons; the contact timeline shows the decide-first hint, Task 12). A STOP or START on the held number closes the To-dos of every hold on it (Task 8); Confirm stop / Not a stop close them (Task 11); a click once the contact's number is no longer on hold closes the To-do (Task 13). The agency Work queue has no action buttons (its rows are read-only links), so nothing changes there.

## File Structure

Read off the Files block of each task below (each task's block is the authority). **45 files created, 55 modified, 1 deleted** across 15 implementation tasks (Task 7 runs: danlo's decision 3). Test counts are left to each task's own test code: nothing was run to count them (Replay status).

**packages/db**

Created:
- `supabase/migrations/0055_consent_writes.sql`, `src/test/consent-writes-schema.test.ts`, `src/test/consent-writes-live.test.ts` (CI only) — Task 1
- `src/consent-tasks.test.ts` (Tasks 2, 13), `src/test/consent-tasks-live.test.ts` (CI only) — Task 2
- `supabase/backfills/0055-telnyx-optout-owners.sql`, `src/backfill/telnyx-optouts.ts`, `src/backfill/telnyx-optouts.test.ts`, `src/backfill/telnyx-optouts-run.ts`, `src/test/telnyx-backfill.test.ts` — Task 3
- `supabase/migrations/0056_messaging_profile.sql`, `src/test/messaging-profile-schema.test.ts` — Task 7

Modified:
- `src/consent.ts` (replaced), `src/consent.test.ts`, `src/test/consent-ledger-schema.test.ts` — Task 1
- `src/index.ts` — Tasks 1, 2, 7, 13
- `src/activities.ts` — Tasks 2, 13; `src/booking.ts`, `src/work-queue.ts` — Task 2
- `package.json`, `src/ci/sql-files.test.ts` — Task 3
- `src/accounts.ts`, `src/test/accounts.test.ts` — Task 7

**apps/web** (paths under `apps/web/`; `…/` is `src/app/(dashboard)/dashboard/accounts/[accountId]/`)

Created:
- `src/lib/consent/keywords.ts`, `keywords.test.ts`, `phrases.ts`, `phrases.test.ts` — Task 4
- `src/lib/consent/replies.ts`, `replies.test.ts` — Tasks 5, 8
- `src/lib/consent/inbound.ts`, `inbound.test.ts` — Task 8
- `src/app/api/sms/inbound/route.consent.test.ts` — Task 9
- `src/lib/consent/grants.ts`, `grants.test.ts` — Task 10
- `src/lib/ui/guarded-run.ts` (Tasks 11, 12), `src/lib/ui/guarded-run.test.ts` — Task 11
- `src/lib/consent/texts-view.ts`, `texts-view.test.ts`, `actor.ts`, `actor.test.ts`, `staff-actions.ts`, `staff-actions.test.ts`, `texts-context.ts` — Task 11
- `…/contacts/texts-actions.ts`, `src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts`, `route.test.ts` — Task 11
- `src/lib/consent/texts-row.ts`, `texts-row.test.ts`, `…/contacts/texts-row.tsx`, `…/contacts/texts-row.test.ts`, `…/contacts/[contactId]/activity-timeline.hold.test.ts` — Task 12
- `…/tasks/consent-hold-actions.tsx`, `…/tasks/work-list.consent.test.ts`, `…/contacts/[contactId]/actions.test.ts` — Task 13
- `…/checklist/actions.test.ts` — Task 7
- `e2e/consent-texts.spec.ts` — Task 15

Modified:
- `src/lib/messages.ts` (Tasks 5, 7), `src/lib/consent/copy.test.ts` — Task 5
- `src/lib/consent/classes.ts`, `classes.test.ts`, `gate.ts`, `gate.test.ts`, `composer-state.ts`, `composer-state.test.ts`, `src/lib/automations/send-sms.ts`, `send-sms.test.ts` — Task 6
- `src/lib/sms/sender.ts`, `sender.test.ts`, `…/checklist/actions.ts`, `…/checklist/a2p-panel.tsx`, `e2e/blueprints.spec.ts` — Task 7
- `src/app/api/sms/inbound/route.ts` (replaced), `route.test.ts`, `src/lib/sms/opt-out.ts` — Task 9
- `src/app/f/[publicId]/actions.ts`, `actions.test.ts`, `src/app/b/[publicId]/actions.ts`, `actions.test.ts` — Task 10
- `src/lib/contacts/marketing-optout.ts`, `marketing-optout.test.ts`, `src/lib/contacts/phone-country.ts` (Tasks 11, 12), `phone-country.test.ts`, `…/contacts/marketing-optout-switch.tsx` — Task 11 (R3-M7)
- `…/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`, `…/contacts/[contactId]/contact-fields-panel.tsx`, `…/contacts/[contactId]/page.tsx`, `…/contacts/[contactId]/page.test.ts`, `src/app/(dashboard)/dashboard/styleguide/page.tsx` — Task 12
- `…/tasks/actions.ts`, `…/tasks/actions.test.ts`, `…/tasks/work-list.tsx`, `…/calls/[callId]/page.tsx`, `…/calls/[callId]/page.test.ts`, `…/contacts/[contactId]/actions.ts` — Task 13
- `e2e/consent-phone-country.spec.ts` (PR-1's e2e, on #152's version), `…/contacts/[contactId]/activity-timeline.tsx` — Task 12
- `src/lib/consent/scans.test.ts` — Task 14

Deleted:
- `…/contacts/phone-country-row.tsx` — Task 12 (Task 11 re-points its one import first; its Check number state lives on in `texts-row.tsx`)

**repo root**

Modified:
- `docs/runbooks/a2p-registration.md` — Task 9
- `.github/workflows/ci.yml` — Task 15 (one non-secret literal in the `e2e` job)

## Task order and checkpoints

16 tasks, 3 orchestrator checkpoints, at most 3 lanes at a time. Each lane is a worktree on `feat/consent-pr2` (`.claude/worktrees/consent-pr2-<lane>`), created from the branch head at the phase's start, with `pnpm install --frozen-lockfile --prefer-offline`. Lanes commit locally, one commit per task (the message is in each task's last step), and never push. The orchestrator cherry-picks at each checkpoint, in task order.

**Phase 1** (two lanes, no shared file):
- **Lane A** (`packages/db` only): Task 1 → Task 2 → Task 3.
- **Lane B** (`apps/web` only, no database dependency): Task 4 → Task 5 → Task 6.

**Checkpoint A (orchestrator only).** Cherry-pick Tasks 1–6. On that head: both typechecks (`pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck`); the full web suite (Global Constraints), where the ONE new failure allowed is scan 2's positive control naming the three consent kinds (Task 6 Step 4 explains it; Task 8 turns it green, and Checkpoint B must see it green); the whole db suite twice with the JSON reporter, the branch's parent on the replica's `pre` and this head on `post`, then diff per-test statuses: no test may go from passed to failed; the only new failures allowed are the CI-only files (`consent-writes-live.test.ts`, `consent-tasks-live.test.ts`). Nothing goes to any Supabase project here.

**Phase 2** (up to three lanes, no shared file):
- **Lane A** (the inbound route): Task 8 → Task 9.
- **Lane B** (grants and the Texts actions): Task 10 → Task 11.
- **Lane C**: Task 7 (danlo's decision 3).
- Lanes B and C are cut from Checkpoint A's head, so they INHERIT scan 2's predicted red (Task 6 Step 4) until Lane A's Task 8 lands at Checkpoint B; their full-suite runs expect it, and it is not theirs to fix (review R3-N4).

**Checkpoint B.** Cherry-pick Tasks 7–11; the same checks, plus `pnpm --filter web lint`.

**Phase 3** (ONE lane, review I1): Task 12 → Task 13. Task 13's `consent-hold-actions.tsx` imports `runTextsAction` from Task 12's `lib/consent/texts-row.ts`, so Task 13 cannot start before Task 12 has landed. A second lane cut from Task 12's commit would start at the same moment the single lane does, and would only add a cherry-pick; one lane is the honest shape.

**Checkpoint C.** Cherry-pick Tasks 12 and 13 (one lane, in order); the same checks.

**Phase 4** (the integration branch itself, in order): Task 14 (scans) → Task 15 (e2e) → Task 16 (gates, 0055 and 0056 to CI then production, parity, the Telnyx opt-out import before any number moves, merge, Telnyx step 0, handoff).

Dependencies, in full:
- Task 1: none. Task 2: Task 1 (`readConsentActions`, `readConsentEvent`, `readConsentHistory`, `newestDecidingRow`; review M6). Task 3: Task 1 (`consentAppendSql`).
- Tasks 4, 5: none. Task 6: none (it names the three kinds itself).
- Task 7: none in code (Phase 2 only because it edits `messages.ts`, which Task 5 owns in Phase 1).
- Task 8: Tasks 1, 2, 4, 5, 6. Task 9: Task 8.
- Task 10: Task 1. Task 11: Tasks 1, 2, 4, 5.
- Task 12: Tasks 2, 5, 11 (Task 2's `holdOpenTaskIds`). Task 13: Tasks 1, 2, 5, 11, 12 (Task 12's `runTextsAction`; review I1).
- Task 14: Tasks 1–13. Task 15: Tasks 9, 11, 12, 13. Task 16: everything.

Commands run from the lane's worktree root (Git Bash) unless a step says otherwise. **How to read each task.** Step 1 writes the tests (complete files, or exact find-and-replace edits against the task's parent commit). Step 2 runs them; "Expected" is the predicted RED. Step 3 writes the implementation. Step 4 runs again; "Expected" is the predicted GREEN. Step 5's probes are applied to the finished task one at a time. A block titled "Create" is a complete new file; "Replace the whole file" is a complete new file for an existing path; "Edit" gives the exact current text to find and its replacement.

---

### Task 1: Migration 0055 (the guarded write, one row per source, `tasks.consent_event_id`) and the ledger module

**Owner:** bis-db-schema. **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `packages/db/supabase/migrations/0055_consent_writes.sql`
- Create: `packages/db/src/test/consent-writes-schema.test.ts`
- Create: `packages/db/src/test/consent-writes-live.test.ts` (CI only)
- Replace the whole file: `packages/db/src/consent.ts`
- Modify: `packages/db/src/consent.test.ts`, `packages/db/src/index.ts`, `packages/db/src/test/consent-ledger-schema.test.ts`

**Interfaces:**
- Consumes: 0054's `consent_events` (PR-1).
- Produces (all exported from `@bis/db`):
  - `type ConsentGuard = "none" | "if_empty" | "unless_customer_stopped" | "if_allowed" | "if_stopped_or_held" | { ifNewest: string | null }` (`unless_customer_stopped` refuses only while the newest deciding row is the customer's OWN stop: `CUSTOMER_STOP_METHODS`)
  - `CUSTOMER_STOP_METHODS: readonly ConsentMethod[]` = `keyword`, `carrier_block`, `backfill_telnyx`, `unsubscribe_link`, `one_click` (danlo 2026-09-28)
  - `type PriorDecidingRow = { id: string; action: ConsentAction; method: ConsentMethod; evidence: Record<string, unknown> }`
  - `type ConsentAppend = { outcome: "appended"; id: string; prior: PriorDecidingRow | null } | { outcome: "duplicate"; id: string } | { outcome: "refused"; prior: PriorDecidingRow | null }`
  - `appendConsentEventGuarded(db, e: ConsentEventInput, guard: ConsentGuard): Promise<ConsentAppend>`
  - `appendConsentEvent(db, e): Promise<{ id: string }>` (unchanged signature; now over the function, guard `none`; still refuses `hold_released`)
  - `recordCarrierBlock(db, input): Promise<"appended" | "already_stopped">` (unchanged signature; now atomic)
  - `newestDecidingRow<T extends ConsentRow>(rows: readonly T[]): T | null` (consentStateOf's own ordering, exported)
  - `type ConsentHistoryRow = ConsentRow & { evidence: Record<string, unknown>; note: string | null; actor_id: string | null }`; `readConsentHistory(db, accountId, channel, address): Promise<ConsentHistoryRow[]>`
  - `type ConsentEventRow = ConsentHistoryRow & { channel: ConsentChannel; address: string; contact_id: string | null }`; `readConsentEvent(db, accountId, id): Promise<ConsentEventRow | null>`
  - `readConsentActions(db, accountId, ids: readonly string[]): Promise<Map<string, ConsentAction>>`
  - `consentWriteArgs(e, guard): Record<string, unknown>` and `consentAppendSql(e, guard): string` (the backfill's SQL text)
  - SQL: `public.append_consent_event(p_account_id uuid, p_channel text, p_address text, p_action text, p_method text, p_guard text, p_expect_id uuid, p_contact_id uuid, p_actor_id text, p_note text, p_source_ref text, p_evidence jsonb, p_occurred_at timestamptz) returns table (outcome text, event_id uuid, prior_id uuid, prior_action text, prior_method text, prior_evidence jsonb)`; unique index `consent_events_source_once`; constraint `consent_events_account_id_id_key`; column `tasks.consent_event_id` with `tasks_consent_event_fkey` and unique index `tasks_consent_event_once`.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/consent-writes-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";

/**
 * 0055 (consent chain PR-2): the ledger's one write path, run as the role
 * that uses it. withRollback only, so it runs on the local PG18 replica
 * (`post`) as well as on the CI project.
 *
 * RED BEFORE APPLY (the replica's `pre`): every test here — the function,
 * the index, the constraint and the tasks column do not exist yet.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ADDR = "+19565550142";

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_CW_${label}_${RUN}`, `Consent writes ${label}`])).rows[0]!.id;
}

type Out = { outcome: string; event_id: string | null; prior_id: string | null; prior_action: string | null; prior_method: string | null };

/**
 * One call of the function, AS service_role (its only grantee). A refusal is
 * a returned row, not an error, so no savepoint is needed. The 2 ms sleep
 * keeps consecutive calls in different MILLISECONDS: the function orders the
 * newest row to the millisecond and then by restrictiveness (as consentStateOf
 * does), so two appends inside one millisecond would tie and the more
 * restrictive would read as newest, which is correct behaviour but not what
 * these tests are about (review R1-I1).
 */
async function append(c: Client, a: {
  account: string; action: string; method: string; guard?: string; expect?: string | null;
  address?: string; ref?: string | null; actor?: string | null; note?: string | null; at?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<Out> {
  await c.query("select pg_sleep(0.002)");
  await c.query("set local role service_role");
  try {
    const { rows: [row] } = await c.query<Out>(
      `select outcome, event_id, prior_id, prior_action, prior_method
         from public.append_consent_event($1, 'sms', $2, $3, $4, $5, $6, null, $7, $8, $9, $10::jsonb, $11)`,
      [a.account, a.address ?? ADDR, a.action, a.method, a.guard ?? "none", a.expect ?? null,
       a.actor ?? null, a.note ?? null, a.ref ?? null, JSON.stringify(a.evidence ?? {}), a.at ?? null]);
    return row!;
  } finally {
    await c.query("reset role");
  }
}

async function refusedWith(c: Client, sql: string, params: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

describe("0055 append_consent_event: who may call it", () => {
  it("EXECUTE is service_role's alone — not anon, not authenticated, not PUBLIC (mutation: drop `revoke all … from public, anon, authenticated` → authenticated keeps EXECUTE, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'service_role']) r order by r`);
      expect(rows).toEqual([{ r: "anon", x: false }, { r: "authenticated", x: false }, { r: "service_role", x: true }]);
    }));

  it("runs as its CALLER (security invoker) with an empty search_path, so it writes with service_role's own grants (mutation: security definer → prosecdef true, FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        "select prosecdef, proconfig from pg_proc where oid = 'public.append_consent_event'::regproc");
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
    }));
});

describe("0055 append_consent_event: the guards", () => {
  it("unless_customer_stopped: the customer's own stop refuses, a HELD address does not — a stop outranks a hold (mutation: `unless_customer_stopped` → `if_allowed` semantics → the held case refuses, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "us");
      const hold = await append(c, { account: a, action: "held", method: "free_text" });
      const stop = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect([hold.outcome, stop.outcome, stop.prior_action]).toEqual(["appended", "appended", "held"]);
      const again = await append(c, { account: a, action: "revoked", method: "carrier_block", guard: "unless_customer_stopped" });
      expect(again).toMatchObject({ outcome: "refused", event_id: null, prior_id: stop.event_id, prior_action: "revoked" });
    }));

  it("unless_customer_stopped: a STAFF stop does not refuse the customer's own STOP — it is recorded over it, so only the customer can lift it (danlo 2026-09-28, review R2-I3; mutation: `when 'unless_customer_stopped' then v_prior_action is distinct from 'revoked'` → the keyword stop is refused, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "usst");
      const staff = await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null });
      const own = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect(own).toMatchObject({ outcome: "appended", prior_id: staff.event_id, prior_action: "revoked", prior_method: "staff" });
      // …and once it is the customer's own, a second customer stop is refused:
      expect((await append(c, { account: a, action: "revoked", method: "backfill_telnyx", guard: "unless_customer_stopped" })).outcome).toBe("refused");
      // A confirmed free-text stop is staff's, not the customer's, so it does not refuse either:
      const b = await account(c, "usft");
      const hold = await append(c, { account: b, action: "held", method: "free_text" });
      await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: hold.event_id });
      expect((await append(c, { account: b, action: "revoked", method: "keyword", guard: "unless_customer_stopped" })).outcome).toBe("appended");
    }));

  it("if_allowed: a hold lands only on an allowed address (mutation: `when 'if_allowed' then v_prior_action is distinct from 'held'` → the hold over a keyword stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ia");
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("appended");
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("refused");
      const b = await account(c, "ib");
      await append(c, { account: b, action: "revoked", method: "keyword" });
      expect((await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("refused");
      // `held` has a state rule of its own that refuses the same priors, which
      // would mask the guard (review R1-N2). An action with NO state rule
      // leaves only the guard to refuse it:
      expect((await append(c, { account: b, action: "granted", method: "form", guard: "if_allowed" })).outcome).toBe("refused");
    }));

  it("if_stopped_or_held: START lifts a stop or a hold, and an allowed address with NO rows is refused, not appended — the plpgsql NULL guard (memory bis-plpgsql-null-guard; mutation: `if not v_ok` without coalesce → NULL is not taken and the insert runs, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "sh");
      expect((await append(c, { account: a, action: "resubscribed", method: "start_keyword", guard: "if_stopped_or_held" })).outcome).toBe("refused");
      await append(c, { account: a, action: "revoked", method: "keyword" });
      expect((await append(c, { account: a, action: "resubscribed", method: "start_keyword", guard: "if_stopped_or_held" })).outcome).toBe("appended");
    }));

  it("if_empty: any row at all, a grant included, refuses the first-text grant (mutation: test only deciding rows → a second grant appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ie");
      expect((await append(c, { account: a, action: "granted", method: "inbound_text", guard: "if_empty" })).outcome).toBe("appended");
      expect((await append(c, { account: a, action: "granted", method: "inbound_text", guard: "if_empty" })).outcome).toBe("refused");
    }));

  it("if_newest: the expected id must still be the newest deciding row, and null means 'there is none' (mutation: `v_prior_id is not distinct from p_expect_id` → `p_expect_id is null or v_prior_id = p_expect_id` → the stale null appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "in");
      // The customer's STOP then START: the address is allowed again, so a staff
      // stop is permitted by choice 19's state rule, and only the compare-and-set
      // can refuse a stale one (review R1-N1: over a stop, the state rule would
      // refuse it anyway and mask the mutation).
      await append(c, { account: a, action: "revoked", method: "keyword" });
      const start = await append(c, { account: a, action: "resubscribed", method: "start_keyword" });
      // A stale "no row yet" click, made before the STOP and the START landed:
      expect((await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null })).outcome).toBe("refused");
      // The right id:
      expect((await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: start.event_id })).outcome).toBe("appended");
      // The same id again, now stale — asked with an action no state rule touches, so only the compare-and-set answers:
      expect((await append(c, { account: a, action: "granted", method: "form", guard: "if_newest", expect: start.event_id })).outcome).toBe("refused");
    }));

  it("an unknown guard raises 22023 and writes nothing (mutation: drop the guard check → the CASE yields NULL and the call silently refuses, FAILS on the code)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ug");
      await c.query("set local role service_role");
      const e = await refusedWith(c,
        "select * from public.append_consent_event($1, 'sms', $2, 'revoked', 'keyword', 'whenever', null, null, null, null, null, '{}'::jsonb, null)", [a, ADDR]);
      await c.query("reset role");
      expect(e).toMatchObject({ code: "22023", message: expect.stringMatching(/unknown guard whenever/) });
    }));
});

describe("0055 append_consent_event: spec §3's two rules and choice 19's staff rules, whatever the guard", () => {
  it("hold_released lands only on a held address — a keyword STOP that landed in between cannot be undone by a stale release (mutation: drop the hold_released rule → the release after the stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "hr");
      const hold = await append(c, { account: a, action: "held", method: "free_text" });
      const stop = await append(c, { account: a, action: "revoked", method: "keyword", guard: "unless_customer_stopped" });
      expect((await append(c, { account: a, action: "hold_released", method: "staff", actor: "user_1", guard: "none" })).outcome).toBe("refused");
      expect((await append(c, { account: a, action: "hold_released", method: "staff", actor: "user_1", guard: "if_newest", expect: hold.event_id })).outcome).toBe("refused");
      expect(stop.outcome).toBe("appended");
      const b = await account(c, "hr2");
      const h2 = await append(c, { account: b, action: "held", method: "free_text" });
      expect((await append(c, { account: b, action: "hold_released", method: "staff", actor: "user_1", guard: "if_newest", expect: h2.event_id })).outcome).toBe("appended");
    }));

  it("held lands only on an allowed address, or as a staff undo of a free-text confirmation or a release — never over a customer's keyword STOP (mutation: drop `v_prior_method = 'free_text'` → the undo over a keyword stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "hd");
      const kw = await append(c, { account: a, action: "revoked", method: "keyword" });
      expect((await append(c, { account: a, action: "held", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: kw.event_id })).outcome).toBe("refused");
      const b = await account(c, "hd2");
      await append(c, { account: b, action: "held", method: "free_text" });
      const confirm = await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "unless_customer_stopped" });
      expect((await append(c, { account: b, action: "held", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: confirm.event_id })).outcome).toBe("appended");
    }));

  it("choice 19 at the write path: a staff stop lands only on an allowed address, a confirmed free-text stop only on a hold, a Resume only over a stop staff made, an Undo only over a staff stop — EVEN WHEN p_expect_id names the customer's own STOP (review R3-C1; mutation: delete any one of the four staff branches → its case appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "c19");
      const kw = await append(c, { account: a, action: "revoked", method: "keyword" });
      const overKw = [
        await append(c, { account: a, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "resubscribed", method: "staff", actor: "user_1", note: "asked", guard: "if_newest", expect: kw.event_id }),
        await append(c, { account: a, action: "resubscribed", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: kw.event_id }),
      ];
      expect(overKw.map((o) => o.outcome)).toEqual(["refused", "refused", "refused", "refused"]);
      // Each of the four where it belongs appends:
      const b = await account(c, "c19b");
      const stop = await append(c, { account: b, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: null });
      const undo = await append(c, { account: b, action: "resubscribed", method: "staff_undo", actor: "user_1", guard: "if_newest", expect: stop.event_id });
      const hold = await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" });
      const confirm = await append(c, { account: b, action: "revoked", method: "free_text", actor: "user_1", guard: "if_newest", expect: hold.event_id });
      const resume = await append(c, { account: b, action: "resubscribed", method: "staff", actor: "user_1", note: "Customer asked on the phone", guard: "if_newest", expect: confirm.event_id });
      expect([stop, undo, hold, confirm, resume].map((o) => o.outcome)).toEqual(["appended", "appended", "appended", "appended", "appended"]);
      // A staff stop over a HOLD is refused too: a hold is decided by Confirm stop / Not a stop, never overwritten.
      const h2 = await append(c, { account: b, action: "held", method: "free_text", guard: "if_allowed" });
      expect((await append(c, { account: b, action: "revoked", method: "staff", actor: "user_1", guard: "if_newest", expect: h2.event_id })).outcome).toBe("refused");
    }));
});

describe("0055 append_consent_event: order, idempotency and the lock", () => {
  it("rows written 2 ms apart in ONE transaction are ordered as written: occurred_at is clock_timestamp() after the lock, not now() (mutation: coalesce(p_occurred_at, now()) → both rows share the transaction's instant, the stop outranks the START, and the hold is refused, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "or");
      const one = await append(c, { account: a, action: "revoked", method: "keyword" });
      const two = await append(c, { account: a, action: "resubscribed", method: "start_keyword" });
      const { rows } = await c.query<{ id: string }>(
        "select id from consent_events where id in ($1, $2) order by occurred_at desc", [one.event_id, two.event_id]);
      expect(rows.map((r) => r.id)).toEqual([two.event_id, one.event_id]);
      expect((await append(c, { account: a, action: "held", method: "free_text", guard: "if_allowed" })).outcome).toBe("appended");
    }));

  it("the newest row is judged to the MILLISECOND, then by restrictiveness, as consentStateOf does in JavaScript: a resubscribe 0.3 ms after a stop in the same millisecond does NOT lift it (mutation: order by occurred_at itself → the resubscribe is newest and the second stop appends, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ms");
      await append(c, { account: a, action: "revoked", method: "keyword", at: "2026-09-01T10:00:00.1231Z" });
      await append(c, { account: a, action: "resubscribed", method: "start_keyword", at: "2026-09-01T10:00:00.1234Z" });
      const probe = await append(c, { account: a, action: "revoked", method: "carrier_block", guard: "unless_customer_stopped" });
      expect(probe).toMatchObject({ outcome: "refused", prior_action: "revoked" });
    }));

  it("a second write from the same source is 'duplicate' with the FIRST row's id, and appends nothing; another action from the same source is its own row (mutation: drop the source_ref check → the unique index raises 23505 instead, FAILS on the outcome)", () =>
    withRollback(async (c) => {
      const a = await account(c, "du");
      const first = await append(c, { account: a, action: "revoked", method: "keyword", ref: "msg_1" });
      const again = await append(c, { account: a, action: "revoked", method: "keyword", ref: "msg_1" });
      expect(again).toEqual({ outcome: "duplicate", event_id: first.event_id, prior_id: null, prior_action: null, prior_method: null });
      const grant = await append(c, { account: a, action: "granted", method: "inbound_text", ref: "msg_1" });
      expect(grant.outcome).toBe("appended");
      const { rows: [n] } = await c.query<{ n: number }>("select count(*)::int as n from consent_events where account_id = $1", [a]);
      expect(n!.n).toBe(2);
    }));

  it("consent_events_source_once also refuses a direct duplicate insert (23505), so a write around the function cannot double a source (mutation: drop the index → the insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ix");
      const insert = `insert into consent_events (account_id, channel, address, action, method, source_ref) values ($1, 'sms', $2, 'granted', 'form', 'sub_1')`;
      await c.query(insert, [a, ADDR]);
      expect(await refusedWith(c, insert, [a, ADDR])).toMatchObject({ code: "23505", constraint: "consent_events_source_once" });
    }));

  it("one address is written by one caller at a time: a second connection waits on the lock and times out, while another address does not wait (A2; mutation: drop pg_advisory_xact_lock → the second call on the same address returns at once, FAILS)", async () => {
    const holder = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const waiter = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    await holder.connect();
    await waiter.connect();
    const acct = "00000000-0000-4000-8000-00000000c0de";   // never inserted: every call below is refused before any insert
    const call = `select outcome from public.append_consent_event($1, 'sms', $2, 'revoked', 'staff', 'if_newest', '00000000-0000-4000-8000-000000000001'::uuid, null, 'user_1', null, null, '{}'::jsonb, null)`;
    try {
      await holder.query("begin");
      await holder.query("set local role service_role");
      expect((await holder.query<{ outcome: string }>(call, [acct, ADDR])).rows[0]!.outcome).toBe("refused");
      await waiter.query("begin");
      await waiter.query("set local role service_role");
      await waiter.query("set local lock_timeout = '300ms'");
      const waited = await waiter.query(call, [acct, ADDR]).then(() => null, (e: unknown) => e);
      expect(waited).toMatchObject({ code: "55P03" });
      await waiter.query("rollback");
      await waiter.query("begin");
      await waiter.query("set local role service_role");
      await waiter.query("set local lock_timeout = '300ms'");
      expect((await waiter.query<{ outcome: string }>(call, [acct, "+19565550199"])).rows[0]!.outcome).toBe("refused");
    } finally {
      await waiter.query("rollback").catch(() => undefined);
      await holder.query("rollback").catch(() => undefined);
      await waiter.end();
      await holder.end();
    }
  });
});

describe("0055 tasks.consent_event_id", () => {
  it("is a nullable uuid, same-account by its composite key, one To-do per ledger row (mutation: a plain FK on consent_event_id → the crossed insert succeeds, FAILS; drop tasks_consent_event_once → the second To-do inserts, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ta");
      const b = await account(c, "tb");
      const ev = await append(c, { account: a, action: "held", method: "free_text" });
      const { rows: [col] } = await c.query(
        `select data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks' and column_name = 'consent_event_id'`);
      expect(col).toEqual({ data_type: "uuid", is_nullable: "YES" });
      const insert = "insert into tasks (account_id, title, consent_event_id) values ($1, 'x', $2)";
      expect(await refusedWith(c, insert, [b, ev.event_id])).toMatchObject({ code: "23503", constraint: "tasks_consent_event_fkey" });
      await c.query(insert, [a, ev.event_id]);
      expect(await refusedWith(c, insert, [a, ev.event_id])).toMatchObject({ code: "23505", constraint: "tasks_consent_event_once" });
      await c.query("insert into tasks (account_id, title) values ($1, 'plain')", [a]);
    }));
});
```

Edit `packages/db/src/test/consent-ledger-schema.test.ts` — the index test (0054's list gains 0055's two):

Find:
```ts
  it("the address read and the contact FK's set-null are both indexed (mutation: drop consent_events_contact_idx → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'consent_events' order by indexname");
      expect(rows.map((r) => r.indexname)).toEqual(["consent_events_address_idx", "consent_events_contact_idx", "consent_events_pkey"]);
```
Replace with:
```ts
  it("the address read and the contact FK's set-null are both indexed, and 0055 adds the composite key tasks point at and one-row-per-source (mutation: drop consent_events_contact_idx → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'consent_events' order by indexname");
      expect(rows.map((r) => r.indexname)).toEqual([
        "consent_events_account_id_id_key", "consent_events_address_idx", "consent_events_contact_idx",
        "consent_events_pkey", "consent_events_source_once",
      ]);
```

Create `packages/db/src/test/consent-writes-live.test.ts` (CI only):

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEventGuarded, recordCarrierBlock, readConsentState } from "../consent";

/** 0055 through PostgREST, on the CI project only: the RPC's argument names and its answer shape as supabase-js sees them. */
describe("0055 appendConsentEventGuarded against the live function (CI only)", () => {
  it("appends, reports a retry of the same source as duplicate, refuses by guard, and recordCarrierBlock is idempotent (mutation: misname any p_ argument in consentWriteArgs → PGRST202, FAILS)", async () => {
    await withTestAccount(async (_tdb, id) => {
      const db = serviceDb();
      const e = { accountId: id, channel: "sms" as const, address: "+19565550166", action: "revoked" as const, method: "keyword" as const, sourceRef: "msg_live_1", evidence: { keyword: "STOP" } };
      const first = await appendConsentEventGuarded(db, e, "unless_customer_stopped");
      expect(first.outcome).toBe("appended");
      const again = await appendConsentEventGuarded(db, e, "unless_customer_stopped");
      expect(again).toEqual({ outcome: "duplicate", id: (first as { id: string }).id });
      expect(await recordCarrierBlock(db, { accountId: id, address: "+19565550166", contactId: null, kind: "voice.textback" })).toBe("already_stopped");
      expect(await readConsentState(db, id, "sms", "+19565550166")).toMatchObject({ state: "stopped", method: "keyword" });
      const lift = await appendConsentEventGuarded(db, { ...e, action: "resubscribed", method: "start_keyword", sourceRef: "msg_live_2" }, "if_stopped_or_held");
      expect(lift).toMatchObject({ outcome: "appended", prior: { action: "revoked", method: "keyword", evidence: { keyword: "STOP" } } });
    });
  });
});
```

Edit `packages/db/src/consent.test.ts`. Replace its import line:

Find:
```ts
import { consentStateOf, readConsentState, recordCarrierBlock, appendConsentEvent, type ConsentRow } from "./consent";
```
Replace with:
```ts
import {
  consentStateOf, readConsentState, recordCarrierBlock, appendConsentEvent, appendConsentEventGuarded,
  newestDecidingRow, readConsentHistory, readConsentEvent, readConsentActions, consentWriteArgs, consentAppendSql,
  CUSTOMER_STOP_METHODS, type ConsentRow,
} from "./consent";
```

Replace the `fakeDb` helper and everything after it (from the line `/** A PostgREST-shaped chain that records what it was asked. */` to the end of the file) with:

```ts
/** A PostgREST-shaped chain that records what it was asked; `rpc` answers the write function. */
function fakeDb(o: {
  read?: { data: unknown; error: unknown };
  single?: { data: unknown; error: unknown };
  rpc?: { data: unknown; error: unknown };
} = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["select", "eq", "in", "order"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  chain.limit = (...a: unknown[]) => { calls.push(["limit", ...a]); return Promise.resolve(o.read ?? { data: [], error: null }); };
  chain.maybeSingle = () => { calls.push(["maybeSingle"]); return Promise.resolve(o.single ?? { data: null, error: null }); };
  // readConsentActions ends at `.in(...)`: make the chain awaitable there.
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res(o.read ?? { data: [], error: null });
  const appended = { data: [{ outcome: "appended", event_id: "e1", prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null };
  const db = {
    from: (t: string) => { calls.push(["from", t]); return chain; },
    rpc: (fn: string, args: unknown) => { calls.push(["rpc", fn, args]); return Promise.resolve(o.rpc ?? appended); },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const rpcArgs = (calls: Array<[string, ...unknown[]]>) => calls.find((c) => c[0] === "rpc")?.[2] as Record<string, unknown> | undefined;

describe("readConsentState", () => {
  it("asks for the newest deciding rows of that address, newest first, and takes 20 so every row at the newest instant reaches the tie-break (review R1-M2; mutation: .limit(1) → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    expect(await readConsentState(f.db, "a1", "sms", "+19562921696")).toEqual({ state: "allowed" });
    expect(f.calls).toEqual(expect.arrayContaining([
      ["from", "consent_events"],
      ["eq", "account_id", "a1"], ["eq", "channel", "sms"], ["eq", "address", "+19562921696"],
      ["in", "action", ["revoked", "held", "hold_released", "resubscribed"]],
      ["order", "occurred_at", { ascending: false }], ["order", "id", { ascending: false }],
      ["limit", 20],
    ]));
  });

  it("THROWS on a read error (the gate fails closed on it; mutation: return allowed → FAILS)", async () => {
    const f = fakeDb({ read: { data: null, error: { message: "permission denied" } } });
    await expect(readConsentState(f.db, "a1", "sms", "+19562921696")).rejects.toThrow("readConsentState failed: permission denied");
  });

  it("orders by occurred_at BEFORE id, both descending, in exactly that sequence (review I2a; mutation: swap the two .order() calls → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readConsentState(f.db, "a1", "sms", "+19562921696");
    expect(f.calls.filter((c) => c[0] === "order")).toEqual([
      ["order", "occurred_at", { ascending: false }],
      ["order", "id", { ascending: false }],
    ]);
  });
});

describe("newestDecidingRow — consentStateOf's own order, exported for the Texts row's CAS", () => {
  it("skips grants, takes the newest instant, then the more restrictive action (mutation: return rows[0] → the older revoked row wins, FAILS)", () => {
    const stop = row("revoked", "2026-10-03T15:00:00Z", "keyword", "00000000-0000-0000-0000-00000000000a");
    const lift = row("resubscribed", "2026-10-04T15:00:00Z", "start_keyword", "00000000-0000-0000-0000-00000000000b");
    const grant = row("granted", "2026-10-05T15:00:00Z", "form", "00000000-0000-0000-0000-00000000000c");
    expect(newestDecidingRow([stop, lift, grant])?.id).toBe(lift.id);
    expect(newestDecidingRow([grant])).toBeNull();
  });
});

describe("readConsentHistory / readConsentEvent / readConsentActions", () => {
  it("history reads the same 20 newest deciding rows WITH evidence, note and actor (mutation: drop evidence from the select → FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readConsentHistory(f.db, "a1", "sms", "+19562921696");
    expect(f.calls).toEqual(expect.arrayContaining([
      ["select", "id, action, method, occurred_at, evidence, note, actor_id"],
      ["in", "action", ["revoked", "held", "hold_released", "resubscribed"]], ["limit", 20],
    ]));
  });

  it("one event is read by account AND id, so another account's id reads nothing (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb({ single: { data: null, error: null } });
    expect(await readConsentEvent(f.db, "a1", "e9")).toBeNull();
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["eq", "id", "e9"]]));
  });

  it("actions by id: no ids is no read at all; a read error throws (mutation: read with an empty list → the chain is asked, FAILS)", async () => {
    const f = fakeDb();
    expect(await readConsentActions(f.db, "a1", [])).toEqual(new Map());
    expect(f.calls).toEqual([]);
    const g = fakeDb({ read: { data: [{ id: "e1", action: "held" }], error: null } });
    expect(await readConsentActions(g.db, "a1", ["e1"])).toEqual(new Map([["e1", "held"]]));
  });
});

describe("appendConsentEventGuarded — the one write", () => {
  it("names the function and passes all thirteen arguments; a string guard has no expected id, { ifNewest } is `if_newest` with it (mutation: send { ifNewest } as its own string → FAILS)", async () => {
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "keyword" }, "unless_customer_stopped")).toEqual({
      p_account_id: "a1", p_channel: "sms", p_address: "+19565550100", p_action: "revoked", p_method: "keyword",
      p_guard: "unless_customer_stopped", p_expect_id: null, p_contact_id: null, p_actor_id: null, p_note: null,
      p_source_ref: null, p_evidence: {}, p_occurred_at: null,
    });
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+1", action: "held", method: "staff_undo", actorId: "u" }, { ifNewest: "e7" }))
      .toMatchObject({ p_guard: "if_newest", p_expect_id: "e7", p_actor_id: "u" });
    expect(consentWriteArgs({ accountId: "a1", channel: "sms", address: "+1", action: "revoked", method: "staff" }, { ifNewest: null }))
      .toMatchObject({ p_guard: "if_newest", p_expect_id: null });
    const f = fakeDb();
    await appendConsentEventGuarded(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "keyword" }, "unless_customer_stopped");
    expect(f.calls[0]?.[0]).toBe("rpc");
    expect(f.calls[0]?.[1]).toBe("append_consent_event");
  });

  it("maps each answer: appended carries the prior row, duplicate the first id, refused no id (mutation: map duplicate to appended → FAILS)", async () => {
    const prior = { prior_id: "p1", prior_action: "revoked", prior_method: "keyword", prior_evidence: { language: "es" } };
    const ok = fakeDb({ rpc: { data: [{ outcome: "appended", event_id: "e2", ...prior }], error: null } });
    expect(await appendConsentEventGuarded(ok.db, { accountId: "a", channel: "sms", address: "+1", action: "resubscribed", method: "start_keyword" }, "if_stopped_or_held"))
      .toEqual({ outcome: "appended", id: "e2", prior: { id: "p1", action: "revoked", method: "keyword", evidence: { language: "es" } } });
    const dup = fakeDb({ rpc: { data: [{ outcome: "duplicate", event_id: "e1", prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null } });
    expect(await appendConsentEventGuarded(dup.db, { accountId: "a", channel: "sms", address: "+1", action: "revoked", method: "keyword" }, "none"))
      .toEqual({ outcome: "duplicate", id: "e1" });
    const no = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: null, prior_action: null, prior_method: null, prior_evidence: null }], error: null } });
    expect(await appendConsentEventGuarded(no.db, { accountId: "a", channel: "sms", address: "+1", action: "held", method: "free_text" }, "if_allowed"))
      .toEqual({ outcome: "refused", prior: null });
  });

  it("an RPC error, no row, or an unknown answer THROWS — a write is never assumed (mutation: return refused on error → FAILS)", async () => {
    const e = { accountId: "a", channel: "sms" as const, address: "+1", action: "revoked" as const, method: "keyword" as const };
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: null, error: { message: "timeout" } } }).db, e, "none")).rejects.toThrow("append_consent_event failed: timeout");
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: [], error: null } }).db, e, "none")).rejects.toThrow("returned no row");
    await expect(appendConsentEventGuarded(fakeDb({ rpc: { data: [{ outcome: "maybe" }], error: null } }).db, e, "none")).rejects.toThrow("unexpected answer");
  });

  it("refuses an occurredAt that does not parse to a finite date, without writing (mutation: drop the parse-guard → the rpc runs, FAILS)", async () => {
    const f = fakeDb();
    await expect(appendConsentEventGuarded(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "revoked", method: "carrier_block", occurredAt: "infinity" }, "none"))
      .rejects.toThrow("occurredAt does not parse to a finite date");
    expect(f.calls.some((c) => c[0] === "rpc")).toBe(false);
  });
});

describe("appendConsentEvent — the unguarded wrapper", () => {
  it("refuses hold_released outright: that row is written only with { ifNewest } on the hold (mutation: drop the refusal → the rpc runs with guard none, FAILS)", async () => {
    const f = fakeDb();
    await expect(appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "hold_released", method: "staff", actorId: "user_1" }))
      .rejects.toThrow("hold_released is written only by appendConsentEventGuarded");
    expect(f.calls.some((c) => c[0] === "rpc")).toBe(false);
  });

  it("writes with guard none and throws when the function refused, naming what it refused after (mutation: return a fake id on refusal → FAILS)", async () => {
    const f = fakeDb();
    expect(await appendConsentEvent(f.db, { accountId: "a1", channel: "sms", address: "+19565550100", action: "granted", method: "form" })).toEqual({ id: "e1" });
    expect(rpcArgs(f.calls)).toMatchObject({ p_guard: "none", p_action: "granted" });
    const g = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: "p", prior_action: "revoked", prior_method: "keyword", prior_evidence: {} }], error: null } });
    await expect(appendConsentEvent(g.db, { accountId: "a1", channel: "sms", address: "+1", action: "held", method: "free_text" }))
      .rejects.toThrow("refused (held after revoked)");
  });
});

describe("CUSTOMER_STOP_METHODS", () => {
  it("is exactly the five stops only the customer can lift, the same list 0055's unless_customer_stopped carries (choice 19; mutation: drop 'backfill_telnyx' → FAILS)", () => {
    expect([...CUSTOMER_STOP_METHODS].sort()).toEqual(["backfill_telnyx", "carrier_block", "keyword", "one_click", "unsubscribe_link"]);
  });
});

describe("recordCarrierBlock", () => {
  it("appends revoked / carrier_block with the kind as evidence, guarded unless_customer_stopped (mutation: guard 'none' → FAILS)", async () => {
    const f = fakeDb();
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: "c1", kind: "voice.textback" })).toBe("appended");
    expect(rpcArgs(f.calls)).toMatchObject({ p_account_id: "a1", p_channel: "sms", p_address: "+19562921696", p_action: "revoked",
      p_method: "carrier_block", p_contact_id: "c1", p_evidence: { kind: "voice.textback" }, p_guard: "unless_customer_stopped" });
  });

  it("an address already stopped is 'already_stopped', decided inside the function's lock (spec §4.3 idempotency; mutation: map refused to appended → FAILS)", async () => {
    const f = fakeDb({ rpc: { data: [{ outcome: "refused", event_id: null, prior_id: "p", prior_action: "revoked", prior_method: "keyword", prior_evidence: {} }], error: null } });
    expect(await recordCarrierBlock(f.db, { accountId: "a1", address: "+19562921696", contactId: null, kind: "voice.textback" })).toBe("already_stopped");
  });
});

describe("consentAppendSql — the backfill's statement", () => {
  it("calls the function once with every argument a typed literal, quotes doubled (mutation: skip the quote doubling → the O'Brien name breaks out of its literal, FAILS)", () => {
    const sql = consentAppendSql({
      accountId: "11111111-1111-4111-8111-111111111111", channel: "sms", address: "+19565550100", action: "revoked",
      method: "backfill_telnyx", sourceRef: "telnyx_optout:+19565550000:+19565550100", occurredAt: "2026-04-28T12:00:38Z",
      evidence: { keyword: "STOP", note: "O'Brien" },
    }, "unless_customer_stopped");
    expect(sql).toBe(
      "select outcome, event_id from public.append_consent_event(" +
      "'11111111-1111-4111-8111-111111111111'::uuid, 'sms'::text, '+19565550100'::text, 'revoked'::text, 'backfill_telnyx'::text, " +
      "'unless_customer_stopped'::text, null::uuid, null::uuid, null::text, null::text, 'telnyx_optout:+19565550000:+19565550100'::text, " +
      "'{\"keyword\":\"STOP\",\"note\":\"O''Brien\"}'::jsonb, '2026-04-28T12:00:38Z'::timestamptz);");
  });

  it("refuses a value that would carry a backslash into the MCP (memory bis-mcp-sql-escapes; mutation: drop the backslash check → the statement is returned, FAILS)", () => {
    expect(() => consentAppendSql({ accountId: "a", channel: "sms", address: "+1", action: "revoked", method: "backfill_telnyx", evidence: { keyword: "ST\"OP" } }, "unless_customer_stopped"))
      .toThrow("backslash");
  });
});
```

(The first `describe("consentStateOf — spec §3's table", …)` block and its `row` helper, lines 10–82 of today's file, stay exactly as they are.)

Edit `packages/db/src/index.ts`:

Find:
```ts
export { consentStateOf, readConsentState, appendConsentEvent, recordCarrierBlock,
         CONSENT_METHODS, DECIDING_ACTIONS,
         type ConsentChannel, type ConsentAction, type ConsentMethod, type ConsentRow,
         type ConsentState, type ConsentEventInput } from "./consent";
```
Replace with:
```ts
export { consentStateOf, readConsentState, appendConsentEvent, recordCarrierBlock,
         appendConsentEventGuarded, newestDecidingRow, readConsentHistory, readConsentEvent,
         readConsentActions, consentWriteArgs, consentAppendSql,
         CONSENT_METHODS, DECIDING_ACTIONS, CUSTOMER_STOP_METHODS,
         type ConsentChannel, type ConsentAction, type ConsentMethod, type ConsentRow,
         type ConsentState, type ConsentEventInput, type ConsentGuard, type ConsentAppend,
         type PriorDecidingRow, type ConsentHistoryRow, type ConsentEventRow } from "./consent";
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd packages/db
pnpm exec vitest run src/consent.test.ts
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/pre pnpm exec vitest run src/test/consent-writes-schema.test.ts src/test/consent-ledger-schema.test.ts
```

Expected (predicted; not replayed): `consent.test.ts` fails to import (the new exports do not exist). On `pre`, every test in `consent-writes-schema.test.ts` fails (the function, the index, the constraint and the column are missing), and `consent-ledger-schema.test.ts`'s index test fails on the two missing names; its other 17 tests pass (the file has 18 on `76c6acfb`).

- [ ] **Step 3: Write the migration and the module**

Create `packages/db/supabase/migrations/0055_consent_writes.sql`:

```sql
-- 0055_consent_writes.sql
-- Consent chain PR-2 (docs/superpowers/specs/2026-09-26-consent-chain-design.md
-- sections 3 and 4.2; plan docs/superpowers/plans/2026-09-28-consent-pr2-keywords-holds-controls.md).
--
-- ADDITIVE ONLY. The build before this file runs unchanged against it: it
-- never calls the new function, never writes the new tasks column, and its
-- one ledger writer (the gate's carrier_block) writes no source_ref, which the
-- new unique index ignores. So production takes this file BEFORE the merge
-- deploy, and the build after it can rely on it from its first request.
--
-- 1. public.append_consent_event: the ledger's ONE write path from PR-2 on.
--    Under a per-address advisory lock it reads the address's newest deciding
--    row, applies the caller's guard, spec section 3's two rules (a
--    hold_released only while held; a held only while allowed, or as a staff
--    undo of a hold's resolution) and choice 19's staff rules (below), and
--    inserts with occurred_at = clock_timestamp() taken AFTER the lock. The
--    newest row is ordered as consentStateOf orders it in
--    packages/db/src/consent.ts: occurred_at to the MILLISECOND (the precision
--    of JavaScript's Date.parse), then the more restrictive action, then the
--    larger id, so the function and the reducer never disagree. Two writes to
--    one address inside the same millisecond therefore tie on time and the
--    more restrictive reads as newest (a stop written 0.4 ms before a START
--    still stands): that errs toward sending less, on purpose.
--    Choice 19 (staff can lift only a stop staff made), enforced here and not
--    only in the app: a staff 'revoked' lands only on an allowed address; a
--    confirmed free-text stop ('revoked' / 'free_text') only on a hold; a
--    staff Resume ('resubscribed' / 'staff') only over a stop whose method is
--    staff, free_text or backfill_0049; a staff undo of a stop
--    ('resubscribed' / 'staff_undo') only over a staff stop. Without these a
--    caller who knows the id of a customer's own STOP could stop over it and
--    then undo its own stop (plan review R3-C1).
--    The guard unless_customer_stopped refuses only while the newest deciding
--    row is the customer's OWN stop (keyword, carrier_block, backfill_telnyx,
--    unsubscribe_link, one_click): a customer's STOP over a staff stop is
--    recorded, so only the customer can lift it (danlo, 2026-09-28).
--    SECURITY INVOKER: it writes with its caller's own grants, and EXECUTE is
--    service_role's alone (0054 gives service_role SELECT and INSERT on the
--    ledger; no role holds UPDATE or DELETE). A retried write from the same
--    source (a webhook's message id, a form submission, a booking, a backfill
--    row) answers 'duplicate' with the first row's id and writes nothing.
-- 2. consent_events_source_once: one row per address, action and source. A
--    source_ref names ONE delivery or event (a message id, a form submission,
--    a booking, one Telnyx opt-out at its own time), never a reusable channel
--    such as a token or an address: a reused source would read as a retry
--    forever, and a second real stop from it would be dropped as 'duplicate'.
-- 3. consent_events_account_id_id_key and tasks.consent_event_id: a To-do
--    names the hold or stop it asks about, same-account by construction
--    (0050's composite pattern), one To-do per ledger row.
--
-- tasks keeps its table-level grants (authenticated INSERT, UPDATE, DELETE;
-- schema-grants-guard.test.ts pins them), so the new column is
-- client-writable like every other tasks column. The composite key means a
-- client can only link its own account's task to its own account's ledger
-- row, and nothing trusts the link: the To-do's buttons re-read the ledger and
-- act through this function.
--
-- No backslash anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first; the build after this file calls the function):
--   drop function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz);
--   drop index public.tasks_consent_event_once;
--   alter table public.tasks drop column consent_event_id;
--   alter table public.consent_events drop constraint consent_events_account_id_id_key;
--   drop index public.consent_events_source_once;

set local lock_timeout = '5s';

create unique index consent_events_source_once
  on public.consent_events (account_id, channel, address, action, source_ref)
  where source_ref is not null;

alter table public.consent_events
  add constraint consent_events_account_id_id_key unique (account_id, id);

alter table public.tasks add column consent_event_id uuid;
alter table public.tasks add constraint tasks_consent_event_fkey
  foreign key (account_id, consent_event_id) references public.consent_events (account_id, id)
  on delete set null (consent_event_id);
create unique index tasks_consent_event_once
  on public.tasks (consent_event_id) where consent_event_id is not null;

comment on column public.tasks.consent_event_id is
  'The consent_events row this To-do asks about (a free-text hold to confirm, or a CANCEL stop whose appointment to check). One To-do per row. Written by the inbound SMS route as the service role.';

create function public.append_consent_event(
  p_account_id uuid, p_channel text, p_address text, p_action text, p_method text,
  p_guard text, p_expect_id uuid,
  p_contact_id uuid, p_actor_id text, p_note text, p_source_ref text,
  p_evidence jsonb, p_occurred_at timestamptz
)
returns table (outcome text, event_id uuid, prior_id uuid, prior_action text, prior_method text, prior_evidence jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prior_id uuid;
  v_prior_action text;
  v_prior_method text;
  v_prior_evidence jsonb;
  v_dup uuid;
  v_ok boolean;
  v_id uuid;
begin
  if p_guard is null or p_guard not in ('none', 'if_empty', 'unless_customer_stopped', 'if_allowed', 'if_stopped_or_held', 'if_newest') then
    raise exception 'append_consent_event: unknown guard %', coalesce(p_guard, 'null') using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text || '|' || p_channel || '|' || p_address, 0));

  if p_source_ref is not null then
    select e.id into v_dup
      from public.consent_events e
     where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address
       and e.action = p_action and e.source_ref = p_source_ref;
    if v_dup is not null then
      return query select 'duplicate'::text, v_dup, null::uuid, null::text, null::text, null::jsonb;
      return;
    end if;
  end if;

  select e.id, e.action, e.method, e.evidence
    into v_prior_id, v_prior_action, v_prior_method, v_prior_evidence
    from public.consent_events e
   where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address
     and e.action in ('revoked', 'held', 'hold_released', 'resubscribed')
   order by pg_catalog.date_trunc('milliseconds', e.occurred_at) desc,
            case e.action when 'revoked' then 3 when 'held' then 2 else 1 end desc,
            e.id desc
   limit 1;

  v_ok := case p_guard
    when 'none' then true
    when 'if_empty' then not exists (
      select 1 from public.consent_events e
       where e.account_id = p_account_id and e.channel = p_channel and e.address = p_address)
    when 'unless_customer_stopped' then v_prior_action is distinct from 'revoked'
      or v_prior_method not in ('keyword', 'carrier_block', 'backfill_telnyx', 'unsubscribe_link', 'one_click')
    when 'if_allowed' then v_prior_action is null or v_prior_action in ('hold_released', 'resubscribed')
    when 'if_stopped_or_held' then v_prior_action in ('revoked', 'held')
    when 'if_newest' then v_prior_id is not distinct from p_expect_id
  end;

  if p_action = 'hold_released' then
    v_ok := v_ok and v_prior_action = 'held';
  elsif p_action = 'held' then
    v_ok := v_ok and (
      v_prior_action is null
      or v_prior_action in ('hold_released', 'resubscribed')
      or (p_method = 'staff_undo' and p_guard = 'if_newest'
          and ((v_prior_action = 'revoked' and v_prior_method = 'free_text') or v_prior_action = 'hold_released')));
  elsif p_action = 'revoked' and p_method = 'staff' then
    v_ok := v_ok and (v_prior_action is null or v_prior_action in ('hold_released', 'resubscribed'));
  elsif p_action = 'revoked' and p_method = 'free_text' then
    v_ok := v_ok and v_prior_action = 'held';
  elsif p_action = 'resubscribed' and p_method = 'staff' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method in ('staff', 'free_text', 'backfill_0049');
  elsif p_action = 'resubscribed' and p_method = 'staff_undo' then
    v_ok := v_ok and v_prior_action = 'revoked' and v_prior_method = 'staff';
  end if;

  -- coalesce is load-bearing: `v_prior_action in (...)` is NULL, not false,
  -- when the address has no deciding row, and `if not NULL` is not taken
  -- (memory bis-plpgsql-null-guard).
  if not coalesce(v_ok, false) then
    return query select 'refused'::text, null::uuid, v_prior_id, v_prior_action, v_prior_method, v_prior_evidence;
    return;
  end if;

  insert into public.consent_events
    (account_id, channel, address, action, method, contact_id, actor_id, note, source_ref, evidence, occurred_at)
  values
    (p_account_id, p_channel, p_address, p_action, p_method, p_contact_id, p_actor_id, p_note, p_source_ref,
     coalesce(p_evidence, '{}'::jsonb), coalesce(p_occurred_at, pg_catalog.clock_timestamp()))
  returning id into v_id;

  return query select 'appended'::text, v_id, v_prior_id, v_prior_action, v_prior_method, v_prior_evidence;
end;
$$;

comment on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz) is
  'The consent ledger''s one write path (0055). Per-address advisory lock; guard none, if_empty, unless_customer_stopped (refused only over the customer''s own stop), if_allowed, if_stopped_or_held or if_newest (p_expect_id: the newest deciding row the caller saw, null for none); hold_released only while held; held only while allowed or as a staff undo; staff stop only while allowed, confirmed free-text stop only while held, staff Resume only over a staff-made stop, staff undo only over a staff stop (choice 19). A source_ref names one delivery or event, never a reusable channel. Answers appended, duplicate (same address, action and source_ref) or refused, with the prior newest deciding row. Called only from packages/db/src/consent.ts.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
revoke all on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)
  to service_role;
```

Replace the whole file `packages/db/src/consent.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The consent ledger (0054, consent chain spec §3): append-only, per
 * account, keyed on the normalised address (E.164 for SMS, the lowercased
 * address for email). THE ONLY MODULE THAT NAMES `consent_events` OR ITS
 * WRITE FUNCTION (source scan 3, apps/web's lib/consent/scans.test.ts).
 *
 * From PR-2 every write goes through `public.append_consent_event` (0055):
 * under a per-address lock it reads the newest deciding row, applies the
 * caller's guard and spec §3's two rules, and inserts. No role holds UPDATE
 * or DELETE on the table.
 */
export type ConsentChannel = "sms" | "email";
export type ConsentAction = "granted" | "revoked" | "held" | "hold_released" | "resubscribed";
export const CONSENT_METHODS = [
  "keyword", "start_keyword", "free_text", "staff", "staff_undo", "carrier_block",
  "unsubscribe_link", "one_click", "unsubscribe_page", "form", "booking", "inbound_text",
  "backfill_0049", "backfill_telnyx",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/** The rows that decide the state. `granted` is evidence only and never does (choice 28). */
export const DECIDING_ACTIONS = ["revoked", "held", "hold_released", "resubscribed"] as const satisfies readonly ConsentAction[];

type DecidingAction = (typeof DECIDING_ACTIONS)[number];

/** On an `occurred_at` tie the more restrictive row wins: a stop outranks a
 *  hold, a hold outranks a lift. Never the uuid's accident (review R1-M2).
 *  0055's function orders by the same three keys. */
const RESTRICTIVENESS: Record<DecidingAction, number> = { revoked: 3, held: 2, hold_released: 1, resubscribed: 1 };

/** How many of an address's newest deciding rows a read takes: every row that
 *  shares the newest instant, with room to spare. */
const NEWEST_ROWS = 20;

/** The ledger's write function (0055). Named here and nowhere else. */
const WRITE_FUNCTION = "append_consent_event";

export type ConsentRow = {
  id: string; action: ConsentAction; method: ConsentMethod; occurred_at: string;
};

export type ConsentState =
  | { state: "allowed" }
  | { state: "stopped"; since: string; method: ConsentMethod; eventId: string }
  | { state: "held"; since: string; method: ConsentMethod; eventId: string };

/**
 * The newest DECIDING row: `occurred_at` compared as instants (Date.parse,
 * millisecond precision), then the more restrictive action, then the larger
 * id. `granted` rows are skipped wherever they sort. 0055's function orders
 * by the same keys, truncating `occurred_at` to the millisecond, so the two
 * can never disagree about which row is newest.
 */
export function newestDecidingRow<T extends ConsentRow>(rows: readonly T[]): T | null {
  const deciding = rows.filter((r) => (DECIDING_ACTIONS as readonly string[]).includes(r.action));
  deciding.sort((a, b) => {
    const t = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    if (t !== 0) return t;
    const r = RESTRICTIVENESS[b.action as DecidingAction] - RESTRICTIVENESS[a.action as DecidingAction];
    return r !== 0 ? r : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
  return deciding[0] ?? null;
}

/**
 * Spec §3's table, pure: none / `hold_released` / `resubscribed` → allowed;
 * `revoked` → stopped; `held` → held. Compared as instants, never as strings:
 * PostgREST and a backfill can spell the same moment differently.
 */
export function consentStateOf(rows: readonly ConsentRow[]): ConsentState {
  const newest = newestDecidingRow(rows);
  if (!newest || newest.action === "hold_released" || newest.action === "resubscribed") return { state: "allowed" };
  return {
    state: newest.action === "revoked" ? "stopped" : "held",
    since: newest.occurred_at, method: newest.method, eventId: newest.id,
  };
}

/**
 * One address's state. THROWS on a read error: the send gate turns that into
 * `blocked: ledger_unavailable` (fails closed, §4.1).
 */
export async function readConsentState(
  db: SupabaseClient, accountId: string, channel: ConsentChannel, address: string,
): Promise<ConsentState> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at")
    .eq("account_id", accountId).eq("channel", channel).eq("address", address)
    .in("action", [...DECIDING_ACTIONS])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(NEWEST_ROWS);
  if (error) throw new Error(`readConsentState failed: ${error.message}`);
  return consentStateOf((data ?? []) as ConsentRow[]);
}

/** A deciding row with what the Texts row and the staff actions show and check. */
export type ConsentHistoryRow = ConsentRow & {
  evidence: Record<string, unknown>; note: string | null; actor_id: string | null;
};

/** The same newest deciding rows as `readConsentState`, WITH evidence, note and actor. THROWS on a read error. */
export async function readConsentHistory(
  db: SupabaseClient, accountId: string, channel: ConsentChannel, address: string,
): Promise<ConsentHistoryRow[]> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at, evidence, note, actor_id")
    .eq("account_id", accountId).eq("channel", channel).eq("address", address)
    .in("action", [...DECIDING_ACTIONS])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(NEWEST_ROWS);
  if (error) throw new Error(`readConsentHistory failed: ${error.message}`);
  return (data ?? []) as ConsentHistoryRow[];
}

export type ConsentEventRow = ConsentHistoryRow & {
  channel: ConsentChannel; address: string; contact_id: string | null;
};

/** One row, by account AND id (another account's id reads nothing). THROWS on a read error. */
export async function readConsentEvent(
  db: SupabaseClient, accountId: string, id: string,
): Promise<ConsentEventRow | null> {
  const { data, error } = await db.from("consent_events")
    .select("id, action, method, occurred_at, evidence, note, actor_id, channel, address, contact_id")
    .eq("account_id", accountId).eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`readConsentEvent failed: ${error.message}`);
  return (data as ConsentEventRow | null) ?? null;
}

/** Each row's action, by id, for the To-do rows that link one (work-queue.ts). No ids, no read. */
export async function readConsentActions(
  db: SupabaseClient, accountId: string, ids: readonly string[],
): Promise<Map<string, ConsentAction>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("consent_events")
    .select("id, action")
    .eq("account_id", accountId).in("id", [...ids]);
  if (error) throw new Error(`readConsentActions failed: ${error.message}`);
  return new Map(((data ?? []) as { id: string; action: ConsentAction }[]).map((r) => [r.id, r.action]));
}

export type ConsentEventInput = {
  accountId: string;
  channel: ConsentChannel;
  address: string;
  action: ConsentAction;
  method: ConsentMethod;
  contactId?: string | null;
  actorId?: string | null;
  note?: string | null;
  sourceRef?: string | null;
  evidence?: Record<string, unknown>;
  occurredAt?: string;
};

/**
 * The guard the function applies inside its lock:
 * - `none`: always (spec §3's two rules still apply);
 * - `if_empty`: the address has no row at all, a grant included (the first-text grant);
 * - `unless_customer_stopped`: the newest deciding row is not the CUSTOMER'S OWN stop
 *   (`CUSTOMER_STOP_METHODS`). A staff stop or a confirmed free-text stop does not
 *   refuse it: the customer's STOP is recorded over it, so only the customer can
 *   lift it (choice 19; danlo 2026-09-28);
 * - `if_allowed`: no deciding row, or a lift (a free-text hold);
 * - `if_stopped_or_held`: a stop or a hold (START);
 * - `{ ifNewest }`: the newest deciding row is exactly this one, `null` meaning
 *   there is none (every staff action: a stale click is refused, never applied).
 */
export type ConsentGuard =
  | "none" | "if_empty" | "unless_customer_stopped" | "if_allowed" | "if_stopped_or_held"
  | { ifNewest: string | null };

/** The stops only the customer can lift (choice 19). 0055's `unless_customer_stopped` carries the same list. */
export const CUSTOMER_STOP_METHODS: readonly ConsentMethod[] = ["keyword", "carrier_block", "backfill_telnyx", "unsubscribe_link", "one_click"];

export type PriorDecidingRow = {
  id: string; action: ConsentAction; method: ConsentMethod; evidence: Record<string, unknown>;
};

export type ConsentAppend =
  | { outcome: "appended"; id: string; prior: PriorDecidingRow | null }
  | { outcome: "duplicate"; id: string }
  | { outcome: "refused"; prior: PriorDecidingRow | null };

type WriteAnswer = {
  outcome: string; event_id: string | null;
  prior_id: string | null; prior_action: ConsentAction | null; prior_method: ConsentMethod | null;
  prior_evidence: Record<string, unknown> | null;
};

function assertOccurredAt(occurredAt: string | undefined): void {
  // The table's own CHECK (consent_events_occurred_at_sane) refuses a future
  // or infinite occurred_at too, but only after a round trip; refuse here,
  // without writing, the moment it cannot even parse to a finite instant.
  if (occurredAt !== undefined && !Number.isFinite(Date.parse(occurredAt))) {
    throw new Error(`appendConsentEvent: occurredAt does not parse to a finite date: ${occurredAt}`);
  }
}

/** The function's thirteen arguments, by name (PostgREST matches on the names). */
export function consentWriteArgs(e: ConsentEventInput, guard: ConsentGuard): Record<string, unknown> {
  return {
    p_account_id: e.accountId, p_channel: e.channel, p_address: e.address,
    p_action: e.action, p_method: e.method,
    p_guard: typeof guard === "string" ? guard : "if_newest",
    p_expect_id: typeof guard === "string" ? null : guard.ifNewest,
    p_contact_id: e.contactId ?? null, p_actor_id: e.actorId ?? null, p_note: e.note ?? null,
    p_source_ref: e.sourceRef ?? null, p_evidence: e.evidence ?? {}, p_occurred_at: e.occurredAt ?? null,
  };
}

/** THE write. THROWS on an RPC error or an answer it does not know: a write is never assumed. */
export async function appendConsentEventGuarded(
  db: SupabaseClient, e: ConsentEventInput, guard: ConsentGuard,
): Promise<ConsentAppend> {
  assertOccurredAt(e.occurredAt);
  const { data, error } = await db.rpc(WRITE_FUNCTION, consentWriteArgs(e, guard));
  if (error) throw new Error(`append_consent_event failed: ${error.message}`);
  const answer = (Array.isArray(data) ? data[0] : data) as WriteAnswer | undefined;
  if (!answer) throw new Error("append_consent_event returned no row");
  const prior: PriorDecidingRow | null = answer.prior_id && answer.prior_action && answer.prior_method
    ? { id: answer.prior_id, action: answer.prior_action, method: answer.prior_method, evidence: answer.prior_evidence ?? {} }
    : null;
  if (answer.outcome === "appended" && answer.event_id) return { outcome: "appended", id: answer.event_id, prior };
  if (answer.outcome === "duplicate" && answer.event_id) return { outcome: "duplicate", id: answer.event_id };
  if (answer.outcome === "refused") return { outcome: "refused", prior };
  throw new Error(`append_consent_event: unexpected answer ${JSON.stringify(answer.outcome)}`);
}

/**
 * An unguarded append (guard `none`), for the writers that need no guard: the
 * PR-1 live test and grants. `hold_released` is refused outright: it is
 * written only by `appendConsentEventGuarded` with `{ ifNewest: <the hold> }`.
 * THROWS when the function refused (spec §3's rules still apply).
 */
export async function appendConsentEvent(db: SupabaseClient, e: ConsentEventInput): Promise<{ id: string }> {
  if (e.action === "hold_released") {
    throw new Error("appendConsentEvent: hold_released is written only by appendConsentEventGuarded with { ifNewest: <the held row> }");
  }
  const r = await appendConsentEventGuarded(db, e, "none");
  if (r.outcome === "refused") {
    throw new Error(`appendConsentEvent: refused (${e.action} after ${r.prior?.action ?? "no row"})`);
  }
  return { id: r.id };
}

/**
 * The carrier refused a send because the number opted out (gate step 9).
 * Appends `revoked` / `carrier_block` unless the address is ALREADY stopped,
 * decided inside the function's lock, so two refusals at once write one row.
 */
export async function recordCarrierBlock(
  db: SupabaseClient,
  input: { accountId: string; address: string; contactId: string | null; kind: string },
): Promise<"appended" | "already_stopped"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: input.accountId, channel: "sms", address: input.address,
    action: "revoked", method: "carrier_block", contactId: input.contactId,
    evidence: { kind: input.kind },
  }, "unless_customer_stopped");
  return r.outcome === "appended" ? "appended" : "already_stopped";
}

/**
 * The same write as ONE SQL statement, for a one-off backfill the
 * orchestrator runs through the Supabase MCP (never the app). Every value is
 * a typed literal with its quotes doubled; a statement that would carry a
 * backslash is refused, because the MCP mangles backslash escapes (memory
 * bis-mcp-sql-escapes).
 */
export function consentAppendSql(e: ConsentEventInput, guard: ConsentGuard): string {
  assertOccurredAt(e.occurredAt);
  const a = consentWriteArgs(e, guard);
  const lit = (v: unknown, type: string) =>
    v === null || v === undefined ? `null::${type}` : `'${(typeof v === "string" ? v : JSON.stringify(v)).split("'").join("''")}'::${type}`;
  const sql = `select outcome, event_id from public.${WRITE_FUNCTION}(` + [
    lit(a.p_account_id, "uuid"), lit(a.p_channel, "text"), lit(a.p_address, "text"), lit(a.p_action, "text"),
    lit(a.p_method, "text"), lit(a.p_guard, "text"), lit(a.p_expect_id, "uuid"), lit(a.p_contact_id, "uuid"),
    lit(a.p_actor_id, "text"), lit(a.p_note, "text"), lit(a.p_source_ref, "text"), lit(a.p_evidence, "jsonb"),
    lit(a.p_occurred_at, "timestamptz"),
  ].join(", ") + ");";
  if (sql.includes(String.fromCharCode(0x5c))) throw new Error("consentAppendSql: a value carries a backslash, which the MCP would mangle");
  return sql;
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd packages/db
pnpm exec vitest run src/consent.test.ts
pnpm exec tsc --noEmit
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/consent-writes-schema.test.ts src/test/consent-ledger-schema.test.ts
```

Expected (predicted; not replayed): `consent.test.ts` all pass (the unchanged consentStateOf block plus the new blocks); `tsc` exit 0; on `post`, `consent-writes-schema.test.ts` and `consent-ledger-schema.test.ts` all pass. Then the full web suite (Global Constraints) — `apps/web` imports `appendConsentEvent`/`recordCarrierBlock` only through mocked factories, so nothing there changes.

- [ ] **Step 5: Probes** (apply one at a time to the finished task; each must turn the named test red)

| # | Mutation | Must fail |
|---|---|---|
| 1 | 0055: drop `from public, anon, authenticated` from the revoke (revoke from service_role only) | "EXECUTE is service_role's alone" |
| 2 | 0055: `security definer` | "runs as its CALLER" |
| 3 | 0055: `if not v_ok` (no coalesce) | "if_stopped_or_held: … NULL guard" |
| 4 | 0055: `when 'if_newest' then p_expect_id is null or v_prior_id = p_expect_id` | "if_newest: …" |
| 5 | 0055: delete the `if p_action = 'hold_released'` branch | "hold_released lands only on a held address" |
| 6 | 0055: drop `and v_prior_method = 'free_text'` | "held lands only on an allowed address …" |
| 7 | 0055: `coalesce(p_occurred_at, now())` | "rows written 2 ms apart in ONE transaction are ordered as written …" |
| 8 | 0055: `order by e.occurred_at desc, …` (no date_trunc) | "the newest row is judged to the MILLISECOND" |
| 9 | 0055: delete the `if p_source_ref is not null` block | "a second write from the same source is 'duplicate'" |
| 10 | 0055: drop `consent_events_source_once` | "consent_events_source_once also refuses …" and the index-list test |
| 11 | 0055: delete the `perform pg_advisory_xact_lock(…)` | "one address is written by one caller at a time" |
| 12 | 0055: a plain `foreign key (consent_event_id) references public.consent_events (id)` (the id is the primary key, so nothing else is needed) | "tasks.consent_event_id …" |
| 13 | consent.ts: `p_guard: "if_newest"` → `JSON.stringify(guard)` for objects | "names the function and passes all thirteen arguments" |
| 14 | consent.ts: map `duplicate` to `{ outcome: "appended", id, prior: null }` | "maps each answer" |
| 15 | consent.ts: `recordCarrierBlock` with guard `"none"` | "appends revoked / carrier_block … guarded unless_customer_stopped" |
| 16 | consent.ts: delete the `.split("'").join("''")` | "calls the function once with every argument a typed literal" |
| 17 | consent.ts: `readConsentEvent` without `.eq("account_id", …)` | "one event is read by account AND id" |
| 18 | 0055: delete the `elsif p_action = 'revoked' and p_method = 'staff'` branch | "choice 19 at the write path …" |
| 19 | 0055: delete the `elsif p_action = 'revoked' and p_method = 'free_text'` branch | "choice 19 at the write path …" |
| 20 | 0055: delete the `elsif p_action = 'resubscribed' and p_method = 'staff'` branch | "choice 19 at the write path …" |
| 21 | 0055: delete the `elsif p_action = 'resubscribed' and p_method = 'staff_undo'` branch | "choice 19 at the write path …" |
| 22 | 0055: `when 'unless_customer_stopped' then v_prior_action is distinct from 'revoked'` (drop the method half) | "unless_customer_stopped: a STAFF stop does not refuse …" |
| 23 | 0055: `when 'if_allowed' then v_prior_action is distinct from 'held'` | "if_allowed: a hold lands only on an allowed address" |

SQL probes run on the replica's `post` (`create or replace function …` with the change, then the test file, then rebuild `post`). Record each row's red tests in the task report.

- [ ] **Step 6: Commit (locally; never push)**

```bash
git add packages/db/supabase/migrations/0055_consent_writes.sql packages/db/src/consent.ts packages/db/src/consent.test.ts \
  packages/db/src/index.ts packages/db/src/test/consent-writes-schema.test.ts packages/db/src/test/consent-writes-live.test.ts \
  packages/db/src/test/consent-ledger-schema.test.ts
git commit -m "feat(consent): 0055, the ledger's one guarded write (per-address lock, one row per source) and tasks.consent_event_id"
```

---

### Task 2: The To-do, booking and work-queue helpers for consent

**Owner:** bis-crm. **Tier:** MEDIUM. **Questions:** none.

**Files:**
- Modify: `packages/db/src/activities.ts`, `packages/db/src/booking.ts`, `packages/db/src/work-queue.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/consent-tasks.test.ts`
- Create: `packages/db/src/test/consent-tasks-live.test.ts` (CI only)

**Interfaces:**
- Consumes: Task 1's `readConsentActions`, `readConsentEvent`, `readConsentHistory`, `newestDecidingRow` (the hold guard), `tasks.consent_event_id`, `tasks_consent_event_once`.
- Produces (exported from `@bis/db`):
  - `ensureConsentTask(db, accountId, input: { contactId: string; consentEventId: string; title: string }, actorId: string, actorType?: ActorType): Promise<{ id: string; created: boolean }>`
  - `completeTasksForConsentEvents(db, accountId, eventIds: readonly string[], actorId: string, actorType?: ActorType): Promise<string[]>` (the ids it completed)
  - `reopenTasks(db, accountId, ids: readonly string[], actorId: string, actorType?: ActorType): Promise<void>`
  - `nextBookedStart(db, accountId, contactId, nowIso: string): Promise<string | null>`
  - `WorkRow.consent?: { eventId: string; action: ConsentAction } | null` (set on task rows that link a ledger row)
  - `HoldUndecidedError`; `completeTask` now THROWS it for a To-do whose linked number is still on hold (its newest deciding row is a hold), so no "Done" anywhere closes a hold without deciding it (review R3-I1, R3-N3; G21)
  - `holdOpenTaskIds(db, accountId, tasks: readonly { id: string; completed_at: string | null; consent_event_id?: string | null }[]): Promise<string[]>` — the open To-dos whose number is still on hold (the contact timeline shows a hint in place of their Done, review R3-N1)
  - `listContactTasks` also selects `consent_event_id`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/consent-tasks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./events", () => ({ emit: vi.fn(async () => undefined) }));
import { emit } from "./events";
// The two ledger reads the hold guard makes; the reducer (newestDecidingRow) stays real.
vi.mock("./consent", async (importOriginal) => ({
  ...(await importOriginal<object>()), readConsentEvent: vi.fn(), readConsentHistory: vi.fn(),
}));
import { readConsentEvent, readConsentHistory } from "./consent";
import {
  ensureConsentTask, completeTasksForConsentEvents, reopenTasks, completeTask, holdOpenTaskIds, HoldUndecidedError,
} from "./activities";
import { nextBookedStart } from "./booking";

/**
 * The consent To-do helpers, against a PostgREST-shaped fake that records
 * what it was asked (no database). The live behaviour — the unique index, the
 * composite key — is consent-tasks-live.test.ts (CI) and Task 1's schema test.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answers: Answer[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  let next = 0;
  const answer = () => Promise.resolve(answers[next++] ?? { data: null, error: null });
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["insert", "update", "eq", "in", "is", "gt", "order", "select"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  chain.single = () => { calls.push(["single"]); return answer(); };
  chain.maybeSingle = () => { calls.push(["maybeSingle"]); return answer(); };
  chain.limit = (...a: unknown[]) => { calls.push(["limit", ...a]); return answer(); };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("ensureConsentTask — one To-do per ledger row", () => {
  it("inserts the task with its consent_event_id and emits task.created (mutation: drop consent_event_id from the insert → FAILS)", async () => {
    vi.mocked(emit).mockClear();
    const f = fakeDb([{ data: { id: "t1" }, error: null }]);
    expect(await ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "Ana may have asked …" }, "sms-inbound", "system"))
      .toEqual({ id: "t1", created: true });
    expect(f.calls.find((c) => c[0] === "insert")?.[1]).toEqual({
      account_id: "a1", contact_id: "c1", title: "Ana may have asked …", consent_event_id: "e1",
    });
    expect(emit).toHaveBeenCalledWith(f.db, "a1", "task.created", "sms-inbound", { taskId: "t1", contactId: "c1", consentEventId: "e1" }, "system");
  });

  it("a second attempt for the same row (23505 on tasks_consent_event_once) returns the FIRST task and emits nothing (mutation: throw on 23505 → FAILS)", async () => {
    vi.mocked(emit).mockClear();
    const f = fakeDb([{ data: null, error: { code: "23505", message: "duplicate" } }, { data: { id: "t0" }, error: null }]);
    expect(await ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "x" }, "sms-inbound", "system"))
      .toEqual({ id: "t0", created: false });
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "consent_event_id", "e1"]]));
    expect(emit).not.toHaveBeenCalled();
  });

  it("any other insert error THROWS, so the inbound route answers 503 and Telnyx retries (mutation: swallow every error → FAILS)", async () => {
    const f = fakeDb([{ data: null, error: { code: "42501", message: "permission denied" } }]);
    await expect(ensureConsentTask(f.db, "a1", { contactId: "c1", consentEventId: "e1", title: "x" }, "a", "system")).rejects.toThrow("permission denied");
  });
});

describe("completeTasksForConsentEvents / reopenTasks — the hold To-do follows the hold", () => {
  it("completes only OPEN tasks linking these rows, and returns exactly the ids it completed (mutation: drop .is('completed_at', null) → a done task would be re-stamped and reopened by the undo, FAILS)", async () => {
    const f = fakeDb([{ data: [{ id: "t1" }, { id: "t2" }], error: null }]);
    expect(await completeTasksForConsentEvents(f.db, "a1", ["e1", "e2"], "user_1")).toEqual(["t1", "t2"]);
    expect(f.calls).toEqual(expect.arrayContaining([
      ["eq", "account_id", "a1"], ["in", "consent_event_id", ["e1", "e2"]], ["is", "completed_at", null], ["select", "id"],
    ]));
  });

  it("no rows asked about is no write at all (mutation: drop the empty-list guard → an unfiltered update is issued, FAILS)", async () => {
    const f = fakeDb([]);
    expect(await completeTasksForConsentEvents(f.db, "a1", [], "user_1")).toEqual([]);
    await reopenTasks(f.db, "a1", [], "user_1");
    expect(f.calls).toEqual([]);
  });

  it("reopens exactly the tasks the undo carries, in this account (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb([{ data: [{ id: "t1" }], error: null }]);
    await reopenTasks(f.db, "a1", ["t1"], "user_1");
    expect(f.calls).toEqual(expect.arrayContaining([["update", { completed_at: null }], ["eq", "account_id", "a1"], ["in", "id", ["t1"]]]));
  });
});

describe("nextBookedStart — for the CANCEL To-do", () => {
  it("the soonest BOOKED appointment after now, for this contact (mutation: drop the status filter → a cancelled one would count, FAILS)", async () => {
    const f = fakeDb([{ data: [{ starts_at: "2026-10-09T15:00:00Z" }], error: null }]);
    expect(await nextBookedStart(f.db, "a1", "c1", "2026-10-06T00:00:00Z")).toBe("2026-10-09T15:00:00Z");
    expect(f.calls).toEqual(expect.arrayContaining([
      ["eq", "contact_id", "c1"], ["eq", "status", "booked"], ["gt", "starts_at", "2026-10-06T00:00:00Z"],
      ["order", "starts_at", { ascending: true }], ["limit", 1],
    ]));
  });

  it("none is null, and a read error throws (mutation: return null on error → FAILS)", async () => {
    expect(await nextBookedStart(fakeDb([{ data: [], error: null }]).db, "a1", "c1", "2026-10-06T00:00:00Z")).toBeNull();
    await expect(nextBookedStart(fakeDb([{ data: null, error: { message: "boom" } }]).db, "a1", "c1", "x")).rejects.toThrow("boom");
  });
});

/** A hold on the contact's number, as readConsentEvent answers it. */
const HOLD = { id: "h1", action: "held", method: "free_text", channel: "sms", address: "+19562921696", contact_id: "c1",
  occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null };

describe("completeTask — a hold's To-do closes by deciding the hold, never by Done (review R3-I1, R3-N3; G21)", () => {
  beforeEach(() => {
    vi.mocked(readConsentEvent).mockReset().mockResolvedValue(HOLD as never);
    vi.mocked(readConsentHistory).mockReset();
  });

  it("refuses while the NUMBER is still on hold — its newest deciding row a hold, the To-do's own or a later one — and writes nothing (mutation: drop the guard → the update runs, FAILS; mutation: ask only whether the To-do's OWN hold is newest → the H2 case completes, FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([HOLD] as never);
    const f = fakeDb([{ data: { consent_event_id: "h1" }, error: null }]);
    await expect(completeTask(f.db, "a1", "t1", "user_1")).rejects.toBeInstanceOf(HoldUndecidedError);
    expect(f.calls.some((c) => c[0] === "update")).toBe(false);
    // Not a stop, then its Undo: a NEW hold (H2) is newest, and the reopened To-do T1 still links H1.
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "h2", method: "staff_undo", occurred_at: "2026-10-05T12:00:00Z" },
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    const g = fakeDb([{ data: { consent_event_id: "h1" }, error: null }]);
    await expect(completeTask(g.db, "a1", "t1", "user_1")).rejects.toBeInstanceOf(HoldUndecidedError);
  });

  it("completes once the hold is decided, and a task with no consent link exactly as before (mutation: refuse every linked task → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    const f = fakeDb([{ data: { consent_event_id: "h1" }, error: null }, { data: null, error: null }]);
    await completeTask(f.db, "a1", "t1", "user_1");
    expect(f.calls.some((c) => c[0] === "update")).toBe(true);
    const g = fakeDb([{ data: { consent_event_id: null }, error: null }, { data: null, error: null }]);
    await completeTask(g.db, "a1", "t2", "user_1");
    expect(g.calls.some((c) => c[0] === "update")).toBe(true);
    expect(readConsentEvent).toHaveBeenCalledTimes(1);   // the plain task read no ledger
  });
});

describe("holdOpenTaskIds — the open To-dos the contact timeline shows a hint for, in place of a Done that would be refused (review R3-N1)", () => {
  beforeEach(() => {
    vi.mocked(readConsentEvent).mockReset().mockResolvedValue(HOLD as never);
    vi.mocked(readConsentHistory).mockReset().mockResolvedValue([HOLD] as never);
  });

  it("only OPEN tasks linked to a number that is still on hold (mutation: drop the open-task condition → the done one is listed, FAILS)", async () => {
    expect(await holdOpenTaskIds({} as never, "a1", [
      { id: "t_open", completed_at: null, consent_event_id: "h1" },
      { id: "t_done", completed_at: "2026-10-05T12:00:00Z", consent_event_id: "h1" },
      { id: "t_plain", completed_at: null, consent_event_id: null },
    ])).toEqual(["t_open"]);
  });

  it("a number no longer on hold offers Done again (mutation: hint for every linked task → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { ...HOLD, id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z" }, HOLD,
    ] as never);
    expect(await holdOpenTaskIds({} as never, "a1", [{ id: "t_open", completed_at: null, consent_event_id: "h1" }])).toEqual([]);
  });
});
```

Create `packages/db/src/test/consent-tasks-live.test.ts` (CI only):

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEvent } from "../consent";
import { createContact } from "../contacts";
import { ensureConsentTask, completeTasksForConsentEvents, reopenTasks } from "../activities";
import { listAccountWork } from "../work-queue";

/** The consent To-do through PostgREST, on the CI project: one per ledger row, completed and reopened as a set, shown with its row's action. */
describe("consent To-do rows (CI only: withTestAccount + serviceDb)", () => {
  it("a second ensure returns the first task; the work queue reports the linked row's action; complete then reopen round-trips (mutation: drop consent_event_id from openTasks' select → consent is undefined, FAILS)", async () => {
    await withTestAccount(async (_tdb, id) => {
      const db = serviceDb();
      const contact = await createContact(db, id, { firstName: "Hold", phone: "+19565550133" }, "consent-tasks-live", "system");
      const ev = await appendConsentEvent(db, { accountId: id, channel: "sms", address: "+19565550133", action: "held", method: "free_text", contactId: contact.id });
      const one = await ensureConsentTask(db, id, { contactId: contact.id, consentEventId: ev.id, title: "Hold may have asked to stop texts" }, "consent-tasks-live", "system");
      const two = await ensureConsentTask(db, id, { contactId: contact.id, consentEventId: ev.id, title: "again" }, "consent-tasks-live", "system");
      expect(one.created).toBe(true);
      expect(two).toEqual({ id: one.id, created: false });
      const work = await listAccountWork(db, id);
      expect(work.find((w) => w.id === `task:${one.id}`)?.consent).toEqual({ eventId: ev.id, action: "held" });
      expect(await completeTasksForConsentEvents(db, id, [ev.id], "consent-tasks-live", "system")).toEqual([one.id]);
      expect((await listAccountWork(db, id)).some((w) => w.id === `task:${one.id}`)).toBe(false);
      await reopenTasks(db, id, [one.id], "consent-tasks-live", "system");
      expect((await listAccountWork(db, id)).some((w) => w.id === `task:${one.id}`)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd packages/db
pnpm exec vitest run src/consent-tasks.test.ts
```

Expected (predicted; not replayed): the file fails to import (`ensureConsentTask`, `completeTasksForConsentEvents`, `reopenTasks`, `nextBookedStart` do not exist).

- [ ] **Step 3: Write the helpers**

Edit `packages/db/src/activities.ts` — append after `reopenTask` (the end of the file):

```ts
/**
 * The consent To-do (consent chain spec §6, plan Task 8): one per ledger row,
 * enforced by 0055's `tasks_consent_event_once`. A second attempt — Telnyx
 * retrying a webhook whose first attempt already wrote the To-do — finds the
 * first one rather than making two, and emits nothing. Any other error
 * THROWS: the inbound route turns it into a 503 so the To-do is retried.
 */
export async function ensureConsentTask(
  db: SupabaseClient, accountId: string,
  input: { contactId: string; consentEventId: string; title: string }, actorId: string,
  actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks")
    .insert({ account_id: accountId, contact_id: input.contactId, title: input.title, consent_event_id: input.consentEventId })
    .select("id").single();
  if (!error && data) {
    await emit(db, accountId, "task.created", actorId,
      { taskId: data.id, contactId: input.contactId, consentEventId: input.consentEventId }, actorType);
    return { id: data.id as string, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureConsentTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks")
    .select("id").eq("account_id", accountId).eq("consent_event_id", input.consentEventId).maybeSingle();
  if (readErr || !found) throw new Error(`ensureConsentTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

/**
 * Completes the OPEN tasks that link any of these ledger rows (a hold's
 * To-do, once staff confirm or release the hold, from the drawer or the To-do
 * list) and returns exactly the ids it completed: the action's undo reopens
 * those and no others. No rows asked about, no write.
 */
export async function completeTasksForConsentEvents(
  db: SupabaseClient, accountId: string, eventIds: readonly string[], actorId: string,
  actorType: ActorType = "user",
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await db.from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("account_id", accountId).in("consent_event_id", [...eventIds]).is("completed_at", null)
    .select("id");
  if (error) throw new Error(`completeTasksForConsentEvents failed: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  for (const taskId of ids) await emit(db, accountId, "task.completed", actorId, { taskId }, actorType);
  return ids;
}

/** The undo of `completeTasksForConsentEvents`: reopens exactly these tasks, in this account. */
export async function reopenTasks(
  db: SupabaseClient, accountId: string, ids: readonly string[], actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await db.from("tasks")
    .update({ completed_at: null })
    .eq("account_id", accountId).in("id", [...ids])
    .select("id");
  if (error) throw new Error(`reopenTasks failed: ${error.message}`);
  for (const r of (data ?? []) as { id: string }[]) await emit(db, accountId, "task.reopened", actorId, { taskId: r.id }, actorType);
}
```

Edit `packages/db/src/booking.ts` — insert immediately BEFORE `export async function listBookingCreationsBetween(` (after `listUpcomingBookings`):

```ts
/**
 * When this contact's soonest upcoming `booked` appointment starts, or null.
 * For the consent CANCEL To-do (spec §4.2 step 2): a customer who texts
 * CANCEL has stopped their texts, and staff check whether they also meant
 * the appointment. THROWS on a read error (the inbound route retries).
 */
export async function nextBookedStart(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string,
): Promise<string | null> {
  const { data, error } = await db.from("bookings")
    .select("starts_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("status", "booked")
    .gt("starts_at", nowIso)
    .order("starts_at", { ascending: true }).limit(1);
  if (error) throw new Error(`nextBookedStart failed: ${error.message}`);
  return ((data ?? []) as { starts_at: string }[])[0]?.starts_at ?? null;
}

```

Edit `packages/db/src/work-queue.ts`:

Find:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandDisplayName } from "./branding";
```
Replace with:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandDisplayName } from "./branding";
import { readConsentActions, type ConsentAction } from "./consent";
```

Find:
```ts
  dueAt: string | null;
  occurredAt: string;
};
```
Replace with:
```ts
  dueAt: string | null;
  occurredAt: string;
  /** A task that asks about a consent ledger row (0055's
   *  `tasks.consent_event_id`), with that row's action: `held` is a hold to
   *  confirm or release (the To-do's Confirm stop / Not a stop), `revoked` a
   *  CANCEL stop to check against the appointment. Absent on every other row. */
  consent?: { eventId: string; action: ConsentAction } | null;
};
```

Find:
```ts
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at")
    .eq("account_id", accountId).is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`openTasks failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: `task:${t.id}`, source: "task" as const, accountId,
    contactId: t.contact_id, title: t.title,
    dueAt: t.due_at, occurredAt: t.created_at,
  }));
```
Replace with:
```ts
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at, consent_event_id")
    .eq("account_id", accountId).is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`openTasks failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; contact_id: string | null; title: string; due_at: string | null; created_at: string; consent_event_id: string | null }[];
  // One read for the whole batch, and none at all without a consent task.
  const linked = rows.map((t) => t.consent_event_id).filter((id): id is string => id !== null);
  const actions = await readConsentActions(db, accountId, linked);
  return rows.map((t) => {
    const action = t.consent_event_id ? actions.get(t.consent_event_id) : undefined;
    return {
      id: `task:${t.id}`, source: "task" as const, accountId,
      contactId: t.contact_id, title: t.title,
      dueAt: t.due_at, occurredAt: t.created_at,
      consent: t.consent_event_id && action ? { eventId: t.consent_event_id, action } : null,
    };
  });
```

Edit `packages/db/src/activities.ts` again — the hold To-do's guard (review R3-I1, R3-N3, R3-N1; plan G21). Add to its imports:

```ts
import { readConsentEvent, readConsentHistory, newestDecidingRow } from "./consent";
```

and append:

```ts
/** A hold's To-do is closed by deciding the hold (Confirm stop / Not a stop), never by "Done" (review R3-I1). */
export class HoldUndecidedError extends Error {
  constructor() {
    super("this To-do asks about a hold that is still undecided");
    this.name = "HoldUndecidedError";
  }
}

/**
 * Is the NUMBER this ledger row is about still on hold — its newest deciding
 * row a hold, this one or a later one (review R3-N3: after Not a stop and its
 * Undo, the new hold H2 is newest while the reopened To-do still links H1)?
 */
async function holdStillOpen(db: SupabaseClient, accountId: string, eventId: string): Promise<boolean> {
  const ev = await readConsentEvent(db, accountId, eventId);
  if (!ev || ev.action !== "held") return false;
  return newestDecidingRow(await readConsentHistory(db, accountId, ev.channel, ev.address))?.action === "held";
}

/** The open To-dos whose linked number is still on hold: the contact timeline shows a hint in place of their Done (review R3-N1). */
export async function holdOpenTaskIds(
  db: SupabaseClient, accountId: string,
  tasks: readonly { id: string; completed_at: string | null; consent_event_id?: string | null }[],
): Promise<string[]> {
  const open: string[] = [];
  for (const t of tasks) {
    if (!t.completed_at && t.consent_event_id && await holdStillOpen(db, accountId, t.consent_event_id)) open.push(t.id);
  }
  return open;
}
```

And in the same file, `completeTask` gains the guard (every "Done" path meets it: the per-account list, the contact page's timeline):

Find:
```ts
export async function completeTask(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { error } = await db.from("tasks")
```
Replace with:
```ts
export async function completeTask(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { data: linked, error: readError } = await db.from("tasks")
    .select("consent_event_id").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (readError) throw new Error(readError.message);
  const eventId = (linked as { consent_event_id: string | null } | null)?.consent_event_id ?? null;
  if (eventId && await holdStillOpen(db, accountId, eventId)) throw new HoldUndecidedError();
  const { error } = await db.from("tasks")
```

And `listContactTasks` returns the link, for the timeline (Task 12):

Find:
```ts
    .select("id, title, due_at, completed_at, created_at")
    .eq("account_id", accountId).eq("contact_id", contactId)
```
Replace with:
```ts
    .select("id, title, due_at, completed_at, created_at, consent_event_id")
    .eq("account_id", accountId).eq("contact_id", contactId)
```

Edit `packages/db/src/index.ts`:

Find:
```ts
export { addNote, listNotes, addTask, listContactTasks, completeTask, reopenTask } from "./activities";
```
Replace with:
```ts
export { addNote, listNotes, addTask, listContactTasks, completeTask, reopenTask,
         ensureConsentTask, completeTasksForConsentEvents, reopenTasks,
         HoldUndecidedError, holdOpenTaskIds } from "./activities";
```

Find the line in `packages/db/src/index.ts` that exports from `./booking` and contains `listUpcomingBookings`, and add `nextBookedStart` to its name list (keep every other name exactly as it is).

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd packages/db
pnpm exec vitest run src/consent-tasks.test.ts
pnpm exec tsc --noEmit
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/work-queue.test.ts
```

Expected (predicted; not replayed): the new file passes (12 tests); `tsc` exit 0; `work-queue.test.ts`'s `withRollback` tests pass unchanged on `post` (its `withTestAccount` tests fail to connect locally, as on `main`). Then the full web suite: `WorkRow.consent` is optional, so no web fixture changes; `apps/web` tests that mock `@bis/db` and build work rows are unaffected.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `ensureConsentTask`: drop `consent_event_id` from the insert | "inserts the task with its consent_event_id" |
| 2 | `ensureConsentTask`: `if (error) throw` (no 23505 branch) | "a second attempt … returns the FIRST task" |
| 3 | `ensureConsentTask`: return `{ id: "", created: false }` on every error | "any other insert error THROWS" |
| 4 | `completeTasksForConsentEvents`: drop `.is("completed_at", null)` | "completes only OPEN tasks …" |
| 5 | `completeTasksForConsentEvents`: drop the empty-list guard | "no rows asked about is no write at all" |
| 6 | `reopenTasks`: drop `.eq("account_id", accountId)` | "reopens exactly the tasks the undo carries, in this account" |
| 7 | `nextBookedStart`: drop `.eq("status", "booked")` | "the soonest BOOKED appointment" |
| 8 | `openTasks`: drop `consent_event_id` from the select | `consent-tasks-live.test.ts` (CI) |
| 9 | `completeTask`: drop the `holdStillOpen` guard | "refuses while the NUMBER is still on hold …" |
| 10 | `holdStillOpen`: `?.id === eventId` (only the To-do's OWN hold counts, review R3-N3) | "refuses while the NUMBER is still on hold …" (the H2 case) |
| 11 | `holdStillOpen`: return true for any linked row | "completes once the hold is decided …" and "a number no longer on hold offers Done again" |
| 12 | `holdOpenTaskIds`: drop the `!t.completed_at` condition | "only OPEN tasks linked to a number that is still on hold" |

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/activities.ts packages/db/src/booking.ts packages/db/src/work-queue.ts packages/db/src/index.ts \
  packages/db/src/consent-tasks.test.ts packages/db/src/test/consent-tasks-live.test.ts
git commit -m "feat(consent): one To-do per ledger row, completed and reopened as a set; the next booking; the work queue names the linked row"
```

---

### Task 3: The Telnyx opt-out backfill: the owners read, the plan, the CLI

**Owner:** bis-db-schema. **Tier:** HIGH (it writes the ledger on production, through the orchestrator, after danlo sees the count). **Questions:** none — Q4 was decided on 2026-09-28: import Telnyx's existing opt-outs BEFORE any number changes profile (review R1-C1; Task 16 steps 7–8).

**Files:**
- Create: `packages/db/supabase/backfills/0055-telnyx-optout-owners.sql`
- Create: `packages/db/src/backfill/telnyx-optouts.ts`, `packages/db/src/backfill/telnyx-optouts.test.ts`, `packages/db/src/backfill/telnyx-optouts-run.ts`
- Create: `packages/db/src/test/telnyx-backfill.test.ts`
- Modify: `packages/db/package.json`, `packages/db/src/ci/sql-files.test.ts`

**Interfaces:**
- Consumes: Task 1's `consentAppendSql`.
- Produces: `parseOptouts(json: unknown): OptoutRow[]` (throws on anything that is not an opt-out row or a page of them); `planTelnyxBackfill(rows: OptoutRow[], owners: Owner[]): TelnyxBackfillPlan`; `telnyxBackfillSql(plan): string` (ONE statement answering `outcome, n` per outcome; refuses an empty plan); CLI `pnpm --filter @bis/db backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]`.

**How it is used (Task 16, steps 7–8), and WHEN (review R1-C1).** A Telnyx block lives on a messaging PROFILE (F4), and today every BIS number sits on one shared profile (`crm-features.md:1099`); step 0 moves each business's number onto its own. Whether a number's opt-outs follow it is NOT FOUND (assumption A5; inferred from F4 that they do not), so the shared profile's list is read and recorded BEFORE any number moves, while it still describes every business. The orchestrator, under danlo's go, reads the account's opt-outs UNFILTERED by profile (`GET /v2/messaging_optouts?redaction_enabled=false&page[size]=250&page[number]=N`, every page saved as-is into one JSON array), reads the owners with `0055-telnyx-optout-owners.sql` through the MCP, runs the CLI for the COUNT (it maps each row by its `from`, the business's number, so rows for numbers that are not BIS's are only counted), shows danlo, and only on his go emits and pastes the SQL. The customer numbers stay in the orchestrator's temp files, deleted after, except the statement pasted into the MCP for the write itself, which necessarily carries them to production (review R1-M3).

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/backfill/telnyx-optouts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseOptouts, planTelnyxBackfill, telnyxBackfillSql, type OptoutRow } from "./telnyx-optouts";

const OWNERS = [
  { e164: "+19565550000", account_id: "11111111-1111-4111-8111-111111111111", status: "live" },
  { e164: "+19565550001", account_id: "22222222-2222-4222-8222-222222222222", status: "testing" },
];
const row = (o: Partial<OptoutRow> = {}): OptoutRow => ({
  from: "+19565550000", to: "+19565551234", messaging_profile_id: "prof-1", keyword: "STOP",
  created_at: "2025-04-28 12:00:38.631252+00:00", ...o,
});

describe("parseOptouts — what the orchestrator saved from Telnyx", () => {
  it("accepts an array of pages (each { data: [...] }) or a flat array of rows (mutation: accept only pages → the flat array throws, FAILS)", () => {
    const one = row();
    expect(parseOptouts([{ data: [one], meta: { total_pages: 1 } }])).toEqual([one]);
    expect(parseOptouts([one])).toEqual([one]);
  });

  it("refuses a redacted number, a non-E.164 number, an unparseable time, or a non-array, so a bad copy writes nothing (mutation: skip the redaction check → FAILS)", () => {
    expect(() => parseOptouts([row({ to: "+44776****" })])).toThrow(/redacted/);
    expect(() => parseOptouts([row({ from: "BISRGV" })])).toThrow(/E\.164/);
    expect(() => parseOptouts([row({ created_at: "yesterday" })])).toThrow(/created_at/);
    expect(() => parseOptouts({ data: [] })).toThrow(/array/);
  });
});

describe("planTelnyxBackfill — which account each opt-out belongs to", () => {
  it("maps by the BUSINESS's number (`from`, plan F10), counts per account, and reports unmatched numbers without a customer number (mutation: map by `to` → nothing matches, FAILS)", () => {
    const plan = planTelnyxBackfill([
      row(), row({ to: "+19565552222", from: "+19565550001" }), row({ from: "+19565559999" }),
    ], OWNERS);
    expect(plan.toAppend.map((r) => [r.accountId, r.address])).toEqual([
      ["11111111-1111-4111-8111-111111111111", "+19565551234"],
      ["22222222-2222-4222-8222-222222222222", "+19565552222"],
    ]);
    expect(plan.perAccount).toEqual({ "11111111-1111-4111-8111-111111111111": 1, "22222222-2222-4222-8222-222222222222": 1 });
    expect(plan.unmatched).toEqual([{ from: "+19565559999", rows: 1 }]);
    expect(plan.toMatchesOwners).toBe(0);
  });

  it("the same customer twice for one account is one row (mutation: drop the de-duplication → two, FAILS)", () => {
    expect(planTelnyxBackfill([row(), row({ keyword: "QUIT" })], OWNERS).toAppend).toHaveLength(1);
  });

  it("counts how many `to` numbers are the business's OWN numbers — a reversed reading would show here, not in the ledger (mutation: drop the count → FAILS)", () => {
    expect(planTelnyxBackfill([row({ to: "+19565550001" })], OWNERS).toMatchesOwners).toBe(1);
  });
});

describe("telnyxBackfillSql — the statement the orchestrator pastes", () => {
  it("one guarded call per row: revoked, backfill_telnyx, unless_customer_stopped, the opt-out's own time, a source naming that one opt-out event — its numbers AND its time (review R1-I3; mutation: guard 'none' → FAILS; drop the time from the source → FAILS)", () => {
    const sql = telnyxBackfillSql(planTelnyxBackfill([row()], OWNERS));
    expect(sql.match(/public\.append_consent_event\(/g)).toHaveLength(1);
    expect(sql).toContain("'backfill_telnyx'::text, 'unless_customer_stopped'::text");
    expect(sql).toContain("'telnyx_optout:+19565550000:+19565551234:2025-04-28T12:00:38.631Z'::text");
    expect(sql).toContain("'2025-04-28T12:00:38.631Z'::timestamptz");
    expect(sql).toContain("\"keyword\":\"STOP\"");
    expect(sql).not.toContain(String.fromCharCode(0x5c));
  });

  it("is ONE statement that answers each outcome and its count, so execute_sql (which shows only the last statement's result) reports the whole write (review R1-M3; mutation: one statement per row → several semicolons, FAILS)", () => {
    const sql = telnyxBackfillSql(planTelnyxBackfill([row(), row({ to: "+19565554321" })], OWNERS));
    expect(sql.match(/public\.append_consent_event\(/g)).toHaveLength(2);
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql).toMatch(/group by outcome/);
  });

  it("an empty plan is refused, never an invalid statement with no call in it (mutation: drop the check → FAILS)", () => {
    expect(() => telnyxBackfillSql(planTelnyxBackfill([], OWNERS))).toThrow(/nothing to write/);
  });
});
```

Create `packages/db/src/test/telnyx-backfill.test.ts` (withRollback: replica and CI):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withRollback } from "./db";
import { planTelnyxBackfill, telnyxBackfillSql } from "../backfill/telnyx-optouts";

/**
 * The backfill end to end inside a rolled-back transaction: the owners read,
 * the plan, the emitted SQL run as the database owner (what execute_sql is),
 * and a second run. RED BEFORE APPLY: the function does not exist on `pre`.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const owners = readFileSync(fileURLToPath(new URL("../../supabase/backfills/0055-telnyx-optout-owners.sql", import.meta.url)), "utf8");

describe("the Telnyx opt-out backfill, run", () => {
  it("writes one revoked row per opt-out, dated at the opt-out, and a re-run after the customer's own START still writes nothing — the guard cannot mask it (review R1-I2; mutation: a source_ref that varies per run → the re-run appends a second stop, FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Backfill') returning id", [agency!.id, `org_TB_${RUN}`])).rows[0]!.id;
      // Seven random digits: phone_numbers.e164 is unique across every account on the shared CI project.
      const number = `+1956${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
      await c.query("insert into phone_numbers (account_id, e164, status) values ($1, $2, 'live')", [acct, number]);
      const ownerRows = (await c.query<{ e164: string; account_id: string; status: string }>(owners)).rows;
      expect(ownerRows.some((o) => o.e164 === number && o.account_id === acct)).toBe(true);
      // Built afresh each time, as a second session would build it.
      const statement = () => telnyxBackfillSql(planTelnyxBackfill([
        { from: number, to: "+19565551234", messaging_profile_id: "p", keyword: "STOP", created_at: "2025-04-28T12:00:38Z" },
      ], ownerRows));
      expect((await c.query(statement())).rows).toEqual([{ outcome: "appended", n: 1 }]);
      // The customer texts START afterwards: the address is allowed again, so
      // `unless_customer_stopped` would let a second stop through. Only the
      // source (one opt-out event) stops the re-run from writing it again.
      await c.query("set local role service_role");
      await c.query(
        "select * from public.append_consent_event($1, 'sms', '+19565551234', 'resubscribed', 'start_keyword', 'none', null, null, null, null, 'msg_start_1', '{}'::jsonb, null)", [acct]);
      await c.query("reset role");
      expect((await c.query(statement())).rows).toEqual([{ outcome: "duplicate", n: 1 }]);
      const { rows } = await c.query(
        "select action, method, occurred_at, source_ref from consent_events where account_id = $1 and method = 'backfill_telnyx'", [acct]);
      expect(rows).toEqual([{ action: "revoked", method: "backfill_telnyx", occurred_at: new Date("2025-04-28T12:00:38Z"), source_ref: `telnyx_optout:${number}:+19565551234:2025-04-28T12:00:38.000Z` }]);
    }));
});
```

Edit `packages/db/src/ci/sql-files.test.ts`:

Find:
```ts
  "backfills/0054-dnd-preflight.sql",
];
```
Replace with:
```ts
  "backfills/0054-dnd-preflight.sql",
  "backfills/0055-telnyx-optout-owners.sql",
];
```

(That adds three parameterised cases for the new file: ASCII only, no backslash, and ci:sql's read gate.)

- [ ] **Step 2: Run them to see them fail**

```bash
cd packages/db
pnpm exec vitest run src/backfill/telnyx-optouts.test.ts src/ci/sql-files.test.ts
```

Expected (predicted; not replayed): `telnyx-optouts.test.ts` fails to import; `sql-files.test.ts`'s three new cases fail (the file does not exist).

- [ ] **Step 3: Write the read, the module and the CLI**

Create `packages/db/supabase/backfills/0055-telnyx-optout-owners.sql`:

```sql
-- 0055-telnyx-optout-owners.sql (consent chain PR-2, plan Task 3)
-- READ ONLY. Every number this platform has ever held, with the account it
-- belongs to, for the Telnyx opt-out backfill: an opt-out row names the
-- business's number in `from` (plan F10), and this maps it to an account.
-- Every status is listed (a released number's opt-outs are still reported,
-- never written, if its row's account no longer texts). No customer number is
-- read here.
select p.e164, p.account_id, p.status
  from public.phone_numbers p
 order by p.e164;
```

Create `packages/db/src/backfill/telnyx-optouts.ts`:

```ts
import { consentAppendSql } from "../consent";

/**
 * Consent chain PR-2's Telnyx backfill (spec §4.2, plan Task 3): Telnyx's
 * own opt-out list (`GET /v2/messaging_optouts`, VERIFIED, plan F6) becomes
 * `revoked` / `backfill_telnyx` rows in the ledger, so BIS already blocks a
 * number Telnyx blocks before the first send finds out through a 40300.
 *
 * Pure: the orchestrator fetches the pages and reads the owners (the app
 * never calls Telnyx for this), and the SQL this emits is pasted by hand
 * after danlo has seen the count.
 */
export type OptoutRow = {
  from: string; to: string; messaging_profile_id: string | null; keyword: string | null; created_at: string;
};
export type Owner = { e164: string; account_id: string; status: string };
export type PlannedRevoke = {
  accountId: string; address: string; from: string; keyword: string | null; profileId: string | null; occurredAt: string;
};
export type TelnyxBackfillPlan = {
  toAppend: PlannedRevoke[];
  perAccount: Record<string, number>;
  /** Business numbers with opt-outs but no row in phone_numbers: reported, never written. */
  unmatched: { from: string; rows: number }[];
  /** Opt-outs whose `to` is one of OUR numbers: expected 0; more means the orientation was misread. */
  toMatchesOwners: number;
};

const E164 = /^[+][1-9][0-9]{7,14}$/;

function asRow(v: unknown, i: number): OptoutRow {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object") throw new Error(`opt-out ${i}: not an object`);
  for (const k of ["from", "to"] as const) {
    const n = r[k];
    if (typeof n !== "string") throw new Error(`opt-out ${i}: ${k} is missing`);
    if (n.includes("*")) throw new Error(`opt-out ${i}: ${k} is redacted — fetch with redaction_enabled=false`);
    if (!E164.test(n)) throw new Error(`opt-out ${i}: ${k} is not E.164`);
  }
  if (typeof r.created_at !== "string" || !Number.isFinite(Date.parse(String(r.created_at).replace(" ", "T")))) {
    throw new Error(`opt-out ${i}: created_at does not parse`);
  }
  return {
    from: r.from as string, to: r.to as string,
    messaging_profile_id: typeof r.messaging_profile_id === "string" ? r.messaging_profile_id : null,
    keyword: typeof r.keyword === "string" ? r.keyword : null,
    created_at: r.created_at as string,
  };
}

/** Pages as Telnyx returns them (`{ data: [...] }` each), or a flat array of rows. THROWS on anything else. */
export function parseOptouts(json: unknown): OptoutRow[] {
  if (!Array.isArray(json)) throw new Error("opt-outs: expected an array of pages or rows");
  const rows = json.flatMap((item: unknown) =>
    item && typeof item === "object" && Array.isArray((item as { data?: unknown }).data) ? (item as { data: unknown[] }).data : [item]);
  return rows.map(asRow);
}

/** Telnyx prints `2025-04-28 12:00:38.631252+00:00`; the ledger wants an ISO instant. */
function isoOf(created: string): string {
  return new Date(Date.parse(created.replace(" ", "T"))).toISOString();
}

export function planTelnyxBackfill(rows: readonly OptoutRow[], owners: readonly Owner[]): TelnyxBackfillPlan {
  const byNumber = new Map(owners.map((o) => [o.e164, o]));
  const seen = new Set<string>();
  const toAppend: PlannedRevoke[] = [];
  const perAccount: Record<string, number> = {};
  const unmatched = new Map<string, number>();
  let toMatchesOwners = 0;
  for (const r of rows) {
    if (byNumber.has(r.to)) toMatchesOwners++;
    const owner = byNumber.get(r.from);
    if (!owner) { unmatched.set(r.from, (unmatched.get(r.from) ?? 0) + 1); continue; }
    const key = `${owner.account_id}|${r.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toAppend.push({ accountId: owner.account_id, address: r.to, from: r.from, keyword: r.keyword, profileId: r.messaging_profile_id, occurredAt: isoOf(r.created_at) });
    perAccount[owner.account_id] = (perAccount[owner.account_id] ?? 0) + 1;
  }
  return { toAppend, perAccount, unmatched: [...unmatched].map(([from, n]) => ({ from, rows: n })), toMatchesOwners };
}

/**
 * One guarded call per row: `revoked`, `backfill_telnyx`,
 * `unless_customer_stopped` (a staff stop does not refuse it; the customer's
 * own does), at the opt-out's own time, with a source naming that ONE
 * opt-out event — `telnyx_optout:<from>:<to>:<its time>` — so a re-run
 * appends nothing (0055's one row per source) while a later, second opt-out
 * of the same number would still be its own row (review R1-I3: a source is
 * an event, never a reusable channel).
 *
 * ONE statement, answering `outcome, n` per outcome (review R1-M3):
 * execute_sql shows only the last statement's result, so a file of one
 * statement per row would report only its last row. The statement carries
 * customer numbers: the file is never committed and is deleted after use.
 */
export function telnyxBackfillSql(plan: TelnyxBackfillPlan): string {
  if (plan.toAppend.length === 0) throw new Error("telnyxBackfillSql: nothing to write");
  const calls = plan.toAppend.map((r) => consentAppendSql({
    accountId: r.accountId, channel: "sms", address: r.address, action: "revoked", method: "backfill_telnyx",
    sourceRef: `telnyx_optout:${r.from}:${r.address}:${r.occurredAt}`, occurredAt: r.occurredAt,
    evidence: { keyword: r.keyword, messaging_profile_id: r.profileId, from: r.from },
  }, "unless_customer_stopped").replace(/;$/, ""));
  return [
    "-- Telnyx opt-out backfill (plan Task 3). HOLDS CUSTOMER NUMBERS: never commit it, and delete it after running.",
    "select outcome, count(*)::int as n from (",
    calls.join("\nunion all\n"),
    ") t group by outcome order by outcome;",
  ].join("\n") + "\n";
}
```

Create `packages/db/src/backfill/telnyx-optouts-run.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseOptouts, planTelnyxBackfill, telnyxBackfillSql, type Owner } from "./telnyx-optouts";

/**
 * pnpm --filter @bis/db backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]
 *
 * Prints counts only (never a customer number): rows read, to write per
 * account, business numbers with no owner, and `to` numbers that are our own
 * (expected 0). With --emit-sql it also writes the statements to <out.sql>.
 * Connects to nothing.
 */
function main(argv: string[]): void {
  const [optoutsPath, ownersPath, flag, outPath] = argv;
  if (!optoutsPath || !ownersPath || (flag !== undefined && (flag !== "--emit-sql" || !outPath))) {
    throw new Error("usage: backfill:telnyx-optouts <optouts.json> <owners.json> [--emit-sql <out.sql>]");
  }
  const rows = parseOptouts(JSON.parse(readFileSync(optoutsPath, "utf8")));
  const owners = JSON.parse(readFileSync(ownersPath, "utf8")) as Owner[];
  if (!Array.isArray(owners)) throw new Error("owners: expected the JSON array execute_sql returned");
  const plan = planTelnyxBackfill(rows, owners);
  console.log(`opt-outs read: ${rows.length}`);
  for (const [account, n] of Object.entries(plan.perAccount)) console.log(`to write, account ${account}: ${n}`);
  console.log(`to write, total: ${plan.toAppend.length}`);
  for (const u of plan.unmatched) console.log(`no owner for business number ${u.from}: ${u.rows} opt-out(s), not written`);
  console.log(`opt-outs whose customer number is one of ours (expected 0): ${plan.toMatchesOwners}`);
  if (outPath && plan.toAppend.length === 0) console.log("nothing to write: no statement emitted");
  else if (outPath) {
    writeFileSync(outPath, telnyxBackfillSql(plan));
    console.log(`statement written to ${outPath} — delete it after running`);
  }
}

main(process.argv.slice(2));
```

Edit `packages/db/package.json`:

Find:
```json
    "backfill:phone-country": "tsx src/backfill/phone-country-run.ts"
```
Replace with:
```json
    "backfill:phone-country": "tsx src/backfill/phone-country-run.ts",
    "backfill:telnyx-optouts": "tsx src/backfill/telnyx-optouts-run.ts"
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd packages/db
pnpm exec vitest run src/backfill/telnyx-optouts.test.ts src/ci/sql-files.test.ts
pnpm exec tsc --noEmit
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/telnyx-backfill.test.ts
```

Expected (predicted; not replayed): the 8 new cases and all `sql-files` cases pass; `tsc` exit 0; the backfill run passes on `post` (and fails on `pre`, where the function does not exist).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `parseOptouts`: drop the `{ data }` flattening | "accepts an array of pages …" |
| 2 | `asRow`: drop the `includes("*")` check | "refuses a redacted number …" |
| 3 | `planTelnyxBackfill`: look the owner up by `r.to` | "maps by the BUSINESS's number" |
| 4 | drop the `seen` de-duplication | "the same customer twice for one account is one row" |
| 5 | `toMatchesOwners` never incremented | "counts how many `to` numbers are the business's OWN numbers" |
| 6 | `telnyxBackfillSql`: guard `"none"` | "one guarded call per row" |
| 7 | source ref `telnyx_optout:${Date.now()}` | "writes one revoked row per opt-out … a re-run after the customer's own START still writes nothing" (telnyx-backfill.test.ts; the START between runs is what makes this probe bite, review R1-I2) |
| 8 | source ref without the time (`telnyx_optout:${r.from}:${r.address}`) | "one guarded call per row: … a source naming that one opt-out event" |
| 9 | one statement per row (join the calls with `;\n`) | "is ONE statement that answers each outcome and its count" |
| 10 | drop the empty-plan check | "an empty plan is refused …" |

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/backfills/0055-telnyx-optout-owners.sql packages/db/src/backfill/telnyx-optouts.ts \
  packages/db/src/backfill/telnyx-optouts.test.ts packages/db/src/backfill/telnyx-optouts-run.ts \
  packages/db/src/test/telnyx-backfill.test.ts packages/db/package.json packages/db/src/ci/sql-files.test.ts
git commit -m "feat(consent): the Telnyx opt-out backfill — owners read, plan by the business's number, one guarded call per row"
```

---

### Task 4: The keyword matcher and the phrase list

**Owner:** bis-comms. **Tier:** HIGH (it decides what counts as a stop). **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/keywords.ts`, `apps/web/src/lib/consent/keywords.test.ts`
- Create: `apps/web/src/lib/consent/phrases.ts`, `apps/web/src/lib/consent/phrases.test.ts`

**Interfaces:**
- Produces:
  - `type KeywordKind = "stop" | "start" | "help"`; `type KeywordLanguage = "en" | "es"`; `type KeywordMatch = { kind: KeywordKind; word: string; language: KeywordLanguage }`
  - `normaliseKeyword(text: string): string`; `matchKeyword(text: string): KeywordMatch | null`; `keywordDisplay(word: string): string`; `CANCEL_WORDS: ReadonlySet<string>` (`CANCEL`, `CANCELAR`)
  - `type PhraseMatch = { phrase: string; language: "en" | "es" }`; `PHRASES_EN`, `PHRASES_ES: readonly string[]` (sentence phrases, found anywhere); `ES_VERB_FORMS`, `ES_MESSAGE_OBJECTS: readonly string[]` and `ES_VERB_PHRASES` (every form with every object: a Spanish verb form counts only with a message object, danlo 2026-09-28); `WHOLE_MESSAGE_PHRASES: readonly PhraseMatch[]` and `REPEATED_KEYWORDS: readonly { word; language }[]` (only as the whole message); `NOT_FOLLOWED_BY` ("mensajes de voz", "lista de espera"); `normalisePhraseText(text: string): string`; `matchPhrase(text: string): PhraseMatch | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/keywords.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchKeyword, normaliseKeyword, keywordDisplay, CANCEL_WORDS } from "./keywords";

/**
 * Spec decision 10, 11 and choice 26, extended by plan G9: the WHOLE message,
 * ignoring case, accents, spaces, inner hyphens and the punctuation or symbols
 * at either end. Every word of the spec's lists, and the fixed non-matches of
 * spec §8 ("stop by at 3", "Cancel my appointment please", "No").
 */
const STOP_EN = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT"];
const STOP_ES = ["PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS"];

describe("matchKeyword — the spec's stop words", () => {
  it.each(STOP_EN)("%s, in upper, lower and title case, is an English stop (mutation: drop any word from the table → FAILS naming it)", (w) => {
    for (const text of [w, w.toLowerCase(), w[0] + w.slice(1).toLowerCase()]) {
      expect(matchKeyword(text)).toMatchObject({ kind: "stop", language: "en" });
    }
  });

  it.each(STOP_ES)("%s, in upper, lower and title case, is a Spanish stop (mutation: drop the accent strip → NO MÁS is missed, FAILS)", (w) => {
    for (const text of [w, w.toLowerCase(), w[0] + w.slice(1).toLowerCase()]) {
      expect(matchKeyword(text)).toMatchObject({ kind: "stop", language: "es" });
    }
  });

  it("the decomposed accent an iPhone sends matches too (mutation: normalise NFC instead of NFD → FAILS)", () => {
    expect(matchKeyword("no ma" + String.fromCharCode(0x301) + "s")).toMatchObject({ kind: "stop", word: "NOMAS", language: "es" });
  });

  it("punctuation and symbols at EITHER end, and inner spaces and hyphens, are ignored (plan G9; mutation: strip only the trailing end → ¡Alto! is missed, FAILS; mutation: keep inner hyphens → Opt-out is missed, FAILS)", () => {
    for (const text of ["STOP.", "stop!!!", "Stop 🙏", "  stop  ", "¡Alto!", "¿Baja?", "\"STOP\"", "s t o p", "Opt-out", "no-más"]) {
      expect(matchKeyword(text)?.kind, text).toBe("stop");
    }
  });

  it("the canonical word is what the ledger records, and the drawer prints the spaced forms (mutation: display the canonical form → 'NOMAS' reaches staff, FAILS)", () => {
    expect(matchKeyword("opt out")?.word).toBe("OPTOUT");
    expect(keywordDisplay("OPTOUT")).toBe("OPT OUT");
    expect(keywordDisplay("NOMAS")).toBe("NO MAS");
    expect(keywordDisplay("STOP")).toBe("STOP");
  });

  it("CANCEL and CANCELAR are the two words that also raise the appointment To-do (spec §4.2 step 2; mutation: add END → FAILS)", () => {
    expect([...CANCEL_WORDS].sort()).toEqual(["CANCEL", "CANCELAR"]);
  });
});

describe("matchKeyword — START, UNSTOP, HELP, AYUDA", () => {
  it("START and UNSTOP re-grant; HELP is English help and AYUDA Spanish help (mutation: AYUDA as English → FAILS)", () => {
    expect(matchKeyword("start")).toMatchObject({ kind: "start", word: "START" });
    expect(matchKeyword("Unstop!")).toMatchObject({ kind: "start", word: "UNSTOP" });
    expect(matchKeyword("help?")).toMatchObject({ kind: "help", language: "en" });
    expect(matchKeyword("Ayuda")).toMatchObject({ kind: "help", language: "es" });
  });
});

describe("matchKeyword — what is NOT a keyword", () => {
  it.each([
    "stop by at 3", "Cancel my appointment please", "No", "Stops", "stopp", "end it", "please stop",
    "Yes", "Y", "Si", "Sí", "confirm", "N", "", "   ", "🙏",
  ])("%j is not a keyword: whole message only, and no YES/NO word is one (mutation: match a keyword anywhere in the text → FAILS)", (text) => {
    expect(matchKeyword(text)).toBeNull();
  });

  it("normalises to the matcher's form (the positive control for the table)", () => {
    expect(normaliseKeyword(" ¡No Más! ")).toBe("NOMAS");
  });
});
```

Create `apps/web/src/lib/consent/phrases.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchConfirmationReply } from "@bis/db";
import {
  matchPhrase, normalisePhraseText, PHRASES_EN, PHRASES_ES, ES_VERB_FORMS, ES_MESSAGE_OBJECTS, ES_VERB_PHRASES,
  WHOLE_MESSAGE_PHRASES, REPEATED_KEYWORDS, NOT_FOLLOWED_BY,
} from "./phrases";
import { matchKeyword } from "./keywords";

/**
 * Spec §4.2's phrase list as corrected (S9: danlo's 2026-09-28 decisions),
 * matched ignoring case, accents and punctuation (apostrophes dropped, so
 * "don't text" is "dont text"). A false match only holds texts; a missed
 * sentence is the risk, which is why staff can still stop texts by hand.
 *
 * The expected lists are LITERALS here, not the module's own arrays: a test
 * that iterates the implementation's list cannot notice a phrase dropped from
 * it (review R2-I5).
 */
const EXPECTED_EN = [
  "stop texting", "stop sending", "stop messaging", "stop contacting", "dont text", "do not text",
  "dont message", "do not message", "no more texts", "no more messages", "remove me", "take me off",
  "unsubscribe me", "wrong number",
  "no more texting", "do not contact me", "dont contact me",
];
const EXPECTED_ES = [
  "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado",
  "quitenme de su lista", "quitenme de la lista", "quiteme de su lista", "quiteme de la lista",
  "quitame de su lista", "quitame de la lista", "saquenme de su lista", "saquenme de la lista",
  "saqueme de su lista", "saqueme de la lista", "sacame de su lista", "sacame de la lista",
];
const EXPECTED_VERB_FORMS = [
  "no me manden", "no me mande", "no me mandes", "no me envien", "no me envie", "no me envies",
  "no me escriban", "no me escriba", "no me escribas",
  "dejen de mandarme", "deje de mandarme", "deja de mandarme", "dejen de enviarme", "deje de enviarme",
  "deja de enviarme", "dejen de escribirme", "deje de escribirme", "deja de escribirme",
  "dejen de mandar", "deje de mandar", "deja de mandar", "dejen de enviar", "deje de enviar", "deja de enviar",
  "dejen de escribir", "deje de escribir", "deja de escribir",
  "no quiero recibir",
];
const EXPECTED_OBJECTS = ["mensajes", "textos", "nada", "mas"];
const EXPECTED_VERB_PHRASES = EXPECTED_VERB_FORMS.flatMap((v) => EXPECTED_OBJECTS.map((o) => `${v} ${o}`));
const EXPECTED_WHOLE = [
  { phrase: "please stop", language: "en" }, { phrase: "stop please", language: "en" },
  { phrase: "borrenme", language: "es" }, { phrase: "borreme", language: "es" }, { phrase: "borrame", language: "es" },
  { phrase: "dejen de escribirme", language: "es" }, { phrase: "deje de escribirme", language: "es" },
  { phrase: "deja de escribirme", language: "es" }, { phrase: "no me escriban", language: "es" },
  { phrase: "no me escriba", language: "es" }, { phrase: "no me escribas", language: "es" },
];
const EXPECTED_REPEATED = [
  { word: "stop", language: "en" }, { word: "parar", language: "es" }, { word: "alto", language: "es" }, { word: "baja", language: "es" },
];

describe("matchPhrase — every sentence phrase, in a real sentence", () => {
  it.each(EXPECTED_EN)("English %j matches inside a sentence (mutation: drop the phrase from PHRASES_EN → FAILS)", (phrase) => {
    expect(matchPhrase(`Hi, please ${phrase} ok? Thanks`)).toEqual({ phrase, language: "en" });
  });

  it.each([...EXPECTED_ES, ...EXPECTED_VERB_PHRASES])("Spanish %j matches inside a sentence (mutation: drop the phrase, a verb form or an object → FAILS)", (phrase) => {
    expect(matchPhrase(`Hola, por favor ${phrase} ya, gracias`)).toEqual({ phrase, language: "es" });
  });
});

describe("matchPhrase — how people actually write", () => {
  it("apostrophes, curly or straight, accents, capitals and punctuation are ignored (mutation: keep apostrophes → \"Don't text me\" is missed, FAILS)", () => {
    expect(matchPhrase("Don't text me anymore")?.phrase).toBe("dont text");
    expect(matchPhrase("don’t message me!!")?.phrase).toBe("dont message");
    expect(matchPhrase("STOP TEXTING ME.")?.phrase).toBe("stop texting");
    expect(matchPhrase("Número equivocado")?.phrase).toBe("numero equivocado");
    expect(matchPhrase("Don't contact me again")?.phrase).toBe("dont contact me");
  });

  it("Spanish about MESSAGES holds — a verb form with its message object, the list, the other message phrases (danlo 2026-09-28; mutation: drop \"mas\" from the objects → \"No me manden más\" is missed, FAILS)", () => {
    expect(matchPhrase("Dejen de mandarme mensajes")?.phrase).toBe("dejen de mandarme mensajes");
    expect(matchPhrase("Dejen de enviarme mensajes")?.phrase).toBe("dejen de enviarme mensajes");
    expect(matchPhrase("Deje de mandarme mensajes")?.phrase).toBe("deje de mandarme mensajes");
    expect(matchPhrase("No me mande más mensajes")?.phrase).toBe("no me mande mas");
    expect(matchPhrase("No me envíe mensajes")?.phrase).toBe("no me envie mensajes");
    expect(matchPhrase("No me mandes mensajes")?.phrase).toBe("no me mandes mensajes");
    expect(matchPhrase("No me manden más")?.phrase).toBe("no me manden mas");
    expect(matchPhrase("Ya no me mande nada")?.phrase).toBe("no me mande nada");
    expect(matchPhrase("Ya no me manden mensajes")?.phrase).toBe("no me manden mensajes");
    expect(matchPhrase("No me mande mensajes de texto")?.phrase).toBe("no me mande mensajes");
    expect(matchPhrase("Quíteme de la lista")?.phrase).toBe("quiteme de la lista");
    expect(matchPhrase("Quítenme de su lista por favor")?.phrase).toBe("quitenme de su lista");
    expect(matchPhrase("Sáquenme de su lista")?.phrase).toBe("saquenme de su lista");
    expect(matchPhrase("Sácame de la lista")?.phrase).toBe("sacame de la lista");
    expect(matchPhrase("No más textos")?.phrase).toBe("no mas textos");
    expect(matchPhrase("No quiero más mensajes")?.phrase).toBe("no quiero mas mensajes");
  });

  it("Spanish NOT about messages does not hold: a bare verb form, a list that is not the texting list, a cita, voicemail (danlo 2026-09-28; mutation: let a bare verb form count → \"No me mande la factura\" holds, FAILS)", () => {
    for (const text of [
      "No me mande a nadie mañana, va a llover", "No me mande la factura", "No me envíe el recibo, ya pagué",
      "Deje de mandar a Juan", "Quíteme de las 3 y póngame a las 5", "Quítame de la cita del martes",
      "Bórreme la cita del lunes", "Ya no me mande al muchacho ese, corta mal", "No me mandes la foto todavía",
      "No quiero recibir la factura en papel", "Si no me manda la dirección no puedo ir", "quiteme la cita",
    ]) expect(matchPhrase(text), text).toBeNull();
  });

  it("\"No me mande mensajes de voz, mejor texto\" does NOT hold, and \"Quíteme de la lista de espera\" does NOT hold: voicemail and a waiting list are not the texting list — the first one even asks for texts (plan decision on danlo's rule; mutation: drop NOT_FOLLOWED_BY → both hold, FAILS)", () => {
    expect(matchPhrase("No me mande mensajes de voz, mejor texto")).toBeNull();
    expect(matchPhrase("Quíteme de la lista de espera")).toBeNull();
    // …while a second, real occurrence in the same text still counts:
    expect(matchPhrase("No me mande mensajes de voz. No me mande mensajes, punto")?.phrase).toBe("no me mande mensajes");
  });

  it("an ESCRIBIR form holds as the WHOLE message — writing to the customer IS messaging, and a missed stop is worse than a false hold (orchestrator, under danlo's rule; decision 27; mutation: drop the six from WHOLE_MESSAGE_PHRASES → FAILS)", () => {
    expect(matchPhrase("Dejen de escribirme")).toEqual({ phrase: "dejen de escribirme", language: "es" });
    expect(matchPhrase("Deje de escribirme.")).toEqual({ phrase: "deje de escribirme", language: "es" });
    expect(matchPhrase("¡Deja de escribirme!")).toEqual({ phrase: "deja de escribirme", language: "es" });
    expect(matchPhrase("No me escriban")).toEqual({ phrase: "no me escriban", language: "es" });
    expect(matchPhrase("No me escriba")).toEqual({ phrase: "no me escriba", language: "es" });
    expect(matchPhrase("No me escribas!!")).toEqual({ phrase: "no me escribas", language: "es" });
  });

  it("…but only as the whole message, and the MANDAR / ENVIAR forms stay object-only (\"mandar\" can mean a crew or an invoice): \"No me escriba el martes, mejor llámeme\" and \"Dejen de mandarme\" do NOT hold (mutation: match the escribir forms anywhere → the first holds, FAILS; mutation: make \"dejen de mandarme\" whole-message too → the second holds, FAILS)", () => {
    expect(matchPhrase("No me escriba el martes, mejor llámeme")).toBeNull();
    expect(matchPhrase("Dejen de mandarme")).toBeNull();
    expect(matchPhrase("No me envíe")).toBeNull();
  });
});

describe("matchPhrase — whole-message phrases and a repeated stop word (danlo, 2026-09-28)", () => {
  it("\"please stop\", \"stop please\" and \"Bórreme\" hold only as the WHOLE message, punctuation aside (mutation: drop the whole-message list → FAILS)", () => {
    expect(matchPhrase("Please stop!!")).toEqual({ phrase: "please stop", language: "en" });
    expect(matchPhrase("Stop, please.")).toEqual({ phrase: "stop please", language: "en" });
    expect(matchPhrase("¡Bórreme!")).toEqual({ phrase: "borreme", language: "es" });
    expect(matchPhrase("Bórrenme")).toEqual({ phrase: "borrenme", language: "es" });
  });

  it("\"Please stop by Thursday\" does NOT hold: a whole-message phrase inside a longer text is not a stop request (danlo, 2026-09-28; mutation: match the whole-message phrases anywhere → FAILS)", () => {
    expect(matchPhrase("Please stop by Thursday")).toBeNull();
    expect(matchPhrase("Can you stop please at the store")).toBeNull();
    expect(matchPhrase("Bórreme la cita del lunes")).toBeNull();
  });

  it("a stop word repeated as the whole message holds, in either language, however many times, English allowing one \"please\" at either end (review M2; mutation: drop the repeated-word rule → FAILS; drop the please allowance → \"Stop stop please\" is missed, FAILS)", () => {
    expect(matchPhrase("STOP STOP")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Stop. Stop. Stop.")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Stop stop please")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Please stop stop")).toEqual({ phrase: "stop stop", language: "en" });
    expect(matchPhrase("Parar parar")).toEqual({ phrase: "parar parar", language: "es" });
    expect(matchPhrase("PARAR PARAR")).toEqual({ phrase: "parar parar", language: "es" });
    expect(matchPhrase("Alto alto")).toEqual({ phrase: "alto alto", language: "es" });
    expect(matchPhrase("¡Baja, baja!")).toEqual({ phrase: "baja baja", language: "es" });
  });

  it("…but not one word on its own (that is a keyword, keywords.ts), and not inside a longer text (mutation: accept a single word → \"alto\" holds, FAILS; mutation: find the repeat anywhere → FAILS)", () => {
    expect(matchPhrase("alto")).toBeNull();
    expect(matchPhrase("stop stop by later")).toBeNull();
  });
});

describe("matchPhrase — the fixed negative set", () => {
  it.each([
    "Can you stop by at 3?", "I'll text you the address", "Cancel my appointment please", "No", "Yes",
    "Remove the old gutters", "Take me to the shop", "That texture looks great", "Is the number right?",
    "remove meat from the order", "don't texture the wall", "Please stop by Thursday",
  ])("%j is not a stop request (mutation: substring match without word edges → 'remove meat' or 'texture' matches, FAILS)", (text) => {
    expect(matchPhrase(text)).toBeNull();
  });
});

describe("the lists themselves", () => {
  it("every phrase is already in the matcher's own form, or it could never match (mutation: add a phrase with an accent or a capital → FAILS naming it)", () => {
    for (const p of [...PHRASES_EN, ...PHRASES_ES, ...ES_VERB_PHRASES, ...WHOLE_MESSAGE_PHRASES.map((w) => w.phrase)]) expect(normalisePhraseText(p), p).toBe(p);
    for (const r of REPEATED_KEYWORDS) expect(normalisePhraseText(r.word), r.word).toBe(r.word);
  });

  it("no sentence phrase contains another as whole words, so their order never changes WHETHER a text holds (review M1; mutation: add \"ya no me mande mensajes\" → it contains \"no me mande mensajes\", FAILS)", () => {
    const all = [...PHRASES_EN, ...PHRASES_ES, ...ES_VERB_PHRASES];
    for (const p of all) for (const q of all) if (p !== q) expect(` ${p} `.includes(` ${q} `), `${p} ⊃ ${q}`).toBe(false);
  });

  it("no phrase is a keyword, and no phrase is itself a YES/NO answer as the automation engine reads one, so YES/NO and a phrase can never both fire on one text (spec §4.2 step 5, corrected S5; the engine's own exported matcher — review R2-m14; mutation: add 'no' to PHRASES_ES → FAILS)", () => {
    const all = [...PHRASES_EN, ...PHRASES_ES, ...ES_VERB_PHRASES, ...WHOLE_MESSAGE_PHRASES.map((w) => w.phrase),
      ...REPEATED_KEYWORDS.map((r) => `${r.word} ${r.word}`)];
    for (const p of all) {
      expect(matchKeyword(p), p).toBeNull();
      // YES/NO matches only a whole one-word message, so a text fires both only if it IS a phrase:
      expect(matchConfirmationReply(p), p).toBeNull();
      expect(matchConfirmationReply(`${p}!`), p).toBeNull();
    }
  });

  it("are exactly the corrected spec lists (spec §4.2 as corrected by S9; mutation: drop, add or reorder an entry → FAILS)", () => {
    expect(PHRASES_EN).toEqual(EXPECTED_EN);
    expect(PHRASES_ES).toEqual(EXPECTED_ES);
    expect(ES_VERB_FORMS).toEqual(EXPECTED_VERB_FORMS);
    expect(ES_MESSAGE_OBJECTS).toEqual(EXPECTED_OBJECTS);
    expect(ES_VERB_PHRASES).toEqual(EXPECTED_VERB_PHRASES);
    expect(WHOLE_MESSAGE_PHRASES).toEqual(EXPECTED_WHOLE);
    expect(REPEATED_KEYWORDS).toEqual(EXPECTED_REPEATED);
    expect(NOT_FOLLOWED_BY).toEqual([{ last: "mensajes", next: "de voz" }, { last: "lista", next: "de espera" }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/keywords.test.ts src/lib/consent/phrases.test.ts
```

Expected (predicted; not replayed): both files fail to import.

- [ ] **Step 3: Write the two modules**

Create `apps/web/src/lib/consent/keywords.ts`:

```ts
/**
 * The stop, start and help keywords (consent chain spec decisions 10 and 11,
 * choice 26), matched against the WHOLE message: accents, case, spaces, inner
 * hyphens and the punctuation or symbols at either end are ignored (plan G9:
 * choice 26's reasoning — customers type both — applied to "¡Alto!" and
 * "Opt-out" too). Anything longer than the word itself is not a keyword; the
 * phrase list (phrases.ts) reads sentences.
 *
 * The lists are the spec's. Telnyx's defaults (STOP, STOPALL, STOP ALL,
 * UNSUBSCRIBE, CANCEL, END, QUIT; START, UNSTOP; HELP — plan F2) are all here,
 * so a word Telnyx handles is always one BIS knows too.
 */
export type KeywordKind = "stop" | "start" | "help";
export type KeywordLanguage = "en" | "es";
export type KeywordMatch = { kind: KeywordKind; word: string; language: KeywordLanguage };

const STOP_EN = { kind: "stop", language: "en" } as const;
const STOP_ES = { kind: "stop", language: "es" } as const;

/** Each word in the matcher's own form (no accents, spaces or hyphens) → what it means. */
const KEYWORDS: ReadonlyMap<string, Omit<KeywordMatch, "word">> = new Map<string, Omit<KeywordMatch, "word">>([
  ["STOP", STOP_EN], ["STOPALL", STOP_EN], ["UNSUBSCRIBE", STOP_EN], ["CANCEL", STOP_EN],
  ["END", STOP_EN], ["QUIT", STOP_EN], ["REVOKE", STOP_EN], ["OPTOUT", STOP_EN],
  ["PARAR", STOP_ES], ["DETENER", STOP_ES], ["ALTO", STOP_ES], ["CANCELAR", STOP_ES],
  ["BAJA", STOP_ES], ["NOMAS", STOP_ES],
  ["START", { kind: "start", language: "en" }], ["UNSTOP", { kind: "start", language: "en" }],
  ["HELP", { kind: "help", language: "en" }], ["AYUDA", { kind: "help", language: "es" }],
]);

/** The two words that may also have meant an appointment (spec §4.2 step 2). */
export const CANCEL_WORDS: ReadonlySet<string> = new Set(["CANCEL", "CANCELAR"]);

/** How staff read a matched word: the spec's spaced spellings where it has them. */
const DISPLAY: Readonly<Record<string, string>> = { OPTOUT: "OPT OUT", NOMAS: "NO MAS" };

export function keywordDisplay(word: string): string {
  return DISPLAY[word] ?? word;
}

export function normaliseKeyword(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/^[\s\p{P}\p{S}\p{Cf}]+|[\s\p{P}\p{S}\p{Cf}]+$/gu, "")
    .replace(/[\s\p{Pd}]+/gu, "");
}

export function matchKeyword(text: string): KeywordMatch | null {
  const word = normaliseKeyword(text);
  const hit = KEYWORDS.get(word);
  return hit ? { ...hit, word } : null;
}
```

Create `apps/web/src/lib/consent/phrases.ts`:

```ts
/**
 * The free-text stop phrases (consent chain spec §4.2, decision 5): matched
 * against the message with accents removed, lowercased, apostrophes dropped
 * and every other non-letter a space. A match holds texts and asks staff (a
 * To-do); it never replies (choice 20). Reviewed in PR-2 (danlo, 2026-09-28;
 * spec S9) and extended only with tests. Four kinds:
 *
 * 1. SENTENCE phrases, found as whole words anywhere in the message.
 * 2. SPANISH VERB FORMS, which count ONLY WITH A MESSAGE OBJECT (danlo): "no
 *    me mande mensajes / textos / nada / mas", "deje de mandarme mensajes" …
 *    A bare form ("No me mande la factura", "Deje de mandar a Juan") is not
 *    about messages and does not hold, even as the whole message — except
 *    the ESCRIBIR forms, which ARE about messages and hold as the whole
 *    message (kind 3: "Dejen de escribirme", "No me escriba").
 * 3. WHOLE-MESSAGE phrases, which count only when they ARE the message:
 *    "Please stop!!" holds, "Please stop by Thursday" does not; "Bórreme"
 *    holds, "Bórreme la cita del lunes" does not.
 * 4. A stop word REPEATED as the whole message ("STOP STOP", "Parar parar"),
 *    English allowing one "please" at either end ("Stop stop please"); one
 *    word on its own is a keyword (keywords.ts), not a phrase.
 *
 * No sentence phrase contains another (a test pins it), so their order never
 * changes WHETHER a text holds. Two continuations are not what they look
 * like and do not count: "mensajes de voz" (voicemail) and "lista de espera"
 * (a waiting list).
 */
export type PhraseMatch = { phrase: string; language: "en" | "es" };

export const PHRASES_EN: readonly string[] = [
  "stop texting", "stop sending", "stop messaging", "stop contacting", "dont text", "do not text",
  "dont message", "do not message", "no more texts", "no more messages", "remove me", "take me off",
  "unsubscribe me", "wrong number",
  "no more texting", "do not contact me", "dont contact me",
];

/** Spanish sentence phrases that are about messages on their own. */
export const PHRASES_ES: readonly string[] = [
  "no quiero mas mensajes", "no quiero mensajes", "no mas mensajes", "no mas textos", "numero equivocado",
  "quitenme de su lista", "quitenme de la lista", "quiteme de su lista", "quiteme de la lista",
  "quitame de su lista", "quitame de la lista", "saquenme de su lista", "saquenme de la lista",
  "saqueme de su lista", "saqueme de la lista", "sacame de su lista", "sacame de la lista",
];

/** Spanish verb forms: each counts only followed by one of ES_MESSAGE_OBJECTS (danlo, 2026-09-28). */
export const ES_VERB_FORMS: readonly string[] = [
  "no me manden", "no me mande", "no me mandes", "no me envien", "no me envie", "no me envies",
  "no me escriban", "no me escriba", "no me escribas",
  "dejen de mandarme", "deje de mandarme", "deja de mandarme", "dejen de enviarme", "deje de enviarme",
  "deja de enviarme", "dejen de escribirme", "deje de escribirme", "deja de escribirme",
  "dejen de mandar", "deje de mandar", "deja de mandar", "dejen de enviar", "deje de enviar", "deja de enviar",
  "dejen de escribir", "deje de escribir", "deja de escribir",
  "no quiero recibir",
];
export const ES_MESSAGE_OBJECTS: readonly string[] = ["mensajes", "textos", "nada", "mas"];
/** Every verb form with every object: the sentence phrases the Spanish verb forms become. */
export const ES_VERB_PHRASES: readonly string[] = ES_VERB_FORMS.flatMap((v) => ES_MESSAGE_OBJECTS.map((o) => `${v} ${o}`));

/** Only when they ARE the whole message (danlo, 2026-09-28). */
export const WHOLE_MESSAGE_PHRASES: readonly PhraseMatch[] = [
  { phrase: "please stop", language: "en" }, { phrase: "stop please", language: "en" },
  { phrase: "borrenme", language: "es" }, { phrase: "borreme", language: "es" }, { phrase: "borrame", language: "es" },
  // ESCRIBIR is always about messages ("writing to me" is texting me), so its
  // bare forms hold as the whole message; MANDAR / ENVIAR do not ("mandar"
  // can mean a crew or an invoice), and stay object-only.
  { phrase: "dejen de escribirme", language: "es" }, { phrase: "deje de escribirme", language: "es" },
  { phrase: "deja de escribirme", language: "es" }, { phrase: "no me escriban", language: "es" },
  { phrase: "no me escriba", language: "es" }, { phrase: "no me escribas", language: "es" },
];

/** A stop word repeated as the whole message, any number of times. */
export const REPEATED_KEYWORDS: readonly { word: string; language: "en" | "es" }[] = [
  { word: "stop", language: "en" }, { word: "parar", language: "es" }, { word: "alto", language: "es" }, { word: "baja", language: "es" },
];

/** "mensajes de voz" is voicemail and "lista de espera" a waiting list: a phrase ending in the first word, followed by the rest, does not count. */
export const NOT_FOLLOWED_BY: readonly { last: string; next: string }[] = [
  { last: "mensajes", next: "de voz" }, { last: "lista", next: "de espera" },
];

export function normalisePhraseText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Does the phrase occur, as whole words, at least once in a way that counts? */
function occurs(hay: string, phrase: string): boolean {
  const needle = ` ${phrase} `;
  const last = phrase.slice(phrase.lastIndexOf(" ") + 1);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const rest = hay.slice(at + needle.length);
    if (!NOT_FOLLOWED_BY.some((x) => x.last === last && rest.startsWith(`${x.next} `))) return true;
  }
  return false;
}

export function matchPhrase(text: string): PhraseMatch | null {
  const whole = normalisePhraseText(text);
  const exact = WHOLE_MESSAGE_PHRASES.find((w) => w.phrase === whole);
  if (exact) return { phrase: exact.phrase, language: exact.language };
  const words = whole.split(" ");
  for (const r of REPEATED_KEYWORDS) {
    // English allows one "please" at either end: "Stop stop please", "Please stop stop".
    const core = r.language === "en" && words[0] === "please" ? words.slice(1)
      : r.language === "en" && words[words.length - 1] === "please" ? words.slice(0, -1) : words;
    if (core.length >= 2 && core.every((w) => w === r.word)) return { phrase: `${r.word} ${r.word}`, language: r.language };
  }
  const hay = ` ${whole} `;
  for (const phrase of PHRASES_EN) if (occurs(hay, phrase)) return { phrase, language: "en" };
  for (const phrase of [...PHRASES_ES, ...ES_VERB_PHRASES]) if (occurs(hay, phrase)) return { phrase, language: "es" };
  return null;
}
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/keywords.test.ts src/lib/consent/phrases.test.ts
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass; `tsc` exit 0.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | delete `["REVOKE", STOP_EN]` | "REVOKE, in upper …" |
| 2 | `.normalize("NFC")` | "the decomposed accent an iPhone sends" |
| 3 | leading-end strip removed (`^[…]+|` dropped) | "punctuation and symbols at EITHER end …" |
| 4 | `.replace(/[\s\p{Pd}]+/gu, "")` → `.replace(/\s+/g, "")` | same test (Opt-out, no-más) |
| 5 | `keywordDisplay` returns `word` | "the canonical word is what the ledger records …" |
| 6 | `AYUDA` → `language: "en"` | "START and UNSTOP re-grant; …" |
| 7 | `matchKeyword` tests `text.toUpperCase().includes(key)` for each key | the "is not a keyword" table |
| 8 | phrases: drop the apostrophe removal | "apostrophes, curly or straight …" |
| 9 | `hay.includes(phrase)` (no spaces around) | the fixed negative set ('remove meat', 'texture') |
| 10 | add `"ya no me mande mensajes"` to `PHRASES_ES` | "no sentence phrase contains another …" and "are exactly the corrected spec lists" |
| 11 | add `"no"` to `PHRASES_ES` | "no phrase is a keyword, and no phrase is itself a YES/NO answer …" and "are exactly the corrected spec lists" |
| 12 | delete `"dejen de mandarme"` from `ES_VERB_FORMS` | "Spanish \"dejen de mandarme mensajes\" matches inside a sentence" (and its three siblings), "Spanish about MESSAGES holds …" and "are exactly the corrected spec lists" |
| 13 | let a bare verb form count: match `ES_VERB_FORMS` themselves as sentence phrases | "Spanish NOT about messages does not hold …" and "…but only as the whole message, and the MANDAR / ENVIAR forms stay object-only …" |
| 13b | delete `"no me escriba"` from `WHOLE_MESSAGE_PHRASES` | "an ESCRIBIR form holds as the WHOLE message …" and "are exactly the corrected spec lists" |
| 14 | delete `"borreme"` from `WHOLE_MESSAGE_PHRASES` | "\"please stop\", \"stop please\" and \"Bórreme\" hold only as the WHOLE message …" and "are exactly the corrected spec lists" |
| 15 | match the whole-message phrases anywhere (append `"please stop"`, `"stop please"` to `PHRASES_EN` and the three `borr…me` to `PHRASES_ES`) | "\"Please stop by Thursday\" does NOT hold …", the negative set, and "are exactly the corrected spec lists" |
| 16 | drop the repeated-word loop | "a stop word repeated as the whole message holds …" |
| 17 | `core.length >= 1` in the repeated-word loop | "…but not one word on its own …" (`"alto"`) |
| 18 | the repeated-word loop tests `core.some(…)` | "…but not one word on its own, and not inside a longer text" (`"stop stop by later"`) |
| 19 | drop the `NOT_FOLLOWED_BY` check from `occurs` (return true on the first occurrence) | "\"No me mande mensajes de voz, mejor texto\" does NOT hold …" |
| 20 | delete `"mas"` from `ES_MESSAGE_OBJECTS` | "Spanish about MESSAGES holds …" (`"No me manden más"`) and "are exactly the corrected spec lists" |
| 21 | drop the English `please` allowance (`core = words`) | "a stop word repeated … English allowing one \"please\" …" (`"Stop stop please"`) |
| 22 | delete `{ word: "parar", … }` from `REPEATED_KEYWORDS` | "a stop word repeated …" (`"Parar parar"`) and "are exactly the corrected spec lists" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/keywords.ts apps/web/src/lib/consent/keywords.test.ts \
  apps/web/src/lib/consent/phrases.ts apps/web/src/lib/consent/phrases.test.ts
git commit -m "feat(consent): the stop, start and help keywords and the free-text phrase list, with the spec's matrix"
```

---

### Task 5: Every PR-2 consent line, and the reply text

**Owner:** bis-comms. **Tier:** HIGH (customer-facing and legal copy). **Questions:** none — Q2 was decided on 2026-09-28: the help reply, BIS's and Telnyx's, carries the contact sentence the A2P campaign promises (`docs/runbooks/a2p-registration.md:197-199`), in unaccented Spanish (measured below).

**Why the reply keys are `sms.consentReply.*`, not `consent.reply.*`** (review R2-I4 / R3-I5): scan 2 (`scans.test.ts:186`) reads every `"consent.…"` string in a file that imports the gate as a message KIND and demands it be registered. `replies.ts` imports the gate from Task 8 on, so twelve `consent.reply.*` copy keys there would turn scan 2 red on correct code. The keys sit beside `sms.optOut.*` instead, and Task 14 adds a probe that an unregistered `"consent.help_v2"` is still caught.

**What the help line's contact sentence costs** (measured with `segmentsFor`'s own rules, `apps/web/src/lib/sms/segments.ts` on `76c6acfb`; septets for GSM-7, UTF-16 units for UCS-2):

| Line | "956 Woodworks" | 20-character GSM-7 name | no name |
|---|---|---|---|
| BIS help, English (new) | GSM-7 83 → 1 segment | 90 → 1 | 68 → 1 |
| BIS help, Spanish, "numero" (chosen) | GSM-7 111 → 1 | 118 → 1 | 96 → 1 |
| BIS help, Spanish, "número" (rejected) | UCS-2 111 → 2 | 118 → 2 | 96 → 2 |
| Telnyx bilingual help, "numero" (chosen) | GSM-7 180 → 2 | 187 → 2 | 165 → 2 |
| Telnyx bilingual help, "número" (rejected) | UCS-2 180 → 3 | 187 → 3 | 165 → 3 |
| for comparison: Telnyx bilingual stop | GSM-7 154 → 1 | 161 → 2 | 139 → 1 |

Every one of BIS's own replies is one GSM-7 segment for a 20-character name (the boundary the spec's other lines keep), and "número" would push the Spanish help over it, so the line says "numero" — the spec's own no-á-í-ó-ú rule (§4.2 "Customer-facing texts"). A business name with an accent ("Jardinería López") drops every line to UCS-2 whatever the wording (2 segments for most of BIS's replies, 3 for Telnyx's bilingual ones): a residual, not billed to the business by BIS (G11).

**Files:**
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/consent/copy.test.ts`
- Create: `apps/web/src/lib/consent/replies.ts`, `apps/web/src/lib/consent/replies.test.ts` (Task 8 adds `sendConsentReply` to both)

**Interfaces:**
- Produces: the 52 keys below; `type ReplyKind = "consent.stop_confirmation" | "consent.start_confirmation" | "consent.help"`; `consentReplyBody(kind: ReplyKind, language: "en" | "es", brandName: string): string`; `telnyxReplyText(op: "stop" | "start" | "help", brandName: string): string`; `TELNYX_KEYWORDS: Readonly<Record<"stop" | "start" | "help", readonly string[]>>`.

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/consent/copy.test.ts` — append at the end of the file:

```ts
describe("PR-2: the spec's own words (§4.2 and §6), verbatim", () => {
  it("the six customer replies of §4.2's table, with {Business} (mutation: reword any one → FAILS)", () => {
    expect(m["sms.consentReply.stop.en"]).toBe("{Business}: You won't get any more texts from us. Reply START to get them again.");
    expect(m["sms.consentReply.stop.es"]).toBe("{Business}: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.");
    expect(m["sms.consentReply.start.en"]).toBe("{Business}: You'll get our texts again. Reply STOP to stop them.");
    expect(m["sms.consentReply.start.es"]).toBe("{Business}: Listo, le enviaremos mensajes de nuevo. Responda PARAR para dejarlos.");
    expect(m["sms.consentReply.help.en"]).toBe("{Business}: Reply STOP to stop texts from us. Call or text this number for help.");
    expect(m["sms.consentReply.help.es"]).toBe("{Business}: Responda PARAR para dejar de recibir mensajes. Llame o escriba a este numero para recibir ayuda.");
  });

  it("each nameless variant is its named line without the \"{Business}: \" prefix (the text-back's rule; mutation: a nameless line that differs → FAILS)", () => {
    for (const k of ["stop", "start", "help"] as const) {
      for (const l of ["en", "es"] as const) {
        expect(`{Business}: ${m[`sms.consentReply.${k}.noName.${l}` as keyof typeof m]}`).toBe(m[`sms.consentReply.${k}.${l}` as keyof typeof m]);
      }
    }
  });

  it("the Texts row's own words from §6 (mutation: reword → FAILS)", () => {
    expect(m["contact.texts.loadFailed"]).toBe("Couldn't load their message settings. Try again.");
    expect(m["contact.texts.customerOnly"]).toBe("They can text START to get texts again.");
    expect(m["contact.texts.resumeNoteLabel"]).toBe("What did they ask for? (required)");
    expect(m["contact.texts.stopTexts"]).toBe("Stop texts");
    expect(m["contact.texts.stoppedToast"]).toBe("Texts stopped.");
    expect(m["contact.texts.confirmStop"]).toBe("Confirm stop");
    expect(m["contact.texts.notAStop"]).toBe("Not a stop");
    expect(m["contact.texts.how.keyword"]).toBe("they texted {word}");
    expect(m["contact.texts.how.staff"]).toBe("you recorded it");
    expect(m["contact.texts.how.carrier"]).toBe("the carrier blocked it");
    expect(m["contact.texts.how.unsubscribeLink"]).toBe("unsubscribe link");
  });

  it("the To-do rows of §6, English and Spanish, with their placeholders (mutation: reword → FAILS)", () => {
    expect(m["todo.consent.hold.en"]).toBe("{name} may have asked to stop texts: “{excerpt}”. Texts to them are on hold.");
    expect(m["todo.consent.hold.es"]).toBe("{name} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes están en pausa.");
    expect(m["todo.consent.hold.confirm.es"]).toBe("Confirmar");
    expect(m["todo.consent.hold.notStop.es"]).toBe("No era eso");
    expect(m["todo.consent.cancel.en"]).toBe("{name} texted {word}, so their texts are stopped. Check whether they also meant their appointment on {date}.");
    expect(m["todo.consent.cancel.es"]).toBe("{name} envió {word} y sus mensajes quedaron suspendidos. Revise si también quería cancelar su cita del {date}.");
  });

  it("no PR-2 line exposes a code, a kind, a method or template syntax beyond its own placeholders (DESIGN.md voice; 52 keys, read off messages.ts; mutation: add a line naming 'carrier_block' → FAILS)", () => {
    const keys = Object.keys(m).filter((k) => /^(sms\.consentReply|contact\.texts|todo\.consent)\./.test(k));
    expect(keys.length).toBe(52);
    for (const k of keys) {
      const text = m[k as keyof typeof m];
      expect(text, k).not.toMatch(/\{\{|40300|carrier_block|free_text|backfill|ledger|consent\.|automation\./);
    }
  });
});
```

Create `apps/web/src/lib/consent/replies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { consentReplyBody, telnyxReplyText, TELNYX_KEYWORDS } from "./replies";
import { segmentsFor } from "@/lib/sms/segments";

const KINDS = ["consent.stop_confirmation", "consent.start_confirmation", "consent.help"] as const;

describe("consentReplyBody — what BIS itself sends", () => {
  it("signs with the business name in the language asked (mutation: always English → FAILS)", () => {
    expect(consentReplyBody("consent.stop_confirmation", "es", "956 Woodworks"))
      .toBe("956 Woodworks: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.");
    expect(consentReplyBody("consent.help", "en", "956 Woodworks")).toBe("956 Woodworks: Reply STOP to stop texts from us. Call or text this number for help.");
  });

  it("the help reply names a way to reach the business, in both languages — the A2P campaign's promise (a2p-registration.md:197-199; danlo 2026-09-28; mutation: drop the contact sentence → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "956 Woodworks")).toContain("Call or text this number for help.");
    expect(consentReplyBody("consent.help", "es", "956 Woodworks")).toContain("Llame o escriba a este numero para recibir ayuda.");
  });

  it("a blank name drops the prefix rather than inventing one (mutation: sign as \"\" → ': You won't…', FAILS)", () => {
    expect(consentReplyBody("consent.start_confirmation", "en", "  ")).toBe("You'll get our texts again. Reply STOP to stop them.");
  });

  it("a name holding $& or $1 is printed as written (mutation: .replace with a string replacement → FAILS)", () => {
    expect(consentReplyBody("consent.help", "en", "A$&B")).toBe("A$&B: Reply STOP to stop texts from us. Call or text this number for help.");
  });

  it.each(KINDS.flatMap((k) => (["en", "es"] as const).map((l) => [k, l] as const)))(
    "%s in %s is GSM-7 and ONE segment for a 20-character GSM-7 name (spec: no á, í, ó or ú; mutation: put an accent in the line → UCS-2, FAILS)",
    (kind, lang) => {
      const s = segmentsFor(consentReplyBody(kind, lang, "Rio Grande Plumbing!"));
      expect(s.encoding).toBe("gsm7");
      expect(s.segments).toBe(1);
    });
});

describe("telnyxReplyText — what each business's Telnyx profile answers (Task 16 step 10; danlo's decision 1)", () => {
  it("is the English line then the Spanish line without its prefix, one bilingual reply (mutation: prefix the Spanish half too → FAILS)", () => {
    expect(telnyxReplyText("stop", "956 Woodworks")).toBe(
      "956 Woodworks: You won't get any more texts from us. Reply START to get them again. Ya no le enviaremos mensajes. Responda START para volver a recibirlos.");
  });

  it("is at least Telnyx's 20 characters and GSM-7 for every op, even nameless (plan F2; mutation: an empty reply → FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const t = telnyxReplyText(op, "");
      expect(t.length).toBeGreaterThanOrEqual(20);
      expect(segmentsFor(t).encoding).toBe("gsm7");
    }
  });

  it("with a 20-character GSM-7 name every Telnyx reply stays GSM-7 and at most two segments (measured: stop 161 → 2, start 144 → 1, help 187 → 2; mutation: \"número\" in the Spanish help → UCS-2, three segments, FAILS)", () => {
    for (const op of ["stop", "start", "help"] as const) {
      const s = segmentsFor(telnyxReplyText(op, "Rio Grande Plumbing!"));
      expect(s.encoding, op).toBe("gsm7");
      expect(s.segments, op).toBeLessThanOrEqual(2);
    }
  });

  it("the stop config lists every stop word of decision 10, each at most once, within Telnyx's 20 (plan F2; mutation: drop NO MÁS → FAILS)", () => {
    expect(TELNYX_KEYWORDS.stop).toEqual([
      "STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT",
      "PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS",
    ]);
    expect(new Set(TELNYX_KEYWORDS.stop).size).toBe(TELNYX_KEYWORDS.stop.length);
    expect(TELNYX_KEYWORDS.stop.length).toBeLessThanOrEqual(20);
    expect(TELNYX_KEYWORDS.start).toEqual(["START", "UNSTOP"]);
    expect(TELNYX_KEYWORDS.help).toEqual(["HELP", "AYUDA"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/copy.test.ts src/lib/consent/replies.test.ts
```

Expected (predicted; not replayed): `replies.test.ts` fails to import; `copy.test.ts`'s PR-2 block fails (the keys are undefined); its PR-1 blocks still pass.

- [ ] **Step 3: Write the copy and the module**

Edit `apps/web/src/lib/messages.ts`:

Find:
```ts
  "contact.phoneCountry.inlineChanged": "Their number changed since your edit. Reload to see it.",
```
Replace with (the line itself, then the Texts row's lines):
```ts
  "contact.phoneCountry.inlineChanged": "Their number changed since your edit. Reload to see it.",
  // The rest of the Texts row (consent chain PR-2, spec §6). Status words are
  // a dot + word (rule 3). "{date}" is a calendar day in the account's zone;
  // "{word}" is the keyword as staff read it (keywordDisplay); "{excerpt}" is
  // what the customer wrote, cut at 60 characters; "{name}" is the staff
  // member's first name (plan G14).
  "contact.texts.allowed": "Allowed",
  "contact.texts.stopped": "Stopped",
  "contact.texts.held": "On hold",
  "contact.texts.since": "Since {date}",
  "contact.texts.how.keyword": "they texted {word}",
  "contact.texts.how.freeTextBy": "they wrote “{excerpt}”, confirmed by {name}",
  "contact.texts.how.freeText": "they wrote “{excerpt}”, confirmed by your team",
  "contact.texts.how.staff": "you recorded it",
  "contact.texts.how.carrier": "the carrier blocked it",
  "contact.texts.how.unsubscribeLink": "unsubscribe link",
  "contact.texts.stopTexts": "Stop texts",
  "contact.texts.stoppedToast": "Texts stopped.",
  "contact.texts.resume": "Resume texts…",
  "contact.texts.resumeNoteLabel": "What did they ask for? (required)",
  "contact.texts.resumeSubmit": "Resume texts",
  "contact.texts.resumeCancel": "Cancel",
  "contact.texts.resumeNoteRequired": "Write what they asked for before you turn texts back on.",
  "contact.texts.resumedToast": "Texts are back on. To stop them again, use Stop texts.",
  "contact.texts.customerOnly": "They can text START to get texts again.",
  "contact.texts.heldLine": "They wrote “{excerpt}”. Texts are on hold.",
  "contact.texts.confirmStop": "Confirm stop",
  "contact.texts.notAStop": "Not a stop",
  "contact.texts.confirmedToast": "Stop confirmed. Texts to them are stopped.",
  "contact.texts.releasedToast": "Hold lifted. Texts to them are back on.",
  "contact.texts.loadFailed": "Couldn't load their message settings. Try again.",
  "contact.texts.changed": "Their texts changed while you were looking. This is where they stand now.",
  "contact.texts.failed": "Couldn't save that — please try again.",
  "contact.texts.noNumber": "They have no number to text.",
  "contact.texts.undoBusy": "Your last change is still saving. Try again in a moment.",
  "contact.texts.undoExpired": "That can no longer be undone here. Use Stop texts or Resume texts instead.",
  // The consent To-do rows (spec §6). The English line is written into
  // tasks.title when the To-do is made (plan G8); the Spanish lines wait for an
  // operator locale. "{date}" is the appointment's calendar day in the account's zone.
  "todo.consent.hold.en": "{name} may have asked to stop texts: “{excerpt}”. Texts to them are on hold.",
  "todo.consent.hold.es": "{name} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes están en pausa.",
  "todo.consent.hold.confirm.es": "Confirmar",
  "todo.consent.hold.notStop.es": "No era eso",
  "todo.consent.cancel.en": "{name} texted {word}, so their texts are stopped. Check whether they also meant their appointment on {date}.",
  "todo.consent.cancel.es": "{name} envió {word} y sus mensajes quedaron suspendidos. Revise si también quería cancelar su cita del {date}.",
  "todo.consent.decided": "This one was already decided. Open the contact to see where their texts stand.",
  "todo.consent.decideFirst": "Decide this one with Confirm stop or Not a stop.",
  // The contact timeline's line in place of Done for an open To-do whose
  // number is still on hold (review R3-N1). It points at the To do page, the
  // one place that can always close it: after a phone correction the Texts
  // row no longer shows the old number's hold (review M3), and a CANCEL
  // To-do the fail-closed read marks keeps its Done there (review M4).
  "todo.consent.timelineHint": "Close this one from the To do page.",
  "todo.consent.failed": "Couldn't save that — please try again.",
```

Find:
```ts
  "sms.optOut.en": "Reply STOP to opt out.",
  "sms.optOut.es": "Responde STOP para cancelar.",
```
Replace with (the two lines, then the consent replies):
```ts
  "sms.optOut.en": "Reply STOP to opt out.",
  "sms.optOut.es": "Responde STOP para cancelar.",
  // The consent replies (spec §4.2's table, verbatim, with the help line's
  // contact sentence added by spec correction S12): the ONE stop
  // confirmation, the start confirmation and the help reply. Kept under
  // sms.* on purpose: a "consent.…" string in a gate-importing file reads as
  // a message kind to scan 2 (scans.test.ts). No á, í, ó or ú (UCS-2 would
  // double every one); replies.test.ts measures each at one GSM-7 segment.
  // "{Business}" is brandDisplayName; a blank name uses the noName line, the
  // text-back's rule (textback-body.ts).
  "sms.consentReply.stop.en": "{Business}: You won't get any more texts from us. Reply START to get them again.",
  "sms.consentReply.stop.es": "{Business}: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.",
  "sms.consentReply.stop.noName.en": "You won't get any more texts from us. Reply START to get them again.",
  "sms.consentReply.stop.noName.es": "Ya no le enviaremos mensajes. Responda START para volver a recibirlos.",
  "sms.consentReply.start.en": "{Business}: You'll get our texts again. Reply STOP to stop them.",
  "sms.consentReply.start.es": "{Business}: Listo, le enviaremos mensajes de nuevo. Responda PARAR para dejarlos.",
  "sms.consentReply.start.noName.en": "You'll get our texts again. Reply STOP to stop them.",
  "sms.consentReply.start.noName.es": "Listo, le enviaremos mensajes de nuevo. Responda PARAR para dejarlos.",
  "sms.consentReply.help.en": "{Business}: Reply STOP to stop texts from us. Call or text this number for help.",
  "sms.consentReply.help.es": "{Business}: Responda PARAR para dejar de recibir mensajes. Llame o escriba a este numero para recibir ayuda.",
  "sms.consentReply.help.noName.en": "Reply STOP to stop texts from us. Call or text this number for help.",
  "sms.consentReply.help.noName.es": "Responda PARAR para dejar de recibir mensajes. Llame o escriba a este numero para recibir ayuda.",
```

Key count (the copy test's 52, counted off the two blocks above): `sms.consentReply.*` 12; `contact.texts.*` 30; `todo.consent.*` 10.

Create `apps/web/src/lib/consent/replies.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * The consent replies (spec §4.2's table): the ONE stop confirmation, the
 * start confirmation and the help reply, BIS's own words. BIS sends one only
 * when Telnyx did not already answer the keyword itself (plan G4); when Telnyx
 * did, the customer's reply IS the profile's configured text, which
 * `telnyxReplyText` gives for Task 16's step 0.
 */
export type ReplyKind = "consent.stop_confirmation" | "consent.start_confirmation" | "consent.help";

const LINES = {
  "consent.stop_confirmation": { en: ["sms.consentReply.stop.en", "sms.consentReply.stop.noName.en"], es: ["sms.consentReply.stop.es", "sms.consentReply.stop.noName.es"] },
  "consent.start_confirmation": { en: ["sms.consentReply.start.en", "sms.consentReply.start.noName.en"], es: ["sms.consentReply.start.es", "sms.consentReply.start.noName.es"] },
  "consent.help": { en: ["sms.consentReply.help.en", "sms.consentReply.help.noName.en"], es: ["sms.consentReply.help.es", "sms.consentReply.help.noName.es"] },
} as const satisfies Record<ReplyKind, Record<"en" | "es", readonly [keyof typeof m, keyof typeof m]>>;

/** The reply in the language asked, signed with the customer-facing name; a blank name drops the prefix. */
export function consentReplyBody(kind: ReplyKind, language: "en" | "es", brandName: string): string {
  const [named, nameless] = LINES[kind][language];
  const name = brandName.trim();
  return name ? m[named].replace("{Business}", () => name) : m[nameless];
}

/**
 * The keywords each business's Telnyx profile lists: one bilingual config per
 * operation for each sender country, US, MX and CA (Task 16; plan F2, F3;
 * danlo 2026-09-28 — a Canadian +1 sender gets the named reply too). Every
 * stop word of decision 10 is in the stop config, so each one gets the
 * business-named reply below; START, UNSTOP and HELP are Telnyx's own
 * defaults, listed so their replies are ours.
 */
export const TELNYX_KEYWORDS = {
  stop: [
    "STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPT OUT", "OPTOUT",
    "PARAR", "DETENER", "ALTO", "CANCELAR", "BAJA", "NO MAS", "NO MÁS",
  ],
  start: ["START", "UNSTOP"],
  help: ["HELP", "AYUDA"],
} as const satisfies Record<"stop" | "start" | "help", readonly string[]>;

/** One bilingual reply per operation: the English line, then the Spanish line without its prefix (spec §5 step 0). */
export function telnyxReplyText(op: "stop" | "start" | "help", brandName: string): string {
  const kind: ReplyKind = op === "stop" ? "consent.stop_confirmation" : op === "start" ? "consent.start_confirmation" : "consent.help";
  return `${consentReplyBody(kind, "en", brandName)} ${consentReplyBody(kind, "es", "")}`;
}
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/copy.test.ts src/lib/consent/replies.test.ts src/lib/messages.test.ts
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass (`messages.test.ts` scans every key, so the new ones pass its voice rules too); `tsc` exit 0.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `sms.consentReply.stop.es` → "…mensajes. Responda START para recibirlos." | "the six customer replies of §4.2's table" |
| 2 | `sms.consentReply.help.noName.en` → "Reply STOP to stop texts." | "each nameless variant is its named line …" |
| 3 | `sms.consentReply.start.es`: "Listo" → "Listo, ya" plus "más" | "…is GSM-7 and ONE segment …" |
| 4 | `consentReplyBody`: `.replace("{Business}", name)` | "a name holding $& or $1 …" |
| 5 | `consentReplyBody`: ignore `language` (always `en`) | "signs with the business name in the language asked" |
| 6 | `telnyxReplyText`: `consentReplyBody(kind, "es", brandName)` for the second half | "is the English line then the Spanish line without its prefix" |
| 7 | drop `"NO MÁS"` from `TELNYX_KEYWORDS.stop` | "the stop config lists every stop word …" |
| 8 | add `"contact.texts.debug": "carrier_block"` | "no PR-2 line exposes a code …" |
| 9 | `sms.consentReply.help.es`: "numero" → "número" | "…is GSM-7 and ONE segment …" and "with a 20-character GSM-7 name every Telnyx reply stays GSM-7 …" |
| 10 | drop " Call or text this number for help." from `sms.consentReply.help.en` and its noName twin | "the help reply names a way to reach the business …" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/consent/copy.test.ts apps/web/src/lib/consent/replies.ts apps/web/src/lib/consent/replies.test.ts
git commit -m "feat(consent): every PR-2 consent line, the reply text and the Telnyx profile's keywords and replies"
```

---

### Task 6: The three consent kinds and the gate's one exception

**Owner:** bis-comms. **Tier:** HIGH (the only send to a stopped address). **Questions:** none.

**Files:**
- Modify: `apps/web/src/lib/consent/classes.ts`, `classes.test.ts`, `gate.ts`, `gate.test.ts`, `composer-state.ts`, `composer-state.test.ts`
- Modify: `apps/web/src/lib/automations/send-sms.ts`, `apps/web/src/lib/automations/send-sms.test.ts`

**Interfaces:**
- Consumes: PR-1's gate.
- Produces: `SMS_KINDS` gains `consent.stop_confirmation`, `consent.start_confirmation`, `consent.help` (class `consent_reply`, hours `any`, footer `none`); `SmsRequest.answersEventId?: string`; `SmsBlockReason` gains `"stop_confirmation_stale"`; `ClearedSms.answersEventId: string | null`; `STOP_CONFIRMATION_WINDOW_MS = 300_000`; `answersStop(state: { eventId: string; since: string }, answersEventId: string | null, now: Date): boolean`.

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/consent/classes.test.ts`:

Find:
```ts
  "operator.alert_phone_code": ["operator", "any", "none"],
};
```
Replace with:
```ts
  "operator.alert_phone_code": ["operator", "any", "none"],
  // PR-2 (spec §4.1 item 2's last row; choice 18: any hour). No footer: each
  // line carries its own way out (spec §4.2's table).
  "consent.stop_confirmation": ["consent_reply", "any", "none"],
  "consent.start_confirmation": ["consent_reply", "any", "none"],
  "consent.help": ["consent_reply", "any", "none"],
};
```

Find:
```ts
  it("has exactly the spec's eleven PR-1 kinds, no more and no fewer — which also proves the consent.* kinds are NOT here yet (PR-2 is the first code to send them): a set equal to SPEC_TABLE's eleven names has no room for a twelfth (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(SMS_KINDS).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    expect(Object.keys(SMS_KINDS)).toHaveLength(11);
  });
```
Replace with:
```ts
  it("has exactly the spec's fourteen kinds — PR-1's eleven and PR-2's three consent replies — no more and no fewer (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(SMS_KINDS).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    expect(Object.keys(SMS_KINDS)).toHaveLength(14);
  });
```

Edit `apps/web/src/lib/consent/gate.test.ts`:

Find:
```ts
import { decideSms, deliverSms, sendSms, type SmsRequest, type ClearedSms } from "./gate";
```
Replace with:
```ts
import { decideSms, deliverSms, sendSms, answersStop, STOP_CONFIRMATION_WINDOW_MS, type SmsRequest, type ClearedSms } from "./gate";
```

Append at the end of the file:

```ts
describe("the stop confirmation: the only send to a stopped address (spec §4.2, plan G5)", () => {
  const STOPPED_AT = new Date(DAY.getTime() - 2 * 60_000).toISOString();
  const stopped = (eventId = "rev_1", since = STOPPED_AT) => ({ state: "stopped" as const, since, method: "keyword" as const, eventId });
  const confirm = (over: Partial<SmsRequest> = {}) => base({ kind: "consent.stop_confirmation", body: "956 Woodworks: You won't…", answersEventId: "rev_1", numberFromCarrier: true, ...over });

  it("goes through when it answers the NEWEST revoked row, under five minutes old, and is sent as written, no footer (mutation: drop the exception → blocked stopped, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    const r = await sendSms(DB, confirm());
    expect(r).toMatchObject({ kind: "sent", body: "956 Woodworks: You won't…" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is refused when the newest revoked row is ANOTHER one — a stop it does not answer (mutation: skip the id comparison → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped("rev_2"));
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stopped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("is refused at five minutes and sent at four minutes 59 (mutation: drop the age check → the late one is sent, FAILS; mutation: <= → the boundary is sent, FAILS)", async () => {
    const at = (ms: number) => new Date(DAY.getTime() - ms).toISOString();
    db.readConsentState.mockResolvedValue(stopped("rev_1", at(STOP_CONFIRMATION_WINDOW_MS)));
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stopped" });
    db.readConsentState.mockResolvedValue(stopped("rev_1", at(STOP_CONFIRMATION_WINDOW_MS - 1_000)));
    expect((await sendSms(DB, confirm())).kind).toBe("sent");
    expect(STOP_CONFIRMATION_WINDOW_MS).toBe(300_000);
  });

  it("is refused with no answersEventId at all (mutation: treat a missing id as a match → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    expect(await sendSms(DB, confirm({ answersEventId: undefined }))).toEqual({ kind: "blocked", reason: "stopped" });
  });

  it("an address that is no longer stopped is refused as stale, never told 'you won't get any more texts' (mutation: let an allowed address through → sent, FAILS)", async () => {
    db.readConsentState.mockResolvedValue({ state: "allowed" });
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "stop_confirmation_stale" });
    db.readConsentState.mockResolvedValue({ state: "held", since: STOPPED_AT, method: "free_text", eventId: "h1" });
    expect(await sendSms(DB, confirm())).toEqual({ kind: "blocked", reason: "held" });
  });

  it("no other kind gets the exception, whatever id it carries (mutation: apply it to every kind → the help reply is sent to a stopped address, FAILS)", async () => {
    db.readConsentState.mockResolvedValue(stopped());
    for (const kind of ["consent.help", "consent.start_confirmation", "staff.composer_sms"] as const) {
      expect(await sendSms(DB, confirm({ kind })), kind).toEqual({ kind: "blocked", reason: "stopped" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("the deliver re-check honours the same exception, with the id the decision carried (mutation: re-check with answersEventId null → blocked, FAILS)", async () => {
    // The re-check judges the five minutes at the REAL clock (a delay between
    // decide and deliver counts), so the clock is pinned to DAY here: without
    // it this case would turn red on its own after 2026-10-06.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAY);
    try {
      db.readConsentState.mockResolvedValue(stopped());
      const d = await decideSms(DB, confirm());
      if (d.kind !== "clear") throw new Error(`expected clear, got ${d.kind}`);
      expect(d.send.answersEventId).toBe("rev_1");
      expect((await deliverSms(DB, d.send)).kind).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the consent kinds go at 03:00 (choice 18) and carry no footer (mutation: give consent.help automated hours → deferred, FAILS)", async () => {
    const night = new Date("2026-10-07T08:00:00Z"); // 03:00 in Chicago
    const d = await decideSms(DB, base({ kind: "consent.help", body: "956 Woodworks: Reply STOP to stop texts from us.", now: night }));
    expect(d.kind === "clear" && d.send.body).toBe("956 Woodworks: Reply STOP to stop texts from us.");
  });

  it("answersStop, pure: an unparseable 'since' is never within the window (mutation: treat NaN as 0 → true, FAILS)", () => {
    expect(answersStop({ eventId: "e", since: "not a date" }, "e", DAY)).toBe(false);
    expect(answersStop({ eventId: "e", since: DAY.toISOString() }, "e", DAY)).toBe(true);
    expect(answersStop({ eventId: "e", since: DAY.toISOString() }, null, DAY)).toBe(false);
  });
});
```

Edit `apps/web/src/lib/consent/composer-state.test.ts` — append at the end of the file:

```ts
describe("composerBlockedLine: the stop confirmation's own refusal", () => {
  it("a staff text never meets stop_confirmation_stale, but if it did it would read as a plain failure, never a stop (mutation: map it to the stopped line → FAILS)", () => {
    expect(composerBlockedLine("stop_confirmation_stale")).toBe(m["compose.smsFailed"]);
  });
});
```

(`composer-state.test.ts` already imports `m` and `composerBlockedLine`, lines 2–3.)

Edit `apps/web/src/lib/automations/send-sms.test.ts` — insert immediately AFTER the case titled "a refusal throws SmsBlocked with the gate's reason, and writes no row (mutation: swallow it → resolves, FAILS)":

```ts
  it("a stale-stop-confirmation refusal, which only a consent reply can meet, is a programming error, never a skipped row (mutation: throw SmsBlocked for it → FAILS)", async () => {
    const odd = fakeSmsGate({ decide: () => ({ kind: "blocked", reason: "stop_confirmation_stale" }) });
    const e = await sendAutomationSms(ctx({ sms: odd }), input()).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(SmsBlocked);
    expect(String(e)).toMatch(/stale stop confirmation/);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/classes.test.ts src/lib/consent/gate.test.ts src/lib/consent/composer-state.test.ts src/lib/automations/send-sms.test.ts
```

Expected (predicted; not replayed): `classes.test.ts` fails (14 ≠ 11 and the three new rows); `gate.test.ts` fails at import (`answersStop` and `STOP_CONFIRMATION_WINDOW_MS` do not exist); `composer-state.test.ts`'s new case fails (the switch has no case for the new reason, so it returns `undefined`). Run `src/lib/automations/send-sms.test.ts` too: its new case fails (the refusal is thrown as `SmsBlocked`).

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/consent/classes.ts`:

Find:
```ts
 * The three `consent.*` kinds (the stop and start confirmations and the
 * help reply) arrive with PR-2, which is the first code to send them.
```
Replace with:
```ts
 * The three `consent.*` kinds (the stop and start confirmations and the
 * help reply) are sent only by lib/consent/replies.ts (source scan), at any
 * hour (choice 18), with no footer: each line carries its own way out.
```

Find:
```ts
  "operator.alert_phone_code": { class: "operator", hours: "any", footer: "none" },
} as const satisfies Record<string, SmsKindSpec>;
```
Replace with:
```ts
  "operator.alert_phone_code": { class: "operator", hours: "any", footer: "none" },
  "consent.stop_confirmation": { class: "consent_reply", hours: "any", footer: "none" },
  "consent.start_confirmation": { class: "consent_reply", hours: "any", footer: "none" },
  "consent.help": { class: "consent_reply", hours: "any", footer: "none" },
} as const satisfies Record<string, SmsKindSpec>;
```

Edit `apps/web/src/lib/consent/gate.ts`:

Find:
```ts
  numberFromCarrier?: boolean;
};

export type SmsBlockReason =
  | "no_number" | "a2p_not_approved" | "no_live_number" | "stopped" | "held"
  | "unconfirmed_number" | "window_after_deadline" | "ledger_unavailable";
```
Replace with:
```ts
  numberFromCarrier?: boolean;
  /** `consent.stop_confirmation` only: the id of the `revoked` row it answers.
   *  The gate lets that one kind through a stopped address only when this
   *  row is still the newest deciding row and under five minutes old (spec
   *  §4.2). Only lib/consent/replies.ts sets it (source scan). */
  answersEventId?: string;
};

export type SmsBlockReason =
  | "no_number" | "a2p_not_approved" | "no_live_number" | "stopped" | "held"
  | "unconfirmed_number" | "window_after_deadline" | "ledger_unavailable"
  /** A stop confirmation for an address that is no longer stopped (a START
   *  landed first): "you won't get any more texts" would be false. */
  | "stop_confirmation_stale";

/** Spec §4.2: the one stop confirmation goes within five minutes of the stop
 *  (today's 47 CFR 64.1200(a)(12) presumes a confirmation sent within five
 *  minutes is consented, choice 18). */
export const STOP_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;

/** Does a stop confirmation answer THIS stop: the newest row, still young? Pure. */
export function answersStop(
  state: { eventId: string; since: string }, answersEventId: string | null, now: Date,
): boolean {
  if (answersEventId === null || state.eventId !== answersEventId) return false;
  const age = now.getTime() - Date.parse(state.since);
  return Number.isFinite(age) && age < STOP_CONFIRMATION_WINDOW_MS;
}
```

Find:
```ts
  readonly contactId: string | null;
  readonly numberFromCarrier: boolean;
};
```
Replace with:
```ts
  readonly contactId: string | null;
  readonly numberFromCarrier: boolean;
  /** The stop this confirmation answers, for the deliver re-check. */
  readonly answersEventId: string | null;
};
```

Find:
```ts
async function consentBlock(
  db: SupabaseClient, accountId: string, kind: SmsKind, address: string, contactId: string | null,
  numberFromCarrier: boolean,
): Promise<SmsBlockReason | null> {
  try {
    const state = await readConsentState(db, accountId, "sms", address);
    if (state.state === "stopped") return "stopped";
    if (state.state === "held") return "held";
```
Replace with:
```ts
async function consentBlock(
  db: SupabaseClient, accountId: string, kind: SmsKind, address: string, contactId: string | null,
  numberFromCarrier: boolean, answersEventId: string | null, now: Date,
): Promise<SmsBlockReason | null> {
  try {
    const state = await readConsentState(db, accountId, "sms", address);
    if (kind === "consent.stop_confirmation") {
      // The one send a stopped address may get (spec §4.2), and ONLY there.
      if (state.state === "held") return "held";
      if (state.state !== "stopped") return "stop_confirmation_stale";
      if (!answersStop(state, answersEventId, now)) return "stopped";
    } else {
      if (state.state === "stopped") return "stopped";
      if (state.state === "held") return "held";
    }
```

Find:
```ts
  const blocked = await consentBlock(db, req.accountId, req.kind, number.e164, contactId, fromCarrier);
  if (blocked) return { kind: "blocked", reason: blocked };
```
Replace with:
```ts
  const answersEventId = req.answersEventId ?? null;
  const blocked = await consentBlock(db, req.accountId, req.kind, number.e164, contactId, fromCarrier, answersEventId, req.now ?? new Date());
  if (blocked) return { kind: "blocked", reason: blocked };
```

Find:
```ts
    send: { [CLEARED]: true, accountId: req.accountId, kind: req.kind, to: number.e164, from: sender.from, body, contactId, numberFromCarrier: fromCarrier },
```
Replace with:
```ts
    send: { [CLEARED]: true, accountId: req.accountId, kind: req.kind, to: number.e164, from: sender.from, body, contactId, numberFromCarrier: fromCarrier, answersEventId },
```

Find:
```ts
    const blocked = await consentBlock(db, cleared.accountId, cleared.kind, cleared.to, cleared.contactId, cleared.numberFromCarrier);
```
Replace with:
```ts
    const blocked = await consentBlock(db, cleared.accountId, cleared.kind, cleared.to, cleared.contactId, cleared.numberFromCarrier, cleared.answersEventId, new Date());
```

Edit `apps/web/src/lib/consent/composer-state.ts`:

Find:
```ts
export function composerBlockedLine(reason: "stopped" | "held" | "unconfirmed_number" | "window_after_deadline"): string {
  switch (reason) {
    case "stopped": return m["compose.smsStoppedUndated"];
    case "held": return m["compose.smsHeld"];
    case "unconfirmed_number": return m["compose.smsCheckNumber"];
    case "window_after_deadline": return m["compose.smsFailed"];
  }
}
```
Replace with:
```ts
export function composerBlockedLine(
  reason: "stopped" | "held" | "unconfirmed_number" | "window_after_deadline" | "stop_confirmation_stale",
): string {
  switch (reason) {
    case "stopped": return m["compose.smsStoppedUndated"];
    case "held": return m["compose.smsHeld"];
    case "unconfirmed_number": return m["compose.smsCheckNumber"];
    // Neither reaches a staff text (no deadline, not a stop confirmation):
    // typed for the gate's full reason list, worded as a plain failure.
    case "window_after_deadline": return m["compose.smsFailed"];
    case "stop_confirmation_stale": return m["compose.smsFailed"];
  }
}
```

Edit `apps/web/src/lib/automations/send-sms.ts`:

Find:
```ts
export type AutomationBlockReason = Exclude<SmsBlockReason, "ledger_unavailable">;
```
Replace with:
```ts
/** An automation never sends a consent reply, so the stop confirmation's own
 *  refusal is not one of its reasons (hold-or-send.ts's BLOCK_REASONS). */
export type AutomationBlockReason = Exclude<SmsBlockReason, "ledger_unavailable" | "stop_confirmation_stale">;
```

Find:
```ts
      if (result.reason === "ledger_unavailable") {
        throw new SmsDeferred(new Date(ctx.now.getTime() + LEDGER_RETRY_MS), "ledger_unavailable");
      }
      throw new SmsBlocked(result.reason);
```
Replace with:
```ts
      if (result.reason === "ledger_unavailable") {
        throw new SmsDeferred(new Date(ctx.now.getTime() + LEDGER_RETRY_MS), "ledger_unavailable");
      }
      if (result.reason === "stop_confirmation_stale") {
        // Only a consent reply can meet it (gate.ts), and no automation sends one.
        throw new Error(`automation sms: ${input.kind} was refused as a stale stop confirmation, which only a consent reply can be`);
      }
      throw new SmsBlocked(result.reason);
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/classes.test.ts src/lib/consent/gate.test.ts src/lib/consent/composer-state.test.ts src/lib/automations/send-sms.test.ts
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass, including PR-1's `it.each(Object.keys(SMS_KINDS))` "blocked by a stop" case, which now runs for the three consent kinds and sees `stopped` for each (the stop confirmation has no `answersEventId` there). `tsc` exit 0 (the automations' `BLOCK_REASONS` record still covers `AutomationBlockReason` exactly). Then the full web suite: every `vi.mock("@bis/db")` factory is unchanged (the gate imports nothing new from `@bis/db`). **One predicted red, on purpose (review R2-I4):** `scans.test.ts` › scan 2's positive control ("the scan reaches every send path's kind — none of the eleven is missing") fails naming `consent.help`, `consent.start_confirmation` and `consent.stop_confirmation`: the registry now holds them, and no file that imports the gate names them until Task 8's `replies.ts` does. It is the one new web failure Checkpoint A allows; Task 8's Step 4 turns it green, and Task 14 retitles it. Every other scan stays green (the reply COPY keys are `sms.consentReply.*`, which scan 2's `KIND_LITERAL` does not read).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `consentBlock`: delete the `consent.stop_confirmation` branch | "goes through when it answers the NEWEST revoked row …" |
| 2 | `answersStop`: drop `state.eventId !== answersEventId` | "is refused when the newest revoked row is ANOTHER one" |
| 3 | `answersStop`: drop the age condition | "is refused at five minutes …" |
| 4 | `answersStop`: `age <= STOP_CONFIRMATION_WINDOW_MS` | same test (the boundary) |
| 5 | `answersStop`: treat a missing id as a match — `if (answersEventId !== null && state.eventId !== answersEventId) return false;` | "is refused with no answersEventId at all" |
| 6 | `if (state.state !== "stopped") return "stop_confirmation_stale"` → `return null` | "an address that is no longer stopped …" |
| 7 | apply the exception when `kind.startsWith("consent.")` | "no other kind gets the exception …" |
| 8 | deliver re-check passes `null` for `answersEventId` | "the deliver re-check honours the same exception …" |
| 9 | `consent.help` hours `automated` | "the consent kinds go at 03:00 …" |
| 10 | `answersStop`: treat NaN as 0 — `const age = Number.isNaN(raw) ? 0 : raw` (with `raw` the subtraction) | "answersStop, pure: …" |
| 11 | send-sms.ts: delete the `stop_confirmation_stale` branch (and widen `SmsBlocked` to take it) | "a stale-stop-confirmation refusal … is a programming error" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/classes.ts apps/web/src/lib/consent/classes.test.ts apps/web/src/lib/consent/gate.ts \
  apps/web/src/lib/consent/gate.test.ts apps/web/src/lib/consent/composer-state.ts apps/web/src/lib/consent/composer-state.test.ts \
  apps/web/src/lib/automations/send-sms.ts apps/web/src/lib/automations/send-sms.test.ts
git commit -m "feat(consent): the three consent reply kinds and the gate's one exception, the fresh stop confirmation"
```

---

### Task 7: Each texting business's own Telnyx messaging profile, recorded, and texting refused without it

**Owner:** bis-comms (with bis-db-schema for 0056). **Tier:** HIGH (it gates every send). **Questions:** none — Q3 was decided on 2026-09-28: record it. This task runs.

**What the refusal also stops** (review R1-M8; danlo's decision stands with these consequences, written here so nobody meets them by surprise). `resolveSmsSender` (`lib/sms/sender.ts:30`) is shared, so while an approved account has no profile id recorded:
1. **"Approved" cannot be saved on the A2P card without a profile id** (`a2pApprovalIsComplete`, below): the agency records the profile first, or in the same save.
2. **Every text the account sends is refused**: automations, the missed-call text-back, consent replies, composer replies.
3. **Owner alerts by SMS are refused too** (`lib/sms/alerts.ts:158`), and so is **the alert phone's verification code** (`settings/actions.ts:329`, "Texting isn't turned on for this account yet, so no verification code can go out. See the Checklist page.").
4. **The reason every screen shows is the existing `a2p_not_approved` wording** ("texting isn't turned on for this account yet"), not a profile-specific line; the A2P card itself is where the agency sees the missing field.
Task 16 step 10 records each business's profile id the moment it creates the profile, so the window is only the time between approval and that step.

**Why (brief item a):** spec §5 makes "one Telnyx messaging profile per texting account" a go-live precondition, because a stop on a shared profile blocks every business on it (F4) and a shared profile's reply cannot name each business (F3). Nothing in the code knows a profile today (R1). The send path needs none (F9: the number's own profile applies). What the app can do is refuse to text for an account until its own profile is recorded, and refuse a second account the same profile. Recorded on the A2P card, beside the brand and campaign ids, by the agency, when step 0 is done (Task 16).

**Files:**
- Create: `packages/db/supabase/migrations/0056_messaging_profile.sql`, `packages/db/src/test/messaging-profile-schema.test.ts`
- Modify: `packages/db/src/accounts.ts`, `packages/db/src/index.ts`, `packages/db/src/test/accounts.test.ts`
- Modify: `apps/web/src/lib/sms/sender.ts`, `apps/web/src/lib/sms/sender.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts`, `…/checklist/a2p-panel.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.test.ts`
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/e2e/blueprints.spec.ts`

**Interfaces:**
- Produces: `accounts.telnyx_messaging_profile_id text null` (lowercase uuid shape; unique where set; not granted to `authenticated`); `A2pRegistration.messagingProfileId: string | null`; `isMessagingProfileId(v: string): boolean`; `MessagingProfileTakenError`; `a2pApprovalIsComplete` requires the profile for `approved`; `resolveSmsSender` refuses `a2p_not_approved` while it is missing.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/messaging-profile-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/** 0056 (consent chain PR-2, plan Task 7). RED BEFORE APPLY: the column does not exist. */
const RUN = Math.random().toString(36).slice(2, 10);
const P1 = "740572b6-099c-44a1-89b9-6c92163bc68d";

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [agency!.id, `org_MP_${label}_${RUN}`, `Profile ${label}`])).rows[0]!.id;
}
async function refused(c: Client, sql: string, p: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try { await c.query(sql, p); return null; } catch (e) { return e; } finally { await c.query("rollback to savepoint probe"); }
}
const SET = "update accounts set telnyx_messaging_profile_id = $2 where id = $1";

describe("0056 accounts.telnyx_messaging_profile_id", () => {
  it("holds one lowercase Telnyx profile id, and no two accounts share one (mutation: drop the unique index → the second account takes P1, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "a");
      const b = await account(c, "b");
      await c.query(SET, [a, P1]);
      expect(await refused(c, SET, [b, P1])).toMatchObject({ code: "23505", constraint: "accounts_telnyx_messaging_profile_id_key" });
      await c.query(SET, [b, null]);
    }));

  it("refuses anything that is not a lowercase uuid (mutation: drop the CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "c");
      for (const bad of [P1.toUpperCase(), "not-a-profile", ""]) {
        expect(await refused(c, SET, [a, bad]), bad).toMatchObject({ code: "23514", constraint: "accounts_telnyx_messaging_profile_id_check" });
      }
    }));

  it("is agency-written only: a client cannot update it (mutation: grant update (telnyx_messaging_profile_id) to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "d");
      await actAs(c, { org_id: `org_MP_d_${RUN}`, sub: "user_mp" });
      expect(await refused(c, SET, [a, P1])).toMatchObject({ code: "42501" });
    }));
});
```

Edit `packages/db/src/test/accounts.test.ts`. In the A2P round-trip test, each `setA2pRegistration` patch gains `messagingProfileId`, and two cases are added:

Find:
```ts
      await setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: "CAMP456", status: "pending",
      }, "user_test");
```
Replace with:
```ts
      await setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: "CAMP456", status: "pending", messagingProfileId: null,
      }, "user_test");
```

Find:
```ts
      await expect(setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: null, status: "approved",
      }, "user_test")).rejects.toThrow(/brand id and a campaign id/);
```
Replace with:
```ts
      await expect(setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: null, status: "approved", messagingProfileId: null,
      }, "user_test")).rejects.toThrow(/brand id, a campaign id and a messaging profile id/);
      // Plan Task 7: approved also needs the business's OWN messaging profile.
      await expect(setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: "CAMP456", status: "approved", messagingProfileId: null,
      }, "user_test")).rejects.toThrow(/messaging profile id/);
```

Find:
```ts
      await setA2pRegistration(db, accountId, {
        brandId: null, campaignId: null, status: "pending",
      }, "user_test");
```
Replace with:
```ts
      await setA2pRegistration(db, accountId, {
        brandId: null, campaignId: null, status: "pending", messagingProfileId: null,
      }, "user_test");
```

And the fourth call, the ghost-account test (`accounts.test.ts:154-155` on `76c6acfb`; without it `tsc` fails on the now-required field, review R1-M2):

Find:
```ts
    await expect(setA2pRegistration(
      db, ghost, { brandId: null, campaignId: null, status: "pending" }, "user_test",
    )).rejects.toThrow(/no account/);
```
Replace with:
```ts
    await expect(setA2pRegistration(
      db, ghost, { brandId: null, campaignId: null, status: "pending", messagingProfileId: null }, "user_test",
    )).rejects.toThrow(/no account/);
```

(`grep -c "setA2pRegistration(" packages/db/src/test/accounts.test.ts` prints 4 on `76c6acfb`; after this task every one of the four passes `messagingProfileId`.)

Edit `apps/web/src/lib/sms/sender.test.ts`: in each of the four fixtures `a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null })`, add `messagingProfileId: "740572b6-099c-44a1-89b9-6c92163bc68d"` (four occurrences; `grep -c 'campaignId: "C", updatedAt: null' src/lib/sms/sender.test.ts` must print 4 before and 0 after). Then insert after the case titled "refuses when approved but no live number exists":

```ts
  it("refuses an APPROVED account with no messaging profile of its own recorded — texting waits for step 0 (plan Task 7; mutation: drop the profile check → the live number is returned, FAILS)", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", messagingProfileId: null, updatedAt: null });
    const gate = await resolveSmsSender(
      dbReturning([{ e164: "+15551112222", status: "live", created_at: "2026-01-01" }]), "acc",
    );
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAgencyOnlyAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn() }));
// vi.mock factories are hoisted above every declaration in this file, so
// what they close over must be made by vi.hoisted (a class declared below
// would be in its temporal dead zone when the factory runs).
const { setA2p, MessagingProfileTakenError } = vi.hoisted(() => ({
  setA2p: vi.fn(),
  MessagingProfileTakenError: class MessagingProfileTakenError extends Error {},
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real, serviceDb: () => ({}), setA2pRegistration: setA2p,
    MessagingProfileTakenError, addCustomChecklistItem: vi.fn(),
  };
});

import { setA2pRegistrationAction } from "./actions";
import { m } from "@/lib/messages";

const P = "740572b6-099c-44a1-89b9-6c92163bc68d";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => { setA2p.mockReset().mockResolvedValue(undefined); });

describe("setA2pRegistrationAction — the messaging profile (plan Task 7)", () => {
  it("approved with brand and campaign but no profile is refused with its own line, and nothing is written (mutation: drop the profile check → the write runs, FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "approved", brandId: "B", campaignId: "C" })))
      .toEqual({ ok: false, error: m["a2p.approvedNeedsProfile"] });
    expect(setA2p).not.toHaveBeenCalled();
  });

  it("a profile id is trimmed and lowercased before it is written (mutation: write it as typed → FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "approved", brandId: "B", campaignId: "C", messagingProfileId: `  ${P.toUpperCase()} ` })))
      .toEqual({ ok: true });
    expect(setA2p.mock.calls[0]![2]).toEqual({ brandId: "B", campaignId: "C", status: "approved", messagingProfileId: P });
  });

  it("something that is not a profile id is refused before the write (mutation: skip isMessagingProfileId → FAILS)", async () => {
    expect(await setA2pRegistrationAction("a1", form({ status: "pending", messagingProfileId: "profile-1" })))
      .toEqual({ ok: false, error: m["a2p.profileMalformed"] });
    expect(setA2p).not.toHaveBeenCalled();
  });

  it("a profile another company already uses says so, never the generic failure (mutation: drop the instanceof branch → saveFailed, FAILS)", async () => {
    setA2p.mockRejectedValue(new MessagingProfileTakenError("taken"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setA2pRegistrationAction("a1", form({ status: "pending", messagingProfileId: P })))
      .toEqual({ ok: false, error: m["a2p.profileTaken"] });
  });
});
```

Edit `apps/web/e2e/blueprints.spec.ts` (the A2P block):

Find:
```ts
    await page.getByLabel("Brand ID").fill("BRAND123");
    await page.getByLabel("Campaign ID").fill("CAMP456");
```
Replace with:
```ts
    await page.getByLabel("Brand ID").fill("BRAND123");
    await page.getByLabel("Campaign ID").fill("CAMP456");
    // Plan Task 7: approved also needs the business's own messaging profile,
    // unique across companies, so the run's own random one.
    await page.getByLabel("Messaging profile ID").fill(crypto.randomUUID());
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd packages/db
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/pre pnpm exec vitest run src/test/messaging-profile-schema.test.ts
cd ../../apps/web
pnpm exec vitest run src/lib/sms/sender.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.test.ts"
```

Expected (predicted; not replayed): all three schema tests fail on `pre` (no column); `sender.test.ts`'s new case fails (the account is cleared); `actions.test.ts` fails on each case (no profile field, no new copy keys).

- [ ] **Step 3: Implement**

Create `packages/db/supabase/migrations/0056_messaging_profile.sql`:

```sql
-- 0056_messaging_profile.sql
-- Consent chain PR-2, plan Task 7 (danlo's answer to Q3). Each texting
-- business's OWN Telnyx messaging profile, recorded by the agency on the A2P
-- card once step 0 is done on Telnyx. Spec section 5: one profile per
-- texting account is a go-live precondition, because Telnyx blocks a STOP at
-- the profile (every number on it) and a profile has one reply text. The app
-- refuses to text for an approved account until this is set
-- (lib/sms/sender.ts), and no two accounts can record the same profile.
--
-- Agency-written through serviceDb only: 0013 and 0053 grant `authenticated`
-- UPDATE on named branding columns of accounts, and this column is not one of
-- them (schema-grants-guard.test.ts pins that list, unchanged).
--
-- ADDITIVE ONLY: the build before this file never reads the column.
-- No backslash anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first):
--   drop index public.accounts_telnyx_messaging_profile_id_key;
--   alter table public.accounts drop column telnyx_messaging_profile_id;

set local lock_timeout = '5s';

alter table public.accounts add column telnyx_messaging_profile_id text
  constraint accounts_telnyx_messaging_profile_id_check check (
    telnyx_messaging_profile_id is null
    or telnyx_messaging_profile_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

create unique index accounts_telnyx_messaging_profile_id_key
  on public.accounts (telnyx_messaging_profile_id) where telnyx_messaging_profile_id is not null;

comment on column public.accounts.telnyx_messaging_profile_id is
  'This business''s own Telnyx messaging profile (a uuid), recorded on the A2P card after step 0. Texting is refused while it is null, and no two accounts share one. Agency-written through serviceDb only.';
```

Edit `packages/db/src/accounts.ts`:

Find:
```ts
/** The writable shape. `getA2pRegistration` returns this plus `updatedAt`. */
export type A2pRegistration = {
  brandId: string | null;
  campaignId: string | null;
  status: A2pStatus;
};
```
Replace with:
```ts
/** The writable shape. `getA2pRegistration` returns this plus `updatedAt`. */
export type A2pRegistration = {
  brandId: string | null;
  campaignId: string | null;
  status: A2pStatus;
  /** This business's OWN Telnyx messaging profile (0056, plan Task 7): lowercase uuid. */
  messagingProfileId: string | null;
};

/** A Telnyx messaging profile id as 0056's CHECK accepts it: a lowercase uuid. */
export function isMessagingProfileId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

/** Another account already recorded this profile (0056's unique index). */
export class MessagingProfileTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagingProfileTakenError";
  }
}
```

Find:
```ts
export function a2pApprovalIsComplete(patch: A2pRegistration): boolean {
  return patch.status !== "approved" || Boolean(patch.brandId && patch.campaignId);
}
```
Replace with:
```ts
export function a2pApprovalIsComplete(patch: A2pRegistration): boolean {
  return patch.status !== "approved" || Boolean(patch.brandId && patch.campaignId && patch.messagingProfileId);
}
```

Find:
```ts
  if (!a2pApprovalIsComplete(patch)) {
    throw new Error("setA2pRegistration: approved requires a brand id and a campaign id");
  }
  const { data, error } = await db.from("accounts")
    .update({
      a2p_brand_id: patch.brandId,
      a2p_campaign_id: patch.campaignId,
      a2p_status: patch.status,
      a2p_updated_at: new Date().toISOString(),
    })
    .eq("id", accountId).select("id");
  if (error) throw new Error(`setA2pRegistration failed: ${error.message}`);
```
Replace with:
```ts
  if (!a2pApprovalIsComplete(patch)) {
    throw new Error("setA2pRegistration: approved requires a brand id, a campaign id and a messaging profile id");
  }
  const { data, error } = await db.from("accounts")
    .update({
      a2p_brand_id: patch.brandId,
      a2p_campaign_id: patch.campaignId,
      a2p_status: patch.status,
      telnyx_messaging_profile_id: patch.messagingProfileId,
      a2p_updated_at: new Date().toISOString(),
    })
    .eq("id", accountId).select("id");
  if (error?.code === "23505") {
    throw new MessagingProfileTakenError(`setA2pRegistration: messaging profile ${patch.messagingProfileId} is another account's`);
  }
  if (error) throw new Error(`setA2pRegistration failed: ${error.message}`);
```

Find:
```ts
  await emit(db, accountId, "account.a2p_updated", actorId, {
    status: patch.status, brandId: patch.brandId, campaignId: patch.campaignId,
  });
```
Replace with:
```ts
  await emit(db, accountId, "account.a2p_updated", actorId, {
    status: patch.status, brandId: patch.brandId, campaignId: patch.campaignId,
    messagingProfileId: patch.messagingProfileId,
  });
```

Find:
```ts
  const { data, error } = await db.from("accounts")
    .select("a2p_brand_id, a2p_campaign_id, a2p_status, a2p_updated_at")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getA2pRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    brandId: data.a2p_brand_id, campaignId: data.a2p_campaign_id,
    status: data.a2p_status as A2pStatus,
    updatedAt: data.a2p_updated_at,
  };
```
Replace with:
```ts
  const { data, error } = await db.from("accounts")
    .select("a2p_brand_id, a2p_campaign_id, a2p_status, a2p_updated_at, telnyx_messaging_profile_id")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getA2pRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    brandId: data.a2p_brand_id, campaignId: data.a2p_campaign_id,
    status: data.a2p_status as A2pStatus,
    messagingProfileId: (data as { telnyx_messaging_profile_id: string | null }).telnyx_messaging_profile_id,
    updatedAt: data.a2p_updated_at,
  };
```

Edit `packages/db/src/index.ts`:

Find:
```ts
         setA2pRegistration, getA2pRegistration, a2pApprovalIsComplete } from "./accounts";
```
Replace with:
```ts
         setA2pRegistration, getA2pRegistration, a2pApprovalIsComplete,
         isMessagingProfileId, MessagingProfileTakenError } from "./accounts";
```

Edit `apps/web/src/lib/sms/sender.ts`:

Find:
```ts
  const a2p = await getA2pRegistration(db, accountId);
  if (a2p?.status !== "approved") return { ok: false, reason: "a2p_not_approved" };
```
Replace with:
```ts
  const a2p = await getA2pRegistration(db, accountId);
  // Approved AND the business's own messaging profile recorded (0056, plan
  // Task 7): spec §5's go-live precondition, enforced where every send path
  // already asks. The A2P card refuses "approved" without it; this is the
  // same rule for a row written any other way.
  if (a2p?.status !== "approved" || !a2p.messagingProfileId) return { ok: false, reason: "a2p_not_approved" };
```

Edit `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts`:

Find:
```ts
  setChecklistItem, addCustomChecklistItem, serviceDb, setA2pRegistration,
  a2pApprovalIsComplete, type A2pStatus,
} from "@bis/db";
```
Replace with:
```ts
  setChecklistItem, addCustomChecklistItem, serviceDb, setA2pRegistration,
  a2pApprovalIsComplete, isMessagingProfileId, MessagingProfileTakenError, type A2pStatus,
} from "@bis/db";
```

Then:

Find:
```ts
  const patch = { brandId: str("brandId"), campaignId: str("campaignId"), status };

  // Checked here as well as in setA2pRegistration so the operator gets a
  // sentence that names the problem instead of the generic write failure the
  // catch below produces. The db-layer guard is the one that binds.
  if (!a2pApprovalIsComplete(patch)) {
    return { ok: false, error: m["a2p.approvedNeedsIds"] };
  }

  try {
    await setA2pRegistration(serviceDb(), accountId, patch, userId);
  } catch (e) {
    console.error(`setA2pRegistrationAction: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["a2p.saveFailed"] };
  }
```
Replace with:
```ts
  const profile = str("messagingProfileId")?.toLowerCase() ?? null;
  if (profile !== null && !isMessagingProfileId(profile)) return { ok: false, error: m["a2p.profileMalformed"] };
  const patch = { brandId: str("brandId"), campaignId: str("campaignId"), status, messagingProfileId: profile };

  // Checked here as well as in setA2pRegistration so the operator gets a
  // sentence that names the problem instead of the generic write failure the
  // catch below produces. The db-layer guard is the one that binds.
  if (status === "approved" && !(patch.brandId && patch.campaignId)) {
    return { ok: false, error: m["a2p.approvedNeedsIds"] };
  }
  if (!a2pApprovalIsComplete(patch)) {
    return { ok: false, error: m["a2p.approvedNeedsProfile"] };
  }

  try {
    await setA2pRegistration(serviceDb(), accountId, patch, userId);
  } catch (e) {
    if (e instanceof MessagingProfileTakenError) return { ok: false, error: m["a2p.profileTaken"] };
    console.error(`setA2pRegistrationAction: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["a2p.saveFailed"] };
  }
```

Edit `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/a2p-panel.tsx`:

Find:
```ts
  const current = registration ?? { brandId: null, campaignId: null, status: "not_started" as const };
```
Replace with:
```ts
  const current = registration ?? { brandId: null, campaignId: null, status: "not_started" as const, messagingProfileId: null };
```

Find:
```ts
  const [campaignId, setCampaignId] = useState(current.campaignId ?? "");
```
Replace with:
```ts
  const [campaignId, setCampaignId] = useState(current.campaignId ?? "");
  const [messagingProfileId, setMessagingProfileId] = useState(current.messagingProfileId ?? "");
```

Find:
```tsx
            <div className="space-y-1.5">
              <Label htmlFor="a2pCampaignId">{m["a2p.campaignId"]}</Label>
              <Input
                id="a2pCampaignId" name="campaignId"
                value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
              />
            </div>
          </div>
```
Replace with:
```tsx
            <div className="space-y-1.5">
              <Label htmlFor="a2pCampaignId">{m["a2p.campaignId"]}</Label>
              <Input
                id="a2pCampaignId" name="campaignId"
                value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a2pMessagingProfileId">{m["a2p.messagingProfileId"]}</Label>
            <Input
              id="a2pMessagingProfileId" name="messagingProfileId" aria-describedby="a2pMessagingProfileIdHint"
              value={messagingProfileId} onChange={(e) => setMessagingProfileId(e.target.value)}
            />
            <p id="a2pMessagingProfileIdHint" className="text-xs text-muted-foreground">{m["a2p.messagingProfileIdHint"]}</p>
          </div>
```

Edit `apps/web/src/lib/messages.ts`:

Find:
```ts
  "a2p.campaignId": "Campaign ID",
```
Replace with:
```ts
  "a2p.campaignId": "Campaign ID",
  // Plan Task 7: the business's own Telnyx messaging profile (spec §5).
  "a2p.messagingProfileId": "Messaging profile ID",
  "a2p.messagingProfileIdHint": "From Telnyx, Messaging, Profiles. Every company needs its own, with its stop words and replies set up, before it can text.",
  "a2p.approvedNeedsProfile": "This company's own messaging profile ID is needed before marking this approved",
  "a2p.profileMalformed": "That doesn't look like a messaging profile ID. Copy it from Telnyx.",
  "a2p.profileTaken": "Another company already uses that messaging profile. Every company needs its own.",
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd packages/db
pnpm exec tsc --noEmit
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/messaging-profile-schema.test.ts src/test/schema-grants-guard.test.ts
cd ../../apps/web
pnpm exec vitest run src/lib/sms/sender.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.test.ts" src/lib/messages.test.ts
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass; `schema-grants-guard.test.ts` unchanged (the column is not granted). Then the full web suite. `blueprints.spec.ts` runs in CI's e2e only.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | 0056: drop the unique index | "holds one lowercase Telnyx profile id, and no two accounts share one" |
| 2 | 0056: drop the CHECK | "refuses anything that is not a lowercase uuid" |
| 3 | 0056: `grant update (telnyx_messaging_profile_id) on public.accounts to authenticated` | "is agency-written only" and `schema-grants-guard.test.ts` |
| 4 | sender.ts: drop `|| !a2p.messagingProfileId` | "refuses an APPROVED account with no messaging profile …" |
| 5 | actions.ts: drop the `approvedNeedsProfile` return | "approved with brand and campaign but no profile is refused …" |
| 6 | actions.ts: no `.toLowerCase()` | "a profile id is trimmed and lowercased …" |
| 7 | actions.ts: drop the `isMessagingProfileId` check | "something that is not a profile id is refused …" |
| 8 | actions.ts: drop the `instanceof MessagingProfileTakenError` branch | "a profile another company already uses says so …" |
| 9 | accounts.ts: `a2pApprovalIsComplete` without the profile | `accounts.test.ts` (CI) "messaging profile id" |

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/0056_messaging_profile.sql packages/db/src/test/messaging-profile-schema.test.ts \
  packages/db/src/accounts.ts packages/db/src/index.ts packages/db/src/test/accounts.test.ts \
  apps/web/src/lib/sms/sender.ts apps/web/src/lib/sms/sender.test.ts apps/web/src/lib/messages.ts apps/web/e2e/blueprints.spec.ts \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/a2p-panel.tsx"
git commit -m "feat(a2p): each business's own Telnyx messaging profile on the A2P card; texting waits for it (0056)"
```

---

### Task 8: The inbound consent step, and the reply sender

**Owner:** bis-comms. **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/inbound.ts`, `apps/web/src/lib/consent/inbound.test.ts`
- Modify: `apps/web/src/lib/consent/replies.ts`, `apps/web/src/lib/consent/replies.test.ts` (Task 5 created both)

**Interfaces:**
- Consumes: Task 1 `appendConsentEventGuarded`, `readConsentHistory`; Task 2 `ensureConsentTask`, `nextBookedStart`, `completeTasksForConsentEvents`; Task 4 `matchKeyword`, `matchPhrase`, `keywordDisplay`, `CANCEL_WORDS`; Task 5 `consentReplyBody`, `ReplyKind`; Task 6's kinds and `SmsRequest.answersEventId`.
- Produces:
  - `type Autoresponse = "STOP" | "START" | "HELP" | "OTHER"`; `parseAutoresponse(v: unknown): Autoresponse | null` — ANY non-blank value means Telnyx replied (review R2-I2 / R1-I7): `INFO` (the OpenAPI's name for help, F11) reads as `HELP`, an unknown value as `OTHER`; only a missing or blank value is `null`
  - `type InboundClass = { kind: "stop"; keyword: KeywordMatch | null } | { kind: "start"; keyword: KeywordMatch } | { kind: "help"; keyword: KeywordMatch } | { kind: "telnyx_only"; autoresponse: "START" | "HELP" | "OTHER" } | { kind: "phrase"; phrase: PhraseMatch } | { kind: "none" }`; `classifyInbound(text: string, autoresponse: Autoresponse | null): InboundClass`
  - `CHANGES_CONSENT: ReadonlySet<InboundClass["kind"]>` (`stop`, `start`, `phrase`)
  - `type ConsentReplyPlan = { kind: ReplyKind; language: "en" | "es"; answersEventId?: string }`
  - `type InboundConsentInput = { accountId: string; address: string; text: string; autoresponse: Autoresponse | null; providerMessageId: string | null; messagingProfileId: string | null; contactId: string | null; firstFiling: boolean; now: Date }`
  - `recordInboundConsent(db, input: InboundConsentInput, c: InboundClass, owe: (reply: ConsentReplyPlan) => void): Promise<void>` — calls `owe` THE MOMENT a reply is owed (right after the append answers `appended`, before any To-do), then THROWS when a stop, start or hold, or its To-do, cannot be written (review R2-I1a: the attempt that writes the row owes the reply even when a later step fails; its retry finds the row `duplicate` and owes nothing)
  - `excerptOf(text: string, max?: number): string`
  - `sendConsentReply(db, r: { accountId: string; to: string; contactId: string | null; conversationId: string | null; reply: ConsentReplyPlan }): Promise<void>` (never throws; logs)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/inbound.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  appendConsentEventGuarded: vi.fn(), ensureConsentTask: vi.fn(), nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(), getContact: vi.fn(), completeTasksForConsentEvents: vi.fn(), readConsentHistory: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import {
  classifyInbound, parseAutoresponse, recordInboundConsent, excerptOf, CHANGES_CONSENT,
  type InboundConsentInput, type InboundClass, type ConsentReplyPlan,
} from "./inbound";
import { m } from "@/lib/messages";

const DB = {} as never;
const NOW = new Date("2026-10-06T20:00:00Z");
const input = (over: Partial<InboundConsentInput> = {}): InboundConsentInput => ({
  accountId: "acct_1", address: "+19562921696", text: "STOP", autoresponse: null,
  providerMessageId: "msg_1", messagingProfileId: "prof_1", contactId: "ct_1", firstFiling: true, now: NOW, ...over,
});
const appended = (id: string, prior: object | null = null) => ({ outcome: "appended", id, prior });
const calls = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].action, c[1].method, c[2]]);
/** One run of the step; `reply` is the first reply it owed, `owed` every one (there must never be two). */
async function run(i: InboundConsentInput, c: InboundClass): Promise<{ reply: ConsentReplyPlan | null; owed: ConsentReplyPlan[] }> {
  const owed: ConsentReplyPlan[] = [];
  await recordInboundConsent(DB, i, c, (p) => owed.push(p));
  expect(owed.length).toBeLessThanOrEqual(1);
  return { reply: owed[0] ?? null, owed };
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
    e.action === "granted" ? { outcome: "refused", prior: null } : appended(`ev_${e.action}`));
  db.ensureConsentTask.mockResolvedValue({ id: "task_1", created: true });
  db.nextBookedStart.mockResolvedValue(null);
  db.readAccountTimezone.mockResolvedValue("America/Los_Angeles");
  db.getContact.mockResolvedValue({ id: "ct_1", first_name: "Ana", last_name: "Ruiz" });
  db.completeTasksForConsentEvents.mockResolvedValue([]);
  db.readConsentHistory.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseAutoresponse and classifyInbound (plan G4)", () => {
  it("ANY non-blank value means Telnyx replied: STOP, START and HELP in any case, INFO read as HELP, anything else OTHER; only a missing or blank value is null (review R2-I2; mutation: map an unknown value to null → BIS would reply too, FAILS)", () => {
    expect([parseAutoresponse("STOP"), parseAutoresponse(" start "), parseAutoresponse("help")]).toEqual(["STOP", "START", "HELP"]);
    expect([parseAutoresponse("INFO"), parseAutoresponse("info")]).toEqual(["HELP", "HELP"]);
    expect([parseAutoresponse("AYUDA"), parseAutoresponse("opt_out")]).toEqual(["OTHER", "OTHER"]);
    expect([parseAutoresponse(""), parseAutoresponse("  "), parseAutoresponse(5), parseAutoresponse(undefined), parseAutoresponse(null)])
      .toEqual([null, null, null, null, null]);
  });

  it("only Telnyx's STOP makes a stop on its own; an OTHER or INFO it sent on a text BIS does not recognise is telnyx_only, recorded nowhere (review R2-I2: only STOP records carrier_block; mutation: treat OTHER as a stop → FAILS)", () => {
    expect(classifyInbound("hola?", "OTHER")).toEqual({ kind: "telnyx_only", autoresponse: "OTHER" });
    expect(classifyInbound("info please", "HELP")).toEqual({ kind: "telnyx_only", autoresponse: "HELP" });
  });

  it("a stop SENTENCE is held even when Telnyx answered something else — the hold is the safe direction (review R2-m-b; mutation: return telnyx_only before reading the phrase list → FAILS)", () => {
    expect(classifyInbound("please stop texting me", "OTHER")).toMatchObject({ kind: "phrase", phrase: { phrase: "stop texting" } });
    expect(classifyInbound("ya no me manden nada", "HELP")).toMatchObject({ kind: "phrase" });
  });

  it("a keyword decides the kind; Telnyx's STOP makes it a stop even when BIS's list does not match (mutation: ignore autoresponse STOP → none, FAILS)", () => {
    expect(classifyInbound("PARAR", null)).toMatchObject({ kind: "stop", keyword: { word: "PARAR", language: "es" } });
    expect(classifyInbound("please stop contacting us", "STOP")).toEqual({ kind: "stop", keyword: null });
    expect(classifyInbound("Unstop", null)).toMatchObject({ kind: "start" });
    expect(classifyInbound("ayuda", null)).toMatchObject({ kind: "help", keyword: { language: "es" } });
  });

  it("a Telnyx START or HELP BIS does not recognise is telnyx_only; a sentence is a phrase; the rest is none (mutation: treat telnyx_only START as a start → FAILS)", () => {
    expect(classifyInbound("join", "START")).toEqual({ kind: "telnyx_only", autoresponse: "START" });
    expect(classifyInbound("ya no me manden nada", null)).toMatchObject({ kind: "phrase", phrase: { phrase: "no me manden nada" } });
    expect(classifyInbound("see you Tuesday", null)).toEqual({ kind: "none" });
  });

  it("only a stop, a start and a phrase change consent, so only they answer 503 on failure (plan G2; mutation: add help → FAILS)", () => {
    expect([...CHANGES_CONSENT].sort()).toEqual(["phrase", "start", "stop"]);
  });
});

describe("recordInboundConsent — a stop", () => {
  it("appends revoked / keyword, guarded unless_customer_stopped, sourced to the message, with the evidence staff and counsel read (mutation: drop sourceRef → a retry writes twice, FAILS)", async () => {
    await run(input({ text: "Stop!" }), classifyInbound("Stop!", null));
    const e = db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "revoked")!;
    expect(e[1]).toEqual({
      accountId: "acct_1", channel: "sms", address: "+19562921696", contactId: "ct_1", sourceRef: "msg_1",
      action: "revoked", method: "keyword",
      evidence: { keyword: "STOP", language: "en", autoresponse_type: null, messaging_profile_id: "prof_1", excerpt: "Stop!" },
    });
    expect(e[2]).toBe("unless_customer_stopped");
  });

  it("Telnyx did NOT answer: BIS sends the one confirmation, answering this row, in the keyword's language (mutation: drop answersEventId → FAILS)", async () => {
    const r = await run(input({ text: "baja" }), classifyInbound("baja", null));
    expect(r.reply).toEqual({ kind: "consent.stop_confirmation", language: "es", answersEventId: "ev_revoked" });
  });

  it("Telnyx DID answer: the stop is recorded and BIS sends nothing — one confirmation, never two (spec decision 12, plan F4; mutation: reply anyway → FAILS)", async () => {
    const r = await run(input({ autoresponse: "STOP" }), classifyInbound("STOP", "STOP"));
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a Telnyx STOP BIS's list does not match is recorded as the carrier's block, and BIS sends nothing (plan G4; mutation: skip it → FAILS)", async () => {
    const r = await run(input({ text: "plz no mas msgs", autoresponse: "STOP" }), classifyInbound("plz no mas msgs", "STOP"));
    expect(calls()).toContainEqual(["revoked", "carrier_block", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a customer's STOP over a STAFF stop is recorded, with no confirmation: the texts were already off, and now only the customer can turn them back on (danlo 2026-09-28, review R2-I3, spec S8; mutation: confirm it → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? appended("ev_kw", { id: "st", action: "revoked", method: "staff", evidence: {} }) : { outcome: "refused", prior: null });
    const r = await run(input({ text: "Alto" }), classifyInbound("Alto", null));
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(r.reply).toBeNull();
  });

  it("a CANCEL whose To-do fails still owes its confirmation, owed BEFORE the throw — the attempt that wrote the stop answers it, and the 503's retry (duplicate) owes nothing (review R2-I1a; mutation: owe the reply after cancelTodo → nothing owed, FAILS)", async () => {
    db.nextBookedStart.mockRejectedValue(new Error("bookings read failed"));
    const owed: ConsentReplyPlan[] = [];
    await expect(recordInboundConsent(DB, input({ text: "Cancel." }), classifyInbound("Cancel.", null), (p) => owed.push(p)))
      .rejects.toThrow("bookings read failed");
    expect(owed).toEqual([{ kind: "consent.stop_confirmation", language: "en", answersEventId: "ev_revoked" }]);
  });

  it("a STOP or a START that lands on a HELD address closes the To-dos of EVERY hold on that number — the reopened one of an Undo included — so no row is left with two dead buttons (review R3-I1, R3-N3; mutation: skip the close → FAILS; mutation: close only the prior row's To-dos → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "granted" ? { outcome: "refused", prior: null } : appended(`ev_${e.action}`, { id: "ev_hold", action: "held", method: "staff_undo", evidence: {} }));
    // Not a stop, then its Undo: H0 released, then H (the Undo's new hold); T0 was reopened and still links H0.
    db.readConsentHistory.mockResolvedValue([
      { id: "ev_hold", action: "held", method: "staff_undo", occurred_at: "2026-10-05T12:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "ev_rel", action: "hold_released", method: "staff", occurred_at: "2026-10-05T11:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "ev_hold_0", action: "held", method: "free_text", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ]);
    await run(input({ text: "STOP" }), classifyInbound("STOP", null));
    expect(db.readConsentHistory).toHaveBeenCalledWith(DB, "acct_1", "sms", "+19562921696");   // this number's holds, not another's (review M8)
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(DB, "acct_1", ["ev_hold", "ev_hold_0"], "sms-inbound", "system");
    db.completeTasksForConsentEvents.mockClear();
    await run(input({ text: "START", providerMessageId: "msg_2" }), classifyInbound("START", null));
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(DB, "acct_1", ["ev_hold", "ev_hold_0"], "sms-inbound", "system");
    // Closing is cleanup: its failure is logged, and the stop still stands and is still confirmed.
    db.completeTasksForConsentEvents.mockRejectedValue(new Error("tasks update failed"));
    const r = await run(input({ text: "STOP", providerMessageId: "msg_3" }), classifyInbound("STOP", null));
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });

  it("an address the customer already stopped gets nothing — no confirmation, no To-do (spec §4.2 step 2; mutation: reply on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "refused", prior: { id: "old", action: "revoked", method: "keyword", evidence: {} } } : { outcome: "refused", prior: null });
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ text: "CANCEL" }), classifyInbound("CANCEL", null));
    expect(r.reply).toBeNull();
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("a retry of the same message (duplicate) sends nothing, and makes sure the CANCEL To-do exists (plan G1; mutation: reply on duplicate → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_first" } : { outcome: "refused", prior: null });
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ text: "cancel", firstFiling: false }), classifyInbound("cancel", null));
    expect(r.reply).toBeNull();
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", expect.objectContaining({ consentEventId: "ev_first" }), "sms-inbound", "system");
  });

  it("CANCEL with an upcoming booking adds the To-do in the account's own zone; with none, no To-do (spec §4.2 step 2; mutation: print the date in UTC → Oct 10, FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-10T02:00:00Z"); // Oct 9, 7 PM in Los Angeles
    await run(input({ text: "Cancelar" }), classifyInbound("Cancelar", null));
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", {
      contactId: "ct_1", consentEventId: "ev_revoked",
      title: "Ana Ruiz texted CANCELAR, so their texts are stopped. Check whether they also meant their appointment on Oct 9, 2026.",
    }, "sms-inbound", "system");
    db.ensureConsentTask.mockClear();
    db.nextBookedStart.mockResolvedValue(null);
    await run(input({ text: "Cancelar", providerMessageId: "msg_2" }), classifyInbound("Cancelar", null));
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("END is a stop, not a CANCEL: no appointment To-do (mutation: every stop word checks the booking → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    await run(input({ text: "END" }), classifyInbound("END", null));
    expect(db.nextBookedStart).not.toHaveBeenCalled();
  });

  it("a ledger write that fails THROWS, so the route answers 503 and Telnyx retries (spec §5; mutation: catch and return → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) => {
      if (e.action === "revoked") throw new Error("append_consent_event failed: timeout");
      return { outcome: "refused", prior: null };
    });
    await expect(run(input(), classifyInbound("STOP", null))).rejects.toThrow("timeout");
  });
});

describe("recordInboundConsent — START and HELP", () => {
  it("START lifts a stop, and the confirmation speaks the language of the stop it lifts (spec §4.2; mutation: always English → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "resubscribed" ? appended("ev_start", { id: "old", action: "revoked", method: "keyword", evidence: { language: "es" } }) : { outcome: "refused", prior: null });
    const r = await run(input({ text: "START" }), classifyInbound("START", null));
    expect(calls()).toContainEqual(["resubscribed", "start_keyword", "if_stopped_or_held"]);
    expect(r.reply).toEqual({ kind: "consent.start_confirmation", language: "es" });
  });

  it("START that Telnyx answered, or that lifted nothing, gets no BIS reply (mutation: reply when refused → FAILS)", async () => {
    expect((await run(input({ text: "START", autoresponse: "START" }), classifyInbound("START", "START"))).reply).toBeNull();
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    expect((await run(input({ text: "START" }), classifyInbound("START", null))).reply).toBeNull();
  });

  it("AYUDA gets BIS's Spanish help, once, only when Telnyx did not answer and only from the attempt that filed the text (mutation: reply on a retry → FAILS)", async () => {
    expect((await run(input({ text: "Ayuda" }), classifyInbound("Ayuda", null))).reply).toEqual({ kind: "consent.help", language: "es" });
    expect((await run(input({ text: "Ayuda", firstFiling: false }), classifyInbound("Ayuda", null))).reply).toBeNull();
    expect((await run(input({ text: "HELP", autoresponse: "HELP" }), classifyInbound("HELP", "HELP"))).reply).toBeNull();
    expect(calls().filter(([a]) => a !== "granted")).toEqual([]);
  });

  it("AYUDA that Telnyx marked INFO or with a value BIS does not know gets NO BIS reply — one reply, never two (review R2-I2; mutation: reply when autoresponse is OTHER → FAILS)", async () => {
    expect((await run(input({ text: "Ayuda", autoresponse: parseAutoresponse("INFO") }), classifyInbound("Ayuda", parseAutoresponse("INFO")))).reply).toBeNull();
    expect((await run(input({ text: "Ayuda", autoresponse: "OTHER" }), classifyInbound("Ayuda", "OTHER"))).reply).toBeNull();
    expect((await run(input({ text: "baja", autoresponse: "OTHER" }), classifyInbound("baja", "OTHER"))).reply).toBeNull();
    expect(calls()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);   // the stop is still recorded
  });

  it("a Telnyx START that BIS does not recognise is logged, never recorded (plan G4: disagreement resolves toward sending less; mutation: record it → FAILS)", async () => {
    const r = await run(input({ text: "join", autoresponse: "START" }), classifyInbound("join", "START"));
    expect(r.reply).toBeNull();
    expect(calls().filter(([a]) => a !== "granted")).toEqual([]);
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/does not match/);
  });
});

describe("recordInboundConsent — a phrase, the grant, the alert phone", () => {
  it("a phrase holds texts (if_allowed) and asks staff with a To-do naming the contact and what they wrote; no text is sent (choice 20; mutation: reply → FAILS)", async () => {
    const text = "Por favor ya no me manden mensajes, estoy muy ocupada con el trabajo y la familia esta semana";
    const r = await run(input({ text }), classifyInbound(text, null));
    expect(calls()).toContainEqual(["held", "free_text", "if_allowed"]);
    expect(db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "held")![1].evidence)
      .toEqual({ phrase: "no me manden mensajes", language: "es", excerpt: text });
    expect(db.ensureConsentTask).toHaveBeenCalledWith(DB, "acct_1", {
      contactId: "ct_1", consentEventId: "ev_held",
      title: m["todo.consent.hold.en"].replace("{name}", "Ana Ruiz").replace("{excerpt}", excerptOf(text, 60)),
    }, "sms-inbound", "system");
    expect(r.reply).toBeNull();
  });

  it("a phrase on an address that is not allowed holds nothing and asks nothing (mutation: To-do on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    await run(input({ text: "wrong number" }), classifyInbound("wrong number", null));
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
  });

  it("a nameless contact is named by their number in the To-do (mutation: print '(no name)' → FAILS)", async () => {
    db.getContact.mockResolvedValue({ id: "ct_1", first_name: null, last_name: null });
    await run(input({ text: "remove me" }), classifyInbound("remove me", null));
    expect(db.ensureConsentTask.mock.calls[0]![2].title).toMatch(/^\+19562921696 may have asked/);
  });

  it("the first-text grant is written FIRST, if_empty, and its failure is only logged — the stop still lands (decision 8, plan G2; mutation: let the grant's failure throw → FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) => {
      if (e.action === "granted") throw new Error("grant write failed");
      return appended(`ev_${e.action}`);
    });
    const r = await run(input(), classifyInbound("STOP", null));
    expect(calls()[0]).toEqual(["granted", "inbound_text", "if_empty"]);
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });

  it("the alert phone (no contact) gets no grant and no To-do, but its STOP is recorded and confirmed (plan G10; mutation: grant with contactId null → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    const r = await run(input({ contactId: null, text: "cancel" }), classifyInbound("cancel", null));
    expect(calls()).toEqual([["revoked", "keyword", "unless_customer_stopped"]]);
    expect(db.ensureConsentTask).not.toHaveBeenCalled();
    expect(r.reply?.kind).toBe("consent.stop_confirmation");
  });
});

describe("excerptOf", () => {
  it("keeps at most `max` characters, never splitting an emoji, and marks the cut (mutation: .slice on UTF-16 → a lone surrogate, FAILS)", () => {
    const text = `${"a".repeat(58)}👍👍👍`;
    const cut = excerptOf(text, 60);
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut.endsWith("👍…")).toBe(true);
    expect(excerptOf("  short\n text ")).toBe("short text");
  });
});
```

Edit `apps/web/src/lib/consent/replies.test.ts`. Replace its first two lines:

Find:
```ts
import { describe, it, expect } from "vitest";
import { consentReplyBody, telnyxReplyText, TELNYX_KEYWORDS } from "./replies";
```
Replace with:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ getBranding: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const gate = vi.hoisted(() => ({ sendSms: vi.fn() }));
vi.mock("./gate", () => gate);

import { consentReplyBody, telnyxReplyText, sendConsentReply, TELNYX_KEYWORDS } from "./replies";
```

Append at the end of the file:

```ts
describe("sendConsentReply — the one BIS reply, through the gate", () => {
  const plan = { kind: "consent.stop_confirmation" as const, language: "es" as const, answersEventId: "ev_1" };
  beforeEach(() => {
    for (const fn of [...Object.values(db), gate.sendSms]) fn.mockReset();
    db.getBranding.mockResolvedValue({ brandName: " 956 Woodworks " });
    db.createMessage.mockResolvedValue({ id: "msg_out" });
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      await opts.prepare?.({ body: req.body, to: "+19562921696", from: "+19565550000" });
      return { kind: "sent", providerMessageId: "p_1", to: "+19562921696", from: "+19565550000", body: req.body, billable: true, segments: 1 };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("asks the gate for the kind, the carrier's number, the stop it answers and the business-named line (mutation: numberFromCarrier false → FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(gate.sendSms.mock.calls[0]![1]).toEqual({
      accountId: "a1", kind: "consent.stop_confirmation", to: "+19562921696", contactId: "ct_1", language: "es",
      numberFromCarrier: true, answersEventId: "ev_1",
      body: "956 Woodworks: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.",
    });
  });

  it("files the reply in the thread before it leaves, then marks it sent with the provider's id (mutation: skip the sent write → FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(db.createMessage).toHaveBeenCalledWith({}, "a1", expect.objectContaining({ conversationId: "conv_1", channel: "sms", direction: "outbound" }), "sms-inbound", "system");
    expect(db.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "msg_out", "sent", { providerMessageId: "p_1" }, "sms-inbound", "system");
  });

  it("the alert phone has no thread: the reply still goes, and nothing is filed (mutation: require a conversation → no send, FAILS)", async () => {
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: null, conversationId: null, reply: plan });
    expect(gate.sendSms).toHaveBeenCalledTimes(1);
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it("a refusal or a failure is logged and never thrown — it runs after the response, where a throw has no one to reach (mutation: rethrow → FAILS)", async () => {
    gate.sendSms.mockResolvedValue({ kind: "blocked", reason: "a2p_not_approved" });
    await expect(sendConsentReply({} as never, { accountId: "a1", to: "+1", contactId: null, conversationId: null, reply: plan })).resolves.toBeUndefined();
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/not sent: blocked a2p_not_approved/);
    db.getBranding.mockRejectedValue(new Error("getBranding failed: timeout"));
    await expect(sendConsentReply({} as never, { accountId: "a1", to: "+1", contactId: null, conversationId: null, reply: plan })).resolves.toBeUndefined();
  });

  it("a filing that fails does not stop the reply: the thread line is optional, the confirmation is not (review R2-I1b; mutation: let prepare's createMessage throw → the gate sends nothing, FAILS)", async () => {
    db.createMessage.mockRejectedValue(new Error("createMessage failed"));
    let prepared: Promise<void> | undefined;
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      prepared = opts.prepare?.({ body: req.body, to: "+19562921696", from: "+19565550000" });
      await prepared;   // a throw here is the gate's "nothing leaves" (gate.ts:191-195)
      return { kind: "sent", providerMessageId: "p_1", to: "+19562921696", from: "+19565550000", body: req.body, billable: true, segments: 1 };
    });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    await expect(prepared).resolves.toBeUndefined();
    expect(vi.mocked(console.info).mock.calls.map((c) => String(c[0]))).toContain("consent reply consent.stop_confirmation for account a1 sent");
    expect(db.updateMessageStatus).not.toHaveBeenCalled();
  });

  it("a 'sent' status write that fails AFTER the send is logged as that, never as 'not sent' (review R2-m5; mutation: one try around both → 'not sent', FAILS)", async () => {
    db.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    const lines = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /sent, but its thread row was not marked sent/.test(l))).toBe(true);
    expect(lines.some((l) => /not sent:/.test(l))).toBe(false);
  });

  it("a 40300 on a START confirmation is logged naming the carrier block the gate recorded — the START-then-blocked trace (review R2-I1c; mutation: fall through to the generic 'failed provider' line → FAILS)", async () => {
    gate.sendSms.mockResolvedValue({ kind: "failed", stage: "provider", error: "telnyx send failed (403): …", carrierBlocked: true });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: null, conversationId: null, reply: { kind: "consent.start_confirmation", language: "en" } });
    expect(String(vi.mocked(console.error).mock.calls.at(-1)?.[0])).toMatch(/consent\.start_confirmation .* the carrier refused it \(40300\): Telnyx still blocks this number/);
  });

  it("a provider failure after filing marks the filed row failed (mutation: leave it queued → FAILS)", async () => {
    gate.sendSms.mockImplementation(async (_d: unknown, req: { body: string }, opts: { prepare?: (c: object) => Promise<void> }) => {
      await opts.prepare?.({ body: req.body, to: "+1", from: "+2" });
      return { kind: "failed", stage: "provider", error: "telnyx send failed (403): …", carrierBlocked: true };
    });
    await sendConsentReply({} as never, { accountId: "a1", to: "+19562921696", contactId: "ct_1", conversationId: "conv_1", reply: plan });
    expect(db.updateMessageStatus).toHaveBeenCalledWith({}, "a1", "msg_out", "failed", { error: "telnyx send failed (403): …" }, "sms-inbound", "system");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/inbound.test.ts src/lib/consent/replies.test.ts
```

Expected (predicted; not replayed): `inbound.test.ts` fails to import; `replies.test.ts` fails to import `sendConsentReply`.

- [ ] **Step 3: Write the step and the sender**

Create `apps/web/src/lib/consent/inbound.ts`:

```ts
import {
  appendConsentEventGuarded, ensureConsentTask, getContact, nextBookedStart, readAccountTimezone,
  completeTasksForConsentEvents, readConsentHistory,
  type ConsentAppend, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import { loggableError } from "@/lib/loggable-error";
import { hoursZone } from "./hours";
import { matchKeyword, keywordDisplay, CANCEL_WORDS, type KeywordMatch } from "./keywords";
import { matchPhrase, type PhraseMatch } from "./phrases";
import type { ReplyKind } from "./replies";

/**
 * The inbound consent step (consent chain spec §4.2, plan Tasks 8–9): what a
 * customer's text means for their texts, written to the ledger, and whether
 * BIS owes them its own reply.
 *
 * THE TELNYX SPLIT (plan G4, F1, F4). Telnyx answers the keywords it knows
 * itself and marks the webhook `autoresponse_type`; its STOP block also
 * refuses BIS's own send. So when `autoresponse_type` carries ANY value, the
 * customer's confirmation IS Telnyx's configured reply, and BIS sends
 * nothing; the spelling of the value is not trusted (review R2-I2: INFO is
 * the OpenAPI's help, and the facts file's caveat that a custom word may be
 * reported as itself). BIS replies only when it is absent. Only the value
 * STOP is read as the carrier's block when BIS's list does not match; a
 * START, HELP or unknown value BIS does not match is logged and not recorded
 * — unless the text is a stop SENTENCE, which is held all the same (review
 * R2-m-b: the hold is the safe direction).
 *
 * RETRIES (plan G1). Every write is sourced to the message id, so a retried
 * webhook appends nothing new (0055) and finds the To-do it already made; a
 * reply is owed only by the attempt that APPENDED the row it answers (stop,
 * start) or that FILED the message (help), and it is owed the moment the
 * append answers, before any To-do, so a To-do failure (503) cannot lose it
 * (review R2-I1a).
 */
export type Autoresponse = "STOP" | "START" | "HELP" | "OTHER";

/** Any non-blank `autoresponse_type` means Telnyx replied. INFO is the OpenAPI's name for help (plan F11). */
export function parseAutoresponse(v: unknown): Autoresponse | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const up = v.trim().toUpperCase();
  if (up === "INFO") return "HELP";
  return up === "STOP" || up === "START" || up === "HELP" ? up : "OTHER";
}

export type InboundClass =
  | { kind: "stop"; keyword: KeywordMatch | null }
  | { kind: "start"; keyword: KeywordMatch }
  | { kind: "help"; keyword: KeywordMatch }
  | { kind: "telnyx_only"; autoresponse: "START" | "HELP" | "OTHER" }
  | { kind: "phrase"; phrase: PhraseMatch }
  | { kind: "none" };

/** Pure. A stop wins over everything, Telnyx's included; then START, HELP; then a stop sentence, even when Telnyx answered something else (review R2-m-b); telnyx_only or none last. */
export function classifyInbound(text: string, autoresponse: Autoresponse | null): InboundClass {
  const keyword = matchKeyword(text);
  if (autoresponse === "STOP" || keyword?.kind === "stop") {
    return { kind: "stop", keyword: keyword?.kind === "stop" ? keyword : null };
  }
  if (keyword?.kind === "start") return { kind: "start", keyword };
  if (keyword?.kind === "help") return { kind: "help", keyword };
  // A stop SENTENCE is held even when Telnyx answered something else: the
  // hold is the safe direction (review R2-m-b).
  const phrase = matchPhrase(text);
  if (phrase) return { kind: "phrase", phrase };
  return autoresponse !== null ? { kind: "telnyx_only", autoresponse } : { kind: "none" };
}

/**
 * A stop or a START that lands on a HELD address decides the hold: the
 * To-dos of EVERY hold on that number are closed (review R3-N3: after Not a
 * stop and its Undo, the reopened To-do links the older hold, not the one
 * this row replaced), so none sits open with two buttons that can only say
 * "already decided" (review R3-I1). Cleanup, so contained: the ledger row is
 * what matters, and the To-do's own buttons close a stale row on a click.
 */
async function closeHoldTodo(db: SupabaseClient, i: InboundConsentInput, r: ConsentAppend): Promise<void> {
  if (r.outcome !== "appended" || r.prior?.action !== "held") return;
  try {
    const holds = (await readConsentHistory(db, i.accountId, "sms", i.address)).filter((row) => row.action === "held").map((row) => row.id);
    await completeTasksForConsentEvents(db, i.accountId, holds, ACTOR, "system");
  } catch (e) {
    console.error(`inbound consent: the hold To-do for account ${i.accountId} was not closed: ${loggableError(e)}`);
  }
}

/** The texts whose handling must not be lost: a failure answers 503 so Telnyx retries (plan G2). */
export const CHANGES_CONSENT: ReadonlySet<InboundClass["kind"]> = new Set(["stop", "start", "phrase"]);

export type ConsentReplyPlan = { kind: ReplyKind; language: "en" | "es"; answersEventId?: string };

export type InboundConsentInput = {
  accountId: string;
  /** The sender, E.164 from the carrier. */
  address: string;
  text: string;
  autoresponse: Autoresponse | null;
  providerMessageId: string | null;
  messagingProfileId: string | null;
  /** The contact the route filed the text under; null for the alert phone (plan G10). */
  contactId: string | null;
  /** This attempt filed the message; false on Telnyx's retry of one already filed. */
  firstFiling: boolean;
  now: Date;
};

const ACTOR = "sms-inbound";
/** The ledger's own cap on an excerpt (0054's evidence CHECK). */
const EVIDENCE_EXCERPT = 160;
/** What a To-do line quotes. */
const TODO_EXCERPT = 60;

/** At most `max` characters (code points, so an emoji is never split), whitespace collapsed, the cut marked. */
export function excerptOf(text: string, max: number = EVIDENCE_EXCERPT): string {
  const chars = Array.from(text.trim().replace(/\s+/g, " "));
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

async function contactLabel(db: SupabaseClient, i: InboundConsentInput): Promise<string> {
  const contact = await getContact(db, i.accountId, i.contactId as string);
  const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  return name || i.address;
}

/** Spec §4.2 step 2: a CANCEL with an upcoming appointment asks staff whether the appointment was meant too. */
async function cancelTodo(db: SupabaseClient, i: InboundConsentInput, eventId: string, word: string): Promise<void> {
  const startsAt = await nextBookedStart(db, i.accountId, i.contactId as string, i.now.toISOString());
  if (!startsAt) return;
  const [name, zone] = await Promise.all([contactLabel(db, i), readAccountTimezone(db, i.accountId)]);
  const title = m["todo.consent.cancel.en"]
    .replace("{name}", () => name)
    .replace("{word}", () => keywordDisplay(word))
    .replace("{date}", () => formatDateInZone(startsAt, hoursZone(zone)));
  await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title }, ACTOR, "system");
}

/** Decision 5: a sentence holds texts and asks staff to confirm or undo. */
async function holdTodo(db: SupabaseClient, i: InboundConsentInput, eventId: string): Promise<void> {
  const name = await contactLabel(db, i);
  const title = m["todo.consent.hold.en"]
    .replace("{name}", () => name)
    .replace("{excerpt}", () => excerptOf(i.text, TODO_EXCERPT));
  await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title }, ACTOR, "system");
}

/**
 * Writes what the text means and says which reply BIS owes. THROWS when a
 * stop, a start, a hold or its To-do cannot be written: the route answers 503
 * and Telnyx retries (spec §5). The grant is evidence and never throws.
 */
export async function recordInboundConsent(
  db: SupabaseClient, i: InboundConsentInput, c: InboundClass, owe: (reply: ConsentReplyPlan) => void,
): Promise<void> {
  const base = { accountId: i.accountId, channel: "sms" as const, address: i.address, contactId: i.contactId, sourceRef: i.providerMessageId };
  const excerpt = excerptOf(i.text);

  // Step 6 (decision 8): a first text is a grant. Evidence only (choice 28,
  // choice 29), and never for the alert phone, which is not a customer.
  if (i.contactId !== null) {
    try {
      await appendConsentEventGuarded(db, { ...base, action: "granted", method: "inbound_text", evidence: { excerpt } }, "if_empty");
    } catch (e) {
      console.error(`inbound consent: the first-text grant for account ${i.accountId} was not recorded: ${loggableError(e)}`);
    }
  }

  switch (c.kind) {
    case "stop": {
      const kw = c.keyword;
      const r: ConsentAppend = await appendConsentEventGuarded(db, {
        ...base, action: "revoked", method: kw ? "keyword" : "carrier_block",
        evidence: {
          keyword: kw?.word ?? null, language: kw?.language ?? null, autoresponse_type: i.autoresponse,
          messaging_profile_id: i.messagingProfileId, excerpt,
        },
      }, "unless_customer_stopped");
      if (r.outcome === "refused") return;   // the customer's own stop already stands (danlo 2026-09-28)
      // Owed FIRST, before anything below can throw (review R2-I1a). Not over
      // a staff stop: the texts were already off, so there is nothing to
      // confirm; the new row makes the stop the customer's own (spec S8).
      if (r.outcome === "appended" && kw && i.autoresponse === null && r.prior?.action !== "revoked") {
        owe({ kind: "consent.stop_confirmation", language: kw.language, answersEventId: r.id });
      }
      await closeHoldTodo(db, i, r);
      if (kw && CANCEL_WORDS.has(kw.word) && i.contactId !== null) await cancelTodo(db, i, r.id, kw.word);
      return;
    }
    case "start": {
      const r = await appendConsentEventGuarded(db, {
        ...base, action: "resubscribed", method: "start_keyword",
        evidence: { keyword: c.keyword.word, autoresponse_type: i.autoresponse, messaging_profile_id: i.messagingProfileId },
      }, "if_stopped_or_held");
      if (r.outcome === "appended" && i.autoresponse === null) {
        owe({ kind: "consent.start_confirmation", language: r.prior?.evidence.language === "es" ? "es" : "en" });
      }
      await closeHoldTodo(db, i, r);
      return;
    }
    case "help":
      // No ledger row: HELP changes nothing. The gate refuses a stopped or held address (spec §4.2 step 4).
      if (i.autoresponse === null && i.firstFiling) owe({ kind: "consent.help", language: c.keyword.language });
      return;
    case "phrase": {
      const r = await appendConsentEventGuarded(db, {
        ...base, action: "held", method: "free_text",
        evidence: { phrase: c.phrase.phrase, language: c.phrase.language, excerpt },
      }, "if_allowed");
      if (r.outcome !== "refused" && i.contactId !== null) await holdTodo(db, i, r.id);
      return;   // choice 20: a free-text hold is never confirmed by text
    }
    case "telnyx_only":
      console.error(`inbound consent: Telnyx answered ${c.autoresponse} for account ${i.accountId} to a text BIS's keyword list does not match; nothing recorded`);
      return;
    case "none":
      return;
  }
}
```

Edit `apps/web/src/lib/consent/replies.ts`:

Find:
```ts
import { m } from "@/lib/messages";
```
Replace with:
```ts
import { getBranding, createMessage, updateMessageStatus, type SupabaseClient } from "@bis/db";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { sendSms } from "./gate";
import type { ConsentReplyPlan } from "./inbound";
```

Append at the end of `replies.ts`:

```ts
const ACTOR = "sms-inbound";

/**
 * Sends BIS's one reply (plan Task 9 runs this in `after()`, once the webhook
 * has answered): through the gate, as the carrier's own number (the sender
 * of the text it answers, never a stored flag), with the stop it answers for
 * the gate's one exception. Filed in the thread before it leaves when there
 * is a thread (the alert phone has none). NEVER THROWS: it runs after the
 * response, where a throw has no one to reach, so every outcome is logged.
 * Not billed (plan G11). The customer-facing name comes from the email
 * shell's `brandDisplayName`, as the text-back's does (textback.ts:35;
 * review R2-m6).
 *
 * The thread line is optional; the confirmation is not (review R2-I1b): a
 * filing that fails inside `prepare` is logged and the text still goes (the
 * gate treats a throw from `prepare` as "nothing leaves", gate.ts:191-195).
 * A status write that fails AFTER the send is logged as exactly that, never
 * as "not sent" (review R2-m5).
 */
export async function sendConsentReply(
  db: SupabaseClient,
  r: { accountId: string; to: string; contactId: string | null; conversationId: string | null; reply: ConsentReplyPlan },
): Promise<void> {
  try {
    const body = consentReplyBody(r.reply.kind, r.reply.language, brandDisplayName(await getBranding(db, r.accountId)));
    let messageId: string | null = null;
    const result = await sendSms(db, {
      accountId: r.accountId, kind: r.reply.kind, to: r.to, body, contactId: r.contactId,
      language: r.reply.language, numberFromCarrier: true,
      ...(r.reply.answersEventId ? { answersEventId: r.reply.answersEventId } : {}),
    }, {
      prepare: async ({ body: sent }) => {
        if (!r.conversationId) return;
        try {
          messageId = (await createMessage(db, r.accountId, {
            conversationId: r.conversationId, channel: "sms", direction: "outbound", body: sent,
          }, ACTOR, "system")).id;
        } catch (e) {
          console.error(`consent reply ${r.reply.kind} for account ${r.accountId}: not filed in the thread, sending anyway: ${loggableError(e)}`);
        }
      },
    });
    if (result.kind === "sent") {
      console.info(`consent reply ${r.reply.kind} for account ${r.accountId} sent`);
      if (messageId) {
        try {
          await updateMessageStatus(db, r.accountId, messageId, "sent", { providerMessageId: result.providerMessageId }, ACTOR, "system");
        } catch (e) {
          console.error(`consent reply ${r.reply.kind} for account ${r.accountId} sent, but its thread row was not marked sent: ${loggableError(e)}`);
        }
      }
      return;
    }
    if (result.kind === "failed" && messageId) {
      await updateMessageStatus(db, r.accountId, messageId, "failed", { error: result.error }, ACTOR, "system");
    }
    if (result.kind === "failed" && result.carrierBlocked) {
      // Review R2-I1c: a START Telnyx did not recognise (say "Start!") lifts
      // BIS's ledger, but Telnyx still blocks the number, refuses this
      // confirmation with 40300, and the gate has just recorded carrier_block
      // again. The ledger is right (the number IS blocked); the customer has
      // no reply and stays blocked until they send a START Telnyx matches.
      // Worded for both outcomes of the gate's write (review R2-m-d): it
      // appends carrier_block, or finds the customer's own stop already there.
      console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: the carrier refused it (40300): Telnyx still blocks this number, the gate records it as stopped (carrier_block, unless the customer's own stop already stands), and it stays blocked until the customer texts a START Telnyx itself recognises`);
      return;
    }
    const why = result.kind === "blocked" ? `blocked ${result.reason}` : result.kind === "failed" ? `failed ${result.stage}` : result.kind;
    console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: ${why}`);
  } catch (e) {
    console.error(`consent reply ${r.reply.kind} for account ${r.accountId} not sent: ${loggableError(e)}`);
  }
}
```

(The replies test's expected gate request lists `body` last; `toEqual` ignores key order.)

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/inbound.test.ts src/lib/consent/replies.test.ts
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass; `tsc` exit 0. Then the full web suite (nothing imports these modules yet), where scan 2's positive control, red since Task 6, turns GREEN: `replies.ts` now imports the gate and names the three consent kinds (review R2-I4).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `parseAutoresponse` returns `up` for any non-blank string (no INFO mapping, no OTHER) | "ANY non-blank value means Telnyx replied …" |
| 2 | `classifyInbound`: drop `autoresponse === "STOP" ||` | "a keyword decides the kind; Telnyx's STOP …" and "a Telnyx STOP BIS's list does not match …" |
| 3 | `classifyInbound`: return `start` for `telnyx_only` START | "a Telnyx START or HELP BIS does not recognise is telnyx_only …" |
| 4 | stop: drop `sourceRef` from `base` | "appends revoked / keyword … sourced to the message" |
| 5 | stop: owe without `answersEventId` | "Telnyx did NOT answer: BIS sends the one confirmation …" |
| 6 | stop: drop `&& i.autoresponse === null` | "Telnyx DID answer: … BIS sends nothing" and "AYUDA that Telnyx marked INFO …" (the `baja` line) |
| 7 | stop: owe when `r.outcome === "duplicate"` too | "a retry of the same message (duplicate) sends nothing …" |
| 8 | `cancelTodo`: `formatDateInZone(startsAt, "UTC")` | "CANCEL with an upcoming booking adds the To-do in the account's own zone …" |
| 9 | stop: `CANCEL_WORDS.has` → `true` | "END is a stop, not a CANCEL …" |
| 10 | wrap the stop write in try/catch and `return` (swallowing the error) | "a ledger write that fails THROWS …" |
| 11 | start: `language: "en"` always | "START lifts a stop, and the confirmation speaks the language of the stop it lifts" |
| 12 | help: drop `!i.firstFiling` | "AYUDA gets BIS's Spanish help, once …" |
| 13 | phrase: `ensureConsentTask` also on refused | "a phrase on an address that is not allowed …" |
| 14 | grant: rethrow its failure | "the first-text grant is written FIRST … its failure is only logged" |
| 15 | grant: drop `if (i.contactId !== null)` | "the alert phone (no contact) gets no grant …" |
| 16 | `excerptOf`: `text.slice(0, max - 1)` | "keeps at most `max` characters, never splitting an emoji …" |
| 17 | `sendConsentReply`: `numberFromCarrier: false` | "asks the gate for the kind, the carrier's number …" |
| 18 | `sendConsentReply`: drop the `sent` status write | "files the reply in the thread before it leaves …" |
| 19 | `sendConsentReply`: `if (!r.conversationId) throw …` in prepare | "the alert phone has no thread …" |
| 20 | `sendConsentReply`: rethrow in the catch | "a refusal or a failure is logged and never thrown …" |
| 21 | `parseAutoresponse`: return `null` for a value that is not STOP, START or HELP | "ANY non-blank value means Telnyx replied …" and "AYUDA that Telnyx marked INFO …" |
| 22 | stop: drop `&& r.prior?.action !== "revoked"` | "a customer's STOP over a STAFF stop is recorded, with no confirmation" |
| 23 | stop: move the `owe(…)` below `cancelTodo(…)` | "a CANCEL whose To-do fails still owes its confirmation …" |
| 24 | delete both `await closeHoldTodo(db, i, r)` calls | "a STOP or a START that lands on a HELD address closes that hold's To-do" |
| 25 | `closeHoldTodo`: no try/catch | same test (its last part: the stop is still confirmed) |
| 25b | `closeHoldTodo`: complete `[r.prior.id]` only | same test (the reopened To-do of the older hold stays open) |
| 25c | `classifyInbound`: return `telnyx_only` before `matchPhrase` | "a stop SENTENCE is held even when Telnyx answered something else" |
| 26 | `sendConsentReply`: no try/catch inside `prepare` | "a filing that fails does not stop the reply" |
| 27 | `sendConsentReply`: one try around the send and the `sent` write, logging "not sent" | "a 'sent' status write that fails AFTER the send …" |
| 28 | `sendConsentReply`: delete the `carrierBlocked` branch | "a 40300 on a START confirmation is logged naming the carrier block …" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/inbound.ts apps/web/src/lib/consent/inbound.test.ts \
  apps/web/src/lib/consent/replies.ts apps/web/src/lib/consent/replies.test.ts
git commit -m "feat(consent): the inbound consent step (stop, start, help, holds, grants, To-dos) and the one reply, through the gate"
```

---

### Task 9: The inbound route: the consent step on every text, a 503 on a lost stop, replies after the response

**Owner:** bis-comms. **Tier:** HIGH. **Questions:** none.

**Files:**
- Replace the whole file: `apps/web/src/app/api/sms/inbound/route.ts`
- Modify: `apps/web/src/app/api/sms/inbound/route.test.ts`
- Create: `apps/web/src/app/api/sms/inbound/route.consent.test.ts`
- Modify: `apps/web/src/lib/sms/opt-out.ts` (its "do not add keyword handling" paragraph), `docs/runbooks/a2p-registration.md` (the same paragraph)

**Interfaces:**
- Consumes: Task 8's `classifyInbound`, `parseAutoresponse`, `recordInboundConsent`, `CHANGES_CONSENT`, `sendConsentReply`.
- Produces: the route's behaviour (G1–G4, G10, G16): STOP and START from the alert phone recorded before its drop; a retry skips only the filing and YES/NO; YES/NO runs only for a text that is nothing else; a consent-changing text whose handling fails answers 503; BIS's reply runs in `after()`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/sms/inbound/route.consent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

/**
 * The inbound route's consent step with GENUINELY SIGNED fixtures (spec §8):
 * a real Ed25519 key pair made for this file, its public half as
 * TELNYX_PUBLIC_KEY, every request signed over `${timestamp}|${body}` exactly
 * as Telnyx signs. The database is mocked; the consent step (inbound.ts) is
 * the real one; the reply sender is a spy, and `after` hands its work to the
 * test so a reply that was never scheduled cannot pass as sent.
 */
const db = vi.hoisted(() => ({
  serviceDb: vi.fn(), getPhoneNumberByE164: vi.fn(), getAlertPhone: vi.fn(), findMessageByProviderId: vi.fn(),
  createContact: vi.fn(), ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(),
  applyConfirmationReply: vi.fn(), updateMessageStatusByProviderId: vi.fn(),
  appendConsentEventGuarded: vi.fn(), ensureConsentTask: vi.fn(), nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(), getContact: vi.fn(), completeTasksForConsentEvents: vi.fn(), readConsentHistory: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const sendReply = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/replies", () => ({ sendConsentReply: sendReply }));
const deferred = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (work: () => Promise<void>) => { deferred.push(work); } };
});

import { POST } from "./route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const RAW_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const OUR_NUMBER = "+19565550000";
const CUSTOMER = "+19562921696";

function signed(payload: object, key = privateKey): Request {
  const raw = JSON.stringify({ data: { event_type: "message.received", payload } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(`${ts}|${raw}`, "utf8"), key).toString("base64");
  return new Request("https://x.test/api/sms/inbound", {
    method: "POST", headers: { "telnyx-timestamp": ts, "telnyx-signature-ed25519": sig }, body: raw,
  });
}
let seq = 0;
const text = (body: string, over: Record<string, unknown> = {}) => signed({
  id: `msg_${++seq}`, to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: body,
  messaging_profile_id: "prof_1", ...over,
});
const writes = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].action, c[1].method, c[2]]);

beforeEach(() => {
  for (const fn of [...Object.values(db), sendReply]) fn.mockReset();
  deferred.length = 0;
  process.env.TELNYX_PUBLIC_KEY = RAW_PUBLIC_KEY;
  db.serviceDb.mockReturnValue({});
  db.getPhoneNumberByE164.mockResolvedValue({ id: "pn_1", account_id: "acct_1", e164: OUR_NUMBER, telnyx_id: null, status: "live" });
  db.getAlertPhone.mockResolvedValue(null);
  db.findMessageByProviderId.mockResolvedValue(null);
  db.createContact.mockResolvedValue({ id: "ct_1", existing: true, flagged: false });
  db.ensureConversation.mockResolvedValue({ id: "conv_1", created: false });
  db.createMessage.mockResolvedValue({ id: "in_1" });
  db.applyConfirmationReply.mockResolvedValue(null);
  db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
    e.action === "granted" ? { outcome: "refused", prior: null } : { outcome: "appended", id: `ev_${e.action}`, prior: null });
  db.ensureConsentTask.mockResolvedValue({ id: "task_1", created: true });
  db.nextBookedStart.mockResolvedValue(null);
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.getContact.mockResolvedValue({ id: "ct_1", first_name: "Ana", last_name: null });
  db.completeTasksForConsentEvents.mockResolvedValue([]);
  db.readConsentHistory.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function runDeferred(): Promise<void> {
  for (const work of deferred.splice(0)) await work();
}

describe("signed fixtures", () => {
  it("a body signed with another key is refused 401 and nothing is written (the positive control that signatures are real; mutation: accept any signature → FAILS)", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const res = await POST(signed({ id: "x", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "STOP" }, other));
    expect(res.status).toBe(401);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("STOP: one confirmation, never two, none missing (spec §8)", () => {
  it("Telnyx answered (autoresponse_type STOP): the stop is recorded, sourced to the message, and no BIS reply is scheduled (mutation: schedule anyway → FAILS)", async () => {
    const res = await POST(text("STOP", { autoresponse_type: "STOP" }));
    expect(res.status).toBe(200);
    expect(writes()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "revoked")![1])
      .toMatchObject({ sourceRef: `msg_${seq}`, contactId: "ct_1", evidence: { autoresponse_type: "STOP", messaging_profile_id: "prof_1" } });
    expect(deferred).toHaveLength(0);
  });

  it("Telnyx did not answer: exactly one reply is scheduled after the response, answering the new stop (mutation: send inline → sendReply runs before POST returns, FAILS)", async () => {
    const res = await POST(text("Parar"));
    expect(res.status).toBe(200);
    expect(sendReply).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    await runDeferred();
    expect(sendReply).toHaveBeenCalledWith({}, {
      accountId: "acct_1", to: CUSTOMER, contactId: "ct_1", conversationId: "conv_1",
      reply: { kind: "consent.stop_confirmation", language: "es", answersEventId: "ev_revoked" },
    });
  });

  it("Telnyx's retry of the same STOP files nothing twice and schedules nothing (plan G1; mutation: the retry returns before the consent step again → the 503's retry never writes, see the next case)", async () => {
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_first" } : { outcome: "refused", prior: null });
    const res = await POST(text("STOP"));
    expect(res.status).toBe(200);
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });

  it("a ledger write that fails answers 503; Telnyx's retry, finding the text filed, writes the stop and replies once (spec §5, S1; mutation: return before the consent step on a retry → the retry writes nothing, FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementationOnce(async () => ({ outcome: "refused", prior: null }))   // the grant
      .mockImplementationOnce(async () => { throw new Error("append_consent_event failed: timeout"); });
    const payload = { id: "msg_retry", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "STOP" };
    const first = await POST(signed(payload));
    expect(first.status).toBe(503);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    const second = await POST(signed(payload));
    expect(second.status).toBe(200);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(writes().filter(([a]) => a === "revoked")).toHaveLength(2);
    expect(deferred).toHaveLength(1);
  });

  it("a CANCEL whose To-do fails answers 503 having ALREADY scheduled its one confirmation; Telnyx's retry makes the To-do and schedules none — never zero replies, never two (review R2-I1a; mutation: owe the reply after the To-do → the first attempt schedules nothing, FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    db.ensureConsentTask.mockRejectedValueOnce(new Error("tasks insert failed"));
    const payload = { id: "msg_cancel", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "Cancel." };
    expect((await POST(signed(payload))).status).toBe(503);
    expect(deferred).toHaveLength(1);
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_revoked" } : { outcome: "refused", prior: null });
    expect((await POST(signed(payload))).status).toBe(200);
    expect(deferred).toHaveLength(1);
    expect(db.ensureConsentTask).toHaveBeenCalledTimes(2);
  });

  it("an autoresponse_type BIS does not know means Telnyx replied: the stop is recorded, nothing is scheduled, and the value is logged (review R2-I2; mutation: read OTHER as absent → a reply is scheduled, FAILS)", async () => {
    await POST(text("Baja", { autoresponse_type: "OPT_OUT" }));
    expect(writes()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(deferred).toHaveLength(0);
    expect(vi.mocked(console.error).mock.calls.some((c) => c.map(String).join(" ").includes("OPT_OUT"))).toBe(true);
  });

  it("an address the customer already stopped gets 200 and nothing scheduled (mutation: reply on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    expect((await POST(text("STOP"))).status).toBe(200);
    expect(deferred).toHaveLength(0);
  });

  it("CANCEL with a booking coming up adds the To-do (mutation: drop the CANCEL branch → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    await POST(text("Cancel"));
    expect(db.ensureConsentTask).toHaveBeenCalledWith({}, "acct_1", expect.objectContaining({ consentEventId: "ev_revoked" }), "sms-inbound", "system");
  });
});

describe("START and HELP", () => {
  it("START that Telnyx answered is recorded, and BIS sends nothing (mutation: schedule anyway → FAILS)", async () => {
    await POST(text("START", { autoresponse_type: "START" }));
    expect(writes()).toContainEqual(["resubscribed", "start_keyword", "if_stopped_or_held"]);
    expect(deferred).toHaveLength(0);
  });

  it("AYUDA gets BIS's Spanish help after the response; HELP that Telnyx answered gets nothing (mutation: help replies when Telnyx answered → FAILS)", async () => {
    await POST(text("Ayuda"));
    await runDeferred();
    expect(sendReply.mock.calls[0]![1].reply).toEqual({ kind: "consent.help", language: "es" });
    sendReply.mockClear();
    await POST(text("HELP", { autoresponse_type: "HELP" }));
    expect(deferred).toHaveLength(0);
  });
});

describe("YES/NO, the phrase list, the grant", () => {
  it("YES/NO runs for a text that is nothing else, and never for a keyword (spec §4.2 step 5; mutation: run it for every text → FAILS)", async () => {
    await POST(text("YES"));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
    await POST(text("STOP"));
    await POST(text("please stop texting me"));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
  });

  it("a text Telnyx answered but BIS does not recognise (telnyx_only) still reaches YES/NO: step 5's 'otherwise' (review R2-m4; mutation: YES/NO only for kind none → FAILS)", async () => {
    await POST(text("yes", { autoresponse_type: "OTHER" }));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
  });

  it("a sentence holds texts and makes the To-do; nothing is scheduled (choice 20; mutation: reply to a hold → FAILS)", async () => {
    await POST(text("please stop texting me"));
    expect(writes()).toContainEqual(["held", "free_text", "if_allowed"]);
    expect(db.ensureConsentTask).toHaveBeenCalledTimes(1);
    expect(deferred).toHaveLength(0);
  });

  it("the first-text grant is written before anything else for a plain text, and a failed grant still answers 200 (decision 8, plan G2; mutation: 503 on a grant failure → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    const res = await POST(text("see you Tuesday"));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([["granted", "inbound_text", "if_empty"]]);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
  });
});

describe("the alert phone (review R2-I5, plan G10)", () => {
  beforeEach(() => { db.getAlertPhone.mockResolvedValue(CUSTOMER); });

  it("its STOP and START are recorded BEFORE the drop, with no contact and no filing (mutation: drop before recording → FAILS)", async () => {
    await POST(text("STOP"));
    await POST(text("START"));
    expect(writes()).toEqual([["revoked", "keyword", "unless_customer_stopped"], ["resubscribed", "start_keyword", "if_stopped_or_held"]]);
    expect(db.appendConsentEventGuarded.mock.calls.every((c) => c[1].contactId === null)).toBe(true);
    expect(db.createContact).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it("anything else from the alert phone writes nothing at all (mutation: record its phrases too → FAILS)", async () => {
    await POST(text("please stop texting me"));
    await POST(text("HELP"));
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("what answers 503 (plan G2)", () => {
  it("a STOP whose contact cannot be made answers 503; the same failure on a plain text answers 200, as before (mutation: 503 for every failure → the plain case FAILS)", async () => {
    db.createContact.mockRejectedValue(new Error("createContact failed"));
    expect((await POST(text("STOP"))).status).toBe(503);
    expect((await POST(text("see you Tuesday"))).status).toBe(200);
  });

  it("a STOP when serviceDb() itself throws answers 503, never the 200 a plain text still gets (mutation: classify inside the try → the throw happens first and answers 200, FAILS)", async () => {
    db.serviceDb.mockImplementation(() => { throw new Error("Supabase service env vars missing"); });
    expect((await POST(text("STOP"))).status).toBe(503);
    expect((await POST(text("hi"))).status).toBe(200);
  });
});
```

Edit `apps/web/src/app/api/sms/inbound/route.test.ts`:

Find:
```ts
  applyConfirmationReply: vi.fn(),
  serviceDb: vi.fn(),
}));
vi.mock("@/lib/voice/telnyx-signature", () => ({ verifyTelnyxSignature: verify }));
vi.mock("@bis/db", () => dbMocks);
```
Replace with:
```ts
  applyConfirmationReply: vi.fn(),
  serviceDb: vi.fn(),
  // Consent chain PR-2 (the route's consent step, lib/consent/inbound.ts):
  // every export it reaches is defined, so no path here reads an undefined
  // mock (Global Constraints). A plain text writes only the grant.
  appendConsentEventGuarded: vi.fn(),
  ensureConsentTask: vi.fn(),
  nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(),
  getContact: vi.fn(),
  completeTasksForConsentEvents: vi.fn(),
  readConsentHistory: vi.fn(),
}));
vi.mock("@/lib/voice/telnyx-signature", () => ({ verifyTelnyxSignature: verify }));
vi.mock("@bis/db", () => dbMocks);
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});
vi.mock("@/lib/consent/replies", () => ({ sendConsentReply: vi.fn() }));
```

Find:
```ts
  // Off by default, same as a real account (0035_alert_phone.sql: the field
  // IS the switch) — the loop-guard test below overrides it.
  dbMocks.getAlertPhone.mockResolvedValue(null);
});
```
Replace with:
```ts
  // Off by default, same as a real account (0035_alert_phone.sql: the field
  // IS the switch) — the loop-guard test below overrides it.
  dbMocks.getAlertPhone.mockResolvedValue(null);
  dbMocks.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
  afterMock.mockReset();
});
```

In the case titled "an ordinary message still goes through untouched" (review R2-m13: after this task the route DOES classify first):

Find:
```ts
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // it decides; the route does not pre-filter
```
Replace with:
```ts
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // a plain text reaches it; a keyword or a stop sentence does not (the route classifies first, spec §4.2 step 5)
```

Replace the case titled "NEVER sends anything back — the route is a recorder" (`route.test.ts:337-390` on `76c6acfb`: the whole `it(...)` block, from its `it(` line to its closing `});`) with:

```ts
  it("the YES/NO leg still sends nothing; the route's only way to send is the consent reply, after the response (plan G16; mutation: import any sender into this route → FAILS)", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    const res = await POST(inbound("yes"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage.mock.calls[0]![2].direction).toBe("inbound");
    // A YES answer is a recorder's job (automation spec decision 6): nothing
    // is scheduled after the response.
    expect(afterMock).not.toHaveBeenCalled();
    // The import surface, as before (a sender reached through a library
    // import is what this case exists to stop): no SMS provider, no
    // automation, no email, no composer action, and not the gate itself —
    // the consent replies reach the gate only through lib/consent/replies,
    // whose one kind family scans.test.ts pins (Task 14).
    const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(routeSource).not.toContain('from "@/lib/sms');
    expect(routeSource).not.toContain('from "@/lib/automations');
    expect(routeSource).not.toContain('from "@/lib/email');
    expect(routeSource).not.toContain('from "@/lib/consent/gate');
    expect(routeSource).not.toContain("sendSmsAction");
  });
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/app/api/sms/inbound/route.consent.test.ts src/app/api/sms/inbound/route.test.ts
```

Expected (predicted; not replayed): `route.consent.test.ts` fails in almost every case (the route writes no ledger rows, never answers 503, never defers); its 401 control and "anything else from the alert phone writes nothing" pass. `route.test.ts` passes (the rewritten case holds on today's route too).

- [ ] **Step 3: Rewrite the route and the two comments**

Replace the whole file `apps/web/src/app/api/sms/inbound/route.ts`:

```ts
// One Telnyx messaging webhook URL carries THREE event types: inbound texts
// (`message.received`) and both outbound status callbacks
// (`message.sent`, `message.finalized`) — a messaging profile has exactly
// one inbound-webhook slot, so this route branches on `event_type` rather
// than existing as two routes.
//
// Payload shape verified 2026-09-04 against Telnyx's current messaging
// webhook docs (developers.telnyx.com/docs/messaging/messages/receiving-webhooks),
// not assumed from memory — see task-4-report.md for the full diff against
// the brief's draft test. Two things worth stating up front because getting
// either wrong means inbound texts or status updates are silently dropped:
//
//  1. The envelope is `{ data: { event_type, id, occurred_at, payload,
//     record_type }, meta }`. `data.id` is the WEBHOOK EVENT's own id — a
//     different value from the message id. The message id (== what
//     `lib/sms/telnyx.ts`'s `send()` stores as `provider_message_id`, read
//     from the synchronous `POST /v2/messages` response's `data.id`) lives
//     at `data.payload.id` on this webhook, not at the envelope's `data.id`.
//     Looking up `data.id` here would never match a real outbound message.
//
//  2. `message.received`: `data.payload.from.phone_number` is the customer
//     (a single object), `data.payload.to[].phone_number` is our number (an
//     array — one entry for a normal SMS to one number), `data.payload.text`
//     is the body. `message.sent` / `message.finalized`: per-recipient
//     status lives at `data.payload.to[].status`.
//
//  3. Consent chain PR-2 (spec §4.2): every inbound text runs the consent
//     step (lib/consent/inbound.ts) — STOP, START, HELP in English and
//     Spanish, the phrase list, the first-text grant. `autoresponse_type`
//     (VERIFIED, plan F1) says Telnyx already answered a keyword itself, in
//     which case BIS sends nothing. Telnyx retries a non-2xx up to three
//     times per URL, then the failover URL (VERIFIED, plan F7), and gives
//     each attempt 2 s: so a text that changes consent and could not be
//     handled answers 503, every write is idempotent on the message id, and
//     BIS's own reply runs in `after()`, once this route has answered.
import { NextResponse, after } from "next/server";
import {
  serviceDb, ensureConversation, createMessage, createContact, incrementUnreadCount,
  updateMessageStatusByProviderId, findMessageByProviderId, getPhoneNumberByE164, getAlertPhone,
  applyConfirmationReply,
  type MessageStatus, type SupabaseClient,
} from "@bis/db";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { e164Of } from "@/lib/voice/phone-number";
import { loggableError } from "@/lib/loggable-error";
import {
  classifyInbound, parseAutoresponse, recordInboundConsent, CHANGES_CONSENT, type InboundClass,
} from "@/lib/consent/inbound";
import { sendConsentReply } from "@/lib/consent/replies";

// A webhook, not a user action: there is no session, no operator, no AI
// persona — "system" is the actor for every write this route makes.
const ACTOR_ID = "sms-inbound";
const ACTOR_TYPE = "system" as const;

function log(...args: unknown[]) {
  console.error("[sms/inbound]", ...args);
}

// Telnyx's per-recipient `to[].status` values (from `message.sent` /
// `message.finalized`) mapped onto this platform's MessageStatus ladder.
// A status not listed here (Telnyx adds one later, or a typo in the
// payload) is deliberately left unmapped rather than guessed — the caller
// treats "no mapping" the same as "no mappable status" and skips the write.
// That's safe either way: updateMessageStatusByProviderId's own STATUS_RANK
// guard (packages/db/src/messaging.ts) already makes a stale or
// out-of-order write a no-op, so the only failure mode of an unmapped
// status is "this particular update did nothing," never a regression.
const STATUS_MAP: Record<string, MessageStatus> = {
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivery_unconfirmed: "sent",
  delivered: "delivered",
  sending_failed: "failed",
  delivery_failed: "failed",
};

type TelnyxRecipient = { phone_number?: string; status?: string };
type TelnyxPayload = {
  id?: string;
  from?: { phone_number?: string };
  to?: TelnyxRecipient[];
  text?: string;
  /** Telnyx answered the text itself as this keyword (plan F1). */
  autoresponse_type?: string;
  /** The profile the text came in on (plan F9), kept as evidence. */
  messaging_profile_id?: string;
};
type TelnyxWebhookBody = {
  data?: { event_type?: string; payload?: TelnyxPayload };
};

/** Work to run once the response is sent (`after`); injected so tests can run it. */
type Defer = (work: () => Promise<void>) => void;

async function handleInbound(
  db: SupabaseClient, payload: TelnyxPayload | undefined, consent: InboundClass, defer: Defer,
): Promise<void> {
  const calledNumber = e164Of(payload?.to?.[0]?.phone_number ?? null);
  if (!calledNumber) {
    log("inbound message with no resolvable called (to) number");
    return;
  }

  // Resolve the tenant off the DIALED number, never the payload's claimed
  // sender. An unknown called-number is not this platform's error to fix —
  // it 200s so the provider stops retrying — but it IS logged, because the
  // case that matters is a number we DO own whose phone_numbers row is
  // missing or wrong: a real customer's text silently discarded with no
  // screen anywhere that would say so.
  //
  // The status check is the same guard voice/incoming applies at its own
  // tenant-resolution step: setPhoneNumberStatus is a plain UPDATE, never a
  // delete, so a released or reassigned number's row persists with the OLD
  // account_id. Treating anything other than testing/live as "unowned"
  // stops a stranger's text to a released number from being attributed to
  // a former tenant's conversation list.
  const phoneRow = await getPhoneNumberByE164(db, calledNumber);
  if (!phoneRow || (phoneRow.status !== "testing" && phoneRow.status !== "live")) {
    log("inbound text to a number this platform does not own or is not active", calledNumber);
    return;
  }
  const accountId = phoneRow.account_id;
  const fromNumber = e164Of(payload?.from?.phone_number ?? null);
  const text = typeof payload?.text === "string" ? payload.text : "";
  const providerMessageId = payload?.id ?? null;
  const base = {
    accountId, text, autoresponse: parseAutoresponse(payload?.autoresponse_type), providerMessageId,
    messagingProfileId: typeof payload?.messaging_profile_id === "string" ? payload.messaging_profile_id : null,
    now: new Date(),
  };

  // THE loop guard 0035_alert_phone.sql's own comment leaves to the send
  // path: a text FROM the account's own alert phone is the platform
  // receiving its own alert reply, or the owner texting their own line by
  // habit, and filing it would create a CONTACT for the business owner.
  // Contained on purpose: a failed read degrades the guard, never the
  // customer's message.
  let alertPhone: string | null = null;
  try {
    alertPhone = await getAlertPhone(db, accountId);
  } catch (e) {
    log("getAlertPhone read failed — proceeding without the loop guard rather than dropping the text", accountId, String(e));
  }
  if (alertPhone && fromNumber === alertPhone) {
    // Review R2-I5 (plan G10): the gate records a carrier block for the
    // alert phone's own texts too, and choice 19 lets only the phone's own
    // START lift it, so its STOP and START are recorded BEFORE the drop. No
    // grant, no To-do, no HELP: it is the business, not a customer.
    if (consent.kind === "stop" || consent.kind === "start") {
      await recordInboundConsent(db, { ...base, address: fromNumber, contactId: null, firstFiling: true }, consent,
        (reply) => defer(() => sendConsentReply(db, { accountId, to: fromNumber, contactId: null, conversationId: null, reply })));
    }
    log("dropping inbound text from the account's own alert_phone — recognized, not filed as a contact", accountId, alertPhone);
    return;
  }

  // Telnyx retries message.received at-least-once, and a 503 below asks it
  // to. payload.id is the message's own id (file header note 1), stable
  // across retries: a row already recorded under it means this delivery was
  // filed before, so the FILING is skipped (and YES/NO, which answers "the
  // most recent unanswered ask" and must not run twice), but the consent step
  // is not: it is idempotent on the same id, and it is what a retry is for
  // (plan G1, spec S1).
  const existing = providerMessageId ? await findMessageByProviderId(db, accountId, providerMessageId) : null;
  const firstFiling = existing === null;

  // Match an existing contact on this account by phone, or create one —
  // createContact already dedupes on phone (contacts.ts's findDuplicate),
  // so a known customer's text joins their existing thread.
  const contact = await createContact(
    db, accountId, { phone: fromNumber ?? undefined }, ACTOR_ID, ACTOR_TYPE,
  );
  const conversation = await ensureConversation(db, accountId, contact.id, ACTOR_ID, ACTOR_TYPE);

  if (firstFiling) {
    await createMessage(db, accountId, {
      conversationId: conversation.id, channel: "sms", direction: "inbound",
      body: text, providerMessageId: providerMessageId ?? undefined,
    }, ACTOR_ID, ACTOR_TYPE);
    // Same invariant every other inbound writer keeps: a new inbound message
    // always bumps the conversation's unread count, right after the row that
    // made it unread exists.
    await incrementUnreadCount(db, accountId, conversation.id);

    // PART B: the appointment-confirmation answer, for a text that is
    // nothing else (a keyword or a stop sentence never reaches it; spec §4.2
    // step 5's "otherwise", which includes a text Telnyx answered but BIS
    // does not recognise — review R2-m4). CONTAINED ON PURPOSE: a failed
    // recognition degrades to "nobody recorded the answer", which the
    // operator still sees as an unread "yes". THE LOG LINE BELOW IS
    // LOAD-BEARING: route.test.ts asserts on exactly it. It sends NOTHING
    // (automation spec decision 6).
    if (consent.kind === "none" || consent.kind === "telnyx_only") {
      try {
        const answer = await applyConfirmationReply(db, accountId, contact.id, text, new Date());
        if (answer) log("recorded an appointment confirmation reply", accountId, contact.id, answer);
      } catch (e) {
        log("could not record a confirmation reply — the customer's message is filed regardless", accountId, String(e));
      }
    }
  } else {
    log("already-recorded inbound message (retried delivery): consent step only", providerMessageId);
  }

  if (!fromNumber) {
    if (consent.kind !== "none") log("inbound text with no sender number: nothing to record in the consent ledger", accountId);
    return;
  }
  // The reply is scheduled the moment it is owed, inside the step, so a
  // To-do failure after it (503) cannot lose it (review R2-I1a).
  await recordInboundConsent(db, { ...base, address: fromNumber, contactId: contact.id, firstFiling }, consent,
    (reply) => defer(() => sendConsentReply(db, { accountId, to: fromNumber, contactId: contact.id, conversationId: conversation.id, reply })));
}

async function handleStatus(db: SupabaseClient, payload: TelnyxPayload | undefined): Promise<void> {
  // payload.id, NOT the webhook envelope's data.id — see file header note 1.
  const providerMessageId = payload?.id;
  const rawStatus = payload?.to?.[0]?.status;
  const status = rawStatus ? STATUS_MAP[rawStatus] : undefined;
  if (!providerMessageId || !status) {
    log("status event missing a resolvable message id or mappable status", providerMessageId, rawStatus);
    return;
  }
  await updateMessageStatusByProviderId(db, providerMessageId, status);
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST — the signature covers the exact raw bytes; re-serializing
  // a parsed body would not match.
  const rawBody = await req.text();

  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  const timestamp = req.headers.get("telnyx-timestamp");
  const signatureB64 = req.headers.get("telnyx-signature-ed25519");
  const verified = !!publicKey &&
    verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey });
  if (!verified) {
    log("rejected: invalid signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: TelnyxWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    log("rejected: malformed JSON body past a valid signature");
    return NextResponse.json({ ok: true });
  }

  const eventType = body.data?.event_type;
  const payload = body.data?.payload;
  // Classified BEFORE anything can fail (pure), so a failure anywhere below —
  // serviceDb() included — knows whether it lost a stop.
  const consent: InboundClass = eventType === "message.received"
    ? classifyInbound(typeof payload?.text === "string" ? payload.text : "", parseAutoresponse(payload?.autoresponse_type))
    : { kind: "none" };
  if (eventType === "message.received" && parseAutoresponse(payload?.autoresponse_type) === "OTHER") {
    // Review R2-I2: any value means Telnyx replied, so BIS sends nothing; a
    // value BIS does not know is logged so it can be added on purpose.
    log("an autoresponse_type BIS does not know, read as 'Telnyx already replied'", String(payload?.autoresponse_type).slice(0, 40));
  }

  // Everything past the signature check acks 200 whatever happens inside,
  // EXCEPT a text that changes consent (a stop, a start, a stop sentence):
  // losing one of those is a legal failure, so it answers 503 and Telnyx
  // retries (plan G2; every write it retries is idempotent). A plain text
  // keeps the old rule: nothing a retry can fix, so 200 and a log line.
  // serviceDb() MUST stay inside this try for either guarantee to hold.
  try {
    const db = serviceDb();
    if (eventType === "message.received") {
      await handleInbound(db, payload, consent, (work) => after(work));
    } else if (eventType === "message.sent" || eventType === "message.finalized") {
      await handleStatus(db, payload);
    } else {
      log("ignoring unrecognised event_type", eventType);
    }
  } catch (e) {
    if (CHANGES_CONSENT.has(consent.kind)) {
      log("could not handle a text that changes consent; answering 503 so Telnyx retries", eventType, consent.kind, loggableError(e));
      return NextResponse.json({ error: "retry" }, { status: 503 });
    }
    log("unexpected failure handling webhook", eventType, String(e));
  }
  return NextResponse.json({ ok: true });
}
```

Edit `apps/web/src/lib/sms/opt-out.ts`:

Find:
```ts
 * WHAT THIS IS NOT: the opt-out MECHANISM. Telnyx detects STOP (and STOPALL,
 * UNSUBSCRIBE, CANCEL, END, QUIT) on the way in, adds the number to its own
 * opt-out list, auto-replies, and blocks every later send to it — at the
 * messaging-profile level, before this platform sees anything. Implementing a
 * second opt-out list here would be a race against that one, so we owe the
 * carriers the LANGUAGE and nothing else. Do not "finish the job" by adding
 * keyword handling to the inbound webhook.
```
Replace with:
```ts
 * WHAT THIS IS NOT: the opt-out MECHANISM. That is the consent ledger (consent
 * chain PR-2): the inbound webhook reads STOP, START and HELP in English and
 * Spanish, and stop sentences, and writes them to the ledger the send gate
 * reads before every text. Telnyx's own keyword handling stays on as the
 * backstop (spec decision 12): it blocks at the messaging profile and answers
 * the keywords it knows, and the webhook's `autoresponse_type` tells BIS it
 * did, so the customer never gets two confirmations (plan G4).
```

Find:
```ts
 * The KEYWORD stays the English "STOP" in both languages, which is not an
 * oversight: STOP is what Telnyx recognises by default. PARAR and DETENER
 * work only once they are registered as custom keywords on the messaging
 * profile, and telling a Spanish-speaking customer to reply with a word that
 * does nothing is worse than telling them one that works.
```
Replace with:
```ts
 * The KEYWORD stays the English "STOP" in both languages: STOP is the word
 * every carrier, Telnyx and BIS all recognise. PARAR works too (BIS's own
 * matcher reads it, and step 0 registers it on each profile), but a
 * disclosure that names the one universal word is the safer promise.
```

Edit `docs/runbooks/a2p-registration.md`:

Find:
```md
**Telnyx implements these, not us.** It detects STOP, STOPALL, UNSUBSCRIBE,
CANCEL, END and QUIT on the way in, adds the number to its own opt-out list,
auto-replies, and blocks every later send to it — at the messaging-profile
level, before the platform sees anything. So do not add keyword handling to
`/api/sms/inbound`: a second opt-out list would be racing the real one. What
the platform owes is the LANGUAGE, and `lib/sms/opt-out.ts` appends it to
every programme message (the text-back and everything through
`sendAutomationSms`), which is also what makes the sample messages below match
real traffic.
```
Replace with:
```md
**Both Telnyx and the platform implement these.** Telnyx detects its default
keywords (STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT; START,
UNSTOP; HELP), blocks a STOP at the messaging-profile level, and answers with
the profile's configured reply. Since consent chain PR-2 the platform ALSO
reads every inbound text (`/api/sms/inbound`): the same English words plus
REVOKE, OPT OUT, OPTOUT and the Spanish PARAR, DETENER, ALTO, CANCELAR, BAJA,
NO MAS, and stop sentences, and records each in the consent ledger that the
send gate reads before every text. When Telnyx already answered (the webhook's
`autoresponse_type`), the platform sends nothing more, so a customer never
gets two confirmations. `lib/sms/opt-out.ts` still appends the opt-out
LANGUAGE to every programme message, which is what makes the sample messages
below match real traffic.
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/app/api/sms/inbound/route.consent.test.ts src/app/api/sms/inbound/route.test.ts src/lib/sms/opt-out.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint src/app/api/sms/inbound/route.ts src/lib/consent
```

Expected (predicted; not replayed): all pass; `tsc` exit 0; eslint 0 errors. Every existing `route.test.ts` case still holds: the retry case sees one `createMessage` and one unread bump; the alert-phone case never reaches the matcher; the "does not own" cases write nothing. Then the full web suite.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | on a retry (`existing`), `return` before the consent step (today's shape) | "a ledger write that fails answers 503; Telnyx's retry … writes the stop" |
| 2 | send the reply inline (`(reply) => sendConsentReply(...)` instead of `defer`) | "Telnyx did not answer: exactly one reply is scheduled after the response" |
| 3 | always `owe` a reply, even with `autoresponse_type` set (drop inbound's `i.autoresponse === null`) | "Telnyx answered (autoresponse_type STOP): … no BIS reply is scheduled" |
| 4 | run YES/NO for every first filing (drop the `consent.kind` condition) | "YES/NO runs for a text that is nothing else …" |
| 5 | move the alert-phone drop above the consent block | "its STOP and START are recorded BEFORE the drop …" |
| 6 | `catch`: answer 503 for every failure | "a STOP whose contact cannot be made answers 503; … a plain text answers 200" |
| 7 | classify inside the try, after `serviceDb()` | "a STOP when serviceDb() itself throws answers 503 …" |
| 8 | `catch`: always 200 (today's rule) | "a ledger write that fails answers 503 …" |
| 9 | route imports `sendSms` from `@/lib/consent/gate` | route.test.ts "the YES/NO leg still sends nothing …" |
| 10 | accept any signature (skip `verified`) | "a body signed with another key is refused 401 …" |
| 11 | YES/NO only for `consent.kind === "none"` (today's condition before review R2-m4) | "a text Telnyx answered but BIS does not recognise (telnyx_only) still reaches YES/NO" |
| 12 | inbound.ts: owe the stop reply after `cancelTodo` | "a CANCEL whose To-do fails answers 503 having ALREADY scheduled its one confirmation …" |
| 13 | inbound.ts: `parseAutoresponse` returns `null` for an unknown value | "an autoresponse_type BIS does not know means Telnyx replied …" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/sms/inbound/route.ts apps/web/src/app/api/sms/inbound/route.test.ts \
  apps/web/src/app/api/sms/inbound/route.consent.test.ts apps/web/src/lib/sms/opt-out.ts docs/runbooks/a2p-registration.md
git commit -m "feat(consent): the inbound route reads STOP, START, HELP and stop sentences; a lost stop answers 503; replies after the response"
```

---

### Task 10: Grants from a ticked form consent and from a booking

**Owner:** bis-crm (form) with bis-booking (booking). **Tier:** MEDIUM (evidence only; nothing reads a grant as permission, choice 29). **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/grants.ts`, `apps/web/src/lib/consent/grants.test.ts`
- Modify: `apps/web/src/app/f/[publicId]/actions.ts`, `apps/web/src/app/f/[publicId]/actions.test.ts`
- Modify: `apps/web/src/app/b/[publicId]/actions.ts`, `apps/web/src/app/b/[publicId]/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 `appendConsentEventGuarded`.
- Produces: `recordFormGrants(db, input: { accountId: string; formId: string; submissionId: string; fields: FormField[]; answers: { key: string; value: string }[]; consent: FormConsentEntry[] | null }): Promise<void>`; `recordBookingGrant(db, input: { accountId: string; bookingId: string; contactId: string; phoneAsTyped: string | null }): Promise<void>`. Both never throw.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/grants.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { recordFormGrants, recordBookingGrant } from "./grants";
import type { FormField } from "@bis/db";

const FIELDS: FormField[] = [
  { key: "p", kind: "core.phone", label: "Phone", required: false },
  { key: "e", kind: "core.email", label: "Email", required: false },
  { key: "ok", kind: "consent", label: "Text me about my job", required: false },
  { key: "ok2", kind: "consent", label: "Email me offers", required: false },
];
const consent = (given: Record<string, boolean>) => Object.entries(given).map(([key, g]) => ({ key, given: g, text: FIELDS.find((f) => f.key === key)!.label, at: "2026-10-06T20:00:00Z" }));
const rows = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].channel, c[1].address, c[1].sourceRef, c[2]]);

beforeEach(() => {
  db.appendConsentEventGuarded.mockReset().mockResolvedValue({ outcome: "appended", id: "g1", prior: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordFormGrants (spec §4.2, grants; decision 8)", () => {
  it("a ticked field grants the phone as sms and the email as email, normalised, once per field per submission, with the label exactly as shown (mutation: key the source by submission only → the second field collides, FAILS)", async () => {
    await recordFormGrants({} as never, {
      accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "(956) 292-1696" }, { key: "e", value: " Ana@Example.com " }],
      consent: consent({ ok: true, ok2: true }),
    });
    expect(rows()).toEqual([
      ["sms", "+19562921696", "form_submission:s1:ok", "none"], ["email", "ana@example.com", "form_submission:s1:ok", "none"],
      ["sms", "+19562921696", "form_submission:s1:ok2", "none"], ["email", "ana@example.com", "form_submission:s1:ok2", "none"],
    ]);
    expect(db.appendConsentEventGuarded.mock.calls[0]![1]).toMatchObject({
      action: "granted", method: "form", evidence: { form_id: "f1", submission_id: "s1", field: "ok", label: "Text me about my job" },
    });
  });

  it("an unticked field grants nothing; no consent fields grant nothing (mutation: drop the given filter → FAILS)", async () => {
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: consent({ ok: false }) });
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: null });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("an address that will not normalise is skipped, never written malformed (mutation: write the email as typed → FAILS)", async () => {
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "call me" }, { key: "e", value: "not-an-email" }], consent: consent({ ok: true }) });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("the writes run together, not one after another, on the public submit path (review R2-m16; mutation: await each write in turn → the second has not started while the first is pending, FAILS)", async () => {
    let release!: () => void;
    db.appendConsentEventGuarded
      .mockImplementationOnce(() => new Promise((r) => { release = () => r({ outcome: "appended", id: "e1", prior: null }); }))
      .mockResolvedValue({ outcome: "appended", id: "e2", prior: null });
    const done = recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }, { key: "e", value: "ana@example.com" }], consent: consent({ ok: true }) });
    await Promise.resolve();
    expect(db.appendConsentEventGuarded).toHaveBeenCalledTimes(2);
    release();
    await done;
  });

  it("a write that fails is logged and the lead goes on (evidence only; mutation: rethrow → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    await expect(recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: consent({ ok: true }) })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("recordBookingGrant", () => {
  it("a booking with a phone grants sms, sourced to the booking, with the contact (mutation: source by contact → FAILS)", async () => {
    await recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: "956-292-1696" });
    expect(db.appendConsentEventGuarded.mock.calls[0]![1]).toMatchObject({
      channel: "sms", address: "+19562921696", action: "granted", method: "booking", contactId: "c1",
      sourceRef: "booking:b1", evidence: { booking_id: "b1" },
    });
  });

  it("no phone, no grant; a failed write is only logged (mutation: throw → FAILS)", async () => {
    await recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: null });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    await expect(recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: "9562921696" })).resolves.toBeUndefined();
  });
});
```

Edit `apps/web/src/app/f/[publicId]/actions.test.ts`:

Find:
```ts
const instantReplyMock = vi.fn();
vi.mock("@/lib/automations/instant-reply", () => ({
  sendInstantReply: (...a: unknown[]) => instantReplyMock(...a),
}));
```
Replace with:
```ts
const instantReplyMock = vi.fn();
vi.mock("@/lib/automations/instant-reply", () => ({
  sendInstantReply: (...a: unknown[]) => instantReplyMock(...a),
}));
const formGrantsMock = vi.fn();
vi.mock("@/lib/consent/grants", () => ({
  recordFormGrants: (...a: unknown[]) => formGrantsMock(...a),
  recordBookingGrant: vi.fn(),
}));
```

Find:
```ts
  instantReplyMock.mockReset().mockResolvedValue({ kind: "skipped", reason: "disabled" });
});
```
Replace with:
```ts
  instantReplyMock.mockReset().mockResolvedValue({ kind: "skipped", reason: "disabled" });
  formGrantsMock.mockReset().mockResolvedValue(undefined);
});

describe("submitFormAction — the consent grant (consent chain PR-2, plan Task 10)", () => {
  const CONSENT_FORM = [
    { key: "phone", kind: "core.phone", label: "Phone", required: false },
    { key: "sms_ok", kind: "consent", label: "Text me about my request", required: false },
  ];

  it("a saved submission hands its fields, answers and consent record to recordFormGrants (mutation: drop the call → FAILS)", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({ fields: CONSENT_FORM }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "9562921696", sms_ok: "on" }));
    expect(result.status).toBe("success");
    expect(formGrantsMock).toHaveBeenCalledTimes(1);
    expect(formGrantsMock.mock.calls[0]![1]).toMatchObject({
      accountId: "acct_1", formId: "form_row_1", submissionId: "sub_1", fields: CONSENT_FORM,
      answers: [{ key: "phone", value: "9562921696" }],
      consent: [{ key: "sms_ok", given: true, text: "Text me about my request" }],
    });
  });

  it("a submission caught as spam grants nothing (mutation: record grants before the guards → FAILS)", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({ fields: CONSENT_FORM }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
    await submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "9562921696", sms_ok: "on", [HONEYPOT_FIELD]: "bot" }));
    expect(formGrantsMock).not.toHaveBeenCalled();
  });
});
```

Edit `apps/web/src/app/b/[publicId]/actions.test.ts` — add, next to its other `vi.mock(...)` calls (before the first `import` that is not from `vitest`):

```ts
const bookingGrantMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/grants", () => ({ recordBookingGrant: bookingGrantMock, recordFormGrants: vi.fn() }));
```

and, at the end of the file:

```ts
describe("submitBookingAction — the booking grant (consent chain PR-2, plan Task 10)", () => {
  it("a created booking grants its phone, as typed, for that booking and contact (mutation: drop the call → FAILS)", async () => {
    bookingGrantMock.mockReset().mockResolvedValue(undefined);
    const result = await submitBookingAction(PUBLIC_ID, validFormData());
    expect(result.ok).toBe(true);
    expect(bookingGrantMock).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID, bookingId: "booking_1", contactId: "contact_1", phoneAsTyped: "956-555-0101",
    });
  });

  it("a taken slot grants nothing (mutation: grant before the booking exists → FAILS)", async () => {
    bookingGrantMock.mockReset();
    createBookingMock.mockRejectedValue(new SlotTakenError());
    await submitBookingAction(PUBLIC_ID, validFormData());
    expect(bookingGrantMock).not.toHaveBeenCalled();
  });
});
```

(`SlotTakenError` is already imported by that file; if its constructor takes arguments in this codebase, pass what the file's existing slot-taken test passes — `grep -n "new SlotTakenError" src/app/b/[publicId]/actions.test.ts`.)

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/grants.test.ts "src/app/f/[publicId]/actions.test.ts" "src/app/b/[publicId]/actions.test.ts"
```

Expected (predicted; not replayed): `grants.test.ts` fails to import; each action file's two new "hands … / grants its phone" cases fail (never called); their "grants nothing" cases pass already.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/consent/grants.ts`:

```ts
import { appendConsentEventGuarded, type FormField, type SupabaseClient } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";

/**
 * Grants where BIS already captures them (spec decision 8, §4.2 "Grants"):
 * a ticked form consent field, and a booking made with a phone. (The third,
 * a customer texting first, is the inbound route's, lib/consent/inbound.ts.)
 *
 * Evidence ONLY: a grant never lifts a stop (choice 28) and nothing requires
 * one before sending (choice 29), so a write that fails is logged and the
 * lead or the booking goes on. Each is written once per address per source
 * (0055's one row per source): a re-run appends nothing.
 */
export type FormConsentEntry = { key: string; given: boolean; text: string; at: string };

function answerOf(fields: FormField[], answers: { key: string; value: string }[], kind: FormField["kind"]): string {
  const field = fields.find((f) => f.kind === kind);
  return field ? (answers.find((a) => a.key === field.key)?.value ?? "").trim() : "";
}

export async function recordFormGrants(
  db: SupabaseClient,
  input: {
    accountId: string; formId: string; submissionId: string;
    fields: FormField[]; answers: { key: string; value: string }[]; consent: FormConsentEntry[] | null;
  },
): Promise<void> {
  const ticked = (input.consent ?? []).filter((c) => c.given);
  if (ticked.length === 0) return;
  const sms = normalisePhone(answerOf(input.fields, input.answers, "core.phone") || null)?.e164 ?? null;
  const typedEmail = answerOf(input.fields, input.answers, "core.email").toLowerCase();
  const email = typedEmail.indexOf("@") > 0 ? typedEmail : null;
  // Together, not one after another: this runs on the public submit path
  // (review R2-m16). Each write is contained on its own.
  const writes: Promise<void>[] = [];
  for (const c of ticked) {
    for (const [channel, address] of [["sms", sms], ["email", email]] as const) {
      if (!address) continue;
      writes.push(appendConsentEventGuarded(db, {
        accountId: input.accountId, channel, address, action: "granted", method: "form",
        sourceRef: `form_submission:${input.submissionId}:${c.key}`,
        evidence: { form_id: input.formId, submission_id: input.submissionId, field: c.key, label: c.text },
      }, "none").then(() => undefined, (e: unknown) => {
        console.error(`form grant for submission ${input.submissionId} not recorded: ${loggableError(e)}`);
      }));
    }
  }
  await Promise.all(writes);
}

export async function recordBookingGrant(
  db: SupabaseClient,
  input: { accountId: string; bookingId: string; contactId: string; phoneAsTyped: string | null },
): Promise<void> {
  const address = normalisePhone(input.phoneAsTyped || null)?.e164;
  if (!address) return;
  try {
    await appendConsentEventGuarded(db, {
      accountId: input.accountId, channel: "sms", address, action: "granted", method: "booking",
      contactId: input.contactId, sourceRef: `booking:${input.bookingId}`, evidence: { booking_id: input.bookingId },
    }, "none");
  } catch (e) {
    console.error(`booking grant for booking ${input.bookingId} not recorded: ${loggableError(e)}`);
  }
}
```

Edit `apps/web/src/app/f/[publicId]/actions.ts`:

Find:
```ts
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
```
Replace with:
```ts
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import { recordFormGrants } from "@/lib/consent/grants";
```

The grants go BEFORE enrichment (review R2-m16): `enrich` sends the instant reply, and the evidence of consent should exist before anything reaches the customer; the writes run together, so the public submit waits for one round trip, not one per field.

Find:
```ts
    // --- Enrichment: best-effort from here on. A failure here must never
```
Replace with:
```ts
    // Consent chain PR-2 (decision 8): a ticked consent field is a grant, per
    // address given, recorded before enrichment sends anything. Evidence
    // only, never throws (lib/consent/grants.ts).
    await recordFormGrants(db, {
      accountId, formId: form.id, submissionId, fields: form.fields, answers, consent: base.consent,
    });

    // --- Enrichment: best-effort from here on. A failure here must never
```

Edit `apps/web/src/app/b/[publicId]/actions.ts`. Add to the imports (after the `import { bookingConfirmationSubject } …` line):

```ts
import { recordBookingGrant } from "@/lib/consent/grants";
```

Find:
```ts
    const contactName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
```
Replace with:
```ts
    // Consent chain PR-2 (decision 8): a booking made with a phone is a grant.
    // Evidence only, never throws (lib/consent/grants.ts). As typed, so the
    // ledger keys the number the contact row stores.
    await recordBookingGrant(db, { accountId: calendar.account_id, bookingId, contactId, phoneAsTyped: phone || null });

    const contactName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/grants.test.ts "src/app/f/[publicId]/actions.test.ts" "src/app/b/[publicId]/actions.test.ts"
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass, including the booking happy path's exact order list (the grant module is mocked and pushes nothing). Then the full web suite: `app/f/[publicId]/actions.returning-lead.test.ts` is one of the two env suites and fails before it runs, as on `main`; `lib/concierge` and `api/intake` do not call `recordFormGrants` (plan G17).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | source `form_submission:${submissionId}` (no field key) | "a ticked field grants the phone as sms and the email as email …" |
| 2 | drop `.filter((c) => c.given)` | "an unticked field grants nothing …" |
| 3 | `email = typedEmail` unconditionally | "an address that will not normalise is skipped …" |
| 4 | rethrow in `recordFormGrants`'s rejection handler | "a write that fails is logged and the lead goes on" |
| 4b | `recordFormGrants`: `await` each write inside the loop | "the writes run together, not one after another …" |
| 5 | `sourceRef: \`contact:${contactId}\`` in the booking grant | "a booking with a phone grants sms, sourced to the booking …" |
| 6 | f action: delete the `recordFormGrants` call | "a saved submission hands its fields … to recordFormGrants" |
| 7 | f action: move the call above the honeypot guard | "a submission caught as spam grants nothing" |
| 8 | b action: delete the `recordBookingGrant` call | "a created booking grants its phone …" |
| 9 | b action: move the call above `createBooking` | "a taken slot grants nothing" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/grants.ts apps/web/src/lib/consent/grants.test.ts \
  "apps/web/src/app/f/[publicId]/actions.ts" "apps/web/src/app/f/[publicId]/actions.test.ts" \
  "apps/web/src/app/b/[publicId]/actions.ts" "apps/web/src/app/b/[publicId]/actions.test.ts"
git commit -m "feat(consent): grants from a ticked form consent and from a booking, once per source, evidence only"
```

---

### Task 11: The Texts row's data: the view, the staff actions, the drawer's read (and R3-M7)

**Owner:** bis-crm. **Tier:** HIGH (staff can stop and resume a customer's texts). **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/ui/guarded-run.ts`, `apps/web/src/lib/ui/guarded-run.test.ts` (R3-M7)
- Modify: `apps/web/src/lib/contacts/marketing-optout.ts`, `marketing-optout.test.ts`, `apps/web/src/lib/contacts/phone-country.ts`, `phone-country.test.ts`, `…/contacts/phone-country-row.tsx`, `…/contacts/marketing-optout-switch.tsx` (R3-M7 imports only)
- Create: `apps/web/src/lib/consent/texts-view.ts`, `texts-view.test.ts`, `actor.ts`, `actor.test.ts`, `staff-actions.ts`, `staff-actions.test.ts`, `texts-context.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-actions.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts`, `route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`readConsentHistory`, `readConsentEvent`, `newestDecidingRow`, `appendConsentEventGuarded`); Task 2 (`completeTasksForConsentEvents`, `reopenTasks`); Task 4 (`keywordDisplay`); Task 5 (copy).
- Produces:
  - `lib/ui/guarded-run.ts`: `type ToastLike`; `runGuarded(busy, start, work): boolean` (moved from `marketing-optout.ts`, unchanged)
  - `lib/consent/texts-view.ts`: `type TextsHow`; `type TextsView = { kind: "no_number" } | { kind: "check_number" } | { kind: "allowed"; newestId: string | null } | { kind: "stopped"; eventId: string; since: string; how: TextsHow; canResume: boolean } | { kind: "held"; eventId: string; since: string; excerpt: string | null }`; `RESUMABLE_METHODS`; `howOf(row)`; `textsViewOf(rows, number: { unconfirmed: boolean } | null)`; `readTextsView(db, accountId, contact: { phone: string | null; phone_country_unconfirmed?: boolean | null }): Promise<TextsView>` (THROWS on a read error)
  - `lib/consent/staff-actions.ts`: `type TextsUndo = { kind: "stop"; eventId: string } | { kind: "decision"; eventId: string; reopenTaskIds: string[] }`; `type TextsActionResult = { ok: true; view: TextsView; undo?: TextsUndo } | { ok: false; error: string; view?: TextsView }`; `type TextsContext` (it carries `now: Date`, the request's clock); `UNDO_WINDOW_MS` (two minutes); `stopTexts(ctx, expectNewest)` (only over an ALLOWED address: no deciding row, a resubscribe or a release — 0055's rule, mirrored, review R3-C1), `undoStopTexts(ctx, eventId)`, `resumeTexts(ctx, expectEventId, note)`, `confirmStop(ctx, holdEventId)`, `notAStop(ctx, holdEventId)`, `undoHoldDecision(ctx, eventId, reopenTaskIds)` (both Undos: the same staff member's own row, under `UNDO_WINDOW_MS` old, review R3-I6)
  - `lib/consent/texts-context.ts`: `textsContextFor(accountId, contactId, userId): Promise<TextsContext | { ok: false; error: string }>`
  - `lib/consent/actor.ts`: `actorName(userId: string): Promise<string | null>`
  - `contacts/texts-actions.ts` ("use server"): `stopTextsAction(accountId, contactId, expectNewest: string | null)`, `undoStopTextsAction(accountId, contactId, eventId)`, `resumeTextsAction(accountId, contactId, expectEventId, note)`, `confirmStopAction(accountId, contactId, holdEventId)`, `notAStopAction(accountId, contactId, holdEventId)`, `undoHoldDecisionAction(accountId, contactId, eventId, reopenTaskIds: string[])`, each `Promise<TextsActionResult>`
  - `GET /api/accounts/[accountId]/contacts/[contactId]/texts` → `{ view: TextsView; zone: string; phone: string | null }` (`type TextsResponse`), 404 without access or contact, 500 on an unreadable ledger

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/ui/guarded-run.test.ts` — the four `runGuarded` cases MOVED from `lib/contacts/marketing-optout.test.ts` (its `describe("runGuarded", …)` block, lines 133–179 today), verbatim, under this header:

```ts
import { describe, it, expect, vi } from "vitest";
import { runGuarded } from "./guarded-run";

/** One write at a time for a guarded control (moved from marketing-optout.ts, review R3-M7: PR-3 retires that module). */
describe("runGuarded", () => {
  function starter() {
    const started: Array<Promise<void>> = [];
    const start = (cb: () => Promise<void>) => { started.push(cb()); };
    return { start, started };
  }

  it("runs the work inside `start` and is busy until it settles", async () => {
    const busy = { current: false };
    const { start, started } = starter();
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    runGuarded(busy, start, work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(started).toHaveLength(1);
    expect(busy.current).toBe(true);
    finish();
    await started[0];
    expect(busy.current).toBe(false);
  });

  it("refuses a second write while the first is still saving", () => {
    const busy = { current: false };
    const { start } = starter();
    const first = vi.fn(() => new Promise<void>(() => {}));
    const second = vi.fn(async () => {});
    runGuarded(busy, start, first);
    runGuarded(busy, start, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("answers whether it ran: true when it took the work, false when it refused", () => {
    const busy = { current: false };
    const { start } = starter();
    expect(runGuarded(busy, start, () => new Promise<void>(() => {}))).toBe(true);
    expect(runGuarded(busy, start, async () => {})).toBe(false);
  });

  it("is free again after a write that throws", async () => {
    const busy = { current: false };
    const { start, started } = starter();
    runGuarded(busy, start, async () => { throw new Error("boom"); });
    await started[0]!.catch(() => {});
    expect(busy.current).toBe(false);
  });
});
```

Edit `apps/web/src/lib/contacts/marketing-optout.test.ts`: delete its `describe("runGuarded", …)` block (moved above), and change its import line:

Find:
```ts
import { flipMarketingOptOut, optOutSinceLine, runGuarded, type OptOutToast } from "./marketing-optout";
```
Replace with:
```ts
import { flipMarketingOptOut, optOutSinceLine } from "./marketing-optout";
import type { ToastLike as OptOutToast } from "@/lib/ui/guarded-run";
```

Edit `apps/web/src/lib/contacts/phone-country.test.ts`:

Find:
```ts
import type { OptOutToast } from "./marketing-optout";
```
Replace with:
```ts
import type { ToastLike as OptOutToast } from "@/lib/ui/guarded-run";
```

Create `apps/web/src/lib/consent/texts-view.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConsentHistoryRow } from "@bis/db";

const db = vi.hoisted(() => ({ readConsentHistory: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { textsViewOf, howOf, readTextsView, RESUMABLE_METHODS } from "./texts-view";

let n = 0;
const row = (action: ConsentHistoryRow["action"], method: ConsentHistoryRow["method"], at: string, evidence: Record<string, unknown> = {}): ConsentHistoryRow =>
  ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, action, method, occurred_at: at, evidence, note: null, actor_id: null });
const OK = { unconfirmed: false };

describe("textsViewOf — spec §6's Texts row, in the gate's order (plan G18)", () => {
  it("no textable number is no row at all (mutation: allowed → FAILS)", () => {
    expect(textsViewOf([], null)).toEqual({ kind: "no_number" });
  });

  it("a keyword stop reads 'they texted …' in the spaced spelling, and staff may NOT resume it (choice 19; mutation: canResume for every stop → FAILS)", () => {
    const stop = row("revoked", "keyword", "2026-10-03T15:00:00Z", { keyword: "OPTOUT" });
    expect(textsViewOf([stop], OK)).toEqual({
      kind: "stopped", eventId: stop.id, since: stop.occurred_at, how: { kind: "keyword", word: "OPT OUT" }, canResume: false,
    });
  });

  it("a staff stop and a confirmed free-text stop may be resumed; a carrier stop may not (mutation: add carrier_block to RESUMABLE_METHODS → FAILS)", () => {
    expect((textsViewOf([row("revoked", "staff", "2026-10-03T15:00:00Z")], OK) as { canResume: boolean }).canResume).toBe(true);
    const confirmed = row("revoked", "free_text", "2026-10-03T15:00:00Z", { excerpt: "ya no me manden", actorName: "Ana" });
    expect(textsViewOf([confirmed], OK)).toMatchObject({ how: { kind: "free_text", excerpt: "ya no me manden", by: "Ana" }, canResume: true });
    expect(textsViewOf([row("revoked", "carrier_block", "2026-10-03T15:00:00Z")], OK)).toMatchObject({ how: { kind: "carrier" }, canResume: false });
    expect([...RESUMABLE_METHODS].sort()).toEqual(["backfill_0049", "free_text", "staff"]);
  });

  it("a hold shows what they wrote; a hold beats the Check number state (mutation: check the flag first → check_number, FAILS)", () => {
    const hold = row("held", "free_text", "2026-10-03T15:00:00Z", { excerpt: "remove me please" });
    expect(textsViewOf([hold], { unconfirmed: true })).toEqual({ kind: "held", eventId: hold.id, since: hold.occurred_at, excerpt: "remove me please" });
  });

  it("Check number shows only while nothing stops or holds the number (mutation: never show it → allowed, FAILS)", () => {
    expect(textsViewOf([], { unconfirmed: true })).toEqual({ kind: "check_number" });
  });

  it("allowed carries the newest deciding row's id for the next action's compare-and-set, never a grant's (plan G6; mutation: newestId from rows[0] → the grant, FAILS)", () => {
    const stop = row("revoked", "keyword", "2026-10-01T10:00:00Z");
    const lift = row("resubscribed", "start_keyword", "2026-10-02T10:00:00Z");
    const grant = row("granted", "form", "2026-10-03T10:00:00Z");
    expect(textsViewOf([grant, lift, stop], OK)).toEqual({ kind: "allowed", newestId: lift.id });
    expect(textsViewOf([], OK)).toEqual({ kind: "allowed", newestId: null });
  });

  it("howOf maps the unsubscribe methods to the link and 0049 to 'you recorded it' (mutation: fall through to carrier → FAILS)", () => {
    expect(howOf(row("revoked", "one_click", "2026-10-03T15:00:00Z"))).toEqual({ kind: "unsubscribe_link" });
    expect(howOf(row("revoked", "backfill_0049", "2026-10-03T15:00:00Z"))).toEqual({ kind: "staff" });
    expect(howOf(row("revoked", "backfill_telnyx", "2026-10-03T15:00:00Z"))).toEqual({ kind: "carrier" });
  });
});

describe("readTextsView — the Check number rule PR-1's page tests pinned, now on the function the page calls (review R3-I7)", () => {
  beforeEach(() => { db.readConsentHistory.mockReset().mockResolvedValue([]); });

  it("a stored number that will not parse is no row, and the ledger is not read (mutation: read the ledger with the raw phone → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "call me", phone_country_unconfirmed: false })).toEqual({ kind: "no_number" });
    expect(db.readConsentHistory).not.toHaveBeenCalled();
  });

  it("a number that reads both ways is Check number even with the flag false — flag OR the number ([contactId]/page.test.ts's case, moved; mutation: pass the flag alone → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "55 1234 5678", phone_country_unconfirmed: false })).toEqual({ kind: "check_number" });
  });

  it("the flag alone raises it too; a plainly US number with no flag is Allowed, read under its E.164 key (mutation: ignore the flag → FAILS; key the read by the phone as stored → FAILS)", async () => {
    expect(await readTextsView({} as never, "a1", { phone: "(956) 292-1696", phone_country_unconfirmed: true })).toEqual({ kind: "check_number" });
    expect(await readTextsView({} as never, "a1", { phone: "(956) 292-1696", phone_country_unconfirmed: false })).toEqual({ kind: "allowed", newestId: null });
    expect(db.readConsentHistory).toHaveBeenLastCalledWith({}, "a1", "sms", "+19562921696");
  });
});
```

Create `apps/web/src/lib/consent/actor.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ users: { getUser } }) }));
import { actorName } from "./actor";

describe("actorName — 'confirmed by Ana' (plan G14)", () => {
  it("is the first name, else the full name, else null; Clerk unreachable is null, never a throw (mutation: rethrow → FAILS)", async () => {
    getUser.mockResolvedValueOnce({ firstName: " Ana ", fullName: "Ana Ruiz" });
    expect(await actorName("user_1")).toBe("Ana");
    getUser.mockResolvedValueOnce({ firstName: null, fullName: "Ana Ruiz" });
    expect(await actorName("user_1")).toBe("Ana Ruiz");
    getUser.mockResolvedValueOnce({ firstName: null, fullName: null });
    expect(await actorName("user_1")).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    getUser.mockRejectedValueOnce(new Error("clerk down"));
    expect(await actorName("user_1")).toBeNull();
  });
});
```

Create `apps/web/src/lib/consent/staff-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  appendConsentEventGuarded: vi.fn(), readConsentHistory: vi.fn(), readConsentEvent: vi.fn(),
  completeTasksForConsentEvents: vi.fn(), reopenTasks: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { stopTexts, undoStopTexts, resumeTexts, confirmStop, notAStop, undoHoldDecision, UNDO_WINDOW_MS, type TextsContext } from "./staff-actions";
import { m } from "@/lib/messages";

const READER = { reader: true } as never;
const WRITER = { writer: true } as never;
const NOW = new Date("2026-10-06T20:00:00Z");
/** Thirty seconds before NOW: inside the Undo window. */
const FRESH = "2026-10-06T19:59:30Z";
const ctx: TextsContext = {
  db: READER, writer: WRITER, accountId: "a1", contactId: "c1", userId: "user_1", actorName: "Ana",
  address: "+19562921696", unconfirmed: false, now: NOW,
};
let n = 0;
const row = (action: string, method: string, evidence: Record<string, unknown> = {}, at = `2026-10-0${++n}T10:00:00Z`) =>
  ({ id: `ev_${n}`, action, method, occurred_at: at, evidence, note: null, actor_id: null });
const guardOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[2];
const eventOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[1];

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  n = 0;
  db.readConsentHistory.mockResolvedValue([]);
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "new_1", prior: null });
  db.completeTasksForConsentEvents.mockResolvedValue(["task_1"]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stopTexts", () => {
  it("writes revoked / staff through the SERVICE client, compare-and-set on the row the operator saw, with the actor and their name (plan G6, G14; mutation: guard 'none' → FAILS)", async () => {
    const r = await stopTexts(ctx, null);
    expect(db.appendConsentEventGuarded.mock.calls[0]![0]).toBe(WRITER);
    expect(eventOf()).toMatchObject({ action: "revoked", method: "staff", actorId: "user_1", address: "+19562921696", contactId: "c1", evidence: { actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: null });
    expect(r).toMatchObject({ ok: true, undo: { kind: "stop", eventId: "new_1" } });
  });

  it("a stale click the function refuses (the newest row moved between the read and the write) answers the fresh view, never applied (mutation: treat refused as ok → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    const kw = row("revoked", "keyword", { keyword: "STOP" });
    db.readConsentHistory.mockResolvedValueOnce([]).mockResolvedValue([kw]);
    expect(await stopTexts(ctx, null)).toEqual({ ok: false, error: m["contact.texts.changed"], view: expect.objectContaining({ kind: "stopped", eventId: kw.id }) });
  });

  it("never stops over a customer's own STOP or over a hold, even when the client names that row's id — 0055's rule, mirrored here (review R3-C1; mutation: drop the state check → the write is attempted, FAILS)", async () => {
    const kw = row("revoked", "keyword", { keyword: "STOP" });
    db.readConsentHistory.mockResolvedValue([kw]);
    expect((await stopTexts(ctx, kw.id)).ok).toBe(false);
    const hold = row("held", "free_text");
    db.readConsentHistory.mockResolvedValue([hold]);
    expect((await stopTexts(ctx, hold.id)).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    // …and over a resubscribe it does write:
    const start = row("resubscribed", "start_keyword");
    db.readConsentHistory.mockResolvedValue([start]);
    expect((await stopTexts(ctx, start.id)).ok).toBe(true);
  });
});

describe("undoStopTexts", () => {
  it("undoes only a STAFF stop, compare-and-set on it (mutation: skip the method check → a keyword stop is undone, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoStopTexts(ctx, "ev_kw")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff"), id: "ev_staff", actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoStopTexts(ctx, "ev_staff")).ok).toBe(true);
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff_undo" });
    expect(guardOf()).toEqual({ ifNewest: "ev_staff" });
  });

  it("an Undo is the SAME person's, inside the window: another user's stop, or one older than UNDO_WINDOW_MS, is refused with the undo-expired line — otherwise Undo is a note-free Resume (review R3-I6; mutation: drop the actor check → FAILS; mutation: drop the age check → FAILS)", async () => {
    const base = { ...row("revoked", "staff"), id: "ev_staff", address: "+19562921696", channel: "sms", contact_id: "c1" };
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_2", occurred_at: FRESH });
    expect(await undoStopTexts(ctx, "ev_staff")).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    const old = new Date(NOW.getTime() - UNDO_WINDOW_MS).toISOString();
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_1", occurred_at: old });
    expect(await undoStopTexts(ctx, "ev_staff")).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("another number's row is refused, whatever its method (mutation: drop the address check → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff"), address: "+19565550000", channel: "sms", contact_id: "c9" });
    expect((await undoStopTexts(ctx, "ev_x")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("resumeTexts (choice 19)", () => {
  it("refuses an empty note before anything is read (mutation: drop the note check → FAILS)", async () => {
    expect(await resumeTexts(ctx, "ev_1", "   ")).toEqual({ ok: false, error: m["contact.texts.resumeNoteRequired"] });
    expect(db.readConsentHistory).not.toHaveBeenCalled();
  });

  it("resumes a staff-recorded stop with the note, compare-and-set on it (mutation: omit the note → FAILS)", async () => {
    const stop = row("revoked", "staff");
    db.readConsentHistory.mockResolvedValue([stop]);
    expect((await resumeTexts(ctx, stop.id, " Asked on the phone ")).ok).toBe(true);
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff", note: "Asked on the phone" });
    expect(guardOf()).toEqual({ ifNewest: stop.id });
  });

  it("never resumes the customer's own stop, even if the client asks (mutation: drop the RESUMABLE check → FAILS)", async () => {
    const stop = row("revoked", "keyword");
    db.readConsentHistory.mockResolvedValue([stop]);
    expect((await resumeTexts(ctx, stop.id, "they asked")).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("confirmStop / notAStop / their undo", () => {
  it("Confirm stop turns the hold into revoked / free_text carrying what they wrote, and completes the hold's To-dos (mutation: drop the evidence copy → FAILS)", async () => {
    const hold = row("held", "free_text", { phrase: "ya no me manden", excerpt: "Ya no me manden mensajes" });
    db.readConsentHistory.mockResolvedValue([hold]);
    const r = await confirmStop(ctx, hold.id);
    expect(eventOf()).toMatchObject({ action: "revoked", method: "free_text", evidence: { confirms: hold.id, phrase: "ya no me manden", excerpt: "Ya no me manden mensajes", actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: hold.id });
    expect(db.completeTasksForConsentEvents).toHaveBeenCalledWith(READER, "a1", [hold.id], "user_1");
    expect(r).toMatchObject({ ok: true, undo: { kind: "decision", eventId: "new_1", reopenTaskIds: ["task_1"] } });
  });

  it("Confirm stop on something that is no longer the hold is refused (a STOP landed first; mutation: skip the hold check → FAILS)", async () => {
    const hold = row("held", "free_text");
    const stop = row("revoked", "keyword");
    db.readConsentHistory.mockResolvedValue([stop, hold]);
    expect((await confirmStop(ctx, hold.id)).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("Not a stop releases the hold (hold_released / staff) and completes its To-dos; a To-do failure does not undo the release (mutation: let it throw → FAILS)", async () => {
    const hold = row("held", "free_text", { excerpt: "wrong number" });
    db.readConsentHistory.mockResolvedValue([hold]);
    db.completeTasksForConsentEvents.mockRejectedValue(new Error("tasks down"));
    const r = await notAStop(ctx, hold.id);
    expect(eventOf()).toMatchObject({ action: "hold_released", method: "staff", evidence: { releases: hold.id, excerpt: "wrong number" } });
    expect(r).toMatchObject({ ok: true, undo: { kind: "decision", reopenTaskIds: [] } });
  });

  it("the Undo of either puts the hold back (held / staff_undo) with what they wrote, and reopens exactly the To-dos it closed (mutation: reopen none → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("hold_released", "staff", { excerpt: "wrong number" }), id: "ev_rel", actor_id: "user_1", occurred_at: FRESH, address: "+19562921696", channel: "sms", contact_id: "c1" });
    const r = await undoHoldDecision(ctx, "ev_rel", ["task_1"]);
    expect(eventOf()).toMatchObject({ action: "held", method: "staff_undo", evidence: { undoes: "ev_rel", excerpt: "wrong number" } });
    expect(guardOf()).toEqual({ ifNewest: "ev_rel" });
    expect(db.reopenTasks).toHaveBeenCalledWith(READER, "a1", ["task_1"], "user_1");
    expect(r.ok).toBe(true);
  });

  it("the Undo of a hold decision is bound the same way: another user's, or an old one, is refused (review R3-I6; mutation: drop the bound from undoHoldDecision → a confirmed stop is lifted back to a hold with no note, FAILS)", async () => {
    const base = { ...row("revoked", "free_text", { excerpt: "ya no me manden" }), id: "ev_conf", address: "+19562921696", channel: "sms", contact_id: "c1" };
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_2", occurred_at: FRESH });
    expect(await undoHoldDecision(ctx, "ev_conf", [])).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    db.readConsentEvent.mockResolvedValue({ ...base, actor_id: "user_1", occurred_at: "2026-10-06T19:00:00Z" });
    expect(await undoHoldDecision(ctx, "ev_conf", [])).toEqual({ ok: false, error: m["contact.texts.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("an Undo pointed at anything but a hold decision is refused (mutation: accept any row → a keyword stop is 'undone' into a hold, FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "keyword"), address: "+19562921696", channel: "sms", contact_id: "c1" });
    expect((await undoHoldDecision(ctx, "ev_kw", [])).ok).toBe(false);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("a write that throws is a plain failure line, logged (mutation: rethrow → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("append_consent_event failed: timeout"));
    expect(await stopTexts(ctx, null)).toEqual({ ok: false, error: m["contact.texts.failed"] });
  });
});
```

Create `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }) }));
const getContact = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getContact }));
const readTextsView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/texts-view", () => ({ readTextsView }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";

const params = { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  getContact.mockReset().mockResolvedValue({ id: "c1", phone: "+19562921696", phone_country_unconfirmed: false });
  readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/texts — the Texts row's own read (spec §6: its own loading and error)", () => {
  it("answers the view, the account's zone and the stored phone, read under the request's own client (mutation: drop the zone → FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+19562921696" });
  });

  it("404 without access, and 404 for a contact that is not this account's (mutation: skip the contact read → FAILS)", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(readTextsView).toHaveBeenCalledTimes(0);
  });

  it("an unreadable ledger is a 500 the row shows as its error line, never a guessed 'Allowed' (fails closed; mutation: answer allowed on error → FAILS)", async () => {
    readTextsView.mockRejectedValue(new Error("readConsentHistory failed: timeout"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/ui/guarded-run.test.ts src/lib/consent/texts-view.test.ts src/lib/consent/actor.test.ts src/lib/consent/staff-actions.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts"
```

Expected (predicted; not replayed): every file fails to import its module.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/ui/guarded-run.ts`:

```ts
/**
 * One write at a time for a control that runs at once and offers Undo
 * (DESIGN.md rule 6). Moved here from lib/contacts/marketing-optout.ts
 * (review R3-M7): the Texts row, the Check number state and the marketing
 * switch share it, and PR-3 retires the marketing module.
 *
 * `busy` is a ref, not the transition's `pending`: an Undo closure is built
 * during an EARLIER write, so a `pending` captured then is stale by the time
 * the toast's button is clicked; a ref is read at click time. `start` is the
 * control's `startTransition`, so it still reads `pending` while the write
 * runs. Answers whether it took the work: `false` means refused, which an
 * Undo turns into a word to the operator.
 */
export type ToastLike = {
  success: (message: string, opts: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

export function runGuarded(
  busy: { current: boolean },
  start: (work: () => Promise<void>) => void,
  work: () => Promise<void>,
): boolean {
  if (busy.current) return false;
  busy.current = true;
  start(async () => {
    try {
      await work();
    } finally {
      busy.current = false;
    }
  });
  return true;
}
```

Edit `apps/web/src/lib/contacts/marketing-optout.ts`:

Find:
```ts
import type { ResolvedZone } from "@bis/db";
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
```
Replace with:
```ts
import type { ResolvedZone } from "@bis/db";
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import type { ToastLike } from "@/lib/ui/guarded-run";
```

Find:
```ts
/** The slice of sonner's `toast` this uses, injected so it is testable
 *  without a DOM. */
export type OptOutToast = {
  success: (message: string, opts: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};
```
Replace with:
```ts
/** The slice of sonner's `toast` this uses (lib/ui/guarded-run.ts). */
type OptOutToast = ToastLike;
```

Delete the whole `runGuarded` function and its doc comment (the block starting `/**\n * One write at a time. \`busy\` is a ref` through the function's closing `}` at the end of the file).

Edit `apps/web/src/lib/contacts/phone-country.ts`:

Find:
```ts
import type { OptOutToast } from "@/lib/contacts/marketing-optout";
```
Replace with:
```ts
import type { ToastLike as OptOutToast } from "@/lib/ui/guarded-run";
```

Edit `…/contacts/phone-country-row.tsx`:

Find:
```ts
import { runGuarded } from "@/lib/contacts/marketing-optout";
```
Replace with:
```ts
import { runGuarded } from "@/lib/ui/guarded-run";
```

Edit `…/contacts/marketing-optout-switch.tsx`:

Find:
```ts
import { flipMarketingOptOut, optOutSinceLine, runGuarded, type OptOutZone } from "@/lib/contacts/marketing-optout";
```
Replace with:
```ts
import { flipMarketingOptOut, optOutSinceLine, type OptOutZone } from "@/lib/contacts/marketing-optout";
import { runGuarded } from "@/lib/ui/guarded-run";
```

Create `apps/web/src/lib/consent/texts-view.ts`:

```ts
import {
  consentStateOf, newestDecidingRow, readConsentHistory,
  type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { keywordDisplay } from "./keywords";

/**
 * The contact's Texts row (consent chain spec §6), as data: what the ledger
 * says about their number, in the gate's own order (plan G18) — Stopped, On
 * hold, Check number, Allowed. Server-only (it reads the ledger and judges
 * the number); the row itself imports only the TYPES.
 */
export type TextsHow =
  | { kind: "keyword"; word: string }
  | { kind: "free_text"; excerpt: string | null; by: string | null }
  | { kind: "staff" }
  | { kind: "carrier" }
  | { kind: "unsubscribe_link" };

export type TextsView =
  | { kind: "no_number" }
  | { kind: "check_number" }
  | { kind: "allowed"; newestId: string | null }
  | { kind: "stopped"; eventId: string; since: string; how: TextsHow; canResume: boolean }
  | { kind: "held"; eventId: string; since: string; excerpt: string | null };

/** Choice 19: staff may resume only a stop staff recorded, staff confirmed, or staff's 0049 switch. */
export const RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "free_text", "backfill_0049"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function howOf(row: ConsentHistoryRow): TextsHow {
  switch (row.method) {
    case "keyword": return { kind: "keyword", word: keywordDisplay(str(row.evidence.keyword) ?? "STOP") };
    case "free_text": return { kind: "free_text", excerpt: str(row.evidence.excerpt), by: str(row.evidence.actorName) };
    case "carrier_block":
    case "backfill_telnyx": return { kind: "carrier" };
    case "unsubscribe_link":
    case "one_click":
    case "unsubscribe_page": return { kind: "unsubscribe_link" };
    default: return { kind: "staff" };   // staff, staff_undo, backfill_0049
  }
}

export function textsViewOf(rows: readonly ConsentHistoryRow[], number: { unconfirmed: boolean } | null): TextsView {
  if (number === null) return { kind: "no_number" };
  const state = consentStateOf(rows);
  if (state.state === "stopped") {
    const row = rows.find((r) => r.id === state.eventId);
    return {
      kind: "stopped", eventId: state.eventId, since: state.since,
      how: row ? howOf(row) : { kind: "staff" }, canResume: RESUMABLE_METHODS.includes(state.method),
    };
  }
  if (state.state === "held") {
    const row = rows.find((r) => r.id === state.eventId);
    return { kind: "held", eventId: state.eventId, since: state.since, excerpt: row ? str(row.evidence.excerpt) : null };
  }
  if (number.unconfirmed) return { kind: "check_number" };
  return { kind: "allowed", newestId: newestDecidingRow(rows)?.id ?? null };
}

/** The contact's Texts row, read. THROWS on an unreadable ledger (the row shows its error line). */
export async function readTextsView(
  db: SupabaseClient, accountId: string, contact: { phone: string | null; phone_country_unconfirmed?: boolean | null },
): Promise<TextsView> {
  const number = normalisePhone(contact.phone);
  if (!number) return { kind: "no_number" };
  const rows = await readConsentHistory(db, accountId, "sms", number.e164);
  return textsViewOf(rows, { unconfirmed: contact.phone_country_unconfirmed === true || number.unconfirmed });
}
```

Create `apps/web/src/lib/consent/actor.ts`:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import { loggableError } from "@/lib/loggable-error";

/**
 * The staff member's name for "confirmed by Ana" (spec §6; plan G14): no
 * table holds it (public.users has no writer), so it is Clerk's, read when
 * the ledger row is written and kept in the row's evidence. Clerk
 * unreachable is `null`, never a failed action.
 */
export async function actorName(userId: string): Promise<string | null> {
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return user.firstName?.trim() || user.fullName?.trim() || null;
  } catch (e) {
    console.error(`actorName: Clerk read for ${userId} failed: ${loggableError(e)}`);
    return null;
  }
}
```

Create `apps/web/src/lib/consent/staff-actions.ts`:

```ts
import {
  appendConsentEventGuarded, readConsentHistory, readConsentEvent, newestDecidingRow,
  completeTasksForConsentEvents, reopenTasks,
  type ConsentAction, type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { textsViewOf, RESUMABLE_METHODS, type TextsView } from "./texts-view";

/**
 * The staff controls of spec §4.2 ("Staff controls") and §6, behind the
 * server actions in contacts/texts-actions.ts and tasks/actions.ts. Every
 * write is a compare-and-set on the newest deciding row the operator SAW
 * (`{ ifNewest }`, plan G6): a stale click — the customer texted STOP while
 * the drawer was open — is refused and answered with where things stand now,
 * never applied over a customer's own stop (choice 19).
 */
export type TextsUndo =
  | { kind: "stop"; eventId: string }
  | { kind: "decision"; eventId: string; reopenTaskIds: string[] };

export type TextsActionResult =
  | { ok: true; view: TextsView; undo?: TextsUndo }
  | { ok: false; error: string; view?: TextsView };

export type TextsContext = {
  /** The request's RLS client: reads the ledger (SELECT under RLS) and writes tasks. */
  db: SupabaseClient;
  /** The service client: the ledger's only writer (0054, 0055). */
  writer: SupabaseClient;
  accountId: string;
  contactId: string;
  userId: string;
  actorName: string | null;
  /** The contact's number, E.164: the ledger's key. */
  address: string;
  unconfirmed: boolean;
  /** The request's clock, for the Undo window. */
  now: Date;
};

/**
 * How long an Undo stays an Undo (review R3-I6). The toast that offers it
 * lives a few seconds; two minutes covers a slow network without letting an
 * Undo become a note-free Resume. Past it, or for someone else's row, staff
 * use Stop texts or Resume texts (with its note), like any other change.
 */
export const UNDO_WINDOW_MS = 2 * 60 * 1000;

/** Is this the operator's own row, young enough to undo? Pure. */
function undoable(ctx: TextsContext, row: { actor_id: string | null; occurred_at: string }): boolean {
  const age = ctx.now.getTime() - Date.parse(row.occurred_at);
  return row.actor_id === ctx.userId && Number.isFinite(age) && age < UNDO_WINDOW_MS;
}
const undoExpired = (): TextsActionResult => ({ ok: false, error: m["contact.texts.undoExpired"] });

const history = (ctx: TextsContext): Promise<ConsentHistoryRow[]> => readConsentHistory(ctx.db, ctx.accountId, "sms", ctx.address);
const view = async (ctx: TextsContext): Promise<TextsView> => textsViewOf(await history(ctx), { unconfirmed: ctx.unconfirmed });
const heldIds = (rows: readonly ConsentHistoryRow[]) => rows.filter((r) => r.action === "held").map((r) => r.id);

async function changed(ctx: TextsContext): Promise<TextsActionResult> {
  try {
    return { ok: false, error: m["contact.texts.changed"], view: await view(ctx) };
  } catch {
    return { ok: false, error: m["contact.texts.changed"] };
  }
}

async function guarded(label: string, ctx: TextsContext, work: () => Promise<TextsActionResult>): Promise<TextsActionResult> {
  try {
    return await work();
  } catch (e) {
    console.error(`${label}: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.texts.failed"] };
  }
}

/** One ledger row, compare-and-set on `expect`. The new row's id, or null when the newest row moved. */
async function write(
  ctx: TextsContext, e: { action: ConsentAction; method: ConsentMethod; note?: string; evidence?: Record<string, unknown> },
  expect: string | null,
): Promise<string | null> {
  const r = await appendConsentEventGuarded(ctx.writer, {
    accountId: ctx.accountId, channel: "sms", address: ctx.address, contactId: ctx.contactId,
    action: e.action, method: e.method, actorId: ctx.userId, note: e.note ?? null,
    evidence: { ...(e.evidence ?? {}), ...(ctx.actorName ? { actorName: ctx.actorName } : {}) },
  }, { ifNewest: expect });
  return r.outcome === "appended" ? r.id : null;
}

/** Closing a hold's To-dos is bookkeeping: a failure there is logged, never a failed decision. */
async function closeHoldTodos(ctx: TextsContext, rows: readonly ConsentHistoryRow[]): Promise<string[]> {
  try {
    return await completeTasksForConsentEvents(ctx.db, ctx.accountId, heldIds(rows), ctx.userId);
  } catch (e) {
    console.error(`consent To-dos for contact ${ctx.contactId} not closed: ${loggableError(e)}`);
    return [];
  }
}

/**
 * "Stop texts": revoked / staff, at once, with an Undo — only over an ALLOWED
 * address (no deciding row, a resubscribe or a release). 0055 enforces the
 * same rule inside its lock (review R3-C1); this read answers the operator
 * with where things stand instead of a bare refusal. A stop already stands,
 * and a hold is decided by Confirm stop / Not a stop.
 */
export function stopTexts(ctx: TextsContext, expectNewest: string | null): Promise<TextsActionResult> {
  return guarded("stopTexts", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if ((newest?.id ?? null) !== expectNewest || (newest !== null && newest.action !== "resubscribed" && newest.action !== "hold_released")) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "revoked", method: "staff" }, expectNewest);
    if (!id) return changed(ctx);
    return { ok: true, view: await view(ctx), undo: { kind: "stop", eventId: id } };
  });
}

/** The Undo of "Stop texts": only that staff stop, and only while it is still the newest row. */
export function undoStopTexts(ctx: TextsContext, eventId: string): Promise<TextsActionResult> {
  return guarded("undoStopTexts", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    if (!row || row.address !== ctx.address || row.action !== "revoked" || row.method !== "staff") return changed(ctx);
    if (!undoable(ctx, row)) return undoExpired();
    const id = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

/** "Resume texts" with the required note: only a stop staff may lift (choice 19). */
export async function resumeTexts(ctx: TextsContext, expectEventId: string, note: string): Promise<TextsActionResult> {
  const text = note.trim();
  if (!text) return { ok: false, error: m["contact.texts.resumeNoteRequired"] };
  return guarded("resumeTexts", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if (!newest || newest.id !== expectEventId || newest.action !== "revoked" || !RESUMABLE_METHODS.includes(newest.method)) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "resubscribed", method: "staff", note: text.slice(0, 500) }, expectEventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

async function decideHold(
  label: string, ctx: TextsContext, holdEventId: string,
  e: (hold: ConsentHistoryRow) => { action: ConsentAction; method: ConsentMethod; evidence: Record<string, unknown> },
): Promise<TextsActionResult> {
  return guarded(label, ctx, async () => {
    const rows = await history(ctx);
    const hold = newestDecidingRow(rows);
    if (!hold || hold.id !== holdEventId || hold.action !== "held") return changed(ctx);
    const id = await write(ctx, e(hold), holdEventId);
    if (!id) return changed(ctx);
    const reopenTaskIds = await closeHoldTodos(ctx, rows);
    return { ok: true, view: await view(ctx), undo: { kind: "decision", eventId: id, reopenTaskIds } };
  });
}

const what = (row: { evidence: Record<string, unknown> }) => ({ phrase: row.evidence.phrase ?? null, excerpt: row.evidence.excerpt ?? null });

/** "Confirm stop": the hold becomes revoked / free_text, carrying what they wrote. */
export function confirmStop(ctx: TextsContext, holdEventId: string): Promise<TextsActionResult> {
  return decideHold("confirmStop", ctx, holdEventId, (hold) => ({
    action: "revoked", method: "free_text", evidence: { confirms: holdEventId, ...what(hold) },
  }));
}

/** "Not a stop": hold_released / staff (spec §3's guarded write, 0055). */
export function notAStop(ctx: TextsContext, holdEventId: string): Promise<TextsActionResult> {
  return decideHold("notAStop", ctx, holdEventId, (hold) => ({
    action: "hold_released", method: "staff", evidence: { releases: holdEventId, ...what(hold) },
  }));
}

/** The Undo of either: held / staff_undo, back On hold (spec §4.2), and the To-dos it closed reopened. */
export function undoHoldDecision(ctx: TextsContext, eventId: string, reopenTaskIds: readonly string[]): Promise<TextsActionResult> {
  return guarded("undoHoldDecision", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    const isDecision = !!row && row.address === ctx.address
      && ((row.action === "revoked" && row.method === "free_text") || (row.action === "hold_released" && row.method === "staff"));
    if (!row || !isDecision) return changed(ctx);
    if (!undoable(ctx, row)) return undoExpired();
    const id = await write(ctx, { action: "held", method: "staff_undo", evidence: { undoes: eventId, ...what(row) } }, eventId);
    if (!id) return changed(ctx);
    try {
      await reopenTasks(ctx.db, ctx.accountId, reopenTaskIds, ctx.userId);
    } catch (e) {
      console.error(`consent To-dos for contact ${ctx.contactId} not reopened: ${loggableError(e)}`);
    }
    return { ok: true, view: await view(ctx) };
  });
}
```

Create `apps/web/src/lib/consent/texts-context.ts`:

```ts
import { getContact, serviceDb } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { actorName } from "./actor";
import type { TextsContext } from "./staff-actions";

/**
 * The context a staff action runs in, AFTER the caller's own
 * `requireAccountAccess`: the contact read under the request's RLS client
 * (which is what proves it is this account's), its number as the ledger
 * keys it, and the service client that writes (0053's server-written shape).
 */
export async function textsContextFor(
  accountId: string, contactId: string, userId: string,
): Promise<TextsContext | { ok: false; error: string }> {
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    const number = normalisePhone(contact?.phone ?? null);
    if (!contact || !number) return { ok: false, error: m["contact.texts.noNumber"] };
    return {
      db, writer: serviceDb(), accountId, contactId, userId, actorName: await actorName(userId),
      address: number.e164, unconfirmed: contact.phone_country_unconfirmed === true || number.unconfirmed,
      now: new Date(),
    };
  } catch (e) {
    console.error(`textsContextFor: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.texts.failed"] };
  }
}
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { textsContextFor } from "@/lib/consent/texts-context";
import {
  stopTexts, undoStopTexts, resumeTexts, confirmStop, notAStop, undoHoldDecision,
  type TextsActionResult, type TextsContext,
} from "@/lib/consent/staff-actions";

/** The Texts row's actions (consent chain PR-2, spec §4.2 "Staff controls"). Each re-reads the contact under RLS. */
async function run(
  accountId: string, contactId: string, act: (ctx: TextsContext) => Promise<TextsActionResult>,
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await textsContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) {
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/tasks`);
  }
  return result;
}

export async function stopTextsAction(accountId: string, contactId: string, expectNewest: string | null): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => stopTexts(ctx, expectNewest));
}
export async function undoStopTextsAction(accountId: string, contactId: string, eventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoStopTexts(ctx, eventId));
}
export async function resumeTextsAction(accountId: string, contactId: string, expectEventId: string, note: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => resumeTexts(ctx, expectEventId, note));
}
export async function confirmStopAction(accountId: string, contactId: string, holdEventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => confirmStop(ctx, holdEventId));
}
export async function notAStopAction(accountId: string, contactId: string, holdEventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => notAStop(ctx, holdEventId));
}
export async function undoHoldDecisionAction(accountId: string, contactId: string, eventId: string, reopenTaskIds: string[]): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoHoldDecision(ctx, eventId, reopenTaskIds));
}
```

Create `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { loggableError } from "@/lib/loggable-error";
import { readTextsView, type TextsView } from "@/lib/consent/texts-view";

export const dynamic = "force-dynamic";

/** The drawer's Texts row reads this on its own (spec §6: the Messages block's own loading and error),
 *  with the stored phone the Check number pick is judged against (review I3: the number the operator SAW). */
export type TextsResponse = { view: TextsView; zone: string; phone: string | null };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });
  try {
    const [view, account] = await Promise.all([
      readTextsView(db, accountId, contact),
      db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    ]);
    const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);
    return NextResponse.json({ view, zone: zone.zone, phone: contact.phone ?? null } satisfies TextsResponse);
  } catch (e) {
    // Fails closed: an unreadable ledger is the row's error line, never a guessed "Allowed".
    console.error(`texts read: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({ error: "unreadable" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/ui/guarded-run.test.ts src/lib/contacts/marketing-optout.test.ts src/lib/contacts/phone-country.test.ts \
  src/lib/consent/texts-view.test.ts src/lib/consent/actor.test.ts src/lib/consent/staff-actions.test.ts \
  "src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts"
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass; `marketing-optout.test.ts` has four fewer cases (moved); `tsc` exit 0. Then the full web suite.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `RESUMABLE_METHODS` gains `carrier_block` | "a staff stop and a confirmed free-text stop may be resumed; a carrier stop may not" |
| 2 | `textsViewOf`: check `number.unconfirmed` before the ledger state | "a hold shows what they wrote; a hold beats the Check number state" |
| 3 | `newestId: rows[0]?.id ?? null` | "allowed carries the newest deciding row's id …" |
| 4 | `howOf`: `keyword` returns the raw word | "a keyword stop reads 'they texted …' in the spaced spelling" |
| 5 | `stopTexts`: guard `"none"` (write with `appendConsentEventGuarded(…, "none")`) | "writes revoked / staff through the SERVICE client, compare-and-set …" |
| 6 | `write`: use `ctx.db` instead of `ctx.writer` | same test |
| 7 | `undoStopTexts`: drop `row.method !== "staff"` | "undoes only a STAFF stop …" |
| 8 | `undoStopTexts`: drop `row.address !== ctx.address` | "another number's row is refused …" |
| 9 | `resumeTexts`: drop the RESUMABLE check | "never resumes the customer's own stop …" |
| 10 | `confirmStop`: evidence without `what(hold)` | "Confirm stop turns the hold into revoked / free_text carrying what they wrote …" |
| 11 | `decideHold`: drop `hold.id !== holdEventId` | "Confirm stop on something that is no longer the hold is refused" |
| 12 | `closeHoldTodos`: rethrow | "Not a stop releases the hold …; a To-do failure does not undo the release" |
| 13 | `undoHoldDecision`: skip `reopenTasks` | "the Undo of either puts the hold back … and reopens exactly the To-dos it closed" |
| 14 | `undoHoldDecision`: `isDecision = true` | "an Undo pointed at anything but a hold decision is refused" |
| 15 | `actorName`: rethrow | "is the first name, else the full name, else null; …" |
| 16 | texts route: answer `{ view: { kind: "allowed" } }` in the catch | "an unreadable ledger is a 500 …" |
| 17 | `stopTexts`: drop the state check (keep only the id compare) | "never stops over a customer's own STOP or over a hold …" |
| 18 | `undoable`: drop `row.actor_id === ctx.userId` | "an Undo is the SAME person's, inside the window …" and "the Undo of a hold decision is bound the same way …" |
| 19 | `undoable`: drop the age condition | the same two tests |
| 20 | `readTextsView`: `unconfirmed: contact.phone_country_unconfirmed === true` (the flag alone) | "a number that reads both ways is Check number even with the flag false …" |
| 21 | `readTextsView`: read the ledger with `contact.phone` instead of `number.e164` | "the flag alone raises it too; a plainly US number …" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ui apps/web/src/lib/contacts/marketing-optout.ts apps/web/src/lib/contacts/marketing-optout.test.ts \
  apps/web/src/lib/contacts/phone-country.ts apps/web/src/lib/contacts/phone-country.test.ts \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/phone-country-row.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/marketing-optout-switch.tsx" \
  apps/web/src/lib/consent/texts-view.ts apps/web/src/lib/consent/texts-view.test.ts apps/web/src/lib/consent/actor.ts \
  apps/web/src/lib/consent/actor.test.ts apps/web/src/lib/consent/staff-actions.ts apps/web/src/lib/consent/staff-actions.test.ts \
  apps/web/src/lib/consent/texts-context.ts \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-actions.ts" \
  "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts" \
  "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts"
git commit -m "feat(consent): the Texts row's data — the view, the staff controls as compare-and-set writes, the drawer's own read; runGuarded moves to lib/ui (R3-M7)"
```

---

### Task 12: The Texts row: Allowed, Stopped, On hold and Check number, in the drawer and on the contact page

**Owner:** bis-frontend (with bis-crm). **Tier:** HIGH (UI for legal controls). **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/texts-row.ts`, `apps/web/src/lib/consent/texts-row.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.tsx`, `…/contacts/texts-row.test.ts`
- Delete: `…/contacts/phone-country-row.tsx` (its Check number state moves into `texts-row.tsx`, review R3-M7's "one state of a Texts row")
- Modify: `…/contacts/contact-drawer.tsx`, `…/contacts/contact-drawer.wiring.test.ts`, `…/contacts/[contactId]/contact-fields-panel.tsx`, `…/contacts/[contactId]/page.tsx`, `…/contacts/[contactId]/page.test.ts`, `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`
- Modify: `apps/web/src/lib/ui/guarded-run.ts` (`ToastLike.success`'s options become optional: a success with nothing to undo)
- Modify: `apps/web/src/lib/contacts/phone-country.ts` (two comments still name the deleted row, review R3-m7)
- Modify: `apps/web/e2e/consent-phone-country.spec.ts` (PR-1's e2e, on top of #152's version at `76c6acfb`: each "no Check number row" waits for the Texts row to have loaded, and a pick leaves focus on the row's status; review R3-I3, R3-I4)
- Modify: `…/contacts/[contactId]/activity-timeline.tsx`; Create: `…/contacts/[contactId]/activity-timeline.hold.test.ts` (a hold's To-do shows a hint in place of a Done that would be refused; review R3-N1, G21)

**Interfaces:**
- Consumes: Task 2 (`holdOpenTaskIds`, `listContactTasks`'s `consent_event_id`); Task 11 (`TextsView`, `TextsActionResult`, `TextsUndo`, the six actions, `TextsResponse`, `runGuarded`, `ToastLike`); PR-1's `pickPhoneCountry`, `PHONE_CHECK_TREATMENT`, `setPhoneCountryAction`, `undoPhoneCountryAction`.
- Produces: `type TextsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; view: TextsView; zone: string; phone: string | null }`; `TEXTS_TREATMENT`; `howLine(how)`; `textsLine(view, zone)`; `parseTextsResponse(json)`; `textsLoadFrom(res)`; `runTextsAction(act, show, toast, opts): Promise<boolean>`; `<TextsRow accountId contactId load onChanged? onRetry? />`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/texts-row.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { howLine, textsLine, parseTextsResponse, textsLoadFrom, runTextsAction, TEXTS_TREATMENT } from "./texts-row";
import type { TextsView } from "./texts-view";

const STOPPED: TextsView = { kind: "stopped", eventId: "ev1", since: "2026-10-04T02:30:00Z", how: { kind: "keyword", word: "STOP" }, canResume: false };

describe("the Texts row's lines (spec §6)", () => {
  it("stopped reads 'Since {date} · {how}', the date in the ACCOUNT's zone (mutation: format in UTC → Oct 4, FAILS)", () => {
    expect(textsLine(STOPPED, "America/Chicago")).toBe(`${m["contact.texts.since"].replace("{date}", "Oct 3, 2026")} · they texted STOP`);
    expect(textsLine(STOPPED, "UTC")).toContain("Oct 4, 2026");
  });

  it("an unreadable date keeps the how, never throws inside a render (mutation: let formatDateInZone throw → FAILS)", () => {
    expect(textsLine({ ...STOPPED, since: "not a date" }, "America/Chicago")).toBe("they texted STOP");
  });

  it("each how in plain words, a free-text stop naming who confirmed it (mutation: drop the name branch → FAILS)", () => {
    expect(howLine({ kind: "free_text", excerpt: "ya no me manden", by: "Ana" })).toBe("they wrote “ya no me manden”, confirmed by Ana");
    expect(howLine({ kind: "free_text", excerpt: "ya no me manden", by: null })).toBe("they wrote “ya no me manden”, confirmed by your team");
    expect(howLine({ kind: "staff" })).toBe(m["contact.texts.how.staff"]);
    expect(howLine({ kind: "carrier" })).toBe(m["contact.texts.how.carrier"]);
    expect(howLine({ kind: "unsubscribe_link" })).toBe(m["contact.texts.how.unsubscribeLink"]);
  });

  it("a hold quotes what they wrote, cut at 60 characters; with nothing to quote it says texts are on hold (mutation: no fallback → '“null”', FAILS)", () => {
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: "remove me" }, "UTC")).toBe("They wrote “remove me”. Texts are on hold.");
    expect(textsLine({ kind: "held", eventId: "h", since: "2026-10-03T15:00:00Z", excerpt: null }, "UTC")).toBe(m["compose.smsHeld"]);
    const long = textsLine({ kind: "held", eventId: "h", since: "x", excerpt: "a".repeat(80) }, "UTC")!;
    expect(long).toContain(`“${"a".repeat(59)}…”`);
  });

  it("status is a dot and a word from the token classes (rule 3; mutation: stopped borrows allowed's dot → FAILS)", () => {
    expect(TEXTS_TREATMENT.allowed).toMatchObject({ label: "Allowed", dot: "bg-success" });
    expect(TEXTS_TREATMENT.stopped).toMatchObject({ label: "Stopped", dot: "bg-destructive" });
    expect(TEXTS_TREATMENT.held).toMatchObject({ label: "On hold", dot: "bg-warning" });
  });
});

describe("parseTextsResponse / textsLoadFrom — the drawer's read is parsed, not cast", () => {
  it("a good body is ready; a non-OK response or a malformed body is the error state (mutation: cast the body → the bad one is ready, FAILS)", async () => {
    const good = { view: { kind: "allowed", newestId: null }, zone: "America/Chicago", phone: "+19562921696" };
    expect(await textsLoadFrom({ ok: true, json: async () => good })).toEqual({ status: "ready", ...good });
    expect(await textsLoadFrom({ ok: false, json: async () => good })).toEqual({ status: "error" });
    expect(parseTextsResponse({ view: { kind: "maybe" }, zone: "UTC", phone: null })).toBeNull();
    expect(parseTextsResponse({ view: { kind: "stopped", since: "x", how: { kind: "staff" } }, zone: "UTC", phone: null })).toBeNull();
    expect(parseTextsResponse({ view: { kind: "allowed", newestId: null }, phone: null })).toBeNull();
  });
});

describe("runTextsAction — at once, the answer shown, Undo on the toast (rule 6)", () => {
  const toast = () => {
    let undo: (() => unknown) | null = null;
    const t = {
      success: vi.fn((_m: string, opts?: { action: { label: string; onClick: () => void } }) => { undo = opts?.action.onClick ?? null; }),
      error: vi.fn(),
    };
    return { t, click: () => undo?.() };
  };
  const ALLOWED: TextsView = { kind: "allowed", newestId: "e0" };

  it("shows the new state, calls onChanged, and offers Undo that runs with the action's own token (mutation: drop the undo action → FAILS)", async () => {
    const shown: TextsView[] = [];
    const { t, click } = toast();
    const undo = vi.fn(async () => ({ ok: true as const, view: ALLOWED }));
    const onChanged = vi.fn();
    expect(await runTextsAction(async () => ({ ok: true, view: STOPPED, undo: { kind: "stop", eventId: "ev1" } }), (v) => shown.push(v), t,
      { success: m["contact.texts.stoppedToast"], undo, onChanged })).toBe(true);
    expect(shown).toEqual([STOPPED]);
    expect(t.success).toHaveBeenCalledWith(m["contact.texts.stoppedToast"], expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }));
    await click();
    expect(undo).toHaveBeenCalledWith({ kind: "stop", eventId: "ev1" });
    expect(shown).toEqual([STOPPED, ALLOWED]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("a refusal says why AND shows where things stand now (mutation: drop show on refusal → FAILS)", async () => {
    const shown: TextsView[] = [];
    const { t } = toast();
    expect(await runTextsAction(async () => ({ ok: false, error: m["contact.texts.changed"], view: STOPPED }), (v) => shown.push(v), t, { success: "x" })).toBe(false);
    expect(t.error).toHaveBeenCalledWith(m["contact.texts.changed"]);
    expect(shown).toEqual([STOPPED]);
  });

  it("a rejected action (a stale tab after a redeploy) is the 'crashed' line (mutation: let it throw → FAILS)", async () => {
    const { t } = toast();
    expect(await runTextsAction(async () => { throw new Error("stale action id"); }, () => {}, t, { success: "x" })).toBe(false);
    expect(t.error).toHaveBeenCalledWith(m["inline.crashed"]);
  });

  it("a success with nothing to undo is a plain toast; a refused Undo says so (mutation: drop the undoBusy line → FAILS)", async () => {
    const { t, click } = toast();
    await runTextsAction(async () => ({ ok: true, view: ALLOWED }), () => {}, t, { success: m["contact.texts.resumedToast"] });
    expect(t.success).toHaveBeenCalledWith(m["contact.texts.resumedToast"]);
    const second = toast();
    await runTextsAction(async () => ({ ok: true, view: STOPPED, undo: { kind: "stop", eventId: "ev1" } }), () => {}, second.t,
      { success: "x", undo: async () => ({ ok: true, view: ALLOWED }), run: () => false });
    second.click();
    expect(second.t.error).toHaveBeenCalledWith(m["contact.texts.undoBusy"]);
    void click;
  });
});
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import type { TextsLoad } from "@/lib/consent/texts-row";

// Server actions are stubbed: this renders, nothing is clicked (the clicks are e2e, Task 15).
vi.mock("./actions", () => ({ setPhoneCountryAction: vi.fn(), undoPhoneCountryAction: vi.fn() }));
vi.mock("./texts-actions", () => ({
  stopTextsAction: vi.fn(), undoStopTextsAction: vi.fn(), resumeTextsAction: vi.fn(),
  confirmStopAction: vi.fn(), notAStopAction: vi.fn(), undoHoldDecisionAction: vi.fn(),
}));

const { TextsRow } = await import("./texts-row");

const ready = (view: Extract<TextsLoad, { status: "ready" }>["view"]): TextsLoad =>
  ({ status: "ready", view, zone: "America/Chicago", phone: "+15512345678" });
const html = (load: TextsLoad) => renderToStaticMarkup(createElement(TextsRow, { accountId: "a1", contactId: "c1", load }));
/** One button's opening tag, by its visible label. */
const button = (markup: string, label: string) => {
  const at = markup.indexOf(`>${label}<`);
  if (at < 0) return null;
  return markup.slice(markup.lastIndexOf("<button", at), at + 1);
};
/** The whole element (a div) carrying this test id, children included. */
const inside = (markup: string, testid: string): string => {
  const at = markup.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  const open = markup.lastIndexOf("<div", at);
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let t = tags.exec(markup); t; t = tags.exec(markup)) {
    depth += t[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(open, tags.lastIndex);
  }
  return "";
};

describe("TextsRow — every state of spec §6", () => {
  it("loading is a two-row skeleton; no status word (mutation: render one skeleton → FAILS)", () => {
    const out = html({ status: "loading" });
    expect(out).toContain('data-testid="texts-row-skeleton"');
    expect(out.match(/data-slot="skeleton"/g) ?? []).toHaveLength(2);
    expect(renderedText(out)).not.toContain("Allowed");
  });

  it("an error is the block's own line with Retry, never a guessed state (mutation: render allowed → FAILS)", () => {
    const out = renderToStaticMarkup(createElement(TextsRow, { accountId: "a1", contactId: "c1", load: { status: "error" }, onRetry: () => {} }));
    expect(renderedText(out)).toContain(m["contact.texts.loadFailed"]);
    expect(button(out, m["common.retry"])).not.toBeNull();
  });

  it("no textable number is no row (mutation: render allowed → FAILS)", () => {
    expect(html(ready({ kind: "no_number" }))).toBe("");
  });

  it("Allowed: dot + word, and one GHOST 'Stop texts' (rules 3, 8; mutation: default variant → FAILS)", () => {
    const out = html(ready({ kind: "allowed", newestId: null }));
    expect(out).toContain('data-state="allowed"');
    expect(renderedText(out)).toContain("Allowed");
    expect(out).toMatch(/<span class="[^"]*bg-success[^"]*" aria-hidden/);
    expect(button(out, m["contact.texts.stopTexts"])).toContain('data-variant="ghost"');
  });

  it("Stopped by the customer: since and how, the START line, and NO Resume (choice 19; mutation: offer Resume for every stop → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-10-04T02:30:00Z", how: { kind: "keyword", word: "STOP" }, canResume: false }));
    const text = renderedText(out);
    expect(text).toContain("Since Oct 3, 2026 · they texted STOP");
    expect(text).toContain(m["contact.texts.customerOnly"]);
    expect(button(out, m["contact.texts.resume"])).toBeNull();
  });

  it("Stopped by staff: a ghost 'Resume texts…' and no START line (mutation: invert canResume → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-10-04T02:30:00Z", how: { kind: "staff" }, canResume: true }));
    expect(button(out, m["contact.texts.resume"])).toContain('data-variant="ghost"');
    expect(renderedText(out)).not.toContain(m["contact.texts.customerOnly"]);
  });

  it("On hold: what they wrote, and two ghost buttons, Confirm stop and Not a stop (mutation: drop Not a stop → FAILS)", () => {
    const out = html(ready({ kind: "held", eventId: "h", since: "2026-10-04T02:30:00Z", excerpt: "remove me" }));
    expect(renderedText(out)).toContain("They wrote “remove me”. Texts are on hold.");
    expect(button(out, m["contact.texts.confirmStop"])).toContain('data-variant="ghost"');
    expect(button(out, m["contact.texts.notAStop"])).toContain('data-variant="ghost"');
  });

  it("Check number keeps PR-1's own test id on the WHOLE state — the status word, the line and both country buttons inside it — because PR-1's e2e reads the word through it (review R3-I2; mutation: wrap only the line and the buttons → the word falls outside, FAILS)", () => {
    const block = inside(html(ready({ kind: "check_number" })), "phone-country-row");
    expect(renderedText(block)).toContain(m["contact.phoneCountry.word"]);
    expect(renderedText(block)).toContain(m["contact.phoneCountry.line"]);
    expect(block).toContain('data-testid="texts-row-status"');
    expect(button(block, m["contact.phoneCountry.mx"])).not.toBeNull();
    expect(button(block, m["contact.phoneCountry.us"])).not.toBeNull();
  });

  it("the status line is the first child of ONE wrapper in every ready state, Check number included, so React keeps the same node — and its focus — when the state changes (review R3-N2; mutation: a wrapper of its own for Check number, the bare status line elsewhere → FAILS)", () => {
    const sameShape = /<div class="space-y-1\.5"( data-testid="phone-country-row")?><div[^>]*data-testid="texts-row-status"/;
    for (const view of [{ kind: "allowed", newestId: null }, { kind: "check_number" },
      { kind: "held", eventId: "h", since: "2026-10-04T02:30:00Z", excerpt: "remove me" }] as const) {
      expect(html(ready(view)), view.kind).toMatch(sameShape);
    }
  });

  it("the status is a focus target, so an action keeps the keyboard in the row (review R3-M9; mutation: drop tabIndex → FAILS)", () => {
    expect(html(ready({ kind: "allowed", newestId: null }))).toMatch(/data-testid="texts-row-status"[^>]*tabindex="-1"|tabindex="-1"[^>]*data-testid="texts-row-status"/);
  });
});
```

Edit `…/contacts/contact-drawer.wiring.test.ts` — replace the two describes that pin PR-1's row. Replace the whole `describe("the Check number row follows a phone edit", …)` block with:

```ts
describe("the Texts row follows the contact (consent chain PR-2)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const panel = strip(readFileSync(path.join(here, "[contactId]", "contact-fields-panel.tsx"), "utf8"));
  const row = strip(readFileSync(path.join(here, "texts-row.tsx"), "utf8"));

  it("the drawer reads the Texts row on its own, again on every summary re-read: a phone save, a pick, an Undo (mutation: drop retryNonce from the texts effect's deps → FAILS)", () => {
    expect(drawer).toMatch(/\/texts`\)[\s\S]{0,900}?\}, \[accountId, contactId, retryNonce\]\);/);
  });

  it("the drawer re-reads its summary after a phone save (mutation: drop the nonce bump → FAILS)", () => {
    expect(drawer).toMatch(/if \(field === "phone"\) setRetryNonce\(\(n\) => n \+ 1\);/);
  });

  it("a row action or a pick makes the drawer re-read, and the row hands onChanged to the pick (re-review minor 1; mutation: drop the onChanged prop, or stop passing it to pickPhoneCountry → FAILS)", () => {
    expect(drawer).toMatch(/<TextsRow[\s\S]{0,400}?onChanged=\{\(\) => setRetryNonce\(\(n\) => n \+ 1\)\}/);
    expect(row).toMatch(/run,\s*onChanged,\s*\)\);/);
  });

  it("the full page hands the row the page's own Texts load and refreshes on change (mutation: pass a constant load → FAILS)", () => {
    expect(panel).toMatch(/<TextsRow[\s\S]{0,300}?load=\{texts\}/);
    expect(panel).toMatch(/onChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});
```

and replace the whole `describe("the pick is judged against the phone the operator SAW (review I3, round 4)", …)` block with:

```ts
describe("the pick is judged against the phone the operator SAW (review I3, round 4)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const row = strip(readFileSync(path.join(here, "texts-row.tsx"), "utf8"));
  const drawer = strip(readFileSync(path.join(here, "contact-drawer.tsx"), "utf8"));
  const page = strip(readFileSync(path.join(here, "[contactId]", "page.tsx"), "utf8"));

  it("the row passes ITS OWN phone to setPhoneCountryAction, never a literal \"\" (mutation: setPhoneCountryAction(accountId, contactId, c) → FAILS)", () => {
    expect(row).toContain("setPhoneCountryAction(accountId, contactId, c, phone)");
  });

  it("that phone is the one the server read with the view (the Texts load), never the peek stub row.phone (mutation: phone={row.phone ?? \"\"} → FAILS)", () => {
    expect(row).toContain('const phone = load.phone ?? "";');
    expect(drawer).not.toMatch(/<TextsRow[\s\S]{0,400}?row\.phone/);
  });

  it("the full page's load carries the real contact record's phone (mutation: phone: null → FAILS)", () => {
    expect(page).toContain("phone: contact.phone ?? null");
  });
});
```

Edit `…/contacts/[contactId]/page.test.ts`:

Find:
```ts
const phoneRowProps = vi.fn();
vi.mock("../phone-country-row", () => ({
  PhoneCountryRow: (props: Record<string, unknown>) => { phoneRowProps(props); return null; },
}));
```
Replace with:
```ts
const textsRowProps = vi.fn();
vi.mock("../texts-row", () => ({
  TextsRow: (props: Record<string, unknown>) => { textsRowProps(props); return null; },
}));
// Consent chain PR-2: the Texts row's read, stubbed per test.
const readTextsView = vi.fn();
vi.mock("@/lib/consent/texts-view", () => ({ readTextsView: (...a: unknown[]) => readTextsView(...a) }));
```

Replace the two cases titled "a stored number that reads both ways gets the Check number row, flag or not (mutation: pass the flag alone → FAILS)" and "a plainly US number does not" with:

```ts
  it("the page hands the Texts row what the server read, the account's zone and the stored phone (spec §6; mutation: pass no load → FAILS)", async () => {
    readTextsView.mockResolvedValue({ kind: "check_number" });
    await render();
    expect(readTextsView).toHaveBeenCalledWith(expect.anything(), "acct1", expect.objectContaining({ id: "ct1" }));
    expect(textsRowProps.mock.calls[0]![0]).toMatchObject({
      contactId: "ct1", load: { status: "ready", view: { kind: "check_number" }, zone: "America/Chicago", phone: CONTACT.phone ?? null },
    });
  });

  it("an unreadable ledger gives the row its error state, never a thrown page (fails closed; mutation: let it throw → FAILS)", async () => {
    readTextsView.mockRejectedValue(new Error("readConsentHistory failed: timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(textsRowProps.mock.calls[0]![0]).toMatchObject({ load: { status: "error" } });
  });

  it("the timeline is told exactly what holdOpenTaskIds answered for the page's own tasks, and an unreadable ledger hints every open linked one — never a Done that would be refused (review R3-N1, I4; mutation: pass [] on failure → FAILS; mutation: pass the fallback always → the first case FAILS)", async () => {
    listContactTasksMock.mockResolvedValue([
      { id: "t_hold", title: "Ana may have asked …", completed_at: null, consent_event_id: "h1" },
      { id: "t_plain", title: "Call back", completed_at: null, consent_event_id: null },
    ]);
    // The hold was decided since: the read answers none, and the page passes none (not its own fallback).
    holdOpenTaskIdsMock.mockResolvedValue([]);
    await render();
    expect(holdOpenTaskIdsMock).toHaveBeenCalledWith(expect.anything(), "acct1", [
      expect.objectContaining({ id: "t_hold", consent_event_id: "h1" }), expect.objectContaining({ id: "t_plain", consent_event_id: null }),
    ]);
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({ holdOpenTaskIds: [] });
    holdOpenTaskIdsMock.mockRejectedValue(new Error("readConsentEvent failed: timeout"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(timelineProps.mock.calls.at(-1)![0]).toMatchObject({ holdOpenTaskIds: ["t_hold"] });
  });
```

And in the same file's `@bis/db` mock factory (`page.test.ts:36-45` on `76c6acfb`), find:
```ts
  listContactTasks: async () => [],
```
Replace with:
```ts
  listContactTasks: (...args: unknown[]) => listContactTasksMock(...args),
  holdOpenTaskIds: (...args: unknown[]) => holdOpenTaskIdsMock(...args),
```
and declare, just above that `vi.mock("@bis/db", …)` call, `const listContactTasksMock = vi.fn(async () => [] as unknown[]);` and `const holdOpenTaskIdsMock = vi.fn(async () => [] as string[]);` (reset both to those defaults in the file's `beforeEach`).

(`render`, `CONTACT` and the zone the file's other cases resolve are the file's own; if its `beforeEach` clears `phoneRowProps`, change that line to `textsRowProps.mockClear(); readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });`.)

- [ ] **Step 2: Run them to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/texts-row.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts" \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.hold.test.ts"
```

Expected (predicted; not replayed): the two new files fail to import; the wiring test's retargeted cases fail (no `texts-row.tsx`, no `<TextsRow`); the page test's three new cases fail; the timeline test's hint case fails (no `holdOpenTaskIds` prop yet), and its discriminator passes.

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/ui/guarded-run.ts`:

Find:
```ts
  success: (message: string, opts: { action: { label: string; onClick: () => void } }) => unknown;
```
Replace with:
```ts
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
```

Create `apps/web/src/lib/consent/texts-row.ts`:

```ts
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import type { ToastLike } from "@/lib/ui/guarded-run";
import type { TextsHow, TextsView } from "./texts-view";
import type { TextsActionResult, TextsUndo } from "./staff-actions";

/**
 * The Texts row's behaviour, minus React (spec §6): its words, its read, and
 * how an action runs (DESIGN.md rule 6: at once, the answer shown, Undo on
 * the toast). Client-safe: TYPE-ONLY imports of the server modules.
 */
export type TextsLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: TextsView; zone: string; phone: string | null };

/** Dot + word (rule 3), token classes only. On hold is a warning: staff must decide it. */
export const TEXTS_TREATMENT = {
  allowed: { label: m["contact.texts.allowed"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  stopped: { label: m["contact.texts.stopped"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
  held: { label: m["contact.texts.held"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
} as const;

const QUOTE = 60;
function quote(s: string): string {
  const c = Array.from(s);
  return c.length <= QUOTE ? s : `${c.slice(0, QUOTE - 1).join("")}…`;
}

export function howLine(how: TextsHow): string {
  switch (how.kind) {
    case "keyword": return m["contact.texts.how.keyword"].replace("{word}", () => how.word);
    case "free_text": {
      const excerpt = quote(how.excerpt ?? "…");
      const by = how.by;
      return by
        ? m["contact.texts.how.freeTextBy"].replace("{excerpt}", () => excerpt).replace("{name}", () => by)
        : m["contact.texts.how.freeText"].replace("{excerpt}", () => excerpt);
    }
    case "staff": return m["contact.texts.how.staff"];
    case "carrier": return m["contact.texts.how.carrier"];
    case "unsubscribe_link": return m["contact.texts.how.unsubscribeLink"];
  }
}

/** The line under the status, or null. A date that will not format drops the date, never throws in a render. */
export function textsLine(view: TextsView, zone: string): string | null {
  if (view.kind === "stopped") {
    let since: string | null = null;
    try {
      since = m["contact.texts.since"].replace("{date}", formatDateInZone(view.since, zone));
    } catch {
      since = null;
    }
    const how = howLine(view.how);
    return since ? `${since} · ${how}` : how;
  }
  if (view.kind === "held") {
    const excerpt = view.excerpt;
    return excerpt ? m["contact.texts.heldLine"].replace("{excerpt}", () => quote(excerpt)) : m["compose.smsHeld"];
  }
  return null;
}

const KINDS = new Set(["no_number", "check_number", "allowed", "stopped", "held"]);

/** The drawer's read, parsed, never cast: a body this bundle cannot trust is the error state. */
export function parseTextsResponse(json: unknown): { view: TextsView; zone: string; phone: string | null } | null {
  const j = json as { view?: Record<string, unknown>; zone?: unknown; phone?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.zone !== "string" || !j.view || !KINDS.has(j.view.kind as string)) return null;
  const v = j.view;
  if ((v.kind === "stopped" || v.kind === "held") && (typeof v.eventId !== "string" || typeof v.since !== "string")) return null;
  if (v.kind === "stopped" && (typeof v.how !== "object" || v.how === null || typeof v.canResume !== "boolean")) return null;
  if (j.phone !== null && typeof j.phone !== "string") return null;
  return { view: v as TextsView, zone: j.zone, phone: (j.phone as string | null) ?? null };
}

export async function textsLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<TextsLoad> {
  if (!res.ok) return { status: "error" };
  const parsed = parseTextsResponse(await res.json());
  return parsed ? { status: "ready", ...parsed } : { status: "error" };
}

export type TextsRunner = (work: () => Promise<void>) => boolean | Promise<void>;

async function attempt(
  act: () => Promise<TextsActionResult>, show: (v: TextsView) => void, toast: ToastLike,
): Promise<Extract<TextsActionResult, { ok: true }> | null> {
  let r: TextsActionResult;
  try {
    r = await act();
  } catch {
    // A stale tab posting a server-action id from before a redeploy rejects.
    toast.error(m["inline.crashed"]);
    return null;
  }
  if (!r.ok) {
    if (r.view) show(r.view);
    toast.error(r.error);
    return null;
  }
  show(r.view);
  return r;
}

/** One action. Answers whether it went through. Undo runs through the row's own guard; a refused Undo says so. */
export async function runTextsAction(
  act: () => Promise<TextsActionResult>, show: (v: TextsView) => void, toast: ToastLike,
  o: { success: string; undo?: (u: TextsUndo) => Promise<TextsActionResult>; run?: TextsRunner; onChanged?: () => void },
): Promise<boolean> {
  const r = await attempt(act, show, toast);
  if (!r) return false;
  o.onChanged?.();
  const undo = o.undo;
  const token = r.undo;
  if (!undo || !token) {
    toast.success(o.success);
    return true;
  }
  toast.success(o.success, {
    action: {
      label: m["common.undo"],
      onClick: () => {
        const run = o.run ?? ((work) => work());
        const ran = run(async () => {
          if (await attempt(() => undo(token), show, toast)) o.onChanged?.();
        });
        if (ran === false) toast.error(m["contact.texts.undoBusy"]);
        return ran;
      },
    },
  });
  return true;
}
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { PhoneCountry } from "@bis/db/phone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/ui/guarded-run";
import { PHONE_CHECK_TREATMENT, pickPhoneCountry } from "@/lib/contacts/phone-country";
import { TEXTS_TREATMENT, textsLine, runTextsAction, type TextsLoad } from "@/lib/consent/texts-row";
import type { TextsView } from "@/lib/consent/texts-view";
import type { TextsActionResult, TextsUndo } from "@/lib/consent/staff-actions";
import { setPhoneCountryAction, undoPhoneCountryAction } from "./actions";
import {
  stopTextsAction, undoStopTextsAction, resumeTextsAction, confirmStopAction, notAStopAction, undoHoldDecisionAction,
} from "./texts-actions";

/**
 * The contact's Messages block, Texts row (consent chain spec §6): Allowed,
 * Stopped, On hold and Check number, each a dot + word (rule 3), every
 * button ghost except the Resume form's own "Resume texts" (rule 8: that
 * inline form is its own view). Each action runs at once with an Undo toast
 * (rule 6); Resume asks for a note first and has no undo (plan G13).
 *
 * Rendered in the drawer (which reads it on its own, so the block has its own
 * two-row skeleton and error line) and on the contact page (read on the
 * server). Keyboard (review R3-M9, R3-I4): the status line is a focus target
 * that stays MOUNTED in every ready state (after a pick too, when the number's
 * state is unknown until the host re-reads), and every action returns focus
 * to it, so the row never drops the keyboard on the page body when the
 * button that held it goes away. The Resume form's note field takes focus
 * when the form opens, and Cancel hands it back to the status.
 */
type Ready = Extract<TextsLoad, { status: "ready" }>;

function Block({ children, state }: { children: React.ReactNode; state?: string }) {
  return (
    <div className="space-y-1.5" data-testid="texts-row" data-state={state}>
      <p className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.14em] uppercase">{m["contact.messages.title"]}</p>
      {children}
    </div>
  );
}

export function TextsRow({ accountId, contactId, load, onChanged = () => {}, onRetry }: {
  accountId: string;
  contactId: string;
  load: TextsLoad;
  /** A row action or a pick changed the ledger or the number: the host re-reads. */
  onChanged?: () => void;
  /** The error state's Retry. */
  onRetry?: () => void;
}) {
  if (load.status === "loading") {
    return (
      <Block>
        <div className="space-y-2" data-testid="texts-row-skeleton">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      </Block>
    );
  }
  if (load.status === "error") {
    return (
      <Block>
        <p className="text-muted-foreground text-sm">{m["contact.texts.loadFailed"]}</p>
        {onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>{m["common.retry"]}</Button> : null}
      </Block>
    );
  }
  if (load.view.kind === "no_number") return null;
  return <ReadyRow key={contactId} accountId={accountId} contactId={contactId} load={load} onChanged={onChanged} />;
}

function ReadyRow({ accountId, contactId, load, onChanged }: {
  accountId: string; contactId: string; load: Ready; onChanged: () => void;
}) {
  const [adopted, setAdopted] = useState(load);
  const [view, setView] = useState<TextsView>(load.view);
  const [checking, setChecking] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  // A re-read (the drawer's refetch, the page's refresh) is the truth. Adopted
  // during render — React's pattern for a prop that changed — never by
  // remounting, so focus stays where the action left it.
  if (adopted !== load) {
    setAdopted(load);
    setView(load.view);
    setChecking(true);
  }

  const phone = load.phone ?? "";
  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const show = (next: TextsView) => {
    setView(next);
    setResuming(false);
    queueMicrotask(() => status.current?.focus());
  };
  const undo = (u: TextsUndo): Promise<TextsActionResult> => u.kind === "stop"
    ? undoStopTextsAction(accountId, contactId, u.eventId)
    : undoHoldDecisionAction(accountId, contactId, u.eventId, u.reopenTaskIds);
  const act = (call: () => Promise<TextsActionResult>, success: string, withUndo = true) => {
    if (pending || busy.current) return;
    run(async () => {
      await runTextsAction(call, show, toast, { success, undo: withUndo ? undo : undefined, run, onChanged });
    });
  };

  function pick(country: PhoneCountry) {
    if (pending || busy.current) return;
    run(() => pickPhoneCountry(
      country,
      (c) => setPhoneCountryAction(accountId, contactId, c, phone),
      (picked, previous) => undoPhoneCountryAction(accountId, contactId, picked, previous),
      setChecking,
      toast,
      run,
      onChanged,
    ));
  }

  // A pick answered: the Check number state is gone, and what the number is
  // now is the host's re-read (onChanged). Until then the status line stays,
  // with no word, and takes the focus the pressed button had (review R3-I4).
  const picked = view.kind === "check_number" && !checking;
  useEffect(() => {
    if (picked) status.current?.focus();
  }, [picked]);

  const line = textsLine(view, load.zone);
  const pill = view.kind === "allowed" ? TEXTS_TREATMENT.allowed
    : view.kind === "stopped" ? TEXTS_TREATMENT.stopped
    : view.kind === "held" ? TEXTS_TREATMENT.held
    : PHONE_CHECK_TREATMENT;
  const checkNumber = view.kind === "check_number" && !picked;

  return (
    <Block state={view.kind}>
      {/* ONE wrapper in every ready state — right after the Messages label —
          with the status line as ITS first child, so React keeps the same
          status node (its focus, its tabindex) when the state changes under
          it, INTO Check number as well as out of it (review R3-N2: an Undo of
          a pick, a phone edit to an ambiguous number). PR-1's test id sits on
          the wrapper only in the Check number state, where it wraps the whole
          state, word included (review R3-I2). */}
      <div className="space-y-1.5" data-testid={checkNumber ? "phone-country-row" : undefined}>
        <div ref={status} tabIndex={-1} data-testid="texts-row-status"
          className="flex items-center gap-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>{m["contact.messages.texts"]}</span>
          {picked ? null : <DotPill {...pill} dense data-status={view.kind} />}
        </div>
        {checkNumber ? (
          <>
            <p className="text-muted-foreground text-xs">{m["contact.phoneCountry.line"]}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("MX")}>{m["contact.phoneCountry.mx"]}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => pick("US")}>{m["contact.phoneCountry.us"]}</Button>
            </div>
          </>
        ) : null}
      </div>
      {line ? <p className="text-muted-foreground text-xs">{line}</p> : null}

      {view.kind === "allowed" ? (
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => act(() => stopTextsAction(accountId, contactId, view.newestId), m["contact.texts.stoppedToast"])}>
          {m["contact.texts.stopTexts"]}
        </Button>
      ) : null}

      {view.kind === "stopped" && !view.canResume ? (
        <p className="text-muted-foreground text-xs">{m["contact.texts.customerOnly"]}</p>
      ) : null}
      {view.kind === "stopped" && view.canResume && !resuming ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setResuming(true)}>
          {m["contact.texts.resume"]}
        </Button>
      ) : null}
      {view.kind === "stopped" && view.canResume && resuming ? (
        <form className="space-y-2" data-testid="texts-resume-form" onSubmit={(e) => {
          e.preventDefault();
          act(() => resumeTextsAction(accountId, contactId, view.eventId, note), m["contact.texts.resumedToast"], false);
        }}>
          <Label htmlFor={`texts-resume-${contactId}`}>{m["contact.texts.resumeNoteLabel"]}</Label>
          <Input id={`texts-resume-${contactId}`} name="note" value={note} aria-required="true" autoFocus
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>{m["contact.texts.resumeSubmit"]}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setResuming(false);
              queueMicrotask(() => status.current?.focus());
            }}>{m["contact.texts.resumeCancel"]}</Button>
          </div>
        </form>
      ) : null}

      {view.kind === "held" ? (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => act(() => confirmStopAction(accountId, contactId, view.eventId), m["contact.texts.confirmedToast"])}>
            {m["contact.texts.confirmStop"]}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending}
            onClick={() => act(() => notAStopAction(accountId, contactId, view.eventId), m["contact.texts.releasedToast"])}>
            {m["contact.texts.notAStop"]}
          </Button>
        </div>
      ) : null}

    </Block>
  );
}
```

Delete `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/phone-country-row.tsx` (`git rm`).

Edit `apps/web/src/lib/contacts/phone-country.ts` — the two comments that still name the deleted row (review R3-m7):

Find:
```ts
 * behaviour; phone-country-row.tsx is its shell. Type-only import of the
```
Replace with:
```ts
 * behaviour; the Texts row's Check number state (texts-row.tsx) is its shell. Type-only import of the
```

Find:
```ts
  // Re-review minor 1: the host (PhoneCountryRow) has no other way to learn
```
Replace with:
```ts
  // Re-review minor 1: the host (the Texts row, texts-row.tsx) has no other way to learn
```

Edit `apps/web/e2e/consent-phone-country.spec.ts` (PR-1's e2e as #152 left it at `76c6acfb`; review R3-I3, R3-I4). After Task 12 the Texts row is its OWN read, separate from the drawer's summary, so "the summary has loaded" no longer proves the row has: a count-0 on `phone-country-row` would pass against the row's skeleton. Each count-0 now first waits for the Texts row to carry a `data-state` (the loading block has none).

In the first test, find:
```ts
  await expect(row).toHaveCount(0);
  expect(await stored()).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });
```
Replace with:
```ts
  await expect(row).toHaveCount(0);
  // Review R3-I4: the pressed button is gone; the row's status line keeps the keyboard.
  await expect(page.getByRole("dialog").getByTestId("texts-row-status")).toBeFocused();
  expect(await stored()).toEqual({ phone: "+525512345678", phone_country_unconfirmed: false });
```

In the second test, find:
```ts
  await expect(page.getByRole("dialog").getByText(m["drawer.recent"], { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByTestId("phone-country-row")).toHaveCount(0);
```
Replace with:
```ts
  await expect(page.getByRole("dialog").getByText(m["drawer.recent"], { exact: true })).toBeVisible();
  // The Texts row is its own read (consent chain PR-2): wait for it to have
  // LOADED — a data-state — or the count below passes against its skeleton.
  await expect(page.getByRole("dialog").getByTestId("texts-row")).toHaveAttribute("data-state", /.+/);
  await expect(page.getByRole("dialog").getByTestId("phone-country-row")).toHaveCount(0);
```

In the third test, find:
```ts
  // The test above settled it as US: no row.
  await expect(drawer.getByTestId("phone-country-row")).toHaveCount(0);
```
Replace with:
```ts
  // The test above settled it as US: no row — once the Texts row has loaded
  // (its own read since consent chain PR-2; the skeleton has no data-state).
  await expect(drawer.getByTestId("texts-row")).toHaveAttribute("data-state", /.+/);
  await expect(drawer.getByTestId("phone-country-row")).toHaveCount(0);
```

Edit `…/contacts/contact-drawer.tsx`:

Find:
```ts
import { MarketingOptOutSwitch } from "./marketing-optout-switch";
import { PhoneCountryRow } from "./phone-country-row";
```
Replace with:
```ts
import { MarketingOptOutSwitch } from "./marketing-optout-switch";
import { TextsRow } from "./texts-row";
import { textsLoadFrom, type TextsLoad } from "@/lib/consent/texts-row";
```

Find:
```ts
  const load: LoadResult | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };
```
Replace with:
```ts
  const load: LoadResult | { status: "loading" } =
    contactId && fetched?.contactId === contactId ? fetched.result : { status: "loading" };

  // The Texts row's own read (consent chain PR-2, spec §6: the Messages block
  // has its own skeleton and error). Re-read whenever the summary is — a
  // phone save, a pick, a row action, an Undo all bump retryNonce — with the
  // same stale-closure guard as the summary's fetch above.
  const [texts, setTexts] = useState<{ contactId: string; load: TextsLoad } | null>(null);
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/texts`)
      .then(async (res) => {
        if (stale) return;
        const next = await textsLoadFrom(res);
        if (!stale) setTexts({ contactId, load: next });
      })
      .catch(() => { if (!stale) setTexts({ contactId, load: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const textsLoad: TextsLoad = contactId && texts?.contactId === contactId ? texts.load : { status: "loading" };
```

Find:
```tsx
              {load.status === "loading" ? (
                <div className="space-y-2" data-testid="drawer-skeleton">
```
Replace with:
```tsx
              <TextsRow
                accountId={accountId}
                contactId={row.id}
                load={textsLoad}
                onChanged={() => setRetryNonce((n) => n + 1)}
                onRetry={() => setRetryNonce((n) => n + 1)}
              />

              {load.status === "loading" ? (
                <div className="space-y-2" data-testid="drawer-skeleton">
```

Find (and delete it — the whole block, comment included):
```tsx
                  {/* The Texts row's Check number state (spec §6, F-009), from
                      the summary for the same stub-row reason. Renders
                      nothing for a number that is not ambiguous. */}
                  <PhoneCountryRow
                    // Keyed by the flag too (review R3-I2): a re-read summary
                    // that settles or raises the question remounts the row
                    // from it, never from a stale first render.
                    key={`phone-${row.id}-${load.summary.phone_country_unconfirmed}`}
                    accountId={accountId}
                    contactId={row.id}
                    // The phone as RENDERED (review I3), from the SUMMARY —
                    // never `row.phone`, which is a `?peek=` deep link's
                    // all-null stub (round 3: that stub answered `""`, and
                    // the pick's compare-and-set must fail closed on it,
                    // not merely tolerate it).
                    phone={load.summary.phone ?? ""}
                    unconfirmed={load.summary.phone_country_unconfirmed}
                    onChanged={() => setRetryNonce((n) => n + 1)}
                  />
```
Replace with: nothing.

Edit `…/contacts/[contactId]/contact-fields-panel.tsx`:

Find:
```ts
import { MarketingOptOutSwitch } from "../marketing-optout-switch";
import { PhoneCountryRow } from "../phone-country-row";
```
Replace with:
```ts
import { useRouter } from "next/navigation";
import { MarketingOptOutSwitch } from "../marketing-optout-switch";
import { TextsRow } from "../texts-row";
import type { TextsLoad } from "@/lib/consent/texts-row";
```

Find:
```ts
  zone,
  phoneUnconfirmed,
}: {
```
Replace with:
```ts
  zone,
  texts,
}: {
```

Find:
```ts
  /** F-009: the number could be Mexican or US (the flag, or the stored
   *  number reads both ways). Worked out on the server page, which has the
   *  normaliser; the panel is a client component and must not ship it. */
  phoneUnconfirmed: boolean;
}) {
```
Replace with:
```ts
  /** The Texts row, read on the server page (which has the normaliser and
   *  the ledger read; this client component ships neither). */
  texts: TextsLoad;
}) {
  const router = useRouter();
```

Find:
```tsx
          <PhoneCountryRow
            // Keyed by the flag too (review R3-I2): the page re-renders after
            // a phone edit, and the row must follow the new answer.
            key={`phone-${contactId}-${phoneUnconfirmed}`}
            accountId={accountId}
            contactId={contactId}
            unconfirmed={phoneUnconfirmed}
            phone={contact.phone ?? ""}
          />
```
Replace with:
```tsx
          <TextsRow
            accountId={accountId}
            contactId={contactId}
            load={texts}
            // The composer on this page reads the same ledger: refresh it too.
            onChanged={() => router.refresh()}
            onRetry={() => router.refresh()}
          />
```

Edit `…/contacts/[contactId]/page.tsx`:

Find:
```ts
import { normalisePhone } from "@bis/db/phone";
import { smsRecipientState } from "@/lib/consent/recipient-state";
```
Replace with:
```ts
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { readTextsView } from "@/lib/consent/texts-view";
import type { TextsLoad } from "@/lib/consent/texts-row";
import { loggableError } from "@/lib/loggable-error";
```

Find:
```ts
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);
```
Replace with:
```ts
  const zone = await renderZone((account.data as { timezone: string } | null)?.timezone);

  // The Texts row (consent chain PR-2, spec §6), read under this request's
  // RLS client. An unreadable ledger is the row's error state, never a thrown
  // page and never a guessed "Allowed".
  let texts: TextsLoad;
  try {
    texts = { status: "ready", view: await readTextsView(db, accountId, contact), zone: zone.zone, phone: contact.phone ?? null };
  } catch (e) {
    console.error(`contact page: Texts row unreadable for contact ${contactId}: ${loggableError(e)}`);
    texts = { status: "error" };
  }

  // Review R3-N1 (G21): a To-do whose number is still on hold is closed by
  // deciding the hold, never by "Done", so the timeline shows a hint in its
  // place. A failed read fails CLOSED: every open linked To-do gets the hint
  // — a CANCEL To-do too (review M4), which is why the hint names the To do
  // page, where that To-do keeps its Done.
  let holdOpen: string[];
  try {
    holdOpen = await holdOpenTaskIds(db, accountId, tasks);
  } catch (e) {
    console.error(`contact page: hold To-dos unreadable for contact ${contactId}: ${loggableError(e)}`);
    holdOpen = tasks.filter((t) => !t.completed_at && t.consent_event_id).map((t) => t.id);
  }
```

Find:
```ts
import { getContact, listContactTags, listNotes, listContactTasks,
```
Replace with:
```ts
import { getContact, listContactTags, listNotes, listContactTasks, holdOpenTaskIds,
```

Find:
```tsx
          tasks={tasks}
          opportunities={opps}
```
Replace with:
```tsx
          tasks={tasks}
          holdOpenTaskIds={holdOpen}
          opportunities={opps}
```

Edit `…/contacts/[contactId]/activity-timeline.tsx` (review R3-N1):

Find:
```tsx
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null }
```
Replace with:
```tsx
  | { kind: "task"; id: string; at: string; title: string; dueAt: string | null; completedAt: string | null; holdOpen: boolean }
```

Find:
```tsx
  notes,
  tasks,
  opportunities,
```
Replace with:
```tsx
  notes,
  tasks,
  holdOpenTaskIds,
  opportunities,
```

Find:
```tsx
  notes: Note[];
  tasks: Task[];
```
Replace with:
```tsx
  notes: Note[];
  tasks: Task[];
  /** Open To-dos whose number is still on hold (consent chain PR-2, G21):
   *  decided with Confirm stop / Not a stop, so a hint stands in for Done. */
  holdOpenTaskIds: string[];
```

Find:
```tsx
        completedAt: t.completed_at,
      }),
```
Replace with:
```tsx
        completedAt: t.completed_at,
        holdOpen: holdOpenTaskIds.includes(t.id),
      }),
```

Find:
```tsx
        {!done ? (
          <form action={completeAction} className="shrink-0">
```
Replace with:
```tsx
        {!done && item.holdOpen ? (
          <p className="shrink-0 text-xs text-muted-foreground" data-testid="task-decide-first">
            {m["todo.consent.timelineHint"]}
          </p>
        ) : !done ? (
          <form action={completeAction} className="shrink-0">
```

Create `…/contacts/[contactId]/activity-timeline.hold.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

// "use server" actions and the client composer are not rendered here; only the task rows are read.
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));

const { ActivityTimeline } = await import("./activity-timeline");

const task = (id: string, title: string, consent_event_id: string | null) =>
  ({ id, title, due_at: null, completed_at: null, created_at: "2026-10-05T10:00:00Z", consent_event_id });
const html = (holdOpenTaskIds: string[]) => renderToStaticMarkup(createElement(ActivityTimeline, {
  accountId: "a1", contactId: "c1", contactHasEmail: false, contactHasPhone: false,
  smsGate: { ok: false, reason: "a2p_not_approved" }, smsBlockedLine: null,
  notes: [], tasks: [task("t_hold", "Ana may have asked to stop texts", "h1"), task("t_plain", "Call back", null)],
  holdOpenTaskIds, opportunities: [], submissions: [], messages: [],
  emailAction: async () => {}, smsAction: async () => {},
} as never));
const doneButtons = (markup: string) => (markup.match(new RegExp(`>${m["contact.done"]}<`, "g")) ?? []).length;

describe("the contact timeline and a hold's To-do (review R3-N1, G21)", () => {
  it("a To-do whose number is still on hold shows the decide-first hint INSTEAD of Done; a plain To-do keeps its Done (mutation: render Done for every open task → two Done buttons, FAILS)", () => {
    const out = html(["t_hold"]);
    expect(renderedText(out)).toContain(m["todo.consent.timelineHint"]);
    expect(doneButtons(out)).toBe(1);
  });

  it("once the hold is decided the same To-do offers Done again (the discriminator; mutation: hint for every linked task → FAILS)", () => {
    const out = html([]);
    expect(renderedText(out)).not.toContain(m["todo.consent.timelineHint"]);
    expect(doneButtons(out)).toBe(2);
  });
});
```

Find:
```tsx
          phoneUnconfirmed={contact.phone_country_unconfirmed === true || normalisePhone(contact.phone)?.unconfirmed === true}
```
Replace with:
```tsx
          texts={texts}
```

Edit `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`:

Find:
```ts
import { PHONE_CHECK_TREATMENT } from "@/lib/contacts/phone-country";
```
Replace with:
```ts
import { PHONE_CHECK_TREATMENT } from "@/lib/contacts/phone-country";
import { TEXTS_TREATMENT } from "@/lib/consent/texts-row";
```

Find:
```tsx
          {/* The contact Messages block's Texts row (consent chain PR-1):
              its one state so far, Check number, a warning because the
              operator must pick the country before anything is texted.
              Read off lib/contacts/phone-country.ts, so it cannot drift. */}
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            …/contacts/phone-country-row.tsx · lib/contacts/phone-country.ts
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="styleguide-texts-state">
            <span className="text-sm">{m["contact.messages.texts"]}</span>
            <DotPill {...PHONE_CHECK_TREATMENT} dense data-status="unconfirmed_number" />
            <span className="text-xs text-muted-foreground">{m["contact.phoneCountry.line"]}</span>
          </div>
```
Replace with:
```tsx
          {/* The contact Messages block's Texts row (consent chain PR-1 and
              PR-2): its four states, each a dot + word. Allowed, Stopped and
              On hold are read off lib/consent/texts-row.ts; Check number off
              lib/contacts/phone-country.ts, so none can drift. */}
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            …/contacts/texts-row.tsx · lib/consent/texts-row.ts · lib/contacts/phone-country.ts
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="styleguide-texts-state">
            <span className="text-sm">{m["contact.messages.texts"]}</span>
            <DotPill {...TEXTS_TREATMENT.allowed} dense data-status="allowed" />
            <DotPill {...TEXTS_TREATMENT.stopped} dense data-status="stopped" />
            <DotPill {...TEXTS_TREATMENT.held} dense data-status="held" />
            <DotPill {...PHONE_CHECK_TREATMENT} dense data-status="unconfirmed_number" />
          </div>
```

(No e2e reads `styleguide-texts-state`: `grep -rn styleguide-texts-state apps/web/e2e` found none on 66b38d57.)

- [ ] **Step 4: Run them to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/texts-row.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts" \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" src/lib/contacts \
  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.hold.test.ts"
pnpm exec tsc --noEmit
pnpm exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/consent src/lib/ui
grep -rn "phone-country-row\|PhoneCountryRow" src e2e
```

Expected (predicted; not replayed): all pass; `tsc` exit 0; eslint 0 errors (if `react-hooks` flags the adopt-during-render block, the fix is the React docs' own pattern already used; do NOT move it into an effect, which would remount-or-flash); the grep finds only the test id itself — `data-testid="phone-country-row"` in `texts-row.tsx`, its unit test, and the e2e specs that read it — and nothing names the deleted file or `PhoneCountryRow` any more (review R3-m7). Then the full web suite.

**UI definition of done** (DESIGN.md), checked by bis-design-reviewer on a running build in Task 16 step 1 (D7 permitting) or by danlo: tokens only (the treatments and every class above are token classes); dark and light through `.dark`; the blur fallback (the row adds no blur); loaded / error states (above; there is no empty state: every contact with a number has a state); keyboard (the status is a focus target; Esc still closes the drawer; the Resume form's Cancel is a real button); copy (the lines above); `/styleguide` (above).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `textsLine`: `formatDateInZone(view.since, "UTC")` | "stopped reads 'Since {date} · {how}' …" |
| 2 | `textsLine`: no try/catch around the date | "an unreadable date keeps the how …" |
| 3 | `howLine`: free_text ignores `by` | "each how in plain words …" |
| 4 | `textsLine`: held without the `compose.smsHeld` fallback | "a hold quotes what they wrote …" |
| 5 | `TEXTS_TREATMENT.stopped.dot` → `bg-success` | "status is a dot and a word …" |
| 6 | `parseTextsResponse`: return `j as …` | "a good body is ready; … a malformed body is the error state" |
| 7 | `runTextsAction`: no `action` on the success toast | "shows the new state, calls onChanged, and offers Undo …" |
| 8 | `attempt`: no `show(r.view)` on refusal | "a refusal says why AND shows where things stand now" |
| 9 | `attempt`: no try/catch | "a rejected action … is the 'crashed' line" |
| 10 | `runTextsAction`: drop the `undoBusy` line | "a success with nothing to undo … a refused Undo says so" |
| 11 | texts-row.tsx: one skeleton | "loading is a two-row skeleton" |
| 12 | texts-row.tsx: Stop texts `variant` default | "Allowed: dot + word, and one GHOST 'Stop texts'" |
| 13 | texts-row.tsx: render Resume for every stop | "Stopped by the customer: … NO Resume" |
| 14 | texts-row.tsx: drop `tabIndex={-1}` | "the status is a focus target …" |
| 15 | texts-row.tsx: drop `data-testid="phone-country-row"` | "Check number keeps PR-1's own test id on the WHOLE state …" and the PR-1 e2e |
| 15b | texts-row.tsx: move the test id onto the line-and-buttons div only (the status outside it) | "Check number keeps PR-1's own test id on the WHOLE state …" (the word check) |
| 15b2 | texts-row.tsx: give Check number a wrapper of its own and render the status line bare in the other states (the shape before review R3-N2) | "the status line is the first child of ONE wrapper in every ready state …" |
| 15e | activity-timeline.tsx: render Done for every open task (drop the `item.holdOpen` branch) | activity-timeline.hold.test "a To-do whose number is still on hold shows the decide-first hint INSTEAD of Done …" |
| 15f | page.tsx: `holdOpen = []` in the catch | page.test "the timeline is told which open To-dos are a hold still undecided …" |
| 15c | texts-row.tsx: after a pick render `<Block state="check_number">{null}</Block>` again (no status line) | e2e `consent-phone-country.spec.ts` test 1's `toBeFocused()` (review R3-I4; e2e only: a static render cannot press a button) |
| 15d | consent-phone-country.spec.ts: delete the two `data-state` waits, and make the drawer's texts fetch slow (a 2 s `await` in the texts route) | the two count-0 assertions still PASS without the waits — the reason the waits exist; with them the tests wait for the loaded row (run once to see the difference, then revert) |
| 16 | drawer: texts effect deps without `retryNonce` | wiring "the drawer reads the Texts row on its own, again on every summary re-read" |
| 17 | page: let `readTextsView` throw | page.test "an unreadable ledger gives the row its error state …" |

- [ ] **Step 6: Commit**

```bash
git rm "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/phone-country-row.tsx"
git add apps/web/src/lib/consent/texts-row.ts apps/web/src/lib/consent/texts-row.test.ts apps/web/src/lib/ui/guarded-run.ts \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/texts-row.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.hold.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" \n  apps/web/src/lib/contacts/phone-country.ts apps/web/e2e/consent-phone-country.spec.ts
git commit -m "feat(consent): the Texts row — Allowed, Stopped, On hold, Check number — with Stop, Resume, Confirm stop and Not a stop, focus kept in the row (R3-M9)"
```

---

### Task 13: The consent To-do rows, and "Send it now" closed on render (R3-M8)

**Owner:** bis-crm (To-do) with bis-voice (the call page). **Tier:** MEDIUM. **Questions:** none.

**Files:**
- Modify: `packages/db/src/activities.ts`, `packages/db/src/index.ts`, `packages/db/src/consent-tasks.test.ts` (one read)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts`, `…/tasks/actions.test.ts`, `…/tasks/work-list.tsx`
- Create: `…/tasks/consent-hold-actions.tsx`, `…/tasks/work-list.consent.test.ts`
- Modify: `…/calls/[callId]/page.tsx`, `…/calls/[callId]/page.test.ts`
- Modify: `…/contacts/[contactId]/actions.ts` (the timeline's "complete" meets the same rule); Create: `…/contacts/[contactId]/actions.test.ts`

**Interfaces:**
- Consumes: Task 2 (`WorkRow.consent`, `completeTasksForConsentEvents`, `HoldUndecidedError`), Task 1 (`readConsentEvent`, `readConsentHistory`, `newestDecidingRow`), Task 11 (`textsContextFor`, `confirmStop`, `notAStop`, `undoHoldDecision`, `TextsActionResult`), Task 12 (`runTextsAction`), PR-1 (`smsRecipientState`, `composerStateLine`).
- Produces: `readTaskContact(db, accountId, taskId): Promise<{ contactId: string | null; consentEventId: string | null } | null>` (`@bis/db`); (`HoldUndecidedError`, which `completeTask` throws for a To-do whose number is still on hold, is Task 2's); `confirmStopFromTask(accountId, taskId)`, `notAStopFromTask(accountId, taskId)`, `undoHoldDecisionFromTask(accountId, contactId, eventId, reopenTaskIds)` (server actions, `Promise<TextsActionResult>`); `<ConsentHoldActions />`.

**The rule (plan G8, spec §6):** a To-do linked to a HOLD shows the hold line (its `tasks.title`) with ghost "Confirm stop" and "Not a stop" in place of "Done"; either decides the contact's CURRENT hold (a To-do made for an earlier hold of the same number still resolves the one on the number now) and completes the hold's To-dos, with Undo. A To-do linked to a CANCEL stop keeps "Done": staff check the appointment, then close it.

**A hold's To-do is never closed without deciding the hold, and never left open once it is decided** (review R3-I1, with the deferred agency Work-queue item):
- **Done cannot close it, and no screen offers a Done that would be refused.** `completeTask` itself refuses a To-do whose linked NUMBER is still on hold — its newest deciding row a hold, the To-do's own or a later one (Task 2's `HoldUndecidedError`; review R3-N3) — so every path meets the rule. The per-account list shows the two buttons instead of Done (a stale tab's Done is refused with "decide first"). The contact page's timeline shows a one-line hint in place of Done for such a To-do, "Close this one from the To do page." (`todo.consent.timelineHint`; Task 12; reviews R3-N1, M3), and `completeTaskAction` still refuses a stale page's Done without an error page. The decision itself is made with the To-do page's two buttons, or the Texts row's while the contact's current number is the one on hold; after a phone correction it is not, and the To-do page's buttons then close the To-do, because the contact's number is no longer on hold (below). The agency Work queue has no action buttons at all — its rows are read-only links into the account (`work/agency-work-list.tsx:22-27` on `76c6acfb`) — so the deferred item that assumed a "Done" there was wrong, and nothing changes on that screen.
- **It closes itself** when the hold is decided anywhere: Confirm stop / Not a stop (Task 11 completes the hold's To-dos); a STOP or START landing on the held number (Task 8's `closeHoldTodo`); and, as the last net, a click on either button once the contact's number is no longer on hold (a decision in another tab, a new number) closes the To-do and says it was already decided.

- [ ] **Step 1: Write the failing tests**

Edit `packages/db/src/consent-tasks.test.ts`. Add `readTaskContact` to its `./activities` import, then append:

```ts
describe("readTaskContact — the To-do's contact and the ledger row it asks about", () => {
  it("reads the task by account AND id (mutation: drop the account filter → FAILS)", async () => {
    const f = fakeDb([{ data: { contact_id: "c1", consent_event_id: "h1" }, error: null }]);
    expect(await readTaskContact(f.db, "a1", "t1")).toEqual({ contactId: "c1", consentEventId: "h1" });
    expect(f.calls).toEqual(expect.arrayContaining([["eq", "account_id", "a1"], ["eq", "id", "t1"]]));
    expect(await readTaskContact(fakeDb([{ data: null, error: null }]).db, "a1", "t1")).toBeNull();
  });
});
```

Edit `…/tasks/actions.test.ts` — add, beside its other `vi.mock(...)` calls:

```ts
const texts = vi.hoisted(() => ({ textsContextFor: vi.fn(), confirmStop: vi.fn(), notAStop: vi.fn(), undoHoldDecision: vi.fn() }));
vi.mock("@/lib/consent/texts-context", () => ({ textsContextFor: texts.textsContextFor }));
vi.mock("@/lib/consent/staff-actions", () => ({ confirmStop: texts.confirmStop, notAStop: texts.notAStop, undoHoldDecision: texts.undoHoldDecision }));
```

and ensure the file's `@bis/db` mock factory also defines `readTaskContact`, `readConsentHistory` and `completeTasksForConsentEvents` (add `readTaskContact: vi.fn(async () => ({ contactId: "c1", consentEventId: "h1" }))`, `readConsentHistory: vi.fn(async () => [])` and `completeTasksForConsentEvents: vi.fn(async () => ["t1"])` to it; the factory already spreads `importOriginal`, so `HoldUndecidedError` is the real class). Then append:

```ts
describe("the consent To-do's buttons (consent chain PR-2)", () => {
  const CTX = { db: {}, writer: {}, accountId: "acct_1", contactId: "c1", userId: "user_1", actorName: null, address: "+19562921696", unconfirmed: false, now: new Date("2026-10-06T20:00:00Z") };
  beforeEach(() => {
    for (const fn of Object.values(texts)) fn.mockReset();
    texts.textsContextFor.mockResolvedValue(CTX);
    texts.confirmStop.mockResolvedValue({ ok: true, view: { kind: "stopped" } });
    texts.notAStop.mockResolvedValue({ ok: true, view: { kind: "allowed", newestId: "r1" } });
  });

  it("Confirm stop decides the contact's CURRENT hold, whatever hold the To-do was made for (mutation: pass the task's own link → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "h2", action: "held", method: "staff_undo", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
      { id: "h1", action: "held", method: "free_text", occurred_at: "2026-10-04T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ] as never);
    expect((await confirmStopFromTask("acct_1", "t1")).ok).toBe(true);
    expect(texts.confirmStop).toHaveBeenCalledWith(CTX, "h2");
  });

  it("a To-do whose number is no longer on hold says it was already decided, and decides nothing (mutation: decide anyway → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "r1", action: "hold_released", method: "staff", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: "u" },
    ] as never);
    expect(await notAStopFromTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decided"] });
    expect(texts.notAStop).not.toHaveBeenCalled();
  });

  it("…and that To-do closes itself, through its own ledger link, so it never sits open with two dead buttons (review R3-I1; mutation: return 'decided' without closing → FAILS)", async () => {
    vi.mocked(readConsentHistory).mockResolvedValue([
      { id: "r1", action: "resubscribed", method: "start_keyword", occurred_at: "2026-10-05T10:00:00Z", evidence: {}, note: null, actor_id: null },
    ] as never);
    await confirmStopFromTask("acct_1", "t1");
    expect(vi.mocked(completeTasksForConsentEvents)).toHaveBeenCalledWith(CTX.db, "acct_1", ["h1"], "user_1");
  });

  it("a Done on a hold's To-do while the hold is undecided (a stale tab) is refused with the decide-first line (review R3-I1; mutation: fall through to the generic failure → FAILS)", async () => {
    vi.mocked(completeTask).mockRejectedValueOnce(new HoldUndecidedError());
    expect(await completeWorkTask("acct_1", "t1")).toEqual({ ok: false, error: m["todo.consent.decideFirst"] });
  });
});
```

(`readConsentHistory`, `completeTask`, `completeTasksForConsentEvents` and `HoldUndecidedError` are imported from `@bis/db` at the top of the test file for `vi.mocked`; `m` from `@/lib/messages`; `confirmStopFromTask`, `notAStopFromTask`, `completeWorkTask` from `./actions`.)

Create `…/contacts/[contactId]/actions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({})) }));
const completeTask = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), completeTask }));

import { HoldUndecidedError } from "@bis/db";
import { revalidatePath } from "next/cache";
import { completeTaskAction } from "./actions";

const form = (taskId: string) => { const f = new FormData(); f.set("contactId", "c1"); f.set("taskId", taskId); return f; };

describe("completeTaskAction — the timeline's 'complete' (review R3-I1)", () => {
  it("a stale page's Done on a hold's undecided To-do is refused without an error page: the page re-renders, and the timeline then shows the decide-first hint in its place (mutation: let HoldUndecidedError propagate → rejects, FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new HoldUndecidedError());
    await expect(completeTaskAction("a1", form("t1"))).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("any other failure still throws, as before (mutation: swallow every error → FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new Error("update failed"));
    await expect(completeTaskAction("a1", form("t2"))).rejects.toThrow("update failed");
  });
});
```

(`readConsentHistory` is imported from `@bis/db` at the top of the test file for `vi.mocked`; `m` from `@/lib/messages`; `confirmStopFromTask`, `notAStopFromTask` from `./actions`.)

Create `…/tasks/work-list.consent.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const task = (consent: WorkRow["consent"]): WorkRow => ({
  id: "task:t1", source: "task", accountId: "a1", contactId: "c1",
  title: "Ana may have asked to stop texts: “remove me”. Texts to them are on hold.",
  dueAt: null, occurredAt: "2026-10-05T10:00:00Z", consent,
});
const render = (row: WorkRow) => renderToStaticMarkup(createElement(WorkList, {
  buckets: { overdue: [], today: [row], waiting: [] }, accountId: "a1", contactNames: { c1: "Ana" }, timezone: "America/Chicago",
}));

describe("the consent To-do row (spec §6)", () => {
  it("a hold's To-do offers Confirm stop and Not a stop, both ghost, and no Done (mutation: render WorkRowActions for it → FAILS)", () => {
    const out = render(task({ eventId: "h1", action: "held" }));
    expect(out).toContain(`>${m["contact.texts.confirmStop"]}<`);
    expect(out).toContain(`>${m["contact.texts.notAStop"]}<`);
    expect(out).not.toContain(`>${m["work.done"]}<`);
    expect(out.match(/data-variant="ghost"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("a CANCEL stop's To-do keeps Done (mutation: give it the hold buttons → FAILS)", () => {
    const out = render(task({ eventId: "r1", action: "revoked" }));
    expect(out).toContain(`>${m["work.done"]}<`);
    expect(out).not.toContain(`>${m["contact.texts.confirmStop"]}<`);
  });
});
```

(If `WorkList`'s `buckets` type has more keys than `overdue`, `today`, `waiting`, read them off `lib/work/buckets.ts`'s `BucketedWork` and pass empty arrays for the rest.)

Edit `…/calls/[callId]/page.test.ts`:

Find:
```ts
vi.mock("@bis/db", () => ({
  getCall: (...args: unknown[]) => getCallMock(...args),
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
  listProposalsForCall: (...args: unknown[]) => listProposalsForCallMock(...args),
}));
```
Replace with:
```ts
const getContactMock = vi.fn();
vi.mock("@bis/db", () => ({
  getCall: (...args: unknown[]) => getCallMock(...args),
  listFailedOutboundSms: (...args: unknown[]) => listFailedOutboundSmsMock(...args),
  listProposalsForCall: (...args: unknown[]) => listProposalsForCallMock(...args),
  getContact: (...args: unknown[]) => getContactMock(...args),
}));
// Review R3-M8: the resend reads the same recipient state as the composer.
const recipientStateMock = vi.fn();
vi.mock("@/lib/consent/recipient-state", () => ({ smsRecipientState: (...a: unknown[]) => recipientStateMock(...a) }));
```

Append at the end of the file:

```ts
describe("\"Send it now\" is closed on render when the number cannot be texted (review R3-M8)", () => {
  it("a stopped number shows the composer's own stopped line in place of the button (mutation: render the button regardless → FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockResolvedValue({ kind: "stopped", since: "2026-08-25T21:00:00Z" });
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).not.toContain("Send it now");
    expect(renderedText(html)).toContain(m["compose.smsStopped"].replace("{date}", "Aug 25, 2026"));
  });

  it("an ok number keeps the button (the discriminator; mutation: always close it → FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false });
    recipientStateMock.mockResolvedValue({ kind: "ok" });
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).toContain("Send it now");
  });

  it("a contact read that fails closes it with the unreadable line, never an open button (fails closed; mutation: show the button on error → FAILS)", async () => {
    getContactMock.mockRejectedValue(new Error("getContact failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render({ ...CALL, outcome: "abandoned", booking_id: null }, [FAILED_TEXTBACK]);
    expect(html).not.toContain("Send it now");
    expect(renderedText(html)).toContain(m["compose.smsStateUnknown"]);
  });
});
```

(Each copy assertion reads the WHOLE line through `renderedText`, which decodes the `&#x27;` React writes for an apostrophe — a `.split("'")[0]` would keep only "Couldn" of the unreadable line, which half the page could match (review R3-m2; memory `bis-vacuous-test-shapes`, "the assertion the renderer escapes out from under"). The file already imports `m` and `renderedText` (`page.test.ts:3-4` on `76c6acfb`).)

- [ ] **Step 2: Run them to see them fail**

```bash
cd packages/db && pnpm exec vitest run src/consent-tasks.test.ts
cd ../../apps/web
pnpm exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" "src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.test.ts" \n  "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.test.ts"
```

Expected (predicted; not replayed): the new cases fail (no `readTaskContact`, no From-task actions, no hold buttons, the button always renders).

- [ ] **Step 3: Implement**

Edit `packages/db/src/activities.ts` — append:

```ts
/**
 * A task's contact and the ledger row it asks about, by account AND id (the
 * consent To-do's buttons act on that contact's number, and close the To-do
 * through its own link).
 */
export async function readTaskContact(
  db: SupabaseClient, accountId: string, taskId: string,
): Promise<{ contactId: string | null; consentEventId: string | null } | null> {
  const { data, error } = await db.from("tasks")
    .select("contact_id, consent_event_id").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (error) throw new Error(`readTaskContact failed: ${error.message}`);
  const row = data as { contact_id: string | null; consent_event_id: string | null } | null;
  return row ? { contactId: row.contact_id, consentEventId: row.consent_event_id } : null;
}
```

Edit `packages/db/src/index.ts` — in the `./activities` export line Task 2 wrote, add `readTaskContact` (`HoldUndecidedError` is Task 2's).

Edit `…/tasks/actions.ts`:

Find:
```ts
import { revalidatePath } from "next/cache";
import { addTask, completeTask, reopenTask, type WorkSource } from "@bis/db";
```
Replace with:
```ts
import { revalidatePath } from "next/cache";
import {
  addTask, completeTask, reopenTask, readTaskContact, readConsentHistory, newestDecidingRow,
  completeTasksForConsentEvents, HoldUndecidedError, type WorkSource,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { textsContextFor } from "@/lib/consent/texts-context";
import { confirmStop, notAStop, undoHoldDecision, type TextsActionResult } from "@/lib/consent/staff-actions";
```

Find (in `completeWorkTask`):
```ts
  } catch (e) {
    console.error(`completeWorkTask: failed for task ${taskId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["work.actionFailed"] };
```
Replace with:
```ts
  } catch (e) {
    // Review R3-I1: a hold's To-do closes by deciding the hold (a stale tab
    // can still show its old Done).
    if (e instanceof HoldUndecidedError) return { ok: false, error: m["todo.consent.decideFirst"] };
    console.error(`completeWorkTask: failed for task ${taskId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["work.actionFailed"] };
```

Edit `…/contacts/[contactId]/actions.ts` — the timeline's "complete" meets the same rule:

Find:
```ts
import { updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields } from "@bis/db";
```
Replace with:
```ts
import { updateContact, addTagToContact, removeTagFromContact,
         addNote, addTask, completeTask, listCustomFields, HoldUndecidedError } from "@bis/db";
```

Find:
```ts
  await completeTask(await dbForRequest(), accountId, String(formData.get("taskId")), userId);
  revalidatePath(path);
}
```
Replace with:
```ts
  try {
    await completeTask(await dbForRequest(), accountId, String(formData.get("taskId")), userId);
  } catch (e) {
    // Review R3-I1, R3-N1: a hold's To-do is closed by deciding the hold,
    // and the timeline shows a hint instead of Done for one (Task 12), so
    // this is a stale page. Re-render (the hint appears) rather than show an
    // error page. The decision is on the To-do page, and in the Texts row
    // while the contact's current number is the one on hold.
    if (!(e instanceof HoldUndecidedError)) throw e;
  }
  revalidatePath(path);
}
```

Append at the end of `…/tasks/actions.ts`:

```ts
/**
 * The consent To-do's two buttons (spec §6): decide the contact's CURRENT
 * hold, whatever hold the To-do was made for, through the same guarded write
 * as the drawer (lib/consent/staff-actions.ts), which also completes the
 * hold's To-dos. A number no longer on hold says so, decides nothing, and
 * closes the To-do through its own ledger link (review R3-I1): it has
 * nothing left to ask.
 */
async function decideFromTask(
  accountId: string, taskId: string, decide: typeof confirmStop,
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    const task = await readTaskContact(await dbForRequest(), accountId, taskId);
    if (!task?.contactId) return { ok: false, error: m["todo.consent.decided"] };
    const ctx = await textsContextFor(accountId, task.contactId, userId);
    if ("ok" in ctx) return ctx;
    const newest = newestDecidingRow(await readConsentHistory(ctx.db, accountId, "sms", ctx.address));
    if (!newest || newest.action !== "held") {
      if (task.consentEventId) {
        try {
          await completeTasksForConsentEvents(ctx.db, accountId, [task.consentEventId], userId);
          revalidatePath(tasksPath(accountId));
        } catch (e) {
          console.error(`decideFromTask: stale hold To-do ${taskId} (account ${accountId}) not closed: ${loggableError(e)}`);
        }
      }
      return { ok: false, error: m["todo.consent.decided"] };
    }
    const result = await decide(ctx, newest.id);
    if (result.ok) revalidatePath(tasksPath(accountId));
    return result;
  } catch (e) {
    console.error(`decideFromTask: task ${taskId} (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, error: m["todo.consent.failed"] };
  }
}

export async function confirmStopFromTask(accountId: string, taskId: string): Promise<TextsActionResult> {
  return decideFromTask(accountId, taskId, confirmStop);
}

export async function notAStopFromTask(accountId: string, taskId: string): Promise<TextsActionResult> {
  return decideFromTask(accountId, taskId, notAStop);
}

export async function undoHoldDecisionFromTask(
  accountId: string, contactId: string, eventId: string, reopenTaskIds: string[],
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await textsContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await undoHoldDecision(ctx, eventId, reopenTaskIds);
  if (result.ok) revalidatePath(tasksPath(accountId));
  return result;
}
```

Create `…/tasks/consent-hold-actions.tsx`:

```tsx
"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/ui/guarded-run";
import { runTextsAction } from "@/lib/consent/texts-row";
import type { TextsActionResult } from "@/lib/consent/staff-actions";

/**
 * A hold To-do's two buttons (spec §6): "Confirm stop" and "Not a stop",
 * ghost, each at once with an Undo toast (rule 6). Props are the To-do
 * screen's server actions, bound to the account by work-list.tsx (this
 * folder's own precedent for a client list under a server page).
 */
export function ConsentHoldActions({ taskId, contactId, confirm, release, undo }: {
  taskId: string;
  contactId: string | null;
  confirm: (taskId: string) => Promise<TextsActionResult>;
  release: (taskId: string) => Promise<TextsActionResult>;
  undo: (contactId: string, eventId: string, reopenTaskIds: string[]) => Promise<TextsActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const act = (call: () => Promise<TextsActionResult>, success: string) => {
    if (pending || busy.current || !contactId) return;
    run(async () => {
      await runTextsAction(call, () => router.refresh(), toast, {
        success, run, onChanged: () => router.refresh(),
        undo: (u) => u.kind === "decision" ? undo(contactId, u.eventId, u.reopenTaskIds) : Promise.resolve({ ok: false, error: m["todo.consent.failed"] }),
      });
    });
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" disabled={pending || !contactId} onClick={() => act(() => confirm(taskId), m["contact.texts.confirmedToast"])}>
        {m["contact.texts.confirmStop"]}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending || !contactId} onClick={() => act(() => release(taskId), m["contact.texts.releasedToast"])}>
        {m["contact.texts.notAStop"]}
      </Button>
    </div>
  );
}
```

Edit `…/tasks/work-list.tsx`:

Find:
```ts
import {
  completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking,
  type ActionResult, type DismissResult,
} from "./actions";
import { WorkRowActions } from "./work-row-actions";
```
Replace with:
```ts
import {
  completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking,
  confirmStopFromTask, notAStopFromTask, undoHoldDecisionFromTask,
  type ActionResult, type DismissResult,
} from "./actions";
import { WorkRowActions } from "./work-row-actions";
import { ConsentHoldActions } from "./consent-hold-actions";
import type { TextsActionResult } from "@/lib/consent/staff-actions";
```

Find:
```ts
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
};
```
Replace with:
```ts
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
  confirmStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  notAStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  undoHoldDecisionFromTask: (contactId: string, eventId: string, reopenTaskIds: string[]) => Promise<TextsActionResult>;
};
```

Find:
```ts
      <div className="shrink-0 pr-4">
        <WorkRowActions
          source={row.source}
          rawId={rawRowId(row)}
          contactId={row.contactId}
          label={primary}
          completeWorkTask={actions.completeWorkTask}
          reopenWorkTask={actions.reopenWorkTask}
          dismissToTask={actions.dismissToTask}
          closeOutBooking={actions.closeOutBooking}
        />
      </div>
```
Replace with:
```tsx
      <div className="shrink-0 pr-4">
        {/* A hold's To-do is decided, not ticked off (spec §6): its two
            buttons replace Done. A CANCEL To-do keeps Done. */}
        {row.consent?.action === "held" ? (
          <ConsentHoldActions
            taskId={rawRowId(row)}
            contactId={row.contactId}
            confirm={actions.confirmStopFromTask}
            release={actions.notAStopFromTask}
            undo={actions.undoHoldDecisionFromTask}
          />
        ) : (
          <WorkRowActions
            source={row.source}
            rawId={rawRowId(row)}
            contactId={row.contactId}
            label={primary}
            completeWorkTask={actions.completeWorkTask}
            reopenWorkTask={actions.reopenWorkTask}
            dismissToTask={actions.dismissToTask}
            closeOutBooking={actions.closeOutBooking}
          />
        )}
      </div>
```

Find:
```ts
    closeOutBooking: closeOutBooking.bind(null, accountId),
  };
```
Replace with:
```ts
    closeOutBooking: closeOutBooking.bind(null, accountId),
    confirmStopFromTask: confirmStopFromTask.bind(null, accountId),
    notAStopFromTask: notAStopFromTask.bind(null, accountId),
    undoHoldDecisionFromTask: undoHoldDecisionFromTask.bind(null, accountId),
  };
```

Edit `…/calls/[callId]/page.tsx`:

Find:
```ts
import {
  getCall, listFailedOutboundSms, listProposalsForCall,
  type FailedOutboundSms, type CallProposal,
} from "@bis/db";
```
Replace with:
```ts
import {
  getCall, listFailedOutboundSms, listProposalsForCall, getContact,
  type FailedOutboundSms, type CallProposal,
} from "@bis/db";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { composerStateLine } from "@/lib/consent/composer-state";
```

Find:
```ts
  const window = textbackWindow(call);
  let textbackFailure: FailedOutboundSms | undefined;
  if (window) {
    try {
      [textbackFailure] = await listFailedOutboundSms(db, accountId, [window]);
    } catch (e) {
      console.error(
        `call detail ${callId}: failed-text-back read failed, rendering no badge: ${String(e)}`,
      );
    }
  }
```
Replace with:
```ts
  const window = textbackWindow(call);
  let textbackFailure: FailedOutboundSms | undefined;
  if (window) {
    try {
      [textbackFailure] = await listFailedOutboundSms(db, accountId, [window]);
    } catch (e) {
      console.error(
        `call detail ${callId}: failed-text-back read failed, rendering no badge: ${String(e)}`,
      );
    }
  }

  // Review R3-M8: "Send it now" is closed ON RENDER when this contact cannot
  // be texted — stopped, on hold, a number whose country is unknown, or a
  // state that cannot be read — in the composer's own words (the same two
  // reads, recipient-state.ts and composer-state.ts), so the call page and
  // the contact page can never disagree. Fails closed like the composer.
  let resendClosedLine: string | null = null;
  if (textbackFailure && !textbackFailure.supersededAt && call.contact_id) {
    try {
      const contact = await getContact(db, accountId, call.contact_id);
      resendClosedLine = contact ? composerStateLine(await smsRecipientState(db, accountId, contact), timezone) : null;
    } catch (e) {
      console.error(`call detail ${callId}: recipient read failed, closing the resend: ${String(e)}`);
      resendClosedLine = m["compose.smsStateUnknown"];
    }
  }
```

Find:
```tsx
                ) : call.contact_id ? (
                  <TextbackResend
```
Replace with:
```tsx
                ) : resendClosedLine ? (
                  <p className="text-sm leading-6 text-muted-foreground">{resendClosedLine}</p>
                ) : call.contact_id ? (
                  <TextbackResend
```

- [ ] **Step 4: Run them to see them pass**

```bash
cd packages/db && pnpm exec vitest run src/consent-tasks.test.ts && pnpm exec tsc --noEmit
cd ../../apps/web
pnpm exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" "src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.test.ts" \
  "src/app/(dashboard)/dashboard/work" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.test.ts"
pnpm exec tsc --noEmit
```

Expected (predicted; not replayed): all pass, including the existing call-page resend cases (their `recipientStateMock` defaults to `undefined` → `composerStateLine` would throw on `undefined.kind`: set `recipientStateMock.mockResolvedValue({ kind: "ok" })` and `getContactMock.mockResolvedValue({ id: "ct1", phone: "+19565061545", phone_country_unconfirmed: false })` in that file's `beforeEach`, or the existing "Send it now" cases go red for the wrong reason). Then the full web suite.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `readTaskContact`: drop `.eq("account_id", accountId)` | "reads the task by account AND id" |
| 2 | `decideFromTask`: `decide(ctx, task.consentEventId!)` (the task's own linked event) instead of `newest.id` | "Confirm stop decides the contact's CURRENT hold …" (expressible now that `readTaskContact` returns the link, review R3-m6) |
| 3 | `decideFromTask`: drop `newest.action !== "held"` | "a To-do whose number is no longer on hold says it was already decided …" |
| 3b | `decideFromTask`: return "decided" without `completeTasksForConsentEvents` | "…and that To-do closes itself, through its own ledger link …" |
| 3e | tasks/actions.ts: `completeWorkTask` without the `HoldUndecidedError` branch | "a Done on a hold's To-do while the hold is undecided … decide-first line" |
| 3f | contacts/[contactId]/actions.ts: `completeTaskAction` without its catch | "a hold's undecided To-do is refused without an error page …" |
| 4 | work-list: render `WorkRowActions` for every row | "a hold's To-do offers Confirm stop and Not a stop … and no Done" |
| 5 | work-list: `row.consent ? <ConsentHoldActions …>` (any consent) | "a CANCEL stop's To-do keeps Done" |
| 6 | call page: skip the `resendClosedLine` branch | "a stopped number shows the composer's own stopped line in place of the button" |
| 7 | call page: `resendClosedLine = null` in the catch | "a contact read that fails closes it with the unreadable line …" |

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/activities.ts packages/db/src/index.ts packages/db/src/consent-tasks.test.ts \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/consent-hold-actions.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.consent.test.ts" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.tsx" \
  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.test.ts" \n  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.ts" \n  "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.test.ts"
git commit -m "feat(consent): hold To-dos are decided in place (Confirm stop, Not a stop); the call page's resend closes on render (R3-M8)"
```

---

### Task 14: The source scans for PR-2

**Owner:** bis-reviewer drafts, bis-comms applies (on the integration branch). **Tier:** HIGH. **Questions:** none.

**Files:**
- Modify: `apps/web/src/lib/consent/scans.test.ts`

**What it pins** (each with a positive control, each reading code with comments stripped, PR-1's `code()`):
1. scan 2 sees all fourteen kinds;
2. scan 3: `consent.ts` writes only through the function (no `.insert(` left either), only `consent.ts` names the function, and 0055 never updates or deletes the ledger;
3. only the consent reply path sets `numberFromCarrier` or `answersEventId` besides the gate and the text-back;
4. only `classes.ts`, `gate.ts` (its one exception), `inbound.ts` and `replies.ts` name a `consent.*` kind;
5. the inbound route reaches a send only through `lib/consent/replies`;
6. consent replies record no usage (G11).

- [ ] **Step 1: Write the scans**

Edit `apps/web/src/lib/consent/scans.test.ts`:

Find:
```ts
 * Scan 4 (the customer-initiated EMAIL kinds) is PR-3's, with the email kinds.
```
Replace with:
```ts
 * Scan 4 (the customer-initiated EMAIL kinds) is PR-3's, with the email kinds.
 *
 * PR-2 adds: every ledger write is the one guarded function (0055), named
 * only in consent.ts; only the consent reply path sets `answersEventId` (the
 * gate's one exception) or `numberFromCarrier` beside the text-back; only the
 * registry, the gate (its one exception), the inbound step and the reply
 * sender name a `consent.*` kind;
 * the inbound route reaches a send only through lib/consent/replies; and a
 * consent reply records no usage (plan G11).
```

Find:
```ts
  it("the scan reaches every send path's kind — none of the eleven is missing (the positive control)", () => {
```
Replace with:
```ts
  it("the scan reaches every send path's kind — none of the fourteen is missing (the positive control)", () => {
```

Find:
```ts
  it("consent.ts never updates, upserts or deletes, anywhere in the file, however the table is spelled (mutation: add .update( to a consent_events call, or .delete() after .from(\"consent_events\" as never) or .from(CONST) → FAILS)", () => {
    const src = code(join(DB_SRC, "consent.ts"));
    expect(src.match(/\.from\(/g)?.length).toBeGreaterThanOrEqual(2);   // the read and the insert: the scan sees both
    expect(src).toMatch(/\.insert\(/);
    expect(src.match(/\.(?:update|upsert|delete)\s*\(/g) ?? []).toEqual([]);
  });
```
Replace with:
```ts
  it("consent.ts never inserts, updates, upserts or deletes directly: every write is the one guarded function (0055; mutation: add .insert( or .update( to a consent_events call → FAILS)", () => {
    const src = code(join(DB_SRC, "consent.ts"));
    expect(src.match(/\.from\(/g)?.length).toBeGreaterThanOrEqual(4);   // the four reads: the scan sees them
    expect(src).toMatch(/\.rpc\(WRITE_FUNCTION,/);                      // and the one write
    expect(src.match(/\.(?:insert|update|upsert|delete)\s*\(/g) ?? []).toEqual([]);
  });

  it("only packages/db/src/consent.ts names the ledger's write function, as any string literal (mutation: an rpc(\"append_consent_event\") from apps/web → FAILS naming the file)", () => {
    const naming = [...webSources(), ...dbSources()].filter((f) => /["'`]append_consent_event["'`]/.test(code(f))).map(rel);
    expect(naming).toEqual(["packages/db/src/consent.ts"]);
  });

  it("0055, which defines the function, inserts into the ledger and never updates, deletes or truncates it (the insert is the positive control; mutation: add an update of consent_events → FAILS)", () => {
    const sql = readFileSync(join(REPO, "packages", "db", "supabase", "migrations", "0055_consent_writes.sql"), "utf-8").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/insert into public\.consent_events/);
    expect(sql).not.toMatch(/update\s+public\.consent_events|delete\s+from\s+public\.consent_events|truncate/i);
  });
```

Find:
```ts
  it("no production file but the gate (which declares and carries it) and lib/voice/textback.ts names numberFromCarrier, and the gate never sets it true itself (mutation: the composer sends numberFromCarrier: true → FAILS naming it; the list holding textback.ts is the positive control)", () => {
    const naming = webSources().filter((f) => /\bnumberFromCarrier\b/.test(code(f))).map(rel).sort();
    expect(naming).toEqual(["apps/web/src/lib/consent/gate.ts", "apps/web/src/lib/voice/textback.ts"]);
    expect(code(join(WEB_SRC, "lib", "voice", "textback.ts"))).toMatch(/\bnumberFromCarrier\s*:\s*true\b/);
    expect(code(join(WEB_SRC, "lib", "consent", "gate.ts"))).not.toMatch(/\b(?:numberFromCarrier|fromCarrier)\s*[:=]\s*true\b/);
  });
```
Replace with:
```ts
  it("no production file but the gate (which declares and carries it), the text-back and the consent reply sender names numberFromCarrier, and the gate never sets it true itself (mutation: the composer sends numberFromCarrier: true → FAILS naming it; textback.ts and replies.ts setting it are the positive controls)", () => {
    const naming = webSources().filter((f) => /\bnumberFromCarrier\b/.test(code(f))).map(rel).sort();
    expect(naming).toEqual(["apps/web/src/lib/consent/gate.ts", "apps/web/src/lib/consent/replies.ts", "apps/web/src/lib/voice/textback.ts"]);
    expect(code(join(WEB_SRC, "lib", "voice", "textback.ts"))).toMatch(/\bnumberFromCarrier\s*:\s*true\b/);
    expect(code(join(WEB_SRC, "lib", "consent", "replies.ts"))).toMatch(/\bnumberFromCarrier\s*:\s*true\b/);
    expect(code(join(WEB_SRC, "lib", "consent", "gate.ts"))).not.toMatch(/\b(?:numberFromCarrier|fromCarrier)\s*[:=]\s*true\b/);
  });

  it("only the consent reply path names answersEventId: the gate (which checks it), the inbound step (which plans it) and the reply sender (which passes it) (spec §4.2's one exception; mutation: the composer passes answersEventId → FAILS naming it; replies.ts passing it is the positive control)", () => {
    const naming = webSources().filter((f) => /\banswersEventId\b/.test(code(f))).map(rel).sort();
    expect(naming).toEqual(["apps/web/src/lib/consent/gate.ts", "apps/web/src/lib/consent/inbound.ts", "apps/web/src/lib/consent/replies.ts"]);
    expect(code(join(WEB_SRC, "lib", "consent", "replies.ts"))).toMatch(/\banswersEventId\s*:\s*r\.reply\.answersEventId\b/);
  });
```

Append at the end of the file:

```ts
describe("PR-2: who may send a consent reply, and how", () => {
  const CONSENT_KIND = /["'`]consent\.(?:stop_confirmation|start_confirmation|help)["'`]/;

  it("only the registry, the gate (its one exception), the inbound step and the reply sender name a consent.* kind (mutation: the composer sends kind \"consent.help\" → FAILS naming it; the four files are the positive control)", () => {
    expect(webSources().filter((f) => CONSENT_KIND.test(code(f))).map(rel).sort()).toEqual([
      "apps/web/src/lib/consent/classes.ts", "apps/web/src/lib/consent/gate.ts", "apps/web/src/lib/consent/inbound.ts", "apps/web/src/lib/consent/replies.ts",
    ]);
  });

  it("the inbound route reaches a send only through lib/consent/replies: never the gate, lib/sms, an automation or email, by any import path (plan G16; mutation: import sendSms from the gate into the route → FAILS)", () => {
    const route = join(WEB_SRC, "app", "api", "sms", "inbound", "route.ts");
    const imports = importsOf(route);
    expect(imports).toContain("apps/web/src/lib/consent/replies");
    expect(imports.filter((i) => /^apps\/web\/src\/lib\/(?:consent\/gate|sms(?:\/|$)|automations|email)/.test(i))).toEqual([]);
    expect(importsOf(join(WEB_SRC, "lib", "consent", "inbound.ts"))).not.toContain("apps/web/src/lib/consent/gate");
  });

  it("a consent reply records no usage (plan G11: not billed); the composer, which bills, is the positive control (mutation: recordUsageSafely in replies.ts → FAILS)", () => {
    const usage = /\brecordUsage(?:Safely)?\b|["'`]usage_events["'`]/;
    expect(code(join(WEB_SRC, "lib", "consent", "replies.ts"))).not.toMatch(usage);
    expect(code(join(WEB_SRC, "app", "(dashboard)", "dashboard", "accounts", "[accountId]", "conversations", "actions.ts"))).toMatch(usage);
  });
});
```

- [ ] **Step 2: Run the scans**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/scans.test.ts
```

Expected (predicted; not replayed): all pass on the integration branch (Tasks 1–13 in).

- [ ] **Step 3: Probes** (each must turn the named scan red; revert after each)

| # | Mutation | Must fail |
|---|---|---|
| 1 | add `db.from("consent_events").insert({})` to consent.ts | "consent.ts never inserts, updates …" |
| 2 | add `await db.rpc("append_consent_event", {})` to `lib/consent/inbound.ts` | "only packages/db/src/consent.ts names the ledger's write function" |
| 3 | add `update public.consent_events set note = null;` to the REAL `packages/db/supabase/migrations/0055_consent_writes.sql` in the lane worktree (the scan reads that path; a scratch copy would be a silent no-op, review R3-m6), run the scan, then `git checkout -- packages/db/supabase/migrations/0055_consent_writes.sql` | "0055 … never updates, deletes or truncates it" |
| 4 | the composer sends `numberFromCarrier: true` | the numberFromCarrier scan |
| 5 | the composer passes `answersEventId: "x"` | the answersEventId scan |
| 6 | the composer sends `kind: "consent.help"` | "only the registry, the gate (its one exception), the inbound step and the reply sender name a consent.* kind" (and scan 2 stays green: the kind exists) |
| 7 | route.ts imports `sendSms` from `../../../../lib/consent/gate` | "the inbound route reaches a send only through lib/consent/replies" |
| 8 | replies.ts calls `recordUsageSafely` | "a consent reply records no usage" |
| 9 | replies.ts gains `const PROBE = "consent.help_v2";` (an unregistered kind in a gate caller) | scan 2's "each kind literal in a file that sends through the gate is a registry key" (naming `consent.help_v2`): the `sms.consentReply.*` rename must not have blinded it (review R3-I5) |
| 10 | messages.ts: rename one reply key back to `"consent.reply.help.en"` (and its use in replies.ts) | scan 2's "each kind literal … is a registry key" (naming it): the reason the keys live under `sms.` |

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/consent/scans.test.ts
git commit -m "test(consent): PR-2's source scans — one guarded ledger write, the consent reply path alone, no usage for a reply"
```

---

### Task 15: e2e on the fixture account: a signed STOP, the staff controls, a hold and its To-do

**Owner:** bis-e2e-qa (and bis-platform for the one `ci.yml` line). **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `apps/web/e2e/consent-texts.spec.ts`
- Modify: `.github/workflows/ci.yml` (the `e2e` job's `env:` block: one NON-secret literal)

**The key (Prerequisites 4):** the spec builds an Ed25519 private key from a FIXED 32-byte seed and signs its webhooks with it; the e2e server verifies them with `TELNYX_PUBLIC_KEY`, which ci.yml sets to that seed's public half. It signs nothing anywhere else, exactly as `STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only` does for billing. Compute the literal once, by running this with Node (it prints the base64 public key):

```bash
node -e 'const c=require("node:crypto");const k=c.createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),Buffer.from("5eed".repeat(16),"hex")]),format:"der",type:"pkcs8"});console.log(c.createPublicKey(k).export({format:"der",type:"spki"}).subarray(12).toString("base64"))'
```

- [ ] **Step 1: Add the literal to ci.yml**

Edit `.github/workflows/ci.yml` — in the `e2e` job's `env:` block:

Find:
```yaml
      STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only
```
Replace with (`<printed key>` is the output of the command above, pasted exactly):
```yaml
      STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only
      # NOT a secret: the PUBLIC half of a fixed test key whose private half
      # lives in e2e/consent-texts.spec.ts, so the e2e server accepts that
      # spec's signed SMS webhooks. Production's TELNYX_PUBLIC_KEY is set on
      # Vercel Production only and is a different key.
      TELNYX_PUBLIC_KEY: <printed key>
```

- [ ] **Step 2: Write the spec**

Create `apps/web/e2e/consent-texts.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Consent chain PR-2 end to end (spec §8's e2e list, as plan G15 adjusts it):
 *   1. a signed inbound STOP that Telnyx answered stops the contact; the
 *      drawer says so and offers no Resume (choice 19);
 *   2. staff Stop texts runs at once with Undo, and keeps focus in the row
 *      (R3-M9); Resume refuses an empty note, then resumes with one;
 *   3. a stop sentence holds texts and makes a To-do; "Not a stop" on the To-do
 *      lifts the hold and closes it.
 * NOT here (plan G15): BIS's own confirmation text. The fixture account has no
 * approved A2P registration, so the gate refuses every send there; the
 * one-confirmation rule is proven by the route's signed-fixture tests.
 *
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One (CLAUDE.md). Its
 * own contacts and its own phone_numbers row, deleted in afterAll; the
 * ledger rows stay (append-only) until the fixture account is swept.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

type ClientFixture = { accountId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};

// The fixed test key (Step 1). Its public half MUST equal ci.yml's literal.
const PRIVATE = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from("5eed".repeat(16), "hex")]),
  format: "der", type: "pkcs8",
});
const PUBLIC_RAW = createPublicKey(PRIVATE).export({ format: "der", type: "spki" }).subarray(12).toString("base64");

const ACTOR = "e2e-consent-texts";
const STAMP = Date.now().toString();
const four = () => String(Math.floor(Math.random() * 9000) + 1000);
// 956-292 is a McAllen exchange, valid as a US number only (PR-1's E1), so
// none of these reads as "could be Mexican" and the row is not Check number.
const OUR_NUMBER = `+1956555${four()}`;
const STOPPER = `+1956292${four()}`;
const STAFF = `+1956292${four()}`;
const HOLDER = `+1956292${four()}`;
const made: { contacts: string[]; numberId: string | null } = { contacts: [], numberId: null };

function signedHeaders(raw: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "content-type": "application/json",
    "telnyx-timestamp": ts,
    "telnyx-signature-ed25519": sign(null, Buffer.from(`${ts}|${raw}`, "utf8"), PRIVATE).toString("base64"),
  };
}
const inbound = (from: string, text: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  data: { event_type: "message.received", payload: {
    id: `e2e-${STAMP}-${Math.random().toString(36).slice(2, 8)}`, to: [{ phone_number: OUR_NUMBER }],
    from: { phone_number: from }, text, messaging_profile_id: "e2e-profile", ...extra,
  } },
});

test.beforeAll(async () => {
  if (process.env.TELNYX_PUBLIC_KEY !== PUBLIC_RAW) {
    // In CI the literal is set (ci.yml), so a mismatch is a real failure. A
    // local run holds the real public key (or none): skip there, loudly,
    // rather than fail every local e2e run (review R3-m4; billing.spec.ts's
    // own precedent, :123-124).
    const why = "TELNYX_PUBLIC_KEY is not this spec's test key: set ci.yml's e2e literal from the command in plan Task 15";
    if (process.env.CI) throw new Error(why);
    console.warn(`::warning title=consent-texts.spec.ts skipped::${why}`);
    test.skip(true, why);
  }
  const { accountId } = fixture();
  const db = serviceDb();
  const { data, error } = await db.from("phone_numbers")
    .insert({ account_id: accountId, e164: OUR_NUMBER, status: "testing" }).select("id").single();
  if (error || !data) throw new Error(`consent-texts e2e: number insert failed: ${error?.message}`);
  made.numberId = (data as { id: string }).id;
  for (const [first, phone] of [["Stopper", STOPPER], ["Staff", STAFF], ["Holder", HOLDER]] as const) {
    made.contacts.push((await createContact(db, accountId, { firstName: first, lastName: STAMP, phone }, ACTOR)).id);
  }
});

test.afterAll(async () => {
  const db = serviceDb();
  for (const id of made.contacts) {
    const { error } = await db.from("contacts").delete().eq("id", id);
    if (error) console.error(`consent-texts e2e: contact cleanup failed (the fixture sweep takes it): ${error.message}`);
  }
  if (made.numberId) {
    const { error } = await db.from("phone_numbers").delete().eq("id", made.numberId);
    if (error) console.error(`consent-texts e2e: number cleanup failed: ${error.message}`);
  }
});

async function openDrawer(page: import("@playwright/test").Page, first: string) {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `${first} ${STAMP}` }).first().click();
  return page.getByRole("dialog").getByTestId("texts-row");
}

test("a signed STOP that Telnyx answered stops the contact: the drawer says so, and staff cannot resume it", async ({ page, request }) => {
  const raw = inbound(STOPPER, "STOP", { autoresponse_type: "STOP" });
  const res = await request.post("/api/sms/inbound", { headers: signedHeaders(raw), data: raw });
  expect(res.status()).toBe(200);
  const row = await openDrawer(page, "Stopper");
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText(m["contact.texts.stopped"]);
  await expect(row).toContainText("they texted STOP");
  await expect(row).toContainText(m["contact.texts.customerOnly"]);
  await expect(row.getByRole("button", { name: m["contact.texts.resume"] })).toHaveCount(0);
});

test("staff Stop texts runs at once with Undo and keeps focus in the row; Resume refuses an empty note, then resumes", async ({ page }) => {
  const row = await openDrawer(page, "Staff");
  await expect(row).toHaveAttribute("data-state", "allowed");
  await row.getByRole("button", { name: m["contact.texts.stopTexts"] }).click();
  const toast = page.getByText(m["contact.texts.stoppedToast"]);
  await expect(toast).toBeVisible();
  await toast.hover();   // pauses Sonner's timer (PR-1's R3-M5 note); pointer events reach it since #151
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText(m["contact.texts.how.staff"]);
  await expect(page.getByTestId("texts-row-status")).toBeFocused();   // R3-M9
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");

  await row.getByRole("button", { name: m["contact.texts.stopTexts"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  // Review R3-I4: opening the form puts the keyboard in the note; Cancel hands it back to the status.
  await row.getByRole("button", { name: m["contact.texts.resume"] }).click();
  await expect(row.getByLabel(m["contact.texts.resumeNoteLabel"])).toBeFocused();
  await row.getByRole("button", { name: m["contact.texts.resumeCancel"] }).click();
  await expect(page.getByTestId("texts-row-status")).toBeFocused();
  await row.getByRole("button", { name: m["contact.texts.resume"] }).click();
  await row.getByRole("button", { name: m["contact.texts.resumeSubmit"] }).click();
  await expect(page.getByText(m["contact.texts.resumeNoteRequired"])).toBeVisible();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await row.getByLabel(m["contact.texts.resumeNoteLabel"]).fill("Asked on the phone for texts again");
  await row.getByRole("button", { name: m["contact.texts.resumeSubmit"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");
});

test("a stop sentence holds texts and makes a To-do; Not a stop on the To-do lifts the hold and closes it", async ({ page, request }) => {
  const raw = inbound(HOLDER, "please stop texting me");
  const res = await request.post("/api/sms/inbound", { headers: signedHeaders(raw), data: raw });
  expect(res.status()).toBe(200);
  const row = await openDrawer(page, "Holder");
  await expect(row).toHaveAttribute("data-state", "held");
  await expect(row).toContainText("please stop texting me");

  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/tasks`);
  const todo = page.getByRole("listitem").filter({ hasText: "may have asked to stop texts" }).filter({ hasText: "please stop texting me" });
  await expect(todo).toHaveCount(1);
  await todo.getByRole("button", { name: m["contact.texts.notAStop"] }).click();
  await expect(page.getByText(m["contact.texts.releasedToast"])).toBeVisible();
  await expect(todo).toHaveCount(0);

  const after = await openDrawer(page, "Holder");
  await expect(after).toHaveAttribute("data-state", "allowed");
});
```

- [ ] **Step 3: Check it locally as far as this machine allows**

```bash
cd apps/web
pnpm exec tsc --noEmit
pnpm exec eslint e2e/consent-texts.spec.ts
```

Playwright refuses production locally (#135) and the lane has no CI-project env, so the spec runs in CI's `e2e` job only (Task 16 reads its result on the head SHA). **Not replayed.**

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/consent-texts.spec.ts .github/workflows/ci.yml
git commit -m "test(e2e): a signed STOP, the staff Texts controls with focus kept, and a hold decided from its To-do, on the fixture account"
```

---

### Task 16: Gates, 0055 and 0056 to CI then production, parity, the Telnyx opt-out import, merge, Telnyx step 0, handoff

**Owner:** the orchestrator, with bis-e2e-qa for the gates. **Nothing here is an implementer step.** Every Supabase step is the orchestrator's, exactly once per project; every production READ and every Telnyx call needs danlo's explicit go first. Record each step's result in the ledger (`.superpowers/sdd/progress.md`).

**The order:** branch complete → CI apply → green head → production apply → parity (danlo's go covers these) → **the Telnyx opt-out import: the count, then the write only after danlo sees the count — BEFORE any number changes profile** (review R1-C1; danlo's decision 4) → merge (danlo's go) → deploy check → Telnyx step 0 per business: its own profile, its number moved, its configs (danlo's go, with a read-back) → go-live check after A2P approval (not merge).

- [ ] **Step 1: The branch is complete.** On `feat/consent-pr2` after Checkpoint C and Tasks 14–15: `pnpm install --frozen-lockfile --prefer-offline`; both typechecks; `pnpm --filter web lint` (0 errors); the full web suite (the two env suites only); the db suite on the replica, the branch's parent on `pre` and the head on `post`, with Checkpoint A's pass→fail diff (no flips; the CI-only files the only new failures). `git log --oneline main..feat/consent-pr2` shows the plan commit, the spec commit, the merge of `main` if one was needed, and one commit per task. Then the browser-bundle check PR-1 made (the libphonenumber metadata stays on the server): `pnpm --filter web build`, `grep -rl country_calling_codes apps/web/.next/server | wc -l` ≥ 1 and `grep -rl country_calling_codes apps/web/.next/static | wc -l` = 0 (the Texts row imports only TYPES from the server modules). If D7 is done, bis-design-reviewer checks the Texts row on a running build (dark and light, the blur fallback, 375 px); otherwise that is danlo's eyeball after the deploy (step 9).

- [ ] **Step 2: Pre-flight reads on BOTH projects, under danlo's go for production** (counts only):
  1. 0055's unique index would refuse to build over an existing duplicate: `select count(*) from (select 1 from public.consent_events where source_ref is not null group by account_id, channel, address, action, source_ref having count(*) > 1) d;` must be `0` (PR-1 writes no `source_ref`; expected 0).
  2. Task 7: `select count(*) from public.accounts where a2p_status = 'approved';` — every approved account will be REFUSED texting until its profile is recorded (that is the point; Task 7 lists what else stops). Expected 0 today (no account is approved, `crm-features.md:1098`); if not 0, tell danlo which accounts stop texting at the merge.

- [ ] **Step 3: 0055 and 0056 to the CI project** (runbook `docs/runbooks/ci-supabase-project.md` §6). Push the branch (the first push; the pre-push hook runs), then:

```bash
gh workflow run ci-project-setup.yml --ref feat/consent-pr2 -f step=push-dry-run
```

The run's log must list exactly the new files: `0055_consent_writes.sql` and `0056_messaging_profile.sql`. Only then `-f step=push` and `-f step=migrations`; `migrations` must list them applied. Neither file has a backslash (Task 1, Task 7). From here until the merge, `main`'s own CI sees 0055 on the shared CI project and `consent-ledger-schema.test.ts`'s index list goes red there (main pins three indexes; 0055 adds two). Keep steps 3–9 in as few sittings as danlo's goes allow.

- [ ] **Step 4: CI green on the head SHA.** Re-run the branch's CI if it ran before step 3. Read the check runs FOR THE HEAD SHA:

```bash
SHA=$(git rev-parse feat/consent-pr2)
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
```

Expected: `verify` and `e2e` both `completed` / `success`. In `verify`'s log, on the CI project: `consent-writes-schema.test.ts` all passed (including the two-connection lock test: A2), `consent-writes-live.test.ts` 1 passed (the RPC through PostgREST), `consent-tasks-live.test.ts` 1 passed, `telnyx-backfill.test.ts` 1 passed, `messaging-profile-schema.test.ts` 3 passed. In `e2e`'s: `consent-texts.spec.ts` 3 passed, `consent-phone-country.spec.ts` green in its Task 12 version (the test id wraps the whole Check number state, review R3-I2; each "no row" waits for the Texts row's `data-state`, R3-I3; a pick keeps focus in the row, R3-I4), `blueprints.spec.ts` green (Task 7's profile field).

- [ ] **Step 5: 0055, then 0056, to production, BEFORE the merge** (the merge deploys code that calls the function on its first inbound text, and a contact page whose task read selects `tasks.consent_event_id` — Task 2's `listContactTasks`, review M9 — so without 0055 every contact page would fail; 0055 is additive, so the live build runs unchanged against it). Under danlo's one go for steps 5, 6 and 9, through the Supabase MCP on `tlbkbmlrfafquucsmsmm`:
  1. Pre-flight read: `select to_regprocedure('public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)') as fn, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'consent_event_id') as col;` must return `null` and `0`. Anything else: STOP (never re-apply).
  2. `apply_migration`, name `0055_consent_writes`, the file's exact contents. Once. Then `notify pgrst, 'reload schema';` (the 0053 precedent: the new function must be in PostgREST's cache before the first call).
  3. Post-apply reads, all of which must match:
     - `select prosecdef, proconfig, md5(pg_get_functiondef(oid)) from pg_proc where oid = to_regprocedure('public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)');` → `false`, `{search_path=""}`, and the same md5 the CI project returns for the same query (run it there too; the parity step compares it again);
     - `select r, has_function_privilege(r, 'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)', 'EXECUTE') from unnest(array['anon','authenticated','service_role']) r;` → `false`, `false`, `true`;
     - `select indexname from pg_indexes where tablename = 'consent_events' order by 1;` → `consent_events_account_id_id_key`, `consent_events_address_idx`, `consent_events_contact_idx`, `consent_events_pkey`, `consent_events_source_once`;
     - `select conname from pg_constraint where conname in ('tasks_consent_event_fkey', 'consent_events_account_id_id_key') order by 1;` → both;
     - the ledger's grants are unchanged from 0054 (PR-1 Task 17 step 6's `has_table_privilege` query → exactly `authenticated SELECT`, `service_role INSERT`, `service_role SELECT`).
  4. 0056: the same pre-flight (`telnyx_messaging_profile_id` column absent), `apply_migration` name `0056_messaging_profile` once, and post-apply: the column exists, its CHECK and unique index exist, and `has_column_privilege('authenticated', 'public.accounts', 'telnyx_messaging_profile_id', 'UPDATE')` is `false`.

- [ ] **Step 6: Parity** (runbook §5): `-f step=fingerprint` and `-f step=migration-history` on the CI project; `packages/db/supabase/parity/fingerprint.sql` and `migration-history.sql` through `execute_sql` on production (read only); diff; only the runbook's allowed differences may remain. Then PR-1's `.superpowers/sdd/consent-pr1/parity-0054.sql` on both (still identical), plus the function md5 of step 5.3 on both (identical). Ledger: `0055 APPLIED — CI odnobiodsftffphuuosz (db push) <date> — PROD tlbkbmlrfafquucsmsmm (MCP) <date> — NEVER RE-APPLY` (and the same line for 0056).

- [ ] **Step 7: The Telnyx opt-out import, the count — BEFORE any number changes profile** (Task 3; danlo's decision 4, review R1-C1; danlo's go for the Telnyx read and the production read). Today every BIS number is on one shared messaging profile (`crm-features.md:1099`), and whether a number's opt-outs follow it to a new profile is NOT FOUND (A5; inferred from F4 that they do not). So this runs now, right after parity, while the shared profile's list still covers every business, and step 10 does not start until step 8 is done or danlo has seen a zero. **It also runs before the MERGE** (review R1-N9): the build live before the merge has no Stop texts, no hold and no staff decision, so no staff stop or hold can exist on production yet. A backfill row is dated at the opt-out's own, PAST time; written after staff had stopped or held the same number, it would sit OLDER than that staff row, leave the staff stop the newest (and so staff-resumable), and quietly break choice 19. **Precondition, told to danlo (review R1-N8):** nobody deletes the shared messaging profile or clears its opt-out list before step 8 is done — the A2P work this week must leave both alone.
  1. `GET /v2/messaging_optouts?redaction_enabled=false&page[size]=250&page[number]=N` — UNFILTERED by profile, so the shared profile and any other are all read (assumption: the list without `filter[messaging_profile_id]` covers every profile on the Telnyx account; F6 verified the filter exists, not what its absence returns — so also run it once WITH the shared profile's id and check that its count is not larger than the unfiltered one) — every page appended to one JSON array in `/tmp/optouts.json` (it holds customer numbers: never commit it). `TELNYX_API_KEY` is exported by danlo in the shell for the session, never echoed or written to a file (memory `bis-env-secret-reads`).
  2. The owners: paste `packages/db/supabase/backfills/0055-telnyx-optout-owners.sql` into `execute_sql` on production; take only the JSON array of rows into `/tmp/owners.json`.
  3. `pnpm --filter @bis/db backfill:telnyx-optouts /tmp/optouts.json /tmp/owners.json` prints "opt-outs read", "to write" per account and in total, business numbers with no owner (numbers on the Telnyx account that are not BIS's: counted, never written), and "opt-outs whose customer number is one of ours (expected 0)". A non-zero last line means the `from`/`to` orientation (F10) was misread: STOP. Report all of it to danlo.
  4. Expected: small or zero (no account has texted a customer, spec §4.2). Zero to write: nothing to write, and that is the answer; delete the temp files and go on.

- [ ] **Step 8: The import write, only after danlo has seen step 7's count and says go — still before any number moves.** `pnpm --filter @bis/db backfill:telnyx-optouts /tmp/optouts.json /tmp/owners.json --emit-sql /tmp/telnyx-backfill.sql`, then paste that file into `execute_sql` on production (no backslash: `consentAppendSql` refuses one; no transaction control). It is ONE statement (review R1-M3: `execute_sql` shows only the last statement's result) and it answers one row per outcome — `appended`, `duplicate`, `refused` (the customer's own stop already stood) — whose counts add up to "to write, total". Run it a second time: every row the first run `appended` now answers `duplicate`, every `refused` stays `refused` (no row was written for it), any `duplicate` stays `duplicate`, and the total is unchanged (review R1-N6; one row per source). Then delete `/tmp/optouts.json`, `/tmp/owners.json` and `/tmp/telnyx-backfill.sql`, and say so in the ledger. The customer numbers left this machine only inside that pasted statement.

- [ ] **Step 9: Merge, under danlo's go.** Squash-merge through GitHub only after steps 4–6 (the ruleset requires `verify` and `e2e` green on the head SHA; the policy is non-strict, so if `main` moved since step 4, merge `main` in, re-run, and re-read the head SHA's check runs). After the deploy: the Vercel deployment is READY and error-free; open any contact on production as the agency (the Texts row reads Allowed for a textable number); the cron's next tick is 200.

- [ ] **Step 10: Telnyx step 0, per texting business — danlo's go, never an implementer** (spec §5 go-live item 1 as corrected by S2 and S11; brief item c). Only after step 8 (or step 7's zero). For each business about to text (BIS's own line and 956 Woodworks first, `crm-features.md:1099`), after danlo has created its own messaging profile and moved its number onto it (an operational step, spec §9):
  1. **Preconditions and read before** (Telnyx API reads, as in step 7.1):
     - The account's `brand_name` (read through the MCP, `select brand_name from accounts where id = …`) is not blank: every reply below is signed with it. Blank: STOP until it is set (review R1-M6).
     - `GET /v2/messaging_profiles/{id}`: its `features.ai_opt_out_detection_enabled` must be `false` (F8). **If it is `true`: STOP and report to danlo.** Turning it off is itself a Telnyx write, done only under danlo's go and read back like the configs. **If the field is absent, that is unknown, not off:** check the profile in the Telnyx portal (Messaging → the profile → opt-out settings) and record what it shows (review R1-I6).
     - `GET /v2/messaging_profiles/{id}/phone_numbers` (only this business's numbers), `GET /v2/messaging_profiles/{id}/autoresp_configs` (what is there now).
     - Assumptions this step rests on, each settled by its own read-back or by step 11: the profile id is a UUID (Task 7's CHECK; if Telnyx shows another shape, STOP — 0056 would refuse it); Telnyx answers its DEFAULT stop words with the custom stop config's `resp_text` too (F2 says the defaults stay active; that they take the custom config's reply is the reading of its docs, not a documented sentence — step 11 checks it word for word); Telnyx accepts `CA` as a `country_code` beside `US` and `MX` (its examples show two-letter country codes; `CA` itself is not shown — the POST's answer and the read-back settle it; if refused, record it and tell danlo, since a Canadian sender then gets Telnyx's unnamed reply).
  2. **The configs**, with `{Business}` = that account's `brand_name`, ONE bilingual config per operation for EACH sender country `US`, `MX` and `CA` — nine configs (danlo's decision 1: a Canadian +1 sender gets the named reply too, review R2-m11). The texts are Task 5's `telnyxReplyText(op, brand)`, which `replies.test.ts` pins:
     - `op: "stop"`, `keywords`: `STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT, OPTOUT, PARAR, DETENER, ALTO, CANCELAR, BAJA, NO MAS, NO MÁS` (Task 5's `TELNYX_KEYWORDS.stop`), `resp_text`: `{Business}: You won't get any more texts from us. Reply START to get them again. Ya no le enviaremos mensajes. Responda START para volver a recibirlos.`
     - `op: "start"`, `keywords`: `START, UNSTOP`, `resp_text`: `{Business}: You'll get our texts again. Reply STOP to stop them. Listo, le enviaremos mensajes de nuevo. Responda PARAR para dejarlos.`
     - `op: "help"` (F11: if Telnyx refuses `help`, use `info`, and use the same op in the read-back, review R1-M5), `keywords`: `HELP, AYUDA`, `resp_text`: `{Business}: Reply STOP to stop texts from us. Call or text this number for help. Responda PARAR para dejar de recibir mensajes. Llame o escriba a este numero para recibir ayuda.` (danlo's decision 2; two GSM-7 segments, measured in Task 5.)
     Either danlo enters them in the portal (Messaging → keywords management) or the orchestrator POSTs each to `POST /v2/messaging_profiles/{id}/autoresp_configs`. If a config for the same `op` and `country_code` already exists, PATCH/PUT it (`/autoresp_configs/{autoresp_cfg_id}`) rather than adding a second.
     **Assumption (review R1-N11):** Telnyx accepts its own reserved default words (STOP, STOPALL, STOP ALL, UNSUBSCRIBE, CANCEL, END, QUIT, START, UNSTOP, HELP) inside a custom config's `keywords`. If a POST is refused for that, drop ONLY the default words from that config's `keywords` (F2: the defaults stay active whatever the list says), post the rest, compare the read-back against the list as posted, and let step 11's rows 1, 5 and 6 confirm that the defaults answer with the custom `resp_text`. Record which way it went.
  3. **Read back** `GET …/autoresp_configs` and compare, as sorted JSON, against the nine bodies (`jq -S '[.data[] | {op, keywords: (.keywords | sort), resp_text, country_code}] | sort_by(.country_code, .op)'` on both sides; `op` as it was posted, `help` or `info`). Read `GET /v2/messaging_profiles/{id}` again: `features.ai_opt_out_detection_enabled` is `false` (review R1-I6). Any difference: STOP and report. Record in the ledger: the profile id, the nine config ids, the AI-detection value, the date.
  4. Record the profile id on the account's A2P card (Task 7; the agency's own screen). The app refuses texting for an approved account until it is there.
  5. A business rename (its `brand_name`) makes these replies stale: redo 10.2–10.3 (noted in the runbook by Task 9's edit; add it there if it is missing).

- [ ] **Step 11: The go-live check — after A2P approval, NOT a merge gate** (spec §5, items 1, 2 and 6 now met). On BIS's own line, from danlo's own phone, one text at a time, each from a KNOWN state (review R2-N2: a text sent to an address that is already stopped tests nothing), and for each the reply written down WORD FOR WORD and compared character for character with the line the table names (review R1-M5: a reply that differs means the wrong config, or the wrong sender, answered). After each: the drawer's Texts row, and `consent_events` for the address (read through the MCP, BIS's own account only). Before row 1 the Texts row must read Allowed; if it does not, text `START` and wait for its reply. **Precondition (review M5a):** danlo's phone is NOT the alert phone of the account that owns BIS's line — the route drops the alert phone's HELP and phrases and never files its texts (G10), so every row below would read wrong. **One reply may arrive in two or three parts** (the bilingual lines are 2 GSM-7 segments or more, Task 5's measurement): that is still ONE reply; compare the joined text (review M5d).

| # | Text | State before | Expected answerer — and what BIS writes |
|---|---|---|---|
| 1 | `HELP` | Allowed | **Telnyx's** help line (step 10.2). BIS sends nothing (`autoresponse_type` set); it writes at most the first-text grant (`granted` / `inbound_text`, only if the number has no ledger row yet; review M5b). |
| 2 | `AYUDA` | Allowed | **Telnyx's** help line (AYUDA is in the help config). BIS: nothing. |
| 3 | `s t o p` | Allowed | **BIS's own** stop confirmation, English (Task 5), answering the new `revoked` / `keyword` row. The one word here only BIS's matcher reads as a stop (spaces are ignored, choice 26; Telnyx matches the whole message, A1), so BIS's own reply path is exercised live. If Telnyx answers it instead, record that: A1 is then wider than assumed, and BIS correctly sent nothing. |
| 4 | `START` | Stopped by BIS only (Telnyx never saw a STOP) | Exactly ONE start reply: **Telnyx's** start line if Telnyx answers START on a number it never blocked, otherwise **BIS's own** start confirmation (English). Which one is NOT FOUND in Telnyx's docs; record it — later rows name it "row 4's answerer". BIS writes `resubscribed` either way. If Telnyx answered row 3 itself, the number is Telnyx-blocked and this row is row 6 (review M5c). |
| 5 | `STOP` | Allowed | **Telnyx's** stop line. BIS writes `revoked` / `keyword`, sends nothing. |
| 6 | `START` | Stopped by Telnyx | **Telnyx's** start line. BIS writes `resubscribed`, sends nothing. |
| 7 | `PARAR` | Allowed | **Telnyx's** stop line (PARAR is in the stop config). BIS writes `revoked` / `keyword`. |
| 8 | `START` | Stopped by Telnyx | **Telnyx's** start line. |
| 9 | `Stop.` | Allowed | **Telnyx's** stop line if Telnyx ignores the full stop, otherwise **BIS's own** stop confirmation (A1). Record which. Then `START`: **Telnyx's** start line if Telnyx answered `Stop.` (row 6), otherwise **row 4's answerer**. |
| 10 | `STOP`, then `Start!` | Allowed, then stopped by Telnyx | `STOP`: **Telnyx's** stop line. `Start!`: **Telnyx's** start line if Telnyx recognises it; otherwise **NOBODY, by design** — BIS lifts its ledger, its start confirmation is refused with 40300, the gate records the block again, and the log names it (A1's trace, review R2-I1c). **Then look at the Texts row (review I3):** only if it reads Stopped, send a plain `START`: **Telnyx's** start line. If it reads Allowed, Telnyx recognised `Start!` and the number is allowed on both sides: send nothing more (a START there could fairly get no answer, which is not a fault). |
| 11 | `Cancel.` | Allowed | **Telnyx's** stop line if Telnyx ignores the full stop, otherwise **BIS's own** stop confirmation. Then `START`: **Telnyx's** start line if Telnyx answered `Cancel.`, otherwise **row 4's answerer**. |
| 12 | `please stop texting me` | Allowed | **NOBODY, by design** (choice 20): the Texts row reads On hold and a To-do appears. Then Not a stop in the drawer, which leaves the number Allowed. |

This settles A1, A3 and A4, and F3's per-language question does not arise with the bilingual configs. Two replies to one text, or none where the table names an answerer: STOP texting on every account (`outbound_suppressed`) and report.

- [ ] **Step 12: Handoff.** The ledger lines above; the head SHA and its check runs; the counts from steps 2, 7 and 8; the Telnyx config ids and AI-detection readings from step 10; and the Next plans below.

---

## Self-review (done while writing, and again after the three-reviewer fix round; recorded for the reviewer)

**Spec coverage** (the §7 PR-2 row, item by item, and what PR-1 handed on):
- Inbound keywords, START and HELP: Task 4 (the matcher, decision 10/11, choice 26 as G9 extends it), Task 8 (what each means), Task 9 (the route).
- The confirmation and the Telnyx reconciliation: Task 5 (§4.2's six lines, the help lines with S12's contact sentence), Task 6 (the three kinds, choice 18's any hour, the gate's one exception), Task 8 (BIS replies only when `autoresponse_type` is absent, whatever its spelling: G4; the reply owed the moment the row is written: G1), Task 9 (after the response: G3), Task 16 step 10 (Telnyx's own replies and keywords for US, MX and CA, with a read-back) and step 11 (the live one-reply check, word for word).
- The phrase list and holds: Task 4 (§4.2's phrases as S9 extends them: 17 English and 17 Spanish sentence phrases, 28 Spanish verb forms × 4 message objects, 11 whole-message phrases and 4 repeated stop words, pinned by literals), Task 8 (held, the To-do, choice 20's no reply), Tasks 11–13 (Confirm stop, Not a stop, their bounded Undo, the To-do's own buttons, G20, G21).
- Grants: Task 8 (texting first, spec step 6), Task 10 (form, booking).
- The drawer's Messages block, Texts row, and the To-do rows: Tasks 11, 12, 13 (§6's Allowed, Stopped, On hold, Check number; the two-row skeleton and the error line; "Since {date} · {how}"; Resume's required note; To-do lines from `messages.ts`).
- The Telnyx backfill: Task 3 and Task 16 steps 7–8 (count first, write after danlo sees it, both before any number changes profile: A5, S11).
- §3's PR-2 schema: `tasks.consent_event_id` with its grant decision (Task 1, G7); the guarded `hold_released` (Task 1's SQL rule, used by Task 11's Not a stop); choice 19's staff rules in the same function (G6); one row per source event (S10).
- §4.2's alert phone (review R2-I5): Task 9 (STOP and START before the drop).
- §5: a lost stop answers 503 (Task 9, G2); one confirmation per revoked row, within five minutes, never for an address the customer already stopped, none over a staff stop (S8), none when Telnyx replied (Tasks 6, 8, 9); one profile per texting business (Task 7, Task 16 step 10).
- §8's PR-2 tests: the matcher and phrase tables (Task 4); the state order at the millisecond (Task 1); the inbound route with genuinely signed fixtures, `autoresponse_type` present, absent and unknown, an already-stopped address, CANCEL with a booking and a failing To-do, YES/NO unchanged, the hold, the first-text grant, the 503 (Task 9); the scans (Task 14); the DB tests (Task 1, Task 3); the e2e as G15 adjusts it (Task 15), and PR-1's e2e kept honest (Task 12).
- PR-1's inherited items: R2-I5 (Task 9), R3-M7 (Task 11's move, Task 12's one row), R3-M8 (Task 13), R3-M9 (Task 12's focus target, kept mounted after a pick, proven in Tasks 12 and 15), G2 (Task 1), the guarded `hold_released` (Task 1).
- Not in PR-2, deliberately: every email item (PR-3); the quiet-columns drop migration; a per-contact zone; AI stop detection (decision 5; F8 keeps Telnyx's off too).

**Placeholder scan:** `grep -nE "TBD|TODO|implement later|fill in|similar to Task"` over this file returns this line and the two uses of Task 8's constant `TODO_EXCERPT` (an identifier, not a placeholder). Three edits say "the file's own" helper names (`render`, `CONTACT`, the `@bis/db` mock factory of `tasks/actions.test.ts`) instead of quoting them, because those files are long and the helper is used as-is; each such edit names the exact grep that finds it.

**Type consistency** (names a later task uses, checked against the task that defines them): `appendConsentEventGuarded` / `ConsentGuard` (with `unless_customer_stopped`) / `{ ifNewest }` / `ConsentAppend.outcome` / `CUSTOMER_STOP_METHODS` (Task 1 → 3, 8, 10, 11); `readConsentHistory`, `readConsentEvent`, `readConsentActions`, `newestDecidingRow` (Task 1 → 2, 11, 13); `ensureConsentTask`, `completeTasksForConsentEvents`, `reopenTasks`, `nextBookedStart`, `WorkRow.consent` (Task 2 → 8, 11, 13); `matchKeyword`, `keywordDisplay`, `CANCEL_WORDS`, `matchPhrase` (Task 4 → 8, 11); `ReplyKind`, `consentReplyBody`, `telnyxReplyText`, `TELNYX_KEYWORDS`, the `sms.consentReply.*` keys (Task 5 → 8, 16); `SmsRequest.answersEventId`, `stop_confirmation_stale` (Task 6 → 8); `classifyInbound`, `parseAutoresponse` (`Autoresponse` with `OTHER`), `recordInboundConsent` (with its `owe` callback), `CHANGES_CONSENT`, `ConsentReplyPlan`, `sendConsentReply` (Task 8 → 9); `TextsView`, `TextsActionResult`, `TextsUndo`, `TextsContext` (with `now`), `UNDO_WINDOW_MS`, `textsContextFor`, the six `…Action`s, `TextsResponse` (Task 11 → 12, 13); `TextsLoad`, `runTextsAction`, `TEXTS_TREATMENT` (Task 12 → 13); `HoldUndecidedError`, `holdOpenTaskIds`, `listContactTasks`'s `consent_event_id` (Task 2 → 12, 13); `matchPhrase`, `WHOLE_MESSAGE_PHRASES`, `REPEATED_KEYWORDS` (Task 4 → 8); `readTaskContact` (returning the link, Task 13). NOT checked by a compiler: nothing was run (see Replay status).

**Counts** (read off this file): 16 tasks; 3 checkpoints; 2 migrations (0055, 0056); 52 new copy keys (Task 5, counted off its two blocks: 12 + 30 + 10) plus 5 A2P keys (Task 7); nine Telnyx autoresp configs per profile (Task 16 step 10.2: 3 operations × 3 countries); 17 stop keywords in the stop config (Task 5's `TELNYX_KEYWORDS.stop`, ≤ Telnyx's 20); 161 phrase entries (Task 4: 17 English and 17 Spanish sentence phrases, 112 Spanish verb phrases from 28 forms × 4 objects, 11 whole-message phrases, 4 repeated stop words), plus 2 `NOT_FOLLOWED_BY` exclusions.

**Vacuity checks applied while writing** (memories `bis-vacuous-test-shapes`, `bis-test-vacuity`):
- Every `vi.mock("@bis/db")` factory that a changed module reaches gains the new exports (route.test.ts and route.consent.test.ts gain `completeTasksForConsentEvents`; the call page test; the tasks actions test), and where a test needs a real pure function or class beside the mocks (`newestDecidingRow`, `HoldUndecidedError`), the factory spreads `importOriginal`.
- A time bomb found and fixed while writing: the gate's deliver re-check judges the five minutes at the real clock, so Task 6's re-check case pins the clock with `vi.useFakeTimers({ toFake: ["Date"] })`; without it the case turns red on its own after 2026-10-06. The Undo window uses the context's own `now`, never the real clock.
- Two zones where a zone matters (the CANCEL To-do's date in Los Angeles vs UTC; the stopped line in Chicago vs UTC).
- The copy assertions that meet an apostrophe in rendered HTML read the WHOLE line through `renderedText` (review R3-m2 removed the `.split("'")[0]` that kept only "Couldn").
- A near-miss negative for every phrase-list edge ("remove meat", "don't texture", "Take me to the shop"), and for the keyword table ("Stops", "stopp", "end it"); the whole-message rule is pinned from both sides ("Please stop!!" holds, "Please stop by Thursday" does not, danlo's decision), so a later widening is a decision, not an accident.
- A list pinned against a LITERAL in the test, never the implementation's own array (the phrase list, review R2-I5).
- A mock that must echo its input where identity matters (the retry test's `duplicate` carries the FIRST id, and the To-do is asserted against that id, not the new one).
- A guard that masks a probe is taken out of the probe's way (review R1-I2: the backfill re-run test puts the customer's START between the runs, so only the source can stop the second stop).
- Consecutive schema-test writes are 2 ms apart, so a millisecond tie cannot make a correct function fail (review R1-I1).
- A probe that reads a path is applied to THAT path (review R3-m6: Task 14 probe 3 edits the real 0055 file and restores it).
- The decomposed accent is built with `String.fromCharCode(0x301)`, not a literal, so an editor that re-normalises the file cannot turn the test into a composed-accent test.
- No assertion of the form `expect(x).toEqual(expect.arrayContaining([]))` (one was written and removed).

**Known residuals** (each a deliberate trade, not a gap to fill silently):
- A HELP/AYUDA text whose FIRST attempt fails after filing gets no BIS help reply on the retry (help is not retried, G2); rare, and Telnyx answers HELP itself.
- A Telnyx-handled START or HELP that arrives WITHOUT `autoresponse_type` would get two replies (A3); Task 16 step 11 checks it.
- A START Telnyx does not recognise, after a Telnyx-blocked STOP, gets no reply and leaves the number blocked (A1's trace; logged by name; the customer's plain START works).
- A keyword only BIS knows (`Stop.`, `¡Alto!`) is lost if all six of Telnyx's attempts fail (F7); nothing else retries a webhook (review R2-m12).
- A hold whose To-do cannot be written on any of the six attempts stays held with no To-do; the drawer's Texts row still shows it On hold with its two buttons (review R2-m12).
- A reply lost after the response — `after()` cut short, or the provider failing — is logged and not retried (review R2-I1, R2-m12); the ledger row stands either way.
- A stop whose append COMMITS but whose answer is lost on the network gets no reply: the route answers 503, and Telnyx's retry finds the row `duplicate`, which owes nothing (review R2-m-e). The ledger is right; only the confirmation is missing.
- The To-do's Undo carries task ids from the client; `reopenTasks` is bounded to the account (and RLS), so the worst case is a staff member reopening their own account's tasks.

**Not replayed:** every step. The machine never had the 1.5 GB the brief requires for even one targeted test file, while this plan was written or while its review fixes were made. One pure module was SIMULATED instead, outside vitest: Task 4's `phrases.ts`, extracted from this file and run through Node's own type stripping, answered every assertion of its planned test as the test expects (review M7's count, recomputed for the final list): 50 named assertions (every held, not-held, whole-message and repeated-word case), 146 per-phrase sentences (17 English, 129 Spanish), 24 negative texts, all 21,170 ordered pairs of the containment test, and 157 normal-form checks — 21,547 checks, none failing. That is evidence about the logic, not a replay of the test file.

## Deferred to whole-branch review

- **A text arriving on an unexpected profile.** The route records `payload.messaging_profile_id` as evidence (Task 8) but does not compare it with the profile Task 7 records. Worth a log line once real traffic flows.
- **The agency Work queue item is withdrawn.** The first draft deferred "a Done on the agency Work queue completes a hold's To-do"; that screen has no action buttons at all (`work/agency-work-list.tsx:22-27` on `76c6acfb`: "No action buttons … A row here is read-only"), and G21 now makes every real "Done" path refuse an undecided hold.
- **Review minors not applied in this round** (each with its reviewer's id; the orchestrator chose which to apply now):
  - R1-M4 — the CLI's "no owner for business number" lines would print customer numbers under a reversed from/to reading; the owners SQL says released numbers' opt-outs are "reported, never written" but `planTelnyxBackfill` ignores `status`.
  - R1-M7 — `openTasks` throws when `readConsentActions` fails, so the whole To-do list errors (consider `consent: null` and a log); probe 8 is CI-only.
  - R1-M10 — the SQL could refuse `revoked` over `revoked` for every write (spec §4.3); a follow-up to revoke service_role's direct INSERT once the old build is gone.
  - R1-M11 — the replica steps for 0056; Task 16 step 1 expects the plan and spec commits on `feat/consent-pr2` while Prerequisite 1 cuts it from `main`.
  - R1-M12 — the same as R2-I1a (fixed).
  - R2-m3 — an already-stopped CANCEL raises no appointment To-do; the spec should say whether it must.
  - R2-m7 — resolved by danlo's decision 2 (Task 5 now pins the chosen wording).
  - R2-m8 — the same as R1-I4 (fixed: S7).
  - R2-m9 — G9 (leading punctuation, inner hyphens) is not yet written into spec §4.2 step 1 or §8, and runs opposite to YES/NO's "trailing only" (`automations.ts:815-821`).
  - R2-m10 — recorded as an FYI (External facts), not changed.
  - R2-m11 — resolved by danlo's decision 1 (CA added).
  - R2-m12 — recorded under Known residuals.
  - R2-m14 — resolved by danlo's decision 6 (the property now uses `matchConfirmationReply`).
  - R2-m15 — "the carrier blocked it" may read as jargon (DESIGN.md voice); danlo's copy call.
  - R2-m17 — the corrected decision 12's "Telnyx answers a keyword it knows before BIS sees the text" is an inference from F1/F4, not a documented sentence.
  - R3-m1 — Esc in the Resume note input does nothing (`contact-drawer.tsx:106-115` keeps a focused input from closing the drawer); the DoD line "Esc still closes the drawer" is untrue there.
  - R3-m3 — the texts route ignores `account.error` (the contact page logs it) and drops `guessed` (#123 m3).
  - R3-m5 — the e2e's random `four()` suffixes can collide (about 1 in 3,000), which `createContact` would dedupe.
  - R3-m9 — a no-phone contact flashes a Messages skeleton, then nothing; after a pick only the status line shows until the re-read.
  - R3-m10 — the route scan misses a send reached through `lib/voice/textback` or a transitive import (scan 1 still catches a provider bypass).
  - R3-m12 — the To-do buttons call `router.refresh()` twice; focus is lost when the row leaves the list.
  - R3-I7's aside — `textsContextFor` has no unit test of its own.
  - R1-N4 — `CUSTOMER_STOP_METHODS` and 0055's list, and `RESUMABLE_METHODS` and 0055's Resume list, are tied by no test (only `keyword` is used as a prior row); a loop test over each method as the prior row would tie them.
  - R1-N7 — the import write takes one advisory lock per row until its single statement commits; if "to write, total" is above about 1,000, split it into batches.
  - R1-N10 — choice 28 ("a grant never lifts a stop") is enforced only by callers: a `resubscribed` with a method other than `start_keyword`, `staff`, `staff_undo` or `unsubscribe_page` has no state rule; an allow-list rule in 0055 would close it.
  - R2-m-a — a non-blank sentinel `autoresponse_type` (say "none") on ordinary texts would silence BIS-only replies; low risk, and Task 16 step 11's row 3 (a word only BIS matches) would show it.
  - Review corrections not yet made: G15 should say why §8's "the composer is disabled" e2e line was dropped (the A2P line shows first on the fixture account); G12's "Stop texts takes no note" should either be written into spec §4.2 ("optional note") and §6's example, or reversed.

## QUESTIONS FOR DANLO

**None open.** danlo decided the four questions of the first draft, and two more, on 2026-09-28 (Prerequisites item 2); the plan is written to those decisions. FYIs only:

1. **Consent replies are not billed** (G11). A stop, start or help reply is not an automation, a composer reply or a missed-call text-back, so the M7a rule does not bill it, and Task 14 pins that no consent reply records usage. Yours to change if it should.
2. **An accented business name makes every reply longer.** "Jardinería López" puts most of BIS's replies at 2 segments and Telnyx's bilingual ones at 3 (Task 5's measurement). The spec's own words stay unaccented; the name is the business's.
3. **Decision 10 was amended** (S7). It is one of the orchestrator's technical defaults, not one of your binding decisions: BIS now sends its own confirmation only when Telnyx did not already answer, which is what decision 12 and §4.2 already said.
4. **The phrase list follows your two decisions of 2026-09-28.** English: "please stop", "stop please" and a repeated "stop" hold only as the WHOLE message ("Please stop!!" holds; "Please stop by Thursday" does not). Spanish: the verb forms hold only about messages ("No me mande más mensajes" holds; "No me mande la factura" does not), "Bórreme" only as the whole message, and "PARAR PARAR" as a repeated stop word. Two refinements, so you are not surprised: a bare ESCRIBIR request holds as the whole message ("Dejen de escribirme", "No me escriba" — writing to the customer is messaging, and a missed stop is worse than a false hold), while the bare MANDAR / ENVIAR forms still need a message object ("Dejen de mandarme" alone does not hold: "mandar" can mean a crew or an invoice); and "No me mande mensajes de voz, mejor texto" does NOT hold, by the plan's choice, because it asks for texts rather than against them (the same for "Quíteme de la lista de espera", a waiting list). Tests pin every one of these.
5. **Leave the shared messaging profile alone until Task 16 step 8 is done** (review R1-N8): do not delete it or clear its opt-out list during this week's A2P work. Its list is what step 7 imports, and moving a number off it may leave that number's opt-outs behind (A5).

## Next plans

- **Go-live of texting, not a merge gate** (spec §5): PR-2 merged (this plan), Task 16 steps 7–8 done once and steps 10 and 11 done per business; A2P approved per business; counsel's reading of the adopted FCC order (item 3); danlo's two hardening-sprint items (item 4).
- **PR-3 (consent chain):** email kinds, scan 4 for them, the footer and headers, the token, `/u/[token]`, the one-click endpoint, the 0049 fold, the Email row beside this PR's Texts row (the Messages block's second row; its skeleton already reserves the space). Its `/u/[token]` writes must source each to one event, never the token (S10).
- **A migration that drops `automation_settings`'s quiet columns** and `bumpHeldForAccount` (PR-1's Next plans; unchanged).
- **A per-contact time zone** (spec §9): the gate already takes one.

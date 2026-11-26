# OpenAI model switch: off the models OpenAI retires in January 2027

Date: 2026-11-26. Tier: HIGH (voice call routing and every AI feature). Status: plan only, nothing built.
Owner's target: production fully switched by **2027-01-06**, with a rollback that needs no build where one exists.

## 1. Why, and what nobody has measured

OpenAI's deprecations page (read 2026-11-26) retires what production runs on:

| Model | Shutdown | OpenAI's replacement |
|---|---|---|
| gpt-4o-mini (and gpt-4o, gpt-4.1, gpt-4.1-mini) | 2027-01-14 | gpt-6-luna |
| gpt-realtime, gpt-realtime-2025-08-28 | 2027-01-20 | gpt-realtime-2.1 |
| gpt-4o-mini-transcribe-2025-03-20 | 2027-01-20 | gpt-4o-mini-transcribe-2025-12-15 |
| gpt-4o-mini-transcribe (alias), -2025-12-15 | 2027-02-26 | gpt-live-transcribe or gpt-transcribe |
| gpt-4o-mini-tts | 2027-01-06 | gpt-realtime-2.1-mini |

OpenAI does not say which snapshot the bare alias `gpt-4o-mini-transcribe` points at. This plan treats it as dying 2027-01-20.

Assumptions. Each one is either tested in Step 0 or named where it matters.
- **A1.** gpt-6-luna has no public parameter notes. Unknown: Chat Completions or Responses; `max_tokens` or
  `max_completion_tokens`; reasoning effort and its default; JSON mode; tools on Chat Completions. The GPT-6.2
  guide says tools need Responses and to omit temperature. Luna may or may not follow it. (We send no temperature today.)
- **A2.** Luna's price is not read. `prices.ts` must hold it before any task row can name luna: the row's type does not compile otherwise.
- **A3.** gpt-realtime-2.1 accepts our flat accept body unchanged. The SIP guide's older section shows
  `"model": "gpt-realtime-2.1"` on `/v1/realtime/calls/{id}/accept` with `realtime.call.incoming`. Not measured.
- **A4.** gpt-transcribe works as `audio.input.transcription.model` in a Realtime session and emits the same
  `conversation.item.input_audio_transcription.delta` and `.completed` events. Not measured. We send no `language`
  today, so the `languages` rename does not touch our body.
- **A5.** Vercel applies an env change only to a new deployment. Instant Rollback serves an older deployment with the
  env it was built with, and it pauses auto-promotion until undone. From Vercel's docs as remembered, not re-read today.
- **A6.** The repo secret `OPENAI_API_KEY` may belong to a different OpenAI project than production's voice project. Model access can differ by project.
- **A7.** A refused accept ends the SIP leg as failed or no-answer, so the model-down handoff rings the transfer
  number (voice-setup.md, "Taking the phones back", lever 3). The error heartbeat is in code; how the leg ends in this case is not measured.

## 2. Where the brief and the source disagree (the source wins)

1. `corpus-lib.ts:32`'s gpt-4o is **not a judge**. A person grades every corpus rule (owner decision B5,
   `docs/runbooks/sofia-corpus.md` section 5). gpt-4o is the corpus's `--phone-engine chat` fallback. It still dies 2027-01-14.
2. The router **has** a fallback slot (`tasks.ts:41`), but the gateway tries it only after a *transient* provider
   error: network, 408, 429 or 5xx (`gateway.ts`, step 7). It never fires on a 400 (a param refused) or a 404 (a model gone).
   It covers a luna outage. It is not a rollback.
3. `owner-line/session-config.ts:22` spells `"gpt-4o-mini-transcribe"` itself, instead of reading `TRANSCRIBE_MODEL`.
   Changing only the constant would leave the owner line on the dying model.
4. **Phone calls cannot reach Preview.** OpenAI's webhook points at `app.bis-rgv.com/api/voice/incoming`
   (voice-setup.md Step 1). Telnyx's TeXML app points at production. `REALTIME_MODEL` on Preview tests the browser demos only (WebRTC, the same session builder), never SIP.
5. Changing an env var means a redeploy (A5). The only rollback that needs no build is Vercel Instant Rollback.
6. The existing spike (`scripts/realtime-spike.ts`) strips the audio block before `session.update`. It has never checked a transcription model.
7. gpt-realtime itself never met the corpus bar (100% of MUST NOT, at least 90% of MUST). Runs 1 to 3 on
   2026-10-22 all failed it. The corpus covers only the two trade modules, and those are paused everywhere. No corpus tests the prompt that live calls run.
8. gpt-4o-mini-tts is used nowhere. Its 2027-01-06 date needs no work.

## 3. Inventory: every model use

| # | file:line | What it does | Model today | Dies | Goes to |
|---|---|---|---|---|---|
| 1 | apps/web/src/lib/ai/tasks.ts:52 | `web_chat`: website chat reply and capture; tools; max_tokens 500; ungated | gpt-4o-mini | 01-14 | luna |
| 2 | tasks.ts:55 | `call_summary`: staff summary; no params; fact-line fallback | gpt-4o-mini | 01-14 | luna |
| 3 | tasks.ts:60 | `call_card`: reason and quote; max_tokens 300; json_object | gpt-4o-mini | 01-14 | luna |
| 4 | tasks.ts:66 | `call_proposals`: suggestions; max_tokens 2000; json_object | gpt-4o-mini | 01-14 | luna |
| 5 | tasks.ts:72 | `record_summary`: record page paragraph; max_tokens 400 | gpt-4o-mini | 01-14 | luna |
| 6 | apps/web/src/lib/ai/prices.ts:9 | The gateway's price table and allow-list | gpt-4o-mini | 01-14 | add luna; drop 4o-mini |
| 7 | apps/web/src/lib/ai/providers/openai.ts:6, :18 | Chat Completions URL; `modelBodyFields` turns params into fields | (any) | | per-model rules go here |
| 8 | apps/web/src/lib/voice/session-config.ts:13 | `REALTIME_MODEL` = env, else default | gpt-realtime | 01-20 | gpt-realtime-2.1 |
| 9 | session-config.ts:15 | `TRANSCRIBE_MODEL`, a constant: caller speech to text | gpt-4o-mini-transcribe | 01-20 (assumed) | Step 0's winner |
| 10 | apps/web/src/lib/owner-line/session-config.ts:17, :22 | Owner line: `REALTIME_MODEL` and its OWN transcribe literal | both above | 01-20 | both above |
| 11 | apps/web/src/app/api/voice/incoming/route.ts:1487, :183, :476 | Phone receptionist: build the session, accept, socket | rows 8, 9 | | |
| 12 | apps/web/src/app/api/voice/web/session/route.ts:255, :274 | Website "Talk to Sofía" demo: client secret | rows 8, 9 | | |
| 13 | apps/web/src/lib/voice/prospect-demo.ts:205; app/(dashboard)/dashboard/demo/actions.ts:66; demo/prospect-demo.tsx:77 | Agency prospect demo (browser WebRTC) | rows 8, 9 | | |
| 14 | apps/web/src/lib/voice/finish-call.ts:1028-1035 | Writes each call's models, tokens and estimated cost (call_usage) | rows 8, 9 | | |
| 15 | apps/web/src/lib/voice/call-usage.ts:28-32, :35 | Realtime prices; 2.1 already priced; transcription unpriced | | | |
| 16 | apps/web/src/lib/voice/modules/corpus-lib.ts:32 | `PHONE_FALLBACK_MODEL`: corpus phone items on chat completions | gpt-4o | 01-14 | luna |
| 17 | apps/web/scripts/sofia-corpus.ts:56, :83, :173 | Corpus: web chat = the `web_chat` row; Realtime socket; chat call | rows 1, 8, 16 | | |
| 18 | apps/web/scripts/realtime-spike.ts:49; scripts/owner-line-corpus.ts:37 | Spike and owner-line corpus on `REALTIME_MODEL` | row 8 | | |
| 19 | .github/workflows/sofia-corpus.yml:47, :67 | Input descriptions name gpt-realtime and gpt-4o; no model input | | | PR 1, PR 6 |
| 20 | .github/workflows/ci.yml:670 | e2e holds `OPENAI_API_KEY`, but `AI_PROVIDER: fake`: no model call | | | nothing |
| 21 | apps/web/e2e/ai-settings.spec.ts:51 | Seeds a ledger row named gpt-4o-mini. An old row stays valid | | | keep |
| 22 | packages/db tests; migrations 0086:38, 0116:37 | Fixture data. `model` columns are free text, 1 to 64 chars | | | no migration |
| 23 | apps/web/src/lib/concierge/guards.ts:33; lib/proposals/generate.ts:352 | Comments that reason about gpt-4o-mini | | | reword in PR 2, PR 2b |

Not used anywhere: embeddings, moderation, TTS, Whisper, the Responses API, images. The root `scripts/` folder has no
model use. `texml/route.ts:678` dials `sip.api.openai.com` and names no model, so it is unaffected.

## 4. Step 0: the spike (no production change)

It reuses the manual workflow `sofia-corpus.yml`. Its rules stay as they are: the key sits on one step, the log is
public, an OpenAI error is printed as code, type and param only, and every input is synthetic. PR 1 adds:

- **(a) `step=model-spike`**, a new `scripts/model-spike.ts`. For luna and each of the five tasks, it sends a message
  shaped like the real one with these variants. V1: today's row exactly. V2: `max_completion_tokens` instead of
  `max_tokens`. V3: V2 plus `reasoning_effort` set to none, then minimal, then low. For `web_chat` only: tools plus
  `tool_choice: "none"` on Chat Completions, then the same on `POST /v1/responses`. Every accepted variant runs 5 times.
  For each call it records the HTTP status, the error param, finish_reason, prompt, completion and reasoning tokens,
  latency, empty content or not, whether the JSON parses (JSON tasks), and whether a tool call came back (`web_chat`).
  It also runs `GET /v1/models`, filtered to `gpt-6*`, `gpt-realtime*`, `gpt-transcribe*` and `gpt-live*`, to show what this key's project can see (A6).
- **(b) `step=spike` takes a new `realtime_model` input** and adds two checks. First, the FULL session config
  (audio block kept) with each transcription candidate: gpt-transcribe, gpt-live-transcribe and
  gpt-4o-mini-transcribe-2025-12-15. It records `session.updated` or the error param. Second, an audio round trip: one
  session speaks one fixed English and one fixed Spanish sentence (model audio, no person recorded). A second session,
  using the candidate transcriber, is fed that audio. The spike records whether `.delta` and `.completed` arrive, the usage shape, and the transcript (capped at 120 characters).
- **(c) `step=corpus` takes `realtime_model`** (a fixed choice: gpt-realtime or gpt-realtime-2.1). It is passed as `REALTIME_MODEL` to the one step. There is no free text.

**Why the transcription events matter.** `classifyOutcome` (`call-state.ts:265`) labels a call with no caller transcript
as `spam`. A spam call is not billed and is not counted in "calls answered". The recorded-message hangup judges `.delta`
(`call-events.ts:115`). A transcriber that sends different event names, or no deltas, would fail silently on every call.

**What the findings decide (D1).**
- The parameter map. For each task, take the cheapest accepted variant that passes all of these: 5 of 5 answers non-empty
  and valid, finish_reason `stop`, and p95 latency under the caller's limit. The limit is 10 s for the summary, the card
  and the proposals (`summary-service.ts:89`, `call-card.ts:226`, `generate.ts:371`), and the web chat's own budget for the chat.
- If luna refuses a param, the fix goes **per model, not per call site**. A `MODEL_RULES` table beside `PRICES` names
  each model's cap field, its accepted reasoning efforts, JSON mode yes or no, and its API (chat or responses).
  `modelBodyFields` reads it. A unit test fails if any task row sends a param its model's rule refuses. No call site
  names a model (the gateway's header), so no call site changes.
- If luna takes tools only on Responses, PR 2c (a Responses path) lands before the web chat moves. If luna refuses Chat Completions altogether, PR 2c lands before every text task.
- If reasoning uses up the cap (finish_reason `length`, empty content), raise the cap by the measured reasoning p95 and
  set the lowest effort luna accepts. Reasoning tokens bill as output, so the cost line is re-run.
- If 2.1 refuses a text-only session, corpus phone items run on the chat engine (PR 3), and the results sheet says so.
- The transcriber is the first candidate that sends `.delta` and `.completed` in both languages. gpt-transcribe is
  preferred, because the transcription guide names it for in-session use. -2025-12-15 is a stopgap only (it dies 02-26).

The orchestrator dispatches it with `gh workflow run`. It costs a few cents.

## 5. PR sequence

Each PR has one tier, ships on its own, and stays under 800 changed lines. None adds a migration. Only PR 1 changes the pipeline.

- **PR 1. The spike and the corpus take a model (HIGH: a CI file that holds a secret).** Files: `sofia-corpus.yml`,
  `scripts/model-spike.ts` (new), `scripts/realtime-spike.ts`, `ci/ci-workflow.test.ts`, `ci/realtime-spike.test.ts`,
  `docs/runbooks/sofia-corpus.md`. About 500 lines. Production does not change. The review probes the key's scope, the no-message rule and the fixed choices.
- **PR 2c. Responses path (HIGH; only if D1 says so).** A Responses branch in `providers/openai.ts`, chosen by `MODEL_RULES.api`. About 400 lines.
- **PR 2. Internal text tasks to luna (MEDIUM).** The `call_summary`, `call_card`, `call_proposals` and `record_summary`
  rows move to luna with D1's params. gpt-4o-mini becomes each row's `fallback` until PR 6. Luna's price goes in
  `prices.ts`, read from OpenAI's page that day. `MODEL_RULES` and its conformance test land here. Tests that pin
  gpt-4o-mini move: `gateway.test`, `gateway.routes.test`, `prices.test`, `summary-service.test`, `call-card.test`,
  `proposals/generate.test`, `record/ai-summary-service.test` and `ai-summary/route.test`. About 350 lines.
  Every caller already has a non-AI form (the gateway's header). A luna failure means fact-line summaries and no card,
  never a broken call. Before merging: price the last 30 days of `ai_ledger` tokens at luna's price against each account's
  budget, so no account goes over its budget just from the switch. Rollback: Instant Rollback right after the deploy, or a
  one-line revert PR. `AI_GATEWAY_OFF=1` plus a redeploy is the kill switch.
- **PR 2b. Website chat to luna (HIGH: replies customers read).** The `web_chat` row and the `guards.ts` comment.
  `scripts/sofia-corpus.ts` follows the row on its own. Gate: the corpus web items on luna against a gpt-4o-mini baseline,
  paired as in section 6, and danlo chats on BIS's chat page (one English, one Spanish, one lead). About 150 lines.
- **PR 3. The corpus phone fallback leaves gpt-4o (LOW).** `PHONE_FALLBACK_MODEL` becomes luna and sends luna's params
  through `modelBodyFields`. Also the `corpus-lib.test` pin, the yml description and one runbook line. About 40 lines. No production effect.
- **PR 4. The voice models can be set by env, defaults unchanged (HIGH: voice routing).** `TRANSCRIBE_MODEL` becomes
  `process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"`. `owner-line/session-config.ts:22` reads `TRANSCRIBE_MODEL`.
  Tests prove two things. With no env set, every accept body is byte for byte today's. An override reaches the phone
  accept, the website demo, the prospect demo, the owner line and `call_usage`. Proposed `.env.example` lines go in the
  report, for bis-platform to land. About 80 lines.
- *Then the env stages in section 6 (danlo).*
- **PR 5. New defaults in code (HIGH), only after G3 and G4 pass.** `REALTIME_MODEL` defaults to gpt-realtime-2.1 and
  `TRANSCRIBE_MODEL` to D1's winner. The pins in `session-config.test` and `owner-line/session-config.test` move.
  voice-setup.md's env reference and sofia-corpus.md's "default model" line are updated. About 60 lines. Order: merge,
  deploy, then danlo removes the two env vars and redeploys. The values are equal, so behaviour does not change.
- **PR 6. Retire the old names (LOW), by 2027-01-12.** Remove the gpt-4o-mini fallbacks and its price row, so no row can
  name it (the type stops compiling). Update the workflow descriptions. Keep `call-usage.ts`'s gpt-realtime price, so old rows can be re-costed. About 80 lines.

## 6. Gates for Sofía (gpt-realtime-2.1 plus the new transcriber)

**G1. Corpus, paired.** On the same day, with the same corpus version (insurance v3 and events v3, hashes in `pin.ts`),
repeat=3, all 3 must pass per item: one run on gpt-realtime (the baseline) and one on gpt-realtime-2.1. danlo grades
both (B5). 2.1 passes when, for each module and for each language: its MUST NOT failures are no more than the
baseline's, and its MUST rate is at least the baseline's minus 3 points. The absolute bar is recorded beside it (Q2).
The owner-line corpus (`scripts/owner-line-corpus.ts`, run locally; O-4's bar) must stay at 10/10 × 3 on 2.1. danlo runs
it, or Claude runs it with a throwaway key at his request, as O-4 was run. Recommended (Q2): a 12-item base corpus slice,
half Spanish (message, booking, hours, price, asking for a person, caller-ID name), as a LOW PR before the runs. The
live prompt has no corpus today. A fix round is structured fields or code checks, never wording alone (three wording-only
runs did not converge on gpt-realtime, 2026-10-22). At most two rounds (section 8).

**G2. Preview, browser only (section 2, item 4).** danlo sets `REALTIME_MODEL=gpt-realtime-2.1` and
`TRANSCRIBE_MODEL=<winner>` on Preview and redeploys the branch. He opens `/dashboard/demo` and has one English and one
Spanish conversation. Pass: the greeting is not clipped, the voice is marin, turn-taking feels like today's, Spanish gets
Spanish, and no "unavailable". This proves `client_secrets` accepts the config. It does not prove SIP. ASSUMPTION: Preview holds an OpenAI key. If it does not, skip G2 and say so.

**G3. Production, real calls (danlo places every call).** The window is a weekday morning danlo picks; Dec 10 is
proposed. Production gets about 0.7 calls a day (81 in 120 days), so callers are exposed for minutes before a verdict.
1. danlo sets `REALTIME_MODEL` and `TRANSCRIBE_MODEL` in Production and redeploys.
2. One warm-up call, not graded: the first call after a deploy can hit a cold start (F-032, 2026-11-12).
3. Six graded calls to the BIS account's live number, from danlo's cell. His cell is the owner line's verified cell:
   when the PIN prompt plays, he presses pound for the receptionist (voice-setup.md, O-5 call 3). His number maps to the
   "Dan Lopez" customer, so Sofía may greet him as a known caller. For one new-caller call he withholds his number (*67).
   A withheld caller has no history (`texml/route.ts:464`). ASSUMPTION: the carrier delivers a withheld call. The
   "Caller" contact 227ec777 is for email-forward tests and plays no part here. Never call from, or about, a client's number.
   The calls: (1) English message; (2) Spanish message; (3) English booking or reschedule; (4) Spanish hours or price
   question; (5) English, asks for a person; (6) silent for 35 s, where the silence guard ends the call with its fixed
   sentence. Then one owner-line call: right PIN, the three questions.
4. For every call, read: Vercel logs on `/api/voice/incoming` show "call accepted" and no "failed to accept call". The
   calls row has the expected outcome (never spam for calls 1 to 5), a transcript WITH caller turns (this proves
   `.completed` arrives), and a summary that matches the call. The `call_usage` row names gpt-realtime-2.1 and the
   transcriber. The staff alert email arrived. Step 6 of voice-setup.md is walked.
   Pass: all six calls and the owner-line call. Dead air, a refused accept, or a missing caller turn means rollback at once.

**Rollback (named).** Vercel Instant Rollback to the deployment before the env change (no build). Or remove both vars and
redeploy. This works only until 2027-01-20. After that there is no old model to return to, and the floor is "Taking the
phones back" (voice-setup.md: the per-account forward, or `VOICE_FORWARD_TO`).

**G4. Watch, 7 days (orchestrator, read-only, daily).** `ops_heartbeats` errors on `voice.sip_webhook`; "failed to
accept call" lines; the share of spam against the 30 days before; calls with no caller turn; `call_usage` cost per minute
against gpt-realtime rows; summaries present. At about 5 calls a week, the watch catches breakage, not small quality
shifts. danlo's own calls are the quality evidence. For PR 2 and PR 2b: one real call's summary, card and proposals are
read on the call page, and for 48 h `ai_ledger` shows luna, `ok`, and no rise in `provider_error` or `timeout`.

## 7. Cost (an estimate)

**Realtime.** In `call-usage.ts`, the two models differ only in text output: $16 becomes $24 per 1M tokens (+$8). Audio
in and out, cached input and text input cost the same. So the delta per call is text output tokens × $8 per 1M.
ASSUMPTION: a 1.22-minute call (production's average, 2026-11-26) makes 300 to 2,000 text output tokens (the transcript
of her speech plus tool arguments). That is $0.0024 to $0.016 a call. At 81 calls in 120 days (about 20 a month), it is
$0.05 to $0.33 a month, or $0.19 to $1.30 over 120 days. Before G3, replace this with `call_usage`'s measured
`output_text_tokens` (agency-only, read-only on production).
**Transcription.** Unpriced today (`call-usage.ts:35`). gpt-transcribe's price is unknown. The row stores its tokens and seconds, so it can be costed later.
**Text tasks.** gpt-4o-mini costs $0.15 in and $0.60 out per 1M. Luna's price is unknown (A2). PR 2's check: the last
30 days of `ai_ledger` input tokens × luna's input price, plus output tokens (with the measured reasoning share) × luna's output price.

## 8. Plan B

**Trigger.** 2.1 fails G1 after two fix rounds (D3, 2026-12-16). Or it fails G3 for a reason no fix can reach: a refused accept, dead air, or unusable Spanish.
- **B0, first, inside OpenAI.** gpt-realtime-2.1-mini, or the GPT-Live path (gpt-live-1, `/v1/live/sessions`,
  `live.transport.incoming`). That is a new accept flow, so it needs its own spike first.
- **B1. A time-boxed ElevenLabs Agents trial, Dec 17 to 23.** danlo creates the account. Nothing is built before his OK.
  The trial is a test agent with Sofía's prompt and the corpus scripts read aloud. No client number, no BIS data. Decision on 2026-12-28.
- **The honest limit.** A new vendor means new SIP routing, tools, webhooks and every leg of `finishCall`. That will not
  reach production by 2027-01-20. So if 2.1 works but scores under the bar, it ships by Jan 20 with the gaps logged, and
  B1 follows later. If 2.1 does not work at all, calls go to people from Jan 20 (the per-account forward, or `VOICE_FORWARD_TO`) until a replacement passes G3.

## 9. Timeline

| Date | What | Who | Decides or blocks |
|---|---|---|---|
| Nov 30 to Dec 2 | PR 1 built, reviewed, merged | bis-voice, reviewer | blocks the spike and corpus runs |
| Dec 2 | Spike; corpus on gpt-realtime and on 2.1 (repeat 3) | orchestrator | |
| Dec 3 | **D1**: luna params, Responses or not, the transcriber, 2.1 text-only | orchestrator | blocks PR 2c, 2, 2b, 4 |
| Dec 3 to 4 | Base corpus slice (if Q2 says yes), then run it on both models | bis-voice, orchestrator | |
| Dec 4 to 8 | **danlo grades** every corpus run | OWNER | blocks D2 |
| Dec 4 to 8 | PR 2c (if needed), PR 2, PR 3, PR 4 merged | implementers | PR 4 blocks G2 |
| Dec 9 | **D2**: does 2.1 pass G1? Yes: G2. No: fix round 1 | OWNER, orchestrator | blocks G3 |
| Dec 9 | G2: Preview env and the demo conversations | OWNER | |
| Dec 10 | G3: production window and calls | OWNER | blocks PR 5 |
| Dec 10 to 14 | PR 2b, then danlo's chat on BIS's chat page | implementer, OWNER | |
| Dec 10 to 17 | G4 watch | orchestrator | |
| Dec 9 to 16 | Only if D2 fails: rounds 1 and 2, each re-run and re-graded; G3 moves to Dec 17 or Dec 21 | | |
| Dec 16 | **D3**: Plan B trigger | OWNER | |
| Dec 17 to 18 | PR 5 merged; env vars removed | implementer, OWNER | |
| Dec 17 to 28 | Only if D3: ElevenLabs trial, decision Dec 28 | OWNER | |
| **Jan 6** | **TARGET.** danlo reads OpenAI usage by model: no requests to a retiring model for 48 h | OWNER | |
| Jan 12 | PR 6 | implementer | |
| Jan 14, Jan 20, Feb 26 | Shutdowns | | |

Owner items: every Vercel env change (Preview and Production), every real call and chat, corpus grading, the OpenAI usage check, and the Plan B account and decisions.

## 10. Open questions for danlo

- **Q1.** Can you grade from Dec 4 to 8 and call on Dec 10? Is Dec 21 to Jan 4 a freeze?
- **Q2.** gpt-realtime never met the absolute bar. Do you accept the paired bar (2.1 no worse than gpt-realtime on the same day)? Recommended: yes. And should we add the 12-item base corpus? Recommended: yes.
- **Q3.** Should every account move at once by env, in a window (recommended, at about 0.7 calls a day)? Or should we first build a per-number trial switch (about 150 lines, HIGH) so only the BIS line moves?
- **Q4.** If luna costs several times what gpt-4o-mini does, should we raise account AI budgets, or accept more fact-line summaries?

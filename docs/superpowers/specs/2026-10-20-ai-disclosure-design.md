# S-47 part a: Sofía says she is an AI, measured first (F-034, decision 20, migration 0093)

Status: approved in conversation 2026-10-20 (owner). Part a of S-47 (parallel work, `docs/crm-features.md`
§4.3); parts b–e follow in their own specs: b the insurance P&C and events guardrail modules (F-174),
c structured hours/services/prices (F-037 part), d the one switch (F-084), e identity checks by risk (F-116).

## 1. Why

Decision 20 (owner, 2026-10-05): every assistant discloses by default, measured first on one account for
four weeks, counsel reads the wording before every account gets it. Today Sofía is told the opposite:
"Do not volunteer that you are automated" (`apps/web/src/lib/voice/system-prompt.ts:72`), and nothing tells
a caller the call is transcribed.

No account has real call volume yet (production, 28 days to 2026-10-20: BIS 223 calls, 208 of them spam;
Resaca 48, the demo seed; 956 Woodworks 20, all spam). A before/after trial would measure nothing, so the
trial splits calls instead: on a Trial account a fair coin decides, per call, whether Sofía discloses, and
the two halves are compared as calls arrive.

## 2. Owner decisions (2026-10-20)

- **D1 Order:** S-47 runs a → b → c → d → e; disclosure first because its trial is a calendar clock.
- **D2 Trial design:** per-account setting Off / Trial / On; Trial = a random half of calls disclose, each
  call stamped; BIS's own line On at deploy; the first real client with volume goes on Trial.
- **D3 Wording** (said after the operator's greeting, in the call's language):
  - EN: "I'm {persona}, an AI assistant. This call is transcribed so the team can follow up."
  - ES: "Soy {persona}, una asistente de inteligencia artificial. Esta llamada se transcribe para que el
    equipo le dé seguimiento."
- **D4 Web chat:** on Trial or On the chat is always labelled AI (header + first message); no split.
- **D5 Why a call disclosed (2026-10-20):** each stamped call also records the setting that decided it,
  `calls.disclosure_setting` ('trial' or 'on'). The results card counts ONLY Trial calls; an On call is
  "outside the trial" and goes to the not-counted footnote, so moving an account from Trial to On never
  pours every-call-discloses calls into the "Said it was AI" half.
- **D6 Asked for a person (2026-10-20):** each half gets its own "Asked for a person" figure (counted calls
  with `handoff_requested_at` set), and those calls are left OUT of "Hung up early" (hung up early =
  `outcome = 'abandoned'` AND `handoff_requested_at is null`): a handed-off call classifies `abandoned` at
  socket close, and asking for a person is not hanging up.

## 3. Scope

**In:** the setting; the spoken sentence; the prompt's IDENTITY line per call; the per-call stamp; the
results card; the chat label; BIS On at rollout.
**Out:** owner-chosen wording variants; an unprompted offer of a person in the opening (Sofía already
offers one when asked); other states' recording-consent notices (F-127); turning any account beyond BIS
and the trial client On before counsel reads the wording (an ops step, not code).

## 4. Data (migration 0093, tier HIGH)

- `voice_profiles.disclosure text not null default 'off'` with
  `voice_profiles_disclosure_check (disclosure in ('off', 'trial', 'on'))`. Writable only where the
  agency writes voice settings today (same grants and RLS path as the other agency-only voice columns;
  the plan reads 0019 and 0053 and pins it). Owners can read, never write (decision 28: guardrails are
  never owner-editable).
- `calls.disclosed boolean` (nullable): set once at call start for every call whose profile is Trial or
  On; null for Off and for every call before 0093. Server-written only, like the rest of `calls`.
- `calls.disclosure_setting text` (nullable) with `calls_disclosure_setting_check (disclosure_setting in
  ('trial', 'on'))` (D5): the setting that decided this call, stamped on the same insert as `disclosed`,
  only for Trial/On; Off sends neither. Server-written only.
- The pairing is enforced by the database (Task 1 review fix, 2026-10-20):
  `calls_disclosure_pair_check ((disclosed is null) = (disclosure_setting is null))`, so the two are null
  together or set together, and `calls_disclosure_on_check (disclosure_setting is distinct from 'on' or
  disclosed)`, so an On call is always disclosed. Every row before 0093 is null and null and passes both.
- Additive and safe under the running build (defaults and nullable). Apply order: bis-ci, production,
  parity, merge. The client-write digest must stay unchanged.

## 5. Behaviour

### 5.1 The phone call
- At call start (the incoming route, where the greeting and prompt are built) the server resolves
  `disclose`: Off → false; On → true; Trial → a fair coin (`crypto.randomInt(2) === 1`, never
  `Math.random`). It stamps `calls.disclosed` with that value, and `calls.disclosure_setting` with the
  setting that decided it (D5), on the call row it already writes; a stamp
  failure is logged by id and the call goes on (it disclosed or not as decided; the call is then simply
  left out of the results).
- `openingGreeting` (`lib/voice/greeting.ts`) gains `disclose: boolean` and `personaName`. When true it
  appends the D3 sentence after each greeting in that greeting's language (on a bilingual line: English
  greeting + English sentence, then Spanish greeting + Spanish sentence), inside the same word-for-word
  instruction. When false the instruction is byte-identical to today's.
- `buildSystemPrompt` gains `disclosed: boolean`. When true the IDENTITY line reads: you already told the
  caller you are {persona}, an AI assistant; if asked, confirm it plainly; never claim to be human; offer
  a person (or a message) if they would rather. When false it is byte-identical to today's line. "Never
  claim to be human" holds on every call either way.
- Spam screening and the robocall paths are unchanged; a call screened before the greeting is stamped as
  decided but excluded from results by outcome.

### 5.2 The website chat
- When the account's setting is Trial or On: the chat header reads "{persona} · AI assistant" /
  "{persona} · asistente de IA", and the first assistant message carries one sentence saying she is an AI
  assistant and the chat is saved so the team can follow up (EN/ES, in the page's language). The chat's
  prompt gets the same disclosed IDENTITY line. Off: unchanged.

### 5.3 The results card (agency only)
- On the account's Voice settings page, under the setting, visible to the agency only: two columns,
  "Said it was AI" and "Didn't", each with: calls counted, booked %, hung up early % (`outcome =
  'abandoned'` AND `handoff_requested_at is null`, D6), and asked for a person % (`handoff_requested_at is
  not null`, D6). Counted = finished calls stamped `disclosure_setting = 'trial'` (D5), excluding
  `outcome = 'spam'`. A footnote: "{n} calls not counted (spam, or outside the trial)" — finished calls
  that are spam, unstamped, or stamped by On.
- No comparison sentence until each column has at least 30 counted calls; until then: "Not enough calls
  yet to tell." Past that, the card shows the numbers only. It never declares a winner; the owner decides.
- Loaded, empty ("No calls since the trial started") and error states; English and Spanish; tokens only;
  no hero (rule 11).

### 5.4 The setting
- On the same Voice settings page (agency only): a three-way choice Off / Trial / On, saved with the
  page's own Save (one primary per card, rule 8), with one line explaining each. Changing it affects the
  next call; calls already stamped keep their stamp.

## 6. Copy

All strings in `messages.ts` with `.es` twins; the spoken D3 sentences live in the greeting builder as
constants (they are speech, not UI), pinned by test in both languages. Spanish UI copy is usted, except
the website chat's two strings (its label and first-message sentence), which follow the chat's own existing
register, tú (`lib/concierge/strings.ts`): "…para que el equipo te dé seguimiento." The spoken phone
sentence stays exactly D3 (usted, "le").

## 7. Testing

- Greeting: Off byte-identical to today (en, es, both); Trial/On appends the right sentence per language;
  bilingual order.
- Prompt: disclosed vs not; "never claim to be human" in both.
- Coin: `crypto.randomInt` is the source (mocked); Trial stamps what it decided; On always true; Off null.
- Stamp failure: the call proceeds and logs ids only.
- Results: spam, null and On-stamped calls excluded (D5); second-account rows never counted; < 30 per
  half shows the not-enough line; percentages exact on fixed fixtures; a call that asked for a person is
  counted under "Asked for a person" and never under "Hung up early" (D6).
- Migration (0093): the two CHECKs; default; owners cannot write `disclosure`; authenticated cannot write
  `calls.disclosed` or `calls.disclosure_setting`; digest unchanged.
- e2e: with the setting On, the public chat header shows the AI label in English and Spanish; the agency
  sees the setting and the card; a client Owner sees neither control.

## 8. Rollout

1. 0093 to bis-ci, then production (MCP, once), then parity, then merge.
2. After deploy: set BIS's own line to On; one real call to the BIS line hears the sentence; read
   `calls.disclosed = true` on that call.
3. When the first real client with call volume goes live: set it to Trial; read the card after ~4 weeks
   or 30+ counted calls per half; counsel reads the wording; the owner decides whether every account goes
   On (an ops step).

## 9. Tiers (per task, binding rule 2026-10-19)

Migration 0093 HIGH; the call-start resolve + stamp MEDIUM (voice path, never-throw); greeting/prompt
MEDIUM; copy, UI, results card, e2e LOW. One final review + design review at the end.

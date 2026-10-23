# S-47 part c: business hours, services and prices that Sofía quotes exactly, with a version stamp on calls (F-037 part 1, migration 0095)

Status: owner decisions C1–C4 and the section 4 data model approved in conversation 2026-10-21/23; the
open sections were settled with the owner's "go with your recommendations" (C5–C10, 2026-10-23), and the
owner answered the first draft's questions the same day (C11–C17), read the twelve price sentences
(C18), and ruled on the two questions the implementation plan raised (C19, C20). There are no open
questions (section 10). Part c of S-47 (parallel work, `docs/crm-features.md` §4.3, row
"↳ F-037 (part)", 2.5–3 ew). Part a (disclosure, F-034) shipped in #279, part b (trade modules, F-174 part)
in #280–#283; d (the one switch, F-084) and e (identity checks, F-116 part) follow in their own specs.
F-037 part 2 (owner-edited versioned facts, visibility tiers, freshness; `crm-features.md` row 1500) builds
on the tables this part adds.

## 1. Why

Today everything Sofía knows about a business is two free-text boxes on the Voice page, Facts and Services
(`voice_profiles.facts`, `.services`), pasted into the prompt as they are
(`apps/web/src/lib/voice/system-prompt.ts`, the `WHAT YOU KNOW ABOUT …` block). Three problems follow:

- **Hours.** "Are you open?" needs today's weekday, the time in the business's zone and the hours. She has
  the first two (the prompt's "current date and time" line) and only prose for the third, so she works the
  answer out herself, and the after-hours setting "Follow business hours, then take a message" has no
  hours to follow: with that setting the prompt says nothing at all about being closed.
- **Prices.** The HARD LIMITS line lets her quote "a price … stated above", so any amount anywhere in the
  prose is quotable, in her own words, including arithmetic on it. The events module (S-47b, B4) already
  had to forbid per-guest multiplication and require "word for word"; every other account has no such rule.
- **No record of what she knew.** A call transcript can be read against the trade rules it ran under
  (`calls.trade_module_version`), but not against the facts, which change in place. When a caller says
  "she told me $40", nobody can tell whether $40 was in the facts that afternoon.

Binding decisions this spec obeys: **decision 28** (guardrails, and in part 1 the facts too, are edited by
the agency; owners edit facts later, in F-037 part 2) and **decision 21** (unchanged; nothing here touches
the urgent path).

## 2. Owner decisions

Fixed by the owner (2026-10-21/23):

- **C1 Business hours are their own record** on the voice profile: per weekday, closed or one or more
  open–close spans, in the same JSON shape as `calendars.open_hours` (migration 0016;
  `OpenHours` in `apps/web/src/lib/booking/slots.ts`). A "Copy from calendar" button pre-fills them. Sofía
  answers "are you open?" from them, and the after-hours rule uses them. The calendar keeps governing
  bookable times. Free-text hours left in Facts are flagged on the Voice page.
- **C2 Services with six price kinds:** `fixed`, `from`, `range`, `per_unit` (with a unit, e.g. guest,
  hour), `free`, `after_visit` (no number). Name in English, optional Spanish name, optional description in
  English and Spanish. Code renders each service into ONE fixed sentence in English and one in Spanish (the
  Spanish uses the Spanish name, else the English name). Sofía reads only that sentence. No per-unit
  arithmetic, ever.
- **C3 The list is the only source of prices.** Once an account has a price list, Sofía quotes prices only
  from it and ignores amounts in Facts; the Voice page flags dollar amounts left in Facts. With NO list and
  NO structured hours the prompt is byte-identical to today's (pinned by a digest test, as S-47b did).
- **C4 Every knowledge save is a numbered, immutable snapshot.** Every Voice page save that changes hours,
  services, Facts or the Services text writes a snapshot numbered per account (1, 2, 3…) whose payload is
  exactly what she is given. Calls and chats store `knowledge_version` at their start; a chat keeps its
  starting snapshot for its whole life. The call page links "What Sofía knew (#N)", agency only, like the
  trade-rules line.

Settled on the owner's "go with your recommendations" (2026-10-23):

- **C5 "Open now" is computed in code**, at call start (and at each chat turn), in the account's timezone,
  and given to her as one line: "Right now: open until 6:00 PM." / "Right now: closed; opens Monday at
  8:00 AM." The after-hours rule keys on that line when structured hours exist.
- **C6 The prompt.** With a list, a SERVICES AND PRICES block of the rendered sentences and a changed HARD
  LIMITS price line ("only from the list"). The trade-module blocks keep working unchanged: insurance never
  quotes; events' "word for word from the facts" is pointed at the list by the base prompt, not by editing
  the module (section 5.4). No module `VERSION` changes.
- **C7 Untouched:** the placeholder sanitizer (#283, `apps/web/src/lib/voice/tools/placeholders.ts`) and
  every S-47b behaviour.
- **C8 The Voice page** gains a Business hours card and a Services & prices card, each with its own Save
  (DESIGN.md rule 8, the 2026-09-23 amendment), existing components only, tokens only, English and Spanish
  copy keys.
- **C9 The snapshot is written in the same database transaction as the save**, by a `SECURITY DEFINER`
  RPC executed by `service_role` only, the repo's established pattern for an all-or-nothing write
  (`go_live`, 0063; `reserve_document_version` and `mark_document_version_ready`, 0077). A failed snapshot
  fails the save.
- **C10 Tiers and rollout** as S-47b: 0095 HIGH; renderers, prompt and stamping MEDIUM; UI, copy and e2e
  LOW. bis-ci → green CI → production `apply_migration` once → parity → merge only after production. No
  corpus run (the modules are paused); unit tests pin every rendered sentence per price kind in both
  languages, and the byte-identity digests.

The owner's answers to the first draft's questions (2026-10-23):

- **C11 Any amount she should say is a row on the list.** A deposit, a fee or a minimum with an amount
  becomes its own row (for example "Deposit to hold a date", fixed, $500). Refund and cancellation terms
  with no amount stay in Facts. The Voice page's Facts flag lists each amount it found, so the operator
  knows exactly what to move (5.3).
- **C12 No trade-module change.** The trade modules are paused (owner, 2026-10-23; a structured-intake
  redesign comes later), so S-47c changes no module file, no `VERSION` and no pin. Events v3's "the facts
  above" is pointed at the list by the base prompt alone (5.4).
- **C13 Insurance shows no amounts anywhere.** On an `insurance_pc` account the prompt lists service
  names and descriptions only, and the Voice page hides the price fields (5.4, 5.7).
- **C14 Closed means a message, unless they ask or it is urgent.** When structured hours say the business
  is closed right now, Sofía puts a caller through only when the caller asks for a person or a trade
  module's urgent path applies; otherwise she takes a message. Exactly how this meets the base prompt's
  offers is 5.2.1. Accounts without structured hours, and every account while it is open, are unchanged.
- **C15 Automatic snapshots are accepted.** The snapshot recorded at call or chat start when what she
  is about to be given differs from the latest snapshot, though no Voice page save recorded it (5.6), is
  part of C4.
- **C16 A `per_unit` row needs both units.** It cannot be saved without `unit_en` AND `unit_es`; there is
  no English fallback for the unit (the name keeps its fallback, C2). Enforced by the database CHECK
  (4), and validated first by the Save action so the operator gets a sentence instead of a refusal.
- **C17 Hours are readable by every account member,** as Facts already are: `business_hours` lives on
  `voice_profiles` and keeps that table's SELECT grant.
- **C18 The twelve price sentences (owner's read, 2026-10-23).** All six English sentences stand as
  drafted. Two Spanish ones change: `from` is "El precio de {N} es desde {A}." and `after_visit` is "El
  precio de {N} se lo damos después de una visita." The other four Spanish sentences stand. The table in
  5.1 is final, and the plan pins it as literal test fixtures.

The owner's rulings on the implementation plan's questions (2026-10-23):

- **C19 Closed hours change nothing under "Always take a message".** The 5.2.1 changes (the four offers of a
  person become "offer to take a message"; the closed TOOLS line) apply only under "Follow business hours,
  then take a message": `closedNow` requires that setting. "Always take a message" already holds at every
  hour, and its MESSAGES ONLY line (5.2.1 point 5) keeps saying when to put someone through, so the prompt
  never says both "only when the caller asks" and "or it cannot wait".
- **C20 A failed price-list read closes the price line.** When the read of the account's services FAILS (an
  error, not an empty list) on the phone, at chat creation or on an unstamped chat turn, the HARD LIMITS
  price line becomes a fixed closed line: she gives no price, says the business will confirm pricing and
  offers to take their details, so no amount left in the prose can be quoted while the list is unknown. The
  line is pinned in the plan ("- Do not give, confirm or estimate any price, rate or amount right now, not
  even one written above. If asked, say the business will confirm pricing and offer to take their
  details. This overrides any rule below that allows a price from the facts."; its last sentence keeps the
  events module's "word for word from the facts above" from reopening prices). An empty list (the read succeeded, no rows) keeps today's line, byte for byte. An insurance
  account keeps today's line on a failed read (its module forbids every quote and overrides that line).
  The browser voice demo reads its live list the same way and follows the same rule.

## 3. Scope

**In:** migration 0095 (the hours column, the services table, the snapshots table, the two stamp columns,
two RPCs); the pure renderers (hours lines, the open-now line, the price sentences, the snapshot payload);
the prompt wiring on all three surfaces (phone, web chat, browser voice demo: one Sofía); stamping on calls
and chats; the two Voice page cards and the two Facts flags; the read-only "What Sofía knew" page and the
call-page link; copy keys; unit, route, db and e2e tests.

**Out (and where it goes):** owners editing hours, services or facts, visibility tiers, freshness and the
serializer (F-037 part 2); holiday and special-date hours (F-037 part 2; until then a dated closure stays
in Facts, see 5.3); services with durations that the booking page offers (F-047 part); packages and menus
(F-166); showing the knowledge version in the web-chat inbox (a later read, nothing stores less for it);
any change to module wording (the modules are paused, C12); a corpus run.

## 4. Data (migration 0095, tier HIGH)

```
voice_profiles.business_hours        jsonb null
  check (business_hours is null or jsonb_typeof(business_hours) = 'object')

voice_services
  id                uuid pk default gen_random_uuid()
  account_id        uuid not null references accounts(id) on delete cascade
  position          integer not null check (position between 1 and 50)
  name_en           text not null      check (length(btrim(name_en)) between 1 and 80)
  name_es           text null          check (name_es is null or length(btrim(name_es)) between 1 and 80)
  description_en    text null          check (… between 1 and 300)
  description_es    text null          check (… between 1 and 300)
  price_kind        text not null      check (price_kind in ('fixed','from','range','per_unit','free','after_visit'))
  amount_cents      integer null       check (amount_cents is null or amount_cents between 1 and 100000000)
  amount_max_cents  integer null
  unit_en           text null          check (unit_en is null or length(btrim(unit_en)) between 1 and 30)
  unit_es           text null          check (… between 1 and 30)
  created_at        timestamptz not null default now()
  unique (account_id, position)
  no text column may contain a carriage return or a line feed (one CHECK per column: a name is one prompt
    line, and a newline in it would start a line of instructions)
  voice_services_price_shape_check — each kind carries exactly its amounts:
    fixed, from       amount_cents set; amount_max_cents, unit_en, unit_es null
    range             amount_cents and amount_max_cents set, amount_max_cents > amount_cents; units null
    per_unit          amount_cents, unit_en and unit_es set (C16); amount_max_cents null
    free, after_visit amount_cents, amount_max_cents, unit_en, unit_es all null

voice_knowledge_snapshots
  id          uuid pk default gen_random_uuid()
  account_id  uuid not null references accounts(id) on delete cascade
  version     integer not null check (version > 0)
  payload     jsonb not null check (jsonb_typeof(payload) = 'object')
  created_at  timestamptz not null default now()
  created_by  text not null   (the Clerk user id, or 'system' for a call-start record, 5.6)
  unique (account_id, version)
  never edited: a BEFORE UPDATE trigger raises, and UPDATE, DELETE and TRUNCATE are revoked from every
  role including service_role (an account's deletion still cascades: referential actions run as the
  table owner)

calls.knowledge_version                   integer null check (> 0)
concierge_conversations.knowledge_version integer null check (> 0)
  each with a foreign key (account_id, knowledge_version) → voice_knowledge_snapshots (account_id, version),
  added NOT VALID and then VALIDATEd in the same file (the scan then holds SHARE UPDATE EXCLUSIVE, not the
  ALTER's ACCESS EXCLUSIVE); NULL passes (MATCH SIMPLE)
```

- `business_hours` NULL = no structured hours (today's behaviour). The shape inside the object is enforced
  by the app on save (the RPC refuses a malformed value, 4.1) and read defensively with
  `normalizeOpenHours` (slots.ts), as `calendars.open_hours` is, because 0016 set the precedent of no deep
  CHECK on this JSON.
- **Grants and policies.** `voice_services` and `voice_knowledge_snapshots`: `revoke all` from `public`,
  `anon`, `authenticated`, `service_role`; then `grant select` to `authenticated` and `service_role`, and
  NOTHING else. Every write goes through the two RPCs (4.1), which run as the function owner, so even the
  server cannot change the services without recording a snapshot. RLS on both: a member-read policy
  (`app.is_agency() or account_id = app.current_account_id()`, 0077's shape) and a restrictive Owners-only
  policy (`(select app.is_agency()) or (select app.is_account_owner(app.current_account_id()))`, every
  helper coalesced, the plpgsql-NULL lesson). Client Owners may read; Staff, Technicians and anon may not;
  no client role writes anything. `voice_profiles.business_hours` inherits that table's grants:
  `authenticated` has SELECT (every member of the tenant, as for `facts` today; accepted, C17) and no UPDATE.
- **The client-write digest is unchanged** (`proposals-drop.test.ts`, `51|0dd3e2d7…`), and
  `schema-grants-guard.test.ts`'s EXPECTED_WRITES gains nothing: both new tables have RLS on and no
  client write.
- Comments on every new column and table in 0093/0094's style (who writes it, through what).
- Rollback lines in the file header in 0094's form; the two stamp columns and the snapshots table only on an
  owner decision, because they drop the record of what each call and chat knew.

### 4.1 The two RPCs (C9)

Both `language plpgsql security definer set search_path = ''`, `revoke all … from public, anon,
authenticated, service_role; grant execute … to service_role`, called through `serviceDb()` behind the app's
agency check, exactly as `go_live`. Both lock the account row `for no key update` first (0077's quota
lock), so two knowledge writes on one account queue and version numbers never collide.

- **`save_voice_knowledge(p_account_id, p_actor, p_parts jsonb, p_payload jsonb, p_base_version integer)`
  returns jsonb.** `p_parts` carries any of `facts`, `services_text`, `business_hours` (an object, or JSON
  null to clear) and `services` (the whole ordered list). It refuses, writing nothing, with a status: no
  voice profile (`no_profile`), a base version that is no longer the latest (`stale`: someone saved in
  between; the action re-reads and retries once, then shows "Someone else just saved this. Reload to see
  their change."), or a malformed part (`invalid`, the CHECKs above plus the hours shape). Otherwise, in
  one transaction: updates the named profile columns, replaces the account's `voice_services` rows when
  `services` is present (delete, then insert at positions 1..n), records a `voice_profile.updated` event
  naming the parts inside the transaction (as `go_live` records its events), and appends a snapshot with
  `version = latest + 1` and `p_payload` UNLESS the latest snapshot's payload already equals `p_payload`
  (jsonb equality). Returns `{status: 'ok', version}`.
- **`ensure_knowledge_snapshot(p_account_id, p_payload jsonb)` returns integer.** The latest version when
  its payload equals `p_payload`; otherwise appends one (`created_by = 'system'`) and returns it. Used at
  call and chat start (5.6).

The payload is built in TypeScript, not SQL, because it carries the rendered sentences (5.1), and the same
object that is sent to the RPC builds the prompt. The database guarantees the numbering and the
immutability; the app guarantees the payload.

### 4.2 The payload (what "exactly what she was given" means)

```
{ "schema": 1,
  "facts": "...", "services_text": "...", "timezone": "America/Chicago",
  "business_hours": { "mon": [["08:00","12:00"],["13:00","18:00"]], ... } | null,
  "hours_lines": ["Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM", ..., "Sunday: closed"] | null,
  "services": [ { "position": 1, "name_en": "...", "name_es": null, "description_en": null, "description_es": null,
                  "price_kind": "fixed", "amount_cents": 2500, "amount_max_cents": null, "unit_en": null, "unit_es": null,
                  "sentence_en": "The price for Haircut is $25.", "sentence_es": "El precio de Haircut es $25." } ],
  "renderer_version": 1 }
```

Row ids are left out (the list is replaced on save; only content counts for equality). The "Right now"
line is left out: it depends on the moment, and the call's own start time plus `business_hours` and
`timezone` reproduce it exactly. `renderer_version` is a constant in the renderer module, bumped with any
template change, which therefore also produces a new snapshot at the next call (5.6).

### 4.3 LOAD-BEARING on 0095 being on production

PostgREST refuses a request naming a column, table or function it does not know, so the merge waits for
0095 on production (as 0093 and 0094 did). The sites:

- `PROFILE_COLS` (`packages/db/src/voice.ts`) gains `business_hours`: every voice profile read, so every
  call, every chat turn and the Voice page;
- `CALL_DETAIL_COLS` (same file) gains `knowledge_version`: every call page;
- `CONVO_COLS` (`packages/db/src/concierge.ts`) gains `knowledge_version`: every later chat turn;
- `startCallRow` and `createConciergeConversation` name `knowledge_version` when given (nearly always);
- the new reads `listVoiceServices` and `getKnowledgeSnapshot` and the two RPCs, on every call and every
  chat start.

## 5. Behaviour

### 5.1 The renderers (pure, `apps/web/src/lib/voice/knowledge/`, tier MEDIUM)

- `price-sentence.ts`: `priceSentence(service, "en" | "es")`. One template per kind and language, no other
  wording anywhere. `{N}` is the name (Spanish: `name_es`, else `name_en`), `{U}` the unit (`unit_en` in
  English, `unit_es` in Spanish; both are required, C16, so there is no fallback), `{A}`/`{B}` the amounts:

  | kind | English | Spanish |
  |---|---|---|
  | fixed | The price for {N} is {A}. | El precio de {N} es {A}. |
  | from | The price for {N} starts at {A}. | El precio de {N} es desde {A}. |
  | range | The price for {N} is between {A} and {B}. | El precio de {N} es de {A} a {B}. |
  | per_unit | The price for {N} is {A} per {U}. | El precio de {N} es {A} por {U}. |
  | free | There is no charge for {N}. | {N} no tiene costo. |
  | after_visit | The price for {N} is given after a visit. | El precio de {N} se lo damos después de una visita. |

  Amounts: US dollars, whole dollars without cents ("$25", "$1,200"), otherwise two decimals ("$25.50");
  the same `en-US` formatting in both languages (the RGV market writes and says "$1,200"). The "price
  for {N}" frame avoids articles, so no name ever needs a gender or "el/la" guess.
- `hours.ts`: `hoursLines(hours)` (Monday first, as the calendar panel; "Sunday: closed"; 12-hour times;
  "24:00" reads "midnight"), and `openNowLine(hours, timezone, now)`: "Right now: open until 6:00 PM." /
  "Right now: closed; opens today at 1:00 PM." / "… opens tomorrow at 8:00 AM." / "… opens Monday at
  8:00 AM." A span ending "24:00" followed by one starting "00:00" the next day is one stretch ("open until
  2:00 AM"). All arithmetic in the account's zone through `Intl.DateTimeFormat` with an explicit `timeZone`,
  slots.ts's rule, so DST is the zone's, never the server's.
- `payload.ts`: `buildKnowledgePayload({ facts, servicesText, timezone, businessHours, services })` →
  4.2's object, deterministic (fixed key order, positions 1..n).

### 5.2 The prompt (`system-prompt.ts`)

`VoicePromptInput` gains two optional fields: `businessHours?: OpenHours | null` and
`priceList?: RenderedService[] | null` (name, description and the two sentences). Absent, null or an empty
list adds nothing, so every existing prompt is **byte-identical** (C3). Both are filled from the payload,
never from a second read, so the prompt and the snapshot cannot disagree.

Inside the `WHAT YOU KNOW ABOUT …` block, after the Facts and the `Services:` line:

```
BUSINESS HOURS (the regular weekly hours; where hours written above differ, these are right, except a
closure written above for a specific date):
Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM
…
Sunday: closed
Right now: closed; opens Monday at 8:00 AM.

SERVICES AND PRICES (the only prices you may give; for a price, say that service's sentence exactly as it
is written here, in the language you are speaking):
- Haircut — English: "The price for Haircut is $25." Spanish: "El precio de Corte de cabello es $25."
  About it: <description in the language spoken, if any>
```

Both sentences are always given, whatever the language setting: she says the one in the language she is
speaking, and the base LANGUAGE line still decides which that is.

**The HARD LIMITS price line.** Without a list it is today's line, byte for byte. With a list it becomes:

> - Give a price only by saying, word for word, that service's sentence from SERVICES AND PRICES above.
>   Any other amount written above, in the facts or the services, is not a price you may give. Never
>   multiply, add up, estimate or round a price, never work out a total, and never quote a service that
>   is not on the list: say the business will confirm pricing and offer to take their details. Wherever a
>   rule below speaks of prices "in the facts", it means this list.

The last sentence is what keeps the events module (5.4) working without a wording change.

**The after-hours rule (C5).** Only when `businessHours` is set; otherwise every line is today's:

- Phone, "Follow business hours, then take a message", closed now: a new line —
  "AFTER HOURS — The business is closed right now (see Right now above). If it matters to what they need,
  say so and say when it opens. You can still answer questions from what you know above{, and book a time
  that check_availability returns — only where a new booking can be made}. For anything that needs someone
  on the team, take a message and say the team will call them back once it opens.{ If they ask for a
  person, or it is urgent, you can still put them through. — only when `handoffAvailable`, C14}" Open now:
  no line (the Right now line already says until when).
- Phone, "Always take a message": the MESSAGES ONLY line, unchanged (it holds whatever the hours).
- Web chat and voice demo: today's conditional "AFTER HOURS — If the business is closed right now…" line
  (shown only under "Always take a message") becomes the definite one when closed, and is left out when
  open: "AFTER HOURS — The business is closed right now (see Right now above); say so briefly and {use
  capture_lead … / take a message …}". Under "Follow business hours" the chat gains the same definite line
  when closed (it had nothing).

The calendar still governs what `check_availability` returns; nothing here changes the slot engine.

#### 5.2.1 Closed now and the offer of a person (C14)

Today the base prompt has one string for what Sofía offers someone who would rather talk to a person,
`wouldRatherTalkToAPerson`: on the phone, "offer to put them through to someone on the team" when
`handoffAvailable` (a transfer number is set for this call), else "offer to take a message". It is used in
four places: the IDENTITY line (asked whether she is a person or an AI), the hidden-caller-ID line (an
existing appointment cannot be looked up), the reschedule/cancel refusal, and the other-number line. When
`handoffAvailable`, the session also carries `transfer_to_human`, and its TOOLS line says to call it "as
soon as the caller asks to speak to a person, or accepts when you offer".

S-47c adds one derived flag in `buildSystemPrompt`, `closedNow`: true only on the PHONE medium, only when
`businessHours` is set, and only when `openNowLine` says closed. When `closedNow` is false (no structured
hours, open right now, or the web chat or voice demo) nothing below applies and every line is today's.
Accounts without structured hours therefore stay byte-identical (the C3 digests). When `closedNow` is true
and `handoffAvailable`:

1. `wouldRatherTalkToAPerson` resolves to the existing no-transfer string, "offer to take a message", byte
   for byte, in all four places. She no longer volunteers a transfer.
2. `transfer_to_human` stays on the session (`toolSchemas` still receives `handoffAvailable`;
   `session-config.ts` is unchanged), so a caller who asks can still be put through. Its TOOLS line
   becomes: "- transfer_to_human() — the business is closed right now, so do not offer this. Call it only
   when the caller asks to speak to a person{, or when they accept the offer on the URGENT path in the
   trade rules above — only when the account has a trade module}. Do not ask them to hold first; that line
   is spoken for you the moment the transfer starts. If the tool comes back with an error, apologize and
   take a message instead."
3. The trade module still receives `handoffAvailable: true` in its context, so its URGENT path still makes
   its offer, word for word (C12: no module change). The module's "offer to connect them … wherever the
   general rules above say to offer a person" now finds the general rules saying "take a message", which is
   the intended result. Its "if they ask to speak to a person themselves, put them through" agrees with
   point 2.
4. The AFTER HOURS closed line (5.2) carries the matching sentence: "If they ask for a person, or it is
   urgent, you can still put them through."
5. "Always take a message" keeps its MESSAGES ONLY line unchanged, including its existing "If they ask for
   a person, or it cannot wait, you can still put them through", open or closed. The hours do not change
   that setting (it already holds at every hour).

With `handoffAvailable` false, nothing here changes anything: there was no transfer to suppress. An account
without a trade module has no URGENT path, so when it is closed she puts a caller through only when they
ask.

### 5.3 Facts that conflict (the Voice page flags, C1 and C3)

A pure `factsWarnings(facts, servicesText, { hasHours, hasPriceList })` in `lib/voice/knowledge/`:

- **Hours in Facts** (times like "8am", "8:00 a.m.", "8–5", or a weekday followed by a time, English and
  Spanish day names): with structured hours set, a Notice under Facts: "Facts mentions hours. {persona} uses
  Business hours below, so take regular hours out of Facts. A closure on a specific date can stay."
  Without structured hours, a gentler hint: "Add Business hours below so {persona} can tell callers whether
  you are open right now."
- **Amounts in Facts or Services** ("$40", "40 dollars", "40 dólares", "USD"): with a price list, a Notice
  that names each amount found, in the order it appears, with a few words around it (C11): "{persona} gives
  prices only from Services & prices, so these amounts in Facts will not be said: "$500 deposit to hold
  the date", "$35 per guest". Add each one she should say as its own row (a deposit or a fee too), or take
  it out. Refund and cancellation terms without an amount can stay." `factsWarnings` returns the matches
  (text and position), so the Notice and its test read the same list. Without a list, nothing (today's
  behaviour).

Flags never block a save; they are re-computed live as the operator types.

### 5.4 The trade modules (C6, C7)

No module file changes; `VERSION` stays 3 for both; `pin.ts`'s history is untouched (C12: the modules are
paused, and a structured-intake redesign comes later).

- **Events** (`modules/events.ts` v3) says prices are given "only by repeating what the facts above say,
  word for word" and never one "not written in the facts above". The list sits ABOVE the module block
  (inside WHAT YOU KNOW), so it is part of "the facts above", and the HARD LIMITS line's last sentence says
  outright that "in the facts" means the list. A list sentence read word for word satisfies the module
  rule, and an amount left in the prose is excluded by the HARD LIMITS line. A deposit, fee or minimum she
  should say is a row on the list; refund and cancellation terms without an amount stay in Facts, where the
  module still lets her give them word for word (C11).
- **Insurance** (`modules/insurance-pc.ts` v3) never quotes, "even if a price … appears in the facts
  above", and says it overrides the HARD LIMITS line. As defence in depth, on an account whose trade module
  is `insurance_pc` the SERVICES AND PRICES block lists the service names and descriptions only, with no
  sentence and no amount, and the HARD LIMITS price line stays today's: the prompt never carries a number
  insurance could be talked into reading. The snapshot payload is the same either way (it records the
  account's knowledge; the call's `trade_module` stamp records which rules shaped it). The Voice page hides
  the price fields on that account (5.7, C13).
- The placeholder sanitizer and the post-call ID masking (B7) are not touched.

### 5.5 Where each surface reads its knowledge

- **Phone** (`api/voice/incoming/route.ts`): reads `listVoiceServices` beside the existing profile and
  account reads (in parallel; the profile already carries `business_hours`), builds the payload, calls
  `ensure_knowledge_snapshot`, stamps `knowledge_version` through `startCallRow` (beside `trade_module`),
  and builds the prompt from the same payload. Fail-open, as the row itself is: if the read of services or
  the RPC fails, the call goes on, unstamped, with the knowledge it could read (the profile's free text if
  the services read failed). A latency read of the two added round trips is a plan Task 0 item.
- **Web chat** (`api/concierge/[publicId]/turn/route.ts`): at conversation creation, the same build, ensure
  and stamp (`createConciergeConversation` gains `knowledgeVersion`). EVERY later turn reads the stamped
  snapshot (`getKnowledgeSnapshot(db, accountId, version)`) and builds facts, services, hours and the list
  from its payload, not from the live profile, so a chat keeps its starting knowledge (C4), as it keeps its
  trade module. The open-now line is recomputed at each turn from the snapshot's hours and the turn's own
  time. A chat with no stamp (created before this build, or an ensure that failed) reads the live profile,
  as today.
- **Browser voice demo** (`api/voice/web/session`): builds from the live rows; no row, no stamp, no RPC.

### 5.6 Why a call can record a snapshot nobody saved

`ensure_knowledge_snapshot` at call and chat start is what makes C4's "exactly what she was given" true in
every case, not only after a Voice page save: an account that has not been saved since this build (every
account on day one), a profile written outside the Voice page (`packages/db/src/demo/seed.ts` writes facts
through `upsertVoiceProfile`), a renderer change (`renderer_version`), or a build rolled back and forward.
When the live payload matches the latest snapshot, which is the normal case, it is one read and no write.
Such a snapshot says "Recorded automatically" on its page (5.8). The owner accepted these automatic
snapshots as part of C4 (C15).

### 5.7 The Voice page (agency only)

Two new cards, after the receptionist profile card, each its own form with its own primary Save
(DESIGN.md rule 8; each writes only through `save_voice_knowledge` with only its part). Existing
components only (`Card`, `Checkbox`, `Input type="time"`, `Select`, `Button` ghost, `Notice`,
`SubmitButton`), tokens only, so no styleguide change. Loaded, empty and error states each designed; the
page renders on the server, so there is no loading state beyond the page's own.

- **Business hours** (`id="business-hours"`). Seven rows, Monday first, each with an "Open" checkbox and,
  when open, one or more from–to spans and "Add hours" (ghost) for another span; a span has a remove
  button. "Copy from calendar" (ghost) fills the rows from the account calendar's `open_hours` without
  saving, disabled with a hint when the calendar has no hours. The time fields reuse `hours-form.ts`'s
  seed-on-pointerdown helper, never seed-on-focus (the tab-through defect recorded there). Times are in
  the account's timezone, said under the title. Validation: each span's end after its start, spans on one
  day not overlapping, at least one open day ("Mark at least one day open, or clear the hours"). "Clear
  hours" (ghost) saves NULL, back to today's behaviour. Empty state: "Add your hours so {persona} can tell
  callers whether you're open right now." with Copy from calendar and Set hours.
- **Services & prices** (`id="services-prices"`). An ordered list; each row shows the name, the kind and
  the amount, with Move up / Move down / Edit / Remove (ghost). Edit opens the row inline: English name,
  Spanish name, kind (Select of the six), the amount fields the kind needs (none, one, two, or one plus the
  two unit fields), descriptions; and a live preview of the English and the Spanish sentence, from
  `priceSentence`, the same function the prompt uses. "Add a service" (ghost); at most 50. Remove is staged
  until Save (the card's Save is the commit; nothing is destroyed before it). Empty state: "List your
  services and prices so {persona} quotes them exactly." with Add a service.
  - A `per_unit` row needs both unit fields (C16): the Save action refuses it first, naming the row ("Add
    the unit in English and in Spanish for {name}"), and the CHECK refuses it again if anything gets past
    the action. The action's validation exists for the sentence, not for safety.
  - **On an insurance account (C13)** the card is titled "Services" and shows no price at all: the kind
    Select, the amount and unit fields and the sentence preview are hidden, and the row shows only the
    names and descriptions. A row added there is saved as `after_visit` (the one kind with no number). A
    row that already carries a price keeps it untouched in the database (the form sends it back as it was
    stored) but shows none of it. A Notice says: "On insurance accounts {persona} names these services
    but never gives a price." If the account's trade module is later set to none or events, the prices
    show again, and rows added under insurance read "given after a visit" until edited.
- Each Save: a "Saved" toast as the other Voice cards; a refused save keeps the operator's edits (the
  `use-form-submit` rule from the calendar panel) and says why.
- The profile card's Facts and Services boxes save through the same RPC (only the `facts` and
  `services_text` parts), then the rest of the profile through `upsertVoiceProfile` as today; the RPC runs
  first, so a failed snapshot saves nothing. On an account with no profile yet, the profile is created first
  and the knowledge part follows (the first save then records version 1). `upsertVoiceProfile` refuses
  `business_hours` at run time, as it refuses `forward_calls`.
- The command palette's `/voice` keywords gain hours, prices, services, horario, precios.

### 5.8 The call page and "What Sofía knew"

- The call details gain one `<dt>`/`<dd>` pair, agency only and only when the call is stamped (the
  trade-rules line's rule, S-47b 5.7): label "Knowledge", value a link "What {persona} knew (#N)" to
  `/dashboard/accounts/{accountId}/voice/knowledge/{N}`.
- That page (agency only, `requireAgencyOnlyAccountAccess`, a sub-page of the agency-only Voice section,
  not a new top-level surface) shows one snapshot read-only: "Version N · saved {date} by {person}" or
  "Recorded automatically"; Facts; Services text; Business hours (the stored lines); Services and prices
  (each service with its English and Spanish sentence); and Older / Newer links to the neighbouring
  versions. A version that does not exist is the page's not-found state; a failed read is its error state.

## 6. Copy

New keys, English and Spanish, through the catalogue (`lib/messages.ts`, `.es` keys; the i18n baseline
regenerated): both card titles, descriptions, empty states and hints; the weekday labels if the calendar's
are not reusable as keys; Open, Add hours, Remove, Copy from calendar, Clear hours, the timezone line; the
six price-kind labels and their amount-field labels; the preview labels; the validation messages; the stale
message; the `per_unit` units message (C16); the insurance title "Services" and its Notice (C13); the two Facts flags with their list of amounts (C11) and the hint; the call-page label and link; the
knowledge page's headings. Two existing keys change: `voice.profile.factsHint` ("Hours, pricing,
policies…") → "Policies and anything else a caller might ask about. Hours and prices go in their own cards
below." and `voice.tradeRules.eventsHint` ("…gives prices only word for word from Facts") → "…gives prices
only word for word from Services & prices, or from Facts when there is no list." The price sentences and
the prompt lines are not catalogue copy (they are model input), and are pinned by tests instead.

## 7. Tests

- **Renderers:** `priceSentence` for every kind in both languages, as literal strings (12 fixtures),
  including the Spanish-name fallback, cents, thousands; the shape refusals (a `range` without its
  maximum, or a `per_unit` without either unit, throws). `hoursLines` and `openNowLine`: open, lunch gap, closed today, closed until
  tomorrow, closed until Monday, the "24:00"/"00:00" join, a DST-change day in `America/Chicago`.
  `buildKnowledgePayload` is deterministic (same input, deep-equal output, stable key order).
- **Byte identity (C3):** before `system-prompt.ts` is touched, record `PRE_S47C_DIGEST` over every
  existing combination × trade module (none, insurance_pc, events) at main 044b1ab2. Assert it with the new
  fields absent, null and empty; `PRE_S47B_DIGEST` stays green too.
- **Prompt:** hours alone add the BUSINESS HOURS block and change nothing else; a list alone adds the list
  and swaps exactly the one HARD LIMITS line; insurance gets names only and today's HARD LIMITS line; the
  AFTER HOURS variants per medium × setting × open/closed. C14, phone with a transfer number: closed now,
  all four offer sites read "offer to take a message", the TOOLS line is the closed variant (with the
  URGENT clause only when a module is set), `toolSchemas` still carries `transfer_to_human`, and the module
  block is byte-identical to the open-now one; open now, the prompt equals the no-hours prompt plus the
  BUSINESS HOURS block and nothing else; web chat and voice demo, closed or open, no C14 line at all.
  Guards on the specific sentences, never on a heading (a test a comment could satisfy is vacuous).
  `pin.ts` hashes unchanged (no module text moved).
- **Facts flags:** each pattern in both languages, the list of amounts returned in order with their
  surrounding words (C11), and the false-positive guards (a phone number, a ZIP, a year, "24/7" not read as
  an amount).
- **Voice page (insurance, C13):** on an `insurance_pc` account no amount, unit, kind or sentence renders,
  a new row saves as `after_visit`, and a stored row's price is sent back unchanged.
- **db (HIGH):** 0095's shape; the price-shape CHECK accepts each kind with exactly its amounts and refuses
  each extra or missing one (one mutation probe per clause, including `per_unit` with no `unit_es`, C16);
  the newline CHECKs; position bounds and
  uniqueness; snapshot uniqueness, the UPDATE trigger and the revoked UPDATE/DELETE for service_role, and an
  account delete still cascading; the two FKs (a stamp naming a missing version refused; NULL admitted);
  `save_voice_knowledge`: ok, `stale`, `no_profile`, `invalid`, no new version on an equal payload, version
  n+1 otherwise, the services replaced in order, nothing written on refusal; `ensure_knowledge_snapshot`:
  idempotent, and two concurrent calls with one new payload produce one row; grants: Owner reads, Staff and
  Technician read nothing, anon nothing, the agency's own token writes nothing, service_role cannot insert
  into either table directly; the client-write digest and the schema guard unchanged.
- **Routes:** the incoming route stamps the version the RPC returned and builds the prompt from the same
  payload; an RPC failure leaves the call unstamped and answered; the concierge stamps at creation, and a
  later turn builds from the stamped snapshot after the profile changed.
- **Actions:** each card saves only its part; a stale save retries once then refuses with the stale copy;
  a snapshot failure fails the save; the profile save runs the RPC before `upsertVoiceProfile`.
- **e2e (LOW, per-run fixture account only):** Business hours: Copy from calendar, save, reload, see the
  rows; Services: add a `per_unit` row, see both preview sentences, save, reload, see it; clear both after.

## 8. Rollout

1. 0095 → bis-ci (`ci-project-setup.yml`, push-dry-run then push) → green `verify` and `e2e` on the head
   SHA (read the check runs for that SHA) → production via MCP `apply_migration` once (name
   `structured_facts`, the exact file text) → md5 compare of the stored text → parity check
   (`docs/runbooks/ci-supabase-project.md`).
2. PR; merge only after 0095 is on production (4.3).
3. Deploy READY → smokes: a test call on the fixture line, or the browser voice demo, on an account with
   hours and a list; the call page shows the link; the knowledge page renders. Tracker: F-037 part 1 done.
4. Merging changes no prompt by itself: an account's prompt changes only once the agency saves hours or a
   list for it. From the first call after deploy every call carries a knowledge version (5.6).

## 9. Tiers (per task, binding rule 2026-10-19)

- **HIGH:** migration 0095, the two RPCs and their db tests.
- **MEDIUM:** the renderers; the prompt wiring and the byte-identity digests; stamping in the phone and chat
  routes; the save actions.
- **LOW:** the two Voice page cards, the Facts flags' UI, the knowledge page and the call-page link; copy
  keys and baseline; the palette keywords; the e2e spec.
- One end-of-PR review (final + design), then one fix round.

## 10. Open questions

No open questions. The first draft's Q1–Q7 were answered by the owner on 2026-10-23 and are decisions
C11–C17, Q8 (the owner's read of the twelve price sentences) is C18, and the implementation plan's two
questions (closed hours under "Always take a message"; the price line on a failed list read) are C19 and
C20 (section 2).

# Web concierge — a text assistant on every client's own website

**Date:** 2026-09-20 · **Branch:** `feat/web-concierge` · **Base:** `0758655`
**Status:** Decisions made by danlo 2026-09-20. Ready to plan.

Supersedes the draft at `.superpowers/sdd/web-concierge-design-2026-09-20.md`.
Scoping briefs: `.superpowers/sdd/concierge-voice-runtime.md`,
`.superpowers/sdd/concierge-intake-and-embed.md`.

## Why

M4's roadmap line is "web concierge + knowledge base — embeddable widget per
client reusing the same brain"
(`2026-08-24-voice-receptionist-core-design.md:23`). The voice half is done;
this half has never been started, and it is the only reason §8a still reads M4
as partial.

What exists today is a **demo, not a product**: `api/voice/web/session/route.ts`
mints an OpenAI Realtime secret for ONE tenant, pinned by the `SOFIA_WEB_NUMBER`
env var, for the agency's own marketing site. The request carries no tenant
identity at all (`route.ts:105`, `getPhoneNumberByE164(db, calledNumber)`), so
it cannot serve a second client, let alone every client.

danlo, 2026-09-20: *"I want it as a standard option available to all my
clients."* That is the shape this spec builds.

## The four decisions, already made

| # | Decision | Recorded |
|---|---|---|
| 1 | **Text, not voice**, for the client widget | danlo, 2026-09-20 |
| 2 | **Floating bubble**, thin chrome around an isolated frame | danlo, 2026-09-20 |
| 3 | **Leave consent alone** — no automatic SMS on a widget lead | danlo, 2026-09-20 |
| 4 | **The operator picks which form a lead files into** | danlo, 2026-09-20 |

They are not re-argued here. Decision 1's reasoning is in the draft §1; the
short version is that mic permission is the highest-friction thing a website can
ask a four-second-old visitor, text bills per turn rather than by wall clock
(the exact hole #101 had to bound), and a typed conversation IS the transcript a
lead needs. **Voice sells, text converts.** The voice demo stays the agency's
own sales tool and is not touched by this work.

Decision 4 is new to this spec and came out of verifying the draft. See
"The lead seam" below.

**What decision 1 costs, stated:** this is a genuinely new code path. Nothing in
this repo runs a live text conversation. The only non-Realtime OpenAI call is
`summary-service.ts:68`'s one-shot staff summary. New API shape, new cost unit,
new transcript home.

## The lead seam — the draft's one wrong assumption

The draft treats "lead capture → `enrich()`" as free. It is not.

`enrich()` (`apps/web/src/lib/forms/enrich.ts:33`) takes a **`FormRow`**, and
`createSubmission(db, accountId, formId, input)`
(`packages/db/src/forms.ts:194`) writes a `form_submissions` row whose `form_id`
is `not null references public.forms(id) on delete restrict`
(`0006_forms.sql:41`). There is no path into the CRM through `enrich()` without
a form. This is exactly how #99's intake already works — its `publicId` IS a
form's public id (`api/intake/[publicId]/route.ts:86`).

So "which form does a widget lead land in" is a real question, and the answer is
decision 4: **a new nullable `voice_profiles.concierge_form_id`, chosen by the
operator**, in the same card that holds the toggle. The toggle cannot be
switched on without one — the setup wizard's existing "locked, with a reason"
shape (`DESIGN.md`, Key patterns → Setup).

Why this over the alternatives, briefly, so nobody re-opens it:

- **Not an auto-provisioned hidden form.** It would need a `forms.system_kind`
  marker so the builder cannot delete or unpublish it out from under a live
  widget, and it puts a row in the operator's Forms list that they did not make.
- **Not addressing by the form's public id.** It makes "which form?" a
  client-facing question and puts the snippet card on the Forms screen rather
  than with the assistant it configures.
- **Not refactoring `enrich()` off `FormRow`.** Two live callers on a path that
  handles real customer data, for no user-visible gain.

**The consequence to accept:** the widget does NOT validate against the chosen
form's `required` flags. A conversation cannot guarantee that a visitor
volunteered `core.company_name` because the operator marked it required on a web
form. The intake route does validate (`route.ts:97-108`) and returns
`fieldErrors`; the concierge deliberately does not. A conversation that produced
a name and a way to reach someone is a lead, and refusing to file it because a
fifth field is blank would throw away the thing the widget exists to catch. The
answers it did collect are mapped onto the form's field keys **by `kind`**
(`FormFieldKind`, `packages/db/src/forms.ts:5-7`); kinds the form does not carry
are dropped, exactly as `enrich`'s own `byKind` map already expects.

## Shape

```
client's own website
  <script src="app.bis-rgv.com/embed.js" data-concierge="<publicId>">
        │  the SAME loader route that already serves forms and booking
        │  (apps/web/src/app/embed.js/route.ts:6-13, one cached script for all)
        ▼
  BUBBLE CHROME in the host page  ← new: fixed-position launcher + panel
        │  the only code that runs in the client's DOM. No conversation,
        │  no branding read, no lead data — it opens and closes a frame.
        ▼
  iframe → app.bis-rgv.com/c/<publicId>        ← new public route
        │      · resolves the tenant from the public id, like /f and /b
        │      · paints the client's brand (DESIGN.md rule 9)
        │      · mints a render token, honeypot, fill-time floor
        ▼
  POST /api/concierge/<publicId>/turn          ← new public API
        │      · turn 1: render token + honeypot + fill-time + per-IP cap
        │      · every turn: the server-side TURN CAP
        │      · one Chat Completions call per turn, server-side
        │      · the server IS in the loop, so it receives tool calls directly
        ▼
  capture_lead tool fires → lib/forms/enrich.ts
        contact (deduped) · conversation · unread badge · alert email · receipt
```

## Data — migration `0042_web_concierge.sql`

### Three columns on `voice_profiles`

```sql
alter table public.voice_profiles
  add column public_id text unique,
  add column concierge_enabled boolean not null default false,
  add column concierge_form_id uuid references public.forms(id) on delete set null;
```

- **`public_id` is NULLABLE and minted lazily**, by app code, the first time the
  concierge is switched on. `newPublicId()` (`packages/db/src/forms.ts:54`, 12
  random bytes over `ALPHABET`) is app-side, so there is no SQL default that
  matches it, and a backfill of every existing profile would mint addresses for
  accounts that will never use one. Postgres permits many nulls under a unique
  constraint, so this needs no partial index.
- **`concierge_enabled` is SEPARATE from `enabled`** (the phone line) on
  purpose. A client may want the website assistant without the phone
  receptionist, or the reverse. It joins `booking_enabled` and
  `textback_enabled` (`packages/db/src/voice.ts:10-16`) as a third per-feature
  switch on the same row.
- **`concierge_form_id` is `on delete set null`, not `restrict`.** Deleting a
  form must not be blocked by this pointer; it must turn the widget off. The
  route therefore treats a null `concierge_form_id` as "not configured" and
  refuses, which is the fail-closed direction.

`PROFILE_COLS` (`packages/db/src/voice.ts:38-41`) and `VoiceProfileRow` both
grow by three. `VoiceProfilePatch` is derived, so it follows.

### One new table, `concierge_conversations`

The turn cap **must** be server-side, which means a server-side row. A design
where the browser posts the transcript each turn puts the counter in the
attacker's hands: they reset it by not sending it. The transcript lives here for
the same reason — decision 1's whole premise is that the typed conversation IS
the record, and a record the client holds is not one.

```sql
create table public.concierge_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Captured at conversation START, not read per turn: an operator changing
  -- the destination form mid-conversation must not strand a lead halfway.
  -- `restrict` for 0006_forms.sql:39-41's stated reason — these carry leads,
  -- and deleting a form must never be able to destroy them.
  form_id uuid not null references public.forms(id) on delete restrict,
  ip_hash text not null,
  -- The cap's counter. Claimed atomically (see below), never read-then-written.
  turn_count int not null default 0,
  -- [{role, text, at}] — the same shape as `calls.transcript`'s
  -- TranscriptEvent (packages/db/src/voice.ts), so one reader renders both.
  transcript jsonb not null default '[]'::jsonb,
  -- Set once, when capture_lead first succeeds. Its non-null-ness is what
  -- stops a second submission for the same visitor.
  submission_id uuid references public.form_submissions(id) on delete set null,
  locale text not null default 'en',
  attribution jsonb not null default '{}'::jsonb,
  origin text,
  created_at timestamptz not null default now(),
  last_turn_at timestamptz not null default now()
);

create index concierge_conversations_ip_idx
  on public.concierge_conversations (ip_hash, created_at desc);
create index concierge_conversations_account_idx
  on public.concierge_conversations (account_id, created_at desc);
```

**Grants — the same reasoning 0041 spells out, and it must be repeated here.**
This project's default ACL auto-grants ALL privileges to `anon` AND
`authenticated` on every new table (`0020_voice_grants_revoke.sql` exists
because of exactly that; 0033 shipped without a grant block and still carries
INSERT/UPDATE/DELETE to `anon`). Nothing but the route touches this table and
the route uses `serviceDb()`:

```sql
alter table public.concierge_conversations enable row level security;
revoke all on public.concierge_conversations from anon, authenticated;
grant select, insert, update, delete on public.concierge_conversations to service_role;
```

RLS on with zero policies, service-role only — `screened_calls`' shape, narrower
than `call_proposals`, identical to `voice_web_sessions`.

⚠️ **Not a `calls` row, and not a `conversations` row.** `calls` feeds the
weekly report's "calls answered" (0041's own comment, and 0039/0040 before it).
A website chat is not a call. `conversations` is the OPERATOR's inbox thread,
and `enrich()` already opens one of those when a lead is filed — this table is
the visitor-side conversation, which exists before and mostly without a lead.

### One SQL function, for the turn claim

```sql
create function public.concierge_claim_turn(p_conversation_id uuid, p_max int)
returns int language sql as $fn$
  update public.concierge_conversations
     set turn_count = turn_count + 1, last_turn_at = now()
   where id = p_conversation_id and turn_count < p_max
  returning turn_count;
$fn$;
```

Read-then-write loses the race: two turns posted together both read N and both
write N+1, and the cap leaks. One statement cannot. The precedent is
`increment_conversation_unread`, called through `db.rpc(...)` at
`packages/db/src/messaging.ts:498`. A null return means the cap is reached.

## Tenant resolution

`voice_profiles.public_id` behind `/c/[publicId]`, the third instance of a
pattern the repo has already proved twice: `calendars.public_id` behind
`/b/[publicId]` — *"`public_id` is the authorisation to submit: no accountId, no
auth, on purpose"* (`packages/db/src/booking.ts:268-269`) — and
`forms.public_id` behind `/f/[publicId]`.

New accessor `getVoiceProfileByPublicId(db, publicId)`, shaped like
`getPublishedFormByPublicId`. It must return null unless `concierge_enabled` is
true **and** `concierge_form_id` is set — an address that resolves to a profile
whose widget is switched off is a 404, not a working chat.

**The consequence worth stating:** because every client gets their own
`publicId` and their own row, one client's widget cannot see, speak as, or bill
another. That is the same property `/b` and `/f` already rely on, not a new
guarantee to invent.

`SOFIA_WEB_NUMBER` and the voice demo are untouched. Two surfaces, two jobs.

## The guards

`/api/intake/[publicId]` **cannot** be the widget's front door. It is gated by
one shared static secret (`route.ts:51-57`) with no per-origin binding and no
rate limit at all — correct for a trusted server, catastrophic in a browser
where every visitor can read it.

| Guard | Exists | When it applies |
|---|---|---|
| Signed render token bound to the public id | ✅ `guards.ts:54,76` | **turn 1 only** |
| Honeypot field | ✅ `guards.ts:4` | turn 1 only |
| Fill-time floor, `MIN_FILL_MS` 2000 | ✅ `guards.ts:9` | turn 1 only |
| Keyed IP hashing, never raw | ✅ `guards.ts:128` | every turn |
| Same response body on accept and reject | ✅ precedent | **turn-1 start guards only** |
| Per-IP **conversation** cap | ➖ re-keyed | turn 1 only |
| Per-conversation **turn cap** | ❌ **new** | every turn |

**The anti-oracle body is narrower than the draft said, and deliberately
(amended 2026-09-20 in Task 4's review).** The honeypot, the render token and
the fill-time floor answer with the same body a good turn gets, because a
spammer probing for which guard tripped can reshape the request to dodge it.
The two caps answer `429` instead. A cap is not a guard a request can be
reshaped to dodge, and a real visitor who hits one — three conversations in
ten minutes is rare but possible — needs to know to come back later, not to
be handed a fake reply. A chat cannot fake success the way a form's
"thanks, we'll be in touch" can; the only convincing fake would be a real
model call, which is the cost the cap exists to refuse.

**Why the first three gate turn 1 only, and this is load-bearing.**
`MAX_TOKEN_AGE_MS` is 30 minutes (`guards.ts:19`). A chat panel left open past
that would be refused mid-sentence — a cliff no visitor could understand. The
render token's job is proving *this came from our page*, which is a statement
about how the conversation STARTED. After turn 1 the authorisation is the
conversation row itself: server-created, addressed by a v4 uuid the visitor
never chose, and carrying its own cap. Every turn re-checks that the
conversation's `account_id` matches the one the `publicId` resolves to, so a
leaked conversation id cannot be driven through another tenant's address.

**The two caps do different jobs and neither substitutes for the other.**
Every existing limiter in this repo assumes one POST is one interaction —
`RATE_LIMIT_MAX` 5 per `RATE_LIMIT_WINDOW_MS` 600s (`guards.ts:10-11`). A real
conversation is ten turns in four minutes and would be cut off at five; raise
the cap to fit a conversation and it stops stopping a flood. So:

- `CONCIERGE_MAX_TURNS` — a conversation is at most N turns, full stop.
- `CONCIERGE_MAX_CONVERSATIONS_PER_IP` per `CONCIERGE_IP_WINDOW_MS` — how many
  conversations one visitor may START.

Same two-level shape as #101's `WEB_SESSION_MAX_PER_IP` /
`WEB_SESSION_MAX_PER_ACCOUNT_PER_DAY` (`lib/voice/web-demo.ts:47-55`), and a
per-account daily conversation cap joins them for the same reason: one client's
widget must not be able to spend without a ceiling.

**Every cost check happens BEFORE the model call**, and **fails closed** on a
throwing counter — #101's asymmetry, for #101's reason: a guard failing open
here costs an unbounded number of model calls, not one.

## The model call — the new code path

`POST https://api.openai.com/v1/chat/completions`, `gpt-4o-mini`, the existing
`OPENAI_API_KEY`, with `AbortSignal.timeout(...)`. That is the same endpoint,
model, key and hung-connection defence `summary-service.ts:68-95` already proved
in production; nothing new is being introduced at the transport layer.

Messages: the concierge system prompt, then the stored `transcript`, then the
new visitor text. The transcript is read from the row, never from the request.

**One tool: `capture_lead`.** The draft ruled tools out, but that reasoning was
voice-shaped: *"nothing in this repo RECEIVES a tool-call event from a WebRTC
session — `processCallEvent` is wired only to the phone path's server-held
socket"* (`concierge-voice-runtime.md` §6). On text that objection disappears —
the server makes the HTTP call and the tool call comes back in the response
body. This is the one thing text buys that voice could not have given us, and
the alternative (a second extraction model call per turn to guess whether a lead
appeared) is both more expensive and less reliable.

The tool is defined **locally for the concierge**, not taken from
`lib/voice/tools/registry.ts`. `runTool` resolves against a voice-shaped context
(`ctx.callRowId`, `ctx.callerNumber`) that does not exist here, and
`transfer_to_human` requires a phone leg the web has never had
(`registry.ts:426-446`). Booking, rescheduling and cancelling stay off — see
Out of scope.

The server validates the tool arguments with `isValidEmail` / `isValidPhone`
(`guards.ts:171,176`) before filing, and files at most once per conversation
(`submission_id` guards it). A later capture in the same conversation appends to
the transcript and does not create a second submission.

### The prompt is phone-shaped, and this is where that gets fixed

`buildSystemPrompt` (`lib/voice/system-prompt.ts:11`) opens with
`You are ${personaName}, the phone receptionist for ${businessName}.` (`:30`)
and `TONE — ... This is a phone call: short sentences, one question at a time,
no bulleted lists read aloud.` (`:46`). The web demo never fixed this; it
appends `webDemoNotice` AFTER the prompt saying the conversation is on the
website, leaving the base text asserting the opposite — a contradiction the
runtime brief flagged as unresolved.

The concierge does not inherit that. `buildSystemPrompt` grows a **medium**
input (`"phone" | "web"`, defaulting to `"phone"` so every existing caller is
byte-identical), which selects those two sentences. Everything else — identity,
language, the business facts, the HARD LIMITS block, never quote a price, never
invent a fact, take a message rather than guess — is the tenant's own and
carries over unchanged. **There is one Sofía**, and this spec keeps the
`route.ts:5-11` promise rather than forking a second prompt.

The web wording must also say she cannot book, and that leaving a name and an
email or phone is how the business gets back to them.

## What a lead looks like, and the consent consequence

`enrich()` gives the widget, free: contact create-or-dedupe on the indexed
`phone_key`/`email_key`, first-touch attribution, the submission→contact link, a
conversation thread, the unread badge, the `form.submitted` event, the
lead-alert email to `form.notify_emails` (`enrich.ts:145`) and the receipt
(`:155`).

**It will not send the instant text, and that is decision 3.** `enrich` gates
`sendInstantReply` on `consentWithheld` (`enrich.ts:169-178`), and a
conversation cannot tick a box under its exact wording — which is why #99
records every consent field as `given: false`. So the concierge passes
`consentWithheld: true` **explicitly and unconditionally**, not as a side effect
of the chosen form happening to carry a consent field. A form without one would
otherwise let a widget lead trigger an automatic text nobody agreed to, purely
because of how the operator built that form.

A widget lead therefore gets the CRM row, the thread, the unread badge, the
alert email and the receipt — and the operator replies by hand from
Conversations. US texting-consent risk is one-sided, and a personal first reply
is a good first touch, not a gap. A proper in-conversation consent moment can be
added later without blocking any of this.

## Delivery — the floating bubble

`embed.js` today serves one fixed script to every embedder
(`app/embed.js/route.ts:6-13`, `s-maxage=3600`), configured entirely by `data-*`
attributes, and it inserts a fixed-size iframe as its own next sibling
(`lib/forms/embed-script.ts:49-57`). That is a **page-loader**, not a widget
runtime: right for a form, wrong for something that floats.

`data-concierge="<publicId>"` joins `data-form` and `data-booking` in the same
script, and takes a different branch: instead of an inline iframe it builds a
fixed-position launcher button and a panel that holds the iframe, with an
open/closed state and a mobile full-screen behaviour.

What does NOT change, and is the reason this stays safe:

- **The conversation still lives entirely in the iframe.** CSS isolation by
  construction — no shadow DOM, no injected styles, no collision, because none
  of the client-facing UI runs in the host page's DOM. Only the chrome does.
- **The `postMessage` handler keeps both checks** — `event.source !==
  iframe.contentWindow` and `event.origin !== origin`
  (`embed-script.ts:75-94`). The bubble adds an open/close message and nothing
  that navigates the host page.
- **Attribution passthrough is reused as-is** (`embed-script.ts:40-47`). The
  iframe cannot read the host page's `utm_*`/`gclid`/`ref`, so they are lifted
  by the loader — miss this and attribution records empty forever while
  appearing to work.
- **The script is still one cached artifact for every tenant.** Per-tenant
  configuration stays in the `data-*` attributes.

`z-index` against a host page's own CSS is the one genuinely new risk. The
launcher takes a high explicit value and a `data-z` escape hatch, and the
styleguide entry documents it.

## Product surface — standard for every client

The architecture already assumed this; what "standard" adds is surface.

1. **The card.** A `Website assistant` section on the **Voice page**
   (`(dashboard)/.../voice/voice-settings.tsx`), beside the `booking_enabled`
   and `textback_enabled` checkboxes it is a sibling of (`:169,180`). Not under
   `/settings` — the persona it configures lives here, and splitting them puts
   the switch on a different page from the thing it switches.
   - the toggle, disabled with a stated reason until a form is chosen — and
     when the assistant is ON, always rendered enabled (it is the off
     switch), naming the stored destination even if that form has since
     been unpublished, with a sentence saying so (amended 2026-09-20). A
     stored destination no longer published is named in the Select in BOTH
     states (never blank), and while OFF it locks the toggle with its own
     sentence. CORRECTED (whole-branch review, 2026-09-20): "rather than
     ever being silently re-enabled onto" (fix round 2's wording) let the
     disable toast's Undo through review twice, because it named only the
     checkbox. The actual rule is EVERY path that calls `enableAction` —
     the checkbox's `disabled`, `turnOn`, and the disable toast's Undo —
     shares one gate (`conciergeCanTurnOn`), decided client-side in the
     card, never in SQL (publication is mutable operational state; a CHECK
     constraint proves nothing that survives the next unpublish)
   - the destination-form select (published forms only; the single form
     pre-selected when the account has exactly one)
   - the copy-the-snippet card
2. **⌘K.** `/voice` is already a palette destination derived from
   `buildNavGroups` (`lib/palette/registry.ts:70-84`), so DESIGN.md's
   registration rule is met by construction. Its `NAV_KEYWORDS["/voice"]` entry
   (`registry.ts:56`) gains `website`, `widget`, `chat`, `concierge`, `bubble`.
   ⚠️ `SETTINGS_SECTIONS` hard-codes `${base}/settings#${anchor}`
   (`registry.ts:117`), so this section is **not** added there — an entry in
   that list would emit a link to an anchor that does not exist.
3. **The snippet component — extract, do not paste.**
   `calendar/embed-snippet.tsx` says in its own comment that it *"mirrors
   `forms/[formId]/embed-snippet.tsx` exactly"*. A third copy is this repo's own
   three-copies threshold. One shared component takes the attribute name, the
   public id and the copy strings; both existing call sites move onto it in the
   same task, so the extraction is proved by its callers rather than asserted.
4. **A `checklist-catalogue.ts` item** — `concierge_embed`, "Put the assistant
   on your website", `external: false`, so it reaches every new client's
   activation flow instead of depending on the agency remembering. A new
   catalogue item needs no backfill: an item with no row reads as undone
   (`checklist-catalogue.ts`, `mergeChecklist`'s own docstring).

**Free per tenant, because the seam is the public id:** the client's persona
(`persona_name`, `greeting_en`/`greeting_es`, `facts`, `services`, `languages`,
`after_hours` are all already on the row), their branding via `publicFormTheme`
(`lib/branding/public-form-theme.ts`, the same engine `/f/[publicId]` paints
with), `enrich()` lead filing, and the caps.

## Screens

**`/c/[publicId]`** — the chat page, `force-dynamic`, `robots: noindex`,
branded from the public id exactly as `f/[publicId]/page.tsx` does: `cache()`d
loads so `generateMetadata` and the component share one query each, and a
branding read that returns `UNBRANDED` on failure rather than throwing
(`page.tsx:30-46`) — a database blip must not cost the client the customer.

Per DESIGN.md's definition of done, all four states are designed:

- **Loaded** — the greeting from the profile (`greeting_en`/`greeting_es` by
  locale), a message list, a composer.
- **Empty** — the greeting IS the empty state. It is the tenant's own copy.
- **Loading** — a skeleton shaped like a message bubble while a turn is in
  flight, never a spinner (DESIGN.md rule 7).
- **Error** — a model call that fails or times out says so in one sentence and
  keeps the composer usable. The turn cap's own end state is its own copy:
  "leave your name and a number and the team will pick this up" — not an error,
  because it is not one.

Tokens only, both themes through the `.dark` class, the `@supports not
(backdrop-filter)` fallback, a visible focus ring, Esc closes the panel.
`/styleguide` gains the message-bubble and launcher variants.

⚠️ **`/b` and `/f` never joined the token system** (recorded in
`bis-next-work`'s design backlog). `/c` is built on tokens from the start; it is
not a reason to convert the other two in this branch.

**Voice page** — the Website assistant card above.
**Forms → Submissions** — widget leads appear there already, with no work,
because they are `form_submissions` rows on the chosen form.

## Testing

Every test names the mutation that must make it fail. The catalogue in
`bis-vacuous-test-shapes` applies, and three entries from it bite here directly:

- **Grants tests must assert 42501**, not merely "an error" — "relation does not
  exist" and a schema-cache miss look identical to a passing deny. And the
  agency simulation is `actAs(c, { app_role: "agency_admin" })`, never
  `actAsOwner`, which does `reset role` and bypasses grants entirely.
- **A table's grants test is not its accessors' test.** Every accessor this
  migration ships needs a caller in a committed test, with rows seeded on BOTH
  sides of BOTH filters — a counter tested against a table holding only its own
  rows cannot fail a swapped filter.
- **A mutation aimed at a module the test MOCKS is invisible.** Route tests mock
  `@bis/db`; mutations for route behaviour must target route code.

Named properties:

1. `concierge_claim_turn` refuses turn N+1 — proved by driving a conversation
   past `CONCIERGE_MAX_TURNS`, and by two concurrent claims at the boundary
   yielding exactly one success.
2. The per-IP conversation cap is checked BEFORE any model call — proved by
   moving the fetch above the check and watching the test go red, the same
   reordering mutation #101's Minor closed on.
3. A throwing counter refuses (fails closed), not proceeds.
4. A conversation id from account A, posted to account B's `publicId`, is
   refused.
5. The render token, honeypot and fill-time floor gate turn 1 and are NOT
   consulted on turn 2 — including a turn 2 arriving more than
   `MAX_TOKEN_AGE_MS` after the page rendered.
6. `consentWithheld: true` reaches `enrich()` even when the chosen form carries
   no consent field — mutation: pass the form-derived value and assert the
   instant reply fires, which it must not.
7. A second `capture_lead` in one conversation files no second submission.
8. `buildSystemPrompt` with the default medium is **byte-identical** to today's
   output for every existing caller.
9. `getVoiceProfileByPublicId` returns null when `concierge_enabled` is false
   and when `concierge_form_id` is null.
10. `EMBED_SCRIPT`'s existing `data-form` / `data-booking` behaviour is
    unchanged, and the `postMessage` source and origin checks still both apply
    on the concierge branch.

Gates before merge, one at a time, read from exit codes in files: `pnpm check`,
`pnpm --filter web build`, `pnpm --filter web test:e2e`. An e2e spec drives one
full conversation to a filed lead — on the **per-run fixture account**, never
`Test Client One` or any live account.

## Out of scope

- **The pgvector knowledge base.** The roadmap pairs it with the concierge, but
  the live account's facts are 2,510 characters — a prompt holds them. A KB
  matters when the corpus outgrows a prompt; building it first invents a
  problem. §8a's M4 row stays honest about this.
- **Booking, rescheduling and cancelling from the widget.** Giving an anonymous
  stranger a path into a tenant's calendar is a larger decision than v1 needs.
  The existing demo already refuses it by forcing `tools: []`.
- **Voice on the client widget.** Decision 1.
- **An in-conversation consent moment.** Decision 3, and it can be added later
  without disturbing anything here.
- **Converting `/b` and `/f` to tokens.** Backlog, not this branch.
- **Touching the voice demo.** `SOFIA_WEB_NUMBER` and
  `api/voice/web/session/route.ts` are unchanged.

## Known properties, accepted

- **A widget lead never gets an automatic text.** Decision 3, deliberate.
- **The widget does not enforce the chosen form's required fields.** Stated
  above; filing an incomplete lead beats discarding a real one.
- **The turn cap ends a conversation the visitor may still want to continue.**
  That is what a cap is. The copy at the boundary invites them to leave their
  details, so the end state still produces a lead.
- **`z-index` can lose to a host page.** Mitigated by a high default and a
  documented escape hatch, not solved — nothing embedded in someone else's page
  can solve it.
- **A conversation left open costs nothing.** Unlike the Realtime demo, text
  bills per turn. There is no session to bound, which is decision 1's third
  reason and the reason nothing in this spec claims to cap a duration.

## Order of work

1. **Migration 0042** — the three `voice_profiles` columns, the
   `concierge_conversations` table with its grant block, and
   `concierge_claim_turn`. Plus the accessors, each with a caller in a test.
   *The orchestrator applies the migration, exactly once. The implementer never
   applies one.*
2. **`buildSystemPrompt` medium** — defaulting to `"phone"`, with the
   byte-identity test for existing callers.
3. **`/c/[publicId]`** — the chat page, branded, render token, honeypot, all
   four states.
4. **`POST /api/concierge/[publicId]/turn`** — the caps, the model call, the
   `capture_lead` tool, `enrich()`.
5. **The embed loader** — `data-concierge`, bubble chrome, and the shared
   snippet component both existing call sites move onto.
6. **Product surface** — the Voice-page card, the palette keywords, the
   checklist item, `/styleguide`.

Steps 1–4 are the product. 5 is what makes anyone use it. 6 is what makes it
standard rather than a one-off.

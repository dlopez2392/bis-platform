# Automations Milestone C — Instant reply to new leads — Design

**Date:** 2026-09-07 · **Status:** all five sections approved by danlo on
2026-09-07 · **Parent spec:** `2026-09-06-automations-design.md`, whose
Section 1 names this milestone ("the inline path — fires at the emit site, no
cron, different mechanism, own seam") and says it gets a short design pass of
its own before it is planned. This is that pass.

## Decisions taken in this pass (danlo, 2026-09-07) — do not re-litigate

- **Scope = the web-form lead, text channel.** An instant SMS to a person who
  submitted a public form with a phone number. The email receipt every
  published form already sends is unchanged. Inbound texts from unknown
  numbers get no auto-reply, the booking page and the voice paths are
  untouched. (Options considered: adding an editable email half; adding an
  inbound-SMS auto-reply. Both rejected — the text is the only channel where
  nothing exists, and speed-to-lead is the point.)
- **Trigger = every qualifying submission, new or returning contact,** under a
  24h per-thread hold and a consent rule (Section 1). Not "brand-new contacts
  only", not "every submission with no hold".
- **Two bodies, English and Spanish; the submission's locale picks.** Not one
  body, not the text-back's empty-means-default pattern.
- **Seam = a direct call inside the form action** (Approach 1). Not an event
  dispatcher hung on `emit()` (hidden control flow, `@bis/db` mock blast
  radius, no second inline recipe designed), not Next's `after()` (a pattern
  no other send uses, console-only failures either way).
- **Daily cap reused as-is:** `AUTOMATION_DAILY_CAP` (25 per account per 24h),
  counted on a stamp on the submission row. No per-tick cap — there is no tick.
- **One attempt, no retry, no failure-marker column.** The receipt email
  already went; the failed text is visible in the inbox.
- **Storage:** English in `automations.body` (the column every recipe treats as
  "the text that sends"), Spanish in `automations.config.bodyEs`.

Open and deliberately NOT part of C (from Milestone B's review; danlo decides):

1. The ~2h text reminder gets one attempt ever (24h cooldown × 45-minute
   window). Recommendation on file: exempt that pass from the 24h hold so it
   retries next tick — the window bounds it to three attempts.
2. `brandDisplayName` falls back to `accounts.name` when `brand_name` is null,
   so the agency's internal label reaches customers through every composer.
   Recommendation on file: a separate small PR sequenced BEFORE C's build —
   fall back to the no-name copy variants and require a brand name at
   go-live. C's send path composes nothing (Section 3), so C itself cannot
   leak a name at send time; only its prefilled defaults on the page inherit
   the resolver, like the other three cards.

## Decisions taken after the review (danlo, 2026-09-07) — built in PR #30

The review of the built branch (all eight claims confirmed, zero Critical)
raised two pre-enablement risks; danlo decided both, plus the two items still
open from Milestone B's review:

1. **Destination allowlist: `+1` and `+52` only.** `toE164` accepts any
   8–15-digit number as `+digits` and nothing in the SMS layer restricts a
   destination, and this is the only recipe whose trigger needs no
   reservation, call or login. `INSTANT_REPLY_ALLOWED_PATTERNS` in `caps.ts`
   — a SHAPE per prefix (ten digits after `+1`; ten after `+52`, or the
   legacy mobile `1` and ten), because `toE164` also turns a typed
   "12345678" into a NANP-impossible `+12345678` that a bare prefix would
   admit (re-review, 2026-09-07). A number outside it is a new free-check
   skip, `outsideRegion`, logged with the submission id and the first three
   characters only. US/Canada and Mexico are who a Rio Grande Valley
   business serves; the Caribbean NANP caveat is documented on the constant.
2. **The frozen prefill (the `accounts.name` fallback) is fixed
   platform-wide in its own PR**, the resolver fix that was Milestone B's
   open Decision 2. It lands before any account enables this recipe. The
   card keeps resolving its defaults the way the other three cards do.
3. **The text reminder retries next tick** (Milestone B's open Decision 1):
   the pass no longer reads its attempt marker; its 45-minute window bounds
   it to three attempts and three failed rows. `skippedRecentFailure` leaves
   that pass's counters. The morning-band recipes keep the 24h hold.
4. **Sequencing:** items 1 and 3 fold into PR #30 before merge; item 2 is
   the next PR.

## Section 1 — Scope and trigger (APPROVED)

The recipe is `instant_reply`: one row per account in `automations`, off by
default, configured on the Automations page (Section 4). It fires from the
public form action `apps/web/src/app/f/[publicId]/actions.ts` and nowhere else.

A submission texts the lead when every one of these holds. The first miss ends
it with a named outcome (Section 3 gives the check order actually executed,
which puts the free checks first):

- **The submission passed the spam gates.** Honeypot, too-fast, rate-limited
  and duplicate submissions return `successFor(...)` before `enrich` runs and
  never reach this code.
- **Enrichment produced a contact and a thread.** If the contact write failed,
  `contactId` is null, there is no thread to put a text in, and nothing sends.
- **The account has `instant_reply` enabled.**
- **The phone the person typed parsed to E.164.** The action already computes
  `toE164(rawPhone)` for the contact row and stores the raw string when it
  does not parse; a number that stayed as typed is not textable.
- **No optional consent box was withheld.** `form_submissions.consent` stores
  `[{key, given, text, at}]`, one entry per consent field. Any entry with
  `given: false` means no text. Required consent fields cannot be submitted
  unticked, so this only bites optional consent a person deliberately skipped.
- **The account passes the A2P sender gate** (`resolveSmsSender`), the same
  gate as every other send. It fails closed.
- **The lead's thread has no non-failed outbound text in the last 24h**
  (`hasRecentOutboundSms`). One conversation exists per (account, contact) —
  `conversations_account_contact_unique` — so a returning contact's second
  submission lands in the same thread, and this hold is the primary
  double-text guard for new and returning contacts alike. Its "any outbound
  text counts" semantics are wanted here: if the company already texted this
  person today, a generic "we got your message" is redundant.
- **The account has fewer than 25 instant replies stamped in the last 24h.**
  The 26th lead still gets the email receipt, and the staff alert still goes.

The text goes out LAST — after the staff alert (`notify`) and the receipt
(`receipt`), in its own try/catch, independent of both. A provider failure
leaves a failed message row in the lead's thread and a log line. It never
touches `form_submissions.processing_error` (that field means "nobody was told
about this lead") and never fails the submission.

What the lead experiences: they press Submit, see the success screen, and
within a few seconds hold a text from the company's own number in the language
they filled the form in. Replying lands in the thread the form opened.

## Section 2 — Data layer and migration (APPROVED)

**Migration `0027_instant_reply.sql`**, applied ONCE through the Supabase tool
after a separate pre-flight read, in the 0026 shape:

1. `automations_recipe_key_check` dropped and re-added with `'instant_reply'`
   as the fourth key. The pre-flight confirms the constraint name first, as
   0026's did.
2. `alter table public.form_submissions add column instant_reply_sent_at
   timestamptz;` — null means no text was sent for that submission.
3. `create index form_submissions_instant_reply_sent on public.form_submissions
   (account_id, instant_reply_sent_at) where instant_reply_sent_at is not null;`
   — the daily-cap count is an index-only read.
4. **Grants.** The column is written only by the service role from the public
   form path. The pre-flight reads what `authenticated` currently holds on
   `form_submissions` (no migration grants or revokes on that table — it lives
   on whatever 0001/0006 established), and the plan pins that standing in
   `packages/db/src/test/automations-grants.test.ts` the way B pinned the
   bookings columns. `SUBMISSION_COLS` in `forms.ts` is an explicit column
   list, so the dashboard's submission reader never sees the stamp.

**`packages/db/src/automations.ts`** additions, beside the three recipes:

- `RecipeKey` gains `"instant_reply"`.
- `InstantReplyConfig = { bodyEs: string }` and
  `parseInstantReplyConfig(raw: unknown): InstantReplyConfig | null` — refuses a
  missing or non-string `bodyEs`. Used on write (save action) and on read
  (send path), like `parseReviewRequestConfig`. The length cap on both texts
  (`AUTOMATION_BODY_MAX_LENGTH`, 1000) is enforced in the save action, where
  that constant lives; the parser checks shape only.
- The inline read uses the existing `getAutomation(db, accountId, "instant_reply")`.
  `listEnabled` (the cron's fan-out across accounts) is the wrong shape and is
  not touched.
- `stampInstantReplySent(db, submissionId)` — sets `instant_reply_sent_at = now()`.
- `countInstantRepliesSince(db, accountId, sinceIso)` — `count` of rows for the
  account with `instant_reply_sent_at >= sinceIso`.

No failure-marker column, no attempt counter, no change to `contacts`,
`conversations` or `messages`. A failed text is a normal failed message row.

## Section 3 — The send path (APPROVED)

**New module `apps/web/src/lib/automations/instant-reply.ts`**, one export:

```ts
export type InstantReplyInput = {
  db: SupabaseClient; now: Date;
  accountId: string; submissionId: string; contactId: string; conversationId: string;
  phoneE164: string | null;          // toE164(rawPhone) — null when it did not parse
  locale: "en" | "es";               // the submission's normalized locale
  consentWithheld: boolean;          // any consent entry with given === false
};
export type InstantReplySkip =
  "noPhone" | "consentWithheld" | "disabled" | "smsGate" | "recentText" | "dailyCap";
export type InstantReplyOutcome =
  | { kind: "sent"; unstamped: boolean }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: InstantReplySkip; detail?: string };
export async function sendInstantReply(input: InstantReplyInput): Promise<InstantReplyOutcome>;
```

It never throws for a business reason. Order inside — free checks before any
read, a deliberate small reorder from Section 1's list that changes only which
reason is reported when two apply:

1. `phoneE164` null → `noPhone`.
2. `consentWithheld` → `consentWithheld`.
3. `getAutomation(...)`: missing, `enabled: false`, or a config the parser
   refuses → `disabled`. Accounts with the recipe off pay exactly this one
   indexed read per submission.
4. `resolveSmsSender(db, accountId)` not ok → `smsGate`, `detail` = the gate's
   reason.
5. `hasRecentOutboundSms(db, accountId, conversationId, now − 24h)` → `recentText`.
6. `countInstantRepliesSince(db, accountId, now − DAILY_CAP_WINDOW_MS) >=
   AUTOMATION_DAILY_CAP` → `dailyCap`.
7. Body = `automation.body` for `en`, `config.bodyEs` for `es`, sent VERBATIM
   (no composition, no link, no name resolution). Then the shared write-then-
   send path `sendAutomationSms(ctx, { accountId, contactId, to: phoneE164,
   from: gate.from, body, onProviderFailure: async () => {} })` — provider
   first, conversation, message row, send. The failure callback is a no-op
   because nothing retries. A provider failure (the helper has already marked
   the row failed) → `{ kind: "failed", error }`.
8. `stampInstantReplySent(db, submissionId)`, then `markAutomationSmsSent(ctx,
   accountId, sent, "instant reply")`. A stamp failure after a successful send
   → `{ kind: "sent", unstamped: true }`; the thread hold still blocks a double
   text and the cap undercounts by one.

**One small refactor in `send-sms.ts`:** `sendAutomationSms` and
`markAutomationSmsSent` take `SmsSendContext = Pick<PassContext, "db" | "sms">`
instead of the full `PassContext`. A full context satisfies the pick, so the
five passes and their tests do not change, and the inline module never
constructs an email provider it does not use. The lazy SMS getter moves out of
`buildPassContext` into an exported `lazySmsProvider()` in `harness.ts` so
there is one definition; the inline module builds `{ db, sms: lazySmsProvider() }`.

**The form action change** (`enrich` in `f/[publicId]/actions.ts`):

- `enrich` gains a `consentWithheld: boolean` parameter, derived where the
  outer action already builds the consent record (`consentFields.map(...)`).
- `conversationId` and `phoneE164` are hoisted out of the enrichment try like
  `contactId` already is.
- A fourth independent block after `receipt(...)`:

```ts
if (contactId && conversationId) {
  try {
    const outcome = await sendInstantReply({ db, now, accountId, submissionId, contactId,
      conversationId, phoneE164, locale, consentWithheld });
    logInstantReplyOutcome(submissionId, accountId, outcome);   // in the module
  } catch (e) {
    console.error(`instant reply crashed for submission ${submissionId}: ${String(e)}`);
  }
}
```

**Logging** (console.error, the passes' convention): `smsGate` ("account …
cannot text (reason)"), `dailyCap`, `failed`, and `sent` with `unstamped: true`
("text sent but submission … not stamped"). `disabled`, `noPhone`,
`consentWithheld` and `recentText` are normal and stay silent — `disabled` in
particular would otherwise log once per submission for every account without
the recipe.

**Cost** for an account with the recipe on: five small reads (automation, A2P,
phone number, recent text, cap count), four small writes (conversation lookup/
insert, message row, stamp, status), one Telnyx call. Roughly half a second to
a second on the form POST, after the lead is saved and both emails have gone.

## Section 4 — Copy and the card (APPROVED)

**Defaults**, one per language, following `textback-body.ts`'s measured rules:
plain sentences a business owner would type; the company named up front
(a text from an unknown number otherwise reads as spam); no em dash (outside
GSM-7); the Spanish written with no á/í/ó/ú (é, ñ, ü, ¿, ¡ are inside GSM-7)
so it stays one segment; a blank brand name drops the opening clause rather
than inventing "our team". Tú form, matching the receipt email the same person
gets in the same minute (`lead-receipt.ts`: "Recibimos tu mensaje…").

- English: `Hi, this is {brand}. We got your message and will be in touch shortly. Reply here if you'd like to add anything.`
- Spanish: `Hola, somos {brand}. Recibimos tu mensaje y nos pondremos en contacto pronto. Responde a este mensaje si quieres agregar algo.`
- No name: the first sentence is dropped; the rest stands unchanged.

Strings live in `apps/web/src/lib/messages.ts` (this repo's client-facing-copy
rule) under `automations.instantReply.defaultBodyEn / defaultBodyNoNameEn /
defaultBodyEs / defaultBodyNoNameEs`, mirroring the `voice.textback.*` keys.
`apps/web/src/lib/automations/instant-reply-copy.ts` exports
`defaultInstantReplyBody(brandName: string, language: "en" | "es"): string`.
Segment counts are pinned in its test, including the accented-name case
(`defaultInstantReplyBody("García Roofing", "es")` measured, not assumed).

The brand name reaches the page the way the other three defaults get it
(`page.tsx`: `brandDisplayName(branding, acct?.name ?? "")`) — the resolver
the open Decision 2 will fix. The send path composes nothing, so no name can
leak at send time.

**The card** — `instant-reply-card.tsx`, fourth on the Automations page after
the text reminder, mirroring `sms-reminder-card.tsx`; `data-testid="instant-reply-card"`,
every id scoped to the card (`instant-enabled`, `instant-body-en`,
`instant-body-es`, `instant-reply-preview-en/-es`, `instant-reply-count-en/-es`)
because Playwright strict mode throws on an unscoped `getByLabel`:

- Title **"Instant reply to new leads"**. Description: texts a new lead from
  your number the moment they submit a form with a phone, in the language
  they used; off until you turn it on, and only for companies whose texting
  registration is approved. The email receipt they already get is unchanged.
- Enabled checkbox, and the same blocked notice the reminder card shows
  (`compose.smsBlockedA2p` / `compose.smsBlockedNoNumber`) from the page's
  `resolveSmsSender` result.
- Two textareas, **English message** and **Spanish message**, each prefilled
  with its default when the row has none, each with a hint naming which
  submissions receive it, a live `<output>` preview that IS the string that
  sends (the body verbatim), and its character and segment count via
  `segmentsFor` / `compose.smsSegments`.
- Save → `saveInstantReplyAction(accountId, formData)` in
  `automations/actions.ts`: `isAgency` re-check like the others; both texts
  trimmed and non-empty when `enabled` (error `automations.instantReply.bodiesRequired`);
  each ≤ `AUTOMATION_BODY_MAX_LENGTH`; `upsertAutomation(serviceDb(), accountId,
  "instant_reply", { enabled, body: bodyEn, config: { bodyEs } }, userId)`;
  `revalidatePath` on the page; `useFormSubmit` + toast on the client like the
  other cards.

## Section 5 — Testing (APPROVED)

One named mutation per new test, reverted, diffed back — the house rule. The
test files below all exist today except the two new module tests.

- **The module** — `lib/automations/instant-reply.test.ts` (new). Every skip
  reason in Section 3's order; the sent path's ordering (provider constructed
  before any row, row before send, stamp before mark-sent); provider failure
  (row marked failed, no stamp, `failed`, nothing thrown); stamp failure after
  a successful send (`sent`, `unstamped: true`); locale picking the body
  verbatim; a config the parser refuses → `disabled`. Module-level mocks of
  `@bis/db` and `@/lib/sms/sender`, as the pass tests do.
- **The sentinel** — a new describe in `sentinel.test.ts`: `sendInstantReply`
  run for an account whose name is `"Rio Roofing — trial"` with clean saved
  bodies; every send argument and the message row scanned for the label.
  Mutation: prefix the body with the account name inside the module.
- **The form action** — `f/[publicId]/actions.test.ts` (20 tests today) and
  `actions.returning-lead.test.ts`: the reply is invoked after the receipt
  with the E.164 phone, locale, contact, thread and consent flag; a THROWING
  reply never fails the submission and never writes `processing_error`;
  every spam-rejected path and a failed enrichment never invoke it; a
  returning lead still qualifies. `@/lib/automations/instant-reply` is mocked
  at module level exporting its one function (vitest throws on any export a
  factory mock omits).
- **Copy** — `instant-reply-copy.test.ts` (new): both defaults measured with
  `segmentsFor`: one GSM-7 segment for a plain brand; `"García Roofing"`
  pinned at its real encoding and count; the blank brand dropping the clause;
  no em dash in either.
- **Save action and page** — `automations/actions.test.ts`, `page.test.ts`:
  both texts required when enabling; the cap per text; config stored as
  `{ bodyEs }`; `parseInstantReplyConfig` refusing a non-string; the fourth
  card rendering with the blocked notice when the account cannot text.
- **Database** — `packages/db/src/test/automations.test.ts` (hits the REAL
  project): the catalogue accepts `instant_reply` and refuses an unknown key
  (23514); the stamp lands; the count respects window and account.
  `automations-grants.test.ts`: the client role's standing on
  `form_submissions` pinned under `withRollback` + `actAs`, one refused
  statement per rollback, SQLSTATE pinned (42501 vs PGRST204), watched
  failing first.
- **End to end** — `apps/web/e2e/automations.spec.ts`: the agency sees the
  fourth card, both previews render at one segment for the fixture brand,
  every locator scoped to `getByTestId("instant-reply-card")`. It NEVER
  enables the recipe: e2e shares the production database.
- **Gates** — `pnpm check`, build, full e2e, against the baseline at `2293b74`:
  db 213 · web 1329 · e2e 71.

Not provable automatically: a real text to a real lead. No account is
A2P-approved and `TELNYX_API_KEY` is unset, so in production the recipe is
inert at the sender gate (`a2p_not_approved`) until one is — exactly like B's
SMS paths.

## Verified facts (checked in source 2026-09-07 — do not re-derive)

- The public form action already sends TWO customer/staff emails inline and
  awaited: `notify` (staff alert, `notify_emails`) then `receipt` (the lead's
  auto-reply, every published form, no switch), each in its own try/catch;
  the receipt is logged, never recorded on the submission (`actions.ts:357-372`).
- `enrich(db, form, submissionId, answers, attribution, origin, locale)` is
  called at `actions.ts:236`; consent is built in the outer action
  (`consentFields.map(...)`, `:142-150`) and stored as `[{key, given, text, at}]`.
- `toE164` is imported from `@/lib/voice/phone-number` (`:23`); the contact
  row stores `toE164(rawPhone) ?? rawPhone` (`:294`).
- `ensureConversation(db, accountId, contactId, actorId, actorType)` returns
  the existing row for `(account_id, contact_id)`; the unique constraint is
  `conversations_account_contact_unique` (`messaging.ts:57-80`).
- `hasRecentOutboundSms(db, accountId, conversationId, since)` counts outbound
  `sms` rows with `status != 'failed'` since `since` (`messaging.ts:246-260`).
- `resolveSmsSender(db, accountId)` → `{ ok: true, from }` or
  `{ ok: false, reason: "a2p_not_approved" | "no_live_number" }`, fails closed.
- `sendAutomationSms(ctx: PassContext, input)` and `markAutomationSmsSent(ctx,
  accountId, sent, what)` in `lib/automations/send-sms.ts`; `buildPassContext`
  in `harness.ts:14-23` constructs email eagerly and SMS lazily.
- `caps.ts`: `AUTOMATION_TICK_CAP = 10`, `AUTOMATION_DAILY_CAP = 25`,
  `DAILY_CAP_WINDOW_MS = 24h`, `SMS_RETRY_COOLDOWN_MS = 24h`,
  `AUTOMATION_BODY_MAX_LENGTH = 1000`.
- `automations` table (0025): `body text not null default ''`, `config jsonb`,
  `unique (account_id, recipe_key)`; the check is named
  `automations_recipe_key_check` and 0026 re-created it with three keys.
- `form_submissions` (0006) has no `instant_reply_sent_at`; `listSubmissions`
  selects the explicit `SUBMISSION_COLS`. No migration grants or revokes on
  `form_submissions` by name.
- Real domain events already emitted include `form.submitted`
  (`emitFormSubmitted`, `forms.ts:293`); nothing consumes any event for side
  effects.
- `defaultTextbackBody(brandName, language)` (`lib/voice/textback-body.ts`) is
  the precedent for bilingual, GSM-7-measured, no-name-drops-the-clause copy.
- The Automations page (`automations/page.tsx`) loads the three rows with
  `getAutomation`, resolves `brandName` through `brandDisplayName`, and calls
  `resolveSmsSender` once so every card can show the blocked notice.
- Next.js is `16.2.11`; nothing in `apps/web/src` uses `after()` / `waitUntil`.
- The cron runs `*/15` (`apps/web/vercel.json`); Milestone B's first live tick
  ran 03:00:24Z on `2293b74` with a 200 and zero error lines.

## Status and next steps

1. danlo reviews this written spec.
2. danlo calls the two open Milestone B decisions; Decision 2 (the
   `brandDisplayName` fallback) is recommended as its own small PR before C's
   build.
3. Invoke `superpowers:writing-plans` — and ONLY that skill — for Milestone C.
4. Inline execution on `feat/automations-c` (danlo's stated preference), one
   review at the end, PR, CI `verify` + `e2e` green on the head, danlo merges.
   Migration 0027 is applied once, in Task 1, after its pre-flight read, and
   never re-applied.

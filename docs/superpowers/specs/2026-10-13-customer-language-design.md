# A language on every customer, and the automatic messages in it — design (first release, item 5: S-09, with F-008 part, F-011 part, F-049 part)

Date: 2026-10-13. Owner decisions L1–L3 and the delivery split (danlo, 2026-10-13, given in the brief; §2 records
them verbatim as D-rows). Plan: `docs/crm-features.md` §4.3 item 5 (`:1272-1276`: S-09 3–4, F-008 +1–1.5, F-011
part +0.5, F-049 part +0.5), the feature rows F-008 (`:1920`), F-011 (`:1923`), F-049 (`:2033`), and decision 33's
first group (`:3316-3328`, ratified 2026-10-05), which already sets aside "the booking spec's fixed reminder timing
(F-049 part 1, reminders however late they booked)". Siblings: the record page (`2026-10-12-record-page-design.md`,
"part 1"; its C11 waits on this spec) and the drawer (`2026-10-13-record-drawer-design.md`, "part 3"). Design
contract: DESIGN.md rules 3, 5, 6, 8, the Record page section, Provenance, and the definition of done's bilingual
line. Starting inventory: `.claude/worktrees/s09-inventory.md`, re-read against the code (§4 lists what did not
hold).

**Delivery: two PRs** (D4, D5). **PR 1** carries migration 0076, the language on the contact, its signals, its
line and hint on the record and in the drawer, and the `lang` of customer-typed text. **PR 2** changes no schema:
the send rule, Spanish reminders, the late-booking reminder, and the Spanish boxes on the editable messages
(their columns ride in 0076, C17).

**What is verified and what is not.** Every function name, line and count below was read off the worktree at
`0d6d0edc` (branch `feat/s09-language`). Anything not read is labelled **Assumption**. Counts on production are
**not** assumed: §18 lists the read-only queries that measure them before PR 1's backfill is decided.

## 1. Goal

A Spanish-speaking customer of a Valley business gets every automatic message in Spanish, not only the ones sent
in the minute they booked. Today the confirmation is in their language and the reminder a day later is not,
because nothing remembers what language they used: the reminder runs from a cron that "has no booker language on
the row" (`lib/email/templates/booking.ts:4-11`). This spec gives the customer's record that memory, filled
automatically from the customer's own first clear sign, always correctable by staff, never overwritten behind
staff's back; makes every scheduled message read it; and gives every message an owner can edit a Spanish version
beside the English. It also closes the one reminder gap the plan carries with it (F-049): an early appointment
booked the evening before, which today gets no reminder email at all.

## 2. Decisions

Owner (danlo, 2026-10-13), verbatim from the brief:

| # | Question | Decision |
|---|---|---|
| L1 | How a contact's language is set | Automatically from the customer's own first clear signal (a booking on the Spanish booking page, by web or by phone with Sofía; a form filled in Spanish; a call where they spoke Spanish — calls.language) ONLY when the contact has no language yet. Staff can always change it; a staff choice is never overwritten. When later evidence disagrees with the stored language, the record shows a hint "Spoke English on the last call. Switch to English?" with Switch / Keep; Keep hides it until a newer signal. |
| L2 | Editable automation messages | (calendar follow-up, review request, no-show nudge, appointment-confirm SMS, quote follow-up, referral ask, reactivation, and a custom missed-call text-back): each gets a Spanish box beside the English one, pre-filled with our written Spanish default. Spanish customers get the Spanish box. If someone edits the English but not the Spanish, the card warns "The Spanish still says the old message". If the Spanish box is emptied, Spanish customers get the English. No machine translation (F-011's AI twin drafting is later). |
| L3 | A customer with no language | A customer with no language → the account's language (accounts.language, 0065), else English. accounts.language today governs client-role dashboard sessions only (0065's comment); it now also sets the default for customer messages, and its Settings label must say so. |
| D4 | Delivery | Design approved as presented: TWO PRs. PR 1 (migration 0076): contacts.language ('en'\|'es'\|null) plus its source and set time; the auto-set writes at each signal point (web booking action, Sofía's booking tools, form submission, call finish), only when null, never over a staff choice; the hint; a Language line in Details on the record page and in the drawer ("Español · from her booking (Oct 3)"), inline edit with Undo, Technician scope as other fields; customer-typed text carries the contact's language instead of `lang=""`; who may write the column decided with 0053 in mind. |
| D5 | PR 2 | The rule — in-the-moment replies (confirmations, lead receipt, missed-call text-back default, consent replies) keep following the live signal; scheduled sends (reminders email + SMS, the automations above) use contact.language → account.language → 'en'. Reminders gain Spanish copy. The late-booking gap (reminder-timing.ts:20-27, D-029): send one at the start of sending hours (8 AM, the account's zone) that morning when there is still useful time; define the exact threshold. The Spanish boxes: schema, null meaning "our default Spanish", the staleness warning, settings UI on each card (rule 8), opt-out footer already bilingual. |
| D6 | Out of scope | Weekly report and lead alert to the owner (staff-facing → F-013), language detection from inbound text messages, AI translation/glossary, CSV language column, the booking row's own locale column unless shown to be needed. |

Choices this spec makes (each is the brief's "decide …" answered; Q-rows in §22 ask the owner to confirm the
ones that change what a customer receives):

| # | Choice | PR |
|---|---|---|
| C1 | **The source is a closed set of four: `booking`, `form`, `call`, `staff`.** No `import`: a CSV language column is out of scope (D6) and nothing else imports a language. A backfilled value (§18) takes the source of the evidence it came from (`form` or `call`), never a fifth kind, so the Details line reads the same for old and new contacts | 1 |
| C2 | **Server-only, the 0053 convention.** The client role gets no UPDATE on any language column (a column added after 0053 is not client-updatable until granted by name, `0053_server_only_writes.sql:28-29`), and a plain trigger nulls them on a client-role INSERT (contacts keep their table-level INSERT, `schema-grants-guard.test.ts:81-84`), the `current_user = 'authenticated'` shape of `app.stamp_created_by()` (`0071_places_and_equipment.sql:139-148`). Staff edits go through a server action that proves the contact on the request client first (`getContact` under RLS, so Technician scope holds, `0068_mine_unassigned_technician.sql:103-107`) and writes on the service client. Why not client-writable like Source: the auto-set's one promise ("never over a staff choice") rests on the source being true, and a client write could claim any source; and Undo must restore the prior source exactly (C9), which a stamping trigger cannot | 1 |
| C3 | **The one auto writer is a SQL function**, `public.record_language_signal(...)`, executable by `service_role` only: it records the signal and sets the language **in the same statement only when it is null**. "Only when null" is therefore one atomic UPDATE, not a read then a write: Sofía's booking tool and the call's finish can race on the same contact (§7.3), and the first wins | 1 |
| C4 | **The hint is computed on read from stored facts**, not stored itself. The contact keeps its LAST signal (language, source, time) and when Keep was pressed; the hint is a pure function of those and the language's own set time (§7.4). Computing it from the calls, bookings and forms on every read would need a strict language per call that `calls.language` does not hold (C5) and three joins on every record and drawer open | 1 |
| C5 | **A call's signal is a STRICT reading of the caller's words, never `calls.language`.** `calls.language` is forced to the voice profile's language whenever the profile is not "both" (`lib/voice/language.ts:18`) and turns every tie or empty transcript into English (`:22-25`): both are defaults, not evidence. A new `clearCallerLanguage(transcript)` answers `"es"`, `"en"` or `null` (unclear) from the caller's turns alone, ignoring the profile (§7.2). `calls.language`, the Calls badge and the text-back's language are unchanged | 1 |
| C6 | **A web page's language counts only when it is not what the customer would get anyway.** No public page offers a language choice (no switcher on the booking or form page; both read `?locale=` or the form's own default, `b/[publicId]/(book)/page.tsx:111`, `f/[publicId]/page.tsx:52-53`), so a page's default is the business's choice, not the customer's. A booking or form in Spanish on an account whose fallback is English is a signal; in English on an account whose language is Spanish, a signal; in the fallback's own language, nothing (it would change no message) | 1 |
| C7 | **Phone bookings signal as `booking`, at the booking**, from the strict reading of the call so far (the turns plus the one still arriving, as `detectCallerLanguage` reads them, `language.ts:41-50`); the call's finish signals again as `call`. A booking made by a caller who never said enough to read stays unsignalled until the finish | 1 |
| C8 | **The Details line shows the effective fallback when the language is not set** ("Not set. Messages go out in English, the account's language."), so the owner never has to know rule L3 to know what a customer gets | 1 |
| C9 | **Undo restores the prior triple exactly** (language, source, set time), including back to "not set". The action returns the prior values, the toast's Undo sends them back through a restore action on the same proof (C2) | 1 |
| C10 | **Customer-typed text takes the contact's language only when one is set**; with none it keeps `lang=""`. The account's language is a sending default, not evidence of what a customer wrote. The caller's own words on the call card keep the call's own `lang` (`call-card-panel.tsx:86`), a per-call value that already exists; that is a deviation from the brief's list, said here on purpose (§9) | 1 |
| C11 | **One message, one language.** Whatever language the BODY resolves to (§10.2), the subject, the fixed lead sentence, the button, the date, the email unsubscribe footer and the SMS opt-out line follow it. A Spanish customer whose Spanish box was emptied gets the whole message in English, never an English body under a Spanish subject | 2 |
| C12 | **The resolver is one function in one place**, `recipientLanguage(contactLanguage, accountLanguage)` in `packages/db/src/messaging.ts`, called by every scheduled due-list's mapper, so each due row carries its resolved `language` and no pass re-derives it | 2 |
| C13 | **The Spanish box has three states**: `null` = our written Spanish default (the box shows it pre-filled); `''` = emptied, Spanish customers get the English; any text = theirs. Saving a box whose text equals our current default stores `null`, the 0024 discipline that "an unrelated save can never silently pin the frozen default into the column" (`0024_textback.sql:13-15`) | 2 |
| C14 | **Staleness is detected by the English the Spanish was written beside** (`*_es_basis`), not by timestamps: a pure comparison with no clock, immune to a re-save of the same English (§12.3) | 2 |
| C15 | **The SMS reminder's closing line gets a Spanish box too**, though L2's list does not name it: it is an editable body (`automations.body`, read at `passes/sms-reminder.ts:115`) on a scheduled send, and without a box a Spanish reminder would end in the operator's English. The instant reply keeps its own Spanish (`config.bodyEs`, `automations/actions.ts:299-319`), already shipped with a different contract (both required, no default) | 2 |
| C16 | **The late-booking reminder email goes at 08:00 when no text reminder will cover it** and the appointment starts more than 45 minutes after the hours open (09:00 in, 08:45 out). Where a text reminder will go, D-029's rule stands unchanged, so the email and the text still never land together (§11.3) | 2 |
| C17 | **0076 also carries PR 2's columns** (the Spanish boxes and their bases), unused until PR 2: one apply cycle (bis-ci, production, parity) instead of two. PR 2 then has no migration (Q6) | 1 |
| C18 | **A business-cancel notice pre-selects the contact's resolved language** in the owner's dialog, which already asks (`calendar/cancel-notice.ts:71-72`). The owner still chooses | 2 |
| C19 | **Spanish texts stay one segment's alphabet.** Every Spanish SMS default and lead is written without á, í, ó or ú (outside GSM-7, `lib/sms/segments.ts:15-17`), the rule the text-back already keeps (`lib/voice/textback-body.ts:63-71`); and the date inside a Spanish text is folded (`sáb` → `sab`), because `formatWhen`'s Spanish output carries them (§13) | 2 |

## 3. Non-goals

Everything in D6. Also: the in-the-moment messages' language rule (D5; they keep the live signal); the consent
gate, the send gate and the email gate (they already take a `language`, §10.4, and are not changed); the instant
reply's bilingual bodies (C15); the Calls page's language badge and `calls.language` (C5); a language on the add-by-
hand contact form; a language column on bookings (§10.5 shows it is not needed); converting today's tú Spanish to
usted (Q5); the dashboard chrome of the automation cards in Spanish (they are agency-only and English today; their
new keys get twins for the ratchet, §15); timeline rows for a language change (it is a fact on the record, not an
event in the customer's story; the change is still an `events` row with its actor, §7.5).

## 4. What exists today (re-verified; corrections to the inventory and the brief)

| Fact | Where |
|---|---|
| No `language` on `contacts`; the client role's UPDATE list has no such column | `schema-grants-guard.test.ts:81-84`; `packages/db/src/contacts.ts:58-59` (`COLS`) |
| `accounts.language` is the client-role dashboard default only | `0065_account_language.sql:14-19`; written only by `setAccountLanguage` (`accounts.ts:147-153`) |
| The Settings card says so | `messages.ts:926-927` ("Changes the language your client sees when they sign in, and their alert texts…") |
| `form_submissions.locale` is stored per submission; `forms.locale_default` per form | `0006_forms.sql:53`, `:29` |
| `bookings` stores no language | `booking.ts:4-11` (the recorded follow-up) |
| `calls.language` and `calls.transcript` are stored | `packages/db/src/voice.ts:45-48`; `0019`'s `transcript jsonb` |
| No scheduled pass passes a `language` to any gate | grep `language\|locale` over `lib/automations/passes/*.ts`, no hit outside tests |
| The reminder email has no locale input and a hard-coded English subject | `booking.ts:318-326`, `:341-367`; `passes/reminders.ts:78-80`, `:95` |
| Every editable body is one English column | `automations.body` (`0025_automations.sql:26`, the eight recipes `0047_automations_b.sql:73-75`); `calendars.followup_body` (`0022_meetings_followups.sql:6`, client-editable `:12-13`); `voice_profiles.textback_body` (`0024_textback.sql:16-18`, server-only by inheritance `:8-11`) |
| The gates already speak Spanish when told | email footer `lib/consent/email-gate.ts:69-70`, `:198`; SMS opt-out `lib/sms/opt-out.ts:56-68`, forwarded by `sendAutomationSms` (`send-sms.ts:130`) |
| The YES/NO reader already accepts "si" and "sí" | `packages/db/src/automations.ts:794` |

**Corrections.**
- The inventory's row "Reminder (SMS leg) … the late-booking leg at start−2h15m" is wrong: the text reminder goes
  for every booking, 90–135 minutes before it (`automations.ts:539-541`); 2h15m is only the LATE EMAIL's deadline
  (`reminder-timing.ts:29-32`).
- The inventory lists the SMS reminder as English-only but misses that its closing line is operator-editable (C15).
- The plan's row "A booking made less than about 23 hours ahead never gets a reminder" (`crm-features.md:823`)
  predates D-029's late window (`booking.ts:1084-1119`); the real gap is narrower (§11.3).
- The plan's row citing `registry.ts:261-268` as the English-only phone confirmation (`crm-features.md:834`) was
  already corrected by the inventory: phone confirmations, reschedules and cancels are bilingual
  (`spokenLocale`, `voice/tools/registry.ts:162-164`, used at `:497`, `:607`, `:680`).
- The brief's example "from her booking" assumes a gender BIS does not store; the copy says "their" (§15).

## 5. Roles

| What | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| See a customer's Language line and hint | yes | yes | their own customers only (`getContact` is null otherwise, a 404) | yes |
| Change the language, Switch, Keep, Undo | yes | yes | their own customers (the action's `getContact` proof on the request client fails for anyone else's) | yes |
| The account's language (Settings) | no (agency-only, unchanged) | no | no | yes |
| The Spanish boxes on Automations | no (`automations.agencyOnly`, every save action, `automations/actions.ts:31-32`) | no | no | yes |
| The calendar follow-up's Spanish box | as `followup_body` today (client-editable, `0022:12-13`; Owner only for UPDATE on calendars, `0066_staff_and_roles.sql:88`) | | | yes |
| The text-back's Spanish box | as `textback_body` today (agency through `voice/actions.ts`) | | | yes |

**No RLS policy changes.** The language columns ride the existing `contacts` policies for SELECT; nothing on the
client role can write them (C2).

## 6. Data: migration 0076 (PR 1, by bis-db-schema)

`0076_customer_language.sql`. **Numbering:** 0075 is the newest on `main`; no other worktree holds a 0076
(checked); if one lands first this becomes the next free number. ASCII only, no backslash (the MCP apply rule).
`set local lock_timeout = '5s'` (0050's precedent). Additive: catalogue-only ALTERs plus one data UPDATE (§6.5).

### 6.1 contacts

```
contacts:
  language                     text null  check (language in ('en','es'))
  language_source              text null  check (language_source in ('booking','form','call','staff'))
  language_set_at              timestamptz null
  last_language_signal         text null  check (last_language_signal in ('en','es'))
  last_language_signal_source  text null  check (last_language_signal_source in ('booking','form','call'))
  last_language_signal_at      timestamptz null
  language_hint_kept_at        timestamptz null
-- coherence: all three of language/_source/_set_at null, or all three set
-- coherence: all three last_language_signal* null, or all three set
```

A signal is never `staff` (staff do not "signal", they choose), hence the narrower check on
`last_language_signal_source`.

### 6.2 The writer

```
public.record_language_signal(p_account uuid, p_contact uuid, p_language text, p_source text, p_at timestamptz)
  returns boolean  -- true when this call SET the language (it was null)
```

One UPDATE on `(account_id, id)`: it writes the three `last_language_signal*` columns when `p_at` is not older than
the stored signal (an out-of-order signal never replaces a newer one), and sets `language`, `language_source`,
`language_set_at` **only where `language is null`**. `language`, `security invoker`, `set search_path = ''`;
`revoke all … from public, anon, authenticated; grant execute … to service_role`. A NULL in any argument raises
(memory: a plpgsql NULL guard fails open; every test is `coalesce(…, false)` or `is not distinct from`).

### 6.3 The client-role INSERT guard

`app.contacts_language_server_only()`, a plain (not definer) BEFORE INSERT trigger: when `current_user =
'authenticated'`, all seven columns are set to NULL. No UPDATE trigger is needed: no UPDATE grant exists. The
service role and the table owner pass through.

### 6.4 PR 2's columns (C17)

```
automations:     body_es text null, body_es_basis text null
calendars:       followup_body_es text null, followup_body_es_basis text null
voice_profiles:  textback_body_es text null, textback_body_es_basis text null
```

Grants follow each English column's: `calendars` gains `grant update (followup_body_es, followup_body_es_basis) to
authenticated` (0022's precedent); `automations` and `voice_profiles` grant nothing (their writes are service-only,
`0025:36-39`, `0024:8-11`). Each `*_es` gets a length check equal to its English column's validation
(`AUTOMATION_BODY_MAX_LENGTH`, 1,000, `messages.ts`' `automations.bodyTooLong`); **Assumption** that calendars and
voice_profiles validate in the action only; bis-db-schema reads both before writing a CHECK.

### 6.5 The one data step (Q1)

For every row whose English is already custom (`body <> ''`, `followup_body <> ''`, `textback_body <> ''`), set
the Spanish to `''` (emptied: Spanish customers keep getting that English). Rows still on our default keep `null`
(our Spanish default). Why: today a Spanish customer of an account that rewrote its English gets that English; on
PR 2's deploy they would otherwise get our Spanish default, whose content may not match a rewrite that, say, names
a season or an offer. Nothing changes content silently; the card says what happens (§12.4) and offers "Use our
Spanish".

### 6.6 Column comments, rollback

Each new column gets a comment naming its one writer (C2, C3). 0065's column comment on `accounts.language` is
replaced: "Two readers: the client-role dashboard default (0065) and, since 0076, the language of scheduled
customer messages to a contact with no language (S-09 L3)". **Rollback** (app first): `drop function
public.record_language_signal`, `drop trigger … ; drop function app.contacts_language_server_only()`, drop the
columns (the §6.5 data is lost with them; nothing reads it before PR 2), restore 0065's comment. **Apply order:**
additive; the build before PR 1 reads none of it, so it applies before merge (§18).

## 7. The language signal (PR 1)

### 7.1 Where each signal is written

All on the service client, after the contact is known, best-effort (its own try/catch: a signal must never cost
the booking, the form or the call), through `recordLanguageSignal(db, accountId, contactId, {language, source,
at})` in `packages/db/src/contacts.ts`, which calls the function (C3) and emits `contact.language_set` with the
caller's actor only when it returned true.

| Signal | Point | Language | Actor |
|---|---|---|---|
| Web booking | `b/[publicId]/actions.ts`, after `createBooking` succeeded (`:333-342`), beside the other best-effort contact writes (`:354-364`) | `pageLanguageSignal(locale, fallback)` (C6): the posted `locale` (`:181`) when it differs from `accounts.language ?? "en"` (`language` is already on the action's account row, `:121-125`), else none | the action's `ACTOR_ID, ACTOR_TYPE` (`"public"`) |
| Phone booking | `voice/tools/registry.ts`, `book_appointment`, after the booking row exists (`:481-488`) | `clearCallerLanguage` over the transcript plus the in-flight turn (C7); none when null | the tool's `ACTOR_ID, ACTOR_TYPE` |
| Form | `lib/forms/enrich.ts`, after `createContact` (`:96-107`) | `pageLanguageSignal(locale, fallback)` with the submission's `locale` (`f/[publicId]/actions.ts:97`, threaded to `enrich`, `:213`) | `"form", "system"` (`:107`) |
| Call | `lib/voice/finish-call.ts`, after `resolveContactId` (`:417`), meaningful calls only | `clearCallerLanguage(state.transcript)`; none when null | the finish's actor |

### 7.2 `clearCallerLanguage` (bis-voice, `lib/voice/language.ts`)

From the caller's turns only (the file's own rule, `:1-4`), scored with the existing `ES_MARKERS`, `ES_CHARS` and
`EN_MARKERS` (`:7-9`), **the profile ignored**: `"es"` when Spanish hits ≥ 2 and Spanish > English (today's rule,
`:22-25`, so the Calls badge and the contact never disagree about a Spanish caller on a "both" line); `"en"` when
English hits ≥ 3 and English ≥ 2 × Spanish; otherwise `null`. English needs more because `EN_MARKERS` holds words a
code-switching Spanish speaker says every sentence ("for", "you", "have", `:8`), and a false English is the costly
error here: it makes a hint (§7.4) or, on an empty record, sets English. **Assumption:** the thresholds are first
guesses; §18's measurement reads how many stored transcripts each would classify, and the plan tunes before merge.

### 7.3 Order and races

The phone booking and the call's finish can both find the language null within a minute: the function's
`where language is null` makes the first one win and the second only a last signal. A signal older than the stored
last signal (a slow finish after a later booking) is dropped (§6.2).

### 7.4 The hint, computed on read

`languageHint(contact)` in `lib/contacts/language.ts` (bis-crm), pure:

```
show when  language is not null
      and  last_language_signal is not null and last_language_signal <> language
      and  last_language_signal_at > language_set_at
      and  (language_hint_kept_at is null or last_language_signal_at > language_hint_kept_at)
returns    { language: last_language_signal, source: last_language_signal_source } | null
```

So: a later signal that agrees never shows; a staff choice made after the signal hides it (they saw it and chose);
**Keep** stamps `language_hint_kept_at = now()` and the hint stays away until a NEWER signal; **Switch** sets the
language to the signal's as a staff choice (`staff`, now), which hides it by the third line.

### 7.5 Staff writes (bis-crm, `contacts/actions.ts`, already `proven-target`, `in-account-service-reads.test.ts:83`)

- `setContactLanguageAction(accountId, contactId, language)`: `requireAccountAccess`; `getContact` on
  `dbForRequest()` (null → "not found", nothing written); then on the service client `language = $1,
  language_source = 'staff', language_set_at = now()`; emits `contact.language_set` with `userId`, `"user"`;
  returns `{ ok, undo: { language, source, setAt } }` (the prior triple, read in the same proof).
- `restoreContactLanguageAction(accountId, contactId, prior)`: the same proof, writes the triple back (C9). The
  prior source is validated against the closed set; a forged `staff` is harmless (it is the caller's own record).
- `keepContactLanguageAction(accountId, contactId)`: the same proof, `language_hint_kept_at = now()`.

## 8. The record page and the drawer (PR 1, bis-crm)

### 8.1 Where

One `LanguageField` component used by both: on the record page inside `ContactDetailsBody`
(`[contactId]/contact-fields-panel.tsx:62`), and in the drawer's Details (`contact-drawer.tsx`, the `who` section;
the route adds `who.language`, `summary/route.ts:135-144`, parsed in `lib/contacts/drawer-summary.ts:26-37`).
Position: directly under Phone (it is about how we reach them), the same 92px label column as Source
(`source-field.tsx`).

### 8.2 What it shows

| State | Line |
|---|---|
| Set | **Español** · por su cita (3 oct) / **English** · from their booking (Oct 3) — the value as its endonym (`LANGUAGE_OPTIONS`, `lib/i18n/language-options.ts:7-10`), then the source phrase with the date in the account's zone and the page's language |
| Not set | "Not set. Messages go out in English, the account's language." (C8; the account clause only when `accounts.language` is set) |
| Hint | under the line, muted: "Spoke English on the last call. Switch to English?" with two ghost buttons **Switch** and **Keep** (§15). Never a primary: the record's one primary is Call (DESIGN.md rule 8's record-page sentence) |
| Loading | the Details skeleton line it sits in (rule 7) |
| Error | the Details card's own error (it reads from the same contact row; no separate fetch) |

### 8.3 Editing

Click the value → a Select of English / Español (the kit's `Select`; `InlineField` is a text field,
`components/inline-field.tsx`) → saves on change → toast "Language set to Español." with **Undo** (rule 6) → Undo
calls the restore action (C9). Esc cancels before a change. No "Not set" option: a person can set a language, not
un-know one; Undo of a first set is the only way back to Not set. Switch writes the same as a choice and gets the
same toast and Undo. Keep's toast: "We'll ask again if a newer call, booking or form says otherwise." (no Undo:
nothing about the customer changed). Keyboard: the Select and both buttons in DOM order with a visible ring; the
drawer's Esc rule unchanged (part 3 §9.7).

### 8.4 Bilingual

The page and drawer already render in the reader's language (part 3 D10); every new key has its twin (§15). The
`lang` of the value: the endonym carries its own (`<span lang="es">Español</span>`), so a screen reader on an
English page says it right.

## 9. Customer-typed text takes the contact's language (PR 1, bis-crm and bis-comms)

Part 1's C11 waited on this (`2026-10-12-record-page-design.md:76`). Only text the CUSTOMER wrote, and only when
the contact has a language (C10); otherwise `lang=""` stays.

| Where | Today | After |
|---|---|---|
| Form answers on the timeline | `activity-timeline.tsx:188` `lang=""` | contact's language |
| An INBOUND message's subject and body | `:200-201` `lang=""` (both directions) | inbound: contact's language; outbound stays `lang=""` (the business wrote it) |
| A booking's note, when the customer booked it (`author_kind = 'customer'`, 0073) | `:209` | contact's language |
| The same three on the group page | `group-timeline.tsx:130`, `:142-143`, `:151` | each row's own member's language (the loader adds it per row) |
| Drawer Recent excerpts | `lib/record/recent-rows.ts:15-19`, `:33` (`lang: "" \| "en"`) | the type widens to `"" \| "en" \| "es"`; message and booking excerpts as above |
| Conversations, inbound bubbles | `conversations/message-thread.tsx:56` (no `lang` at all) | contact's language on inbound bodies (bis-comms) |
| The caller's own words | `call-card-panel.tsx:86` `lang={language}` (the call's) | **unchanged** (C10) |

Notes, To-dos and tags stay `lang=""`: staff wrote them, in a language BIS does not know.

## 10. The send rule (PR 2)

### 10.1 Which messages follow which rule

| Message | Rule | Where its language comes from after PR 2 |
|---|---|---|
| Booking confirmation (web), reschedule, cancel | live | the page's `locale` (`b/[publicId]/actions.ts:181`, `:497-505`), unchanged |
| Phone confirmation, reschedule, cancel | live | `spokenLocale` (`registry.ts:162-164`), unchanged |
| Lead receipt | live | the form's `locale` (`f/[publicId]/actions.ts:97`), unchanged |
| Instant reply | live | the form's `locale` (`instant-reply.ts:141`, `:221`), unchanged |
| Missed-call text-back | live | the caller's spoken language (`finish-call.ts:383-389`, `textback.ts:210`); **gains the Spanish box** (§12) |
| Consent replies | live | the keyword the customer typed (`consent/inbound.ts:92`), unchanged |
| Business-cancel notice | owner's choice | the dialog, **pre-selected** to `recipientLanguage` (C18) |
| Reminder email, text reminder | scheduled | `recipientLanguage` |
| Calendar follow-up | scheduled | `recipientLanguage` |
| Review request, no-show nudge, appointment confirmation, quote follow-up, referral ask, reactivation | scheduled | `recipientLanguage` |

### 10.2 The resolver and the body chooser (bis-comms, `packages/db/src/messaging.ts`)

- `recipientLanguage(contactLanguage, accountLanguage): "en" | "es"` — the contact's, else the account's, else
  `"en"` (L3). `resolveLocale`'s shape (`lib/i18n/locale.ts:12-19`), but for a customer, not a reader.
- `chooseBody({ language, body, bodyEs, defaults }): { language, text }` — English: `body.trim() || defaults.en`.
  Spanish: `bodyEs === null` → `defaults.es`; `bodyEs.trim() === ""` → **`{ language: "en", text: body.trim() ||
  defaults.en }`** (C11: the message switches language, not just the body); else `bodyEs.trim()`. The RETURNED
  language is the one every other part of the message uses.
- `spanishIsStale({ body, bodyEs, bodyEsBasis })` — §12.3.

### 10.3 The due-lists carry the language (bis-booking, bis-automations)

Each due-list's mapper resolves `language` from the contact's embed and the account row: `REMINDER_SELECT`'s
`contacts(...)` embed (`booking.ts:1321-1322`) and the follow-up's (`:1454`) add `language`; `ACCOUNT_BRAND_COLS`
(`booking.ts:1067-1070`), the one account read every due-list shares through `loadSendableRows` (`:1259-1262`),
adds `language`; the automations due-lists' selects add `contacts(language)` and read the account's through the
same `AccountBrandInfo`. Due rows for recipes with a body also carry `bodyEs` and (for the cards only)
`bodyEsBasis`; `listEnabled` (`automations.ts:80-90`) selects `body_es`.

### 10.4 The gates

Every scheduled pass passes the chosen language to the gate it already calls: `ctx.email.send({ …, language })`
(the footer, `email-gate.ts:69-70`, `:198`) and `sendAutomationSms(ctx, { …, language })` (the opt-out line,
`send-sms.ts:130` → `withOptOut`, `opt-out.ts:56-68`). **No gate changes.** `outbound_suppressed`, the consent
ledger, the fixed hours and the deadline rules apply exactly as today.

### 10.5 Why bookings need no language column (D6)

The reminder reads the contact. A booking's own language could only differ from its contact's when staff chose
another language for the customer, and then staff's choice is the one to follow. The one case a booking column
would serve, a booking made on the Spanish page whose contact staff had set to English, is the case L1 says staff
win. **Not needed.**

## 11. Reminders (PR 2, bis-booking with bis-comms' templates)

### 11.1 The email reminder in Spanish

`bookingReminderEmail` gains `locale?: PublicLocale` (`booking.ts:318-326`) and a `REMINDER_COPY` table beside
`CONFIRMATION_COPY` (`:12-33`): the intro line (`:354`, `:361`), the video button (`:344`, `:364`), the cancel link,
and the subject (today a literal in the pass, `reminders.ts:95`, moving into the template as
`bookingReminderSubject(locale)`). The pass formats the time with `formatWhen(…, locale)` (`lib/booking/time.ts:40-
45`) and adds `?locale=es` to the cancel link as the confirmation does (`b/[publicId]/actions.ts:428`). The file
comment at `booking.ts:4-11` is rewritten: the reminder now speaks the customer's language.

### 11.2 The text reminder in Spanish

`smsReminderLead` and `defaultSmsReminderBody` (`sms-reminder-copy.ts:10-20`) take a `language`; Spanish keys
twin `automations.smsReminder.lead`, `.leadNoName`, `.defaultBody` (`messages.ts:2064-2066`). The settings preview
renders both languages (`SMS_REMINDER_PREVIEW_INSTANT`, `:38`).

### 11.3 The late-booking reminder (F-049 part; decision 33)

**Today.** A booking made less than 24h15m ahead is "late" (`isLateBooking`, `booking.ts:1125-1127`) and is listed
once 3h–4h15m before it (`LATE_REMINDER_WINDOW_*`, `:1118-1119`), at least an hour after it was made (`:1120`). Its
deadline is the start minus 2h15m (`reminderDeadline`, `reminder-timing.ts:29-32`), so a held one is dropped
whenever 08:00 is at or past that, i.e. every late-booked appointment at or before 10:15 that was listed before the
hours opened (`:20-27`). D-029 chose that so the email and the text reminder (held to the same 08:00) never land
together. Where texting is OFF (every live account today: no A2P, `getSmsProvider()` throws in production without
`TELNYX_API_KEY`), those appointments get no reminder at all.

**The rule.** `reminderDeadline(reminder, { textCovers })`:

| Reminder | Deadline | Effect |
|---|---|---|
| Day-before (not late) | the start | unchanged |
| Late, and a text reminder will go | start − `SMS_REMINDER_WINDOW_END_MS` (2h15m) | unchanged (D-029) |
| Late, and no text reminder will go | start − `MORNING_OF_MIN_NOTICE_MS` (**45 minutes**) | held to 08:00 and sent then when the appointment starts after 08:45 |

`textCovers` = the account has `sms_reminder` on (`listEnabled`, `automations.ts:80-90`) AND its SMS gate is open
(`resolveSmsSender`, cached per account as the text pass does, `passes/sms-reminder.ts:80-100`) AND the contact has
a textable phone (`normalisePhone`). Read for LATE rows only, so a day-before tick costs nothing new. The consent
ledger is not consulted (the gate decides at send time; §19).

| Late-booked appointment (booked the evening before) | Today | After, no text | After, text on |
|---|---|---|---|
| 07:30, 08:30, 08:45 | none (confirmation only) | none (confirmation only) | the text, as today |
| 09:00, 09:30, 10:00, 10:15 | none | **email at the 08:00 tick**, 45–60 minutes ahead | the text, as today |
| 10:30 to 12:15 | email at 08:00 | email at 08:00 | email at 08:00, text later, as today |

**Why 45 minutes.** 09:00 is the first slot of most trade days, and the release tick lands between 08:00 and 08:15
(96 ticks a day, `reminders.ts:102`), so a 09:00 customer gets 45–60 minutes: time to read it on the way, or to
call and move. An 08:45 appointment would get under 45 minutes, less use than the confirmation already gave.

**Decision 33.** Ratified as "the booking spec's fixed reminder timing (F-049 part 1, reminders however late they
booked)" (`crm-features.md:3325-3327`). Compatible: no window moves (`REMINDER_WINDOW_*`, `LATE_REMINDER_*`,
`SMS_REMINDER_WINDOW_*` unchanged), the fixed sending hours stay fixed (`lib/consent/hours.ts:1-25`), no
per-account knob appears; only an email-only late reminder's deadline changes. The comments that state the old
price (`reminder-timing.ts:20-27`, `booking.ts:1110-1116`) are rewritten to the new one.

## 12. The Spanish boxes (PR 2)

### 12.1 Which, and where each lives

| Card | Owner of the card | English | Spanish (0076) |
|---|---|---|---|
| Review requests, No-show follow-ups, Text reminders (closing line), Appointment confirmations (closing line), Referral asks, Checking in with past customers, Quote follow-ups | bis-automations (`automations/*-card.tsx`, `automations-settings.tsx:86`) | `automations.body` | `automations.body_es`, `body_es_basis` |
| Calendar follow-up | bis-booking (`calendar/calendar-settings.tsx:68`) | `calendars.followup_body` | `followup_body_es`, `followup_body_es_basis` |
| Missed-call text-back | bis-voice (`voice/voice-settings.tsx:68`) | `voice_profiles.textback_body` | `textback_body_es`, `textback_body_es_basis` |

### 12.2 The box

Two labelled textareas, "English message" and "Spanish message", side by side at the card's `md` width and stacked
below it, each with its own preview and, on SMS-capable cards, its own segment count (the instant-reply card's
precedent, `automations/instant-reply-card.tsx:104-125`). The Spanish box opens with `bodyEs ?? our default` (C13).
Under it, at most one line:

| State | Line under the Spanish box |
|---|---|
| Stale (§12.3) | ● "The Spanish still says the old message. Update it to match your English." (dot and word, rule 3) and a checkbox "The Spanish still matches", which, saved, records the basis |
| Emptied (`''`) | "Customers whose language is Spanish will get the English message." and a ghost **Use our Spanish**, which refills the box with our default (saving it stores `null`) |
| Spanish SMS with á, í, ó or ú | "Accents on á, í, ó or ú make this text cost {n} parts instead of {m}." ({m} measured on the folded text; F-011's accent hint) |
| otherwise | nothing |

**One primary Save per card, unchanged** (rule 8): both boxes, the checkbox and the card's other fields are one
form, one server action, one toast. The save action validates the Spanish exactly as the English (length,
`automations.bodyTooLong`), trims, maps "equals our default" to `null` (C13), and sets the basis (§12.3).

### 12.3 Staleness

`spanishIsStale({ body, bodyEs, bodyEsBasis })`, pure:

```
bodyEs === ""                         → false   (they chose English for everyone)
body.trim() === "" && bodyEs === null → false   (our English default beside our Spanish default)
otherwise                             → bodyEsBasis !== body
```

On save the basis becomes the new English when the Spanish box changed in this save or "The Spanish still
matches" was ticked; otherwise it keeps its value. So: a custom English with our Spanish default is stale until
someone writes Spanish or ticks the box; editing only the English makes a written Spanish stale; re-saving the same
English changes nothing.

### 12.4 Rows that already have a custom English

0076 empties their Spanish (§6.5, Q1), so their Spanish customers get exactly what they get today, and the card
shows the "emptied" line with Use our Spanish. Nothing is stale on day one; nothing changes content without a
person choosing it.

## 13. Spanish texts and GSM-7 (PR 2, bis-comms)

A single á, í, ó or ú turns a whole text into UCS-2 at 70 characters a segment (`segments.ts:15-17`; the reasoning
already written at `opt-out.ts:46-49` and `textback-body.ts:63-71`). Two consequences:

- **Our copy.** Every Spanish SMS default and lead in §15 is written without them (é, ñ, ü, ¿, ¡ are allowed).
  A test pins it over the keys (§16).
- **The date.** Measured on this machine's Node: `formatWhen(…, "es")` renders `"sáb, 17 de oct, 9:30 a.m. CDT"`
  and `"mié, 14 de oct, 9:30 a.m. CDT"`; `sáb` carries á. A Spanish text renders its time through
  `gsmFoldVowels` (á→a, í→i, ó→o, ú→u, and their capitals) in `lib/sms/segments.ts`, so every Saturday Spanish
  reminder is not billed double. Emails keep the accents.

The opt-out line is already bilingual and GSM-safe (`messages.ts:1765-1766`; STOP stays the keyword in both, `opt-
out.ts:51-55`). START stays literal wherever it appears.

## 14. The account's language: what Settings says (PR 2)

`settings.language.description` and its twin (`messages.ts:926-927`) gain the new reader (L3); the label stays
"Language". The Details line's "Not set" sentence (C8) names the account's language, so the two say the same thing
from both ends.

## 15. Copy

Usted throughout; trades Spanish a Valley business owner reads at 7 AM. SMS rows carry no á/í/ó/ú (§13). `{name}`
is `brandDisplayName`, never `accounts.name`. Every key has its `.es` twin (the ratchet admits no new key without
one); `INTERNAL_MILESTONE` and the accents guard run over all of them.

### 15.1 To customers (PR 2)

| Key | English | Español |
|---|---|---|
| reminder email subject | Reminder: your upcoming booking | Recordatorio: su próxima cita |
| reminder email intro | This is a reminder for your upcoming booking. | Le recordamos su próxima cita. |
| reminder email video button | Join your video meeting | Entrar a la videollamada |
| reminder email cancel link | Cancel this booking | Cancelar esta cita |
| `automations.smsReminder.lead` (SMS) | Reminder: your appointment with {name} is {when}. | Recordatorio: su cita con {name} es el {when}. |
| `automations.smsReminder.leadNoName` (SMS) | Reminder: your appointment is {when}. | Recordatorio: su cita es el {when}. |
| `automations.smsReminder.defaultBody` (SMS) | Reply to this text if you need to make a change. | Si necesita hacer un cambio, responda a este mensaje. |
| `automations.appointmentConfirm.lead` (SMS) | Hi, it's {name}. You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it. | Hola, le escribe {name}. Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver. |
| `automations.appointmentConfirm.leadNoName` (SMS) | You're booked for {when}. Reply YES … we'll see it. | Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver. |
| `automations.review.defaultBody` (SMS and email) | Thanks for choosing {name}! If you have a minute, we'd love a quick review: | ¡Gracias por elegir a {name}! Si tiene un minuto, nos ayuda mucho que nos deje una reseña: |
| `automations.review.defaultBodyNoName` | Thanks for choosing us! If you have a minute, we'd love a quick review: | ¡Gracias por elegirnos! Si tiene un minuto, nos ayuda mucho que nos deje una reseña: |
| review email subject (`review-request.ts:24`) | Would you leave {name} a review? | ¿Le gustaría dejarle una reseña a {name}? |
| review email button (`:23`) | Leave a review | Dejar una reseña |
| `automations.noShow.defaultBody` (SMS and email) | We missed you at your appointment with {name}. Pick a new time here: | Le estuvimos esperando en su cita con {name}. Escoja otro horario en este enlace: |
| `automations.noShow.defaultBodyNoName` | We missed you at your appointment. Pick a new time here: | Le estuvimos esperando en su cita. Escoja otro horario en este enlace: |
| no-show email subject (`no-show-nudge.ts:21`) | Want to pick a new time with {name}? | ¿Quiere escoger otro horario con {name}? |
| no-show email button (`:20`) | Pick a new time | Escoger otro horario |
| `automations.quoteFollowup.defaultBody` (SMS and email) | Hi, it's {name}. Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions? | Hola, le escribe {name}. ¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos. |
| `automations.quoteFollowup.defaultBodyNoName` | Just checking you got the quote … Any questions? | ¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos. |
| `automations.quoteFollowup.emailSubject` · `NoName` | About your quote from {name} · About your quote | Sobre su estimado de {name} · Sobre su estimado |
| `automations.referral.defaultBody` (SMS and email) | Thanks again from {name}. Know anyone who needs the same done? Send their name and number and we'll look after them. | Gracias otra vez de parte de {name}. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos. |
| `automations.referral.defaultBodyNoName` | Thanks again. Know anyone … look after them. | Gracias otra vez. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos. |
| `automations.referral.emailSubject` · `NoName` | One favor, from {name} · One favor | Un favor, de parte de {name} · Un favor |
| `automations.reactivation.defaultBody` (email) | Hi, it's {name}. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule. | Hola, le saluda {name}. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita. |
| `automations.reactivation.defaultBodyNoName` | Hi. It's been a while … on the schedule. | Hola. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita. |
| `automations.reactivation.subject` · `subjectNoName` | A note from {name} · Checking in | Un saludo de {name} · Pasamos a saludar |
| `automations.reactivation.footerReason` | You're getting this because you've been a customer of {name}. If you'd rather not hear from us, reply and let us know. | Le llega este correo porque ha sido cliente de {name}. Si prefiere no recibir más mensajes, responda y avísenos. |
| `automations.reactivation.footerReasonNoName` | … a customer of ours … | Le llega este correo porque ha sido nuestro cliente. Si prefiere no recibir más mensajes, responda y avísenos. |
| `DEFAULT_FOLLOWUP_BODY` (`followup.ts:17-19`, moves to the catalogue) | Thanks for coming in! If you have any questions or want to book again, just reply to this email. | ¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo. |
| follow-up subject (`followup.ts:54`) | Thanks from {name} | Gracias de parte de {name} |

"estimado" over "cotización": the Valley's own word for a quote, and no accent. "cel" over "número de teléfono":
how the Valley says it, and no accent in a text.

### 15.2 On the record and the drawer (PR 1)

| Key | English | Español |
|---|---|---|
| `contact.language.label` | Language | Idioma |
| `contact.language.notSet` | Not set. Messages go out in {language}. | Sin definir. Los mensajes salen en {language}. |
| `contact.language.notSetAccount` | Not set. Messages go out in {language}, the account's language. | Sin definir. Los mensajes salen en {language}, el idioma de la cuenta. |
| `contact.language.from.booking` | from their booking ({date}) | por su cita ({date}) |
| `contact.language.from.form` | from a form they filled in ({date}) | por un formulario que llenó ({date}) |
| `contact.language.from.call` | from a call ({date}) | por una llamada ({date}) |
| `contact.language.from.staff` | set by your team ({date}) | lo eligió su equipo ({date}) |
| `contact.language.hint.call` | Spoke {language} on the last call. Switch to {language}? | En la última llamada habló {language}. ¿Cambiar a {language}? |
| `contact.language.hint.booking` | Booked in {language} last time. Switch to {language}? | La última vez hizo su cita en {language}. ¿Cambiar a {language}? |
| `contact.language.hint.form` | Filled in a form in {language} last time. Switch to {language}? | La última vez llenó un formulario en {language}. ¿Cambiar a {language}? |
| `contact.language.switch` · `.keep` | Switch · Keep | Cambiar · Dejarlo así |
| `contact.language.setToast` | Language set to {value}. | Idioma cambiado a {value}. |
| `contact.language.keptToast` | We'll ask again if a newer call, booking or form says otherwise. | Le volveremos a preguntar si otra llamada, cita o formulario dice otra cosa. |
| `contact.language.saveFailed` | Couldn't change the language. Try again. | No se pudo cambiar el idioma. Intente de nuevo. |
| `language.name.en` · `.es` (in a sentence) | English · Spanish | inglés · español |

`{value}` is the endonym (English / Español); `{language}` is the in-sentence name. Undo is the existing toast
Undo key.

### 15.3 Settings (PR 2; cards' chrome renders in English, keys twinned for the ratchet)

| Key | English | Español |
|---|---|---|
| `automations.bodyEn.label` · `bodyEs.label` | English message · Spanish message | Mensaje en inglés · Mensaje en español |
| `automations.bodyEs.hint` | Sent to customers whose language is Spanish. It starts as our Spanish; change it to say what your English says. | Se manda a los clientes que hablan español. Empieza con nuestro mensaje en español; cámbielo para que diga lo mismo que su mensaje en inglés. |
| `automations.bodyEs.stale` | The Spanish still says the old message. Update it to match your English. | El mensaje en español todavía dice lo de antes. Actualícelo para que diga lo mismo que el de inglés. |
| `automations.bodyEs.stillMatches` | The Spanish still matches | El español todavía coincide |
| `automations.bodyEs.emptied` | Customers whose language is Spanish will get the English message. | Los clientes que hablan español recibirán el mensaje en inglés. |
| `automations.bodyEs.useOurs` | Use our Spanish | Usar nuestro español |
| `automations.bodyEs.accentCost` | Accents on á, í, ó or ú make this text cost {n} parts instead of {m}. | Los acentos en á, í, ó o ú hacen que este texto cueste {n} partes en vez de {m}. |
| `automations.previewEs` | Spanish preview | Vista previa en español |
| `settings.language.description` (changed) | Changes the language your client sees when they sign in and their alert texts, and the language automatic messages go out in to customers whose language we don't know yet. Agency staff stay in English. | Cambia el idioma que ve su cliente al iniciar sesión y sus mensajes de aviso, y el idioma de los mensajes automáticos a los clientes de quienes todavía no sabemos el idioma. El personal de la agencia sigue en inglés. |

## 16. Testing (every test names the mutation that breaks it)

### 16.1 Database (bis-db-schema; `pnpm --filter @bis/db exec vitest run`, by path)

- **Grants guard** (`schema-grants-guard.test.ts:81-84`, `:69-72`): contacts' client UPDATE list is unchanged (probe:
  `grant update (language)` → FAILS by name); calendars' list gains exactly `followup_body_es`,
  `followup_body_es_basis` (probe: omit the grant → the card's save on the request client is refused → FAILS);
  `automations` and `voice_profiles` gain nothing (`automations-grants.test.ts`).
- **The INSERT guard**: a client-role INSERT carrying `language = 'es', language_source = 'staff'` stores all NULL
  (probe: drop the trigger → FAILS); a service-role INSERT keeps them.
- **`record_language_signal`**: on a null contact it sets the triple and the last signal and returns true; a second,
  disagreeing signal leaves the language and moves the last signal, returns false (probe: drop `where language is
  null` → overwritten → FAILS); an older signal changes nothing (probe: drop the time guard → FAILS); a NULL
  argument raises (probe: remove the guard → a NULL language is written → FAILS); `authenticated` cannot execute it
  (probe: grant execute → FAILS).
- **Coherence checks**: a language without a source is refused (probe: drop the check → FAILS).
- **§6.5 data step**, on the local replica pre/post (memory: local DB replica): a custom-English row's Spanish is
  `''`, a default row's is null (probe: update every row → the default row reads `''` → FAILS).

### 16.2 Unit (web; by path)

- `clearCallerLanguage`: two Spanish markers with a majority → `es` on an `en`-only profile (probe: honour the
  profile as `detectSpokenLanguage` does → `en` → FAILS); a lone "gracias" → `null`; a tie → `null`; three English
  markers with none Spanish → `en`; "hola, I need una cita for you" → `null` (probe: English at ≥ 2 → `en` → FAILS).
- `pageLanguageSignal`: `es` on an English fallback → `es`; `en` on an English fallback → none (probe: always count
  → FAILS); `en` on a Spanish account → `en`.
- `languageHint`: the four §7.4 lines, each with a case where only that line hides it (probe: drop any line → its
  case FAILS); Keep then a newer signal shows again.
- **Signal points**: the booking action with `locale=es` on an English account calls `recordLanguageSignal` with
  `booking`/`es`, after `createBooking` (probe: before it → a lost slot race signals → FAILS); a signal failure
  does not fail the booking (probe: no try → FAILS); the same for `enrich` (`form`), `finishCall` (`call`, only
  when meaningful and contacted), `book_appointment` (`booking`).
- **Staff actions**: a Technician's set on a contact `getContact` cannot see writes nothing (probe: write before
  the proof → FAILS); Undo restores `{es, booking, Oct 3}`, not `staff` (probe: restore through the set action →
  FAILS); Keep stamps only `language_hint_kept_at`.
- **The Details line**: each source's phrase and the zone's date; Not set with and without the account clause;
  the hint's buttons are `ghost` (probe: `default` → FAILS); the drawer's `who.language` parses and a malformed one
  is the who section's error, not the drawer's (part 3 §7.4's rule).
- **`lang`**: an inbound message body on an `es` contact has `lang="es"`, an outbound one `lang=""` (probe: tag
  both → FAILS); a null contact keeps `lang=""` (probe: use the account's language → FAILS); the group timeline uses
  each row's member.
- `recipientLanguage`: contact over account over English (probe: swap → the `en` contact on an `es` account gets
  Spanish → FAILS).
- `chooseBody`: `null` → our Spanish; `''` → English text AND `language: "en"` (probe: return `es` → the subject
  test below FAILS); custom → theirs, trimmed.
- `spanishIsStale`: the truth table of §12.3, row by row (probe: drop the first line → an emptied box warns → FAILS).
- **Each scheduled pass** (reminders, text reminders, follow-ups and the six recipes): an `es` contact gets the
  Spanish subject, body and date, and the gate receives `language: "es"` (probe: drop the gate's `language` → an
  English footer under a Spanish body → FAILS); an `es` contact with an emptied box gets English everywhere
  (C11); a null contact on an `es` account gets Spanish (L3).
- **In-the-moment unchanged**: the web confirmation for a contact stored `en` booked with `locale=es` is Spanish
  (probe: route it through `recipientLanguage` → FAILS).
- **Save actions**: a Spanish box equal to our default stores `null` (probe: store the literal → FAILS); the basis
  moves only when the Spanish changed or the box was ticked (probe: always move it → an English-only edit is not
  stale → FAILS).
- **GSM-7**: every Spanish SMS default, lead and the opt-out line is GSM-7 (`segmentsFor(...).encoding`), probe:
  add "aquí" → FAILS; a Saturday Spanish reminder is GSM-7 (probe: no `gsmFoldVowels` → `ucs2` → FAILS).
- **Late reminder**: `reminderDeadline` returns start−45m for a late email-only row and start−2h15m when the text
  covers it (probe: ignore `textCovers` → FAILS). `cron-coupling.test.ts`'s whole-day sweep gains: with texting off,
  every late-booked appointment starting after 08:45 gets exactly one email, at or after 08:00, at least 45 minutes
  ahead, and none at or before 08:45 (probe: 60 minutes → 09:00 gets none → FAILS); with texting on, the email and
  the text still never share a quarter hour (kept, probe: drop `textCovers` → FAILS).
- **Copy guards**: the ratchet (`lib/i18n/ratchet.test.ts`), the accents guard, `INTERNAL_MILESTONE`, and
  `brand-name-parity.test.ts` over the Spanish templates.

### 16.3 e2e (bis-e2e-qa; the per-run fixture account, never `Test Client One`; fake providers only)

- **PR 1**: book through `/b/{id}?locale=es`; the new contact's record shows "Español · from their booking (…)"
  and the drawer the same; set English → toast → Undo → back to "from their booking"; a Spanish reader's page reads
  "Idioma". The hint: a disagreeing last signal seeded on the fixture contact → the hint shows → Keep → gone after a
  reload.
- **PR 2**: on Automations, the review card's Spanish box opens with our Spanish; edit only the English and save →
  the stale line; empty the Spanish → the emptied line → Use our Spanish refills it. No message is sent by e2e
  beyond the fake provider.
- The `forms.spec` unread flake is unrelated and unchanged.

## 17. Delivery

**PR 1** (0076): the migration (§6); `recordLanguageSignal`, the staff actions, `clearCallerLanguage`,
`pageLanguageSignal`, `languageHint`; the four signal points; the Language line and hint on the record and in the
drawer; §9's `lang`; §15.2's keys; §16.1 and PR 1's §16.2 and §16.3. Customers notice nothing: no message changes.

**PR 2** (no migration): the resolver and `chooseBody`; the due-lists' language; every scheduled pass passes it to
its gate; Spanish reminders and the late-booking rule; the Spanish boxes on nine cards; GSM folding and the accent
hint; the cancel dialog's pre-selection; §15.1 and §15.3; the rest of §16.

**Effort.** Inside item 5's budget (`crm-features.md:1272-1276`, 5–6.5 engineer-weeks with its riders): PR 1 about
1.5 (the migration and its tests 0.5, signals 0.25, the record and drawer 0.5, `lang` 0.25); PR 2 about 2 (passes
and due-lists 0.75, nine cards 0.75, reminders and the late rule 0.5). **Assumption**: no estimate here is measured.

## 18. Rollout, backfill, rollback

### 18.1 PR 1's migration (`docs/runbooks/ci-supabase-project.md` §6)

1. bis-db-schema writes 0076 and its tests; run on the local replica pre and post (memory: local DB replica).
2. With main merged in: `ci-project-setup.yml -f step=push-dry-run --ref feat/s09-language` lists exactly 0076;
   then `-f step=push`.
3. Post-apply checks on bis-ci (`ci:sql`, read-only): the seven columns and their checks, the function's
   `proacl` (service_role only), the trigger, the six PR 2 columns, calendars' grants, and the §6.5 counts.
4. The branch's CI green on its head SHA, read from the check runs.
5. Production: the MCP procedure (pre-flight read by name, `apply_migration`, post-apply verification).
6. Parity (runbook §5). 7. Ledger line `0076 APPLIED … NEVER RE-APPLY`. 8. Merge.

Additive, so it applies before the merge; the build before it reads none of it.

### 18.2 What to measure first (production, read-only, by the orchestrator)

```
-- contacts, and how many could be backfilled
select count(*) from contacts;
select count(distinct fs.contact_id) from form_submissions fs
  join forms f on f.id = fs.form_id join accounts a on a.id = f.account_id
  where fs.contact_id is not null and fs.locale is not null
    and fs.locale <> coalesce(a.language, 'en');                    -- C6's page rule
select count(distinct contact_id) from calls
  where contact_id is not null and jsonb_array_length(transcript) > 0;   -- candidates for C5's reading
-- L3's reach: accounts whose null-language contacts switch to Spanish on PR 2's deploy
select id, brand_name from accounts where language = 'es';
-- §6.5's reach (0076's own Q1 data step: a whitespace-only body is the senders' own "use the
-- default" -- bookingFollowupEmail's `.trim()`, prepareTextback's `.trim() ||` -- so "customised"
-- means one real, non-whitespace character, not merely a non-empty string)
select recipe_key, count(*) filter (where body ~ '[^[:space:]]') from automations group by recipe_key;
select count(*) filter (where followup_body ~ '[^[:space:]]') from calendars;
select count(*) filter (where textback_body ~ '[^[:space:]]') from voice_profiles;
```

The join columns are real: `form_submissions.form_id`, `.contact_id` and `.locale` (`0006_forms.sql:41-42`, `:53`).
**Assumption:** `accounts.brand_name` is the column `brandDisplayName` reads; bis-db-schema checks it before the run.

### 18.3 Backfill (Q4)

**Recommendation: yes, once, after PR 1 merges, Spanish and English alike, from the two kinds of stored evidence
only.** A script `apps/web/scripts/backfill-contact-language.ts` (never applies anything itself — it only turns an
evidence file into a SQL file the orchestrator reviews and applies through the Supabase MCP; "dry run" here means
exactly that: the orchestrator choosing not to apply the file it printed, not a mode flag) replays, per contact and
oldest first, every form submission (C6's page rule on its stored `locale`) and every call (`clearCallerLanguage`
over the stored `calls.transcript`, never `calls.language`, C5, and only a call whose `outcome` is meaningful —
`booked`, `lead` or `message`, never `spam`, `abandoned` or `transferred` — the export's own filter, Task 19 step 7)
through `record_language_signal` with the evidence's own time. The first signal sets the language, the newest is
the last signal, so a contact whose history disagrees shows its hint, which is the truth. The generated SQL also
stamps each backfilled event's `created_at` to the evidence's own time, not `now()`: an event dated today for a
form submitted months ago would crowd the dashboard activity card's newest-50-events read. **Bookings give
nothing**: they store no language (§4). Run by the orchestrator on bis-ci, then production; agents never run it
against a shared project. Without it, every existing customer stays "Not set" until their next booking, form or
call.

**C6 note, stated as intended:** a form whose own default `locale` is Spanish, served to a submitter on an English
account, counts as a Spanish signal for that submitter — both live (C6) and in this backfill. The form's chosen
default is the business's own proxy for what language the page was in; neither reads anything about the actual
submitter beyond that. A business that intentionally runs a Spanish-only intake form is choosing to read every one
of its submitters as Spanish speakers, and that is the intended behavior, not a bug the backfill should route
around.

### 18.4 PR 2's switch-on

On deploy, scheduled sends start reading the language. A contact with none, on an account with none, gets
exactly what they get today. **The accounts from §18.2's `language = 'es'` query** are the ones whose customers
switch to Spanish at once (L3); the orchestrator names them to danlo before the merge, so each client hears it
from BIS first (Q10). Rollback: revert PR 2 (sends go back to English; the columns stay, unread). PR 1's rollback:
revert the app; 0076 stays (additive) unless §6.6's SQL is wanted.

## 19. Risks

- **A text that the consent ledger will block still counts as "covering"** the late email (§11.3): a contact who
  stopped texts, booked late for 09:00, gets neither. Rare (a late booking by someone who texted STOP); the gate's
  answer is not knowable at listing time without a ledger read per late row. Accepted; revisit with F-049's text
  legs.
- **The strict detector's thresholds are guesses** (§7.2). A wrong English on an empty record sets English;
  staff see the source ("from a call") and change it; a wrong English on a set record is only a hint.
- **The account fallback can surprise a Spanish account's English customers** who never gave a signal (C6 covers
  those who booked or filled a form; a caller who said too little stays unsignalled). Q10's notice is the mitigation.
- **Existing Spanish uses tú, new Spanish uses usted** (booking confirmations `booking.ts:24-31`, the opt-out line
  `messages.ts:1766`, the instant reply's defaults `:2084-2085`). A Spanish customer can get "Tu cita quedó
  agendada" then "Le recordamos su próxima cita". Q5.
- **Three GSM-7 constraints on our Spanish** limit the wording (§15.1's "cel", "estimado"). Read by the owner (Q5).
- **The drawer's open time** gains nothing measurable: the language is on the contact row it already reads.

## 20. Agent ownership and needs (through the orchestrator)

- **bis-db-schema**: 0076 (§6), its db tests and the grants guard (§16.1), the §18.2 queries' column check, the
  backfill script's SQL review.
- **bis-crm**: `recordLanguageSignal`, `setContactLanguage`/restore/keep in `packages/db/src/contacts.ts` (and
  `COLS`, `:58-59`); the staff actions; `languageHint`; `LanguageField` on the record and in the drawer, the route's
  `who.language` and its parser; §9's timeline, group timeline and Recent `lang`; the form signal in `enrich.ts`;
  §15.2's keys; the backfill script.
- **bis-comms** (this agent): `recipientLanguage`, `chooseBody`, `spanishIsStale` in `packages/db/src/messaging.ts`;
  the Spanish reminder template and every template's Spanish (§15.1); `gsmFoldVowels` and the accent count in
  `lib/sms/segments.ts`; the conversations thread's inbound `lang`; the copy review of every Spanish string;
  `settings.language.description`.
- **bis-booking**: the web booking signal; `reminderDeadline` and `MORNING_OF_MIN_NOTICE_MS`; `listDueReminders`'
  and `listDueFollowups`' language and `textCovers` inputs; the follow-up pass and the calendar card's box; the
  cancel dialog's pre-selection; `cron-coupling.test.ts`.
- **bis-voice**: `clearCallerLanguage`; the call signal in `finish-call.ts` and the booking signal in
  `book_appointment`; the text-back's Spanish box (card and `textback.ts:210`).
- **bis-automations**: the six recipes' and the text reminder's due-lists and passes; `listEnabled`'s `body_es`; the
  seven cards' boxes and save actions; `reminders.ts` and `sms-reminder.ts` passing the language.
- **bis-e2e-qa**: §16.3.
- **Orchestrator**: the §18 sequence, the measurements, the backfill run, the Q10 notice, the ledger, DESIGN.md.

## 21. DESIGN.md impact (proposed; the orchestrator lands it in PR 1)

- **Definition of done, bilingual line** (`DESIGN.md:331-334`): unchanged and binding here. The Language line and
  hint are on surfaces that already carry bilingual copy (the record page, the drawer), so they render in English
  and Spanish, survive the pseudo-locale, and set `lang`. The automation cards' chrome stays English (agency-only,
  not yet bilingual), so the item does not yet bind them; their CUSTOMER content now does, through §15.1.
- **Key patterns, a new bullet after "The weekly report"**: "**A customer's language** (decided 2026-10-13) is one
  fact on their record: set by their own first clear sign (a Spanish booking or form, a call in which they clearly
  spoke it), changed by staff at any time, never overwritten by a later sign, which offers a Switch instead. Every
  scheduled message reads it, then the account's language, then English; a reply in the moment follows the
  moment. One message is in one language, end to end: subject, body, date, button and footer."
- **Record page section**: the D3 line "no language chip (a contact's language arrives with item 5, S-09)" in part
  1 is history; DESIGN.md itself names no chip and needs no edit.

## 22. Open questions (for the owner)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Accounts that already rewrote an English message: should their Spanish customers get our Spanish default (with the stale warning) or keep getting their English until someone writes Spanish? | **Keep their English** (0076 sets those Spanish boxes to emptied, §6.5); the card says so and offers "Use our Spanish". No message changes content without a person choosing it |
| Q2 | A booking or form in English: is it a signal? No page offers a language choice | **Only when it differs from what the customer would get anyway** (C6): Spanish on an English account counts, English on a Spanish account counts, the fallback's own language does not |
| Q3 | The late-booking email at 08:00: the 45-minute threshold, and only when no text reminder will go | **Yes to both** (C16): a 09:00 job gets 45–60 minutes; where a text goes, D-029's no-collision rule stands |
| Q4 | Backfill existing contacts' language? | **Yes, once, from stored form submissions and recomputed call transcripts, never `calls.language`, never bookings** (§18.3), after §18.2's counts are read |
| Q5 | Today's Spanish uses tú (booking confirmations, lead receipt, the opt-out line, the instant reply); this spec's uses usted | **Usted everywhere**, in a follow-up pass that converts the tú strings (the opt-out line last, after a read of its carrier wording); this spec's new copy is usted from day one |
| Q6 | One migration (0076 carries PR 2's columns) or a second (0077 in PR 2)? | **One** (C17): one bis-ci/production/parity cycle; the columns are inert until PR 2 |
| Q7 | A call heard as English: needs three English markers and twice the Spanish; and it can make a hint on a Spanish record | **Yes**; tune the thresholds on §18.2's transcript sample before PR 1 merges |
| Q8 | The instant reply already has its own Spanish (both required, no default). Fold it into the new boxes? | **No, not now** (C15); its contract is stricter and shipped. Revisit if owners find two patterns confusing |
| Q9 | The text reminder's closing line is not in L2's list but is editable | **Give it a Spanish box** (C15), or a Spanish reminder ends in English |
| Q10 | On PR 2's deploy, every customer with no language on a Spanish account starts getting Spanish scheduled messages (L3) | **Name those accounts (§18.2) and tell each client before the merge**; no flag, since L3 is the decision |

**Decided 2026-10-13 (owner):** Q1 keep their English (0076 marks an account's customised bodies' Spanish
as emptied; the card offers "Use our Spanish"). Q2, Q3, Q4 as recommended (backfill only after read-only
production counts). Q5 usted everywhere, converting today's tú copy in a follow-up pass, the opt-out line
last after its carrier wording is checked. Q10 measure the switched accounts and customers before PR 2
merges; the owner tells those clients first. Orchestrator rulings: Q6 one migration (0076 carries PR 2's
columns); Q7 thresholds tuned on a sample of stored transcripts before PR 1 merges; Q8 the instant reply
stays as shipped; Q9 the SMS reminder's closing line gets a Spanish box.

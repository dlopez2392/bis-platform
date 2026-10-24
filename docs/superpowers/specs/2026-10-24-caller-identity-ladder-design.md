# S-47 part e: caller identity checks scaled to each pack's risk (F-116 part, the no-text version; no migration)

Status: owner decisions E1–E5 fixed in conversation 2026-10-24, and the design of sections 5.1–5.4 (the
rungs, the action requirements, the one module, the confirm flow) approved the same day. This draft fills in
the rest against the tree at main `449d5bf6`. The choices it makes that the decisions did not dictate are
S1–S18 in section 2. One owner question is open (section 11). Part e of S-47 (parallel work,
`docs/crm-features.md` §4.3 row "↳ F-116 (part) | the verification ladder by pack risk | (in S-47) 1",
line 1344). Parts a (F-034, #279), b (F-174 part, #280–#283), c (F-037 part 1, #284) and d (F-084, #286) have
shipped. F-116's later part, one-time codes by text, waits for A2P and decision 19 (`crm-features.md` l.1576).

## 1. Why

Today the only identity a call carries is the caller ID, and the booking tools treat it as enough for
everything:

- **A shared phone reads the wrong person's appointment.** `find_my_booking`
  (`apps/web/src/lib/voice/tools/registry.ts:306-329`) calls `findUpcomingBookingForPhone`
  (`packages/db/src/voice.ts:932-947`), which collects EVERY contact on the account whose phone is the
  caller ID and returns the soonest booking among all of them. A husband who rings about his own Thursday
  visit hears his wife's Tuesday one, and can move or cancel it: `checkCallerOwnsBooking`
  (`registry.ts:96-136`) passes any booking whose contact's phone is the caller ID (`registry.ts:127-129`,
  through `isCallerIdNumber`, `apps/web/src/lib/voice/phone-number.ts:63-67`).
- **No pack can ask for more.** The trade modules (`apps/web/src/lib/voice/modules/index.ts:22-44`; migration
  0094) carry words and a version, and no notion of risk. An insurance agency's appointment is read out to
  anyone holding the policyholder's phone.
- **The carrier's caller-ID attestation is never looked at on the SIP leg.** The registry says so
  (`registry.ts:97-99`); nothing in `apps/web/src/app/api/voice/incoming/route.ts` reads it. Whether it even
  reaches that leg is unknown.

The plan's row: "Identity checks scaled to each pack's risk; a voice alone never proves who is calling"
(`crm-features.md` l.2220, F-116). Binding text this spec obeys: **decision 19** (`crm-features.md`
l.3081-3119: acts the caller asks for run live, "and it relies on S-47's identity checks (F-116) to establish
which booking, record and number are theirs"); §3.2 rule 4 (l.943, the "Why" column's binding constraint 5:
"S-47's identity checks (F-116) are what establish 'own'"; no new live write path, no code sent); **decision
28** (guardrails are fixed in code, never owner-edited); and the testing rule at l.1857-1860 ("the identity
ladder (F-116 part) against hand-run test calls").

## 2. Owner decisions

Fixed by the owner (2026-10-24):

- **E1 Scope:** the ladder, the shared-phone fix, and observation of the carrier's caller-ID attestation.
  One-time codes are out of scope; they need A2P and decision 19.
- **E2 The rung-2 check** is the caller's full name plus the email on file. The CODE compares them and never
  reads the stored value back. A customer with no email on file cannot pass rung 2 by phone; Sofía takes a
  message instead.
- **E3 Shared phone on an ordinary account:** when several contacts share the calling number, the name the
  caller gives picks the person (rung 1 plus disambiguation). A spouse who says the other spouse's name gets
  that spouse's appointment.
- **E4 Packs:** `insurance_pc` requires rung 2 to read, move or cancel an existing appointment; `events`
  requires rung 1. Packs stay OFF on every account; this only sets what applies once one is switched on.
- **E5 Failed checks:** two tries, then a message. One To-do per call for the team, in the account's
  language: "Someone asked about an appointment and couldn't confirm who they are". It is linked to the call
  and filed by server code. Sofía is never told which detail was wrong.

Spec choices the decisions left open (made in this draft; each is pinned where it is specified):

- **S1 Who the candidates are.** The contacts of THIS account whose stored phone is the caller ID by
  `isCallerIdNumber`, the rule the ownership check already uses. They are read through the indexed
  `phone_key` (0033, `contacts_account_phone_key`) and then filtered by that rule in code, so a phone typed
  before F-009 ("(956) 292-1696") is a candidate as it is an owner today (5.2, SD4). At most 20 are read; a
  number with more cannot be narrowed by name on a call (S6).
- **S2 The name rule:** first and last name, case- and accent-insensitive, whitespace collapsed; a spoken
  name matches a record when its first word is the record's first word, its words appear in the record's
  name in order, and its last word is a real name word, not a particle (5.3). Never fuzzy.
- **S3 The email rule:** the spoken address is normalised ("dot", "at", "arroba", "punto", spaces), must
  have an email's shape (`isValidEmail`, the video gate's rule), and is compared through `emailKey`, the
  repo's one definition of "the same mailbox", against the stored `email_key` (0034). The tool never reads
  the raw stored email at all (5.3).
- **S4 Two customers with the same full name on one number:** never guess. On a rung-1 account the result
  asks for the email on file too (not a try); the email must then pick exactly one of them, or it is a miss.
  When none of the name's matches has an email, it is a miss, worded as every miss is. On a rung-2 account
  two records matching name AND email are a miss (a duplicate record is the team's to merge).
- **S5 What a try is:** one `confirm_identity` call with a well-shaped name (and an email where one was
  asked for) that confirms nobody. A name of one word, a missing or malformed email, and a failed read on our
  side are not tries: the first two ask again, the third apologises and offers a message (E5's "counts as
  not confirmed": nothing is confirmed, and the caller is not punished for our outage). Two tries lock.
- **S6 When the check cannot be passed on this call at all,** before the caller says anything: on a rung-2
  account none of the candidates has an email on file (E2), or the number has more than 20 candidates. The
  result says she cannot look it up on this call and offers a message; the call is locked and files the
  To-do, because the team still has to confirm who called.
- **S7 One confirmed contact at a time.** A later successful `confirm_identity` replaces the earlier one
  (E3: the spouse who then asks about the other's appointment says that name). Find, move and cancel act
  only on the contact confirmed last.
- **S8 `confirm_identity` confirms and returns no appointment;** the result tells her to call
  `find_my_booking` again. One extra tool round trip, because the system prompt, which this part does not
  change, says reschedule and cancel are "only for the booking find_my_booking returned on this call"
  (`system-prompt.ts:264`).
- **S9 Moving or cancelling needs the confirmation in call state** (or a booking made on this call). Today
  either passes on the caller ID alone, without a lookup first (`registry.ts:127-129`); that is a deliberate
  tightening (SD9).
- **S10 The To-do is the call's ONE To-do.** `tasks_call_once` (0064:112-113) already allows one To-do per
  call, and the callback To-do takes it (`finish-call.ts:823-835`). A locked call's To-do carries E5's
  title INSTEAD of "Call back at {number}: {reason}", with no contact; the call card keeps the number and the
  message. Filed by `finishCall` after the caller hangs up, never during the call; not for a call that was
  transferred, a recording, or a call with no row (5.6).
- **S11 The To-do opens the call.** A call-linked To-do with no contact links nowhere today
  (`lib/documents/card-focus.ts:23-42`); it gains the call page as its link (5.6; another agent's file).
- **S12 No stored provenance note.** Calls keep no record of tool outcomes (5.9), and adding one is a
  migration. The To-do (with Sofía's mark) and the server log line are the record.
- **S13 Attestation observation** extends the TeXML route's rule to the SIP leg, with two additions the SIP
  shape needs: the `Identity` header and a `verstat` parameter inside `From` or `P-Asserted-Identity` (5.7).
- **S14 Sofía's sentences** in tool results are fixed in English and Spanish (usted, the phone register the
  modules use: "se lo va a confirmar", `modules/events.ts:62`), quoted for her to say, and pinned by tests.
  They are model input, not catalogue copy (S-47c §6's rule for the price sentences).
- **S15 The rung requirement reads the call's own module stamp** (`tradeStamp`, `route.ts:1174`, the value
  that stamped the row and built the prompt), passed in the tool context, never a second read.
- **S16 The Voice page's insurance hint names the check,** so the agency knows what switching the pack on
  does (section 6).
- **S17 `findUpcomingBookingForPhone` is removed,** replaced by a lookup for ONE contact, so the household
  read cannot come back by reuse.
- **S18 A locked call can still book and leave a message** (rung 0), and a booking made on this call can
  still be moved or cancelled on it.

## 3. Scope

**In:** the identity module `apps/web/src/lib/voice/identity/` (the ladder table, name and email matching,
the per-call identity state helpers, the tool-result sentences); the new tool `confirm_identity`; the
changes to `find_my_booking`, `reschedule_appointment` and `cancel_appointment`; two reads in
`packages/db/src/voice.ts` and the removal of one; the To-do in `finishCall`; the SIP attestation log line;
the copy keys; unit, db and route tests; the runbook step for danlo's test calls.

**Out (and where it goes):** one-time codes (F-116's later part: A2P, decision 19, E1); acting on the
attestation (observation first; a later part may use it once a real call's log shows what arrives); "habla
por", a delegate speaking for someone on another number (F-003's part, l.1476, hypothesis H5); which record a
NEW booking lands on when a phone is shared (finding F1); any system prompt change (5.5); any trade-module
wording, `VERSION` or pin change (the modules are paused; `modules/pin.ts` is untouched); the web chat and
the browser voice demo (they stay at rung 0, 5.8); a corpus run.

## 4. Data (no migration)

Nothing is added to the schema. Every column used exists on production:

- **Candidates:** `contacts.phone_key` and `contacts.email_key`, generated columns (0033:21-41, 0034:39-45),
  each with an `(account_id, key)` index.
- **The To-do's link:** `tasks.call_id` and its one-per-call index `tasks_call_once` (0064:106-113), set only
  by server code since `app.keep_task_links` (0074, re-created in 0097:185-212).

Two reads are added to `packages/db/src/voice.ts` (exported by the barrel's `export * from "./voice"`,
`packages/db/src/index.ts:143`, so no barrel line is needed for them):

```
listCallerIdCandidates(db, accountId, callerE164)
  -> { rows: { id, first_name, last_name, phone, email_key }[], truncated: boolean }
  where account_id = accountId and phone_key in (keys of callerE164), limit 21
  keys: phoneDigits(callerE164) (contacts.ts:177-180), plus the ten national digits of a +52 or +521
        number (spokenPhone's own forms, phone-number.ts:46-49), so a Mexican number typed without its code
        is found
  truncated: 21 rows came back (more than 20 candidates)
  throws on a read error (the caller fails closed, S5)

findUpcomingBookingForContact(db, accountId, contactId, nowIso)
  -> { bookingId, startsAt } | null
  the soonest booking of that ONE contact on that account: status booked, starts_at > now
```

`findUpcomingBookingForPhone` (`voice.ts:932-947`) is removed with its test (`packages/db/src/test/voice.test.ts:197-217`);
`registry.ts:319` was its only caller (S17).

The rows carry `phone` so the app can apply `isCallerIdNumber` (S1), and `email_key` rather than `email`, so
the raw stored address never enters the tool (E2, S3). Names stay in the tool's memory for one comparison
and are never put in call state (5.4.1).

One barrel line is needed for the email rule: `export { emailKey } from "./contacts";`, a new line beside the
contacts exports (`index.ts:20-27`). `emailKey` (`contacts.ts:209-214`) is the twin of `email_key`, and a
second implementation in the app is exactly the drift 0034 was written to end (needs, section 10).

## 5. Behaviour

### 5.1 The ladder (`identity/ladder.ts`, pure, tier MEDIUM)

```
type Rung = 0 | 1 | 2 | 3
  0  no caller ID, or the web chat or the browser voice demo
  1  the caller ID matches a contact on this account (and, when several share it, the name picks one, E3)
  2  rung 1, plus a full name AND an email that match the SAME record (E2)
  3  a one-time code. Declared, unbuilt: no action requires it, and nothing can reach it.

type IdentityAction = "read_existing" | "change_existing" | "book_new" | "leave_message"

REQUIREMENTS (fixed in code, decision 28; no account setting):
                   read_existing  change_existing  book_new  leave_message
  no pack                1               1             0           0
  events                 1               1             0           0
  insurance_pc           2               2             0           0

requiredRung(action, tradeModule: TradeModuleId | null): Rung
  an id this build does not know reads as "no pack", the rule tradeModuleBlock already follows
  (modules/index.ts:53-58)
```

`read_existing` is `find_my_booking`; `change_existing` is `reschedule_appointment` and `cancel_appointment`.
`book_new` and `leave_message` are written down so the table says what does not change: `book_appointment`,
`take_message` and `capture_lead` read no rung. `check_availability` reads none either (open times are not
personal). Decision 19's blank-fill on the caller's own record keeps its own rung-1 rule, unchanged at both
of its sites (`registry.ts:463-475` and `finish-call.ts:335-347`; SD5). The events row equals the no-pack row
today (SD11); it is declared so a later change to the base row cannot move a pack silently.

The module is the ONLY place a rung or a requirement is written. The trade modules' words, `VERSION`s and
`pin.ts` hashes do not change, and the corpus is not run (section 3).

### 5.2 Who is on this number (S1)

`identity/candidates.ts` wraps `listCallerIdCandidates` and filters its rows with `isCallerIdNumber(row.phone,
ctx.callerNumber)`, the rule `checkCallerOwnsBooking` applies today (`registry.ts:128`). The filter matters:
`phone_key` is digits only, so two numbers that differ only in country code share a key, and only the E.164
compare tells them apart. The read is made fresh on every `find_my_booking` and `confirm_identity` call (one
indexed query); no candidate list is kept between tool calls.

Fixing the match through `phone_key` also closes a gap the brief did not name: today `findUpcomingBookingForPhone`
compares the raw stored `phone` with the caller's E.164 (`voice.ts:935`), so a contact whose phone was typed
before F-009 is found by nobody, while the ownership check, which normalises (`registry.ts:104-108`), would
accept it (SD4).

### 5.3 Matching (`identity/match.ts`, pure, tier MEDIUM)

**Names (S2).** `nameWords(text)`: Unicode NFKD, combining marks removed (so "Muñoz" = "Munoz", "José" =
"Jose"), lowercased, apostrophes removed ("O'Brien" = "obrien"), every other character that is not a letter
read as a space (so "García-López" is two words), whitespace collapsed, split. A record's words are
`nameWords(first_name + " " + last_name)`. A spoken name S matches a record R when ALL hold:

1. S has at least two words, and R has at least two words (a record with only a first name, or a "Caller"
   placeholder, can never be confirmed by name);
2. S's first word equals R's first word;
3. S's words appear in R in the same order (a subsequence; words may be skipped);
4. S's last word is not a particle: de, del, la, las, los, y, e, da, di, van, von.

So "María Elena García López" on record is matched by "María García", "María Elena García", "María García
López" and "maria lopez"; not by "Elena García" (first word), "García María" (order), "María García Pérez"
(a word not on record) or "María de" (particle). The voice-created split matters here: `book_appointment`
stores everything before the LAST space as the first name (`registry.ts:444-446`), so "María García López"
becomes first "María García", last "López"; rule 3 reads the whole name and is indifferent to the split.

**Emails (S3).** `spokenEmail(text)`: NFKD, marks removed, lowercased. If it contains "@", all whitespace is
removed and nothing else changes. Otherwise it is read word by word: "at" and "arroba" → "@"; "dot" and
"punto" → "."; "underscore" and "guion bajo" → "_" (the two-word form is read before "guion"); "dash",
"hyphen" and "guion" → "-"; "plus" and "mas" → "+"; every other word is kept; the words are joined with no
spaces. Only whole words are mapped, and only in
an address with no "@", so "dottie@…" is never touched. The result must pass `isValidEmail`
(`apps/web/src/lib/forms/guards.ts:189`), or it is not an email (S5: ask again). A record matches when
`emailKey(result) === row.email_key`: lowercase, trimmed, `+tag` folded, Gmail dots NOT folded (the
`emailKey` doc, `contacts.ts:183-208`). A record whose `email_key` is null matches no email.

**The decision.** `decideIdentity({ candidates, required, fullName, email })`, pure, returns one of
`confirmed(contactId, rung)`, `ask_name`, `ask_email`, `miss`, `cannot_on_this_call`:

```
candidates = 0                          -> (find answers found:false, as today)
truncated (more than 20)                -> cannot_on_this_call                          (S6)
required 1, exactly one candidate       -> confirmed(it, 1), no name needed             (today's behaviour)
required 2, no candidate has email_key  -> cannot_on_this_call                          (E2, S6)
name has fewer than two words           -> ask_name                                     (not a try)
required 2, email missing or malformed  -> ask_email                                    (not a try)
required 1:
  name matches exactly one              -> confirmed(it, 1)
  name matches several:
    no email given, one of them has one -> ask_email                                    (S4, not a try)
    email given, picks exactly one      -> confirmed(it, 2)
    otherwise                           -> miss
  name matches none                     -> miss
required 2:
  exactly one candidate matches name AND email -> confirmed(it, 2)
  otherwise                                    -> miss                                  (S4)
```

`find_my_booking` runs the first four rows only (it has no name yet) and otherwise asks for what the
requirement needs.

### 5.4 The tools (tier HIGH for the gating, MEDIUM for the rest)

#### 5.4.1 Per-call identity state (`call-state.ts`)

`CallState` (`apps/web/src/lib/voice/call-state.ts:64-106`) gains one field, and `emptyCallState`
(`call-state.ts:108-113`) its empty value:

```
identity: {
  confirmed: { contactId: string; rung: 1 | 2; by: "caller_id" | "name" | "name_email" } | null;
  misses: number;                 // tries that confirmed nobody (S5)
  locked: null | "misses" | "cannot";
}
```

It lives in `CallState` because nothing else in the registry is per-call and mutable: `ToolContext`
(`registry.ts:49-67`) is the call's fixed configuration, built once before accept (`route.ts:1266-1271`).
`CallState` is a local `let` inside `runCallLifecycle` (`route.ts:294`), created empty for each call and
gone with the invocation (`call-state.ts:1-4`), so a confirmation can never cross calls. Tool calls are
applied one at a time through the frame chain (`route.ts:654-663`), so two quick `confirm_identity` calls
cannot both read `misses: 0`. Only ids and counters are held: no name, email or phone enters the state that
`finishCall` and the summary read. Pure helpers in `identity/state.ts`: `withConfirmed`, `withMiss` (locks at
2), `withLocked`, `isLocked`, `confirmedFor(state, contactId, required)`.

`state.contactId` (the contact a booking made on this call landed on, `registry.ts:442-450`) is NOT set by a
confirmation: a confirmed spouse who then books a new appointment books exactly as today (finding F1).

`ToolContext` gains `tradeModule: TradeModuleId | null`, set from `tradeStamp?.module ?? null` at
`route.ts:1266` (S15). `registry.test.ts`'s context builder gains it.

#### 5.4.2 The flow

`find_my_booking`, in this order (today's first two refusals unchanged, `registry.ts:307-318`):

1. No caller ID → today's refusal (rung 0). A recited number that is not the caller ID → today's refusal.
2. Locked → the LOCKED result (5.4.4); nothing is read.
3. Confirmed at or above `requiredRung("read_existing")` → `findUpcomingBookingForContact` for the confirmed
   contact → `{ found: true, bookingId, startsAt, startsAtLocal }` (`withServed(..., "booking_found")`, as
   today) or `{ found: false }`.
4. Otherwise read the candidates (a read failure → the READ FAILED result; nothing confirmed, not a try).
   None → `{ found: false }` (today's answer for a number with nobody on it). Then `decideIdentity` without a
   name: `confirmed` (one candidate, rung 1) → confirm by `caller_id` and continue as step 3;
   `cannot_on_this_call` → lock "cannot", CANNOT result; otherwise ASK NAME (rung 1) or ASK NAME AND EMAIL
   (rung 2).

`confirm_identity({ fullName, email? })` (new):

1. No caller ID → the no-caller-ID refusal (a name never raises rung 0).
2. Locked → LOCKED.
3. Read the candidates (failure → READ FAILED); `decideIdentity`; then:
   `confirmed` → `withConfirmed`, CONFIRMED; `ask_name` / `ask_email` → those results, state unchanged;
   `miss` → `withMiss`: the first is MISS, the second LOCKED; `cannot_on_this_call` → lock "cannot", CANNOT.

`reschedule_appointment` and `cancel_appointment` keep their order (booking read, then ownership, before the
slot lookup, the room and both writes, `registry.ts:575-583`, `706-713`). `checkCallerOwnsBooking` becomes:

```
owned when
  the booking was made on this call (state.bookings, today's (a), registry.ts:127)          rung 0
  OR  confirmedFor(state, booking.contact_id, requiredRung("change_existing"))
      AND isCallerIdNumber(contact.phone, ctx.callerNumber)          (today's (b), kept as a second check)
refused otherwise:
  locked                     -> LOCKED
  nothing confirmed          -> NOT CONFIRMED YET
  a different contact        -> today's refusal text, with "isn't under the number they're calling from"
                                replaced by "isn't one they have confirmed is theirs"
```

The contact read stays the one read, still failing closed (`registry.ts:118-126`). `confirm_identity` joins
`MANAGE_TOOLS` (`registry.ts:71-73`), so the mode guard (`registry.ts:265-273`) refuses it where appointments
cannot be looked up at all, and `ToolName` (`registry.ts:37-41`) gains it.

Every identity result is checked by test to carry none of the candidates' names, emails or phones (E2):
the code compares; the model is told only the outcome.

#### 5.4.3 Tool schemas (`tools/schemas.ts`)

`confirm_identity` joins `BOOKING_TOOLS` (`schemas.ts:6-26`), so it is on the session exactly where
`find_my_booking` is (`toolSchemas`, `schemas.ts:78-102`: modes `full` and `manage`, never `none`):

```
{ type: "function", name: "confirm_identity",
  description: "Confirm whose appointment the caller means, when find_my_booking asks you to. Pass the first
    and last name exactly as the caller said it, and the email address only when you were asked for it:
    spell the email back character by character and wait for them to confirm, then write it with the @ and .
    symbols. It checks only the people under the number they are calling from. It never tells you a name or
    an email, and you must never suggest, guess or spell one for them.",
  parameters: { type: "object",
    properties: { fullName: { type: "string", description: "First and last name, as the caller said it." },
                  email: { type: "string", description: "Only when asked for. The address as confirmed, with @ and . symbols." } },
    required: ["fullName"] } }
```

`find_my_booking`'s description (`schemas.ts:24`) gains one sentence: "If it asks you to confirm who they
are, ask for exactly what it says, call confirm_identity, then call find_my_booking again." Its existing
words stay, so `schemas.test.ts`'s pins ("calling from", "cannot look up any other number") hold. The
reschedule and cancel descriptions (`schemas.ts:17-22`) do not change: "a booking find_my_booking returned
on this call" stays true under S8.

#### 5.4.4 The results, word for word (S14; pinned as literals)

Each is a tool result; the quoted sentences are hers to say, in the language she is speaking.

- **ASK NAME** (several on the number, rung 1):
  `{ found: false, confirmIdentity: "name", next: "Before you look anything up, ask whose name the
  appointment is under: the first and last name. For example: \"Whose name is the appointment under? I'll
  need the first and last name.\" In Spanish: \"¿A nombre de quién está la cita? Necesito el nombre y el
  apellido.\" Then call confirm_identity with fullName. Do not suggest or guess a name, and do not say how
  many people use this number." }`
- **ASK NAME AND EMAIL** (rung 2):
  `{ found: false, confirmIdentity: "name_and_email", next: "Before you look anything up, ask for the full
  name the appointment is under and the email address on file. For example: \"To look that up, I need the
  full name and the email address we have on file.\" In Spanish: \"Para buscarla, necesito el nombre
  completo y el correo electrónico que tenemos registrado.\" Spell the email back character by character,
  saying 'at' for @ and 'dot' for the period, and wait for them to confirm. Then call confirm_identity with
  fullName and email. Do not suggest or guess a name or an email." }`
- **ASK NAME AGAIN** (one word): `{ ok: false, confirmed: false, next: "Ask for their first AND last name,
  then call confirm_identity again." }`
- **ASK EMAIL** (rung 2 without a usable email, or S4's same-name case): `{ ok: false, confirmed: false,
  confirmIdentity: "email", next: "Ask for the email address on file: \"Could I also have the email address
  we have on file?\" In Spanish: \"¿Me da también el correo electrónico que tenemos registrado?\" Spell it
  back character by character and wait for them to confirm, then call confirm_identity again with fullName
  and email." }`
- **CONFIRMED**: `{ ok: true, confirmed: true, next: "Confirmed. Call find_my_booking now." }`
- **MISS** (the first): `{ ok: false, confirmed: false, next: "Say: \"I couldn't find it under those
  details.\" In Spanish: \"No la encontré con esos datos.\" You may ask them once more and call
  confirm_identity again. You have not been told which detail did not match, so do not say or guess." }`
  A name miss and an email miss return the SAME object (E5; pinned by deep equality).
- **LOCKED** (the second miss, and every later find, confirm, move or cancel of an existing appointment):
  `{ ok: false, confirmed: false, locked: true, next: "Say: \"I'm sorry, I couldn't find it under those
  details, so I can't look it up on this call. I can take a message and someone from the team will call you
  back.\" In Spanish: \"Lo siento, no la encontré con esos datos, así que no puedo consultarla en esta
  llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada.\" If they want, take the
  message with take_message. Do not ask for these details again on this call." }`
  After a "cannot" lock, the later refusals use the CANNOT sentence instead, so she never says "those details"
  to someone who gave none.
- **CANNOT** (S6): `{ found: false, locked: true, next: "Say: \"I'm sorry, I can't look that up on this
  call. I can take a message and someone from the team will call you back.\" In Spanish: \"Lo siento, no
  puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la
  llamada.\" If they want, take the message with take_message." }`
- **NOT CONFIRMED YET** (move or cancel before a confirmation): `{ ok: false, error: "This appointment can't
  be changed until find_my_booking has found it for them on this call. Call find_my_booking first. Do not
  share any of its details." }`
- **READ FAILED**: `{ ok: false, confirmed: false, error: "The details couldn't be checked right now, so
  nothing was looked up. Apologize, then ${nextStep(ctx)} so the team can help." }` (`nextStep`,
  `registry.ts:84-88`: a transfer where one is set up, else a message, as every refusal today).

The LOCKED and CANNOT results name `take_message` only, never a transfer (E5: "then a message"). A caller who
asks for a person is still put through where `transfer_to_human` is on the session; the prompt's TOOLS line
for it is unchanged.

### 5.5 The prompt does not change

The accept body sends the prompt and the tools as two separate fields: `instructions:
buildSystemPrompt(input, now)` and `tools: toolSchemas(...)` (`session-config.ts:110-114`). The three pinned
digests hash `buildSystemPrompt`'s output and nothing else (`system-prompt.test.ts:532-536` `digestOf`;
`PRE_S47B_DIGEST` at 538, `PRE_S47C_DIGEST` at 648, `PRE_S47D_DIGEST` at 711), and no test hashes
`toolSchemas`. `system-prompt.ts` and `system-prompt.test.ts` are not edited, so all three stay green
untouched. Baseline at `449d5bf6`, before any change: `pnpm exec vitest run
src/lib/voice/system-prompt.test.ts src/lib/voice/tools/schemas.test.ts src/lib/voice/tools/registry.test.ts`
→ `Test Files  3 passed (3)`, `Tests  256 passed (256)`.

What the frozen prompt already says, and why it agrees with this design:

- "find_my_booking() — call it FIRST when a caller wants to check, change or cancel an appointment. It only
  looks up the number they are calling from." (`system-prompt.ts:263`) Still true; the identity asks arrive
  in its result.
- "reschedule_appointment … / cancel_appointment … — only for the booking find_my_booking returned on this
  call, or one you booked on this call. If either refuses, apologize and {offer a person or a message}."
  (`system-prompt.ts:264`) Still true under S8. The one tension: on NOT CONFIRMED YET the prompt's
  refusal rule may win over the result's "call find_my_booking first", and she offers a person or a message
  instead. That is a safe ending, and the case needs her to skip the FIRST step the line above names.
- The hidden-caller-ID line (`system-prompt.ts:154-155`) and the other-number line (`system-prompt.ts:268`)
  are unchanged and agree with rung 0.

The prompt's TOOLS list does not name `confirm_identity`; she learns it from its schema and from
`find_my_booking`'s results, which is where every instruction of this part travels (owner design). The email
spell-back rule in the BOOKING block (`system-prompt.ts:283`) appears only when new bookings can be made,
which is why ASK NAME AND EMAIL and ASK EMAIL carry their own spell-back sentence.

Not a digest, but noted: the corpus runner sends the real `toolSchemas` to its runs (`modules/corpus-lib.ts:143-147`)
and its stub answers `{ ok: true }` for any tool it does not mirror (`corpus-lib.ts:176-205`). A future
corpus run will see `confirm_identity` and get `ok: true` from it (finding F4). The modules are paused; no run
is part of this spec.

### 5.6 The To-do (`finishCall`, tier MEDIUM)

In the callback To-do leg (`finish-call.ts:798-835`), one decision decides the one To-do:

```
identityTodo = state.identity.locked !== null && !state.recordedCaller && !wasTransferred(state)
if (meta.callRowId && (identityTodo || callbackLine)) ensureCallbackTask(db, accountId, {
  callId: meta.callRowId,
  contactId: identityTodo ? null : contactId,
  title: identityTodo ? t(m, "voice.todo.identity", locale) : callbackLine,
  dueAt: meta.endedAt.toISOString(),
})
locale = resolveLocale(undefined, ctx.accountLanguage ?? null)     (the alert SMS's rule, finish-call.ts:571)
```

- **Once per call:** `ensureCallbackTask` (`voice.ts:695-727`) inserts with `call_id`, and a second insert
  answers 23505 under `tasks_call_once` and returns the first row. `finishCall` runs once per call. No new
  dedupe, no new link kind, no migration.
- **Why one To-do, not two (S10):** the index allows one per call, and a locked call usually also took a
  message (E5), which would otherwise file the callback To-do on the same key. E5 asks for one To-do per call;
  the locked call's is E5's. The callback number and the message stay on the call card
  (`calls.callback_number`, `calls.reason`, 0064) and in the staff alert email, both unchanged.
- **No contact:** the call never confirmed who rang, so the To-do is not put on any customer's record.
- **Not filed** for a call transferred to a person (a person already has it), a recording, or a call with no
  row (`meta.callRowId` null: nothing to link it to; the same gate the callback To-do has). The skipped case
  is logged by account id.
- **Language:** the ACCOUNT's (E5), as the closure To-do does (`lib/business-status/closure-todo.ts:46-61`),
  never the caller's. `FinishContext.accountLanguage` is already set (`route.ts:1276`); no new read.
- **Provenance:** a To-do with a `call_id` already carries "Sofía · AI" on the work list
  (`work-list.tsx:215-233`), so the mark is DESIGN.md's without new code.
- **Its link (S11):** `workRowHref` (`lib/documents/card-focus.ts:23-42`) answers the contact's page or
  nothing, so a To-do with a call and no contact has no link today. It gains: a row with a `callId` and no
  `contactId` links to `/dashboard/accounts/{accountId}/calls/{callId}`. `WorkRow` already carries `callId`
  (`packages/db/src/work-queue.ts:88`). This also gives a link to today's callback To-dos that have no
  contact. The file belongs to the work-queue owner (section 10).
- `callbackTodo` stays true when this To-do is filed, so the post-call proposals do not also suggest a
  callback (`finish-call.ts:820-823`), unchanged.

### 5.7 Attestation observation on the SIP leg (tier LOW)

**What exists.** The TeXML route logs every form field NAME and the value of any field whose name looks like
an attestation (`app/api/voice/texml/telnyx-request.ts:63-108`, `logFormFields`, called at
`texml/route.ts:779`). The SIP route already logs every SIP header NAME on every call (`route.ts:924`,
`sipHeaderNames`, `lib/voice/sip-headers.ts:80-84`), and no value.

**What the SIP shape needs that TeXML's rule misses.** On SIP, STIR/SHAKEN rides in a header named
`Identity` (a signed token whose payload carries `attest`: A, B or C), which the TeXML name pattern
`/attest|shaken|stir|verstat/i` does not match, and whose value `SAFE_VALUE` would print as "(unprintable)";
and a carrier's verification result often rides as a `verstat=` parameter inside the `From` or
`P-Asserted-Identity` value, not as a header name. ASSUMPTION, not verified: whether Telnyx forwards any of
this onto the leg it dials to OpenAI, and whether OpenAI's `sip_headers` repeats it. That is what this line
exists to find out.

**The change.**

- `lib/voice/attestation-log.ts` (new): the shared rule, moved from `telnyx-request.ts:63-67,101`
  (`FIELD_NAME`, `ATTESTATION_FIELD`, `SAFE_VALUE`, and the value rule: "(unprintable)" unless short and
  plain, "(redacted)" when it holds seven or more digits in a run, else the value). `logFormFields` imports
  it and prints byte-identical lines (its existing tests are the guard). One rule, two callers, the file's
  own reason for existing (`telnyx-request.ts:5-7`).
- `sip-headers.ts` gains `sipAttestation(eventData): string`, bounded like `logFormFields` (at most 10
  values, names that could forge a log line counted, not printed): a header whose name matches the pattern
  prints by the shared rule; a header named `identity` prints `identity=attest:A` when the middle segment
  of its token, base64url-decoded (at most 4,096 characters, in a try), is JSON with `attest` exactly "A",
  "B" or "C", else `identity=(present)`; the token itself is never printed; a `verstat` parameter in `from`
  or `p-asserted-identity` prints as `from.verstat=TN-Validation-Passed` when it is at most 40 letters and
  hyphens, else `(unprintable)`. "none" when nothing is found. Nothing is verified, stored or decided.
- `route.ts:924`'s existing log line gains the field: `log("incoming call", { callId, callerNumber,
  calledNumber, sipHeaderNames: …, attestation: sipAttestation(event.data) })`. Pure, before the tenant read;
  the accept body and every decision are unchanged (a route test pins it).

The runbook's "While you are in the logs" line (`docs/runbooks/voice-setup.md:795-796`) asks to record
whether a TeXML attestation field arrives; nobody has recorded it yet. The proposed Step 8 (section 8) asks
for both lines.

### 5.8 Web chat and the browser voice demo

Unchanged, at rung 0. The demo's session has no tools at all (`app/api/voice/web/session/route.ts:254`,
`tools: []`), and the chat has only its own `capture_lead` (`lib/concierge/prompt.ts`). `runTool` runs on the
phone route only (`call-events.ts:191`, reached from `route.ts:739`).

### 5.9 Logs, and why there is no timeline note (S12)

Calls keep no record of tool outcomes: the call row stores the transcript of spoken turns, the summary and
the card (`finishCallRow`, `voice.ts:602-616`; `CALL_DETAIL_COLS`, `voice.ts:1034-1035`), and `ai_acts` holds
undoable writes only (`packages/db/src/ai-act-rules.ts:21-25`; 0091's kind CHECK). A confirmation is not a
write, and a note would need a column or a kind, which is a migration this part avoids. The record is the
To-do (5.6) and one server log line per identity event, keyed by the call row id and saying only the event:
`voice identity {callRowId|(no row)}: confirmed rung {1|2} by {caller-id|name|name-email}` / `miss {n}` /
`locked ({misses|cannot})` / `read failed`. Never a name, an email or a number (`registry.ts:111-113`'s
"logged by booking id only" rule).

## 6. Copy

Catalogue keys (`apps/web/src/lib/messages.ts`, the `voice.` namespace, `.es` twins; the i18n baseline
regenerated):

- `voice.todo.identity`: "Someone asked about an appointment and couldn't confirm who they are"
- `voice.todo.identity.es`: "Alguien preguntó por una cita y no pudo confirmar quién es"
- `voice.tradeRules.insurance_pcHint` (S16) gains a closing sentence: " Before reading, moving or cancelling
  an appointment, {persona} asks for the full name and the email on file." `.es`: " Antes de consultar,
  cambiar o cancelar una cita, {persona} pide el nombre completo y el correo electrónico registrado."
  (`messages.ts:2056-2057`; the Voice page is agency-only.)

Both pass the 7 AM read and carry no milestone code (the `INTERNAL_MILESTONE` guard). Sofía's sentences
(5.4.4) are model input, not catalogue copy, and are pinned by tests (S14). Spanish register: usted, the
phone line's register in the modules (`modules/events.ts:62`, `98`); the staff-facing To-do in the closure
To-do's plain register (`messages.ts:2531-2534`).

## 7. Tests

Unit, route and db; no e2e (phone calls are tested by real calls, section 8).

- **Ladder:** every cell of the 5.1 table as a fixture; an unknown module id reads as no pack; no action
  requires rung 3 (mutation: insurance read → 1 FAILS).
- **Names:** each rule of 5.3 with the examples given there, accents and ñ, hyphen, apostrophe, particles,
  the voice-created first/last split, a one-word record and a "Caller" record never matching (mutation: drop
  rule 3 → "García María" FAILS; drop rule 4 → "María de" FAILS).
- **Emails:** "ana dot garcia at gmail dot com", "ana punto garcia arroba gmail punto com", "A N A @ x . com",
  "guion bajo", "plus"; an address with "@" left alone ("dottie@x.com"); `+tag` folding; a malformed result
  refused; a null `email_key` never matching.
- **The decision:** every row of 5.3's table, including the same-name pair (S4) with and without emails and
  the 21-row truncation (S6).
- **Registry (HIGH; `registry.test.ts`, its `@bis/db` mock spreads the real module, so `emailKey` is real):**
  one contact, rung 1: no name asked and the lookup is for that contact (today's case, red first against the
  new read); two contacts: ASK NAME, and `JSON.stringify` of the result contains neither stored name, email
  nor phone (mutation: put the names in the result → FAILS); confirm A then find → `findUpcomingBookingForContact`
  called with A only; confirm B afterwards replaces A (S7); a name miss and an email miss deep-equal (E5);
  two misses lock, and a third `confirm_identity` makes no read (read count; mutation: no lock → FAILS); while
  locked, find, reschedule and cancel refuse with LOCKED and `book_appointment` and `take_message` still
  work (S18), and a booking made on this call can still be moved; a failed candidate read is READ FAILED and
  not a miss; insurance: a name alone gets ASK EMAIL, name and email confirm at rung 2, no email on any
  candidate is CANNOT and locks; reschedule or cancel of a booking whose contact is not the confirmed one is
  refused, and before any confirmation NOT CONFIRMED YET (S9; mutation: today's caller-ID-only rule → FAILS);
  a rung-1 confirmation on an insurance call cannot move a booking (mutation: ignore the rung → FAILS); no
  caller ID: `confirm_identity` refused; a recited other number still refused; mode `none` refuses
  `confirm_identity`. **Second account:** the context's `accountId` is what reaches every read (mutation: a
  fixed id → FAILS).
- **Schemas:** `confirm_identity` in modes `full` and `manage`, not `none`; `fullName` required, `email`
  optional; its description's "never suggest, guess or spell"; `find_my_booking` keeps its two pinned phrases
  and gains the confirm sentence; the video variant still touches only `book_appointment`.
- **Prompt:** `system-prompt.test.ts` untouched and green (all three digests).
- **db (`packages/db/src/test/voice.test.ts`, `withTestAccount` nested for the second account, as
  `booking.test.ts:922` does):** `listCallerIdCandidates` finds an E.164 phone, a legacy typed "(956)
  292-1696" phone (red first: today's `findUpcomingBookingForPhone` misses it) and a Mexican number stored
  with and without its code; returns `email_key`, never `email`; account B's contact with the same phone and
  the same name is never returned for account A (mutation: drop the `account_id` filter → FAILS); 21 rows set
  `truncated`. `findUpcomingBookingForContact` returns that contact's soonest booked future booking only,
  skips past and cancelled, never another contact's on the same phone, and answers null for account A asked
  about account B's contact (mutation: drop the `account_id` filter → FAILS).
- **finishCall:** a locked call files exactly one To-do with the identity title in the account's language
  (en, es, null → en), `contactId` null and the call id, even when a message was taken (one
  `ensureCallbackTask` call; mutation: file the callback title → FAILS); an unlocked call files today's
  callback To-do unchanged; locked plus transferred, locked plus recording, and no row file none.
- **Attestation:** `sipAttestation` over the name pattern, `identity` with an `attest` of A, B and C, a
  malformed and an oversized token (`(present)`, never the token), a `verstat` parameter in `From`, the digit
  redaction, the bounds; the incoming route's log line carries the field and its accept body is unchanged;
  `telnyx-request.test.ts` green without edits (the extraction is byte-identical).
- **Work list (owner of the file):** a To-do with a call and no contact links to the call page; one with a
  contact still links to the contact.

Commands (agent-scoped, never the gates): `pnpm --filter web exec vitest run src/lib/voice src/app/api/voice`
and the work-list test by path; `pnpm --filter @bis/db exec vitest run src/test/voice.test.ts` (judged by its
summary block); `pnpm --filter web typecheck`.

## 8. Rollout

1. No migration, so nothing goes to bis-ci or production first. One PR; merge only on green `verify` and
   `e2e` for the head SHA (read the check runs for that SHA).
2. Deploy READY. Merging changes every phone call in one way only: a number shared by several contacts now
   asks whose appointment it is. Every pack is off (E4), so rung 2 applies nowhere until an account's module
   is set to `insurance_pc`.
3. **Real test calls (the exit gate; danlo's).** Proposed for `docs/runbooks/voice-setup.md` as "Step 8 —
   Identity checks", after Step 7 (bis-platform lands it):
   - On danlo's own account (the reachable number `+19565061545`, status `testing`), create two contacts
     with danlo's mobile as their phone, "Ana Prueba" and "Beto Prueba", each with an upcoming booking, and
     no email on Beto. Note any existing contact with that phone (it is a third candidate).
   - Call. Ask about "my appointment": she asks whose name it is under and says no name herself. Say "Beto
     Prueba": she reads Beto's time and only Beto's. Say "Ana Prueba": Ana's. Logs:
     `voice identity …: confirmed rung 1 by name`.
   - Call again. Give "Carla Prueba" twice: the same "couldn't find it under those details" both times, then
     the offer of a message. Hang up. The To do page shows "Someone asked about an appointment and couldn't
     confirm who they are", marked "Sofía · AI", opening the call. Logs: `miss 1`, `locked (misses)`.
   - Only with the owner's answer to Q1: set the account's trade rules to insurance, call, give Ana's name and
     her email (spelled): confirmed at rung 2; give Beto's name: she cannot look it up (no email), offers a
     message. Set the trade rules back to none at once.
   - In both calls' logs, copy the `[voice/incoming] incoming call` line's `attestation` field and the
     `texml form fields:` line's `attestation:` part into the ledger: they are this part's E1 finding.
   - Delete the two test contacts and their bookings.
4. Tracker: F-116 part done once step 3 passes.

**Rollback:** revert the PR. Nothing is stored that the old build cannot read; a To-do it filed stays an
ordinary To-do.

## 9. Tiers (per task, binding rule 2026-10-19)

- **HIGH:** the gating in `find_my_booking`, `reschedule_appointment` and `cancel_appointment`
  (`checkCallerOwnsBooking`); the two reads and the removal in `packages/db/src/voice.ts`, with their db
  tests (a bug here reads or cancels another customer's appointment, silently).
- **MEDIUM:** the identity module (ladder, matching, decision, state); `confirm_identity` and its schema;
  the To-do in `finishCall`.
- **LOW:** the attestation line and the shared rule's extraction; copy keys and baseline; the insurance
  hint; the work-list link (another agent's file); the runbook step (proposed).
- One end-of-PR review (final + design), then one fix round. No corpus run.

## 10. What was checked, needs, and findings

**The brief's context map, checked against `449d5bf6`:**

| Claim | Verdict |
|---|---|
| `registry.ts:96-136` checkCallerOwnsBooking | Yes: doc 96-113, function 114-136 |
| `phone-number.ts:63-67` isCallerIdNumber | Yes |
| find_my_booking `registry.ts:306-329`, `schemas.ts:23-25` | Yes |
| `voice.ts:932-947` returns the soonest booking across every contact sharing the phone | Yes, and it compares the raw stored phone (SD4) |
| The prompt's caller line `system-prompt.ts:142-156` | Yes |
| The modules have no risk concept (`modules/index.ts:22-44`, 0094) | Yes |
| STIR/SHAKEN is not read on the SIP path | Yes; but header NAMES are already logged (SD6) |
| Blank-fill rung-1 rule `registry.ts:454-475` | Yes, and a second site (SD5) |
| `crm-features.md` l.2220, l.1576, l.1857-1860 | Yes |
| l.943 binding constraint 5 / decision 19 | It is §3.2 rule 4, whose "Why" cell is "Binding constraint 5" (SD8) |
| l.3081-3121 decision 19 | Heading at 3081, text to 3119; decision 20 starts at 3121 |
| `telnyx-request.ts:61-108` | `logFormFields` and its constants are 63-108; 61 closes `readTelnyxForm` (SD8) |
| tasks link `tasks.call_id` (0064) with once-per-call dedupe | Exists, and is already the callback To-do's (SD1) |
| A tool-schema change reaches no pinned digest | Confirmed (5.5) |

**Needs from other agents or the orchestrator:**

- The owner of `packages/db/src/index.ts`: one new line, `export { emailKey } from "./contacts";` (4). Why:
  the email comparison must be the database's own rule, and a second copy drifts (0034).
- The owner of `apps/web/src/lib/documents/card-focus.ts` and `…/tasks/work-list.tsx` (the work queue):
  `workRowHref` links a To-do with a `callId` and no `contactId` to the call page, with its test (5.6, S11).
- bis-platform: the runbook's Step 8 (section 8, step 3).

**Findings outside this part (unfixed, for the ledger):**

- **F1** A NEW booking on a shared phone lands on whichever contact the dedupe finds: `createContact` matches
  email first, then `phone_key` with `limit(1)` (`packages/db/src/contacts.ts:269-277`), so a spouse who
  books without an email can be booked onto the other spouse's record. E3 covers existing appointments only.
- **F2** Decision 19's blank-fill on a shared phone fills the blanks of whichever contact the dedupe found,
  because "the caller's own record" is judged by caller ID alone (`registry.ts:463-475`,
  `finish-call.ts:335-347`). Blanks only; decision 19 unchanged by this part.
- **F3** `finishCall`'s message thread on a shared phone (`resolveContactId`, `finish-call.ts:307-347`) has
  the same shape as F1.
- **F4** The corpus stub answers `{ ok: true }` for `find_my_booking` and `confirm_identity`
  (`corpus-lib.ts:176-205`), so a future corpus run cannot exercise the ladder; the plan tests it by real
  calls (l.1858-1860) until F-021's harness.
- **F5** The runbook has asked since #198 for the TeXML attestation field to be recorded
  (`voice-setup.md:795-796`), and no record exists.

## 11. Owner questions

- **Q1 May danlo's own account switch its trade rules to insurance for the length of the rung-2 test call
  (section 8, step 3), and back to none straight after?** E4 says packs stay off on every account, and the
  plan tests the ladder by real calls (l.1858-1860); without a pack switched on somewhere, rung 2 is tested by
  unit tests only. Recommendation: yes, on that account only, set back to none in the same sitting. Until
  answered, the step is skipped and rung 2 ships on unit tests.

## 12. Spec deviations (code that contradicts the brief, with evidence)

- **SD1 The once-per-call To-do link is already taken.** The brief offered `tasks.call_id` "with server-side
  dedupe once per call" as a free choice; `tasks_call_once` (0064:112-113) already allows ONE To-do per call
  and the callback To-do uses it (`finish-call.ts:823-835`). A locked call that took a message would file
  both on one key, and the second would silently return the first. Resolved by S10: the identity To-do IS the
  call's To-do.
- **SD2 "Linked to the call" does not show today.** A call-linked To-do links to its contact or nowhere
  (`card-focus.ts:23-42`; `work-list.tsx:257-258`). Resolved by S11, in another agent's file.
- **SD3 There is no state object in the registry.** `ToolContext` (`registry.ts:49-67`) is fixed per call;
  the only per-call mutable state is `CallState` (`call-state.ts:64-106`), which the identity goes into.
- **SD4 The household read also misses typed phones.** Beyond the gap the brief names,
  `findUpcomingBookingForPhone` compares the raw `phone` with the E.164 (`voice.ts:935`), while the ownership
  check normalises (`registry.ts:104-108`, 128). The candidate read uses `phone_key` plus `isCallerIdNumber`.
- **SD5 Decision 19's blank-fill has two sites,** `registry.ts:463-475` and `finish-call.ts:335-347`; both
  keep their rung-1 rule.
- **SD6 The SIP leg is half-observed already, and differently shaped.** Header names are logged on every
  call (`route.ts:924`). The STIR/SHAKEN header is `Identity`, which the TeXML name pattern
  (`telnyx-request.ts:64`) does not match, and `verstat` is a URI parameter in a value, not a name; mirroring
  `logFormFields` alone would observe nothing (S13).
- **SD7 "Values with digits redacted"** is narrower in the code: a value prints when it is at most 64 plain
  characters, is "(redacted)" only with seven or more digits in a run, and is "(unprintable)" otherwise
  (`telnyx-request.ts:65`, `101`). The SIP line uses that exact rule, shared.
- **SD8 Line citations:** `logFormFields` is `telnyx-request.ts:63-108`; `crm-features.md` l.943 is §3.2
  rule 4 (binding constraint 5 is its reason); decision 19 runs l.3081-3119.
- **SD9 "Rung 1, as today" is a tightening for moves and cancels.** Today they pass on the caller ID alone,
  with no lookup first (`registry.ts:127-129`); under S9 they need the confirmation `find_my_booking` or
  `confirm_identity` recorded in call state. Finding first is what the prompt already tells her to do
  (`system-prompt.ts:263`).
- **SD10 The frozen prompt costs one round trip.** Because `system-prompt.ts:264` names `find_my_booking` as
  the source of a movable booking, `confirm_identity` cannot hand back the booking itself (S8).
- **SD11 The events requirement equals no pack's** (both rung 1, E4), so switching events on changes no
  identity behaviour today; it is declared in the table for a later base change.
- **SD12 "The code compares" needs one export.** `emailKey`, the rule behind `email_key`, is not exported
  from `@bis/db` (`index.ts:20-27`); section 10 asks for the line.
- **SD13 A tool-schema change does reach the corpus,** though no digest: `toolsFor` sends `toolSchemas`
  (`corpus-lib.ts:143-147`) and module result sheets pin module text only (`modules/pin.ts:16-21`). No run is
  planned (F4).

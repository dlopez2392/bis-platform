# S-47 part e: caller identity checks scaled to each pack's risk (F-116 part, the no-text version; no migration)

Status: owner decisions E1–E5 fixed in conversation 2026-10-24, and the design of sections 5.1–5.4 (the
rungs, the action requirements, the one module, the confirm flow) approved the same day. This draft fills in
the rest against the tree at main `449d5bf6`. The choices it makes that the decisions did not dictate are
S1–S25 in section 2. The owner answered the first draft's question and its three findings the same day (E6,
E7), and the orchestrator ruled on its "needs" and on findings F4 and F5 (O1–O3); one new owner question,
raised by E7, is open (Q2, section 11). Part e of S-47 (parallel work,
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

The owner's answers to the first draft (2026-10-24):

- **E6 One rung-2 test call (Q1).** Yes. Just before the owner's call, the orchestrator switches BIS's own
  account (the number `+19565061545`) to the insurance trade rules; straight after, it switches them back to
  none and records both times. Written into the rollout (section 8, step 3) and the runbook's Step 8.
- **E7 One record rule on a shared number (F1–F3), fixed in this part.** On a shared number, the confirmed
  person's record is used. With no confirmation, Sofía neither creates nor writes anything ambiguous, and
  asks the name first. It covers a new booking (including one without an email: today's phone-match-first
  dedupe, `packages/db/src/contacts.ts:276-277`), decision 19's blank-fill, and `finishCall`'s message
  thread. The new-booking contact choice and the blank-fill are writes to customer records: tier HIGH.

The orchestrator's rulings (2026-10-24):

- **O1 The three "needs" join this PR:** the `emailKey` export line in `packages/db/src/index.ts`;
  `workRowHref` (`apps/web/src/lib/documents/card-focus.ts`) linking a To-do with a call and no contact to
  the call page; the runbook's Step 8 (`docs/runbooks/voice-setup.md`).
- **O2 F4:** the corpus stub must follow the real ladder, or at least refuse, so a corpus run cannot pass
  the ladder vacuously. This spec recommends following it (S24, 5.11).
- **O3 F5** is folded into Step 8.

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
  (`lib/documents/card-focus.ts:23-42`); it gains the call page as its link (5.6; in this PR, O1).
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
- **S19 One picker for every record write (E7).** `pickRecordOnNumber` (`identity/record.ts`) decides
  which contact a booking, a lead, a message thread or a blank-fill lands on, with the SAME name and email
  rules as the confirm (5.3). Every voice write site calls it; none calls the phone-first dedupe on a shared
  number (5.10).
- **S20 "Shared" is judged on the number being stored:** the caller ID, or the number the caller gave
  (`spokenPhone`), whichever the write would store. Two or more contacts of this account on it is shared;
  one or none is today's path (the sole contact on a number is that number's person, rung 1), with ONE
  exception: a full name (two words or more) that does not match a sole contact who has a full name of their
  own is a different person, and makes a new contact (S21) rather than landing on them. A sole "Caller"
  record, or one with only a first name, keeps today's path, so a repeat caller's blank name is still filled
  (decision 19's purpose).
- **S21 A name that matches nobody on a shared number makes a new contact,** named and on that number.
  That is not ambiguous: it is a new person in the household. It is made through `createContact` with
  `matchBy: "email_only"` (5.10.1), so an email on file elsewhere on the account still wins, as today, and
  the phone never picks a household member.
- **S22 `take_message` asks for a name on a shared number.** With nobody confirmed and no name, it refuses
  once and asks for the first and last name, or `nameDeclined: true` (the `emailDeclined` pattern that the
  2026-08-28 calls proved works, `registry.ts:390-404`). A declined or ambiguous name leaves the message on
  the call (its card, the alert and the To-do) and in no customer's thread.
- **S23 A second booking in one call is picked again.** Today `book_appointment` reuses `state.contactId`
  from the call's first booking (`registry.ts:442`), so "and one for my husband" lands on the wife. Every
  booking with a number runs the picker (one indexed read, after the first booking's own insert, so the
  wife's new record is already on the number); `state.contactId` is reused only when the picker answers
  `today`, and is then the latest booking's contact.
- **S24 The corpus stub follows the real ladder** (O2): it runs `decideIdentity` and the 5.4.4 result
  builders over a fixture's contacts, with per-item state, rather than refusing (5.11).
- **S25 The missed-call text-back on an unconfirmed shared number** waits on Q2 (section 11). Until it is
  answered the PR writes nothing there: no contact, so no text (Q2's option (a)), at every site, including
  `contactForCallerId`'s own phone pick (5.10.4).

## 3. Scope

**In:** the identity module `apps/web/src/lib/voice/identity/` (the ladder table, name and email matching,
the per-call identity state helpers, the tool-result sentences); the new tool `confirm_identity`; the
changes to `find_my_booking`, `reschedule_appointment` and `cancel_appointment`; two reads in
`packages/db/src/voice.ts` and the removal of one; the To-do in `finishCall`; the SIP attestation log line;
E7's one record rule on a shared number (the new-booking contact, the blank-fill at both sites, the message
thread, `take_message`'s name, `createContact`'s `matchBy`, and the text-back: no ambiguous write now, Q2's answer later); the
`emailKey` barrel line, `workRowHref`'s call link and the runbook's Step 8 (O1); the corpus stub (O2); the
copy keys; unit, db and route tests.

**Out (and where it goes):** one-time codes (F-116's later part: A2P, decision 19, E1); acting on the
attestation (observation first; a later part may use it once a real call's log shows what arrives); "habla
por", a delegate speaking for someone on another number (F-003's part, l.1476, hypothesis H5); the
phone-first dedupe for every NON-voice writer (the booking page, forms, the web chat, the CSV import keep
`createContact`'s default; E7 is Sofía's rule); any system prompt change (5.5); any trade-module
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
listContactsOnNumber(db, accountId, e164)
  -> { rows: { id, first_name, last_name, phone, email_key }[], truncated: boolean }
  where account_id = accountId and phone_key in (keys of e164), limit 21
  keys: phoneDigits(e164) (contacts.ts:177-180), plus the ten national digits of a +52 or +521
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

The same read serves both callers: the identity check passes the caller ID; the record rule (5.10) passes
the number the write would store (S20). `isCallerIdNumber(stored, number)` is a plain "does this stored phone
read as this E.164" compare, so it filters either.

One barrel line is needed for the email rule: `export { emailKey } from "./contacts";`, a new line beside the
contacts exports (`index.ts:20-27`). `emailKey` (`contacts.ts:209-214`) is the twin of `email_key`, and a
second implementation in the app is exactly the drift 0034 was written to end (in this PR, O1).

One option is added to `createContact` (`packages/db/src/contacts.ts`, tier HIGH, 5.10.1):
`CreateContactInput` (`contacts.ts:33-42`) gains `matchBy?: "email_only"`, read only by `createContact`
(as `assignedTo` and `author` are; `toRow`, `contacts.ts:128`, names its fields one by one and never sees
it). With it, `findDuplicate` (`contacts.ts:261-354`) runs the email lookup (266-272) and skips the whole
phone branch (274-351): no phone match, no legacy-key read, no country twin. Absent, every caller behaves
exactly as today.

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

`identity/candidates.ts` wraps `listContactsOnNumber` and filters its rows with `isCallerIdNumber(row.phone,
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
confirmation, and a booking does not set the confirmation: the two stay separate facts. A confirmed person
who then books is booked onto their own record because the record rule reads the confirmation (5.10.1),
not because the confirm wrote `state.contactId`.

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
and its stub answers `{ ok: true }` for any tool it does not mirror (`corpus-lib.ts:176-205`). Left alone, a
corpus run would see `confirm_identity` and get `ok: true` from it (finding F4); 5.11 makes the stub follow
the ladder (O2). The modules are paused; no run is part of this spec.

The same holds for `take_message`'s two new fields (5.10.5): the prompt's TOOLS line still names
`take_message(body, callbackNumber)` (`system-prompt.ts:212`) and is not edited; the fields reach her through
the schema and the one result that asks for them.

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
  contact. In this PR (O1).
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

### 5.10 One record rule on a shared number (E7, tier HIGH)

Today every voice write that needs a contact goes through `createContact`'s dedupe, which takes the email
match, else the FIRST contact whose `phone_key` matches (`contacts.ts:274-279`, `limit(1)`; `winner` at
439-440). On a household number that is whichever row Postgres returns. Four sites inherit it: the new
booking (`registry.ts:442-476`), decision 19's blank-fill (`registry.ts:463-475`, `finish-call.ts:335-347`),
`finishCall`'s message thread (`resolveContactId`, `finish-call.ts:307-379`) and the text-back's own
resolver (`textback.ts:159-184`). E7 replaces the phone pick at all four with one decision.

#### 5.10.0 The picker (`identity/record.ts`, pure)

```
pickRecordOnNumber({ onNumber, truncated, name, email, confirmed }) returns one of
  today                      0 or 1 real contacts on the number: today's code path, unchanged (S20)
  existing(contactId)        the confirmed person, or the one contact the name (and email) picks
  create                     the name matches nobody on the number: a new person (S21)
  ask_name                   no name, or a name of one word
  ambiguous                  the name fits several and no email picks one, or more than 20 on the number

in this order:
  onNumber has exactly 1 real contact, it has two name words or more,
    and the name has two words or more and does not match it (5.3)   -> create        (S20's exception)
  onNumber has 0 or 1 real contacts and not truncated               -> today
  truncated                                                          -> ambiguous
  confirmed is on onNumber, and the name is absent, matches it (5.3),
    or is that record's first word alone                             -> existing(confirmed)
  name absent or one word                                            -> ask_name
  the name matches exactly one                                       -> existing(it)
  the name matches several: the email (emailKey) picks exactly one   -> existing(it); otherwise ambiguous
  the name matches none                                              -> create
```

- `onNumber` is `listContactsOnNumber` (4) for the number the write would store (S20), filtered by
  `isCallerIdNumber`. "Real" leaves out a holding record, if Q2 creates them (5.10.4).
- `confirmed` is `state.identity.confirmed`, and counts only when the number being stored IS the caller ID:
  a confirmation is about the caller ID's people, never about a number the caller recited.
- The name and email rules are 5.3's, word for word. The picker never fuzzes and never returns a contact
  the caller did not name or confirm.
- A read failure throws. Every caller below already sits inside a net that writes nothing on a throw.

#### 5.10.1 A new booking (`registry.ts:442-476`)

The picker runs after the slot check (`registry.ts:434-435`) and before the first write (442), so a refused
booking writes nothing. The number is `e164Of(phone)`, the stored form of `spokenPhone`'s result
(`registry.ts:384`); with no number at all (caller ID withheld and none said) it is `today`: an email-only
`createContact`, which cannot reach a household by phone.

- The picker runs for every booking that has a number, the call's second booking included (S23).
- `today` → today's code, unchanged: `state.contactId` when the call already booked, else `createContact`.
- `existing(id)` → `contactId = id`, no `createContact`; the blank-fill of 5.10.2 applies.
- `create` → `createContact({ firstName, lastName, phone, email, source: "voice", matchBy: "email_only" })`
  (4). An email on file elsewhere on the account still wins, as today (`existing: true`, and no fill: that
  record was reached by email, not picked by name); otherwise a new contact and its `contact_created` act.
- `ask_name` → `{ ok: false, error: "Before you book, ask for their first AND last name, then call
  book_appointment again with it." }`, nothing written.
- `ambiguous` → `{ ok: false, error: "This appointment can't be booked under that name on this call. First
  call capture_lead with their name and what they needed, then take_message, so the team can book it." }`,
  nothing written. It is the prompt's own fallback for a booking that cannot be completed
  (`system-prompt.ts:286`).
- A read failure → the throw reaches `call-events.ts:206-220` ("tool failed — apologize and offer to take a
  message"); nothing written.
- A booking does not set `state.identity` (5.4.1).

`createContact`'s `matchBy` (4) is in `packages/db/src/contacts.ts`: `CreateContactInput` (33-42),
`findDuplicate`'s phone branch (274-351) skipped when it is set, read at 439. No other caller passes it.

#### 5.10.2 Decision 19's blank-fill (`registry.ts:463-475`, `finish-call.ts:335-347`)

Today the fill runs when the deduped record's stored phone is the caller ID. After E7 it runs ONLY on:

- a record the picker returned as `existing` on the caller-ID number (the confirmed person, or the one the
  name picked), or
- on a number with one contact or none (`today`), the record today's check accepts, unchanged.

Never on a record the email dedupe reached on the `create` path, and never on a household member reached by
phone. What is filled is unchanged: blanks only, stamped "Sofía · AI", undoable (`fieldFillActs`). The two
phone-only fills (`finish-call.ts:364-372` and `textback.ts:175-180`, both no-ops on a caller-ID match, by
their own comments) run only where their record was picked by this rule.

#### 5.10.3 `finishCall`'s message thread (`resolveContactId`, `finish-call.ts:307-379`)

The new order:

1. `state.contactId` (308): an in-call booking, already picked by 5.10.1. Unchanged.
2. NEW: `state.identity.confirmed` → that contact: the confirmed person's record (E7). A lead's fields fill
   its blanks only when the lead's `fullName` matches it (5.3).
3. A lead (313-350): the number is `e164Of(spokenPhone(fields.callbackNumber, callerNumber))`; the picker
   with the lead's `fullName` and `email`. `existing` → that record, with the 5.10.2 fill; `create` →
   `createContact` with `matchBy: "email_only"`; `ask_name` or `ambiguous` → null; `today` → today's code.
4. No lead, a caller ID (352-376): on a shared caller-ID number, the picker with the last message's `name`
   (S22, 5.10.5). `existing` → it; `create` → `createContact({ firstName, lastName, phone: callerNumber,
   source: "voice", matchBy: "email_only" })`; a declined name, `ask_name` or `ambiguous` → null. Any other
   number → today's "Caller" path.
5. Null: the lead-treatment block's own `if (contactId)` (`finish-call.ts:457-472`) skips the thread. The
   call row's `contact_id` stays null; the call card, the staff alert and the To-do are unaffected. The
   message is on the call, in no customer's thread.

#### 5.10.4 The text-back (waits on Q2)

`prepareTextback` takes its contact from `finishCall`'s resolver (`finish-call.ts:634-639`), from
`handoff-result` (`app/api/voice/texml/handoff-result/route.ts:352-362`, the call row's contact) or, when
neither gives one, from `contactForCallerId` (`textback.ts:237-238`, the phone-first dedupe). After 5.10.3 a
shared, unconfirmed, unnamed call resolves to null and the text-back is not sent ("no_contact",
`textback.ts:242`), while `contactForCallerId` would still pick a household member by phone. A conversation
must have a contact (`conversations.contact_id not null`, 0005:14), so the text has to live on SOME record or
not go. Q2 (section 11) asks which. Until it is answered, `contactForCallerId` (`textback.ts:159-184`) reads
`listContactsOnNumber` first and returns null on a shared number, so no path writes anything ambiguous
meanwhile (S25). The recommendation, (c): one holding contact per shared number, first
name "Caller", no last name, found or created by `contactForCallerId` when the number is shared. It is never
"real" in the picker (5.10.0) and can never be confirmed (5.3 rule 1: one word), so no appointment, fill or
lead ever lands on it; it carries the missed-call texts and the replies to them, which is what today's
"Caller" contact is for an unknown number.

#### 5.10.5 `take_message` asks for a name (S22)

- Schema (`schemas.ts:32-34`): `take_message` gains `name` ("The caller's first and last name, when you were
  asked for it.") and `nameDeclined` ("true ONLY after you asked for their name and they would not give
  it."). `required` stays `["body"]`.
- `registry.ts:339-347`: when there is a caller ID, nothing is confirmed, no `name` and no `nameDeclined`,
  it reads `listContactsOnNumber(callerNumber)`; two or more real contacts → `{ ok: false, error: "Before you
  take the message, ask for their first and last name, then call take_message again with name. If they
  would rather not say, call it again with nameDeclined: true." }`. One or none → recorded as today. A read
  failure → recorded as today (a message is never lost on our outage; `finishCall` decides its record later,
  and fails closed there).
- `TakenMessage` (`call-state.ts:12`) gains `name?: string` and `nameDeclined?: boolean`.
- The prompt's TOOLS line still says `take_message(body, callbackNumber)` (`system-prompt.ts:212`); the new
  fields travel in the schema and in this one result (5.5, SD16).

### 5.11 The corpus stub follows the ladder (O2, S24; tier LOW)

Today `stubToolResult` (`modules/corpus-lib.ts:176-205`) answers `{ ok: true }` for every tool it does not
mirror, so a corpus item could "find" and "cancel" an appointment with no check at all.

- `CorpusFixture` (`corpus-lib.ts:38-43`) gains an optional `contactsOnNumber: { firstName, lastName,
  email? }[]` (default `[]`, so every existing fixture parses unchanged) and the runner's per-item closure
  (`apps/web/scripts/sofia-corpus.ts:214`) holds one `identity` state (5.4.1's shape) and the stub bookings
  made in that item.
- `find_my_booking`, `confirm_identity`, `reschedule_appointment`, `cancel_appointment` and `take_message`
  run the SAME pure functions the live tools use (`decideIdentity`, `requiredRung` with the item's module,
  `withMiss`, the 5.4.4 result builders, the 5.10.5 name ask), over the fixture's contacts (emails keyed with
  `emailKey`). A confirmed find answers one fixed stub booking; a move or cancel passes only for it or for a
  booking the item made.
- Why follow, not refuse: refusing would make every appointment item fail or be skipped, so no run could
  show the ladder working; following it costs fixture data only, and it is the stub's own v3 rule
  ("registry.ts's own functions, so the stub answers what the live tool answers", `corpus-lib.ts:196`).
- A parity test feeds one fixture to the stub and to `runTool` (its DB reads mocked from the same contacts)
  and requires deep-equal results for each of the five tools. No corpus run is part of this spec.

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
  `booking.test.ts:922` does):** `listContactsOnNumber` finds an E.164 phone, a legacy typed "(956)
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
- **Work list (O1, `card-focus.test.ts`):** a To-do with a call and no contact links to the call page; one
  with a contact still links to the contact; a closure or expiry To-do keeps its own link (mutation: test
  `callId` before `closureFocus` → the closure case FAILS).
- **The picker (E7, pure):** every row of 5.10.0's order as a fixture, including S20's exception (a sole
  "Dan Lopez" and the name "Ana Prueba" → create; a sole "Caller" and "Ana Prueba" → today), a confirmation
  that counts only on the caller-ID number (a recited number with the same contacts ignores it; mutation:
  always read `confirmed` → FAILS), the same-name pair with and without an email, and truncation.
- **The new booking (HIGH, `registry.test.ts`):** on a shared number, "Beto Prueba" books onto Beto, never
  Ana, with and without an email (red first: today it lands on whichever row `createContact`'s phone match
  returns); a name matching nobody makes a new contact through `createContact` with `matchBy: "email_only"`;
  one word asks for the full name and writes nothing (no `createContact`, no `createBooking`); ambiguous
  writes nothing; a second booking in the same call for the other person lands on that person, on a shared
  number AND on a number that had nobody before the first booking (S23; mutation: reuse `state.contactId` →
  FAILS in both); a confirmed person booking under their first name alone is booked onto
  their record; a non-shared number is today's path, byte for byte (the existing book tests pass unedited).
- **The blank-fill (HIGH):** filled on the record the name picked; never on a household member reached by
  phone; never on a record the email dedupe reached on the `create` path; the single-contact path as today;
  at `registry.ts` and at `finish-call.ts` both (mutation at each site: today's caller-ID-only check → FAILS).
- **`createContact`'s `matchBy` (HIGH, `packages/db/src/test/contacts.test.ts`):** with `email_only`, a
  contact with the same phone and no email match is NOT returned (a new row is made); an email match still
  returns its contact; no `contact_duplicate_flags` row and no country-twin read on that path; absent, every
  existing dedupe test passes unedited. Second account: account B's contact with the same email is never
  returned for account A (mutation: drop the `account_id` filter from the email branch → FAILS).
- **The message thread (HIGH, `finish-call.test.ts`):** the confirmed person's record is used; a lead on a
  shared number goes to the name's one match, or a new contact, or nowhere when ambiguous; a message with
  `nameDeclined` on a shared number writes no contact, no conversation and no message row, while the call
  row, the card, the alert and the To-do are written; a non-shared number is today's path.
- **`take_message` (5.10.5):** on a shared number with nothing confirmed, no name and no `nameDeclined`, it
  refuses once with the literal sentence and records nothing; with `name` or `nameDeclined` it records the
  message with them; a single-contact number records it as today, with no refusal; a confirmed caller is
  never asked (no read); a read failure records the message.
- **The text-back:** now, on a shared unconfirmed number `contactForCallerId` returns null, makes no
  `createContact` call, and `prepareTextback` answers "no_contact" (mutation: today's phone pick → FAILS); a
  number with one contact or none is today's path. After Q2, per the answer; with (c), a shared unconfirmed call threads its text on the
  one "Caller" holding record, created once and reused on the second call (mutation: create every time →
  FAILS), and that record is never offered by the picker or matched by a name.
- **The corpus stub (O2, `corpus-lib.test.ts`):** the parity test of 5.11 for each of the five tools over
  one fixture with two contacts on the number; with no `contactsOnNumber`, find answers `{ found: false }`;
  a cancel before any confirmation is refused (mutation: today's `{ ok: true }` → FAILS); every existing
  fixture still parses.

Commands (agent-scoped, never the gates): `pnpm --filter web exec vitest run src/lib/voice src/app/api/voice`
and the work-list test by path; `pnpm --filter @bis/db exec vitest run src/test/voice.test.ts` (judged by its
summary block); `pnpm --filter web typecheck`.

## 8. Rollout

1. No migration, so nothing goes to bis-ci or production first. One PR; merge only on green `verify` and
   `e2e` for the head SHA (read the check runs for that SHA).
2. Deploy READY. Merging changes phone calls in two ways only: on a number several contacts share, Sofía
   asks whose appointment it is, and every booking, lead, message thread and fill lands on the person the
   name or the confirmation picks, or on nobody (E7). Every pack is off (E4), so rung 2 applies nowhere until
   an account's module is set to `insurance_pc`.
3. **Real test calls (the exit gate).** The runbook's new Step 8, landed in this PR (O1) in
   `docs/runbooks/voice-setup.md` after "Step 7 — Booking leg", exactly as below. danlo places the calls; the
   orchestrator does every dashboard step and records the times (E6).
4. Tracker: F-116 part done once Step 8 passes, with the ledger entry of its step 8.6.

The text of Step 8 (the plan pins it; Q2's answer adds 8.5's last line):

```
## Step 8 — Identity checks (shared numbers and the insurance check)

Run once after the identity-checks release, on BIS's OWN account: its number +19565061545 (status
testing) is the only one that takes a real call. danlo places the calls from his mobile; the orchestrator
does every dashboard step and writes each time in the ledger. No client account is touched.

8.1 Setup (orchestrator). On BIS's account, Contacts: note every contact whose phone is danlo's mobile
    (normally "Dan Lopez"). Make no new contacts by hand: the calls below make them.

8.2 Call 1, bookings on a shared number (danlo). Ask to book "for Ana Prueba", decline the email; then, on
    the same call, ask to book one "for Beto Prueba", decline the email. Hang up.
    Check (orchestrator): Contacts shows Ana Prueba and Beto Prueba, each with danlo's mobile and her or his
    own booking; Dan Lopez gained no booking and no changed field.
    Logs: no "contact dedupe" error.

8.3 Call 2, whose appointment (danlo). Ask "when is my appointment?". She asks whose name it is under and
    says no name herself. Say "Beto Prueba": she gives Beto's time, and only Beto's. Then ask about
    "Ana Prueba's": Ana's time.
    Logs: voice identity <call>: confirmed rung 1 by name (twice).

8.4 Call 3, two misses (danlo). Ask about an appointment and give "Carla Prueba" twice. Both times she says
    she couldn't find it under those details; after the second she offers to take a message. Decline the
    name when she asks for it, leave the message, hang up.
    Check (orchestrator): To do shows "Someone asked about an appointment and couldn't confirm who they
    are", marked "Sofía · AI"; opening it opens the call; the call's card has the message. No customer's
    thread got the message.
    Logs: miss 1, locked (misses).

8.5 Call 4, the insurance check (owner decision E6).
    a. Orchestrator: on Ana Prueba's record, set her email to ana.prueba@example.com (an edit sends nothing).
    b. Orchestrator, just before the call: Voice page, Trade rules: Insurance (property & casualty), Save.
       Write the time. Do NOT open or save the Services & prices card while insurance is on.
    c. danlo: ask about "my appointment". She asks for the full name and the email on file. Give
       "Ana Prueba" and spell ana.prueba@example.com: she reads it back, then gives Ana's time.
       Then ask about "Beto Prueba's" with any email: she couldn't find it under those details.
       Logs: confirmed rung 2 by name-email, then miss 1.
    d. Orchestrator, straight after the call: Trade rules: None, Save. Write the time. Every call between
       the two times ran under the insurance rules.
    [Q2's answer: the missed-call text on a shared number, and how to check it.]

8.6 The carrier's caller-ID attestation (folds in the "While you are in the logs" check of the press-1
    section). For each call above, copy into the ledger:
    - the [voice/incoming] "incoming call" line's attestation field, and
    - the "texml form fields:" line's attestation: part.
    "none" on every call is a result too: write it down.

8.7 Clean up (orchestrator). Cancel the two test bookings on the Calendar page, delete Ana Prueba and Beto
    Prueba, and mark the test To-dos done.

If it fails: a booking or a time for the wrong person, a name said by Sofía before the caller said one, or
a To-do missing after 8.4 is a failed release. Roll back by reverting the release; nothing it stored needs
undoing.
```

The press-1 section's own "While you are in the logs" line (`voice-setup.md:795-796`) gains one sentence:
"Since the identity-checks release, record the result in Step 8.6."

**Rollback:** revert the PR. Nothing is stored that the old build cannot read; a To-do it filed stays an
ordinary To-do.

## 9. Tiers (per task, binding rule 2026-10-19)

- **HIGH:** the gating in `find_my_booking`, `reschedule_appointment` and `cancel_appointment`
  (`checkCallerOwnsBooking`); the two reads and the removal in `packages/db/src/voice.ts`, with their db
  tests (a bug here reads or cancels another customer's appointment, silently); E7's writes to customer
  records: the picker, the new-booking contact choice (5.10.1), the blank-fill at both sites (5.10.2), the
  message thread (5.10.3), `createContact`'s `matchBy` (4), and the text-back's null on a shared number now,
  Q2's answer later (5.10.4).
- **MEDIUM:** the identity module (ladder, matching, decision, state); `confirm_identity` and its schema;
  `take_message`'s name (5.10.5); the To-do in `finishCall`.
- **LOW:** the attestation line and the shared rule's extraction; copy keys and baseline; the insurance
  hint; `workRowHref`'s call link and the `emailKey` barrel line (O1); the corpus stub (5.11; no live path
  runs it); the runbook's Step 8.
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

**The first draft's "needs", now in this PR (O1):**

- `packages/db/src/index.ts`: one new line, `export { emailKey } from "./contacts";` (4). The email
  comparison must be the database's own rule; a second copy drifts (0034).
- `apps/web/src/lib/documents/card-focus.ts`: `workRowHref` links a To-do with a `callId` and no
  `contactId` to the call page, with its test (5.6, S11). `work-list.tsx` needs no edit (it already passes
  the whole row, `work-list.tsx:258`).
- `docs/runbooks/voice-setup.md`: Step 8, verbatim in section 8, and one sentence in the press-1 section.

The new-booking choice reaches `packages/db/src/contacts.ts`, a CRM file, for one option that no other caller
passes (4); its owner should see the `matchBy` diff in review.

**The first draft's findings, and where each went:**

- **F1** (a new booking on a shared phone lands on whichever contact the dedupe finds,
  `contacts.ts:274-279`): fixed by E7, 5.10.1.
- **F2** (decision 19's blank-fill on a shared phone, `registry.ts:463-475`, `finish-call.ts:335-347`): fixed
  by E7, 5.10.2.
- **F3** (`finishCall`'s message thread, `finish-call.ts:307-379`): fixed by E7, 5.10.3. Following it showed
  the text-back depends on the same resolver: 5.10.4 and Q2.
- **F4** (the corpus stub's `{ ok: true }`, `corpus-lib.ts:176-205`): O2, 5.11.
- **F5** (the TeXML attestation field never recorded, `voice-setup.md:795-796`): O3, Step 8.6.

**Consistency check after the E6/E7 edits (2026-10-24):** every file:line cited by the new text was re-read
at `449d5bf6` (`contacts.ts:33-42, 128, 261-354, 439-472`; `finish-call.ts:307-379, 457-472, 634-639`;
`textback.ts:159-184, 237-242`; `handoff-result/route.ts:352-362`; `schemas.ts:32-34`; `call-state.ts:12`;
`corpus-lib.ts:38-43, 176-205`; `sofia-corpus.ts:214`; 0005:14); the picker's order was walked against
every call of Step 8 (which is how S20's exception and S23's every-booking rule were found); and the S, E,
O, Q and SD references were checked to resolve.

## 11. Owner questions

- **Q1 (answered: E6).** One rung-2 test call on BIS's own account, switched by the orchestrator just
  before and back straight after, both times recorded (Step 8.5).
- **Q2 On a shared number where nobody is confirmed and no name was given, where does the missed-call
  text-back live?** E7 says nothing ambiguous is written, and a text must sit in a contact's conversation
  (0005:14). (a) Do not send it: households lose the missed-call text, which is what an unconfirmed
  household call gets after 5.10.3 as written. (b) Put it on one household member's thread: a guess, which E7
  rules out. (c) One holding contact per shared number, "Caller", created once and reused, which no booking,
  lead, fill or name can ever reach (5.10.4). **Recommendation: (c)**: the caller still gets the text, its
  reply has a home, and no real person's record is written. Until answered, the PR ships (a) at every site,
  so nothing ambiguous is written meanwhile: `finishCall`'s resolver returns null (5.10.3) and
  `contactForCallerId` returns null on a shared number instead of picking by phone (`textback.ts:166-168`),
  which `prepareTextback` already treats as "no_contact" (`textback.ts:242`). (c), if chosen, replaces that
  null with the holding record.

## 12. Spec deviations (code that contradicts the brief, with evidence)

- **SD1 The once-per-call To-do link is already taken.** The brief offered `tasks.call_id` "with server-side
  dedupe once per call" as a free choice; `tasks_call_once` (0064:112-113) already allows ONE To-do per call
  and the callback To-do uses it (`finish-call.ts:823-835`). A locked call that took a message would file
  both on one key, and the second would silently return the first. Resolved by S10: the identity To-do IS the
  call's To-do.
- **SD2 "Linked to the call" does not show today.** A call-linked To-do links to its contact or nowhere
  (`card-focus.ts:23-42`; `work-list.tsx:257-258`). Resolved by S11, in this PR (O1).
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
  from `@bis/db` (`index.ts:20-27`); the line is in this PR (O1).
- **SD13 A tool-schema change does reach the corpus,** though no digest: `toolsFor` sends `toolSchemas`
  (`corpus-lib.ts:143-147`) and module result sheets pin module text only (`modules/pin.ts:16-21`). No run is
  planned; the stub follows the ladder (O2, 5.11).

Found while specifying E7 (2026-10-24):

- **SD14 E7 names three sites; there are four.** The text-back resolves its contact through `finishCall`'s
  resolver (`finish-call.ts:634-639`) and, failing that, through its own phone-first `contactForCallerId`
  (`textback.ts:166-168`, reached from `textback.ts:237-238` and `handoff-result/route.ts:352-362`). Fixing
  the thread alone turns an unconfirmed household's missed-call text into "no_contact" (`textback.ts:242`)
  and leaves `contactForCallerId`'s phone pick in place. Covered by S25, 5.10.4 and Q2.
- **SD15 The household gap is also inside one call.** `book_appointment` reuses `state.contactId`
  (`registry.ts:442`), so a second booking for another person lands on the first one's record even when the
  number had nobody on it before the call. Covered by S23.
- **SD16 "Asks the name first" has no field to ask with on a message.** `take_message` takes `body` and
  `callbackNumber` only (`schemas.ts:32-34`), and the frozen prompt names exactly those two
  (`system-prompt.ts:212`). Covered by S22 and 5.10.5, through the schema and one result.
- **SD17 Two more fills sit beside decision 19's.** `finish-call.ts:364-372` and `textback.ts:175-180` fill
  the phone on a phone-deduped record (no-ops on a caller-ID match, by their own comments). They follow the
  picker with the rest (5.10.2).
- **SD18 A single-contact number is not always that person.** Today's rule (and S20 as first drafted) books
  "Ana Prueba" onto a sole "Dan Lopez" because their phone matches (`contacts.ts:274-279`). E7's "nothing
  ambiguous" is applied there too: S20's exception makes a new contact when a full name contradicts a sole
  contact's full name, and keeps today's fill for a sole "Caller".

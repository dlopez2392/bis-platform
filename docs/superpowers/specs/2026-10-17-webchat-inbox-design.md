# Web chat in the inbox, and a composer that follows the last reply (S-06 part 3)

Status: approved in brainstorming 2026-10-17 (danlo, tiles; `.superpowers/sdd/s06c-design.md`).
First-release item 7, part 3 of 3 (`docs/crm-features.md:1284-1285`: F-036 part, F-068 part).
**Amended 2026-10-17 (owner rulings, tiles):** the chat matched to an existing customer is marked unconfirmed (§5a); the record gets one row per chat and the chat counts for "Last talked" (§7, G12 changed); G9 as proposed; every other gap accepted. New gaps G18-G22 are open.
Part 1 (#264, 0082) and part 2 (#266, 0083) are live: `2026-10-16-inbound-email-design.md`,
`2026-10-17-forward-to-record-design.md`.

This spec writes the approved design down. It does not re-decide it. Where the code made a
ruling impossible to follow as worded, or left a choice open, the choice is a numbered gap
(G1..G22; G18-G22 arose from the owner's rulings of 2026-10-17) with a proposal, at the end. Every claim about code cites `file:line` as read on
branch `feat/s06-webchat-inbox` at `d6be0a06`. Anything not read is marked ASSUMPTION.

## What exists today

- **The visitor-side chat** is `concierge_conversations` (0042:52-78): one row per chat,
  `transcript jsonb` of `[{role: "visitor"|"assistant", text, at}]` (`ConciergeTurn`,
  `packages/db/src/concierge.ts:8`), `submission_id` set once when a lead files (0042:70,
  `on delete set null`), `locale`, `account_id`. Service role only, no `authenticated` grant
  (0042:113-115). No retention: nothing deletes a row outside account teardown
  (`concierge.ts:320`, `account-teardown.ts:23`).
- **Turns are appended, never rewritten**: `concierge_append_turns` does
  `transcript = transcript || p_turns` in one statement and returns the new length
  (0044:28-34). Nothing else writes `transcript`.
- **The turn route** (`apps/web/src/app/api/concierge/[publicId]/turn/route.ts`) states three
  properties it does NOT have (`route.ts:15-34`): the transcript is atomic but not ordered
  across two tabs; `turn_count` is a spend counter, not an index; and a retried POST after a
  successful append files the same exchange twice (no idempotency stamp).
- **Order inside one turn**: model call (`route.ts:496-510`); `fileLead` when the model called
  `capture_lead` (`route.ts:529-574`); an optional follow-up completion (`route.ts:591-616`);
  `now` taken once (`route.ts:642`) and BOTH lines of the exchange appended with that same `at`
  (`route.ts:653-656`); usage in `after()` (`route.ts:688-700`). An append failure is logged and
  the answer still goes back (`route.ts:657-661`). `filed` is true when a lead is on file for the
  chat, from this turn or an earlier one (`route.ts:522`, `568`).
- **`fileLead`** (`apps/web/src/lib/concierge/lead.ts:62-189`) creates the submission
  (`authorKind: "ai"`, `lead.ts:151-156`), claims the chat's one slot (`lead.ts:158`), then runs
  `enrich` (`lead.ts:170-180`). It returns a boolean, no contact or thread id.
- **`enrich`** (`apps/web/src/lib/forms/enrich.ts:35-259`) returns `void`. In order: contact
  create-or-dedupe on email OR phone, unverified by design (`enrich.ts:82-108`);
  `linkSubmissionContact` (`enrich.ts:156`); `ensureConversation` + one `form`-channel inbound
  message, subject = form name, body = the message field or "Label: value" lines
  (`enrich.ts:170-182`); `incrementUnreadCount` (`enrich.ts:183`); then the lead alert email
  (`notify`, `enrich.ts:197-203`), the receipt, the instant text.
- **`messages`** already allows `channel='webchat'` (0006:90-92). `provider_message_id` has a
  global partial unique index (0005:51-52). `author_kind` is NOT NULL from the closed five, and
  `author_id` is only for `person` (0073:54-57, 0074:41). No trigger on `messages` (grep of
  every migration naming `on public.messages`: 0005, 0053, 0068 only, none a trigger).
  `created_at` is a plain default (0005:43), so an explicit value is accepted.
- **`createMessage`** (`packages/db/src/messaging.ts:139-189`): TypeScript channel union is
  `"email" | "form" | "voice" | "sms"` (`messaging.ts:20`), no `webchat`; no `createdAt` input;
  emits one `message.created` per row (`messaging.ts:168-170`); touches `last_message_at` to the
  app's now on every row (`messaging.ts:181-186`); the author comes from
  `messageAuthor(actorType, actorId, direction)` (`messaging.ts:145-147`).
- **`messageAuthor`** (`packages/db/src/provenance.ts:19-24`): `ai` → `ai`; inbound → `customer`;
  `user` → `person`; else `automation`. `ActorType` is `"user" | "system" | "ai"`
  (`events.ts:4`). SQL twin `app.message_author` (0073:72), pinned by `provenance-parity.test.ts`.
- **The inbox thread** reads `listMessages` (`messaging.ts:833-842`), which selects
  `MESSAGE_COLS` (`messaging.ts:81-82`): no `author_kind`, no `author_id`; ordered by
  `created_at` ascending ONLY. The bubble (`conversations/message-thread.tsx:97-136`): outbound
  right on `--accent-dim`, inbound left on `--surface-2`; footer = time, the channel label for
  any non-email channel, and the status word for outbound. No author mark today.
- **The inbox composer is email only** (`conversations/email-composer.tsx:11-14`, rendered at
  `conversations/page.tsx:357-362`). The record page's `MessageComposer`
  (`contacts/[contactId]/message-composer.tsx:39-251`) has Note / Email / Text, starts on Note
  (`message-composer.tsx:78`), and is fed server-side facts: `smsGate`, `contactHasPhone`,
  `smsBlockedLine`, `emailNoticeLine` (`contacts/[contactId]/page.tsx:91-121`, `167`,
  `219-226`). `sendSmsAction` already exists in the inbox's own actions
  (`conversations/actions.ts:181`). "Cleared for texts" already has one predicate:
  `canTextFrom({ phone, smsGate, smsBlockedLine })` (`lib/record/header-actions.ts:25-27`).
- **Channel labels are English only**: `MESSAGE_CHANNEL_LABEL` is built from bare `m[...]`
  (`lib/labels.ts:46-51`); the four keys have no `.es` twin (`lib/messages.ts:1474-1477`).

## Decisions (danlo, 2026-10-17, from `s06c-design.md`)

| # | Decision |
|---|---|
| 1 | The LEAD's chat, in full: when a web chat becomes a lead, the whole chat files on that customer's thread as web chat, every turn marked visitor or Sofía; later turns join it. Chats that never become a lead stay out. No live takeover (F-036 future). Staff reply by text or email. |
| 2 | The composer starts on the channel of the customer's most recent inbound text or email; after a web chat, form or call it starts on Text when their number is cleared for texts, otherwise Email. Never a channel the customer has stopped (both stopped → today's stopped notices). One tap switches for that message; not sticky. |
| 3 | Post-lead visitor turns raise unread and move the thread up, like a text or email. Sofía's turns never do. No alert beyond today's one lead alert. |
| 4 | One `messages` row per turn, channel `webchat`. Visitor: inbound, customer author. Sofía: outbound, "Sofía · AI" author. Pre-lead turns copied at filing with their own times; later turns appended as they happen. Idempotent per turn (chat id + turn index). |
| 5 | Today's `form` lead entry stays. A repeat visitor matched to an existing customer lands on that customer's thread. Nothing ever SENDS a webchat row. Visitor turns count as hearing back. Billing unchanged. A failed copy never costs the lead; it is logged with the account id only, and the next turn retries. A deleted customer's later turns are dropped quietly, never filed elsewhere. The start channel is decided on the server by a pure function. No new table expected. |

## Design

### 1. Which chat, and which thread

A chat files when, and only when, it has a lead on file: `filed === true` in the route
(`route.ts:522`, `568`), which covers a lead filed this turn, one filed on an earlier turn, and
one another tab filed first. The thread is resolved ONLY through the lead, never by matching the
visitor again:

`concierge_conversations.submission_id` → `form_submissions.contact_id` (set by enrich,
`enrich.ts:156`) → `ensureConversation(db, accountId, contactId, "concierge", "system")`
(`messaging.ts:100-137`; it returns the existing thread, so a repeat visitor enrich deduped onto
an existing customer lands on that customer's thread, decision 5).

- `submission_id` null (submission gone, 0042:70) or `contact_id` null (enrich failed before
  linking, or the contact was deleted: `form_submissions.contact_id … on delete set null`,
  0006:42) → **dropped quietly**: nothing written, one log line `{accountId, reason:
  "no customer"}`. Never `findDuplicate`, never a new contact, never another thread.
- In practice a lead's customer is rarely deletable: `deleteContacts` keeps any contact whose
  conversation has a message (`contacts.ts:1101-1113`), and enrich always writes one. The drop is
  for the paths where enrich's contact group failed, and for account teardown.

### 2. What one row looks like

| Field | Visitor turn | Sofía's turn |
|---|---|---|
| `channel` | `webchat` | `webchat` |
| `direction` | `inbound` | `outbound` |
| `status` | `delivered` (received in full, the `messaging.ts:30-34` rule for inbound writers) | `delivered` (the visitor read it on screen) |
| actor passed | `("concierge", "system")` → `messageAuthor` = `customer` | `("concierge", "ai")` → `messageAuthor` = `ai` |
| `author_kind` / `author_id` | `customer` / null | `ai` / null |
| `body` | the turn's `text` (≤ 2,000, `route.ts:167-168`) | the stored text (≤ 2,000, `route.ts:640`) |
| `subject` | null | null |
| `provider_message_id` | `webchat:<chat id>:<index>` (G1) | same shape |
| `created_at` | the turn's `at`, made strictly increasing in index order (G5) | same |
| `meta` | `{ webchat: { chat_id, index, locale, submission_id, matched_existing } }` (§5a) | same |

`<index>` is the turn's position in the `transcript` array, 0-based (G2). `locale` is the chat's
own `concierge_conversations.locale`, the language the visitor chatted in.

**No change to `messageAuthor` or `app.message_author`**: both kinds come out of the existing
mapping (`provenance.ts:20-21`), so the parity test gains no new input pair. The write goes on
the route's service client, as every `messages` write must since 0053.

### 3. The sync (one code path for the copy and for later turns)

After the route has appended this turn's exchange (`route.ts:653-656`) and `filed` is true, the
route schedules ONE background job in `after()` (the usage leg's precedent, `route.ts:689`):

1. Read the chat fresh (`getConciergeConversation`, `concierge.ts:238-245`): the transcript as
   stored, including this turn's pair and anything another tab appended.
2. Resolve the thread (§1). No customer → drop, log, stop. The same one read of the
   submission (`form_submissions.select("contact_id, created_at, contacts(created_at)")`) also
   answers whether the chat matched an existing customer (§5a).
3. Read the keys already on the thread: `provider_message_id` of this account's messages on
   this conversation whose key starts `webchat:<chat id>:` (served by `messages_thread`,
   0005:47).
4. Plan (a pure function): every transcript index with no key, in index order, with its
   `created_at` (G5).
5. Write them through ONE new `@bis/db` writer, `fileWebchatTurns` (G6): one insert per row in
   index order; `23505` on `provider_message_id` → that row is already there (another tab's
   sync or a retry), skipped and not counted; any other error stops the batch (order is kept)
   and is logged. Then, once per batch: the conversation touch (only when at least one VISITOR
   row was inserted, decision 3), one event, and the unread raise (§4).

Nothing from the sync reaches the visitor's response: it runs after the response is sent, in
its own try/catch, so a database hiccup can never change, delay or break the chat (decision 5).
The next turn's sync finds whatever this one missed, because step 3 reads what IS on the
thread, not what this turn meant to write.

**On the filing turn** the sync copies every earlier turn plus the filing turn's own pair: the
pre-lead copy (decision 4). **On every later turn** it copies that turn's pair (and any leftover).
Same code, same function.

**Cost per post-lead turn**: four reads (chat, submission's contact, conversation, keys), two
inserts, one touch, one unread call, one event: about nine round trips, none on the visitor's
path. Within `maxDuration` 30s (`route.ts:61`) the turn itself keeps 27s (`route.ts:76`); the
sync has the rest. A sync cut off by the platform heals on the next turn; on the chat's LAST
turn there is no next turn, and that pair stays only in the transcript (failure table).

**Where it does NOT run**: not inside `fileLead` or `enrich` (G3). Not on any refusal path
(start guard, caps, 404/403, 503): those return before the append and must cost nothing.

### 4. Unread and the inbox order

- **Filing turn**: no unread for any copied row. `enrich` already raised one for the lead entry
  (`enrich.ts:183`); the chat is that lead's story, not a second event (decision 3: no extra
  alert).
- **Later turns**: the sync raises unread by the number of VISITOR rows it actually inserted
  (normally 1), by calling `incrementUnreadCount` (`messaging.ts:581`) that many times. The rule
  is "the lead was on file when this turn STARTED" (`conversation.submission_id` non-null on the
  read at `route.ts:388`, or the row built at `route.ts:379-384` for turn 1, which never has one).
- Sofía's rows never raise unread and never touch `last_message_at` (decision 3). A visitor row
  touches it to now, so the thread moves up like a text.
- The sidebar badge (`sumUnreadCount`, `messaging.ts:606-614`) and the To do's unanswered row
  (`work-queue.ts:103-104`, `unread_count > 0`) follow from the count with no change.

### 5. The inbox thread: how a web chat bubble reads

`listMessages` adds `author_kind, author_id` to its select (additive; `ContactMessageRow` already
types the pair, `messaging.ts:827-831`). The page reads the persona name with
`getVoiceProfile(db, accountId)` (`voice.ts:159`) only when the open thread holds a webchat row;
a failed read falls back to "Sofía" (`author-mark.ts:80`'s own fallback).

| | Visitor turn | Sofía's turn |
|---|---|---|
| side, surface | left, `--surface-2` (inbound, unchanged) | right, `--accent-dim` (outbound, unchanged) |
| body `lang` | `meta.webchat.locale` (the language they chatted in; one message, one language) | same |
| footer | time · **Web chat** · **Customer** | time · **Web chat** · **{persona} · AI** |
| status word | none (inbound) | none: a webchat row is not a send the team made, so `MESSAGE_STATUS_LABEL` is not shown for it |

The marks reuse `provenance.customer` and `provenance.ai` (`lib/messages.ts:2657-2661`) through
`authorLabel` (`lib/record/author-mark.ts:72-85`), so the inbox and the record use one mark set
(DESIGN.md, Provenance: "Sofía · AI" is a mark, never a sixth kind). The footer is in the STAFF
member's language (`lang={locale}`), as the forward line is (`message-thread.tsx:164-171`).
Time: `formatDateTimeInZone(created_at, timezone)`, as every bubble.

The thread then reads, oldest first: the chat's turns, the lead entry exactly as enrich writes it
today (subject = form name, "Form submission"; G16), then Sofía's reply on the filing turn (G4),
then later turns. The list row's preview is the newest body, whoever wrote it
(`messaging.ts:725-736`): after a chat that is often Sofía's last line. ⌘K search finds chat
words (`searchConversations` has no channel filter, `messaging.ts:863-876`).

States (DESIGN.md rules 5 and 7): loading is the page's existing skeleton; an empty thread is
never listed (`listConversations`' existence join, `messaging.ts:645`); a failed persona read
costs only the name. Tokens only; dark and light come from the existing two surfaces.

### 5a. A chat matched to an existing customer is marked unconfirmed (RULED 2026-10-17)

`enrich` attaches a lead to an EXISTING customer when the typed email OR phone matches one,
unverified by design (`enrich.ts:82-89`, `97-108`; `created.existing`, `enrich.ts:149`). The owner
ruled that such a chat is shown on the thread as unconfirmed.

**How "matched existing" is known.** `enrich` returns nothing (`enrich.ts:48`) and the sync may
run in a LATER request than the filing (§3), so an in-process return value is not enough. The
fact is derived instead, from two timestamps the sync already reaches: the chat's submission is
written BEFORE `enrich` looks for a contact (`lead.ts:151` then `lead.ts:170`), so

- `contacts.created_at < form_submissions.created_at` → the customer already existed: **matched**;
- otherwise → `enrich` created them from this chat: **new**, no line.

This needs NO change to `enrich`, `fileLead` or the schema, and it gives the same answer on every
retry. (A contact created by another path in the milliseconds between the submission insert and
the dedupe would read as "new"; G19.) The sync writes the answer into every copied row's
`meta.webchat.matched_existing` (boolean), together with `meta.webchat.submission_id`, so the
thread and the record (§7) read it from the rows themselves with no extra query.

**Rendering.** ONE line per chat, not per bubble: above the chat's first row on the thread (the
row whose `meta.webchat.index` is the lowest of that `chat_id` on the thread), only when
`matched_existing` is true:

> Matched by the phone or email they typed; not confirmed.

Muted text (`text-muted-foreground`, `text-xs`), in the staff member's language
(`lang={locale}`), with `data-webchat-unconfirmed` for tests; the same shape as the forward line
(`message-thread.tsx:164-171`). It is a fact about the match, not a status, so no dot. A customer
created from the chat shows no line. The record's chat row carries the same line (§7, G18).

### 6. The composer that follows the last reply

**The inbox composer becomes Text | Email** (G9): the existing `MessageComposer` with two new
props, `modes` (which tabs, here `["sms", "email"]`; the record page keeps its default three) and
`initialMode` (the server's answer below). Its tabs, gates, stopped lines, segment counter and
actions are the ones it has today; the inbox passes `sendSmsAction` and `sendEmailAction` from
its own `actions.ts`. The record page's composer is unchanged: it still starts on Note.

**Not sticky**: switching tabs changes only this message. After a successful send the mode
returns to the server's `initialMode` (and on the next page load it is recomputed anyway).

**Two pure functions**, in `conversations/start-channel.ts`, called only on the server
(`page.tsx`) and passed to the client as data:

```
type LastReply = "sms" | "email" | "other" | null;
type Readiness = "ready" | "stopped" | "unavailable";

lastCustomerReply(messages: ThreadMessage[]): LastReply
startChannel(input: { lastReply: LastReply; text: Readiness; email: Readiness }): "sms" | "email"
```

`lastCustomerReply` takes the thread's rows (already loaded by the page, now with the author
pair) and answers for the newest row that is the customer reaching the business (G11):
- `direction = 'inbound'` and `channel = 'sms'` and `author_kind = 'customer'` → `"sms"`;
- `direction = 'inbound'` and `channel = 'email'` and `author_kind = 'customer'` → `"email"`
  (a teammate's forward, `author_kind = 'person'`, part 2, is not the customer and is skipped);
- `direction = 'inbound'` and `channel` in (`webchat`, `form`, `voice`) → `"other"` (a call's
  inbox copy is written by the receptionist with author `ai`, `finish-call.ts:106`, `426`, and still
  counts: decision 2 names a call);
- no such row → `null`.

`Readiness` is computed on the server from reads the record page already makes, made here too
for the open thread (`getContact` on the request client, then on the ledger client
`smsRecipientState` and `emailRecipientState`, plus `softSmsGate`, `lib/record/loaders.ts:166`):
- **Text** `ready` when `canTextFrom({ phone, smsGate, smsBlockedLine })`
  (`header-actions.ts:25-27`); `stopped` when `smsRecipientState` is `stopped`
  (`recipient-state.ts:29`); otherwise `unavailable` (no phone, A2P not approved, no number,
  held, number to confirm, or a read that failed).
- **Email** `ready` when the contact has an email and `emailRecipientState` is `ok`; `stopped`
  when it is `stopped` (an unsubscribe, a staff stop, a bounce or a complaint,
  `recipient-state.ts:57-68`); otherwise `unavailable` (no email, or `unknown`).

`startChannel`:
1. preferred = `"sms"` for `lastReply = "sms"`; `"email"` for `"email"`; for `"other"` and
   `null`, `"sms"` when Text is `ready`, else `"email"`.
2. preferred `ready` → preferred. Else the other one `ready` → the other.
3. Neither ready (G10): the one that is NOT stopped, so the composer never opens on a channel
   the customer stopped; both stopped (or both merely unavailable) → preferred, whose line is
   today's notice (`smsFormBlock`, `message-composer.tsx:30-37`; `composerEmailNotice`,
   `composer-state.ts:85-97`).

It never returns `webchat`: nothing sends a webchat row (decision 5).

### 7. The record page: one row per chat (RULED 2026-10-17, G12 changed)

The record timeline gets ONE row per chat; individual turns are never timeline rows, and the
messages source keeps its `email`/`sms` filter (`record.ts:375`).

**Where it is computed.** A ninth timeline source, `chats`, in `listTimelinePage`
(`record.ts:336-411`; `TimelineSource` and `TIMELINE_SOURCES` at `record.ts:265-266` gain
`"chats"`), on the caller's client so RLS and 0068's Technician fence decide, for one contact or a
household's set through `forContacts` exactly as the messages source does:

1. The anchor read: this account's `webchat` messages on the contact(s)' conversations whose
   `meta->webchat->>index = '0'`, paged by `withTimelinePage` on `created_at` (the source rule:
   `limit + 1` past the cursor). Index 0 is always the first row a sync inserts (§3 step 5, index
   order), so every copied chat has one.
2. The count read, only for the chat ids on this page: `select meta->webchat->>chat_id` of the
   same conversations' webchat rows with that `chat_id` in the page's set; counted in JS (at most
   48 rows a chat, `CONCIERGE_MAX_TURNS` 24 × 2).

A new entry kind, `{ kind: "chat"; id: <anchor message id>; at: <anchor created_at>; contactId;
chat: { conversationId, count, matchedExisting } }`. Its `at` is the chat's START, so later turns
never move the row and the cursor stays total. The drawer's five newest rows
(`lib/record/recent-rows.ts:56`) and the group page read the same page, so they follow with no
code of their own.

**N** is the number of the chat's rows on the thread, both sides (visitor and Sofía): what staff
will see when they open it.

**The row** reads (persona from the timeline loader's existing `personaName`,
`lib/record/loaders.ts:65-81`):

> Customer · Chatted with Sofía on your website · 12 messages

and the whole row opens `/dashboard/accounts/<accountId>/conversations?c=<conversationId>`.
When `matchedExisting`, it carries the §5a line beneath it.

**The author mark is the customer** (G20): the chat is the customer's act of reaching the
business, and "Chatted with Sofía" already names Sofía in the words; a "Sofía · AI" mark would
read "Sofía · AI · Chatted with Sofía". `authorOf` (`author-mark.ts:25-70`) gains
`case "chat": return { kind: "customer", personId: null }`, inside the closed five.

**The existing "took a request in the website chat" row stays alongside** (G21): it is a
different event (the lead Sofía filed, `lead.ts:151-156`, mark "Sofía · AI", `timeline.chat`,
`lib/messages.ts:4515`), and it carries the captured answers (name, phone, need) the chat row does
not. The two read, newest first: the request at filing time, the chat row at the chat's start.

**"Last talked" counts the chat.** `newestConversationMessage` and `newestSetMessage`
(`record.ts:58-61`, `119-122`) add `webchat` to their channel filter; `LastTalkedChannel`
(`record.ts:33`) gains `"chat"`, mapped from `webchat`; the fact reads "Last talked 2 hours ago
(website chat)". Any turn counts, Sofía's included: both are the customer's conversation with the
business.

## Every reader of `messages`, and what web chat rows do to it

| Reader | File:line | Filter | Effect of webchat rows |
|---|---|---|---|
| Inbox list + preview | `messaging.ts:623-736` | none | Thread listed; preview may be Sofía's last line |
| Thread | `messaging.ts:833-842` | none | Rendered per §5 (gains the author pair) |
| ⌘K search | `messaging.ts:863-876` | body | Chat words are found |
| Quote follow-up "heard back" | `automations.ts:1939-1973`, used by `passes/quote-followup.ts:295` | `direction = inbound`, any channel | A visitor turn suppresses a pending follow-up, as decision 5 wants |
| Reactivation pre-filter + exact check | `automations.ts:1599-1604`, `1754-1769` | any direction, any channel | Any chat row keeps the customer out of "it's been a while" |
| Missed-call text-back release | `voice.ts:1020-1036` | `sms`, inbound | No effect: a chat does not cancel a held text-back (G17) |
| Failed-text badge / resend | `messaging.ts:459`, `549` | `sms`, outbound | No effect |
| Text-back cooldown | `messaging.ts:332-341` | `sms`, outbound | No effect |
| Delivery webhooks | `messaging.ts:242-246` | provider id + outbound | A `webchat:` key never matches a Resend or Telnyx id |
| Inbound-email dedupe | `messaging.ts:289-305` | provider id | No overlap (Resend ids only) |
| Booking notice discard | `booking.ts:566-568` | `email`, outbound, queued | No effect |
| Record "Last talked" | `record.ts:53-66`, `115-125` | `email`, `sms`, plus `webchat` (§7) | The chat counts: "(website chat)" |
| Record timeline | `record.ts:375` | `email`, `sms` (unchanged) | Turns are not rows; the new `chats` source adds ONE row per chat (§7); the drawer's recent rows and the group page follow |
| Empty-thread delete | 0083:95-108 | existence | A chat row keeps the thread (as any message) |
| Message visibility proof | `lib/auth/visible.ts:41` | id | Unchanged |
| Technician restriction | 0068 (through the conversation) | | Webchat rows inherit it |
| Billing | `route.ts:688-700` (`ai_chats` per chat), `smsBillable` in the SMS gate | | Unchanged: rows bill nothing |
| Weekly report | `packages/db/src/weekly-report.ts` | does not read `messages` (grep) | No effect |
| Dashboard Activity card | `activity-card.tsx:50-55`, raw window 50 (`dashboard/page.tsx:45`) | skips `message.*` | Per-row events would crowd the window: one event per batch instead (G6) |

No sender or pass selects outbound rows by channel generically (grep of `"queued"` and of every
`from("messages")` in `apps/web/src` and `packages/db/src`), so no path can try to send a
webchat row.

## Data model

**No migration.** The CHECK already allows `webchat` (0006:91-92); the idempotency key uses the
existing unique index (0005:51-52, G1); both author kinds are legal with a null `author_id`
(0073:54-57); `created_at` takes an explicit value (no trigger).

TypeScript, all additive:
- `NewMessage["channel"]` gains `"webchat"` (`messaging.ts:20`); `MESSAGE_CHANNEL_LABEL` must then
  carry it (`labels.ts:46`, a compile error otherwise).
- `fileWebchatTurns(db, accountId, conversationId, rows, { raiseUnread }) →
  { inserted, visitorInserted }` in `packages/db/src/messaging.ts`, exported through the barrel.
- `listMessages` selects `author_kind, author_id`.
- The thread resolver (§1, submission → contact → conversation) as one `@bis/db` function.
- The route stamps the visitor line's `at` with the request's arrival (G4).
- `meta.webchat` carries `submission_id` and `matched_existing` (§5a); jsonb, so no migration.
- `record.ts`: `TimelineSource` gains `"chats"`, `TimelineEntry` gains `kind: "chat"`,
  `LastTalkedChannel` gains `"chat"`, both newest-message reads add `webchat` (§7);
  `author-mark.ts`'s `authorOf` gains the `chat` case (customer).

## Copy (English, and Spanish usted)

| Key | English | Spanish |
|---|---|---|
| `conversations.channel.webchat` | Web chat | Chat web |
| `conversations.channel.email.es` (G8) | | Correo |
| `conversations.channel.sms.es` (G8) | | Texto |
| `conversations.channel.form.es` (G8) | | Formulario |
| `conversations.channel.voice.es` (G8) | | Llamada |
| `conversations.compose.via` (the tab group's label) | Reply by | Responder por |
| `conversations.webchat.unconfirmed` (§5a, ruling 1) | Matched by the phone or email they typed; not confirmed. | Lo relacionamos por el teléfono o el correo que escribió; no está confirmado. |
| `timeline.webchat` (§7, ruling 2) | Chatted with {name} on your website · {count} messages | Conversó con {name} en su sitio web · {count} mensajes |
| `timeline.webchat.one` | Chatted with {name} on your website · 1 message | Conversó con {name} en su sitio web · 1 mensaje |
| `record.facts.channel.chat` (§7) | website chat | chat del sitio web |
| reused: `provenance.customer` | Customer | Cliente |
| reused: `provenance.ai` | {name} · AI | {name} · IA |
| reused: `compose.sms`, `compose.email`, every stopped / held / unknown line | as today | as today |

No visitor-facing copy changes: the widget's strings (`lib/concierge/strings.ts`) are untouched.
No milestone codes, no `{{…}}`, no vendor words (the 7 AM read).

## Failure behaviour

| Case | What happens |
|---|---|
| Chat never becomes a lead | Nothing in the inbox (decision 1) |
| Lead filing fails | As today (`lead.ts:183-188`); no lead, no sync |
| Transcript append fails (`route.ts:657-661`) | That pair is in neither place; the visitor still gets the answer |
| Sync: chat read, contact read, conversation read or keys read fails | Logged `{accountId}` only; nothing written; the next turn retries |
| Lead's customer gone (`contact_id` or `submission_id` null) | Dropped quietly, logged `{accountId, "no customer"}`; never filed elsewhere |
| Insert `23505` | That turn is already on the thread; skipped, not counted |
| Any other insert error | Batch stops at that row (order kept); logged; next turn retries the rest |
| Touch or event fails | Logged; rows stand (the `messaging.ts:172-186` posture) |
| Unread raise fails | Logged; the count is one short (the row exists, so no later sync re-raises it) |
| Sync cut off by the platform | Next turn heals; on the chat's last turn the pair stays only in the transcript |
| Any sync throw | Caught inside `after()`; the visitor's response was already sent and is identical |

Logs never carry transcript text, names, numbers or the contact id (decision 5: "account id
only").

## Tests

- **Unit, pure**: the planner (missing indices only; index order; a duplicated retried pair is two
  indices; strictly increasing times with equal `at`; an empty transcript); the unread rule
  (filing turn none, later turn per visitor row, Sofía never); `lastCustomerReply` (sms, email,
  a forward skipped, webchat/form/voice, a call's `ai` row, none); `startChannel` over the whole
  matrix (4 × 3 × 3 = 36 cases), each asserted by name.
- **Route** (`route.test.ts`): sync scheduled when filed this turn, when filed earlier, when
  another tab filed it; NOT scheduled with no lead or on any refusal; a sync that throws leaves
  the response body byte-identical; the visitor line's `at` is the arrival time.
- **db, replica**: `fileWebchatTurns` writes `author_kind` `customer`/`ai` with null
  `author_id`, the `webchat` channel passes the CHECK, `created_at` is kept, a second call with
  the same rows inserts nothing (23505 path), the touch only for a visitor row, unread by
  `visitorInserted` only when asked; `listMessages` returns the author pair; the resolver drops
  for a null `contact_id`; a Technician reads the rows only on their own customer.
- **UI**: the webchat bubble (both marks, persona fallback, `lang` from the chat's locale, the
  footer in the staff locale, no status word) in English and Spanish; the inbox composer opens on
  `initialMode`, switches with one tap, returns to it after a send; `messageChannelLabel` for all
  five channels in both languages; the pseudo-locale overflow on the new footer.
- **Unconfirmed match (ruling 1)**: the derivation (contact older than the submission → matched;
  created by it → new; equal times read as new); the line renders once per chat, above its first
  row, only when matched, in both languages; never for a new customer.
- **Record (ruling 2)**: the `chats` source returns one entry per chat (a 6-turn chat is ONE row,
  never six), N counts both sides, `at` is the chat's start and stays put after a later turn,
  paging across a page boundary neither repeats nor skips a chat, a household page merges members'
  chats, a Technician sees only their own customers' chats, a failed read names `chats` in
  `failed`; the row's mark is Customer, it links to the thread, it carries the unconfirmed line;
  the "took a request" row still shows beside it; "Last talked" reads "(website chat)" when the
  chat is newest; the drawer's recent rows show the chat row. Both languages, singular and plural.
- **e2e** (one, per-run fixture account, G15): seed a lead chat (a `concierge_conversations` row
  with a four-turn transcript and a submission linked to a fixture contact with its thread), post
  one turn through the real route with `page.request` and the chat's id, open the inbox and see
  the turns, both marks and Web chat. Skips itself without `OPENAI_API_KEY`, as
  `concierge.spec.ts:318-324` does.

## Gaps for the owner (proposals)

| # | Gap | Proposal |
|---|---|---|
| G1 | How turn idempotency is stored | `provider_message_id = 'webchat:<chat id>:<index>'` on the existing global partial unique index (0005:51-52), insert and treat `23505` as "already there" (the `document-requirements.ts:87` pattern; ASSUMPTION: a PostgREST upsert cannot target a partial index, so plain insert). No migration. The alternative, `meta` plus a new unique index, costs migration 0084 for nothing. **RULED 2026-10-17: accepted as proposed.** |
| G2 | What "turn index" means | The array position in `transcript`. Stable, because the transcript is append-only (0044:28-34). A retried visitor POST already stores its exchange twice (`route.ts:30-34`); those are two indices and appear twice on the thread, mirroring the transcript. A retried SYNC never duplicates. **RULED 2026-10-17: accepted as proposed.** |
| G3 | Where the copy runs | In the turn route, after the transcript append, in `after()`. Not in `fileLead`: `enrich` returns `void` (`enrich.ts:48`), so neither knows the thread, and the filing turn's own pair is appended only after `fileLead` returns (`route.ts:653`). One sync covers the copy, later turns and retries. The lead alert (`enrich.ts:197-203`) goes out about a second before the turns land; it links to the record page (`enrich.ts:423-425`), where the chat row (§7) appears once the copy has landed. **RULED 2026-10-17: accepted as proposed.** |
| G4 | The filing turn's order | Today both lines share one `now` taken after the model (`route.ts:642`). Stamp the visitor line with the request's arrival (`startedAt`, `route.ts:155`): then the visitor's details read BEFORE the lead entry and Sofía's thank-you AFTER it, which is what happened. The approved "chat turns, then the lead" holds for every turn except that one reply; moving it above the lead would misstate the time. **RULED 2026-10-17: accepted as proposed.** |
| G5 | Equal times | Both lines of an exchange carry the same `at` (`route.ts:654-655`) and `listMessages` orders by `created_at` only (`messaging.ts:840`), so Sofía could render above the question. The planner writes `created_at` strictly increasing in index order (+1 ms on a tie). **RULED 2026-10-17: accepted as proposed.** |
| G6 | One event per row | A full 24-turn chat (`CONCIERGE_MAX_TURNS`, `lib/concierge/guards.ts:14`) copied at filing is 48 rows; one `message.created` each (`messaging.ts:168`) would fill the Activity card's 50-event raw window (`dashboard/page.tsx:45`) and push real bookings out. `fileWebchatTurns` emits ONE `webchat.filed` `{conversationId, chatId, count}` per batch (actor `system`) and one touch, instead of going through `createMessage` per row. Nothing reads `message.created` (grep). **RULED 2026-10-17: accepted as proposed.** |
| G7 | The unread rule | As §4: only when the lead was on file at the turn's start; +1 per inserted visitor row; Sofía's rows never touch `last_message_at`. **RULED 2026-10-17: accepted as proposed.** |
| G8 | Channel labels are English only (`labels.ts:46-51`) | `messageChannelLabel` takes the locale (default `en`); all five labels get `.es`. A web chat bubble would otherwise be the one Spanish thread with an English channel word. **RULED 2026-10-17: accepted as proposed.** |
| G9 | The inbox has no Text composer (`email-composer.tsx:11-14`) | The inbox gets `MessageComposer` with `modes = ["sms", "email"]` and `initialMode`; no Note (the inbox has none today). `EmailComposer` retires. The record page's composer is unchanged and still starts on Note. **RULED 2026-10-17: as proposed.** |
| G10 | Neither channel ready | Open on the one the customer has NOT stopped (its line says what is missing); both stopped, or both merely unavailable → the preferred one, showing today's notice. **RULED 2026-10-17: accepted as proposed.** |
| G11 | What counts as "their last reply" | As §6: a teammate's forward does not count; a call's inbox copy does even though its author is `ai`. **RULED 2026-10-17: accepted as proposed.** |
| G12 | The record page | Proposed: web chat off the record timeline and off "Last talked". **RULED 2026-10-17: CHANGED.** One row per chat ("Chatted with Sofía on your website · N messages") that opens the thread; individual turns are not timeline rows; the chat counts for "Last talked". Settled in §7, with G20-G22. |
| G13 | Leads filed before this ships | No backfill. If such a chat gets a new turn after release, its sync copies the whole chat then. **RULED 2026-10-17: accepted as proposed.** |
| G14 | Retention | None added. `concierge_conversations` keeps every chat forever today, including chats that never became leads; the copy makes a lead's chat part of the permanent thread, like texts and emails. A retention rule for unconverted chats is a later privacy item. **RULED 2026-10-17: accepted as proposed.** |
| G15 | The one e2e | "A chat becomes a lead" depends on the model choosing `capture_lead`, which no test can force. Seed the lead chat, post one REAL turn (skips without the key), and assert the inbox. The copy and the planner are proven deterministically by the unit and replica tests. **RULED 2026-10-17: accepted as proposed.** |
| G16 | "New lead from your website" | No new copy: the lead entry stays exactly as `enrich` writes it (`enrich.ts:179-182`): subject = the form's name, "Form submission". **RULED 2026-10-17: accepted as proposed.** |
| G17 | A chat after a missed call | A visitor turn does not cancel a held 08:00 text-back (`voice.ts:1029-1032` reads inbound texts only). Unchanged in this part. **RULED 2026-10-17: accepted as proposed.** |
| G18 | The unconfirmed line on the record (new, from ruling 1) | The ruling names the thread; the record is where a wrong match does its harm, so the chat row (§7) carries the same "Matched by the phone or email they typed; not confirmed." line beneath it. Same key, same `matched_existing` fact. OPEN. |
| G19 | How "matched existing" is known (new, from ruling 1) | Derived, not returned by `enrich`: `contacts.created_at < form_submissions.created_at` means the customer existed before this chat's lead (the submission is written first, `lead.ts:151`, then `enrich`, `lead.ts:170`). Stored in every copied row's `meta.webchat.matched_existing`. No change to `enrich`, `fileLead` or the schema. The alternative (enrich returns `{ contactId, conversationId, matchedExisting }`) only reaches the filing turn; carrying it to later turns would need a column, so a migration. Known edge: a contact created by another path in the milliseconds between the submission insert and the dedupe reads as new (no line). OPEN. |
| G20 | The chat row's author mark (new, from ruling 2) | The customer (`provenance.customer`): the chat is the customer reaching the business, and the words already name Sofía ("Sofía · AI · Chatted with Sofía" would repeat her). Inside the closed five. OPEN. |
| G21 | The "took a request in the website chat" row (new, from ruling 2) | Stays alongside: it is Sofía's filing of the lead (mark "Sofía · AI") and carries the captured answers; the chat row is the customer's conversation. Two rows, two events. OPEN. |
| G22 | Where the chat row sits in time, and N (new, from ruling 2) | At the chat's START (its index-0 row's `created_at`), so later turns never move it and the timeline cursor stays total; "Last talked" carries the chat's newest turn. N counts the chat's rows on the thread, visitor and Sofía both (what opening it shows), with a singular form for 1. OPEN. |

## Out of scope

Live staff takeover (F-036 future); chats that never become a lead; the "transcript view" and the
"offline panel" that `docs/crm-features.md:1284` lists for F-036 part 1 (not in the approved
design); booking from the chat; sending anything over web chat; a backfill; retention; individual
turns as record timeline rows (the chat is one row, §7); any change to the widget or its strings.

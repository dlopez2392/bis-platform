# Inbound email: customers' replies come back (S-06 part 1)

Status: approved in brainstorming 2026-10-16 (danlo, tiles). First-release item 7
(`docs/crm-features.md` §4.3 row 7, S-06), split into three parts:

1. **Replies come back** (this spec): a reply address per customer thread on a BIS
   subdomain or the client's own `reply.` subdomain, sender checks, a "Needs a look"
   queue, the owner's forwarded copy, and an emailed stop that is heard.
2. Forward-to-record addresses (the same token, shown on the record) and the never-log list.
3. Web-chat threads in the inbox, the transcript view, the offline panel, and a composer
   that follows the thread's channel (F-036 part 1, F-068 part 1).

Source text: `docs/research/2026-09-25-crm-feature-research.md` §6.2 step 1;
`docs/crm-features.md` "Where email stops", Surface 5 (the inbox).

## What exists today

- The Resend webhook (`apps/web/src/app/api/webhooks/resend/route.ts`) handles delivery
  events only; unmapped events return 200 "ignored". Nothing receives mail.
- Every customer email passes `apps/web/src/lib/consent/email-gate.ts`
  (`sendEmail`, `emailSenderFor`); the Reply-To is `accounts.reply_to_email` (0014).
- `conversations` is one row per contact (unique `account_id, contact_id`); `messages`
  already allows `direction='inbound'`, `channel='email'`, with a global unique
  `provider_message_id` and `author_kind` (0073/0074). Writes are server-only (0053).
- The Telnyx inbound route (`apps/web/src/app/api/sms/inbound/route.ts`) is the template:
  verify, find the tenant, dedupe, write, raise unread, classify consent, 503 to retry.
- An emailed "stop" is not read at all (consent spec decision 6: staff press Stop emails).

## External facts and assumptions

- **Fact (Resend docs, read 2026-10-16):** a verified domain with Resend's MX record
  receives mail for *any* local part and fires `email.received`; the full message
  (text, HTML, headers, attachment metadata) is fetched from the Receiving API. Every
  account also has a Resend-managed `<id>.resend.app` receiving subdomain.
- **Fact (spike, 2026-10-16):** `reply.bis-rgv.com` is live (MX
  `inbound-smtp.us-east-1.amazonaws.com` priority 10, DNS on Vercel). A Gmail test message
  arrived carrying, stamped by Resend's receiving MTA:
  `Authentication-Results: amazonses.com; spf=pass …; dkim=pass header.i=@gmail.com;
  dmarc=pass header.from=gmail.com;` plus `Received-SPF`, `X-SES-Spam-Verdict: PASS` and
  `X-SES-Virus-Verdict: PASS`. The raw message is downloadable; the Received emails API
  also returns headers (Resend docs).
- **Rule from the spike:** read ONLY the topmost `Authentication-Results` header whose
  authserv-id is `amazonses.com`. Any other `Authentication-Results` (a sender can write
  one into its own message) is ignored. `X-SES-Spam-Verdict` or `X-SES-Virus-Verdict`
  other than `PASS` holds the message with reason `unverified`.
- **Settled:** `email.received` is added to the EXISTING Resend webhook, so it arrives at
  the same endpoint with the same svix secret (`RESEND_WEBHOOK_SECRET`). The webhook
  payload is metadata only (`email_id`, `from`, `to`, `subject`, attachment metadata);
  the body and headers are fetched by id.

## Decisions (danlo, 2026-10-16)

| # | Decision |
|---|---|
| 1 | Email first, then forward-to-record, then web chat (three parts). |
| 2 | Both reply domains in part 1: a BIS subdomain for every account, and `reply.<client-domain>` once its MX record checks out (manual DNS step, like the sending domain). |
| 3 | Held mail waits in the inbox's "Needs a look" filter; the work queue carries one row linking there. |
| 4 | A clear emailed stop is applied at once (method `inbound_email`), shown on the thread with Undo; an unclear one only gets a chip. |
| 5 | One opaque token per customer thread is the reply address's local part. |
| 6 | The owner's forwarded copy comes from the same sender as lead alerts (operator class). |

## Design

### Turning it on

Per account, agency only. The Settings "Sending address" card gains a **Replies** row,
dot and word, three states:

- **Off** (default): nothing changes; Reply-To stays `reply_to_email`. Every account
  starts here, so no live client's mail changes until staff turn it on.
- **BIS address**: replies go to `r-<token>@reply.bis-rgv.com`.
- **Own domain**: replies go to `r-<token>@<inbound_domain>` (`reply.<client-domain>`).
  Selectable only after **Check DNS** finds an MX record on `inbound_domain` pointing at
  Resend's inbound host; staff add the domain in the Resend dashboard by hand (no
  Domains API in this part).

An Owner sees the address their customers reply to, read-only.

### Outbound

When the account's mode is not `off`, every customer-facing email (composer, reminders,
confirmations, any kind sent to a contact through the gate) carries
`Reply-To: r-<token>@<domain>`, where `<token>` is that contact's
`conversations.reply_token`, created lazily on first need (the conversation itself is
ensured if it does not exist). The one change point is the gate's sender resolution
(`emailSenderFor` / `sendEmail`). Operator mail (lead alerts, reports to the agency) is
untouched. `accounts.reply_to_email` stops being the Reply-To for those accounts and
becomes the forwarding destination.

### Inbound

A new `email.received` branch in the Resend webhook:

1. Verify svix; bad signature → 401.
2. Fetch the full message from Resend; fetch failure → 503 (Resend retries). Dedupe on
   Resend's received-email id: an existing `inbound_emails` row → 200.
3. Parse the recipient: local part `r-<token>`, domain must be `reply.bis-rgv.com` or the
   `inbound_domain` of the token's account. Unknown token, revoked token, or a domain that
   does not belong to the token's account → 200, dropped, one log line, nothing stored.
4. **Sender check.** Filed only when BOTH hold:
   - the sender's `email_key` matches the thread's contact or a member of any household or
     business group that contact belongs to (`client_group_members`);
   - the message passes authentication, read from the `amazonses.com`
     `Authentication-Results` header only: `dmarc=pass`, or (`dmarc=none`, the From
     domain publishes no policy) `spf=pass` and `dkim=pass` with `header.i`/`header.d`
     on the From domain; and both SES verdicts are `PASS`.
   Otherwise held, with a reason: `not_on_record` (authenticated, but the sender is not
   the contact or a group member), `unverified` (authentication failed or missing).
5. **Filed:** a `messages` row on the thread — `channel='email'`, `direction='inbound'`,
   `status='delivered'`, `author_kind='customer'`, `provider_message_id` = Resend's id,
   `subject`, `body` = the new text with quoted history stripped (English and Spanish
   quote markers: "On … wrote:", "El … escribió:", `>` lines, Outlook's "From:" block),
   `meta.inbound_email_id`, `meta.attachment_count`. Unread is raised. When the sender is
   a group member other than the contact, the bubble names them ("from Luis Ruiz").
6. **Held:** only the `inbound_emails` row; nothing on the thread.
7. Filed mail runs the stop rule (below).
8. Filed mail is forwarded to `accounts.reply_to_email` when set: from the lead-alert
   sender, display name "<customer name> via <business name>", `Reply-To` the customer's
   address, subject unchanged, body the new text plus an "Answer in BIS" link to the
   thread. Operator class, so a customer's suppression never blocks it. A failed forward
   is logged; the filed message stands. Held mail is not forwarded.
9. `stampHeartbeat("email.inbound")`.

Attachments are not stored in this part: the bubble says "2 attachments — not saved yet"
(landing them in the vault is a later part).

### The stop rule

Filed mail only (held mail's sender is not confirmed). The new text (never the quoted
history) runs through the texts' English/Spanish matcher (`lib/consent/phrases.ts`).

- **Clear stop:** append "No marketing emails" for the sender's address to the ledger,
  method `inbound_email`, evidence = the message id and the matched phrase. The thread
  shows "Stopped marketing emails · from their reply" with **Undo**. Undo appends a
  reversing staff event (the ledger stays append-only). A ledger write failure → 503 so
  Resend retries, the same rule as SMS.
- **Unclear:** a ghost chip "May want to stop" with the existing **Stop emails** action.
- Per the 2026-09-30 decision, an email stop covers referral asks.

### Needs a look

The inbox list gains a filter **Needs a look · N** (count of `held` rows). Each held item:
sender, subject, received time, and the reason in words —
"Not on this customer's record" / "Couldn't confirm who sent it" — plus the token's
customer as the suggestion. Actions, one primary per item:

- **File on <customer>** (primary): files it exactly as step 5 (unread not raised; the
  stop rule runs; no forward), toast with Undo (Undo deletes the filed message and returns
  the row to `held`).
- **Choose a record** (ghost): contact search, then file there.
- **Not a customer** (ghost): status `dismissed`, toast with Undo.

Empty: "Emails we couldn't match to a customer wait here for you to file." Error and
loading states per DESIGN.md rules 5 and 7. The work queue shows one row,
"N emails need a look", linking to the filter, only when N > 0. All copy in English and
Spanish.

## Data model (migration 0082)

- `conversations.reply_token text unique` (12 random bytes, url-safe, lowercase so it
  survives mail clients that lowercase local parts), `reply_token_revoked_at timestamptz`.
- `accounts.inbound_mode text not null default 'off'` check in (`off`, `bis`,
  `own_domain`); `accounts.inbound_domain text` (lowercase, required when `own_domain`).
  Agency-only writes, like `from_email`.
- `inbound_emails`: `id`, `account_id`, `conversation_id`, `provider_email_id` (unique),
  `from_email`, `from_name`, `to_email`, `subject`, `text`, `auth` jsonb
  (`spf`, `dkim`, `dmarc`), `status` (`filed`, `held`, `dismissed`), `hold_reason`,
  `message_id` (the filed message, nullable), `decided_by`, `decided_at`, `received_at`.
  Members of the account read; only the server writes (0053 rule); the Technician
  restriction (0068) applies as it does to messages.
- `consent_events.method` check gains `inbound_email`.

## Failure behaviour

| Case | Response |
|---|---|
| Bad svix signature | 401 |
| Resend fetch fails | 503 (retry) |
| Duplicate delivery | 200, no second row |
| Unknown or revoked token, foreign domain | 200, dropped, logged |
| Stop detected, ledger write fails | 503 (retry) |
| Forward to owner fails | logged, filed message stands |

## Tests

- Unit: token parse; sender check (contact, household member, business member, stranger,
  DKIM fail, DMARC missing with SPF+DKIM aligned, headers absent); quote stripping in
  English and Spanish; the stop classifier on a reply's new text only.
- Route: filed, held (both reasons), duplicate, revoked token, foreign domain, fetch 503,
  ledger 503, forward failure.
- db/RLS: the new table's read/write rules, agency-only account columns, the method check.
- e2e on the per-run fixture account: a held email is filed from Needs a look, then undone.

## Owner actions (danlo)

Step by step: `docs/runbooks/inbound-email.md`. In short:

1. DONE 2026-10-16: `reply.bis-rgv.com` verified in Resend (Vercel auto-configure),
   receiving on, MX live, a test message received.
2. Resend: add the `email.received` event to the EXISTING webhook on production's
   `/api/webhooks/resend` (same signing secret; this settles the svix assumption above).
3. Per client with its own domain: the MX record on `reply.<domain>`.

Inbound reaches production only; Preview and CI prove the path with route tests.

## Out of scope

Forward-to-record addresses and the never-log list (part 2); web chat in the inbox and
the channel-following composer (part 3); attachments into the vault; capturing an
owner's own Gmail or Outlook mail (inbox sync, later); threading headers
(`In-Reply-To`) on outbound mail.

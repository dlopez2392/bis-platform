# Inbound email: setup runbook

How customers' email replies reach BIS (S-06 part 1, spec
`docs/superpowers/specs/2026-10-16-inbound-email-design.md`). Nothing here changes any
client's mail by itself: a client's Reply-To changes only when an account's **Replies**
switch is turned on in Settings.

Resend facts below were read from Resend's docs on 2026-10-16
(`resend.com/docs/dashboard/receiving/*`). Dashboard labels may drift; the record
values are always whatever Resend shows you.

## 1. Add the BIS reply subdomain in Resend (once)

1. resend.com → **Domains** → **Add Domain** → `reply.bis-rgv.com`, same region as
   `bis-rgv.com`.
2. On the domain's page, **Receiving** section → switch **Enable Receiving** on.
3. Resend lists the DNS records: one **MX** for receiving plus the domain's DKIM/SPF
   records. Keep the page open.

## 2. Add the records at bis-rgv.com's DNS provider

- Add every record exactly as Resend shows it (Name/Host, Value, Priority). The MX host
  is normally `reply` — the provider appends `.bis-rgv.com`.
- On Cloudflare: **DNS only** (grey cloud), never Proxied.
- Do not change the existing MX records on `bis-rgv.com` itself. A subdomain is used so
  the normal mailbox is untouched; Resend only receives when its MX is the lowest
  priority value *for that name*.

## 3. Verify

Resend → **I've added the record** / **Verify**, then wait for **Verified** (minutes, up
to a couple of hours).

## 4. Smoke test the receiving side

Send any email from a personal mailbox to `test@reply.bis-rgv.com` and confirm it shows
in Resend → **Emails** → **Receiving**. Any local part at the domain is received.

Before DNS is verified the same test works against Resend's managed address: **Emails** →
**Receiving** → **⋯** → **Receiving address** (`<id>.resend.app`).

## 5. Connect the webhook (only after the S-06 part 1 code is on production)

Resend → **Webhooks** → **edit the existing webhook** pointing at production's
`/api/webhooks/resend` → tick **`email.received`** → save.

Edit, do not add: a new webhook gets a new signing secret, and production verifies every
event against `RESEND_WEBHOOK_SECRET`. The webhook carries only metadata; the app fetches
the body and headers from Resend's Received emails API.

**The production key must be Full access.** That fetch uses production's `RESEND_API_KEY`,
and a Resend key with **Sending access** can send mail but cannot read received mail. With
a Sending access key every reply fails: the webhook answers `503 fetch_failed`, Resend keeps
retrying, and nothing reaches BIS. Check it in Resend → **API keys** → the key's
**Permission** column. To fix it (found and fixed in production on 2026-10-17):

1. Resend → **API keys** → **Create API key**, permission **Full access**, all domains.
   Copy the `re_…` value (shown once).
2. Vercel → bis-platform → **Settings** → **Environment Variables** → `RESEND_API_KEY`
   (Production) → **⋯** → **Edit** → paste → **Save**.
3. Vercel → **Deployments** → the current Production deployment → **⋯** → **Redeploy**.
4. Resend → **Webhooks** → the webhook → the failed `email.received` event → **Replay**.
   It should now answer `200 filed` (or `held`).
5. Delete the old Sending access key in Resend once the replay succeeds.

How to tell this failure apart from others: in Resend → **Webhooks** → the event, every
attempt shows `HTTP 503` with the response body `fetch_failed`, and production's logs say
"the received email could not be fetched".

## 6. Turn replies on, one account at a time

Account → Settings → Sending address → **Replies** → **BIS address**. Start with BIS's
own account; send it an email from the composer, reply from a personal mailbox, and check
the reply lands on the thread (or in **Needs a look** if the address is not on the record).

From then on that account's customer emails carry
`Reply-To: r-<token>@reply.bis-rgv.com`, and each filed reply is forwarded to the
account's reply-to address from the lead-alert sender.

## 7. A client's own domain (per client, when asked)

1. Add `reply.<client-domain>` in Resend (step 1) and enable receiving.
2. The client, or whoever runs their DNS, adds the records Resend shows (step 2).
3. Once Resend shows **Verified**, Settings → Replies → **Own domain** → enter
   `reply.<client-domain>` → **Check DNS** → select it.

## Turning it off

Settings → Replies → **Off** restores the old Reply-To at once. Replies already sent to a
`r-<token>` address still arrive and are filed while the webhook is connected. To stop a
single leaked address, set that conversation's `reply_token_revoked_at` (there is no
button for it in part 1); mail to the old address is then dropped.

## Forwarding to a record, and Never record (S-06 part 2)

**The forwarding address is the customer's reply address.** Each customer's record shows it
as **Forwarding address** (with Replies on); it is the same `r-<token>@…` address their
emails carry as Reply-To. A teammate who forwards an email there saves it on that customer:
the whole text, the quoted original included, marked as a forward and as written by that
teammate. A forward raises no unread badge, sends no copy to the owner's mailbox, and a
"STOP" inside it never stops the customer (staff can still press Stop emails by hand).

**Who counts as the team:** anyone with a membership in the account, any role, and the
account's reply-to mailbox (Settings → Sending address). A forward from the mailbox is
filed with no named person and reads "Someone on the team". BIS agency staff are NOT the
team here: their forwards wait in **Needs a look** like any other sender. The forgery check
still applies: a teammate's forward that fails it waits in Needs a look as `unverified`,
and the team is not even looked up.

**Dropped, never stored.** Two kinds of mail are dropped before anything is saved, with one
log line that names only the account (production's logs prefix each with `resend webhook: `):

- Automatic mail (out-of-office and other auto-replies, bounces, mail from `mailer-daemon`
  or `postmaster`): `inbound email: dropped (automatic) account=<id>`
- A sender on the account's **Never record** list (an address, or a domain and every
  subdomain of it), even when the sender is the customer:
  `inbound email: dropped (never record) account=<id>`

A forwarding rule (`Auto-Submitted: auto-forwarded`) set up by a teammate files normally,
as their forward; anyone else's forwarding rule is dropped as automatic mail. A drop is
never retroactive: an entry added to Never record does not touch mail already saved, and a
Resend retry of a dropped message is dropped again.

**503s (Resend retries):** the webhook answers `503 lookup_failed`, and saves nothing, when
reading the Never record list fails ("reading the never record list failed") or when the
team lookup fails ("the team lookup failed"). Both clear on their own once the database
answers; Resend's retry then files, holds or drops the message as usual.

**Reading a dropped message:** BIS stores nothing for it, by design. Resend still has it:
Resend → **Receiving** → the message (or **Webhooks** → the `email.received` event, which
answered `200` with the body `dropped`). Production's logs show which of the two lines
above dropped it, and for which account.

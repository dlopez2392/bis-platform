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

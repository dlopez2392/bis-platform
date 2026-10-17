# Forward to a record, and never record (S-06 part 2)

Status: approved in brainstorming 2026-10-17 (danlo, tiles). First-release item 7, part 2 of 3.
Part 1 (customers' replies come back) shipped in #264 (migration 0082) and is live: see
`docs/superpowers/specs/2026-10-16-inbound-email-design.md` and `docs/runbooks/inbound-email.md`.

Source text: `docs/research/2026-09-25-crm-feature-research.md` §6.2 step 1 ("Per record. Each
record also gets an address with an opaque token … so a doctor's note or a customer's photo can be
forwarded straight onto the right child or job"; "never-log lists exclude vendor and personal
addresses").

## What exists today (part 1)

- Each customer thread has one opaque reply token (`conversations.reply_token`), used as
  `r-<token>@<reply domain>` in the Reply-To of every customer email once the account's Replies
  mode is not off. Mail to it arrives through Resend's `email.received` webhook
  (`apps/web/src/lib/email/inbound/pipeline.ts`).
- A reply is **filed** when the sender's `email_key` matches the thread's contact or a member of
  one of their households or businesses AND Resend's own `Authentication-Results` passes
  (`senderAuthenticated`); otherwise it is **held** in the inbox's Needs a look.
- So today a forward from the Owner or staff to a customer's address is always held
  (`not_on_record`): the sender is a teammate, not the customer.
- `users.email` and `memberships (account_id, user_id, role)` exist; agency staff are users with
  the agency role.

## Decisions (danlo, 2026-10-17)

| # | Decision |
|---|---|
| 1 | The forwarding address IS the customer's existing reply address (same token); no new token. |
| 2 | A forward is filed automatically when the sender is on the account's team (anyone who signs in to the account, BIS agency staff, or the account's own reply-to address) and the forgery check passes. Anyone else is held, as in part 1. |
| 3 | Automatic mail (out-of-office, auto-responders, bounces) is dropped, never stored. |
| 4 | Each account has a **Never record** list of addresses or whole domains whose mail is dropped, never stored, even when the sender matches a customer. The agency and the account's Owners edit it. |

## Design

### 1. Showing the address

The record page's "who they are" column gains one row, **Forwarding address**, showing
`r-<token>@<domain>` with a **Copy** button and the line "Forward an email here to save it on
this customer." The token is created lazily (`ensureReplyToken`) when the page renders the row.
The domain follows the account's Replies mode exactly as the gate's Reply-To does
(`reply.bis-rgv.com`, or `inbound_domain` for `own_domain`).

- Replies mode **off**: the agency sees "Turn on Replies in Settings to get a forwarding address";
  Owners and staff see nothing.
- A Technician sees the row only on customers they can see (the record page already enforces it).
- The drawer (the record's quick look) does not show it; it is one link away on the full record.
- English and Spanish copy; the Copy button toasts "Copied" with no Undo (nothing to undo).

### 2. Pipeline order (the webhook's `email.received` branch)

After fetching the email and resolving the token's thread (part 1, unchanged), and BEFORE storing
anything:

1. **Automatic mail → dropped.** From the raw header block (part 1 already reads it), any of:
   `Auto-Submitted` present and not `no`; `X-Autoreply`, `X-Autorespond` or `X-Autoresponse`
   present; `Precedence: auto_reply`, `bulk` or `junk`; a `Content-Type` of `multipart/report`
   with `report-type=delivery-status`; or a sender local part of `mailer-daemon` or `postmaster`.
   Answer 200 dropped, log only the account id and the word "automatic". No raw headers (null):
   not treated as automatic (the message proceeds and, lacking authentication, is held anyway).
2. **Never record → dropped.** The sender's address (`bareAddress` of the From) matches an entry in
   the account's never-record list: an address entry matches its `email_key` exactly; a domain
   entry matches that domain and any subdomain of it. 200 dropped, log the account id and
   "never record" only (never the address or pattern). An unparseable From never matches.
3. **Sender check** (part 1), in this order:
   - customer or household/business member + authenticated → part 1's filed path, unchanged;
   - else **team member + authenticated** → the forward path (below);
   - else → held, as part 1.

A dropped message stores no `inbound_emails` row; a Resend retry of it is dropped again (stateless).

### 3. Who is "the team"

The sender's `email_key` (part 1's normalisation) equals the `email_key` of ANY of:
- a user with a membership in this account (any role, including Technician);
- a user with the agency role;
- the account's `reply_to_email`.

Resolved by one `@bis/db` function reading on the service client (the webhook has no session),
scoped to the account; it answers `{ userId } | { mailbox: true } | null`.

### 4. The forward path

- Stored like a filed reply (`inbound_emails` status `filed`; a `messages` row on the token's thread,
  `channel='email'`, `direction='inbound'`) EXCEPT:
  - `author_kind='person'`, `author_id` = the matched user's id; a `reply_to_email` match has no
    user, so `author_id` is null and the row renders as "Someone on the team" (DESIGN.md
    provenance rule: still the person mark, never a sixth kind);
  - `meta.forwarded = true`; the bubble reads **"Forwarded by Maria · team"** (or "Forwarded by
    someone on the team"), English and Spanish;
  - the body is the whole forwarded text, NOT stripped of quoted history (the customer's original
    is the point of a forward);
  - unread is NOT raised (a teammate sent it);
  - the owner's forwarded copy is NOT sent;
  - the stop rule does NOT run (a forwarded STOP is not the customer's live request; staff can
    press Stop emails).
- Attachments: counted as in part 1 ("2 attachments — not saved yet"); saving them into the vault
  is a later part.

### 5. The Never record list

- Shown in two places, one shared component:
  - the agency's Settings → **Sending address** card, below the Replies row;
  - the Owner's **Branding** page, below the "where your customers' replies go" line (Settings is
    agency-only, part 1 ruling G6).
- A list of entries, each with **Remove**; an input "Address or domain" with **Add** (ghost button;
  the card's one primary stays Save, rule 8). Add and Remove apply at once with an Undo toast
  (rule 6). Empty state: "Mail from addresses or domains you add here is never saved."
- Validation: an entry is either an address (`local@domain`, normalised by `email_key`) or a
  domain (`example.com` shape, lowercase, at least one dot, no `@`). At most 200 entries per
  account. A duplicate add answers "Already on the list."
- Owners may add and remove on their own account; Technicians and staff without the Owner role
  cannot see or edit it; the agency can on every account. Server actions enforce the role.
- Shown to Owners in their language; dot + word not needed (no status).

## Data model (migration 0083)

- `inbound_never_log`: `id`, `account_id` (FK accounts, on delete cascade), `pattern text`
  (lowercase; CHECK: an address with one `@`, or a domain with no `@` and at least one dot; max
  length 254), `kind text` (`address` | `domain`, CHECK consistent with `pattern`), `added_by text`,
  `created_at`. Unique `(account_id, pattern)`. RLS: members of the account read (agency all);
  only the server writes (0053); no Technician read (a restrictive policy using
  `app.sees_all_customers`). Index on `account_id`.
- No change to `inbound_emails` or `messages` (`meta.forwarded` is jsonb).
- ASCII only, no backslash, `lock_timeout` first; applied bis-ci first, then production, then
  parity (as 0082).

## Failure behaviour

| Case | Response |
|---|---|
| Automatic mail | 200 dropped, nothing stored |
| Never-record sender | 200 dropped, nothing stored |
| Team lookup fails (DB error) | 503 (Resend retries) |
| Never-record lookup fails | 503 (Resend retries) |
| Team forward, unauthenticated | held (`unverified`), as part 1 |

## Tests

- Unit: the automatic-mail detector (each header case, a normal Gmail reply is not automatic,
  null headers); never-record matching (address, domain, subdomain, a lookalike domain like
  `notsupplier.com` must NOT match `supplier.com`, unparseable From); pattern validation.
- Route/pipeline: automatic → dropped, nothing stored; listed sender → dropped even when a
  customer; team member (member, agency, reply_to mailbox) + authenticated → filed as a forward
  with the person mark, unread not raised, no owner copy, no stop; team member unauthenticated →
  held; a customer still files exactly as part 1.
- db/RLS: the table's grants, member read, Technician no read, agency read, unique pattern,
  the CHECKs.
- UI: the Forwarding address row (on/off/agency/Technician), the Never record list (add, remove,
  Undo, duplicate, invalid, 200 cap) in both languages.
- e2e on the per-run fixture account: add a Never record entry, see it, Undo it.

## Out of scope

Saving forwarded attachments into the vault; a separate token per record kind (job, child);
showing the address in the drawer; parsing the original sender out of a forwarded message.

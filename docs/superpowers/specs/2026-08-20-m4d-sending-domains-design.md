# M4d — per-client sending domains — design

**Date:** 2026-08-20
**Status:** approved by danlo in conversation, spec not yet reviewed, not implemented
**Branch:** `docs/m4d-sending-domains`, cut from `main` @ `d1c50da`

## 1. What & why

Every message this platform sends leaves from `crm@bis-rgv.com`. The display
name is already the client's — `resend.ts` composes
`` `${input.fromName} <${this.#fromAddress}>` `` and `fromName` carries the brand
— so a customer today sees:

```
From: Acme Corp <crm@bis-rgv.com>
```

Half white-labelled. The name is theirs, the domain is ours, and the domain is
the half a mail client shows when it decides whether to trust the sender. This
is the last leak in the white-labelling program M3 started: the client's
sidebar, their public form, their favicon, their brand colour, their reply-to
address and their branded email templates have all shipped, and the envelope
sender is what is left.

The reply-to spec (`2026-08-16-reply-to-address-design.md`) anticipated this
exact milestone by name and left an instruction for it, quoted in §4.

## 2. Decisions locked with danlo — do not re-litigate

1. **Agency-run provisioning.** danlo verifies each domain in the Resend
   dashboard and adds the DNS records at the domain host. The app records the
   resulting address and sends from it. **No Resend Domains API integration, no
   secret carrying domain-management scope, no verification wizard.** The
   existing `checklist.email_domain` item already describes this process; it
   predates the feature.
2. **Outbound to customers only.** `conversations/actions.ts` sends from the
   client's address. The lead alert in `f/[publicId]/actions.ts` is
   **unchanged** and keeps `crm@bis-rgv.com`. Rationale in §3.
3. **A preflight test send guards the save.** Setting an address proves it works
   before the value is stored, and needs no key beyond the sending key already
   in production — though that key's *domain scope* may need widening, which is
   a separate ops step and §8's subject.
4. **Unset means today's behaviour**, exactly. Null → `EMAIL_FROM`.
5. **Agency-only.** A client cannot set their own sending address. This is a
   safety boundary, not a permissions preference — see §5.

## 3. Why the lead alert is deliberately excluded

The two send paths have different audiences, and only one of them is a
white-labelling surface:

| path | goes to | white-label matters? |
|---|---|---|
| `conversations/actions.ts` | the client's **customer** | **yes** — this is the whole point |
| `f/[publicId]/actions.ts` | the client's **own staff** | no — they log into BIS daily |

Nothing is hidden from a client by a lead alert that says `bis-rgv.com`; they
know what platform they are on.

The deciding argument is deliverability, not aesthetics. A lead alert sent from
`acme.com` **to** `acme.com` through a third-party sender is the precise shape
corporate mail filters treat as internal spoofing, and it is the one message in
this system that must never be quarantined — it is how a client learns a
stranger asked them for a quote. Nothing downstream retries it, and
`notified_at` records an attempt rather than a receipt. Trading a real chance of
a silently filtered lead for a cosmetic gain on a message the client already
knows the origin of is a bad trade.

**Revisit when** the platform is resold to another agency (roadmap M7), where a
sub-agency's staff seeing `bis-rgv.com` is a genuine leak. That is a different
problem with a different answer and it does not block this one.

## 4. Approach — a sending identity of its own, not a branding field

`from_email` gets **its own accessor and its own Settings card**. It does *not*
join the `Branding` type, `getBranding`/`setBranding`, or the shared
`BrandingPanel`.

This reverses the shape the reply-to milestone chose for `reply_to_email`,
deliberately and on that spec's own instruction:

> **Rejected — its own `emailIdentity` module and card.** Conceptually cleaner
> and it is the shape M4d wants, but for a single field today it buys a second
> read on the client page, a second action and more grant surface. **If M4d
> grows a real email-identity concept (custom domain, per-account From), that is
> the moment to extract it, and the extraction is mechanical.**
>
> — `2026-08-16-reply-to-address-design.md` §3

That moment is now, and the reason is stronger than the tidiness that spec was
weighing. **`Branding` is a client-writable type. `from_email` must never be
client-writable.** Putting a field with one write-scope inside a type that
carries the other is how the 0013 column-grant trap gets sprung: the next person
to add a branding field follows the established pattern, adds the grant, and
either over-grants this column or under-grants theirs. §5 explains what
over-granting this particular column would cost.

Keeping the two apart makes the mistake unavailable rather than merely
discouraged, and it preserves the property the client `/branding` page's own
comment rests on — *"This page fetches branding and nothing else… there is no
branch here for a future edit to get wrong."* The client page is not touched by
this milestone at all.

**`reply_to_email` stays exactly where it is.** Moving shipped, working,
client-editable code into the new module is not in scope and would be churn for
symmetry's sake. The two fields have genuinely different write-scopes, and that
is the thing being modelled.

**Rejected — put it on the branding card, agency audience only.** What was
presented in conversation before the M4b instruction was found. `panelCopy`
already carries an `audience`, so hiding the field from clients is easy — but
"easy to hide in the UI" is not the property that matters. The data would still
sit in a client-writable type one grant away from being writable, and
`getBranding` would return an agency-only value in the client's payload.

## 5. What over-granting this column would cost

`from_email` is the one branding-adjacent column where a client write is not
merely wrong but dangerous.

Resend accepts a send from any domain **verified on our account** — not merely
one belonging to the requesting tenant. A client able to write `from_email`
could therefore set it to *another BIS client's verified domain* and send mail
as that company. Cross-tenant impersonation, through a column that looks like a
display preference, reachable without touching a single row belonging to the
other tenant — so RLS, which is the platform's whole isolation story, never
sees it.

This is why the boundary is structural (§4) rather than a `disabled` attribute
or an audience check in a component.

Migration 0015 therefore writes **no** `grant update (from_email)`. That inverts
the warning 0013 left and 0014 obeyed —

> ⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves for
> the agency and silently fails for clients.

— so the migration must state plainly that the omission is the intent, or a
future reader will correct it into a vulnerability. `client-branding-grants.test.ts`
asserts the granted set exactly and in both directions; because a column with no
grant does not change that set, the test passes either way and pins nothing
until `from_email` is named in it as deliberately absent. It will be.

## 6. Send path

`SendEmailInput` gains an optional field:

```ts
/** Overrides the provider's configured from-address for this send alone.
 *  Optional so the lead-alert caller is unchanged: absent means the platform
 *  address, exactly as before. */
fromAddress?: string;
```

Optional for the same reason `html?` was — every existing caller keeps working
untouched. `ResendEmailProvider.send` resolves
`input.fromAddress?.trim() || this.#fromAddress`.

> **Changed deliberately during implementation.** This section originally
> specified `input.fromAddress ?? this.#fromAddress`. `??` only falls back on
> `null`/`undefined`, so an empty or whitespace-only string survives it and the
> provider composes a From line of `Acme Corp <>`. The shipped code uses
> `?.trim() ||` instead, and three tests pin the blank, whitespace-only and
> undefined cases. Do not "restore" the `??`.

`getEmailProvider`'s production guard is unchanged: `EMAIL_FROM` stays required,
because it remains the fallback for every unset account and the only address the
lead alert uses.

Exactly one call site passes the new field — `conversations/actions.ts`, which
already loads the account to resolve `replyTo` and `fromName`.

## 7. Preflight

Saving an address sends one real message through Resend using the candidate
address, addressed to the **signed-in agency admin's Clerk email**. Resend
rejects an unverified domain, so:

- send succeeds → write the column
- send throws → the action fails carrying Resend's own message, and **the column
  is not written**

Addressing it to the signed-in admin needs no new configuration and puts the
failure in front of the person who caused it. It uses the existing
sending-scoped key — the property agency-run provisioning was chosen to keep.

**Known hole, closed by failing loudly:** outside production
`getEmailProvider` returns the fake, which delivers nothing and so can validate
nothing. This follows from the send guard, whose two-signal requirement
(`VERCEL_ENV` *and* `NODE_ENV`) must never be weakened to make a test more
convenient.

> **Changed deliberately during implementation.** This section originally said
> a dev or preview save "always succeeds regardless of the address" — i.e. the
> fake was to resolve and the write to go through. That would report a
> verification that never happened, which is the exact class of lie this gate
> exists to prevent. `verifyFromAddress` therefore **throws** on
> `provider.isFake` ("A sending address cannot be verified outside production,
> because email is suppressed there"), the column is not written, and a test
> pins it. Do not read this section as an instruction to remove that throw.

The consequence to record either way: **a green save outside production is not
evidence the domain is verified**, and the only real proof is a production save.

**The gate's load-bearing assumption, checked 2026-08-20:** Resend's error
reference documents an unverified sender as a **synchronous `validation_error`
with HTTP 403** — *"The `domain.com` domain is not verified. Please, add and
verify your domain."* It is returned on the `emails.send` call itself, not
delivered later by webhook. So the preflight can gate the write, and the error
it surfaces is already phrased for the person reading it.

⚠️ That is **documentation, not a real call.** It is strong enough to plan
against and not strong enough to skip proving: the first task that touches the
preflight should trigger the 403 once against the production key and record the
actual payload shape, because the action has to read the error's *message* to be
worth anything, and error shapes are exactly what SDKs restructure between
versions. If it turns out to be asynchronous after all, the gate is not
buildable and the honest fallback is to accept the value and let the existing
`failed` message status surface the problem — weaker, but better than a gate
that reports a verification it never performed.

## 8. The API key scope — a blocker before any of this works

The production `RESEND_API_KEY` (`bis-platform-prod`) was created with **Sending
access scoped to `bis-rgv.com`**. A key scoped to one domain cannot send from
another, so with today's key **every send from a client domain fails**,
correctly and by design, no matter how much of §6 is built.

**danlo's hands, before the preflight can ever pass:** widen that key's domain
scope in the Resend dashboard, or issue a key covering the domains we send for.
Nothing in this milestone can verify itself in production until that is done —
and the preflight in §7 is what will report it, immediately and with Resend's
own wording, rather than letting it surface as a client's undelivered email.

**This is also what makes §5 live rather than theoretical.** A key scoped to a
single domain narrows the impersonation vector by accident. Widening the scope —
which this milestone requires — removes that accidental protection and makes the
column grant the only thing standing between a client and another tenant's
verified domain. The two changes ship together, so the structural boundary in §4
has to be right the first time.

✅ **Confirmed narrow by danlo, 2026-08-20.** The key is scoped to
`bis-rgv.com`. This is a live blocker, not a hypothetical one.

### The scope cannot be widened — the key must be replaced

Resend exposes `PATCH /api-keys/{id}`, but it accepts **`name` only**.
`permission` and `domain_id` are fixed at creation (`domain_id` is documented on
create as "restrict an API key to send emails only from a specific domain").
There is no path from a restricted key to an unrestricted one; there is only a
new key.

**Procedure, in this order — the order is what avoids an outage window:**

1. **Create** a new key in the Resend dashboard. Permission **`sending_access`**,
   not full access — least privilege still applies, and nothing in this codebase
   manages domains or keys at runtime. Leave the domain restriction **empty**;
   that is the entire point of the change.
2. **Swap it into Vercel** on `RESEND_API_KEY`, **Production** only, and
   **Remove then Add New rather than adding over the existing name** — Vercel
   silently no-ops an Add on a name that already exists, which cost three
   debugging rounds when the webhook secret was set. Mark the new value
   **Sensitive**. That flag is load-bearing, not hygiene: it is what stops
   `vercel env pull --environment=production` from handing a real key to a local
   `next dev`, which is the precise hole the two-signal send guard exists for.
3. **Deploy fresh.** An environment change does not reach deployments that
   already exist.
4. **Prove it before retiring anything** — one real submission against a
   production form, and confirm the lead alert is delivered. That is how the
   pipeline was proven on 2026-08-18 and it exercises the new key end to end.
5. **Only then delete the old key.** Deleting first opens a window where the
   platform cannot send at all.

**Doing this before M4d ships is safe and worth doing early.** No code reads a
per-account from-address yet, so every send still resolves to `EMAIL_FROM` and
behaviour is byte-identical either way. The widening is inert until §6 lands —
which also means it can be verified on its own, uncoupled from this milestone,
and a failure there cannot be confused with a bug in this one.

## 9. Authentication is the milestone's real dependency — and we cannot see it fail

Found 2026-08-20 while proving the key swap, and it reframes what this milestone
depends on.

A test message sent from `crm@bis-rgv.com` to a Gmail address was **accepted by
Google and never appeared** — not in the inbox, not in spam, not in trash,
confirmed by three searches. Every system we own reported success:

| source | says |
|---|---|
| `messages.status` | `delivered` |
| `events` | `sent` → `delivered`, no bounce, no complaint |
| Resend dashboard | Sent 7:33 PM, **Delivered** 7:33 PM |
| the recipient | nothing |

Resend's own Insights names the cause: **`bis-rgv.com` has no valid DMARC
record.** `delivered` means the receiving server ACCEPTED the message. What
Google then does with it is invisible to the sender.

**🔴 This is the `notified_at` failure shape, and M4d ships straight into it.**
The whole point of a per-client sending domain is a client's mail landing in
their customer's inbox. Every client domain will therefore need **SPF + DKIM +
DMARC**, not merely the DKIM that verification gives you — and when it is
missing, nothing in this platform can tell. Our database will read `delivered`,
Resend will read `delivered`, and the customer will never have seen it. The
preflight in §7 does not catch this either: it proves the domain is *verified*,
which is a different property from *authenticated well enough to land*.

**Consequences for this milestone:**

1. `checklist.email_domain` currently reads *"Add a sending subdomain and
   DKIM… Done in Resend, then the DNS records at the domain host."* **DKIM
   alone is not enough and the copy now teaches the wrong thing.** It must name
   DMARC as a required record, not an optional hardening step. This is no longer
   a copy tweak folded into §10 — it is the difference between a client's mail
   landing and vanishing.
2. **Resend's per-domain Insights is the only place this is visible**, and it is
   agency-run (decision 1), so checking it belongs in the onboarding process for
   every client domain — after verification, before the client sends anything
   real.
3. **Do not add a "deliverability" indicator to the product on the strength of
   `delivered`.** It would be the most confidently wrong thing on the screen.

**Not in scope to fix in code**, and deliberately so: DNS records are the
agency's job under decision 1, and there is no API surface here worth building
to watch them. What changes is the checklist copy and what the agency is told to
do. Recorded rather than solved.

## 10. Surfaces

- **Agency Settings** — a small card of its own ("Sending address"), fed by the
  new accessor. Shows the current address or the platform default, and the
  save path from §7.
- **The client's `/branding` page** — untouched. The field does not render and
  the page's read does not change.
- **Activation checklist** — `checklist.email_domain.help` currently stops at
  verifying in Resend and adding DNS. Setting the address is the step after,
  and the copy should say so. No new catalogue item; the existing one grows.

## 11. Testing

- **Address resolution** — null → `EMAIL_FROM`; set → the account's address.
  Mutation-check by forcing the fallback and watching the override test fail.
- **Preflight** — a throwing provider leaves the column unchanged. This is the
  assertion that matters most, because the failure it guards is silent.
- **Grants** — `from_email` asserted absent from the `authenticated` update set,
  in `client-branding-grants.test.ts`, alongside the existing exact-set check.
- **Lead alert unchanged** — pin that `f/[publicId]` sends with no `fromAddress`.
  Without this, a later "consistency" edit flips it with nothing going red, and
  §3's deliverability reasoning is lost silently.
- **e2e** — the sending-address field is absent from a client's `/branding` page.

House rule applies throughout: an assertion is not evidence until it has been
watched to fail against the defect it claims to catch.

## 12. Out of scope, recorded

- **Resend Domains API** in any form — creation, DNS-record display, verification
  polling.
- **Send retry.** There is none anywhere in the codebase today. A domain
  unverified or revoked *after* a successful save fails at send time down the
  existing path and surfaces as a `failed` message in Conversations.
- **Moving `reply_to_email`** into the new module (§4).
- **Bounce reasons**, still discarded by the Resend webhook. Adjacent, separate.
- **The lead alert's from-address** (§3), until M7 makes it a real leak.

## 13. Migration note

Migration **0015**. `alter table public.accounts add column from_email text;` —
nullable, no default, no grant. Last applied migration in the shared dev
database is **0014**; there is exactly one Supabase project and production reads
it, so applying 0015 changes production's schema the moment it runs. The column
being nullable with no default is what makes that safe: no existing row changes
meaning and no code reads it until §6 ships.

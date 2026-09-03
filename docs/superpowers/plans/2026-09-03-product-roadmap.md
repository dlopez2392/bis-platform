# BIS Platform — Product Roadmap (rebased 2026-09-03)

Supersedes the sequencing in the Aug 31 *BIS Platform Review* (§06). That
document drove the P1–P7 design migration, which is **complete and deployed**
(`main` = `e004437`). Its "Now" column is done. This rebases the rest against
what the codebase actually is today.

Direction chosen by danlo: **SMS and missed-call text-back first**, then
automations — on the reasoning that SMS is what makes an automations engine
worth building.

---

## What the review got right, and what it could not have known

Verified against source on 2026-09-03. Closed by P1–P7: milestone jargon (now
guarded by `INTERNAL_MILESTONE` tests in *both* copy catalogues, so it cannot
come back), the dashboard, table bulk actions, Setup's wide-screen dead zone,
and the booking page's branding, measure and footer.

Still open, confirmed by grep: no SMS (`channel` is `"email" | "form" | "voice"`),
no call-recording playback, no CSV import/export, no contacts filters, bare
sign-in page.

**Never addressed, and it was rated Fix First:** the scroll jank and UI freezes.
It is not in P1–P7 at all. See Phase 0.

---

## Phase 0 — Two things to settle before any of this is schedulable

Neither is engineering work. Both change what the rest of the roadmap costs.

### 0a. Does the scroll jank actually reproduce?

The review's evidence is "screenshot capture timed out" and "large black
voids" — a report from an automated capture tool, which is an unreliable
narrator, and this repo has a standing lesson that a hidden browser window
makes every measurement lie. Open Setup and Settings in a real browser, record
a DevTools performance profile while scrolling, and either produce a flame
chart or close the finding. **Do not schedule a fix for a symptom that has not
been reproduced by a human.**

### 0b. Vercel Hobby → Pro, or accept the ceiling

This is the constraint that shapes everything below, and the review does not
mention it.

There is **one cron job in the entire platform** (`vercel.json`:
`/api/cron/reminders`, `0 14 * * *`) and **no queue** — no Inngest, QStash,
BullMQ, pg-boss, pg_cron, or `waitUntil`. The Hobby plan *rejects any
deployment carrying a sub-daily schedule*, which is why the reminder window was
widened to `[now, now+25h]`.

Consequences, both real:

- **Missed-call text-back must fire synchronously**, inline in the request that
  already knows the call ended. There is nowhere to put a delayed send, and
  nowhere to retry a failed one.
- **An automations engine has no runtime.** "Booking → reminder sequence" and
  "no-show → rebooking nudge" are scheduled work. On Hobby they can only run
  once a day at 14:00 UTC, which is not an automation, it is a batch job.

So Tier 2's automations are gated on a billing decision, not on engineering.
Worth deciding now rather than discovering it mid-build.

---

## Phase 1 — SMS

The review treats this as one item. It is three, with different risk profiles
and one hard external dependency.

### 1a. A2P 10DLC has to become real state — this gates everything else

Today A2P registration is **four lines of instructional copy** and a manual
checkbox (`checklist-catalogue.ts:17`, `external: true`). No brand ID, no
campaign ID, no registration status is stored anywhere.

That is fine while SMS does not exist. The moment there is a Send button, the
platform is one operator mistake away from sending unregistered A2P traffic and
getting a client's number blocked by the carriers. **The platform must know
whether a number is cleared to text before it offers to text.**

Smallest honest version: store the brand/campaign identifiers and a
registration status on the account, surface it in Setup, and gate the SMS
composer on it. This is not glamorous and it is the prerequisite.

### 1b. The first outbound Telnyx integration

**There is no Telnyx API client in this repo.** Telnyx today is an inbound
webhook signature verifier plus a hand-typed ID string on a form. There is no
`telnyx` dependency, no `TELNYX_API_KEY`, no messaging-profile ID, and the repo
has never made an outbound HTTP call to Telnyx of any kind.

The good news is the shape is already established and should be copied
exactly from email:

- An `SmsProvider` interface mirroring `EmailProvider` (`lib/email/types.ts:27`),
  with a **fake-vs-real selection guard** copied from
  `getEmailProvider` (`lib/email/index.ts:31`): real provider only when
  `VERCEL_ENV === "production" && NODE_ENV === "production"`. This is the single
  most important thing to carry over — a stray SMS to a real contact cannot be
  unsent, and this codebase already has the pattern that prevents it.
- **Write-then-send** ordering from `sendEmailAction`
  (`conversations/actions.ts:34`): the `messages` row exists before anything
  leaves the building, so a provider failure is a visible `failed` message
  rather than a silent gap.
- Delivery receipts drop into `updateMessageStatusByProviderId` **unchanged** —
  it looks a row up by the globally-unique `provider_message_id` and reads
  `account_id` back off it, so a Telnyx DLR needs no new plumbing. Map Telnyx
  events onto the existing `STATUS_RANK` ladder, which is monotonic and
  forward-only.
- The inbound SMS webhook reuses `verifyTelnyxSignature`
  (`lib/voice/telnyx-signature.ts:14`) verbatim — it is generic over
  `rawBody` and nothing about it is voice-specific.

**Cheaper than expected:** `'sms'` is *already legal* at the database layer.
Migration `0006` set the CHECK constraint to
`('email','sms','webchat','voice','note','form')` as a deliberate decision that
"channels are adapters, not migrations." Adding the SMS channel is a one-word
edit to the TypeScript union at `messaging.ts:13`. **Zero migrations.**

**One product decision, not a bug:** conversations are keyed one-per-contact
(`conversations_account_contact_unique`), with no channel column. An inbound
SMS lands in the same thread as that contact's email. Decide whether that
unified thread is the product you want before building the UI around it.

Also missing and needed: `phone_numbers` has **no SMS-capability field** — five
columns, and `telnyx_id` is nullable and hand-typed.

### 1c. Missed-call text-back

The flagship pitch, and it has a wrinkle the review does not mention.

`finishCall` deliberately does almost nothing for an `abandoned` call. Its own
comment: *"`abandoned`/`spam` get a row and nothing else — nobody picks those
up, so there is no one to hand off to."* Specifically, `resolveContactId` never
runs, so **an abandoned call creates no contact**. But `createMessage` requires
a `conversationId`, which requires a `contactId`.

So text-back is not "add a send call." It requires deciding to **create a CRM
contact for every abandoned call** — which means every wrong number, every
robocall and every spam call becomes a contact record. That is a real product
trade, and the honest options are: create contacts for abandoned calls and
accept the noise, or text without a CRM row and lose the thread.

Mechanically it attaches as a **fourth independent leg in `finishCall`**,
matching the file's existing three-legs-each-allowed-to-fail architecture,
gated on the inverse of `isMeaningful`. It must be independently try/caught:
`finishCall` is contractually never-throws, because the caller has already hung
up. `ctx.callerNumber`, `ctx.accountId` and `ctx.branding` are already in scope.

Synchronous, per Phase 0b — there is no queue to defer to.

---

## Phase 2 — Automations

**Blocked on the Phase 0b decision.** Recipes that fire on an event
(form submitted → notify) can run inline like 1c. Recipes that wait
(booking → reminder sequence, no-show → nudge) cannot exist on a once-daily
cron.

The review's advice to ship "ten solid recipes, not a blank canvas" is right and
worth keeping. Note the platform already emits domain events — `emit(...)` with
`call.recorded`, `contact.created`, `note.created` and others — but **nothing
consumes them for side effects**; the only reader is the dashboard activity
feed. The event stream is the natural spine for this, and it already exists.

---

## Phase 3 — Reviews, reporting, billing

Unchanged from the review's Tier 2/3, with one correction: **billing is
probably not Tier 3.** The review lists it as a gap in the verdict and then
sequences it last while calling it "what turns a consulting practice into
recurring SaaS revenue." If that is true it belongs earlier. The prior question
is how clients are billed today; if it is manual invoicing that works, this is a
convenience, and if it is blocking sales, it is Phase 1.

The weekly ROI email is the cheapest high-value item in the whole review — the
data all exists, and the cron that would send it already runs daily at the right
cadence. It is the one Phase 3 item that is not blocked by anything.

---

## Deliberately not scheduled

- **Websites + Local Visibility (§04).** The strategic insight is the best idea
  in the review — the CRM already produces embeddable surfaces, so a website
  offering is their distribution layer rather than a separate product. But it is
  a *business line*, not a feature, and it should not compete with SMS for the
  same week.
- **The unbranded booking page.** The review says the booking page has no logo
  or business name. The brand row exists in code but only renders when the
  account has branding set — so the finding was probably a *defaults* problem
  observed on an unbranded Test Client One, not missing wiring. Decide what an
  unbranded account should show its customers.
- **Sign-in branding.** DESIGN.md rule 9 names login as a client-customer
  surface that carries the client's logo, but there is one shared sign-in URL
  and no tenant context before authentication. It cannot be per-client without a
  tenant hint in the URL. Needs a decision, not a ticket.
- **Demo data.** Seed a professional dataset; the review notes a contact named
  "Deez Nutz" in Test Client One. Five minutes, and you will screen-share this.

---

## Carried forward from P1–P7

Small, already-scoped, none blocking: `/f` posts its embed height without its
brand row (same defect P7 fixed on `/b`); `/f`'s brand logo has no reserved box,
so the row shifts on image load; `b/error.tsx` hard-codes its styles (dropped
from P7 deliberately — an error boundary has no tenant tokens to read);
`font: 600 15px inherit` is an **invalid CSS shorthand** on the public
Confirm/Cancel buttons, so they render in default Arial — pre-existing, cheap,
and visible to customers.

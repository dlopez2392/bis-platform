# BIS Platform — M1c Forms & Embeds

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan
**Scope:** A form builder over existing CRM fields, a public hosted form page, an iframe embed snippet, and a submission pipeline that turns a stranger on a client's website into a contact, a conversation, and a notification.

---

## 1. Why

Every contact in this CRM exists because a human typed it in. There is no path from a client's website into the system, which means the platform cannot yet do the one thing a client is actually paying for: catch a lead the moment it arrives.

M1a built contacts, custom fields, and the pipeline. M1b built conversations and outbound email. M1c connects them to the outside world. It is the last piece of the roadmap's M1 "CRM spine" that stands between the platform and a client whose website feeds it.

**Scope split.** The M1b handoff note framed this milestone as "forms + blueprints". Those are two independent subsystems with different payoffs: forms produce leads for client #1, blueprints produce provisioning speed for client #2 onward. They are separated here. **M1c is forms and embeds only; blueprints v0 and the activation checklist become M1d.**

**First target: bis-rgv.com.** BIS is client #1. Its site already runs a bilingual contact form wired directly to Resend, so M1c has a concrete, honest bar to clear — and BIS feels every rough edge before a paying client does. Because that site is bilingual, the public form is bilingual from the first commit, not retrofitted.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Delivery | **Hosted page + iframe embed** | One implementation, two delivery modes: `/f/<publicId>` is a real public page (linkable, QR-able, emailable) and the embed snippet is an iframe pointing at that same page. Style-isolated, so no client CSS can break the form and no host page can restyle it into illegibility. Survives WordPress/Wix/Squarespace HTML sanitizing, which matters the day this is resold. Rejected: a script that renders inline into the host DOM — it buys visual inheritance and costs a permanent browser-compat surface plus a fight with every site builder's sanitizer. Rejected: a public submit API with no UI — best possible fit on a site we control, but every future client would need a developer, which kills the resale story the platform exists for. |
| Public URL | **Opaque `public_id` token**, not a slug | A guessable `/f/quote-request` lets anyone enumerate every client's forms by name and spam them, and forces a cross-tenant uniqueness fight for common names. A published form is not secret, but it should not be *discoverable*. |
| Builder depth | **Field picker over existing CRM fields** | A form is an ordered list of fields, each referencing a core contact field or an existing M1a `custom_field`, plus per-form label/placeholder/required overrides. Nothing can be collected that the CRM cannot store, so there is no orphan data and no second field-type system to drift. Rejected: per-form field definitions with optional mapping — two field systems, and unmapped answers land in a jsonb blob nobody reports on. Rejected: a drag-and-drop visual canvas — that is most of a milestone spent on the builder instead of on leads arriving, and the underlying data model is identical, so it can be added later without a migration. |
| Submit transport | **Server action on the public page**, not a public JSON API | Inside the iframe the page is same-origin, so there is no CORS, no origin allowlist, no preflight, and no second auth surface to get wrong. This is the iframe decision paying off twice. |
| On submit | **Email notification + in-app unread** | bis-rgv.com emails danlo today. Replacing that with a silent CRM row would be a regression that costs real leads. The automation engine is M3, so this is one deliberate hardcoded notification — the same shape the roadmap already planned for missed-call text-back. |
| Spam defense | **Honeypot + signed fill-time + DB-backed rate limit** | Three cheap layers, no third-party account, no user friction, nothing on danlo's hands before the milestone is verifiable. Turnstile slots in later behind the same check interface. The rate limit **must** be DB-backed: in-process counters are per-lambda on Vercel, which is the exact open bug on the BIS website. |
| Form message channel | **Add `'form'` to the `messages.channel` check** | A form message has no honest home in the existing enum. `note` means *the operator wrote this internally* in the M1b UI, so reusing it would render the contact's own words as an internal note. `webchat` is reserved for the M4 chat widget. Migration `0005` states its own precedent: adding an enum value is the cheap direction. |
| Write ordering | **Submission row first, enrichment best-effort** | The property that matters is *a lead is never lost*. Inserting `form_submissions` first guarantees it in one statement. Rejected: a single Postgres RPC doing the whole pipeline transactionally — genuinely atomic, but it pushes dedupe and custom-field merging into PL/pgSQL where the existing `withRollback`/`actAs` harness cannot reach it as easily. |

### Non-goals

- Multi-step forms, file uploads, conditional logic, payment fields.
- Form view and conversion-rate analytics. Submission count only; views need a tracking surface that does not exist.
- SMS consent *enforcement*. Consent text is captured (§4) because proving it later is expensive and capturing it now is free, but SMS itself stays blocked on A2P 10DLC.
- Inbound email replies. M1b's `reply-to` gap is untouched by this milestone and still needs an explicit decision.
- Blueprint packaging — M1d.

**One omission recorded so M1d does not read it as an oversight:** no `blueprint_key` or `origin` columns are added to `forms`. The platform spec (§5) says every blueprint asset carries a stable `blueprint_key`, but adding two nullable columns in `0007` needs no backfill — every pre-existing form is `origin='user'` — so building them now would be speculation.

---

## 3. Why an iframe rather than a native form on bis-rgv.com

bis-rgv.com is a Next.js site under our own control with an existing form designed to match its page. The visually perfect answer is to keep that form and POST to a platform endpoint. That is a fair objection and worth stating plainly.

It is still the wrong first cut. The platform's reason to exist is that it can be sold to clients who are not us, on sites we do not own and cannot rebuild. A delivery mechanism proven only against our own Next.js app is proven against the one case that will never need it. The iframe is verified on a site we control first, which is exactly the right order — but it is the mechanism that generalizes.

The visual cost is real and is paid down with per-form theming (§6): accent color, radius, light/dark/auto, and a transparent background so the form sits on the host section's own background. That closes most of the gap without inheriting the host's fonts. It will not be pixel-identical to a hand-built form, and that is the accepted trade.

---

## 4. Data model

Migration `0006` adds two tables plus one enum widening, following the M0/M1a/M1b pattern: `account_id` on every row, RLS via the `app.*` helpers, an event emitted on mutation.

**`forms`**

- `id`, `account_id`
- `public_id` — text, globally unique, opaque ~12-char token. This is the `/f/<publicId>` URL.
- `name`
- `status` — `draft` | `published` | `archived`
- `fields` jsonb — ordered array of `{ key, kind, label, placeholder, required }` where `kind` is one of:
  - `core.first_name` | `core.last_name` | `core.email` | `core.phone` | `core.company_name`
  - `custom.<field_key>` — references an M1a `custom_fields` row for this account, `model='contact'`
  - `message` — special; becomes an inbound message on the contact's conversation
  - `consent` — checkbox; the exact copy shown is stored per submission
- `theme` jsonb — `{ accent, radius, mode: light|dark|auto, transparentBackground }`
- `success_mode` — `message` | `redirect`; `success_message`, `redirect_url`
- `notify_emails` text[]
- `locale_default` — `en` | `es`
- `created_at`, `updated_at`

**`form_submissions`**

- `id`, `account_id`, `form_id`, `contact_id` (nullable — see §5)
- `values` jsonb — array of `{ key, label, value }`. **Self-describing on purpose:** storing the label alongside the value means editing or deleting a form field later never makes an old submission unreadable.
- `attribution` jsonb — `utm_source/medium/campaign/term/content`, `gclid`, `fbclid`, host page URL, referrer
- `consent` jsonb — `{ given, text, at }` where `text` is the exact consent copy displayed. Consent proof requires knowing what the person agreed to, not merely that a box was ticked.
- `locale`, `ip_hash`, `user_agent`
- `spam_reason` — null when accepted, otherwise `honeypot` | `too_fast` | `rate_limited`
- `processing_error` — nullable; a non-fatal enrichment failure, recorded rather than swallowed
- `created_at`

Indexes: `(account_id, form_id, created_at desc)` for the submissions list, and `(form_id, ip_hash, created_at desc)` for the rate-limit count.

**`ip_hash`, never a raw IP.** Rate limiting needs only equality. Storing visitors' raw IP addresses is personal data we have no reason to hold.

**No rate-limit table.** The limit is counted off `form_submissions` itself over a sliding window: **5 submissions per `(form_id, ip_hash)` per 10 minutes**, both values named as constants in one module so they are tunable without a hunt. Rejected attempts are recorded with `spam_reason` instead of vanishing, so the UI can say "37 blocked this week" rather than showing silence. Growth stays bounded because once an IP is over the limit, nothing further is inserted for it.

**Enum widening:** `messages.channel` gains `'form'`.

---

## 5. Submission pipeline

The order **is** the design.

**Guards, cheapest first. A bot receives the same success response a human receives — never confirm a block.**

1. Look up the form by `public_id`. Not `published` → 404.
2. Honeypot field filled → record `spam_reason='honeypot'`, return success.
3. Fill time under ~2 seconds → record `too_fast`, return success. **The baseline timestamp is HMAC-signed at render time**, not read from a client-supplied field — otherwise a bot sends a fabricated old timestamp and the check is theater.
4. Over the rate limit for `(form_id, ip_hash, window)` → stop, return success, insert nothing further.
5. Field validation — required fields present, email and phone well-formed → real, human-readable, localized field errors returned to the page.

**Writes. The submission row goes first, because it *is* the lead.**

6. Insert `form_submissions` with values, attribution, consent, locale. From this instant the lead cannot be lost.
7. `createContact` — already dedupes on email-or-phone within the account — then link `contact_id` onto the submission.
   - **Existing contact: fill blanks only, never overwrite.** A returning lead who now supplies a phone number gets it added; a mistyped name never clobbers a good record. This requires reading the existing contact first, since `updateContact` takes a partial and would happily overwrite.
   - Custom answers merge into `contacts.custom`. Attribution merges into `contacts.attribution`, preserving first touch and recording last touch.
   - New contact: `source = 'form: <form name>'`.
8. A `message` field, if present → `ensureConversation` + `createMessage` with `channel='form'`, `direction='inbound'`.
9. Increment `conversations.unread_count`.
10. Emit `form.submitted` with `actor_type='system'`.
11. Email the `notify_emails` addresses via the M1b provider — **last, and non-fatal.**
12. Success message, or redirect (§6).

**Steps 7–11 are best-effort**, in exactly the sense `createMessage`'s conversation-touch already is: any failure writes `processing_error` on the submission and the lead survives visibly. Step 6 alone guarantees the property that matters.

Non-production sends nothing (M1b's guard, unchanged), so end-to-end coverage stays real without mailing anyone.

---

## 6. Surfaces

### Public: `/f/<publicId>`

Server-rendered, unauthenticated. Renders only `status='published'`; draft and archived both return a plain 404 — do not leak that a draft exists at that token. Locale comes from `?locale=`, falling back to `locale_default`. Every string from the existing `m` catalog; semantic tokens only.

Middleware protects only `/dashboard(.*)`, which M1b proved with a live signed-out `curl`. No middleware change is expected — **the plan verifies this with a real request rather than assuming it.**

### Public: `/embed.js`

A route handler returning a small script as `application/javascript` with a long cache. Three responsibilities, each with a way to be silently wrong:

1. **Inject the iframe** pointing at `/f/<publicId>`, with `data-locale` passed through.
2. **Lift attribution off the host page.** `utm_*`, `gclid`, and `fbclid` live on the *host* URL — the iframe cannot see them. `embed.js` reads `window.location` and `document.referrer` and appends them to the iframe `src`. Miss this and attribution records empty forever while appearing to work, which is worse than not shipping it.
3. **Auto-height.** The iframe posts `{ type: 'bis-form-height', height }`; `embed.js` **validates `event.source === iframe.contentWindow`** before trusting it. Posting with `'*'` as targetOrigin is acceptable outbound — the host origin is unknowable and the payload is a single number — but the listener must be strict.

### Dashboard (authenticated)

- `/dashboard/accounts/[accountId]/forms` — list: name, status, submission count.
- `/dashboard/accounts/[accountId]/forms/[formId]` — ordered field list with add/remove/reorder (dnd-kit, already in the repo from the pipeline board), theme controls, success behavior, notify addresses, a copyable embed snippet, and this form's submissions with the `processing_error` flag surfaced.

The sidebar gains a seventh item, **Forms**. Product intent is deliberately simpler than GHL's seventeen; seven still makes that point, and this is a named decision rather than a quiet one.

Both dashboard screens use the existing app shell and `PageHeader` pattern.

### Existing screens M1c has to change

A form submission is the first inbound message this platform has ever produced, and two existing surfaces were built on the assumption that inbound does not exist. Both need work here or the lead arrives and nobody sees it.

**Conversations.** M1b deliberately shipped **no unread indicator**, on the correct reasoning that a badge which can never appear is dead UI. It can appear now. This milestone adds: an unread count on the thread list, cleared when the thread is opened; inbound message styling distinct from outbound; and a truthful label for `channel='form'` entries — "Form submission", not "Note", because the words are the contact's own.

**Contact detail timeline.** `ActivityTimeline` already merges three sources and does not yet include messages — M1b's recorded gap. M1c adds form submissions as a fourth source, so a lead's own words appear on their record rather than only in Conversations. This is the narrow version of that gap: form submissions only, not the general messages backfill.

---

## 7. Error handling

The organizing rule, inherited from the M1b review: **a pre-write rejection and a post-write failure owe the user opposite answers.** `send-errors.ts` already exists for this shape and is reused.

- **Before the submission row exists** — validation failure, database unreachable → honest error, form state preserved, nothing written.
- **After the submission row exists** (steps 7–11) → the submitter sees **success**, because the lead genuinely is saved. `processing_error` is recorded and the submissions list flags it as needing attention. A silent partial failure here is how leads rot unnoticed.
- **Double submit** — two layers. Client: the pending-state submit button M1b built. Server: an identical `(form_id, ip_hash, values_hash)` **within 60 seconds** returns success without creating a second row, so a double-tap on a slow phone does not produce two leads. `values_hash` is a digest of the normalized submitted values — trimmed, lowercased, key-sorted — so incidental whitespace does not defeat it.
- **Redirect success mode has a trap.** A redirect fired inside a 300px iframe navigates the iframe, not the page. It must postMessage `embed.js` to navigate the top window, with a plain redirect on the bare hosted page. Both paths are required.

---

## 8. Pre-existing defects this milestone must fix

Reading the code for this design surfaced two problems that are latent today and become real the moment a public endpoint calls into them. They are M1c's work, not follow-ups.

**1. `createContact` interpolates untrusted input into a PostgREST filter.** `packages/db/src/contacts.ts:35` builds `email.ilike."${email}",phone.eq."${phone}"` by string interpolation into `.or()`. Today that value comes from an authenticated operator typing into the CRM. M1c makes it public and attacker-controlled: an email containing `"` or `,` breaks out of the filter grammar. Account scoping is a separate `.eq("account_id")`, so this is not believed to be a cross-tenant leak, but a query-manipulation surface must not exist on a public endpoint. **Fix:** strict format validation before the value reaches the query, and split the `.or()` into two plain filters rather than one interpolated string.

**2. `contacts.ts`, `activities.ts`, and `opportunities.ts` hardcode `actor_type: 'user'`.** A public form submission has no user. This is precisely the bug the M1b review gate caught in the Resend webhook — `messaging.ts` was fixed to take an `actorType` parameter; the other three modules were never revisited. If M1c reuses them unchanged, every form-generated event claims a human performed it and the audit trail lies. `events.actor_type` already permits `'user' | 'system' | 'ai'`. **Fix:** thread `actorType` through those three modules the way `messaging.ts` already does, and record form-driven events as `system`.

**And one column that stops being decorative.** `conversations.unread_count` exists but M1b's spec deliberately left it at zero — "nothing can be unread when every message is outbound," and nothing in the codebase writes it. A form submission is the first inbound message this platform has ever had, so M1c is where unread becomes real: increment on inbound, clear when the thread is opened.

---

## 9. Testing

- **`@bis/db`**, against the real database using the existing `withRollback`/`actAs` harness: forms CRUD; published-only visibility; pipeline cases — new contact, dedupe by email, dedupe by phone, blanks-filled-never-overwritten; custom answers merged into `contacts.custom`; attribution first-touch preserved; spam-rejected rows recorded with **no** contact, message, or event created; rate-limit window boundary; `unread_count` increments; `form.submitted` carries `actor_type='system'`; cross-tenant isolation with forged claims.
- **`apps/web` unit:** honeypot detection; fill-time signature verification including a **tampered** timestamp; attribution parsing from a host URL; values-hash double-submit dedupe; `embed.js` rejecting a height message from a foreign `event.source`.
- **Playwright:** publish a form → open `/f/<publicId>` → submit → assert the contact exists, the thread shows as unread in Conversations and clears when opened, the entry is labelled as a form submission rather than a note, the submission appears on the contact's timeline, and the submission is listed under the form; a honeypot-filled submit shows success and creates nothing; an identical resubmit creates no duplicate. Cleanup follows M1b's pattern — service-role deletion of only test-created rows.
- **Manual, with captured evidence:** the embed on a throwaway static HTML page, proving auto-height, top-window redirect, and attribution passthrough. Unit tests cannot prove the delivery mechanism and the delivery mechanism *is* the deliverable, so this is an explicit plan task, not an afterthought.
- `pnpm check` (typecheck + lint + tests) green before every commit. Note the existing trap: piping `pnpm check` through `grep` swallows the exit code — check it separately.

---

## 10. Risks

**A public unauthenticated write endpoint is a new class of surface for this project.** Every prior write path sat behind Clerk. The mitigations are §5's guards and §8's two fixes; the plan should treat the public submit path as the highest-scrutiny code in the milestone.

**Attribution failing silently.** If `embed.js` does not lift host-page parameters, the feature appears to work while recording nothing, and the failure is only discoverable by inspecting rows. Covered by a unit test and the manual embed verification.

**A service-role client on a public path.** The submit path has no Clerk JWT, so it must use the service-role client, which bypasses RLS. `account_id` therefore **must** come from the `forms` row and never from the request — this is exactly the IDOR class the M1a review caught when `accountId` was a client-controlled hidden input feeding a service-role client.

**Spam volume outrunning three cheap layers.** Honeypot and fill-time stop naive bots; a targeted form-spam service will get through. The rate limit bounds the damage and `spam_reason` makes the volume visible. Turnstile behind the same interface is the escalation, and it is a deliberate later step because it puts an env-var dependency on danlo's hands.

**Scope creep toward a form builder product.** Multi-step, conditional logic, file uploads, and styling controls all feel adjacent. They are non-goals (§2).

---

## 11. Success criteria

- A form built in the dashboard, published, and embedded on a page outside this app renders at the right height and accepts a submission.
- That submission creates or correctly dedupes a contact, records the submission with attribution lifted from the host page, posts the message into Conversations as unread, and emails the notify address in production.
- The unread indicator appears, clears when the thread is opened, and the entry reads as a form submission rather than an internal note.
- The submission is visible on the contact's own timeline, not only in Conversations.
- A returning lead's submission fills blank contact fields and overwrites nothing.
- A honeypot-filled or rate-limited submission is recorded with its reason, creates no contact, no message, no event, and no notification — and is indistinguishable from success to the sender.
- A failure after the submission row is written still shows the sender success, and is visible in the dashboard as `processing_error`.
- No event generated by a form submission claims `actor_type='user'`.
- `pnpm check` green; new `@bis/db`, `apps/web` unit, and Playwright tests passing.

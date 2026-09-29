# Consent chain: the ledger, the one gate, stop words and unsubscribe (Design)

Status: the owner decisions in §1.1 were approved by danlo on 2026-09-26 and are binding. §1.2 records defaults the
orchestrator set. §1.3 lists the choices this spec makes itself; they wait for danlo's review. This is sub-project A
of the CRM plan (#145, `docs/crm-features.md` §4.2, "The legal-date chain", :1113–1182). It covers chain step 1
(F-009), step 3 (F-066 part), step 4 (S-05 and F-065 part) and step 5 (F-133 part), and it adds email. It ships in
three PRs (§7), and each PR gets its own implementation plan. Repo facts are cited against `main` at `61e7f113`.

Corrected on 2026-09-26 from the PR-1 plan review (three reviewers) and danlo's answers of that day. The corrections
are made in place: §1.3 choice 25; §3 (the actor column, the contact reference, the grants, the second index, the
state's tie-break, `hold_released` until PR-2); §4.1 items 1, 3 and 4; §4.2 (the alert phone's STOP and START); §5
(fails closed, go-live item 6); §6 (the quiet-hours sentence, the Messages block's states, the Check number row,
"Mexico (+52)", the alert code's refusals); §8 (the hours tests, scans 1 to 4); §11 (Telnyx's code, verified). A
re-review of the corrected plan added: §4.1 item 1 (who wrote a number, for the backfill) and item 4 and §5 (the
re-hold at delivery, and the re-hold age cap).

Corrected on 2026-09-28 from the PR-2 plan's Telnyx research
(`docs/superpowers/plans/2026-09-28-consent-pr2-keywords-holds-controls.md`, "Spec gaps resolved", S1–S6). The
corrections are made in place: decisions 12 and 16 (verified); §4.2 step 5 (a phrase can be one word), the retry
paragraph (the dedupe returns early) and the Telnyx backfill (verified); §5 go-live step 0 (START and UNSTOP are
Telnyx defaults; AI opt-out detection stays off); §11 (Telnyx's answers).

Corrected again on 2026-09-28 from the PR-2 plan's review (three reviewers) and danlo's decisions of that day (plan
"Spec gaps resolved", S7–S12). In place: decision 10 (S7: BIS confirms only when Telnyx did not); choice 19's note
(Telnyx's block is verified, F4); §3's `source_ref` (S10: one event, never a reusable channel); §4.2 step 2 (S8: a
customer's STOP over a staff stop is recorded, without a reply), the retry paragraph (the attempt that writes the row
owes the reply), the reply table's help lines (S12: a contact sentence) and the phrase list (S9: extended); §5 go-live
step 0 (S11: US, MX and CA; the AI detection read; the opt-out import before any number moves).

## 1. Decisions

### 1.1 Owner decisions (danlo, 2026-09-26; binding)

| # | Question | Decision |
|---|---|---|
| 1 | Decision 27 (`crm-features.md:3216–3230`): designate an exclusive opt-out method? | **No. Honour any reasonable method, in either language.** That means keywords in English and Spanish; free-text sentences, which cause an immediate hold plus a staff To-do to confirm or undo; and staff recording a request the customer made by phone |
| 2 | What does an SMS stop cover? | **Everything.** After a stop, that business sends NOTHING to that number except ONE plain confirmation, with no promotion and no rebooking offer. START re-subscribes. There is no category question. This matches Telnyx's profile-level block and the FCC's "revoke all" direction |
| 3 | Scope and key | The ledger is per **account**, keyed on the normalised address: E.164 for SMS, the lowercased address for email. **Every** send path passes the one gate: automations, text-back, composer, staff alerts, the alert-phone code, and every email path. A number F-009 marks as ambiguous is **held until someone confirms it** |
| 4 | Quiet hours | **Fixed. They cannot be switched off.** Automated texts go only 8 a.m.–9 p.m. in the recipient's zone (the contact's zone if known, otherwise the account's). Marketing texts also follow the Texas solicitation hours: not before 9 a.m., on Sunday not before noon, and until 9 p.m. That reading of Tex. Bus. & Com. Code §301.051 is an **assumption**, and counsel confirms whether it reaches texts. Staff-typed conversation replies, staff alerts and alert-phone codes may go at any hour. Automations are **rescheduled** into the window, not dropped |
| 5 | Free-text stop detection | A reviewed English and Spanish **phrase list in code**, with tests. AI detection waits for study decision 6 (the AI provider's data-retention terms) |
| 6 | Email | **In scope.** The opt-out is an unsubscribe link in every automated email, plus the RFC 8058 one-click `List-Unsubscribe` and `List-Unsubscribe-Post` headers. Both land on a BIS page or endpoint that records the revoke at once. There is **no** inbound-email reading. The token is **signed (HMAC)** and encodes the account, the channel and the address, so there is no token table |
| 7 | What does an email unsubscribe cover? | **All automated email from that business stops, except a direct response to what the customer just did** (the "customer-initiated transactional" class, §4.3). Example: the confirmation of a booking they made after unsubscribing. Reminders, follow-ups, review requests, reactivation and referral asks all stop |
| 8 | Grants | The ledger also records **grants where BIS already captures them**, with no new screens: the form consent checkbox, a booking that includes a phone number, and a customer texting first |
| 9 | Architecture | **An append-only ledger plus one gate, enforced by source-scan tests.** This was chosen over flags on contacts and over leaning on the providers |

### 1.2 Technical defaults (set by the orchestrator)

| # | Default |
|---|---|
| 10 | BIS handles the stop, start and help keywords in the inbound SMS webhook. It sends the single confirmation itself only when Telnyx did not already answer the keyword (the webhook's `autoresponse_type` is absent); when Telnyx answered, Telnyx's configured reply, set to §4.2's own line, is the single confirmation (amended 2026-09-28, PR-2 plan S7: a Telnyx block also refuses BIS's own send, so BIS could not send it). A keyword matches only the **whole message**, ignoring case and accents. **Stop, English:** STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPT OUT, OPTOUT. **Stop, Spanish:** PARAR, DETENER, ALTO, CANCELAR, BAJA, NO MAS / NO MÁS |
| 11 | START and UNSTOP re-grant. HELP and AYUDA reply with the business name and how to stop |
| 12 | Telnyx's own keyword handling stays on as a **backstop**, and the Spanish words are registered on the profile. How Telnyx's auto-reply interacts with BIS's confirmation, so that no customer gets two, is an **assumption**. It must be checked against Telnyx's docs or support before the PR-2 implementation plan is written. The setting the plan names is the `autoresponse_type` field on the inbound message webhook (`crm-features.md:1176`). It is **verified 2026-09-28** (PR-2 plan F1–F4): Telnyx answers a keyword it knows before BIS sees the text, the webhook then carries `autoresponse_type`, and Telnyx's block also refuses BIS's own send, so BIS confirms only when `autoresponse_type` is absent |
| 13 | The YES/NO appointment confirmation keeps working. Its precedence against the keywords is defined in §4.2 |
| 14 | Staff can record an opt-out, and it takes effect at once. Resuming requires a note saying the customer asked |
| 15 | The contact drawer shows "Texts: allowed / stopped (date, how)" and the same for email, with Stop and Resume controls. It follows DESIGN.md: dot + word, tokens only, and the reversible-with-undo and confirm rules. A free-text hold creates a To-do row |
| 16 | A backfill brings in 0049's email opt-outs and, since its API allows it (**verified 2026-09-28**, `GET /v2/messaging_optouts`, PR-2 plan F6), Telnyx's existing opt-out list. 0049's readers switch to the ledger |
| 17 | The "ten business days" duty is met by **acting immediately**. There is **no clock setting**: every revoke and every hold blocks the very next send, so nothing waits on a clock. The plan's proposed setting (`crm-features.md:1176`) is therefore not needed |

### 1.3 Choices this spec makes (for danlo's review)

| # | Choice | Why |
|---|---|---|
| 18 | The stop confirmation, the start confirmation and the help reply go **at any hour**. They are exempt from decision 4's window | Each one answers the customer's own text within seconds. Today's 47 CFR 64.1200(a)(12) presumes a confirmation sent within five minutes is consented (`crm-features.md:1106`), and holding it until 8 a.m. would lose that |
| 19 | A stop the customer made **themselves** (a keyword, the unsubscribe link, one-click), or one the carrier reports, is lifted **only by the customer's own act**: texting START, or Resubscribe on the unsubscribe page. Staff Resume is offered only for stops that staff recorded, staff confirmed, or that came from staff's 0049 switch | Only the customer's own act undoes their own act. For SMS, Telnyx also keeps its own block on that number (decision 2), so a BIS-side resume could not reach them anyway (verified 2026-09-28: Telnyx's block is per messaging profile and has no exemption, PR-2 plan F4) |
| 20 | A **free-text stop gets no confirmation text**, not at the hold and not when staff confirm it | A hold may be a false positive, and staff confirm long after the five-minute window of choice 18. Counsel reads this (§5, go-live item 3) |
| 21 | An automated text or email whose purpose has passed before the window opens is **not sent**. It is logged "not sent: quiet hours ran past the appointment". Today's "deadline sends now, inside quiet hours" branch (`apps/web/src/lib/automations/hold-or-send.ts:184`) is removed | Decision 4 forbids sending in the quiet window. A reminder that arrives after the appointment is worse than none. Everything else is rescheduled, not dropped |
| 22 | A **staff-typed email** to a contact who unsubscribed still sends. The composer shows a notice | Decision 7 covers *automated* email. A person replying about the customer's own matter is not automated |
| 23 | **Operator mail** (email BIS sends to the business's own people or the agency: alerts, reports, billing, the sending-address check) passes the gate but is **not** subject to the customer ledger | The ledger holds customers' choices about a business's customer mail. Operator mail never carries the unsubscribe link and has its own switches (the weekly report's recipients field, DESIGN.md "The weekly report") |
| 24 | Folding 0049 **widens** each opt-out: a contact marked "No marketing emails" stops *all* automated email, reminders included | Decision 7 gives an email stop one meaning. 0049 promised "Quotes and appointment emails still go" (`apps/web/src/lib/messages.ts:443`), so the backfill's count is reported to danlo before production runs it (§5) |
| 25 | The gate does **not** read `contacts.dnd` | It is `jsonb not null default '{}'` (`packages/db/supabase/migrations/0003_crm_core.sql:13`), and no code reads or writes it (`packages/db/src/automations.ts:1293`, `0049_contacts_marketing_email_optout.sql:41–48`). Two sources of truth would be worse. PR-1 checks both databases for any non-empty value; if one exists, its implementation plan converts it into staff-recorded stops. This departs from `crm-features.md:1181`. **Checked 2026-09-26: 0 rows on production and on the CI project**, so there is nothing to convert |
| 26 | Keyword matching ignores spaces too, so STOP ALL (a Telnyx default, `crm-features.md:1099`), OPT OUT and NO MAS match as well as their one-word forms | Customers type both |
| 27 | Opening the `/u/[token]` page records the revoke at once. The page offers a ghost "Resubscribe" | Decision 6 says "at once". The button undoes a mis-tap, or a revoke caused by a link-scanning mail filter opening the page (§5) |
| 28 | A **grant never lifts a stop**. Only `resubscribed` does (START, the page's Resubscribe, or staff Resume with a note) | A customer who texted STOP and later books online with their phone has not asked for texts again |
| 29 | The gate **blocks on a revocation**. It does not yet **require** a recorded grant before sending | Requiring a grant before marketing texts belongs to broadcasts (S-43, S-52), which are out of scope (§9) |
| 30 | F-009 uses `libphonenumber-js` (MIT) to judge whether a 10-digit number is a valid US number, a valid Mexican one, or both | The platform spec allows MIT libraries (`crm-features.md:3206`). A hand-made table of area codes would rot |
| 31 | **Automated email** keeps quiet hours, on the same fixed 8 a.m.–9 p.m. automated window. Customer-initiated, staff-typed and operator email go at any hour | Decision 4 names texts. `holdOrSend` already holds the email passes (`passes/reminders.ts:77`, `followups.ts:112`, `reactivation.ts:187`), and removing the switch has to leave them with some window. The fixed one is the least surprising |

## 2. Today (repo facts at `61e7f113`)

- **SMS provider calls.** Five sites call the provider:
  - the automation harness, `getSmsProvider` at `apps/web/src/lib/automations/harness.ts:26`, used by `sendAutomationSms` (`lib/automations/send-sms.ts:76`, send at :104);
  - staff alerts, `deliverAlertSms` (`lib/sms/alerts.ts:182`);
  - the missed-call text-back, `deliverTextback` (`lib/voice/textback.ts:247–248`);
  - the composer (`app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts:173–174`);
  - the alert-phone code (`…/settings/actions.ts:324`).
  In this section, a path that starts with `lib/` or `app/` is under `apps/web/src/`, and `passes/` is
  `apps/web/src/lib/automations/passes/`. A bare migration name is under `packages/db/supabase/migrations/`.
- **More triggers than the five paths suggest.**
  - `sendAutomationSms` has seven callers: `instant-reply.ts:177` and the passes `appointment-confirm.ts:157`, `no-show-nudge.ts:218`, `referral-ask.ts:269`, `sms-reminder.ts:119`, `quote-followup.ts:208` and `review-request.ts:235`.
  - The instant reply fires from the public form (`app/f/[publicId]/actions.ts:205`), the intake API (`app/api/intake/[publicId]/route.ts:146`) and the web concierge (`lib/concierge/lead.ts:131`).
  - Alerts fire on a booking (`app/b/[publicId]/actions.ts:462`) and at the end of a call (`lib/voice/finish-call.ts:462`, :605).
  - The text-back also fires from the handoff-result route (`app/api/voice/texml/handoff-result/route.ts:281`, :294).
- **The A2P gate.** `resolveSmsSender` (`lib/sms/sender.ts:30`) refuses unless `accounts.a2p_status = 'approved'` (:34). The default is `'not_started'` (`0023_a2p_registration.sql:18`). The composer (:138), the code (:311), alerts (`alerts.ts:158`), the text-back (`textback.ts:158`) and every pass call it. `sendAutomationSms` does not; its callers do.
- **No path checks a revocation.**
  - `sendAutomationSms`'s only compliance step is `withOptOut` (`send-sms.ts:96`).
  - `withOptOut` (`lib/sms/opt-out.ts:54`) only appends "Reply STOP to opt out." or "Responde STOP para cancelar." (`lib/messages.ts:985–986`).
  - Its comment says not to add keyword handling to the inbound webhook, because Telnyx does it (`opt-out.ts:14–20`). PR-2 reverses that and rewrites the comment.
- **The inbound route** (`app/api/sms/inbound/route.ts`):
  - It verifies an Ed25519 signature (:225–233).
  - It finds the account from the dialled number (:95–100) and drops texts from the alert phone (:130).
  - It dedupes retries by provider id (:143–150), then creates or finds the contact (:157), files the message (:161) and runs the YES/NO confirmation (:201).
  - It reads no STOP, START or HELP, and no `autoresponse_type`.
- **YES/NO.** `matchConfirmationReply` (`packages/db/src/automations.ts:826`) matches the whole message after trimming, lowercasing and removing trailing punctuation.
  - Yes words: yes, y, si, sí, confirm, confirmed (:789–794). No words: no, n (:804).
  - "cancel" is deliberately excluded (:795–803).
- **Quiet hours.**
  - The logic is `inQuietWindow` and `quietWindowEnd` (`lib/automations/quiet-hours.ts:153`, :164). It runs on the account's clock, `accounts.timezone` (`0001_tenancy.sql:26`, default America/Chicago).
  - The default window is 21:00–08:00 (`packages/db/src/automation-settings.ts:7`).
  - It can be switched off through `automation_settings.quiet_enabled`, `quiet_start` and `quiet_end` (`0046_automation_log.sql:89–96`), and a start equal to the end also disables it (`quiet-hours.ts:145`). The switch is saved by `saveQuietHoursAction` (`automations/actions.ts:337`).
  - `holdOrSend` (`hold-or-send.ts:169`) writes a `held` row to `automation_log` with `held_until` (:184–206), and sends at once when the deadline falls before the window ends (:184).
  - Only the automation passes and the instant reply use it. The text-back has none.
- **Numbers.**
  - `toE164` (`lib/voice/phone-number.ts:4`) turns any 10 digits into `+1…` (:6).
  - `contacts.phone_key` (`0033_contact_dedupe_keys.sql:21–30`) keeps the digits and drops a leading 1 from 11 digits, so a correct `+52` number and a mis-stored `+1` copy of it get different keys.
  - Contacts have no time-zone column. Only `bookings.booker_timezone` exists (`0016_booking.sql:47`).
- **Email.**
  - The provider is `lib/email/resend.ts:16`. It sends only from, to, reply-to, subject, text and html (:18–38). `SendEmailInput` has no headers (`lib/email/types.ts:1–23`), and there is no `List-Unsubscribe` anywhere.
  - The production guard is in `getEmailProvider` (`lib/email/index.ts:20`, :31–43).
  - Twenty send sites are classified in §4.3. Invitations go through Clerk, not Resend (`…/settings/actions.ts:95`).
- **0049.**
  - `contacts.marketing_email_opted_out_at` (`0049_contacts_marketing_email_optout.sql:89–90`) is written by `setMarketingEmailOptOut` (`packages/db/src/contacts.ts:416`, :422) from the drawer switch (`app/(dashboard)/dashboard/accounts/[accountId]/contacts/marketing-optout-switch.tsx:58`).
  - It is read at `packages/db/src/contacts.ts:20`; by the referral-ask skip (`packages/db/src/automations.ts:999`, :1016; `passes/referral-ask.ts:219–221`); by the reactivation lists (`automations.ts:1491`, :1620); and by the summary API (`app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts:103`, `lib/contacts/summary.ts:99`).
  - The switch is shown at `app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx:200–204` and `app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx:78–82`.
- **Grants BIS already captures.**
  - A form's consent field has an operator-written label and no default wording (`app/(dashboard)/dashboard/accounts/[accountId]/forms/[formId]/form-editor.tsx:24–27`, `app/f/[publicId]/public-form.tsx:181–206`). It is stored only in `form_submissions.consent` (`0006_forms.sql:48–52`, built at `app/f/[publicId]/actions.ts:102–118`).
  - A booking stores the booker's phone on the contact (`app/b/[publicId]/actions.ts:181`, :202, :290–297).
  - An inbound text creates or finds the contact (`route.ts:157`).
- **To-do rows** live in `tasks` (`0003_crm_core.sql:106–115`), which has no kind or source column, and are created by `addTask` (`packages/db/src/activities.ts:25`).
- **Signing precedent.** The form render token uses HMAC-SHA256 with `timingSafeEqual` (`lib/forms/guards.ts:45`, :54, :76, :85), and its secret falls back to the service-role key (:37–41).
- **RLS precedent.** `usage_events`: select policy, revoke from anon and authenticated, then grant select (`0051_billing_core.sql:214–218`). The highest migration is `0052_billing_checkout.sql`.
- **Account switch.** `accounts.outbound_suppressed` (`0032_outbound_suppressed.sql:17–18`) makes every automation pass skip an account. It stays as it is.

## 3. Data model

New migration(s) in PR-1 (numbered from 0053), applied to the CI project first, then production, then checked for
parity (CLAUDE.md; `docs/runbooks/ci-supabase-project.md`).

**`consent_events`** is the ledger. It is append-only and follows the research study's shape
(`docs/research/2026-09-25-crm-feature-research.md:231`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `account_id` | uuid not null | FK `accounts`, on delete cascade |
| `channel` | text not null | `sms` or `email` |
| `address` | text not null | For SMS, E.164 (check `^\+[1-9][0-9]{7,14}$`). For email, trimmed and lowercased (check `address = lower(address)`) |
| `action` | text not null | `granted`, `revoked`, `held`, `hold_released`, `resubscribed` |
| `method` | text not null | `keyword`, `start_keyword`, `free_text`, `staff`, `staff_undo`, `carrier_block`, `unsubscribe_link`, `one_click`, `unsubscribe_page`, `form`, `booking`, `inbound_text`, `backfill_0049`, `backfill_telnyx` |
| `contact_id` | uuid null | The contact it concerned at the time, so the evidence outlives a merge or a delete. The reference is **composite**: `(account_id, contact_id)` → `contacts(account_id, id)`, `on delete set null (contact_id)` (0050's pattern), so a row can never name another account's contact |
| `actor_id` | text null | The staff member's Clerk user id (`user_…`), for `staff` and `staff_undo`, where a check requires it non-blank. It is text, not a uuid FK to `users`: the id staff actions carry is Clerk's, as `events.actor_id` stores it |
| `note` | text null | Required, and must not be blank, when `method = 'staff'` and `action = 'resubscribed'` (a check constraint) |
| `source_ref` | text null | The inbound message, form submission or booking id: ONE delivery or event, never a reusable channel such as a token or an address, because PR-2's one-row-per-source index reads a reused source as a retry forever and would drop a second real stop (PR-2 plan S10). The Telnyx backfill's source names the opt-out and its time |
| `evidence` | jsonb not null default `'{}'` | The keyword or phrase matched, a message excerpt of at most 160 characters, the consent label shown, or the token's issue time |
| `occurred_at` | timestamptz not null default `now()` | For backfills, the original time |
| `created_at` | timestamptz not null default `now()` | |

- **Indexes** on `(account_id, channel, address, occurred_at desc, id desc)` (the state read), and on
  `(account_id, contact_id) where contact_id is not null` (the contact reference's set-null on a contact delete).
- **RLS**, following `0051_billing_core.sql:214–218`: a select policy for `authenticated` (the agency, or the row's own account); `revoke all` from anon, authenticated **and service_role** (the default privileges hand all three everything, `MAINTAIN` included); then `grant select` to authenticated and `grant select, insert` to service_role.
- **Writes** go only through `packages/db/src/consent.ts`, using the service role behind `requireAccountAccess` for staff actions.
- **Append-only by grants.** No role, `service_role` included, holds `update`, `delete`, `truncate` or `maintain`. Account deletion still cascades, and a contact delete still nulls `contact_id`, because referential actions run as the table owner (proved by a DB test on a PG18 replica, §8).

**State of an address.** The state comes from the newest row whose action is `revoked`, `held`, `hold_released` or
`resubscribed`, ordered by `occurred_at`. On an `occurred_at` tie the **more restrictive** row wins (`revoked`, then
`held`, then `hold_released` and `resubscribed`), and only then the larger `id`, because a uuid's order is random.
`granted` rows are evidence and never change the state (choice 28).

| Newest deciding row | State | The gate |
|---|---|---|
| none, `hold_released` or `resubscribed` | **allowed** | sends |
| `revoked` | **stopped** | blocks everything except the one stop confirmation (§4.2) |
| `held` | **held** | blocks everything |

- A `held` row is written only when the state is allowed, or as the undo of a hold's resolution (§4.2), which
  returns the row to On hold.
- A `hold_released` row is written only when the state is held. The server function checks this inside the insert statement, so a keyword stop that lands in between cannot be undone by a stale click. Until PR-2 builds that guarded write, PR-1's `appendConsentEvent` refuses `hold_released` outright.

**Other changes**
- `contacts.phone_country_unconfirmed boolean not null default false`: F-009's ambiguous flag (§4.1).
- `tasks.consent_event_id uuid null`, a FK to `consent_events`. It links a To-do row to the hold (or stop) it asks about.
- `automation_settings.quiet_enabled`, `quiet_start` and `quiet_end` stop being read in PR-1. A later migration drops them once both databases pass the parity check.
- `contacts.marketing_email_opted_out_at` stops being read and written in PR-3, and is dropped the same way.

## 4. Flows

### 4.1 PR-1: numbers, classes, the gate

1. **Normalising numbers (F-009).** One function, `normalisePhone(input)`, replaces `toE164` and serves every place a
   typed or spoken number becomes E.164: Sofía's capture, the booking page, forms and intake, CSV import, contact
   edits, and the alert phone.
   - A number with a country code (`+1`, `+52`, `00 52`, `011 52`) is kept as given. The retired Mexican mobile `1`
     after `52` is dropped.
   - Mexico's retired trunk prefixes `01`, `044` and `045` before ten digits are dropped and the rest judged as a
     Mexican number. Any other leading `0` is refused, never stored as `+0…`.
   - A 10-digit number that is valid only as a US number becomes `+1`, and one valid only as a Mexican number becomes
     `+52` (choice 30).
   - A number valid as both, or valid as neither, is stored as `+1` (today's reading, so its `phone_key` does not
     move) and flagged `phone_country_unconfirmed`.
   - **Every contact write passes the number as the person typed or said it**, never a pre-normalised `+1…`: a `+1`
     reads as a country code the person gave, so a pre-normalised ambiguous number would be stored confirmed and
     texted. For Sofía's tools, a leading `1` the model adds to ten digits is dropped, and a number that is the
     caller ID is taken from the carrier. The instant reply texts the number as typed.
   - Numbers that arrive from the carrier (an inbound call's caller number, an inbound text's sender) keep their own
     `+` and code and are never flagged. The gate does not hold a text to the caller ID on the contact's stored
     flag, which is about a number a person typed.
   - **Dedupe.** A new `+52` number whose key misses also looks up the bare ten digits: a contact stored as those bare
     digits is the same contact, and one stored as `+1` with them is recorded in `contact_duplicate_flags`
     (`phone_country_twin`) for the merge queue.
   - The alert-phone field gains a country choice (US (+1) / Mexico (+52)), so it is never ambiguous. Only a bare ten
     digits take the chosen country; a country code typed without `+` (`1` + ten, `52` + ten, `521` + ten) is a code,
     and one that disagrees with the choice is refused with its own line, never re-coded.
   - **Backfill:** flag every stored `+1` number that is also a valid Mexican number, unless the same account has
     seen it as the caller or sender of an inbound call or text. It runs **after** the build that normalises on write
     is live (until then the old build keeps storing `+1…`), and it decides who wrote each number from what can be
     known, never from `updated_at`, which any field's edit moves: a contact created before the deploy's cut-off, or
     a number not stored as E.164 (the new build stores every number that parses as E.164), was the old build's and
     is flagged; one created after it and stored as E.164 is the new build's own reading, not flagged, and listed in
     the report. Nothing is dropped silently. The cut-off is the deploy's READY instant plus Skew Protection's maximum
     age if it is on.
   - A flagged number is **held** by the gate (decision 3) until staff pick the country in the drawer (§6). The pick
     is refused if the stored number is no longer ambiguous.
2. **The message-class registry** (`apps/web/src/lib/consent/classes.ts`) gives every send a stable `kind`, and each
   kind has a channel, a class, an hours rule and a footer. The classes are `customer_initiated`, `informational`,
   `marketing`, `staff_typed`, `operator` and `consent_reply`. The SMS kinds are:

   | Kind | Sent from (`apps/web/src/…`) | Class | Hours |
   |---|---|---|---|
   | `automation.instant_reply` | `lib/automations/instant-reply.ts:177` | customer_initiated | automated |
   | `automation.appointment_confirm` | `passes/appointment-confirm.ts:157` | informational | automated |
   | `automation.sms_reminder` | `passes/sms-reminder.ts:119` | informational | automated |
   | `automation.no_show_nudge` | `passes/no-show-nudge.ts:218` | marketing | marketing |
   | `automation.referral_ask` | `passes/referral-ask.ts:269` | marketing | marketing |
   | `automation.review_request` | `passes/review-request.ts:235` | marketing | marketing |
   | `automation.quote_followup` | `passes/quote-followup.ts:208` | marketing | marketing |
   | `voice.textback` | `lib/voice/textback.ts:248` | informational | automated |
   | `staff.composer_sms` | `conversations/actions.ts:174` | staff_typed | any |
   | `operator.alert_sms` | `lib/sms/alerts.ts:182` | operator | any |
   | `operator.alert_phone_code` | `settings/actions.ts:324` | operator | any |
   | `consent.stop_confirmation`, `consent.start_confirmation`, `consent.help` | the inbound route (PR-2) | consent_reply | any (choice 18) |

   - **Automated hours** are 08:00–21:00 in the recipient's zone. **Marketing hours** are 09:00–21:00 Monday to
     Saturday and 12:00–21:00 on Sunday (decision 4).
   - The recipient's zone is the contact's zone if one is known, otherwise `accounts.timezone`. BIS stores no zone
     per contact today (§2), so every recipient uses the account's zone. The gate takes a contact zone in its
     signature so that the first feature that records one needs no gate change.
   - Automated email runs on the same fixed automated hours (choice 31).
   - Each kind keeps today's footer. The registry records it: the STOP line for automation kinds (`send-sms.ts:96`),
     and the text-back as today.
   - The classification of review requests, quote follow-ups and no-show nudges as marketing is **proposed** (it is
     the stricter choice) and goes to counsel with the table (`crm-features.md:1106`).
3. **The gate** (`apps/web/src/lib/consent/gate.ts`) is the only module that may call a provider. It exposes
   `sendSms({ accountId, kind, to, body, contactId?, language?, deadline? })` and, from PR-3,
   `sendEmail({ accountId, kind, to, …, contactId? })`. Each call returns one of four results:
   `sent`, `deferred` (with `until`), `blocked` (with a reason) or `failed`. For an SMS the gate:
   1. rejects a `kind` missing from the registry (a programming error, and it throws);
   2. normalises `to`;
   3. runs `resolveSmsSender` (A2P, a live number), so every path gets it;
   4. reads the ledger state: stopped → `blocked: stopped`, held → `blocked: held`;
   5. refuses a contact whose `phone_country_unconfirmed` is set (`blocked: unconfirmed_number`), unless `to` came
      from the carrier (the text-back's caller ID);
   6. applies the kind's hours: outside them → `deferred` until the window opens, unless choice 21 applies
      (→ `blocked: window_after_deadline`);
   7. adds the kind's footer;
   8. sends through the provider;
   9. if the carrier refuses because the number is opted out (Telnyx code `40300`, §11), appends `revoked` with method
      `carrier_block`.

   If the ledger, the flag or the account's zone cannot be read, the gate **fails closed**
   (`blocked: ledger_unavailable`). A zone that was read but cannot be resolved still takes the fallback zone; an
   outage is not a zone.
4. **Routing the five paths.**
   - The harness's `ctx.sms()` becomes the gate's `sendSms`, and `imports.test.ts` stops allowing `harness.ts` to
     import the SMS factory.
   - Alerts, the text-back, the composer and the code call `sendSms` in place of `getSmsProvider().send`.
   - `holdOrSend` takes its window from the gate: a `deferred` result becomes its `held` row, and the quiet-hours
     settings are no longer read.
   - The text-back joins that held-row mechanism with its own kind, so a call missed at 10 p.m. gets its text at
     8 a.m. At release it is **skipped** if that number has called, or texted, since the missed call, and a held
     text-back's default wording drops "just now" (danlo, 2026-09-26).
   - `ledger_unavailable` on an automation or the text-back is a **15-minute re-hold**, not a failure, whether the
     gate meets it deciding or delivering: a released reminder, the instant reply and the text-back have no later
     pass to retry them.
   - **The re-hold age cap** (orchestrator, 2026-09-26): an instant reply or a text-back released more than 24 hours
     after what triggered it (the form submission, the call's end) is not sent and not held again. It is logged
     skipped, "Not sent: too long after they wrote in" / "Not sent: too long after the call", so an outage never
     answers days later.
   - A `blocked` automation is logged in `automation_log` with the gate's reason, so "What went out" can say why. A
     refused row gives back its place under the per-tick and per-day caps, so refusals cannot starve other sends.
   - The composer and the code show the reason inline (§6).

### 4.2 PR-2: stop words, holds, grants, staff controls

**The alert phone first.** The route drops texts from the alert phone before anything else (`route.ts:130`), but the
gate records `carrier_block` for operator kinds too, and choice 19 forbids staff Resume of a carrier stop. So STOP and
START from the alert phone are handled (steps 1–3 below) **before** that drop; otherwise a carrier block on the alert
phone could never be lifted.

**The inbound route**, after it files the message (`route.ts:161`), so that staff always see what was written:

1. **Normalise.** Unicode NFD with the accents removed, uppercase, trailing punctuation removed, and every space
   removed (choice 26).
2. **Stop keyword** (decision 10). Unless the customer's OWN stop already stands — the newest deciding row is a
   `revoked` whose method is `keyword`, `carrier_block`, `backfill_telnyx`, `unsubscribe_link` or `one_click` — append
   `revoked` (method `keyword`, with the word in the evidence). Over a staff stop or a confirmed free-text stop it IS
   appended, so from then on only the customer can lift it (choice 19; corrected 2026-09-28 by danlo's decision, PR-2
   plan S8). §4.3's email rule below ("an address that is already stopped gets no second row") is a different
   principle; PR-3 decides whether email follows this one.
   - Then send **one** `consent.stop_confirmation` in the keyword's language, unless the webhook shows Telnyx already
     auto-replied (decision 12), and only when the address was not already stopped: a stop over a staff stop gets no
     confirmation (the texts were already off). An address the customer had already stopped gets nothing.
   - If the word was CANCEL or CANCELAR and the contact has an upcoming booking, also add a To-do asking staff to
     check whether they meant the appointment (§6).
   - Nothing else runs for that message.
3. **START or UNSTOP.** If the address is stopped or held, append `resubscribed` (method `start_keyword`) and send a
   `consent.start_confirmation`, unless Telnyx auto-replied. Nothing else runs.
4. **HELP or AYUDA.** If the address is allowed, send `consent.help` in that language, unless Telnyx auto-replied. A
   stopped or held address gets nothing from BIS (decision 2, and the gate's block on held addresses).
5. **Otherwise**, the YES/NO confirmation runs exactly as today (`route.ts:201`). Then the free-text detector runs.
   - No phrase matches a YES/NO word, and YES/NO matches only a whole one-word message (§2), so the two can never
     both fire. (Corrected 2026-09-28: not every phrase has two words, `borrenme` is one; the PR-2 plan tests that no
     phrase matches a YES/NO word.)
   - If a phrase matches and the address is allowed, append `held` (method `free_text`, with the phrase and an
     excerpt in the evidence) and add the To-do. No text is sent (choice 20).
6. **Grant from texting first.** If the account's ledger has no row at all for this address, a `granted` row (method
   `inbound_text`) is appended first, before steps 2–5.

**Replies are written after the ledger.** If the ledger write fails, the route returns a 5xx so that Telnyx retries.
The existing provider-id dedupe (`route.ts:143–150`) RETURNS before anything else runs, so as it stands a retry would
never reach the ledger (corrected 2026-09-28, PR-2 plan S1). On a retry the dedupe skips only the filing and the YES/NO
step; the consent steps run again, every consent write is idempotent on the message id (one ledger row per source,
one To-do per ledger row), and a reply is sent only by the attempt that wrote the row it answers. That attempt owes the
reply from the moment the row is written and schedules it then, even if a later step (the CANCEL To-do) fails and
answers 5xx; its retry finds the row already written and sends nothing (PR-2 plan review R2-I1a).

**The only send allowed to a stopped address.** The gate lets `consent.stop_confirmation` through a stopped address
only when the caller passes the id of the `revoked` row it answers, and that row is the newest and under five
minutes old.

**Customer-facing texts.** They have no á, í, ó or ú, which would drop the message to UCS-2 (`opt-out.ts:43–46`).
`{Business}` is the name the text-back uses (`brandDisplayName`, as `lib/voice/textback.ts` applies it; the old
citation `messages.ts:988` now points at other keys).

| Kind | English | Spanish |
|---|---|---|
| stop confirmation | `{Business}: You won't get any more texts from us. Reply START to get them again.` | `{Business}: Ya no le enviaremos mensajes. Responda START para volver a recibirlos.` |
| start confirmation | `{Business}: You'll get our texts again. Reply STOP to stop them.` | `{Business}: Listo, le enviaremos mensajes de nuevo. Responda PARAR para dejarlos.` |
| help | `{Business}: Reply STOP to stop texts from us. Call or text this number for help.` | `{Business}: Responda PARAR para dejar de recibir mensajes. Llame o escriba a este numero para recibir ayuda.` |

The help line's second sentence (added 2026-09-28, danlo's decision; PR-2 plan S12) is the contact the A2P campaign
promises (`docs/runbooks/a2p-registration.md:197-199`). "numero" is unaccented on purpose: "número" would push the
Spanish help from one GSM-7 segment to two UCS-2 segments.

The start confirmation uses the language of the stop it lifts, and English otherwise.

**The phrase list** (`apps/web/src/lib/consent/phrases.ts`) is matched against the normalised text (accents, case,
apostrophes and punctuation ignored). Reviewed in PR-2 (danlo, 2026-09-28, four decisions, and the orchestrator's calls
under them; PR-2 plan S9) and extended only with tests, it has four kinds. Where a false hold and a missed stop
conflict, it holds: staff clear a false hold in one click.

- **Sentence phrases, as whole words anywhere in the message.**
  - **English:** stop texting, stop sending, stop messaging, stop contacting, dont text, do not text, dont message, do
    not message, no more texts, no more messages, remove me, take me off, unsubscribe me, wrong number, no more
    texting, do not contact me, dont contact me.
  - **Spanish, about messages on their own:** no quiero mas mensajes, no quiero mensajes, no quiero sus mensajes, no
    mas mensajes, no mas textos, numero equivocado; and quitenme / quiteme / quitame / saquenme / saqueme / sacame de
    su lista or de la lista. Any "… de la lista …" holds, "Quítame de la lista del sábado y ponme el domingo" included
    (danlo's list form); only "lista de espera" (a waiting list) does not. ("no quiero sus mensajes" added by the
    orchestrator, 2026-09-28, dispatch-task-4: it holds anywhere, like "no quiero mensajes".)
- **Spanish verb forms, ONLY ABOUT MESSAGES** (danlo): no me manden / mande / mandes / envien / envie / envies /
  escriban / escriba / escribas; dejen / deje / deja de mandar(me) / enviar(me) / escribir(me); no quiero recibir; no
  me vuelvan / vuelva / vuelvas a mandar / enviar. Each counts only with a message object:
  - a **message word** right after the form, anywhere in the message: mensajes, textos, sms, msjs, mensajitos, ningun
    mensaje, sus mensajes ("No me envíen ningún mensaje", "No me vuelvan a mandar mensajes");
  - or **"mas" / "nada"** (also "nada mas", "nunca mas") only at the END of the message, courtesy words aside, or right
    before a message word: "No me manden más", "No me mande nada, gracias" and "No me mande más mensajes" hold; "No me
    manden más a Pedro", "No me mande más de dos trabajadores" and "No me mande nada por correo" do not.
  A bare mandar or enviar form does not hold ("No me mande la factura", "Dejen de mandarme"): "mandar" can mean a crew
  or an invoice. "mensajes de voz" counts as messages: "No me mande mensajes de voz, mejor texto" is a false hold staff
  clear in one click, and excluding it missed "no me manden mensajes de voz ni textos" (orchestrator).
- **Whole-message phrases:** "please stop" and "stop please" (English, exact); in Spanish "borrenme", "borreme",
  "borrame", "borren / borre / borra mi numero", the escribir forms "dejen / deje / deja de escribirme" and "no me
  escriban / escriba / escribas", and "no me vuelvan / vuelva / vuelvas a escribir". They count ONLY when they are the
  whole message, punctuation aside; the Spanish ones may carry ONE leading "ya" / "por favor" / "porfa" / "porfavor"
  and ONE trailing "por favor" / "porfa" / "porfavor" / "gracias" / "ya" (orchestrator). "Please stop!!", "¡Bórreme!",
  "Ya no me escriban", "No me escriban, gracias", "Borren mi número" and "Por favor borre mi número" hold; "Please
  stop by Thursday", "Bórreme la cita del lunes", "No me escriba el martes, mejor llámeme", "Ya no me escriba, yo le
  llamo", "Borre mi número viejo, use el nuevo" (a number change) and "Borren mi número de la cita" (an appointment
  detail) do not. "escribir" is always about messages — writing to the customer is texting them — and a missed stop
  is worse than a false hold (decision 27), so its bare forms hold as the whole message while mandar and enviar stay
  object-only. ("borren / borre / borra mi numero" added by the orchestrator, 2026-09-28, dispatch-task-4: same rule
  and courtesy wrapper as "borrenme" / "borreme" / "borrame".)
- **A stop word repeated as the whole message:** "stop stop", "parar parar", "alto alto", "baja baja", any number of
  repeats (English also with one "please" at either end, Spanish with the courtesy words); one word on its own is a
  keyword (decision 10), not a phrase.
- No sentence phrase contains another, so the order of the lists never changes whether a text holds.

A false match only holds messages, and staff undo it in one click. A missed sentence is the risk, which is why staff
can still record a stop by hand.

**Grants** (decision 8). Each is appended once per address, per source:
- **Form:** a ticked consent field appends a `granted` row for each address submitted (the phone as `sms`, the email
  as `email`). Method `form`; the evidence holds the form id, the submission id and the label exactly as shown. The
  label is operator-written (§2), so a row records what was shown and ticked, not a legal conclusion.
- **Booking:** a booking with a phone appends `granted` (`sms`, method `booking`, the booking id).
- **Texting first:** step 6 above.

**Staff controls** (server actions in the contacts section, behind `requireAccountAccess`):
- **Stop texts / Stop emails** appends `revoked` (method `staff`, optional note) at once. Undo appends `resubscribed`
  (method `staff_undo`).
- **Resume** appends `resubscribed` (method `staff`) with a required note. It is offered only when the newest
  `revoked` row's method is `staff`, `free_text` or `backfill_0049` (choice 19).
- **Confirm stop** on a hold appends `revoked` (method `free_text`). **Not a stop** appends `hold_released`. Undoing
  either one appends `held` (method `staff_undo`), which puts the contact back On hold.
- **The number's country** (Mexico +52 / US +1) rewrites the contact's phone and clears the flag. Undo restores both.

**Telnyx backfill.** Telnyx's API lists a messaging profile's opted-out numbers (**verified 2026-09-28**,
`GET /v2/messaging_optouts`, PR-2 plan F6 and F10: each row's `from` is the business's number and `to` the
customer's), so a one-off script appends `revoked` (method `backfill_telnyx`) for each `to`, in the account that owns
the `from` number. danlo sees the count first. Because no account has texted a customer (§2), the list is expected to
be short.

### 4.3 PR-3: email

**The customer-initiated transactional class.** An email is in this class only if all four of these hold:
- it is sent to the person whose own action caused it;
- it is sent inside the same request, or the same live call, that action started;
- it is about only that action;
- no cron pass sends it.

This class sends after an unsubscribe (decision 7). The registry flags such kinds, and a source scan (§8) pins them to
the listed files. Paths below are under `apps/web/src/`.

| Kind | Sent from | To | Class | After an unsubscribe |
|---|---|---|---|---|
| `booking.confirmation` | `app/b/[publicId]/actions.ts:436` | customer | customer_initiated | **sends** |
| `forms.receipt` | `lib/forms/enrich.ts:411` | customer | customer_initiated | **sends** |
| `voice.booked` | `lib/voice/tools/registry.ts:264` | caller | customer_initiated | **sends** |
| `voice.moved` | `lib/voice/tools/registry.ts:365` | caller | customer_initiated | **sends** |
| `automation.reminder` | `lib/automations/passes/reminders.ts:80` | customer | informational | stops |
| `automation.followup` | `passes/followups.ts:121` | customer | informational | stops |
| `automation.review_request` | `passes/review-request.ts:304` | customer | marketing | stops |
| `automation.referral_ask` | `passes/referral-ask.ts:345` | customer | marketing | stops |
| `automation.reactivation` | `passes/reactivation.ts:197` | customer | marketing | stops |
| `automation.quote_followup` | `passes/quote-followup.ts:294` | customer | marketing | stops |
| `automation.no_show_nudge` | `passes/no-show-nudge.ts:281` | customer | marketing | stops |
| `staff.composer_email` | `conversations/actions.ts:77` | customer | staff_typed | sends, with a notice to staff (choice 22) |
| `operator.booking_alert` | `app/b/[publicId]/actions.ts:415` | staff | operator | not subject (choice 23) |
| `operator.cancel_notice` | `app/b/[publicId]/cancel/[token]/actions.ts:183` | staff | operator | not subject |
| `operator.lead_alert` | `lib/forms/enrich.ts:358` | staff | operator | not subject |
| `operator.call_alert` | `lib/voice/finish-call.ts:417` | staff | operator | not subject |
| `operator.weekly_report` | `passes/weekly-report.ts:121` | owner | operator | not subject |
| `operator.agency_report` | `passes/weekly-agency-report.ts:118` | agency | operator | not subject |
| `operator.billing_link` | `lib/billing/billing-link.ts:236` | client | operator | not subject |
| `operator.sender_check` | `lib/email/preflight.ts:34` | admin | operator | not subject |

**Headers and footer.**
- `SendEmailInput` gains `headers` and `resend.ts` passes them on. That the Resend SDK accepts them is an assumption
  (§11).
- Every email whose recipient is a customer (the first twelve rows) carries both:
  - a footer link in the branded shell, "Don't want these emails? Unsubscribe." or "¿No quiere recibir estos correos?
    Cancelar suscripción.", in the email's language;
  - the headers `List-Unsubscribe: <https://…/api/unsubscribe/{token}>` and `List-Unsubscribe-Post:
    List-Unsubscribe=One-Click` (RFC 8058).
- The customer-initiated ones carry them too, so the way out is always visible.
- Operator mail carries neither.

**The token.**
- It is `base64url(payload).base64url(mac)`. The payload is `{v:1, a:accountId, c:"email", t:address, i:issuedAt}`,
  and the MAC is HMAC-SHA256, following the form token's pattern (`lib/forms/guards.ts:45–85`).
- The secret is a new env var, `CONSENT_TOKEN_SECRET`. It is required in production, the way the Resend key is
  (`lib/email/index.ts:34`), and it has **no** fallback to the service-role key (unlike `guards.ts:37–41`).
- `CONSENT_TOKEN_SECRET_PREVIOUS` is optional and is still accepted when verifying, so a rotation does not break links
  already sent.
- Tokens do not expire. The channel field lets SMS use the same format later.

**Endpoints.** Both are public and are added to the middleware's public routes (`apps/web/src/proxy.ts:3` protects
only `/dashboard(.*)` today).
- `GET /u/[token]`: verifies the token and, if the address is allowed, appends `revoked` (method `unsubscribe_link`),
  then renders the page (§6). Its ghost "Resubscribe" posts a server action that appends `resubscribed` (method
  `unsubscribe_page`).
- `POST /api/unsubscribe/[token]`: the RFC 8058 target. It verifies, appends `revoked` (method `one_click`) if the
  address is allowed, and returns 200 with no body, with no cookies and no redirect.
- Both are idempotent: an address that is already stopped gets no second row. A bad token gets a 400 on the endpoint
  and the error page on `/u`.

**The 0049 fold.**
- PR-3's migration appends `revoked` (method `backfill_0049`, `occurred_at` = the column's value) for every contact
  whose `marketing_email_opted_out_at` is set and whose email is present.
- The readers listed in §2 switch to the ledger:
  - the referral ask and reactivation skip on the email state, and every other email kind now does too, through the
    gate;
  - the summary API reports the email state;
  - the drawer's switch is replaced by the email row (§6).
- The backfill's count is reported before production runs it (choice 24).
- Until PR-3 ships, the plan's interim routine stands: forwarded "stop" replies are set by hand
  (`crm-features.md:1099`).

**Routing.** The harness's email factory, every row above, and the `ctx.email()` path call the gate's `sendEmail`. The
ledger check is skipped for `customer_initiated`, `staff_typed` and `operator` kinds, but they still pass the gate.

## 5. Safety, failures, rollout

- **Fails closed.** A ledger, flag or zone read error blocks the send, the error is logged through `loggableError` (`apps/web/src/lib/billing/billing-link.ts:74`), and
  the send is retried: an automation, a released hold, the instant reply and the text-back are re-held for 15 minutes
  (§4.1 item 4), the last two for at most 24 hours after their trigger (the age cap); the composer and the alert code
  show an error line. A ledger write error on an inbound stop returns
  a 5xx so Telnyx retries.
- **One confirmation.** At most one BIS confirmation per `revoked` row, only within five minutes, never for an address
  that was already stopped, and none when Telnyx has already replied (decision 12, §11).
- **Mail scanners.** A corporate mail filter that opens `/u/[token]` records a revoke nobody asked for. That errs
  toward sending less, the drawer shows it as "unsubscribe link", and the page's Resubscribe recovers it (choice 27).
- **Privacy.**
  - The token carries the email address base64-encoded, not encrypted, so request logs can hold it. That is accepted,
    because the owner chose a stateless signed token (decision 6).
  - The route never logs the token itself.
  - Evidence excerpts are capped at 160 characters.
- **The carrier.** One Telnyx messaging profile per texting account is a go-live precondition, because a stop on a
  shared profile blocks every business on it while BIS's per-account ledger would not (`crm-features.md:1099`).
- **Rollout.** One PR each, in this order. PR-3 depends only on PR-1 and may run beside PR-2.
  - **PR-1** changes behaviour at once, but no customer can tell yet because the A2P gate holds all texting (§2):
    quiet hours become fixed and their switch disappears, the text-back waits for the window, and flagged numbers are
    held. Automated email also moves to the fixed window.
  - **PR-2** starts reading keywords on every inbound text.
  - **PR-3** puts the footer and headers on every customer email at once, and its 0049 fold widens those opt-outs
    (choice 24). danlo sees the count first.
- **Migrations** go to the CI project first, then production, then a parity check. Backfills are idempotent: they skip
  an address whose newest row already came from the same backfill method.

**Blocking go-live, not merge** (texting stays off for every account until all of these hold, `crm-features.md:1098`):
1. **Step 0:** the Telnyx profile keyword configuration.
   - Every stop word of decision 10 (Telnyx's defaults with the Spanish words, NO MAS and NO MÁS, REVOKE, OPT OUT
     and OPTOUT) is listed in ONE opt-out config per sender country — US, MX and CA (danlo, 2026-09-28, so a
     Canadian +1 sender gets the named reply too; PR-2 plan S11) — whose reply is the bilingual stop line of §4.2.
   - START and UNSTOP are Telnyx defaults, reserved and always active: nothing to register (corrected 2026-09-28,
     PR-2 plan S2). START/UNSTOP and HELP/AYUDA each get one bilingual config per country too, whose replies are
     §4.2's start and help lines, English then Spanish, with the business name (danlo, 2026-09-28).
   - Telnyx's AI opt-out detection stays OFF on every profile: it would turn a free-text message into a carrier block
     that only the customer's START lifts, against choice 20 and decision 5 (PR-2 plan F8). It is read before and
     after the configs; `true` stops the rollout, turning it off is a Telnyx write under danlo's go with a read-back,
     and an absent field is unknown, not off (S11).
   - Telnyx's existing opt-outs are imported into the ledger BEFORE any number moves off the shared profile: whether
     a number's opt-outs follow it to a new profile is not documented, and the inference from Telnyx's per-profile
     blocks is that they do not (PR-2 plan A5, S11).
   - Done per account profile (`crm-features.md:1099`, :1172).
2. **The Telnyx answers** listed in §11 are confirmed, and PR-2's reconciliation is adjusted to them.
3. **Step 6:** counsel reads the adopted FCC order against this design, in the week it is published
   (`crm-features.md:1178`, :1106).
4. **The two hardening-sprint preconditions** (F-114, tracked outside the repo, `crm-features.md:1174`, :1186–1188):
   **danlo to name.**
5. **A2P 10DLC approval** for each texting account (`crm-features.md:1098`).
6. **PR-2 merged.** Until it is, BIS records no START, so a carrier stop (`carrier_block`, recorded from PR-1 on)
   can never lift.

## 6. Screens (DESIGN.md: tokens only, both themes, loaded/empty/error, plain copy)

- **Contact drawer: a "Messages" block** replaces the "No marketing emails" switch (`contact-drawer.tsx:200–204`,
  `contact-fields-panel.tsx:78–82`). It has two rows, Texts and Email, and each row shows a status dot + word from the
  status tokens (rule 3), then one line of how and when. The block lands in parts:
  - PR-1 ships the Texts row's Check number state (F-009);
  - PR-2 ships the rest of the Texts row;
  - PR-3 ships the Email row and removes the 0049 switch.
  - **Allowed:** ghost "Stop texts" or "Stop emails". It runs at once with the undo toast "Texts stopped. Undo."
    (rule 6).
  - **Stopped:**
    - "Since 3 Oct · they texted STOP", "· they wrote 'ya no me manden', confirmed by Ana", "· you recorded it: asked
      on the phone", "· unsubscribe link", or "· the carrier blocked it".
    - Where choice 19 allows it, a ghost "Resume texts…" opens an inline note, "What did they ask for? (required)",
      with the one primary "Resume texts" (rule 8: that inline form is its own view).
    - Where it does not: "They can text START to get texts again." For email: "They can resubscribe from the
      unsubscribe link in any email from you."
  - **On hold:** "They wrote 'ya no me manden'. Texts are on hold." Ghost "Confirm stop" and "Not a stop", each at once
    with an undo toast.
  - **Check number:** "This number could be Mexican or US." Ghost "Mexico (+52)" and "US (+1)", each at once with an
    undo toast.
  - **Loading** is a two-row skeleton. **Error:** "Couldn't load their message settings. Try again." There is no empty
    state, because every contact has a state. These two states apply **from PR-2**, when the block has rows to load.
    PR-1's Check number row renders only from the drawer's loaded summary, and uses the drawer's own skeleton and
    error.
  - The Check number row follows the number: a phone edit re-reads the summary, so a number made ambiguous shows the
    row, and one corrected hides it, without a reload.
- **The conversation composer.** When texts are stopped, held or the number is unconfirmed, the text composer is
  disabled with one line, e.g. "They stopped texts on 3 Oct. You can't text this number until they text START." When
  email is unsubscribed, the email composer stays usable with the notice "They unsubscribed from your emails on 3 Oct.
  Write only about something they asked you for." (choice 22).
- **To-do rows.** The row's text renders from `messages.ts` whenever `consent_event_id` is set. The English and
  Spanish strings are both written out (`crm-features.md:1052`, :1177), and `tasks.title` stores the English line for
  exports.
  - **Hold.** English: "{name} may have asked to stop texts: “{excerpt}”. Texts to them are on hold." with "Confirm
    stop" / "Not a stop". Spanish: "{name} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes están en
    pausa." with "Confirmar" / "No era eso".
  - **CANCEL.** English: "{name} texted {word}, so their texts are stopped. Check whether they also meant their
    appointment on {date}." Spanish: "{name} envió {word} y sus mensajes quedaron suspendidos. Revise si también
    quería cancelar su cita del {date}."
- **Automations page, quiet hours.** The switch and the time pickers become read-only text: "Automated texts and
  emails go out between 8 a.m. and 9 p.m. in your time zone ({zone}). Marketing texts wait until 9 a.m., and on
  Sundays until noon. Anything due overnight goes out when the window opens, unless it's a reminder that would arrive
  after the appointment." (Corrected: the first wording promised the late reminder that choice 21 skips.)
- **Settings, alert phone.** A country choice, US (+1) / Mexico (+52), beside the number (spelled as the drawer spells
  it). When the code is blocked by a stop, including the FIRST attempt, which the carrier refuses (`40300`) before
  the ledger knows: "This number has stopped texts from your business line. Text START to it from that phone to turn
  them back on." A number typed with a country code that disagrees with the choice gets its own line and no code.
- **`/u/[token]`** is branded with the client's logo and brand colour (rule 9). It shows English and Spanish stacked,
  because the token carries no language.
  - **Loaded:** "You're unsubscribed. {Business} won't send you any more automated emails. You'll still get a
    confirmation when you book or ask for something." / "Listo. {Business} ya no le enviará correos automáticos. Si
    reserva o pide algo, sí recibirá la confirmación." It has one ghost button, "Resubscribe / Volver a suscribirme",
    and no primary.
  - **After Resubscribe:** "You'll get emails from {Business} again." / "Volverá a recibir correos de {Business}."
  - **Error (bad token):** "This unsubscribe link doesn't work. Reply to any email from the business and ask them to
    stop." / "Este enlace no funciona. Responda a cualquier correo del negocio y pida que dejen de escribirle."
  - It is server-rendered, so there is no loading state.
- **Emails:** the footer line of §4.3 goes in the branded shell. There is nothing new for ⌘K, since no settings section
  is added. `/styleguide` gains the dot+word consent statuses.

## 7. Delivery and estimates

The plan costs the SMS chain at **8–10 engineer-weeks** (`crm-features.md:1179`):
- step 1, 1.5–2;
- step 3, 1.5;
- step 4, 2–3 (S-05) plus 2–2.5;
- step 5, 1.

Of that, 6–7 is counted in §4.2 and S-05's 2–3 in the first release (:1266–1267).

| PR | Contents | Plan steps | Estimate (ew) |
|---|---|---|---|
| **PR-1** | The ledger migration and RLS; F-009 (normalisation, +52, the flag, its backfill and the drawer's country control); the class registry and fixed hours; the gate; all five SMS paths through it; the source scans | 1, 3, and step 4's gate share | **5–6** (1.5–2 + 1.5 + 2–2.5) |
| **PR-2** | Inbound keywords, START and HELP, the confirmation and the Telnyx reconciliation, the phrase list and holds, grants, the drawer's Messages block and the To-do rows, the Telnyx backfill | the rest of step 4, and step 5 | **3–4** (2–3 + 1) |
| **PR-3** | Email kinds in the registry, the footer and headers, the token, `/u/[token]` and the one-click endpoint, the 0049 fold and backfill, every email path through the gate, the customer-initiated rule | not in the plan | **3–4.5, this spec's own estimate** (the plan costs no email chain) |

- PR-1 and PR-2 come to 8–10 ew, which is the plan's chain total.
- Sofía asking the caller which country a number belongs to is F-009's voice half and is out of scope here (§9), but
  step 1's figure is kept whole, because the plan does not break it out.
- With PR-3 the chain is **11–14.5 ew**.
- The planning date for texting is 1 December 2026 (`crm-features.md:1160`). Email already sends today, so PR-3 has no
  date to wait for.

## 8. Testing (tier HIGH: legal)

- **Unit tests.**
  - `normalisePhone`: a table of US-only, MX-only, both, neither, `+52 1`, `00 52`, carrier-supplied and border-city
    numbers.
  - The keyword matcher: every word with and without accents, in any case, with trailing punctuation and with inner
    spaces. Non-matches too: "stop by at 3", "Cancel my appointment please", and "No".
  - The phrase list: each phrase in context, plus a fixed negative set.
  - The state reducer: tables of event sequences, including a keyword stop landing between a hold and its release.
  - Hours: 20:59 and 21:00, Sunday 11:59 and 12:00 for marketing, DST changeover days (in a zone whose clocks jump
    at midnight, such as Havana, and a Pacific zone, not only the test machine's own), and choice 21's expiry.
  - The token: sign and verify, a tampered payload, a wrong secret, and the previous secret.
  - Registry completeness.
- **Inbound route tests** use signed fixtures: each keyword branch; `autoresponse_type` present versus absent (one
  confirmation, never two); an already-stopped address; CANCEL with a booking; YES/NO unchanged; the free-text hold;
  the first-text grant; and a 5xx when the ledger write fails.
- **Source scans**, built on `lib/automations/imports.test.ts:18–48` and `send-sms.test.ts:189–220`:
  1. Outside the provider's own modules (`lib/sms/index.ts`, `telnyx.ts`, `fake.ts`; for email, PR-3's equivalents),
     only `lib/consent/gate.ts` imports `getSmsProvider`, `getEmailProvider`, the Telnyx or Resend modules or the
     `resend` package (PR-1 for SMS, PR-3 for email). The rest of `lib/sms/` is NOT exempt: `alerts.ts` is a send
     path, and `types.ts` could re-export the factory. Only `telnyx.ts` names Telnyx's messages endpoint, so no raw
     `fetch` goes around the gate.
  2. Every `kind` literal passed to the gate exists in the registry (any quoted string that starts like a kind, so a
     kind held in a constant is seen too).
  3. Only `packages/db/src/consent.ts` names the `consent_events` table (as any string literal), and nothing updates
     or deletes it.
  4. **PR-3, with the email kinds:** the EMAIL kinds flagged `customer_initiated` are used only in
     `app/b/[publicId]/actions.ts`, `lib/forms/enrich.ts` and `lib/voice/tools/registry.ts`, and never under
     `lib/automations/`. (For SMS the class changes only the hours; `automation.instant_reply` is
     `customer_initiated` and lives under `lib/automations/`, so the scan cannot apply to SMS kinds.)
  5. After PR-3, nothing reads `marketing_email_opted_out_at`, and after PR-1 nothing reads `quiet_enabled`.

  Each scan ships with a recorded mutation probe that makes it fail, so none of them can pass vacuously.
- **DB tests** on the CI project:
  - RLS: a client reads only its own account's rows, and no role can update or delete;
  - an account delete still cascades;
  - the `note` check;
  - backfill idempotency.
- **E2E** runs on the per-run fixture account, never Test Client One:
  - staff stop texts in the drawer, which shows Stopped with an undo, and the composer is disabled;
  - Resume refuses an empty note;
  - a simulated signed inbound STOP stops the contact, and the fake provider records one confirmation;
  - `/u/{token}` for a fixture contact shows the unsubscribed page, and Resubscribe restores it;
  - the one-click POST returns 200.

## 9. Out of scope

- The customer preference page and consent certificate (F-065's later part).
- Broadcasts and segments, and requiring a recorded grant before marketing (S-43, S-52; choice 29).
- AI stop detection (decision 5).
- Reading inbound email.
- Category questions (decision 2).
- The SB 140 registration card (F-066's later part).
- F-133's fraud and emergency flags.
- WhatsApp.
- A per-contact time zone.
- Sofía asking the caller for the country (F-009's voice half).
- Creating per-account Telnyx profiles (an operational step, `crm-features.md:1099`).
- The existing `outbound_suppressed` switch, which is unchanged.

## 10. Legal facts and their status

"Plan-cited" means the plan links a primary source (`crm-features.md` Appendix C, :3872–3895) and this spec did not
re-read it.

| Fact | Status |
|---|---|
| Since 11 April 2025, callers and texters must honour a revocation made by any reasonable means within ten business days | Plan-cited (47 CFR 64.1200, eCFR; `crm-features.md:1116–1117`, :3874) |
| The "revoke all" provision's outer date is **31 January 2027** (Bureau order DA 26-12, 6 January 2026) | Plan-cited (`crm-features.md:1118–1124`, :3877–3878) |
| A draft rewrite (FCC-CIRC 2609-05, 9 September 2026) was set for a vote at the 30 September 2026 open meeting and **had not been adopted** when the plan was written. As drafted, it would take effect 30 days after Federal Register publication | Plan-cited (`crm-features.md:1125–1152`, :3875–3876). Its adoption is unknown to this spec |
| Today's (a)(12): one confirmation, no promotion, presumed consented within five minutes | Plan-cited (`crm-features.md:1106`, :1147–1149) |
| 47 CFR 64.1200(c)(1): 8 a.m. to 9 p.m. at the called party's location | Plan-cited (`crm-features.md:3881`). Whether it reaches informational texts is an **assumption**; BIS applies it to all automated texts by choice (decision 4) |
| Tex. Bus. & Com. Code §301.051: 9 a.m. to 9 p.m. Monday to Saturday, noon to 9 p.m. Sunday | The statute is plan-cited (`crm-features.md:3883`). The hours are danlo's reading and an **assumption**, and whether they reach texts is for counsel |
| CAN-SPAM: a working opt-out mechanism, honoured within ten business days | Plan-cited (FTC guide, `crm-features.md:3894`). That the mechanism must work for at least 30 days after sending is an **assumption** from the same guide |
| RFC 8058 one-click: a POST of `List-Unsubscribe=One-Click` to an HTTPS URL | External standard, not cited by the plan. An **assumption** to verify, as is the claim that large mailbox providers expect it of bulk senders |
| **1 December 2026** | The plan's planning date for texting, not a legal date (`crm-features.md:1160–1163`) |

## 11. External assumptions to verify at build time (not repo facts)

- **Telnyx** (before the PR-2 implementation plan; answered 2026-09-28 from Telnyx's documentation, PR-2 plan F1–F11):
  - ~~that the inbound message webhook carries `autoresponse_type` when Telnyx has auto-replied to a keyword, and what
    its values are~~ **VERIFIED:** it does, on `message.received`, absent when no keyword matched; documented values
    START, STOP, HELP;
  - ~~whether custom Spanish opt-out keywords, and START and UNSTOP as opt-in, can be registered per profile~~
    **VERIFIED:** custom keywords are added per profile (at most 20 per config); START and UNSTOP are defaults,
    always active;
  - ~~whether the auto-reply text is configurable per profile, and in which language it is sent~~ **VERIFIED:** per
    profile and per sender country, one reply per config; two replies in two languages for ONE country is **NOT
    FOUND** in Telnyx's docs;
  - ~~whether a profile-level block also stops BIS's own confirmation~~ **VERIFIED:** it does; there is no exemption;
  - ~~the error code for a send to an opted-out number (for `carrier_block`)~~ **VERIFIED 2026-09-26:** `40300`,
    "Blocked due to STOP message" (developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out). Block rules
    are per messaging profile. The HTTP status of that refusal is still an assumption; the gate keys on the code;
  - ~~whether an API lists a profile's opted-out numbers (for the backfill)~~ **VERIFIED:** `GET /v2/messaging_optouts`;
  - ~~whether Telnyx retries an inbound webhook that gets a 5xx~~ **VERIFIED:** any non-2xx is retried, up to 3
    attempts per URL and then the failover URL; Telnyx expects an answer within 2 seconds;
  - **new, VERIFIED:** Telnyx offers per-profile AI opt-out detection; it stays off (§5 step 0);
  - still **NOT FOUND:** the HTTP status of the `40300` refusal (the gate keys on the code), and whether Telnyx's
    keyword match ignores punctuation, accents or inner spaces (checked live at go-live).
- **Resend:** the send call accepts custom `headers`.
- **`libphonenumber-js`:** its metadata tells US from Mexican 10-digit numbers as §4.1 needs. Tests pin the border area
  codes.
- **Postgres:** a cascade from `accounts` deletes ledger rows even though no role holds `delete`. A DB test proves it.

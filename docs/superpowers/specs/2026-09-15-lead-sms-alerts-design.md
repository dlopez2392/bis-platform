# Texting the business when work arrives — design

**Date:** 2026-09-15 · **Branch:** `docs/feature-specs` · **Base:** `6613c09`
**Status:** IDEA. Not planned, not scheduled. Nothing below is settled except
the findings, which were read from the tree rather than assumed.

## Why

danlo, 2026-09-15: when a potential customer books a meeting or asks for
information, a text should go to the number that business uses for texting.

The operator does not live in the dashboard. Email already goes out, and email
at 7 AM on a Saturday is not the same as a phone buzzing in a truck.

## What already exists, verified

Three alert paths already fire, **all of them email only**:

| Trigger | Where | Recipients |
|---|---|---|
| Form submission | `app/f/[publicId]/actions.ts` → `notify()` | `forms.notify_emails` |
| Booking created | `app/b/[publicId]/actions.ts` | `calendars.notify_emails` |
| Call finished | `lib/voice/finish-call.ts` | `calendar.notify_emails`, via `FinishContext.notifyEmails` |

The voice alert fires only for `booked`/`lead`/`message` outcomes (`isMeaningful`).

**Outbound SMS is fully built and working** — `lib/sms/telnyx.ts`,
`lib/sms/index.ts`, with a production gate requiring both `VERCEL_ENV` and
`NODE_ENV` to be `production`. `lib/sms/sender.ts`'s `resolveSmsSender` is the
single gate: it requires `accounts.a2p_status === 'approved'` and picks the
oldest `live` row in `phone_numbers`. It fails closed.

**Every existing SMS goes to the customer. None goes to the business.** The
complete list of send sites is the missed-call text-back, the four automation
passes, and the operator's manual reply in the inbox.

## The two things that do not exist

**1. There is no "the business's own number".** One `phone_numbers` table
(`0019_voice_core.sql`), one `e164` per row, globally unique. The number
customers *call* is the same row and field texts are sent *from*. Grepping
`notify_phone`, `alert_phone`, `owner_phone`, `business_phone`, `notify_sms`
returns nothing in schema or code.

The nearest thing is `VOICE_FORWARD_TO`, and it is not this: a **global** env
var that forwards calls away from the AI, platform-wide. Not per-account, not a
notification destination. See `2026-09-15-call-handoff-design.md`.

**2. There is no account-level recipient list.** Recipients are per-event and
scattered across three tables: `forms.notify_emails`, `calendars.notify_emails`,
`accounts.report_emails` (weekly report only, agency-written, deliberately
without an `authenticated` UPDATE grant).

`0031_weekly_report.sql`'s own comment already names this gap:

> There is no account-level recipient in this schema today: every
> operator-facing email (lead alerts, booking alerts, voice summaries) goes to
> a FORM's notify list… An account with no form would otherwise be unreachable.

So this feature is really two: a **destination** and a **channel**. The
destination gap is pre-existing and bites email today.

## Open questions — none of these are decided

**Whose number is it?** One number per account, or a list like the email
arrays? A landscaper with two crews is not the same as a solo operator.

**Which events text, and who chooses?** All three, or only the ones worth
waking someone for? The weekly report's field-is-the-switch pattern is the
obvious precedent — no number, no text, and that is not a failure.

**Does it replace email or join it?** Both channels for the same event is
noise. Only SMS is a regression for anyone who works from an inbox.

**What does a text cost, and who pays?** Every alert is a billable segment on
the account's own A2P registration. An account with a busy form could generate
real volume. `lib/sms/segments.ts` already counts segments.

**Does an alert to the business consume the A2P gate?** `resolveSmsSender`
requires `a2p_status === 'approved'`. An operator alert is arguably
business-to-self rather than business-to-consumer, but the carrier does not
know that, and the number sending it is the same one.

**What happens when the business replies to the alert?** Inbound texts land in
`api/sms/inbound/route.ts`, which creates a contact and a conversation. A reply
from the operator's own phone would create a contact **for the operator**.
That is a real bug waiting to happen and it needs an answer before any of this
ships.

## Out of scope

Push notifications. A mobile app. Per-user routing (`users` has 0 rows).
Changing how email alerts work today.

## Testing, when this is real

The A2P gate and the production send gate are the two things that must not
regress. Any test that sends must run on the per-run fixture account.

The operator-replies-to-an-alert case deserves a test before the feature
exists, because it is the one that quietly corrupts the CRM.

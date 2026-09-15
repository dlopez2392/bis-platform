# Meeting transcripts and AI notes — design

**Date:** 2026-09-15 · **Branch:** `docs/feature-specs` · **Base:** `6613c09`
**Status:** BLOCKED on a product decision. Not an engineering problem yet.

## Why

danlo, 2026-09-15: when we have meetings on the software, can they be
transcribed and broken into notes by AI?

## The decision that has to come first

**Meetings are not held in this product today. They are scheduled.**

`calendars.meeting_type` is `in_person | phone | video`. For `video`, a room is
created at booking time and its URL stored on `bookings.meeting_url`. The
provider is Daily.co (`lib/meetings/daily.ts`), and the interface
(`lib/meetings/provider.ts`) has **exactly one method**:

```ts
createMeetingRoom({ bookingId, endsAt }) → { url }
```

The URL is emailed and that is the end of the product's involvement. There is
no meeting route in the app, no embedded client, no `@daily-co` dependency.
The customer clicks through to a third party's hosted room.

`DAILY_API_KEY` is blank in `.env.example` and absent from `.env.local`, so
**video meetings are dormant right now** — even room creation. Both write paths
are best-effort; a missing provider silently leaves `meetingUrl` undefined.

So the question is not "how do we transcribe meetings". It is:

> **Do meetings happen inside this product?**

Everything else follows from that, and it is danlo's call, not an engineering
one. Until it is answered there is nothing to design.

## What exists, and what it is not

**Phone calls already have a real transcript.** Turn-by-turn, both sides,
persisted. `session-config.ts` configures `gpt-4o-mini-transcribe`;
`call-events.ts` captures assistant and caller turns as
`{ role, text, at }`; `finishCallRow` writes `calls.transcript` at hangup.
Rendered as a two-sided conversation with clock times in `transcript-view.tsx`.

**No audio is stored anywhere.** Text only.

**Phone calls already have an AI summary**, with a hallucination guard worth
studying before anything similar is built elsewhere: `summarize.ts` builds a
deterministic fact line from state, regex-checks the model's prose against that
state, and prefixes a ⚠ MISMATCH banner when they disagree. It caught a
fabricated appointment on an empty transcript this week.

**It is prose, not notes.** Three or four sentences in a single column. No
action items, no decisions, no attendees, no sections.

### The conflation risk, stated plainly

Everything transcript- and summary-shaped lives under `lib/voice/`, keyed to the
`calls` table, the OpenAI SIP socket, and `CallState` — an in-process object
that dies with the phone call. **None of it is reachable from a booking.**
`calls` and `bookings` join only via `calls.booking_id`, set when the AI booked
during that call.

There is no media pipeline and no data model on the meeting side that any of
the call machinery could be pointed at without new plumbing. "We already do
this for calls" is true and misleading in the same breath.

## What a meeting's outcome looks like today

A human clicks a button. `bookings.status` is
`booked | cancelled | completed | no_show`, set from the Calendar list or, since
this week, from the work queue. Terminal — there is no un-complete path.

`bookings.note` exists but holds the **request** note captured at booking time.
Nothing writes to it afterwards.

The follow-up, no-show nudge and review-request passes are all template-driven
with operator-authored prose. Zero AI.

## If the answer is "meetings stay outside the product"

Then this is an integration question, not a feature. Daily.co supports
recording and transcription; this integration exposes neither, sends no
`enable_recording` or `enable_transcription`, has no webhook handler, and calls
no recordings or transcript endpoint. The scope was locked deliberately in
`2026-08-28-video-meetings-followups-design.md` to room links plus follow-up
emails.

The work would be: turn the key on, enable the provider's own features, handle
its webhook, store what comes back. Bounded, and mostly plumbing.

## If the answer is "meetings happen here"

That is a much larger product, and worth naming honestly: an embedded client, a
media path, consent and recording law per participant, storage and retention of
audio, and a transcription pipeline that is not the phone one.

## Open questions, once the decision is made

**Consent.** Recording a two-party conversation has legal requirements that
vary by state. The product already has consent copy for form submissions and
stores the exact wording agreed to — the same seriousness applies here, more so.

**Notes of what shape?** "Break it into notes" could mean action items,
decisions, a summary, or a follow-up draft. The phone summary is prose because
a staff alert wants prose. A meeting record probably wants structure.

**Where do notes live?** On the booking, on the contact's timeline, or both.
The contact timeline is the surface that already aggregates.

**What about phone and in-person meetings?** Two of the three meeting types
have no digital surface at all. A feature that only serves `video` serves the
type that is currently switched off.

## Out of scope

Live transcription during a call. Speaker diarisation beyond two parties.
Translation. Anything touching the existing phone transcript, which works.

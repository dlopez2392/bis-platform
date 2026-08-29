# Video Meetings + Follow-up Emails — Design

**Date:** 2026-08-28 · **Milestone:** Voice sub-project 3 · **Approved by:** danlo (section-by-section, this session)

## Goal

A booking must lead to a meeting. Video-type companies get an auto-generated,
expiring video room link on every booking (Teams/Zoom-style click-to-join, no
accounts for anyone); every company can opt into a next-morning follow-up email;
and the three exit-gate dry-run findings are fixed so the wizard's next walk —
the first real client — has zero rough edges.

## Locked decisions (do not re-litigate)

1. **Provider: Daily.co** behind a provider abstraction (email-provider
   pattern); Jitsi is the recorded zero-cost fallback, swappable in one file.
   One BIS account (`DAILY_API_KEY`); per-booking private rooms with
   unguessable names, auto-expiring ~1h after the appointment ends.
2. **Meeting type is a per-company calendar setting** (`in_person` default /
   `phone` / `video`). Per-booking choice is a recorded follow-up, layering on
   this as the default.
3. **Video bookings require an email, tool-enforced.** On a video calendar,
   `book_appointment` REFUSES the emailDeclined path with an instructive
   error; Sofía takes a message instead. Web widget already requires email —
   no change. (Prompt rules are wishes; tool contracts are enforcement.)
4. **Follow-ups: next-morning via the existing daily cron**, send-then-stamp
   (`followup_sent_at`), all bookings with a contact email, per-company
   toggle + editable body, **off by default**. Hobby cron = next-morning
   granularity; Pro upgrade tightens timing without redesign. Deferred
   (recorded): review-ask links, no-show branch, multi-email sequences.
5. **The three dry-run findings ride along** (§Findings below).
6. Design quality first-class on any touched UI (calendar settings, wizard
   cards, email templates).

## Part 1 — Data + Daily integration

**Migration 0022** (0021 is the latest applied; confirm still-free at plan
time), additive only:
- `calendars.meeting_type text not null default 'in_person'`
  check in (`in_person`,`phone`,`video`)
- `calendars.followup_enabled boolean not null default false`
- `calendars.followup_body text not null default ''`
- `bookings.meeting_url text` (nullable)
- `bookings.followup_sent_at timestamptz` (nullable)
- Column grants for the calendar settings patch follow the 0016/0018
  precedent (`meeting_type`, `followup_enabled`, `followup_body` added to the
  authenticated UPDATE grant; bookings columns are serviceDb-written only).

**Provider module** `apps/web/src/lib/meetings/`:
- `provider.ts`: `createMeetingRoom(input: { bookingId: string; endsAt: Date }): Promise<{ url: string }>` —
  interface + `getMeetingProvider()` reading env (like `getEmailProvider`).
- `daily.ts`: POST `https://api.daily.co/v1/rooms` with unguessable name,
  `exp` = endsAt + 1h, privacy via unguessable-name room. Timeout via
  AbortSignal (summary-service precedent). Errors throw; call sites decide.
- Unset `DAILY_API_KEY` → provider unavailable → video calendars behave like
  phone calendars (book without links), one log line. Dormant-until-configured
  (TELNYX_PUBLIC_KEY precedent). Runbook documents the env var.

**Room creation happens at booking time** in both write paths (web booking
action + voice `book_appointment`), and on reschedule (new booking row = new
room; the old room dies by expiry — cancel needs no API call).

**Failure rules:**
- **A room failure never fails a booking** (send-failure precedent): booking
  succeeds, `meeting_url` stays null, `console.error` logs it, confirmation
  goes out without the link. Operator sees the missing link on the calendar
  page. Regenerate-link affordance: recorded follow-up.
- No key configured → same path, one log, no error.

## Part 2 — Surfaces + voice behavior

- **Confirmation email**: "Join your video meeting" link block when
  `meeting_url` present (both web and voice bookings; template shell shared).
- **Reminder email**: includes the join link when present.
- **Operator calendar page**: video bookings show their join link (the
  company's side of the meeting).
- **Voice on a video calendar**: prompt states appointments are by video and
  an email is required for the meeting link; `book_appointment` (tool layer)
  rejects `emailDeclined: true` when `calendar.meeting_type === 'video'` with
  an instructive error ("video appointments need an email for the meeting
  link — take a message instead so a human can arrange it"). Sofía never
  reads a URL aloud — "you'll get the link by email."
- Link hygiene: `meeting_url` never logged; travels only in the customer's
  emails and the authenticated dashboard (cancel-token discipline).

## Part 3 — Follow-up engine

- **Same daily cron invocation** as reminders (`/api/cron/reminders` route
  gains a second pass; Hobby allows limited cron entries — one invocation,
  two passes, reminders first).
- `listDueFollowups(db, now)`: bookings with `status = 'booked'`,
  `ends_at` in `[now - 25h, now]` (mirror of the reminder window), calendar
  `followup_enabled`, `followup_sent_at is null`, contact email non-null.
  Send branded follow-up (company From/reply-to when configured; operator's
  `followup_body`, default text pre-filled in the UI), then stamp
  `followup_sent_at`. `{sent,failed,unstamped,skipped_no_email}` result shape
  like reminders.
- **Calendar page UI**: toggle + textarea with the default copy ("Thanks for
  coming in! If you have any questions or want to book again, just reply to
  this email."), same grant pattern as other calendar settings. Off by
  default — no client's customers get mail the client didn't choose.
- Cancelled bookings and no-email bookings are skipped with a log, never an
  error.

## Findings (from the wizard exit-gate dry run)

1. **Testing answers regardless of the receptionist toggle.** Both gates that
   decline calls (`/api/voice/incoming` step 7 and the TeXML classify) change
   to: decline when profile missing, or when `!profile.enabled` AND number
   status is `live`. A `testing` number answers with the profile as-is. `live`
   keeps requiring `enabled` (go-live's meaning). The two gates must stay in
   agreement — one shared predicate or paired tests.
2. **Wizard surfaces the Testing flip.** Number/test-call cards show the
   number's status; when `provisioned`, the test-call card offers a one-click
   agency-only "Enable test calls" button calling the existing
   `setNumberStatusAction` (status → testing). Card copy explains Testing.
3. **Summary speaks the account timezone.** `generateSummary` receives the
   account timezone and instructs the model to state times in it; the
   RECORDED fact line stays raw ISO (the honesty anchor). Test pins a
   UTC-vs-Central case.

## Security / failure posture

- `DAILY_API_KEY` server-side only, Sensitive in Vercel.
- Follow-up settings writes: same guard/grant discipline as calendar
  settings; e2e through a real session covers the new column grants (the
  recorded serviceDb-blindness lesson).
- Soft-and-loud degradation everywhere: room failure → booking survives +
  log; follow-up send failure → logged, unstamped, retries next morning;
  no email → skipped + log.

## Testing

- Provider mocked in unit tests: room-per-booking, expiry math,
  failure-never-blocks-booking (mutation-style pin).
- Registry: video-calendar email gate (emailDeclined → refused with the
  take-a-message error; email path books + link created).
- `listDueFollowups` window pure-tested both directions (ended-yesterday
  sends; cancelled / no-email / already-stamped / window-edge don't).
- Summary tz: pinned UTC-vs-Central case.
- Testing-status gate: both gates tested for the new predicate (testing+
  disabled answers; live+disabled declines; missing profile declines).
- e2e: calendar meeting-type + follow-up settings round-trip through a real
  session; a video booking's confirmation carries the link.
- Full gates: `pnpm check` · build · e2e suite.

## Exit gate

1. Flip a test calendar to video; one real **web booking**: confirmation
   email carries a working Daily link; both parties join in-browser.
2. One **phone call** on that video calendar declining email → Sofía refuses
   to book and takes a message (the new gate end-to-end).
3. The **follow-up arrives next morning** for a completed test booking with
   the company's text. Read-first teardown after.

## Deferred (recorded)

- Per-booking meeting-type choice (booker picks).
- Regenerate-meeting-link operator affordance.
- Review-ask / no-show / sequence follow-ups.
- Jitsi fallback implementation (interface ready).
- Client's own Zoom/Teams accounts as per-client integrations behind the
  same meeting-location setting.

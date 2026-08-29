# Video Meetings + Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily.co video room per booking on video-type calendars, next-morning follow-up emails, and the three wizard dry-run fixes.

**Architecture:** Provider abstraction (email-provider pattern) for rooms; room created at booking time in both write paths, never blocking a booking. Follow-ups = a second pass in the existing daily cron, send-then-stamp. Spec: `docs/superpowers/specs/2026-08-28-video-meetings-followups-design.md`.

**Tech Stack:** unchanged (Next.js App Router, @bis/db/PostgREST, Resend, vitest, Playwright).

## Global Constraints

- **Migrations 0001–0021 APPLIED — never re-apply. This milestone adds ONLY 0022** (controller applies to prod `tlbkbmlrfafquucsmsmm` after Task 1 review).
- Guard-then-`serviceDb()` writes; page/action reads via `dbForRequest()`; new `@bis/db` exports via `index.ts` (voice.ts/booking.ts are wildcard/explicit — match existing).
- **A room failure must never fail a booking** (send-failure precedent, pinned by test). `DAILY_API_KEY` unset = dormant (video behaves like phone; one log line).
- **`meeting_url` never appears in logs** (cancel-token discipline).
- Tool enforcement over prompt prose (the recorded lesson): the video email gate lives in `book_appointment`, not only in Sofía's instructions.
- The two call-accept gates (incoming webhook step 7, texml classify) must stay in agreement — shared predicate or paired tests.
- All copy through `m`; design quality first-class on touched UI; TDD; per-task gates: full web (and db where touched) suite + tsc + eslint + build for UI/route tasks. Commits: conventional prefixes.
- Report files use `-video` suffix (`.superpowers/sdd/task-N-report-video.md`); ledger = `.superpowers/sdd/progress.md`.

---

### Task 1: DB — migration 0022 + types + settings mapping + follow-up accessors

**Files:** Create `packages/db/supabase/migrations/0022_meetings_followups.sql` · Modify `packages/db/src/booking.ts`, `packages/db/src/index.ts` · Test `packages/db/src/test/booking.test.ts` (extend)

**Interfaces produced (later tasks consume verbatim):**
- `CalendarRow` gains `meeting_type: "in_person" | "phone" | "video"; followup_enabled: boolean; followup_body: string`
- `BookingRow` gains `meeting_url: string | null; followup_sent_at: string | null`
- `CreateBookingInput` gains `meetingUrl?: string`
- `CalendarSettingsPatch` gains `meetingType?; followupEnabled?; followupBody?` (camelCase, mapped in `updateCalendarSettings` like the others)
- `listDueFollowups(db, nowIso: string): Promise<DueFollowup[]>` where `DueFollowup = { bookingId; accountId; startsAt; contactEmail: string | null; contactName; accountName; accountTimezone; branding: Branding; fromEmail: string | null; replyToEmail: string | null; followupBody: string }` (mirror `DueReminder`'s join shape — read `listDueReminders` and copy its select/embed idiom)
- `stampFollowupSent(db, bookingId): Promise<void>` (mirror `stampReminderSent`)

- [ ] **Step 1: Migration** (file only — controller applies):

```sql
-- 0022: per-company meeting type + video room link per booking + follow-ups.
alter table public.calendars
  add column meeting_type text not null default 'in_person'
    check (meeting_type in ('in_person','phone','video')),
  add column followup_enabled boolean not null default false,
  add column followup_body text not null default '';
alter table public.bookings
  add column meeting_url text,
  add column followup_sent_at timestamptz;
-- Settings are client-editable like the rest of the calendar knobs (0016/0018
-- precedent). Booking columns stay serviceDb-written; SELECT already granted.
grant update (meeting_type, followup_enabled, followup_body)
  on public.calendars to authenticated;
```

- [ ] **Step 2: Failing tests** (withTestAccount idiom; unique fixtures): calendar defaults read back (`in_person`, false, ""); `updateCalendarSettings` round-trips the three new fields; `createBooking` with `meetingUrl` persists it and without leaves null; `listDueFollowups` both directions — a booked booking ended 2h ago on an enabled calendar with contact email → returned; each of (cancelled / followup already stamped / calendar disabled / ended 26h ago / ends in the future) → NOT returned; contact without email → returned with `contactEmail: null` (route decides to skip+log); `stampFollowupSent` sets the stamp (and second call is idempotent).
- [ ] **Step 3–4:** RED → implement (extend `CALENDAR_COLS`/`BOOKING_COLS`, the patch mapping, the two accessors modeled on the reminder pair) → full `pnpm --filter @bis/db test` + tsc GREEN. Note: the test db predates 0022 — the controller applies 0022 BEFORE this task's implementer runs tests (dispatch note), unlike 0021.
- [ ] **Step 5: Commit** `feat(db): meeting type + meeting_url + follow-up columns and accessors (0022)`

---

### Task 2: Meetings provider (Daily) + env docs

**Files:** Create `apps/web/src/lib/meetings/provider.ts`, `daily.ts`, `daily.test.ts`, `provider.test.ts` · Modify `.env.example`

**Interfaces produced:**
- `type MeetingProvider = { createMeetingRoom(input: { bookingId: string; endsAt: Date }): Promise<{ url: string }> }`
- `getMeetingProvider(env?: NodeJS.ProcessEnv): MeetingProvider | null` — null when `DAILY_API_KEY` unset/blank (callers treat null as "no video links today", one log).

- [ ] **Step 1: Failing tests:** `getMeetingProvider({})` → null; with key → provider whose `createMeetingRoom` POSTs `https://api.daily.co/v1/rooms` (fetch mocked) with Bearer key and body containing `properties.exp` ≈ `endsAt/1000 + 3600` (±5s) and an unguessable `name` (assert NOT derived from bookingId — two calls for the same bookingId give different names); non-ok response → throws with status in message; request carries an AbortSignal (summary-service precedent, 10s).
- [ ] **Step 2–3:** RED → implement:

```ts
// daily.ts (shape — complete the obvious plumbing)
export function createDailyProvider(apiKey: string): MeetingProvider {
  return {
    async createMeetingRoom({ endsAt }) {
      const res = await fetch("https://api.daily.co/v1/rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `bis-${crypto.randomUUID()}`,
          properties: { exp: Math.floor(endsAt.getTime() / 1000) + 3600 },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`daily rooms failed: ${res.status} ${await res.text().catch(() => "")}`);
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("daily rooms: no url in response");
      return { url: data.url };
    },
  };
}
```

`.env.example`: `DAILY_API_KEY=` with comment (Daily.co dashboard → Developers; unset = video calendars book without links; Sensitive in Vercel).
- [ ] **Step 4–5:** GREEN + tsc + eslint → Commit `feat(meetings): Daily room provider behind an abstraction (dormant until DAILY_API_KEY)`

---

### Task 3: Web booking path — room at booking time + confirmation link

**Files:** Modify `apps/web/src/app/b/[publicId]/actions.ts`, `apps/web/src/lib/email/templates/booking.ts` · Tests: both files' existing test files

**Interfaces:** consumes Task 1 `meetingUrl` input + Task 2 provider. Produces: `BookingConfirmationInput` gains `meetingUrl?: string` (Task 5 does the reminder template).

- [ ] **Step 1: Failing tests:** action test — video calendar (fixture `meeting_type: "video"`) + provider available → `createBooking` receives `meetingUrl` and the confirmation send's html contains the room url; provider THROWS → booking still returns ok (**the pin**), `createBooking` called with no `meetingUrl`, console.error spied; `meeting_type: "in_person"` → provider never called. Template test — `meetingUrl` present → "Join your video meeting" link in html AND a plain URL line in text; absent → neither (empty-cancelUrl precedent).
- [ ] **Step 2–3:** RED → implement. In the action, between the still-free check and `createBooking`: look up provider + `calendar.meeting_type === "video"`; try/catch `createMeetingRoom` (log on failure; NEVER log the url on success); pass `meetingUrl` into `createBooking` and the template input. Template: link block styled like the cancel link but promoted (it IS the meeting).
- [ ] **Step 4–5:** GREEN + gates → Commit `feat(booking): video room per booking + join link in confirmation (web path)`

---

### Task 4: Voice path — room creation + tool-enforced email gate + prompt line

**Files:** Modify `apps/web/src/lib/voice/tools/registry.ts`, `apps/web/src/lib/voice/system-prompt.ts`, `apps/web/src/lib/voice/session-config.ts` (VoicePromptInput gains `meetingType`) and `apps/web/src/app/api/voice/incoming/route.ts` (thread `calendar.meeting_type` into promptInput) · Tests: registry.test.ts, system-prompt.test.ts

**Interfaces:** ToolContext already carries `calendar` (now with `meeting_type` from Task 1 types).

- [ ] **Step 1: Failing tests (registry):** video calendar + `emailDeclined: true` → `{ok:false}` with error matching /video appointment.*email/ AND createBooking not called (**the gate**); video + real email → books, provider called, `createBooking` gets `meetingUrl`, confirmation email html contains url; video + provider throws → books without url (never-fail pin); non-video calendar + `emailDeclined: true` → books exactly as today (regression pin). **Prompt tests:** `meetingType: "video"` prompt contains the video line (below) and the booking-disabled branch doesn't; non-video prompt lacks it.
- [ ] **Step 2–3:** RED → implement. Registry: inside `book_appointment`, after the existing email gate, add:

```ts
      if (ctx.calendar.meeting_type === "video" && !email) {
        return { state, result: { ok: false,
          error: "This is a video appointment — an email is required for the meeting link. If the caller cannot give one, do not book: use take_message so a human can arrange it." } };
      }
```

then create the room (provider null or throw → book without url, console.error WITHOUT the url). Prompt (inside bookingEnabled when `input.meetingType === "video"`): `"- Appointments at this business happen over a VIDEO CALL. Tell the caller early that their appointment is a video meeting and that you need an email address to send their meeting link — for video appointments an email is required to book; if they cannot provide one, take a message instead. Never read a web link aloud; say the link arrives by email."`
- [ ] **Step 4–5:** full web suite + gates → Commit `feat(voice): video calendars require email at the tool; room per voice booking`

---

### Task 5: Reminder template + operator calendar page show the link

**Files:** Modify `apps/web/src/lib/email/templates/booking.ts` (`BookingReminderInput` gains `meetingUrl?`), `apps/web/src/app/api/cron/reminders/route.ts` (pass it — `listDueReminders` must select `meeting_url`; extend the accessor in packages/db if its select list omits it), `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` · Tests: template test + bookings-list render test if the repo pattern supports it (else e2e note)

- [ ] Steps: failing template test (reminder with/without url) → implement → operator list shows a "Join" link on bookings with `meeting_url` (design-consistent, opens new tab) → gates → Commit `feat(booking): join link in reminders and on the operator calendar`

---

### Task 6: Follow-up engine — cron second pass + template

**Files:** Modify `apps/web/src/app/api/cron/reminders/route.ts` · Create `apps/web/src/lib/email/templates/followup.ts` + test · Test: cron route test (extend)

**Interfaces:** consumes Task 1 `listDueFollowups`/`stampFollowupSent`. Route result JSON gains `followups: { sent, failed, unstamped, skippedNoEmail }`.

- [ ] **Step 1: Failing tests:** template — branded shell, operator body rendered as paragraphs (plain text split on blank lines, escaped), default subject `Thanks from {brand}`; route — after the reminder pass, due follow-up with email → send called with company fromAddress/replyTo (DueReminder precedent) then `stampFollowupSent`; send throws → failed counted, NOT stamped (**send-then-stamp pin**); `contactEmail: null` → skipped + log, not stamped (retries harmlessly until window passes — assert skip counter); empty `followup_body` → the default copy from the spec is used.
- [ ] **Step 2–3:** RED → implement (reminders pass unchanged first; follow-ups second; both inside the existing auth/CRON_SECRET gate; origin already `configuredOrigin() ?? req.url`).
- [ ] **Step 4–5:** gates → Commit `feat(followups): next-morning follow-up pass on the reminder cron (send-then-stamp)`

---

### Task 7: Calendar settings UI — meeting type + follow-up controls

**Files:** Modify `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/calendar-settings.tsx`, its actions file, `apps/web/src/lib/messages.ts` · e2e: extend `apps/web/e2e/booking.spec.ts` or a new small spec

- [ ] Steps: meeting-type select (In person / Phone / Video — copy through `m`) + follow-up toggle + textarea (pre-filled with the spec's default when empty) wired through `updateCalendarSettings`'s patch (grants exist via 0022); failing action-level tests where the file has them; **e2e round-trip through a real session** (set video + enable follow-up + body, reload, assert persisted — this is the column-grant proof, the recorded lesson); frontend-design consistency (this page already has a settings idiom — extend it, don't fork). Gates + build → Commit `feat(web): calendar meeting-type and follow-up settings`

---

### Task 8: Finding 1 — Testing answers regardless of the toggle

**Files:** Create `apps/web/src/lib/voice/accept-gate.ts` + test · Modify `apps/web/src/app/api/voice/incoming/route.ts` (step 7), `apps/web/src/app/api/voice/texml/route.ts` (classify) · Tests: both route test files

**Interface produced:** `callAnswerable(input: { status: PhoneNumberStatus; profile: { enabled: boolean } | null }): { answerable: boolean; reason?: "no-profile" | "disabled" }` — the ONE shared predicate both gates call (the stay-in-agreement constraint): profile null → no; status `testing` → yes (profile exists); status `live` → `profile.enabled`; other statuses unreachable here (routes already filtered testing/live).

- [ ] **Step 1: Failing tests:** predicate — (testing, enabled:false) answerable; (live, enabled:false) not, reason disabled; (testing, null) not, no-profile; (live, enabled:true) answerable. Routes — incoming: testing+disabled call reaches accept (mock through step 11); live+disabled still declines `disabled`. texml: testing+disabled returns `<Dial>`; live+disabled returns the spoken refusal.
- [ ] **Step 2–3:** RED → implement (both routes swap their inline checks for the predicate; texml's refusal language pick keeps `profile?.languages ?? "en"`).
- [ ] **Step 4–5:** full suite + gates → Commit `fix(voice): testing numbers answer regardless of the receptionist toggle (shared gate predicate)`

---

### Task 9: Finding 2 — wizard surfaces the Testing flip

**Files:** Modify `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/setup-panel.tsx` (+ its page if data needed), possibly a small client island (follow `setup-move-number-button.tsx`'s Result-typed idiom), `apps/web/src/lib/setup/setup-view.ts` if a pure decision is extracted, `messages.ts` · Tests: any new pure logic in `.ts` gets tests (the `.tsx` glob limitation stands)

- [ ] Steps: number/test-call cards show the assigned number's STATUS; when `provisioned`, the test-call card renders an agency-only **"Enable test calls"** button calling the existing `setNumberStatusAction(accountId, phoneNumberId, "testing")` (read `voice/actions.ts` for the exact signature) with router.refresh on ok + inline error on failure; card copy (via `m`): what Testing means (answers calls for setup; Go live makes it permanent). Any status→display decision extracted to `setup-view.ts` + tested. Gates + build → Commit `feat(web): wizard surfaces number status with one-click enable-test-calls`

---

### Task 10: Finding 3 — summary speaks the account timezone

**Files:** Modify `apps/web/src/lib/voice/summary-service.ts` (`generateSummary(state, opts?: { timezone?: string; fetchImpl? })` — restructure the current `deps` param, update existing callers/tests), `apps/web/src/lib/voice/finish-call.ts` (FinishContext gains `timezone: string`; pass to generateSummary), `apps/web/src/app/api/voice/incoming/route.ts` (thread `accountRow.timezone` into finishCtx) · Tests: summary-service.test.ts, finish-call.test.ts

- [ ] **Step 1: Failing tests:** the prompt sent to the model contains the timezone and an instruction to state times in it (assert on the mocked fetch body); finish-call passes `ctx.timezone` through; a fixture state with a booking at `2026-08-31T14:00:00.000Z` + timezone `America/Chicago` → prompt instructs Central (the model call is mocked — assert the INSTRUCTION, we cannot assert model output).
- [ ] **Step 2–3:** RED → implement (prompt line: "State all dates and times in the {timezone} timezone in natural local form (e.g. 9:00 AM Central). Never present a UTC time as if it were local."). Fact line stays raw ISO.
- [ ] **Step 4–5:** gates → Commit `fix(voice): summaries state times in the account timezone`

---

### Task 11: Final gates + runbook + ledger

- [ ] `pnpm check` exit 0 → `pnpm --filter web build` → full e2e once (red-spec protocol: re-run alone first).
- [ ] Runbook: DAILY_API_KEY setup (Sensitive; dormant until set); follow-up settings pointer; **Testing-status semantics rewrite** (testing answers without the toggle — update the wizard/onboarding section and any step that said otherwise); env sweep.
- [ ] Ledger: milestone section (gates, 0022 applied-by-controller note, deferred list from the spec).
- [ ] Commit `docs: video meetings + follow-ups runbook and env docs`

---

## Plan Self-Review

1. **Spec coverage:** Part 1 → T1/T2; Part 2 surfaces → T3 (confirmation) / T5 (reminder + operator) / T4 (voice + gate + prompt); Part 3 → T1 (accessors) / T6 (engine) / T7 (UI + grant e2e); Findings 1/2/3 → T8/T9/T10; security/failure rules embedded as pins in T2–T6; exit gate = post-merge (controller + danlo, spec §Exit gate); runbook/env → T11.
2. **Type consistency:** `meetingUrl?` on CreateBookingInput (T1) consumed T3/T4; `MeetingProvider`/`getMeetingProvider` (T2) consumed T3/T4; `DueFollowup`/`stampFollowupSent` (T1) consumed T6; `callAnswerable` (T8) both routes; `BookingConfirmationInput.meetingUrl` (T3) vs `BookingReminderInput.meetingUrl` (T5) — separate inputs, both optional.
3. **Verified against source this session:** template functions take typed inputs (booking.ts:86/136); `generateSummary(state, deps?)` (summary-service.ts:14) — T10 restructures it; `createBooking` explicit insert (booking.ts:196) — T1 adds the column line; grant idiom (0016:85); `setNumberStatusAction` exists (voice/actions.ts). Migration number 0022 confirmed free (0021 latest).

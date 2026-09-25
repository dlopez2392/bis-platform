/**
 * FIXED platform constants (danlo, 2026-09-06), and they apply to RECIPE
 * passes only — the reminder and follow-up passes are uncapped (see their doc
 * comments: a reminder is one-to-one with a booking the customer made, and a
 * daily cap would drop reminders for a busy client), and since part B so is
 * `appointment_confirm`, the THIRD uncapped pass and the first RECIPE to be
 * one (spec decision 2): it is keyed on `starts_at` inside a 75-minute
 * window, so no status change and no import can burst it, and a fully-booked
 * Saturday would otherwise leave five customers unasked.
 *
 * The cap's job is a burst guard against a bug or a bulk status change, not
 * a plan feature: the morning band is twelve ticks wide, so an uncapped pass
 * on a busy client is a burst. No storage, no UI, no grant question. Skipped
 * rows are counted as `skippedCap` and left unstamped, so they are simply
 * due again next tick or next morning — and the counter is what tells us if
 * a real client ever hits this, at which point per-client configuration is a
 * decision with evidence behind it.
 */
export const AUTOMATION_TICK_CAP = 10;
export const AUTOMATION_DAILY_CAP = 25;
/** "A day" is a rolling 24h from the tick, counted from the pass's own stamp
 *  column — no ledger table, no timezone. */
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * REACTIVATION'S OWN CAP (danlo, 2026-09-21), and the reason it is not the
 * platform's 25: 25 a day is 750 people a month who did NOT just interact
 * with the business, which is a blast. Five is a number an operator can read
 * in their sent folder. Counted per account per rolling 24h off
 * `contacts.reactivation_sent_at`, and it composes with the harder limit the
 * schema itself enforces — one reactivation per contact, ever.
 */
export const REACTIVATION_DAILY_CAP = 5;

/**
 * One SMS attempt per booking per day after a FAILED attempt (danlo,
 * 2026-09-06; spec, "Decisions taken after Milestone A shipped").
 * Write-then-send on a 15-minute cron wrote ~12 failed messages rows per
 * booking per morning band during a carrier outage. Each MORNING-BAND
 * SMS-capable pass (review request, no-show nudge) writes its recipe's own
 * `*_sms_failed_at` on a provider failure and holds the booking while that
 * marker is younger than this — counted as `skippedRecentFailure`. At most
 * ceil(61h / 24h) = 3 attempts across the review request's window, one
 * visible failed row each (cron-coupling.test.ts pins the 3). Email sends
 * carry no marker: the decision is about the rows a text leaves in the
 * customer's conversation.
 *
 * THE TEXT REMINDER IS EXEMPT (danlo, 2026-09-07, from Milestone B's
 * review): its window is 45 minutes — three ticks — so a 24h hold outlived
 * the window and meant ONE attempt ever; a single carrier blip cost the
 * customer their reminder. That pass still writes its attempt marker but
 * never reads it back; the window itself bounds it to three attempts and
 * three failed rows, which is the pile-up this hold exists to prevent.
 * THE CONFIRMATION ASK IS EXEMPT TOO (part B), for the identical reason at a
 * different width: its window is 75 minutes — five ticks — so the same 24h
 * hold would again mean one attempt ever. It writes `confirm_sms_failed_at`
 * and never reads it back.
 */
export const SMS_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The longest operator-written body any recipe accepts. A pasted 3,000-
 * character closing line would become a ~20-segment text per booking,
 * billed; the actions refuse above this and the textareas stop typing at it.
 */
export const AUTOMATION_BODY_MAX_LENGTH = 1000;

/**
 * The instant reply's per-thread hold (Milestone C, the inline recipe): a
 * new web-form lead is not texted when their thread already carries a
 * non-failed outbound text younger than this. `hasRecentOutboundSms`'s "ANY
 * outbound text counts" semantics — which made it the WRONG store for the
 * cron recipes' cooldown (a noon reminder would have silenced the next
 * morning's review request) — are exactly right here: if the company already
 * texted this person today, a generic "we got your message" is redundant.
 * Its own constant, not SMS_RETRY_COOLDOWN_MS: that one is about a FAILED
 * attempt, this one about a successful send, and they must be free to move
 * apart.
 */
export const INSTANT_REPLY_THREAD_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Where an instant reply may be sent (danlo, 2026-09-07, from Milestone C's
 * review). This is the only recipe whose trigger needs no reservation, no
 * call and no login — anyone can type any number into a public form — and
 * `toE164` accepts any 8–15-digit number as `+digits`, so without this a
 * rotating-IP bot could direct the daily cap's worth of billed international
 * texts at an account every day once a Telnyx key exists. US/Canada and
 * Mexico are who a Rio Grande Valley business actually serves; a number
 * outside the list is skipped as `outsideRegion` and logged. Caveat: +1
 * also covers the Caribbean NANP countries (Jamaica +1876, the Dominican
 * Republic +1809…), which carriers bill as international; an area-code
 * table is not worth its weight until a real client asks.
 *
 * A SHAPE per prefix, not a bare prefix (re-review, 2026-09-07): `toE164`
 * turns "12345678" into "+12345678", which a prefix match would admit and
 * the provider would then reject — unbilled, but a message row, four reads
 * and a provider call per junk submission, invisible to the hold (failed
 * rows are excluded) and to the cap (only successes are stamped). NANP is
 * fixed at ten digits after +1; Mexican numbers are ten after +52, or
 * eleven with the legacy mobile "1" (+52 1 …) some people still type.
 */
export const INSTANT_REPLY_ALLOWED_PATTERNS: readonly RegExp[] = [/^\+1\d{10}$/, /^\+521?\d{10}$/];

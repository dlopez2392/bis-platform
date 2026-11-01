import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * S-10 fix round I6. `automation_log.reason` is stored as the ENGLISH sentence
 * `REASONS` (lib/automations/hold-or-send.ts) wrote when the row was logged,
 * so a Spanish reader of the Activity page saw English. This reads a stored
 * sentence back to its catalogue key at render time and says it in the
 * reader's language: calendar/server-words.ts's `inDrawerLanguage` pattern,
 * with one difference on purpose: text it does not know (a reason written
 * before a rewording, or one some future writer stores) shows AS STORED in
 * either language, never as a different, generic sentence.
 *
 * Keyed by REASONS' own names so reason-words.test.ts can pin this list to
 * REASONS word for word: a new reason, or a reworded one, reds there by name.
 * Names only, no import of hold-or-send.ts, which is server code.
 */
export const REASON_KEYS = {
  windowAfterDeadline: "activity.reason.windowAfterDeadline",
  ledgerRetry: "activity.reason.ledgerRetry",
  emailLedgerRetry: "activity.reason.emailLedgerRetry",
  emailSetupRetry: "activity.reason.emailSetupRetry",
  tooLongAfterCall: "activity.reason.tooLongAfterCall",
  tooLongAfterWriteIn: "activity.reason.tooLongAfterWriteIn",
  textsStopped: "activity.reason.textsStopped",
  textsHeld: "activity.reason.textsHeld",
  numberUnconfirmed: "activity.reason.numberUnconfirmed",
  noEmail: "activity.reason.noEmail",
  noPhone: "activity.reason.noPhone",
  smsGate: "activity.reason.smsGate",
  dailyCap: "activity.reason.dailyCap",
  failed: "activity.reason.failed",
  appointmentStarted: "activity.reason.appointmentStarted",
  noLongerDue: "activity.reason.noLongerDue",
  recipeOff: "activity.reason.recipeOff",
  timezone: "activity.reason.timezone",
  calendarOff: "activity.reason.calendarOff",
  recentText: "activity.reason.recentText",
  smsCooldown: "activity.reason.smsCooldown",
  tooCloseToAppointment: "activity.reason.tooCloseToAppointment",
  reviewFirst: "activity.reason.reviewFirst",
  heardBack: "activity.reason.heardBack",
  stageGone: "activity.reason.stageGone",
  noMailingAddress: "activity.reason.noMailingAddress",
  noReplyTo: "activity.reason.noReplyTo",
  optedOutEmail: "activity.reason.optedOutEmail",
  suppressedEmail: "activity.reason.suppressedEmail",
  outsideRegion: "activity.reason.outsideRegion",
  consentWithheld: "activity.reason.consentWithheld",
  robocall: "activity.reason.robocall",
  callerHungUp: "activity.reason.callerHungUp",
  transferNoAnswer: "activity.reason.transferNoAnswer",
  heldClosedToday: "automations.reason.heldClosedToday",
  heldStorm: "automations.reason.heldStorm",
  heldClosedDay: "automations.reason.heldClosedDay",
  heldClosureUnknown: "automations.reason.heldClosureUnknown",
  skippedClosed: "automations.reason.skippedClosed",
  heldBillingPaused: "automations.reason.heldBillingPaused",
  skippedBillingPaused: "automations.reason.skippedBillingPaused",
  billingPaused: "automations.reason.billingPaused",
  accountSuppressed: "automations.reason.accountSuppressed",
} as const satisfies Record<string, MessageKey>;

const BY_ENGLISH = new Map<string, MessageKey>(Object.values(REASON_KEYS).map((k) => [t(m, k, "en"), k]));

/** REASONS.quietHours' one interpolated shape, "Held until 8:00 AM — quiet hours",
 *  split off the catalogue's own English so the two cannot drift apart. */
const [QUIET_HEAD, QUIET_TAIL] = t(m, "activity.reason.quietHours", "en").split("{time}") as [string, string];

/** The clock REASONS.quietHours printed (en-US "8:00 AM", with whatever space
 *  ICU puts before the meridiem) in the reader's convention: es-US writes
 *  "8:00 a.m.". Anything else passes through as it was stored. */
function clockIn(clock: string, locale: Locale): string {
  if (locale === "en") return clock;
  const match = /^(\d{1,2}:\d{2})\s?(AM|PM)$/.exec(clock);
  return match ? `${match[1]} ${match[2] === "AM" ? "a.m." : "p.m."}` : clock;
}

/** `stored`, an automation_log reason, in `locale`; unknown text as stored. */
export function reasonInLanguage(stored: string, locale: Locale): string {
  if (locale === "en") return stored;
  const key = BY_ENGLISH.get(stored);
  if (key) return t(m, key, locale);
  if (stored.length > QUIET_HEAD.length + QUIET_TAIL.length && stored.startsWith(QUIET_HEAD) && stored.endsWith(QUIET_TAIL)) {
    const clock = stored.slice(QUIET_HEAD.length, stored.length - QUIET_TAIL.length);
    return t(m, "activity.reason.quietHours", locale, { time: clockIn(clock, locale) });
  }
  return stored;
}

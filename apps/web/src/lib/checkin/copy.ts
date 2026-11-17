import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { CheckinAnswer } from "@bis/db";

/**
 * The check-in page's words (F-072, plan D1). Browser-safe: no database, no server-only import.
 *
 * Each sentence that names the business has its own sentence for an account with NO brand name (the /d page's
 * rule): filling {name} with a fallback word cannot be right in Spanish and opens a sentence lower-case.
 */
const NO_NAME: Partial<Record<MessageKey, MessageKey>> = {
  "checkin.thanks.review": "checkin.thanks.reviewNoName",
  "checkin.sorry": "checkin.sorryNoName",
  "checkin.sorry.plain": "checkin.sorry.plainNoName",
  "checkin.expired.title": "checkin.expired.titleNoName",
  "checkin.expired.body": "checkin.expired.bodyNoName",
  "checkin.task.title": "checkin.task.titleNoName",
};

export type CheckinLocale = "en" | "es";
export type CheckinCopy = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The page's words in `lang`. `business` is the brand name (`brandDisplayName`), or null/"" when the account has none. */
export function checkinCopy(lang: CheckinLocale, business: string | null): CheckinCopy {
  const name = business?.trim() || null;
  return (key, params) => (name
    ? t(m, key, lang, { name, ...params })
    : t(m, NO_NAME[key] ?? key, lang, params));
}

/**
 * The sentence above the review button after an answer. The ONLY thing that differs by answer: great and okay share
 * one, not great has the apology. The button below it is a separate component that is never told the answer.
 * `withReview` is false only when the account has no review link on file (the button is omitted, so the words
 * must not point at it); it is a fact about the account, never about the answer.
 */
export function thankYouKey(answer: CheckinAnswer, withReview = true): MessageKey {
  if (answer === "not_great") return withReview ? "checkin.sorry" : "checkin.sorry.plain";
  return withReview ? "checkin.thanks.review" : "checkin.thanks.plain";
}

export const answerKey = (answer: CheckinAnswer): MessageKey => `checkin.answer.${answer}`;

const BOTH: readonly CheckinLocale[] = ["en", "es"];

/**
 * A page with no language to read (a link that does not verify, an unset secret, an error boundary: the token
 * carries the language, and none of these can trust it) shows both, stacked, each in its own `lang`. The locale is
 * a variable here on purpose: both languages are always shown, never a hard-coded English.
 */
export function stackedLines(key: MessageKey): { en: string; es: string } {
  const [en, es] = BOTH.map((lang) => t(m, key, lang)) as [string, string];
  return { en, es };
}

/** The tab title of a page with no language: "English / Español". */
export const stackedTitle = (key: MessageKey): string => BOTH.map((lang) => t(m, key, lang)).join(" / ");

/** The "not great" To-do's title, in the ACCOUNT's language (staff read it), never the customer's. */
export function checkinTaskTitle(lang: CheckinLocale, customerName: string): string {
  return checkinCopy(lang, customerName)("checkin.task.title");
}

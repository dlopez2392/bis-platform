// S-47d (plan Task 7, orchestrator's widened S7): the closure To-do's title, English or Spanish by the
// account's own language, never the actor's. Imports @bis/db VALUES (getAccountLanguage, ensureClosureTask),
// but `serviceDb` only as `import type` — this file never calls it, so the in-account-service-reads scan does
// not list it: Task 8's server actions pass the client they already hold.
import type { serviceDb } from "@bis/db";
import { getAccountLanguage, ensureClosureTask, type ClosureKind } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

function dayParts(day: string): { month: number; date: number } {
  const [, mm, dd] = day.split("-");
  return { month: Number(mm) - 1, date: Number(dd) };
}

/**
 * SD16: the closure To-do's `{dates}` (Task 2's bullet, verbatim literals). `from`/`to` are "YYYY-MM-DD"
 * calendar days (never converted through a zone — the day a closed day starts and ends on IS the date
 * stored, `closed_days.starts_on`/`ends_on`). The year never appears, matching the spec's drafts; a closed
 * day cannot span more than 92 days (0097's `closed_days_range_check`), so a cross-YEAR range still reads
 * fine without one.
 */
export function closureTodoDates(from: string, to: string, locale: "en" | "es"): string {
  const months = locale === "es" ? MONTHS_ES : MONTHS_EN;
  const a = dayParts(from);
  const b = dayParts(to);
  if (from === to) return locale === "es" ? `${a.date} de ${months[a.month]}` : `${months[a.month]} ${a.date}`;
  if (a.month === b.month) {
    return locale === "es" ? `${a.date} al ${b.date} de ${months[a.month]}` : `${months[a.month]} ${a.date} – ${b.date}`;
  }
  return locale === "es"
    ? `${a.date} de ${months[a.month]} al ${b.date} de ${months[b.month]}`
    : `${months[a.month]} ${a.date} – ${months[b.month]} ${b.date}`;
}

/**
 * Files the one closure To-do for this account, kind and date (plan "The model, The reader", S7/S8). The
 * title reads the ACCOUNT's language (getAccountLanguage; null -> English, D7), never the actor's: the
 * customer-affecting words on a staff-facing To-do still follow the account's own convention. `ensureClosureTask`
 * is the dedupe: a second call for the same (accountId, kind, on) re-reads the existing row instead of filing
 * twice (`tasks_closure_once`). Whether at least one appointment is affected is the caller's own check (Task 8).
 */
export async function fileClosureTodo(
  db: ReturnType<typeof serviceDb>,
  input: { accountId: string; kind: ClosureKind; on: string; to?: string; createdBy: string },
): Promise<{ id: string; created: boolean }> {
  const language = await getAccountLanguage(db, input.accountId);
  const locale: Locale = language === "es" ? "es" : "en";
  const title = input.kind === "status"
    ? t(m, "business.todo.status", locale)
    : t(m, "business.todo.closedDay", locale, { dates: closureTodoDates(input.on, input.to ?? input.on, locale) });
  return ensureClosureTask(db, input.accountId, { kind: input.kind, on: input.on, title, createdBy: input.createdBy });
}

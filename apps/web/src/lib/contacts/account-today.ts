import type { SupabaseClient } from "@bis/db";
import { renderZone } from "@/lib/zone";
import { dayKeyInZone } from "@/lib/booking/availability";
import { loggableError } from "@/lib/loggable-error";

/**
 * The account's own today, `YYYY-MM-DD` in its zone (spec §6), so a warranty's status and the
 * "not after today" rule never use the browser's clock or zone, nor the server's. One rule for the
 * Properties card's read route and for the equipment actions that re-validate a date.
 *
 * The zone is read on the caller's own client (`db`), the email route's shape. An unreadable zone is
 * logged and falls to `renderZone`'s own fallback, never a failure: a date line is not worth failing
 * the card over.
 */
export async function accountToday(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) console.error(`account today: account ${accountId} timezone unreadable: ${loggableError(error)}`);
  const stored = error ? undefined : (data as { timezone: string | null } | null)?.timezone ?? undefined;
  const zone = await renderZone(stored);
  return dayKeyInZone(new Date(), zone.zone);
}

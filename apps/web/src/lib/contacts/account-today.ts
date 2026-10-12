import type { SupabaseClient } from "@bis/db";
import { renderZone } from "@/lib/zone";
import { dayKeyInZone } from "@/lib/booking/availability";
import { loggableError } from "@/lib/loggable-error";

/**
 * The account's own today, `YYYY-MM-DD` in its zone (spec §6), so a warranty's status and the
 * "not after today" rule never use the browser's clock or zone, nor the server's. The zone is read on
 * the caller's own client (`db`), the email route's shape.
 */
async function readZone(db: SupabaseClient, accountId: string, onError: "fallback" | "throw"): Promise<string> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) {
    // The write path fails closed (contacts/[contactId]/actions.ts's dueAtInAccountZone): a date
    // checked against the agency's GUESSED zone could pass a day the account has not reached.
    if (onError === "throw") throw new Error(`account today: account ${accountId} timezone read failed: ${error.message}`);
    console.error(`account today: account ${accountId} timezone unreadable: ${loggableError(error)}`);
  }
  const stored = error ? undefined : (data as { timezone: string | null } | null)?.timezone ?? undefined;
  return dayKeyInZone(new Date(), (await renderZone(stored)).zone);
}

/** For a READ (the card's route): an unreadable zone is logged and falls to renderZone's fallback. */
export async function accountToday(db: SupabaseClient, accountId: string): Promise<string> {
  return readZone(db, accountId, "fallback");
}

/** For a WRITE that validates a date against today: an unreadable zone THROWS, refusing the write. */
export async function accountTodayForWrite(db: SupabaseClient, accountId: string): Promise<string> {
  return readZone(db, accountId, "throw");
}

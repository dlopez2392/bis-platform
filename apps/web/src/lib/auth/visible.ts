import { dbForRequest } from "@/lib/db";

/**
 * Spec §7.3: "prove the target through the request client, then write through
 * the service client". RLS does not bind serviceDb(), so a server action that
 * writes with it must first see the row with the caller's own token. Under
 * 0068 a Technician cannot see another person's booking or conversation, so
 * the proof fails with no role branching. Throws on a read error: "could not
 * tell" is never "allowed".
 */
export type ProvableTable = "bookings" | "conversations";

/** True when the CALLER's own client (RLS + 0068) can see this row in this account. */
export async function callerCanSee(table: ProvableTable, accountId: string, id: string): Promise<boolean> {
  const db = await dbForRequest();
  const { data, error } = await db.from(table).select("id").eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`callerCanSee(${table}) failed: ${error.message}`);
  return data !== null;
}

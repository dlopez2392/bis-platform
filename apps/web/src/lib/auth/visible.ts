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

/**
 * True when the CALLER's own client sees `messageId` on the thread of
 * `bookingId`'s contact, all in `accountId`. The Calendar Undo carries a
 * notice message id from the browser, and the service client then deletes or
 * reads that message scoped only by account: proving the booking does not
 * prove the message. A cancel notice is written to the booking contact's own
 * thread (`queueCancelNotice` → `ensureConversation`), so "on that contact's
 * thread" is exactly the binding. Throws on a read error, like `callerCanSee`.
 */
export async function noticeBelongsToBooking(accountId: string, bookingId: string, messageId: string): Promise<boolean> {
  const db = await dbForRequest();
  const read = async <T>(table: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) throw new Error(`noticeBelongsToBooking(${table}) failed: ${error.message}`);
    return (data ?? null) as T | null;
  };
  const booking = await read<{ contact_id: string }>("bookings",
    db.from("bookings").select("contact_id").eq("account_id", accountId).eq("id", bookingId).maybeSingle());
  if (!booking) return false;
  const message = await read<{ conversation_id: string }>("messages",
    db.from("messages").select("conversation_id").eq("account_id", accountId).eq("id", messageId).maybeSingle());
  if (!message) return false;
  const thread = await read<{ id: string }>("conversations",
    db.from("conversations").select("id").eq("account_id", accountId).eq("id", message.conversation_id)
      .eq("contact_id", booking.contact_id).maybeSingle());
  return thread !== null;
}

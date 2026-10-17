"use server";

import { getContact, getInboundSettings, ensureReplyToken, serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { replyAddressFor } from "@/lib/email/inbound/address";
import { canFormReplyAddress, tokenSafeError } from "@/lib/email/inbound/forwarding-view";

export type ForwardingAddressResult = { ok: true; address: string } | { ok: false };

/**
 * S-06 part 2 (owner ruling 2026-10-17, amending G15): the record's "Get forwarding address". A page
 * view never writes; this is the one place the customer's reply token is made. The caller is proven
 * first (requireAccountAccess), then the customer, by getContact on the REQUEST client (RLS answers
 * null for one the caller may not see); only then does the service client make the token, scoped to
 * the route's own account and contact. Never logs the token.
 */
export async function getForwardingAddressAction(accountId: string, contactId: string): Promise<ForwardingAddressResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!isUuid(contactId)) return { ok: false };
  try {
    const contact = await getContact(await dbForRequest(), accountId, contactId);
    if (!contact) return { ok: false };
    const settings = await getInboundSettings(serviceDb(), accountId);
    if (!canFormReplyAddress(settings)) return { ok: false };
    // A person clicked: the conversation.created event, if this makes the conversation, is theirs.
    const { token } = await ensureReplyToken(serviceDb(), accountId, contactId, userId, undefined, "user");
    const address = replyAddressFor(token, settings);
    return address ? { ok: true, address } : { ok: false };
  } catch (e) {
    console.error(`forwarding address: account ${accountId} could not be made: ${tokenSafeError(e)}`);
    return { ok: false };
  }
}

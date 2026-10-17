import type { SupabaseClient } from "@supabase/supabase-js";
import { getConciergeConversation } from "./concierge";
import { ensureConversation, fileWebchatTurns, type WebchatFileResult } from "./messaging";
import {
  planWebchatRows, parseWebchatKey, matchedExistingCustomer, WEBCHAT_ACTOR_ID, WEBCHAT_KEY_PREFIX, WEBCHAT_MAX_ROWS_PER_CHAT,
  type WebchatKey,
} from "./webchat-plan";

/**
 * S-06 part 3 (spec §1, §3): a lead's website chat on the customer's thread. ONE code path for the
 * pre-lead copy and for every later turn: read the chat as stored, resolve the thread through the lead
 * only, read what IS on the thread, plan what is missing, write it. Called by the turn route in after(),
 * on its service client. Never throws on a failed read or write: it answers an outcome, and the route
 * logs the account id with it (spec decision 5). The next turn's sync heals whatever this one missed.
 */
export type WebchatThread = { conversationId: string; matchedExisting: boolean; leadAt: string };
export type WebchatSyncResult =
  | { outcome: "filed"; result: WebchatFileResult }
  | { outcome: "no_lead" }
  | { outcome: "no_customer" }
  | { outcome: "nothing_new" }
  | { outcome: "failed"; stage: "chat" | "thread" | "keys" | "write" };

/** Spec §1: submission → its contact → that customer's one conversation. null when the submission's
 *  contact is gone (0006:42's `on delete set null`): dropped, never another thread, never a new contact.
 *  The same read answers §5a's match (G19) and the lead's time (plan G27). THROWS on a read error. */
export async function resolveWebchatThread(db: SupabaseClient, accountId: string, submissionId: string): Promise<WebchatThread | null> {
  const { data, error } = await db.from("form_submissions").select("contact_id, created_at, contacts(created_at)")
    .eq("account_id", accountId).eq("id", submissionId).maybeSingle();
  if (error) throw new Error(`resolveWebchatThread failed: ${error.message}`);
  const row = data as { contact_id: string | null; created_at: string;
    contacts: { created_at: string } | { created_at: string }[] | null } | null;
  const contact = Array.isArray(row?.contacts) ? row?.contacts[0] : row?.contacts;
  if (!row || !row.contact_id || !contact) return null;
  const { id } = await ensureConversation(db, accountId, row.contact_id, WEBCHAT_ACTOR_ID, "system");
  return { conversationId: id, matchedExisting: matchedExistingCustomer(contact.created_at, row.created_at), leadAt: row.created_at };
}

/** This chat's rows already on the thread, by key (spec §3 step 3; served by 0005's messages_thread).
 *  THROWS on a read error. */
export async function listWebchatKeys(db: SupabaseClient, accountId: string, conversationId: string, chatId: string): Promise<WebchatKey[]> {
  const { data, error } = await db.from("messages").select("provider_message_id, created_at")
    .eq("account_id", accountId).eq("conversation_id", conversationId)
    .like("provider_message_id", `${WEBCHAT_KEY_PREFIX}${chatId}:%`).limit(WEBCHAT_MAX_ROWS_PER_CHAT * 4);
  if (error) throw new Error(`listWebchatKeys failed: ${error.message}`);
  return ((data ?? []) as { provider_message_id: string | null; created_at: string }[]).flatMap((r) => {
    const index = parseWebchatKey(chatId, r.provider_message_id);
    return index === null ? [] : [{ index, createdAt: r.created_at }];
  });
}

export async function syncWebchatTurns(
  db: SupabaseClient, accountId: string, chatId: string, opts: { raiseUnread: boolean; now?: Date },
): Promise<WebchatSyncResult> {
  let chat: Awaited<ReturnType<typeof getConciergeConversation>>;
  try {
    chat = await getConciergeConversation(db, chatId);
  } catch {
    return { outcome: "failed", stage: "chat" };
  }
  // getConciergeConversation is not account-scoped (concierge.ts:238): the account is checked here.
  if (!chat || chat.account_id !== accountId || !chat.submission_id) return { outcome: "no_lead" };
  const submissionId = chat.submission_id;
  let thread: WebchatThread | null;
  try {
    thread = await resolveWebchatThread(db, accountId, submissionId);
  } catch {
    return { outcome: "failed", stage: "thread" };
  }
  if (!thread) return { outcome: "no_customer" };
  let existing: WebchatKey[];
  try {
    existing = await listWebchatKeys(db, accountId, thread.conversationId, chatId);
  } catch {
    return { outcome: "failed", stage: "keys" };
  }
  // The plan is INSIDE the write stage's try (Task 2 review): planWebchatRows throws a RangeError on an
  // unparseable `now` under a turn whose `at` does not parse, and an Invalid Date `now` throws on
  // toISOString before the planner runs. Either is a failed write, never a throw out of the sync.
  try {
    const rows = planWebchatRows({
      chatId, transcript: chat.transcript, existing, locale: chat.locale, submissionId,
      matchedExisting: thread.matchedExisting, leadAt: thread.leadAt, now: (opts.now ?? new Date()).toISOString(),
    });
    if (rows.length === 0) return { outcome: "nothing_new" };
    return { outcome: "filed", result: await fileWebchatTurns(db, accountId, thread.conversationId, rows, { raiseUnread: opts.raiseUnread }) };
  } catch {
    return { outcome: "failed", stage: "write" };
  }
}

"use server";

import { serviceDb } from "@bis/db";
import { readUnsubscribeToken, recordUnsubscribe, recordResubscribe } from "@/lib/consent/unsubscribe";
import type { UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { loggableError } from "@/lib/loggable-error";

/**
 * The /u page's two buttons (spec §4.3; choice 27; (decision Q1)). Each RE-OPENS the
 * token (the page's state is never trusted), writes through the one ledger
 * path, and answers the state to show. Server actions are POST-only and
 * refuse a foreign Origin (plan X5), so a page elsewhere cannot press them.
 */
export async function unsubscribeAction(token: string): Promise<{ state: UnsubscribeState }> {
  const read = readUnsubscribeToken(token);
  if (!read.ok) return { state: read.why === "bad_token" ? "bad_link" : "failed" };
  try {
    await recordUnsubscribe(serviceDb(), read.payload, "unsubscribe_link");
    return { state: "stopped" };
  } catch (e) {
    console.error(`unsubscribe page: account ${read.payload.a}, stop not recorded: ${loggableError(e)}`);
    return { state: "failed" };
  }
}

export async function resubscribeAction(token: string): Promise<{ state: UnsubscribeState }> {
  const read = readUnsubscribeToken(token);
  if (!read.ok) return { state: read.why === "bad_token" ? "bad_link" : "failed" };
  try {
    await recordResubscribe(serviceDb(), read.payload);
    return { state: "resubscribed" };
  } catch (e) {
    console.error(`unsubscribe page: account ${read.payload.a}, resubscribe not recorded: ${loggableError(e)}`);
    return { state: "failed" };
  }
}

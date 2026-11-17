import { serviceDb, unsubscribeFromBrief } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { readBriefToken } from "./token";

export type BriefOffResult = "off" | "bad_link" | "not_configured" | "failed";

/**
 * Turn a brief off from its signed link: the ONE write behind both the one-click POST route and the page's button.
 * The token is the proof; the write deletes that PERSON's subscription on that business (not a row id, which a re-enable changes).
 * Idempotent: nothing to delete (already off) is "off" too (the safe direction, and a mail client that retries must see success). The token is read BEFORE any client is
 * made, so a bad link or an unset secret costs no query. Never logs the token.
 */
export async function turnBriefOff(token: unknown, env: NodeJS.ProcessEnv = process.env): Promise<BriefOffResult> {
  const read = readBriefToken(token, env);
  if (!read.ok) {
    if (read.why === "not_configured") {
      console.error("brief off link refused: CONSENT_TOKEN_SECRET is not set");
      return "not_configured";
    }
    return "bad_link";
  }
  try {
    await unsubscribeFromBrief(serviceDb(), { userId: read.payload.u, accountId: read.payload.a });
    return "off";
  } catch (e) {
    console.error(`brief off: person ${read.payload.u} on account ${read.payload.a} not turned off: ${loggableError(e)}`);
    return "failed";
  }
}

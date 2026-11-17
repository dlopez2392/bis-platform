import { serviceDb, unsubscribeFromBrief } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { readBriefToken } from "./token";

export type BriefOffResult = "off" | "bad_link" | "not_configured" | "failed";

/**
 * Turn a brief off from its signed link: the ONE write behind both the one-click POST route and the page's button.
 * The token is the proof; the write deletes that subscription row. Idempotent: a row that is already gone is "off"
 * too (the safe direction, and a mail client that retries must see success). The token is read BEFORE any client is
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
    await unsubscribeFromBrief(serviceDb(), { id: read.payload.s });
    return "off";
  } catch (e) {
    console.error(`brief off: subscription ${read.payload.s} not turned off: ${loggableError(e)}`);
    return "failed";
  }
}

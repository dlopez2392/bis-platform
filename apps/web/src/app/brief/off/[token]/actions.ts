"use server";

import { turnBriefOff } from "@/lib/brief/off";
import type { BriefOffState } from "./copy";

/**
 * The /brief/off page's one button. It RE-OPENS the token (the page's own state is never trusted) and writes
 * through the one path the one-click route uses. Server actions are POST-only and refuse a foreign Origin, so a
 * page elsewhere cannot press it. An unset secret reads as "failed" here, as on /u: the person is told it did not
 * work, and the platform's log says why.
 */
export async function turnOffAction(token: string): Promise<{ state: BriefOffState }> {
  const result = await turnBriefOff(token);
  if (result === "off") return { state: "off" };
  return { state: result === "bad_link" ? "bad_link" : "failed" };
}

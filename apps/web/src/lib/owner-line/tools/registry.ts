// apps/web/src/lib/owner-line/tools/registry.ts
import type { SupabaseClient } from "@bis/db";
import { OWNER_TOOL_NAMES, type OwnerToolName } from "./schemas";
import { callsAndMessages, appointments, needsAttention } from "./read";
import type { OwnerLineSession } from "../session";

export type OwnerToolContext = {
  session: OwnerLineSession; now: () => Date;
  recheck: (s: OwnerLineSession, now: Date) => Promise<boolean>;
  client: (s: OwnerLineSession, now: Date) => SupabaseClient;
};

/**
 * Runs one owner tool (F-032 §5). In order:
 *   1. an unknown name — a receptionist tool included — is refused without a read;
 *   2. the session is re-checked live (SC-12), and a refusal or a throw is "couldnt_read" with no read at all;
 *   3. the read runs through the factory's client;
 *   4. anything that throws is "couldnt_read", never partial data.
 * The prompt turns "couldnt_read" into "I couldn't read that just now" — but nothing here depends on it: the model
 * simply has no data to speak.
 */
export async function runOwnerTool(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!(OWNER_TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, error: "unknown_tool" };
  const now = ctx.now();
  let live = false;
  try {
    live = await ctx.recheck(ctx.session, now);
  } catch (e) {
    console.error(`[voice/owner-line] session re-check failed — refusing ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!live) return { ok: false, error: "couldnt_read" };
  try {
    const c = { db: ctx.client(ctx.session, now), accountId: ctx.session.accountId, timezone: ctx.session.timezone,
      locale: ctx.session.locale, now };
    switch (name as OwnerToolName) {
      case "calls_and_messages": return await callsAndMessages(c, args);
      case "appointments": return await appointments(c, args);
      case "needs_attention": return await needsAttention(c);
    }
  } catch (e) {
    console.error(`[voice/owner-line] tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: "couldnt_read" };
  }
  return { ok: false, error: "unknown_tool" };
}

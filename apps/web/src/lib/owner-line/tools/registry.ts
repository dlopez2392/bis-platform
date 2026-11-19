// apps/web/src/lib/owner-line/tools/registry.ts
import type { SupabaseClient } from "@bis/db";
import { runOffered, errorClass } from "@/lib/tools/belt";
import { callsAndMessages, appointments, needsAttention, lookupCustomer, type StaffReadContext } from "@/lib/tools/staff/read";
import { OWNER_TOOL_NAMES, type OwnerToolName } from "./schemas";
import type { OwnerLineSession } from "../session";

export type OwnerToolContext = {
  session: OwnerLineSession; now: () => Date;
  recheck: (s: OwnerLineSession, now: Date) => Promise<boolean>;
  client: (s: OwnerLineSession, now: Date) => SupabaseClient;
};

type Result = Record<string, unknown>;
const unknownTool = (): Result => ({ ok: false, error: "unknown_tool" });
const couldntRead = (): Result => ({ ok: false, error: "couldnt_read" });

/**
 * Runs one owner tool (F-032 §5), through the belt's guard (F-023, lib/tools/belt.ts runOffered). In order:
 *   1. an unknown name — a receptionist tool included — is refused without a read;
 *   2. the session is re-checked live (SC-12), and a refusal or a throw is "couldnt_read" with no read at all;
 *   3. the read runs through the factory's client, as a StaffReadContext (lib/tools/staff/read.ts);
 *   4. anything that throws is "couldnt_read", never partial data, and the log says the error's class only.
 * Every owner-line session is offered the whole owner catalogue, so the guard's not-offered branch is unreachable
 * here today; it answers "unknown_tool", what such a name was answered before the belt.
 * The prompt turns "couldnt_read" into "I couldn't read that just now" — but nothing here depends on it: the model
 * simply has no data to speak.
 */
export async function runOwnerTool(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<Result> {
  return runOffered<OwnerToolName, Result>({
    catalogue: OWNER_TOOL_NAMES,
    offered: OWNER_TOOL_NAMES,
    name, args,
    unknown: unknownTool,
    notOffered: unknownTool,
    onError: (cls) => {
      console.error(`[voice/owner-line] tool ${name} failed for account ${ctx.session.accountId}: ${cls}`);
      return couldntRead();
    },
    run: async (tool, a) => {
      const now = ctx.now();
      let live = false;
      try {
        live = await ctx.recheck(ctx.session, now);
      } catch (e) {
        // Caught HERE, not by the guard: a failed re-check is a refusal with its own log line, never a read failure.
        console.error(`[voice/owner-line] session re-check failed — refusing ${tool} for account ${ctx.session.accountId}: ${errorClass(e)}`);
      }
      if (!live) return couldntRead();
      const c: StaffReadContext = { db: ctx.client(ctx.session, now), accountId: ctx.session.accountId,
        timezone: ctx.session.timezone, locale: ctx.session.locale, now };
      switch (tool) {
        case "calls_and_messages": return await callsAndMessages(c, a);
        case "appointments": return await appointments(c, a);
        case "needs_attention": return await needsAttention(c);
        case "lookup_customer": return await lookupCustomer(c, a);
      }
    },
  });
}

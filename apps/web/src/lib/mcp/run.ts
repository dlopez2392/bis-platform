// apps/web/src/lib/mcp/run.ts
// One MCP tool call (plan 2026-11-19-mcp-server.md §3.2-§3.5). The token gave a Clerk user id and nothing else; which
// businesses that person may ask about is read again from BIS's own tables on EVERY call: their memberships
// (listMyMemberships: client access on, not archived, account scope only, so an agency login reaches nothing), the
// owner line's roles (OWNER_LINE_ROLES: Owner and Staff on today's data path, never a Technician), and each
// business's AI-apps switch. Then the access-log write (which re-checks all of it inside the database and holds the
// rate limits) runs BEFORE the read, and a failed write fails the call (F-118 owner ruling 4).
import { randomUUID } from "node:crypto";
import { serviceDb, noteAiAppRead, readAiAppsSwitch, type SupabaseClient } from "@bis/db";
import { listMyMemberships, type MyMembership } from "@/lib/owner-line/memberships";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { ownerLineReadClient } from "@/lib/owner-line/reader";
import { callsAndMessages, appointments, needsAttention, lookupCustomer, type StaffReadContext } from "@/lib/tools/staff/read";
import { runOffered } from "@/lib/tools/belt";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { resolveLocale, type Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { MCP_TOOL_NAMES, LOG_KIND_OF, type McpToolName } from "./tools";

type Result = Record<string, unknown>;
type Business = Pick<MyMembership, "accountId" | "role" | "businessName">;

const unknownTool = (): Result => ({ ok: false, error: "unknown_tool" });
const couldntRead = (): Result => ({ ok: false, error: "couldnt_read" });
const noBusiness = (l: Locale): Result => ({ ok: false, error: "no_business", message: t(m, "mcp.noBusiness", l) });
const rateLimited = (l: Locale): Result => ({ ok: false, error: "rate_limited", message: t(m, "mcp.rateLimited", l) });
/** The SAME bytes whether the argument was left out or named a business this person may not ask about (§3.2 step 3):
 *  only their own businesses are listed, so the answer never says whether any other business exists. */
const chooseBusiness = (l: Locale, allowed: readonly Business[]): Result => ({
  ok: false, error: "choose_business", message: t(m, "mcp.chooseBusiness", l),
  businesses: allowed.map((b) => ({ id: b.accountId, name: b.businessName })),
});

/** The businesses this person may ask about, read now, never cached: a membership lost, a role changed or a switch
 *  turned off stops the very next call (§3.2 step 2, D2). */
async function allowedBusinesses(db: SupabaseClient, clerkUserId: string): Promise<Business[]> {
  const mine = (await listMyMemberships(db, clerkUserId)).filter((x) => OWNER_LINE_ROLES.includes(x.role));
  const on = await Promise.all(mine.map(async (x) => (await readAiAppsSwitch(db, x.accountId)).enabledAt !== null));
  return mine.filter((_, i) => on[i]);
}

/** The person's stored name (for the access log) and own language. A person with no users row has neither. */
async function readPerson(db: SupabaseClient, clerkUserId: string): Promise<{ name: string | null; language: Locale | null }> {
  const { data, error } = await db.from("users").select("name, language").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`mcp readPerson failed: ${error.message}`);
  const r = (data ?? {}) as { name?: unknown; language?: unknown };
  return { name: typeof r.name === "string" ? r.name : null, language: r.language === "en" || r.language === "es" ? r.language : null };
}

/** What a read needs from the business: its zone, its language, its Clerk org (the token data path mints with it). */
async function readBusiness(db: SupabaseClient, accountId: string): Promise<{ zone: string; language: Locale | null; clerkOrgId: string }> {
  const { data, error } = await db.from("accounts").select("timezone, language, clerk_org_id").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`mcp readBusiness failed: ${error.message}`);
  const r = data as { timezone?: string | null; language?: unknown; clerk_org_id?: unknown } | null;
  // Never a read in some other zone: "today" in the wrong zone is a wrong answer said with confidence.
  const zone = resolveAccountZone(r?.timezone);
  if (!r || zone === null || typeof r.clerk_org_id !== "string") throw new Error("mcp readBusiness: unusable account row");
  return { zone, language: r.language === "en" || r.language === "es" ? r.language : null, clerkOrgId: r.clerk_org_id };
}

export type McpRunContext = { clerkUserId: string; now?: () => Date };

/**
 * Runs one tool, through the belt's one guard (lib/tools/belt.ts runOffered). In order:
 *   1. a name the server does not offer (a write such as book_appointment included) → unknown_tool, nothing read;
 *   2. the allowed businesses, read now; none → no_business;
 *   3. which one: my_businesses lists them all; a read takes `business` when it names one of them, the only one when
 *      it is left out and there is exactly one, else choose_business;
 *   4. the access-log write, FIRST, under a fresh request id: not_allowed → no_business, rate_limited → rate_limited;
 *   5. the read, on the owner line's own client factory (ownerLineReadClient, so the F2-vs-token decision stays in
 *      data-path.ts), in the business's zone and the person's language, then the business's, then English (D6);
 *   6. anything that throws → couldnt_read, logged by the error's class only (never its message).
 */
export async function runMcpTool(ctx: McpRunContext, name: string, args: Record<string, unknown>): Promise<Result> {
  return runOffered<McpToolName, Result>({
    catalogue: MCP_TOOL_NAMES,
    offered: MCP_TOOL_NAMES,
    name, args,
    unknown: unknownTool,
    notOffered: unknownTool,
    onError: (cls) => {
      console.error(`[mcp] tool ${name} failed: ${cls}`);
      return couldntRead();
    },
    run: async (tool, a) => {
      const db = serviceDb();
      const [allowed, person] = await Promise.all([allowedBusinesses(db, ctx.clerkUserId), readPerson(db, ctx.clerkUserId)]);
      const own = resolveLocale(person.language, null);
      if (allowed.length === 0) return noBusiness(own);
      const requestId = randomUUID();
      const note = (b: Business) => noteAiAppRead(db, {
        accountId: b.accountId, actorClerkUserId: ctx.clerkUserId, actorName: person.name, kind: LOG_KIND_OF[tool], requestId,
      });

      if (tool === "my_businesses") {
        const listed: Business[] = [];
        for (const b of allowed) {
          const r = await note(b);
          if (!r.ok && r.reason === "rate_limited") return rateLimited(own);
          if (r.ok) listed.push(b);
        }
        if (listed.length === 0) return noBusiness(own);
        return { ok: true, businesses: listed.map((b) => ({ id: b.accountId, name: b.businessName })) };
      }

      const { business, ...readArgs } = a;
      // Left out: absent, null or "" (a client may send an optional argument either way).
      const leftOut = business === undefined || business === null || business === "";
      const chosen = leftOut && allowed.length === 1
        ? allowed[0]!
        : allowed.find((b) => typeof business === "string" && b.accountId === business);
      if (!chosen) return chooseBusiness(own, allowed);

      const logged = await note(chosen);
      if (!logged.ok) return logged.reason === "rate_limited" ? rateLimited(own) : noBusiness(own);

      const now = (ctx.now ?? (() => new Date()))();
      const acct = await readBusiness(db, chosen.accountId);
      const c: StaffReadContext = {
        db: ownerLineReadClient({ role: chosen.role, clerkUserId: ctx.clerkUserId, clerkOrgId: acct.clerkOrgId }, now),
        accountId: chosen.accountId, timezone: acct.zone, locale: resolveLocale(person.language, acct.language), now,
      };
      switch (tool) {
        case "calls_and_messages": return await callsAndMessages(c, readArgs);
        case "appointments": return await appointments(c, readArgs);
        case "needs_attention": return await needsAttention(c);
        case "lookup_customer": return await lookupCustomer(c, readArgs);
      }
    },
  });
}

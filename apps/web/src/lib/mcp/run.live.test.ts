import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../e2e/fixtures/production-guard";

// The live scope test of the read-only MCP server (plan 2026-11-19-mcp-server.md §5, last bullet), on the replica kit,
// as lib/owner-line/tools/read.live.test.ts runs: a PostgREST in front of a replica that holds 20261119152434_ai_apps,
// its service key in SUPABASE_SERVICE_ROLE_KEY, and BIS_REPLICA_JWT_SECRET naming the kit. Without that secret this
// file is SKIPPED, and a skip is not a pass. Every call runs through the REAL runner: the real memberships read, the
// real switch read, the real note_ai_app_read (role, switch and limits re-checked in the database), the real factory
// client and the real staff reads. Two businesses, each with a customer, a call and a booking; A's Owner must only
// ever see A.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/mcp/run.live.test.ts");

import {
  serviceDb, createAccount, createContact, getOrCreateCalendar, createBooking, deleteAccountCascade, setAiAppsSwitch,
  readAiAppLog,
} from "@bis/db";
import { dayKeyInZone } from "@/lib/booking/availability";
import { runMcpTool } from "./run";

vi.setConfig({ testTimeout: 30_000 });
const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
const RUN = randomUUID().slice(0, 8);
const ZONE = "America/Chicago";
type Acct = { id: string; ownerSub: string; ownerId: string; phoneId: string };
const made: Acct[] = [];
const subs: string[] = [];

async function must<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

describe.skipIf(!SECRET)("the MCP runner reads only the asking person's own business (plan §5, live)", () => {
  let A: Acct;
  let B: Acct;

  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing: run with the replica kit's env");
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const db = serviceDb();
    const account = async (tag: string, lastName: string): Promise<Acct> => {
      const org = `org_mcp_${tag}_${RUN}`;
      const { id } = await createAccount(db, { clerkOrgId: org, name: `Fixture Co (mcp ${tag})`, actorId: "user_test" });
      await must(db.from("accounts").update({ client_access_enabled: true, timezone: ZONE }).eq("id", id).select("id"), "account");
      const sub = `user_mcp_${tag}_${RUN}`;
      const u = await must<{ id: string }>(db.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.invalid`, name: `Owner ${tag}` })
        .select("id").single(), "user");
      subs.push(sub);
      await must(db.from("memberships").insert({ user_id: u.id, scope: "account", account_id: id, role: "owner" }).select("id"), "membership");
      await setAiAppsSwitch(db, id, true, u.id);
      const ph = await must<{ id: string }>(db.from("phone_numbers").insert({ account_id: id,
        e164: `+999${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`, status: "live" }).select("id").single(), "phone");
      const a: Acct = { id, ownerSub: sub, ownerId: u.id, phoneId: ph.id };
      made.push(a);
      const k = await createContact(db, id, { firstName: "Maria", lastName, phone: "+19565550177" }, "voice", "ai");
      await must(db.from("calls").insert({ account_id: id, phone_number_id: ph.id, contact_id: k.id, caller_e164: "+19565550177",
        outcome: "lead" }).select("id"), "call");
      const cal = await getOrCreateCalendar(db, id, "user_test");
      const starts = new Date(Date.now() + 26 * 3600_000);
      await createBooking(db, id, { calendarId: cal.id, contactId: k.id, startsAt: starts, endsAt: new Date(starts.getTime() + 3600_000) }, "voice", "ai");
      return a;
    };
    A = await account("a", `Garza${RUN}`);
    B = await account("b", `Ruiz${RUN}`);
  });

  afterAll(async () => {
    for (const a of made) await deleteAccountCascade(serviceDb(), a.id, "lib/mcp/run.live.test.ts");
    for (const sub of subs) {
      const { error } = await serviceDb().from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });

  const range = () => ({ range: "dates", from: dayKeyInZone(new Date(), ZONE), to: dayKeyInZone(new Date(Date.now() + 30 * 3600_000), ZONE) });
  type Out = { ok: boolean; error?: string; count?: number; businesses?: { id: string }[]; matches?: unknown[] };
  const asA = (tool: string, args: Record<string, unknown> = {}) => runMcpTool({ clerkUserId: A.ownerSub }, tool, args) as Promise<Out>;

  it("my_businesses lists A only", async () => {
    expect((await asA("my_businesses")).businesses?.map((b) => b.id)).toEqual([A.id]);
  });

  it("each read answers A's one row, never B's", async () => {
    expect((await asA("calls_and_messages", range())).count).toBe(1);
    expect((await asA("appointments", range())).count).toBe(1);
    expect((await asA("lookup_customer", { term: `Ruiz${RUN}` })).count).toBe(0);
    expect((await asA("lookup_customer", { term: `Garza${RUN}` })).count).toBe(1);
  });

  it("naming B's id answers choose_business listing A only, and reads nothing of B", async () => {
    const out = await asA("appointments", { ...range(), business: B.id });
    expect(out).toMatchObject({ ok: false, error: "choose_business", businesses: [{ id: A.id }] });
  });

  it("every read above wrote one access-log row on A and none on B", async () => {
    const onA = await readAiAppLog(serviceDb(), A.id, 100);
    expect(onA.length).toBeGreaterThanOrEqual(5);
    expect(onA.every((r) => r.who === "Owner a")).toBe(true);
    expect(await readAiAppLog(serviceDb(), B.id, 100)).toEqual([]);
  });

  it("turning A's switch off stops the next read at the app's own switch read, before any write (note_ai_app_read's own refusal is PR A's test)", async () => {
    await setAiAppsSwitch(serviceDb(), A.id, false, A.ownerId);
    expect(await asA("needs_attention")).toMatchObject({ ok: false, error: "no_business" });
  });
});

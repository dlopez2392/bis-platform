import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../../e2e/fixtures/production-guard";

// The live scope test of the owner tools (spec §7 "Scope", review I-11), on the replica kit: a PostgREST in front of
// a replica that holds 0115, its service key in SUPABASE_SERVICE_ROLE_KEY, and BIS_REPLICA_JWT_SECRET naming the kit
// (it doubles as SUPABASE_JWT_SECRET for the token path). Without that secret this file is SKIPPED, and a skip is
// not a pass: the PR states the replica run. Every tool runs through the REAL factory (ownerLineReadClient), the
// REAL readers and the REAL live re-check (recheckOwnerSession -> owner_line_session_check), so a session naming a
// business its person is not on is refused by the database, not by a stub.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/owner-line/tools/read.live.test.ts");

import {
  serviceDb, createAccount, createContact, getOrCreateCalendar, createBooking, ensureCallbackTask, deleteAccountCascade,
  setOwnerLineSwitch,
} from "@bis/db";
import { dayKeyInZone } from "@/lib/booking/availability";
import { callbackTaskTitle } from "@/lib/voice/call-card";
import { m } from "@/lib/messages";
import { runOwnerTool } from "./registry";
import { ownerLineReadClient } from "../reader";
import { recheckOwnerSession, type OwnerLineSession } from "../session";
import { OWNER_LINE_DATA_PATH } from "../data-path";

vi.setConfig({ testTimeout: 30_000 });
const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
const RUN = randomUUID().slice(0, 8);
const ZONE = "America/Chicago";
const PIN = `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`;
const B_ONLY = "B-only words that must never be heard on A";
// Review I-4: A's two customers are two PEOPLE (two phones), or createContact folds the second into the first and the
// Technician (assigned one of them) sees both. B's customer shares A's first customer's name AND phone, so nothing
// but the account tells them apart.
const SHARED_PHONE = "+19565550177";
const A_SECOND_PHONE = "+19565550178";
// Review I-1: a field on B's call that none of A's carries. A's calls are leads; B's is a message.
const B_OUTCOME_WORDS = m["ownerLine.tool.outcome.message"];
type Who = { id: string; sub: string };
type Acct = { id: string; org: string; phoneId: string; people: Partial<Record<"owner" | "staff" | "tech", Who>> };
const made: Acct[] = [];
const subs: string[] = [];

async function must<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

describe.skipIf(!SECRET)("owner tools see exactly what the role sees, on the dialed business only (spec §7; review I-11), for EVERY tool", () => {
  let A: Acct;
  let B: Acct;
  const range = () => ({ range: "dates", from: dayKeyInZone(new Date(), ZONE), to: dayKeyInZone(new Date(Date.now() + 30 * 3600_000), ZONE) });

  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing: run with the replica kit's env");
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const db = serviceDb();
    const account = async (tag: string): Promise<Acct> => {
      const org = `org_olt_${tag}_${RUN}`;
      const { id } = await createAccount(db, { clerkOrgId: org, name: `Fixture Co (owner line ${tag})`, actorId: "user_test" });
      await must(db.from("accounts").update({ client_access_enabled: true, timezone: ZONE }).eq("id", id).select("id"), "account");
      await setOwnerLineSwitch(db, id, true, "owner");
      // One live number per account (phone_numbers_one_active_per_account): every customer's call is on it.
      const ph = await must<{ id: string }>(db.from("phone_numbers").insert({ account_id: id,
        e164: `+999${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`, status: "live" }).select("id").single(), "phone");
      const a: Acct = { id, org, phoneId: ph.id, people: {} };
      made.push(a);
      return a;
    };
    let cell = 0;
    const person = async (a: Acct, key: "owner" | "staff" | "tech", role: "owner" | "staff" | "technician") => {
      const sub = `user_olt_${key}_${RUN}_${made.indexOf(a)}`;
      const u = await must<{ id: string }>(db.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.invalid` }).select("id").single(), "user");
      subs.push(sub);
      await must(db.from("memberships").insert({ user_id: u.id, scope: "account", account_id: a.id, role }).select("id"), "membership");
      // A verified cell with a PIN: what the live re-check requires (membership, role, switch, enrolled, not locked).
      await must(db.from("owner_line_enrollments").insert({ account_id: a.id, user_id: u.id, e164: `+1956558${String(++cell).padStart(4, "0")}`,
        verified_at: new Date().toISOString(), pin_hash: PIN, pin_set_at: new Date().toISOString() }).select("id"), "enrollment");
      a.people[key] = { id: u.id, sub };
    };
    const customer = async (a: Acct, assignedTo: string | null, hour: number, phone: string, only = "", outcome = "lead") => {
      const made = await createContact(db, a.id, { firstName: "Maria", lastName: "López", phone }, "voice", "ai");
      // A NEW contact every time (review I-4): an existing one would merge two customers the Technician must tell apart.
      expect(made.existing, `createContact on ${a.org} with ${phone}`).toBe(false);
      const k = made.id;
      if (assignedTo) await must(db.from("contacts").update({ assigned_to: assignedTo }).eq("id", k).select("id"), "assign");
      const callId = (await must<{ id: string }>(db.from("calls").insert({ account_id: a.id, phone_number_id: a.phoneId, contact_id: k,
        caller_e164: phone, outcome, reason: only || null }).select("id").single(), "call")).id;
      const cal = await getOrCreateCalendar(db, a.id, "user_test");
      const starts = new Date(Date.now() + 26 * 3600_000 + hour * 3600_000);
      await createBooking(db, a.id, { calendarId: cal.id, contactId: k, startsAt: starts, endsAt: new Date(starts.getTime() + 3600_000) }, "voice", "ai");
      // The REAL writer of Sofía's callback To do (finish-call.ts:604), number as the caller ID gave it (review I-3).
      await ensureCallbackTask(db, a.id, { callId, contactId: k, title: callbackTaskTitle(phone, only || null),
        dueAt: new Date(Date.now() + 3600_000).toISOString() }, "voice");
    };
    A = await account("a");
    B = await account("b");
    await person(A, "owner", "owner");
    await person(A, "staff", "staff");
    await person(A, "tech", "technician");
    await person(B, "owner", "owner");
    await customer(A, A.people.tech!.id, 0, SHARED_PHONE);
    await customer(A, null, 2, A_SECOND_PHONE);
    await customer(B, null, 0, SHARED_PHONE, B_ONLY, "message");
  });

  afterAll(async () => {
    for (const a of made) await deleteAccountCascade(serviceDb(), a.id, "lib/owner-line/tools/read.live.test.ts");
    for (const sub of subs) {
      const { error } = await serviceDb().from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });

  const session = (a: Acct, who: Who, role: OwnerLineSession["role"], asAccount: Acct = a): OwnerLineSession => ({
    accountId: asAccount.id, userId: who.id, role, clerkUserId: who.sub, clerkOrgId: asAccount.org,
    firstName: null, actorName: null, locale: "en", timezone: ZONE,
  });
  type Out = { ok: boolean; count?: number; error?: string; calls?: { outcome: string }[]; items?: { what: string }[] };
  const run = (s: OwnerLineSession, tool: string, args: Record<string, unknown>) => runOwnerTool({
    session: s, now: () => new Date(), recheck: recheckOwnerSession, client: (x, n) => ownerLineReadClient(x, n),
  }, tool, args) as Promise<Out>;
  /**
   * What each tool must ALSO show about A, beyond its count (review I-1, I-3). calls_and_messages' count is the tile's
   * read, a different query from the listing, so the count alone cannot see the listing reading another business:
   * every listed call must be one the count counts, and none may carry B's outcome. needs_attention reads each
   * callback To do as the row shows it, number included (owner ruling 2026-11-09, extended).
   */
  const seenOnA = (tool: string, out: Out, phones: string[]) => {
    if (tool === "calls_and_messages") {
      expect(out.calls, "listed calls").toHaveLength(out.count!);
      expect(out.calls!.map((x) => x.outcome), "B's outcome").not.toContain(B_OUTCOME_WORDS);
    }
    if (tool === "needs_attention") {
      expect(out.items!.map((x) => x.what).sort()).toEqual(phones.map((p) => callbackTaskTitle(p, null)).sort());
      for (const p of phones) expect(callbackTaskTitle(p, null)).toContain(p);
    }
  };
  const TOOLS = [["calls_and_messages"], ["appointments"], ["needs_attention"]] as const;
  const args = (tool: string) => (tool === "needs_attention" ? {} : range());

  it.each(TOOLS)("Owner of A, %s: A's two, and not one word of B's same-named customer", async (tool) => {
    const out = await run(session(A, A.people.owner!, "owner"), tool, args(tool));
    expect(out).toMatchObject({ ok: true, count: 2 });
    expect(JSON.stringify(out)).not.toContain(B_ONLY);
    seenOnA(tool, out, [SHARED_PHONE, A_SECOND_PHONE]);
  });
  it.each(TOOLS)("Staff of A, %s: what Staff see, A's two, nothing of B's", async (tool) => {
    const out = await run(session(A, A.people.staff!, "staff"), tool, args(tool));
    expect(out).toMatchObject({ ok: true, count: 2 });
    expect(JSON.stringify(out)).not.toContain(B_ONLY);
    seenOnA(tool, out, [SHARED_PHONE, A_SECOND_PHONE]);
  });
  it.each(TOOLS)("Owner of B, %s: B's one, nothing of A's (a second account)", async (tool) => {
    const out = await run(session(B, B.people.owner!, "owner"), tool, args(tool));
    expect(out).toMatchObject({ ok: true, count: 1 });
    if (tool === "calls_and_messages") {
      expect(out.calls, "listed calls").toHaveLength(1);
      expect(out.calls![0]!.outcome).toBe(B_OUTCOME_WORDS);
    }
  });
  it.each(TOOLS)("A's Owner naming business B, %s: the live re-check refuses before any read (not a member of B)", async (tool) => {
    expect(await run(session(A, A.people.owner!, "owner", B), tool, args(tool))).toEqual({ ok: false, error: "couldnt_read" });
  });
  it.skipIf(OWNER_LINE_DATA_PATH !== "service").each(TOOLS)("Technician of A, %s, under F2: refused before reading, never given unscoped reads", async (tool) => {
    expect(await run(session(A, A.people.tech!, "technician"), tool, args(tool))).toEqual({ ok: false, error: "couldnt_read" });
  });
  it.skipIf(OWNER_LINE_DATA_PATH !== "token").each(TOOLS)("Technician of A, %s, under T: only the assigned customer's", async (tool) => {
    const out = await run(session(A, A.people.tech!, "technician"), tool, args(tool));
    expect(out).toMatchObject({ ok: true, count: 1 });
    expect(JSON.stringify(out)).not.toContain(B_ONLY);
    seenOnA(tool, out, [SHARED_PHONE]);   // the assigned customer's number only
  });
});

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../e2e/fixtures/production-guard";

// The live harness of `lib/proposals/decide.live.test.ts`, with one difference that is the point of this
// file: the REQUEST client is a real signed-in client (`userDb` with a token signed by the replica's own
// PostgREST secret), so RLS, 0091's Technician fence and a second account are the database's to refuse,
// not a mock's. The token needs that secret, which only the replica kit has (`BIS_REPLICA_JWT_SECRET`, passed
// on the command line with the kit's `env-run.sh`); without it the file is SKIPPED, and a skip is not a pass.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/ai-acts/actions.live.test.ts");

const who = vi.hoisted(() => ({ userId: "", token: "", canManage: true, isAgency: false, role: "owner" as string }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" })) }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: vi.fn(async () => ({ userId: who.userId, isAgency: who.isAgency, role: who.role, canManage: who.canManage })),
  requireAccountOwner: vi.fn(async () => {
    if (!who.canManage) throw new Error("NEXT_REDIRECT");
    return { userId: who.userId, isAgency: who.isAgency, role: who.role, canManage: true };
  }),
}));
vi.mock("@/lib/db", async () => {
  const { userDb } = await import("@bis/db");
  return { dbForRequest: vi.fn(async () => userDb(who.token)) };
});
const sends = vi.hoisted(() => [] as { to: string; subject: string; body: string }[]);
vi.mock("@/lib/email", async (io) => ({
  ...(await io<typeof import("@/lib/email")>()),
  getEmailProvider: () => ({
    isFake: true,
    send: async (input: { to: string; subject: string; body: string }) => { sends.push(input); return { providerMessageId: `fake_${sends.length}` }; },
  }),
}));

import {
  serviceDb, createAccount, deleteAccountCascade, createContact, getOrCreateCalendar, createBooking, insertAiActs, getAiAct,
} from "@bis/db";
import type { NewAiAct } from "@bis/db/ai-act-rules";
import { redoAiFieldFillAction, undoAiActAction } from "./actions";

/** Item 8c, plan Task 5: the undo actions against a real database (the replica kit, 0091 applied). */

vi.setConfig({ testTimeout: 30_000 });
type Db = ReturnType<typeof serviceDb>;
const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
const RUN = Math.random().toString(36).slice(2, 8);
const svc = (): Db => serviceDb();
const DAY = 86_400_000;

function sign(sub: string, orgId: string): string {
  const b64 = (b: Buffer) => b.toString("base64url");
  const head = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(Buffer.from(JSON.stringify({ role: "authenticated", org_id: orgId, sub, exp: Math.floor(Date.now() / 1000) + 3600 })));
  return `${head}.${body}.${b64(createHmac("sha256", SECRET!).update(`${head}.${body}`).digest())}`;
}

async function must<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

type Person = { sub: string; id: string };
type Acct = { id: string; orgId: string; calendarId: string; phoneId: string; people: Record<"owner" | "staff" | "tech", Person> };
const made: Acct[] = [];
const users: string[] = [];

async function person(accountId: string, role: "owner" | "staff" | "technician", label: string): Promise<Person> {
  const sub = `user_aia_${label}_${RUN}_${made.length}`;
  const u = await must<{ id: string }>(svc().from("users").insert({ clerk_user_id: sub, email: `${sub}@example.invalid`, name: `Person ${label}` }).select("id").single(), "user");
  users.push(sub);
  await must(svc().from("memberships").insert({ user_id: u.id, scope: "account", account_id: accountId, role }).select("id").single(), "membership");
  return { sub, id: u.id };
}

async function account(language: "en" | "es" | null = "en"): Promise<Acct> {
  const orgId = `org_test_aia_${Math.random().toString(36).slice(2, 10)}`;
  const { id } = await createAccount(svc(), { clerkOrgId: orgId, name: "Fixture Co (ai acts)", actorId: "user_test" });
  await must(svc().from("accounts").update({ client_access_enabled: true, language }).eq("id", id).select("id"), "account");
  const cal = await getOrCreateCalendar(svc(), id, "user_test");
  const e164 = `+999${String(Math.floor(Math.random() * 1_000_000_000_000)).padStart(12, "0")}`;
  const ph = await must<{ id: string }>(svc().from("phone_numbers").insert({ account_id: id, e164 }).select("id").single(), "phone");
  const a: Acct = { id, orgId, calendarId: cal.id, phoneId: ph.id, people: {} as Acct["people"] };
  made.push(a);
  a.people = { owner: await person(id, "owner", "owner"), staff: await person(id, "staff", "staff"), tech: await person(id, "technician", "tech") };
  return a;
}

function as(a: Acct, p: "owner" | "staff" | "tech"): void {
  who.userId = a.people[p].sub;
  who.token = sign(a.people[p].sub, a.orgId);
  who.canManage = p === "owner";
  who.role = p === "tech" ? "technician" : p;
}

async function call(a: Acct, contactId: string | null): Promise<string> {
  return (await must<{ id: string }>(svc().from("calls").insert({ account_id: a.id, phone_number_id: a.phoneId, caller_e164: "+19565550100", contact_id: contactId }).select("id").single(), "call")).id;
}
async function contact(a: Acct, input: Parameters<typeof createContact>[2]): Promise<string> {
  return (await createContact(svc(), a.id, input, "voice", "ai")).id;
}
/** One act, as Task 4's recordAct writes it (service client), and its id. */
async function act(a: Acct, x: NewAiAct): Promise<string> {
  await insertAiActs(svc(), a.id, [x]);
  const rows = await must<{ id: string }[]>(svc().from("ai_acts").select("id").eq("account_id", a.id).eq("contact_id", x.contactId).eq("kind", x.kind).order("created_at", { ascending: false }).limit(1), "act id");
  return rows[0]!.id;
}
const at = (days: number, hour = 15) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
async function bookedAct(a: Acct, cid: string, callId: string, days = 3): Promise<{ bookingId: string; actId: string }> {
  const s = at(days);
  const e = new Date(s.getTime() + 3_600_000);
  const { id } = await createBooking(svc(), a.id, { calendarId: a.calendarId, contactId: cid, startsAt: s, endsAt: e }, "voice", "ai");
  const actId = await act(a, { kind: "booking_created", actor: "voice", callId, chatId: null, contactId: cid, target: { bookingId: id }, before: null, after: { startsAt: s.toISOString(), endsAt: e.toISOString() } });
  return { bookingId: id, actId };
}
const status = async (id: string) => (await must<{ status: string }>(svc().from("bookings").select("status").eq("id", id).single(), "booking")).status;
const actRow = async (a: Acct, id: string) => getAiAct(svc(), a.id, id);

describe.skipIf(!SECRET)("undoAiActAction against the replica", () => {
  let A: Acct;
  let B: Acct;
  beforeAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing: source the replica kit's env-run.sh");
    A = await account("en");
    B = await account("en");
  });
  afterAll(async () => {
    for (const a of made) await deleteAccountCascade(svc(), a.id, "lib/ai-acts/actions.live.test.ts");
    for (const sub of users) {
      const { error } = await svc().from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });
  beforeEach(() => { sends.length = 0; });

  it("a booking undo cancels the booking and stamps the act with the undoer; unticked, nothing is sent (mutation: ignore notify -> FAILS)", async () => {
    const cid = await contact(A, { firstName: "Ana", lastName: "Ruiz", email: "ana-live@example.invalid", phone: "+19565550111" });
    const k = await call(A, cid);
    const { bookingId, actId } = await bookedAct(A, cid, k);
    as(A, "owner");
    expect(await undoAiActAction(A.id, actId, { notify: false })).toEqual({ ok: true, control: "booking", told: "notAsked" });
    expect(await status(bookingId)).toBe("cancelled");
    expect(await actRow(A, actId)).toMatchObject({ undoneBy: A.people.owner.sub, undoNotified: false });
    expect(sends).toEqual([]);
    // A second Undo of the same act is refused and writes nothing.
    expect(await undoAiActAction(A.id, actId, { notify: true })).toEqual({ ok: false, reason: "notAvailable" });
    expect(sends).toEqual([]);
  });

  it("ticked, for a Spanish customer on an English account: the notice is Spanish, end to end, and the act is marked told", async () => {
    const cid = await contact(A, { firstName: "Lucía", email: "lucia-live@example.invalid", phone: "+19565550112" });
    await must(svc().from("contacts").update({ language: "es", language_source: "staff", language_set_at: new Date().toISOString() }).eq("id", cid).select("id"), "language");
    const k = await call(A, cid);
    const { actId } = await bookedAct(A, cid, k, 4);
    as(A, "owner");
    expect(await undoAiActAction(A.id, actId, { notify: true })).toEqual({ ok: true, control: "booking", told: "yes" });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ to: "lucia-live@example.invalid", subject: "Tu cita fue cancelada" });
    expect(sends[0]!.body).toContain("Si no pediste esta cancelación");
    expect(await actRow(A, actId)).toMatchObject({ undoNotified: true });
  });

  it("account B's Owner with A's act id gets notAvailable and nothing is written, while B holds an act of its own (second account)", async () => {
    const cid = await contact(A, { firstName: "Zoe", phone: "+19565550113" });
    const { bookingId, actId } = await bookedAct(A, cid, await call(A, cid), 5);
    const bc = await contact(B, { firstName: "Bea", phone: "+19565550114" });
    const own = await bookedAct(B, bc, await call(B, bc), 5);
    as(B, "owner");
    expect(await undoAiActAction(A.id, actId, { notify: false })).toEqual({ ok: false, reason: "notAvailable" });
    expect(await undoAiActAction(B.id, actId, { notify: false })).toEqual({ ok: false, reason: "notAvailable" });
    expect(await status(bookingId)).toBe("booked");
    expect(await actRow(A, actId)).toMatchObject({ undoneAt: null });
    expect(await status(own.bookingId)).toBe("booked");
  });

  it("a Technician gets notAvailable on an unassigned customer's act, and may undo once the customer is theirs", async () => {
    const cid = await contact(A, { firstName: "Teo", phone: "+19565550115" });
    const { bookingId, actId } = await bookedAct(A, cid, await call(A, cid), 6);
    as(A, "tech");
    expect(await undoAiActAction(A.id, actId, { notify: false })).toEqual({ ok: false, reason: "notAvailable" });
    expect(await status(bookingId)).toBe("booked");
    await must(svc().from("contacts").update({ assigned_to: A.people.tech.id }).eq("id", cid).select("id"), "assign");
    expect(await undoAiActAction(A.id, actId, { notify: false })).toEqual({ ok: true, control: "booking", told: "notAsked" });
    expect(await status(bookingId)).toBe("cancelled");
  });

  it("a field undo when a person changed the value since answers changed and leaves their value", async () => {
    const cid = await contact(A, { firstName: "Mia", email: "mia-sofia@example.invalid", phone: "+19565550116" });
    const actId = await act(A, { kind: "contact_field_filled", actor: "voice", callId: await call(A, cid), chatId: null, contactId: cid,
      target: { field: "email" }, before: { value: null }, after: { value: "mia-sofia@example.invalid" } });
    await must(svc().from("contacts").update({ email: "mia-own@example.invalid" }).eq("id", cid).select("id"), "edit");
    as(A, "staff");
    expect(await undoAiActAction(A.id, actId, {})).toEqual({ ok: false, reason: "changed" });
    expect((await must<{ email: string }>(svc().from("contacts").select("email").eq("id", cid).single(), "c")).email).toBe("mia-own@example.invalid");
    expect(await actRow(A, actId)).toMatchObject({ undoneAt: null });
  });

  it("a field undo puts the old value back and stamps; the redo puts Sofía's value back and clears it; a second redo answers changed", async () => {
    const cid = await contact(A, { firstName: "Caller", phone: "+19565550117" });
    await must(svc().from("contacts").update({ first_name: "Noé" }).eq("id", cid).select("id"), "fill");
    const actId = await act(A, { kind: "contact_field_filled", actor: "voice", callId: await call(A, cid), chatId: null, contactId: cid,
      target: { field: "firstName" }, before: { value: "Caller" }, after: { value: "Noé" } });
    const first = async () => (await must<{ first_name: string }>(svc().from("contacts").select("first_name").eq("id", cid).single(), "c")).first_name;
    as(A, "staff");
    expect(await undoAiActAction(A.id, actId, {})).toEqual({ ok: true, control: "field" });
    expect(await first()).toBe("Caller");
    expect(await actRow(A, actId)).toMatchObject({ undoneBy: A.people.staff.sub });
    expect(await redoAiFieldFillAction(A.id, actId)).toEqual({ ok: true });
    expect(await first()).toBe("Noé");
    expect(await actRow(A, actId)).toMatchObject({ undoneAt: null, undoneBy: null });
    expect(await redoAiFieldFillAction(A.id, actId)).toEqual({ ok: false, reason: "changed" });
    expect(await first()).toBe("Noé");
  });

  describe("the contact undo", () => {
    async function sofiasContact(a: Acct, name: string, phone: string) {
      const cid = await contact(a, { firstName: name, lastName: "Vega", phone });
      const k = await call(a, cid);
      const conv = await must<{ id: string }>(svc().from("conversations").insert({ account_id: a.id, contact_id: cid }).select("id").single(), "conversation");
      await must(svc().from("messages").insert({ account_id: a.id, conversation_id: conv.id, channel: "voice", direction: "inbound", body: "Call summary", author_kind: "ai" }).select("id"), "message");
      const actId = await act(a, { kind: "contact_created", actor: "voice", callId: k, chatId: null, contactId: cid, target: {}, before: null, after: null });
      return { cid, k, actId };
    }
    const exists = async (cid: string) => (await must<unknown[]>(svc().from("contacts").select("id").eq("id", cid), "c")).length === 1;

    it("a Staff member is redirected: removing a customer is an Owner's", async () => {
      const { cid, actId } = await sofiasContact(A, "Sol", "+19565550118");
      as(A, "staff");
      await expect(undoAiActAction(A.id, actId, { typedName: "Sol Vega" })).rejects.toThrow("NEXT_REDIRECT");
      expect(await exists(cid)).toBe(true);
    });
    it("the wrong typed name writes nothing", async () => {
      const { cid, actId } = await sofiasContact(A, "Rita", "+19565550119");
      as(A, "owner");
      expect(await undoAiActAction(A.id, actId, { typedName: "Rita Veg" })).toEqual({ ok: false, reason: "typedName" });
      expect(await exists(cid)).toBe(true);
    });
    it("the clean contact is removed, and its call stays in Calls with no customer", async () => {
      const { cid, k, actId } = await sofiasContact(A, "Iris", "+19565550120");
      as(A, "owner");
      expect(await undoAiActAction(A.id, actId, { typedName: "Iris Vega" })).toEqual({ ok: true, control: "contact", removed: true });
      expect(await exists(cid)).toBe(false);
      expect(await must<{ contact_id: string | null }>(svc().from("calls").select("contact_id").eq("id", k).single(), "call")).toEqual({ contact_id: null });
    });
    it("a contact with a note answers hasActivity, and the note and the contact stay", async () => {
      const { cid, actId } = await sofiasContact(A, "Eva", "+19565550121");
      await must(svc().from("notes").insert({ account_id: A.id, contact_id: cid, body: "Called back about the roof" }).select("id"), "note");
      as(A, "owner");
      expect(await undoAiActAction(A.id, actId, { typedName: "Eva Vega" })).toEqual({ ok: false, reason: "hasActivity" });
      expect(await exists(cid)).toBe(true);
      expect(await must<unknown[]>(svc().from("notes").select("id").eq("contact_id", cid), "notes")).toHaveLength(1);
    });
  });
});

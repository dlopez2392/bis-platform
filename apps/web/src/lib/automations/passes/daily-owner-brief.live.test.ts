import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { refuseProduction } from "../../../../e2e/fixtures/production-guard";

// The daily owner brief's pass (F-082 PR 3) against a REAL database (bis-ci or the local replica, never production):
// a seeded subscription written directly, the REAL email gate with a capturing provider behind it, the REAL owner-line
// reads. Plan docs/superpowers/plans/2026-11-15-daily-owner-brief.md D1, D3, D4, D5, D6. Nothing here reaches Resend.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/automations/passes/daily-owner-brief.live.test.ts");

const scope = vi.hoisted(() => ({ ids: new Set<string>() }));
const provider = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; body: string; html?: string; headers?: Record<string, string>; idempotencyKey?: string }[],
  fail: null as null | (() => never), hold: null as null | Promise<void> }));
// The pass sees ONLY this file's own fixture subscriptions: a real subscription on the shared project (bis-ci) can
// never be claimed or mailed by a test, whatever else is in the table.
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, listDueBriefSubscriptions: async (db: Parameters<typeof real.listDueBriefSubscriptions>[0]) =>
    (await real.listDueBriefSubscriptions(db)).filter((r) => scope.ids.has(r.subscriptionId)) };
});
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEmailProvider: () => ({
    isFake: true,
    send: async (i: { to: string; subject: string; body: string; html?: string; headers?: Record<string, string>; idempotencyKey?: string }) => {
      if (provider.hold) await provider.hold;
      if (provider.fail) provider.fail();
      provider.sent.push(i);
      return { providerMessageId: `cap_${provider.sent.length}` };
    },
  }),
}));

import {
  serviceDb, createAccount, createContact, getOrCreateCalendar, createBooking, deleteAccountCascade, type SupabaseClient,
} from "@bis/db";
import { buildPassContext, runPass } from "../harness";
import { dailyOwnerBriefPass } from "./daily-owner-brief";

vi.setConfig({ testTimeout: 60_000 });
const RUN = randomUUID().slice(0, 8);
const ORIGIN = "https://app.example.com";
const ZONE = "America/Chicago";
// 07:00 on Wednesday 2027-03-10 in Chicago (CST, UTC-6; the clock change is the 14th). Yesterday = the 9th.
const T0700 = new Date("2027-03-10T13:00:00Z");
const at = (mins: number) => new Date(T0700.getTime() + mins * 60_000);
const TODAY_JOB = "2027-03-10T16:00:00Z";
const YESTERDAY_CALL = "2027-03-09T20:00:00Z";

const accounts: string[] = [];
const people: string[] = [];
/** This test's subscriptions: deleted after it, so one test's unhandled row never sends (or is counted) in the next. */
const subs: string[] = [];
let n = 0;
async function must<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const r = await q;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/** One business, with its brand, and `person` as a member who opted in (written straight to the table). */
type Biz = { id: string; brand: string; internal: string; phoneId: string };
async function business(tag: string, over: Record<string, unknown> = {}): Promise<Biz> {
  const db = serviceDb();
  const internal = `ZZ Internal Label ${tag} ${RUN} - trial`;
  const brand = `Rio ${tag} Roofing`;
  const { id } = await createAccount(db, { clerkOrgId: `org_odb_${tag}_${RUN}_${++n}`, name: internal, actorId: "user_test" });
  accounts.push(id);
  await must(db.from("accounts").update({ client_access_enabled: true, timezone: ZONE, brand_name: brand, ...over }).eq("id", id).select("id"), "account");
  const ph = await must<{ id: string }>(db.from("phone_numbers").insert({ account_id: id,
    e164: `+999${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`, status: "live" }).select("id").single(), "phone");
  return { id, brand, internal, phoneId: ph.id };
}
async function person(tag: string, language: "en" | "es" | null = null): Promise<{ id: string; email: string }> {
  const email = `odb_${tag}_${RUN}_${++n}@example.invalid`;
  const u = await must<{ id: string }>(serviceDb().from("users").insert({ clerk_user_id: `user_odb_${tag}_${RUN}_${n}`, email, language }).select("id").single(), "user");
  people.push(`user_odb_${tag}_${RUN}_${n}`);
  return { id: u.id, email };
}
async function subscribe(b: Biz, p: { id: string }, role: "owner" | "staff" | "technician" = "owner", enabledAt = "2027-03-01T12:00:00Z"): Promise<string> {
  const db = serviceDb();
  await must(db.from("memberships").insert({ user_id: p.id, scope: "account", account_id: b.id, role }).select("id"), "membership");
  const id = (await must<{ id: string }>(db.from("owner_brief_subscriptions").insert({ user_id: p.id, account_id: b.id, enabled_at: enabledAt }).select("id").single(), "subscription")).id;
  subs.push(id); scope.ids.add(id);
  return id;
}
const job = async (b: Biz, first: string) => {
  const db = serviceDb();
  const k = await createContact(db, b.id, { firstName: first, lastName: "Customer", phone: `+1956555${String(1000 + ++n).padStart(4, "0")}` }, "voice", "ai");
  const cal = await getOrCreateCalendar(db, b.id, "user_test");
  const startsAt = new Date(TODAY_JOB);
  await createBooking(db, b.id, { calendarId: cal.id, contactId: k.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) }, "user_test", "ai");
};
const call = (b: Biz, outcome: string, extra: Record<string, unknown> = {}) => must(serviceDb().from("calls").insert({
  account_id: b.id, phone_number_id: b.phoneId, caller_e164: `+1956556${String(1000 + ++n).padStart(4, "0")}`, outcome,
  started_at: YESTERDAY_CALL, ...extra }).select("id"), "call");
const row = async (id: string) => must<{ last_handled_day: string | null; last_sent_day: string | null; last_outcome: string | null }>(
  serviceDb().from("owner_brief_subscriptions").select("last_handled_day, last_sent_day, last_outcome").eq("id", id).single(), "row");

/** A client wrapper that records every table read and can throw for one business's bookings read. */
function watch(db: SupabaseClient, opts: { poisonBookingsOf?: string } = {}): { db: SupabaseClient; tables: string[] } {
  const tables: string[] = [];
  const wrap = (t: object, table: string): object => new Proxy(t, {
    get(target, prop) {
      const v = (target as Record<string | symbol, unknown>)[prop];
      if (typeof v !== "function" || prop === "then") return typeof v === "function" ? v.bind(target) : v;
      return (...args: unknown[]) => {
        if (table === "bookings" && prop === "eq" && args[0] === "account_id" && args[1] === opts.poisonBookingsOf) throw new Error("poisoned read");
        const out = v.apply(target, args);
        return out && typeof out === "object" ? wrap(out, table) : out;
      };
    },
  });
  const proxy = new Proxy(db, { get(target, prop) {
    if (prop !== "from") { const v = (target as unknown as Record<string | symbol, unknown>)[prop]; return typeof v === "function" ? v.bind(target) : v; }
    return (table: string) => { tables.push(table); return wrap(target.from(table), table); };
  } });
  return { db: proxy as SupabaseClient, tables };
}

const tick = (now: Date, db: SupabaseClient = serviceDb()) =>
  runPass(dailyOwnerBriefPass, buildPassContext({ db, now, origin: ORIGIN }), async () => {});
const mine = (p: { email: string }) => provider.sent.filter((s) => s.to === p.email);

beforeAll(async () => {
  // A crashed earlier run's fixtures (this file's own prefix, never this run's) would otherwise be due in every tick.
  const db = serviceDb();
  const stale = await must<{ id: string }[]>(db.from("accounts").select("id").like("clerk_org_id", "org_odb_%").not("clerk_org_id", "like", `%_${RUN}_%`), "stale");
  for (const a of stale) await deleteAccountCascade(db, a.id, "lib/automations/passes/daily-owner-brief.live.test.ts");
  await db.from("users").delete().like("clerk_user_id", "user_odb_%").not("clerk_user_id", "like", `%_${RUN}_%`);
}, 240_000);
beforeEach(() => {
  provider.sent.length = 0; provider.fail = null; provider.hold = null;
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  vi.stubEnv("CONSENT_TOKEN_SECRET", "live-test-secret-0123456789abcdef-0123");
  vi.stubEnv("PHONE_SPAM_EXEMPT_CALLERS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  if (subs.length > 0) await serviceDb().from("owner_brief_subscriptions").delete().in("id", subs.splice(0));
});
afterAll(async () => {
  for (const id of accounts) await deleteAccountCascade(serviceDb(), id, "lib/automations/passes/daily-owner-brief.live.test.ts");
  for (const sub of people) await serviceDb().from("users").delete().eq("clerk_user_id", sub);
}, 240_000);

describe("the daily owner brief pass (live)", () => {
  it("sends ONE brief at 07:00 local, from the brand, with the one-click way off; the next ticks that morning send nothing", async () => {
    const b = await business("sent"); const p = await person("sent"); const id = await subscribe(b, p);
    await job(b, "Alice");
    const first = await tick(T0700);
    expect(first.sent).toBe(1);
    const [mail] = mine(p);
    expect(mail!.subject).toContain(b.brand);
    expect(mail!.body).toContain("Alice Customer");
    expect(mail!.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\/api\/brief\/off\/.+>$/);
    expect(mail!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(`${mail!.subject}${mail!.body}${mail!.html}`).not.toContain(b.internal);   // accounts.name never reaches the owner's inbox
    expect(await row(id)).toEqual({ last_handled_day: "2027-03-10", last_sent_day: "2027-03-10", last_outcome: "sent" });
    for (const m of [15, 30, 59, 119]) await tick(at(m));
    expect(mine(p)).toHaveLength(1);
  });

  it("a quiet day sends nothing, is counted quiet (never sent), and the next tick does not recompute (no read but the subscription list)", async () => {
    const b = await business("quiet"); const p = await person("quiet"); const id = await subscribe(b, p);
    const first = await tick(T0700);
    expect(first).toMatchObject({ sent: 0, skippedQuiet: 1 });
    expect(mine(p)).toHaveLength(0);
    expect(await row(id)).toMatchObject({ last_handled_day: "2027-03-10", last_sent_day: null, last_outcome: "quiet" });
    const w = watch(serviceDb());
    const second = await tick(at(15), w.db);
    expect(second.skippedAlreadyHandled).toBeGreaterThanOrEqual(1);
    expect(w.tables.filter((t) => t !== "owner_brief_subscriptions")).toEqual([]);
  });

  it("a failed send RELEASES the claim, the next tick retries and sends once", async () => {
    const b = await business("retry"); const p = await person("retry"); const id = await subscribe(b, p);
    await job(b, "Retry");
    provider.fail = () => { throw new Error("resend said no"); };
    const first = await tick(T0700);
    expect(first).toMatchObject({ sent: 0, failed: 1, released: 1 });
    expect(await row(id)).toMatchObject({ last_handled_day: null, last_sent_day: null });
    provider.fail = null;
    expect(await tick(at(15))).toMatchObject({ sent: 1 });
    expect(mine(p)).toHaveLength(1);
  });

  it("a failure that may have landed (a reset connection) is released too, and the retry carries the SAME fixed idempotency key", async () => {
    const b = await business("unsure"); const p = await person("unsure"); await subscribe(b, p);
    await job(b, "Unsure");
    provider.fail = () => { throw new Error("Unable to fetch data. The request could not be resolved."); };
    expect(await tick(T0700)).toMatchObject({ sent: 0, failed: 1, released: 1 });
    provider.fail = null;
    expect(await tick(at(15))).toMatchObject({ sent: 1 });
    expect(mine(p)[0]!.idempotencyKey).toBe(`daily-brief/${b.id}/${p.id}/2027-03-10`);   // the unit file pins that both attempts carry it
  });

  it("a replayed identical now sends once, in sequence and when two runs overlap", async () => {
    const b = await business("replay"); const p = await person("replay"); await subscribe(b, p);
    await job(b, "Replay");
    await tick(T0700); await tick(T0700);
    expect(mine(p)).toHaveLength(1);

    const b2 = await business("overlap"); const p2 = await person("overlap"); await subscribe(b2, p2);
    await job(b2, "Overlap");
    let release!: () => void;
    provider.hold = new Promise<void>((r) => { release = r; });
    const both = Promise.all([tick(T0700), tick(T0700)]);
    setTimeout(release, 1500);                    // both runs have long since reached their send or lost the claim
    await both;
    expect(mine(p2)).toHaveLength(1);
  });

  it("only inside 07:00-08:59 local: 06:45, 09:00 and 10:00 send nothing, and the day is not claimed", async () => {
    const b = await business("band"); const p = await person("band"); const id = await subscribe(b, p);
    await job(b, "Band");
    for (const m of [-15, 120, 180]) expect(await tick(at(m))).toMatchObject({ sent: 0 });
    expect((await row(id)).last_handled_day).toBeNull();
    expect(await tick(at(119))).toMatchObject({ sent: 1 });                     // 08:59 is still inside
  });

  it("a person who turned it on today waits for tomorrow; opted out (row deleted) is never mailed", async () => {
    const b = await business("new"); const p = await person("new"); await subscribe(b, p, "owner", "2027-03-10T10:00:00Z");
    await job(b, "New");
    expect(await tick(T0700)).toMatchObject({ sent: 0 });
    expect(await tick(new Date(T0700.getTime() + 86_400_000))).toMatchObject({ sent: 0, skippedQuiet: 1 });   // tomorrow: eligible (nothing booked that day)
    const b2 = await business("off"); const p2 = await person("off"); const id = await subscribe(b2, p2);
    await job(b2, "Off");
    await must(serviceDb().from("owner_brief_subscriptions").delete().eq("id", id).select("id"), "delete");
    await tick(T0700);
    expect(mine(p2)).toHaveLength(0);
  });

  it.each([
    ["removed from the team", async (b: Biz, p: { id: string }) => { await must(serviceDb().from("memberships").delete().eq("account_id", b.id).eq("user_id", p.id).select("id"), "m"); }],
    ["demoted to technician", async (b: Biz, p: { id: string }) => { await must(serviceDb().from("memberships").update({ role: "technician" }).eq("account_id", b.id).eq("user_id", p.id).select("id"), "m"); }],
    ["the account is outbound-suppressed", async (b: Biz) => { await must(serviceDb().from("accounts").update({ outbound_suppressed: true }).eq("id", b.id).select("id"), "a"); }],
    ["client access is off", async (b: Biz) => { await must(serviceDb().from("accounts").update({ client_access_enabled: false }).eq("id", b.id).select("id"), "a"); }],
    ["the account is archived", async (b: Biz) => { await must(serviceDb().from("accounts").update({ status: "archived" }).eq("id", b.id).select("id"), "a"); }],
  ])("nothing is sent when %s", async (_name, change) => {
    const b = await business("gone"); const p = await person("gone"); await subscribe(b, p);
    await job(b, "Gone");
    await change(b, p);
    await tick(T0700);
    expect(mine(p)).toHaveLength(0);
  });

  it("a staff member is mailed too (owner answer Q1)", async () => {
    const b = await business("staff"); const p = await person("staff"); await subscribe(b, p, "staff");
    await job(b, "Staffer");
    expect(await tick(T0700)).toMatchObject({ sent: 1 });
  });

  it("a person in two businesses gets two emails, each from its own brand with only its own content; counters equal the sends", async () => {
    const a = await business("two-a"); const bb = await business("two-b"); const p = await person("two");
    await subscribe(a, p); await subscribe(bb, p);
    await job(a, "Alicia"); await job(bb, "Roberto");
    await call(a, "lead");                                   // A's one lead; B has two answered calls and no lead
    await call(bb, "message"); await call(bb, "message");
    const c = await tick(T0700);
    const [fromA, fromB] = [mine(p).find((s) => s.subject.includes(a.brand)), mine(p).find((s) => s.subject.includes(bb.brand))];
    expect(mine(p)).toHaveLength(2);
    expect(fromA!.body).toContain("Alicia");
    expect(fromA!.body).not.toContain("Roberto");
    expect(fromB!.body).toContain("Roberto");
    expect(fromB!.body).not.toContain("Alicia");
    expect(fromA!.subject).toContain("1 new lead");
    expect(fromA!.subject).not.toContain("2 calls");  // B's two calls never reach A's subject
    expect(fromB!.subject).toContain("2 calls");
    expect(fromB!.subject).not.toContain("lead");     // A's lead never reaches B's
    expect(c.sent).toBe(provider.sent.length);
  });

  it("spam, abandoned, owner-line and agency-handset calls yesterday leave the day quiet; a real answered call does not", async () => {
    const b = await business("calls"); const p = await person("calls"); await subscribe(b, p);
    const handset = "+19565550199";
    vi.stubEnv("PHONE_SPAM_EXEMPT_CALLERS", handset);
    const owner = await person("calls-owner");
    await call(b, "spam"); await call(b, "abandoned");
    await call(b, "lead", { owner_line_user_id: owner.id });
    await call(b, "lead", { caller_e164: handset });
    expect(await tick(T0700)).toMatchObject({ sent: 0, skippedQuiet: 1 });
    expect(mine(p)).toHaveLength(0);
    const b2 = await business("calls2"); const p2 = await person("calls2"); await subscribe(b2, p2);
    await call(b2, "message");
    await tick(T0700);
    expect(mine(p2)).toHaveLength(1);
  });

  it("one subscription's failing read does not stop the next, and the failed one is released for the next tick", async () => {
    const bad = await business("bad"); const good = await business("good"); const pb = await person("bad"); const pg = await person("good");
    const idBad = await subscribe(bad, pb); await subscribe(good, pg);
    await job(bad, "Bad"); await job(good, "Good");
    const w = watch(serviceDb(), { poisonBookingsOf: bad.id });
    const c = await tick(T0700, w.db);
    expect(c).toMatchObject({ failed: 1, released: 1 });
    expect(mine(pg)).toHaveLength(1);
    expect(mine(pb)).toHaveLength(0);
    expect((await row(idBad)).last_handled_day).toBeNull();
  });

  it("with APP_ORIGIN unset nothing is sent and nothing is claimed: a brief never carries a vercel.app link", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    const b = await business("origin"); const p = await person("origin"); const id = await subscribe(b, p);
    await job(b, "Origin");
    expect(await tick(T0700)).toMatchObject({ sent: 0, skippedNoOrigin: 1 });
    expect((await row(id)).last_handled_day).toBeNull();
  });

  it("the brief speaks the person's language, then the account's, then English", async () => {
    const b = await business("lang", { language: "en" }); const p = await person("lang", "es"); await subscribe(b, p);
    await job(b, "Lengua");
    await tick(T0700);
    expect(mine(p)[0]!.subject).toMatch(/1 trabajo hoy/);
  });
});

import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0109 (spec docs/superpowers/specs/2026-10-31-search-scale-design.md 4.6 item 3): wrapping the 64 policies' helper
 * calls changes no outcome. This is an EQUIVALENCE guard, not a red-first test: it is green on 0001-0108 and must be
 * green, unchanged, on 0001-0109. Each role's whole matrix is pinned below, as read on the 0001-0108 replica and
 * checked cell by cell against the policies; the same file then ran on the replica with 0109 applied.
 *
 * Two accounts and a third with client access off. A has an Owner, a Staff member, two Technicians (each assigned one
 * customer: Mine and Theirs) and a signed-in person with no membership; B and C have an Owner each. Rows of each kind
 * on A and B. Every write runs in a savepoint and is rolled back, so each probe sees the same seed; a refusal is
 * reported by its SQLSTATE, a write by the rows it touched.
 */

const RUN = Math.random().toString(36).slice(2, 10);
const ORG = { A: `org_pi_a_${RUN}`, B: `org_pi_b_${RUN}`, C: `org_pi_c_${RUN}` };
const SUB = {
  ownerA: `u_pi_owner_a_${RUN}`, staffA: `u_pi_staff_a_${RUN}`, techA: `u_pi_tech_a_${RUN}`, tech2A: `u_pi_tech2_a_${RUN}`,
  loneA: `u_pi_lone_a_${RUN}`, ownerB: `u_pi_owner_b_${RUN}`, ownerC: `u_pi_owner_c_${RUN}`, agency: `u_pi_agency_${RUN}`,
} as const;

const one = async (c: Client, sql: string, args: unknown[] = []) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

async function seed(c: Client) {
  const agency = (await c.query<{ id: string }>("select id from agencies order by created_at limit 1")).rows[0]!.id;
  const acct = async (org: string, on: boolean) =>
    one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PI Co',$3) returning id", [agency, org, on]);
  const A = await acct(ORG.A, true), B = await acct(ORG.B, true), C = await acct(ORG.C, false);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[])
    u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  const member = (user: string, account: string, role: string) =>
    one(c, "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,$3) returning id", [user, account, role]);
  const m = {
    ownerA: await member(u.ownerA, A, "owner"), staffA: await member(u.staffA, A, "staff"), techA: await member(u.techA, A, "technician"),
    tech2A: await member(u.tech2A, A, "technician"), ownerB: await member(u.ownerB, B, "owner"), ownerC: await member(u.ownerC, C, "owner"),
  };
  const contact = (account: string, name: string, who: string | null = null) =>
    one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [account, name, who]);
  const ct = {
    Amine: await contact(A, "Mine", u.techA), Atheirs: await contact(A, "Theirs", u.tech2A), Aspare: await contact(A, "Spare"),
    Bone: await contact(B, "One"), Bspare: await contact(B, "Spare"), Cone: await contact(C, "One"),
  };
  const phone = (account: string) =>
    one(c, "insert into phone_numbers (account_id, e164) values ($1, '+999' || lpad((floor(random() * 1e12))::bigint::text, 12, '0')) returning id", [account]);
  const ph = { A: await phone(A), B: await phone(B) };
  const call = (account: string, p: string, k: string) =>
    one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [account, p, k]);
  const conv = (account: string, k: string) => one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [account, k]);
  const cv = { Amine: await conv(A, ct.Amine), Atheirs: await conv(A, ct.Atheirs), Bone: await conv(B, ct.Bone) };
  const msg = (account: string, v: string) =>
    one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'sms','inbound','hola','customer') returning id", [account, v]);
  const cal = {
    A: await one(c, "insert into calendars (account_id, public_id) values ($1,$2) returning id", [A, `cal_pi_a_${RUN}`]),
    B: await one(c, "insert into calendars (account_id, public_id) values ($1,$2) returning id", [B, `cal_pi_b_${RUN}`]),
  };
  let tok = 0;
  const booking = (account: string, calendar: string, k: string, days: number) =>
    one(c, `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind)
              values ($1,$2,$3, now() + make_interval(days => $4), now() + make_interval(days => $4, hours => 1), $5, 'ai') returning id`,
      [account, calendar, k, days, `tok_pi_${RUN}_${++tok}`]);
  const tag = (account: string, name: string) => one(c, "insert into tags (account_id, name) values ($1,$2) returning id", [account, name]);
  const tg = { At: await tag(A, "Vip"), Aspare: await tag(A, "Spare"), Bt: await tag(B, "Vip"), Bspare: await tag(B, "Spare") };
  await c.query("insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$5), ($3,$2,$5), ($4,$6,$7)",
    [ct.Amine, tg.At, ct.Atheirs, ct.Bone, A, tg.Bt, B]);
  const doc = (account: string, k: string, ownersOnly: boolean) =>
    one(c, "insert into documents (account_id, contact_id, title, category, source, created_by, owners_only) values ($1,$2,'Seguro','insurance','upload','user_seed',$3) returning id",
      [account, k, ownersOnly]);
  const note = (account: string, k: string) => one(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'n') returning id", [account, k]);
  const task = (account: string, k: string) => one(c, "insert into tasks (account_id, contact_id, title) values ($1,$2,'t') returning id", [account, k]);
  const never = (account: string, domain: string) =>
    one(c, "insert into inbound_never_log (account_id, pattern, kind, added_by) values ($1,$2,'domain','u_seed') returning id", [account, domain]);
  const event = (account: string) =>
    one(c, "insert into events (account_id, type, actor_type, payload) values ($1,'pi.seeded','system','{}') returning id::text as id", [account]);
  const [fa, fb] = [ct.Amine, ct.Atheirs].sort();
  const plan = await one(c, `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents, stripe_product_id, stripe_price_ids)
      values ($1, 'PI plan', 100, '{"voice_receptionist": true, "web_concierge": false}', '{"voice_minutes": 0, "sms": 0, "ai_chats": 0}',
              '{"voice_minutes": 0, "sms": 0, "ai_chats": 0}', 'prod_pi', '{"base": "price_a", "voice_minutes": "price_b", "sms": "price_c", "ai_chats": "price_d"}')
      returning id`, [agency]);

  /** label -> id, per table: what each role's reads are reported in. */
  const rows: Record<string, Record<string, string>> = {
    accounts: { A, B, C },
    agencies: { agency },
    plans: { plan },
    users: { ...u },
    memberships: { ...m },
    contacts: { ...ct },
    conversations: { ...cv },
    messages: { Amine: await msg(A, cv.Amine), Atheirs: await msg(A, cv.Atheirs), Bone: await msg(B, cv.Bone) },
    calls: { Amine: await call(A, ph.A, ct.Amine), Atheirs: await call(A, ph.A, ct.Atheirs), Bone: await call(B, ph.B, ct.Bone) },
    phone_numbers: { ...ph },
    calendars: { ...cal },
    bookings: { Amine: await booking(A, cal.A, ct.Amine, 3), Atheirs: await booking(A, cal.A, ct.Atheirs, 4), Bone: await booking(B, cal.B, ct.Bone, 3) },
    tags: { ...tg },
    documents: {
      Amine: await doc(A, ct.Amine, false), AmineOwnersOnly: await doc(A, ct.Amine, true), Atheirs: await doc(A, ct.Atheirs, false),
      Bone: await doc(B, ct.Bone, false),
    },
    notes: { Amine: await note(A, ct.Amine), Atheirs: await note(A, ct.Atheirs), Bone: await note(B, ct.Bone) },
    tasks: { Amine: await task(A, ct.Amine), Atheirs: await task(A, ct.Atheirs), Bone: await task(B, ct.Bone) },
    inbound_never_log: { A: await never(A, `a${RUN}.example.com`), B: await never(B, `b${RUN}.example.com`) },
    events: { A: await event(A), B: await event(B) },
    contact_duplicate_flags: {
      A: await one(c, "insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'phone') returning id", [A, fa, fb]),
    },
  };
  return { A, B, C, agency, u, ct, tg, rows };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

/** Runs one statement in a savepoint and ALWAYS rolls it back: the rows it touched, or the SQLSTATE it raised. */
async function probe(c: Client, sql: string, args: unknown[] = []): Promise<number | string> {
  await c.query("savepoint p");
  try {
    return (await c.query(sql, args)).rowCount ?? 0;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  } finally {
    await c.query("rollback to savepoint p");
  }
}

/** Which seeded rows of each table the caller reads, as their labels, sorted; or the SQLSTATE of the refusal. */
async function reads(c: Client, s: Seeded): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [table, byLabel] of Object.entries(s.rows)) {
    const ids = Object.values(byLabel);
    const label = new Map(Object.entries(byLabel).map(([l, id]) => [id, l]));
    await c.query("savepoint r");
    try {
      const { rows } = await c.query<{ id: string }>(`select id::text as id from public.${table} where id::text = any($1::text[])`, [ids]);
      out[table] = rows.map((r) => label.get(r.id)!).sort().join(" ") || "-";
    } catch (e) {
      out[table] = (e as { code?: string }).code ?? "error";
    } finally {
      await c.query("rollback to savepoint r");
    }
  }
  await c.query("savepoint r");
  try {
    const { rows } = await c.query<{ k: string }>(
      "select contact_id::text || '|' || tag_id::text as k from public.contact_tags where tag_id = any($1::uuid[])", [[s.tg.At, s.tg.Bt]]);
    const name = new Map([[`${s.ct.Amine}|${s.tg.At}`, "Amine"], [`${s.ct.Atheirs}|${s.tg.At}`, "Atheirs"], [`${s.ct.Bone}|${s.tg.Bt}`, "Bone"]]);
    out.contact_tags = rows.map((r) => name.get(r.k) ?? "?").sort().join(" ") || "-";
  } catch (e) {
    out.contact_tags = (e as { code?: string }).code ?? "error";
  } finally {
    await c.query("rollback to savepoint r");
  }
  return out;
}

/** One write of each kind the client role holds a grant for, on its own account (A) and on B. */
async function writes(c: Client, s: Seeded): Promise<Record<string, number | string>> {
  const { A, B, ct, tg, rows } = s;
  const [bfa, bfb] = [ct.Bone, ct.Bspare].sort();
  return {
    "contacts insert A": await probe(c, "insert into contacts (account_id, first_name) values ($1,'New')", [A]),
    "contacts insert B": await probe(c, "insert into contacts (account_id, first_name) values ($1,'New')", [B]),
    "contacts update A.mine": await probe(c, "update contacts set first_name = 'X' where id = $1", [ct.Amine]),
    "contacts update A.spare": await probe(c, "update contacts set first_name = 'X' where id = $1", [ct.Aspare]),
    "contacts update B": await probe(c, "update contacts set first_name = 'X' where id = $1", [ct.Bone]),
    "contacts delete A.spare": await probe(c, "delete from contacts where id = $1", [ct.Aspare]),
    "contacts delete B.spare": await probe(c, "delete from contacts where id = $1", [ct.Bspare]),
    "tags insert A": await probe(c, "insert into tags (account_id, name) values ($1,'New')", [A]),
    "tags insert B": await probe(c, "insert into tags (account_id, name) values ($1,'New')", [B]),
    "tags update A": await probe(c, "update tags set name = 'X' where id = $1", [tg.At]),
    "tags update B": await probe(c, "update tags set name = 'X' where id = $1", [tg.Bt]),
    "tags move A.spare to B": await probe(c, "update tags set account_id = $2 where id = $1", [tg.Aspare, B]),
    "tags delete A.spare": await probe(c, "delete from tags where id = $1", [tg.Aspare]),
    "tags delete B.spare": await probe(c, "delete from tags where id = $1", [tg.Bspare]),
    "contact_tags insert A.mine": await probe(c, "insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [ct.Amine, tg.Aspare, A]),
    "contact_tags insert A.spare": await probe(c, "insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [ct.Aspare, tg.At, A]),
    "contact_tags insert B": await probe(c, "insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [ct.Bspare, tg.Bt, B]),
    "contact_tags delete A.mine": await probe(c, "delete from contact_tags where contact_id = $1 and tag_id = $2", [ct.Amine, tg.At]),
    "contact_tags delete A.theirs": await probe(c, "delete from contact_tags where contact_id = $1 and tag_id = $2", [ct.Atheirs, tg.At]),
    "contact_tags delete B": await probe(c, "delete from contact_tags where contact_id = $1 and tag_id = $2", [ct.Bone, tg.Bt]),
    "notes insert A.mine": await probe(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [A, ct.Amine]),
    "notes insert A.theirs": await probe(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [A, ct.Atheirs]),
    "notes insert B": await probe(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [B, ct.Bone]),
    "notes update A.mine": await probe(c, "update notes set body = 'y' where id = $1", [rows.notes!.Amine]),
    "notes update B": await probe(c, "update notes set body = 'y' where id = $1", [rows.notes!.Bone]),
    "notes move A.mine to B": await probe(c, "update notes set account_id = $2 where id = $1", [rows.notes!.Amine, B]),
    "notes delete A.theirs": await probe(c, "delete from notes where id = $1", [rows.notes!.Atheirs]),
    "notes delete B": await probe(c, "delete from notes where id = $1", [rows.notes!.Bone]),
    "tasks insert A.mine": await probe(c, "insert into tasks (account_id, contact_id, title) values ($1,$2,'x')", [A, ct.Amine]),
    "tasks insert B": await probe(c, "insert into tasks (account_id, contact_id, title) values ($1,$2,'x')", [B, ct.Bone]),
    "tasks update A.mine": await probe(c, "update tasks set title = 'y' where id = $1", [rows.tasks!.Amine]),
    "tasks update A.theirs": await probe(c, "update tasks set title = 'y' where id = $1", [rows.tasks!.Atheirs]),
    "tasks update B": await probe(c, "update tasks set title = 'y' where id = $1", [rows.tasks!.Bone]),
    "tasks delete A.mine": await probe(c, "delete from tasks where id = $1", [rows.tasks!.Amine]),
    "tasks delete B": await probe(c, "delete from tasks where id = $1", [rows.tasks!.Bone]),
    "calendars update A": await probe(c, "update calendars set enabled = false where id = $1", [rows.calendars!.A]),
    "calendars update B": await probe(c, "update calendars set enabled = false where id = $1", [rows.calendars!.B]),
    "accounts update A": await probe(c, "update accounts set brand_name = 'X' where id = $1", [A]),
    "accounts update B": await probe(c, "update accounts set brand_name = 'X' where id = $1", [B]),
    "accounts update C": await probe(c, "update accounts set brand_name = 'X' where id = $1", [s.C]),
    "agencies update": await probe(c, "update agencies set report_email = report_email where id = $1", [s.agency]),
    "duplicate flag insert A": await probe(c, "insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'phone')",
      [A, ...[ct.Amine, ct.Aspare].sort()]),
    "duplicate flag insert B": await probe(c, "insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'phone')", [B, bfa, bfb]),
  };
}

const ROLES = ["ownerA", "staffA", "techA", "loneA", "ownerC", "ownerB", "agency", "forged", "anon"] as const;
type Role = (typeof ROLES)[number];
async function become(c: Client, role: Role) {
  if (role === "anon") return void (await c.query("set local role anon"));
  if (role === "agency") return actAs(c, { app_role: "agency_admin", org_id: "org_agency", sub: SUB.agency });
  if (role === "forged") return actAs(c, { org_id: `org_pi_nope_${RUN}`, sub: `u_pi_nobody_${RUN}` });
  const org = role === "ownerB" ? ORG.B : role === "ownerC" ? ORG.C : ORG.A;
  return actAs(c, { org_id: org, sub: SUB[role] });
}

type Matrix = { reads: Record<string, string>; writes: Record<string, number | string> };
async function matrix(role: Role): Promise<Matrix> {
  let out: Matrix | undefined;
  await withRollback(async (c) => {
    const s = await seed(c);
    await become(c, role);
    out = { reads: await reads(c, s), writes: await writes(c, s) };
  });
  return out!;
}

/** Whose rows each role may touch at all: the agency every account's, a member only their own, the rest nothing. */
const HOME: Record<Role, string | null> = { ownerA: "A", staffA: "A", techA: "A", loneA: "A", ownerB: "B", ownerC: "", forged: "", anon: "", agency: null };
/** People and agency-level rows are reported by role, not by account, so the account check skips them. */
const NOT_BY_ACCOUNT = ["users", "memberships", "agencies", "plans"];

/** Nothing outside the caller's own account, read or written. Independent of the pins: it reads only the labels' account letter. */
function tenancy(role: Role, m: Matrix) {
  const home = HOME[role];
  if (home === null) return;
  const refusedOrEmpty = (v: string) => v === "-" || /^[0-9A-Z]{5}$/.test(v);
  const leaked = Object.entries(m.reads).filter(([t, v]) => !NOT_BY_ACCOUNT.includes(t) && !refusedOrEmpty(v))
    .flatMap(([t, v]) => v.split(" ").filter((l) => !home || !l.startsWith(home)).map((l) => `${t} ${l}`));
  expect(leaked, `${role} reads rows outside its account`).toEqual([]);
  const target = (k: string) => k.match(/ to ([ABC])$/)?.[1] ?? k.match(/ ([ABC])(\.\w+)?$/)?.[1];
  const wrote = Object.entries(m.writes).filter(([k, v]) => typeof v === "number" && v > 0 && target(k) !== home).map(([k]) => k);
  expect(wrote, `${role} wrote rows outside its account`).toEqual([]);
}

/* The pinned matrices, read on 0001-0108. */
const EXPECTED: Record<Role, { reads: Record<string, string>; writes: Record<string, number | string> }> = {
  ownerA: {
    reads: {
      accounts: "A", agencies: "-", plans: "-", users: "ownerA staffA tech2A techA", memberships: "ownerA staffA tech2A techA",
      contacts: "Amine Aspare Atheirs", conversations: "Amine Atheirs", messages: "Amine Atheirs", calls: "Amine Atheirs", phone_numbers: "A",
      calendars: "A", bookings: "Amine Atheirs", tags: "Aspare At", documents: "Amine AmineOwnersOnly Atheirs", notes: "Amine Atheirs",
      tasks: "Amine Atheirs", inbound_never_log: "A", events: "A", contact_duplicate_flags: "A", contact_tags: "Amine Atheirs",
    },
    writes: {
      "contacts insert A": 1, "contacts insert B": "42501", "contacts update A.mine": 1, "contacts update A.spare": 1,
      "contacts update B": 0, "contacts delete A.spare": 1, "contacts delete B.spare": 0, "tags insert A": 1,
      "tags insert B": "42501", "tags update A": 1, "tags update B": 0, "tags move A.spare to B": "42501",
      "tags delete A.spare": 1, "tags delete B.spare": 0, "contact_tags insert A.mine": 1, "contact_tags insert A.spare": 1,
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 1, "contact_tags delete A.theirs": 1, "contact_tags delete B": 0,
      "notes insert A.mine": 1, "notes insert A.theirs": 1, "notes insert B": "42501", "notes update A.mine": 1,
      "notes update B": 0, "notes move A.mine to B": "42501", "notes delete A.theirs": 1, "notes delete B": 0,
      "tasks insert A.mine": 1, "tasks insert B": "42501", "tasks update A.mine": 1, "tasks update A.theirs": 1,
      "tasks update B": 0, "tasks delete A.mine": 1, "tasks delete B": 0, "calendars update A": 1,
      "calendars update B": 0, "accounts update A": 1, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": 1, "duplicate flag insert B": "42501",
    },
  },
  staffA: {
    reads: {
      accounts: "A", agencies: "-", plans: "-", users: "ownerA staffA tech2A techA", memberships: "ownerA staffA tech2A techA",
      contacts: "Amine Aspare Atheirs", conversations: "Amine Atheirs", messages: "Amine Atheirs", calls: "Amine Atheirs", phone_numbers: "A",
      calendars: "A", bookings: "Amine Atheirs", tags: "Aspare At", documents: "Amine Atheirs", notes: "Amine Atheirs",
      tasks: "Amine Atheirs", inbound_never_log: "A", events: "A", contact_duplicate_flags: "A", contact_tags: "Amine Atheirs",
    },
    writes: {
      "contacts insert A": 1, "contacts insert B": "42501", "contacts update A.mine": 1, "contacts update A.spare": 1,
      "contacts update B": 0, "contacts delete A.spare": 0, "contacts delete B.spare": 0, "tags insert A": 1,
      "tags insert B": "42501", "tags update A": 1, "tags update B": 0, "tags move A.spare to B": "42501",
      "tags delete A.spare": 1, "tags delete B.spare": 0, "contact_tags insert A.mine": 1, "contact_tags insert A.spare": 1,
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 1, "contact_tags delete A.theirs": 1, "contact_tags delete B": 0,
      "notes insert A.mine": 1, "notes insert A.theirs": 1, "notes insert B": "42501", "notes update A.mine": 1,
      "notes update B": 0, "notes move A.mine to B": "42501", "notes delete A.theirs": 1, "notes delete B": 0,
      "tasks insert A.mine": 1, "tasks insert B": "42501", "tasks update A.mine": 1, "tasks update A.theirs": 1,
      "tasks update B": 0, "tasks delete A.mine": 1, "tasks delete B": 0, "calendars update A": 0,
      "calendars update B": 0, "accounts update A": 1, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": 1, "duplicate flag insert B": "42501",
    },
  },
  techA: {
    reads: {
      accounts: "A", agencies: "-", plans: "-", users: "ownerA staffA tech2A techA", memberships: "ownerA staffA tech2A techA",
      contacts: "Amine", conversations: "Amine", messages: "Amine", calls: "Amine", phone_numbers: "A",
      calendars: "A", bookings: "Amine", tags: "Aspare At", documents: "Amine", notes: "Amine",
      tasks: "Amine", inbound_never_log: "-", events: "-", contact_duplicate_flags: "-", contact_tags: "Amine",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": "42501", "contacts update A.mine": 1, "contacts update A.spare": 0,
      "contacts update B": 0, "contacts delete A.spare": 0, "contacts delete B.spare": 0, "tags insert A": 1,
      "tags insert B": "42501", "tags update A": 0, "tags update B": 0, "tags move A.spare to B": 0,
      "tags delete A.spare": 0, "tags delete B.spare": 0, "contact_tags insert A.mine": 1, "contact_tags insert A.spare": "42501",
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 1, "contact_tags delete A.theirs": 0, "contact_tags delete B": 0,
      "notes insert A.mine": 1, "notes insert A.theirs": "42501", "notes insert B": "42501", "notes update A.mine": 1,
      "notes update B": 0, "notes move A.mine to B": "42501", "notes delete A.theirs": 0, "notes delete B": 0,
      "tasks insert A.mine": "42501", "tasks insert B": "42501", "tasks update A.mine": 1, "tasks update A.theirs": 0,
      "tasks update B": 0, "tasks delete A.mine": 1, "tasks delete B": 0, "calendars update A": 0,
      "calendars update B": 0, "accounts update A": 0, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": "42501", "duplicate flag insert B": "42501",
    },
  },
  loneA: {
    reads: {
      accounts: "A", agencies: "-", plans: "-", users: "ownerA staffA tech2A techA", memberships: "ownerA staffA tech2A techA",
      contacts: "-", conversations: "-", messages: "-", calls: "-", phone_numbers: "A",
      calendars: "A", bookings: "-", tags: "Aspare At", documents: "-", notes: "-",
      tasks: "-", inbound_never_log: "-", events: "-", contact_duplicate_flags: "-", contact_tags: "-",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": "42501", "contacts update A.mine": 0, "contacts update A.spare": 0,
      "contacts update B": 0, "contacts delete A.spare": 0, "contacts delete B.spare": 0, "tags insert A": 1,
      "tags insert B": "42501", "tags update A": 0, "tags update B": 0, "tags move A.spare to B": 0,
      "tags delete A.spare": 0, "tags delete B.spare": 0, "contact_tags insert A.mine": "42501", "contact_tags insert A.spare": "42501",
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 0, "contact_tags delete A.theirs": 0, "contact_tags delete B": 0,
      "notes insert A.mine": "42501", "notes insert A.theirs": "42501", "notes insert B": "42501", "notes update A.mine": 0,
      "notes update B": 0, "notes move A.mine to B": 0, "notes delete A.theirs": 0, "notes delete B": 0,
      "tasks insert A.mine": "42501", "tasks insert B": "42501", "tasks update A.mine": 0, "tasks update A.theirs": 0,
      "tasks update B": 0, "tasks delete A.mine": 0, "tasks delete B": 0, "calendars update A": 0,
      "calendars update B": 0, "accounts update A": 0, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": "42501", "duplicate flag insert B": "42501",
    },
  },
  ownerC: {
    reads: {
      accounts: "-", agencies: "-", plans: "-", users: "-", memberships: "-",
      contacts: "-", conversations: "-", messages: "-", calls: "-", phone_numbers: "-",
      calendars: "-", bookings: "-", tags: "-", documents: "-", notes: "-",
      tasks: "-", inbound_never_log: "-", events: "-", contact_duplicate_flags: "-", contact_tags: "-",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": "42501", "contacts update A.mine": 0, "contacts update A.spare": 0,
      "contacts update B": 0, "contacts delete A.spare": 0, "contacts delete B.spare": 0, "tags insert A": "42501",
      "tags insert B": "42501", "tags update A": 0, "tags update B": 0, "tags move A.spare to B": 0,
      "tags delete A.spare": 0, "tags delete B.spare": 0, "contact_tags insert A.mine": "42501", "contact_tags insert A.spare": "42501",
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 0, "contact_tags delete A.theirs": 0, "contact_tags delete B": 0,
      "notes insert A.mine": "42501", "notes insert A.theirs": "42501", "notes insert B": "42501", "notes update A.mine": 0,
      "notes update B": 0, "notes move A.mine to B": 0, "notes delete A.theirs": 0, "notes delete B": 0,
      "tasks insert A.mine": "42501", "tasks insert B": "42501", "tasks update A.mine": 0, "tasks update A.theirs": 0,
      "tasks update B": 0, "tasks delete A.mine": 0, "tasks delete B": 0, "calendars update A": 0,
      "calendars update B": 0, "accounts update A": 0, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": "42501", "duplicate flag insert B": "42501",
    },
  },
  ownerB: {
    reads: {
      accounts: "B", agencies: "-", plans: "-", users: "ownerB", memberships: "ownerB",
      contacts: "Bone Bspare", conversations: "Bone", messages: "Bone", calls: "Bone", phone_numbers: "B",
      calendars: "B", bookings: "Bone", tags: "Bspare Bt", documents: "Bone", notes: "Bone",
      tasks: "Bone", inbound_never_log: "B", events: "B", contact_duplicate_flags: "-", contact_tags: "Bone",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": 1, "contacts update A.mine": 0, "contacts update A.spare": 0,
      "contacts update B": 1, "contacts delete A.spare": 0, "contacts delete B.spare": 1, "tags insert A": "42501",
      "tags insert B": 1, "tags update A": 0, "tags update B": 1, "tags move A.spare to B": 0,
      "tags delete A.spare": 0, "tags delete B.spare": 1, "contact_tags insert A.mine": "42501", "contact_tags insert A.spare": "42501",
      "contact_tags insert B": 1, "contact_tags delete A.mine": 0, "contact_tags delete A.theirs": 0, "contact_tags delete B": 1,
      "notes insert A.mine": "42501", "notes insert A.theirs": "42501", "notes insert B": 1, "notes update A.mine": 0,
      "notes update B": 1, "notes move A.mine to B": 0, "notes delete A.theirs": 0, "notes delete B": 1,
      "tasks insert A.mine": "42501", "tasks insert B": 1, "tasks update A.mine": 0, "tasks update A.theirs": 0,
      "tasks update B": 1, "tasks delete A.mine": 0, "tasks delete B": 1, "calendars update A": 0,
      "calendars update B": 1, "accounts update A": 0, "accounts update B": 1, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": "42501", "duplicate flag insert B": 1,
    },
  },
  agency: {
    reads: {
      accounts: "A B C", agencies: "agency", plans: "plan", users: "agency loneA ownerA ownerB ownerC staffA tech2A techA", memberships: "ownerA ownerB ownerC staffA tech2A techA",
      contacts: "Amine Aspare Atheirs Bone Bspare Cone", conversations: "Amine Atheirs Bone", messages: "Amine Atheirs Bone", calls: "Amine Atheirs Bone", phone_numbers: "A B",
      calendars: "A B", bookings: "Amine Atheirs Bone", tags: "Aspare At Bspare Bt", documents: "Amine AmineOwnersOnly Atheirs Bone", notes: "Amine Atheirs Bone",
      tasks: "Amine Atheirs Bone", inbound_never_log: "A B", events: "A B", contact_duplicate_flags: "A", contact_tags: "Amine Atheirs Bone",
    },
    writes: {
      "contacts insert A": 1, "contacts insert B": 1, "contacts update A.mine": 1, "contacts update A.spare": 1,
      "contacts update B": 1, "contacts delete A.spare": 1, "contacts delete B.spare": 1, "tags insert A": 1,
      "tags insert B": 1, "tags update A": 1, "tags update B": 1, "tags move A.spare to B": "23505",
      "tags delete A.spare": 1, "tags delete B.spare": 1, "contact_tags insert A.mine": 1, "contact_tags insert A.spare": 1,
      "contact_tags insert B": 1, "contact_tags delete A.mine": 1, "contact_tags delete A.theirs": 1, "contact_tags delete B": 1,
      "notes insert A.mine": 1, "notes insert A.theirs": 1, "notes insert B": 1, "notes update A.mine": 1,
      "notes update B": 1, "notes move A.mine to B": 1, "notes delete A.theirs": 1, "notes delete B": 1,
      "tasks insert A.mine": 1, "tasks insert B": 1, "tasks update A.mine": 1, "tasks update A.theirs": 1,
      "tasks update B": 1, "tasks delete A.mine": 1, "tasks delete B": 1, "calendars update A": 1,
      "calendars update B": 1, "accounts update A": 1, "accounts update B": 1, "accounts update C": 1,
      "agencies update": 1, "duplicate flag insert A": 1, "duplicate flag insert B": 1,
    },
  },
  forged: {
    reads: {
      accounts: "-", agencies: "-", plans: "-", users: "-", memberships: "-",
      contacts: "-", conversations: "-", messages: "-", calls: "-", phone_numbers: "-",
      calendars: "-", bookings: "-", tags: "-", documents: "-", notes: "-",
      tasks: "-", inbound_never_log: "-", events: "-", contact_duplicate_flags: "-", contact_tags: "-",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": "42501", "contacts update A.mine": 0, "contacts update A.spare": 0,
      "contacts update B": 0, "contacts delete A.spare": 0, "contacts delete B.spare": 0, "tags insert A": "42501",
      "tags insert B": "42501", "tags update A": 0, "tags update B": 0, "tags move A.spare to B": 0,
      "tags delete A.spare": 0, "tags delete B.spare": 0, "contact_tags insert A.mine": "42501", "contact_tags insert A.spare": "42501",
      "contact_tags insert B": "42501", "contact_tags delete A.mine": 0, "contact_tags delete A.theirs": 0, "contact_tags delete B": 0,
      "notes insert A.mine": "42501", "notes insert A.theirs": "42501", "notes insert B": "42501", "notes update A.mine": 0,
      "notes update B": 0, "notes move A.mine to B": 0, "notes delete A.theirs": 0, "notes delete B": 0,
      "tasks insert A.mine": "42501", "tasks insert B": "42501", "tasks update A.mine": 0, "tasks update A.theirs": 0,
      "tasks update B": 0, "tasks delete A.mine": 0, "tasks delete B": 0, "calendars update A": 0,
      "calendars update B": 0, "accounts update A": 0, "accounts update B": 0, "accounts update C": 0,
      "agencies update": 0, "duplicate flag insert A": "42501", "duplicate flag insert B": "42501",
    },
  },
  anon: {
    reads: {
      accounts: "-", agencies: "-", plans: "42501", users: "-", memberships: "-",
      contacts: "-", conversations: "-", messages: "-", calls: "42501", phone_numbers: "42501",
      calendars: "-", bookings: "-", tags: "-", documents: "42501", notes: "-",
      tasks: "-", inbound_never_log: "42501", events: "-", contact_duplicate_flags: "42501", contact_tags: "-",
    },
    writes: {
      "contacts insert A": "42501", "contacts insert B": "42501", "contacts update A.mine": "42501", "contacts update A.spare": "42501",
      "contacts update B": "42501", "contacts delete A.spare": "42501", "contacts delete B.spare": "42501", "tags insert A": "42501",
      "tags insert B": "42501", "tags update A": "42501", "tags update B": "42501", "tags move A.spare to B": "42501",
      "tags delete A.spare": "42501", "tags delete B.spare": "42501", "contact_tags insert A.mine": "42501", "contact_tags insert A.spare": "42501",
      "contact_tags insert B": "42501", "contact_tags delete A.mine": "42501", "contact_tags delete A.theirs": "42501", "contact_tags delete B": "42501",
      "notes insert A.mine": "42501", "notes insert A.theirs": "42501", "notes insert B": "42501", "notes update A.mine": "42501",
      "notes update B": "42501", "notes move A.mine to B": "42501", "notes delete A.theirs": "42501", "notes delete B": "42501",
      "tasks insert A.mine": "42501", "tasks insert B": "42501", "tasks update A.mine": "42501", "tasks update A.theirs": "42501",
      "tasks update B": "42501", "tasks delete A.mine": "42501", "tasks delete B": "42501", "calendars update A": "42501",
      "calendars update B": "42501", "accounts update A": "42501", "accounts update B": "42501", "accounts update C": "42501",
      "agencies update": "42501", "duplicate flag insert A": "42501", "duplicate flag insert B": "42501",
    },
  },
};

describe("0109 changes no outcome: each role's reads and writes, pinned before 0109 and identical after", () => {
  for (const role of ROLES) {
    it(`${role}`, async () => {
      const m = await matrix(role);
      tenancy(role, m);
      expect(m).toEqual(EXPECTED[role]);
    });
  }
});

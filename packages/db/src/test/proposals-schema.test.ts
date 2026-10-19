import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback, actAs } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0088 (item 8b-1, spec 4.1 and 8.2; plan Task 1): one table for every AI suggestion. Server-written
 * only; a client reads a row when it reads the account and, for a Technician, the row's customer (a row
 * with no customer is Owner and Staff only). Same-account composite FKs to calls and contacts, both
 * cascading. What was proposed never changes. One pending row per call, kind and customer.
 *
 * ONE REFUSED STATEMENT PER withRollback: a refusal aborts the transaction (25P02), so every refusing
 * case below has its own block (plan reviewer note 3).
 *
 * call-proposals-grants.test.ts stays (the old table lives until 0089); its cases are re-stated here for
 * proposals. Its column-level UPDATE cases have no twin: no client role holds any UPDATE on proposals,
 * which "authenticated holds UPDATE on no column" pins.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_prp_${RUN}`;
const ORG_B = `org_prpb_${RUN}`;
const SUB = { owner: `u_prp_owner_${RUN}`, staff: `u_prp_staff_${RUN}`, tech: `u_prp_tech_${RUN}`, tech2: `u_prp_tech2_${RUN}`, ownerB: `u_prp_ownerb_${RUN}` } as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_prp_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };
const DIGITS = () => Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
const PAYLOAD = { title: "Send the quote", dueAt: null };
const EXPIRES = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

/** One valid pending row for (acct, call, contact); `over` replaces or adds columns, `undefined` drops one. */
const row = (acct: string, call: string | null, contact: string | null, over: Record<string, unknown> = {}) => ({
  account_id: acct, source: "call", call_id: call, contact_id: contact, kind: "task", payload: PAYLOAD,
  evidence: "I need a quote", expires_at: EXPIRES, ...over,
});
function ins(c: Client, r: Record<string, unknown>) {
  const cols = Object.keys(r).filter((k) => r[k] !== undefined);
  const vals = cols.map((k) => { const v = r[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
  return c.query<{ id: string }>(
    `insert into proposals (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PRP Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PRP B',true) returning id", [agency!.id, ORG_B]);
  const u: Record<string, string> = {};
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (account: string, who: string | null, name: string) =>
    one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [account, name, who]);
  const mine = await ct(acct, u.tech!, "Mine");
  const theirs = await ct(acct, u.tech2!, "Theirs");
  const other = await ct(acctB, null, "Other");
  const phone = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, `+1999${DIGITS()}`]);
  const phoneB = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acctB, `+1999${DIGITS()}`]);
  const call = (account: string, ph: string, contact: string | null) =>
    one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [account, ph, contact]);
  const calls = { mine: await call(acct, phone, mine), theirs: await call(acct, phone, theirs), none: await call(acct, phone, null), other: await call(acctB, phoneB, other) };
  return { acct, acctB, mine, theirs, other, calls };
}
type Seeded = Awaited<ReturnType<typeof seed>>;
/** A's three rows (Mine, Theirs, no customer) and B's one. */
async function seedRows(c: Client, s: Seeded) {
  return {
    mine: (await ins(c, row(s.acct, s.calls.mine, s.mine))).rows[0]!.id,
    theirs: (await ins(c, row(s.acct, s.calls.theirs, s.theirs))).rows[0]!.id,
    none: (await ins(c, row(s.acct, s.calls.none, null))).rows[0]!.id,
    other: (await ins(c, row(s.acctB, s.calls.other, s.other))).rows[0]!.id,
  };
}
/** Pins the table's existence inside a catalogue case, so an empty answer can never mean "no table". */
async function tableExists(c: Client) {
  const { rows } = await c.query<{ oid: string | null }>("select to_regclass('public.proposals')::text as oid");
  expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("proposals");
}

describe("0088: the table, its grants and who writes (spec 4.1, 8.2)", () => {
  it("the table exists (guards every case below from vacuity)", () => withRollback(tableExists));

  it("anon holds nothing; authenticated holds exactly SELECT; service_role holds DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE; the full grant set across every role including PUBLIC is exactly this (mutation: grant insert on public.proposals to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'proposals' and grantee <> 'postgres'
           order by grantee, privilege_type`);
      expect(rows).toEqual([
        { grantee: "authenticated", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "DELETE" },
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "REFERENCES" },
        { grantee: "service_role", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "TRIGGER" },
        { grantee: "service_role", privilege_type: "TRUNCATE" },
        { grantee: "service_role", privilege_type: "UPDATE" },
      ]);
    }));

  // An empty column set is also what a missing table answers, so the case pins the table first and runs
  // the same filter against calendars, whose settings columns the client role does update (the control).
  it("authenticated holds UPDATE on no column (mutation: grant update (status) on public.proposals to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await tableExists(c);
      const updatable = async (table: string) => (await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
           where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' and privilege_type = 'UPDATE'`,
        [table])).rows.map((r) => r.column_name).sort();
      expect((await updatable("calendars")).length, "calendars (the control)").toBeGreaterThan(0);
      expect(await updatable("proposals")).toEqual([]);
    }));

  it("a client cannot INSERT a proposal, even for its own account and call (mutation: grant insert on public.proposals to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("owner"));
      await expect(ins(c, row(s.acct, s.calls.mine, s.mine)))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table proposals\b/) });
    }));
});

describe("0088: who reads (spec 4.1 RLS, 8.3 :363; P14)", () => {
  it("Owner and Staff read A's three rows, the Technician only Mine, the agency all four, B's Owner only B's own (mutations: drop proposals_technician_scope, or its exists -> true -> tech reads three -> FAILS; drop member_read's account arm -> owner reads none -> FAILS; member_read using (true) -> B's owner reads A's rows -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await seedRows(c, s);
      const all = [r.mine, r.theirs, r.none, r.other];
      const readAs = async (p: Who) => {
        await actAs(c, claims(p));
        const { rows } = await c.query<{ id: string }>("select id from proposals where id = any($1::uuid[]) order by id", [all]);
        await c.query("reset role");
        return rows.map((x) => x.id);
      };
      const sorted = (xs: string[]) => [...xs].sort();
      expect(await readAs("owner"), "owner").toEqual(sorted([r.mine, r.theirs, r.none]));
      expect(await readAs("staff"), "staff").toEqual(sorted([r.mine, r.theirs, r.none]));
      expect(await readAs("tech"), "tech").toEqual([r.mine]);
      expect(await readAs("agency"), "agency").toEqual(sorted(all));
      expect(await readAs("ownerB"), "ownerB").toEqual([r.other]);
    }));
});

describe("0088: the composite FKs (spec 4.1)", () => {
  it("refuse a call from another account (mutation: FK on call_id alone, references public.calls (id) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, row(s.acct, s.calls.other, null)))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"proposals_call_fkey"/) });
    }));

  it("...and a contact from another account (mutation: FK on contact_id alone, references public.contacts (id) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, row(s.acct, s.calls.mine, s.other)))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"proposals_contact_fkey"/) });
    }));

  it("deleting a call removes its rows; deleting a contact removes its rows (mutation: on delete no action on either -> the delete raises 23503 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await seedRows(c, s);
      const left = async (id: string) => (await c.query("select 1 from proposals where id = $1", [id])).rowCount;
      expect([await left(r.none), await left(r.theirs)], "both rows exist first").toEqual([1, 1]);
      await c.query("delete from calls where id = $1", [s.calls.none]);
      expect(await left(r.none), "the call's row").toBe(0);
      await c.query("delete from contacts where id = $1", [s.theirs]);
      expect(await left(r.theirs), "the contact's row").toBe(0);
      expect(await left(r.mine), "an unrelated row stays").toBe(1);
    }));

  it("account teardown lists proposals before calls (mutation: move it after calls -> FAILS)", () => {
    const at = (t: string) => (ACCOUNT_OWNED_TABLES as readonly string[]).indexOf(t);
    expect(at("proposals")).toBeGreaterThanOrEqual(0);
    expect(at("proposals")).toBeLessThan(at("calls"));
  });
});

const AT = "2026-10-19T12:00:00Z";
const DECIDED = { decided_at: AT, decided_by: "user_x" };
// [title, the constraint, the row's overrides]. Each row breaks exactly that one constraint, so dropping
// it lets exactly that insert land.
const CHECKS: [string, string, Record<string, unknown>][] = [
  ["a pending row with decided_at set", "proposals_decision_complete", { decided_at: AT }],
  ["an accepted row with decided_* but no applied_payload", "proposals_applied_when_accepted", { status: "accepted", ...DECIDED }],
  ["a pending row WITH an applied_payload", "proposals_applied_when_accepted", { applied_payload: PAYLOAD }],
  ["an edited row whose applied_payload equals payload", "proposals_edited_changes", { status: "edited", ...DECIDED, applied_payload: PAYLOAD }],
  ["an expired row with no expired_reason", "proposals_expired_has_reason", { status: "expired", decided_at: AT, decided_by: "system" }],
  ["a pending row WITH a reason", "proposals_expired_has_reason", { expired_reason: "aged" }],
  ["source call with call_id null", "proposals_source_key", { call_id: null }],
  ["kind note", "proposals_kind_check", { kind: "note" }],
  ["status done", "proposals_status_check", { status: "done", ...DECIDED }],
  ["expired_reason stale", "proposals_expired_reason_check", { status: "expired", decided_at: AT, decided_by: "system", expired_reason: "stale" }],
  ["evidence_lang fr", "proposals_evidence_lang_check", { evidence_lang: "fr" }],
  // Spaces only: btrim(text) strips the ASCII space alone, as 0040's twin does (a tab-only evidence lands).
  ["whitespace-only evidence", "proposals_evidence_nonempty", { evidence: "   " }],
  ["undone_at without undone_by", "proposals_undone_pair", { undone_at: AT }],
];

describe("0088: the CHECKs (spec 4.1, 8.2)", () => {
  it.each(CHECKS)("refuses %s, by %s (mutation: drop that constraint -> the insert lands -> FAILS)", (_title, name, over) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, row(s.acct, s.calls.mine, s.mine, over)))
        .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(new RegExp(`"${name}"`)) });
    }));

  it("an insert without expires_at fails (mutation: expires_at not null default now() + interval '30 days' -> the insert lands -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, row(s.acct, s.calls.mine, s.mine, { expires_at: undefined })))
        .rejects.toMatchObject({ code: "23502", message: expect.stringMatching(/"expires_at"/) });
    }));
});

describe("0088: what was proposed never changes, from the service role too (spec 4.1)", () => {
  const FIXED: [string, string][] = [
    ["payload", `payload = '{"title":"Something else","dueAt":null}'::jsonb`],
    ["evidence", "evidence = 'I said something else'"],
    ["expires_at", "expires_at = expires_at + interval '1 day'"],
    ["contact_id", "contact_id = $2"],
    ["kind", "kind = 'contact_field'"],
  ];
  it.each(FIXED)("refuses a change to %s (mutation: drop the payload line from the trigger -> the payload case FAILS)", (_col, set) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await ins(c, row(s.acct, s.calls.mine, s.mine))).rows[0]!.id;
      await c.query("set local role service_role");
      const args = set.includes("$2") ? [id, s.theirs] : [id];
      await expect(c.query(`update proposals set ${set} where id = $1`, args))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/proposals_proposed_is_fixed/) });
    }));

  it("decision columns move freely", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await ins(c, row(s.acct, s.calls.mine, s.mine))).rows[0]!.id;
      await c.query("set local role service_role");
      const r = await c.query("update proposals set status = 'dismissed', decided_at = now(), decided_by = 'u' where id = $1", [id]);
      expect(r.rowCount).toBe(1);
    }));
});

describe("0088: one pending row per call, kind and customer (spec 4.1; 0040's coalesce)", () => {
  it("refuses a second pending row for the same call, kind and customer (mutation: drop the index -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await ins(c, row(s.acct, s.calls.mine, s.mine));
      await expect(ins(c, row(s.acct, s.calls.mine, s.mine)))
        .rejects.toMatchObject({ code: "23505", message: expect.stringMatching(/"proposals_one_pending_per_call"/) });
    }));

  it("...including when the customer is null (mutation: index on (call_id, kind, contact_id) without coalesce -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await ins(c, row(s.acct, s.calls.none, null));
      await expect(ins(c, row(s.acct, s.calls.none, null)))
        .rejects.toMatchObject({ code: "23505", message: expect.stringMatching(/"proposals_one_pending_per_call"/) });
    }));

  it("once the first is dismissed, a second pending row is accepted", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await ins(c, row(s.acct, s.calls.none, null))).rows[0]!.id;
      await c.query("update proposals set status = 'dismissed', decided_at = now(), decided_by = 'u' where id = $1", [id]);
      expect((await ins(c, row(s.acct, s.calls.none, null))).rowCount).toBe(1);
    }));
});

describe("0088: the CHECK lists equal the code's lists (spec 8.3 :364)", () => {
  it.todo("parity with proposal-rules (Task 4 turns this on)");
});

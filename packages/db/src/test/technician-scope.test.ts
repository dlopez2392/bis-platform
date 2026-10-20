import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";

/**
 * Mine, Unassigned and the Technician (spec §5). Every customer-data table is
 * fenced by a RESTRICTIVE policy keyed on app.sees_all_customers(): agency,
 * Owner and Staff see everything their tenant policy allows; a Technician
 * sees only rows that reach a contact assigned to them; anyone else sees
 * nothing. A refused SELECT/UPDATE/DELETE under RLS is not an error (rowCount
 * 0); a refused INSERT or WITH CHECK raises 42501.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_tech_${RUN}`;
const DIGITS = () => Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
const SUB = {
  owner: `user_t_owner_${RUN}`, staff: `user_t_staff_${RUN}`, tech: `user_t_tech_${RUN}`,
  tech2: `user_t_tech2_${RUN}`, none: `user_t_none_${RUN}`,
} as const;
type Person = keyof typeof SUB;
type Actor = Person | "agency";
const claimsFor = (a: Actor) =>
  a === "agency" ? { app_role: "agency_admin", sub: `user_t_agency_${RUN}` } : { org_id: ORG, sub: SUB[a] };

/** Tables whose rows reach exactly one contact: the key column to select by. */
const PER_CONTACT = {
  contact_tags: "contact_id", notes: "id", tasks: "id", opportunities: "id", conversations: "id",
  messages: "id", calls: "id", proposals: "id", ai_acts: "id", bookings: "id", form_submissions: "id",
  automation_log: "id", consent_events: "id",
} as const;
type Table = keyof typeof PER_CONTACT;

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Tech Co',true) returning id",
    [agency!.id, ORG]);
  const users = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) {
    users[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  }
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$5,'technician')`,
    [users.owner, users.staff, users.tech, users.tech2, acct]);
  const contact = (assignee: string | null, name: string) =>
    one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, assignee]);
  const mine = await contact(users.tech, "Mine");
  const theirs = await contact(users.tech2, "Theirs");
  const open = await contact(null, "Open");

  const tag = await one("insert into tags (account_id, name) values ($1,$2) returning id", [acct, `vip-${RUN}`]);
  const pipeline = await one("insert into pipelines (account_id, name) values ($1,'Sales') returning id", [acct]);
  const stage = await one("insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [acct, pipeline]);
  const phone = await one("insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, `+1999${DIGITS()}`]);
  const calendar = await one("insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `tech-${RUN}`]);
  const form = await one("insert into forms (account_id, public_id, name) values ($1,$2,'Quote') returning id", [acct, `pub_t_${RUN}`]);

  let hour = 0;
  const rowsFor = async (cid: string | null, assignee: string | null): Promise<Record<Table, string>> => {
    hour += 2;
    const starts = new Date(Date.UTC(2030, 0, 1, hour));
    const conv = cid ? await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, cid]) : "";
    const call = await one("insert into calls (account_id, phone_number_id, contact_id, caller_e164) values ($1,$2,$3,'+19565550142') returning id", [acct, phone, cid]);
    if (cid) await c.query("insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [cid, tag, acct]);
    // The row's own customer is what proposals_technician_scope reads, so contact_id is the case's customer.
    const proposal = await one(
      "insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at) values ($1,'call',$2,$3,'task','{}','they asked', now() + interval '30 days') returning id",
      [acct, call, cid]);
    return {
      contact_tags: cid ?? "",
      notes: cid ? await one("insert into notes (account_id, contact_id, body) values ($1,$2,'n') returning id", [acct, cid]) : "",
      tasks: await one("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'t',$3) returning id", [acct, cid, assignee]),
      opportunities: cid ? await one("insert into opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1,$2,$3,$4,'Roof') returning id", [acct, cid, pipeline, stage]) : "",
      conversations: conv,
      messages: cid ? await one("insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'sms','inbound','hola','customer') returning id", [acct, conv]) : "",
      calls: call,
      proposals: proposal,
      // 0091: an act always has its customer (contact_id not null), so the no-customer row has none.
      ai_acts: cid ? await one(
        "insert into ai_acts (account_id, actor, call_id, contact_id, kind, target) values ($1,'voice',$2,$3,'contact_created','{}') returning id",
        [acct, call, cid]) : "",
      bookings: cid ? await one(
        "insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind) values ($1,$2,$3,$4,$5,$6,'person') returning id",
        [acct, calendar, cid, starts.toISOString(), new Date(starts.getTime() + 1_800_000).toISOString(), `tok_${RUN}_${hour}`]) : "",
      form_submissions: await one("insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3) returning id", [acct, form, cid]),
      automation_log: await one(
        "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'sms_reminder','sms',$2,$3,'sent') returning id",
        [acct, cid, `booking:${RUN}-${hour}`]),
      consent_events: await one(
        "insert into consent_events (account_id, channel, address, action, method, contact_id) values ($1,'sms',$2,'revoked','keyword',$3) returning id",
        [acct, `+1956${DIGITS()}`, cid]),
    };
  };
  const rows = { mine: await rowsFor(mine, users.tech), theirs: await rowsFor(theirs, users.tech2), none: await rowsFor(null, null) };
  const looseTaskMine = await one("insert into tasks (account_id, title, assigned_to) values ($1,'loose',$2) returning id", [acct, users.tech]);
  const looseTaskTheirs = await one("insert into tasks (account_id, title, assigned_to) values ($1,'loose',$2) returning id", [acct, users.tech2]);
  const ownerTaskOnMine = await one("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'owner''s',$3) returning id", [acct, mine, users.owner]);
  const event = (await c.query<{ id: string }>(
    "insert into events (account_id, type, actor_type, payload) values ($1,'contact.created','system',$2) returning id::text as id",
    [acct, JSON.stringify({ contactId: mine })])).rows[0]!.id;
  const [a, b] = [mine, open].sort();
  await c.query("insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'test')", [acct, a, b]);
  return { acct, users, mine, theirs, open, rows, looseTaskMine, looseTaskTheirs, ownerTaskOnMine, event };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

/**
 * A statement expected to be REFUSED, run inside a savepoint. One refusal
 * otherwise aborts the whole withRollback transaction (25P02), and every
 * assertion after it fails on "current transaction is aborted" instead of on
 * what it checks. The savepoint is rolled back either way; the role and claims
 * set before it survive (SET LOCAL made before a savepoint is kept).
 */
const refused = async (c: Client, sql: string, args: unknown[]) => {
  await c.query("savepoint refused");
  try {
    return await c.query(sql, args);
  } finally {
    await c.query("rollback to savepoint refused");
  }
};

const visible = async (c: Client, table: Table, ids: string[]) => {
  const key = PER_CONTACT[table];
  const { rows } = await c.query<{ k: string }>(`select ${key}::text as k from ${table} where ${key} = any($1::uuid[])`, [ids.filter(Boolean)]);
  return rows.map((r) => r.k).sort();
};

describe("a Technician reads only their own customers, table by table (mutation: drop any one table's restrictive policy -> that table's case FAILS)", () => {
  for (const table of Object.keys(PER_CONTACT) as Table[]) {
    it(`${table}: own rows only`, () => withRollback(async (c) => {
      const s: Seeded = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect(await visible(c, table, [s.rows.mine[table], s.rows.theirs[table], s.rows.none[table]]))
        .toEqual([s.rows.mine[table]].filter(Boolean).sort());
    }));
  }
  it("contacts: only the one assigned to them", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    const { rows } = await c.query<{ id: string }>("select id from contacts where account_id = $1", [s.acct]);
    expect(rows.map((r) => r.id)).toEqual([s.mine]);
  }));
  it("tasks: a task with no customer is theirs only when assigned to them (mutation: drop the contact_id-is-null branch -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      const { rows } = await c.query<{ id: string }>("select id from tasks where id = any($1::uuid[])", [[s.looseTaskMine, s.looseTaskTheirs]]);
      expect(rows.map((r) => r.id)).toEqual([s.looseTaskMine]);
    }));
  it("events and duplicate flags: none at all", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("select 1 from events where account_id = $1", [s.acct])).rowCount).toBe(0);
    expect((await c.query("select 1 from contact_duplicate_flags where account_id = $1", [s.acct])).rowCount).toBe(0);
  }));
});

describe("Owner, Staff and the agency are unchanged (mutation: key the policy on is_account_owner -> the staff case FAILS)", () => {
  for (const actor of ["owner", "staff", "agency"] as const) {
    it(`${actor}: sees every row of every table`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      for (const table of Object.keys(PER_CONTACT) as Table[]) {
        const ids = [s.rows.mine[table], s.rows.theirs[table], s.rows.none[table]].filter(Boolean);
        expect(await visible(c, table, ids), table).toEqual([...new Set(ids)].sort());
      }
      expect((await c.query("select 1 from events where account_id = $1", [s.acct])).rowCount).toBeGreaterThan(0);
      expect((await c.query("select 1 from contact_duplicate_flags where account_id = $1", [s.acct])).rowCount).toBe(1);
    }));
  }
});

describe("the NULL guard (A1; memory: plpgsql NULL guard)", () => {
  it("a client with no membership sees no customers (mutation: write the policy as `not coalesce(app.is_technician(...), false)` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      expect((await c.query("select 1 from contacts where account_id = $1", [s.acct])).rowCount).toBe(0);
      expect((await c.query("select 1 from calls where account_id = $1", [s.acct])).rowCount).toBe(0);
    }));
  it("sees_all_customers is FALSE, never NULL, for a client token with no membership (mutation: drop either coalesce -> FAILS with null)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      const { rows: [r] } = await c.query("select app.sees_all_customers($1) as sees_all, app.is_technician($1) as tech, app.current_user_id() is not null as known", [s.acct]);
      expect(r).toEqual({ sees_all: false, tech: false, known: true });
    }));
});

describe("Technician writes (spec §5.3)", () => {
  it("updates their own customer, never someone else's", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("update contacts set first_name = 'Edited' where id = $1", [s.mine])).rowCount).toBe(1);
    expect((await c.query("update contacts set first_name = 'Edited' where id = $1", [s.theirs])).rowCount).toBe(0);
  }));
  // Not "drop the WITH CHECK": a FOR ALL policy with no WITH CHECK reuses its USING for the new row,
  // and an UPDATE whose WHERE reads the row must also leave a new row its SELECT USING admits. Both
  // say "still mine", so only losing the policy itself lets the reassignment through.
  it.each([["to another person", "tech2"], ["back to Unassigned", null]] as const)(
    "cannot reassign their customer %s (mutation: drop contacts_technician_scope -> FAILS)", (_label, to) => withRollback(async (c) => {
      const s = await seed(c);
      const target = to === null ? null : s.users[to];
      await actAs(c, claimsFor("tech"));
      await expect(refused(c, "update contacts set assigned_to = $2 where id = $1", [s.mine, target])).rejects.toMatchObject({ code: "42501" });
    }));
  it("a customer they add must be assigned to them (mutation: contacts_technician_scope WITH CHECK (true) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    await expect(refused(c, "insert into contacts (account_id, first_name) values ($1,'Walk-in')", [s.acct])).rejects.toMatchObject({ code: "42501" });
    expect((await c.query("insert into contacts (account_id, first_name, assigned_to) values ($1,'Walk-in',$2)", [s.acct, s.users.tech])).rowCount).toBe(1);
  }));
  // No WHERE, so the statement never reads the row and the SELECT-USING-on-the-new-row rule does not
  // apply: here the WITH CHECK alone stands between a Technician and handing back every customer.
  it("cannot reassign with a WHERE-less UPDATE either (mutation: contacts_technician_scope WITH CHECK (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      await expect(refused(c, "update contacts set assigned_to = null", [])).rejects.toMatchObject({ code: "42501" });
      await actAsOwner(c);
      expect((await c.query("select assigned_to from contacts where id = $1", [s.mine])).rows[0]).toEqual({ assigned_to: s.users.tech });
    }));
  it("finishes a task on their customer that the Owner holds, but cannot reassign it (mutation: drop the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update tasks set completed_at = now() where id = $1", [s.ownerTaskOnMine])).rowCount).toBe(1);
      await expect(refused(c, "update tasks set assigned_to = $2 where id = $1", [s.ownerTaskOnMine, s.users.tech])).rejects.toMatchObject({ code: "42501" });
    }));
  it("a task they add is theirs; one aimed at someone else is refused", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'call back',$3)", [s.acct, s.mine, s.users.tech])).rowCount).toBe(1);
    await expect(refused(c, "insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'x',$3)", [s.acct, s.mine, s.users.tech2])).rejects.toMatchObject({ code: "42501" });
    await expect(refused(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [s.acct, s.theirs])).rejects.toMatchObject({ code: "42501" });
  }));
  it("account configuration is read-only to them; tags may still be created (mutation: drop forms_technician_update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update forms set name = 'Hacked' where account_id = $1", [s.acct])).rowCount).toBe(0);
      await expect(refused(c, "insert into pipelines (account_id, name) values ($1,'Mine')", [s.acct])).rejects.toMatchObject({ code: "42501" });
      expect((await c.query("update accounts set brand_name = 'X' where id = $1", [s.acct])).rowCount).toBe(0);
      expect((await c.query("insert into tags (account_id, name) values ($1,$2)", [s.acct, `new-${RUN}`])).rowCount).toBe(1);
      expect((await c.query("delete from tags where account_id = $1", [s.acct])).rowCount).toBe(0);
    }));
  // $1 the customer, $2 a fresh tag, $3 the account.
  for (const [table, sql] of [
    ["contact_tags", "insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)"],
    ["opportunities",
      `insert into opportunities (account_id, contact_id, pipeline_id, stage_id, name)
         select $3, $1, p.id, st.id, 'Deck' from pipelines p join pipeline_stages st on st.pipeline_id = p.id
          where p.account_id = $3 and $2::uuid is not null limit 1`],
  ] as const) {
    it(`${table}: an insert on someone else's customer is refused, on their own it lands (mutation: ${table}_technician_scope WITH CHECK (true) -> FAILS)`,
      () => withRollback(async (c) => {
        const s = await seed(c);
        const tag = (await c.query<{ id: string }>("insert into tags (account_id, name) values ($1,$2) returning id", [s.acct, `extra-${RUN}`])).rows[0]!.id;
        await actAs(c, claimsFor("tech"));
        await expect(refused(c, sql, [s.theirs, tag, s.acct])).rejects.toMatchObject({ code: "42501" });
        expect((await c.query(sql, [s.mine, tag, s.acct])).rowCount).toBe(1);
      }));
  }
  it("Staff can still reassign anything (mutation: apply the trigger to every authenticated caller -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("staff"));
    expect((await c.query("update contacts set assigned_to = null where id = $1", [s.mine])).rowCount).toBe(1);
    expect((await c.query("update tasks set assigned_to = $2 where id = $1", [s.ownerTaskOnMine, s.users.staff])).rowCount).toBe(1);
  }));
});

/**
 * Account configuration is read-only to a Technician (spec §5.3, migration §4f), one case per table and
 * command, so dropping any one fence fails exactly that case by name. Each statement first runs as Staff
 * on a row of its own (the control: the statement is valid and the permissive policy admits a member),
 * then as the Technician on a fresh row. A refused INSERT raises 42501; a refused UPDATE or DELETE
 * matches 0 rows. accounts INSERT and DELETE are refused by 0001 alone (only accounts_agency_all admits
 * them for a client), so those two fences are belt and braces: no test can attribute the refusal to them.
 */
const CONFIG_TABLES = ["accounts", "forms", "pipelines", "pipeline_stages", "custom_fields", "custom_values", "checklist_items"] as const;
type ConfigTable = (typeof CONFIG_TABLES)[number];
type Probe = { id: string; insert: [string, unknown[]]; update: string };
let probeN = 0;
/** As the table owner: a fresh row to aim UPDATE/DELETE at, a valid INSERT, and the UPDATE to try. */
async function configProbe(c: Client, s: Seeded, t: ConfigTable): Promise<Probe> {
  const n = `${RUN}_${++probeN}`;
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  switch (t) {
    case "accounts":
      return { id: s.acct,
        insert: ["insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'X')", [await one("select agency_id as id from accounts where id = $1", [s.acct]), `org_cfg_${n}`]],
        update: "update accounts set brand_name = 'Hacked' where id = $1" };
    case "forms":
      return { id: await one("insert into forms (account_id, public_id, name) values ($1,$2,'Spare') returning id", [s.acct, `pub_cfg_a_${n}`]),
        insert: ["insert into forms (account_id, public_id, name) values ($1,$2,'X')", [s.acct, `pub_cfg_b_${n}`]],
        update: "update forms set name = 'Hacked' where id = $1" };
    case "pipelines":
      return { id: await one("insert into pipelines (account_id, name) values ($1,$2) returning id", [s.acct, `Spare ${n}`]),
        insert: ["insert into pipelines (account_id, name) values ($1,$2)", [s.acct, `X ${n}`]],
        update: "update pipelines set name = 'Hacked' where id = $1" };
    case "pipeline_stages": {
      const pipeline = await one("select id from pipelines where account_id = $1 limit 1", [s.acct]);
      return { id: await one("insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'Spare',8) returning id", [s.acct, pipeline]),
        insert: ["insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'X',9)", [s.acct, pipeline]],
        update: "update pipeline_stages set name = 'Hacked' where id = $1" };
    }
    case "custom_fields":
      return { id: await one("insert into custom_fields (account_id, model, field_key, name, data_type) values ($1,'contact',$2,'Spare','text') returning id", [s.acct, `spare_${probeN}`]),
        insert: ["insert into custom_fields (account_id, model, field_key, name, data_type) values ($1,'contact',$2,'X','text')", [s.acct, `mine_${probeN}`]],
        update: "update custom_fields set name = 'Hacked' where id = $1" };
    case "custom_values":
      return { id: await one("insert into custom_values (account_id, value_key, name) values ($1,$2,'Spare') returning id", [s.acct, `spare_${probeN}`]),
        insert: ["insert into custom_values (account_id, value_key, name) values ($1,$2,'X')", [s.acct, `mine_${probeN}`]],
        update: "update custom_values set value = 'Hacked' where id = $1" };
    case "checklist_items":
      return { id: await one("insert into checklist_items (account_id, item_key) values ($1,$2) returning id", [s.acct, `custom:spare_${n}`]),
        insert: ["insert into checklist_items (account_id, item_key) values ($1,$2)", [s.acct, `custom:mine_${n}`]],
        update: "update checklist_items set note = 'Hacked' where id = $1" };
  }
}
const beltAndBraces = (t: ConfigTable, cmd: string) => t === "accounts" && cmd !== "update";

describe("account configuration is read-only to a Technician, table by table (spec §5.3, review I3)", () => {
  for (const t of CONFIG_TABLES) {
    for (const cmd of ["insert", "update", "delete"] as const) {
      const why = beltAndBraces(t, cmd)
        ? "also refused by 0001 alone, so no mutation of the fence can fail it"
        : `mutation: drop ${t}_technician_${cmd} -> FAILS`;
      it(`${t} ${cmd}: refused to a Technician, admitted for Staff (${why})`, () => withRollback(async (c) => {
        const s = await seed(c);
        const staffRow = await configProbe(c, s, t);
        const techRow = await configProbe(c, s, t);
        const run = (row: Probe) =>
          cmd === "insert" ? c.query(row.insert[0], row.insert[1])
          : cmd === "update" ? c.query(row.update, [row.id])
          : c.query(`delete from ${t} where id = $1`, [row.id]);
        if (!beltAndBraces(t, cmd)) {
          await actAs(c, claimsFor("staff"));
          expect((await run(staffRow)).rowCount, "Staff control").toBe(1);
        }
        await actAs(c, claimsFor("tech"));
        if (cmd === "insert") await expect(refused(c, techRow.insert[0], techRow.insert[1])).rejects.toMatchObject({ code: "42501" });
        else expect((await run(techRow)).rowCount).toBe(0);
      }));
    }
  }
  it("tags update: refused to a Technician, admitted for Staff (mutation: drop tags_technician_update -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const [a, b] = (await c.query<{ id: string }>(
      "insert into tags (account_id, name) values ($1,$2), ($1,$3) returning id", [s.acct, `a-${RUN}`, `b-${RUN}`])).rows.map((r) => r.id);
    await actAs(c, claimsFor("staff"));
    expect((await c.query("update tags set name = $2 where id = $1", [a, `a2-${RUN}`])).rowCount, "Staff control").toBe(1);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("update tags set name = $2 where id = $1", [b, `b2-${RUN}`])).rowCount).toBe(0);
  }));
});

/**
 * A person who has left (membership deleted; the release has not run yet, or failed) still holds
 * assignments. Owner ruling A1 and spec §8: they read and write nothing. Each case seeds the departed
 * Technician's own customer, message and tasks, so it can only pass because the role is gone.
 */
describe("a departed Technician reads and writes nothing (spec A1, §8; review I1)", () => {
  const departed = async (c: Client) => {
    const s = await seed(c);
    await c.query("delete from memberships where user_id = $1", [s.users.tech]);
    await actAs(c, claimsFor("tech"));
    return s;
  };
  it("contacts: their assigned customer is invisible and uneditable (mutation: drop is_technician from contacts_technician_scope -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await departed(c);
      expect((await c.query("select id from contacts where account_id = $1", [s.acct])).rowCount).toBe(0);
      expect((await c.query("update contacts set first_name = 'Edited' where id = $1", [s.mine])).rowCount).toBe(0);
    }));
  it("messages, notes, calls: nothing through their customer, and no note lands (mutation: drop is_technician from my_contact_ids -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await departed(c);
      expect((await c.query("select id from messages where id = $1", [s.rows.mine.messages])).rowCount).toBe(0);
      expect((await c.query("select id from notes where id = $1", [s.rows.mine.notes])).rowCount).toBe(0);
      expect((await c.query("select id from calls where id = $1", [s.rows.mine.calls])).rowCount).toBe(0);
      await expect(refused(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [s.acct, s.mine])).rejects.toMatchObject({ code: "42501" });
    }));
  it("tasks with no customer: their own is invisible, and they cannot add one (mutation: drop is_technician from the tasks no-customer branch -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await departed(c);
      expect((await c.query("select id from tasks where id = $1", [s.looseTaskMine])).rowCount).toBe(0);
      await expect(refused(c, "insert into tasks (account_id, title, assigned_to) values ($1,'x',$2)", [s.acct, s.users.tech])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("roles and release (spec §5.1, §8)", () => {
  it("memberships.role takes technician and nothing new (mutation: leave the check at owner|staff -> seed FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'tech')", [s.users.none, s.acct]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await c.query("select public.set_account_member_role($1,$2,'technician') as r", [s.acct, s.users.staff])).rows[0]).toEqual({ r: "ok" });
  }));
  /** The release as the server calls it: as service_role, never as the superuser this suite connects as. */
  const release = async (c: Client, acct: string, user: string) => {
    await c.query("set local role service_role");
    const { rows: [r] } = await c.query<{ j: { contacts: string[]; tasks: string[] } }>(
      "select public.release_member_assignments($1,$2) as j", [acct, user]);
    await actAsOwner(c);
    return r!.j;
  };
  it("release_member_assignments, run as service_role, clears a departed person's customers and open tasks, returns them, and a second call finds nothing (mutation: revoke execute from service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("delete from memberships where user_id = $1", [s.users.tech]);
      const first = await release(c, s.acct, s.users.tech);
      expect(first.contacts).toEqual([s.mine]);
      expect(first.tasks.sort()).toEqual([s.rows.mine.tasks, s.looseTaskMine].sort());
      expect((await c.query("select assigned_to from contacts where id = $1", [s.mine])).rows[0]).toEqual({ assigned_to: null });
      expect(await release(c, s.acct, s.users.tech)).toEqual({ contacts: [], tasks: [] });
    }));
  it("release_member_assignments touches only the account named: the same person's customers and tasks in another account stay theirs (mutation: drop account_id from either update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [agency] } = await c.query<{ id: string }>("select agency_id as id from accounts where id = $1", [s.acct]);
      const other = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Tech Co Two',true) returning id",
        [agency!.id, `${ORG}_two`])).rows[0]!.id;
      await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'technician')", [s.users.tech, other]);
      const elsewhere = (await c.query<{ id: string }>(
        "insert into contacts (account_id, first_name, assigned_to) values ($1,'Elsewhere',$2) returning id", [other, s.users.tech])).rows[0]!.id;
      const elsewhereTask = (await c.query<{ id: string }>(
        "insert into tasks (account_id, title, assigned_to) values ($1,'there',$2) returning id", [other, s.users.tech])).rows[0]!.id;
      await c.query("delete from memberships where user_id = $1 and account_id = $2", [s.users.tech, s.acct]);
      const out = await release(c, s.acct, s.users.tech);
      expect(out.contacts).toEqual([s.mine]);
      expect(out.tasks.sort()).toEqual([s.rows.mine.tasks, s.looseTaskMine].sort());
      expect((await c.query("select assigned_to from contacts where id = $1", [elsewhere])).rows[0]).toEqual({ assigned_to: s.users.tech });
      expect((await c.query("select assigned_to from tasks where id = $1", [elsewhereTask])).rows[0]).toEqual({ assigned_to: s.users.tech });
    }));
  it("release_member_assignments leaves a finished task assigned: who did it stays on the record (mutation: drop completed_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const done = (await c.query<{ id: string }>(
        "insert into tasks (account_id, contact_id, title, assigned_to, completed_at) values ($1,$2,'done',$3, now()) returning id",
        [s.acct, s.mine, s.users.tech])).rows[0]!.id;
      await c.query("delete from memberships where user_id = $1", [s.users.tech]);
      const out = await release(c, s.acct, s.users.tech);
      expect(out.tasks).not.toContain(done);
      expect((await c.query("select assigned_to from tasks where id = $1", [done])).rows[0]).toEqual({ assigned_to: s.users.tech });
    }));
  it("release_member_assignments does nothing while the person is still a member (mutation: drop the membership check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [r] } = await c.query("select public.release_member_assignments($1,$2) as j", [s.acct, s.users.tech]);
      expect(r).toEqual({ j: { contacts: [], tasks: [] } });
    }));
  it("release_member_assignments is service_role only", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("owner"));
    await expect(refused(c, "select public.release_member_assignments($1,$2)", [s.acct, s.users.tech])).rejects.toMatchObject({ code: "42501" });
    await actAsOwner(c);
  }));
});

import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { RELATIONSHIP_KEYS, UNDIRECTED_KEYS, DIRECTIONAL_KEYS } from "../relationship-keys";

/**
 * Relationships between customers (spec §5, migration 0070). One row per pair, both people in the
 * row's own account (composite keys, 0050's shape), unique in either direction, client-written
 * under RLS, and fenced for a Technician like 0068: reading needs EITHER person to be theirs,
 * writing needs BOTH. A refused SELECT/UPDATE/DELETE is not an error (rowCount 0); a refused
 * INSERT, a column without a grant, or a failed constraint raises.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_rel_${RUN}`;
const ORG_B = `org_relb_${RUN}`;
const SUB = {
  owner: `user_r_owner_${RUN}`, staff: `user_r_staff_${RUN}`, tech: `user_r_tech_${RUN}`,
  tech2: `user_r_tech2_${RUN}`, none: `user_r_none_${RUN}`, ownerB: `user_r_ownerb_${RUN}`,
} as const;
type Person = keyof typeof SUB;
const claimsFor = (a: Person | "agency") =>
  a === "agency" ? { app_role: "agency_admin", sub: `user_r_agency_${RUN}` }
    : { org_id: a === "ownerB" ? ORG_B : ORG, sub: SUB[a] };

/** One refusal otherwise aborts the whole withRollback transaction (25P02). */
const refused = async (c: Client, sql: string, args: unknown[]) => {
  await c.query("savepoint refused");
  try {
    return await c.query(sql, args);
  } finally {
    await c.query("rollback to savepoint refused");
  }
};

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = (org: string, name: string) => one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name]);
  const acct = await account(ORG, "Rel Co");
  const acctB = await account(ORG_B, "Rel B Co");
  const users = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) {
    users[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  }
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'),
       ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [users.owner, users.staff, users.tech, users.tech2, users.ownerB, acct, acctB]);
  const contact = (a: string, name: string, assignee: string | null) =>
    one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [a, name, assignee]);
  const mine = await contact(acct, "Mine", users.tech);
  const mine2 = await contact(acct, "Mine Too", users.tech);
  const theirs = await contact(acct, "Theirs", users.tech2);
  const open = await contact(acct, "Open", null);
  const elsewhere = await contact(acctB, "Elsewhere", null);
  const rel = (a: string, b: string, key: string) => one(
    "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,$4) returning id",
    [acct, a, b, key]);
  const r = {
    mineTheirs: await rel(mine, theirs, "parent"),
    openMine: await rel(open, mine, "sibling"),
    mineMine2: await rel(mine, mine2, "spouse"),
    theirsOpen: await rel(theirs, open, "godparent"),
  };
  return { acct, acctB, users, mine, mine2, theirs, open, elsewhere, r };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const visibleIds = async (c: Client, acct: string) =>
  (await c.query<{ id: string }>("select id from contact_relationships where account_id = $1 order by id", [acct])).rows.map((x) => x.id);
const all = (s: Seeded) => Object.values(s.r).sort();

describe("shape", () => {
  it("row level security is on; the policies are the tenant policy and four restrictive Technician fences (mutation: drop contact_relationships_technician_delete -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ on: boolean }>(
        "select relrowsecurity as on from pg_class where oid = 'public.contact_relationships'::regclass");
      expect(t!.on).toBe(true);
      const { rows } = await c.query(
        "select policyname, permissive, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'contact_relationships' order by policyname");
      expect(rows).toEqual([
        { policyname: "contact_relationships_member_all", permissive: "PERMISSIVE", cmd: "ALL", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_delete", permissive: "RESTRICTIVE", cmd: "DELETE", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_insert", permissive: "RESTRICTIVE", cmd: "INSERT", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_read", permissive: "RESTRICTIVE", cmd: "SELECT", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_update", permissive: "RESTRICTIVE", cmd: "UPDATE", roles: "{authenticated}" },
      ]);
    }));

  it("label_key's CHECK lists exactly RELATIONSHIP_KEYS (mutation: add 'cousin' to RELATIONSHIP_KEYS only -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [d] } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'contact_relationships_label_key'");
      const keys = [...d!.def.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]).sort();
      expect(keys).toEqual([...RELATIONSHIP_KEYS].sort());
    }));

  it("UNDIRECTED_KEYS and DIRECTIONAL_KEYS split RELATIONSHIP_KEYS, every key in exactly one (mutation: drop 'landlord' from DIRECTIONAL_KEYS -> FAILS)", () => {
    const both = [...UNDIRECTED_KEYS, ...DIRECTIONAL_KEYS];
    expect(new Set(both).size).toBe(both.length);
    expect([...both].sort()).toEqual([...RELATIONSHIP_KEYS].sort());
  });

  it("the pair index covers exactly UNDIRECTED_KEYS and the directed index exactly DIRECTIONAL_KEYS (mutation: move 'landlord' into the pair index's predicate -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ name: string; pred: string | null }>(
        `select i.relname as name, pg_get_expr(x.indpred, x.indrelid) as pred
           from pg_index x join pg_class i on i.oid = x.indexrelid
          where i.relname in ('contact_relationships_pair', 'contact_relationships_directed') order by 1`);
      const keysOf = (name: string) =>
        [...(rows.find((r) => r.name === name)?.pred ?? "").matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]).sort();
      expect(rows.map((r) => r.name)).toEqual(["contact_relationships_directed", "contact_relationships_pair"]);
      expect(keysOf("contact_relationships_pair")).toEqual([...UNDIRECTED_KEYS].sort());
      expect(keysOf("contact_relationships_directed")).toEqual([...DIRECTIONAL_KEYS].sort());
    }));
});

describe("integrity (as the table owner)", () => {
  it("refuses a relationship with oneself (mutation: drop contact_relationships_not_self -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$2,'sibling')",
      [s.acct, s.mine])).rejects.toMatchObject({ code: "23514" });
  }));

  it("refuses a person from another account on either side, each by its own key (mutation: single-column FK on related_contact_id, or on contact_id -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'parent')",
      [s.acct, s.mine, s.elsewhere])).rejects.toMatchObject({ code: "23503", constraint: "contact_relationships_related_fkey" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'parent')",
      [s.acct, s.elsewhere, s.mine])).rejects.toMatchObject({ code: "23503", constraint: "contact_relationships_contact_fkey" });
  }));

  it("refuses a family or symmetric label for a pair in the reverse direction (mutation: index on (contact_id, related_contact_id) without least/greatest -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const reverse = (a: string, b: string, key: string) => refused(c,
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,$4)", [s.acct, a, b, key]);
      const pair = { code: "23505", constraint: "contact_relationships_pair" };
      await expect(reverse(s.theirs, s.mine, "parent")).rejects.toMatchObject(pair);
      await expect(reverse(s.open, s.theirs, "godparent")).rejects.toMatchObject(pair);
      await expect(reverse(s.mine2, s.mine, "spouse")).rejects.toMatchObject(pair);
    }));

  it("allows a support label once in EACH direction (owner, 2026-10-11) (mutation: one order-free index over every key -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ins = (a: string, b: string, key: string) => c.query(
        `insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, contact_is_emergency, contact_can_pick_up)
         values ($1,$2,$3,$4,$4 = 'emergency_contact',$4 = 'authorized_pickup')`, [s.acct, a, b, key]);
      for (const key of ["emergency_contact", "caregiver", "authorized_pickup"]) {
        expect((await ins(s.mine2, s.open, key)).rowCount).toBe(1);
        expect((await ins(s.open, s.mine2, key)).rowCount).toBe(1);
      }
    }));

  it("refuses a support label twice in the SAME direction (mutation: drop contact_relationships_directed -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const caregiver = "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'caregiver')";
      expect((await c.query(caregiver, [s.acct, s.mine2, s.open])).rowCount).toBe(1);
      await expect(refused(c, caregiver, [s.acct, s.mine2, s.open]))
        .rejects.toMatchObject({ code: "23505", constraint: "contact_relationships_directed" });
    }));

  it("'Other' is unique per pair regardless of case; a different text or label is allowed (mutation: drop lower() from the index -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const other = (a: string, b: string, label: string) => c.query(
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,'other',$4)",
        [s.acct, a, b, label]);
      expect((await other(s.mine, s.open, "Vecina")).rowCount).toBe(1);
      await expect(refused(c,
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,'other','VECINA')",
        [s.acct, s.open, s.mine])).rejects.toMatchObject({ code: "23505", constraint: "contact_relationships_pair" });
      expect((await other(s.open, s.mine, "Patrona")).rowCount).toBe(1);
      expect((await c.query(
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, contact_is_emergency) values ($1,$2,$3,'emergency_contact',true)",
        [s.acct, s.mine, s.theirs])).rowCount).toBe(1);
    }));

  it("custom_label belongs to 'other' only and is 1 to 60 characters (mutation: drop contact_relationships_custom -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const ins = (key: string, label: string | null) => refused(c,
      "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,$4,$5)",
      [s.acct, s.mine2, s.open, key, label]);
    await expect(ins("other", null)).rejects.toMatchObject({ code: "23514" });
    await expect(ins("caregiver", "Nana")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("other", "x".repeat(61))).rejects.toMatchObject({ code: "23514" });
    await expect(ins("other", "")).rejects.toMatchObject({ code: "23514" });
  }));

  it("custom_label is stored trimmed and never blank, inner spaces allowed (mutation: drop contact_relationships_custom_trimmed -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const ins = (label: string) => refused(c,
      "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,'other',$4)",
      [s.acct, s.mine2, s.open, label]);
    const trimmed = { code: "23514", constraint: "contact_relationships_custom_trimmed" };
    for (const label of [" Vecina", "Vecina ", "\tVecina", "Vecina\n", "   "]) {
      await expect(ins(label), JSON.stringify(label)).rejects.toMatchObject(trimmed);
    }
    expect((await ins("Prima  de Ana")).rowCount).toBe(1);
    expect((await ins("V")).rowCount).toBe(1);
  }));

  it("an emergency-contact or authorized-pickup label sets side A's flag (mutation: drop contact_relationships_emergency -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'emergency_contact')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'authorized_pickup')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
  }));

  it("an unknown key or word form on either side is refused (mutation: forms CHECK on contact_form only -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'cousin')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514", constraint: "contact_relationships_label_key" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, contact_form) values ($1,$2,$3,'caregiver','x')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514", constraint: "contact_relationships_forms" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, related_form) values ($1,$2,$3,'caregiver','x')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514", constraint: "contact_relationships_forms" });
  }));

  it("deleting either person removes their relationships (mutation: on delete no action -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("delete from contacts where id = $1", [s.theirs]);
    expect(await visibleIds(c, s.acct)).toEqual([s.r.openMine, s.r.mineMine2].sort());
  }));
});

describe("grants and the tenant (as members)", () => {
  it("an Owner changes a flag, never the people or the label (mutation: grant update (label_key) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("owner"));
    expect((await c.query("update contact_relationships set contact_can_pick_up = true, updated_at = now() where id = $1", [s.r.mineTheirs])).rowCount).toBe(1);
    await expect(refused(c, "update contact_relationships set label_key = 'spouse' where id = $1", [s.r.mineTheirs])).rejects.toMatchObject({ code: "42501" });
    await expect(refused(c, "update contact_relationships set related_contact_id = $2 where id = $1", [s.r.mineTheirs, s.open])).rejects.toMatchObject({ code: "42501" });
  }));

  it("another company's Owner reads none and cannot write here (mutation: member_all USING (true) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("ownerB"));
    expect(await visibleIds(c, s.acct)).toEqual([]);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'caregiver')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "42501" });
  }));

  for (const actor of ["owner", "staff", "agency"] as const) {
    it(`${actor}: reads every relationship of the account (mutation: key the read fence on is_account_owner -> the staff case FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c);
        await actAs(c, claimsFor(actor));
        expect(await visibleIds(c, s.acct)).toEqual(all(s));
      }));
  }

  it("a client with no membership reads none (mutation: write the read fence as `(select not app.is_technician(app.current_account_id())) or ...` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      expect(await visibleIds(c, s.acct)).toEqual([]);
    }));
});

describe("the Technician (spec §5.3)", () => {
  it("reads a relationship when EITHER person is theirs, never one with neither (mutation: drop contact_relationships_technician_read -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect(await visibleIds(c, s.acct)).toEqual([s.r.mineTheirs, s.r.openMine, s.r.mineMine2].sort());
    }));

  it("adds one only between two of their own customers, whichever side theirs is on (mutation: insert fence with the read expression, or on related_contact_id only -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'compadre')",
      [s.acct, s.mine2, s.mine])).rowCount).toBe(1);
    const caregiver = "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'caregiver')";
    await expect(refused(c, caregiver, [s.acct, s.mine, s.open])).rejects.toMatchObject({ code: "42501" });
    await expect(refused(c, caregiver, [s.acct, s.open, s.mine])).rejects.toMatchObject({ code: "42501" });
  }));

  it("changes or removes one only when both people are theirs, whichever side theirs is on (mutation: update and delete fences with the read expression, or on related_contact_id only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update contact_relationships set contact_can_pick_up = true where id = $1", [s.r.mineTheirs])).rowCount).toBe(0);
      expect((await c.query("delete from contact_relationships where id = $1", [s.r.mineTheirs])).rowCount).toBe(0);
      expect((await c.query("update contact_relationships set contact_can_pick_up = true where id = $1", [s.r.openMine])).rowCount).toBe(0);
      expect((await c.query("delete from contact_relationships where id = $1", [s.r.openMine])).rowCount).toBe(0);
      expect((await c.query("update contact_relationships set contact_form = 'f' where id = $1", [s.r.mineMine2])).rowCount).toBe(1);
      expect((await c.query("delete from contact_relationships where id = $1", [s.r.mineMine2])).rowCount).toBe(1);
    }));
});

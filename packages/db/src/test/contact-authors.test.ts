import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember } from "./db";

/**
 * 0091 (item 8c, plan Task 1 case 12; spec 5.3): who created each contact. contacts.author_kind is one of the
 * five provenance kinds and author_id goes only with a person (0073's shape). A signed-in INSERT may only say
 * "a person" (and then it is the caller) or "an import"; a signed-in UPDATE never moves either column. Existing
 * contacts are backfilled from their first contact.created event, a web-chat lead (a form contact whose
 * earliest submission is the AI's) reading as the AI.
 *
 * RED BEFORE 0091, legitimately, every case: the columns, the guard and both functions do not exist yet.
 * One refused statement per savepoint (`attempt`).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_cau_${RUN}`;

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
type Pair = { author_kind: string | null; author_id: string | null };
const pairOf = async (c: Client, id: string) =>
  (await c.query<Pair>("select author_kind, author_id from contacts where id = $1", [id])).rows[0]!;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'CAU Co',true) returning id", [agency!.id, ORG]);
  const form = await one(c, "insert into forms (account_id, public_id, name) values ($1,$2,'Quote') returning id", [acct, `pub_cau_${RUN}`]);
  return { acct, form };
}

describe("0091: the closed set on contacts (plan Task 1 case 12)", () => {
  it("refuses a sixth kind, an author_id with any kind but person, and an author_id with no kind (mutation: write contacts_author_id_person as `author_id is null or author_kind = 'person'` -> the no-kind row lands -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const add = (kind: string | null, id: string | null) =>
        attempt(c, "insert into contacts (account_id, first_name, author_kind, author_id) values ($1,'Ana',$2,$3)", [s.acct, kind, id]);
      await expect(add("system", null)).rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/"contacts_author_kind_check"/) });
      await expect(add("ai", "user_x")).rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/"contacts_author_id_person"/) });
      await expect(add(null, "user_x")).rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/"contacts_author_id_person"/) });
      expect((await add("person", "user_x")).rowCount, "a person with an id lands").toBe(1);
      expect((await add(null, null)).rowCount, "no author lands (nullable until the follow-up sets NOT NULL)").toBe(1);
    }));

  it("the five kinds are exactly the provenance set (mutation: add 'system' to the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.contacts'::regclass and conname = 'contacts_author_kind_check'");
      expect(rows).toHaveLength(1);
      expect([...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort()).toEqual(["ai", "automation", "customer", "import", "person"]);
    }));
});

describe("0091: contacts_author_guard (plan Task 1 case 12)", () => {
  it("a signed-in insert sending ai stores person with the JWT sub; sending nothing stores the same (mutation: drop trigger contacts_author_guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const sub = await actAsMember(c, s.acct, ORG, "owner");
      const forged = await one(c, "insert into contacts (account_id, first_name, author_kind, author_id) values ($1,'Ana','ai','user_forged') returning id", [s.acct]);
      const silent = await one(c, "insert into contacts (account_id, first_name) values ($1,'Beto') returning id", [s.acct]);
      await c.query("reset role");
      expect(await pairOf(c, forged)).toEqual({ author_kind: "person", author_id: sub });
      expect(await pairOf(c, silent)).toEqual({ author_kind: "person", author_id: sub });
    }));

  it("a signed-in insert sending import stores import with a null id, whatever id was sent (mutation: keep the sent author_id on import -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      const id = await one(c, "insert into contacts (account_id, first_name, author_kind, author_id) values ($1,'Cris','import','user_forged') returning id", [s.acct]);
      await c.query("reset role");
      expect(await pairOf(c, id)).toEqual({ author_kind: "import", author_id: null });
    }));

  it("a signed-in insert sending automation or customer stores person (anything else becomes the caller)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const sub = await actAsMember(c, s.acct, ORG, "owner");
      const a = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Dora','automation') returning id", [s.acct]);
      const b = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Eli','customer') returning id", [s.acct]);
      await c.query("reset role");
      expect([await pairOf(c, a), await pairOf(c, b)]).toEqual([{ author_kind: "person", author_id: sub }, { author_kind: "person", author_id: sub }]);
    }));

  it("the service role's values are kept (mutation: hold every role in the guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      const ai = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Fer','ai') returning id", [s.acct]);
      const person = await one(c, "insert into contacts (account_id, first_name, author_kind, author_id) values ($1,'Gil','person','user_y') returning id", [s.acct]);
      expect((await c.query("update contacts set author_kind = 'customer' where id = $1", [ai])).rowCount).toBe(1);
      await c.query("reset role");
      expect([await pairOf(c, ai), await pairOf(c, person)]).toEqual([{ author_kind: "customer", author_id: null }, { author_kind: "person", author_id: "user_y" }]);
    }));

  it("a signed-in UPDATE of either column is refused by privilege: the column grant names neither (mutation: grant update (author_kind) on contacts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Hal','ai') returning id", [s.acct]);
      await actAsMember(c, s.acct, ORG, "owner");
      await expect(attempt(c, "update contacts set author_kind = 'person' where id = $1", [id]))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table contacts\b/) });
      await expect(attempt(c, "update contacts set author_id = 'user_forged' where id = $1", [id]))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table contacts\b/) });
    }));

  // The belt behind that grant: a column grant added by a later file must still not let a signed-in UPDATE
  // move the pair. The grant here is made inside this rolled-back transaction only.
  it("the belt: with a column grant, a signed-in UPDATE still keeps the old pair, and the rest of the row updates (mutation: drop the guard's UPDATE branch -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Ivo','ai') returning id", [s.acct]);
      await c.query("grant update (author_kind, author_id) on public.contacts to authenticated");
      await actAsMember(c, s.acct, ORG, "owner");
      expect((await c.query("update contacts set author_kind = 'person', author_id = 'user_forged', first_name = 'Ivan' where id = $1", [id])).rowCount).toBe(1);
      await c.query("reset role");
      const { rows: [r] } = await c.query("select author_kind, author_id, first_name from contacts where id = $1", [id]);
      expect(r).toEqual({ author_kind: "ai", author_id: null, first_name: "Ivan" });
    }));

  it("grants: the guard is closed to anon and open to the two roles that fire it; the mapping and the backfill are no client's (mutation: grant execute on app.backfill_contact_authors() to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; r: string; x: boolean }>(
        `select f, r, has_function_privilege(r, f, 'EXECUTE') as x
           from unnest(array['app.contacts_author_guard()', 'app.contact_author(text, text)', 'app.backfill_contact_authors()']) f
          cross join unnest(array['anon', 'authenticated', 'service_role']) r order by f, r`);
      expect(rows.map((x) => `${x.f.replace(/\(.*$/, "")} ${x.r} ${x.x}`)).toEqual([
        "app.backfill_contact_authors anon false", "app.backfill_contact_authors authenticated false", "app.backfill_contact_authors service_role false",
        "app.contact_author anon false", "app.contact_author authenticated false", "app.contact_author service_role false",
        "app.contacts_author_guard anon false", "app.contacts_author_guard authenticated true", "app.contacts_author_guard service_role true",
      ]);
      const { rows: t } = await c.query<{ d: string }>(
        "select pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.contacts'::regclass and tgname = 'contacts_author_guard'");
      expect(t.map((x) => x.d)).toEqual([
        "CREATE TRIGGER contacts_author_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION app.contacts_author_guard()",
      ]);
    }));
});

describe("0091: the backfill, bucket by bucket (plan Task 1 case 12; Task 0's buckets)", () => {
  // [label, the first contact.created event's actor (null = no event), the kind and id the contact must take].
  const CASES: [string, [string, string] | null, Pair][] = [
    ["ai:voice", ["ai", "voice"], { author_kind: "ai", author_id: null }],
    ["system:form", ["system", "form"], { author_kind: "customer", author_id: null }],
    ["user:<clerk>", ["user", "user_3H2QKPdnekiD0smDzYRIdDlf7am"], { author_kind: "person", author_id: "user_3H2QKPdnekiD0smDzYRIdDlf7am" }],
    ["user:<padded clerk>", ["user", "  user_pad  "], { author_kind: "person", author_id: "user_pad" }],
    ["user:<blank>", ["user", "   "], { author_kind: "person", author_id: null }],
    ["user:system_demo_seed", ["user", "system_demo_seed"], { author_kind: "import", author_id: null }],
    ["system:system_ci_seed", ["system", "system_ci_seed"], { author_kind: "import", author_id: null }],
    ["system:sms-inbound", ["system", "sms-inbound"], { author_kind: "customer", author_id: null }],
    ["no event", null, { author_kind: "customer", author_id: null }],
  ];

  it("each contact takes the kind its first contact.created event gives, a web-chat lead reads as the AI, and a second run changes nothing (mutation: map system_demo_seed to person -> FAILS; drop `author_kind is null` -> the second run rewrites the hand-set row, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ev = (contactId: string, actor: [string, string]) =>
        c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,'contact.created',$2,$3,$4)",
          [s.acct, actor[0], actor[1], JSON.stringify({ contactId })]);
      const ids: Record<string, string> = {};
      for (const [label, actor] of CASES) {
        ids[label] = await one(c, "insert into contacts (account_id, first_name) values ($1,$2) returning id", [s.acct, label]);
        if (actor) await ev(ids[label]!, actor);
      }
      // The first event wins: an ai event, then a person's, reads ai.
      const twice = await one(c, "insert into contacts (account_id, first_name) values ($1,'twice') returning id", [s.acct]);
      await ev(twice, ["ai", "voice"]);
      await ev(twice, ["user", "user_later"]);
      // A web-chat lead: a form contact whose EARLIEST submission is the AI's; the reverse stays the customer's.
      const sub = (contact: string, kind: string, at: string) =>
        c.query("insert into form_submissions (account_id, form_id, contact_id, author_kind, created_at) values ($1,$2,$3,$4,$5)", [s.acct, s.form, contact, kind, at]);
      const lead = await one(c, "insert into contacts (account_id, first_name) values ($1,'lead') returning id", [s.acct]);
      await ev(lead, ["system", "form"]);
      await sub(lead, "ai", "2026-10-01T10:00:00Z");
      await sub(lead, "customer", "2026-10-02T10:00:00Z");
      const notLead = await one(c, "insert into contacts (account_id, first_name) values ($1,'notlead') returning id", [s.acct]);
      await ev(notLead, ["system", "form"]);
      await sub(notLead, "customer", "2026-10-01T10:00:00Z");
      await sub(notLead, "ai", "2026-10-02T10:00:00Z");
      expect((await pairOf(c, lead)).author_kind, "unset before the run").toBeNull();

      const { rows: buckets } = await c.query<{ bucket: string; row_count: string }>("select bucket, row_count from app.backfill_contact_authors()");
      for (const [label, , want] of CASES) expect(await pairOf(c, ids[label]!), label).toEqual(want);
      expect(await pairOf(c, twice), "first event wins").toEqual({ author_kind: "ai", author_id: null });
      expect(await pairOf(c, lead), "web-chat lead").toEqual({ author_kind: "ai", author_id: null });
      expect(await pairOf(c, notLead), "earliest submission is the customer's").toEqual({ author_kind: "customer", author_id: null });

      // Every bucket this seed fills is named, with at least this seed's rows (other suites' unset contacts may join).
      const n = Object.fromEntries(buckets.map((b) => [b.bucket, Number(b.row_count)]));
      const mine: Record<string, number> = {
        "contacts ai": 2, "contacts ai (website chat)": 1, "contacts customer": 3, "contacts customer (no event)": 1,
        "contacts import": 2, "contacts person": 3,
      };
      for (const [b, k] of Object.entries(mine)) expect(n[b] ?? 0, b).toBeGreaterThanOrEqual(k);

      await c.query("update contacts set author_kind = 'automation' where id = $1", [ids["system:form"]]);
      await c.query("select * from app.backfill_contact_authors()");
      expect(await pairOf(c, ids["system:form"]!), "a set row is never rewritten").toEqual({ author_kind: "automation", author_id: null });
      expect(await pairOf(c, ids["user:<clerk>"]!)).toEqual({ author_kind: "person", author_id: "user_3H2QKPdnekiD0smDzYRIdDlf7am" });
    }));
});

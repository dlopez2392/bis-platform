import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback, actAsMember } from "./db";

/**
 * A language on every customer (S-09, migration 0076). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_lang_${RUN}`;
const LANG = [
  "language", "language_source", "language_set_at", "last_language_signal",
  "last_language_signal_source", "last_language_signal_at", "language_hint_kept_at",
] as const;
const T0 = "2026-10-01T15:00:00.000Z";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const FN = "public.record_language_signal(uuid,uuid,text,text,timestamptz)";
/** Each column's comment must name ITS OWN writer, not merely carry "0076" somewhere. */
const WRITER: Record<(typeof LANG)[number], RegExp> = {
  language: /record_language_signal/,
  language_source: /record_language_signal/,
  language_set_at: /record_language_signal/,
  last_language_signal: /record_language_signal/,
  last_language_signal_source: /record_language_signal/,
  last_language_signal_at: /record_language_signal/,
  language_hint_kept_at: /keepContactLanguageHint/,
};

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = async (org: string, name: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name])).rows[0]!.id;
  const acct = await account(ORG, "Lang Co");
  const other = await account(`${ORG}_b`, "Other Co");
  const contact = async (a: string) =>
    (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [a])).rows[0]!.id;
  return { acct, other, ana: await contact(acct), bea: await contact(other) };
}

/** The seven columns, timestamps as ISO strings (pg hands timestamptz back as a Date). */
async function langOf(c: Client, id: string): Promise<Record<string, string | null>> {
  const { rows: [r] } = await c.query(`select ${LANG.join(", ")} from contacts where id = $1`, [id]);
  return Object.fromEntries(LANG.map((k) => [k, r[k] instanceof Date ? (r[k] as Date).toISOString() : (r[k] as string | null)]));
}
const NONE = Object.fromEntries(LANG.map((k) => [k, null]));

const signal = async (c: Client, a: string | null, id: string | null, lang: string | null, source: string | null, at: string | null) =>
  (await attempt(c, "select public.record_language_signal($1::uuid, $2::uuid, $3::text, $4::text, $5::timestamptz) as set",
    [a, id, lang, source, at])).rows[0]!.set as boolean;

describe("contacts' language columns (spec §6.1)", () => {
  it("each value is from its closed set (mutation: drop contacts_language_source_check -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const bad: [string, string][] = [
      ["language = 'fr', language_source = 'staff', language_set_at = now()", "contacts_language_check"],
      ["language = 'es', language_source = 'import', language_set_at = now()", "contacts_language_source_check"],
      ["last_language_signal = 'fr', last_language_signal_source = 'call', last_language_signal_at = now()", "contacts_last_language_signal_check"],
      ["last_language_signal = 'es', last_language_signal_source = 'staff', last_language_signal_at = now()", "contacts_last_language_signal_source_check"],
    ];
    for (const [set, constraint] of bad) {
      await expect(attempt(c, `update contacts set ${set} where id = $1`, [s.ana]), constraint)
        .rejects.toMatchObject({ code: "23514", constraint });
    }
  }));

  it("the language, its source and its time are all set or all null; so is the last signal (mutation: drop contacts_language_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "update contacts set language = 'es' where id = $1", [s.ana]))
        .rejects.toMatchObject({ code: "23514", constraint: "contacts_language_coherent" });
      await expect(attempt(c, "update contacts set last_language_signal = 'es', last_language_signal_at = now() where id = $1", [s.ana]))
        .rejects.toMatchObject({ code: "23514", constraint: "contacts_language_signal_coherent" });
      expect(await langOf(c, s.ana)).toEqual(NONE);
    }));

  it("each new column names its OWN writer in a comment (not just any '0076' text), and accounts.language names its second reader", () => withRollback(async (c) => {
    const { rows } = await c.query<{ attname: (typeof LANG)[number]; d: string | null }>(
      `select a.attname, col_description(a.attrelid, a.attnum) as d from pg_attribute a
        where a.attrelid = 'public.contacts'::regclass and a.attname = any($1)`, [[...LANG]]);
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.d, r.attname).toMatch(/0076/);
      expect(r.d, r.attname).toMatch(WRITER[r.attname]);
    }
    const { rows: [acct] } = await c.query<{ d: string }>(
      "select col_description('public.accounts'::regclass, (select attnum from pg_attribute where attrelid = 'public.accounts'::regclass and attname = 'language')) as d");
    expect(acct!.d).toMatch(/since 0076/);
  }));
});

describe("record_language_signal (spec §6.2, C3)", () => {
  it("on a contact with no language: sets the language, its source and the evidence's own time, and the last signal; returns true", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await signal(c, s.acct, s.ana, "es", "booking", T1)).toBe(true);
      expect(await langOf(c, s.ana)).toEqual({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1, language_hint_kept_at: null,
      });
    }));

  it("a later, disagreeing signal moves only the last signal and returns false (mutation: drop the `language is null` test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await signal(c, s.acct, s.ana, "es", "booking", T1);
      expect(await signal(c, s.acct, s.ana, "en", "call", T2)).toBe(false);
      expect(await langOf(c, s.ana)).toMatchObject({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2,
      });
    }));

  it("an older signal changes nothing (mutation: drop the time guard -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await signal(c, s.acct, s.ana, "es", "booking", T1);
    expect(await signal(c, s.acct, s.ana, "en", "call", T0)).toBe(false);
    expect(await langOf(c, s.ana)).toMatchObject({ last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1 });
  }));

  it("the same signal twice is a no-op the second time: the backfill can be re-run (plan deviation 8)", () => withRollback(async (c) => {
    const s = await seed(c);
    expect(await signal(c, s.acct, s.ana, "es", "form", T1)).toBe(true);
    const once = await langOf(c, s.ana);
    expect(await signal(c, s.acct, s.ana, "es", "form", T1)).toBe(false);
    expect(await langOf(c, s.ana)).toEqual(once);
  }));

  it("never touches another account's contact or an unknown id (mutation: drop the account_id filter -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    expect(await signal(c, s.acct, s.bea, "es", "form", T1)).toBe(false);
    expect(await signal(c, s.acct, "00000000-0000-0000-0000-000000000000", "es", "form", T1)).toBe(false);
    expect(await langOf(c, s.bea)).toEqual(NONE);
  }));

  it("a NULL in any argument raises 22004 before anything is written (mutation: remove the NULL guard -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const args: [string | null, string | null, string | null, string | null, string | null] = [s.acct, s.ana, "es", "booking", T1];
    for (let i = 0; i < args.length; i++) {
      const a = [...args] as typeof args;
      a[i] = null;
      await expect(signal(c, ...a), `argument ${i + 1}`).rejects.toMatchObject({ code: "22004" });
    }
    expect(await langOf(c, s.ana)).toEqual(NONE);
  }));

  it("a value outside its set raises 22023; `staff` is never a signal (mutation: accept 'staff' -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(signal(c, s.acct, s.ana, "fr", "booking", T1)).rejects.toMatchObject({ code: "22023" });
    await expect(signal(c, s.acct, s.ana, "es", "staff", T1)).rejects.toMatchObject({ code: "22023" });
  }));

  it("is security invoker with search_path pg_catalog, pg_temp (0096), and only service_role may execute it (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [FN]);
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=pg_catalog, pg_temp'] });
      const { rows: [p] } = await c.query(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as svc`, [FN]);
      expect(p).toEqual({ anon: false, auth: false, svc: true });
    }));

  it("a signed-in client calling it is refused 42501 on the FUNCTION itself (the real refusal, not just the catalogue)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAsMember(c, s.acct, ORG, "owner");
    await expect(signal(c, s.acct, s.ana, "es", "booking", T1)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied for function record_language_signal/i),
    });
  }));

  it("service_role, its only grantee, can call it directly and it takes effect", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("set local role service_role");
    expect(await signal(c, s.acct, s.ana, "es", "booking", T1)).toBe(true);
    await c.query("reset role");
    expect(await langOf(c, s.ana)).toMatchObject({ language: "es", language_source: "booking", language_set_at: T1 });
  }));

  it("refuses a p_at that is not a real, roughly-current moment: infinite or more than a day ahead (mutation: remove the p_at sanity guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(signal(c, s.acct, s.ana, "es", "booking", "infinity")).rejects.toMatchObject({ code: "22023" });
      const farFuture = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      await expect(signal(c, s.acct, s.ana, "es", "booking", farFuture)).rejects.toMatchObject({ code: "22023" });
      expect(await langOf(c, s.ana)).toEqual(NONE);
    }));
});

describe("record_language_signal's write is race-safe (spec C3)", () => {
  /**
   * Two REAL sessions, not one rolled-back transaction: `withRollback` cannot model a race because
   * everything inside it is the same transaction. A begins and calls, holding the row lock, without
   * committing; B's call is issued (and blocks on that lock) before A commits; once A commits, B's call
   * resolves and must see A's language already set. Cleanup is explicit deletes outside any
   * transaction, each one's error checked, in FK order (contacts, then the account).
   */
  it("a concurrent second signal waits on the row lock, then loses: first write wins the race (mutation: drop `for update` -> FAILS)", async () => {
    const seedClient = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const a = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const b = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    await seedClient.connect();
    await a.connect();
    await b.connect();
    let acctId: string | null = null;
    let contactId: string | null = null;
    try {
      const { rows: [agency] } = await seedClient.query<{ id: string }>("select id from agencies limit 1");
      const { rows: [acct] } = await seedClient.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
        [agency!.id, `org_race_${RUN}`, "Race Co"]);
      acctId = acct!.id;
      const { rows: [contact] } = await seedClient.query<{ id: string }>(
        "insert into contacts (account_id, first_name) values ($1, 'Ana') returning id", [acctId]);
      contactId = contact!.id;

      await a.query("begin");
      const aSet = await a.query(
        "select public.record_language_signal($1::uuid, $2::uuid, 'es', 'booking', $3::timestamptz) as set",
        [acctId, contactId, T1]);
      expect(aSet.rows[0]!.set as boolean).toBe(true);

      await b.query("begin");
      // Issued but NOT awaited yet: this call blocks on A's row lock until A commits or rolls back.
      const bPromise = b.query(
        "select public.record_language_signal($1::uuid, $2::uuid, 'en', 'call', $3::timestamptz) as set",
        [acctId, contactId, T2]);

      // Give B's query time to actually reach and start waiting on the lock before A releases it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await a.query("commit");

      const bSet = await bPromise;
      expect(bSet.rows[0]!.set as boolean).toBe(false);
      await b.query("commit");

      const { rows: [row] } = await seedClient.query<{ language: string; language_source: string }>(
        "select language, language_source from contacts where id = $1", [contactId]);
      expect(row).toMatchObject({ language: "es", language_source: "booking" });
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      if (contactId) {
        const delContact = await seedClient.query("delete from contacts where id = $1", [contactId]).catch((e: unknown) => e);
        if (delContact instanceof Error) throw delContact;
      }
      if (acctId) {
        const delAcct = await seedClient.query("delete from accounts where id = $1", [acctId]).catch((e: unknown) => e);
        if (delAcct instanceof Error) throw delAcct;
      }
      await a.end();
      await b.end();
      await seedClient.end();
    }
  });
});

describe("the client role writes no language (spec §6.3, C2)", () => {
  it("a client INSERT carrying all seven values stores none of them (mutation: drop trigger contacts_language_server_only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      const { rows: [row] } = await attempt(c,
        `insert into contacts (account_id, first_name, language, language_source, language_set_at, last_language_signal,
           last_language_signal_source, last_language_signal_at, language_hint_kept_at)
         values ($1, 'Cleo', 'es', 'staff', now(), 'es', 'call', now(), now()) returning id`, [s.acct]);
      await c.query("reset role");
      expect(await langOf(c, row.id as string)).toEqual(NONE);
    }));

  it("the service role's INSERT keeps them (the guard is the client's only)", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("set local role service_role");
    const { rows: [row] } = await attempt(c,
      "insert into contacts (account_id, first_name, language, language_source, language_set_at) values ($1, 'Dora', 'es', 'staff', $2) returning id",
      [s.acct, T1]);
    await c.query("reset role");
    expect(await langOf(c, row.id as string)).toMatchObject({ language: "es", language_source: "staff", language_set_at: T1 });
  }));

  it("a client UPDATE is refused 42501 on EACH language column separately, a no-op SET included (mutation: grant update(language) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      for (const col of LANG) {
        // A no-op self-assignment (every column here starts NULL): Postgres still checks column-level
        // UPDATE privilege for any column named in SET, independent of whether the value changes, so a
        // probe that grants UPDATE on exactly ONE of the seven columns is caught by that column's own
        // case rather than hiding behind the other six still being refused.
        await expect(attempt(c, `update contacts set ${col} = ${col} where id = $1`, [s.ana]), col)
          .rejects.toMatchObject({ code: "42501" });
      }
    }));
});

describe("PR 2's Spanish-box columns (spec §6.4, C17)", () => {
  it("six nullable columns with no default", () => withRollback(async (c) => {
    const { rows } = await c.query<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) and column_name = any($2) order by 1, 2`,
      [["automations", "calendars", "voice_profiles"],
       ["body_es", "body_es_basis", "followup_body_es", "followup_body_es_basis", "textback_body_es", "textback_body_es_basis"]]);
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "automations.body_es", "automations.body_es_basis", "calendars.followup_body_es", "calendars.followup_body_es_basis",
      "voice_profiles.textback_body_es", "voice_profiles.textback_body_es_basis",
    ]);
    for (const r of rows) expect([r.is_nullable, r.column_default]).toEqual(["YES", null]);
  }));

  it("a Spanish automation body is at most 1,000 characters, the English's own limit (mutation: drop automations_body_es_length -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("insert into automations (account_id, recipe_key) values ($1, 'review_request')", [s.acct]);
      expect((await attempt(c, "update automations set body_es = repeat('a', 1000) where account_id = $1", [s.acct])).rowCount).toBe(1);
      await expect(attempt(c, "update automations set body_es = repeat('a', 1001) where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "automations_body_es_length" });
    }));
});

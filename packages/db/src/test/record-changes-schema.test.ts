import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0111_record_changes.sql: public.record_changes, app.record_changes_settings, app.record_change_fields,
 * app.record_changes_capture and the two contacts triggers (F-115 part 1 / S-04; spec section 2.2, 2.3 and 5;
 * plan Task 1).
 * RED BEFORE APPLY: every case, legitimately: each reads or writes an object 0111 creates (the table, the settings
 * row, the field list or a change row the triggers write). Replica only (withRollback).
 *
 * Who made a write is decided from the SESSION's role (current_setting('role'), which a definer does not change;
 * 0110's rule: a claim is never trusted for the role) and, for a person, the sub claim. A direct session (no API
 * role: migrations, psql, a fixture seeding as postgres) is automation/sql and never refused (plan correction 4).
 *
 * Since 0113 (record-changes-enforce-schema.test.ts) observe mode is gone: author_kind is NOT NULL and enforce is on in
 * every environment. The cases here that pinned an unattributed write landing with a NULL author now pin its refusal
 * (42501, or 23502 when a case switches enforce off), so each mutation they name still FAILS: it would write a row.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };
type Row = { op: string; field: string | null; before: unknown; after: unknown; author_kind: string | null; author_id: string | null; via: string | null };

/** contact-archive-schema.test.ts's helpers, with this file's org prefix. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_rc_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Record changes') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Record changes test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
/** As the table owner (a direct session): its own insert row is automation/sql. The literal shapes the app stores. */
async function contact(c: Client, accountId: string, p: { first?: string; phone?: string; email?: string; custom?: object } = {}): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    `insert into public.contacts (account_id, first_name, phone, email, custom, author_kind)
     values ($1, $2, $3, $4, $5::jsonb, 'person') returning id`,
    [accountId, p.first ?? "Dan", p.phone ?? "(956) 292-1696", p.email ?? "  dan@example.com  ", JSON.stringify(p.custom ?? {})]);
  return r!.id;
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
/** contact-merge-schema.test.ts:60-64. */
async function asService(c: Client) {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
}
/** A service-role PostgREST request as the capture sees it: service claims, plus the x-bis-author header when given. */
async function asServiceWith(c: Client, author?: object | string): Promise<void> {
  await asService(c);
  await header(c, author);
}
/** The request.headers setting PostgREST writes; keys lower-cased. A string author is sent as-is (malformed probes). */
async function header(c: Client, author?: object | string): Promise<void> {
  const value = author === undefined ? {} : { "x-bis-author": typeof author === "string" ? author : JSON.stringify(author) };
  await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(value)]);
}
/** Every bis.* setting back to unset, as plan correction 7 says a definer leaves them. */
async function clearGucs(c: Client) {
  await c.query("select set_config('bis.author', '', true), set_config('bis.author_id', '', true), set_config('bis.via', '', true)");
}
/** As the owner, every change row of one record, oldest first. */
const changes = async (c: Client, id: string, op?: string): Promise<Row[]> => {
  await actAsOwner(c);
  const { rows } = await c.query<Row>(
    `select op, field, before, after, author_kind, author_id, via from public.record_changes
      where record_id = $1 and ($2::text is null or op = $2) order by id`, [id, op ?? null]);
  return rows;
};
/** The update rows' authors only. */
const authors = async (c: Client, id: string) =>
  (await changes(c, id, "update")).map((r) => ({ field: r.field, author_kind: r.author_kind, author_id: r.author_id, via: r.via }));
/** A throwaway SECURITY DEFINER that updates one contact, created inside the rollback. With `kind`, it names its
 *  author the way a 0112 definer will (set, write, reset). */
async function definer(c: Client, name: string, kind?: string) {
  await actAsOwner(c);
  const set = kind ? `perform pg_catalog.set_config('bis.author', '${kind}', true);` : "";
  const reset = kind ? "perform pg_catalog.set_config('bis.author', '', true);" : "";
  await c.query(`create function public.${name}(p uuid) returns void language plpgsql security definer
    set search_path = pg_catalog, pg_temp as $f$ begin ${set}
      update public.contacts set first_name = first_name || 'x' where id = p; ${reset} end $f$`);
  await c.query(`grant execute on function public.${name}(uuid) to anon, authenticated, service_role`);
}

const AUDITED_SPEC = ["first_name", "last_name", "email", "phone", "assigned_to", "dnd", "source",
  "marketing_email_opted_out_at", "language", "custom"];
/** Every contacts column the history leaves out, and why. Names the spec did not list are marked (T1). */
const EXCLUDED: Record<string, string> = {
  id: "the row key", account_id: "the tenant", created_at: "set once on insert",
  archived_at: "0103's log", archived_by: "0103's log", merged_into: "0106's log", merged_at: "0106's log",
  company_name: "derived (0072)", sort_name: "derived", email_key: "derived", phone_key: "derived",
  phone_country_unconfirmed: "derived", updated_at: "a timestamp", author_kind: "creation provenance",
  author_id: "creation provenance", holds_shared_number: "structural", last_language_signal: "telemetry",
  last_language_signal_at: "telemetry", language_hint_kept_at: "telemetry", language_set_at: "telemetry",
  attribution: "machine UTM blob (enrich.ts:416)",
  // Not named by the spec; found on the live column list at 0110 (T1):
  phone_national: "derived (0106, generated)", name_key: "derived (0106, generated)",
  search_name: "derived (0108, generated)",
  language_source: "telemetry: which sign set language (language itself is audited)",
  last_language_signal_source: "telemetry",
  reactivation_sent_at: "a timestamp the reactivation pass stamps (automation bookkeeping)",
};

describe("0111: the record_changes table", () => {
  it("0111: columns, CHECKs and the three indexes; 0113: author_kind NOT NULL and the unattributed index dropped (mutation: drop record_changes_author_id -> an ai row with an id inserts -> FAILS; mutation: 0113 keeps author_kind nullable -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "shape");
      const { rows: cols } = await c.query(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'record_changes' order by ordinal_position`);
      expect(cols).toEqual([
        { column_name: "id", data_type: "bigint", is_nullable: "NO" },
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO" },
        { column_name: "record_type", data_type: "text", is_nullable: "NO" },
        { column_name: "record_id", data_type: "uuid", is_nullable: "NO" },
        { column_name: "contact_id", data_type: "uuid", is_nullable: "YES" },
        { column_name: "client_group_id", data_type: "uuid", is_nullable: "YES" },
        { column_name: "op", data_type: "text", is_nullable: "NO" },
        { column_name: "field", data_type: "text", is_nullable: "YES" },
        { column_name: "before", data_type: "jsonb", is_nullable: "YES" },
        { column_name: "after", data_type: "jsonb", is_nullable: "YES" },
        { column_name: "xact", data_type: "bigint", is_nullable: "NO" },
        { column_name: "author_kind", data_type: "text", is_nullable: "NO" },   // 0113
        { column_name: "author_id", data_type: "text", is_nullable: "YES" },
        { column_name: "via", data_type: "text", is_nullable: "YES" },
        { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      ]);
      const ins = (type: string, op: string, field: string | null, kind: string | null, id: string | null) => refusal(c,
        `insert into public.record_changes (account_id, record_type, record_id, op, field, author_kind, author_id)
         values ($1, $2, gen_random_uuid(), $3, $4, $5, $6)`, [a.accountId, type, op, field, kind, id]);
      expect(await ins("contact", "update", null, "person", "user_x")).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_field_shape") });
      expect(await ins("contact", "insert", "phone", "person", "user_x")).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_field_shape") });
      expect(await ins("contact", "insert", null, "ai", "x")).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_author_id") });
      expect(await ins("booking", "insert", null, "person", "user_x")).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_record_type") });
      expect(await ins("contact", "upsert", null, "person", "user_x")).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_op") });
      expect(await ins("contact", "insert", null, "robot", null)).toMatchObject({ code: "23514", message: expect.stringContaining("record_changes_author_kind") });
      // The controls: each shape the CHECKs allow inserts (the owner is not bound by grants).
      for (const t of ["contact", "client_group", "client_group_member", "place", "equipment", "opportunity", "contact_relationship", "contact_tag"]) {
        expect(await ins(t, "insert", null, "import", "user_x"), t).toBeNull();
      }
      // 0113: a row with no author cannot exist.
      expect(await ins("contact", "update", "phone", null, null)).toMatchObject({ code: "23502", message: expect.stringContaining("author_kind") });
      const { rows: idx } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'record_changes' order by indexname");
      // 0111 also built record_changes_unattributed_idx for the daily audit's count of NULL rows; 0113 dropped it with
      // the NOT NULL (record-changes-enforce-schema.test.ts).
      expect(idx.map((r) => r.indexname)).toEqual(["record_changes_contact_idx", "record_changes_group_idx", "record_changes_pkey",
        "record_changes_record_idx"]);
      expect(idx.find((r) => r.indexname === "record_changes_contact_idx")!.indexdef).toContain("(account_id, contact_id, created_at DESC, id DESC)");
      expect(idx.find((r) => r.indexname === "record_changes_group_idx")!.indexdef).toContain("(account_id, client_group_id, created_at DESC, id DESC) WHERE (client_group_id IS NOT NULL)");
      expect(idx.find((r) => r.indexname === "record_changes_record_idx")!.indexdef).toContain("(account_id, record_type, record_id, created_at DESC)");
    }));

  it("grants: anon none; authenticated and service_role SELECT only; nobody UPDATE/DELETE/TRUNCATE; nothing on the sequence (mutation: grant insert to service_role -> FAILS; grant usage on the sequence to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const held: string[] = [];
      for (const r of ["anon", "authenticated", "service_role"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          const { rows: [h] } = await c.query<{ h: boolean }>("select has_table_privilege($1, 'public.record_changes', $2) as h", [r, p]);
          if (h!.h) held.push(`${r} ${p}`);
        }
      }
      expect(held).toEqual(["authenticated SELECT", "service_role SELECT"]);
      const settings: string[] = [];
      for (const r of ["anon", "authenticated", "service_role"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          const { rows: [h] } = await c.query<{ h: boolean }>("select has_table_privilege($1, 'app.record_changes_settings', $2) as h", [r, p]);
          if (h!.h) settings.push(`${r} ${p}`);
        }
      }
      expect(settings).toEqual([]);
      // Its identity sequence: no role inserts, so none holds anything on it (review m2).
      const seq: string[] = [];
      for (const r of ["anon", "authenticated", "service_role"]) {
        for (const p of ["USAGE", "SELECT", "UPDATE"]) {
          const { rows: [h] } = await c.query<{ h: boolean }>("select has_sequence_privilege($1, 'public.record_changes_id_seq', $2) as h", [r, p]);
          if (h!.h) seq.push(`${r} ${p}`);
        }
      }
      expect(seq).toEqual([]);
      const { rows: [rls] } = await c.query<{ on: boolean }>("select relrowsecurity as on from pg_class where oid = 'public.record_changes'::regclass");
      expect(rls!.on).toBe(true);
      // The capture is not callable by any API role (a trigger function needs no EXECUTE to fire); a PUBLIC grant
      // would show here too, as every role holds what PUBLIC holds.
      const fns: string[] = [];
      for (const r of ["anon", "authenticated", "service_role"]) {
        const { rows: [h] } = await c.query<{ h: boolean }>("select has_function_privilege($1, 'app.record_changes_capture()', 'EXECUTE') as h", [r]);
        if (h!.h) fns.push(r);
      }
      expect(fns).toEqual([]);
    }));

  it("column pin: every contacts column is AUDITED or EXCLUDED (mutation: add a column to contacts in the test -> FAILS naming it)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ f: string[] }>("select app.record_change_fields('contact') as f");
      const audited = f!.f;
      expect([...audited].sort()).toEqual([...AUDITED_SPEC].sort());
      const { rows } = await c.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'contacts' order by ordinal_position");
      const live = rows.map((r) => r.column_name);
      const unlisted = live.filter((n) => !audited.includes(n) && !(n in EXCLUDED));
      expect(unlisted).toEqual([]);
      // A listed name that no longer exists is a stale decision; a name in both lists is no decision.
      expect(Object.keys(EXCLUDED).filter((n) => !live.includes(n))).toEqual([]);
      expect(audited.filter((n) => n in EXCLUDED)).toEqual([]);
    }));
});

describe("0111: what the capture writes", () => {
  it("signed-in edit: one row per changed field, person + sub; a no-op writes nothing (mutation: drop IS DISTINCT FROM -> the no-op case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "edit");
      const id = await contact(c, a.accountId, { custom: { gate: "1234" } });
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("update public.contacts set phone = '+19562921696', email = 'dan@example.com' where id = $1", [id]);
      expect(await changes(c, id, "update")).toEqual([
        { op: "update", field: "email", before: "  dan@example.com  ", after: "dan@example.com", author_kind: "person", author_id: sub, via: null },
        { op: "update", field: "phone", before: "(956) 292-1696", after: "+19562921696", author_kind: "person", author_id: sub, via: null },
      ]);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("update public.contacts set phone = '+19562921696' where id = $1", [id]);
      expect(await changes(c, id, "update")).toHaveLength(2);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query(`update public.contacts set custom = '{"gate":"9","dog":"Rex"}'::jsonb where id = $1`, [id]);
      const custom = (await changes(c, id, "update")).slice(2);
      expect(custom.map((r) => ({ field: r.field, before: r.before, after: r.after })).sort((x, y) => x.field!.localeCompare(y.field!))).toEqual([
        { field: "custom.dog", before: null, after: "Rex" },
        { field: "custom.gate", before: "1234", after: "9" },
      ]);
      expect(custom.every((r) => r.author_kind === "person" && r.author_id === sub)).toBe(true);
    }));

  it("insert snapshots the audited columns only (mutation: snapshot to_jsonb(new) -> 'attribution' appears -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "insert");
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query<{ id: string }>(
        `insert into public.contacts (account_id, first_name, phone, attribution) values ($1, 'Rita', '+19565550111', '{"utm_source":"x"}') returning id`,
        [a.accountId]);
      const rows = await changes(c, r!.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ op: "insert", field: null, before: null, author_kind: "person", author_id: sub, via: null });
      expect(Object.keys(rows[0]!.after as object).sort()).toEqual([...AUDITED_SPEC].sort());
      expect(rows[0]!.after).toMatchObject({ first_name: "Rita", phone: "+19565550111", custom: {}, dnd: {}, email: null });
    }));

  it("precedence: a GUC beats the header; a person-called definer is the person whatever the header; the client path keeps only import and restore: (mutation: read the header before bis.author -> (a) FAILS; mutation: honour any client kind -> (d) FAILS; mutation: no restore length bound -> (d) FAILS; mutation: drop the sub's btrim -> (g) FAILS; mutation: drop 'person needs an id' -> (f) FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "prec");
      // (a) A GUC beats the header.
      const ia = await contact(c, a.accountId);
      await asServiceWith(c, { kind: "ai" });
      await c.query("select set_config('bis.author', 'customer', true)");
      await c.query("update public.contacts set first_name = 'A' where id = $1", [ia]);
      await clearGucs(c);
      expect(await authors(c, ia)).toEqual([{ field: "first_name", author_kind: "customer", author_id: null, via: null }]);

      // (b) A definer a person called: person with the sub, even with an ai header.
      const ib = await contact(c, a.accountId);
      await definer(c, "t_rc_upd_b");
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await header(c, { kind: "ai" });
      await c.query("select public.t_rc_upd_b($1)", [ib]);
      expect(await authors(c, ib)).toEqual([{ field: "first_name", author_kind: "person", author_id: sub, via: null }]);

      // (c) The client path with an import header: import, the sub kept.
      const ic = await contact(c, a.accountId);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "import" });
      await c.query("update public.contacts set first_name = 'C' where id = $1", [ic]);
      expect(await authors(c, ic)).toEqual([{ field: "first_name", author_kind: "import", author_id: sub, via: null }]);

      // (d) The client path: ai is a person; a forged via is dropped; restore:<n> is kept, nothing looser.
      const cases: [object, string | null][] = [
        [{ kind: "ai" }, null], [{ kind: "person", via: "merge:5" }, null], [{ kind: "person", via: "restore:12" }, "restore:12"],
        [{ kind: "person", via: "restore:" }, null], [{ kind: "person", via: "restore:12x" }, null], [{ kind: "person", via: "xrestore:12" }, null],
        // A change id is a bigint: 19 digits at most (9223372036854775807); a 20-digit id cannot name a row.
        [{ kind: "person", via: "restore:9223372036854775807" }, "restore:9223372036854775807"],
        [{ kind: "person", via: "restore:12345678901234567890" }, null],
      ];
      for (const [hdr, via] of cases) {
        const id = await contact(c, a.accountId);
        await actAs(c, { org_id: a.orgId, sub });
        await header(c, hdr);
        await c.query("update public.contacts set first_name = 'D' where id = $1", [id]);
        expect(await authors(c, id), JSON.stringify(hdr)).toEqual([{ field: "first_name", author_kind: "person", author_id: sub, via }]);
      }

      // (e) The service path's header: kind and via as sent; an id only with person or import.
      const he: [object, Omit<Row, "op" | "field" | "before" | "after">][] = [
        [{ kind: "ai", id: "user_x", via: "ai_act:00000000-0000-0000-0000-000000000111" },
          { author_kind: "ai", author_id: null, via: "ai_act:00000000-0000-0000-0000-000000000111" }],
        [{ kind: "import", id: "user_imp" }, { author_kind: "import", author_id: "user_imp", via: null }],
        [{ kind: "person", id: "user_p" }, { author_kind: "person", author_id: "user_p", via: null }],
        [{ kind: "automation" }, { author_kind: "automation", author_id: null, via: null }],
      ];
      for (const [hdr, want] of he) {
        const id = await contact(c, a.accountId);
        await asServiceWith(c, hdr);
        await c.query("update public.contacts set first_name = 'E' where id = $1", [id]);
        expect(await authors(c, id), JSON.stringify(hdr)).toEqual([{ field: "first_name", ...want }]);
      }

      // (g) The sub is trimmed and a blank one is no id (0073's nullif(btrim(sub)) for contacts.author_id). The
      //     agency, so the padded sub needs no membership to reach the row.
      for (const [raw, want] of [["  user_pad  ", "user_pad"], ["   ", null]] as const) {
        const id = await contact(c, a.accountId);
        await actAs(c, { app_role: "agency_admin", sub: raw });
        await header(c);
        await c.query("update public.contacts set first_name = 'G' where id = $1", [id]);
        expect(await authors(c, id), JSON.stringify(raw)).toEqual([{ field: "first_name", author_kind: "person", author_id: want, via: null }]);
      }

      // (f) A header that is not an author is no author: the write is refused (0113: enforce on).
      for (const bad of [{ kind: "person" }, { kind: "person", id: "" }, { kind: "robot" }, "not json", JSON.stringify("ai"), "[1]"]) {
        const id = await contact(c, a.accountId);
        await asServiceWith(c, bad);
        expect(await refusal(c, "update public.contacts set first_name = 'F' where id = $1", [id]), JSON.stringify(bad))
          .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
        expect(await authors(c, id), JSON.stringify(bad)).toEqual([]);
      }
    }));

  it("enforce on: a service request with no author is refused and the update rolls back (mutation: step 5 writes NULL in enforce mode -> FAILS; mutation: read the role from the claim -> 7d FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "enforce");
      const id = await contact(c, a.accountId, { first: "Before" });
      await c.query("update app.record_changes_settings set enforce = true");
      await asServiceWith(c);
      expect(await refusal(c, "update public.contacts set first_name = 'After' where id = $1", [id]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
      await actAsOwner(c);
      const { rows: [r] } = await c.query<{ first_name: string }>("select first_name from public.contacts where id = $1", [id]);
      expect(r!.first_name).toBe("Before");
      expect(await changes(c, id, "update")).toEqual([]);

      // 7b: a direct session with NO claims at all (a migration, psql) is automation/sql and is never refused.
      await c.query("reset role");
      await c.query("select set_config('request.jwt.claims', '', true), set_config('request.headers', '', true)");
      await c.query("update public.contacts set first_name = 'Sql' where id = $1", [id]);
      expect(await authors(c, id)).toEqual([{ field: "first_name", author_kind: "automation", author_id: null, via: "sql" }]);

      // 7d: a direct session that still carries a client's claims (a fixture seeding as postgres after actAs) is
      // still a direct session: the role decides, never a claim (0110's rule).
      const id2 = await contact(c, a.accountId);
      const sub7 = await actAsMember(c, a.accountId, a.orgId, "staff");
      await actAs(c, { role: "authenticated", org_id: a.orgId, sub: sub7 } as unknown as { org_id: string; sub: string });
      await actAsOwner(c);
      await c.query("update public.contacts set first_name = 'Fixture' where id = $1", [id2]);
      expect(await authors(c, id2)).toEqual([{ field: "first_name", author_kind: "automation", author_id: null, via: "sql" }]);

      // 7c: enforce OFF (half of 0113's ROLLBACK), the same service request: the capture's observe branch writes a NULL
      // author, and 0113's NOT NULL refuses it. The whole rollback is proven in record-changes-enforce-schema.test.ts.
      await c.query("update app.record_changes_settings set enforce = false");
      const id3 = await contact(c, a.accountId);
      await asServiceWith(c);
      expect(await refusal(c, "update public.contacts set first_name = 'Observed' where id = $1", [id3]))
        .toMatchObject({ code: "23502", message: expect.stringContaining("author_kind") });
      expect(await authors(c, id3)).toEqual([]);
    }));

  it("a client cannot write the log or claim ai through bis.author (mutation: read the GUC on the client path -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "client");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await refusal(c,
        "insert into public.record_changes (account_id, record_type, record_id, contact_id, op, author_kind) values ($1, 'contact', $2, $2, 'insert', 'ai')",
        [a.accountId, id])).toMatchObject({ code: "42501" });
      expect(await refusal(c, "update public.record_changes set author_kind = 'ai' where record_id = $1", [id])).toMatchObject({ code: "42501" });
      expect(await refusal(c, "delete from public.record_changes where record_id = $1", [id])).toMatchObject({ code: "42501" });
      await c.query("select set_config('bis.author', 'ai', true), set_config('bis.via', 'merge:1', true)");
      await c.query("update public.contacts set first_name = 'Mine' where id = $1", [id]);
      await clearGucs(c);
      expect(await authors(c, id)).toEqual([{ field: "first_name", author_kind: "person", author_id: sub, via: null }]);
    }));

  it("contact purge: value rows gone, one values-free delete row (mutation: keep value rows -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "purge");
      const id = await contact(c, a.accountId);
      const keep = await contact(c, a.accountId, { first: "Stays" });
      await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("update public.contacts set phone = '+19565550001' where id = $1", [id]);
      await c.query("update public.contacts set phone = '+19565550002' where id = any($1::uuid[])", [[id, keep]]);
      expect((await changes(c, id)).length).toBe(3);
      await actAsOwner(c);
      await c.query("delete from public.contacts where id = $1", [id]);
      expect(await changes(c, id)).toEqual([
        { op: "delete", field: null, before: null, after: null, author_kind: "automation", author_id: null, via: "sql" },
      ]);
      // Only that contact's values go.
      expect((await changes(c, keep)).map((r) => r.op)).toEqual(["insert", "update"]);
    }));

  it("a delete cascading from a removed account records nothing, so the account's deletion succeeds (mutation: remove the account-exists early return -> FK violation -> FAILS)", () =>
    withRollback(async (c) => {
      // contacts.account_id is NO ACTION (the teardown deletes contacts first), so no cascade from accounts reaches
      // contacts; 0112's child tables are the ones that cascade. A throwaway child table with the capture attached
      // models them (plan correction 6), inside the rollback.
      const a = await seedAccount(c, "cascade");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query(`create table public.t_rc_child (id uuid primary key default gen_random_uuid(),
        account_id uuid not null references public.accounts (id) on delete cascade, contact_id uuid)`);
      await c.query(`create trigger t_rc_child_capture after insert or delete on public.t_rc_child
        for each row execute function app.record_changes_capture('place', 'server')`);
      const { rows: [ch] } = await c.query<{ id: string }>("insert into public.t_rc_child (account_id, contact_id) values ($1, $2) returning id", [a.accountId, id]);
      expect((await changes(c, ch!.id)).map((r) => r.op)).toEqual(["insert"]);
      // The account's own teardown order: contacts first (a delete row each), then the account.
      await c.query("delete from public.contacts where id = $1", [id]);
      expect(await refusal(c, "delete from public.accounts where id = $1", [a.accountId])).toBeNull();
      const { rows: [n] } = await c.query<{ n: number }>("select count(*)::int as n from public.record_changes where account_id = $1", [a.accountId]);
      expect(n!.n).toBe(0);
    }));

  it("enforce on: an update that changes no audited field writes nothing and is never refused; an audited change still is (mutation: decide the author before the no-change return -> (a) and (b) FAIL)", () =>
    withRollback(async (c) => {
      // stampReactivationSent (automations.ts) sends first and stamps second: a refused stamp would resend.
      const a = await seedAccount(c, "nochange");
      const id = await contact(c, a.accountId, { first: "Same" });
      await c.query("update app.record_changes_settings set enforce = true");
      await asServiceWith(c);
      // (a) Only an EXCLUDED column. expect.soft, so a mutation shows (a) and (b) failing each on its own line.
      expect.soft(await refusal(c, "update public.contacts set reactivation_sent_at = now() where id = $1", [id])).toBeNull();
      // (b) A no-op.
      expect.soft(await refusal(c, "update public.contacts set first_name = first_name where id = $1", [id])).toBeNull();
      expect(await changes(c, id, "update")).toEqual([]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query<{ stamped: boolean }>("select reactivation_sent_at is not null as stamped from public.contacts where id = $1", [id]);
      expect(r!.stamped).toBe(true);
      // (c) An audited field: still refused.
      await asServiceWith(c);
      expect(await refusal(c, "update public.contacts set first_name = 'Other', reactivation_sent_at = null where id = $1", [id]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
    }));

  it("headers: only x-bis-author is read, and nothing else in request.headers reaches a row (mutations: the client path takes the header's id -> FAILS; via falls back to authorization -> FAILS; the author is read from another key -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "headers");
      const SECRET = "Bearer SECRET_X";
      const noise = { authorization: SECRET, "x-author": JSON.stringify({ kind: "ai" }) };
      const leaks = async (id: string) => {
        await actAsOwner(c);
        const { rows: [n] } = await c.query<{ n: number }>(
          "select count(*)::int as n from public.record_changes r where r.record_id = $1 and r::text like '%SECRET_X%'", [id]);
        return n!.n;
      };
      // (a) The client path: an import header naming someone else is an import by the caller's OWN sub.
      const ia = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("select set_config('request.headers', $1, true)",
        [JSON.stringify({ ...noise, "x-bis-author": JSON.stringify({ kind: "import", id: "someone_else" }) })]);
      await c.query("update public.contacts set first_name = 'A' where id = $1", [ia]);
      expect(await authors(c, ia)).toEqual([{ field: "first_name", author_kind: "import", author_id: sub, via: null }]);
      expect(await leaks(ia)).toBe(0);
      // (b) The service path: the author is x-bis-author's, with no via; the bearer goes nowhere.
      const ib = await contact(c, a.accountId);
      await asService(c);
      await c.query("select set_config('request.headers', $1, true)",
        [JSON.stringify({ ...noise, "x-bis-author": JSON.stringify({ kind: "automation" }) })]);
      await c.query("update public.contacts set first_name = 'B' where id = $1", [ib]);
      expect(await authors(c, ib)).toEqual([{ field: "first_name", author_kind: "automation", author_id: null, via: null }]);
      expect(await leaks(ib)).toBe(0);
      // (c) The service path with no x-bis-author: another key is no author, so the write is refused (0113: enforce
      //     on). Nothing is written, so there is no row to leak from.
      const ic = await contact(c, a.accountId);
      await asService(c);
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(noise)]);
      expect(await refusal(c, "update public.contacts set first_name = 'C' where id = $1", [ic])).toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
      expect(await authors(c, ic)).toEqual([]);
    }));

  it("the settings row is one row (mutation: drop the check (id) -> a second insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      // One row. The column default is still 0111's false; 0113 set the row's value on (record-changes-enforce-schema.test.ts).
      const { rows } = await c.query<{ id: boolean }>("select id from app.record_changes_settings");
      expect(rows).toEqual([{ id: true }]);
      const { rows: [d] } = await c.query<{ d: string }>(
        "select column_default as d from information_schema.columns where table_schema = 'app' and table_name = 'record_changes_settings' and column_name = 'enforce'");
      expect(d!.d).toBe("false");
      expect(await refusal(c, "insert into app.record_changes_settings (id) values (false)")).toMatchObject({ code: "23514" });
      expect(await refusal(c, "insert into app.record_changes_settings (id) values (true)")).toMatchObject({ code: "23505" });
    }));

  it("an authenticated token calling a definer with header {kind:automation} is marked person + sub (mutation: swap the bis.author / authenticated-claims branches -> FAILS; mutation: drop the service_role check in the header branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "definer");
      await definer(c, "t_rc_upd_11");
      await definer(c, "t_rc_upd_11_auto", "automation");
      const automation = { "x-bis-author": JSON.stringify({ kind: "automation" }) };

      // (a) The orchestrator's case: a signed-in browser can attach any header to an rpc; inside a definer
      // current_user is not 'authenticated', so the server-path trigger fires, and the token must win.
      const ia = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(automation)]);
      await c.query("select public.t_rc_upd_11($1)", [ia]);
      expect(await authors(c, ia)).toEqual([{ field: "first_name", author_kind: "person", author_id: sub, via: null }]);

      // (b) A definer that names its author outranks the token of the person who called it (step 2 before step 3).
      const ib = await contact(c, a.accountId);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("select public.t_rc_upd_11_auto($1)", [ib]);
      expect(await authors(c, ib)).toEqual([{ field: "first_name", author_kind: "automation", author_id: null, via: null }]);

      // (c) The header is honoured for service_role only: an anon session's rpc with the same header is no author, so
      //     the write is refused (0113: enforce on).
      const ic = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await c.query("set local role anon");
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(automation)]);
      expect(await refusal(c, "select public.t_rc_upd_11($1)", [ic])).toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
      expect(await authors(c, ic)).toEqual([]);
    }));
});

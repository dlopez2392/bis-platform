import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsOwner } from "./db";

/**
 * 0113_record_changes_enforce.sql (F-115 part 1, plan Task 7): every change row names its author, and every
 * server write must. 0113 backfills the NULL-author rows observe mode wrote (from the events ledger, 0073/0091's
 * method, through app.backfill_record_change_authors()), marks what is left automation/'backfill:unknown', sets
 * record_changes.author_kind NOT NULL, drops 0111's record_changes_unattributed_idx and turns enforce on.
 *
 * RED BEFORE APPLY, legitimately: "the column, the index and the switch" (author_kind nullable, the index present,
 * enforce off), "a service write with no author" (observe mode writes NULL instead of refusing), "grants" and "the
 * backfill" (the function does not exist). GREEN BEFORE APPLY TOO, by design: "the ROLLBACK text" (it puts the
 * database back in the state 0111/0112 left, which is what pre already is; it proves the header's rollback, not
 * 0113's state). Replica only (withRollback).
 *
 * The backfill case first runs the ROLLBACK's drop not null inside its own transaction (rolled back with it), so
 * it can seed NULL rows: that ALTER holds ACCESS EXCLUSIVE on record_changes until the case ends, which only makes
 * other suites' contact writes wait for it.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };

/** record-changes-schema.test.ts's seedAccount, with this file's org prefix. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_rce_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Record changes enforce') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Record changes enforce test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
/** contact-merge-schema.test.ts:60-64, then PostgREST's request.headers with no x-bis-author. */
async function asServiceNoAuthor(c: Client) {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
  await c.query("select set_config('request.headers', '{}', true)");
}
async function contact(c: Client, accountId: string, first: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, author_kind) values ($1, $2, 'person') returning id", [accountId, first]);
  return r!.id;
}
const firstName = async (c: Client, id: string) => {
  await actAsOwner(c);
  return (await c.query<{ f: string }>("select first_name as f from public.contacts where id = $1", [id])).rows[0]!.f;
};

const T0 = "2026-11-05T15:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe("0113: every change row names its author", () => {
  it("the column, the index and the switch: author_kind NOT NULL, record_changes_unattributed_idx gone, enforce on (red before apply: YES, present, false)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [col] } = await c.query<{ n: string }>(
        `select is_nullable as n from information_schema.columns
          where table_schema = 'public' and table_name = 'record_changes' and column_name = 'author_kind'`);
      expect(col!.n).toBe("NO");
      const { rows: [idx] } = await c.query<{ r: string | null }>("select to_regclass('public.record_changes_unattributed_idx')::text as r");
      expect(idx!.r).toBeNull();
      const { rows: [s] } = await c.query<{ enforce: boolean }>("select enforce from app.record_changes_settings");
      expect(s!.enforce).toBe(true);
    }));

  it("a service write with no author raises 42501 and the update rolls back; with enforce switched off, NOT NULL still refuses it (mutation: leave enforce off in 0113 -> the first refusal FAILS; drop the set not null -> the second FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "enforce");
      const id = await contact(c, a.accountId, "Before");
      await asServiceNoAuthor(c);
      expect(await refusal(c, "update public.contacts set first_name = 'After' where id = $1", [id]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
      expect(await firstName(c, id)).toBe("Before");
      // Half the ROLLBACK (enforce off, NOT NULL kept): the capture's observe branch writes NULL, and the column refuses it.
      await actAsOwner(c);
      await c.query("update app.record_changes_settings set enforce = false");
      await asServiceNoAuthor(c);
      expect(await refusal(c, "update public.contacts set first_name = 'After' where id = $1", [id]))
        .toMatchObject({ code: "23502", message: expect.stringContaining("author_kind") });
      expect(await firstName(c, id)).toBe("Before");
    }));

  it("grants: the backfill function is no API role's, and is not a definer (mutation: grant execute to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, 'app.backfill_record_change_authors()', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'service_role']) r order by r`);
      expect(rows).toEqual([{ r: "anon", x: false }, { r: "authenticated", x: false }, { r: "service_role", x: false }]);
      const { rows: [p] } = await c.query<{ d: boolean; cfg: string[] }>(
        "select prosecdef as d, proconfig as cfg from pg_proc where oid = 'app.backfill_record_change_authors()'::regprocedure");
      expect(p).toEqual({ d: false, cfg: ["search_path=pg_catalog, pg_temp"] });
    }));

  it("the backfill, pair by pair: contact.updated user/ai/system -> person/ai/automation, contact.created by app.contact_author, within 2 s on the same account, the nearest event; the rest automation/'backfill:unknown'; NOT NULL then holds; a set row is never rewritten (mutations: map system to ai -> FAILS; widen the window to 3 s -> FAILS; drop the account match -> FAILS; skip the leftover update -> set not null FAILS; drop `author_kind is null` -> the second run FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "backfill");
      const other = await seedAccount(c, "other");
      await actAsOwner(c);
      // The ROLLBACK's first half, inside this transaction only: observe-era rows can exist again.
      await c.query("alter table public.record_changes alter column author_kind drop not null");

      /** A NULL-author change row as observe mode wrote it (via NULL, author_id NULL), at T0 + `s` seconds. */
      const row = async (recordType: string, op: string, field: string | null, s = 0): Promise<{ id: string; rec: string }> => {
        const { rows: [r] } = await c.query<{ id: string; rec: string }>(
          `insert into public.record_changes (account_id, record_type, record_id, contact_id, op, field, before, after, author_kind, created_at)
           values ($1, $2, gen_random_uuid(), null, $3, $4, null, null, null, $5) returning id::text, record_id::text as rec`,
          [a.accountId, recordType, op, field, at(s)]);
        return r!;
      };
      const ev = (account: string, type: string, rec: string, actor: [string, string], s: number, fields?: string[]) =>
        c.query("insert into public.events (account_id, type, actor_type, actor_id, payload, created_at) values ($1, $2, $3, $4, $5, $6)",
          [account, type, actor[0], actor[1], JSON.stringify(fields ? { contactId: rec, fields } : { contactId: rec }), at(s)]);

      type Want = { author_kind: string; author_id: string | null; via: string | null };
      const LEFT: Want = { author_kind: "automation", author_id: null, via: "backfill:unknown" };
      const cases: [string, { id: string; rec: string }, Want][] = [];
      const add = async (label: string, r: Promise<{ id: string; rec: string }>, want: Want, events: (rec: string) => Promise<unknown>) => {
        const x = await r; await events(x.rec); cases.push([label, x, want]);
      };

      // contact.updated: the field named in payload.fields, in either of the names the writers emit.
      await add("updated user, camel name", row("contact", "update", "first_name"), { author_kind: "person", author_id: "user_abc", via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_abc"], 0.4, ["firstName", "email"]));
      await add("updated user, padded id", row("contact", "update", "last_name"), { author_kind: "person", author_id: "user_pad", via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "  user_pad  "], 1, ["lastName"]));
      await add("updated user, blank id", row("contact", "update", "email"), { author_kind: "person", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "   "], 1, ["email"]));
      await add("updated ai, column name", row("contact", "update", "first_name"), { author_kind: "ai", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["ai", "voice"], 1, ["first_name"]));
      await add("updated system", row("contact", "update", "phone"), { author_kind: "automation", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["system", "automation"], 1, ["phone", "phone_country_unconfirmed"]));
      await add("updated custom key", row("contact", "update", "custom.gate_code"), { author_kind: "person", author_id: "user_c", via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_c"], 1, ["custom"]));
      await add("updated source", row("contact", "update", "source"), { author_kind: "ai", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["ai", "ai"], 1, ["source"]));
      // The window is 2 s either side, inclusive; the event is usually after the row (emit runs after the write).
      await add("2 s before", row("contact", "update", "first_name"), { author_kind: "ai", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["ai", "voice"], -2, ["firstName"]));
      await add("2 s after", row("contact", "update", "first_name"), { author_kind: "ai", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.updated", rec, ["ai", "voice"], 2, ["firstName"]));
      await add("3 s after", row("contact", "update", "first_name"), LEFT,
        (rec) => ev(a.accountId, "contact.updated", rec, ["ai", "voice"], 3, ["firstName"]));
      // The nearest event wins.
      await add("nearest", row("contact", "update", "first_name"), { author_kind: "ai", author_id: null, via: null },
        async (rec) => { await ev(a.accountId, "contact.updated", rec, ["user", "user_far"], 1.8, ["firstName"]);
          await ev(a.accountId, "contact.updated", rec, ["ai", "voice"], 0.2, ["firstName"]); });
      // No match: another field, another account, another event type.
      await add("other field", row("contact", "update", "phone"), LEFT,
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_abc"], 1, ["email"]));
      await add("other account", row("contact", "update", "first_name"), LEFT,
        (rec) => ev(other.accountId, "contact.updated", rec, ["user", "user_abc"], 1, ["firstName"]));
      await add("update row, created event", row("contact", "update", "first_name"), LEFT,
        (rec) => ev(a.accountId, "contact.created", rec, ["user", "user_abc"], 1));
      // contact.created: app.contact_author (0091, contactAuthor's SQL twin): a non-seed system actor is the customer.
      await add("created system", row("contact", "insert", null), { author_kind: "customer", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.created", rec, ["system", "form"], 1));
      await add("created ai", row("contact", "insert", null), { author_kind: "ai", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.created", rec, ["ai", "voice"], 1));
      await add("created user", row("contact", "insert", null), { author_kind: "person", author_id: "user_new", via: null },
        (rec) => ev(a.accountId, "contact.created", rec, ["user", " user_new "], 1));
      await add("created seed", row("contact", "insert", null), { author_kind: "import", author_id: null, via: null },
        (rec) => ev(a.accountId, "contact.created", rec, ["system", "system_ci_seed"], 1));
      await add("insert row, updated event", row("contact", "insert", null), LEFT,
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_abc"], 1, ["firstName"]));
      // Rows the ledger cannot name: a contact delete, the 0112 types, a row with no event at all.
      await add("contact delete", row("contact", "delete", null), LEFT,
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_abc"], 1, ["firstName"]));
      await add("place update", row("place", "update", "label"), LEFT,
        (rec) => ev(a.accountId, "contact.updated", rec, ["user", "user_abc"], 1, ["label"]));
      await add("no event", row("contact", "update", "first_name"), LEFT, async () => undefined);

      const { rows: buckets } = await c.query<{ bucket: string; row_count: string }>("select bucket, row_count from app.backfill_record_change_authors()");
      const read = async (id: string) =>
        (await c.query<Want>("select author_kind, author_id, via from public.record_changes where id = $1", [id])).rows[0]!;
      for (const [label, r, want] of cases) expect.soft(await read(r.id), label).toEqual(want);

      // Every NULL row in the database is this case's (NOT NULL held until the drop above, inside this transaction),
      // so the buckets are exact. Soft, so a mutation still reaches the set not null below.
      expect.soft(Object.fromEntries(buckets.map((b) => [b.bucket, Number(b.row_count)]))).toEqual({
        "contact.updated person": 4, "contact.updated ai": 5, "contact.updated automation": 1,
        "contact.created customer": 1, "contact.created ai": 1, "contact.created person": 1, "contact.created import": 1,
        "leftover automation backfill:unknown": 8,
      });
      // The ROLLBACK's drop not null undone: the column takes NOT NULL again over the backfilled rows.
      expect(await refusal(c, "alter table public.record_changes alter column author_kind set not null")).toBeNull();

      // A second run rewrites nothing: a row hand-set to another kind keeps it.
      await c.query("alter table public.record_changes alter column author_kind drop not null");
      const hand = cases.find(([l]) => l === "updated system")![1];
      await c.query("update public.record_changes set author_kind = 'customer' where id = $1", [hand.id]);
      const { rows: again } = await c.query<{ bucket: string; row_count: string }>("select bucket, row_count from app.backfill_record_change_authors()");
      expect(again.map((b) => [b.bucket, Number(b.row_count)])).toEqual([["leftover automation backfill:unknown", 0]]);
      expect(await read(hand.id)).toEqual({ author_kind: "customer", author_id: null, via: null });
    }));

  it("the ROLLBACK text (enforce off, drop not null) puts observe mode back: a service write with no author lands with a NULL author (green before apply too)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rollback");
      const id = await contact(c, a.accountId, "Before");
      await actAsOwner(c);
      await c.query("update app.record_changes_settings set enforce = false");
      await c.query("alter table public.record_changes alter column author_kind drop not null");
      await asServiceNoAuthor(c);
      await c.query("update public.contacts set first_name = 'Observed' where id = $1", [id]);
      await actAsOwner(c);
      const { rows } = await c.query("select field, author_kind, author_id, via from public.record_changes where record_id = $1 and op = 'update'", [id]);
      expect(rows).toEqual([{ field: "first_name", author_kind: null, author_id: null, via: null }]);
    }));
});

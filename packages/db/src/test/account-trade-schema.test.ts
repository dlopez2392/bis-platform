import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0101_account_trade.sql (S-53): accounts.trade, accounts.trade_other and their three CHECKs.
 * RED BEFORE APPLY: every case names a column or constraint 0101 adds.
 * The creatable list below is read FROM THE MIGRATION FILE, and the live constraint must list the same keys:
 * apps/web/src/lib/vetting/trades.test.ts proves the file equals the code module, this proves the database
 * equals the file, so the code list and the database cannot drift.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const MIGRATION = path.join(__dirname, "..", "..", "supabase", "migrations", "0101_account_trade.sql");

function fileCreatableKeys(): string[] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const list = /constraint accounts_trade_check check \(trade is null or trade in \(([^)]*)\)\)/.exec(sql);
  if (!list) throw new Error("accounts_trade_check's list not found in 0101");
  // Any quoted string (T1-T3 review m2): a key with a capital, digit or hyphen must still be read.
  return [...list[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

async function seed(c: Client, label: string): Promise<{ accountId: string; orgId: string }> {
  await actAsOwner(c);
  const orgId = `org_trade_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Vet') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Vetting', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}

const setTrade = (c: Client, id: string, trade: string | null, other: string | null) =>
  c.query("update public.accounts set trade = $2, trade_other = $3 where id = $1", [id, trade, other]);

describe("0101 accounts.trade / accounts.trade_other", () => {
  it("both are text, nullable, no default (mutation: default 'other' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts' and column_name in ('trade', 'trade_other')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "trade", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "trade_other", data_type: "text", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("the file lists exactly 21 creatable keys, and the live constraint lists the same ones (mutation: add 'law' to the live CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const keys = fileCreatableKeys();
      expect(keys).toHaveLength(21);
      const { rows: [def] } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'accounts_trade_check' and conrelid = 'public.accounts'::regclass");
      const live = [...def!.d.matchAll(/'([^']*)'::text/g)].map((x) => x[1]!);
      expect([...live].sort()).toEqual([...keys].sort());
    }));

  it("a new company has no trade, and every creatable key is accepted", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "each");
      const read = async () => (await c.query("select trade, trade_other from public.accounts where id = $1", [accountId])).rows;
      expect(await read()).toEqual([{ trade: null, trade_other: null }]);
      for (const key of fileCreatableKeys()) {
        await setTrade(c, accountId, key, key === "other" ? "Marketing and AI receptionist agency" : null);
        expect(await read()).toEqual([{ trade: key, trade_other: key === "other" ? "Marketing and AI receptionist agency" : null }]);
      }
    }));

  it.each(["law", "tax", "medical", "dental", "therapy", "chiropractic", "other_health", "adult_day_care", "home_health", "HVAC", "hvac ", ""])(
    "refuses %j by accounts_trade_check (mutation: drop the CHECK -> FAILS)", (bad) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "held");
        await expect(setTrade(c, accountId, bad, null))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_check" });
      }));

  it.each([null, "", "   ", "x".repeat(121)])(
    "refuses 'other' with description %j by accounts_trade_other_check (mutation: write it as length(btrim(trade_other)) between 1 and 120 -> the null case FAILS)", (desc) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "other");
        await expect(setTrade(c, accountId, "other", desc))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_other_check" });
      }));

  it("accepts 'other' with a 120-character description", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "other120");
      await setTrade(c, accountId, "other", "x".repeat(120));
    }));

  it.each([["hvac", "Something"], [null, "Something"]])(
    "refuses a description beside trade %j by accounts_trade_other_only_check (mutation: write it as trade = 'other' -> the null-trade case FAILS)", (trade, desc) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "only");
        await expect(setTrade(c, accountId, trade, desc))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_other_only_check" });
      }));

  it("a client member cannot write trade or trade_other on their own account (mutation: grant update (trade) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "member");
      await actAsMember(c, accountId, orgId, "owner");
      await expect(c.query("update public.accounts set trade = 'hvac' where id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  // Two tests, not one (plan review I1): after the first refusal the transaction is aborted, so a second
  // statement in the same withRollback would fail with "current transaction is aborted", not by its own check.
  it("an agency session cannot UPDATE trade either (column grant, mutation: grant update (trade_other) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency_upd");
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      await expect(c.query("update public.accounts set trade_other = 'x' where id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("an agency session's INSERT of a held trade is refused by the CHECK (its table-level INSERT is not a way round it)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency_ins");
      const { rows: [agency] } = await c.query<{ id: string }>("select agency_id as id from public.accounts where id = $1", [accountId]);
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      await expect(c.query(
        "insert into public.accounts (agency_id, clerk_org_id, name, trade) values ($1, $2, 'Held', 'tax')",
        [agency!.id, `org_trade_ins_${RUN}`])).rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_check" });
    }));
});

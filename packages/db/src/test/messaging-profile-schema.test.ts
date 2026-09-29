import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/** 0056 (consent chain PR-2, plan Task 7). RED BEFORE APPLY: the column does not exist. */
const RUN = Math.random().toString(36).slice(2, 10);
const P1 = "740572b6-099c-44a1-89b9-6c92163bc68d";

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [agency!.id, `org_MP_${label}_${RUN}`, `Profile ${label}`])).rows[0]!.id;
}
async function refused(c: Client, sql: string, p: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try { await c.query(sql, p); return null; } catch (e) { return e; } finally { await c.query("rollback to savepoint probe"); }
}
const SET = "update accounts set telnyx_messaging_profile_id = $2 where id = $1";

describe("0056 accounts.telnyx_messaging_profile_id", () => {
  it("holds one lowercase Telnyx profile id, and no two accounts share one (mutation: drop the unique index → the second account takes P1, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "a");
      const b = await account(c, "b");
      await c.query(SET, [a, P1]);
      expect(await refused(c, SET, [b, P1])).toMatchObject({ code: "23505", constraint: "accounts_telnyx_messaging_profile_id_key" });
      await c.query(SET, [b, null]);
    }));

  it("refuses anything that is not a lowercase uuid (mutation: drop the CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "c");
      for (const bad of [P1.toUpperCase(), "not-a-profile", ""]) {
        expect(await refused(c, SET, [a, bad]), bad).toMatchObject({ code: "23514", constraint: "accounts_telnyx_messaging_profile_id_check" });
      }
    }));

  it("is agency-written only: a client cannot update it (mutation: grant update (telnyx_messaging_profile_id) to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "d");
      await actAs(c, { org_id: `org_MP_d_${RUN}`, sub: "user_mp" });
      expect(await refused(c, SET, [a, P1])).toMatchObject({ code: "42501" });
    }));
});

import { describe, it, expect, vi } from "vitest";
import type { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitAgencyEvent } from "../events";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * F-032 Task 5 (owner ruling 2026-11-09, "Say BIS, keep names private"): which BIS person turned a client's owner
 * line off is BIS's own record, an events row with account_id NULL. events_read (0109:198) is
 * `is_agency() or account_id = current_account_id()`, so a null-account row is read by the agency and service_role
 * only, never by the client's Owner or Staff. These rows OUTLIVE deleteAccountCascade (it deletes events by
 * account_id), so nothing here writes one outside a rolled-back transaction.
 */
const USER_CLIENT = Symbol.for("@bis/db:user-client");
const TYPE = "owner_line.switch_off";

function fakeClient(opts: { user: boolean; error?: { message: string } | null }) {
  const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: opts.error ?? null }));
  const from = vi.fn(() => ({ insert }));
  const rpc = vi.fn(async () => ({ error: null }));
  const db = { from, rpc } as unknown as SupabaseClient;
  if (opts.user) Object.defineProperty(db, USER_CLIENT, { value: true });
  return { db, from, insert, rpc };
}

describe("emitAgencyEvent (unit)", () => {
  it("inserts exactly { account_id: null, type, actor_type: 'user', actor_id, payload } into events (mutation: send account_id: payload.account_id -> FAILS)", async () => {
    const f = fakeClient({ user: false });
    const payload = { account_id: "11111111-1111-4111-8111-111111111111", changed_at: "2026-11-09T20:00:00.000Z" };
    await emitAgencyEvent(f.db, TYPE, "user_bis", payload);
    expect(f.from).toHaveBeenCalledTimes(1);
    expect(f.from).toHaveBeenCalledWith("events");
    expect(f.insert).toHaveBeenCalledTimes(1);
    expect(f.insert.mock.calls[0]![0]).toStrictEqual({ account_id: null, type: TYPE, actor_type: "user", actor_id: "user_bis", payload });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("a user client is refused before any write (mutation: drop the isUserClient refusal -> FAILS)", async () => {
    const f = fakeClient({ user: true });
    await expect(emitAgencyEvent(f.db, TYPE, "user_bis", { account_id: "a" }))
      .rejects.toThrow(`event emit failed: an agency-only event needs the service client (${TYPE})`);
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("a failed insert throws, naming the database's message (mutation: ignore the insert error -> FAILS)", async () => {
    const f = fakeClient({ user: false, error: { message: "permission denied for table events" } });
    await expect(emitAgencyEvent(f.db, TYPE, "user_bis", {})).rejects.toThrow("event emit failed: permission denied for table events");
  });
});

/**
 * The row emitAgencyEvent BUILDS, inserted on the pg connection as service_role (the role serviceDb() uses), column
 * for column as given: a mutation that changes the row reaches the database unchanged.
 */
function pgServiceClient(c: Client, ids: string[]): SupabaseClient {
  return {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        const cols = Object.keys(row);
        await actAsOwner(c);
        await c.query("set local role service_role");
        const { rows } = await c.query<{ id: string }>(
          `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id::text`,
          cols.map((k) => row[k]));
        await c.query("reset role");
        ids.push(rows[0]!.id);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
}

const RUN = Math.random().toString(36).slice(2, 10);
async function seedAccount(c: Client, label: string): Promise<{ accountId: string; orgId: string }> {
  await actAsOwner(c);
  const orgId = `org_agency_event_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Agency events') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Agency events test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function visible(c: Client, ids: string[]): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>("select id::text from public.events where id::text = any($1) order by id", [ids]);
  const out = rows.map((r) => r.id);
  await actAsOwner(c);
  return out;
}

describe("emitAgencyEvent (database: who can read BIS's own record)", () => {
  it("the client's Owner and Staff read the account's event and never the agency-only one; the agency reads both; a second business reads neither (mutation: write the account's id -> the Owner case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "a");
      const b = await seedAccount(c, "b");
      const agencyOnly: string[] = [];
      await emitAgencyEvent(pgServiceClient(c, agencyOnly), TYPE, `user_bis_${RUN}`,
        { account_id: a.accountId, changed_at: "2026-11-09T20:00:00.000Z" });
      expect(agencyOnly).toHaveLength(1);
      await actAsOwner(c);
      const { rows: [own] } = await c.query<{ id: string }>(
        `insert into public.events (account_id, type, actor_type, actor_id, payload)
         values ($1, 'owner_line.probe', 'system', 'system', '{}') returning id::text`, [a.accountId]);
      const both = [agencyOnly[0]!, own!.id];

      // The stored row is exactly the null-account record (positive control for the reads below).
      const { rows: [stored] } = await c.query<{ account_id: string | null; actor_type: string; actor_id: string; payload: unknown }>(
        "select account_id, actor_type, actor_id, payload from public.events where id::text = $1", [agencyOnly[0]]);
      expect(stored).toEqual({ account_id: null, actor_type: "user", actor_id: `user_bis_${RUN}`,
        payload: { account_id: a.accountId, changed_at: "2026-11-09T20:00:00.000Z" } });

      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await visible(c, both), "the account's Owner").toEqual([own!.id]);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect(await visible(c, both), "the account's Staff").toEqual([own!.id]);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await visible(c, both), "another business's Owner").toEqual([]);
      await actAs(c, { app_role: "agency_admin", sub: `user_bis_${RUN}` });
      expect(await visible(c, both), "the agency").toEqual([...both].sort((x, y) => Number(x) - Number(y)));
    }));
});

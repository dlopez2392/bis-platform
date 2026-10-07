import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withRollback } from "./db";
import { planTelnyxBackfill, telnyxBackfillSql } from "../backfill/telnyx-optouts";

/**
 * The backfill end to end inside a rolled-back transaction: the owners read,
 * the plan, the emitted SQL run as the database owner (what execute_sql is),
 * and a second run. RED BEFORE APPLY: the function does not exist on `pre`.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const owners = readFileSync(fileURLToPath(new URL("../../supabase/backfills/0055-telnyx-optout-owners.sql", import.meta.url)), "utf8");

describe("the Telnyx opt-out backfill, run", () => {
  it("writes one revoked row per opt-out, dated at the opt-out, and a re-run after the customer's own START still writes nothing — the guard cannot mask it (review R1-I2; mutation: a source_ref that varies per run → the re-run appends a second stop, FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Backfill') returning id", [agency!.id, `org_TB_${RUN}`])).rows[0]!.id;
      // Seven random digits: phone_numbers.e164 is unique across every account on the shared CI project.
      const number = `+1956${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
      await c.query("insert into phone_numbers (account_id, e164, status) values ($1, $2, 'live')", [acct, number]);
      const ownerRows = (await c.query<{ e164: string; account_id: string; status: string }>(owners)).rows;
      expect(ownerRows.some((o) => o.e164 === number && o.account_id === acct)).toBe(true);
      // Built afresh each time, as a second session would build it.
      const statement = () => telnyxBackfillSql(planTelnyxBackfill([
        { from: number, to: "+19565551234", messaging_profile_id: "p", keyword: "STOP", created_at: "2025-04-28T12:00:38Z" },
      ], ownerRows));
      expect((await c.query(statement())).rows).toEqual([{ outcome: "appended", n: 1 }]);
      // The customer texts START afterwards: the address is allowed again, so
      // `unless_customer_stopped` would let a second stop through. Only the
      // source (one opt-out event) stops the re-run from writing it again.
      await c.query("set local role service_role");
      await c.query(
        "select * from public.append_consent_event($1, 'sms', '+19565551234', 'resubscribed', 'start_keyword', 'none', null, null, null, null, 'msg_start_1', '{}'::jsonb, null)", [acct]);
      await c.query("reset role");
      expect((await c.query(statement())).rows).toEqual([{ outcome: "duplicate", n: 1 }]);
      const { rows } = await c.query(
        "select action, method, occurred_at, source_ref from consent_events where account_id = $1 and method = 'backfill_telnyx'", [acct]);
      expect(rows).toEqual([{ action: "revoked", method: "backfill_telnyx", occurred_at: new Date("2025-04-28T12:00:38Z"), source_ref: `telnyx_optout:${number}:+19565551234:2025-04-28T12:00:38.000Z` }]);
    }));
});

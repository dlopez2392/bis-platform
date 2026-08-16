import { describe, it, expect } from "vitest";
import { withRollback } from "./db";

/**
 * The column grant is invisible in application code: nothing in TypeScript
 * says a client cannot write `client_access_enabled`. This file is the
 * assertion that says it.
 *
 * Deliberately an EXACT SET rather than a "contains". Adding a branding
 * column later without adding it to the grant means that field saves for the
 * agency and silently fails for clients; adding a NON-branding column to the
 * grant is an escalation. Both directions have to go red here.
 */
const BRANDING_COLUMNS = [
  "brand_color",
  "brand_corners",
  "brand_logo_path",
  "brand_mode",
  "brand_name",
  "brand_neutral",
  "brand_type",
  // Not visual branding, and it belongs here for the same reason as the rest:
  // a client edits it on the same page, through the same RLS-enforced write.
  "reply_to_email",
].sort();

// `withRollback` is the connection helper this package exposes (with `actAs`
// and `actAsOwner`). It hands back no value, so every assertion happens
// INSIDE the callback. These are pure `select`s against the catalog, so the
// rollback it wraps them in costs nothing.
describe("accounts column privileges for authenticated", () => {
  it("grants UPDATE on exactly the columns a client may write", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name
           from information_schema.column_privileges
          where grantee = 'authenticated'
            and table_schema = 'public'
            and table_name = 'accounts'
            and privilege_type = 'UPDATE'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(BRANDING_COLUMNS);
    });
  });

  it("does not grant UPDATE on client_access_enabled, the escalation this prevents", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name
           from information_schema.column_privileges
          where grantee = 'authenticated'
            and table_schema = 'public'
            and table_name = 'accounts'
            and privilege_type = 'UPDATE'
            and column_name in ('client_access_enabled', 'name', 'clerk_org_id', 'agency_id')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it("has the accounts_member_update policy, scoped by org AND the access flag", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ qual: string; with_check: string }>(
        `select qual, with_check from pg_policies
          where schemaname = 'public'
            and tablename = 'accounts'
            and policyname = 'accounts_member_update'`,
      );
      expect(rows).toHaveLength(1);
      // Both halves matter: `qual` decides which rows the update can see,
      // `with_check` decides what the row is allowed to BECOME. Without the
      // second, a client could move their own row to another org.
      for (const clause of [rows[0]!.qual, rows[0]!.with_check]) {
        expect(clause).toContain("client_access_enabled");
        expect(clause).toContain("org_id");
      }
    });
  });
});

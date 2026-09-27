import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { withRollback } from "./db";

/**
 * Migration 0049: `contacts.marketing_email_opted_out_at`.
 *
 * What the file proves, and what it cannot:
 *   - the column's shape (nullable timestamptz, NO default: every contact
 *     starts "may receive"), read from the catalogue;
 *   - that the client role can write it, which since 0053 comes from the
 *     column UPDATE grant on contacts (0053, section 5);
 *   - the contacts column ACLs, exactly: the twelve client-updatable columns
 *     0053 grants by name, plus `sort_name` (0030's no-op SELECT grant);
 *   - that the comment stored live is the comment in the LATEST migration
 *     that sets it (0053 re-comments the column), so the file is a statement
 *     about production (0048's lesson: its first apply stored something other
 *     than the file).
 *
 * RED BEFORE APPLY could not be shown for 0049's cases: 0049 was applied at
 * the migration's STOP POINT, before this test was written. The live-vs-file
 * case is the one whose red is demonstrable after the fact, by mutating the
 * file.
 */

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "..", "supabase", "migrations", "0053_server_only_writes.sql"), "utf8");

/** The `comment on column ... is '...'` literal, un-doubled. */
const FILE_COMMENT = (() => {
  const m = MIGRATION.match(/comment on column public\.contacts\.marketing_email_opted_out_at is\s*'((?:[^']|'')*)';/);
  if (!m) throw new Error("0053: no column comment found in the migration file");
  return m[1]!.replace(/''/g, "'");
})();

describe("0049 contacts.marketing_email_opted_out_at", () => {
  it("is a nullable timestamptz with no default: every contact starts able to receive marketing email", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'contacts'
            and column_name = 'marketing_email_opted_out_at'`);
      expect(rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]);
    });
  });

  it("is writable by the client role through 0053's column grant", async () => {
    await withRollback(async (c) => {
      const privs = async (col: string) => (await c.query<{ p: string }>(
        `select privilege_type as p from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'contacts' and column_name = $1 order by privilege_type`,
        [col])).rows.map((r) => r.p);
      const OPERATOR_FIELD = ["INSERT", "SELECT", "UPDATE"];
      // The control first, as a literal: two empty sets are also equal.
      expect(await privs("first_name"), "contacts.first_name (the control)").toEqual(OPERATOR_FIELD);
      expect(await privs("marketing_email_opted_out_at")).toEqual(OPERATOR_FIELD);

      // `attname` is type name, which always sorts in the C collation, so
      // this order does not depend on the database's locale.
      const { rows } = await c.query<{ attname: string }>(
        `select attname from pg_attribute
          where attrelid = 'public.contacts'::regclass and attnum > 0
            and not attisdropped and attacl is not null
          order by attname`);
      expect(rows.map((r) => r.attname)).toEqual([
        "assigned_to", "attribution", "company_name", "custom", "dnd", "email", "first_name", "last_name",
        "marketing_email_opted_out_at", "phone", "phone_country_unconfirmed", "sort_name", "source", "updated_at",
      ]);
    });
  });

  it("stores the LATEST migration's column comment live (0053)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ d: string | null }>(
        `select col_description('public.contacts'::regclass, a.attnum) as d
           from pg_attribute a
          where a.attrelid = 'public.contacts'::regclass
            and a.attname = 'marketing_email_opted_out_at'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.d).toBe(FILE_COMMENT);
    });
  });
});

import { describe, it, expect } from "vitest";
import { withRollback } from "./db";

/**
 * Calendar SETTINGS are the client's business data — hours, duration, the
 * enabled switch — and are client-editable by design, like M4c's branding.
 * Identity columns are not: `public_id` is a global capability and
 * `account_id` is the tenancy anchor. The grant list IS the boundary, so it
 * is pinned exactly, in both directions.
 *
 * `bookings` carries NO client UPDATE grant at all: operators mutate bookings
 * through server actions (status changes), and the public flow writes through
 * serviceDb. A client-role UPDATE on bookings has no legitimate caller.
 */
const CALENDAR_SETTINGS_COLUMNS = [
  "buffer_minutes",
  "enabled",
  "followup_body",     // client-editable settings knob, granted by 0022
  "followup_enabled",  // client-editable settings knob, granted by 0022
  "max_advance_days",
  "meeting_type",      // client-editable settings knob, granted by 0022
  "min_notice_hours",
  "notify_emails",
  "open_hours",
  "slot_duration_minutes",
  "updated_at", // stamped by updateCalendarSettings on every save; granted by 0018
].sort();

describe("booking column privileges for authenticated", () => {
  it("grants UPDATE on exactly the calendar settings columns", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'calendars' and privilege_type = 'UPDATE'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(CALENDAR_SETTINGS_COLUMNS);
    });
  });

  it("never grants UPDATE on calendar identity or on bookings", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and privilege_type = 'UPDATE'
            and ((table_name = 'calendars' and column_name in ('public_id','account_id','id'))
              or table_name = 'bookings')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it("scopes both tenant policies to authenticated, never PUBLIC", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ tablename: string; roles: string }>(
        `select tablename, roles::text from pg_policies
          where schemaname = 'public' and tablename in ('calendars','bookings')
          order by tablename`,
      );
      expect(rows).toHaveLength(2);
      // pg_policies.roles is '{public}' for an unscoped policy — the defect
      // 0017 exists to correct. Nothing else in this schema asserts policy
      // scope, which is exactly why 0016 shipped without one.
      for (const row of rows) expect(row.roles).toBe("{authenticated}");
    });
  });
});
